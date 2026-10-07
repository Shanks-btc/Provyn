/**
 * Sampling logic for the equity-collateral risk dataset. No scheduling here (see collect.ts) and no storage format
 * (see store.ts): this turns "the world right now" into rows, with every source injectable so failures can be tested.
 *
 * Rules, enforced by construction:
 *   - A failed or timed-out source writes null for its fields plus a short reason in `errors`. Nothing is interpolated,
 *     forward-filled or invented, and one failing source never stops the others or the loop.
 *   - Market-level data only: no wallet address, mint address or reserve address is ever written.
 *   - Idempotent: the store refuses a (series, asset, bucket) key it already holds.
 */

import { KaminoClient } from "../kamino/client";
import { finnhubEnabled, getMarketStatus, getQuote, type FinnhubError, type FinnhubMarketStatus, type FinnhubQuote } from "../finnhub/quote";
import { OPEN_QUOTE_MAX_AGE_SECONDS } from "../agent/priceCheck";
import type { RiskStore } from "./store";

export const SAMPLE_MS = 5 * 60_000;
export const MARKET_STATE_MS = 30 * 60_000;

/**
 * xStock -> the real US ticker it tracks, for the COLLECTOR only (the agent's fallback keeps its own three-asset map).
 * An xStock listed on Kamino but absent here is still sampled; its reference is simply null.
 */
export const COLLECTOR_TICKERS: Record<string, string> = {
  AAPLx: "AAPL",
  SPYx: "SPY",
  TSLAx: "TSLA",
  MSTRx: "MSTR",
  GOOGLx: "GOOGL",
  QQQx: "QQQ",
  NVDAx: "NVDA",
  CRCLx: "CRCL",
  HOODx: "HOOD",
  METAx: "META",
};

/** Per-source time budgets. Kamino's HTTP API took ~8s per call on 2026-09-24 (0.6-2.3s on 2026-10-06), so 25s. */
export const TIMEOUT_MS = { marketLoad: 60_000, rpc: 20_000, kaminoApi: 25_000 };

/** Percentages come from fractions times 100 (0.55 * 100 = 55.00000000000001): round away the float noise at the source. */
export const round6 = (x: number) => Math.round(x * 1e6) / 1e6;

export const bucket = (nowMs: number, size: number) => new Date(Math.floor(nowMs / size) * size).toISOString();

export function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    p.finally(() => clearTimeout(timer)),
    new Promise<never>((_, rej) => {
      timer = setTimeout(() => rej(new Error(`${what} timed out after ${ms / 1000}s`)), ms);
    }),
  ]);
}

/** A one-line reason, never a stack, never an address-shaped string (public keys are redacted defensively). */
export const reason = (e: unknown) =>
  (e instanceof Error ? e.message : String(e))
    .replace(/[1-9A-HJ-NP-Za-km-z]{32,44}/g, "<addr>")
    .replace(/api-key=[^&\s]+/gi, "api-key=<redacted>")
    .slice(0, 160);

export interface MarketStateFields {
  depositedTokens: number;
  depositedUsd: number;
  borrowApyPct: number;
  supplyApyPct: number;
  loanToValuePct: number;
  liquidationThresholdPct: number;
  /** null when only the leverage/metrics API failed: the SDK-side fields above are still real, so they are kept. */
  multiplyPositions: number | null;
  multiplyAvgLeverage: number | null;
  /** Per-field failures inside an otherwise successful read. */
  partialErrors?: Record<string, string>;
}

export interface Sources {
  /** Reload Kamino's market so oracle prices are current. Throwing means "no fresh Kamino data this tick". */
  loadMarket(): Promise<void>;
  /** The xStock symbols to sample (all of Kamino's xStocks). */
  assets(): string[];
  oracleReference(symbol: string): Promise<{ oraclePriceUsd: number; uiMultiplier: number | null; uiMultiplierSource: string }>;
  quote(symbol: string): Promise<FinnhubQuote | FinnhubError>;
  marketStatus(): Promise<FinnhubMarketStatus | FinnhubError>;
  marketState(symbol: string): Promise<MarketStateFields>;
}

