import { isExpenseCategory, SPENDING_CATEGORY_LABELS } from "@/modules/spending/categories";

/** Korean label of a transaction category; null/unknown → 미분류 or the raw key. */
export function categoryLabel(category: string | null): string {
  if (!category || category === "uncategorized") return SPENDING_CATEGORY_LABELS.uncategorized;
  return isExpenseCategory(category) ? SPENDING_CATEGORY_LABELS[category] : category;
}
