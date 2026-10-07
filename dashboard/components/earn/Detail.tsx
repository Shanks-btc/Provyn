"use client";

import Link from "next/link";
import { Fragment, type ReactNode } from "react";
import { explorerAddressUrl, useReserves } from "@/lib/api";
import { market } from "@/lib/market";
import { Mono } from "../Mono";
import { Notice } from "../app/AppShell";

/** Building blocks shared by /earn/redeposit and /earn/multiply, so the two pages keep one structure. */

export function BackLink({ href = "/earn", children = "All Earn strategies" }: { href?: string; children?: ReactNode }) {
  return (
    <Link href={href} className="mb-6 inline-block font-mono text-[12px] text-gold-strong hover:text-gold-text">
      ← {children}
    </Link>
  );
}

export function DetailSection({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} data-section={id} className="border-t border-line py-9 md:py-11">
      <h2 id={id} className="m-0 mb-5 font-serif text-[24px] font-semibold text-ink md:text-[28px]">
        {title}
      </h2>
      {children}
    </section>
  );
}

const STAT_TONE = { ink: "text-ink", positive: "text-positive", gold: "text-gold-text", clay: "text-clay-text" } as const;
export function HeroStat({ label, value, tone = "ink", note }: { label: string; value: ReactNode; tone?: keyof typeof STAT_TONE; note?: string }) {
  return (
    <div className="rounded-[10px] border border-line bg-surface p-5">
      <div className="mb-1 font-mono text-[10px] tracking-[0.03em] text-ink-faint">{label}</div>
      <Mono as="div" className={`text-[26px] ${STAT_TONE[tone]}`}>{value}</Mono>
      {note && <div className="mt-1 font-serif text-[13px] leading-normal text-ink-muted">{note}</div>}
    </div>
  );
}

/** "Your stock → Kamino → …" — a row of boxes joined by arrows on wide screens, a column on narrow ones. */
export function FlowDiagram({ steps }: { steps: { title: string; text: string; tone?: "ink" | "positive" | "clay" }[] }) {
  return (
    <ol className="m-0 flex list-none flex-col items-stretch gap-3 p-0 lg:flex-row lg:items-stretch lg:gap-0">
      {steps.map((s, i) => (
        <Fragment key={s.title}>
          <li className="flex-1 rounded-[10px] border border-line bg-surface p-5">
            <div className="mb-1 font-mono text-[10px] tracking-[0.03em] text-ink-faint">STEP {i + 1}</div>
            <div className={`mb-1 font-serif text-[17px] font-semibold ${s.tone === "clay" ? "text-clay-text" : s.tone === "positive" ? "text-positive" : "text-ink"}`}>{s.title}</div>
            <p className="m-0 font-serif text-[14px] leading-normal text-ink-muted">{s.text}</p>
          </li>
          {i < steps.length - 1 && (
            <li aria-hidden="true" className="flex items-center justify-center py-0 font-mono text-[18px] text-gold-deep lg:px-3">
              <span className="lg:hidden">↓</span>
              <span className="hidden lg:inline">→</span>
            </li>
          )}
        </Fragment>
      ))}
    </ol>
  );
}

