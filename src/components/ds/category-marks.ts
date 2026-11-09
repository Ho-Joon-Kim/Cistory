import type { SpendingCategoryKey } from "@/modules/spending/categories";

/**
 * Line pictograms for the 14 spending categories (CategoryMarks option B): a 20px
 * grid, 1.75 stroke, round caps/joins. `uncategorized` is a dashed circle.
 */
export const CATEGORY_MARK_PATHS: Record<SpendingCategoryKey, string> = {
  food: "M3.5 10.5h13a6.5 6.5 0 0 1-13 0zM8 8l4.75-5M11.25 8 16 3.25",
  cafe: "M4.5 8h8.5v4.25a4.25 4.25 0 0 1-4.25 4.25h0A4.25 4.25 0 0 1 4.5 12.25zM13 9.25h.75a2.25 2.25 0 0 1 0 4.5H13M7.5 2.75v2.5M10.25 2.75v2.5",
  transport:
    "M7 3h6a2.5 2.5 0 0 1 2.5 2.5v7.5a2 2 0 0 1-2 2h-7a2 2 0 0 1-2-2V5.5A2.5 2.5 0 0 1 7 3zM4.5 9h11M7.5 12h.01M12.5 12h.01M6.5 15v2M13.5 15v2",
  shopping:
    "M5 7.25h10l-.75 8.85a1.5 1.5 0 0 1-1.5 1.4h-5.5a1.5 1.5 0 0 1-1.5-1.4zM7.75 9.5V5.75a2.25 2.25 0 0 1 4.5 0V9.5",
  housing: "M3.5 9.25 10 3.75l6.5 5.5M5.5 7.75v8.75h9V7.75M8.5 16.5v-3.75h3v3.75",
  subscription: "M16.25 10A6.25 6.25 0 1 1 14.4 5.6M16.25 3.25v3.5h-3.5M10 7v3.25l2 1.25",
  health: "M8.25 3.5h3.5v4.75h4.75v3.5h-4.75v4.75h-3.5v-4.75H3.5v-3.5h4.75z",
  leisure:
    "M4.5 5.5h11a1 1 0 0 1 1 1v1.75a1.75 1.75 0 0 0 0 3.5v1.75a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1v-1.75a1.75 1.75 0 0 0 0-3.5V6.5a1 1 0 0 1 1-1zM12.25 8v.01M12.25 10v.01M12.25 12v.01",
  education:
    "M10 5.75C8.4 4.5 6.2 4 3.5 4.25v10c2.7-.25 4.9.25 6.5 1.5 1.6-1.25 3.8-1.75 6.5-1.5v-10C13.8 4 11.6 4.5 10 5.75zM10 5.75v10",
  gift: "M4.5 9.5h11v6a1.5 1.5 0 0 1-1.5 1.5H6a1.5 1.5 0 0 1-1.5-1.5zM3.75 6.75h12.5v2.75H3.75zM10 6.75V17M10 6.75C9 4.25 6.25 3.75 6.25 5.25 6.25 6.5 10 6.75 10 6.75zM10 6.75c1-2.5 3.75-3 3.75-1.5 0 1.25-3.75 1.5-3.75 1.5z",
  finance:
    "M4.5 6c0-1.24 2.46-2.25 5.5-2.25s5.5 1.01 5.5 2.25-2.46 2.25-5.5 2.25S4.5 7.24 4.5 6zM4.5 6v4c0 1.24 2.46 2.25 5.5 2.25s5.5-1.01 5.5-2.25V6M4.5 10v4c0 1.24 2.46 2.25 5.5 2.25s5.5-1.01 5.5-2.25v-4",
  travel:
    "M6 6.5h8a1.75 1.75 0 0 1 1.75 1.75v6.5A1.75 1.75 0 0 1 14 16.5H6a1.75 1.75 0 0 1-1.75-1.75v-6.5A1.75 1.75 0 0 1 6 6.5zM8 6.5V4.75a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1V6.5M8 9.5v4M12 9.5v4",
  other:
    "M4 10a1.25 1.25 0 1 0 2.5 0 1.25 1.25 0 1 0-2.5 0zM8.75 10a1.25 1.25 0 1 0 2.5 0 1.25 1.25 0 1 0-2.5 0zM13.5 10a1.25 1.25 0 1 0 2.5 0 1.25 1.25 0 1 0-2.5 0z",
  uncategorized: "M10 3.75a6.25 6.25 0 1 1 0 12.5 6.25 6.25 0 1 1 0-12.5z",
};

/** Grey marks for ledger rows that carry no spending category. */
export type LedgerMarkKind = "deposit" | "refund" | "self_transfer";

export const LEDGER_MARK_PATHS: Record<LedgerMarkKind, string> = {
  deposit: "M10 3.5v9M6 8.75l4 4 4-4M4.5 16.5h11",
  refund: "M7.5 4.75 4 8.25l3.5 3.5M4 8.25h8a4 4 0 0 1 0 8H9",
  self_transfer: "M4 7h11.5M12.5 4l3 3-3 3M16 13H4.5M7.5 10l-3 3 3 3",
};

export const LEDGER_MARK_LABELS: Record<LedgerMarkKind, string> = {
  deposit: "입금",
  refund: "환불",
  self_transfer: "내 계좌 이체",
};

/** CSS color of a category (theme-aware): `var(--cat-food)`. Works as an SVG fill. */
export function categoryColor(category: SpendingCategoryKey): string {
  return `var(--cat-${category})`;
}

/** Pale tint of a category for fills behind text: `var(--cat-food-tint)`. */
export function categoryTint(category: SpendingCategoryKey): string {
  return `var(--cat-${category}-tint)`;
}
