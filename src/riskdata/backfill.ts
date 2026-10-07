/**
 * One-off import of Kamino's own reserve history (hourly, available since the market's start, 2025-07-11 for AAPLx) into
 * the SEPARATE series `market_state_backfill` / `events_backfill`, every row labelled source "backfilled", so it can
 * never be confused with a collected row.
 *
 * WHAT IT CAN AND CANNOT GIVE: Kamino's history has the on-chain side only (oracle price per RAW token, LTV, liquidation
 * threshold, deposits, APYs). Finnhub's free tier has no historical candles, so there is NO reference price and NO gap
 * history before the collector started; the gap series only exists from the first collected sample.
 *
 * Unit note, verified 2026-10-06: `assetPriceUSD` equals the SDK's live oracle price (hourly 12:00Z 333.788 vs the SDK's
 * 333.7876 for AAPLx), i.e. it is per RAW token (stock price x the mint's multiplier), not per UI unit.
 */

import { KaminoClient } from "../kamino/client";
import { reason, round6, withTimeout } from "./collector";
import type { RiskStore } from "./store";

const API = "https://api.kamino.finance";
const START = "2025-07-01T00:00:00.000Z"; // before the market existed: the API returns from its first row

export async function backfill(kamino: KaminoClient, store: RiskStore, log: (m: string) => void): Promise<void> {
  const market = process.env.KAMINO_MAIN_MARKET!;
  const end = new Date().toISOString();
  for (const { symbol } of kamino.listXStockReserves()) {
    const reserveAddress = String(kamino.getReserve(symbol).address);
    const url = `${API}/kamino-market/${market}/reserves/${reserveAddress}/metrics/history?env=mainnet-beta&start=${START}&end=${end}&frequency=hour`;
    try {
      const res = await withTimeout(fetch(url), 90_000, `history for ${symbol}`);
      if (!res.ok) throw new Error(`Kamino history returned ${res.status}`);
      const body = (await withTimeout(res.json(), 90_000, `history body for ${symbol}`)) as { history: { timestamp: string; metrics: any }[] };
      let wrote = 0;
      let prev: { ltv: number; liq: number } | null = null;
      for (const h of body.history) {
        const m = h.metrics;
        const ts = new Date(h.timestamp).toISOString();
        const ltv = round6(Number(m.loanToValue) * 100);
        const liq = round6(Number(m.liquidationThreshold) * 100);
        const written = store.append({
          series: "market_state_backfill",
          asset: symbol,
          ts,
          source: "backfilled",
          oraclePricePerRawUnitUsd: Number(m.assetPriceUSD),
          loanToValuePct: ltv,
          liquidationThresholdPct: liq,
          depositedTokens: Number(m.totalSupply),
          depositedUsd: Number(m.depositTvl),
          borrowApyPct: Number(m.borrowInterestAPY) * 100,
          supplyApyPct: Number(m.supplyInterestAPY) * 100,
        });
        if (written) wrote++;
        if (prev) {
          const changes: [string, number, number][] = [
            ["loanToValuePct", prev.ltv, ltv],
            ["liquidationThresholdPct", prev.liq, liq],
          ];
          for (const [field, o, n] of changes) {
            if (o !== n) store.append({ series: "events_backfill", asset: symbol, ts, source: "backfilled", type: "risk_parameter_change", field, old: o, new: n });
          }
        }
        prev = { ltv, liq };
      }
      log(`backfill ${symbol}: ${body.history.length} hourly rows from Kamino (${body.history[0]?.timestamp ?? "none"} to ${body.history[body.history.length - 1]?.timestamp ?? "none"}), ${wrote} new`);
    } catch (e) {
      log(`backfill ${symbol}: FAILED, nothing written for it (${reason(e)})`);
    }
  }
}
