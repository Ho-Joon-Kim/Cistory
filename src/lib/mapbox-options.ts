/**
 * Map options every Mapbox GL map in the app should spread into `<Map>` (react-map-gl)
 * or `new mapboxgl.Map()`.
 *
 * `performanceMetricsCollection` defaults to true in mapbox-gl v3 and posts
 * performance telemetry to events.mapbox.com on every map load — noise in the
 * console wherever that host is blocked (QA saw ERR_CONNECTION_REFUSED from a DNS
 * sinkhole) and data this personal app has no reason to send. The billing
 * map-load event is not optional under Mapbox's terms and is left alone, so a
 * blocked events host can still log one failed request per map load.
 */
export const MAPBOX_PRIVACY_OPTIONS = {
  performanceMetricsCollection: false,
  collectResourceTiming: false,
} as const;
