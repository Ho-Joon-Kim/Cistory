import type {
  ForecastInput,
  ForecastResult,
  DailyCumulativePrediction,
  DailySpending,
  MonthlyTotal,
} from "./types";

// ============ Main Entry ============

export function forecastMonthEnd(input: ForecastInput): ForecastResult {
  const { monthlyHistory, currentMonthDays, daysInMonth, todayDayNumber } = input;

  // Edge case: no data at all
  if (currentMonthDays.length === 0 && monthlyHistory.length === 0) {
    return zeroResult("proportional", daysInMonth, todayDayNumber);
  }

  const currentTotal = currentMonthDays.reduce((s, d) => s + d.total, 0);

  // Edge case: month end — just return actual
  if (todayDayNumber >= daysInMonth) {
    return {
      predictedTotal: currentTotal,
      upperBound: currentTotal,
      lowerBound: currentTotal,
      algorithmTier: "proportional",
      dailyPredictions: [],
    };
  }

  const histLen = monthlyHistory.length;

  if (histLen < 1) {
    return proportionalExtrapolation(input, currentTotal);
  }
  if (histLen < 3) {
    return sesExtrapolation(input, currentTotal);
  }
  if (histLen < 6) {
    return weekdayWeightedHolt(input, currentTotal);
  }
  return bayesianHolt(input, currentTotal);
}

// ============ Tier 1: Proportional ============

function proportionalExtrapolation(input: ForecastInput, currentTotal: number): ForecastResult {
  const { daysInMonth, todayDayNumber } = input;
  const ratio = daysInMonth / Math.max(todayDayNumber, 1);
  const predicted = Math.round(currentTotal * ratio);
  const { upper, lower } = computeConfidenceBand(predicted, currentTotal, todayDayNumber, daysInMonth, []);

  return {
    predictedTotal: predicted,
    upperBound: upper,
    lowerBound: lower,
    algorithmTier: "proportional",
    dailyPredictions: buildDailyPredictions(currentTotal, predicted, upper, lower, todayDayNumber, daysInMonth),
  };
}

// ============ Tier 2: SES ============

function sesExtrapolation(input: ForecastInput, currentTotal: number): ForecastResult {
  const { monthlyHistory, daysInMonth, todayDayNumber } = input;
  const alpha = 0.3;

  // Compute daily averages from history
  const dailyAvgs = monthlyHistory.map((m) => m.total / daysInMonthForYYYYMM(m.month));
  let level = dailyAvgs[0];
  for (let i = 1; i < dailyAvgs.length; i++) {
    level = alpha * dailyAvgs[i] + (1 - alpha) * level;
  }

  // Blend SES forecast with proportional
  const sesPredicted = currentTotal + level * (daysInMonth - todayDayNumber);
  const propPredicted = currentTotal * (daysInMonth / Math.max(todayDayNumber, 1));
  const weight = Math.min(todayDayNumber / daysInMonth, 0.7);
  const predicted = Math.round(weight * propPredicted + (1 - weight) * sesPredicted);

  const { upper, lower } = computeConfidenceBand(predicted, currentTotal, todayDayNumber, daysInMonth, monthlyHistory);

  return {
    predictedTotal: predicted,
    upperBound: upper,
    lowerBound: lower,
    algorithmTier: "ses",
    dailyPredictions: buildDailyPredictions(currentTotal, predicted, upper, lower, todayDayNumber, daysInMonth),
  };
}

// ============ Tier 3: Weekday-Weighted Holt ============

function weekdayWeightedHolt(input: ForecastInput, currentTotal: number): ForecastResult {
  const { monthlyHistory, historicalDays, daysInMonth, todayDayNumber } = input;
  const weights = computeWeekdayWeights(historicalDays || []);
  const holt = holtsLinearTrend(monthlyHistory.map((m) => m.total), 0.3, 0.1);

  // Base daily rate from Holt's forecast
  const holtMonthForecast = holt.forecast(1);
  const baseDailyRate = holtMonthForecast / daysInMonth;

  // Apply weekday weights to remaining days
  let remainingPredicted = 0;
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  for (let d = todayDayNumber + 1; d <= daysInMonth; d++) {
    const dow = new Date(year, month, d).getDay();
    remainingPredicted += baseDailyRate * weights[dow];
  }

  const predicted = Math.round(currentTotal + remainingPredicted);
  const { upper, lower } = computeConfidenceBand(predicted, currentTotal, todayDayNumber, daysInMonth, monthlyHistory);

  return {
    predictedTotal: predicted,
    upperBound: upper,
    lowerBound: lower,
    algorithmTier: "weekday-holt",
    dailyPredictions: buildDailyPredictions(currentTotal, predicted, upper, lower, todayDayNumber, daysInMonth),
  };
}

