"use client";
// Copied only into the disposable browser server, never shipped as an app route.
import { AccountAllocationChart } from "@/modules/portfolio/components/AccountAllocationChart";
import { AccountHoldingsPieChart } from "@/modules/portfolio/components/AccountHoldingsPieChart";
import { AssetTimelineChart } from "@/modules/portfolio/components/AssetTimelineChart";
import type { SummaryAccount, SummaryPosition, SummarySnapshot } from "@/modules/portfolio/hooks";
import { DataUsageCard } from "@/modules/settings/components/DataUsageCard";

const account: SummaryAccount = {
  id: "a",
  label: "테스트 계좌",
  accountType: "general",
  isActive: true,
  cano: "00000000",
  acntPrdtCd: "01",
  lastSyncedAt: null,
  lastSyncError: null,
};
const snapshot = { id: "s", accountId: "a", totalEvalAmount: 1000000 } as SummarySnapshot;
const positions = [600000, 400000].map((evalAmount, i) => ({
  id: String(i),
  snapshotId: "s",
  ticker: String(i),
  name: `종목 ${i}`,
  evalAmount,
})) as SummaryPosition[];
export default function ChartPage() {
  return (
    <main className="mx-auto max-w-4xl space-y-6 p-4">
      <section data-testid="allocation">
        <AccountAllocationChart
          accounts={[
            { accountId: "a", label: "A", accountType: "general", totalEvalAmount: 600000 },
            { accountId: "b", label: "B", accountType: "general", totalEvalAmount: 400000 },
          ]}
        />
      </section>
      <section data-testid="holdings">
        <AccountHoldingsPieChart
          accounts={[account]}
          latestSnapshots={[snapshot]}
          positions={positions}
        />
      </section>
      <section data-testid="assets">
        <AssetTimelineChart />
      </section>
      <section data-testid="usage">
        <DataUsageCard />
      </section>
    </main>
  );
}
