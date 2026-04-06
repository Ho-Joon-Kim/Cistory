"use client";

import { useRef, useEffect, useCallback } from "react";
import { useMap } from "react-map-gl/mapbox";
import { useTheme } from "next-themes";

interface FogOfWarLayerProps {
  cells: { lat: number; lon: number }[];
}

/** Convert meters to pixels at a given zoom level and latitude */
function metersToPixels(meters: number, lat: number, zoom: number): number {
  return meters / ((78271.484 * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, zoom));
}

export function FogOfWarLayer({ cells }: FogOfWarLayerProps) {
  const { current: map } = useMap();
  const { resolvedTheme } = useTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);

  const render = useCallback(() => {
    const canvas = canvasRef.current;
    const mapInstance = map?.getMap();
    if (!canvas || !mapInstance) return;

    const container = mapInstance.getContainer();
    const width = container.clientWidth;
    const height = container.clientHeight;

    // Handle high-DPI displays
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.scale(dpr, dpr);

    // Step 1: Fill entire canvas with fog
    const fogColor =
      resolvedTheme === "dark" ? "rgba(10, 10, 20, 0.55)" : "rgba(0, 0, 0, 0.45)";
    ctx.fillStyle = fogColor;
    ctx.fillRect(0, 0, width, height);

    // Step 2: Cut out visited cells
    ctx.globalCompositeOperation = "destination-out";

    const zoom = mapInstance.getZoom();

    for (const cell of cells) {
      const pixel = mapInstance.project([cell.lon, cell.lat]);
      // ~500m radius per cell (cells are ~1km grid)
      const radiusPx = metersToPixels(600, cell.lat, zoom);

      // Skip cells that are off-screen (with padding for gradient edge)
      if (
        pixel.x < -radiusPx ||
        pixel.x > width + radiusPx ||
        pixel.y < -radiusPx ||
        pixel.y > height + radiusPx
      ) {
        continue;
      }

      // Radial gradient for soft edges
      const gradient = ctx.createRadialGradient(
        pixel.x,
        pixel.y,
        0,
        pixel.x,
        pixel.y,
        radiusPx,
      );
      gradient.addColorStop(0, "rgba(0, 0, 0, 1)");
      gradient.addColorStop(0.7, "rgba(0, 0, 0, 1)");
      gradient.addColorStop(1, "rgba(0, 0, 0, 0)");

      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(pixel.x, pixel.y, radiusPx, 0, Math.PI * 2);
      ctx.fill();
    }

    // Reset composite operation
    ctx.globalCompositeOperation = "source-over";
  }, [map, cells, resolvedTheme]);

  // Schedule a render via requestAnimationFrame (debounced)
  const scheduleRender = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
    }
    rafRef.current = requestAnimationFrame(render);
  }, [render]);

  // Listen to map move/zoom/resize events
  useEffect(() => {
    const mapInstance = map?.getMap();
    if (!mapInstance) return;

    // Initial render
    scheduleRender();

    mapInstance.on("move", scheduleRender);
    mapInstance.on("zoom", scheduleRender);
    mapInstance.on("resize", scheduleRender);

    return () => {
      mapInstance.off("move", scheduleRender);
      mapInstance.off("zoom", scheduleRender);
      mapInstance.off("resize", scheduleRender);
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, [map, scheduleRender]);

  // Resize canvas when container resizes
  useEffect(() => {
    const mapInstance = map?.getMap();
    if (!mapInstance) return;

    const container = mapInstance.getContainer();
    const observer = new ResizeObserver(() => {
      scheduleRender();
    });
    observer.observe(container);

    return () => {
      observer.disconnect();
    };
  }, [map, scheduleRender]);

  // Re-render when theme changes
  useEffect(() => {
    scheduleRender();
  }, [resolvedTheme, scheduleRender]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width: "100%",
        height: "100%",
        pointerEvents: "none",
        zIndex: 5,
      }}
    />
  );
}
