"use client";

import type { ReactNode } from "react";
import { useReserves } from "@/lib/api";
import { HowItWorks, requiredStock } from "./HowItWorks";
import { Notice } from "../app/AppShell";
import { Mono } from "../Mono";
import { tokenAmount } from "../app/fields";

/** The accepted propose_strategy output, exactly as the agent returned it. */
export interface Proposal {
  proposed: true;
  summary: string;
  strategyType: "borrow" | "borrow_and_earn" | "earn" | "multiply";
  existingCollateralSymbol?: string;
  newDepositSymbol?: string;
  newDepositAmount?: number;
  borrowSymbol?: string;
  borrowAmount?: number;
  earnSymbol?: string;
  earnAmount?: number;
  targetLeverage?: number;
  projectedHealthFactor?: number;
  assetCapabilities: { symbol: string; supported: string[]; notSupported: string[] }[];
  risks: string[];
  validation: { validationId: string; simulatedAtSlot: string | null; unitsConsumed: string | null; projectedHealthFactor: number | null };
}
type NoProposal = { proposed: false; message: string };

const TYPE_LABEL: Record<Proposal["strategyType"], string> = {
  borrow: "Borrow against your stock",
  borrow_and_earn: "Borrow, then redeposit to earn",
  earn: "Supply USDC to earn",
  multiply: "Kamino Multiply (leveraged)",
};

/**
 * The agent's summary/risks/message text is generated live by Claude per request — it can't be edited as a static
 * string, so the site's "no em-dash" style is applied here at render time instead: any em-dash the model wrote comes
 * out as a comma, the same substitution used for every other string on the site.
 */
const noEmDash = (text: string) => text.replace(/\s*—\s*/g, ", ").replace(/,\s*,/g, ",");

/** Renders the agent's **bold** markup as real bold, keeping its paragraphs and lists; never injects HTML. */
export function RichText({ text: raw }: { text: string }) {
  const text = noEmDash(raw);
  return (
    <div className="flex flex-col gap-2 font-serif text-[15px] leading-[1.65] text-ink">
      {text.split(/\n{2,}/).map((para, i) => (
        <p key={i} className="m-0 whitespace-pre-line">
          {para.split(/(\*\*[^*]+\*\*)/g).map((part, j) => (part.startsWith("**") && part.endsWith("**") ? <strong key={j}>{part.slice(2, -2)}</strong> : <span key={j}>{part}</span>))}
        </p>
      ))}
    </div>
  );
}

/** Where the real action lives, with the agent's own numbers pre-filled. */
export function destinationFor(p: Proposal): { href: string; label: string; executes: boolean } {
  const qs = (o: Record<string, string | number | undefined>) => {
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries(o)) if (v !== undefined) u.set(k, String(v));
    return u.toString();
  };
  if (p.strategyType === "borrow") {
    return { href: `/borrow?${qs({ asset: p.newDepositSymbol ?? p.existingCollateralSymbol, supply: p.newDepositAmount, borrow: p.borrowAmount })}`, label: "Open in Borrow to review and sign", executes: true };
  }
  if (p.strategyType === "multiply") {
    return { href: `/earn/multiply?${qs({ asset: p.newDepositSymbol, deposit: p.newDepositAmount, leverage: p.targetLeverage })}`, label: "Open in Multiply to review and sign", executes: true };
  }
  return { href: "/earn/redeposit", label: "Read how this strategy works", executes: false };
}

