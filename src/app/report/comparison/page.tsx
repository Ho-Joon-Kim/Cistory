import { redirect } from "next/navigation";
import { type LegacySearchParams, legacyOverviewRedirect } from "@/modules/overview/legacy-routes";

export default async function ComparisonPage({
  searchParams,
}: {
  searchParams: Promise<LegacySearchParams>;
}) {
  redirect(legacyOverviewRedirect("comparison", await searchParams));
}
