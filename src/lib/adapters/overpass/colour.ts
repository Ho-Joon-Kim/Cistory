const CSS_NAMED_COLORS: Record<string, string> = {
  red: "#ff0000",
  blue: "#0000ff",
  green: "#008000",
  yellow: "#ffff00",
  orange: "#ffa500",
  purple: "#800080",
  black: "#000000",
  white: "#ffffff",
  grey: "#808080",
  gray: "#808080",
  brown: "#a52a2a",
  pink: "#ffc0cb",
  cyan: "#00ffff",
  magenta: "#ff00ff",
  lime: "#00ff00",
  navy: "#000080",
  olive: "#808000",
  teal: "#008080",
  silver: "#c0c0c0",
  maroon: "#800000",
};

function expandShortHex(hex: string): string {
  // #rgb -> #rrggbb
  return `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`.toLowerCase();
}

/**
 * OSM `colour` 태그 정규화. hex(#RRGGBB), short hex(#RGB), CSS named color, rgb() 모두 처리.
 * 파싱 불가 시 undefined 반환.
 */
export function normalizeOsmColour(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined;
  const s = raw.trim().toLowerCase();
  if (!s) return undefined;

  // #RRGGBB
  if (/^#[0-9a-f]{6}$/.test(s)) return s;

  // #RGB
  if (/^#[0-9a-f]{3}$/.test(s)) return expandShortHex(s);

  // CSS named color
  if (s in CSS_NAMED_COLORS) return CSS_NAMED_COLORS[s];

  // rgb(r, g, b) — Overpass 데이터에 간혹 있음
  const rgbMatch = s.match(/^rgb\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/);
  if (rgbMatch) {
    const r = Math.min(255, Number(rgbMatch[1])).toString(16).padStart(2, "0");
    const g = Math.min(255, Number(rgbMatch[2])).toString(16).padStart(2, "0");
    const b = Math.min(255, Number(rgbMatch[3])).toString(16).padStart(2, "0");
    return `#${r}${g}${b}`;
  }

  return undefined;
}
