import { HeartPulse } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CURATED_METRICS } from "@/modules/health/metrics-meta";
import type { TravelTripDetail } from "../hooks";

type HealthSummary = TravelTripDetail["health"][number];

const HEALTH_DATE_FORMATTER = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "UTC",
  month: "long",
  day: "numeric",
  weekday: "short",
});

function displayHealthValue(summary: HealthSummary): { label: string; value: string } {
  const meta = CURATED_METRICS.find((candidate) => candidate.key === summary.metric);
  const rawValue =
    meta?.agg === "sum"
      ? (summary.valueSum ?? summary.valueAvg)
      : (summary.valueAvg ?? summary.valueSum);
  const safeValue = Number.isFinite(rawValue) ? (rawValue ?? 0) : 0;
  const scaled = safeValue * (meta?.scale ?? 1);
  const decimals = meta?.decimals ?? 1;
  return {
    label: meta?.label ?? summary.metric,
    value: `${scaled.toLocaleString("ko-KR", {
      minimumFractionDigits: 0,
      maximumFractionDigits: decimals,
    })}${meta?.unit ?? ""}`,
  };
}

function formatHealthDay(day: string): string {
  const date = new Date(`${day}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? day : HEALTH_DATE_FORMATTER.format(date);
}

export function TripHealthCard({ health }: { health: TravelTripDetail["health"] }) {
  if (health.length === 0) return null;

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <HeartPulse className="h-4 w-4" aria-hidden="true" />
          건강
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="divide-y">
          {health.map((summary) => {
            const display = displayHealthValue(summary);
            return (
              <li
                key={`${summary.day}-${summary.metric}`}
                className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0"
              >
                <div>
                  <p className="text-sm font-medium">{display.label}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {formatHealthDay(summary.day)}
                  </p>
                </div>
                <span className="font-medium tabular-nums">{display.value}</span>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
