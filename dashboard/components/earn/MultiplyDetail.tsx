"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { useState } from "react";
import { useLoad, usePosition, useReserves, useSimulation, type AssetCapabilities, type StrategyInput } from "@/lib/api";
import { useExecute } from "@/lib/execute";
import { borrowApyLabel, checkedAtLabel, market } from "@/lib/market";
import { Mono } from "../Mono";
import { Notice } from "../app/AppShell";
import { BuyAsset } from "../app/BuyAsset";
import { HF_BLOCK, HF_WARN, SimulationPanel } from "../app/SimulationPanel";
import { AmountInput, StatRow, parseAmount, tokenAmount, usd } from "../app/fields";
import { TxModal, type SummaryRow } from "../app/TxModal";
import { DEFAULT_LEVERAGE, HARD_CAP, MIN_LEVERAGE, MULTIPLY_ASSETS, maxLeverageFor, type MultiplyAsset } from "@/lib/multiply";
import { ConnectWalletButton } from "../wallet/ConnectWalletButton";
import { ContractAddresses, COUNTERPARTIES, Counterparties, DetailSection, Faq, FlowDiagram, HeroStat, ProcessList, RiskList } from "./Detail";
import { VaultOverview } from "./VaultOverview";

const ASSETS = MULTIPLY_ASSETS;
type Asset = MultiplyAsset;

const N = ({ children }: { children: React.ReactNode }) => <Mono className="text-[0.92em] text-ink">{children}</Mono>;

