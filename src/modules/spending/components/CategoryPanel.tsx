"use client";

import { type ReactNode, useId, useState } from "react";
import { AiLine, CategoryMark, categoryColor, useEvidence } from "@/components/ds";
import type { Fact } from "@/lib/facts/types";
import { formatWon } from "@/lib/format";
import { cn } from "@/lib/utils";
import { SPENDING_CATEGORY_LABELS, type SpendingCategoryKey } from "../categories";
import { categoryShares, type MonthBar, SPLIT_CATEGORY, SPLIT_LABEL } from "../view-model";
import { BlockTitle, DisclosureButton } from "./parts";

/** Share of the everyday base: one decimal below 10% so small categories never read "0%". */
function formatCategoryShare(ratio: number): string {
  const pct = ratio * 100;
  if (pct > 0 && pct < 10) return `${pct.toFixed(1)}%`;
  return `${Math.round(pct)}%`;
}

/**
 * A category row as in the mock's `.crow`: amount is the primary figure (ink,
 * medium), the share is secondary (12px --ink3). The share bar lives in the
 * label column so it never runs under the amount.
 */
function CategoryRow({
  label,
  leading,
  count,
  value,
  pct,
  share,
  color,
  evidence,
  compact,
}: {
  label: ReactNode;
  leading: ReactNode;
  count?: string;
  value: string;
  pct?: string;
  share: number;
  color?: string;
  evidence?: "on" | "dim";
  compact?: boolean;
}) {
  return (
    <div
      data-evidence={evidence}
      className={cn(
        "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3",
        compact ? "h-8 text-[13px]" : "h-9 text-sm"
      )}
    >
      <span className="relative flex h-full min-w-0 items-center px-2.5">
        <span
          aria-hidden="true"
          className="ds-growx absolute inset-y-1 left-0 rounded-[6px]"
          style={{
            width: `${Math.max(0, Math.min(1, share)) * 100}%`,
            background: color ? `color-mix(in oklab, ${color} 11%, transparent)` : "var(--track)",
          }}
        />
        <span
          className={cn(
            "relative flex min-w-0 items-center gap-2 text-ink",
            !compact && "font-medium"
          )}
        >
          {leading}
          <span className="truncate">{label}</span>
          {count ? <span className="num text-xs font-normal text-ink-3">{count}</span> : null}
        </span>
      </span>
      <span className="flex shrink-0 items-baseline gap-2.5 pr-1">
        <span className={cn("num text-ink", !compact && "font-medium")}>{value}</span>
        <span className="num w-[38px] text-right text-xs text-ink-3">{pct ?? ""}</span>
      </span>
    </div>
  );
}

/**
 * The selected month's top three everyday categories (의료·건강 shown apart),
 * one AI line for the current month, and every category behind a disclosure.
 */
export function CategoryPanel({
  month,
  today,
  counts,
  fact,
}: {
  month: MonthBar;
  today: number;
  /** Per-category transaction counts — known for the current month only. */
  counts?: Partial<Record<SpendingCategoryKey, number>>;
  fact: Fact | null;
}) {
  const { stateOf } = useEvidence();
  const [allOpen, setAllOpen] = useState(false);
  const listId = useId();
  const everyday = categoryShares(month.categories, { excludeSplit: true, counts });
  const all = categoryShares(month.categories, { excludeSplit: false, counts });
  const meta = [
    month.isCurrent ? `${today}일째` : null,
    `${SPLIT_LABEL} 제외 ${formatWon(everyday.base)}`,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <BlockTitle>{month.label} 상위 카테고리</BlockTitle>
        <span className="text-label">{meta}</span>
      </div>
      {everyday.rows.length > 0 ? (
        <div className="flex flex-col gap-1">
          {everyday.rows.slice(0, 3).map((row) => (
            <CategoryRow
              key={row.category}
              label={SPENDING_CATEGORY_LABELS[row.category]}
              leading={<CategoryMark category={row.category} size="sm" />}
              count={row.count ? `${row.count}건` : undefined}
              value={formatWon(row.value)}
              pct={formatCategoryShare(row.share)}
              share={row.width}
              evidence={stateOf(row.category)}
            />
          ))}
        </div>
      ) : (
        <p className="m-0 text-[13px] leading-5 text-ink-2">
          {SPLIT_LABEL} 말고는 기록된 지출이 없어요.
        </p>
      )}
      {month.isCurrent && fact ? <AiLine fact={fact} rows={fact.rows} align="start" /> : null}
      <span className="text-[13px] leading-5 text-ink-2">
        {month.health > 0
          ? `${SPLIT_LABEL} ${formatWon(month.health)} 별도`
          : `이 달은 ${SPLIT_LABEL} 지출이 없었어요`}
      </span>
      {all.rows.length > 0 ? (
        <div className="border-t border-line pt-2">
          <DisclosureButton open={allOpen} onToggle={() => setAllOpen((v) => !v)} controls={listId}>
            카테고리 전체 · {all.rows.length}개
          </DisclosureButton>
          <div id={listId}>
            {allOpen ? (
              <div className="ds-reveal flex flex-col gap-1 pt-2">
                {all.rows.map((row) => {
                  // Same denominator as the top three (spend excluding 의료·건강);
                  // 의료·건강 itself is shown apart, without a share.
                  const split = row.category === SPLIT_CATEGORY;
                  return (
                    <CategoryRow
                      key={row.category}
                      compact
                      label={SPENDING_CATEGORY_LABELS[row.category]}
                      leading={<CategoryMark category={row.category} size="sm" />}
                      count={row.count ? `${row.count}건` : undefined}
                      value={formatWon(row.value)}
                      pct={
                        split || everyday.base <= 0
                          ? undefined
                          : formatCategoryShare(row.value / everyday.base)
                      }
                      share={row.width}
                      color={split ? categoryColor("health") : undefined}
                    />
                  );
                })}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
