/**
 * The one-sentence headline above the hero, assembled from the same comparisons
 * the hero shows (commits, cash flow, weight). Template-first: each domain picks
 * a clause by threshold; the last clause closes the sentence on the period noun
 * ("…이어간 달"). No comparison available → no headline.
 */
import { hasBatchim } from "@/lib/facts";
import type { PeriodContext } from "./labels";

interface Clause {
  /** Connective form ending a non-final clause ("…늘고" — non-past, so the whole sentence modifies the period noun). */
  conn: string;
  /** Adnominal form closing the sentence ("…늘어난"). */
  fin: string;
}

export interface HeadlineInput {
  commits: number | null;
  previousCommits: number | null;
  net: number | null;
  previousNet: number | null;
  weight: number | null;
  previousWeight: number | null;
  /**
   * Names the base of `previousCommits`/`previousNet`: "10월 같은 기간" while the
   * period is in progress (defaults to the previous period's label).
   */
  compareLabel?: string;
}

function commitsClause(label: string, cur: number, prev: number): Clause {
  const r = cur / prev - 1;
  const p = Math.round(Math.abs(r) * 100);
  if (p < 10) {
    return {
      conn: `커밋 속도는 ${label} 그대로,`,
      fin: `커밋 속도가 ${label}${hasBatchim(label) ? "과" : "와"} 비슷한`,
    };
  }
  if (r >= 1) {
    const times = Math.round((cur / prev) * 10) / 10;
    return {
      conn: `커밋은 ${label}의 ${times}배로 늘고,`,
      fin: `커밋이 ${label}의 ${times}배로 늘어난`,
    };
  }
  return r > 0
    ? {
        conn: `커밋은 ${label}보다 ${p}% 늘고,`,
        fin: `커밋이 ${label}보다 ${p}% 늘어난`,
      }
    : {
        conn: `커밋은 ${label}보다 ${p}% 줄고,`,
        fin: `커밋이 ${label}보다 ${p}% 줄어든`,
      };
}

function cashClause(net: number, prev: number): Clause {
  if (prev < 0 && net > 0)
    return { conn: "현금흐름은 흑자로 돌아서고", fin: "현금흐름이 흑자로 돌아선" };
  if (prev > 0 && net < 0)
    return { conn: "현금흐름은 적자로 돌아서고", fin: "현금흐름이 적자로 돌아선" };
  if (net >= 0) return { conn: "현금흐름은 흑자를 이어가고", fin: "현금흐름이 흑자를 이어간" };
  return { conn: "현금흐름은 적자가 이어지고", fin: "현금흐름이 적자에 머문" };
}

function weightClause(cur: number, prev: number): Clause {
  const diff = cur - prev;
  if (diff <= -0.3) return { conn: "체중은 줄고", fin: "체중이 줄어든" };
  if (diff >= 0.3) return { conn: "체중은 늘고", fin: "체중이 늘어난" };
  return { conn: "체중은 그대로이고", fin: "체중이 그대로인" };
}

export function buildHeadline(ctx: PeriodContext, input: HeadlineInput): string | null {
  const clauses: Clause[] = [];
  if (input.commits !== null && input.previousCommits) {
    clauses.push(
      commitsClause(input.compareLabel ?? ctx.previousLabel, input.commits, input.previousCommits)
    );
  }
  if (input.net !== null && input.previousNet !== null) {
    clauses.push(cashClause(input.net, input.previousNet));
  }
  if (input.weight !== null && input.previousWeight !== null) {
    clauses.push(weightClause(input.weight, input.previousWeight));
  }
  if (clauses.length === 0) return null;
  const head = clauses.slice(0, -1).map((c) => c.conn);
  const last = clauses[clauses.length - 1].fin;
  return [...head, `${last} ${ctx.unitNoun}`].join(" ").replace(/,\s*$/, "");
}
