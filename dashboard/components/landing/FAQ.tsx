"use client";

import { useState, type ReactNode } from "react";
import { LANDING_SEP, borrowApyLabel, listJoin, market, pct, signedPct } from "@/lib/market";
import { Mono } from "../Mono";

/*
 * Every answer states only what has been verified in this repo (see TESTPLAN.md). Figures that
 * change — rates, carry, LTVs, which assets have live Multiply, the AAPLx multiplier, the fee —
 * come from market-snapshot.json, the same source as the rest of the page, so the FAQ can never
 * contradict the cards above it.
 */

const { usdc, assets, solana } = market;
const xstockSymbols = market.xstocks.map((x) => x.symbol);
const multiplyLive = market.xstocks.filter((x) => x.multiply.obligations > 0).map((x) => x.symbol);
const aaplx = market.xstocks.find((x) => x.symbol === "AAPLx");
const limits = (s: keyof typeof assets) => `${Math.round(assets[s].loanToValuePct)}% / ${Math.round(assets[s].liquidationThresholdPct)}%`;

const N = ({ children }: { children: ReactNode }) => <Mono className="text-[0.92em] text-ink">{children}</Mono>;

const FAQS: { q: string; a: ReactNode }[] = [
  {
    q: "What is Provyn?",
    a: (
      <>
        Provyn is a prime brokerage rebuilt for the internet, unlock yield, leverage, and liquidity from your stock
        portfolio on Solana. Today, that means borrowing against or earning yield on tokenized stocks (xStocks) via Kamino
        Lend: pick an asset, supply it as collateral, borrow or deposit. An agent runs underneath every action, checking
        your real position and verifying the transaction against real mainnet state before you sign.
      </>
    ),
  },
  {
    q: "Does Provyn use AI?",
    a: (
      <>
        Yes, one step. Provyn uses an AI reasoning step to run these checks, reading your position and Kamino&apos;s prices,
        and simulating the transaction, but it only proposes. Every signature is yours.
      </>
    ),
  },
  {
    q: "Does Provyn hold or move my funds?",
    a: (
      <>
        No. Provyn never holds your keys or your assets. Every transaction is built unsigned, and the only way it goes
        through is you signing it in your own wallet, Provyn&apos;s send step accepts nothing that your wallet hasn&apos;t
        already signed.
      </>
    ),
  },
  {
    q: "Which stocks can I use?",
    a: (
      <>
        Kamino&apos;s xStocks market lists {xstockSymbols.length} tokenized stocks: {listJoin(xstockSymbols, "and", LANDING_SEP)}. Borrow and
        Earn work the same way for each. Multiply is only offered where Kamino has live Multiply positions, right now{" "}
        {listJoin(multiplyLive, "and", LANDING_SEP)}, and never proposed anywhere else.
      </>
    ),
  },
  {
    q: "How much can I borrow, and when does liquidation happen?",
    a: (
      <>
        Each asset has a loan-to-value limit (the most you can borrow against it) and a higher liquidation threshold, for
        example AAPLx <N>{limits("AAPLx")}</N>, SPYx <N>{limits("SPYx")}</N>, TSLAx <N>{limits("TSLAx")}</N>. If your
        collateral&apos;s value falls far enough that your debt crosses the threshold, Kamino can liquidate part of it.
        Provyn aims for a health factor of at least <N>1.5</N> and flags anything lower in plain language.
      </>
    ),
  },
  {
    q: "What does borrowing cost?",
    a: (
      <>
        You pay Kamino&apos;s variable USDC borrow rate, <N>{borrowApyLabel}</N> APY as of the last check. It moves with
        how much of the pool is borrowed, so the proposal shows the rate at the moment it&apos;s made, not a fixed quote.
      </>
    ),
  },
  {
    q: "Why won’t Provyn recommend borrowing just to redeposit and earn?",
    a:
      usdc.netCarryPct < 0 ? (
        <>
          Because right now it loses money: borrowing USDC costs <N>{pct(usdc.borrowApyPct)}</N> while supplying it earns{" "}
          <N>{pct(usdc.supplyApyPct)}</N>, a net carry of <N>{signedPct(usdc.netCarryPct)}</N> a year. The agent says so
          and suggests borrowing only for what you actually need. It will consider the earn leg once supply beats borrow.
        </>
      ) : (
        <>
          It will, when the math works: supplying USDC currently earns <N>{pct(usdc.supplyApyPct)}</N> against a{" "}
          <N>{pct(usdc.borrowApyPct)}</N> borrow cost. The agent still sizes it conservatively and shows both rates.
        </>
      ),
  },
  {
    q: "What is Multiply?",
    a: (
      <>
        A Kamino-managed leveraged position. In one transaction, a flash loan borrows USDC, a Jupiter swap turns it into
        more of your stock, and everything is deposited as collateral, so you hold more exposure than you started with.
        Leverage amplifies losses as well as gains, and you pay the USDC borrow rate on the debt. Provyn sizes it
        conservatively (e.g. <N>1.5×</N>).
      </>
    ),
  },
  {
    q: "What does Pyth do?",
    a: (
      <>
        Provyn cross-checks each xStock&apos;s price against Pyth&apos;s independent feed before sizing a position. Our
        API key doesn&apos;t yet carry entitlement for equity or xStock feeds, so that check currently returns unavailable.
        When it does, the agent says so, lists it as a risk, and sizes the position smaller, it never pretends the check
        passed.
      </>
    ),
  },
  {
    q: "Why does my wallet show more xStock than I can deposit?",
    a: (
      <>
        xStocks are Token-2022 tokens with a scaled display: wallets show your raw balance × an issuer-set multiplier (AAPLx
        is currently <N>×{aaplx?.uiMultiplier?.current.toFixed(6)}</N>), but Kamino moves raw units. Provyn sizes every
        deposit from the raw amount, the displayed figure once failed a real simulation with “insufficient funds”.
      </>
    ),
  },
  {
    q: "Why Solana?",
    a: (
      <>
        Provyn checks your position and simulates the transaction before every proposal, that only works if checking is cheap.
        Reads are free, and a real transaction fee is <N>{solana.proofFeeLamports.toLocaleString("en-US")} lamports</N>{" "}
        (about <N>${solana.proofFeeUsd.toFixed(4)}</N>). And the assets themselves, xStocks and Kamino&apos;s market for
        them, already live here.
      </>
    ),
  },
];

