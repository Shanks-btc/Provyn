"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { useReserves, usePosition, useSimulation, type StrategyInput } from "@/lib/api";
import { useExecute } from "@/lib/execute";
import { borrowApyLabel, checkedAtLabel, market } from "@/lib/market";
import { AmountInput, StatRow, parseAmount, tokenAmount, usd } from "../app/fields";
import { Notice } from "../app/AppShell";
import { BuyAsset } from "../app/BuyAsset";
import { HF_BLOCK, HF_WARN, SimulationPanel } from "../app/SimulationPanel";
import { TxModal, type SummaryRow } from "../app/TxModal";
import { ConnectWalletButton } from "../wallet/ConnectWalletButton";

// Only the three assets Provyn has verified end to end — deliberately not a dropdown of everything listed.
const ASSETS = ["AAPLx", "SPYx", "TSLAx"] as const;
type Asset = (typeof ASSETS)[number];

const floorTo = (n: number, dp: number) => (Math.floor(n * 10 ** dp) / 10 ** dp).toString();

export function BorrowForm() {
  const { publicKey } = useWallet();
  const wallet = publicKey?.toBase58() ?? null;

  // The wizard hands over the agent's recommendation as ?asset=&supply=&borrow= (all optional, all validated here).
  const params = useSearchParams();
  const fromUrl = params.get("asset");
  const [asset, setAsset] = useState<Asset>(() => (ASSETS as readonly string[]).includes(fromUrl ?? "") ? (fromUrl as Asset) : "AAPLx");
  const amountParam = (k: string) => { const v = params.get(k); return v && /^\d*\.?\d+$/.test(v) && Number(v) > 0 ? v : ""; };
  const [supply, setSupply] = useState(() => amountParam("supply"));
  const [borrow, setBorrow] = useState(() => amountParam("borrow"));
  const [modal, setModal] = useState(false);

  const reserves = useReserves();
  const position = usePosition(wallet);
  const exec = useExecute(position.reload);

  const reserve = reserves.status === "ready" ? reserves.data.reserves.find((r) => r.symbol === asset) : undefined;
  const price = reserve ? Number(reserve.oraclePriceUsd) : null;
  const ltv = reserve?.loanToValuePct ?? null;
  const liq = reserve?.liquidationThresholdPct ?? null;

  const spot = position.status === "ready" ? position.data.walletBalances.find((b) => b.symbol === asset)?.amount ?? "0" : null;
  const existing = position.status === "ready" ? position.data.obligations.find((o) => o.type === "Vanilla") : undefined;

  const supplyN = parseAmount(supply);
  const borrowN = parseAmount(borrow);
  const collateralUsd = supplyN !== null && price !== null ? supplyN * price : null;
  const maxBorrow = collateralUsd !== null && ltv !== null ? Math.floor(collateralUsd * (ltv / 100) * 100) / 100 : null;
  const overSpot = supplyN !== null && spot !== null && supplyN > Number(spot);
  const overLtv = borrowN !== null && maxBorrow !== null && borrowN > maxBorrow;
  const currentLtv = borrowN !== null && collateralUsd ? (borrowN / collateralUsd) * 100 : null;

  const inputsOk = wallet && supplyN !== null && borrowN !== null && !overSpot && !overLtv && reserve;
  const strategy: StrategyInput | null = inputsOk
    ? { strategyType: "borrow", newDepositSymbol: asset, newDepositAmount: supplyN!, borrowSymbol: "USDC", borrowAmount: borrowN! }
    : null;
  const sim = useSimulation(wallet, strategy);

  const result = sim.status === "done" ? sim.result : null;
  const hf = result?.projectedHealthFactor ?? null;
  const simOk = !!result?.valid;
  const blockedByHf = hf !== null && hf < HF_BLOCK;

  const summary: SummaryRow[] = [
    { label: "Deposit as collateral", value: `${tokenAmount(supply, 8)} ${asset}` },
    { label: "Collateral value", value: collateralUsd !== null ? usd(collateralUsd) : ", " },
    { label: "Borrow", value: `${tokenAmount(borrow, 6)} USDC` },
    { label: "Borrow APY (last check)", value: borrowApyLabel },
    { label: "Liquidation threshold", value: liq !== null ? `${liq}%` : ", " },
  ];

  const busy = exec.state.step === "building" || exec.state.step === "signing" || exec.state.step === "submitting";
  const closeModal = () => {
    if (busy) return;
    if (exec.state.step === "done" && exec.state.outcome.kind === "success") {
      setSupply("");
      setBorrow("");
    }
    setModal(false);
    exec.reset();
  };

  const action = (() => {
    if (!wallet) return <ConnectWalletButton size="hero">Connect vault to borrow</ConnectWalletButton>;
    const label = (text: string, enabled: boolean) => (
      <button
        type="button"
        disabled={!enabled}
        onClick={() => setModal(true)}
        className="w-full cursor-pointer rounded-lg border border-transparent bg-gold-deep px-7 py-[15px] font-mono text-[15px] font-medium text-gold-ink hover:bg-gold-text disabled:cursor-not-allowed disabled:bg-line-strong disabled:text-ink-muted"
      >
        {text}
      </button>
    );
    if (!strategy) return label("Enter collateral and borrow amounts", false);
    if (sim.status === "idle" || sim.status === "running") return label("Simulating on mainnet…", false);
    if (sim.status === "error" || !simOk) return label("Simulation failed, cannot proceed", false);
    if (blockedByHf) return label("Health factor too low", false);
    return label("Initialize Borrow Position", true);
  })();

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)] lg:gap-8">
      <section aria-labelledby="borrow-form-title" className="rounded-[10px] border border-line bg-surface p-5 md:p-7">
        <h2 id="borrow-form-title" className="sr-only">
          Borrow USDC against an xStock
        </h2>

        <div className="mb-6">
          <div className="mb-2 font-mono text-[11px] tracking-[0.04em] text-ink-muted">COLLATERAL ASSET</div>
          <div role="radiogroup" aria-label="Collateral asset" className="flex flex-wrap gap-2">
            {ASSETS.map((a) => (
              <button
                key={a}
                type="button"
                role="radio"
                aria-checked={asset === a}
                onClick={() => {
                  setAsset(a);
                  setSupply("");
                  setBorrow("");
                }}
                className={`cursor-pointer rounded-lg border px-4 py-2 font-mono text-[14px] ${asset === a ? "border-gold-deep bg-gold-tint text-gold-strong" : "border-line-strong bg-surface text-ink hover:border-gold-deep"}`}
              >
                {a}
              </button>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap items-baseline gap-x-2 font-mono text-[12px] text-ink-muted" data-testid="price">
            {reserves.status === "loading" && <span>Loading Kamino oracle price…</span>}
            {reserves.status === "error" && <span className="text-clay-text">Price unavailable: {reserves.error}</span>}
            {price !== null && (
              <>
                <span>{asset} price</span>
                <span className="text-[15px] text-ink">{usd(price)}</span>
                <span className="text-ink-faint">· Kamino oracle, live</span>
              </>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-5">
          <AmountInput
            id="supply"
            label="SUPPLY COLLATERAL"
            value={supply}
            onChange={setSupply}
            token={asset}
            disabled={!wallet}
            invalid={overSpot}
            onMax={spot !== null && Number(spot) > 0 ? () => setSupply(spot) : undefined}
            hint={
              !wallet
                ? "Connect a wallet to see your balance."
                : spot === null
                  ? "Reading your balance…"
                  : overSpot
                    ? <span className="text-clay-text">More than your depositable balance of {tokenAmount(spot, 8)} {asset}.</span>
                    : <>Balance: {tokenAmount(spot, 8)} {asset} <span className="text-ink-faint">(raw units, what Kamino can actually deposit; your wallet may display slightly more for xStocks)</span></>
            }
          />
          <BuyAsset symbols={[asset]} className="-mt-3" />
          <AmountInput
            id="borrow"
            label="BORROW USDC"
            value={borrow}
            onChange={setBorrow}
            token="USDC"
            disabled={!wallet}
            invalid={overLtv}
            onMax={maxBorrow !== null && maxBorrow > 0 ? () => setBorrow(floorTo(maxBorrow, 2)) : undefined}
            maxLabel="MAX LTV"
            hint={
              overLtv ? (
                <span className="text-clay-text">Above the {ltv}% loan-to-value limit for {asset} (max {maxBorrow !== null ? usd(maxBorrow) : ", "} for this collateral).</span>
              ) : ltv !== null ? (
                <>Up to {ltv}% of collateral value{maxBorrow !== null && maxBorrow > 0 ? ` (${usd(maxBorrow)})` : ""}. Borrowing right up to the limit leaves almost no room before liquidation.</>
              ) : (
                ", "
              )
            }
          />
        </div>

        {existing && (
          <div className="mt-5">
            <Notice tone="gold">
              This wallet already has a Vanilla Kamino position ({existing.deposits.map((d) => d.symbol).join(", ") || "no collateral"} deposited, health factor{" "}
              {existing.healthFactor ? Number(existing.healthFactor).toFixed(2) : "n/a"}). What you borrow here is added to that same position, and the projected health factor below accounts for it.
            </Notice>
          </div>
        )}

        {position.status === "error" && <div className="mt-5"><Notice tone="clay">Could not read your position: {position.error}</Notice></div>}

        <div className="mt-6" data-testid="simulation">
          <SimulationPanel state={sim.status} result={result} error={sim.status === "error" ? sim.error : null} hf={hf} blocked={blockedByHf} />
        </div>

        <div className="mt-6">{action}</div>
        <p className="mb-0 mt-3 font-mono text-[11px] leading-normal text-ink-faint">
          Real mainnet funds. Nothing is signed until you approve it in your wallet, and Provyn never holds your keys.
        </p>
      </section>

      <aside aria-label="Position summary" className="self-start overflow-hidden rounded-[10px] border border-line bg-surface">
        <div className="border-b border-line bg-paper-raised px-5 py-3 font-mono text-[10px] tracking-[0.04em] text-ink-faint">POSITION SUMMARY</div>
        <StatRow label="Collateral" value={collateralUsd !== null ? `${usd(collateralUsd)}` : ", "} tone={collateralUsd !== null ? "ink" : "muted"} note={supplyN !== null ? `${tokenAmount(supply, 8)} ${asset}` : undefined} />
        <StatRow label="Loan" value={borrowN !== null ? usd(borrowN) : ", "} tone={borrowN !== null ? "ink" : "muted"} note={borrowN !== null ? "USDC" : undefined} />
        <StatRow label="LTV" value={currentLtv !== null ? `${currentLtv.toFixed(2)}%` : ", "} tone={currentLtv !== null ? "ink" : "muted"} note={ltv !== null ? `Max ${ltv}%` : undefined} />
        <StatRow label="Liq. LTV" value={liq !== null ? `${liq}%` : ", "} tone={liq !== null ? "ink" : "muted"} note="Liquidation threshold" />
        <StatRow label="Rate" value={`${borrowApyLabel} APY`} note={`Floating · USDC borrow, as of ${checkedAtLabel()}`} />
        <StatRow label="Projected health factor" value={hf !== null ? hf.toFixed(2) : ", "} tone={hf === null ? "muted" : hf < HF_WARN ? "clay" : "ink"} note={hf !== null ? "From the simulated transaction" : "Appears after simulation"} />
        <StatRow label="Network" value="Solana" note={`Kamino xStocks market ${market.market.slice(0, 4)}…${market.market.slice(-4)}`} />
      </aside>

      {result && (
        <TxModal open={modal} title={`Deposit ${tokenAmount(supply, 8)} ${asset} and borrow ${tokenAmount(borrow, 6)} USDC.`} rows={summary} simulation={result} state={exec.state} onConfirm={() => strategy && exec.run(strategy)} onClose={closeModal} />
      )}
    </div>
  );
}
