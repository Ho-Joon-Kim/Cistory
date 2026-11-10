/**
 * Template-first AI lines for /portfolio. Each builder turns already-computed
 * numbers into one candidate {@link Fact} (sentence template + popover rows +
 * evidence keys) or null when nothing is notable — the page then renders no line
 * at all. Numbers are formatted here, never typed into templates, so a future
 * LLM chooser can rephrase `template` without touching a figure.
 */
import { hasBatchim, iGa } from "@/lib/facts/template";
import type { Fact, FactRow } from "@/lib/facts/types";
import { formatMonthDay, formatReturn, formatShare, formatWon } from "@/lib/format";
import { type DriftRow, shortName } from "./view-model";

/** `을` after a final consonant, else `를`. */
const eulReul = (w: string) => (hasBatchim(w) ? "을" : "를");

/** `으로` after a final consonant other than ㄹ, else `로` (`금현물로`, `원으로`). */
export function euro(word: string): string {
  const last = word.trim().slice(-1);
  const code = last.charCodeAt(0) - 0xac00;
  if (code >= 0 && code <= 11171) {
    const jong = code % 28;
    return jong === 0 || jong === 8 ? "로" : "으로";
  }
  return hasBatchim(word) ? "으로" : "로";
}

const signedWon = (n: number) => formatWon(n, { sign: true });

export const evidenceKey = {
  account: (accountId: string) => `acct:${accountId}`,
  position: (accountId: string, ticker: string) => `pos:${accountId}:${ticker}`,
  drift: (accountId: string, ticker: string) => `drift:${accountId}:${ticker}`,
  cashflows: "chart:cashflows",
};

interface Period {
  from: string;
  to: string;
  label: string;
}

// ── hero: which account carried the result ───────────────────────────────────

export interface HeroAccount {
  id: string;
  label: string;
  pnl: number;
  /** Ratio (0.4854 = +48.54%). */
  rate: number;
}

export interface HeroPosition {
  accountId: string;
  accountLabel: string;
  name: string;
  pnl: number;
}

export function heroFact(input: {
  accounts: ReadonlyArray<HeroAccount>;
  positions: ReadonlyArray<HeroPosition>;
  totalPnl: number;
  totalPurchase: number;
  asOf: Period;
  syncedAt: string | null;
}): Fact | null {
  const { accounts, positions, totalPnl } = input;
  const winners = accounts.filter((a) => a.pnl > 0).sort((a, b) => b.pnl - a.pnl);
  const losers = accounts.filter((a) => a.pnl < 0).sort((a, b) => a.pnl - b.pnl);
  const top = [...positions].sort((a, b) => b.pnl - a.pnl)[0];
  const topShare = top && totalPnl > 0 && top.pnl > 0 ? top.pnl / totalPnl : 0;

  const rows: FactRow[] = accounts.map((a) => ({
    label: `${a.label} 평가손익`,
    value: `${signedWon(a.pnl)} (${formatReturn(a.rate)})`,
  }));
  rows.push({ label: "합계", value: signedWon(totalPnl) });
  rows.push({ label: "매입금액", value: formatWon(input.totalPurchase) });
  if (top && top.pnl > 0) {
    rows.push({ label: "손익 1위 종목", value: `${shortName(top.name)} · ${top.accountLabel}` });
    rows.push({ label: "그 종목 평가손익", value: signedWon(top.pnl) });
    if (topShare > 0) rows.push({ label: "총 손익 중 비중", value: formatShare(topShare) });
  }
  if (input.syncedAt) rows.push({ label: "기준", value: input.syncedAt });

  const concentrated = topShare >= 0.5 && topShare <= 1.5;
  const covered = winners.length > 0 && losers.length > 0 && totalPnl > 0;

  if (covered) {
    const w = winners[0];
    const l = losers[0];
    const amount = signedWon(w.pnl);
    const tail = concentrated
      ? " 그 수익의 {topShare}는 {topName} 한 종목({topPnl})에서 나왔어요."
      : "";
    return {
      id: "portfolio.hero.covered",
      kind: "one_off",
      metric: "pnl",
      metricLabel: "평가손익",
      period: input.asOf,
      value: w.pnl,
      unit: "won",
      score: Math.min(1, 0.6 + Math.abs(l.pnl) / Math.max(1, w.pnl)),
      template: `{winner}${iGa(w.label)} {fact}${eulReul(amount)} 벌어 {loser} 손실을 덮었어요.${tail}`,
      detail: {
        trigger: amount,
        winner: w.label,
        loser: l.label,
        topShare: formatShare(topShare),
        topName: top ? shortName(top.name) : "",
        topPnl: top ? signedWon(top.pnl) : "",
      },
      evidence: { kind: "keys", keys: [evidenceKey.account(w.id), evidenceKey.account(l.id)] },
      rows,
    };
  }

  if (concentrated && top) {
    const share = formatShare(topShare);
    return {
      id: "portfolio.hero.concentrated",
      kind: "one_off",
      metric: "pnl",
      metricLabel: "평가손익",
      period: input.asOf,
      value: topShare,
      unit: "percent",
      score: Math.min(1, topShare),
      template: `총 평가손익의 {fact}${iGa(share)} {topName} 한 종목({topPnl})에서 나왔어요.`,
      detail: { trigger: share, topName: shortName(top.name), topPnl: signedWon(top.pnl) },
      evidence: {
        kind: "keys",
        keys: [evidenceKey.account(top.accountId)],
      },
      rows,
    };
  }
  return null;
}