export function ProcessList({ steps }: { steps: { title: string; text: ReactNode }[] }) {
  return (
    <ol className="m-0 flex list-none flex-col gap-3 p-0">
      {steps.map((s, i) => (
        <li key={s.title} className="flex gap-4 rounded-[10px] border border-line bg-surface p-5">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-gold-tint font-mono text-[13px] text-gold-strong">{i + 1}</span>
          <div>
            <div className="mb-0.5 font-serif text-[16px] font-semibold text-ink">{s.title}</div>
            <p className="m-0 font-serif text-[14px] leading-normal text-ink-muted">{s.text}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

export function RiskList({ risks }: { risks: { title: string; tone: "clay" | "neutral"; text: ReactNode; tag?: string }[] }) {
  return (
    <ul className="m-0 grid list-none gap-3 p-0 md:grid-cols-2">
      {risks.map((r) => (
        <li key={r.title} className={`rounded-[10px] border p-5 ${r.tone === "clay" ? "border-clay-text/40 bg-clay-tint/60" : "border-line bg-surface"}`}>
          <div className="mb-1.5 flex items-center justify-between gap-3">
            <span className="font-serif text-[16px] font-semibold text-ink">{r.title}</span>
            {r.tag && <span className={`shrink-0 rounded-xl px-2.5 py-1 font-mono text-[10px] ${r.tone === "clay" ? "bg-clay-tint text-clay-text" : "bg-line-soft text-ink-muted"}`}>{r.tag}</span>}
          </div>
          <p className="m-0 font-serif text-[14px] leading-normal text-ink-muted">{r.text}</p>
        </li>
      ))}
    </ul>
  );
}

/** The market address plus the reserve addresses that matter for this strategy, read live from /api/reserves. */
export function ContractAddresses({ symbols }: { symbols: string[] }) {
  const reserves = useReserves();
  const rows: { label: string; address: string }[] = [{ label: "Kamino xStocks market", address: market.market }];
  if (reserves.status === "ready") {
    for (const sym of symbols) {
      const r = sym === "USDC" ? reserves.data.usdc : reserves.data.reserves.find((x) => x.symbol === sym);
      if (r) rows.push({ label: `${sym} reserve`, address: r.reserveAddress }, { label: `${sym} mint`, address: r.mintAddress });
    }
  }
  return (
    <div>
      <div className="overflow-hidden rounded-[10px] border border-line bg-surface">
        {rows.map((r) => (
          <div key={r.label} className="flex flex-col gap-1 border-b border-line-soft px-5 py-3 last:border-b-0 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
            <span className="font-serif text-[14px] text-ink-muted">{r.label}</span>
            <a href={explorerAddressUrl(r.address)} target="_blank" rel="noreferrer" className="break-all font-mono text-[12px] text-gold-strong underline-offset-2 hover:underline">
              {r.address}
            </a>
          </div>
        ))}
      </div>
      {reserves.status === "loading" && <p className="mb-0 mt-3 font-mono text-[11px] text-ink-faint">Loading reserve addresses from the live market…</p>}
      {reserves.status === "error" && <div className="mt-3"><Notice tone="clay">Reserve addresses unavailable: {reserves.error}</Notice></div>}
    </div>
  );
}

export function Counterparties({ items }: { items: { name: string; role: string; href?: string }[] }) {
  return (
    <ul className="m-0 grid list-none gap-3 p-0 md:grid-cols-2">
      {items.map((c) => (
        <li key={c.name} className="rounded-[10px] border border-line bg-surface p-5">
          {c.href ? (
            <a href={c.href} target="_blank" rel="noreferrer" className="font-serif text-[17px] font-semibold text-ink underline-offset-2 hover:text-gold-text hover:underline">
              {c.name} ↗
            </a>
          ) : (
            <span className="font-serif text-[17px] font-semibold text-ink">{c.name}</span>
          )}
          <p className="mb-0 mt-1.5 font-serif text-[14px] leading-normal text-ink-muted">{c.role}</p>
        </li>
      ))}
    </ul>
  );
}

export const COUNTERPARTIES = [
  { name: "Kamino Lend", role: "The lending market Provyn builds on: it holds your collateral, lends the USDC and liquidates positions that fall below their threshold. Provyn is a client of it, not a lender.", href: "https://kamino.finance" },
  { name: "Pyth Network", role: "Oracle network Provyn cross-checks prices against whenever its feeds can answer. Kamino's own oracle sets the prices your position is actually liquidated against.", href: "https://www.pyth.network" },
];

export function Faq({ items }: { items: { q: string; a: ReactNode }[] }) {
  return (
    <div className="flex flex-col gap-3">
      {items.map((f) => (
        <details key={f.q} className="group rounded-2xl border border-line bg-surface open:border-gold-deep/50">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 font-serif text-[16px] font-semibold text-ink [&::-webkit-details-marker]:hidden">
            {f.q}
            <span aria-hidden="true" className="shrink-0 font-mono text-gold-deep transition-transform group-open:rotate-45">+</span>
          </summary>
          <div className="px-5 pb-5 font-serif text-[15px] leading-[1.65] text-ink-muted">{f.a}</div>
        </details>
      ))}
    </div>
  );
}
