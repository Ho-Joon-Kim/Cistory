"use client";

import { Card, CardContent } from "@/components/ui/card";
import { ArrowDownLeft, ArrowUpRight } from "lucide-react";
import type { TransactionItem } from "@/modules/spending/hooks";

interface TransactionCardProps {
  transaction: TransactionItem;
}

function formatTime(isoString: string): string {
  return new Date(isoString).toLocaleTimeString("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function formatAmount(amount: number): string {
  return amount.toLocaleString("ko-KR");
}

export function TransactionCard({ transaction }: TransactionCardProps) {
  const { type, amount, merchant, accountName, transactedAt } = transaction;
  const isWithdrawal = type === "withdrawal";

  return (
    <Card className="!py-0 !gap-0 rounded-lg relative overflow-hidden">
      {/* Red for withdrawal, green for deposit */}
      <div
        className={`absolute left-0 top-0 bottom-0 w-[3px] ${
          isWithdrawal ? "bg-red-500" : "bg-emerald-500"
        }`}
      />

      <CardContent className="py-2 pl-4 pr-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            {isWithdrawal ? (
              <ArrowUpRight className="h-4 w-4 text-red-500 flex-shrink-0" />
            ) : (
              <ArrowDownLeft className="h-4 w-4 text-emerald-500 flex-shrink-0" />
            )}
            <span className="font-medium text-sm truncate">{merchant}</span>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0 ml-2">
            <span
              className={`font-bold text-sm ${isWithdrawal ? "text-red-500" : "text-emerald-500"}`}
            >
              {isWithdrawal ? "-" : "+"}
              {formatAmount(amount)}원
            </span>
          </div>
        </div>
        <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground">
          <span>{formatTime(transactedAt)}</span>
          {accountName && <span>{accountName}</span>}
        </div>
      </CardContent>
    </Card>
  );
}