export function realSources(kamino: KaminoClient): Sources {
  return {
    loadMarket: () => withTimeout(kamino.init(), TIMEOUT_MS.marketLoad, "Kamino market load"),
    assets: () => kamino.listXStockReserves().map((r) => r.symbol),
    oracleReference: (s) => withTimeout(kamino.getOracleReference(s), TIMEOUT_MS.rpc, "oracle + multiplier read"),
    quote: (s) => getQuote(s, COLLECTOR_TICKERS),
    marketStatus: () => getMarketStatus(),
    marketState: async (symbol) => {
      // Same reads as `npm run snapshot:landing`: SDK reserve stats, then the leverage/metrics API.
      const r = kamino.getReserve(symbol);
      const slot = await withTimeout(kamino.getRpc().getSlot().send(), TIMEOUT_MS.rpc, "getSlot");
      let rows: Awaited<ReturnType<typeof kamino.getMultiplyMetrics>> = [];
      let multiplyError: string | null = null;
      try {
        rows = (await withTimeout(kamino.getMultiplyMetrics(symbol), TIMEOUT_MS.kaminoApi, "Kamino leverage/metrics")).filter((m) => Number(m.totalObligations) > 0);
      } catch (e) {
        multiplyError = reason(e);
      }
      const positions = rows.reduce((n, m) => n + Number(m.totalObligations), 0);
      return {
        depositedTokens: Number(r.getTotalSupply().div(r.getMintFactor())),
        depositedUsd: Number(r.getDepositTvl()),
        borrowApyPct: r.totalBorrowAPY(slot) * 100,
        supplyApyPct: r.totalSupplyAPY(slot) * 100,
        loanToValuePct: round6(r.stats.loanToValue * 100),
        liquidationThresholdPct: round6(r.stats.liquidationThreshold * 100),
        multiplyPositions: multiplyError ? null : positions,
        multiplyAvgLeverage: !multiplyError && positions ? rows.reduce((sum, m) => sum + Number(m.avgLeverage) * Number(m.totalObligations), 0) / positions : null,
        partialErrors: multiplyError ? { multiply: multiplyError } : undefined,
      };
    },
  };
}

export interface Logger {
  (msg: string): void;
}

/** Same rule as the agent's price check: "open" needs Finnhub's own open flag AND a recent trade. Never inferred from the clock. */
function sessionOf(status: FinnhubMarketStatus | FinnhubError, quoteAgeSeconds: number | null): "open" | "closed" | "unknown" {
  if (!status.ok) return "unknown";
  if (!status.isOpen) return "closed";
  return quoteAgeSeconds !== null && quoteAgeSeconds <= OPEN_QUOTE_MAX_AGE_SECONDS ? "open" : "unknown";
}

export interface TickResult {
  written: number;
  skipped: number;
  errors: number;
}

/**
 * One 5-minute sample for every xStock. Never throws.
 *
 * ALWAYS written (`onchain_price`): Kamino's oracle price and the mint's UI multiplier. These are public on-chain facts.
 * ONLY WHEN FINNHUB_ENABLED=true (`oracle_gap`): the stock reference price, the market session and the gaps. Finnhub's free
 * plan is personal-use only and bars sharing its data or derived results, so with the flag off Finnhub is not called at all
 * and no reference or gap row is written.
 */
