"use client";

import { useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { YearlyReportData } from "../types";

const EVOLUTION_COLORS = [
  "#06b6d4", // cyan
  "#f97316", // orange
  "#a855f7", // purple
  "#10b981", // emerald
  "#e11d48", // rose
  "#84cc16", // lime
  "#f59e0b", // amber
  "#3b82f6", // blue
  "#ec4899", // pink
  "#9ca3af", // gray
];

interface LanguageEvolutionProps {
  quarterlyLanguages: YearlyReportData["quarterlyLanguages"];
}

export function LanguageEvolution({ quarterlyLanguages }: LanguageEvolutionProps) {
  const { data, allLanguages } = useMemo(() => {
    const langSet = new Set<string>();

    for (const q of quarterlyLanguages) {
      const sorted = [...q.languages].sort((a, b) => b.seconds - a.seconds);
      for (const lang of sorted.slice(0, 8)) {
        langSet.add(lang.name);
      }
    }

    const allLangs = Array.from(langSet);

    const chartData = quarterlyLanguages.map((q) => {
      const entry: Record<string, string | number> = { quarter: q.quarter };
      const langMap = new Map(q.languages.map((l) => [l.name, l.seconds]));

      for (const lang of allLangs) {
        const seconds = langMap.get(lang) || 0;
        entry[lang] = Math.round((seconds / 3600) * 10) / 10;
      }

      return entry;
    });

    return { data: chartData, allLanguages: allLangs };
  }, [quarterlyLanguages]);

  return (
    <ResponsiveContainer width="100%" height={350}>
      <BarChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
        <XAxis
          dataKey="quarter"
          tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }}
          tickLine={false}
          axisLine={{ stroke: "hsl(var(--border))" }}
        />
        <YAxis
          tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }}
          tickLine={false}
          axisLine={{ stroke: "hsl(var(--border))" }}
          unit="h"
        />
        <Tooltip
          contentStyle={{
            backgroundColor: "hsl(var(--popover))",
            border: "1px solid hsl(var(--border))",
            borderRadius: "8px",
            color: "hsl(var(--foreground))",
          }}
          formatter={(value, name) => [`${value}시간`, String(name)]}
        />
        <Legend wrapperStyle={{ color: "hsl(var(--foreground))" }} />
        {allLanguages.map((lang, index) => (
          <Bar
            key={lang}
            dataKey={lang}
            stackId="languages"
            fill={EVOLUTION_COLORS[index % EVOLUTION_COLORS.length]}
            radius={
              index === allLanguages.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]
            }
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
