"use client";

import { useEffect, useRef } from "react";
import { explorerTxUrl } from "@/lib/api";
import type { ExecuteState } from "@/lib/execute";
import { Mono } from "../Mono";

/** The slice of a simulation the dialog shows: a Kamino ValidationResult or a swap simulation both satisfy it. */
export interface TxSimulation {
  projectedHealthFactor: number | null;
  simulation: { ran: false } | { ran: true; slot: string; unitsConsumed: string | null; instructionCount?: number };
}

export interface SummaryRow {
  label: string;
  value: string;
  tone?: "ink" | "clay";
}

/**
 * The one place a real signature is requested. Three stages, in one dialog:
 *   1. confirm  — "you are about to sign a real transaction", with the exact simulated numbers
 *   2. progress — building → waiting for the wallet → submitting/confirming (cannot be dismissed)
 *   3. outcome  — success (signature + Explorer link), failure (real error + logs), timeout, or "nothing was sent"
 */
export function TxModal({
  open,
  title,
  rows,
  simulation,
  state,
  onConfirm,
  onClose,
  successNote,
}: {
  open: boolean;
  title: string;
  rows: SummaryRow[];
  /** Only what the dialog reads — a ValidationResult (Kamino) or a swap simulation both fit. */
  simulation: TxSimulation;
  state: ExecuteState;
  onConfirm: () => void;
  onClose: () => void;
  /** Extra line inside the success outcome (e.g. the amount a swap actually delivered). */
  successNote?: React.ReactNode;
}) {
  const busy = state.step === "building" || state.step === "signing" || state.step === "submitting";
  const primary = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    primary.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !busy && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy, onClose]);

  if (!open) return null;
  const sim = simulation.simulation.ran ? simulation.simulation : null;
  const hf = simulation.projectedHealthFactor;

  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center bg-ink/55 p-0 sm:items-center sm:p-6" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div role="dialog" aria-modal="true" aria-labelledby="tx-title" data-tx-step={state.step} className="max-h-[92vh] w-full max-w-[520px] overflow-y-auto rounded-t-2xl border border-line bg-surface p-6 shadow-[0_24px_64px_rgba(0,0,0,0.3)] sm:rounded-2xl md:p-8">
        {state.step === "idle" && (
          <>
            <div className="mb-3 inline-block rounded-xl bg-clay-tint px-2.5 py-1 font-mono text-[10px] tracking-[0.03em] text-clay-text">REAL MAINNET TRANSACTION</div>
            <h2 id="tx-title" className="m-0 mb-2 font-serif text-[24px] font-semibold text-ink">
              You are about to sign a real transaction
            </h2>
            <p className="m-0 mb-5 font-serif text-[14px] leading-normal text-ink-muted">
              {title} This moves real funds on Solana mainnet. Provyn never holds your keys, your wallet will ask you to approve it next.
            </p>
            <div className="mb-4 overflow-hidden rounded-[10px] border border-line">
              {rows.map((r) => (
                <div key={r.label} className="flex items-center justify-between gap-4 border-b border-line-soft px-4 py-2.5 last:border-b-0">
                  <span className="font-serif text-[14px] text-ink-muted">{r.label}</span>
                  <Mono className={`text-right text-[13px] ${r.tone === "clay" ? "text-clay-text" : "text-ink"}`}>{r.value}</Mono>
                </div>
              ))}
              {hf !== null && (
                <div className="flex items-center justify-between gap-4 border-b border-line-soft bg-paper-raised px-4 py-2.5 last:border-b-0">
                  <span className="font-serif text-[14px] text-ink-muted">Projected health factor</span>
                  <Mono className={`text-[13px] ${hf < 1.5 ? "text-clay-text" : "text-ink"}`}>{hf.toFixed(2)}</Mono>
                </div>
              )}
            </div>
            {sim && (
              <p className="m-0 mb-5 font-mono text-[11px] leading-[1.6] text-ink-faint">
                On mainnet at slot {sim.slot}: succeeded, {sim.unitsConsumed ?? "?"} compute units{sim.instructionCount !== undefined ? `, ${sim.instructionCount} instructions` : ""}. Nothing has been signed or sent yet.
                The transaction is rebuilt once more right before your wallet opens.
              </p>
            )}
            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <button type="button" onClick={onClose} className="cursor-pointer rounded-lg border border-line-strong bg-surface px-5 py-3 font-mono text-[14px] text-ink hover:border-gold-deep">
                Cancel
              </button>
              <button ref={primary} type="button" onClick={onConfirm} className="cursor-pointer rounded-lg border border-transparent bg-gold-deep px-5 py-3 font-mono text-[14px] font-medium text-gold-ink hover:bg-gold-text">
                Continue to wallet
              </button>
            </div>
          </>
        )}

        {busy && (
          <div aria-live="polite">
            <h2 id="tx-title" className="m-0 mb-4 font-serif text-[22px] font-semibold text-ink">
              {state.step === "building" ? "Building on mainnet…" : state.step === "signing" ? "Waiting for your wallet…" : "Submitting to Solana…"}
            </h2>
            <ol className="m-0 mb-4 flex list-none flex-col gap-2 p-0 font-mono text-[13px]">
              {(
                [
                  ["building", "Build on mainnet"],
                  ["signing", "Approve in your wallet"],
                  ["submitting", "Submit and confirm on-chain"],
                ] as const
              ).map(([step, label], i, all) => {
                const at = all.findIndex(([s]) => s === state.step);
                return (
                  <li key={step} className={i < at ? "text-positive" : i === at ? "text-ink" : "text-ink-faint"}>
                    {i < at ? "✓" : i === at ? "●" : "○"} {label}
                  </li>
                );
              })}
            </ol>
            <p className="m-0 font-serif text-[13px] text-ink-muted">Keep this window open. This can take up to a minute.</p>
          </div>
        )}

        {state.step === "done" && <Outcome state={state} onClose={onClose} primary={primary} successNote={successNote} />}
      </div>
    </div>
  );
}

