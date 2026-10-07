import type { Metadata } from "next";
import Link from "next/link";
import { AppShell, Notice, Page, PageHeader } from "@/components/app/AppShell";
import { BuyAsset } from "@/components/app/BuyAsset";
import { Mono } from "@/components/Mono";
import { BackLink, ContractAddresses, COUNTERPARTIES, Counterparties, DetailSection, Faq, FlowDiagram, HeroStat, ProcessList, RiskList } from "@/components/earn/Detail";
import { VaultOverview } from "@/components/earn/VaultOverview";
import { borrowApyLabel, carryLabel, carryNegative, carryNote, checkedAtLabel, market, pct } from "@/lib/market";

export const metadata: Metadata = {
  title: "Provyn, Redeposit to earn",
  description: "Borrow USDC against an xStock and supply it to Kamino's stablecoin pool. Read the net carry before anything else.",
};

const { usdc, assets } = market;
const N = ({ children }: { children: React.ReactNode }) => <Mono className="text-[0.92em] text-ink">{children}</Mono>;
const limits = (s: keyof typeof assets) => `${Math.round(assets[s].loanToValuePct)}% LTV / ${Math.round(assets[s].liquidationThresholdPct)}% liquidation`;

/**
 * Deliberately a caution card, not a pitch — the same framing as the landing Strategies card and the /earn index.
 * Every figure and the sign-following tone come from the shared snapshot (lib/market), so it cannot disagree with them.
 */
