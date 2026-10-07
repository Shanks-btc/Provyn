"use client";

import { useEffect, useState } from "react";

/** One real tool call the agent made, streamed from /api/intent as it happens. */
export interface AgentEvent {
  type: "tool";
  turn: number;
  name: string;
  isError: boolean;
  symbol: string | null;
  valid: boolean | null;
  available: boolean | null;
  projectedHealthFactor: number | null;
  /** check_price_divergence only: who actually answered, straight from the tool result. Absent on results recorded before the Finnhub fallback existed. */
  source?: "pyth" | "finnhub" | null;
  referenceSession?: "open" | "closed" | "unknown" | null;
  referenceAsOf?: string | null;
}

const lastCloseDate = (iso: string | null | undefined) => {
  const d = iso ? new Date(iso) : null;
  return d && !Number.isNaN(d.getTime()) ? d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : null;
};

export function describeEvent(e: AgentEvent): { label: string; ok: boolean; detail?: string } {
  const sym = e.symbol ?? "";
  switch (e.name) {
    case "get_position":
      return { label: "Read your real Kamino position and wallet balances", ok: !e.isError };
    case "list_xstock_reserves":
      return { label: "Listed the xStock reserves and their risk limits", ok: !e.isError };
    case "get_asset_capabilities":
      return { label: `Checked what ${sym || "the asset"} supports (Borrow / Earn / Multiply)`, ok: !e.isError };
    case "check_price_divergence":
      // The label follows the tool result's own `source`, never an assumption: a Finnhub answer must not read as Pyth.
      if (e.available === false) {
        return { label: `Tried to cross-check ${sym}'s price with Pyth`, ok: false, detail: "Unavailable, Provyn's Pyth key isn't entitled to equity feeds yet" };
      }
      if (e.source === "finnhub") {
        if (e.referenceSession === "open") return { label: `Cross-checked ${sym} price with Finnhub`, ok: !e.isError };
        const day = lastCloseDate(e.referenceAsOf);
        return { label: `Checked ${sym} against Finnhub's last close (market closed, coarse check)`, ok: !e.isError, detail: day ? `Pyth was unavailable. Reference: last close, ${day}` : "Pyth was unavailable" };
      }
      // source "pyth", or a result recorded before the fallback existed (when Pyth was the only possible source).
      return { label: `Cross-checked ${sym} price with Pyth`, ok: !e.isError };
    case "validate_strategy":
      return e.valid === false || e.isError
        ? { label: "Simulated a candidate strategy on mainnet", ok: false, detail: "It did not pass, Provyn will revise it" }
        : { label: "Simulated a candidate strategy on mainnet", ok: true, detail: e.projectedHealthFactor ? `Passed · projected health factor ${e.projectedHealthFactor.toFixed(2)}` : "Passed" };
    case "propose_strategy":
      return e.isError ? { label: "Proposal rejected by Provyn's checks", ok: false, detail: "Provyn will correct it" } : { label: "Prepared the proposal", ok: true };
    default:
      return { label: e.name, ok: !e.isError };
  }
}

/** Live view of the real agent loop: each step appears when the agent actually performs it. */
export function AgentRun({ events, asset }: { events: AgentEvent[]; asset: string }) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, []);

  return (
    <div data-testid="agent-run" role="status" aria-live="polite" className="rounded-[10px] border border-line bg-surface p-6 md:p-8">
      <div className="mb-1 font-mono text-[11px] tracking-[0.04em] text-gold-strong">PROVYN IS WORKING · {seconds}s</div>
      <h2 className="m-0 mb-2 font-serif text-[24px] font-semibold text-ink">Checking real data for your {asset}</h2>
      <p className="m-0 mb-5 max-w-[620px] font-serif text-[14px] leading-normal text-ink-muted">
        This is live, not a preset answer. Provyn reads your position, checks what the asset supports, and simulates its candidate on mainnet before proposing anything. It usually takes one to two minutes.
      </p>
      <ol className="m-0 flex list-none flex-col gap-2.5 p-0">
        {events.map((e, i) => {
          const d = describeEvent(e);
          return (
            <li key={i} data-tool={e.name} className="flex gap-3 font-serif text-[14px] text-ink">
              <span aria-hidden="true" className={`font-mono ${d.ok ? "text-positive" : "text-clay-text"}`}>{d.ok ? "✓" : "✗"}</span>
              <span>
                {d.label}
                {d.detail && <span className={`block font-mono text-[11px] ${d.ok ? "text-ink-muted" : "text-clay-text"}`}>{d.detail}</span>}
              </span>
            </li>
          );
        })}
        <li className="flex gap-3 font-serif text-[14px] text-ink-muted">
          <span aria-hidden="true" className="animate-pulse font-mono text-gold-deep">●</span>
          <span>{events.length === 0 ? "Starting…" : "Working on the next step…"}</span>
        </li>
      </ol>
    </div>
  );
}
