import { market } from "@/lib/market";
import { DotLabel, Section, SectionTitle } from "./Section";
import { StatusPanel } from "./StatusPanel";

// How the Pyth check works, as a plain mechanism — no status claims. (The verified integration
// status, including the blocked entitlement, is the PYTH INTEGRATION STATUS panel in Proof.tsx.)
const CHECK_STEPS = [
  "Read Pyth's real price for the underlying stock",
  "Compare it to the xStock's on-chain price",
  "Flag any meaningful gap before sizing a position",
] as const;

/*
 * Solana figures from market-snapshot.json (`npm run snapshot:landing`), measured live:
 *   - fee: the devnet proof transaction's actual fee (getTransaction), priced at Pyth's live SOL/USD;
 *   - reserves: live xStock reserves in Kamino's xStocks market;
 *   - compute: the agent's StrategyValidator simulating borrow / borrow+earn / SPYx Multiply on
 *     mainnet (Multiply varies with the Jupiter route, so this is a range, not a constant).
 */
const { solana } = market;
const kilo = (n: number) => `${Math.round(n / 1000)}k`;
const SOLANA_FACTS = [
  {
    label: "Real transaction fee paid (devnet)",
    value: `${solana.proofFeeLamports.toLocaleString("en-US")} lamports · ~$${solana.proofFeeUsd.toFixed(4)}`,
    tone: "positive",
  },
  { label: "xStock reserves checked", value: `${solana.xStockReservesLive}, confirmed live`, tone: "positive" },
  {
    label: "Full strategy check, compute cost",
    value: `~${kilo(solana.computeUnitsMin)}–${kilo(solana.computeUnitsMax)} CU`,
    tone: "positive",
  },
] as const;

function Card({ children }: { children: React.ReactNode }) {
  return <div className="card-lift rounded-xl border border-line bg-surface p-6 md:p-8">{children}</div>;
}

function CardTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="mb-3 font-serif text-xl font-semibold leading-[1.3] text-ink">{children}</h3>;
}

export function WhySolanaPyth() {
  return (
    <Section labelledBy="why-title">
      {/* mb-11 keeps the 44px gap to the cards that the removed subtitle used to provide. */}
      <SectionTitle id="why-title" className="mb-11 max-w-[640px]">
        Why Solana
      </SectionTitle>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <div className="mb-4">
            <DotLabel tone="gold">INFRASTRUCTURE</DotLabel>
          </div>
          <CardTitle>Speed and cost make constant verification possible.</CardTitle>
          <p className="mb-5 mt-0 font-serif text-[15px] leading-[1.6] text-ink-muted">
            Every proposal starts with a real check against your position and the market, something that only makes
            sense at scale if it costs a fraction of a cent and confirms in under a second. That&apos;s the role Solana
            plays here: infrastructure Provyn depends on for every single interaction, not a talking point.
          </p>
          <StatusPanel title="FROM OUR OWN TEST RUNS" rows={[...SOLANA_FACTS]} />
        </Card>

        <Card>
          <div className="mb-4">
            <DotLabel tone="clay">MARKET DATA</DotLabel>
          </div>
          <CardTitle>A second price check, whenever Pyth can answer.</CardTitle>
          <p className="mb-5 mt-0 font-serif text-[15px] leading-[1.6] text-ink-muted">
            When Pyth can answer, Provyn cross-checks an xStock&apos;s on-chain price against Pyth&apos;s real market feed
            before recommending anything, catching a gap between the tokenized price and the underlying stock. When it
            can&apos;t, Provyn says so and sizes conservatively.
          </p>
          {/* A plain mechanism list — no status claims. The honest entitlement status lives in the Proof section. */}
          <div className="overflow-hidden rounded-[10px] border border-line">
            <div className="border-b border-line bg-paper-raised px-[18px] py-3 font-mono text-[10px] tracking-[0.04em] text-ink-faint">
              HOW THE CHECK WORKS
            </div>
            <ol className="m-0 list-none p-0">
              {CHECK_STEPS.map((step, i) => (
                <li key={step} className="flex items-baseline gap-3 border-b border-line-soft px-[18px] py-3 last:border-b-0">
                  <span aria-hidden="true" className="shrink-0 font-mono text-[11px] text-gold-strong">
                    {i + 1}.
                  </span>
                  <span className="font-serif text-sm text-ink">{step}</span>
                </li>
              ))}
            </ol>
          </div>
        </Card>
      </div>
    </Section>
  );
}
