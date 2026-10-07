"use client";

import Link from "next/link";
import { useWallet } from "@solana/wallet-adapter-react";
import { usePosition, type WalletPosition } from "@/lib/api";
import { Mono } from "../Mono";
import { Notice } from "../app/AppShell";
import { tokenAmount, usd } from "../app/fields";
import { ConnectWalletButton } from "../wallet/ConnectWalletButton";

type Obligation = WalletPosition["obligations"][number];

/**
 * The connected wallet's real position for one strategy, from /api/position (per-reserve obligation data).
 *   redeposit → the wallet's Vanilla obligation (collateral + USDC debt)
 *   multiply  → the wallet's Multiply obligation(s), optionally for one collateral symbol
 * Empty is shown as empty — never a sample position.
 */
export function VaultOverview({ kind, symbol }: { kind: "redeposit" | "multiply"; symbol?: string }) {
  const { publicKey } = useWallet();
  const wallet = publicKey?.toBase58() ?? null;
  const position = usePosition(wallet);

  if (!wallet) {
    return (
      <div className="flex flex-col items-start gap-4 rounded-[10px] border border-line bg-surface p-6">
        <p className="m-0 font-serif text-[15px] text-ink-muted">Connect a wallet to see your own position in this strategy.</p>
        <ConnectWalletButton size="hero">Connect vault</ConnectWalletButton>
      </div>
    );
  }
  if (position.status === "loading") return <Notice>Reading your position from Kamino…</Notice>;
  if (position.status === "error") return <Notice tone="clay">Could not read your position: {position.error}</Notice>;

  const obligations = position.data.obligations.filter((o) => (kind === "redeposit" ? o.type === "Vanilla" : o.type === "Multiply" && (!symbol || o.deposits.some((d) => d.symbol === symbol))));

  if (obligations.length === 0) {
    return (
      <div className="rounded-[10px] border border-line bg-surface p-6" data-testid="vault-empty">
        <p className="m-0 font-serif text-[15px] text-ink">
          {kind === "redeposit" ? "No borrow position on this wallet." : `No Multiply position${symbol ? ` on ${symbol}` : ""} on this wallet.`}
        </p>
        <p className="mb-0 mt-2 font-serif text-[14px] text-ink-muted">
          {kind === "redeposit" ? (
            <>
              Redeposit needs an existing borrow first. <Link href="/borrow" className="text-gold-strong underline">Start on Borrow</Link>, Provyn does not open this strategy while net carry is negative.
            </>
          ) : (
            <>Nothing to show yet. Once you open one it appears here, and on your <Link href="/portfolio" className="text-gold-strong underline">Portfolio</Link>.</>
          )}
        </p>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-4" data-testid="vault-positions">
      {obligations.map((o) => <ObligationCard key={o.obligationAddress} o={o} />)}
      {kind === "redeposit" && (
        <p className="m-0 font-mono text-[11px] leading-normal text-ink-faint">
          Shows collateral and borrowed amounts in your Kamino obligation. USDC you have supplied to Kamino&apos;s pool (outside the obligation) is not part of this read.
        </p>
      )}
    </div>
  );
}

export function ObligationCard({ o }: { o: Obligation }) {
  const hf = o.healthFactor ? Number(o.healthFactor) : null;
  return (
    <div className="rounded-[10px] border border-line bg-surface p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <span className="rounded-xl bg-line-soft px-2.5 py-1 font-mono text-[10px] text-ink-muted">{o.type.toUpperCase()} OBLIGATION</span>
        <Mono className={`text-[13px] ${hf !== null && hf < 1.5 ? "text-clay-text" : "text-ink"}`}>{hf !== null ? `Health factor ${hf.toFixed(2)}` : "No debt"}</Mono>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Legs title="Deposited" legs={o.deposits} />
        <Legs title="Borrowed" legs={o.borrows} />
      </div>
    </div>
  );
}

function Legs({ title, legs }: { title: string; legs: Obligation["deposits"] }) {
  return (
    <div>
      <div className="mb-1 font-mono text-[10px] tracking-[0.03em] text-ink-faint">{title.toUpperCase()}</div>
      {legs.length === 0 ? <div className="font-mono text-[13px] text-ink-faint">, </div> : legs.map((l) => (
        <div key={l.reserveAddress} className="flex items-baseline justify-between gap-3 font-mono text-[13px] text-ink">
          <span>{tokenAmount(l.amount, 6)} {l.symbol}</span>
          <span className="text-ink-muted">{usd(Number(l.valueUsd))}</span>
        </div>
      ))}
    </div>
  );
}
