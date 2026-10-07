import type { ReactNode } from "react";
import { DotLabel, Section, SectionTitle } from "./Section";

function StepCard({ className = "", children }: { className?: string; children: ReactNode }) {
  return <div className={`card-lift rounded-xl border border-line bg-surface p-6 md:p-8 ${className}`}>{children}</div>;
}

function StepTitle({ children }: { children: ReactNode }) {
  return <h3 className="mb-2.5 font-serif text-[22px] font-semibold text-ink">{children}</h3>;
}

function StepBody({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <p className={`m-0 font-serif text-[15px] leading-[1.6] text-ink-muted ${className}`}>{children}</p>;
}

const CHECKS = [
  ["Reserve data", "Kamino, live"],
  ["Price divergence", "Pyth, flagged if unavailable"],
  ["The transaction itself", "Simulated, mainnet"],
] as const;

export function HowItWorks() {
  return (
    <Section labelledBy="how-title">
      <div className="mb-11 flex flex-col items-start gap-3 lg:flex-row lg:justify-between lg:gap-[60px]">
        <SectionTitle id="how-title" className="max-w-[520px] shrink-0">
          How it works
        </SectionTitle>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <StepCard>
          <div className="mb-4">
            <DotLabel tone="gold">STEP ONE</DotLabel>
          </div>
          <StepTitle>Connect.</StepTitle>
          <StepBody>
            Provyn reads your real Kamino position, what you hold, what you&apos;ve borrowed, and your current health
            factor. Nothing is asked of you that it can check itself.
          </StepBody>
        </StepCard>

        <StepCard>
          <div className="mb-4">
            <DotLabel tone="gold">STEP TWO</DotLabel>
          </div>
          <StepTitle>State your intent.</StepTitle>
          <StepBody>
            Plain language, &ldquo;I want yield without selling my AAPLx.&rdquo; No strategy picker, no menu of products
            to interpret yourself.
          </StepBody>
        </StepCard>

        <StepCard className="lg:col-span-2">
          <div className="mb-4">
            <DotLabel tone="clay">STEP THREE</DotLabel>
          </div>
          <div className="flex flex-col gap-6 md:flex-row md:gap-10">
            <div className="flex-1">
              <StepTitle>Verify, before anything is shown to you.</StepTitle>
              <StepBody>
                Three checks run against real infrastructure before a proposal is ever assembled. If any of them
                can&apos;t be confirmed, Provyn sizes conservatively and says so, it doesn&apos;t guess.
              </StepBody>
            </div>
            <div className="flex-1 overflow-hidden rounded-[10px] border border-line md:self-start">
              <div className="border-b border-line bg-paper-raised px-[18px] py-3 font-mono text-[10px] tracking-[0.04em] text-ink-faint">
                WHAT GETS CHECKED
              </div>
              {CHECKS.map(([label, value]) => (
                <div
                  key={label}
                  className="flex items-center justify-between gap-4 border-b border-line-soft px-[18px] py-3 last:border-b-0"
                >
                  <span className="font-serif text-sm text-ink">{label}</span>
                  <span className="text-right font-mono text-[11px] text-positive">{value}</span>
                </div>
              ))}
            </div>
          </div>
        </StepCard>

        <StepCard className="lg:col-span-2">
          <div className="mb-4">
            <DotLabel tone="gold">STEP FOUR</DotLabel>
          </div>
          <StepTitle>Review, then sign.</StepTitle>
          <StepBody className="max-w-[640px]">
            You see the exact numbers and every risk, including a stale or unavailable price feed, before approving
            anything. Nothing executes without your signature.
          </StepBody>
        </StepCard>
      </div>
    </Section>
  );
}
