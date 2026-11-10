/**
 * Rule-based reader for natural search text ("지난주 저녁 배달", "오늘 쓴 돈이랑
 * 간 곳", "10월 커밋"). No model: dates, sources, expense categories and
 * time-of-day words are matched from fixed vocabularies and removed; whatever is
 * left becomes the literal search term. Every recognised piece becomes a chip
 * the user can remove.
 */
import { shiftDateKey } from "@/lib/date-key";
import { EXPENSE_CATEGORY_LABELS, type ExpenseCategory } from "@/modules/spending/categories";
import type { SearchSource } from "./types";

export type RecordSource = Exclude<SearchSource, "all">;

export interface ParsedRange {
  from: string;
  to: string;
  label: string;
}

export interface ParsedQuery {
  /** Remaining literal term (may be empty). */
  q: string;
  range: ParsedRange | null;
  sources: RecordSource[];
  category: ExpenseCategory | null;
  hours: { from: number; to: number; label: string } | null;
}

export const SOURCE_LABELS: Record<RecordSource, string> = {
  commit: "커밋",
  spending: "소비",
  visit: "방문",
  trip: "여행",
};

const SOURCE_WORDS: [RegExp, RecordSource][] = [
  [/커밋|코드|깃허브|github/i, "commit"],
  [/쓴\s*돈|돈|소비|지출|결제|구매|산\s*것|샀던|샀/, "spending"],
  [/간\s*곳|갔던\s*곳|갔던|방문|장소|들른|머문/, "visit"],
  [/여행|출장/, "trip"],
];

const CATEGORY_WORDS: [RegExp, ExpenseCategory][] = [
  [/카페|커피/, "cafe"],
  [/배달|식비|식사|밥|음식|외식|맛집/, "food"],
  [/택시|교통|버스|지하철\s*요금|주유/, "transport"],
  [/쇼핑/, "shopping"],
  [/구독/, "subscription"],
  [/병원|약국|의료/, "health"],
  [/영화|공연|여가/, "leisure"],
  [/교육|강의|학원/, "education"],
  [/선물|경조/, "gift"],
  [/숙박|호텔/, "travel"],
  [/월세|관리비|생활비/, "housing"],
];

const HOUR_WORDS: [RegExp, { from: number; to: number; label: string }][] = [
  [/새벽/, { from: 0, to: 6, label: "새벽 0–6시" }],
  [/아침|출근길/, { from: 6, to: 11, label: "아침 6–11시" }],
  [/점심/, { from: 11, to: 14, label: "점심 11–14시" }],
  [/오전/, { from: 0, to: 12, label: "오전" }],
  [/오후/, { from: 12, to: 18, label: "오후 12–18시" }],
  [/저녁|퇴근길/, { from: 18, to: 22, label: "저녁 18–22시" }],
  [/심야|밤늦게|한밤/, { from: 22, to: 4, label: "밤 22–4시" }],
  [/밤/, { from: 21, to: 24, label: "밤 21–24시" }],
];

const KOREAN_NUMBERS: Record<string, number> = {
  한: 1,
  두: 2,
  세: 3,
  네: 4,
  다섯: 5,
  여섯: 6,
  일곱: 7,
  여덟: 8,
  아홉: 9,
  열: 10,
};

const FILLERS = new Set([
  "기록",
  "기록들",
  "동안",
  "남긴",
  "있었던",
  "했던",
  "한",
  "것",
  "거",
  "내가",
  "내",
  "보여줘",
  "보여",
  "찾아줘",
  "찾아",
  "알려줘",
  "검색",
  "전부",
  "모두",
  "다",
  "중",
  "때",
  "관련",
  "그리고",
  "및",
]);
const PARTICLES = /(이랑|랑|하고|에서|에|의|을|를|은|는|이|가|도|만|과|와)$/;

function daysInMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}
const pad = (n: number) => String(n).padStart(2, "0");
const key = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

function weekdayIndex(dateKey: string) {
  // Monday = 0.
  return (new Date(`${dateKey}T00:00:00Z`).getUTCDay() + 6) % 7;
}

function clampToToday(range: ParsedRange, today: string): ParsedRange {
  return range.to > today ? { ...range, to: today } : range;
}

interface RangeRule {
  re: RegExp;
  build: (m: RegExpMatchArray, today: string) => ParsedRange | null;
}

