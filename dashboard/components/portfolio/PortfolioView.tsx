"use client";

import Link from "next/link";
import { useWallet } from "@solana/wallet-adapter-react";
import { usePosition, type WalletPosition } from "@/lib/api";
import { Mono } from "../Mono";
import { Notice } from "../app/AppShell";
import { HF_BLOCK, HF_WARN } from "../app/SimulationPanel";
import { tokenAmount, usd } from "../app/fields";
import { ConnectWalletButton } from "../wallet/ConnectWalletButton";
import { ManagePosition } from "./ManagePosition";

type Obligation = WalletPosition["obligations"][number];
type Balance = WalletPosition["walletBalances"][number];

/**
 * Health factor colouring — one rule everywhere on the app. 1.0 is liquidation. At or above 1.5 (the agent's own
 * conservative floor in core.ts) it is healthy; below that it is clay, and below 1.1 it is called out as at risk.
 */
export function healthStatus(hf: number | null): { label: string; text: string; badge: string } {
  if (hf === null) return { label: "No debt", text: "text-ink-muted", badge: "bg-line-soft text-ink-muted" };
  if (hf >= HF_WARN) return { label: "Healthy", text: "text-positive", badge: "bg-positive-tint text-positive" };
  if (hf >= HF_BLOCK) return { label: "Watch", text: "text-clay-text", badge: "bg-clay-tint text-clay-text" };
  return { label: "At risk", text: "text-clay-text", badge: "bg-clay-tint text-clay-text" };
}