// ── asset chart: what the market did once cashflows are removed ─────────────

export function chartFact(input: {
  period: Period;
  rangeLabel: string;
  startValue: number;
  endValue: number;
  cashflows: ReadonlyArray<{ date: string; amount: number }>;
  peak?: { date: string; value: number } | null;
  low?: { date: string; value: number } | null;
}): Fact | null {
  const { startValue, endValue, cashflows } = input;
  if (cashflows.length === 0) return null;
  const change = endValue - startValue;
  const net = cashflows.reduce((s, c) => s + c.amount, 0);
  if (net === 0) return null;
  const market = change - net;
  const marketText = signedWon(market);
  const rows: FactRow[] = [
    {
      label: "기간",
      value: `${formatMonthDay(input.period.from)}–${formatMonthDay(input.period.to)} (${input.rangeLabel})`,
    },
    { label: "시작 평가금액", value: formatWon(startValue) },
    { label: "마지막 평가금액", value: formatWon(endValue) },
    { label: "자산 변화", value: signedWon(change) },
    { label: "같은 기간 순입금", value: `${signedWon(net)} · ${cashflows.length}건` },
    { label: "입출금 제외 변화", value: marketText },
  ];
  if (input.peak && input.low && input.peak.date !== input.low.date) {
    rows.push({
      label: `고점 · ${formatMonthDay(input.peak.date)}`,
      value: formatWon(input.peak.value),
    });
    rows.push({
      label: `저점 · ${formatMonthDay(input.low.date)}`,
      value: formatWon(input.low.value),
    });
  }
  const changeText = signedWon(change);
  const netAbs = formatWon(Math.abs(net));
  const template =
    net > 0
      ? `자산은 {change}${hasBatchim(changeText) ? "이지만" : "지만"} 그사이 {net}${eulReul(netAbs)} 더 넣었어요. 입출금을 빼면 시장에서 {fact} 변했어요.`
      : `자산은 {change}${hasBatchim(changeText) ? "이지만" : "지만"} 그사이 {net}${eulReul(netAbs)} 뺐어요. 입출금을 빼면 시장에서 {fact} 변했어요.`;
  // Notable when the deposits hide or flip the market's move.
  const flips = Math.sign(change) !== Math.sign(market) && market !== 0;
  const share = Math.abs(net) / Math.max(1, Math.abs(change));
  return {
    id: "portfolio.chart.market",
    kind: "delta",
    metric: "market_change",
    metricLabel: "입출금 제외 변화",
    period: input.period,
    value: market,
    unit: "won",
    score: flips ? 0.9 : Math.min(1, share),
    template,
    detail: { trigger: marketText, change: changeText, net: netAbs },
    evidence: { kind: "keys", keys: [evidenceKey.cashflows] },
    rows,
  };
}

// ── holdings: how concentrated the result is ─────────────────────────────────

