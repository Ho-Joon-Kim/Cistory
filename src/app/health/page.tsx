import { redirect } from "next/navigation";
import { type LegacySearchParams, legacyOverviewRedirect } from "@/modules/overview/legacy-routes";

export default async function HealthPage({
  searchParams,
}: {
  searchParams: Promise<LegacySearchParams>;
}) {
  redirect(legacyOverviewRedirect("health", await searchParams));
}
