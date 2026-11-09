import type { HistoryPeriodType, OverviewHistoryResponse } from "../history";
import type { OverviewSnapshotDomains } from "../service";
import { buildFlow, type FlowModel } from "./flow";
import { buildHeadline } from "./headline";
import { buildHero, type HeroModel } from "./hero";
import { type PeriodContext, periodContext, periodMeta, periodTitle } from "./labels";
import {
  type AssetModel,
  buildAsset,
  buildDetails,
  buildMove,
  type DetailTab,
  type MoveModel,
} from "./sections";

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
  const history =
    input.history?.periodType === input.periodType && input.history.periodKey === input.periodKey
      ? input.history
      : null;
  const coding = data(input.domains.coding);
  const spending = data(input.domains.spending);
  const health = data(input.domains.health);
  const location = data(input.domains.location);
  const portfolio = data(input.domains.portfolio);
  const hero = buildHero({ ctx, coding, spending, health, history });
  const prev = history?.previous ?? null;
  const lastWeight = hero.body.weight?.value ?? null;

  return {
    ctx,
    title: periodTitle(ctx),
    meta: periodMeta(ctx, input.computedAt),
    headline: buildHeadline(ctx, {
      commits: coding?.totalCommits ?? null,
      previousCommits: prev?.commits ?? null,
      net: spending ? spending.income - spending.spending : null,
      previousNet:
        prev && prev.income !== null && prev.spending !== null
          ? prev.income - prev.spending
          : ctx.periodType === "year" && spending
            ? spending.income - spending.spending
            : null,
      weight: lastWeight,
      // A year without a stored previous year compares against its first weigh-in.
      previousWeight:
        prev?.weight?.weight ??
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
