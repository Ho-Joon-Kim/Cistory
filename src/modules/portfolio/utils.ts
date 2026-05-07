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
