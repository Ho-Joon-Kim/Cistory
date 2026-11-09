import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";
import { SPENDING_CATEGORY_LABELS, type SpendingCategoryKey } from "@/modules/spending/categories";
import {
  CATEGORY_MARK_PATHS,
  categoryColor,
  LEDGER_MARK_LABELS,
  LEDGER_MARK_PATHS,
  type LedgerMarkKind,
} from "./category-marks";

function MarkTile({
  path,
  color,
  size,
  dashed,
  title,
  className,
}: {
  path: string;
  color: string;
  size: "md" | "sm";
  dashed?: boolean;
  title?: string;
  className?: string;
}) {
  const tileClass = cn("ds-cmk", size === "sm" && "is-sm", className);
  const style = { "--cc": color } as CSSProperties;
  const glyph = (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d={path} strokeDasharray={dashed ? "2.1 2.5" : undefined} />
    </svg>
  );
  if (title) {
    return (
      <span className={tileClass} style={style} role="img" aria-label={title}>
        {glyph}
      </span>
    );
  }
  return (
    <span className={tileClass} style={style} aria-hidden="true">
      {glyph}
    </span>
  );
}

/**
 * Spending category pictogram on a squircle tile tinted 12% of the category
 * color. `md` (28) for ledger rows, `sm` (20) for rankings, legends, tooltips.
 * Decorative by default (the row already names the category); pass `labelled`
 * to expose the category name as an image label.
 */
export function CategoryMark({
  category,
  size = "md",
  labelled = false,
  className,
}: {
  category: SpendingCategoryKey;
  size?: "md" | "sm";
  labelled?: boolean;
  className?: string;
}) {
  return (
    <MarkTile
      path={CATEGORY_MARK_PATHS[category]}
      color={categoryColor(category)}
      size={size}
      dashed={category === "uncategorized"}
      title={labelled ? SPENDING_CATEGORY_LABELS[category] : undefined}
      className={className}
    />
  );
}

/** Grey mark (--ink3) for rows without a category: 입금 · 환불 · 내 계좌 이체. */
export function LedgerMark({
  kind,
  size = "md",
  labelled = false,
  className,
}: {
  kind: LedgerMarkKind;
  size?: "md" | "sm";
  labelled?: boolean;
  className?: string;
}) {
  return (
    <MarkTile
      path={LEDGER_MARK_PATHS[kind]}
      color="var(--ink3)"
      size={size}
      title={labelled ? LEDGER_MARK_LABELS[kind] : undefined}
      className={className}
    />
  );
}
