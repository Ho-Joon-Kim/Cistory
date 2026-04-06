"use client";

import { useState, useEffect } from "react";

export interface ScratchMapRegion {
  name: string;
  visits: number;
  firstVisit: string;
  lastVisit: string;
  lat: number;
  lon: number;
}

export interface ScratchMapData {
  regions: ScratchMapRegion[];
  totalCells: number;
  totalRegions: number;
}

export function useScratchMap(year?: number) {
  const [data, setData] = useState<ScratchMapData | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    setIsLoading(true);

    async function fetchData() {
      try {
        const params = new URLSearchParams();
        if (year) params.set("year", String(year));
        const response = await fetch(`/api/reports/scratch-map?${params}`, {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("Failed to fetch scratch map data");
        const json = await response.json();
        setData(json);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        console.error("Failed to fetch scratch map:", err);
      } finally {
        setIsLoading(false);
      }
    }

    fetchData();
    return () => controller.abort();
  }, [year]);

  return { data, isLoading };
}