export async function sampleOracleGap(src: Sources, store: RiskStore, log: Logger, nowMs = Date.now()): Promise<TickResult> {
  const ts = bucket(nowMs, SAMPLE_MS);
  const res: TickResult = { written: 0, skipped: 0, errors: 0 };
  const withReference = finnhubEnabled();

  let assets: string[] = [];
  let marketError: string | null = null;
  try {
    await src.loadMarket();
    assets = src.assets();
  } catch (e) {
    marketError = `kamino: ${reason(e)}`;
  }
  // If Kamino is down we still know which assets to sample from the last good load; fall back to the mapped set so the
  // reference side is still recorded (oracle fields stay null).
  if (assets.length === 0) {
    try {
      assets = src.assets();
    } catch {
      assets = Object.keys(COLLECTOR_TICKERS);
    }
  }

  // One market-status call serves every asset this tick (only when the reference is enabled).
  const status = withReference ? await src.marketStatus().catch((e): FinnhubError => ({ ok: false, error: reason(e) })) : null;

  await Promise.all(
    assets.map(async (asset) => {
      if (store.has({ series: "onchain_price", asset, ts }) && (!withReference || store.has({ series: "oracle_gap", asset, ts }))) {
        res.skipped++;
        return;
      }
      const errors: Record<string, string> = {};
      let oracle: number | null = null;
      let mult: number | null = null;
      if (marketError) {
        errors.oracle = marketError;
      } else {
        try {
          const ref = await src.oracleReference(asset);
          oracle = ref.oraclePriceUsd;
          mult = ref.uiMultiplier;
          if (mult === null) errors.multiplier = reason(ref.uiMultiplierSource);
        } catch (e) {
          errors.oracle = reason(e);
        }
      }

      // Always: the on-chain series.
      const onchainWritten = store.append({
        series: "onchain_price",
        asset,
        ts,
        source: "collected",
        collectedAt: new Date().toISOString(),
        kaminoOraclePriceUsd: oracle,
        uiMultiplier: mult,
        errors,
      });
      if (onchainWritten) {
        res.written++;
        if (Object.keys(errors).length) res.errors++;
      }

      // Only with the flag on: the Finnhub reference and the gaps.
      if (withReference && status) {
        const gapErrors: Record<string, string> = { ...errors };
        let refPrice: number | null = null;
        let refTime: number | null = null;
        const ticker = COLLECTOR_TICKERS[asset] ?? null;
        if (!ticker) gapErrors.reference = "no Finnhub ticker mapped for this asset";
        else {
          const q = await src.quote(asset).catch((e): FinnhubError => ({ ok: false, error: reason(e) }));
          if (q.ok) {
            refPrice = q.price;
            refTime = q.quoteTime;
          } else gapErrors.reference = reason(q.error);
        }
        if (!status.ok) gapErrors.session = reason(status.error);

        const age = refTime !== null ? Math.max(0, Math.floor(nowMs / 1000) - refTime) : null;
        // Kamino's oracle price per xStock token is the stock price times the mint's effective Token-2022 multiplier.
        // MEASURED 2026-10-06 (TESTPLAN.md, "Oracle vs Finnhub, UI multiplier"): unadjusted gaps were +0.27% / +0.53% / -0.03%
        // (AAPLx / SPYx / TSLAx) against multipliers 1.003269 / 1.005715 / 1; dividing by the multiplier left -0.06% to -0.03%.
        // So `rawGapPct` is the unadjusted gap and `adjustedGapPct` divides the on-chain price by the multiplier first.
        const rawGap = oracle !== null && refPrice !== null ? ((oracle - refPrice) / refPrice) * 100 : null;
        const adjGap = oracle !== null && mult !== null && refPrice !== null ? ((oracle / mult - refPrice) / refPrice) * 100 : null;

        store.append({
          series: "oracle_gap",
          asset,
          ts,
          source: "collected",
          collectedAt: new Date().toISOString(),
          kaminoOraclePriceUsd: oracle,
          uiMultiplier: mult,
          referenceTicker: ticker,
          referencePriceUsd: refPrice,
          referenceQuoteTime: refTime !== null ? new Date(refTime * 1000).toISOString() : null,
          session: sessionOf(status, age),
          rawGapPct: rawGap,
          adjustedGapPct: adjGap,
          errors: gapErrors,
        });
      }

      // Derived event: the effective UI multiplier changed since we last saw it (first sight sets the baseline, no event).
      // The baseline comes from the on-chain series (always collected), falling back to older oracle_gap rows.
      if (mult !== null) {
        const known = (r: any) => r.asset === asset && r.uiMultiplier !== null && r.ts < ts;
        const last = store.latest<any>("onchain_price", known) ?? store.latest<any>("oracle_gap", known);
        if (last && last.uiMultiplier !== mult) {
          const wrote = store.append({ series: "events", asset, ts, source: "collected", type: "multiplier_change", old: last.uiMultiplier, new: mult, lastSeenAt: last.ts });
          if (wrote) log(`EVENT ${asset} multiplier ${last.uiMultiplier} -> ${mult}`);
        }
      }
    })
  );
  log(`onchain_price ${ts}: wrote ${res.written}, skipped ${res.skipped} (already stored), ${res.errors} with a source error${withReference ? " (Finnhub reference ON)" : " (Finnhub reference OFF)"}`);
  return res;
}