export function PortfolioView() {
  const { publicKey } = useWallet();
  const wallet = publicKey?.toBase58() ?? null;
  const position = usePosition(wallet);

  if (!wallet) {
    return (
      <div className="flex flex-col items-start gap-4 rounded-[10px] border border-line bg-surface p-7" data-testid="portfolio-disconnected">
        <h2 className="m-0 font-serif text-[22px] font-semibold text-ink">Connect your wallet</h2>
        <p className="m-0 max-w-[560px] font-serif text-[15px] leading-normal text-ink-muted">
          Your positions are read from Kamino using your wallet&apos;s public address. Connect to see them, nothing is shown until you do, and connecting does not sign anything.
        </p>
        <ConnectWalletButton size="hero" />
      </div>
    );
  }
  if (position.status === "loading") return <Notice>Reading your positions from Kamino…</Notice>;
  if (position.status === "error") return <Notice tone="clay">Could not read your positions: {position.error}</Notice>;

  const { obligations, walletBalances, solBalance } = position.data;
  const vanilla = obligations.filter((o) => o.type === "Vanilla");
  const multiply = obligations.filter((o) => o.type === "Multiply");
  const other = obligations.filter((o) => o.type !== "Vanilla" && o.type !== "Multiply");
  const spot = walletBalances.filter((b) => Number(b.amount) > 0);

  return (
    <div className="flex flex-col gap-10" data-testid="portfolio-connected">
      {obligations.length === 0 && (
        <div className="rounded-[10px] border border-line bg-surface p-7" data-testid="portfolio-empty">
          <h2 className="m-0 mb-2 font-serif text-[22px] font-semibold text-ink">No positions yet</h2>
          <p className="m-0 mb-5 max-w-[560px] font-serif text-[15px] leading-normal text-ink-muted">
            This wallet has no open Kamino obligations in the xStocks market. Once you borrow or open a Multiply position, it appears here.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link href="/borrow" className="rounded-lg bg-gold-deep px-5 py-3 font-mono text-[14px] font-medium text-gold-ink hover:bg-gold-text">Borrow</Link>
            <Link href="/earn" className="rounded-lg border border-line-strong bg-surface px-5 py-3 font-mono text-[14px] text-ink hover:border-gold-deep">Earn</Link>
          </div>
        </div>
      )}

      {vanilla.length > 0 && (
        <Group
          id="vanilla" title="Borrow positions" tag="VANILLA"
          blurb="Standard Kamino obligations: collateral you deposited and USDC you borrowed against it, managed by you."
          items={vanilla} onChanged={position.reload} manageable
        />
      )}
      {multiply.length > 0 && (
        <Group
          id="multiply" title="Multiply positions" tag="MULTIPLY"
          blurb="Leveraged positions opened through Kamino Multiply. The debt was taken on to add exposure, and Kamino's own mechanism manages the leverage, not Provyn. Repay and withdraw aren't offered here yet, unwinding a Multiply position means reversing a flash loan and a swap, not a plain repay/withdraw."
          items={multiply}
        />
      )}
      {other.length > 0 && <Group id="other" title="Other Kamino positions" tag="OTHER" blurb="Obligation types Provyn does not create." items={other} />}

      <section aria-labelledby="spot-title" data-testid="spot-balances">
        <h2 id="spot-title" className="m-0 mb-1 font-serif text-[24px] font-semibold text-ink">Spot balances</h2>
        <p className="m-0 mb-4 max-w-[640px] font-serif text-[14px] leading-normal text-ink-muted">
          Tokens in your wallet that Kamino&apos;s xStocks market lists but that aren&apos;t deposited anywhere. Amounts are raw units, what can actually be deposited.
        </p>
        {spot.length === 0 ? (
          <p className="m-0 font-serif text-[15px] text-ink-muted">No spot balances of Kamino-listed tokens on this wallet.</p>
        ) : (
          <div className="overflow-x-auto rounded-[10px] border border-line bg-surface">
            <table className="w-full min-w-[420px] border-collapse text-left">
              <thead>
                <tr className="border-b border-line bg-paper-raised font-mono text-[10px] tracking-[0.04em] text-ink-faint">
                  <th className="px-5 py-3 font-normal">ASSET</th><th className="px-5 py-3 text-right font-normal">AMOUNT</th><th className="px-5 py-3 text-right font-normal">VALUE</th><th className="px-5 py-3 text-right font-normal"> </th>
                </tr>
              </thead>
              <tbody>
                {spot.map((b) => <SpotRow key={b.mintAddress} b={b} />)}
              </tbody>
            </table>
          </div>
        )}
        <p className="mb-0 mt-3 font-mono text-[11px] text-ink-faint">SOL for fees: {tokenAmount(solBalance, 4)} SOL</p>
        {spot.some((b) => /x$/.test(b.symbol)) && (
          <p className="mb-0 mt-3 font-serif text-[14px] text-ink-muted">
            Put idle xStocks to work: <Link href="/borrow" className="text-gold-strong underline">borrow USDC against them</Link> or see the <Link href="/earn" className="text-gold-strong underline">Earn strategies</Link>.
          </p>
        )}
      </section>
    </div>
  );
}

function SpotRow({ b }: { b: Balance }) {
  const isX = /x$/.test(b.symbol);
  return (
    <tr className="border-b border-line-soft last:border-b-0">
      <td className="px-5 py-3 font-mono text-[14px] text-ink">{b.symbol}</td>
      <td className="px-5 py-3 text-right font-mono text-[14px] text-ink">{tokenAmount(b.amount, 8)}</td>
      <td className="px-5 py-3 text-right font-mono text-[14px] text-ink-muted">{usd(Number(b.valueUsd))}</td>
      <td className="px-5 py-3 text-right font-mono text-[12px]">
        <Link href={isX ? "/borrow" : "/earn"} className="text-gold-strong underline">{isX ? "Deposit via Borrow" : "See Earn"}</Link>
      </td>
    </tr>
  );
}

