export function formatKRW(
  value: number,
  options: { compact?: boolean; sign?: boolean } = {}
): string {
  const sign = options.sign && value > 0 ? "+" : "";
  if (options.compact && Math.abs(value) >= 10000) {
    const fmt = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 0 });
    if (Math.abs(value) >= 100_000_000) {
      return `${sign}${fmt.format(Math.round(value / 100_000_000))}억`;
    }
    if (Math.abs(value) >= 10000) {
      return `${sign}${fmt.format(Math.round(value / 10000))}만`;
    }
  }
  return `${sign}₩${new Intl.NumberFormat("ko-KR").format(Math.round(value))}`;
}

export function formatPercent(value: number | null, fractionDigits = 2): string {
  if (value === null) return "—";
  return `${value > 0 ? "+" : ""}${value.toFixed(fractionDigits)}%`;
}

export const ACCOUNT_TYPE_LABEL: Record<string, string> = {
  general: "일반 위탁",
  isa_brokerage: "ISA 중개형",
  irp: "퇴직연금 (IRP)",
  pension: "개인연금",
};

export function pnlColorClass(value: number): string {
  if (value > 0) return "text-red-600 dark:text-red-400";
  if (value < 0) return "text-blue-600 dark:text-blue-400";
  return "text-muted-foreground";
}

const CATEGORY_RULES: Array<{ pattern: RegExp; category: string }> = [
  { pattern: /나스닥|S&P|미국|S&P|NASDAQ/i, category: "미국주식" },
  { pattern: /AI|반도체|테크|빅테크/i, category: "AI/반도체" },
  { pattern: /테슬라|TSLA/i, category: "테슬라" },
  { pattern: /채권|미국채|국채|크레딧/i, category: "채권" },
  { pattern: /리츠|REIT/i, category: "리츠" },
  { pattern: /금|GOLD/i, category: "금/원자재" },
  { pattern: /배당/i, category: "배당주" },
  { pattern: /KOSPI200|코스피200/i, category: "한국주식" },
];

export function inferCategory(name: string): string {
  for (const { pattern, category } of CATEGORY_RULES) {
    if (pattern.test(name)) return category;
  }
  return "기타";
}

// Shared color palette for portfolio charts (donut/pie/bar)
// Order: blue, green, orange, purple, cyan, yellow, pink, slate
export const CHART_COLORS = [
  "#2563eb",
  "#10b981",
  "#f59e0b",
  "#8b5cf6",
  "#06b6d4",
  "#eab308",
  "#ec4899",
  "#64748b",
] as const;

/**
 * KST-safe date parser. CLAUDE.md 라인 319: `new Date("YYYY-MM-DD")`는 UTC로
 * 파싱돼 한국 기준 하루 어긋남이 발생. 항상 local-midnight로 파싱한다.
 */
export function parseKstDate(ymd: string): Date {
  const y = Number(ymd.slice(0, 4));
  const m = Number(ymd.slice(5, 7));
  const d = Number(ymd.slice(8, 10));
  return new Date(y, m - 1, d);
}

function todayKstYmd(): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(new Date());
}

export interface InflationAdjustedResult {
  years: number;
  inflated: number;
  realGain: number;
  realGainRate: number | null;
  outperformedInflation: boolean;
}

export function computeInflationAdjusted(params: {
  startPurchase: number;
  startDate: string;
  currentTotal: number;
  inflationRate: number;
  endDate?: string;
}): InflationAdjustedResult {
  const startMs = parseKstDate(params.startDate).getTime();
  const endMs = parseKstDate(params.endDate ?? todayKstYmd()).getTime();
  const years = Math.max(0, (endMs - startMs) / (365.25 * 86_400_000));
  const inflated = params.startPurchase * (1 + params.inflationRate) ** years;
  const realGain = params.currentTotal - inflated;
  const realGainRate = inflated > 0 ? (realGain / inflated) * 100 : null;
  return {
    years,
    inflated,
    realGain,
    realGainRate,
    outperformedInflation: realGain > 0,
  };
}

export interface RebalanceInputPosition {
  ticker: string;
  name: string;
  quantity: number;
  currentPrice: number;
  evalAmount: number;
}

export interface RebalanceInputTarget {
  ticker: string;
  name: string;
  targetWeight: number; // 0~1
}

export interface RebalanceInput {
  positions: RebalanceInputPosition[];
  targets: RebalanceInputTarget[];
  cashToInvest: number;
}

export type RebalanceStatus = "buy" | "hold" | "missing-price";

export interface RebalanceRow {
  ticker: string;
  name: string;
  currentWeight: number;
  targetWeight: number;
  currentEval: number;
  targetEval: number;
  diffAmount: number;
  buyAmount: number;
  buyShares: number;
  actualBuyAmount: number;
  currentPrice: number;
  status: RebalanceStatus;
}

export interface RebalanceResult {
  rows: RebalanceRow[];
  totalCurrent: number;
  totalAfter: number;
  totalActualBuy: number;
  remainingCash: number;
  warnings: string[];
}

export function computeRebalance(input: RebalanceInput): RebalanceResult {
  const totalCurrent = input.positions.reduce((s, p) => s + p.evalAmount, 0);
  const totalAfter = totalCurrent + Math.max(0, input.cashToInvest);

  const posMap = new Map(input.positions.map((p) => [p.ticker, p]));
  const tgtMap = new Map(input.targets.map((t) => [t.ticker, t]));
  const tickers = new Set<string>([...posMap.keys(), ...tgtMap.keys()]);

  const warnings: string[] = [];
  const rows: RebalanceRow[] = [];

  for (const ticker of tickers) {
    const pos = posMap.get(ticker);
    const tgt = tgtMap.get(ticker);
    const currentEval = pos?.evalAmount ?? 0;
    const targetWeight = tgt?.targetWeight ?? 0;
    const targetEval = totalAfter * targetWeight;
    const diffAmount = targetEval - currentEval;
    const buyAmount = Math.max(0, diffAmount);
    const currentPrice = pos?.currentPrice ?? 0;
    const name = pos?.name ?? tgt?.name ?? ticker;

    let status: RebalanceStatus;
    let buyShares = 0;
    let actualBuyAmount = 0;

    if (currentPrice > 0) {
      buyShares = Math.floor(buyAmount / currentPrice);
      actualBuyAmount = buyShares * currentPrice;
      status = buyShares > 0 ? "buy" : "hold";
    } else if (buyAmount > 0) {
      status = "missing-price";
      warnings.push(`${name} (${ticker}): 현재가 정보가 없어 매수 수량 계산 불가`);
    } else {
      status = "hold";
    }

    rows.push({
      ticker,
      name,
      currentWeight: totalCurrent > 0 ? currentEval / totalCurrent : 0,
      targetWeight,
      currentEval,
      targetEval,
      diffAmount,
      buyAmount,
      buyShares,
      actualBuyAmount,
      currentPrice,
      status,
    });
  }

  rows.sort((a, b) => b.targetWeight - a.targetWeight);
  const totalActualBuy = rows.reduce((s, r) => s + r.actualBuyAmount, 0);

  return {
    rows,
    totalCurrent,
    totalAfter,
    totalActualBuy,
    remainingCash: Math.max(0, input.cashToInvest) - totalActualBuy,
    warnings,
  };
}
