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

export const SPENDING_CATEGORY_COLORS: Record<SpendingCategoryKey, string> = {
  food: "#f97316",
  cafe: "#d97706",
  transport: "#3b82f6",
  shopping: "#ec4899",
  housing: "#8b5cf6",
  subscription: "#6366f1",
  health: "#10b981",
  leisure: "#14b8a6",
  education: "#06b6d4",
  gift: "#f43f5e",
  finance: "#64748b",
  travel: "#0ea5e9",
  other: "#a3a3a3",
  uncategorized: "#d4d4d4",
};

const CATEGORY_SET = new Set<string>(EXPENSE_CATEGORIES);

export function isExpenseCategory(value: unknown): value is ExpenseCategory {
  return typeof value === "string" && CATEGORY_SET.has(value);
}
