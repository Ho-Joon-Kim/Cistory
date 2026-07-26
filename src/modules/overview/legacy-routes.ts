export type LegacyOverviewRoute = "insights" | "report" | "comparison";
export type LegacySearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function kstParts(now: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .formatToParts(now)
    .reduce<Record<string, string>>((result, part) => {
      if (part.type !== "literal") result[part.type] = part.value;
      return result;
    }, {});
  return parts;
}

function currentKeys(now: Date) {
  const { year, month, day } = kstParts(now);
  return { year, month: `${year}-${month}`, recent: `${year}-${month}-${day}` };
}

function validYear(value: string | undefined, fallback: string) {
  return value && /^\d{4}$/.test(value) ? value : fallback;
}

function validMonth(value: string | undefined, fallback: string) {
  return value && /^\d{4}-(0[1-9]|1[0-2])$/.test(value) ? value : fallback;
}

function target(params: URLSearchParams) {
  return `/overview?${params.toString()}`;
}

export function legacyOverviewRedirect(
  route: LegacyOverviewRoute,
  searchParams: LegacySearchParams,
  now: Date = new Date()
): string {
  const current = currentKeys(now);
  const result = new URLSearchParams();

  if (route === "insights") {
    result.set("periodType", "year");
    result.set("periodKey", validYear(first(searchParams.year), current.year));
    return target(result);
  }

  if (route === "report") {
    const type = first(searchParams.type);
    const legacyMonthly = first(searchParams.period) === "monthly";
    const yearly = type === "yearly";
    const month = legacyMonthly
      ? validMonth(first(searchParams.yearMonth), current.month)
      : validMonth(type === "monthly" ? first(searchParams.period) : undefined, current.month);
    result.set("periodType", yearly ? "year" : "month");
    result.set("periodKey", yearly ? validYear(first(searchParams.period), current.year) : month);
    return target(result);
  }

  const year2 = validYear(first(searchParams.year2), current.year);
  const year1 = validYear(first(searchParams.year1), String(Number(year2) - 1));
  result.set("mode", "comparison");
  result.set("periodType", "year");
  result.set("periodKey", year2);
  result.set("year1", year1);
  result.set("year2", year2);
  return target(result);
}