export function AgentResult({
  outcome,
  onNavigate,
  onRestart,
  onRetry,
  heldBalances,
  onComplete,
}: {
  outcome: { intent: string; result: unknown } | { error: string };
  onNavigate?: () => void;
  onRestart: () => void;
  onRetry: () => void;
  /** The wallet's real MOVABLE balances (raw-based, not the inflated on-screen amount); null while loading. */
  heldBalances: { symbol: string; amount: string }[] | null;
  /** The user followed the last step, so the wizard's saved answers are done with. */
  onComplete?: () => void;
}) {
  const reserves = useReserves();
  if ("error" in outcome) {
    return (
      <div data-testid="agent-result" data-kind="error" className="flex flex-col items-start gap-4">
        <Notice tone="clay"><strong>Provyn could not complete this.</strong> {outcome.error}</Notice>
        <div className="flex gap-3">
          <button type="button" onClick={onRetry} className="cursor-pointer rounded-lg bg-gold-deep px-5 py-3 font-mono text-[14px] font-medium text-gold-ink hover:bg-gold-text">Try again</button>
          <button type="button" onClick={onRestart} className="cursor-pointer rounded-lg border border-line-strong bg-surface px-5 py-3 font-mono text-[14px] text-ink hover:border-gold-deep">Start over</button>
        </div>
      </div>
    );
  }

  const result = outcome.result as Proposal | NoProposal;
  const intentBox = (
    <details className="rounded-lg border border-line bg-surface px-4 py-3">
      <summary className="cursor-pointer font-mono text-[12px] text-ink-muted">What Provyn received (your answers, turned into a request)</summary>
      <p className="mb-0 mt-3 font-serif text-[13px] leading-normal text-ink-muted" data-testid="composed-intent">{outcome.intent}</p>
    </details>
  );

  if (!result.proposed) {
    return (
      <div data-testid="agent-result" data-kind="no-proposal" className="flex flex-col gap-5">
        <Notice tone="gold"><strong>Provyn did not reach a validated proposal.</strong> Here is what it said, unedited:</Notice>
        <div className="rounded-[10px] border border-line bg-surface p-6"><RichText text={result.message} /></div>
        {intentBox}
        <div className="flex flex-wrap gap-3">
          <button type="button" onClick={onRetry} className="cursor-pointer rounded-lg bg-gold-deep px-5 py-3 font-mono text-[14px] font-medium text-gold-ink hover:bg-gold-text">Ask again</button>
          <button type="button" onClick={onRestart} className="cursor-pointer rounded-lg border border-line-strong bg-surface px-5 py-3 font-mono text-[14px] text-ink hover:border-gold-deep">Change my answers</button>
        </div>
      </div>
    );
  }

  const dest = destinationFor(result);
  const hf = result.validation.projectedHealthFactor ?? result.projectedHealthFactor ?? null;
  const rows: [string, ReactNode][] = [["Strategy", TYPE_LABEL[result.strategyType]]];
  if (result.existingCollateralSymbol) rows.push(["Existing collateral", result.existingCollateralSymbol]);
  if (result.newDepositAmount) rows.push(["Deposit", `${tokenAmount(result.newDepositAmount, 8)} ${result.newDepositSymbol}`]);
  if (result.borrowAmount) rows.push(["Borrow", `${tokenAmount(result.borrowAmount, 6)} ${result.borrowSymbol ?? "USDC"}`]);
  if (result.earnAmount) rows.push(["Supply to earn", `${tokenAmount(result.earnAmount, 6)} ${result.earnSymbol ?? "USDC"}`]);
  if (result.targetLeverage) rows.push(["Target leverage", `${result.targetLeverage}x`]);
  if (hf !== null) rows.push(["Projected health factor", <span key="hf" className={hf < 1.5 ? "text-clay-text" : ""}>{hf.toFixed(2)} (liquidation at 1.00)</span>]);

  return (
    <div data-testid="agent-result" data-kind="proposal" className="flex flex-col gap-6">
      <div>
        <div data-testid="strategy-badge" className="mb-3 inline-block rounded-xl bg-positive-tint px-2.5 py-1 font-mono text-[10px] tracking-[0.03em] text-positive">STRATEGY SELECTED FOR YOU</div>
        <h2 data-testid="strategy-title" className="m-0 font-serif text-[28px] font-semibold text-ink md:text-[34px]">{TYPE_LABEL[result.strategyType]}</h2>
        <p className="mb-0 mt-2 font-serif text-[13px] text-ink-muted">This is Provyn&apos;s real answer for your wallet right now. It can differ from run to run, and nothing has been signed or sent.</p>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,400px)]">
        <div className="rounded-[10px] border border-line bg-surface p-6 md:p-7" data-testid="proposal-summary"><RichText text={result.summary} /></div>
        <aside className="self-start overflow-hidden rounded-[10px] border border-line bg-surface" data-testid="proposal-numbers">
          <div className="border-b border-line bg-paper-raised px-5 py-3 font-mono text-[10px] tracking-[0.04em] text-ink-faint">THE NUMBERS PROVYN VALIDATED</div>
          {rows.map(([k, v]) => (
            <div key={k} className="flex items-start justify-between gap-4 border-b border-line-soft px-5 py-3 last:border-b-0">
              <span className="font-serif text-[14px] text-ink-muted">{k}</span>
              <Mono as="span" className="text-right text-[14px] text-ink">{v}</Mono>
            </div>
          ))}
          <div className="border-t border-line-soft bg-paper-raised px-5 py-3 font-mono text-[11px] leading-normal text-ink-faint">
            Simulated at slot {result.validation.simulatedAtSlot ?? "n/a"} · {result.validation.unitsConsumed ?? "?"} compute units
          </div>
        </aside>
      </div>

      <section aria-labelledby="risks-title" data-testid="proposal-risks">
        <h3 id="risks-title" className="m-0 mb-3 font-serif text-[20px] font-semibold text-ink">Risks Provyn flagged</h3>
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {result.risks.map((r, i) => (
            <li key={i} className="rounded-lg border border-clay-text/30 bg-clay-tint/50 px-4 py-3 font-serif text-[14px] leading-normal text-ink">{noEmDash(r)}</li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="caps-title" data-testid="proposal-capabilities">
        <h3 id="caps-title" className="m-0 mb-3 font-serif text-[20px] font-semibold text-ink">What each asset supports</h3>
        <div className="flex flex-wrap gap-3">
          {result.assetCapabilities.map((c) => (
            <div key={c.symbol} className="rounded-lg border border-line bg-surface px-4 py-3 font-mono text-[12px] text-ink">
              <div className="mb-1 text-[13px] font-medium">{c.symbol}</div>
              {c.supported.length > 0 && <div className="text-positive">✓ {c.supported.join(", ")}</div>}
              {c.notSupported.length > 0 && <div className="text-clay-text">✗ {c.notSupported.join(", ")}</div>}
            </div>
          ))}
        </div>
      </section>

      {intentBox}

      <HowItWorks
        proposal={result}
        dest={dest}
        held={heldBalances}
        price={reserves.status === "ready" ? Number(reserves.data.reserves.find((r) => r.symbol === requiredStock(result)?.symbol)?.oraclePriceUsd) || null : null}
        onNavigate={onNavigate}
        onRestart={onRestart}
        onComplete={onComplete}
      />
    </div>
  );
}
