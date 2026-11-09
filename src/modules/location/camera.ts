import { prefersReducedMotion } from "@/lib/hooks/usePrefersReducedMotion";

/**
 * Camera animation length that honours `prefers-reduced-motion`: a reduced-motion
 * user gets an instant jump instead of a fly/ease across the map. Read at call
 * time so every camera move sees the current OS setting.
 */
export function cameraDuration(ms: number): number {
  return prefersReducedMotion() ? 0 : ms;
}
