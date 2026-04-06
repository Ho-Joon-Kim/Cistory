"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Input } from "@/components/ui/input";
import { Search, Loader2, MapPin } from "lucide-react";

interface SearchResult {
  name: string;
  address: string;
  lat: number;
  lon: number;
  category?: string;
}

interface SearchPanelProps {
  onPlaceSelect: (place: { lat: number; lon: number; name: string }) => void;
}

export function SearchPanel({ onPlaceSelect }: SearchPanelProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const search = useCallback(async (q: string) => {
    if (q.trim().length < 2) {
      setResults([]);
      setHasSearched(false);
      return;
    }

    // Abort previous request
    if (abortRef.current) {
      abortRef.current.abort();
    }

    const controller = new AbortController();
    abortRef.current = controller;

    setIsLoading(true);
    setHasSearched(true);

    try {
      const res = await fetch(
        `/api/saved-places/search?q=${encodeURIComponent(q.trim())}`,
        { signal: controller.signal },
      );
      if (!res.ok) throw new Error("Search failed");
      const data = await res.json();
      setResults(data.results ?? []);
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      setResults([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    debounceRef.current = setTimeout(() => {
      search(query);
    }, 300);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [query, search]);

  // Cleanup abort controller on unmount
  useEffect(() => {
    return () => {
      if (abortRef.current) {
        abortRef.current.abort();
      }
    };
  }, []);

  return (
    <div className="flex flex-col p-3">
      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
        장소 검색
      </h3>
      <div className="relative mb-3">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
        <Input
          placeholder="장소명 또는 주소..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="pl-8 h-8 text-sm"
        />
      </div>

      {isLoading && (
        <div className="flex items-center justify-center gap-2 py-6">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          <span className="text-xs text-muted-foreground">검색 중...</span>
        </div>
      )}

      {!isLoading && hasSearched && results.length === 0 && (
        <div className="flex flex-col items-center gap-2 py-6">
          <Search className="h-5 w-5 text-muted-foreground" />
          <p className="text-xs text-muted-foreground">검색 결과가 없습니다</p>
        </div>
      )}

      {!isLoading && results.length > 0 && (
        <div className="flex flex-col gap-0.5">
          {results.map((r, i) => (
            <button
              key={`${r.lat}-${r.lon}-${i}`}
              type="button"
              className="flex items-start gap-2.5 rounded-md px-2 py-2 text-left transition-colors hover:bg-accent/50"
              onClick={() => onPlaceSelect({ lat: r.lat, lon: r.lon, name: r.name })}
            >
              <MapPin className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{r.name}</p>
                {r.address && (
                  <p className="text-xs text-muted-foreground truncate">{r.address}</p>
                )}
                {r.category && (
                  <span className="text-[10px] text-muted-foreground/70">{r.category}</span>
                )}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
