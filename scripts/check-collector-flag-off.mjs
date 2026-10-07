/**
 * `node scripts/check-collector-flag-off.mjs`
 *
 * Runs the REAL collector (`collect.ts --once`) against live Kamino with FINNHUB_ENABLED unset (the default), in a
 * throwaway data directory, while FINNHUB_BASE_URL points at a local server that counts every connection. Expected: the
 * counter stays at 0 (Finnhub never contacted), onchain_price rows with real values exist, and there is no oracle_gap
 * series and no Finnhub-derived field anywhere in the files.
 */
import { spawn } from "node:child_process";
import http from "node:http";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

let connections = 0;
const server = http.createServer(() => {});
server.on("connection", () => connections++);
await new Promise((r) => server.listen(0, "127.0.0.1", r));

const dir = mkdtempSync(path.join(os.tmpdir(), "riskdata-flagoff-"));
const env = { ...process.env, RISKDATA_DIR: dir, FINNHUB_BASE_URL: `http://127.0.0.1:${server.address().port}`, FINNHUB_API_KEY: "test-key" };
delete env.FINNHUB_ENABLED;

const t0 = Date.now();
const child = spawn("npx", ["tsx", "src/riskdata/collect.ts", "--once"], { env, shell: true });
let log = "";
child.stdout.on("data", (d) => (log += d));
child.stderr.on("data", (d) => (log += d));
const code = await new Promise((r) => child.on("exit", r));
server.close();

console.log(log.split("\n").filter((l) => /onchain_price|market_state|oracle_gap|failed|EVENT/.test(l)).join("\n"));
console.log(`collector exit code ${code} after ${((Date.now() - t0) / 1000).toFixed(0)}s`);
console.log(`connections made to the Finnhub endpoint: ${connections}`);

const series = readdirSync(dir).filter((d) => !d.endsWith(".lock"));
console.log(`series written: ${series.join(", ")}`);
let leaked = 0;
for (const s of series) for (const f of readdirSync(path.join(dir, s))) {
  const text = readFileSync(path.join(dir, s, f), "utf8");
  if (/referencePrice|referenceQuote|referenceTicker|adjustedGap|rawGap|"session"/.test(text)) leaked++;
}
const rows = existsSync(path.join(dir, "onchain_price")) ? readdirSync(path.join(dir, "onchain_price")).flatMap((f) => readFileSync(path.join(dir, "onchain_price", f), "utf8").trim().split("\n").map((l) => JSON.parse(l))) : [];
console.log(`onchain_price rows: ${rows.length}; sample: ${JSON.stringify(rows.find((r) => r.asset === "AAPLx"))}`);
console.log(`Finnhub-derived field names found in stored files: ${leaked}`);
rmSync(dir, { recursive: true, force: true });
const ok = code === 0 && connections === 0 && !series.includes("oracle_gap") && rows.length >= 10 && rows.every((r) => typeof r.kaminoOraclePriceUsd === "number") && leaked === 0;
console.log(ok ? "RESULT: PASS" : "RESULT: FAIL");
process.exit(ok ? 0 : 1);
