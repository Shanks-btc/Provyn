import type { Metadata } from "next";
import Link from "next/link";
import { AppShell, Page, PageHeader } from "@/components/app/AppShell";
import { ArrowRightIcon, StackIcon, TrendIcon } from "@/components/icons";
import { Mono } from "@/components/Mono";
import { carryLabel, carryNegative, carryNote, listJoin, market, multiplyLiveAssets, multiplyNotLiveAssets } from "@/lib/market";

export const metadata: Metadata = {
  title: "Provyn, Earn",
  description: "The two Earn strategies Provyn has built on Kamino's xStocks market: Redeposit to earn and Multiply.",
};

const multiplyLive = multiplyLiveAssets.map((s) => ({ symbol: s, ...market.assets[s].multiply }));

/** Exactly two cards — the only two Earn strategies that exist. No placeholders, no filters. */
export default function EarnPage() {
  return (
    <AppShell active="earn">
      <Page>
        <PageHeader
          eyebrow="EARN"
          title="Earn strategies"
          subtitle="Two strategies, both running on Kamino's xStocks market."
        />
        <div className="flex flex-col gap-6 lg:flex-row">
          <Card
            href="/earn/redeposit"
            icon={<TrendIcon />}
            pill={carryNegative ? { label: "NEGATIVE CARRY", cls: "bg-clay-tint text-clay-text" } : { label: "POSITIVE CARRY", cls: "bg-positive-tint text-positive" }}
            title="Redeposit to earn"
            body="Borrowed USDC goes into Kamino's own stablecoin pool instead of sitting idle, the same infrastructure, not a separate vault."
            stat={{ label: "NET CARRY, AS OF LAST CHECK", value: carryLabel, cls: carryNegative ? "text-clay-text" : "text-positive" }}
            note={carryNote}
            cta="Read the details"
          />
          <Card
            href="/earn/multiply"
            icon={<StackIcon />}
            pill={{ label: "LEVERAGED", cls: "bg-clay-tint text-clay-text" }}
            title={`Multiply on ${multiplyLiveAssets.join(" & ")}`}
            body={`Add to a live, Kamino-managed leveraged position, their rebalancing, not ours. Live for ${listJoin(multiplyLiveAssets)}${multiplyNotLiveAssets.length ? `; not available for ${listJoin(multiplyNotLiveAssets)}, which has no live Multiply market` : ""}.`}
            stat={{
              label: `AVG. LEVERAGE (${multiplyLive.map((m) => `${m.symbol} ${m.avgLeverage?.toFixed(2)}x`).join(" · ")})`,
              value: multiplyLive.map((m) => `${m.obligations}`).join(" / "),
              cls: "text-gold-text",
              suffix: "live positions",
            }}
            cta="Open Multiply"
          />
        </div>
      </Page>
    </AppShell>
  );
}

function Card({
  href,
  icon,
  pill,
  title,
  body,
  stat,
  note,
  cta,
}: {
  href: string;
  icon: React.ReactNode;
  pill: { label: string; cls: string };
  title: string;
  body: string;
  stat: { label: string; value: string; cls: string; suffix?: string };
  note?: string;
  cta: string;
}) {
  return (
    <article className="card-lift card-glow flex flex-1 flex-col rounded-[10px] border border-line bg-surface p-7 text-left">
      <div className="mb-5 flex items-start justify-between gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-gold-tint text-gold-text">{icon}</div>
        <span className={`rounded-xl px-2.5 py-1 font-mono text-[10px] tracking-[0.03em] ${pill.cls}`}>{pill.label}</span>
      </div>
      <h2 className="mb-2 mt-0 font-serif text-[22px] font-semibold text-ink">{title}</h2>
      <p className="mb-6 mt-0 font-serif text-[15px] leading-normal text-ink-muted">{body}</p>
      <div className="mt-auto flex items-end justify-between gap-3 border-t border-line-soft pt-4">
        <div>
          <div className="mb-1 font-mono text-[10px] text-ink-faint">{stat.label}</div>
          <Mono as="div" className={`text-[24px] ${stat.cls}`}>
            {stat.value}
            {stat.suffix && <span className="ml-2 text-[12px] text-ink-muted">{stat.suffix}</span>}
          </Mono>
        </div>
        <Link href={href} aria-label={cta} className="flex shrink-0 items-center gap-2 rounded-full bg-ink py-2 pl-4 pr-3 font-mono text-[12px] text-paper">
          {cta} <ArrowRightIcon />
        </Link>
      </div>
      {note && <p className="mb-0 mt-3 font-serif text-[13px] leading-normal text-ink-muted">{note}</p>}
    </article>
  );
}
