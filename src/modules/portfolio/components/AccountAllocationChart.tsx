"use client";

import { Cell, Pie, PieChart, ResponsiveContainer } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { ACCOUNT_TYPE_LABEL, formatKRW } from "../utils";

interface AccountAllocation {
  accountId: string;
  label: string;
  accountType: string;
  totalEvalAmount: number;
}

interface Props {
  accounts: AccountAllocation[];
}

const COLORS = ["#2563eb", "#16a34a", "#f59e0b", "#dc2626", "#9333ea", "#0891b2"];

export function AccountAllocationChart({ accounts }: Props) {
  const total = accounts.reduce((sum, a) => sum + a.totalEvalAmount, 0);

  const data = accounts.map((a, i) => ({
    name: a.label,
    value: a.totalEvalAmount,
    pct: total > 0 ? (a.totalEvalAmount / total) * 100 : 0,
    type: ACCOUNT_TYPE_LABEL[a.accountType] ?? a.accountType,
    fill: COLORS[i % COLORS.length],
  }));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-medium text-muted-foreground">계좌별 비중</CardTitle>
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <div className="text-sm text-muted-foreground py-8 text-center">데이터가 없습니다</div>
        ) : (
          <div className="flex items-center gap-4">
            <div className="flex-shrink-0">
              <ChartContainer config={{}} className="h-[140px] w-[140px] md:h-[160px] md:w-[160px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <ChartTooltip
                      content={<ChartTooltipContent hideLabel />}
                      formatter={(value: number) => formatKRW(value)}
                    />
                    <Pie
                      data={data}
                      dataKey="value"
                      nameKey="name"
                      innerRadius={45}
                      outerRadius={75}
                      strokeWidth={2}
                    >
                      {data.map((d) => (
                        <Cell key={d.name} fill={d.fill} />
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
              </ChartContainer>
            </div>
            <div className="flex-1 space-y-1.5">
              {data.map((d) => (
                <div key={d.name} className="flex items-center gap-2 text-sm">
                  <div
                    className="w-3 h-3 rounded-sm flex-shrink-0"
                    style={{ backgroundColor: d.fill }}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{d.name}</div>
                    <div className="text-xs text-muted-foreground">{d.type}</div>
                  </div>
                  <div className="text-right">
                    <div className="font-semibold">{d.pct.toFixed(1)}%</div>
                    <div className="text-xs text-muted-foreground">
                      {formatKRW(d.value, { compact: true })}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
