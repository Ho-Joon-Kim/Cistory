"use client";

import { useMemo } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import type { MonthlyReportData } from "../types";

const LANGUAGE_COLORS = [
  "#06b6d4", // cyan
  "#f97316", // orange
  "#a855f7", // purple
  "#14b8a6", // teal
  "#e11d48", // rose
  "#84cc16", // lime
  "#9ca3af", // gray (기타)
];

interface LanguagePieProps {
  languages: MonthlyReportData["languageBreakdown"];
}

export function LanguagePie({ languages }: LanguagePieProps) {
  const data = useMemo(() => {
    const sorted = [...languages].sort((a, b) => b.seconds - a.seconds);
    const top = sorted.slice(0, 6);
    const rest = sorted.slice(6);

    const result = top.map((l) => ({
      name: l.name,
      value: Math.round((l.seconds / 3600) * 10) / 10,
    }));

    if (rest.length > 0) {
      const totalRestSeconds = rest.reduce((sum, l) => sum + l.seconds, 0);
      result.push({
        name: "기타",
        value: Math.round((totalRestSeconds / 3600) * 10) / 10,
      });
    }

    return result;
  }, [languages]);

  return (
    <div className="flex flex-col items-center">
      <ResponsiveContainer width="100%" height={300}>
        <PieChart>
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            outerRadius={110}
            paddingAngle={2}
            dataKey="value"
          >
            {data.map((entry, index) => (
              <Cell key={`cell-${entry.name}`} fill={LANGUAGE_COLORS[index % LANGUAGE_COLORS.length]} />
            ))}
          </Pie>
          <Tooltip
            contentStyle={{
              backgroundColor: "hsl(var(--popover))",
              border: "1px solid hsl(var(--border))",
              borderRadius: "8px",
              color: "hsl(var(--foreground))",
            }}
            formatter={(value) => [`${value}시간`, "사용 시간"]}
          />
        </PieChart>
      </ResponsiveContainer>
      <div className="flex flex-wrap justify-center gap-x-4 gap-y-2 mt-2">
        {data.map((entry, index) => (
          <div key={entry.name} className="flex items-center gap-1.5 text-sm">
            <span
              className="inline-block h-3 w-3 rounded-full shrink-0"
              style={{ backgroundColor: LANGUAGE_COLORS[index % LANGUAGE_COLORS.length] }}
            />
            <span className="text-muted-foreground">
              {entry.name} ({entry.value}h)
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
