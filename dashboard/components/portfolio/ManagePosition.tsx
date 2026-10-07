"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useExecute } from "@/lib/execute";
import type { ManageAction, ManagePreviewResponse } from "@/lib/manage";
import { Mono } from "../Mono";
import { AmountInput, parseAmount, tokenAmount, usd } from "../app/fields";
import { TxModal, type SummaryRow } from "../app/TxModal";

interface Leg {
  symbol: string;
  amount: string;
  valueUsd: string;
}

/**
 * Repay / Withdraw / Close for a real Vanilla Kamino obligation. Multiply positions don't get this — unwinding
 * one means reversing a flash loan and a swap, not a plain repay/withdraw, and is separate work.
 *
 * Same discipline as Borrow: a real preview (debounced /api/repay|withdraw|close-position with preview:true)
 * shown inline before anything opens the sign dialog, then the shared TxModal confirm → sign → submit flow.
 */
export function ManagePosition({ deposits, borrows, onChanged }: { obligationAddress: string; deposits: Leg[]; borrows: Leg[]; onChanged?: () => void }) {
  const [open, setOpen] = useState<ManageAction | null>(null);
  if (deposits.length === 0 && borrows.length === 0) return null;

  return (
    <div className="border-t border-line-soft px-5 py-3">
      <div className="flex flex-wrap gap-2">
        {borrows.length > 0 && (
          <button type="button" data-manage-open="repay" onClick={() => setOpen(open === "repay" ? null : "repay")} className={`cursor-pointer rounded-lg border px-4 py-2 font-mono text-[12px] ${open === "repay" ? "border-gold-deep bg-gold-tint text-gold-strong" : "border-line-strong bg-surface text-ink hover:border-gold-deep"}`}>
            Repay
          </button>
        )}
        {deposits.length > 0 && (
          <button type="button" data-manage-open="withdraw" onClick={() => setOpen(open === "withdraw" ? null : "withdraw")} className={`cursor-pointer rounded-lg border px-4 py-2 font-mono text-[12px] ${open === "withdraw" ? "border-gold-deep bg-gold-tint text-gold-strong" : "border-line-strong bg-surface text-ink hover:border-gold-deep"}`}>
            Withdraw
          </button>
        )}
        {deposits.length > 0 && borrows.length > 0 && (
          <button type="button" data-manage-open="close" onClick={() => setOpen(open === "close" ? null : "close")} className={`cursor-pointer rounded-lg border px-4 py-2 font-mono text-[12px] ${open === "close" ? "border-gold-deep bg-gold-tint text-gold-strong" : "border-line-strong bg-surface text-ink hover:border-gold-deep"}`}>
            Close position
          </button>
        )}
      </div>
      {open === "repay" && <RepayForm borrows={borrows} onChanged={onChanged} onDone={() => setOpen(null)} />}
      {open === "withdraw" && <WithdrawForm deposits={deposits} onChanged={onChanged} onDone={() => setOpen(null)} />}
      {open === "close" && <CloseForm deposits={deposits} borrows={borrows} onChanged={onChanged} onDone={() => setOpen(null)} />}
    </div>
  );
}

const fmtPct = (n: number) => `${n.toFixed(2)}`;

/** The simulated-slot / compute-units / key-logs footer, shared by all three forms. */
function SimFooter({ preview }: { preview: ManagePreviewResponse }) {
  if (!preview.simulation.ran) return null;
  return (
    <p className="m-0 mt-2 font-mono text-[11px] leading-normal text-ink-faint">
      Simulated on mainnet at slot {preview.simulation.slot}: {preview.simulation.success ? "succeeded" : "failed"}, {preview.simulation.unitsConsumed ?? "?"} compute units.
    </p>
  );
}

