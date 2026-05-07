"use client";

import { ArrowLeftRight, Train, TrainFront } from "lucide-react";
import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface TopLine {
  lineId: string;
  ref: string | null;
  name: string | null;
  color: string;
  rideCount: number;
}

interface TopStation {
  stationName: string;
  count: number;
}

interface UsageData {
  totalSessions: number;
  totalLegs: number;
  transferCount: number;
  totalDistanceMeters: number;
  topLines: TopLine[];
  topStations: TopStation[];
  topTransferStations: TopStation[];
}

interface SubwayUsageCardProps {
  /** Inclusive YYYY-MM-DD date range. */
  from: string;
  to: string;
  title?: string;
}

function formatKm(m: number): string {
  if (m === 0) return "0km";
  if (m < 1000) return `${m}m`;
  return `${(m / 1000).toFixed(1)}km`;
}

function lineLabel(ref: string | null, name: string | null): string {
  if (ref) return /^\d+$/.test(ref) ? `${ref}호선` : ref;
  return name ?? "노선";
}

export function SubwayUsageCard({ from, to, title = "지하철 이용" }: SubwayUsageCardProps) {
  const [data, setData] = useState<UsageData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const ac = new AbortController();
    setLoading(true);
    fetch(`/api/reports/subway-usage?from=${from}&to=${to}`, { signal: ac.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setData)
      .catch((err) => {
        if (err.name !== "AbortError") console.error("subway usage fetch failed:", err);
      })
      .finally(() => setLoading(false));
    return () => ac.abort();
  }, [from, to]);

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <TrainFront className="h-4 w-4" /> {title}
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">불러오는 중…</CardContent>
      </Card>
    );
  }

  if (!data || data.totalLegs === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <TrainFront className="h-4 w-4" /> {title}
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          이 기간에 매칭된 지하철 이용 기록이 없습니다.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <TrainFront className="h-4 w-4" /> {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
          <Stat label="총 이용" value={`${data.totalSessions}회`} />
          <Stat label="구간 (leg)" value={`${data.totalLegs}회`} />
          <Stat
            label="환승"
            value={`${data.transferCount}회`}
            icon={<ArrowLeftRight className="h-3 w-3 text-muted-foreground" />}
          />
          <Stat label="이동 거리" value={formatKm(data.totalDistanceMeters)} />
        </div>

        {data.topLines.length > 0 && (
          <div className="mt-4">
            <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
              가장 많이 탄 노선
            </div>
            <div className="flex flex-wrap gap-2">
              {data.topLines.map((line) => (
                <div
                  key={line.lineId}
                  className="inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-xs"
                  style={{ borderColor: line.color }}
                >
                  <span
                    className="inline-block w-2.5 h-2.5 rounded-full"
                    style={{ backgroundColor: line.color }}
                  />
                  <span className="font-medium" style={{ color: line.color }}>
                    {lineLabel(line.ref, line.name)}
                  </span>
                  <span className="text-muted-foreground">{line.rideCount}회</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {data.topStations.length > 0 && (
          <div className="mt-4">
            <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
              자주 이용한 역
            </div>
            <ul className="space-y-1 text-sm">
              {data.topStations.map((s) => (
                <li key={s.stationName} className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5">
                    <Train className="h-3 w-3 text-muted-foreground" />
                    {s.stationName}
                  </span>
                  <span className="text-muted-foreground">{s.count}회</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {data.topTransferStations.length > 0 && (
          <div className="mt-4">
            <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
              자주 환승한 역
            </div>
            <ul className="space-y-1 text-sm">
              {data.topTransferStations.map((s) => (
                <li key={s.stationName} className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5">
                    <ArrowLeftRight className="h-3 w-3 text-muted-foreground" />
                    {s.stationName}
                  </span>
                  <span className="text-muted-foreground">{s.count}회</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Stat({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1">
        {icon}
        {label}
      </div>
      <div className="text-lg font-semibold mt-0.5">{value}</div>
    </div>
  );
}