function Group({ id, title, tag, blurb, items, onChanged, manageable }: { id: string; title: string; tag: string; blurb: string; items: Obligation[]; onChanged?: () => void; manageable?: boolean }) {
  return (
    <section aria-labelledby={`${id}-title`} data-testid={`group-${id}`}>
      <div className="mb-1 flex items-center gap-3">
        <h2 id={`${id}-title`} className="m-0 font-serif text-[24px] font-semibold text-ink">{title}</h2>
        <span className="rounded-xl bg-line-soft px-2.5 py-1 font-mono text-[10px] tracking-[0.03em] text-ink-muted">{tag}</span>
      </div>
      <p className="m-0 mb-4 max-w-[680px] font-serif text-[14px] leading-normal text-ink-muted">{blurb}</p>
      <div className="flex flex-col gap-4">{items.map((o) => <ObligationPanel key={o.obligationAddress} o={o} onChanged={onChanged} manageable={manageable} />)}</div>
    </section>
  );
}

function ObligationPanel({ o, onChanged, manageable }: { o: Obligation; onChanged?: () => void; manageable?: boolean }) {
  const hf = o.healthFactor ? Number(o.healthFactor) : null;
  const s = healthStatus(hf);
  return (
    <article className="overflow-hidden rounded-[10px] border border-line bg-surface" data-obligation-type={o.type}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-paper-raised px-5 py-3">
        <span className="font-mono text-[10px] tracking-[0.04em] text-ink-faint">{o.type.toUpperCase()} OBLIGATION · {o.obligationAddress.slice(0, 4)}…{o.obligationAddress.slice(-4)}</span>
        <span className="flex items-center gap-2">
          <span className={`rounded-xl px-2.5 py-1 font-mono text-[10px] ${s.badge}`}>{s.label.toUpperCase()}</span>
          <Mono className={`text-[15px] ${s.text}`} >{hf !== null ? `HF ${hf.toFixed(2)}` : ", "}</Mono>
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[420px] border-collapse text-left">
          <thead>
            <tr className="border-b border-line-soft font-mono text-[10px] tracking-[0.04em] text-ink-faint">
              <th className="px-5 py-2.5 font-normal">ASSET</th><th className="px-5 py-2.5 text-right font-normal">DEPOSITED</th><th className="px-5 py-2.5 text-right font-normal">BORROWED</th>
            </tr>
          </thead>
          <tbody>
            {legRows(o).map((r) => (
              <tr key={r.symbol} className="border-b border-line-soft last:border-b-0">
                <td className="px-5 py-3 font-mono text-[14px] text-ink">{r.symbol}</td>
                <td className="px-5 py-3 text-right font-mono text-[14px] text-ink">{r.dep ? <>{tokenAmount(r.dep.amount, 6)} <span className="text-ink-muted">· {usd(Number(r.dep.valueUsd))}</span></> : <span className="text-ink-faint">, </span>}</td>
                <td className="px-5 py-3 text-right font-mono text-[14px] text-ink">{r.bor ? <>{tokenAmount(r.bor.amount, 6)} <span className="text-ink-muted">· {usd(Number(r.bor.valueUsd))}</span></> : <span className="text-ink-faint">, </span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="grid gap-x-6 gap-y-1 border-t border-line-soft px-5 py-3 font-mono text-[12px] text-ink-muted sm:grid-cols-3">
        <span>Net value {usd(Number(o.netAccountValueUsd))}</span>
        <span>LTV {(Number(o.ltv) * 100).toFixed(2)}%</span>
        <span>Liquidation LTV {(Number(o.liquidationLtv) * 100).toFixed(2)}%</span>
      </div>
      {manageable && <ManagePosition obligationAddress={o.obligationAddress} deposits={o.deposits} borrows={o.borrows} onChanged={onChanged} />}
    </article>
  );
}

/** One row per asset, merging its deposit leg and borrow leg (an asset can be on both sides in principle). */
function legRows(o: Obligation) {
  const symbols = [...new Set([...o.deposits.map((d) => d.symbol), ...o.borrows.map((b) => b.symbol)])];
  return symbols.map((symbol) => ({ symbol, dep: o.deposits.find((d) => d.symbol === symbol), bor: o.borrows.find((b) => b.symbol === symbol) }));
}
