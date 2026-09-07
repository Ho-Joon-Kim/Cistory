import { ApiError } from "@/lib/api-handler";
import { dateKeyToUtcMillis, shiftDateKey, toKstCalendarDate } from "@/lib/date-key";
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
  return { q, from, to, source: source as SearchSource, page };
}