export default function RedepositPage() {
  return (
    <AppShell active="earn">
      <Page>
        <BackLink />
        <PageHeader
          eyebrow="EARN · REDEPOSIT TO EARN"
          title="Redeposit to earn"
          subtitle="Borrow USDC against your stock, then supply that USDC to Kamino's own stablecoin pool. Whether it pays depends entirely on one number, the net carry below."
        />

        <div className="mb-4 grid gap-4 md:grid-cols-3">
          <HeroStat label="NET CARRY, AS OF LAST CHECK" value={carryLabel} tone={carryNegative ? "clay" : "positive"} note={carryNote} />
          <HeroStat label="USDC BORROW APY (YOU PAY)" value={borrowApyLabel} note="Variable, moves with pool utilisation." />
          <HeroStat label="USDC SUPPLY APY (YOU EARN)" value={pct(usdc.supplyApyPct)} note={`Measured ${checkedAtLabel()}.`} />
        </div>
        <Notice tone={carryNegative ? "clay" : "gold"}>
          {carryNegative ? (
            <>
              <strong>Caution, not a pitch.</strong> Right now borrowing USDC costs <N>{pct(usdc.borrowApyPct)}</N> a year and supplying it earns <N>{pct(usdc.supplyApyPct)}</N>, a net carry of <N>{carryLabel}</N>. Doing this today loses money before
              any price move. Provyn won&apos;t recommend it while that is true, and nothing on this page opens the strategy.
            </>
          ) : (
            <>
              Supply APY currently exceeds borrow APY (net carry <N>{carryLabel}</N>). It is variable and can flip negative at any time; this is sized conservatively, and the carry is re-checked each time.
            </>
          )}
        </Notice>

        <DetailSection id="how" title="How it works">
          <FlowDiagram
            steps={[
              { title: "Your stock", text: "AAPLx, SPYx or TSLAx supplied as collateral on Kamino." },
              { title: "Kamino (borrow USDC)", text: `You borrow USDC against it and pay the borrow rate (${borrowApyLabel} APY, as of the last check).` },
              { title: "Kamino's stablecoin pool", text: `The borrowed USDC is supplied to Kamino's own USDC pool and earns the supply rate (${pct(usdc.supplyApyPct)} APY).` },
              { title: "Net carry", text: `Supply rate minus borrow rate: ${carryLabel} a year on the redeposited amount.`, tone: carryNegative ? "clay" : "positive" },
            ]}
          />
          <BuyAsset symbols={["AAPLx", "SPYx", "TSLAx"]} className="mt-4" />
        </DetailSection>

        <DetailSection id="process" title="Process & execution">
          <ProcessList
            steps={[
              { title: "Confirm your collateral position", text: "Provyn reads your real Kamino obligation per reserve, which asset is actually deposited, and its health factor, rather than trusting what anyone says is there." },
              { title: "Borrow USDC against it", text: "Sized against the asset's real loan-to-value limit, with a health factor of at least 1.5 as the conservative floor." },
              { title: "Supply USDC to Kamino's pool", text: "The borrowed USDC goes into Kamino's own stablecoin pool as a plain supply, earning the supply rate." },
              { title: "Monitor net carry", text: "The strategy only makes sense while supply APY is above borrow APY. Both are variable, so this is checked again, not assumed." },
              { title: "Withdraw and repay if carry turns negative", text: "When the carry is negative, as it is right now, the right move is to withdraw the supplied USDC and repay the loan, not to wait." },
            ]}
          />
        </DetailSection>

        <DetailSection id="risks" title="Risk overview">
          <RiskList
            risks={[
              {
                title: "Negative carry",
                tone: carryNegative ? "clay" : "neutral",
                tag: carryNegative ? "TRUE TODAY" : "WATCH",
                text: carryNegative ? (
                  <>The borrow rate is above the supply rate right now (<N>{carryLabel}</N> net). You would pay to hold this position. Rates are variable and can move either way.</>
                ) : (
                  <>Net carry is <N>{carryLabel}</N> today, but both rates are variable and can flip negative without notice.</>
                ),
              },
              {
                title: "Liquidation risk",
                tone: "clay",
                text: <>Your stock is collateral. If its price falls until your debt crosses the asset&apos;s liquidation threshold, Kamino can liquidate part of it, AAPLx <N>{limits("AAPLx")}</N>, SPYx <N>{limits("SPYx")}</N>, TSLAx <N>{limits("TSLAx")}</N>. Redepositing borrowed USDC does not add any collateral.</>,
              },
              { title: "Kamino smart-contract risk", tone: "neutral", text: "Both the borrow and the redeposit happen inside Kamino Lend. A bug, exploit or governance action there would affect this position, and Provyn cannot mitigate it." },
              { title: "Pyth availability risk", tone: "neutral", text: "Provyn's own cross-check against Pyth is currently unavailable for equity and xStock feeds (our API key isn't entitled to them yet), so this is sized conservatively, and that's disclosed. Kamino's own oracle sets liquidation prices." },
            ]}
          />
        </DetailSection>

        <DetailSection id="vault" title="Your position">
          <VaultOverview kind="redeposit" />
        </DetailSection>

        <DetailSection id="contracts" title="Contract addresses">
          <ContractAddresses symbols={["USDC", "AAPLx", "SPYx", "TSLAx"]} />
        </DetailSection>

        <DetailSection id="counterparties" title="Counterparties">
          <Counterparties items={COUNTERPARTIES} />
        </DetailSection>

        <DetailSection id="faq" title="FAQ">
          <Faq
            items={[
              {
                q: "Why won’t Provyn recommend borrowing just to redeposit and earn?",
                a: carryNegative ? (
                  <>Because right now it loses money: borrowing USDC costs <N>{pct(usdc.borrowApyPct)}</N> while supplying it earns <N>{pct(usdc.supplyApyPct)}</N>, a net carry of <N>{carryLabel}</N> a year. Provyn says so, and suggests borrowing only for what you actually need. It will consider the earn leg once supply beats borrow.</>
                ) : (
                  <>It will, when the math works: supplying USDC currently earns <N>{pct(usdc.supplyApyPct)}</N> against a <N>{pct(usdc.borrowApyPct)}</N> borrow cost. It&apos;s still sized conservatively, with both rates shown.</>
                ),
              },
              { q: "What does borrowing cost?", a: <>You pay Kamino&apos;s variable USDC borrow rate, <N>{borrowApyLabel}</N> APY as of the last check. It moves with how much of the pool is borrowed, so a proposal shows the rate at the moment it is made, not a fixed quote.</> },
              { q: "When does liquidation happen?", a: <>When your debt crosses your collateral&apos;s liquidation threshold: AAPLx <N>{limits("AAPLx")}</N>, SPYx <N>{limits("SPYx")}</N>, TSLAx <N>{limits("TSLAx")}</N>. Provyn aims for a health factor of at least <N>1.5</N> and flags anything lower in plain language.</> },
              { q: "Does Provyn hold or move my funds?", a: <>No. Every transaction is built unsigned and only goes through if you sign it in your own wallet. Want to borrow without redepositing? <Link href="/borrow" className="text-gold-strong underline">Go to Borrow</Link>.</> },
            ]}
          />
        </DetailSection>
      </Page>
    </AppShell>
  );
}
