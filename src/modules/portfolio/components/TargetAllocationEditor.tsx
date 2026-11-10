"use client";

import { Loader2, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Sheet } from "@/components/ds";
import { cn } from "@/lib/utils";
import type { SummaryAccount, SummaryPosition, TargetAllocation } from "../hooks";
import { saveTargetAllocations } from "../hooks";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  account: SummaryAccount;
  currentPositions: SummaryPosition[];
  initialTargets: TargetAllocation[];
  onSaved: () => void;
}

interface RowDraft {
  id: string;
  ticker: string;
  name: string;
  weightPct: string;
}

let _rowSeq = 0;
const nextId = () => `r-${++_rowSeq}`;

function toDraft(t: TargetAllocation): RowDraft {
  return {
    id: nextId(),
    ticker: t.ticker,
    name: t.name,
    weightPct: (t.targetWeight * 100).toFixed(2),
  };
}

export function TargetAllocationEditor({
  open,
  onOpenChange,
  account,
  currentPositions,
  initialTargets,
  onSaved,
}: Props) {
  const [rows, setRows] = useState<RowDraft[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setRows(initialTargets.length > 0 ? initialTargets.map(toDraft) : []);
    }
  }, [open, initialTargets]);

  const totalPct = useMemo(() => rows.reduce((s, r) => s + (Number(r.weightPct) || 0), 0), [rows]);
  const balanced = Math.abs(totalPct - 100) < 0.5;
  const valid = balanced && rows.length > 0;
  const gap = Math.abs(100 - totalPct).toFixed(2);
  const totalNote =
    rows.length === 0
      ? "종목을 추가하세요"
      : balanced
        ? "저장할 수 있어요"
        : totalPct < 100
          ? `${gap}%p 모자라요`
          : `${gap}%p 넘쳐요`;

  const fillFromCurrent = () => {
    if (currentPositions.length === 0) {
      toast.error("이 계좌에 보유 종목이 없습니다. 종목 추가로 직접 입력해 주세요.");
      return;
    }
    setRows(
      currentPositions
        .filter((p) => p.evalAmount > 0)
        .sort((a, b) => b.evalAmount - a.evalAmount)
        .map((p) => ({
          id: nextId(),
          ticker: p.ticker,
          name: p.name || p.ticker,
          weightPct: (p.weight * 100).toFixed(2),
        }))
    );
  };

  const addRow = () => {
    setRows((prev) => [...prev, { id: nextId(), ticker: "", name: "", weightPct: "0" }]);
  };

  const updateRow = (id: string, patch: Partial<Omit<RowDraft, "id">>) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };

  const removeRow = (id: string) => {
    setRows((prev) => prev.filter((r) => r.id !== id));
  };

  const handleSave = async () => {
    if (!valid) return;
    const tickers = rows.map((r) => r.ticker.trim());
    if (tickers.some((t) => !t)) {
      toast.error("비어 있는 티커가 있습니다. 모든 종목의 티커를 입력해 주세요.");
      return;
    }
    const duplicate = tickers.find((t, i) => tickers.indexOf(t) !== i);
    if (duplicate) {
      toast.error(`티커 ${duplicate}이(가) 두 번 입력되었습니다. 한 줄을 지워 주세요.`);
      return;
    }

    const targets: TargetAllocation[] = rows.map((r) => ({
      ticker: r.ticker.trim(),
      name: r.name.trim() || r.ticker.trim(),
      targetWeight: (Number(r.weightPct) || 0) / 100,
    }));

    setSaving(true);
    try {
      const res = await saveTargetAllocations(account.id, targets);
      if (res.ok) {
        toast.success("목표 비중이 저장되었습니다.");
        onSaved();
        onOpenChange(false);
      } else {
        toast.error(res.error ?? "목표 비중을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.");
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={`${account.label} 목표 비중`}
      description="종목별 목표 비중을 입력하세요. 합계가 100%가 되면 저장할 수 있어요."
      className="sm:w-[600px]"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <button type="button" onClick={fillFromCurrent} className={buttonClass("secondary")}>
          현재 비중으로 채우기
        </button>
        <p className="m-0 inline-flex items-center gap-2 text-[13px] text-ink-2" aria-live="polite">
          <span
            aria-hidden="true"
            className={cn("size-1.5 flex-none rounded-full", valid ? "bg-brand" : "bg-warn")}
          />
          <span>
            합계{" "}
            <span className={cn("num font-semibold", valid ? "text-ink" : "text-warn")}>
              {totalPct.toFixed(2)}%
            </span>{" "}
            · {totalNote}
          </span>
        </p>
      </div>

      <div className="border-t border-line">
        <div className="text-label hidden h-8 grid-cols-[104px_minmax(0,1fr)_96px_36px] items-center gap-3 border-b border-line sm:grid">
          <span>티커</span>
          <span>종목명</span>
          <span className="text-right">비중 (%)</span>
          <span />
        </div>
        {rows.length === 0 ? (
          <p className="m-0 border-b border-line py-6 text-center text-[13px] text-ink-3">
            아직 종목이 없어요. 현재 비중으로 채우거나 종목을 추가하세요.
          </p>
        ) : (
          rows.map((r, index) => (
            <div
              key={r.id}
              className="grid grid-cols-[minmax(0,1fr)_104px_44px] items-center gap-x-2 gap-y-2 border-b border-line py-3 sm:grid-cols-[104px_minmax(0,1fr)_96px_36px] sm:gap-x-3 sm:py-2"
            >
              <input
                value={r.ticker}
                onChange={(e) => updateRow(r.id, { ticker: e.target.value.toUpperCase() })}
                placeholder="티커"
                aria-label={`${index + 1}번째 종목 티커`}
                className={cn(fieldClass, "num")}
              />
              <input
                value={r.name}
                onChange={(e) => updateRow(r.id, { name: e.target.value })}
                placeholder="종목명"
                aria-label={`${index + 1}번째 종목명`}
                className={cn(fieldClass, "order-first col-span-3 sm:order-none sm:col-span-1")}
              />
              <input
                type="number"
                inputMode="decimal"
                step="0.1"
                min="0"
                max="100"
                value={r.weightPct}
                onChange={(e) => updateRow(r.id, { weightPct: e.target.value })}
                placeholder="비중 %"
                aria-label={`${index + 1}번째 종목 비중 (%)`}
                className={cn(fieldClass, "num text-right")}
              />
              <button
                type="button"
                onClick={() => removeRow(r.id)}
                aria-label={`${index + 1}번째 종목 삭제`}
                className="inline-flex size-11 cursor-pointer items-center justify-center rounded-control border-0 bg-transparent text-ink-3 transition-[color,background-color,scale] duration-150 ease-out hover:bg-sunken hover:text-ink focus-ring active:scale-[0.96] sm:size-9"
              >
                <Trash2 aria-hidden="true" className="size-4" strokeWidth={1.75} />
              </button>
            </div>
          ))
        )}
      </div>

      <button type="button" onClick={addRow} className={cn(buttonClass("ghost"), "self-start")}>
        <Plus aria-hidden="true" className="size-4" strokeWidth={1.75} />
        종목 추가
      </button>

      <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
        <button
          type="button"
          onClick={() => onOpenChange(false)}
          disabled={saving}
          className={buttonClass("secondary")}
        >
          취소
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={!valid || saving}
          className={buttonClass("primary")}
        >
          {saving ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : null}
          저장
        </button>
      </div>
    </Sheet>
  );
}

const fieldClass =
  "h-11 w-full min-w-0 rounded-control border-0 bg-surface px-3 text-base text-ink shadow-ring outline-none transition-shadow duration-150 ease-out placeholder:text-ink-3 hover:shadow-ring-hover focus-visible:shadow-[0_0_0_2px_var(--brand)] sm:h-9 sm:text-sm";

function buttonClass(variant: "primary" | "secondary" | "ghost") {
  return cn(
    "inline-flex h-11 cursor-pointer items-center justify-center gap-1.5 rounded-control border-0 px-3.5 text-[13px] font-semibold whitespace-nowrap transition-[scale,box-shadow,background-color] duration-150 ease-out focus-ring active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100 sm:h-9",
    variant === "primary" &&
      "bg-brand text-brand-ink shadow-[inset_0_1px_0_rgb(255_255_255/0.14),0_1px_2px_rgb(0_0_0/0.14)]",
    variant === "secondary" && "bg-surface text-ink shadow-ring hover:shadow-ring-hover",
    variant === "ghost" && "bg-transparent px-2 text-ink-2 hover:bg-sunken hover:text-ink"
  );
}