// ============ Tier 4: Bayesian Holt ============

function bayesianHolt(input: ForecastInput, currentTotal: number): ForecastResult {
  const { monthlyHistory, historicalDays, daysInMonth, todayDayNumber } = input;
  const weights = computeWeekdayWeights(historicalDays || []);
  const holt = holtsLinearTrend(monthlyHistory.map((m) => m.total), 0.3, 0.1);

  // Prior: Holt's forecast
  const priorMean = holt.forecast(1);
  const totals = monthlyHistory.map((m) => m.total);
  const priorStd = Math.max(stddev(totals), priorMean * 0.1);

  // Likelihood: extrapolate from current data
  const dailyRate = currentTotal / Math.max(todayDayNumber, 1);
  let remainingWeighted = 0;
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  for (let d = todayDayNumber + 1; d <= daysInMonth; d++) {
    const dow = new Date(year, month, d).getDay();
    remainingWeighted += weights[dow];
  }
  const likelihoodMean = currentTotal + dailyRate * remainingWeighted;
  // Likelihood uncertainty decreases as more days pass
  const likelihoodStd = priorStd * Math.sqrt((daysInMonth - todayDayNumber) / daysInMonth);

  // Bayesian update (conjugate normal)
  const priorPrec = 1 / (priorStd * priorStd);
  const likePrec = 1 / (likelihoodStd * likelihoodStd + 1); // +1 to avoid division by 0
  const postPrec = priorPrec + likePrec;
  const postMean = (priorPrec * priorMean + likePrec * likelihoodMean) / postPrec;
  const postStd = Math.sqrt(1 / postPrec);

  const predicted = Math.round(postMean);
  const upper = Math.round(postMean + 1.64 * postStd); // ~90% CI
  const lower = Math.max(currentTotal, Math.round(postMean - 1.64 * postStd));

  return {
    predictedTotal: predicted,
    upperBound: upper,
    lowerBound: lower,
    algorithmTier: "bayesian-holt",
    dailyPredictions: buildDailyPredictions(currentTotal, predicted, upper, lower, todayDayNumber, daysInMonth),
  };
}

// ============ Utilities ============

function holtsLinearTrend(values: number[], alpha: number, beta: number) {
  if (values.length === 0) {
    return { level: 0, trend: 0, forecast: () => 0 };
  }
  if (values.length === 1) {
    return { level: values[0], trend: 0, forecast: (h: number) => values[0] };
  }

  let level = values[0];
  let trend = values[1] - values[0];

  for (let i = 1; i < values.length; i++) {
    const prevLevel = level;
    level = alpha * values[i] + (1 - alpha) * (level + trend);
    trend = beta * (level - prevLevel) + (1 - beta) * trend;
  }

  return {
    level,
    trend,
    forecast: (h: number) => Math.max(0, level + h * trend),
  };
}

export function computeWeekdayWeights(dailyHistory: DailySpending[]): number[] {
  const sums = new Array(7).fill(0);
  const counts = new Array(7).fill(0);

  for (const d of dailyHistory) {
    sums[d.dayOfWeek] += d.total;
    counts[d.dayOfWeek] += 1;
  }

  const avgs = sums.map((s, i) => (counts[i] > 0 ? s / counts[i] : 0));
  const mean = avgs.reduce((a, b) => a + b, 0) / 7;

  if (mean === 0) return new Array(7).fill(1);
  return avgs.map((a) => a / mean);
}

function computeConfidenceBand(
  predicted: number,
  currentTotal: number,
  todayDay: number,
  daysInMonth: number,
  history: MonthlyTotal[],
): { upper: number; lower: number } {
  const totals = history.map((m) => m.total);
  const cv = totals.length >= 2 ? stddev(totals) / Math.max(mean(totals), 1) : 0.3;
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
  daysInMonth: number,
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

function zeroResult(
  tier: ForecastResult["algorithmTier"],
  daysInMonth: number,
  todayDay: number,
): ForecastResult {
  return {
    predictedTotal: 0,
    upperBound: 0,
    lowerBound: 0,
    algorithmTier: tier,
    dailyPredictions: buildDailyPredictions(0, 0, 0, 0, todayDay, daysInMonth),
  };
}

function mean(arr: number[]): number {
  return arr.length === 0 ? 0 : arr.reduce((a, b) => a + b, 0) / arr.length;
}

function stddev(arr: number[]): number {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / (arr.length - 1));
}

function daysInMonthForYYYYMM(ym: string): number {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m, 0).getDate();
}
