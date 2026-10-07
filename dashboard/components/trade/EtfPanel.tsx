"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { useState } from "react";
import { useLoad, usePosition, useReserves, useSimulation, type AssetCapabilities, type StrategyInput } from "@/lib/api";
import { useExecute } from "@/lib/execute";
import { DEFAULT_LEVERAGE, MULTIPLY_ASSETS, maxLeverageFor, type MultiplyAsset } from "@/lib/multiply";
import { HF_BLOCK } from "../app/SimulationPanel";
import { parseAmount, tokenAmount, usd } from "../app/fields";
import { TxModal, type SummaryRow } from "../app/TxModal";
import { ConnectWalletButton } from "../wallet/ConnectWalletButton";

/**
 * Trade → ETF tab. A presentation of the existing real Multiply flow: the same /api/capabilities stats, the same
 * useSimulation → useExecute → TxModal pipeline and the same StrategyInput as /earn/multiply (MultiplyDetail). No
 * separate build or signing logic lives here. Leverage is the shared DEFAULT_LEVERAGE (lib/multiply.ts).
 */

/** One product card: real default leverage as the title, real market stats as separate, labeled context. */
function EtfCard({ asset, onOpen }: { asset: MultiplyAsset; onOpen: () => void }) {
  const caps = useLoad<AssetCapabilities>(`/api/capabilities?asset=${asset}`);
  const live = caps.status === "ready" ? caps.data : null;
  const ok = live?.multiply.supported === true;
  const avg = live?.multiply.avgLeverage ? `${Number(live.multiply.avgLeverage).toFixed(2)}x` : caps.status === "error" ? "n/a" : "…";
  const positions = live ? live.multiply.liveObligations ?? "0" : caps.status === "error" ? "n/a" : "…";
  return (
    <button type="button" data-etf-card={asset} onClick={onOpen} disabled={caps.status === "ready" && !ok} className="w-full cursor-pointer rounded-lg border border-term-control bg-term-surface p-4 text-left hover:border-gold focus-visible:outline focus-visible:outline-1 focus-visible:outline-gold disabled:cursor-not-allowed disabled:opacity-60">
      <div className="font-serif text-[20px] text-term-text">
        {DEFAULT_LEVERAGE.toFixed(1)}x {asset}
      </div>
      <div className="mt-1 font-mono text-[11px] leading-normal text-term-muted">What you open: {DEFAULT_LEVERAGE.toFixed(1)}x Kamino Multiply on {asset} by default.</div>
      <div className="mt-3 border-t border-term-line pt-2.5 font-mono text-[11px] text-term-faint">
        <div className="mb-1 tracking-[0.04em]">CURRENT MARKET ACTIVITY</div>
        <div className="flex justify-between"><span>Open positions</span><span className="text-term-text">{positions}</span></div>
        <div className="flex justify-between"><span>Avg leverage (all users)</span><span className="text-term-text">{avg}</span></div>
      </div>
    </button>
  );
}

