/**
 * 같은 key에 대해 항상 같은 HSL 색을 돌려주는 해시 기반 fallback.
 * Hue만 해시로 흔들고 S/L은 고정하여 지도 위에서 가독성 보장.
 * indexInGroup이 주어지면 golden-angle(137.5°) 오프셋을 적용해 같은 그룹 내
 * fallback 노선 간 충돌을 줄인다.
 */
export function lineFallbackColor(key: string, indexInGroup = 0): string {
  // FNV-1a 32-bit
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const baseHue = Math.abs(h) % 360;
  const hue = (baseHue + indexInGroup * 137.5) % 360;
  return `hsl(${Math.round(hue)}, 65%, 45%)`;
}

export interface LineColorInput {
  colour?: string | null;
  network?: string | null;
  ref?: string | null;
  name?: string | null;
  fallbackIndex?: number;
}

export function resolveLineColor(line: LineColorInput): string {
  if (line.colour) return line.colour;
  const key = `${line.network ?? ""}:${line.ref ?? line.name ?? "unknown"}`;
  return lineFallbackColor(key, line.fallbackIndex ?? 0);
}
