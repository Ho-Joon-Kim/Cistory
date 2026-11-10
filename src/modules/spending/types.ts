import type { CategoryTotals } from "./categories";

// ============ Forecast Input/Output Types ============

export interface MonthlyTotal {
  /** "YYYY-MM" */
  month: string;
  total: number;
  categories?: CategoryTotals;
}

export interface DailySpending {
  /** "YYYY-MM-DD" */
  date: string;
  /** 0=Sunday, 1=Monday, ..., 6=Saturday */
  dayOfWeek: number;
  total: number;
  categories?: CategoryTotals;
}

export interface ForecastInput {
  monthlyHistory: MonthlyTotal[];
  currentMonthDays: DailySpending[];
  /** Individual spending amounts this month to date, for one-off detection. */
  currentMonthAmounts?: number[];
  daysInMonth: number;
  todayDayNumber: number; // 1-indexed
}

export interface DailyCumulativePrediction {
  day: number; // 1-indexed
  mid: number;
  upper: number;
  lower: number;
}

export interface ForecastResult {
  predictedTotal: number;
  upperBound: number;
  lowerBound: number;
  dailyPredictions: DailyCumulativePrediction[];
  /** Sum of this month's one-off charges, added back once instead of extrapolated. */
  oneOffTotal: number;
  oneOffCount: number;
  /** A single charge above this is a one-off; null without history. */
  oneOffThreshold: number | null;
}

// ============ API Response Types ============

export interface CumulativeDataPoint {
  day: number;
  actual: number | null;
  mid: number | null;
  upper: number | null;
  lower: number | null;
  categories: CategoryTotals;
}

export interface MonthlyBarDataPoint {
  /** "MM" */
  month: string;
  /** "YYYY-MM" — `month` alone repeats across a 13-month window. */
  key: string;
  total: number;
  isCurrent: boolean;
  predicted?: number;
  categories: CategoryTotals;
}

/**
 * A settled month's (or months' average) cumulative spending, indexed day-1
 * over the CURRENT month's length. `split` is the 의료·건강 part of `total`.
 */
export interface ReferenceCurve {
  /** "YYYY-MM" — one month, or the months averaged (ascending). */
  months: string[];
  total: number[];
  split: number[];
}

export interface SpendingReferences {
  previous: ReferenceCurve | null;
  average: ReferenceCurve | null;
}

export interface SpendingTrendResponse {
  cumulativeCurve: CumulativeDataPoint[];
  /** Reference lines for the cumulative chart (absent from older responses). */
  references?: SpendingReferences;
  monthlyBars: MonthlyBarDataPoint[];
  forecast: {
    predictedTotal: number;
    upperBound: number;
    lowerBound: number;
    todayDayNumber: number;
    daysInMonth: number;
    currentMonthActualTotal: number;
    /** One-off charges this month (see forecastMonthEnd); 0 when none. */
    oneOffTotal: number;
    oneOffCount: number;
    oneOffThreshold: number | null;
  };
}
