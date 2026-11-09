import { ApiError } from "@/lib/api-handler";
import { dateKeyToUtcMillis, shiftDateKey, toKstCalendarDate } from "@/lib/date-key";
import { isExpenseCategory } from "@/modules/spending/categories";
import { SEARCH_SOURCES, type SearchInput, type SearchSource } from "./types";

export function parseSearchInput(params: URLSearchParams, now = new Date()): SearchInput {
  const to = params.get("to") ?? toKstCalendarDate(now);
  const toMs = dateKeyToUtcMillis(to);
  if (toMs === null) throw new ApiError(400, "유효한 종료 날짜를 선택해 주세요.");
  const from = params.get("from") ?? shiftDateKey(to, -29);
  const fromMs = dateKeyToUtcMillis(from);
  if (fromMs === null || fromMs > toMs || toMs - fromMs > 365 * 86_400_000) {
    throw new ApiError(400, "검색 기간은 올바른 날짜로 최대 366일까지 선택해 주세요.");
  }
  const q = (params.get("q") ?? "").trim();
  if (q.length > 200) throw new ApiError(400, "검색어는 200자 이내로 입력해 주세요.");
  const source = params.get("source") ?? "all";
  if (!SEARCH_SOURCES.some((value) => value === source)) {
    throw new ApiError(400, "올바른 기록 종류를 선택해 주세요.");
  }
  const pageText = params.get("page") ?? "1";
  const page = Number(pageText);
  if (!/^\d+$/.test(pageText) || page < 1 || page > 100) {
    throw new ApiError(400, "페이지는 1부터 100까지 선택해 주세요.");
  }
  const result: SearchInput = { q, from, to, source: source as SearchSource, page };
  const category = params.get("category");
  if (category) {
    if (!isExpenseCategory(category)) throw new ApiError(400, "올바른 소비 분류를 선택해 주세요.");
    result.category = category;
  }
  const hours = params.get("hours");
  if (hours) {
    const match = /^(\d{1,2})-(\d{1,2})$/.exec(hours);
    const fromHour = Number(match?.[1]);
    const toHour = Number(match?.[2]);
    if (!match || fromHour > 23 || toHour > 24 || fromHour === toHour) {
      throw new ApiError(400, "시간대는 0시부터 24시 사이로 선택해 주세요.");
    }
    result.hours = { from: fromHour, to: toHour };
  }
  const repo = params.get("repo");
  if (repo) {
    if (repo.length > 300 || !/^[\w.-]+\/[\w.-]+$/.test(repo)) {
      throw new ApiError(400, "올바른 레포지토리를 선택해 주세요.");
    }
    result.repo = repo;
  }
  return result;
}
