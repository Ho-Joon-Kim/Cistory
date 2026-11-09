export const EXPENSE_CATEGORIES = [
  "food",
  "cafe",
  "transport",
  "shopping",
  "housing",
  "subscription",
  "health",
  "leisure",
  "education",
  "gift",
  "finance",
  "travel",
  "other",
] as const;

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];
export type SpendingCategoryKey = ExpenseCategory | "uncategorized";
export type CategoryTotals = Partial<Record<SpendingCategoryKey, number>>;

export const EXPENSE_CATEGORY_LABELS: Record<ExpenseCategory, string> = {
  food: "식비",
  cafe: "카페",
  transport: "교통",
  shopping: "쇼핑",
  housing: "주거·생활",
  subscription: "구독",
  health: "의료·건강",
  leisure: "문화·여가",
  education: "교육",
  gift: "경조·선물",
  finance: "금융",
  travel: "여행·숙박",
  other: "기타",
};

export const SPENDING_CATEGORY_LABELS: Record<SpendingCategoryKey, string> = {
  ...EXPENSE_CATEGORY_LABELS,
  uncategorized: "미분류",
};

// Neighbouring categories that read alike (food/cafe, housing/subscription,
// health/leisure, education/travel, shopping/gift) differ in hue *and*
// lightness so the stacked bar and legend swatches stay distinguishable.
export const SPENDING_CATEGORY_COLORS: Record<SpendingCategoryKey, string> = {
  food: "#f97316",
  cafe: "#92400e",
  transport: "#3b82f6",
  shopping: "#ec4899",
  housing: "#8b5cf6",
  subscription: "#3730a3",
  health: "#10b981",
  leisure: "#84cc16",
  education: "#06b6d4",
  gift: "#be123c",
  finance: "#64748b",
  travel: "#eab308",
  other: "#a3a3a3",
  uncategorized: "#d4d4d4",
};

const CATEGORY_SET = new Set<string>(EXPENSE_CATEGORIES);

export function isExpenseCategory(value: unknown): value is ExpenseCategory {
  return typeof value === "string" && CATEGORY_SET.has(value);
}
