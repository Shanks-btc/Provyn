/**
 * The agent's price cross-check: Pyth first, Finnhub as a clearly-labelled fallback, otherwise unavailable.
 *
 * Two DIFFERENT comparisons, so the result always says which one it is (`comparison`) and who answered (`source`):
 *   - source "pyth":    Pyth's real-equity feed vs Pyth's own xStock feed (unchanged behaviour).
 *   - source "finnhub": Kamino's on-chain oracle price (divided by the mint's UI multiplier) vs Finnhub's real stock quote.
 * The agent must never describe a Finnhub result as "verified by Pyth"; grounding.ts rejects a proposal that does.
 */

import type { KaminoClient } from "../kamino/client";
import { finnhubEnabled, getMarketStatus, getQuote, type FinnhubMarketStatus, type FinnhubQuote, type FinnhubError } from "../finnhub/quote";
import type { PythFeedClient, DivergenceCheck } from "../pyth/feeds";

/**
 * A gap above this, measured while the market is OPEN, is a "meaningful divergence". 1% is not a new number: it is the
 * lower end of the system prompt's existing guidance ("a spread over ~1-2% ... is a real risk"), taken at its
 * conservative end. Measured 2026-10-06 after the multiplier adjustment: closed session, -0.03% to -0.06% on all three
 * assets; OPEN session (13:30-13:32 UTC, two samples x three assets), -0.54% to +0.14%, the widest gap being TSLAx and
 * SPYx seconds after the open while Kamino's oracle had not yet caught up. All inside 1%, so it leaves headroom without
 * loosening anything.
 */
export const MEANINGFUL_DIVERGENCE_PCT = 1;

/**
 * Finnhub says the market is open, but is the quote actually moving? If its last trade is older than this, the
 * reference is treated as "unknown" session (coarse), never "open". 15 minutes is a provisional bound, chosen to be
 * generous for liquid large caps. Quote ages observed live at the open on 2026-10-06: 8-11s and 31-33s, so the bound is
 * not tight; it only catches a quote that has stopped moving while the market is reported open.
 */
export const OPEN_QUOTE_MAX_AGE_SECONDS = 900;

/**
 * NO wider closed-session tolerance is defined. xStocks trade 24/7 on chain while Finnhub's quote outside regular hours
 * is the last close, so a gap then can be an after-hours move rather than a mispricing, but one snapshot of three assets
 * (-0.06% to -0.03%) is not enough evidence to say how wide an after-hours gap can honestly be. So a closed or unknown
 * session is always a COARSE check: the gap is reported, never classified as a meaningful divergence, and the agent
 * sizes exactly as conservatively as when the check is unavailable. Loosening this needs evidence from real sessions.
 */

export type Session = "open" | "closed" | "unknown";
export type Classification = "within_tolerance" | "meaningful_divergence" | "informational_closed_session";

export interface FinnhubDivergence {
  available: true;
  source: "finnhub";
  comparison: "kamino_oracle_vs_finnhub_quote";
  symbol: string;
  referenceTicker: string;
  referenceSession: Session;
  /** ISO time of Finnhub's last trade (the last close when the market is not open). */
  referenceAsOf: string;
  referenceQuoteAgeSeconds: number;
  referencePriceUsd: number;
  market: { isOpen: boolean | null; session: string | null; holiday: string | null };
  onChainOraclePriceUsd: number;
  uiMultiplier: number;
  uiMultiplierSource: string;
  onChainPriceAdjustedUsd: number;
  /** (adjusted on-chain - Finnhub) / Finnhub * 100 */
  spreadPct: number;
  classification: Classification;
  coarse: boolean;
  pythUnavailableReason: string;
  /** Plain statement of exactly what was and was not checked. The agent must carry this into its summary and risks. */
  disclosure: string;
}

export interface PythDivergence extends DivergenceCheck {
  available: true;
  source: "pyth";
  comparison: "pyth_equity_vs_pyth_xstock_feed";
  referenceSession: Session;
  referenceAsOf: string;
}

export interface PriceUnavailable {
  available: false;
  symbol: string;
  /** Why Pyth could not answer (unchanged field). */
  error: string;
  /** Why the Finnhub fallback could not answer either. Absent when the fallback is switched off (FINNHUB_ENABLED not true). */
  finnhubError?: string;
}

export type PriceCheckResult = PythDivergence | FinnhubDivergence | PriceUnavailable;

export interface PriceCheckDeps {
  pyth: Pick<PythFeedClient, "checkDivergence">;
  kamino: Pick<KaminoClient, "getOracleReference">;
  /** Overrides the FINNHUB_ENABLED env flag (tests). */
  finnhubEnabled?: boolean;
  finnhub?: {
    getQuote: (symbol: string) => Promise<FinnhubQuote | FinnhubError>;
    getMarketStatus: () => Promise<FinnhubMarketStatus | FinnhubError>;
  };
}

const pct = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;

