import type { ReactNode } from "react";
import { CountUp } from "../CountUp";
import { ArrowRightIcon, ChevronIcon, HouseIcon, StackIcon, TrendIcon } from "../icons";
import {
  allAssets,
  borrowApyLabel,
  carryLabel,
  carryNegative,
  carryNote,
  LANDING_SEP,
  listJoin,
  market,
  multiplyLiveAssets,
  multiplyNotLiveAssets,
} from "@/lib/market";
import { Section, SectionTitle } from "./Section";

type PillTone = "neutral" | "gold" | "positive" | "clay";

interface Strategy {
  icon: ReactNode;
  pill: { label: string; tone: PillTone };
  title: string;
  body: string;
  stat: { label: string; value: string; tone: "ink" | "positive" | "gold" | "clay" };
  /** Small caption under the stat row (used by the Earn card's caution note). */
  note?: string;
  link: { href: string; label: string };
}

// Figures come from market-snapshot.json (`npm run snapshot:landing`), verified live against
// Kamino mainnet at market.checkedAt — a snapshot, not a feed, and labelled that way.

// Multiply covers every asset with live Kamino Multiply positions (SPYx and TSLAx as of the last
// snapshot; Provyn's own builder simulated both successfully on mainnet on 2026-09-24). Derived,
// so the card can't claim one asset "only" when another goes live, as "SPYx only" once did.
const multiplyLive = multiplyLiveAssets.map((s) => ({ symbol: s, ...market.assets[s].multiply }));
const multiplyScope =
  `Live for ${listJoin(multiplyLiveAssets, "and", LANDING_SEP)}` +
  (multiplyNotLiveAssets.length ? `; not yet for ${listJoin(multiplyNotLiveAssets, "and", LANDING_SEP)}.` : ".");

const STRATEGIES: Strategy[] = [
  {
    icon: <HouseIcon />,
    // Was "50% LIQ. THRESHOLD" — true for AAPLx only (SPYx is 75%). Per-asset thresholds are in
    // the Capabilities section below.
    pill: { label: "COLLATERAL-BACKED", tone: "neutral" },
    title: "Borrow against your stock",
    body: `Unlock USDC without selling your ${listJoin(allAssets, "or", LANDING_SEP)}. The agent sizes explicitly against each asset's real liquidation threshold.`,
    // A cost the user pays — neutral ink, not green. Green is reserved for figures that are
    // genuinely positive for the user (cf. the carry card's sign-following tone).
    stat: { label: "BORROW APY, AS OF LAST CHECK", value: borrowApyLabel, tone: "ink" },
    link: { href: "/borrow", label: "Go to Borrow" },
  },
  {
    icon: <TrendIcon />,
    // An honesty example, not a pitch: borrowing USDC to supply it back only pays if supply APY
    // beats borrow APY. The caution styling follows the sign of the verified number.
    pill: carryNegative
      ? { label: "NEGATIVE CARRY", tone: "clay" }
      : { label: "POSITIVE CARRY", tone: "positive" },
    title: "Redeposit to earn",
    body: "Borrowed USDC goes into Kamino's own stablecoin pool instead of sitting idle, the same infrastructure, not a separate vault.",
    stat: {
      label: "NET CARRY, AS OF LAST CHECK",
      value: carryLabel,
      tone: carryNegative ? "clay" : "positive",
    },
    note: carryNote,
    link: { href: "/earn/redeposit", label: "Go to Earn" },
  },
  {
    icon: <StackIcon />,
    pill: { label: "LEVERAGED", tone: "clay" },
    title: `Multiply on ${multiplyLiveAssets.join(" & ")}`,
    body: `Add to a live, Kamino-managed leveraged position, their rebalancing, not ours. ${multiplyScope}`,
    stat: {
      // Values follow the title's asset order (e.g. "SPYx & TSLAx" → "2.04x / 1.52x").
      label: `AVG. LEVERAGE (${multiplyLive.map((m) => m.obligations).join(" / ")} POSITIONS)`,
      value: multiplyLive.map((m) => `${(m.avgLeverage ?? 0).toFixed(2)}x`).join(" / "),
      tone: "gold",
    },
    link: { href: "/earn/multiply", label: "Go to Earn (Multiply)" },
  },
];

const PILL: Record<PillTone, string> = {
  neutral: "bg-line-soft text-ink-muted",
  gold: "bg-gold-tint text-gold-text",
  positive: "bg-positive-tint text-positive",
  clay: "bg-clay-tint text-clay-text",
};

const STAT_TONE = { ink: "text-ink", positive: "text-positive", gold: "text-gold-text", clay: "text-clay-text" } as const;

function StrategyCard({ s }: { s: Strategy }) {
  return (
    <article className="card-lift card-glow flex-1 rounded-[10px] border border-line bg-surface p-7 text-left">
      <div className="mb-5 flex items-start justify-between gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-gold-tint text-gold-text">{s.icon}</div>
        <span className={`rounded-xl px-2.5 py-1 font-mono text-[10px] tracking-[0.03em] ${PILL[s.pill.tone]}`}>{s.pill.label}</span>
      </div>
      <h3 className="mb-2 font-serif text-[19px] font-semibold text-ink">{s.title}</h3>
      <p className="mb-6 font-serif text-sm leading-normal text-ink-muted">{s.body}</p>
      <div className="flex items-end justify-between gap-3 border-t border-line-soft pt-4">
        <div>
          <div className="mb-1 font-mono text-[10px] text-ink-faint">{s.stat.label}</div>
          <CountUp className={`font-mono text-[22px] ${STAT_TONE[s.stat.tone]}`}>{s.stat.value}</CountUp>
        </div>
        <a
          href={s.link.href}
          aria-label={s.link.label}
          className="flex size-9 shrink-0 items-center justify-center rounded-full bg-ink text-paper"
        >
          <ArrowRightIcon />
        </a>
      </div>
      {s.note && <p className="mb-0 mt-3 font-serif text-[13px] leading-normal text-ink-muted">{s.note}</p>}
    </article>
  );
}

export function Strategies() {
  return (
    <Section id="strategies" labelledBy="strategies-title">
      <div className="mb-11 flex flex-col items-start gap-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <SectionTitle id="strategies-title" className="mb-3 max-w-[640px]">
            Strategies
          </SectionTitle>
          <p className="m-0 max-w-[560px] font-serif text-[17px] text-ink-muted">
            What&apos;s live right now, priced from Kamino&apos;s real market.
          </p>
        </div>
        <div className="flex shrink-0 gap-2.5">
          {(
            [
              ["left", "Previous strategies (only three exist right now)"],
              ["right", "More strategies (none yet, three shown are all that's built)"],
            ] as const
          ).map(([dir, label]) => (
            <button
              key={dir}
              type="button"
              disabled
              aria-label={label}
              className="flex size-[38px] cursor-default items-center justify-center rounded-full border border-line bg-surface text-ink-muted opacity-45"
            >
              <ChevronIcon direction={dir} />
            </button>
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-6 lg:flex-row">
        {STRATEGIES.map((s) => (
          <StrategyCard key={s.title} s={s} />
        ))}
      </div>
    </Section>
  );
}
