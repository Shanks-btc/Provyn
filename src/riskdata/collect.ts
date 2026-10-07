/**
 * `npm run collect`              long-running collector: every 5 min an oracle-vs-reference sample per xStock, every
 *                                30 min a market-state row per xStock. Independent of the Next dev server; run it under
 *                                any process manager (pm2, systemd, a Railway worker) or cron `--once`.
 * `npm run collect -- --once`    one tick (both series if due), then exit.
 * `npm run collect -- backfill`  import Kamino's hourly reserve history as clearly-labelled "backfilled" rows, then exit.
 * `npm run collect -- export <file.csv>`  write a public-safe CSV (on-chain price and multiplier; Finnhub-derived columns only if
 *                                FINNHUB_ENABLED and RISKDATA_PUBLISH_GAP_STATS are both true; never a Finnhub price).
 * `npm run collect -- migrate-onchain`   one-off: copy on-chain fields of earlier oracle_gap rows into onchain_price.
 *
 * FINNHUB_ENABLED (default off): with it off the collector never calls Finnhub and writes no reference or gap rows.
 *
 * Reads SOLANA_RPC_URL, KAMINO_MAIN_MARKET, FINNHUB_API_KEY and RISKDATA_DIR from .env. Nothing here signs or sends anything.
 */
import "dotenv/config";
import { writeFileSync } from "node:fs";
import { KaminoClient } from "../kamino/client";
import { backfill } from "./backfill";
import { bucket, MARKET_STATE_MS, realSources, reason, sampleMarketState, sampleOracleGap, SAMPLE_MS, type Sources } from "./collector";
import { exposesFinnhubDerived } from "./stats";
import { acquireLock, dataDir, listFiles, readRows, RiskStore } from "./store";

const log = (m: string) => console.log(`${new Date().toISOString()} ${m}`);

/**
 * Public-safe export. Always: the on-chain series (Kamino oracle price and UI multiplier). The Finnhub-derived columns
 * (session and gaps) are added only when FINNHUB_ENABLED and RISKDATA_PUBLISH_GAP_STATS are BOTH on, and a Finnhub
 * reference price is never exported. Older oracle_gap rows contribute only their on-chain fields.
 */
function exportCsv(file: string) {
  const withGaps = exposesFinnhubDerived();
  const cols = ["ts", "asset", "kaminoOraclePriceUsd", "uiMultiplier", ...(withGaps ? ["session", "rawGapPct", "adjustedGapPct"] : [])];
  const rows = new Map<string, Record<string, unknown>>();
  for (const f of listFiles("oracle_gap")) {
    for (const r of readRows<any>(f)) rows.set(`${r.asset}|${r.ts}`, withGaps ? r : { ts: r.ts, asset: r.asset, kaminoOraclePriceUsd: r.kaminoOraclePriceUsd, uiMultiplier: r.uiMultiplier });
  }
  for (const f of listFiles("onchain_price")) for (const r of readRows<any>(f)) rows.set(`${r.asset}|${r.ts}`, { ...(rows.get(`${r.asset}|${r.ts}`) ?? {}), ts: r.ts, asset: r.asset, kaminoOraclePriceUsd: r.kaminoOraclePriceUsd, uiMultiplier: r.uiMultiplier });
  const lines = [cols.join(",")];
  for (const r of [...rows.values()].sort((x, y) => String(x.ts).localeCompare(String(y.ts)) || String(x.asset).localeCompare(String(y.asset)))) lines.push(cols.map((c) => r[c] ?? "").join(","));
  writeFileSync(file, [...lines, ""].join(String.fromCharCode(10)));
  log(`export: ${lines.length - 1} rows to ${file} (columns: ${cols.join(", ")}). Finnhub reference prices are never exported${withGaps ? "" : "; Finnhub-derived columns withheld (FINNHUB_ENABLED and RISKDATA_PUBLISH_GAP_STATS are not both true)"}.`);
}

/** One-off: copy the ON-CHAIN fields of rows collected before the split (oracle_gap) into onchain_price. Finnhub fields stay behind. */
function migrateOnchain(store: RiskStore) {
  let wrote = 0;
  for (const f of listFiles("oracle_gap")) {
    for (const r of readRows<any>(f)) {
      const errors: Record<string, string> = {};
      for (const k of ["oracle", "multiplier"]) if (r.errors?.[k]) errors[k] = r.errors[k];
      if (store.append({ series: "onchain_price", asset: r.asset, ts: r.ts, source: "collected", collectedAt: r.collectedAt, kaminoOraclePriceUsd: r.kaminoOraclePriceUsd, uiMultiplier: r.uiMultiplier, errors })) wrote++;
    }
  }
  log(`migrate-onchain: copied ${wrote} rows' on-chain fields into onchain_price (Finnhub fields were not copied; oracle_gap is unchanged and stays local).`);
}

/** loadMarket reloads every reserve (slow); the oracle and market-state samples within one tick share a single load. */
function shareMarketLoad(src: Sources): Sources {
  let at = 0;
  return {
    ...src,
    loadMarket: async () => {
      if (Date.now() - at < 30_000) return;
      await src.loadMarket();
      at = Date.now();
    },
  };
}

async function main() {
  const { SOLANA_RPC_URL, KAMINO_MAIN_MARKET } = process.env;
  if (!SOLANA_RPC_URL || !KAMINO_MAIN_MARKET) throw new Error("Set SOLANA_RPC_URL and KAMINO_MAIN_MARKET in .env.");
  const mode = process.argv[2];

  if (mode === "export") {
    const file = process.argv[3];
    if (!file) throw new Error("usage: npm run collect -- export <file.csv>");
    return exportCsv(file);
  }

  const store = new RiskStore();
  const kamino = new KaminoClient(SOLANA_RPC_URL, KAMINO_MAIN_MARKET);
  log(`risk-data collector starting. data dir: ${dataDir()}`);

  if (mode === "migrate-onchain") return migrateOnchain(store);

  if (mode === "backfill") {
    // Writes only its own "backfilled" series, so it needs no lock and can run beside a live collector.
    await kamino.init();
    return backfill(kamino, store, log);
  }

  const release = acquireLock();
  const stop = () => {
    release();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  const src = shareMarketLoad(realSources(kamino));
  let lastMarketBucket: string | null = null;
  const tick = async () => {
    const now = Date.now();
    try {
      await sampleOracleGap(src, store, log, now);
      const mb = bucket(now, MARKET_STATE_MS);
      if (mb !== lastMarketBucket) {
        await sampleMarketState(src, store, log, now);
        lastMarketBucket = mb;
      }
    } catch (e) {
      log(`tick failed, loop continues: ${reason(e)}`); // sample* never throw; this is the last line of defence
    }
  };

  await tick();
  if (process.argv.includes("--once")) return release();
  for (;;) {
    const wait = SAMPLE_MS - (Date.now() % SAMPLE_MS) + 3_000; // just after each 5-minute boundary
    await new Promise((r) => setTimeout(r, wait));
    await tick();
  }
}

main().catch((e) => {
  console.error("collector failed:", reason(e));
  process.exit(1);
});
