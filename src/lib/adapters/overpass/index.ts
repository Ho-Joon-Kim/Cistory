import { Agent, fetch as undiciFetch } from "undici";
import { logger } from "@/lib/logger";
import { normalizeOsmColour } from "./colour";
import type {
  OverpassAdapter,
  SubwayFetchResult,
  SubwayLineData,
  SubwayStationData,
} from "./interface";

export type {
  OverpassAdapter,
  SubwayFetchResult,
  SubwayLineData,
  SubwayStationData,
} from "./interface";

const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];

const OVERPASS_TIMEOUT_SEC = 180;
const FETCH_TIMEOUT_MS = (OVERPASS_TIMEOUT_SEC + 30) * 1000;

// Force IPv4 because some networks (incl. dev machines behind Tailscale/VPN)
// advertise AAAA records whose v6 routing is broken, causing Node's Happy
// Eyeballs to stall on TLS handshake even though raw TCP connects. The undici
// dispatcher with connect.family = 4 bypasses this reliably.
const ipv4Dispatcher = new Agent({
  connect: { family: 4 },
  headersTimeout: FETCH_TIMEOUT_MS,
  bodyTimeout: FETCH_TIMEOUT_MS,
});

interface OverpassElement {
  type: "node" | "way" | "relation";
  id: number;
  tags?: Record<string, string>;
  lat?: number;
  lon?: number;
  nodes?: number[];
  members?: Array<{ type: string; ref: number; role: string }>;
}

interface OverpassResponse {
  elements: OverpassElement[];
}

function buildQuery(bbox: [number, number, number, number]): string {
  const [w, s, e, n] = bbox;
  const bboxStr = `${s},${w},${n},${e}`; // Overpass: south,west,north,east
  // Collected sets:
  //   - route relations (subway + metro-like light_rail/monorail + commuter train)
  //   - stop_area relations: OSM's canonical "these stop_positions/platforms are
  //     the same physical station" grouping. Well-populated in KR/JP/TW (~1.4K–9.9K
  //     per country) — used as 1st-pass authoritative station merger.
  //   - explicit subway station/stop nodes as safety net for tagging gaps
  //
  // `out body qt` at the end: the recursive `(._;>;)` pulls all member nodes/ways,
  // but without `body` the `out skel` variant would strip their tags (name, wikidata)
  // which we need for station metadata and transfer merging.
  return `
[out:json][timeout:${OVERPASS_TIMEOUT_SEC}];
(
  relation["route"~"^(subway|light_rail|monorail)$"](${bboxStr});
  relation["route"="train"]["service"="commuter"](${bboxStr});
  relation["public_transport"="stop_area"](${bboxStr});
  node["station"="subway"](${bboxStr});
  node["railway"="station"]["subway"="yes"](${bboxStr});
  node["railway"="stop"]["subway"="yes"](${bboxStr});
);
(._;>;);
out body qt;
`.trim();
}

// Relation route values we consider "subway-like" for line + station extraction.
const SUBWAY_LIKE_ROUTES = new Set(["subway", "light_rail", "monorail", "train"]);

async function callOverpass(query: string): Promise<OverpassResponse> {
  let lastError: unknown;
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      const res = await undiciFetch(endpoint, {
        method: "POST",
        body: `data=${encodeURIComponent(query)}`,
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        signal: controller.signal,
        dispatcher: ipv4Dispatcher,
      });
      clearTimeout(timer);
      if (!res.ok) {
        lastError = new Error(`Overpass ${endpoint} responded ${res.status}`);
        logger.warn("overpass non-ok", { endpoint, status: res.status });
        continue;
      }
      return (await res.json()) as OverpassResponse;
    } catch (err) {
      lastError = err;
      const cause = (err as { cause?: unknown })?.cause;
      logger.warn("overpass endpoint failed, trying next", {
        endpoint,
        error: err instanceof Error ? err.message : String(err),
        cause: cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause),
      });
    }
  }
  throw new Error(
    `All Overpass endpoints failed: ${lastError instanceof Error ? lastError.message : String(lastError)}`
  );
}

function isSubwayStationNode(tags: Record<string, string>): boolean {
  if (tags.station === "subway") return true;
  if (tags.railway === "station" && tags.subway === "yes") return true;
  return false;
}

