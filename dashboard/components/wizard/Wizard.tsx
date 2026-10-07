"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { useEffect, useRef, useState } from "react";
import { usePosition } from "@/lib/api";
import { market } from "@/lib/market";
import { Notice } from "../app/AppShell";
import { ConnectWalletButton } from "../wallet/ConnectWalletButton";
import { AgentRun, type AgentEvent } from "./AgentRun";
import { AgentResult } from "./AgentResult";
import Link from "next/link";

type Goal = "accumulate" | "yield" | "borrow";
const GOAL_TITLE: Record<Exclude<Goal, "accumulate">, string> = { yield: "Yield on your stock", borrow: "Borrow against your stock" };
type Outlook = "bullish" | "bearish" | "volatile" | "neutral";
type Risk = "extra-conservative" | "low" | "moderate" | "high";
export interface Answers {
  goal: Goal | null;
  asset: string | null;
  outlook: Outlook | null;
  risk: Risk | null;
}

// Three real options. No "Hedge Risks": Provyn has no hedging / perps / options capability, so it isn't offered.
const GOALS: { value: Goal; title: string; text: string }[] = [
  { value: "accumulate", title: "Accumulate Spot", text: "Buy an xStock with your USDC or SOL, as a real swap right in the app." },
  { value: "yield", title: "Yield on Stocks", text: "Put stock you hold to work, Provyn weighs the Earn options that genuinely apply." },
  { value: "borrow", title: "Borrow Against Stocks", text: "Borrow USDC against stock you hold, without selling it." },
];
const ASSETS = ["AAPLx", "SPYx", "TSLAx"] as const;
const ASSET_NAME: Record<string, string> = { AAPLx: "Apple", SPYx: "S&P 500 ETF", TSLAx: "Tesla" };
const OUTLOOKS: { value: Outlook; title: string; text: string }[] = [
  { value: "bullish", title: "Bullish", text: "I expect prices to rise." },
  { value: "bearish", title: "Bearish", text: "I expect prices to fall." },
  { value: "volatile", title: "Volatile", text: "I expect big swings either way." },
  { value: "neutral", title: "Neutral", text: "I have no strong view." },
];
const RISKS: { value: Risk; title: string; text: string }[] = [
  { value: "extra-conservative", title: "Extra Conservative", text: "Wide safety margin, no leverage." },
  { value: "low", title: "Low", text: "Cautious sizing, leverage avoided." },
  { value: "moderate", title: "Moderate", text: "Balanced sizing, modest leverage at most." },
  { value: "high", title: "High", text: "Tighter margins accepted, flagged as high-risk." },
];

/** Below this USD value of the chosen asset in the wallet, the wizard offers the real buy step before the agent runs. */
const MIN_HOLD_USD = 1;

type Phase = "steps" | "buy-first" | "running" | "result";

/** The four answers survive a trip to the Trade page (sessionStorage: this tab only, gone when it closes). */
const STORE_KEY = "parity.wizard.answers";
const BLANK: Answers = { goal: null, asset: null, outlook: null, risk: null };
const loadAnswers = (): Answers => {
  try {
    const raw = sessionStorage.getItem(STORE_KEY);
    return raw ? { ...BLANK, ...JSON.parse(raw) } : BLANK;
  } catch {
    return BLANK;
  }
};
const saveAnswers = (a: Answers) => {
  try {
    if (a.goal || a.asset || a.outlook || a.risk) sessionStorage.setItem(STORE_KEY, JSON.stringify(a));
  } catch {
    /* storage unavailable: resuming just starts from the questions */
  }
};
const clearAnswers = () => {
  try {
    sessionStorage.removeItem(STORE_KEY);
  } catch {
    /* nothing to clear */
  }
};

