import type {
  DailyCumulativePrediction,
  ForecastInput,
  ForecastResult,
  MonthlyTotal,
} from "./types";

/**
 * Month-end spending forecast.
 *
 * Previous implementation had four tiers (proportional → SES → weekday-weighted
 * Holt → Bayesian Holt). For a single-user diary-style spending dataset with
 * only a handful of samples per weekday, the advanced tiers' accuracy lift is
 * indistinguishable from noise — they produced plausible-looking numbers but
 * were not empirically more accurate than simple proportional extrapolation.
 *
 * Keep it simple: scale current cumulative by days-remaining, then derive a
 * confidence band from the stddev of past monthly totals (when available).
 *
 * One-off large charges (a single transaction above `oneOffThreshold`) are not
 * a run-rate: they are added back once instead of being extrapolated, so one
 * 1,800,000원 payment on day 4 doesn't project as ~6M by month end.
 */
export function forecastMonthEnd(input: ForecastInput): ForecastResult {
  const { monthlyHistory, currentMonthDays, daysInMonth, todayDayNumber } = input;

  const currentTotal = currentMonthDays.reduce((s, d) => s + d.total, 0);

  // Month end — the answer is the actual number.
  if (todayDayNumber >= daysInMonth) {
    return {
      predictedTotal: currentTotal,
      upperBound: currentTotal,
      lowerBound: currentTotal,
      dailyPredictions: [],
    };
  }

  // No data at all
  if (currentMonthDays.length === 0 && monthlyHistory.length === 0) {
    return {
      predictedTotal: 0,
      upperBound: 0,
      lowerBound: 0,
      dailyPredictions: buildDailyPredictions(0, 0, 0, 0, todayDayNumber, daysInMonth),
    };
  }

  const threshold = oneOffThreshold(monthlyHistory);
  const oneOffTotal =
    threshold === null
      ? 0
      : (input.currentMonthAmounts ?? [])
          .filter((amount) => amount > threshold)
          .reduce((s, amount) => s + amount, 0);
  const runRateTotal = Math.max(currentTotal - oneOffTotal, 0);

  const ratio = daysInMonth / Math.max(todayDayNumber, 1);
  const predicted = oneOffTotal + Math.round(runRateTotal * ratio);

  const { upper, lower } = confidenceBand(
    predicted,
    currentTotal,
    todayDayNumber,
    daysInMonth,
    monthlyHistory
  );

  return {
    predictedTotal: predicted,
    upperBound: upper,
    lowerBound: lower,
    dailyPredictions: buildDailyPredictions(
      currentTotal,
      predicted,
      upper,
      lower,
      todayDayNumber,
      daysInMonth
    ),
  };
}

/**
 * A single transaction larger than this is a one-off. 20% of the median past
 * monthly total: backtested on the owner's 2026-03..10 data (every completed
 * month, forecast made on days 3..end-1), fractions 0.15–0.5 all gave the same
 * best error (median APE 0.253 vs 0.284 naive; days 3–10: 0.346 vs 0.514)
 * because everyday purchases top out near 450k while one-offs start at 720k.
 * 0.2 sits inside that plateau. Null without history (nothing to compare to).
 */
export function oneOffThreshold(history: MonthlyTotal[]): number | null {
  const totals = history.map((m) => m.total).sort((a, b) => a - b);
  if (totals.length === 0) return null;
  const mid = Math.floor(totals.length / 2);
  const median = totals.length % 2 === 0 ? (totals[mid - 1] + totals[mid]) / 2 : totals[mid];
  return Math.round(ONE_OFF_FRACTION_OF_MEDIAN_MONTH * median);
}

const ONE_OFF_FRACTION_OF_MEDIAN_MONTH = 0.2;

function confidenceBand(
  predicted: number,
  currentTotal: number,
  todayDay: number,
  daysInMonth: number,
  history: MonthlyTotal[]
): { upper: number; lower: number } {
  // Use coefficient of variation of past monthly totals as the uncertainty
  // scale. Falls back to ±30% when we don't have enough history.
  const totals = history.map((m) => m.total);
  const cv = totals.length >= 2 ? stddev(totals) / Math.max(mean(totals), 1) : 0.3;
  // Uncertainty shrinks as the month progresses (sqrt of remaining fraction).
  const remainingFraction = Math.sqrt((daysInMonth - todayDay) / Math.max(daysInMonth, 1));
  const spread = predicted * cv * remainingFraction;

  return {
    upper: Math.round(predicted + spread),
    lower: Math.max(currentTotal, Math.round(predicted - spread)),
  };
}

function buildDailyPredictions(
  currentTotal: number,
  predicted: number,
  upper: number,
  lower: number,
  todayDay: number,
  daysInMonth: number
): DailyCumulativePrediction[] {
  const remaining = daysInMonth - todayDay;
  if (remaining <= 0) return [];

  const predictions: DailyCumulativePrediction[] = [];
  for (let d = todayDay + 1; d <= daysInMonth; d++) {
    const progress = (d - todayDay) / remaining;
    predictions.push({
      day: d,
      mid: Math.round(currentTotal + (predicted - currentTotal) * progress),
      upper: Math.round(currentTotal + (upper - currentTotal) * progress),
      lower: Math.round(currentTotal + (lower - currentTotal) * progress),
    });
  }

  return predictions;
}

function mean(arr: number[]): number {
  return arr.length === 0 ? 0 : arr.reduce((a, b) => a + b, 0) / arr.length;
}

function stddev(arr: number[]): number {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / (arr.length - 1));
}
