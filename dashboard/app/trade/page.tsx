import type { Metadata } from "next";
import { Suspense } from "react";
import { SiteNav } from "@/components/SiteNav";
import { ConnectWalletButton } from "@/components/wallet/ConnectWalletButton";
import { RealQuote } from "@/components/trade/RealQuote";
import { finnhubEnabled } from "../../../src/finnhub/quote";
import { TradeSidePanel } from "@/components/trade/TradeSidePanel";
import { OrderPanel } from "@/components/trade/TradeControls";
import {
  ChartPanel,
  Orderbook,
  TickerBar,
} from "@/components/trade/TradeConcept";

// FINNHUB_ENABLED is read per request (not baked in at build time), so the live-price band follows the flag on a running server.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Provyn, Trade (Concept)",
  description: "Concept preview of Provyn's Trade screen. No live equity-perp market exists on Solana yet.",
};

/**
 * Dark terminal-style concept page. Desktop (lg+): chart | orderbook | long/short, filling the
 * viewport (at least the mockup's 900px). Below lg the columns stack as chart → long/short →
 * orderbook: DOM order is the mobile order, and lg:order-* restores the desktop arrangement.
 */
export default function TradeConceptPage() {
  return (
    <div className="flex min-h-screen flex-col bg-charcoal font-serif lg:h-screen lg:min-h-[900px] lg:overflow-hidden">
      <SiteNav tone="dark" active="trade" action={<ConnectWalletButton tone="dark" />} />
      <TickerBar />
      {/* The only real number on this page, in its own band; everything else here is simulated. Rendered only when the
          opt-in Finnhub flag is on: with it off there is no band, no request and no retry loop. */}
      {finnhubEnabled() && <RealQuote symbol="AAPL" />}
      <main className="mx-auto flex w-full max-w-[1440px] flex-col lg:flex-1 lg:flex-row lg:overflow-hidden">
        <ChartPanel />
        {/* Right-hand column: Long/Short by default, the real swap panel with ?mode=spot. Until the URL is read, the
            server HTML is the Long/Short panel, so there is no layout jump for the default view. */}
        <Suspense fallback={<OrderPanel className="lg:order-3" />}>
          <TradeSidePanel className="lg:order-3" />
        </Suspense>
        <Orderbook className="lg:order-2" />
      </main>
    </div>
  );
}
