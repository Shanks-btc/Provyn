import type { Metadata } from "next";
import { AppShell, Page, PageHeader } from "@/components/app/AppShell";
import { PortfolioView } from "@/components/portfolio/PortfolioView";

export const metadata: Metadata = {
  title: "Provyn, Portfolio",
  description: "Your real Kamino positions: borrows, Multiply positions, health factors and idle balances.",
};

export default function PortfolioPage() {
  return (
    <AppShell active="portfolio">
      <Page>
        <PageHeader eyebrow="PORTFOLIO" title="Your positions" subtitle="Read live from Kamino's xStocks market for your connected wallet." />
        <PortfolioView />
      </Page>
    </AppShell>
  );
}