function RepayForm({ borrows, onChanged, onDone }: { borrows: Leg[]; onChanged?: () => void; onDone: () => void }) {
  const { publicKey } = useWallet();
  const wallet = publicKey?.toBase58() ?? null;
  const [asset, setAsset] = useState(borrows[0].symbol);
  const debt = borrows.find((b) => b.symbol === asset)!;
  const [amount, setAmount] = useState("");
  const [max, setMax] = useState(false);
  const [preview, setPreview] = useState<{ status: "idle" } | { status: "loading" } | { status: "ready"; data: ManagePreviewResponse } | { status: "error"; error: string }>({ status: "idle" });
  const [modal, setModal] = useState(false);
  const [snap, setSnap] = useState<ManagePreviewResponse | null>(null);
  const exec = useExecute(onChanged);

  const amountN = parseAmount(amount);
  const valid = wallet !== null && (max || (amountN !== null && amountN > 0));

  useEffect(() => {
    if (!valid) {
      const t = setTimeout(() => setPreview({ status: "idle" }), 0);
      return () => clearTimeout(t);
    }
    let live = true;
    const t = setTimeout(() => {
      setPreview({ status: "loading" });
      api<ManagePreviewResponse>("/api/repay", { json: { wallet, asset, amount: max ? "max" : amountN, preview: true } })
        .then((d) => live && setPreview({ status: "ready", data: d }))
        .catch((e: Error) => live && setPreview({ status: "error", error: e.message }));
    }, 600);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [valid, wallet, asset, max, amountN]);

  const p = preview.status === "ready" ? preview.data : null;
  const run = () => exec.execute(() => api("/api/repay", { json: { wallet, asset, amount: max ? "max" : amountN } }));

  return (
    <div className="mt-3 rounded-lg border border-line-soft bg-paper p-4" data-testid="repay-form">
      {borrows.length > 1 && (
        <div className="mb-3 flex gap-2">
          {borrows.map((b) => (
            <button key={b.symbol} type="button" onClick={() => setAsset(b.symbol)} className={`cursor-pointer rounded-md border px-3 py-1.5 font-mono text-[12px] ${asset === b.symbol ? "border-gold-deep bg-gold-tint text-gold-strong" : "border-line-strong text-ink"}`}>
              {b.symbol}
            </button>
          ))}
        </div>
      )}
      <AmountInput
        id="repay-amount" label={`REPAY ${asset}`} value={amount} onChange={(v) => { setAmount(v); setMax(false); }}
        token={asset}
        onMax={() => { setMax(true); setAmount(""); }}
        hint={
          max ? (
            <>Repaying the full debt: {tokenAmount(debt.amount, 6)} {asset} ({usd(Number(debt.valueUsd))}), plus a little for interest accrued by the time this lands.</>
          ) : (
            <>Real debt: {tokenAmount(debt.amount, 6)} {asset} ({usd(Number(debt.valueUsd))}). Repay any amount up to the full debt, or MAX for all of it.</>
          )
        }
      />
      {preview.status === "loading" && <p className="m-0 mt-2 font-mono text-[11px] text-ink-faint">Simulating on mainnet…</p>}
      {preview.status === "error" && <p className="m-0 mt-2 font-mono text-[11px] text-clay-text">{preview.error}</p>}
      {p && !p.valid && <p className="m-0 mt-2 font-mono text-[11px] text-clay-text" data-testid="repay-error">{p.problems[0]}</p>}
      {p?.valid && (
        <>
          <p className="m-0 mt-2 font-mono text-[11px] text-ink-muted">
            Projected health factor after: <Mono className="text-ink">{p.projectedHealthFactor !== null ? p.projectedHealthFactor.toFixed(2) : "no debt left"}</Mono>
            {p.projectedHealthFactorIsEstimate && " (estimate — the exact amount, with interest accrued since this was read, is resolved on-chain)"}
          </p>
          <SimFooter preview={p} />
        </>
      )}
      <div className="mt-3 flex gap-2">
        <button type="button" disabled={!p?.valid} onClick={() => { setSnap(p); setModal(true); }} data-testid="repay-submit" className="cursor-pointer rounded-lg bg-gold-deep px-5 py-2.5 font-mono text-[13px] font-medium text-gold-ink hover:bg-gold-text disabled:cursor-not-allowed disabled:bg-line-strong disabled:text-ink-muted">
          Repay
        </button>
        <button type="button" onClick={onDone} className="cursor-pointer rounded-lg border border-line-strong bg-surface px-5 py-2.5 font-mono text-[13px] text-ink">Cancel</button>
      </div>
      {snap && (
        <TxModal
          open={modal}
          title={`Repay ${max ? "the full" : tokenAmount(amount, 6)} ${asset} debt${max ? "" : ""} on this position.`}
          rows={rowsFor(snap)}
          simulation={{ projectedHealthFactor: snap.projectedHealthFactor, simulation: snap.simulation.ran ? { ran: true, slot: snap.simulation.slot, unitsConsumed: snap.simulation.unitsConsumed } : { ran: false } }}
          state={exec.state}
          onConfirm={run}
          onClose={() => { if (exec.state.step !== "building" && exec.state.step !== "signing" && exec.state.step !== "submitting") { setModal(false); exec.reset(); if (exec.state.step === "done" && exec.state.outcome.kind === "success") onDone(); } }}
        />
      )}
    </div>
  );
}

function WithdrawForm({ deposits, onChanged, onDone }: { deposits: Leg[]; onChanged?: () => void; onDone: () => void }) {
  const { publicKey } = useWallet();
  const wallet = publicKey?.toBase58() ?? null;
  const [asset, setAsset] = useState(deposits[0].symbol);
  const dep = deposits.find((d) => d.symbol === asset)!;
  const [amount, setAmount] = useState("");
  const [max, setMax] = useState(false);
  const [preview, setPreview] = useState<{ status: "idle" } | { status: "loading" } | { status: "ready"; data: ManagePreviewResponse } | { status: "error"; error: string }>({ status: "idle" });
  const [modal, setModal] = useState(false);
  const [snap, setSnap] = useState<ManagePreviewResponse | null>(null);
  const exec = useExecute(onChanged);

  const amountN = parseAmount(amount);
  const valid = wallet !== null && (max || (amountN !== null && amountN > 0));

  useEffect(() => {
    if (!valid) {
      const t = setTimeout(() => setPreview({ status: "idle" }), 0);
      return () => clearTimeout(t);
    }
    let live = true;
    const t = setTimeout(() => {
      setPreview({ status: "loading" });
      api<ManagePreviewResponse>("/api/withdraw", { json: { wallet, asset, amount: max ? "max" : amountN, preview: true } })
        .then((d) => live && setPreview({ status: "ready", data: d }))
        .catch((e: Error) => live && setPreview({ status: "error", error: e.message }));
    }, 600);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [valid, wallet, asset, max, amountN]);

  const p = preview.status === "ready" ? preview.data : null;
  const run = () => exec.execute(() => api("/api/withdraw", { json: { wallet, asset, amount: max ? "max" : amountN } }));

  return (
    <div className="mt-3 rounded-lg border border-line-soft bg-paper p-4" data-testid="withdraw-form">
      {deposits.length > 1 && (
        <div className="mb-3 flex gap-2">
          {deposits.map((d) => (
            <button key={d.symbol} type="button" onClick={() => setAsset(d.symbol)} className={`cursor-pointer rounded-md border px-3 py-1.5 font-mono text-[12px] ${asset === d.symbol ? "border-gold-deep bg-gold-tint text-gold-strong" : "border-line-strong text-ink"}`}>
              {d.symbol}
            </button>
          ))}
        </div>
      )}
      <AmountInput
        id="withdraw-amount" label={`WITHDRAW ${asset}`} value={amount} onChange={(v) => { setAmount(v); setMax(false); }}
        token={asset}
        onMax={() => { setMax(true); setAmount(""); }}
        hint={
          max ? (
            <>Withdrawing everything deposited: {tokenAmount(dep.amount, 8)} {asset} ({usd(Number(dep.valueUsd))}).</>
          ) : (
            <>Deposited: {tokenAmount(dep.amount, 8)} {asset} ({usd(Number(dep.valueUsd))}). Withdrawing collateral while debt remains lowers your health factor, and Kamino refuses anything that would make the position unsafe.</>
          )
        }
      />
      {preview.status === "loading" && <p className="m-0 mt-2 font-mono text-[11px] text-ink-faint">Simulating on mainnet…</p>}
      {preview.status === "error" && <p className="m-0 mt-2 font-mono text-[11px] text-clay-text">{preview.error}</p>}
      {p && !p.valid && <p className="m-0 mt-2 font-mono text-[11px] text-clay-text" data-testid="withdraw-error">{p.problems[0]}</p>}
      {p?.valid && (
        <>
          <p className="m-0 mt-2 font-mono text-[11px] text-ink-muted">
            Projected health factor after: <Mono className="text-ink">{p.projectedHealthFactor !== null ? p.projectedHealthFactor.toFixed(2) : "no debt left"}</Mono>
            {p.projectedHealthFactorIsEstimate && " (estimate)"}
          </p>
          <SimFooter preview={p} />
        </>
      )}
      <div className="mt-3 flex gap-2">
        <button type="button" disabled={!p?.valid} onClick={() => { setSnap(p); setModal(true); }} data-testid="withdraw-submit" className="cursor-pointer rounded-lg bg-gold-deep px-5 py-2.5 font-mono text-[13px] font-medium text-gold-ink hover:bg-gold-text disabled:cursor-not-allowed disabled:bg-line-strong disabled:text-ink-muted">
          Withdraw
        </button>
        <button type="button" onClick={onDone} className="cursor-pointer rounded-lg border border-line-strong bg-surface px-5 py-2.5 font-mono text-[13px] text-ink">Cancel</button>
      </div>
      {snap && (
        <TxModal
          open={modal}
          title={`Withdraw ${max ? "all of your" : tokenAmount(amount, 8)} ${asset} collateral from this position.`}
          rows={rowsFor(snap)}
          simulation={{ projectedHealthFactor: snap.projectedHealthFactor, simulation: snap.simulation.ran ? { ran: true, slot: snap.simulation.slot, unitsConsumed: snap.simulation.unitsConsumed } : { ran: false } }}
          state={exec.state}
          onConfirm={run}
          onClose={() => { if (exec.state.step !== "building" && exec.state.step !== "signing" && exec.state.step !== "submitting") { setModal(false); exec.reset(); if (exec.state.step === "done" && exec.state.outcome.kind === "success") onDone(); } }}
        />
      )}
    </div>
  );
}

function CloseForm({ deposits, borrows, onChanged, onDone }: { deposits: Leg[]; borrows: Leg[]; onChanged?: () => void; onDone: () => void }) {
  const { publicKey } = useWallet();
  const wallet = publicKey?.toBase58() ?? null;
  const collateralAsset = deposits[0].symbol;
  const debtAsset = borrows[0].symbol;
  const [preview, setPreview] = useState<{ status: "idle" } | { status: "loading" } | { status: "ready"; data: ManagePreviewResponse } | { status: "error"; error: string }>({ status: "idle" });
  const [modal, setModal] = useState(false);
  const [snap, setSnap] = useState<ManagePreviewResponse | null>(null);
  const exec = useExecute(onChanged);

  useEffect(() => {
    if (!wallet) return;
    let live = true;
    // Reset to "loading" for this position. Done in a microtask, which still runs before any network reply can arrive, so the
    // effect body itself does not set state synchronously.
    Promise.resolve().then(() => live && setPreview({ status: "loading" }));
    api<ManagePreviewResponse>("/api/close-position", { json: { wallet, collateralAsset, debtAsset, preview: true } })
      .then((d) => live && setPreview({ status: "ready", data: d }))
      .catch((e: Error) => live && setPreview({ status: "error", error: e.message }));
    return () => {
      live = false;
    };
  }, [wallet, collateralAsset, debtAsset]);

  const p = preview.status === "ready" ? preview.data : null;
  const run = () => exec.execute(() => api("/api/close-position", { json: { wallet, collateralAsset, debtAsset } }));

  return (
    <div className="mt-3 rounded-lg border border-line-soft bg-paper p-4" data-testid="close-form">
      <p className="m-0 font-serif text-[13px] leading-normal text-ink-muted">
        Repays the full {debtAsset} debt and withdraws the full {collateralAsset} collateral, as one transaction, one signature.
      </p>
      <p className="m-0 mt-2 font-mono text-[11px] leading-normal text-clay-text">
        This does not reclaim this position&apos;s own rent. Kamino&apos;s lending program has no instruction to close the obligation account itself, so the ~0.018 SOL locked in it stays locked on this wallet&apos;s obligation after this, even once it has no collateral or debt left.
      </p>
      {preview.status === "loading" && <p className="m-0 mt-2 font-mono text-[11px] text-ink-faint">Simulating on mainnet…</p>}
      {preview.status === "error" && <p className="m-0 mt-2 font-mono text-[11px] text-clay-text">{preview.error}</p>}
      {p && !p.valid && <p className="m-0 mt-2 font-mono text-[11px] text-clay-text" data-testid="close-error">{p.problems[0]}</p>}
      {p?.valid && <SimFooter preview={p} />}
      <div className="mt-3 flex gap-2">
        <button type="button" disabled={!p?.valid} onClick={() => { setSnap(p); setModal(true); }} data-testid="close-submit" className="cursor-pointer rounded-lg bg-gold-deep px-5 py-2.5 font-mono text-[13px] font-medium text-gold-ink hover:bg-gold-text disabled:cursor-not-allowed disabled:bg-line-strong disabled:text-ink-muted">
          Close position
        </button>
        <button type="button" onClick={onDone} className="cursor-pointer rounded-lg border border-line-strong bg-surface px-5 py-2.5 font-mono text-[13px] text-ink">Cancel</button>
      </div>
      {snap && (
        <TxModal
          open={modal}
          title={`Repay the full ${debtAsset} debt and withdraw the full ${collateralAsset} collateral on this position.`}
          rows={rowsFor(snap)}
          simulation={{ projectedHealthFactor: null, simulation: snap.simulation.ran ? { ran: true, slot: snap.simulation.slot, unitsConsumed: snap.simulation.unitsConsumed } : { ran: false } }}
          state={exec.state}
          onConfirm={run}
          onClose={() => { if (exec.state.step !== "building" && exec.state.step !== "signing" && exec.state.step !== "submitting") { setModal(false); exec.reset(); if (exec.state.step === "done" && exec.state.outcome.kind === "success") onDone(); } }}
        />
      )}
    </div>
  );
}

function rowsFor(p: ManagePreviewResponse): SummaryRow[] {
  const rows: SummaryRow[] = [];
  if (p.simulation.ran) {
    rows.push({ label: "Simulated compute units", value: p.simulation.unitsConsumed ?? "?" });
  }
  if (p.projectedHealthFactor !== null) {
    rows.push({ label: "Projected health factor", value: `${fmtPct(p.projectedHealthFactor)}${p.projectedHealthFactorIsEstimate ? " (est.)" : ""}` });
  }
  return rows;
}
