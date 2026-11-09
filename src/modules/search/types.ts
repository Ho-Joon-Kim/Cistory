export const SEARCH_SOURCES = ["all", "commit", "spending", "visit", "trip"] as const;
export type SearchSource = (typeof SEARCH_SOURCES)[number];
export interface SearchInput {
  q: string;
  from: string;
  to: string;
  source: SearchSource;
  page: number;
  /** Only spending rows in this expense category (implies spending-only). */
  category?: string;
  /** KST hour-of-day window, start inclusive / end exclusive (0..24). Excludes trips. */
  hours?: { from: number; to: number };
}
export interface SearchItem {
  id: string;
  source: Exclude<SearchSource, "all">;
  title: string;
  description: string;
  date: string;
  href: string;
  /** UTC instant the record occurred (ISO); trips use their KST start-of-day. */
  occurredAt?: string;
  /** Spending amount in won. */
  amount?: number | null;
  /** Spending expense category key. */
  category?: string | null;
  /** Commit repository `owner/name`. */
  repository?: string | null;
}
export type SearchCounts = Record<Exclude<SearchSource, "all">, number>;
export interface SearchResponse {
  items: SearchItem[];
  hasMore: boolean;
  page: number;
  /** Per-source match counts for the same filters (ignoring `source`). */
  counts?: SearchCounts;
}
