import { redirect } from "next/navigation";
import { type LegacySearchParams, legacyOverviewRedirect } from "@/modules/overview/legacy-routes";

export default async function ReportPage({
  searchParams,
}: {
  searchParams: Promise<LegacySearchParams>;
}) {
  redirect(legacyOverviewRedirect("report", await searchParams));
}
