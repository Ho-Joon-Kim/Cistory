// ============ Forecast Input/Output Types ============

export interface MonthlyTotal {
  /** "YYYY-MM" */
  month: string;
  total: number;
}

export interface DailySpending {
  /** "YYYY-MM-DD" */
  date: string;
  /** 0=Sunday, 1=Monday, ..., 6=Saturday */
  dayOfWeek: number;
  total: number;
}

export interface ForecastInput {
  monthlyHistory: MonthlyTotal[];
  currentMonthDays: DailySpending[];
  historicalDays?: DailySpending[];
  daysInMonth: number;
  todayDayNumber: number; // 1-indexed
}

export interface DailyCumulativePrediction {
  day: number; // 1-indexed
  mid: number;
  upper: number;
  lower: number;
}

export type AlgorithmTier = "proportional" | "ses" | "weekday-holt" | "bayesian-holt";

export interface ForecastResult {
  predictedTotal: number;
  upperBound: number;
  lowerBound: number;
  algorithmTier: AlgorithmTier;
  dailyPredictions: DailyCumulativePrediction[];
}

// ============ API Response Types ============

export interface CumulativeDataPoint {
  day: number;
  actual: number | null;
  mid: number | null;
  upper: number | null;
  lower: number | null;
}

export interface MonthlyBarDataPoint {
  month: string;
  total: number;
  isCurrent: boolean;
  predicted?: number;
}

export interface SpendingTrendResponse {
  cumulativeCurve: CumulativeDataPoint[];
  monthlyBars: MonthlyBarDataPoint[];
  forecast: {
    predictedTotal: number;
    upperBound: number;
    lowerBound: number;
    algorithmTier: AlgorithmTier;
    todayDayNumber: number;
    daysInMonth: number;
    currentMonthActualTotal: number;
  };
}
