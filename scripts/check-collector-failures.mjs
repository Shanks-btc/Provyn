/**
 * `node scripts/check-collector-failures.mjs`
 *
 * Runs the REAL collector process (`collect.ts --once`) in a throwaway data directory with
 *   - Finnhub pointed at a local server that accepts requests and never answers (a real timeout), and
 *   - the Solana RPC pointed at a closed port (Kamino cannot load),
 * then prints the rows it wrote. Expected: null values with short reasons, no invented numbers, a normal exit (the
 * loop survives), and no address-shaped strings anywhere in the files or the log.
 */
import { spawn } from "node:child_process";
import http from "node:http";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const hung = http.createServer(() => {});
await new Promise((r) => hung.listen(0, "127.0.0.1", r));
const dir = mkdtempSync(path.join(os.tmpdir(), "riskdata-fail-"));
const env = {
  ...process.env,
  RISKDATA_DIR: dir,
  FINNHUB_BASE_URL: `http://127.0.0.1:${hung.address().port}`,
  FINNHUB_API_KEY: "test-key",
  SOLANA_RPC_URL: "http://127.0.0.1:1",
};

const t0 = Date.now();
const child = spawn("npx", ["tsx", "src/riskdata/collect.ts", "--once"], { env, shell: true });
let log = "";
child.stdout.on("data", (d) => (log += d));
child.stderr.on("data", (d) => (log += d));
const code = await new Promise((r) => child.on("exit", r));
hung.closeAllConnections();
hung.close();

console.log(log.split("\n").filter((l) => /oracle_gap|market_state|failed|EVENT/.test(l)).join("\n"));
console.log(`collector exit code ${code} after ${((Date.now() - t0) / 1000).toFixed(0)}s`);

let bad = 0;
const base58 = /[1-9A-HJ-NP-Za-km-z]{32,44}/;
for (const series of readdirSync(dir).filter((d) => !d.endsWith(".lock"))) {
  const full = path.join(dir, series);
  for (const f of readdirSync(full)) {
    const text = readFileSync(path.join(full, f), "utf8");
    const rows = text.trim().split("\n").map((l) => JSON.parse(l));
    const r = rows.find((x) => x.asset === "AAPLx");
    console.log(`\n[${series}] ${rows.length} rows; AAPLx:`, JSON.stringify(r));
    if (base58.test(text)) bad++;
  }
}
if (base58.test(log)) bad++;
console.log(`\naddress-shaped strings in files or log: ${bad === 0 ? "none" : bad + " hit(s)"}`);
rmSync(dir, { recursive: true, force: true });
process.exit(code === 0 && bad === 0 ? 0 : 1);
