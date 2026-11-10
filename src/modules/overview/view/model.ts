import type { HistoryPeriodType, OverviewHistoryResponse } from "../history";
import type { OverviewSnapshotDomains } from "../service";
import type { CodingAggregate, HealthAggregate, SpendingAggregate } from "../types";
import { buildFlow, type FlowModel } from "./flow";
import { buildHeadline } from "./headline";
import { buildHero, type HeroModel } from "./hero";
import {
  comparisonBase,
  type PeriodContext,
  periodContext,
  periodMeta,
  periodTitle,
} from "./labels";
import {
  type AssetModel,
  buildAsset,
  buildDetails,
  buildMove,
  type DetailTab,
  type MoveModel,
} from "./sections";
import { metricByDay } from "./series";

export interface OverviewModel {
  ctx: PeriodContext;
  title: string;
  meta: string;
  headline: string | null;
  hero: HeroModel;
  flow: FlowModel;
  move: MoveModel | null;
  asset: AssetModel | null;
  details: DetailTab[];
}

/**
 * The history's entry for the viewed week/month is re-derived from day rows that
 * may come from other (overlapping) snapshots, so its totals can drift from the
 * period's own snapshot (e.g. a month step average of 3,279 vs 3,303). Every
 * number shown for the viewed period — KPI, legend, sparkline bar and the facts
 * comparing against it — must come from one computation, so the viewed period's
 * entry is replaced with the snapshot's own totals.
 */
export function alignHistory(
  history: OverviewHistoryResponse | null,
  ctx: PeriodContext,
  domains: {
    coding: CodingAggregate | null;
    spending: SpendingAggregate | null;
    health: HealthAggregate | null;
  }
): OverviewHistoryResponse | null {
  if (!history || ctx.periodType === "year") return history;
  const { coding, spending, health } = domains;
  const stepValues = [...metricByDay(health, "steps").values()];
  return {
    ...history,
    series: history.series.map((p) => {
      if (p.periodKey !== ctx.periodKey) return p;
      return {
        ...p,
        commits: coding ? coding.totalCommits : p.commits,
        activeDays: coding ? coding.activeDays : p.activeDays,
        spending: spending ? spending.spending : p.spending,
        income: spending ? spending.income : p.income,
        steps:
          stepValues.length > 0
            ? { total: stepValues.reduce((s, v) => s + v, 0), days: stepValues.length }
            : p.steps,
        // Its own snapshot supplies these numbers, so it is not "being computed" here.
        pending: p.pending && !coding && !spending && !health,
      };
    }),
  };
}

function data<T>(envelope: { status: string; data: T | null } | null | undefined): T | null {
  return envelope?.status === "ready" ? envelope.data : null;
}

export function buildOverviewModel(input: {
  periodType: HistoryPeriodType;
  periodKey: string;
  computedAt: string | null;
  domains: OverviewSnapshotDomains;
  history: OverviewHistoryResponse | null;
  today: string;
  now: Date;
}): OverviewModel {
  const ctx = periodContext(input.periodType, input.periodKey, input.today, input.now);
  // A history for another period (still loading after a switch) must not leak in.
  const coding = data(input.domains.coding);
  const spending = data(input.domains.spending);
  const health = data(input.domains.health);
  const history = alignHistory(
    input.history?.periodType === input.periodType && input.history.periodKey === input.periodKey
      ? input.history
      : null,
    ctx,
    { coding, spending, health }
  );
  const location = data(input.domains.location);
  const portfolio = data(input.domains.portfolio);
  const hero = buildHero({ ctx, coding, spending, health, history });
  // Commits and cash are measured against the same elapsed span while in progress;
  // weight is a level, so it keeps the previous period's last weigh-in.
  const base = comparisonBase(ctx, history, { coding, spending, health });
  const prev = base?.period ?? null;
  // Through yesterday while in progress: today is still partial on both sides.
  const cur = base?.current ?? null;
  const prevWeight = history?.previous?.weight?.weight ?? null;
  // An earlier (out-of-period) weigh-in is context, not this period's change.
  const lastWeight = hero.body.weight && !hero.body.weight.asOf ? hero.body.weight.value : null;

  return {
    ctx,
    title: periodTitle(ctx),
    meta: periodMeta(ctx, input.computedAt),
    headline: buildHeadline(ctx, {
      commits: cur ? cur.commits : (coding?.totalCommits ?? null),
      previousCommits: prev?.commits ?? null,
      compareLabel: base?.label,
      net:
        cur && cur.income !== null && cur.spending !== null
          ? cur.income - cur.spending
          : spending
            ? spending.income - spending.spending
            : null,
      previousNet:
        prev && prev.income !== null && prev.spending !== null
          ? prev.income - prev.spending
          : ctx.periodType === "year" && spending
            ? spending.income - spending.spending
            : null,
      weight: lastWeight,
      // A year without a stored previous year compares against its first weigh-in.
      previousWeight:
        prevWeight ??
        (ctx.periodType === "year"
          ? (hero.body.weight?.points.find((p) => p.inside)?.weight ?? null)
          : null),
    }),
    hero,
    flow: buildFlow({ ctx, coding, spending, health, location, history }),
    move: buildMove(ctx, location),
    asset: buildAsset(ctx, portfolio),
    details: buildDetails({ ctx, coding, spending, health, location, history }),
  };
}