/** One 30-minute market-state row per xStock. Never throws. */
export async function sampleMarketState(src: Sources, store: RiskStore, log: Logger, nowMs = Date.now()): Promise<TickResult> {
  const ts = bucket(nowMs, MARKET_STATE_MS);
  const res: TickResult = { written: 0, skipped: 0, errors: 0 };
  let marketError: string | null = null;
  let assets: string[] = [];
  try {
    await src.loadMarket();
    assets = src.assets();
  } catch (e) {
    marketError = `kamino: ${reason(e)}`;
    try {
      assets = src.assets();
    } catch {
      assets = Object.keys(COLLECTOR_TICKERS);
    }
  }
  for (const asset of assets) {
    if (store.has({ series: "market_state", asset, ts })) {
      res.skipped++;
      continue;
    }
    const errors: Record<string, string> = {};
    let f: MarketStateFields | null = null;
    if (marketError) errors.kamino = marketError;
    else {
      try {
        f = await src.marketState(asset);
      } catch (e) {
        errors.kamino = reason(e);
      }
    }
    store.append({
      series: "market_state",
      asset,
      ts,
      source: "collected",
      collectedAt: new Date().toISOString(),
      depositedTokens: f?.depositedTokens ?? null,
      depositedUsd: f?.depositedUsd ?? null,
      borrowApyPct: f?.borrowApyPct ?? null,
      supplyApyPct: f?.supplyApyPct ?? null,
      loanToValuePct: f?.loanToValuePct ?? null,
      liquidationThresholdPct: f?.liquidationThresholdPct ?? null,
      multiplyPositions: f?.multiplyPositions ?? null,
      multiplyAvgLeverage: f?.multiplyAvgLeverage ?? null,
      errors: { ...errors, ...(f?.partialErrors ?? {}) },
    });
    res.written++;
    if (Object.keys(errors).length || f?.partialErrors) res.errors++;

    // Derived events: an LTV or liquidation-threshold change since the last collected row.
    if (f) {
      const last = store.latest<any>("market_state", (r) => r.asset === asset && r.loanToValuePct !== null && r.ts < ts);
      for (const field of ["loanToValuePct", "liquidationThresholdPct"] as const) {
        // round6 on both sides: a row written before percentages were rounded (0.55 * 100 = 55.00000000000001) is not a change.
        if (last && last[field] !== null && round6(last[field]) !== round6(f[field])) {
          const wrote = store.append({ series: "events", asset, ts, source: "collected", type: "risk_parameter_change", field, old: last[field], new: f[field], lastSeenAt: last.ts });
          if (wrote) log(`EVENT ${asset} ${field} ${last[field]} -> ${f[field]}`);
        }
      }
    }
  }
  log(`market_state ${ts}: wrote ${res.written}, skipped ${res.skipped} (already stored), ${res.errors} with a source error`);
  return res;
}