export async function checkPriceDivergence(symbol: string, deps: PriceCheckDeps): Promise<PriceCheckResult> {
  const finnhub = deps.finnhub ?? { getQuote, getMarketStatus };

  // 1. Pyth stays first. If it answers, behaviour is unchanged (plus the labels).
  let pythError: string;
  try {
    const check = await deps.pyth.checkDivergence(symbol);
    return {
      available: true,
      source: "pyth",
      comparison: "pyth_equity_vs_pyth_xstock_feed",
      referenceSession: "unknown",
      referenceAsOf: new Date(check.realPrice.publishTimeUnix * 1000).toISOString(),
      ...check,
    };
  } catch (err) {
    pythError = (err as Error).message;
  }

  // The fallback is opt-in. With it off, behaviour is exactly what it was before the fallback existed: Pyth, then
  // { available: false, symbol, error }. Finnhub is not called, and nothing mentions it.
  if (!(deps.finnhubEnabled ?? finnhubEnabled())) return { available: false, symbol, error: pythError };

  // 2. Finnhub fallback. Never throws; every failure ends in the same `available: false` shape as before.
  const unavailable = (finnhubError: string): PriceUnavailable => ({ available: false, symbol, error: pythError, finnhubError });
  try {
    const [quote, status, ref] = await Promise.all([finnhub.getQuote(symbol), finnhub.getMarketStatus(), deps.kamino.getOracleReference(symbol)]);
    if (!quote.ok) return unavailable(quote.error);
    if (ref.uiMultiplier === null) {
      // An unadjusted comparison can be off by 0.5%+ (SPYx), so without the multiplier there is no honest number.
      return unavailable(`the xStock's UI multiplier could not be read (${ref.uiMultiplierSource}), so Kamino's price cannot be compared with the stock quote`);
    }

    const ageSeconds = Math.max(0, Math.floor(Date.now() / 1000) - quote.quoteTime);
    // The session comes from Finnhub's own market-status; an "open" claim must also be backed by a recent trade.
    const session: Session = !status.ok ? "unknown" : status.isOpen ? (ageSeconds <= OPEN_QUOTE_MAX_AGE_SECONDS ? "open" : "unknown") : "closed";

    const adjusted = ref.oraclePriceUsd / ref.uiMultiplier;
    const spreadPct = ((adjusted - quote.price) / quote.price) * 100;
    const over = Math.abs(spreadPct) > MEANINGFUL_DIVERGENCE_PCT;
    const classification: Classification = !over ? "within_tolerance" : session === "open" ? "meaningful_divergence" : "informational_closed_session";
    const coarse = session !== "open";

    const sessionNote =
      session === "open"
        ? "The US market is open, so Finnhub's quote is live."
        : session === "closed"
          ? `The US market is CLOSED${status.ok && status.session ? ` (${status.session})` : ""}${status.ok && status.holiday ? `, ${status.holiday}` : ""}: Finnhub's quote is the LAST CLOSE (${new Date(quote.quoteTime * 1000).toISOString()}), while the xStock trades 24/7, so a gap can be an after-hours move rather than a mispricing.`
          : `The market session could not be confirmed as live (${status.ok ? `Finnhub reports open but its last trade is ${ageSeconds}s old` : status.error}), so the reference may be stale.`;
    const verdict = coarse
      ? `This is a COARSE check (no wider after-hours tolerance has been established): the ${pct(spreadPct)} gap is reported, not classified as a meaningful divergence. Size exactly as conservatively as if the check were unavailable.`
      : over
        ? `The ${pct(spreadPct)} gap exceeds ${MEANINGFUL_DIVERGENCE_PCT}% while the market is open: treat it as a real divergence.`
        : `The ${pct(spreadPct)} gap is within ${MEANINGFUL_DIVERGENCE_PCT}%.`;

    return {
      available: true,
      source: "finnhub",
      comparison: "kamino_oracle_vs_finnhub_quote",
      symbol,
      referenceTicker: quote.ticker,
      referenceSession: session,
      referenceAsOf: new Date(quote.quoteTime * 1000).toISOString(),
      referenceQuoteAgeSeconds: ageSeconds,
      referencePriceUsd: quote.price,
      market: status.ok ? { isOpen: status.isOpen, session: status.session, holiday: status.holiday } : { isOpen: null, session: null, holiday: null },
      onChainOraclePriceUsd: ref.oraclePriceUsd,
      uiMultiplier: ref.uiMultiplier,
      uiMultiplierSource: ref.uiMultiplierSource,
      onChainPriceAdjustedUsd: adjusted,
      spreadPct,
      classification,
      coarse,
      pythUnavailableReason: pythError,
      disclosure:
        `Pyth could not be used (${pythError}). This price cross-check came from FINNHUB, not Pyth: Kamino's oracle price ` +
        `(${ref.oraclePriceUsd.toFixed(2)}, divided by the xStock's UI multiplier ${ref.uiMultiplier}) against Finnhub's ${quote.ticker} quote (${quote.price}). ` +
        `${sessionNote} ${verdict}`,
    };
  } catch (err) {
    return unavailable((err as Error).message);
  }
}
