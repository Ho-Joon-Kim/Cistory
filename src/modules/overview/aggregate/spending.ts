import { sql } from "drizzle-orm";
import { accountRoles, transactions, users } from "@/db/schema";
import { localDaySql } from "@/db/sql";
import { bucketSql } from "@/modules/spending/classify";
import type { PeriodAggregateInput, SpendingAggregate } from "../types";
import type { LocationReadExecutor } from "./location";
import { finiteNumber as numberValue, resultRows as rows } from "./query-values";

export async function aggregateSpending(
  executor: LocationReadExecutor,
  input: PeriodAggregateInput & { from: Date; toExclusive: Date }
): Promise<SpendingAggregate> {
  const userResult = await executor.execute(sql`
    SELECT ${users.tossMyName} AS "tossMyName" FROM ${users}
    WHERE ${users.id} = ${input.userId} LIMIT 1
  `);
  const tossMyName = rows(userResult)[0]?.tossMyName;
  const bucket = bucketSql(tossMyName == null ? null : String(tossMyName));
  const result = await executor.execute(sql`
    SELECT
      ${localDaySql(transactions.transactedAt)}::text AS date,
      ${bucket} AS bucket,
      COALESCE(${accountRoles.role}, 'default') AS role,
      COALESCE(${transactions.category}, 'uncategorized') AS category,
      COALESCE(SUM(${transactions.amount}), 0)::float8 AS amount
    FROM ${transactions}
    LEFT JOIN ${accountRoles}
      ON ${accountRoles.userId} = ${transactions.userId}
      AND ${accountRoles.accountName} = ${transactions.accountName}
    WHERE ${transactions.userId} = ${input.userId}
      AND ${transactions.transactedAt} >= ${input.from}
      AND ${transactions.transactedAt} < ${input.toExclusive}
    GROUP BY 1, 2, 3, 4
    ORDER BY 1, 2, 3, 4
  `);

  const daily = new Map<string, { spending: number; income: number }>();
  const roles = new Map<string, { spending: number; income: number }>();
  const categories = new Map<string, number>();
  let spending = 0;
  let income = 0;
  for (const row of rows(result)) {
    const bucketName = String(row.bucket);
    if (bucketName === "ignore") continue;
    const amount = numberValue(row.amount);
    const date = String(row.date);
    const role = String(row.role);
    const dailyValue = daily.get(date) ?? { spending: 0, income: 0 };
    const roleValue = roles.get(role) ?? { spending: 0, income: 0 };
    if (bucketName === "spending") {
      spending += amount;
      dailyValue.spending += amount;
      roleValue.spending += amount;
      const category = String(row.category);
      categories.set(category, (categories.get(category) ?? 0) + amount);
    } else if (bucketName === "income") {
      income += amount;
      dailyValue.income += amount;
      roleValue.income += amount;
    }
    daily.set(date, dailyValue);
    roles.set(role, roleValue);
  }

  return {
    spending,
    income,
    netSpend: spending - income,
    daily: [...daily]
      .map(([date, value]) => ({ date, ...value, netSpend: value.spending - value.income }))
      .sort((a, b) => a.date.localeCompare(b.date)),
    accountRoles: [...roles]
      .map(([role, value]) => ({ role, ...value }))
      .sort((a, b) => a.role.localeCompare(b.role)),
    categories: [...categories]
      .map(([category, categorySpending]) => ({ category, spending: categorySpending }))
      .sort((a, b) => b.spending - a.spending || a.category.localeCompare(b.category)),
  };
}