function Outcome({ state, onClose, primary, successNote }: { state: Extract<ExecuteState, { step: "done" }>; onClose: () => void; primary: React.RefObject<HTMLButtonElement | null>; successNote?: React.ReactNode }) {
  const o = state.outcome;
  const close = (
    <button ref={primary} type="button" onClick={onClose} className="mt-5 cursor-pointer rounded-lg border border-transparent bg-gold-deep px-5 py-3 font-mono text-[14px] font-medium text-gold-ink hover:bg-gold-text">
      Close
    </button>
  );
  const head = (tone: "positive" | "clay" | "ink", label: string, text: string) => (
    <>
      <div className={`mb-3 inline-block rounded-xl px-2.5 py-1 font-mono text-[10px] tracking-[0.03em] ${tone === "positive" ? "bg-positive-tint text-positive" : tone === "clay" ? "bg-clay-tint text-clay-text" : "bg-line-soft text-ink-muted"}`}>{label}</div>
      <h2 id="tx-title" className="m-0 mb-2 font-serif text-[24px] font-semibold text-ink">{text}</h2>
    </>
  );
  const link = (sig: string) => (
    <a href={explorerTxUrl(sig)} target="_blank" rel="noreferrer" className="break-all font-mono text-[12px] text-gold-strong underline underline-offset-2">
      {sig}
    </a>
  );

  switch (o.kind) {
    case "success":
      return (
        <div data-outcome="success">
          {head("positive", "CONFIRMED ON-CHAIN", "Transaction confirmed")}
          <p className="m-0 mb-3 font-serif text-[14px] text-ink-muted">Landed in slot <Mono>{o.slot}</Mono> on Solana mainnet. Signature:</p>
          <div className="mb-2">{link(o.signature)}</div>
          <a href={explorerTxUrl(o.signature)} target="_blank" rel="noreferrer" className="font-mono text-[13px] text-gold-strong">View on Solana Explorer ↗</a>
          {successNote && <div data-testid="tx-success-note" className="mt-3 font-serif text-[14px] text-ink">{successNote}</div>}
          <div>{close}</div>
        </div>
      );
    case "failed":
      return (
        <div data-outcome="failed">
          {head("clay", "FAILED ON-CHAIN", "The transaction failed")}
          <p className="m-0 mb-3 font-serif text-[14px] text-ink-muted">It was included in a block but reverted, so your position did not change (a network fee was still charged). Signature:</p>
          <div className="mb-3">{link(o.signature)}</div>
          <pre className="m-0 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-paper p-3 font-mono text-[11px] text-clay-text">{[o.error, ...(o.logs ?? []).filter((l) => /error|failed/i.test(l)).slice(-3)].join("\n")}</pre>
          {close}
        </div>
      );
    case "timeout":
      return (
        <div data-outcome="timeout">
          {head("ink", "NOT CONFIRMED YET", "Confirmation timed out")}
          <p className="m-0 mb-3 font-serif text-[14px] text-ink-muted">
            {o.blockhashExpired
              ? "The transaction's blockhash has expired and it was never seen on-chain, so it can no longer land, nothing was spent. You can safely try again."
              : "We could not confirm it within a minute. It may still land, check the signature below in Solana Explorer before retrying, so you don't do it twice."}
          </p>
          <div>{link(o.signature)}</div>
          {close}
        </div>
      );
    case "declined":
      return (
        <div data-outcome="declined">
          {head("ink", "NOTHING SENT", "Signature declined")}
          <p className="m-0 font-serif text-[14px] text-ink-muted">You closed or rejected the wallet prompt. Nothing was signed or sent, and no funds moved.</p>
          {close}
        </div>
      );
    case "build-failed":
      return (
        <div data-outcome="build-failed">
          {head("clay", "NOTHING SENT", "Could not prepare the transaction")}
          <p className="m-0 mb-3 font-serif text-[14px] text-ink-muted">The final simulation did not pass, so no transaction was issued for signing. No funds moved.</p>
          <pre className="m-0 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-paper p-3 font-mono text-[11px] text-clay-text">{(o.problems.length ? o.problems : [o.error]).join("\n")}</pre>
          {close}
        </div>
      );
    default:
      return (
        <div data-outcome="rejected">
          {head("clay", "NOT SENT", "The transaction was not sent")}
          <p className="m-0 mb-3 font-serif text-[14px] text-ink-muted">It never reached the chain, so nothing was spent.</p>
          <pre className="m-0 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-paper p-3 font-mono text-[11px] text-clay-text">{o.error}</pre>
          {close}
        </div>
      );
  }
}