interface ElementIndex {
  nodes: Map<number, { lat: number; lon: number }>;
  ways: Map<number, number[]>;
  relations: OverpassElement[];
}

function indexElements(elements: OverpassElement[]): ElementIndex {
  const nodes = new Map<number, { lat: number; lon: number }>();
  const ways = new Map<number, number[]>();
  const relations: OverpassElement[] = [];
  for (const el of elements) {
    if (el.type === "node" && typeof el.lat === "number" && typeof el.lon === "number") {
      nodes.set(el.id, { lat: el.lat, lon: el.lon });
    } else if (el.type === "way" && el.nodes) {
      ways.set(el.id, el.nodes);
    } else if (el.type === "relation") {
      relations.push(el);
    }
  }
  return { nodes, ways, relations };
}

function buildLineGeometry(rel: OverpassElement, idx: ElementIndex): number[][][] {
  const coordinates: number[][][] = [];
  for (const m of rel.members ?? []) {
    if (m.type !== "way") continue;
    const wayNodes = idx.ways.get(m.ref);
    if (!wayNodes || wayNodes.length < 2) continue;
    const coords: number[][] = [];
    for (const nid of wayNodes) {
      const n = idx.nodes.get(nid);
      if (n) coords.push([n.lon, n.lat]);
    }
    if (coords.length >= 2) coordinates.push(coords);
  }
  return coordinates;
}

function buildLines(idx: ElementIndex): SubwayLineData[] {
  const lines: SubwayLineData[] = [];
  for (const rel of idx.relations) {
    const tags = rel.tags;
    if (!tags || !SUBWAY_LIKE_ROUTES.has(tags.route ?? "")) continue;
    const coordinates = buildLineGeometry(rel, idx);
    if (coordinates.length === 0) continue;
    lines.push({
      osmRelationId: rel.id,
      name: tags.name,
      nameEn: tags["name:en"],
      ref: tags.ref,
      colour: normalizeOsmColour(tags.colour ?? tags.color),
      operator: tags.operator,
      network: tags.network,
      geometry: { type: "MultiLineString", coordinates },
    });
  }
  return lines;
}

/**
 * Build stations using 4 passes, in order of authoritativeness:
 *   Pass 0: `public_transport=stop_area` relations — OSM's canonical grouping of
 *           stop_positions/platforms/entrances that form one physical station.
 *           When present, this is the most trustworthy signal.
 *   Pass 1: Explicit `station=subway` / `railway=station+subway=yes` nodes not
 *           already consumed by a stop_area.
 *   Pass 2: stop_position members of subway-like route relations, not consumed.
 *   Post: proximity+name + wikidata dedupe to catch stragglers OSM didn't group.
 */