export function Wizard({ onBusyChange, onNavigate, resume = false }: { onBusyChange?: (busy: boolean) => void; onNavigate?: () => void; resume?: boolean } = {}) {
  const { publicKey } = useWallet();
  const wallet = publicKey?.toBase58() ?? null;
  const position = usePosition(wallet);

  // Resuming (after buying on Trade) restores the saved answers and lands on the last question, from where the agent re-runs.
  const [answers, setAnswers] = useState<Answers>(() => (resume ? loadAnswers() : BLANK));
  const restored = resume && !!(answers.goal && answers.asset && (answers.goal === "accumulate" || (answers.outlook && answers.risk)));
  const [step, setStep] = useState(() => (restored ? (answers.goal === "accumulate" ? 2 : 4) : 1));
  const [phase, setPhase] = useState<Phase>(() => (restored && answers.goal === "accumulate" ? "buy-first" : "steps"));
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [outcome, setOutcome] = useState<{ intent: string; result: unknown } | { error: string } | null>(null);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);
  // Tell the modal when the agent is running, so it won't dismiss on a stray click / Escape mid-run.
  useEffect(() => {
    onBusyChange?.(phase === "running");
  }, [phase, onBusyChange]);

  useEffect(() => saveAnswers(answers), [answers]);
  const accumulate = answers.goal === "accumulate";
  const totalSteps = accumulate ? 2 : 4;
  const set = <K extends keyof Answers>(k: K, v: Answers[K]) => setAnswers((a) => ({ ...a, [k]: v }));
  const answered = [answers.goal, answers.asset, answers.outlook, answers.risk][step - 1] !== null;

  const held = position.status === "ready" && answers.asset ? position.data.walletBalances.find((b) => b.symbol === answers.asset) : undefined;
  const heldUsd = held ? Number(held.valueUsd) : 0;
  const enough = heldUsd >= MIN_HOLD_USD;

  const reset = () => {
    abort.current?.abort();
    clearAnswers();
    setAnswers(BLANK);
    setStep(1);
    setPhase("steps");
    setEvents([]);
    setOutcome(null);
  };

  async function runAgent() {
    if (!wallet || !answers.goal || !answers.asset || !answers.outlook || !answers.risk) return;
    setPhase("running");
    setEvents([]);
    setOutcome(null);
    const ctl = new AbortController();
    abort.current = ctl;
    try {
      const res = await fetch("/api/intent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ wallet, goal: answers.goal, asset: answers.asset, outlook: answers.outlook, risk: answers.risk }),
        signal: ctl.signal,
      });
      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `The request to Provyn failed (${res.status}).`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let finished = false;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (!line) continue;
          const msg = JSON.parse(line);
          if (msg.type === "tool") setEvents((e) => [...e, msg as AgentEvent]);
          else if (msg.type === "result") {
            finished = true;
            setOutcome({ intent: msg.intent, result: msg.result });
            setPhase("result");
          } else if (msg.type === "error") {
            finished = true;
            setOutcome({ error: msg.error });
            setPhase("result");
          }
        }
      }
      if (!finished) throw new Error("The connection closed before Provyn finished.");
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      setOutcome({ error: (e as Error).message });
      setPhase("result");
    }
  }

  // Back from a swap: re-run the agent against the new balance as soon as the wallet is connected.
  const autoRan = useRef(false);
  useEffect(() => {
    if (!restored || accumulate || autoRan.current || !wallet) return;
    autoRan.current = true;
    void runAgent();
    // Reset on cleanup: the unmount effect above aborts an in-flight run, so a remount (React StrictMode in dev) must be able to start it again.
    return () => {
      autoRan.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restored, accumulate, wallet]);

  const next = () => {
    if (step < totalSteps) setStep(step + 1);
  };
  /** Picking a card answers it, and (on any step but the last) moves straight to the next question, no separate "Next" click. */
  const pick = <K extends keyof Answers>(k: K, v: Answers[K]) => {
    set(k, v);
    if (step < totalSteps) next();
  };
  const isLast = step === totalSteps;

  // ---- phases after the questions ----
  if (phase === "running") return <AgentRun events={events} asset={answers.asset!} />;
  if (phase === "result" && outcome) return <AgentResult outcome={outcome} onNavigate={onNavigate} onRestart={reset} onRetry={runAgent} heldBalances={position.status === "ready" ? position.data.walletBalances : null} onComplete={clearAnswers} />;
  if (phase === "buy-first") {
    const buyHref = `/trade?${new URLSearchParams({ asset: answers.asset!, mode: "spot", from: "wizard" }).toString()}`;
    const title = accumulate ? `Accumulate ${answers.asset}` : GOAL_TITLE[answers.goal as Exclude<Goal, "accumulate">];
    const primaryBtn = "block w-full rounded-lg bg-gold-deep px-6 py-3 text-center font-mono text-[14px] font-medium text-gold-ink hover:bg-gold-text";
    const secondaryBtn = "block w-full rounded-lg border border-line-strong bg-surface px-6 py-3 text-center font-mono text-[14px] text-ink hover:border-gold-deep";
    const disabledBtn = "block w-full cursor-not-allowed rounded-lg bg-line-strong px-6 py-3 text-center font-mono text-[14px] font-medium text-ink-muted";
    return (
      <div data-testid="wizard-buy-first" className="flex flex-col gap-6">
        <div>
          <div className="mb-3 inline-block rounded-xl bg-positive-tint px-2.5 py-1 font-mono text-[10px] tracking-[0.03em] text-positive">STRATEGY SELECTED FOR YOU</div>
          <h2 className="m-0 font-serif text-[28px] font-semibold text-ink md:text-[34px]">{title}</h2>
          <p className="mb-0 mt-2 font-serif text-[13px] text-ink-muted">
            {enough ? `You hold about $${heldUsd.toFixed(2)} of ${answers.asset}, enough to continue.` : `This needs ${answers.asset}, and this wallet holds ${heldUsd > 0 ? `only about $${heldUsd.toFixed(2)} of it` : "none"} yet.`}
          </p>
        </div>
        <ol className="m-0 flex list-none flex-col gap-4 p-0">
          <li data-testid="how-step-buy" data-done={enough} className={`flex flex-col gap-4 rounded-[10px] border p-6 ${enough ? "border-positive/40 bg-positive-tint/40" : "border-line bg-surface"}`}>
            <div className="flex items-center gap-3">
              <span aria-hidden="true" className={`flex size-8 shrink-0 items-center justify-center rounded-full font-mono text-[13px] ${enough ? "bg-positive text-paper" : "border border-line-strong text-ink"}`}>{enough ? "✓" : 1}</span>
              <div className="font-serif text-[18px] font-semibold text-ink">Buy {answers.asset}</div>
            </div>
            <div className="font-serif text-[14px] leading-normal text-ink-muted">{enough ? <>You hold enough {answers.asset}.</> : "It is its own real swap on the Trade page, with its own receipt."}</div>
            {!enough && (
              <Link href={buyHref} onClick={onNavigate} data-testid="wizard-buy-link" className={primaryBtn}>
                Buy {answers.asset} →
              </Link>
            )}
          </li>
          <li data-testid="how-step-next" className={`flex flex-col gap-4 rounded-[10px] border p-6 ${enough || accumulate ? "border-line bg-surface" : "border-line-soft bg-surface/60"}`}>
            <div className="flex items-center gap-3">
              <span aria-hidden="true" className="flex size-8 shrink-0 items-center justify-center rounded-full border border-line-strong font-mono text-[13px] text-ink">2</span>
              <div className="font-serif text-[18px] font-semibold text-ink">{accumulate ? "Deposit into a vault" : "Get a proposal"}</div>
            </div>
            <div className="font-serif text-[14px] leading-normal text-ink-muted">
              {accumulate
                ? "Borrow against it on Kamino, or put it to work in an Earn vault. Both pages read your real balance and prompt you to buy first if you still need to."
                : "Once you hold enough, Provyn checks your real position and simulates the exact transaction on mainnet before proposing anything."}
            </div>
            {accumulate ? (
              // Just navigation, not a paid call: both destinations handle an empty balance themselves, so this is never gated on already holding the asset.
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Link href={`/borrow?asset=${answers.asset}`} onClick={() => { clearAnswers(); onNavigate?.(); }} data-testid="wizard-borrow-link" className={primaryBtn}>Borrow →</Link>
                <Link href="/earn" onClick={() => { clearAnswers(); onNavigate?.(); }} data-testid="wizard-vault-link" className={secondaryBtn}>Deposit into a vault →</Link>
              </div>
            ) : enough ? (
              <button type="button" onClick={runAgent} data-testid="wizard-agent-button" className={primaryBtn}>Get a proposal →</button>
            ) : (
              <span data-testid="wizard-agent-button" aria-disabled="true" className={disabledBtn}>Get a proposal →</span>
            )}
          </li>
        </ol>
        <div>
          <button type="button" onClick={() => setPhase("steps")} className="cursor-pointer rounded-lg border border-line-strong bg-surface px-5 py-3 font-mono text-[14px] text-ink hover:border-gold-deep">Back</button>
        </div>
      </div>
    );
  }

  // ---- the questions ----
  const heading = [
    "What do you want to do?",
    "Which asset?",
    "Market outlook?",
    "Risk tolerance?",
  ][step - 1];

  return (
    <div data-testid="wizard" data-step={step}>
      <div className="mb-6">
        <div className="mb-2 flex items-center justify-between font-mono text-[11px] tracking-[0.04em] text-ink-muted">
          <span data-testid="wizard-progress">STEP {step} OF {totalSteps}</span>
          {accumulate && <span className="text-ink-faint">Buying needs no outlook or risk answers</span>}
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-line" role="progressbar" aria-valuemin={1} aria-valuemax={totalSteps} aria-valuenow={step} aria-label="Wizard progress">
          <div className="h-full rounded-full bg-gold-deep transition-[width]" style={{ width: `${(step / totalSteps) * 100}%` }} />
        </div>
      </div>

      <fieldset className="m-0 min-w-0 border-0 p-0">
        <legend className="mb-5 p-0 font-serif text-[26px] font-semibold text-ink md:text-[32px]">{heading}</legend>
        {step === 1 && (
          <Options cols="md:grid-cols-3" items={GOALS} value={answers.goal} onPick={(v) => pick("goal", v)} name="Goal" />
        )}
        {step === 2 && (
          <Options cols="md:grid-cols-3" items={ASSETS.map((a) => ({ value: a, title: a, text: `${ASSET_NAME[a]}, ${market.xstocks.find((x) => x.symbol === a)?.name ?? "xStock"}` }))} value={answers.asset} onPick={(v) => pick("asset", v)} name="Asset" />
        )}
        {step === 3 && <Options cols="md:grid-cols-2 lg:grid-cols-4" items={OUTLOOKS} value={answers.outlook} onPick={(v) => pick("outlook", v)} name="Market outlook" />}
        {step === 4 && <Options cols="md:grid-cols-2 lg:grid-cols-4" items={RISKS} value={answers.risk} onPick={(v) => pick("risk", v)} name="Risk tolerance" />}
      </fieldset>

      {step >= 3 && (
        <p className="mb-0 mt-4 max-w-[640px] font-serif text-[13px] leading-normal text-ink-muted">
          {step === 3 ? "Your outlook and risk answers are sent to Provyn as part of your request, they change how it sizes the position and whether it will consider leverage at all." : "This sets a hard limit on your position: a minimum health factor, how much of your borrowing room gets used, and whether leverage is allowed."}
        </p>
      )}

      <div className="mt-8 flex flex-wrap items-center gap-3">
        {step > 1 && (
          <button type="button" onClick={() => setStep(step - 1)} className="cursor-pointer rounded-lg border border-line-strong bg-surface px-5 py-3 font-mono text-[14px] text-ink hover:border-gold-deep">
            Back
          </button>
        )}
        {isLast && accumulate && (
          <button type="button" disabled={!answered} onClick={() => setPhase("buy-first")} data-testid="wizard-finish" className="cursor-pointer rounded-lg border border-transparent bg-gold-deep px-6 py-3 font-mono text-[14px] font-medium text-gold-ink hover:bg-gold-text disabled:cursor-not-allowed disabled:bg-line-strong disabled:text-ink-muted">
            Continue to buy
          </button>
        )}
        {isLast && !accumulate && (
          !wallet ? (
            <ConnectWalletButton size="hero">Connect vault to continue</ConnectWalletButton>
          ) : (
            <button
              type="button"
              disabled={!answered || position.status === "loading"}
              data-testid="wizard-finish"
              onClick={() => (position.status === "ready" && !enough ? setPhase("buy-first") : runAgent())}
              className="cursor-pointer rounded-lg border border-transparent bg-gold-deep px-6 py-3 font-mono text-[14px] font-medium text-gold-ink hover:bg-gold-text disabled:cursor-not-allowed disabled:bg-line-strong disabled:text-ink-muted"
            >
              {position.status === "loading" ? "Checking your wallet…" : "Continue"}
            </button>
          )
        )}
        {isLast && !accumulate && position.status === "error" && <Notice tone="clay">Could not read your wallet: {position.error}</Notice>}
      </div>
      {isLast && !accumulate && !wallet && (
        <p className="mb-0 mt-3 font-serif text-[13px] text-ink-muted">Provyn reasons over your real Kamino position, so it needs your wallet&apos;s public address. Connecting does not sign anything.</p>
      )}
    </div>
  );
}

function Options<T extends string>({ items, value, onPick, cols, name }: { items: { value: T; title: string; text: string }[]; value: T | null; onPick: (v: T) => void; cols: string; name: string }) {
  return (
    <div role="radiogroup" aria-label={name} className={`grid grid-cols-[minmax(0,1fr)] gap-4 ${cols}`}>
      {items.map((o) => {
        const on = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            data-value={o.value}
            onClick={() => onPick(o.value)}
            className={`card-lift cursor-pointer rounded-[10px] border p-5 text-left ${on ? "border-gold-deep bg-gold-tint" : "border-line bg-surface hover:border-gold-deep"}`}
          >
            <div className="mb-1 flex items-center justify-between gap-2 font-serif text-[18px] font-semibold text-ink">
              {o.title}
              <span aria-hidden="true" className={`flex size-5 shrink-0 items-center justify-center rounded-full border text-[11px] ${on ? "border-gold-deep bg-gold-deep text-gold-ink" : "border-line-strong text-transparent"}`}>✓</span>
            </div>
            <p className="m-0 font-serif text-[14px] leading-normal text-ink-muted">{o.text}</p>
          </button>
        );
      })}
    </div>
  );
}
