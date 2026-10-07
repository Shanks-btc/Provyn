/**
 * Finnhub reference prices for the agent's price cross-check fallback (used when Pyth cannot answer).
 *
 * Deliberately small and safe to call from the agent loop:
 *   - Only the three supported assets map to a ticker (AAPLx → AAPL, SPYx → SPY, TSLAx → TSLA); anything else is
 *     "unavailable", never an open proxy for arbitrary tickers.
 *   - NEVER throws: every function returns a structured `{ ok: false, error }` instead.
 *   - 12 s per attempt and ONE retry. Finnhub's latency is uneven (MEASURED 2026-09-27: usually ~0.5 s, with spikes of
 *     6.1 s and 9.7 s on two of ten calls), so a short timeout with no retry turns a slow answer into a false failure.
 *   - ~30 s in-memory cache so one agent run (several tool calls) does not call Finnhub twice for the same thing.
 *   - The key is read from FINNHUB_API_KEY at call time, sent in a header (never in the URL) and never logged.
 *
 * OPT-IN, DEFAULT OFF (FINNHUB_ENABLED=true). Finnhub's free plan is personal-use only and its terms bar sharing its data
 * or "derived results" with third parties without written approval (https://finnhub.io/terms-of-service, read 2026-10-06),
 * so nothing public or business-facing may depend on it. With the flag off every function here returns a structured
 * `{ ok: false, disabled: true }` WITHOUT calling Finnhub, so no caller can reach the network by accident.
 *
 * Market hours are NEVER inferred here: `isOpen` / `session` are Finnhub's own /stock/market-status response.
 */

const BASE = process.env.FINNHUB_BASE_URL ?? "https://finnhub.io/api/v1";
const ATTEMPT_TIMEOUT_MS = 12_000;
const CACHE_MS = 30_000;

/** The xStocks Provyn supports, and the real US ticker each one tracks. */
export const FINNHUB_TICKERS: Record<string, string> = { AAPLx: "AAPL", SPYx: "SPY", TSLAx: "TSLA" };

/** Finnhub is used only when FINNHUB_ENABLED is exactly "true". Read at call time so a restart is not needed to flip it. */
export const finnhubEnabled = () => process.env.FINNHUB_ENABLED === "true";

export type FinnhubError = { ok: false; error: string; /** true when the flag is off: Finnhub was not called at all. */ disabled?: true };
const DISABLED: FinnhubError = { ok: false, error: "Finnhub is disabled (FINNHUB_ENABLED is not true)", disabled: true };

export interface FinnhubQuote {
  ok: true;
  symbol: string; // the xStock symbol asked for, e.g. "AAPLx"
  ticker: string; // the real ticker queried, e.g. "AAPL"
  price: number; // Finnhub "c": the current price, or the last close when the market is not open
  previousClose: number;
  quoteTime: number; // unix seconds of Finnhub's last trade
  fetchedAt: string;
}

export interface FinnhubMarketStatus {
  ok: true;
  exchange: string;
  isOpen: boolean;
  session: string | null; // "pre-market" | "regular" | "post-market" | null, as Finnhub reports it
  holiday: string | null;
  timezone: string;
  time: number;
}

interface RawQuote { c: number; pc: number; t: number }
interface RawStatus { exchange: string; holiday: string | null; isOpen: boolean; session: string | null; timezone: string; t: number }

const cache = new Map<string, { at: number; value: unknown }>();

async function call<T>(path: string): Promise<{ ok: true; value: T } | FinnhubError> {
  const key = process.env.FINNHUB_API_KEY;
  if (!key) return { ok: false, error: "FINNHUB_API_KEY is not configured" };
  for (let attempt = 1; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(`${BASE}${path}`, { headers: { "X-Finnhub-Token": key }, signal: AbortSignal.timeout(ATTEMPT_TIMEOUT_MS), cache: "no-store" });
    } catch {
      // Timeout or dropped connection: nothing says the key or request is wrong, so try once more.
      if (attempt < 2) continue;
      return { ok: false, error: "Finnhub took too long to respond" };
    }
    if (res.status === 401 || res.status === 403) return { ok: false, error: "Finnhub rejected the API key or plan for this request" };
    if (res.status === 429) return { ok: false, error: "Finnhub rate limit reached" };
    if (res.status >= 500 && attempt < 2) continue;
    if (!res.ok) return { ok: false, error: `Finnhub returned ${res.status}` };
    try {
      return { ok: true, value: (await res.json()) as T };
    } catch {
      return { ok: false, error: "Finnhub returned an unreadable response" };
    }
  }
}

async function cached<T extends { ok: true }>(id: string, load: () => Promise<T | FinnhubError>): Promise<T | FinnhubError> {
  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value as T;
  const value = await load();
  if (value.ok) cache.set(id, { at: Date.now(), value }); // failures are never cached
  return value;
}

/**
 * Real quote for a supported xStock. Returns `{ ok: false }` for unsupported symbols, no key, or any Finnhub failure.
 * `tickers` defaults to the agent's three-asset map; the risk-data collector passes its own wider map instead, so the
 * agent's behaviour is unchanged.
 */
export function getQuote(symbol: string, tickers: Record<string, string> = FINNHUB_TICKERS): Promise<FinnhubQuote | FinnhubError> {
  if (!finnhubEnabled()) return Promise.resolve(DISABLED);
  const ticker = tickers[symbol];
  if (!ticker) return Promise.resolve({ ok: false, error: `No Finnhub ticker mapped for "${symbol}"` });
  return cached<FinnhubQuote>(`quote:${ticker}`, async () => {
    const r = await call<RawQuote>(`/quote?symbol=${ticker}`);
    if (!r.ok) return r;
    // Finnhub answers an unknown symbol with all zeros rather than an error.
    if (!r.value || !(r.value.c > 0)) return { ok: false, error: `Finnhub has no quote for ${ticker}` };
    return { ok: true, symbol, ticker, price: r.value.c, previousClose: r.value.pc, quoteTime: r.value.t, fetchedAt: new Date().toISOString() };
  });
}

/** Finnhub's own US market status. Never inferred from the clock. */
export function getMarketStatus(): Promise<FinnhubMarketStatus | FinnhubError> {
  if (!finnhubEnabled()) return Promise.resolve(DISABLED);
  return cached<FinnhubMarketStatus>("status:US", async () => {
    const r = await call<RawStatus>(`/stock/market-status?exchange=US`);
    if (!r.ok) return r;
    const s = r.value;
    if (!s || typeof s.isOpen !== "boolean") return { ok: false, error: "Finnhub returned no market status" };
    return { ok: true, exchange: s.exchange, isOpen: s.isOpen, session: s.session, holiday: s.holiday, timezone: s.timezone, time: s.t };
  });
}