function collectStations(
  elements: OverpassElement[],
  relations: OverpassElement[]
): SubwayStationData[] {
  const byNodeId = new Map<number, SubwayStationData>();
  const stopAreaStations: SubwayStationData[] = [];
  const consumed = new Set<number>();

  const upsertStation = (
    nodeId: number,
    tags: Record<string, string> | undefined,
    lat: number,
    lon: number
  ): SubwayStationData => {
    const existing = byNodeId.get(nodeId);
    if (existing) {
      if (!existing.name && tags?.name) existing.name = tags.name;
      if (!existing.nameEn && tags?.["name:en"]) existing.nameEn = tags["name:en"];
      if (!existing.wikidata && tags?.wikidata) existing.wikidata = tags.wikidata;
      return existing;
    }
    const station: SubwayStationData = {
      osmNodeId: nodeId,
      name: tags?.name,
      nameEn: tags?.["name:en"],
      wikidata: tags?.wikidata,
      lat,
      lon,
      lineRefs: [],
    };
    byNodeId.set(nodeId, station);
    return station;
  };

  // Index nodes with their tags
  const rawNodeById = new Map<number, OverpassElement>();
  for (const el of elements) {
    if (el.type === "node") rawNodeById.set(el.id, el);
  }

  // Precompute: which line refs each stop node participates in across route relations.
  // Used by Pass 0 (stop_area aggregation) and Pass 2.
  const nodeToLineRefs = new Map<number, Set<string>>();
  for (const rel of relations) {
    if (!SUBWAY_LIKE_ROUTES.has(rel.tags?.route ?? "")) continue;
    const lineRef = rel.tags?.ref ?? rel.tags?.name;
    if (!lineRef) continue;
    for (const m of rel.members ?? []) {
      if (m.type !== "node" || !STOP_ROLES.has(m.role)) continue;
      const set = nodeToLineRefs.get(m.ref);
      if (set) set.add(lineRef);
      else nodeToLineRefs.set(m.ref, new Set([lineRef]));
    }
  }

  // Pass 0: stop_area relations → one merged station each.
  // Track which osm node ids we've already used as representative to avoid
  // collision when multiple stop_areas share a member node (rare but happens
  // in overlapping mapper edits). A consumed node is also skipped from later
  // stop_areas so each physical station maps to exactly one pass-0 entry.
  const usedRepresentativeIds = new Set<number>();
  let stopAreaMergedCount = 0;
  for (const rel of relations) {
    if (rel.tags?.public_transport !== "stop_area") continue;
    const memberNodes: OverpassElement[] = [];
    for (const m of rel.members ?? []) {
      if (m.type !== "node") continue;
      if (consumed.has(m.ref)) continue; // already part of an earlier stop_area
      const node = rawNodeById.get(m.ref);
      if (!node || typeof node.lat !== "number" || typeof node.lon !== "number") continue;
      memberNodes.push(node);
    }
    if (memberNodes.length === 0) continue;

    // Reject stop_areas whose member nodes span more than ~1km — those are not
    // real stations. Some OSM mappers mis-use public_transport=stop_area as a
    // route aggregation ("수도권 전철 1호선: 청량리 → 천안 급행" has 30+ stops
    // spread across 100+ km). Real stations cluster within a few hundred meters.
    const lats = memberNodes.map((n) => n.lat as number);
    const lons = memberNodes.map((n) => n.lon as number);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLon = Math.min(...lons);
    const maxLon = Math.max(...lons);
    const spanM = haversineMeters(minLat, minLon, maxLat, maxLon);
    if (spanM > 1000) continue;

    // Pick a representative osm_node_id that hasn't been used yet (deterministic
    // smallest-first). If all candidates are taken, skip this stop_area —
    // consistent with OSM semantics that a node maps to at most one stop_area.
    const sortedByIdAsc = [...memberNodes].sort((a, b) => a.id - b.id);
    const representative = sortedByIdAsc.find((n) => !usedRepresentativeIds.has(n.id));
    if (!representative) continue;

    // Gather line_refs from member nodes' participation in route relations.
    // Skip stop_areas that have zero subway-like line coverage — those are typically
    // bus/tram stop_areas that snuck in because our bbox query is permissive.
    const refSet = new Set<string>();
    for (const n of memberNodes) {
      const refs = nodeToLineRefs.get(n.id);
      if (refs) for (const r of refs) refSet.add(r);
    }
    if (refSet.size === 0) continue;

    // Name priority: subway-tagged member node name > relation name > any member name.
    // Rationale: stop_areas often wrap bus-subway interchanges and the relation
    // name follows the bus stop ("서방사거리(교대)"), while the subway member
    // node has the canonical station name ("교대"). Prefer the latter.
    const subwayMember = memberNodes.find((n) => {
      const t = n.tags;
      if (!t) return false;
      return (
        t.subway === "yes" ||
        t.station === "subway" ||
        t.railway === "subway_entrance" ||
        (t.railway === "station" && t.subway === "yes") ||
        (t.railway === "stop" && t.subway === "yes") ||
        t.public_transport === "stop_position"
      );
    });
    const subwayMemberName = subwayMember?.tags?.name;
    const rawName =
      subwayMemberName ?? rel.tags?.name ?? memberNodes.find((n) => n.tags?.name)?.tags?.name;
    if (!rawName) continue;
    const name = stripAnnotationSuffix(rawName);

    const nameEn = stripAnnotationSuffix(
      subwayMember?.tags?.["name:en"] ??
        rel.tags?.["name:en"] ??
        memberNodes.find((n) => n.tags?.["name:en"])?.tags?.["name:en"]
    );
    const wikidata =
      subwayMember?.tags?.wikidata ??
      rel.tags?.wikidata ??
      memberNodes.find((n) => n.tags?.wikidata)?.tags?.wikidata;

    // Centroid over member nodes.
    const latSum = memberNodes.reduce((acc, n) => acc + (n.lat as number), 0);
    const lonSum = memberNodes.reduce((acc, n) => acc + (n.lon as number), 0);

    stopAreaStations.push({
      osmNodeId: representative.id,
      name,
      nameEn,
      wikidata,
      lat: latSum / memberNodes.length,
      lon: lonSum / memberNodes.length,
      lineRefs: Array.from(refSet).sort(),
    });
    usedRepresentativeIds.add(representative.id);
    for (const n of memberNodes) consumed.add(n.id);
    stopAreaMergedCount++;
  }

  // Pass 1: explicit station nodes not already in a stop_area
  for (const el of elements) {
    if (el.type !== "node" || !el.tags) continue;
    if (typeof el.lat !== "number" || typeof el.lon !== "number") continue;
    if (consumed.has(el.id)) continue;
    if (!isSubwayStationNode(el.tags)) continue;
    upsertStation(el.id, el.tags, el.lat, el.lon);
  }

  // Pass 2: stop members of subway route relations not consumed by stop_area
  for (const rel of relations) {
    if (!SUBWAY_LIKE_ROUTES.has(rel.tags?.route ?? "")) continue;
    const lineRef = rel.tags?.ref ?? rel.tags?.name;
    for (const m of rel.members ?? []) {
      if (m.type !== "node") continue;
      if (!STOP_ROLES.has(m.role)) continue;
      if (consumed.has(m.ref)) continue;
      const node = rawNodeById.get(m.ref);
      if (!node || typeof node.lat !== "number" || typeof node.lon !== "number") continue;
      const name = node.tags?.name;
      if (!name) continue;
      const station = upsertStation(m.ref, node.tags, node.lat, node.lon);
      if (lineRef && !station.lineRefs.includes(lineRef)) {
        station.lineRefs.push(lineRef);
      }
    }
  }

  const fallbackStations = Array.from(byNodeId.values());
  const minAdjacent = computeMinAdjacentStopDistance(rawNodeById, relations);
  // 70% of the 2nd-percentile inter-station gap. Safety rationale: for two nodes
  // at `radius` distance to falsely merge they must share a normalized name AND
  // be on the same line — the latter is vanishingly rare because same-name stops
  // on a single line don't exist in real networks. 0.7 instead of 0.5 catches
  // huge transfer stations like 서울 잠실 (2호선↔8호선 플랫폼 ~320m). Absolute
  // cap at 500m so pathological OSM data can't push us to silly numbers.
  const dedupeRadius = Math.min(500, Math.max(80, Math.floor(minAdjacent * 0.7)));
  logger.info("station collection stats", {
    stopAreaMerged: stopAreaMergedCount,
    fallbackRaw: fallbackStations.length,
    minAdjacentStopMeters: Math.round(minAdjacent),
    chosenRadiusMeters: dedupeRadius,
  });

  // Proximity + wikidata merge the combined list. Reason: in many networks each
  // subway line has its OWN stop_area relation at a transfer station (e.g. 김포공항
  // has 5 separate stop_areas for 5 lines). Without this final dedupe they'd each
  // appear as a separate 김포공항 row with one line_ref. Since they share the same
  // normalized name and sit within the data-driven radius of each other, the
  // merge produces a single transfer station with all line_refs unioned.
  const combined = [...stopAreaStations, ...fallbackStations];
  const proximityMerged = dedupeStationsByProximity(combined, dedupeRadius);
  return mergeByWikidata(proximityMerged);
}