export interface HoldingFactRow {
  accountId: string;
  ticker: string;
  name: string;
  pnl: number;
  rate: number;
}

export function holdingsFact(input: {
  holdings: ReadonlyArray<HoldingFactRow>;
  totalPnl: number;
  asOf: Period;
}): Fact | null {
  const { holdings, totalPnl } = input;
  if (holdings.length < 2) return null;
  const sorted = [...holdings].sort((a, b) => b.pnl - a.pnl);
  const top = sorted[0];
  const worst = sorted[sorted.length - 1];
  if (top.pnl <= 0) return null;
  const gainers = holdings.filter((h) => h.pnl > 0).length;
  const topText = signedWon(top.pnl);
  const rows: FactRow[] = [
    { label: "수익 종목", value: `${gainers} / ${holdings.length}개` },
    // Name and amount on separate rows: a long name in the label used to squeeze
    // "+2,504,540원 (+83.68%)" onto two lines.
    { label: "손익 1위", value: shortName(top.name) },
    { label: "그 종목 평가손익", value: `${topText} (${formatReturn(top.rate)})` },
    { label: "총 평가손익", value: signedWon(totalPnl) },
  ];
  if (worst.pnl < 0) {
    rows.push(
      { label: "손실 1위", value: shortName(worst.name) },
      {
        label: "그 종목 평가손익",
        value: `${signedWon(worst.pnl)} (${formatReturn(worst.rate)})`,
      }
    );
  }
  const losers = holdings.filter((h) => h.pnl < 0);
  const lossSum = losers.reduce((s, h) => s + h.pnl, 0);
  if (losers.length > 0)
    rows.push({ label: "손실 종목 합계", value: `${signedWon(lossSum)} · ${losers.length}개` });

  const lead =
    gainers * 2 < holdings.length
      ? "{count}종목 중 {gainers}개만 수익이에요. "
      : "{count}종목 중 {gainers}개가 수익이에요. ";
  const base = {
    kind: "one_off" as const,
    metric: "pnl",
    metricLabel: "평가손익",
    period: input.asOf,
    unit: "won" as const,
    rows,
  };
  const names = {
    count: String(holdings.length),
    gainers: String(gainers),
    topName: shortName(top.name),
    total: signedWon(totalPnl),
    worstName: shortName(worst.name),
    worstPnl: signedWon(worst.pnl),
  };

  // One holding out-earns the whole portfolio: the rest net to a loss.
  if (totalPnl > 0 && top.pnl > totalPnl) {
    return {
      ...base,
      id: "portfolio.holdings.exceeds",
      value: top.pnl,
      score: 0.9,
      template:
        worst.pnl < 0
          ? `${lead}{topName} 하나가 {fact}${euro(topText)} 전체 평가손익({total})보다 크고, 가장 큰 손실은 {worstName} {worstPnl}이에요.`
          : `${lead}{topName} 하나가 {fact}${euro(topText)} 전체 평가손익({total})보다 커요.`,
      detail: { trigger: topText, ...names },
      evidence: {
        kind: "keys",
        keys: [top, ...(worst.pnl < 0 ? [worst] : [])].map((h) =>
          evidenceKey.position(h.accountId, h.ticker)
        ),
      },
    };
  }

  // Losses are spread over several holdings: how much they take back together.
  if (losers.length >= 2 && totalPnl !== 0) {
    const lossText = signedWon(lossSum);
    return {
      ...base,
      id: "portfolio.holdings.losses",
      value: lossSum,
      score: Math.min(1, Math.abs(lossSum) / Math.max(1, Math.abs(totalPnl)) + 0.3),
      template: `${lead}손실 난 {losers}종목을 합치면 {fact}이고, 가장 큰 손실은 {worstName} {worstPnl}이에요.`,
      detail: { trigger: lossText, losers: String(losers.length), ...names },
      evidence: {
        kind: "keys",
        keys: losers.map((h) => evidenceKey.position(h.accountId, h.ticker)),
      },
    };
  }
  return null;
}

// ── target drift: where the last buy went vs the biggest gap ─────────────────

export interface RecentBuy {
  date: string;
  ticker: string;
  amount: number;
}

