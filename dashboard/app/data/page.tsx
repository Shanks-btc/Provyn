import type { Metadata } from "next";
import { AppShell, Notice, Page, PageHeader } from "@/components/app/AppShell";
import { HeroStat } from "@/components/earn/Detail";
import { Mono } from "@/components/Mono";
import { getGapStats, getStatus, MIN_SAMPLES_FOR_GAP_STATS, type GapCell } from "../../../src/riskdata/stats";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Provyn, Data",
  description: "How tokenized-stock collateral behaves on Kamino, as actually collected so far.",
};

const when = (iso: string | null) => (iso ? `${iso.replace("T", " ").slice(0, 16)} UTC` : "Not started");
const pct = (n: number) => `${n.toFixed(3)}%`;
const SERIES_LABEL: Record<string, string> = {
  onchain_price: "On-chain price and multiplier, every 5 min",
  oracle_gap: "Oracle vs stock price, every 5 min",
  market_state: "Market state, every 30 min",
  events: "Changes observed (multiplier, LTV)",
  market_state_backfill: "Kamino hourly history (backfilled)",
  events_backfill: "Parameter changes in that history (backfilled)",
};

function Cell({ c }: { c: GapCell }) {
  if (!c.enough) return <span className="text-ink-faint">Not enough samples yet ({c.n} of {MIN_SAMPLES_FOR_GAP_STATS})</span>;
  return (
    <span>
      <Mono className="text-ink">median {pct(c.medianAbsGapPct!)}</Mono> <span className="text-ink-faint">·</span> <Mono className="text-ink">95th {pct(c.p95AbsGapPct!)}</Mono>{" "}
      <span className="text-ink-faint">(n {c.n})</span>
    </span>
  );
}

export default function DataPage() {
  const status = getStatus();
  const gap = status.gapStatisticsPublished ? getGapStats() : [];
  const live = status.series.filter((s) => !s.series.endsWith("_backfill"));
  const backfill = status.series.filter((s) => s.series.endsWith("_backfill") && s.count > 0);
  const priceCount = status.series.find((s) => s.series === "onchain_price")?.count ?? 0;
  const withReference = status.referenceSourceEnabled;

  return (
    <AppShell>
      <Page>
        <PageHeader
          eyebrow="DATA"
          title="Collateral risk data"
          subtitle={
            withReference
              ? "Provyn records how each tokenized stock's on-chain price compares with the underlying stock, around the clock. This page shows only what has actually been collected so far."
              : "Provyn records how tokenized-stock collateral behaves on Kamino, around the clock: oracle prices, the multiplier on each token, risk limits, deposits and rates. This page shows only what has actually been collected so far."
          }
        />

        <div className="mb-8 grid gap-4 md:grid-cols-3" data-testid="data-stats">
          <HeroStat label="COLLECTING SINCE" value={<span className="text-[18px]">{when(status.collectingSince)}</span>} />
          <HeroStat label="LAST UPDATE" value={<span className="text-[18px]">{when(status.lastUpdate)}</span>} />
          <HeroStat label="PRICE SAMPLES COLLECTED" value={priceCount.toLocaleString("en-US")} note="One per asset every five minutes." />
        </div>

        <h2 className="mb-3 mt-0 font-serif text-[22px] font-semibold text-ink">Samples by series</h2>
        <div className="mb-8 overflow-x-auto rounded-[10px] border border-line bg-surface">
          <table className="w-full min-w-[640px] border-collapse text-left font-serif text-[14px]">
            <thead>
              <tr className="border-b border-line bg-paper-raised font-mono text-[10px] tracking-[0.04em] text-ink-faint">
                <th className="px-4 py-3 font-normal">SERIES</th>
                <th className="px-4 py-3 font-normal">FIRST</th>
                <th className="px-4 py-3 font-normal">LAST</th>
                <th className="px-4 py-3 text-right font-normal">SAMPLES</th>
                <th className="px-4 py-3 font-normal">SOURCE ERROR RATE</th>
              </tr>
            </thead>
            <tbody>
              {live.map((s) => (
                <tr key={s.series} className="border-b border-line-soft last:border-b-0">
                  <td className="px-4 py-3 text-ink">{SERIES_LABEL[s.series] ?? s.series}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-ink-muted">{s.count ? when(s.firstSampleAt) : "None yet"}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-ink-muted">{s.count ? when(s.lastSampleAt) : "None yet"}</td>
                  <td className="px-4 py-3 text-right"><Mono className="text-ink">{s.count.toLocaleString("en-US")}</Mono></td>
                  <td className="px-4 py-3 text-ink-muted">
                    {Object.keys(s.errorRate).length === 0 ? (s.count ? "No source errors recorded" : "n/a") : Object.entries(s.errorRate).map(([k, v]) => `${k} ${(v.rate * 100).toFixed(1)}%`).join(", ")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {withReference && <h2 className="mb-3 mt-0 font-serif text-[22px] font-semibold text-ink">Price gap statistics</h2>}
        {!withReference ? null : !status.gapStatisticsPublished ? (
          <Notice tone="neutral">
            Gap statistics are withheld for now. The stock prices they are computed from come from a data provider whose terms require written approval before results derived from its data are shared. The counts above are unaffected, and the statistics will appear here once that is in place.
          </Notice>
        ) : (
          <>
            <p className="mb-4 mt-0 max-w-[720px] font-serif text-[14px] leading-normal text-ink-muted">
              Absolute gap between each xStock&apos;s on-chain price (adjusted for its multiplier) and the stock&apos;s price, split by whether US markets were open. A statistic appears only with at least {MIN_SAMPLES_FOR_GAP_STATS} samples behind it. When markets are closed the stock price is the last close, so closed-session gaps are coarse.
            </p>
            <div className="mb-8 overflow-x-auto rounded-[10px] border border-line bg-surface">
              <table className="w-full min-w-[640px] border-collapse text-left font-serif text-[14px]">
                <thead>
                  <tr className="border-b border-line bg-paper-raised font-mono text-[10px] tracking-[0.04em] text-ink-faint">
                    <th className="px-4 py-3 font-normal">ASSET</th>
                    <th className="px-4 py-3 font-normal">MARKET OPEN</th>
                    <th className="px-4 py-3 font-normal">MARKET CLOSED</th>
                  </tr>
                </thead>
                <tbody>
                  {gap.length === 0 && (
                    <tr><td colSpan={3} className="px-4 py-3 text-ink-faint">No samples yet.</td></tr>
                  )}
                  {gap.map((g) => (
                    <tr key={g.asset} className="border-b border-line-soft last:border-b-0">
                      <td className="px-4 py-3"><Mono className="text-ink">{g.asset}</Mono></td>
                      <td className="px-4 py-3"><Cell c={g.open} /></td>
                      <td className="px-4 py-3"><Cell c={g.closed} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {backfill.length > 0 && (
          <Notice tone="neutral">
            Kamino&apos;s own hourly reserve history since {when(backfill[0].firstSampleAt)} was imported once and is kept in separate, labelled series. It covers the on-chain side only (price, limits, deposits, rates).{withReference ? " It has no stock prices, so it cannot produce gap statistics." : ""}
          </Notice>
        )}
      </Page>
    </AppShell>
  );
}