function mergeByWikidata(stations: SubwayStationData[]): SubwayStationData[] {
  const byWikidata = new Map<string, SubwayStationData[]>();
  const withoutWikidata: SubwayStationData[] = [];
  for (const s of stations) {
    if (s.wikidata) {
      const bucket = byWikidata.get(s.wikidata);
      if (bucket) bucket.push(s);
      else byWikidata.set(s.wikidata, [s]);
    } else {
      withoutWikidata.push(s);
    }
  }
  const merged: SubwayStationData[] = [...withoutWikidata];
  for (const cluster of byWikidata.values()) {
    merged.push(mergeStationCluster(cluster));
  }
  return merged;
}

const STOP_ROLES = new Set([
  "stop",
  "stop_entry_only",
  "stop_exit_only",
  "platform",
  "platform_entry_only",
  "platform_exit_only",
]);

/**
 * Empirical lower bound on inter-station distance: walk each subway-like
 * relation's `stop`-role members in order, compute distance between consecutive
 * stops, take the global minimum. This is the "closest real adjacent stations"
 * on any line in the bbox — the dedupe radius stays strictly below this so no
 * two distinct stations on the same line can ever be merged.
 *
 * Platform members are excluded (they cluster very close to stop nodes and
 * would drag the min down artificially). Only role="stop" and its directional
 * variants are considered.
 */