export function driftFact(input: {
  accountId: string;
  accountLabel: string;
  rows: ReadonlyArray<DriftRow>;
  recentBuys: ReadonlyArray<RecentBuy>;
  base: number;
  targetsSetAt: string | null;
  asOf: Period;
}): Fact | null {
  const { rows, recentBuys, accountId } = input;
  const under = rows.filter((r) => r.diff < 0).sort((a, b) => a.diff - b.diff)[0];
  if (!under || Math.abs(under.diff) < 0.01) return null;
  const top = rows[0];
  const byTicker = new Map(rows.map((r) => [r.ticker, r]));
  const bought = [...new Set(recentBuys.map((b) => b.ticker))];
  const intoOver = bought.length > 0 && bought.every((t) => (byTicker.get(t)?.diff ?? 0) > 0);
  const buyAmount = recentBuys.reduce((s, b) => s + b.amount, 0);
  const underAmt = formatWon(under.amount);

  const facts: FactRow[] = [];
  if (input.targetsSetAt) facts.push({ label: "목표 비중 설정", value: input.targetsSetAt });
  if (top && top.diff > 0)
    facts.push({ label: `가장 많이 초과 · ${top.short}`, value: pp(top.diff) });
  facts.push({
    label: `가장 많이 부족 · ${under.short}`,
    value: `${pp(under.diff)} · ${underAmt}`,
  });
  for (const b of recentBuys) {
    facts.push({
      label: `${formatMonthDay(b.date)} 매수 · ${byTicker.get(b.ticker)?.short ?? b.ticker}`,
      value: formatWon(b.amount),
    });
  }
  facts.push({ label: `${input.accountLabel} 주식 평가금액`, value: formatWon(input.base) });

  const sharesText = `${under.shares.toLocaleString("ko-KR")}주`;
  const tail =
    under.shares > 0
      ? `가장 모자란 건 {underName}${euro(under.short)}, {shares}({underAmt})를 사면 목표에 닿아요.`
      : `가장 모자란 건 {underName}${euro(under.short)}, {underAmt}만큼 모자라요.`;

  if (intoOver) {
    const buyText = formatWon(buyAmount);
    const names = bought.map((t) => byTicker.get(t)?.short ?? t).join("·");
    return {
      id: "portfolio.drift.buy-into-over",
      kind: "diagnosis",
      metric: "target_drift",
      metricLabel: "목표 비중",
      period: input.asOf,
      value: buyAmount,
      unit: "won",
      score: 0.85,
      template: `{buyDate} 매수 {fact}${iGa(buyText)} 이미 목표를 넘은 {names}에 들어갔어요. ${tail}`,
      detail: {
        trigger: buyText,
        buyDate: formatMonthDay(recentBuys[0].date),
        names,
        underName: under.short,
        shares: sharesText,
        underAmt,
      },
      evidence: {
        kind: "keys",
        keys: [...bought, under.ticker].map((t) => evidenceKey.drift(accountId, t)),
      },
      rows: facts,
    };
  }

  const gapText = pp(Math.abs(under.diff)).replace("+", "");
  return {
    id: "portfolio.drift.gap",
    kind: "diagnosis",
    metric: "target_drift",
    metricLabel: "목표 비중",
    period: input.asOf,
    value: under.diff,
    unit: "percent",
    score: Math.min(1, Math.abs(under.diff) / 0.03),
    template: `가장 모자란 건 {underName}${euro(under.short)}, 목표보다 {fact} 적어요. ${
      under.shares > 0 ? "{shares}({underAmt})를 사면 목표에 닿아요." : ""
    }`.trim(),
    detail: { trigger: gapText, underName: under.short, shares: sharesText, underAmt },
    evidence: { kind: "keys", keys: [evidenceKey.drift(accountId, under.ticker)] },
    rows: facts,
  };
}

/** Percentage-point difference of two ratios, signed: `+3.65%p` / `−2.24%p`. */
export function pp(diff: number): string {
  const v = Math.round(diff * 10_000) / 100;
  const sign = v > 0 ? "+" : v < 0 ? "−" : "";
  return `${sign}${Math.abs(v).toFixed(2)}%p`;
}
