import { market, pct } from "@/lib/market";
import { Mono } from "../Mono";
import { Section, SectionTitle } from "./Section";

type Symbol = keyof typeof market.assets;

interface Asset {
  symbol: Symbol;
  description: string;
}

const ASSETS: Asset[] = [
  { symbol: "AAPLx", description: "Apple Inc., tokenized equity" },
  { symbol: "SPYx", description: "S&P 500, tokenized index" },
  { symbol: "TSLAx", description: "Tesla, Inc., tokenized equity" },
];

/*
 * Borrow/Earn are supported for all three assets: each reserve has LTV > 0 and the market's USDC
 * reserve is shared (backend get_asset_capabilities, 2026-09-24).
 * Multiply, LTV and liquidation threshold come from market-snapshot.json (`npm run
 * snapshot:landing`), so the Multiply flag and the honesty line below it can't drift apart:
 * both follow Kamino's live Multiply position count for the asset.
 */
function capabilities(symbol: Symbol) {
  return [
    { name: "Borrow", supported: true },
    { name: "Earn", supported: true },
    { name: "Multiply", supported: market.assets[symbol].multiply.obligations > 0 },
  ];
}

function multiplyReason(symbol: Symbol) {
  const n = market.assets[symbol].multiply.obligations;
  return n > 0
    ? `Multiply is live for ${symbol} because ${n} real positions are currently open on it, confirmed, not assumed.`
    : `Multiply isn't live for ${symbol} because Kamino has no live Multiply positions for it today, not a Provyn decision.`;
}

export function Capabilities() {
  return (
    <Section labelledBy="capabilities-title" className="bg-surface">
      <SectionTitle id="capabilities-title" className="mb-3 max-w-[640px]">
        What&apos;s actually available, by asset
      </SectionTitle>
      <p className="mb-11 mt-0 max-w-[620px] font-serif text-[17px] text-ink-muted">
        Capabilities are checked live against Kamino, not assumed, Provyn states what&apos;s supported for the specific
        asset you&apos;re asking about, nothing more.
      </p>

      {/* Three cards: stacked below lg (at 768 three columns would leave ~210px each), a row from lg. */}
      <div className="flex flex-col gap-6 lg:flex-row">
        {ASSETS.map((asset) => {
          const a = market.assets[asset.symbol];
          return (
            <article key={asset.symbol} className="card-lift flex-1 rounded-[10px] border border-line p-7 text-left">
              <h3 className="mb-1 font-serif text-[22px] font-semibold text-ink">{asset.symbol}</h3>
              <div className="mb-5 font-mono text-xs text-ink-faint">{asset.description}</div>
              <dl className="m-0 flex flex-col gap-2.5">
                {capabilities(asset.symbol).map((c) => (
                  <div key={c.name} className="flex justify-between border-t border-line-soft pt-2.5">
                    <dt className="font-serif text-[15px] text-ink">{c.name}</dt>
                    <dd className={`m-0 font-mono text-[13px] ${c.supported ? "text-positive" : "text-ink-faint"}`}>
                      {c.supported ? "Supported" : "Not yet live"}
                    </dd>
                  </div>
                ))}
              </dl>
              <dl className="m-0 mt-4 flex justify-between gap-4 border-t border-dashed border-line pt-3.5">
                <dt className="font-mono text-[11px] text-ink-faint">LTV / LIQ. THRESHOLD</dt>
                <Mono as="dd" className="m-0 text-[11px] text-ink-muted">
                  {pct(a.loanToValuePct, 0)} / {pct(a.liquidationThresholdPct, 0)}
                </Mono>
              </dl>
              {/* ink-muted rather than the mockup's #9A988D: at 12.5px that measured 2.90:1 on white. */}
              <p className="mb-0 mt-3 font-serif text-[12.5px] leading-normal text-ink-muted">{multiplyReason(asset.symbol)}</p>
            </article>
          );
        })}
      </div>
    </Section>
  );
}
