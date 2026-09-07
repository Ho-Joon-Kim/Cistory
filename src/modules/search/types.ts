export const SEARCH_SOURCES = ["all", "commit", "spending", "visit", "trip"] as const;
export type SearchSource = (typeof SEARCH_SOURCES)[number];
export interface SearchInput {
  q: string;
  from: string;
  to: string;
  source: SearchSource;
  page: number;
}
export interface SearchItem {
  id: string;
  source: Exclude<SearchSource, "all">;
  title: string;
  description: string;
  date: string;
  href: string;
}
export interface SearchResponse {
  items: SearchItem[];
  hasMore: boolean;
  page: number;
}
