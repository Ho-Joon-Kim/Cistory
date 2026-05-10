"use client";

import { Loader2, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
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
  const valid = Math.abs(totalPct - 100) < 0.5 && rows.length > 0;

  const fillFromCurrent = () => {
    if (currentPositions.length === 0) {
      toast.error("보유 종목이 없습니다");
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
      toast.error("티커를 모두 입력해주세요");
      return;
    }
    if (new Set(tickers).size !== tickers.length) {
      toast.error("중복된 티커가 있습니다");
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
        toast.success("목표 비중 저장 완료");
        onSaved();
        onOpenChange(false);
      } else {
        toast.error(res.error ?? "저장 실패");
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[640px] max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>목표 비중 설정 — {account.label}</DialogTitle>
          <DialogDescription>
            종목별 목표 비중을 입력하세요. 합계는 100%여야 저장됩니다.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Button type="button" variant="outline" size="sm" onClick={fillFromCurrent}>
              현재 비중으로 채우기
            </Button>
            <div className="text-sm">
              합계{" "}
              <span
                className={
                  Math.abs(totalPct - 100) < 0.5
                    ? "text-green-600 dark:text-green-400 font-semibold"
                    : "text-red-600 dark:text-red-400 font-semibold"
                }
              >
                {totalPct.toFixed(2)}%
              </span>
            </div>
          </div>

          <div className="border rounded-md">
            <div className="grid grid-cols-[110px_1fr_90px_36px] gap-2 px-3 py-2 text-xs text-muted-foreground border-b">
              <div>티커</div>
              <div>종목명</div>
              <div className="text-right">비중 (%)</div>
              <div />
            </div>
            <div className="divide-y">
              {rows.length === 0 ? (
                <div className="px-3 py-6 text-sm text-muted-foreground text-center">
                  아직 종목이 없습니다. "현재 비중으로 채우기" 또는 "+ 종목 추가"를 누르세요.
                </div>
              ) : (
                rows.map((r) => (
                  <div
                    key={r.id}
                    className="grid grid-cols-[110px_1fr_90px_36px] gap-2 px-3 py-2 items-center"
                  >
                    <Input
                      value={r.ticker}
                      onChange={(e) => updateRow(r.id, { ticker: e.target.value.toUpperCase() })}
                      placeholder="예: 005930"
                      className="h-8"
                    />
                    <Input
                      value={r.name}
                      onChange={(e) => updateRow(r.id, { name: e.target.value })}
                      placeholder="종목명"
                      className="h-8"
                    />
                    <Input
                      type="number"
                      step="0.1"
                      min="0"
                      max="100"
                      value={r.weightPct}
                      onChange={(e) => updateRow(r.id, { weightPct: e.target.value })}
                      className="h-8 text-right"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => removeRow(r.id)}
                      aria-label="삭제"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))
              )}
            </div>
          </div>

          <Button type="button" variant="outline" size="sm" onClick={addRow}>
            <Plus className="h-4 w-4 mr-1" />
            종목 추가
          </Button>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            취소
          </Button>
          <Button onClick={handleSave} disabled={!valid || saving}>
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            저장
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
