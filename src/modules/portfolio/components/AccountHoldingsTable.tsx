"use client";

import { ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import type { SummaryAccount, SummaryPosition, SummarySnapshot } from "../hooks";
import { ACCOUNT_TYPE_LABEL, formatKRW, formatPercent, pnlColorClass } from "../utils";

interface Props {
  accounts: SummaryAccount[];
  snapshots: SummarySnapshot[];
  positions: SummaryPosition[];
}

export function AccountHoldingsTable({ accounts, snapshots, positions }: Props) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>(
    Object.fromEntries(accounts.map((a) => [a.id, true]))
  );

  const snapshotByAccount = new Map(snapshots.map((s) => [s.accountId, s]));
  const positionsBySnapshot = new Map<string, SummaryPosition[]>();
  for (const p of positions) {
    const arr = positionsBySnapshot.get(p.snapshotId) ?? [];
    arr.push(p);
    positionsBySnapshot.set(p.snapshotId, arr);
  }

  const toggle = (id: string) => setExpanded((s) => ({ ...s, [id]: !s[id] }));

  return (
    <Card>
      <CardContent className="p-0">
        <div className="divide-y">
          {accounts.map((acc) => {
            const snap = snapshotByAccount.get(acc.id);
            const accPositions = snap ? positionsBySnapshot.get(snap.id) ?? [] : [];
            const sorted = [...accPositions].sort((a, b) => b.evalAmount - a.evalAmount);
            const open = expanded[acc.id];

            return (
              <div key={acc.id}>
                <button
                  type="button"
                  onClick={() => toggle(acc.id)}
                  className="w-full px-4 py-3 flex items-center gap-3 hover:bg-muted/50 transition-colors text-left"
                >
                  {open ? (
                    <ChevronDown className="w-4 h-4 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="w-4 h-4 text-muted-foreground" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2">
                      <span className="font-semibold">{acc.label}</span>
                      <span className="text-xs text-muted-foreground">
                        {ACCOUNT_TYPE_LABEL[acc.accountType] ?? acc.accountType} ·{" "}
                        {acc.cano}-{acc.acntPrdtCd}
                      </span>
                      {acc.lastSyncError && (
                        <span className="text-xs text-red-600 dark:text-red-400">
                          동기화 실패
                        </span>
                      )}
                    </div>
                    {snap && (
                      <div className="text-sm mt-0.5">
                        <span className="font-semibold">{formatKRW(snap.totalEvalAmount)}</span>
                        <span className={`ml-2 ${pnlColorClass(snap.totalPnl)}`}>
                          {formatKRW(snap.totalPnl, { sign: true })}{" "}
                          ({formatPercent(snap.totalPnlRate)})
                        </span>
                        <span className="ml-2 text-xs text-muted-foreground">
                          예수금 {formatKRW(snap.deposit, { compact: true })}
                        </span>
                      </div>
                    )}
                  </div>
                </button>

                {open && sorted.length > 0 && (
                  <div className="px-4 pb-3">
                    <div className="overflow-x-auto rounded-md border">
                      <table className="w-full text-sm">
                        <thead className="bg-muted/50">
                          <tr className="text-xs text-muted-foreground">
                            <th className="text-left p-2 font-medium">종목</th>
                            <th className="text-right p-2 font-medium">수량</th>
                            <th className="text-right p-2 font-medium">평단</th>
                            <th className="text-right p-2 font-medium">현재가</th>
                            <th className="text-right p-2 font-medium">평가금</th>
                            <th className="text-right p-2 font-medium">손익</th>
                            <th className="text-right p-2 font-medium">비중</th>
                          </tr>
                        </thead>
                        <tbody>
                          {sorted.map((p) => (
                            <tr key={p.id} className="border-t">
                              <td className="p-2">
                                <div className="font-medium">{p.name}</div>
                                <div className="text-xs text-muted-foreground">{p.ticker}</div>
                              </td>
                              <td className="text-right p-2 tabular-nums">
                                {p.quantity.toLocaleString()}
                              </td>
                              <td className="text-right p-2 tabular-nums">
                                {p.avgPrice.toLocaleString(undefined, {
                                  maximumFractionDigits: 0,
                                })}
                              </td>
                              <td className="text-right p-2 tabular-nums">
                                {p.currentPrice.toLocaleString()}
                              </td>
                              <td className="text-right p-2 tabular-nums font-medium">
                                {formatKRW(p.evalAmount, { compact: true })}
                              </td>
                              <td className={`text-right p-2 tabular-nums ${pnlColorClass(p.pnl)}`}>
                                {formatPercent(p.pnlRate)}
                              </td>
                              <td className="text-right p-2 tabular-nums">
                                {(p.weight * 100).toFixed(1)}%
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
