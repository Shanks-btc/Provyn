import type { Metadata } from "next";
import { Suspense } from "react";
import { AppShell, Page, PageHeader } from "@/components/app/AppShell";
import { BackLink } from "@/components/earn/Detail";
import { MultiplyDetail } from "@/components/earn/MultiplyDetail";

export const metadata: Metadata = {
  title: "Provyn, Multiply",
  description: "Open a leveraged SPYx or TSLAx position on Kamino Multiply. Kamino's own managed rebalancing, not Provyn's.",
};

export default function MultiplyPage() {
  return (
    <AppShell active="earn">
      <Page>
        <BackLink />
        <PageHeader
          eyebrow="EARN · MULTIPLY"
          title="Multiply on SPYx & TSLAx"
          subtitle="Add leveraged exposure through Kamino's live Multiply market. Live stats below come straight from Kamino; the exact transaction is simulated on mainnet before you sign."
        />
        <Suspense fallback={null}>
          <MultiplyDetail />
        </Suspense>
      </Page>
    </AppShell>
  );
}
