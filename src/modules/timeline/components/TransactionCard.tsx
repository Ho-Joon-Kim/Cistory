"use client";

import { ArrowDownLeft, ArrowUpRight } from "lucide-react";
import type { TransactionItem } from "@/modules/spending/hooks";
import { ActivityCard } from "./ActivityCard";

interface TransactionCardProps {
  transaction: TransactionItem;
}

function formatTime(isoString: string): string {
  const date = new Date(isoString);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

export function TransactionCard({ transaction }: TransactionCardProps) {
  const { type, amount, merchant, accountName, transactedAt } = transaction;
  const isWithdrawal = type === "withdrawal";
  const sign = isWithdrawal ? "−" : "+";

  return (
    <ActivityCard
      accent={isWithdrawal ? "expense" : "income"}
      kind={isWithdrawal ? "지출" : "입금"}
      icon={isWithdrawal ? <ArrowUpRight size={12} /> : <ArrowDownLeft size={12} />}
      title={merchant}
      trailing={
        <strong className="timeline-transaction-amount">
          {sign}
          {amount.toLocaleString("ko-KR")}원
        </strong>
      }
      detail={accountName}
      stats={<time dateTime={transactedAt}>{formatTime(transactedAt)}</time>}
    />
  );
}
