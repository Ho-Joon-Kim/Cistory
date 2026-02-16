"use client";

import { useMemo } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import type { MonthlyReportData } from "../types";

const PROJECT_COLORS = [
  "#10b981", // emerald
  "#f59e0b", // amber
  "#3b82f6", // blue
  "#ef4444", // red
  "#8b5cf6", // violet
  "#ec4899", // pink
  "#6b7280", // gray (기타)
];

interface ProjectDonutProps {
  projects: MonthlyReportData["projectBreakdown"];
}

export function ProjectDonut({ projects }: ProjectDonutProps) {
  const data = useMemo(() => {
    const sorted = [...projects].sort((a, b) => b.commits - a.commits);
    const top = sorted.slice(0, 6);
    const rest = sorted.slice(6);

    const result = top.map((p) => ({
      name: p.name,
      value: p.commits,
    }));

    if (rest.length > 0) {
      result.push({
        name: "기타",
        value: rest.reduce((sum, p) => sum + p.commits, 0),
      });
    }

    return result;
  }, [projects]);

  return (
    <div className="flex flex-col items-center">
      <ResponsiveContainer width="100%" height={300}>
        <PieChart>
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            innerRadius={70}
            outerRadius={110}
            paddingAngle={2}
            dataKey="value"
          >
            {data.map((_, index) => (
              <Cell key={`cell-${index}`} fill={PROJECT_COLORS[index % PROJECT_COLORS.length]} />
            ))}
          </Pie>
          <Tooltip
            contentStyle={{
              backgroundColor: "hsl(var(--popover))",
              border: "1px solid hsl(var(--border))",
              borderRadius: "8px",
              color: "hsl(var(--foreground))",
            }}
            formatter={(value) => [`${value}건`, "커밋"]}
          />
        </PieChart>
      </ResponsiveContainer>
      <div className="flex flex-wrap justify-center gap-x-4 gap-y-2 mt-2">
        {data.map((entry, index) => (
          <div key={entry.name} className="flex items-center gap-1.5 text-sm">
            <span
              className="inline-block h-3 w-3 rounded-full shrink-0"
              style={{ backgroundColor: PROJECT_COLORS[index % PROJECT_COLORS.length] }}
            />
            <span className="text-muted-foreground">
              {entry.name} ({entry.value})
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