const RANGE_RULES: RangeRule[] = [
  { re: /오늘/, build: (_m, t) => ({ from: t, to: t, label: "오늘" }) },
  {
    re: /어제/,
    build: (_m, t) => ({ from: shiftDateKey(t, -1), to: shiftDateKey(t, -1), label: "어제" }),
  },
  {
    re: /그저께|그제/,
    build: (_m, t) => ({ from: shiftDateKey(t, -2), to: shiftDateKey(t, -2), label: "그제" }),
  },
  {
    re: /이번\s*주/,
    build: (_m, t) => ({ from: shiftDateKey(t, -weekdayIndex(t)), to: t, label: "이번 주" }),
  },
  {
    re: /(지난|저번)\s*주/,
    build: (_m, t) => {
      const monday = shiftDateKey(t, -weekdayIndex(t) - 7);
      return { from: monday, to: shiftDateKey(monday, 6), label: "지난주" };
    },
  },
  {
    re: /이번\s*달/,
    build: (_m, t) => ({ from: `${t.slice(0, 8)}01`, to: t, label: "이번 달" }),
  },
  {
    re: /(지난|저번)\s*달/,
    build: (_m, t) => {
      let y = Number(t.slice(0, 4));
      let m = Number(t.slice(5, 7)) - 1;
      if (m === 0) {
        y -= 1;
        m = 12;
      }
      return { from: key(y, m, 1), to: key(y, m, daysInMonth(y, m)), label: "지난달" };
    },
  },
  {
    re: /올해|금년/,
    build: (_m, t) => ({ from: `${t.slice(0, 4)}-01-01`, to: t, label: "올해" }),
  },
  {
    re: /작년|지난\s*해/,
    build: (_m, t) => {
      const y = Number(t.slice(0, 4)) - 1;
      return { from: `${y}-01-01`, to: `${y}-12-31`, label: `${y}년` };
    },
  },
  { re: /일주일/, build: (_m, t) => ({ from: shiftDateKey(t, -6), to: t, label: "최근 7일" }) },
  {
    re: /(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일/,
    build: (m) => {
      const k = key(Number(m[1]), Number(m[2]), Number(m[3]));
      return { from: k, to: k, label: `${m[1]}년 ${Number(m[2])}월 ${Number(m[3])}일` };
    },
  },
  {
    re: /(\d{1,2})월\s*(\d{1,2})일/,
    build: (m, t) => {
      let y = Number(t.slice(0, 4));
      const k0 = key(y, Number(m[1]), Number(m[2]));
      if (k0 > t) y -= 1;
      const k = key(y, Number(m[1]), Number(m[2]));
      return { from: k, to: k, label: `${Number(m[1])}월 ${Number(m[2])}일` };
    },
  },
  {
    re: /(\d{4})년\s*(\d{1,2})월/,
    build: (m) => {
      const y = Number(m[1]);
      const mo = Number(m[2]);
      if (mo < 1 || mo > 12) return null;
      return { from: key(y, mo, 1), to: key(y, mo, daysInMonth(y, mo)), label: `${y}년 ${mo}월` };
    },
  },
  {
    re: /(\d{1,2})월/,
    build: (m, t) => {
      const mo = Number(m[1]);
      if (mo < 1 || mo > 12) return null;
      let y = Number(t.slice(0, 4));
      if (key(y, mo, 1) > t) y -= 1;
      return { from: key(y, mo, 1), to: key(y, mo, daysInMonth(y, mo)), label: `${mo}월` };
    },
  },
  {
    re: /(\d{4})년/,
    build: (m) => ({ from: `${m[1]}-01-01`, to: `${m[1]}-12-31`, label: `${m[1]}년` }),
  },
  {
    re: /(?:(?:최근|지난)\s*(\d+|한|두|세|네|다섯|여섯|일곱|여덟|아홉|열)\s*(일|주일?|달|개월)(?:\s*(?:동안|간))?|(\d+|한|두|세|네|다섯|여섯|일곱|여덟|아홉|열)\s*(일|주일?|달|개월)\s*(?:동안|간))/,
    build: (m, t) => {
      const word = m[1] ?? m[3];
      const unit = m[2] ?? m[4];
      const n = /^\d+$/.test(word) ? Number(word) : (KOREAN_NUMBERS[word] ?? 1);
      const days = Math.min(366, unit === "일" ? n : unit.startsWith("주") ? n * 7 : n * 30);
      if (days < 1) return null;
      return { from: shiftDateKey(t, -(days - 1)), to: t, label: `최근 ${days}일` };
    },
  },
];

function isValidKey(k: string) {
  const d = new Date(`${k}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === k;
}

/** Parses free text into structured filters. `today` is the KST date key. */
export function parseNaturalQuery(text: string, today: string): ParsedQuery {
  let rest = ` ${text.trim()} `;
  let range: ParsedRange | null = null;
  for (const rule of RANGE_RULES) {
    const m = rest.match(rule.re);
    if (!m) continue;
    const built = rule.build(m, today);
    if (!built || !isValidKey(built.from) || !isValidKey(built.to)) continue;
    range = clampToToday(built, today);
    rest = rest.replace(m[0], " ");
    break;
  }

  let category: ExpenseCategory | null = null;
  for (const [re, value] of CATEGORY_WORDS) {
    const m = rest.match(re);
    if (m) {
      category = value;
      rest = rest.replace(m[0], " ");
      break;
    }
  }
  if (!category) {
    for (const [value, label] of Object.entries(EXPENSE_CATEGORY_LABELS)) {
      if (rest.includes(label)) {
        category = value as ExpenseCategory;
        rest = rest.replace(label, " ");
        break;
      }
    }
  }

  const sources: RecordSource[] = [];
  for (const [re, value] of SOURCE_WORDS) {
    const m = rest.match(re);
    if (m) {
      if (!sources.includes(value)) sources.push(value);
      rest = rest.replace(m[0], " ");
    }
  }
  if (category && !sources.includes("spending")) sources.unshift("spending");

  let hours: ParsedQuery["hours"] = null;
  for (const [re, value] of HOUR_WORDS) {
    const m = rest.match(re);
    if (m) {
      hours = value;
      rest = rest.replace(m[0], " ");
      break;
    }
  }

  const q = rest
    .split(/\s+/)
    .map((token) => (token.length > 1 ? token.replace(PARTICLES, "") : token))
    .filter((token) => token && !FILLERS.has(token))
    .join(" ")
    .trim();

  return { q, range, sources, category, hours };
}
