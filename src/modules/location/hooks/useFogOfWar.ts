"use client";

import { useEffect, useRef, useState } from "react";

interface FogCell {
  lat: number;
  lon: number;
}

export function useFogOfWar(enabled: boolean) {
  const [cells, setCells] = useState<FogCell[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const fetchedRef = useRef(false);

  useEffect(() => {
    if (!enabled || fetchedRef.current) return;

    const controller = new AbortController();
    setIsLoading(true);

    async function fetchCells() {
      try {
        const response = await fetch("/api/timeline/locations/fog-cells", {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("Failed to fetch fog cells");
        const data = await response.json();
        setCells(data.cells);
        fetchedRef.current = true;
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        console.error("Failed to fetch fog cells:", err);
      } finally {
        setIsLoading(false);
      }
    }

    fetchCells();
    return () => controller.abort();
  }, [enabled]);

  return { cells, isLoading };
}
