/**
 * `npm run check:riskdata`
 *
 * Exercises the REAL sampling and storage code with injected sources (labelled MOCK), against a throwaway directory so the
 * real dataset is untouched. Checks idempotency, null-on-failure with a reason, a surviving loop, no forward-fill, no
 * address-shaped strings in storage, and the below-threshold statistics state. Pure local: no network.
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.RISKDATA_DIR = mkdtempSync(path.join(os.tmpdir(), "riskdata-check-"));
// Finnhub is opt-in (default off). Sections 1 to 9 exercise the reference and gap series, so they run with both flags on;
// section 10 turns them off and checks that nothing Finnhub-derived is called, written or exposed.
process.env.FINNHUB_ENABLED = "true";
process.env.RISKDATA_PUBLISH_GAP_STATS = "true";

import { sampleMarketState, sampleOracleGap, SAMPLE_MS, type Sources } from "./collector";
import { getGapStats, getStatus, MIN_SAMPLES_FOR_GAP_STATS } from "./stats";
import { listFiles, readRows, RiskStore } from "./store";

let failed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failed++;
};
const quiet = () => {};

const T0 = Date.UTC(2026, 9, 6, 15, 0, 0); // a bucket boundary
const good: Sources = {
  loadMarket: async () => {},
  assets: () => ["AAPLx", "SPYx", "ZZZx"], // ZZZx has no Finnhub ticker mapped
  oracleReference: async (s) => ({ oraclePriceUsd: s === "SPYx" ? 780 : 334, uiMultiplier: s === "SPYx" ? 1.005714 : 1.003269, uiMultiplierSource: "MOCK" }),
  quote: async (s) => ({ ok: true, symbol: s, ticker: s.replace("x", ""), price: s === "SPYx" ? 775.5 : 333.2, previousClose: 1, quoteTime: Math.floor(T0 / 1000) - 10, fetchedAt: "MOCK" }),
  marketStatus: async () => ({ ok: true, exchange: "US", isOpen: true, session: "regular", holiday: null, timezone: "America/New_York", time: 0 }),
  marketState: async () => ({ depositedTokens: 10, depositedUsd: 3340, borrowApyPct: 4, supplyApyPct: 0, loanToValuePct: 40, liquidationThresholdPct: 50, multiplyPositions: 0, multiplyAvgLeverage: null }),
};

async function main() {
  console.log("=== 1. MOCK sources, healthy tick ===");
  let store = new RiskStore();
  const r1 = await sampleOracleGap(good, store, quiet, T0);
  check("wrote one row per asset", r1.written === 3, JSON.stringify(r1));
  const rows = listFiles("oracle_gap").flatMap((f) => readRows<any>(f));
  const spy = rows.find((r) => r.asset === "SPYx")!;
  check("adjusted gap uses the multiplier", Math.abs(spy.adjustedGapPct - ((780 / 1.005714 - 775.5) / 775.5) * 100) < 1e-9 && Math.abs(spy.rawGapPct - ((780 - 775.5) / 775.5) * 100) < 1e-9);
  check("unmapped asset: reference null with a reason, oracle still recorded", rows.find((r) => r.asset === "ZZZx").referencePriceUsd === null && /no Finnhub ticker/.test(rows.find((r) => r.asset === "ZZZx").errors.reference) && rows.find((r) => r.asset === "ZZZx").kaminoOraclePriceUsd === 334);

  console.log("\n=== 2. Idempotency: same bucket, same process and after a 'restart' (new store, same directory) ===");
  const again = await sampleOracleGap(good, store, quiet, T0 + 30_000);
  check("same bucket, same process: nothing written", again.written === 0 && again.skipped === 3);
  store = new RiskStore();
  const afterRestart = await sampleOracleGap(good, store, quiet, T0 + 60_000);
  check("after restart: nothing written twice", afterRestart.written === 0 && afterRestart.skipped === 3);
  check("file still holds exactly 3 rows", listFiles("oracle_gap").flatMap((f) => readRows(f)).length === 3);

  console.log("\n=== 3. MOCK Finnhub failure (timeout): null with a reason, loop survives ===");
  const finnhubDown: Sources = {
    ...good,
    quote: async () => ({ ok: false, error: "Finnhub took too long to respond" }),
    marketStatus: async () => ({ ok: false, error: "Finnhub took too long to respond" }),
  };
  const r3 = await sampleOracleGap(finnhubDown, store, quiet, T0 + SAMPLE_MS);
  const down = listFiles("oracle_gap").flatMap((f) => readRows<any>(f)).filter((r) => r.ts === new Date(T0 + SAMPLE_MS).toISOString() && r.asset === "AAPLx")[0];
  check("row written, reference/gap/session null or unknown, reason recorded", r3.written === 3 && down.referencePriceUsd === null && down.rawGapPct === null && down.adjustedGapPct === null && down.session === "unknown" && /too long/.test(down.errors.reference) && /too long/.test(down.errors.session), JSON.stringify(down.errors));
  check("oracle side still real while Finnhub is down (no cross-contamination)", down.kaminoOraclePriceUsd === 334 && down.uiMultiplier === 1.003269);

  console.log("\n=== 4. MOCK Kamino timeout: oracle null with a reason, reference still recorded ===");
  const kaminoDown: Sources = { ...good, loadMarket: async () => { throw new Error("Kamino market load timed out after 60s"); } };
  await sampleOracleGap(kaminoDown, store, quiet, T0 + 2 * SAMPLE_MS);
  const kd = listFiles("oracle_gap").flatMap((f) => readRows<any>(f)).filter((r) => r.ts === new Date(T0 + 2 * SAMPLE_MS).toISOString() && r.asset === "AAPLx")[0];
  check("oracle and gap null with a reason; reference present", kd.kaminoOraclePriceUsd === null && kd.adjustedGapPct === null && /timed out/.test(kd.errors.oracle) && kd.referencePriceUsd === 333.2, JSON.stringify(kd.errors));
  const mk = await sampleMarketState(kaminoDown, store, quiet, T0);
  const mkRow = readRows<any>(listFiles("market_state")[0])[0];
  check("market_state under a Kamino timeout: nulls plus a reason", mk.written === 3 && mkRow.loanToValuePct === null && /timed out/.test(mkRow.errors.kamino));

  console.log("\n=== 5. MOCK one asset's read throws: only that asset is null ===");
  const oneBad: Sources = { ...good, oracleReference: async (s) => { if (s === "SPYx") throw new Error("RPC 429"); return good.oracleReference(s); } };
  await sampleOracleGap(oneBad, store, quiet, T0 + 3 * SAMPLE_MS);
  const ob = listFiles("oracle_gap").flatMap((f) => readRows<any>(f)).filter((r) => r.ts === new Date(T0 + 3 * SAMPLE_MS).toISOString());
  check("SPYx null with reason, AAPLx intact", ob.find((r) => r.asset === "SPYx").kaminoOraclePriceUsd === null && ob.find((r) => r.asset === "AAPLx").kaminoOraclePriceUsd === 334);

  console.log("\n=== 6. Never forward-filled: a failed bucket after good ones holds nulls, not the previous values ===");
  check("failed rows contain null, not 334 / 775.5", down.referencePriceUsd !== 333.2 && kd.kaminoOraclePriceUsd !== 334);

  console.log("\n=== 7. Multiplier change is recorded as an event, once ===");
  const bumped: Sources = { ...good, oracleReference: async (s) => ({ oraclePriceUsd: 334, uiMultiplier: s === "AAPLx" ? 1.005 : s === "SPYx" ? 1.005714 : 1.003269, uiMultiplierSource: "MOCK" }) }; // only AAPLx changes
  await sampleOracleGap(bumped, store, quiet, T0 + 4 * SAMPLE_MS);
  await sampleOracleGap(bumped, store, quiet, T0 + 4 * SAMPLE_MS + 1000);
  const ev = listFiles("events").flatMap((f) => readRows<any>(f)).filter((r) => r.type === "multiplier_change");
  check("exactly one multiplier_change event for AAPLx (old 1.003269, new 1.005)", ev.length === 1 && ev[0].asset === "AAPLx" && ev[0].old === 1.003269 && ev[0].new === 1.005, JSON.stringify(ev));

  console.log("\n=== 8. No address-shaped strings in storage ===");
  const base58 = /[1-9A-HJ-NP-Za-km-z]{32,44}/;
  let hits = 0;
  for (const series of ["oracle_gap", "market_state", "events"] as const) for (const f of listFiles(series)) if (base58.test(readFileSync(f, "utf8"))) hits++;
  check("no 32-44 char base58 strings in any stored file", hits === 0);

  console.log("\n=== 9. Status and the below-threshold statistics state ===");
  const st = getStatus();
  const og = st.series.find((s) => s.series === "oracle_gap")!;
  check("status counts match the files", og.count === listFiles("oracle_gap").flatMap((f) => readRows(f)).length && og.errorRate.reference.errors > 0);
  const gap = getGapStats();
  check(`few samples: no statistic is shown (needs ${MIN_SAMPLES_FOR_GAP_STATS})`, gap.length > 0 && gap.every((g) => !g.open.enough && g.open.medianAbsGapPct === null && g.open.p95AbsGapPct === null));
  console.log(`      e.g. ${JSON.stringify(gap.find((g) => g.asset === "AAPLx"))}`);

  console.log("\n=== 10. FINNHUB_ENABLED off (the default): on-chain series only ===");
  process.env.FINNHUB_ENABLED = "false";
  let finnhubCalls = 0;
  const watched: Sources = { ...good, quote: async (s) => { finnhubCalls++; return good.quote(s); }, marketStatus: async () => { finnhubCalls++; return good.marketStatus(); } };
  const offTs = new Date(T0 + 10 * SAMPLE_MS).toISOString();
  const offRes = await sampleOracleGap(watched, store, quiet, T0 + 10 * SAMPLE_MS);
  const onchainRows = listFiles("onchain_price").flatMap((f) => readRows<any>(f)).filter((r) => r.ts === offTs);
  const gapRowsOff = listFiles("oracle_gap").flatMap((f) => readRows<any>(f)).filter((r) => r.ts === offTs);
  check("on-chain rows written (price + multiplier) for every asset", offRes.written === 3 && onchainRows.length === 3 && onchainRows.every((r) => typeof r.kaminoOraclePriceUsd === "number" && typeof r.uiMultiplier === "number"));
  check("Finnhub quote and market-status were never called", finnhubCalls === 0, `calls: ${finnhubCalls}`);
  check("no oracle_gap (reference or gap) row written", gapRowsOff.length === 0);
  check("the on-chain rows contain no Finnhub-derived fields", onchainRows.every((r) => !("referencePriceUsd" in r) && !("rawGapPct" in r) && !("adjustedGapPct" in r) && !("session" in r) && !("referenceTicker" in r)));
  const stOff = getStatus();
  check("status: oracle_gap series hidden, referenceSourceEnabled false, gap statistics not published", !stOff.series.some((s) => s.series === "oracle_gap") && stOff.referenceSourceEnabled === false && stOff.gapStatisticsPublished === false && stOff.series.some((s) => s.series === "onchain_price" && s.count > 0));
  check("status JSON contains no Finnhub-derived field names", !/referencePrice|adjustedGap|rawGap|referenceTicker|referenceQuote/.test(JSON.stringify(stOff)));
  process.env.FINNHUB_ENABLED = "true";
  process.env.RISKDATA_PUBLISH_GAP_STATS = "false";
  check("flag on but publish off: oracle_gap still hidden from status", !getStatus().series.some((s) => s.series === "oracle_gap"));
  process.env.RISKDATA_PUBLISH_GAP_STATS = "true";
  check("both on: oracle_gap is exposed again", getStatus().series.some((s) => s.series === "oracle_gap"));

  rmSync(process.env.RISKDATA_DIR!, { recursive: true, force: true });
  console.log(readdirSync(os.tmpdir()).some((d) => d === path.basename(process.env.RISKDATA_DIR!)) ? "temp dir not removed" : "\n(temp dir removed)");
  process.exit(failed ? 1 : 0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
