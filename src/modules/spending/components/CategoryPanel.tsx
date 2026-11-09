"use client";

import { useId, useState } from "react";
import { AiLine, CategoryMark, categoryColor, ShareRow, useEvidence } from "@/components/ds";
import type { Fact } from "@/lib/facts/types";
import { formatShare, formatWon } from "@/lib/format";
import { SPENDING_CATEGORY_LABELS, type SpendingCategoryKey } from "../categories";
import { categoryShares, type MonthBar, SPLIT_LABEL } from "../view-model";
import { BlockTitle, DisclosureButton } from "./parts";

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
            <ShareRow
              key={row.category}
              label={SPENDING_CATEGORY_LABELS[row.category]}
              leading={<CategoryMark category={row.category} size="sm" />}
              count={row.count ? `${row.count}건` : undefined}
              value={formatWon(row.value)}
              pct={formatShare(row.share)}
              share={row.width}
              evidence={stateOf(row.category)}
              className="h-9 text-sm"
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
                {all.rows.map((row) => (
                  <ShareRow
                    key={row.category}
                    label={SPENDING_CATEGORY_LABELS[row.category]}
                    leading={<CategoryMark category={row.category} size="sm" />}
                    count={row.count ? `${row.count}건` : undefined}
                    value={formatWon(row.value)}
                    pct={formatShare(row.share)}
                    share={row.width}
                    color={row.category === "health" ? categoryColor("health") : undefined}
                    className="h-8"
                  />
                ))}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
