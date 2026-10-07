import type { NextRequest } from "next/server";
import { fail, HttpError, json } from "@/lib/server/parity";
import { clientIp, rateLimit, rateLimitedResponse } from "@/lib/server/rate-limit";
import { finnhubEnabled } from "../../../../../src/finnhub/quote";

export const dynamic = "force-dynamic";

/**
 * GET /api/trade/quote?symbol=AAPL — the ONE real number on the Trade concept page: a US stock's real-time quote from
 * Finnhub plus Finnhub's own market-status, combined. Server-side only: FINNHUB_API_KEY is never sent to the browser
 * (it is not NEXT_PUBLIC_) and is passed to Finnhub in a header, not the URL.
 *
 * Free-tier reality (Finnhub's own tracker): historical candles for US stocks are no longer free — only /quote and
 * /stock/market-status — so the chart and orderbook stay simulated and this is just a price.
 *
 * Market hours are NEVER inferred here: `market.isOpen` / `session` are Finnhub's response, passed through.
 */
const FINNHUB = process.env.FINNHUB_BASE_URL ?? "https://finnhub.io/api/v1";
// The assets this app trades; not an open proxy for arbitrary tickers.
const SYMBOLS = ["AAPL", "SPY", "TSLA"];
const CACHE_MS = 15_000; // one upstream pair per symbol per 15s, however many visitors poll (free tier: 60 calls/min)
// Finnhub's latency is spiky: MEASURED 2026-09-27 from the dev machine, a call that normally takes ~0.5s took 6.1s and
// 9.7s on two of ten tries. An 8s timeout with no retry turned those into HTTP 500 "aborted due to timeout" on the page.
// So: a 12s budget per attempt, one retry, and — if Finnhub still can't answer — the last good quote (flagged stale)
// instead of an error, for up to 10 minutes.
const ATTEMPT_TIMEOUT_MS = 12_000;
const STALE_OK_MS = 10 * 60_000;
const PER_IP_PER_MINUTE = 30;

interface FinnhubQuote { c: number; d: number | null; dp: number | null; h: number; l: number; o: number; pc: number; t: number }
interface FinnhubStatus { exchange: string; holiday: string | null; isOpen: boolean; session: string | null; timezone: string; t: number }

const cache = new Map<string, { at: number; body: unknown }>();

async function finnhub<T>(path: string, key: string): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(`${FINNHUB}${path}`, { headers: { "X-Finnhub-Token": key }, signal: AbortSignal.timeout(ATTEMPT_TIMEOUT_MS), cache: "no-store" });
    } catch {
      // Timeout or dropped connection: nothing says the key or request is wrong, so try once more.
      if (attempt < 2) continue;
      throw new HttpError(504, "Finnhub took too long to respond.");
    }
    if (res.status === 401 || res.status === 403) throw new HttpError(502, "Finnhub rejected the API key or plan for this request.");
    if (res.status === 429) throw new HttpError(502, "Finnhub rate limit reached, try again shortly.");
    if (res.status >= 500 && attempt < 2) continue;
    if (!res.ok) throw new HttpError(502, `Finnhub returned ${res.status}.`);
    return (await res.json()) as T;
  }
}

/** One upstream fetch per symbol at a time: concurrent polls share it instead of each spending quota (and waiting). */
const inflight = new Map<string, Promise<Record<string, unknown>>>();

async function fetchBody(symbol: string, key: string): Promise<Record<string, unknown>> {
  const [quote, status] = await Promise.all([
    finnhub<FinnhubQuote>(`/quote?symbol=${symbol}`, key),
    finnhub<FinnhubStatus>(`/stock/market-status?exchange=US`, key),
  ]);
  // Finnhub answers an unknown / unsupported symbol with all zeros rather than an error.
  if (!quote || quote.c === 0) throw new HttpError(502, `Finnhub has no quote for ${symbol}.`);
  return {
    symbol,
    source: "finnhub",
    price: quote.c,
    change: quote.d,
    changePercent: quote.dp,
    high: quote.h,
    low: quote.l,
    open: quote.o,
    previousClose: quote.pc,
    quoteTime: quote.t, // unix seconds of Finnhub's last trade
    market: { exchange: status.exchange, isOpen: status.isOpen, session: status.session, holiday: status.holiday, timezone: status.timezone, time: status.t },
    fetchedAt: new Date().toISOString(),
  };
}

export async function GET(req: NextRequest) {
  try {
    // Finnhub is opt-in (FINNHUB_ENABLED=true): its free plan is personal-use only and bars sharing its data. With the flag
    // off this route does nothing and calls nothing; the Trade page does not render the band at all.
    if (!finnhubEnabled()) throw new HttpError(404, "Live price is not available.");
    const key = process.env.FINNHUB_API_KEY;
    if (!key) throw new HttpError(503, "Live price is not configured on this server (FINNHUB_API_KEY is missing).");
    const symbol = (req.nextUrl.searchParams.get("symbol") ?? "AAPL").toUpperCase();
    if (!SYMBOLS.includes(symbol)) throw new HttpError(400, `symbol must be one of ${SYMBOLS.join(", ")}.`);

    const cached = cache.get(symbol);
    if (cached && Date.now() - cached.at < CACHE_MS) return json(cached.body);

    const retryAfter = rateLimit(`quote:${clientIp(req)}`, PER_IP_PER_MINUTE);
    if (retryAfter !== null) return rateLimitedResponse(retryAfter, "price requests");

    try {
      let pending = inflight.get(symbol);
      if (!pending) {
        pending = fetchBody(symbol, key).finally(() => inflight.delete(symbol));
        inflight.set(symbol, pending);
      }
      const body = await pending;
      cache.set(symbol, { at: Date.now(), body });
      return json(body);
    } catch (err) {
      // Finnhub is slow/down: a quote from the last few minutes beats an error, as long as it says it is stale.
      if (cached && Date.now() - cached.at < STALE_OK_MS && !(err instanceof HttpError && err.status === 400)) {
        return json({ ...(cached.body as object), stale: true, staleSeconds: Math.round((Date.now() - cached.at) / 1000) });
      }
      throw err;
    }
  } catch (err) {
    return fail(err);
  }
}
