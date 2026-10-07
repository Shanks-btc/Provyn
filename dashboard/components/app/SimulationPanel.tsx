"use client";

import type { ValidationResult } from "@/lib/api";
import { Notice } from "./AppShell";

/** Below this projected health factor signing is blocked; below the agent's own 1.5 the UI warns. */
export const HF_BLOCK = 1.1;
export const HF_WARN = 1.5;

export function SimulationPanel({ state, result, error, hf, blocked }: { state: string; result: ValidationResult | null; error: string | null; hf: number | null; blocked: boolean }) {
  if (state === "idle") return <p className="m-0 font-mono text-[12px] text-ink-faint">Enter both amounts and Provyn simulates the exact transaction on mainnet before you sign anything.</p>;
  if (state === "running") return <Notice>Simulating this transaction against live mainnet state…</Notice>;
  if (state === "error") return <Notice tone="clay">Simulation request failed: {error}</Notice>;
  if (!result) return null;
  const sim = result.simulation.ran ? result.simulation : null;
  if (!result.valid) {
    return (
      <Notice tone="clay">
        <strong>Simulation did not pass.</strong> Nothing can be signed.
        <ul className="mb-0 mt-2 list-disc pl-5 font-mono text-[11px]">{result.problems.map((p, i) => <li key={i} className="break-words">{p.slice(0, 260)}</li>)}</ul>
      </Notice>
    );
  }
  return (
    <div className="rounded-lg border border-positive/40 bg-positive-tint px-4 py-3">
      <div className="font-mono text-[11px] tracking-[0.04em] text-positive">SIMULATION PASSED</div>
      <p className="mb-0 mt-1 font-serif text-[14px] leading-normal text-ink">
        Ran against mainnet at slot <span className="font-mono">{sim?.slot}</span> using <span className="font-mono">{sim?.unitsConsumed}</span> compute units. Projected health factor{" "}
        <span className={`font-mono ${hf !== null && hf < HF_WARN ? "text-clay-text" : ""}`}>{hf !== null ? hf.toFixed(2) : "n/a"}</span> (liquidation at 1.00).
      </p>
      {hf !== null && hf < HF_WARN && (
        <p className="mb-0 mt-2 font-serif text-[13px] leading-normal text-clay-text">
          {blocked ? `This is below ${HF_BLOCK.toFixed(2)}, too close to liquidation, so signing is blocked. Borrow less or supply more.` : `Below ${HF_WARN.toFixed(1)}, the health factor Provyn treats as its conservative minimum: a modest price drop could put this position at risk of liquidation.`}
        </p>
      )}
    </div>
  );
}
