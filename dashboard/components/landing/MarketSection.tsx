"use client";

import { useState } from "react";
import { market } from "@/lib/market";
import { Mono } from "../Mono";
import { SectionTitle } from "./Section";

/*
 * Every xStock reserve in Kamino's xStocks market, from market-snapshot.json (`npm run
 * snapshot:landing`): Kamino's oracle price, LTV / liquidation threshold, deposits, live Multiply
 * positions — and each mint's own on-chain facts (issuer token name, token program, Token-2022
 * extensions, scaled-UI multiplier). Read from Solana mainnet at market.checkedAt; a snapshot, not
 * a feed, so the header shows when. The multipliers match an independent source (Stripr) exactly.
 */

type XStock = (typeof market.xstocks)[number];

const MARKET_EXPLORER = `https://explorer.solana.com/address/${market.market}`;
const mintExplorer = (mint: string) => `https://explorer.solana.com/address/${mint}`;

const rows = [...market.xstocks].sort((a, b) => b.depositedUsd - a.depositedUsd);
const maxDeposits = Math.max(...rows.map((r) => r.depositedUsd));

const usdCompact = (n: number) =>
  n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(1)}K` : `$${n.toFixed(0)}`;
const usd = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const multiplier = (x: XStock) => (x.uiMultiplier ? x.uiMultiplier.current.toFixed(6) : ", ");
const multiplierChange = (x: XStock) => (x.uiMultiplier ? (x.uiMultiplier.current - 1) * 100 : 0);
const multiplierSince = (x: XStock) =>
  x.uiMultiplier?.effectiveSince
    ? new Date(x.uiMultiplier.effectiveSince).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).replace(",", ", ")
    : "Unchanged since launch";
const multiplyLabel = (x: XStock) =>
  x.multiply.obligations > 0 ? `${x.multiply.obligations} · ${(x.multiply.avgLeverage ?? 0).toFixed(2)}x` : ", ";
const shortMint = (mint: string) => `${mint.slice(0, 3)}…${mint.slice(-4)}`;

/** Token-2022 extension ids → readable chip labels. */
const EXTENSION_LABELS: Record<string, string> = {
  metadataPointer: "Metadata pointer",
  tokenMetadata: "Token metadata",
  permanentDelegate: "Permanent delegate",
  defaultAccountState: "Default account state",
  scaledUiAmountConfig: "Scaled UI amount",
  pausableConfig: "Pausable",
  confidentialTransferMint: "Confidential transfers",
  transferHook: "Transfer hook",
};

function LiveDot() {
  return <span aria-hidden="true" className="inline-block size-1.5 shrink-0 rounded-full bg-gold" />;
}

function DepositBar({ x }: { x: XStock }) {
  const pct = Math.max(2, (x.depositedUsd / maxDeposits) * 100);
  return (
    <span aria-hidden="true" className="block h-1.5 w-24 overflow-hidden rounded-full bg-term-raised">
      <span className="block h-full rounded-full bg-gold" style={{ width: `${pct}%` }} />
    </span>
  );
}

function MarketTable({ selected, onSelect }: { selected: string; onSelect: (s: string) => void }) {
  const selectButton = (x: XStock, className: string) => (
    <button
      type="button"
      onClick={() => onSelect(x.symbol)}
      aria-pressed={selected === x.symbol}
      aria-label={`Show ${x.symbol} details`}
      className={`cursor-pointer text-left ${className}`}
    >
      <span className="font-mono text-sm font-medium text-term-text">{x.symbol}</span>{" "}
      <span className="font-serif text-[13px] text-term-muted">{x.name?.replace(/ xStock$/, "")}</span>
    </button>
  );

  return (
    <div className="overflow-hidden rounded-xl border border-term-line bg-term-surface">
      <div className="flex flex-col gap-3 border-b border-term-line px-5 py-5 sm:flex-row sm:items-end sm:justify-between md:px-6">
        <div>
          <div className="mb-2 flex items-center gap-2 font-mono text-[11px] text-gold">
            <LiveDot />
            Read from Solana mainnet
          </div>
          <h3 className="m-0 font-serif text-xl font-semibold text-term-text">Every xStock in Kamino&apos;s market</h3>
        </div>
        <a href={MARKET_EXPLORER} target="_blank" rel="noreferrer" className="shrink-0 font-mono text-xs text-term-muted hover:text-gold">
          Verify on explorer ↗
        </a>
      </div>

      {/* lg+: a real table. */}
      <table className="hidden w-full border-collapse lg:table">
        <thead>
          <tr className="border-b border-term-line text-left font-mono text-[10px] tracking-[0.06em] text-term-muted">
            <th scope="col" className="px-6 py-3 font-normal">STOCK</th>
            <th scope="col" className="px-3 py-3 font-normal">DEPOSITED IN KAMINO</th>
            <th scope="col" className="px-3 py-3 text-right font-normal">ORACLE PRICE</th>
            <th scope="col" className="px-3 py-3 text-right font-normal">LTV / LIQ.</th>
            <th scope="col" className="px-3 py-3 text-right font-normal">MULTIPLY (POS. · AVG)</th>
            <th scope="col" className="px-6 py-3 text-right font-normal">UI MULTIPLIER</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((x) => (
            <tr
              key={x.symbol}
              onClick={() => onSelect(x.symbol)}
              className={`cursor-pointer border-b border-term-line last:border-b-0 hover:bg-term-raised/50 ${selected === x.symbol ? "bg-term-raised/70" : ""}`}
            >
              <th scope="row" className="px-6 py-3.5 text-left font-normal">
                {selectButton(x, "")}
              </th>
              <td className="px-3 py-3.5">
                <span className="flex items-center gap-3">
                  <DepositBar x={x} />
                  <Mono className="text-[13px] text-term-text">{usdCompact(x.depositedUsd)}</Mono>
                </span>
              </td>
              <td className="px-3 py-3.5 text-right"><Mono className="text-[13px] text-term-text">{usd(x.priceUsd)}</Mono></td>
              <td className="px-3 py-3.5 text-right">
                <Mono className="text-[13px] text-term-muted">
                  {Math.round(x.loanToValuePct)}% / {Math.round(x.liquidationThresholdPct)}%
                </Mono>
              </td>
              <td className="px-3 py-3.5 text-right">
                <Mono className={`text-[13px] ${x.multiply.obligations > 0 ? "text-gold" : "text-term-muted"}`}>{multiplyLabel(x)}</Mono>
              </td>
              <td className="px-6 py-3.5 text-right"><Mono className="text-[13px] text-term-text">×{multiplier(x)}</Mono></td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Below lg: one block per stock — six columns don't fit a phone or tablet width. */}
      <ul className="m-0 list-none p-0 lg:hidden">
        {rows.map((x) => (
          <li key={x.symbol} className={`border-b border-term-line px-5 py-4 last:border-b-0 md:px-6 ${selected === x.symbol ? "bg-term-raised/70" : ""}`}>
            <div className="mb-3 flex items-center justify-between gap-3">
              {selectButton(x, "min-w-0")}
              <span className="flex shrink-0 items-center gap-2">
                <DepositBar x={x} />
                <Mono className="text-[13px] text-term-text">{usdCompact(x.depositedUsd)}</Mono>
              </span>
            </div>
            <dl className="m-0 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
              {[
                ["ORACLE PRICE", usd(x.priceUsd)],
                ["LTV / LIQ.", `${Math.round(x.loanToValuePct)}% / ${Math.round(x.liquidationThresholdPct)}%`],
                ["MULTIPLY", multiplyLabel(x)],
                ["UI MULTIPLIER", `×${multiplier(x)}`],
              ].map(([k, v]) => (
                <div key={k}>
                  <dt className="font-mono text-[10px] tracking-[0.06em] text-term-muted">{k}</dt>
                  <Mono as="dd" className="m-0 text-[13px] text-term-text">{v}</Mono>
                </div>
              ))}
            </dl>
          </li>
        ))}
      </ul>
    </div>
  );
}

function AssetDetail({ x }: { x: XStock }) {
  const change = multiplierChange(x);
  const facts: [string, string, string?][] = [
    ["Token program", x.tokenProgram],
    ["UI multiplier", multiplier(x)],
    ["Change from 1.0", `${change > 0 ? "+" : ""}${change.toFixed(3)}%`, change > 0 ? "text-gold" : undefined],
    ["Last multiplier update", multiplierSince(x)],
    ["Kamino oracle price", usd(x.priceUsd)],
    ["Deposited in Kamino", `${x.depositedTokens.toLocaleString("en-US", { maximumFractionDigits: 2 })} ${x.symbol}`],
  ];
  return (
    <aside aria-live="polite" aria-labelledby="asset-detail-title" className="rounded-xl border border-term-line bg-term-surface p-5 md:p-6">
      <div className="mb-5 flex items-center justify-between gap-3">
        <span className="flex items-center gap-2 font-mono text-[11px] text-gold">
          <LiveDot />
          Read from Solana mainnet
        </span>
        <a href={mintExplorer(x.mint)} target="_blank" rel="noreferrer" className="font-mono text-xs text-term-muted hover:text-gold">
          Explorer ↗
        </a>
      </div>

      <div className="mb-5 flex items-center gap-3">
        <span aria-hidden="true" className="flex size-11 shrink-0 items-center justify-center rounded-full bg-term-raised font-serif text-lg font-semibold text-term-text">
          {x.symbol[0]}
        </span>
        <div className="min-w-0">
          <h3 id="asset-detail-title" className="m-0 font-serif text-lg font-semibold text-term-text">
            {x.name ?? x.symbol}
          </h3>
          <Mono as="div" className="text-xs text-term-muted">
            {x.symbol} · {shortMint(x.mint)}
          </Mono>
        </div>
      </div>

      <dl className="m-0">
        {facts.map(([k, v, tone]) => (
          <div key={k} className="flex items-baseline justify-between gap-4 border-t border-term-line py-3">
            <dt className="font-serif text-sm text-term-muted">{k}</dt>
            <Mono as="dd" className={`m-0 text-right text-sm font-medium ${tone ?? "text-term-text"}`}>{v}</Mono>
          </div>
        ))}
      </dl>

      <ul aria-label="Token-2022 extensions on this mint" className="m-0 mt-4 flex list-none flex-wrap gap-1.5 p-0">
        {x.extensions.map((e) => (
          <li key={e} className="rounded border border-term-control px-2 py-1 font-mono text-[10px] text-term-muted">
            {EXTENSION_LABELS[e] ?? e}
          </li>
        ))}
      </ul>

      <p className="mb-0 mt-4 font-serif text-[13px] leading-[1.6] text-term-muted">
        This multiplier is set by the token&apos;s issuer. Wallets display raw balance × multiplier; Kamino, and Provyn, work in
        raw units, so deposits are sized from the raw amount.
      </p>
    </aside>
  );
}

const EXPLAINERS = [
  {
    title: "Collateral that's native to the chain",
    body: `All ${rows.length} xStocks in this market are Token-2022 mints on Solana, and Kamino lends against them directly, the asset you borrow against is the token itself, not a wrapper around it.`,
    icon: "M4 7h16M4 12h16M4 17h10",
  },
  {
    title: "A balance your wallet can't show you",
    body: "Wallets display raw balance × multiplier, but Kamino moves raw units. Sizing from the displayed figure once failed a real mainnet simulation with “insufficient funds”, Provyn sizes from the raw amount.",
    icon: "M12 3v18M5 8h14M7 16h10",
  },
  {
    title: "One transaction, several protocols",
    body: "A Multiply position composes a Kamino flash loan, a Jupiter swap and a deposit + borrow atomically, and is simulated on mainnet before it's ever proposed to you.",
    icon: "M13 3L5 14h6l-1 7 8-11h-6l1-7z",
  },
];

function Explainer({ title, body, icon }: (typeof EXPLAINERS)[number]) {
  return (
    <div className="flex gap-4 rounded-xl border border-term-line bg-term-surface p-5 md:p-6">
      <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-term-line text-gold">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
          <path d={icon} stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
        </svg>
      </span>
      <div>
        <h3 className="mb-1.5 mt-0 font-serif text-lg font-semibold text-term-text">{title}</h3>
        <p className="m-0 font-serif text-sm leading-[1.6] text-term-muted">{body}</p>
      </div>
    </div>
  );
}

export function MarketSection() {
  const [selected, setSelected] = useState("AAPLx");
  const current = rows.find((r) => r.symbol === selected) ?? rows[0];

  return (
    <section id="market" aria-labelledby="market-title" className="bg-charcoal">
      <div className="mx-auto max-w-[1440px] px-4 py-14 md:px-10 md:py-[72px] xl:px-14">
        <SectionTitle id="market-title" className="mb-11 max-w-[640px] !text-term-text">
          The market
        </SectionTitle>

        <MarketTable selected={current.symbol} onSelect={setSelected} />

        {/* lg+: explainers left, detail card right. Below lg the detail card comes first, right under
            the table, so picking a stock shows its details without scrolling past the explainers. */}
        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_400px]">
          <div className="order-2 flex flex-col gap-4 lg:order-1">
            {EXPLAINERS.map((e) => (
              <Explainer key={e.title} {...e} />
            ))}
          </div>
          <div className="order-1 lg:order-2">
            <AssetDetail x={current} />
          </div>
        </div>
      </div>
    </section>
  );
}