export function MultiplyDetail() {
  const { publicKey } = useWallet();
  const wallet = publicKey?.toBase58() ?? null;
  // The wizard hands over the agent's recommendation as ?asset=&deposit=&leverage= (all optional, validated here).
  const params = useSearchParams();
  const fromUrl = params.get("asset");
  const [asset, setAsset] = useState<Asset>(() => (ASSETS as readonly string[]).includes(fromUrl ?? "") ? (fromUrl as Asset) : "SPYx");
  const numParam = (k: string) => { const v = params.get(k); return v && /^\d*\.?\d+$/.test(v) && Number(v) > 0 ? v : ""; };
  const [deposit, setDeposit] = useState(() => numParam("deposit"));
  const [leverage, setLeverage] = useState(() => { const v = Number(numParam("leverage")); return v >= MIN_LEVERAGE && v <= HARD_CAP ? v : DEFAULT_LEVERAGE; });
  const [modal, setModal] = useState(false);

  const reserves = useReserves();
  const caps = useLoad<AssetCapabilities>(`/api/capabilities?asset=${asset}`);
  const position = usePosition(wallet);
  const exec = useExecute(position.reload);

  const reserve = reserves.status === "ready" ? reserves.data.reserves.find((r) => r.symbol === asset) : undefined;
  const price = reserve ? Number(reserve.oraclePriceUsd) : null;
  const liq = reserve?.liquidationThresholdPct ?? null;
  const ltv = reserve?.loanToValuePct ?? null;
  const maxLeverage = maxLeverageFor(ltv);
  const lev = Math.min(leverage, maxLeverage);

  const live = caps.status === "ready" ? caps.data : null;
  const multiplyOk = live?.multiply.supported === true;

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
    { label: "Liquidation threshold", value: liq !== null ? `${liq}%` : ", " },
    { label: "USDC borrow APY (last check)", value: borrowApyLabel },
  ];

  const busy = exec.state.step === "building" || exec.state.step === "signing" || exec.state.step === "submitting";
  const closeModal = () => {
    if (busy) return;
    if (exec.state.step === "done" && exec.state.outcome.kind === "success") setDeposit("");
    setModal(false);
    exec.reset();
  };

  const button = (text: string, enabled: boolean) => (
    <button type="button" disabled={!enabled} onClick={() => setModal(true)} className="w-full cursor-pointer rounded-lg border border-transparent bg-gold-deep px-7 py-[15px] font-mono text-[15px] font-medium text-gold-ink hover:bg-gold-text disabled:cursor-not-allowed disabled:bg-line-strong disabled:text-ink-muted">
      {text}
    </button>
  );
  const action = !wallet ? (
    <ConnectWalletButton size="hero">Connect vault to open a position</ConnectWalletButton>
  ) : !multiplyOk ? button(caps.status === "loading" ? "Checking Multiply availability…" : "Multiply unavailable", false)
    : !strategy ? button("Enter a deposit amount", false)
    : sim.status === "idle" || sim.status === "running" ? button("Simulating on mainnet…", false)
    : sim.status === "error" || !simOk ? button("Simulation failed, cannot proceed", false)
    : blockedByHf ? button("Health factor too low", false)
    : button("Open Multiply position", true);

  return (
    <>
      <div role="radiogroup" aria-label="Multiply asset" className="mb-6 flex flex-wrap items-center gap-2">
        {ASSETS.map((a) => (
          <button key={a} type="button" role="radio" aria-checked={asset === a} onClick={() => { setAsset(a); setDeposit(""); }} className={`cursor-pointer rounded-lg border px-4 py-2 font-mono text-[14px] ${asset === a ? "border-gold-deep bg-gold-tint text-gold-strong" : "border-line-strong bg-surface text-ink hover:border-gold-deep"}`}>
            {a}
          </button>
        ))}
        <span className="font-mono text-[11px] text-ink-faint">AAPLx has no live Multiply market on Kamino, so it isn&apos;t offered.</span>
      </div>

      <div className="mb-4 grid gap-4 md:grid-cols-3" data-testid="multiply-stats">
        <HeroStat label={`LIVE ${asset} MULTIPLY POSITIONS`} value={live ? live.multiply.liveObligations ?? "0" : caps.status === "error" ? "n/a" : "…"} note="Open Multiply obligations on Kamino, right now." />
        <HeroStat label="AVERAGE LEVERAGE" value={live?.multiply.avgLeverage ? `${Number(live.multiply.avgLeverage).toFixed(2)}x` : caps.status === "error" ? "n/a" : "…"} tone="gold" note="Across those positions, Kamino's figure, not Provyn's." />
        <HeroStat label="TOTAL VALUE IN THESE POSITIONS" value={live?.multiply.tvlUsd ? usd(Number(live.multiply.tvlUsd)) : caps.status === "error" ? "n/a" : "…"} note={live ? `Live from Kamino${live.dataSource === "cache" ? " (cached, live call failed)" : ""}.` : undefined} />
      </div>
      {caps.status === "error" && <Notice tone="clay">Could not load live Multiply stats: {caps.error}</Notice>}
      {live && !multiplyOk && <Notice tone="clay">{live.multiply.reason}</Notice>}

      <div className="mt-4">
        <Notice tone="gold">
          <strong>Whose rebalancing is this?</strong> Kamino&apos;s own managed rebalancing, not something Provyn built. Provyn prepares and simulates the transaction that opens your position and you sign it; after that, the leverage is Kamino&apos;s
          to manage, not Provyn&apos;s.
        </Notice>
      </div>

      <DetailSection id="open" title="Open a position">
        <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)] lg:gap-8">
          <div className="rounded-[10px] border border-line bg-surface p-5 md:p-7">
            <div className="flex flex-col gap-5">
              <AmountInput
                id="mdeposit" label={`DEPOSIT ${asset.toUpperCase()}`} value={deposit} onChange={setDeposit} token={asset}
                disabled={!wallet || !multiplyOk} invalid={overSpot}
                onMax={spot !== null && Number(spot) > 0 ? () => setDeposit(spot) : undefined}
                hint={!wallet ? "Connect a wallet to see your balance." : spot === null ? "Reading your balance…" : overSpot ? <span className="text-clay-text">More than your depositable balance of {tokenAmount(spot, 8)} {asset}.</span> : <>Balance: {tokenAmount(spot, 8)} {asset} <span className="text-ink-faint">(raw units)</span></>}
              />
              <BuyAsset symbols={[asset]} next="multiply" className="-mt-3" />
              <div>
                <label htmlFor="mlev" className="mb-2 flex items-baseline justify-between font-mono text-[11px] tracking-[0.04em] text-ink-muted">
                  <span>TARGET LEVERAGE</span>
                  <span className="text-[16px] text-ink" data-testid="lev-value">{lev.toFixed(1)}x</span>
                </label>
                <input id="mlev" type="range" min={MIN_LEVERAGE} max={maxLeverage} step={0.1} value={lev} disabled={!wallet || !multiplyOk} onChange={(e) => setLeverage(Number(e.target.value))} className="w-full accent-gold-deep" />
                <div className="mt-1 flex justify-between font-mono text-[11px] text-ink-faint"><span>{MIN_LEVERAGE.toFixed(1)}x</span><span>max offered {maxLeverage.toFixed(1)}x</span></div>
                <p className="mb-0 mt-2 font-mono text-[11px] leading-normal text-ink-muted">Leverage amplifies losses as well as gains. Provyn sizes to {DEFAULT_LEVERAGE.toFixed(1)}x by default.</p>
              </div>
            </div>
            <div className="mt-6" data-testid="simulation"><SimulationPanel state={sim.status} result={result} error={sim.status === "error" ? sim.error : null} hf={hf} blocked={blockedByHf} /></div>
            <div className="mt-6">{action}</div>
            <p className="mb-0 mt-3 font-mono text-[11px] leading-normal text-ink-faint">Real mainnet funds. The transaction flash-borrows USDC, swaps it through Jupiter and deposits everything in one step. Nothing is signed until you approve it in your wallet.</p>
            <p className="mb-0 mt-2 font-mono text-[12px] leading-normal text-ink" data-testid="multiply-close-note">Provyn can&apos;t close Multiply positions yet. Close it in Kamino&apos;s app.</p>
          </div>

          <aside aria-label="Multiply summary" className="self-start overflow-hidden rounded-[10px] border border-line bg-surface">
            <div className="border-b border-line bg-paper-raised px-5 py-3 font-mono text-[10px] tracking-[0.04em] text-ink-faint">POSITION SUMMARY</div>
            <StatRow label={`${asset} price`} value={price !== null ? usd(price) : ", "} tone={price !== null ? "ink" : "muted"} note="Kamino oracle, live" />
            <StatRow label="Your deposit" value={depositUsd !== null ? usd(depositUsd) : ", "} tone={depositUsd !== null ? "ink" : "muted"} />
            <StatRow label="Total exposure" value={depositUsd !== null ? usd(depositUsd * lev) : ", "} tone={depositUsd !== null ? "ink" : "muted"} note={`${lev.toFixed(1)}x`} />
            <StatRow label="USDC debt" value={depositUsd !== null ? usd(depositUsd * (lev - 1)) : ", "} tone={depositUsd !== null ? "ink" : "muted"} note={`Borrow ${borrowApyLabel} APY, as of ${checkedAtLabel()}`} />
            <StatRow label="Liq. LTV" value={liq !== null ? `${liq}%` : ", "} note="Liquidation threshold" />
            <StatRow label="Projected health factor" value={hf !== null ? hf.toFixed(2) : ", "} tone={hf === null ? "muted" : hf < HF_WARN ? "clay" : "ink"} note={hf !== null ? "From the simulated transaction" : "Appears after simulation"} />
            <StatRow label="Network" value="Solana" note={`Kamino xStocks market ${market.market.slice(0, 4)}…${market.market.slice(-4)}`} />
          </aside>
        </div>
        {result && <TxModal open={modal} title={`Open a ${lev.toFixed(1)}x ${asset} Multiply position with ${tokenAmount(deposit, 8)} ${asset}.`} rows={rows} simulation={result} state={exec.state} onConfirm={() => strategy && exec.run(strategy)} onClose={closeModal} />}
      </DetailSection>

      <DetailSection id="how" title="How it works">
        <FlowDiagram steps={[
          { title: "Your deposit", text: `You deposit ${asset} as collateral.` },
          { title: "Flash loan", text: "Kamino flash-borrows USDC for the extra exposure, repaid inside the same transaction." },
          { title: "Jupiter swap", text: `The USDC is swapped into more ${asset} at a live Jupiter quote.` },
          { title: "Leveraged position", text: `Everything is deposited as collateral and the USDC debt stays open. Kamino manages it from there.`, tone: "clay" },
        ]} />
      </DetailSection>

      <DetailSection id="process" title="Process & execution">
        <ProcessList steps={[
          { title: "Confirm Multiply is live for the asset", text: "Provyn checks Kamino's live Multiply market for the asset and refuses to propose it where none exists (AAPLx)." },
          { title: "Build the position", text: "Deposit, flash loan, Jupiter swap and borrow are composed into one atomic transaction, using an address lookup table to fit Solana's size limit." },
          { title: "Simulate it on mainnet", text: "The exact transaction is simulated against live state. You see the result and the projected health factor before anything is signed." },
          { title: "Sign and submit", text: "You approve it in your own wallet; Provyn submits it and waits for on-chain confirmation, then reports the real outcome." },
          { title: "Kamino rebalances", text: "After it opens, the position is managed by Kamino's own Multiply mechanism, Provyn does not rebalance or monitor it on your behalf." },
        ]} />
      </DetailSection>

      <DetailSection id="risks" title="Risk overview">
        <RiskList risks={[
          { title: "Leverage risk", tone: "clay", tag: "AMPLIFIED", text: <>Losses and gains are multiplied by your leverage. At {lev.toFixed(1)}x, a fall in {asset} of roughly <N>{Math.round(100 / lev)}%</N> would erase your deposit before fees. It liquidates at the {asset} threshold of <N>{liq ?? ", "}%</N>.</> },
          { title: "Liquidation risk", tone: "clay", text: <>If the collateral value falls until debt crosses the {liq ?? ", "}% threshold, Kamino can liquidate part of the position. Kamino&apos;s rebalancing does not guarantee that can&apos;t happen.</> },
          { title: "Swap and slippage risk", tone: "neutral", text: "Opening swaps USDC into the stock through Jupiter with a 1% slippage bound and a 0.5% quote buffer; a poor fill costs you at entry." },
          { title: "Borrow-rate risk", tone: "neutral", text: <>You pay the variable USDC borrow rate on the debt (<N>{borrowApyLabel}</N> APY as of the last check). It can rise.</> },
          { title: "Kamino smart-contract risk", tone: "neutral", text: "The position, the flash loan and the rebalancing all live inside Kamino. Provyn cannot mitigate a bug or exploit there." },
          { title: "Pyth availability risk", tone: "neutral", text: "Provyn's Pyth price cross-check is currently unavailable for xStock feeds (key not yet entitled); Provyn says so and sizes conservatively. Kamino's own oracle sets liquidation prices." },
        ]} />
      </DetailSection>

      <DetailSection id="vault" title="Your Multiply position">
        <VaultOverview kind="multiply" symbol={asset} />
      </DetailSection>

      <DetailSection id="contracts" title="Contract addresses">
        <ContractAddresses symbols={["USDC", asset]} />
      </DetailSection>

      <DetailSection id="counterparties" title="Counterparties">
        <Counterparties items={[...COUNTERPARTIES, { name: "Jupiter", role: "The swap aggregator that converts flash-borrowed USDC into more of your stock when a position opens." }]} />
      </DetailSection>

      <DetailSection id="faq" title="FAQ">
        <Faq items={[
          { q: "What is Multiply?", a: <>A Kamino-managed leveraged position. In one transaction, a flash loan borrows USDC, a Jupiter swap turns it into more of your stock, and everything is deposited as collateral, so you hold more exposure than you started with. Leverage amplifies losses as well as gains, and you pay the USDC borrow rate on the debt.</> },
          { q: "Who manages the leverage after it opens?", a: <>Kamino, through its own Multiply mechanism. It is not something Provyn built, and Provyn does not rebalance or watch your position for you.</> },
          { q: "Why only SPYx and TSLAx?", a: <>Those are the assets with a live Kamino Multiply market. AAPLx has none, so Provyn&apos;s capability check refuses to propose it rather than guess. The list is read from Kamino, so it changes if Kamino adds more.</> },
          { q: "Does Provyn hold or move my funds?", a: <>No. The transaction is built unsigned and only goes through if you sign it in your own wallet. Prefer no leverage? <Link href="/borrow" className="text-gold-strong underline">Go to Borrow</Link>.</> },
        ]} />
      </DetailSection>
    </>
  );
}
