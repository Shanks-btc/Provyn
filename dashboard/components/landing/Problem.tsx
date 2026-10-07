import { borrowApyLabel } from "@/lib/market";
import { CountUp } from "../CountUp";
import { Section, SectionTitle } from "./Section";

interface ProblemStat {
  value: string;
  tone: "ink" | "clay" | "positive";
  label: string;
  body: string;
  raised?: boolean;
}

const STATS: ProblemStat[] = [
  // External figures, supplied with the design: not produced by Provyn's backend.
  {
    value: "$100T+",
    tone: "ink",
    label: "GLOBAL EQUITY VALUE",
    body: "Sitting in brokerage accounts worldwide, mostly idle, not earning yield, not backing anything.",
  },
  {
    value: "11.8%",
    tone: "clay",
    label: "SCHWAB'S OWN MARGIN RATE, SMALL BALANCE",
    body: "What a major brokerage charges to borrow against your own stock, checked directly on schwab.com, not estimated.",
  },
  // Internal figure: MUST be the exact value the Strategies Borrow card shows. Both render
  // `borrowApyLabel` from lib/market.ts (market-snapshot.json → usdc.borrowApyPct), never a literal.
  {
    value: borrowApyLabel,
    tone: "positive",
    // The mockup said "LIVE RATE"; the page labels snapshot figures "as of last check" everywhere
    // else (they're verified live, then snapshotted — not a live feed), so this one does too.
    label: "PROVYN'S RATE VIA KAMINO, AS OF LAST CHECK",
    body: "The same real, live-checked figure shown in the Strategies section below, not a separate marketing number.",
    raised: true,
  },
];

const TONE = { ink: "text-ink", clay: "text-clay-text", positive: "text-positive" } as const;

export function Problem() {
  return (
    <Section labelledBy="problem-title" className="bg-surface">
      {/* mb-11 carries the 44px gap the removed subtitle paragraph used to provide. */}
      <SectionTitle id="problem-title" className="mb-11 max-w-[680px]">
        The Problem
      </SectionTitle>

      <div className="flex flex-col gap-6 lg:flex-row">
        {STATS.map((s) => (
          <article
            key={s.label}
            className={`card-lift flex-1 rounded-xl border border-line p-6 md:p-8 ${s.raised ? "bg-paper-raised" : ""}`}
          >
            <CountUp className={`mb-2.5 font-serif text-[36px] font-bold leading-none md:text-[44px] ${TONE[s.tone]}`}>{s.value}</CountUp>
            <div className="mb-3.5 font-mono text-[11px] tracking-[0.04em] text-ink-faint">{s.label}</div>
            <p className="m-0 font-serif text-sm leading-[1.6] text-ink-muted">{s.body}</p>
          </article>
        ))}
      </div>
    </Section>
  );
}