function Item({ index, q, a, open, onToggle }: { index: number; q: string; a: ReactNode; open: boolean; onToggle: () => void }) {
  const qid = `faq-q-${index}`, aid = `faq-a-${index}`;
  return (
    <div
      className={`rounded-2xl border bg-surface transition-colors ${
        open ? "border-gold-deep/50 shadow-[0_8px_30px_-12px_rgba(178,122,31,0.25)]" : "border-line hover:border-line-strong"
      }`}
    >
      <h3 className="m-0">
        <button
          id={qid}
          type="button"
          aria-expanded={open}
          aria-controls={aid}
          onClick={onToggle}
          className="flex w-full cursor-pointer items-center justify-between gap-4 rounded-2xl px-5 py-5 text-left md:px-6"
        >
          <span className="font-serif text-[17px] font-semibold leading-snug text-ink">{q}</span>
          <span
            aria-hidden="true"
            className={`flex size-7 shrink-0 items-center justify-center rounded-full border transition-colors ${
              open ? "border-gold-deep bg-gold-tint text-gold-text" : "border-line-strong text-ink-muted"
            }`}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M2 6h8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              <path
                d="M6 2v8"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                className={`origin-center transition-transform motion-reduce:transition-none ${open ? "scale-y-0" : ""}`}
              />
            </svg>
          </span>
        </button>
      </h3>
      {/* grid-rows 0fr→1fr animates to the answer's natural height; skipped for reduced motion. */}
      <div
        id={aid}
        role="region"
        aria-labelledby={qid}
        inert={!open}
        className={`grid transition-[grid-template-rows] duration-300 ease-out motion-reduce:transition-none ${
          open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
        }`}
      >
        <div className="overflow-hidden">
          <p className="m-0 px-5 pb-5 font-serif text-[15px] leading-[1.65] text-ink-muted md:px-6 md:pb-6">{a}</p>
        </div>
      </div>
    </div>
  );
}

export function FAQ() {
  const [open, setOpen] = useState<Set<number>>(() => new Set([0]));
  const toggle = (i: number) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });

  // Two independent stacks (first half, second half) so opening a card never leaves a hole in the
  // other column; on phones they read as one list, in order.
  const half = Math.ceil(FAQS.length / 2);
  const columns = [FAQS.slice(0, half), FAQS.slice(half)];

  return (
    <section id="faq" aria-labelledby="faq-title" className="relative overflow-hidden border-t border-line bg-paper">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute -left-40 top-24 size-[520px] rounded-full bg-[radial-gradient(circle,rgba(201,151,58,0.12)_0%,transparent_70%)] blur-[30px]" />
        <div className="absolute -right-40 bottom-0 size-[480px] rounded-full bg-[radial-gradient(circle,rgba(184,69,46,0.07)_0%,transparent_70%)] blur-[30px]" />
        <div className="absolute left-1/2 top-6 -translate-x-1/2 select-none font-serif text-[140px] font-bold leading-none tracking-tight text-ink/[0.04] md:top-2 md:text-[240px]">
          FAQ
        </div>
      </div>

      <div className="relative mx-auto max-w-[1440px] px-4 py-16 md:px-10 md:py-24 xl:px-14">
        <div className="mx-auto mb-12 max-w-[640px] text-center">
          <div className="mb-3 font-mono text-xs tracking-[0.08em] text-gold-strong">( Questions )</div>
          <h2 id="faq-title" className="m-0 font-serif text-[34px] font-semibold leading-tight text-ink md:text-[46px]">
            Straight answers.
          </h2>
          <p className="mb-0 mt-4 font-serif text-[17px] leading-normal text-ink-muted">
            What Provyn does, what it checks before you sign, and what it doesn&apos;t do yet.
          </p>
        </div>

        <div className="mx-auto grid max-w-[1120px] grid-cols-1 gap-4 md:grid-cols-2 md:gap-5">
          {columns.map((col, c) => (
            <div key={c} className="flex flex-col gap-4 md:gap-5">
              {col.map((f, i) => {
                const index = c * half + i;
                return <Item key={f.q} index={index} q={f.q} a={f.a} open={open.has(index)} onToggle={() => toggle(index)} />;
              })}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
