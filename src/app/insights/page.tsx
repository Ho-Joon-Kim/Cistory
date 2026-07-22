import { redirect } from "next/navigation";
import { type LegacySearchParams, legacyOverviewRedirect } from "@/modules/overview/legacy-routes";

export default async function InsightsPage({
  searchParams,
}: {
  searchParams: Promise<LegacySearchParams>;
}) {
  redirect(legacyOverviewRedirect("insights", await searchParams));
}