/** Deposit → simulate → confirm → sign, via the same hooks MultiplyDetail uses. */
function EtfOpen({ asset, onBack }: { asset: MultiplyAsset; onBack: () => void }) {
  const { publicKey } = useWallet();
  const wallet = publicKey?.toBase58() ?? null;
  const [deposit, setDeposit] = useState("");
  const [modal, setModal] = useState(false);
  const reserves = useReserves();
  const caps = useLoad<AssetCapabilities>(`/api/capabilities?asset=${asset}`);
  const position = usePosition(wallet);
  const exec = useExecute(position.reload);

  const reserve = reserves.status === "ready" ? reserves.data.reserves.find((r) => r.symbol === asset) : undefined;
  const price = reserve ? Number(reserve.oraclePriceUsd) : null;
  const lev = Math.min(DEFAULT_LEVERAGE, maxLeverageFor(reserve?.loanToValuePct ?? null));
  const multiplyOk = caps.status === "ready" && caps.data.multiply.supported === true;

  const spot = position.status === "ready" ? position.data.walletBalances.find((b) => b.symbol === asset)?.amount ?? "0" : null;
  const depositN = parseAmount(deposit);
  const overSpot = depositN !== null && spot !== null && depositN > Number(spot);
  const depositUsd = depositN !== null && price !== null ? depositN * price : null;

  const strategy: StrategyInput | null =
    wallet && depositN !== null && !overSpot && multiplyOk ? { strategyType: "multiply", newDepositSymbol: asset, newDepositAmount: depositN, targetLeverage: Number(lev.toFixed(2)) } : null;
  const sim = useSimulation(wallet, strategy, 900);
  const result = sim.status === "done" ? sim.result : null;
  const hf = result?.projectedHealthFactor ?? null;
  const simOk = !!result?.valid;
  const blockedByHf = hf !== null && hf < HF_BLOCK;

  const rows: SummaryRow[] = [
    { label: "Deposit", value: `${tokenAmount(deposit, 8)} ${asset}` },
    { label: "Target leverage", value: `${lev.toFixed(2)}x` },
    { label: "Total exposure", value: depositUsd !== null ? usd(depositUsd * lev) : ", " },
    { label: "USDC debt taken on", value: depositUsd !== null ? usd(depositUsd * (lev - 1)) : ", " },
  ];
  const busy = exec.state.step === "building" || exec.state.step === "signing" || exec.state.step === "submitting";
  const closeModal = () => {
    if (busy) return;
    if (exec.state.step === "done" && exec.state.outcome.kind === "success") setDeposit("");
    setModal(false);
    exec.reset();
  };
  const btn = (text: string, enabled: boolean) => (
    <button type="button" disabled={!enabled} onClick={() => setModal(true)} className="w-full cursor-pointer rounded-lg bg-gold px-4 py-3 font-mono text-[13px] font-medium text-gold-ink hover:bg-[#eec468] disabled:cursor-not-allowed disabled:opacity-50">
      {text}
    </button>
  );
  const action = !wallet ? <ConnectWalletButton size="block" tone="dark" />
    : !multiplyOk ? btn(caps.status === "loading" ? "Checking Multiply…" : "Multiply unavailable", false)
    : !strategy ? btn("Enter a deposit amount", false)
    : sim.status === "idle" || sim.status === "running" ? btn("Simulating on mainnet…", false)
    : sim.status === "error" || !simOk ? btn("Simulation failed", false)
    : blockedByHf ? btn("Health factor too low", false)
    : btn(`Open ${lev.toFixed(1)}x ${asset}`, true);

  return (
    <div className="flex flex-col gap-4 px-5 pt-5">
      <button type="button" onClick={onBack} className="w-fit cursor-pointer border-none bg-transparent p-0 font-mono text-[11px] text-term-faint hover:text-term-text">← All ETFs</button>
      <div className="font-serif text-[20px] text-term-text">{lev.toFixed(1)}x {asset}</div>
      <div>
        <label htmlFor="etf-deposit" className="font-mono text-[10px] text-term-faint">DEPOSIT {asset.toUpperCase()}</label>
        <input id="etf-deposit" inputMode="decimal" value={deposit} disabled={!wallet || !multiplyOk} onChange={(e) => setDeposit(e.target.value.replace(/[^0-9.]/g, "").slice(0, 12))} placeholder="0.00" className="mt-1.5 w-full rounded-lg border border-term-control bg-transparent px-3.5 py-3 font-mono text-[14px] text-term-text focus:border-gold focus:outline-none disabled:opacity-60" />
        <div className="mt-1.5 font-mono text-[11px] text-term-faint">
          {!wallet ? "Connect a wallet to see your balance." : spot === null ? "Reading your balance…" : overSpot ? <span className="text-clay">More than your balance of {tokenAmount(spot, 8)} {asset}.</span> : `Balance: ${tokenAmount(spot, 8)} ${asset}`}
        </div>
      </div>
      {depositUsd !== null && <div className="font-mono text-[11px] text-term-muted">Exposure {usd(depositUsd * lev)} · USDC debt {usd(depositUsd * (lev - 1))}{hf !== null ? ` · HF ${hf.toFixed(2)}` : ""}</div>}
      {action}
      <p className="m-0 font-mono text-[10px] leading-normal text-term-faint">Real mainnet funds, via Kamino Multiply (Kamino manages the leverage, not Provyn). Simulated before you sign.</p>
      <p className="m-0 font-mono text-[11px] leading-normal text-term-text" data-testid="etf-close-note">Provyn can&apos;t close Multiply positions yet. Close it in Kamino&apos;s app.</p>
      {result && <TxModal open={modal} title={`Open a ${lev.toFixed(1)}x ${asset} Multiply position with ${tokenAmount(deposit, 8)} ${asset}.`} rows={rows} simulation={result} state={exec.state} onConfirm={() => strategy && exec.run(strategy)} onClose={closeModal} />}
    </div>
  );
}

export function EtfPanel({ asset, onPick, className = "" }: { asset: MultiplyAsset | null; onPick: (a: MultiplyAsset | null) => void; className?: string }) {
  return (
    <div className={`flex flex-col border-b border-term-line pb-5 lg:overflow-y-auto lg:border-b-0 ${className}`} data-testid="etf-panel">
      {asset ? (
        <EtfOpen asset={asset} onBack={() => onPick(null)} />
      ) : (
        <div className="flex flex-col gap-3 px-5 pt-5">
          {MULTIPLY_ASSETS.map((a) => <EtfCard key={a} asset={a} onOpen={() => onPick(a)} />)}
          <p className="m-0 font-mono text-[10px] leading-normal text-term-faint">AAPLx has no live Multiply market on Kamino, so it isn&apos;t offered.</p>
        </div>
      )}
    </div>
  );
}
