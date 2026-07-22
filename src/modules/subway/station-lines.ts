/**
 * Resolving which lines serve a station — the link that lets the map paint a
 * station dot in its line's colour instead of a neutral white.
 *
 * There is no join table: `subway_stations.line_refs` holds the raw OSM refs a
 * station's route relations were tagged with. `subway_lines.ref` comes from the
 * same relations' `ref` tag, while a station's entries fall back to the relation
 * `name` when it has no `ref` — so both keys have to be matched.
 */

export interface StationLine {
  id: string;
  /** Scoping key: refs like "1" or "2" collide across cities. */
  systemId: string;
  name: string | null;
  ref: string | null;
  color: string;
}

/**
 * Natural (numeric-aware) ordering so "1" sorts before "10". Station
 * `line_refs` are stored lexicographically at ingest time, which would
 * otherwise make line 10 the primary line of a 1/10 transfer station.
 */
const refCollator = new Intl.Collator("ko", { numeric: true, sensitivity: "base" });

export function buildStationLineIndex(lines: StationLine[]): Map<string, StationLine> {
  const index = new Map<string, StationLine>();
  // Refs are indexed before names — and never overwritten by one — so a line
  // keyed by its own `ref` cannot be displaced by an unrelated line whose
  // `name` happens to be that same string.
  for (const line of lines) {
    if (line.ref && !index.has(`${line.systemId}:${line.ref}`)) {
      index.set(`${line.systemId}:${line.ref}`, line);
    }
  }
  for (const line of lines) {
    if (line.name && !index.has(`${line.systemId}:${line.name}`)) {
      index.set(`${line.systemId}:${line.name}`, line);
    }
  }
  return index;
}

/**
 * Lines serving a station, ordered naturally by ref. Unmatched refs are dropped
 * — a route relation with no renderable geometry never becomes a line row.
 */
export function resolveStationLines(
  index: Map<string, StationLine>,
  systemId: string,
  lineRefs: string[]
): StationLine[] {
  const seen = new Set<string>();
  return [...lineRefs]
    .sort((a, b) => refCollator.compare(a, b))
    .map((ref) => index.get(`${systemId}:${ref}`))
    .filter((line): line is StationLine => {
      if (!line || seen.has(line.id)) return false;
      seen.add(line.id);
      return true;
    });
}
