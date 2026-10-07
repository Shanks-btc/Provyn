/**
 * `npm run check:agent [-- <trace.json>]`
 *
 * Phase 5 end-to-end check: runs the full agent loop (real Claude, real Kamino/Pyth reads,
 * real mainnet simulation inside validate_strategy) for two fixed intents against real wallets
 * found in earlier phases, and prints every tool call plus the final proposal. Nothing is
 * signed or sent. Non-interactive on purpose — cli.ts can't be driven by piped stdin on Windows.
 *
 * Wallets (holdings re-checked via get_position on every run, not assumed):
 *   - A3iPNQ…: spot AAPLx holder found in Phase 2 (no Kamino obligation as of 2026-09-24).
 *   - BWEJgs…: spot SPYx holder found in Phase 4 (also has a small SPYx Multiply obligation).
 */
import "dotenv/config";
import { writeFileSync } from "node:fs";
import { KaminoClient } from "../kamino/client";
import { PythFeedClient } from "../pyth/feeds";
import { ParityAgent, type ToolCallEvent } from "./core";

const SCENARIOS = [
  {
    name: "AAPLx — Borrow/Earn intent",
    wallet: "A3iPNQiG7sCAmL4dsAVr9RFmjh9EJEbh4jHprpk4DxdP",
    intent: "I hold some AAPLx. I want to earn yield on it without selling it — can I borrow against it?",
  },
  {
    name: "SPYx — Multiply-eligible intent",
    wallet: "BWEJgsSutAxMEWNXTUKSnBaWHHMpQikcHmbmFz8nqEnZ",
    intent: "I'm bullish on the S&P 500 and hold some SPYx. I'd like more exposure than I have, using leverage, but carefully.",
  },
];

/** One-line view of a tool result for the console; the full result goes to the trace file. */
function brief(e: ToolCallEvent): string {
  const o = e.output;
  if (e.isError) return `ERROR ${typeof o === "string" ? o : JSON.stringify(o)}`;
  switch (e.name) {
    case "get_position":
      return (
        `obligations=${JSON.stringify(o.obligations.map((ob: any) => ({ type: ob.type, deposits: ob.deposits.map((d: any) => `${d.amount} ${d.symbol}`), borrows: ob.borrows.map((b: any) => `${b.amount} ${b.symbol}`), hf: ob.healthFactor })))} ` +
        `spot=${JSON.stringify(o.walletBalances.map((b: any) => `${b.amount} ${b.symbol}`))}`
      );
    case "get_asset_capabilities":
      return `borrow=${o.borrow.supported} earn=${o.earn.supported} (supplyApy ${o.earn.supplyApyPct}%, borrowApy ${o.borrow.debtBorrowApyPct}%) multiply=${o.multiply.supported}`;
    case "check_price_divergence":
      return o.available === false
        ? `available=false (pyth: ${o.error}; finnhub: ${o.finnhubError})`
        : o.source === "finnhub"
          ? `source=finnhub session=${o.referenceSession} spread=${o.spreadPct.toFixed(3)}% classification=${o.classification} coarse=${o.coarse}`
          : `source=pyth spread=${o.spreadPct}% staleness=${JSON.stringify(o.staleness)}`;
    case "validate_strategy":
      return `${o.validationId} valid=${o.valid} simulation=${JSON.stringify(
        o.simulation.ran
          ? { ran: true, success: o.simulation.success, slot: o.simulation.slot, unitsConsumed: o.simulation.unitsConsumed, failureReason: o.simulation.failureReason }
          : o.simulation
      )} projectedHF=${o.projectedHealthFactor}${o.problems.length ? ` problems=${JSON.stringify(o.problems)}` : ""}`;
    case "list_xstock_reserves":
      return `${o.length} reserves`;
    default:
      return typeof o === "string" ? o : JSON.stringify(o).slice(0, 300);
  }
}

async function main() {
  const { SOLANA_RPC_URL, KAMINO_MAIN_MARKET, PYTH_HERMES_URL, PYTH_API_KEY, ANTHROPIC_API_KEY } = process.env;
  if (!SOLANA_RPC_URL || !KAMINO_MAIN_MARKET || !ANTHROPIC_API_KEY) {
    throw new Error("SOLANA_RPC_URL, KAMINO_MAIN_MARKET and ANTHROPIC_API_KEY are required.");
  }

  const kamino = new KaminoClient(SOLANA_RPC_URL, KAMINO_MAIN_MARKET);
  await kamino.init();
  const pyth = new PythFeedClient(PYTH_HERMES_URL ?? "https://hermes.pyth.network", PYTH_API_KEY);
  const agent = new ParityAgent(kamino, pyth, ANTHROPIC_API_KEY);

  const trace: any[] = [];
  // CHECK_AGENT_ONLY=AAPLx runs just the scenarios whose name contains that text (each scenario is billed Anthropic spend).
  const only = process.env.CHECK_AGENT_ONLY?.toLowerCase();
  for (const s of SCENARIOS.filter((x) => !only || x.name.toLowerCase().includes(only))) {
    console.log(`\n==================== ${s.name} ====================`);
    console.log(`wallet: ${s.wallet}\nintent: ${s.intent}\n`);
    const calls: ToolCallEvent[] = [];
    const result = await agent.handleIntent(s.intent, s.wallet, (e) => {
      calls.push(e);
      console.log(`[turn ${e.turn}] ${e.name}(${JSON.stringify(e.input)})\n    -> ${brief(e)}`);
    });
    console.log("\n--- FINAL RESULT ---");
    console.log(JSON.stringify(result, null, 2));
    trace.push({ ...s, calls, result });
  }

  const out = process.argv[2];
  if (out) {
    writeFileSync(out, JSON.stringify(trace, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2));
    console.log(`\nFull trace written to ${out}`);
  }
}

main().catch((err) => {
  console.error("E2E agent check failed:", err);
  process.exit(1);
});
