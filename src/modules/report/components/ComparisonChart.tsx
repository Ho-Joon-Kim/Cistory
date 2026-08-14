"use client";

import { useState } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { YearComparisonData } from "../comparison-service";

interface ComparisonChartProps {
  data: YearComparisonData;
}

type MetricKey = "commits" | "coding" | "distance";

const METRIC_CONFIG: Record<
  MetricKey,
  {
    label: string;
    year1Key: string;
    year2Key: string;
    formatter: (v: number) => string;
  }
> = {
  commits: {
    label: "커밋",
    year1Key: "year1Commits",
    year2Key: "year2Commits",
    formatter: (v) => `${v}`,
  },
  coding: {
    label: "코딩 시간",
    year1Key: "year1CodingSeconds",
    year2Key: "year2CodingSeconds",
    formatter: (v) => `${Math.round(v / 3600)}h`,
  },
  distance: {
    label: "이동 거리",
    year1Key: "year1DistanceMeters",
    year2Key: "year2DistanceMeters",
    formatter: (v) => `${Math.round(v / 1000)}km`,
  },
};

const MONTH_LABELS = [
  "1월",
  "2월",
  "3월",
  "4월",
  "5월",
  "6월",
  "7월",
  "8월",
  "9월",
  "10월",
  "11월",
  "12월",
];

export function ComparisonChart({ data }: ComparisonChartProps) {
  const [metric, setMetric] = useState<MetricKey>("commits");
  const config = METRIC_CONFIG[metric];

  const chartData = data.monthlyComparison.map((m, i) => {
    const entry = m as unknown as Record<string, number>;
    return {
      month: MONTH_LABELS[i],
      [data.year1]: entry[config.year1Key],
      [data.year2]: entry[config.year2Key],
    };
  });

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">월별 비교</CardTitle>
          <div className="flex gap-1">
            {(Object.keys(METRIC_CONFIG) as MetricKey[]).map((key) => (
              <Button
                key={key}
                variant={metric === key ? "default" : "outline"}
                size="sm"
                className="text-xs h-7"
                onClick={() => setMetric(key)}
              >
                {METRIC_CONFIG[key].label}
              </Button>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
            <XAxis dataKey="month" tick={{ fontSize: 12 }} />
            <YAxis tick={{ fontSize: 12 }} tickFormatter={config.formatter} />
            <Tooltip formatter={(value) => config.formatter(Number(value ?? 0))} />
            <Legend />
            <Line
              type="monotone"
              dataKey={data.year1}
              stroke="hsl(var(--muted-foreground))"
              strokeWidth={2}
              dot={{ r: 3 }}
              strokeDasharray="5 5"
            />
            <Line
              type="monotone"
              dataKey={data.year2}
              stroke="hsl(var(--primary))"
              strokeWidth={2}
              dot={{ r: 3 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