function computeMinAdjacentStopDistance(
  rawNodeById: Map<number, OverpassElement>,
  relations: OverpassElement[]
): number {
  const ORDERED_STOP_ROLES = new Set(["stop", "stop_entry_only", "stop_exit_only"]);

  // Collect *all* valid adjacent-stop distances, then use a low-percentile pick
  // instead of strict min. OSM has occasional out-of-order stops, duplicated
  // platform nodes tagged at the same station, or misrouted branch points that
  // produce pathologically short edges. A percentile is robust against those
  // outliers while still reflecting the real network's tightest spacing.
  const distances: number[] = [];
  for (const rel of relations) {
    if (!SUBWAY_LIKE_ROUTES.has(rel.tags?.route ?? "")) continue;
    const stops: Array<{ lat: number; lon: number; name?: string }> = [];
    for (const m of rel.members ?? []) {
      if (m.type !== "node" || !ORDERED_STOP_ROLES.has(m.role)) continue;
      const n = rawNodeById.get(m.ref);
      if (n && typeof n.lat === "number" && typeof n.lon === "number") {
        stops.push({ lat: n.lat, lon: n.lon, name: n.tags?.name });
      }
    }
    for (let i = 1; i < stops.length; i++) {
      const a = stops[i - 1];
      const b = stops[i];
      // Same-name consecutive stops = the same physical station tagged twice
      // (common in KR/JP OSM: stop for direction A + stop for direction B both
      // listed as line members). Skip those — they're not adjacent stations.
      if (a.name && b.name && normalizeStationName(a.name) === normalizeStationName(b.name)) {
        continue;
      }
      const d = haversineMeters(a.lat, a.lon, b.lat, b.lon);
      // 80m floor: below this is certainly same-platform duplicates even when
      // names diverge (renamed/romanized variants). Above 80m treat as real.
      if (d >= 80) distances.push(d);
    }
  }
  if (distances.length === 0) return 500;
  distances.sort((a, b) => a - b);
  // 2nd percentile — tolerates ~2% genuinely weird pairs without getting
  // yanked by a single bad relation.
  const idx = Math.max(0, Math.floor(distances.length * 0.02) - 1);
  const pct = distances[idx];
  logger.info("inter-stop distance stats", {
    sampleCount: distances.length,
    min: Math.round(distances[0]),
    p02: Math.round(pct),
    p10: Math.round(distances[Math.floor(distances.length * 0.1)]),
    median: Math.round(distances[Math.floor(distances.length * 0.5)]),
  });
  return pct;
}

/**
 * Same physical station is often tagged as multiple OSM nodes (one per line's
 * stop_position). Merge entries that share a normalized name AND are within
 * `mergeRadiusM` (derived from smallest real inter-station gap in the dataset).
 * Merged station keeps the node id with the richest metadata; line_refs are
 * unioned; coords are averaged.
 */
function dedupeStationsByProximity(
  stations: SubwayStationData[],
  mergeRadiusM: number
): SubwayStationData[] {
  const merged: SubwayStationData[] = [];
  const used = new Array<boolean>(stations.length).fill(false);

  // Bucket by normalized name for O(n) neighbor search within name groups
  const byName = new Map<string, number[]>();
  for (let i = 0; i < stations.length; i++) {
    const key = normalizeStationName(stations[i].name);
    if (!key) continue;
    const bucket = byName.get(key);
    if (bucket) bucket.push(i);
    else byName.set(key, [i]);
  }

  for (let i = 0; i < stations.length; i++) {
    if (used[i]) continue;
    const anchor = stations[i];
    const key = normalizeStationName(anchor.name);
    const cluster = [anchor];
    used[i] = true;
    if (key) {
      const bucket = byName.get(key) ?? [];
      for (const j of bucket) {
        if (used[j] || j === i) continue;
        const other = stations[j];
        const dist = haversineMeters(anchor.lat, anchor.lon, other.lat, other.lon);
        if (dist <= mergeRadiusM) {
          cluster.push(other);
          used[j] = true;
        }
      }
    }
    merged.push(mergeStationCluster(cluster));
  }

  return merged;
}

