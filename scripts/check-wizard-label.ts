/**
 * `npx tsx scripts/check-wizard-label.ts`
 *
 * The wizard's progress label for check_price_divergence must say who actually answered. Runs the REAL describeEvent over
 * recorded-shape events for all four states and fails if a label misattributes the source. Pure function, no network.
 */
import { describeEvent, type AgentEvent } from "../dashboard/components/wizard/AgentRun";

const base: AgentEvent = { type: "tool", turn: 1, name: "check_price_divergence", isError: false, symbol: "AAPLx", valid: null, available: true, projectedHealthFactor: null };
const cases: { name: string; event: Partial<AgentEvent>; expect: (d: ReturnType<typeof describeEvent>) => string | null }[] = [
  { name: "pyth", event: { source: "pyth", referenceSession: "unknown" }, expect: (d) => (d.label === "Cross-checked AAPLx price with Pyth" && d.ok ? null : `got "${d.label}"`) },
  { name: "finnhub, market open", event: { source: "finnhub", referenceSession: "open", referenceAsOf: "2026-10-06T13:30:00.000Z" }, expect: (d) => (d.label === "Cross-checked AAPLx price with Finnhub" && d.ok ? null : `got "${d.label}"`) },
  { name: "finnhub, market closed", event: { source: "finnhub", referenceSession: "closed", referenceAsOf: "2026-10-05T20:00:00.000Z" }, expect: (d) => (d.label === "Checked AAPLx against Finnhub's last close (market closed, coarse check)" && d.ok && !/pyth/i.test(d.label) && /Pyth was unavailable/.test(d.detail ?? "") ? null : `got "${d.label}" / ${d.detail}`) },
  { name: "finnhub, session unknown", event: { source: "finnhub", referenceSession: "unknown", referenceAsOf: "2026-10-06T13:00:00.000Z" }, expect: (d) => (d.label === "Checked AAPLx against Finnhub's last close (market closed, coarse check)" && d.ok ? null : `got "${d.label}"`) },
  { name: "unavailable", event: { available: false }, expect: (d) => (d.label === "Tried to cross-check AAPLx's price with Pyth" && !d.ok && d.detail === "Unavailable, Provyn's Pyth key isn't entitled to equity feeds yet" ? null : `got "${d.label}" / ${d.detail}`) },
  { name: "legacy recorded result (no source field, available:true): predates the fallback, so it was Pyth", event: {}, expect: (d) => (d.label === "Cross-checked AAPLx price with Pyth" ? null : `got "${d.label}"`) },
];
let failed = 0;
for (const c of cases) {
  const problem = c.expect(describeEvent({ ...base, ...c.event }));
  console.log(`${problem ? "FAIL" : "PASS"}  ${c.name}${problem ? `  (${problem})` : ""}`);
  if (problem) failed++;
}
process.exit(failed ? 1 : 0);