/**
 * Strip "(N호선)" / "(Line 7)" / "(공항철도)" style trailing annotations that per-line
 * stop_area relations use in their names. Keep the core station name for display
 * (so the DB stores "잠실역" not "잠실역 (2호선)"). Returns undefined if input was
 * undefined; empty string if everything was annotation.
 */
function stripAnnotationSuffix<T extends string | undefined>(name: T): T {
  if (!name) return name;
  let s = name.trim();
  for (let i = 0; i < 3; i++) {
    const next = s.replace(/\s*\([^()]*\)\s*$/u, "").trim();
    if (next === s) break;
    s = next;
  }
  return s as T;
}

function normalizeStationName(name: string | undefined): string {
  if (!name) return "";
  let s = name.trim().toLowerCase();
  // Strip trailing parenthesized annotations added by per-line stop_area names
  // like "잠실역 (2호선)", "을지로3가(3호선)", "Jamsil (Songpa-gu Office)".
  // Repeat a few times in case there are nested or chained annotations.
  for (let i = 0; i < 3; i++) {
    const next = s.replace(/\s*\([^()]*\)\s*$/u, "").trim();
    if (next === s) break;
    s = next;
  }
  // Strip CJK "station" suffix so "잠실역"/"잠실" and "新宿駅"/"新宿" match.
  // Only strip when the remainder is still 2+ chars to avoid collapsing real
  // single-char names.
  const stripped = s.replace(/(역|駅|站|역사)$/u, "").trim();
  if (stripped.length >= 2) s = stripped;
  return s;
}

function mergeStationCluster(cluster: SubwayStationData[]): SubwayStationData {
  if (cluster.length === 1) return cluster[0];
  const primary = [...cluster].sort((a, b) => {
    const aScore = a.lineRefs.length * 2 + (a.nameEn ? 1 : 0) + (a.wikidata ? 1 : 0);
    const bScore = b.lineRefs.length * 2 + (b.nameEn ? 1 : 0) + (b.wikidata ? 1 : 0);
    return bScore - aScore;
  })[0];
  const allRefs = new Set<string>();
  let latSum = 0;
  let lonSum = 0;
  for (const s of cluster) {
    for (const r of s.lineRefs) allRefs.add(r);
    latSum += s.lat;
    lonSum += s.lon;
  }
  return {
    osmNodeId: primary.osmNodeId,
    name: primary.name,
    nameEn: primary.nameEn ?? cluster.find((s) => s.nameEn)?.nameEn,
    wikidata: primary.wikidata ?? cluster.find((s) => s.wikidata)?.wikidata,
    lat: latSum / cluster.length,
    lon: lonSum / cluster.length,
    lineRefs: Array.from(allRefs).sort(),
  };
}

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function parseResponse(data: OverpassResponse): SubwayFetchResult {
  const idx = indexElements(data.elements);
  const lines = buildLines(idx);
  const stations = collectStations(data.elements, idx.relations);
  return { lines, stations };
}

export class OverpassSubwayAdapter implements OverpassAdapter {
  async fetchSubwayInBbox(bbox: [number, number, number, number]): Promise<SubwayFetchResult> {
    const query = buildQuery(bbox);
    const data = await callOverpass(query);
    const result = parseResponse(data);
    logger.info("overpass subway fetch ok", {
      bbox,
      lineCount: result.lines.length,
      stationCount: result.stations.length,
    });
    return result;
  }
}

let singleton: OverpassSubwayAdapter | null = null;

export function getOverpassAdapter(): OverpassAdapter {
  if (!singleton) singleton = new OverpassSubwayAdapter();
  return singleton;
}
