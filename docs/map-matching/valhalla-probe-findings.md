# Valhalla probe findings

Ground-truth for `ghcr.io/valhalla/valhalla:latest`, gathered by hand-running the
image's real binaries and then probing a live service — not by reading Valhalla's
docs and guessing. Same spirit as `docs/health/google-health-spike-findings.md`:
only what was actually observed, with the real request/response bodies pasted in.

The task-2 brief assumed the `gis-ops/docker-valhalla` project's conventions
(`tile_urls` env var, `/valhalla/scripts/*.sh`, a convenience entrypoint). None of
that exists in `ghcr.io/valhalla/valhalla:latest` — see "Image facts" below. This
doc corrects that and records what the image actually does.

**Scope**: the tile set this probe ran against covers **South Korea only**
(`https://download.geofabrik.de/asia/south-korea-latest.osm.pbf`, ~272MB), not the
full 5-region `MAP_EXTRACTS` list in `src/lib/map-extracts.ts` (~1.4GB total). The
probe's in-coverage coordinates (Seoul, Gangnam-daero) and out-of-coverage
coordinate (South Atlantic) both work correctly against a Korea-only tile set — the
Atlantic point is outside every extract regardless of how many are built.
`docker/valhalla/entrypoint.sh` still handles the full list; only this task's build
was scoped down.

## 1. Valhalla version

```
valhalla_service 3.8.3-14582d257
valhalla_build_tiles 3.8.3-14582d257
```

Also reported by the running service:

```json
{ "version": "3.8.3-14582d257", ... }
```

**Gotcha**: the image's own OCI label says `org.opencontainers.image.version:
"24.04"` — that is the Ubuntu base image tag (confirmed via `/etc/os-release`:
`Ubuntu 24.04.4 LTS (Noble Numbat)`), **not** Valhalla's version. Don't read that
label as the Valhalla version.

`/usr/local/valhalla_version` inside the image contains just the git short hash:
`14582d257` (no `3.8.3` prefix — that comes from `--version`/`/status`, not this
file).

## 2. `/trace_attributes` success response — real field names

Request (Seoul, Gangnam-daero, 4 points, real coverage):

```json
{
  "shape": [
    { "lat": 37.4979, "lon": 127.0276, "time": 0 },
    { "lat": 37.4985, "lon": 127.0281, "time": 6 },
    { "lat": 37.4991, "lon": 127.0287, "time": 12 },
    { "lat": 37.4997, "lon": 127.0292, "time": 18 }
  ],
  "costing": "auto",
  "shape_match": "map_snap",
  "filters": {
    "attributes": [
      "edge.names",
      "edge.road_class",
      "matched.point",
      "matched.type",
      "matched.edge_index",
      "confidence_score"
    ],
    "action": "include"
  }
}
```

Response — `HTTP 200`:

```json
{
  "units": "kilometers",
  "confidence_score": 1,
  "edges": [
    { "road_class": "primary", "names": ["강남대로", "41"] },
    { "road_class": "primary", "names": ["서초대로", "90"] },
    { "road_class": "primary", "names": ["테헤란로", "90"] },
    { "road_class": "primary", "names": ["테헤란로", "90"] },
    { "road_class": "residential", "names": ["강남대로92길"] },
    { "road_class": "residential", "names": ["테헤란로5길"] },
    { "road_class": "residential", "names": ["테헤란로5길"] }
  ],
  "matched_points": [
    { "lon": 127.027525, "lat": 37.497877, "type": "matched", "edge_index": 0 },
    { "lon": 127.028307, "lat": 37.4981, "type": "matched", "edge_index": 3 },
    { "lon": 127.028765, "lat": 37.498957, "type": "matched", "edge_index": 4 },
    { "lon": 127.029393, "lat": 37.49973, "type": "matched", "edge_index": 6 }
  ],
  "alternate_paths": []
}
```

Confirmed field names, all as assumed in the brief:
- `matched_points[]` — `lat`, `lon`, `type`, `edge_index` (note: serialized as
  `lon` before `lat` in this build, not that it matters for JSON field access)
- `edges[]` — `names` (array), `road_class` (string, e.g. `"primary"`,
  `"residential"`)
- top-level `confidence_score` — **confirmed real**, but see the bug below

### Bug found in the brief's own probe script

The brief's Step 1 script's `FILTERS.attributes` list did **not** include
`"confidence_score"`. The first run against real tiles came back with no
`confidence_score` field at all — not `null`, just absent. Re-running the exact
same request **without** a `filters` block at all (unfiltered) shows the full set
of top-level fields Valhalla can return:

```json
{
  "units": "kilometers",
  "osm_changeset": ...,
  "shape": "...",
  "confidence_score": 1.0,
  "raw_score": ...,
  "admins": [{ "country_text": "None", "state_text": "None" }],
  "edges": [...],
  "matched_points": [...],
  "alternate_paths": []
}
```

`admins` is real, but empty in the sense that matters — `country_text`/`state_text`
are both the literal string `"None"` for every point, because this task's build
never ran `valhalla_build_admins` (see §6, "Missing admin/timezone databases
degrade gracefully" — deliberately out of scope for map-matching correctness).
Don't plan on `admins` carrying a real country/state until that database is
built; right now it's a fixed placeholder, not per-point data.

So `filters.attributes` with `action: "include"` is an **allowlist over every
field in the response**, not just per-edge/per-point attributes — top-level
`confidence_score`/`raw_score`/`admins`/`osm_changeset`/`shape` are gated by it
too. The bare (unprefixed) name `"confidence_score"` is the correct filter key —
confirmed by adding it and getting the field back:

```
POST /trace_attributes  filters.attributes: ["confidence_score", "edge.names"]
→ { "units": "kilometers", "confidence_score": 1.0, "edges": [...], "alternate_paths": [] }
```

`scripts/probe-valhalla.ts` has been fixed to include `"confidence_score"` in its
filter list — **the adapter must do the same**, or every match will silently come
back with `confidence_score: undefined`.

### `matched_points[].type` is a three-value enum, not just `matched`

The 4-point Gangnam-daero sample above only exercises `type: "matched"` — every
point in a short, clean, well-spaced trace snaps cleanly. That's not the whole
enum, and it's not representative of what the adapter will actually see: OwnTracks
pings every few seconds, which produces a much denser trace than 4 points spanning
~250m.

Built a 60-point dense trace along the same Gangnam-daero corridor (~1.3m–7m
point spacing, 2s time steps — the shape an OwnTracks track actually has) and
matched it with the same filter set as above. Real result:

```
total matched_points: 60
{'matched': 31, 'interpolated': 26, 'unmatched': 3}
confidence_score: 1.0
```

An illustrative window (`matched_points[9:14]`) showing all three types in
sequence, pasted verbatim:

```json
[
  { "lon": 127.028249, "lat": 37.498082, "type": "interpolated", "edge_index": 2 },
  { "lon": 127.028324, "lat": 37.498105, "type": "matched", "edge_index": 3 },
  { "lon": 127.028183, "lat": 37.49856, "type": "unmatched" },
  { "lon": 127.028207, "lat": 37.498611, "type": "matched", "edge_index": 4 },
  { "lon": 127.028188, "lat": 37.498648, "type": "interpolated", "edge_index": 4 }
]
```

The third element is pasted exactly as received — **`"edge_index"` is absent
from `unmatched` points, not `null` or `-1`**. Confirmed across all 3 unmatched
points in the 60-point sample, not just this one.

What each type means for reconstructing a shape:
- **`matched`** — Valhalla placed this input point confidently on a specific
  edge (`edge_index` into the `edges[]` array).
- **`interpolated`** — the input point falls between two confidently-matched
  points; Valhalla still resolved it to a position along the matched path and
  still reports an `edge_index`. This is not "no data" — it's a real point on
  the reconstructed shape, just not one the algorithm is as confident was an
  independent GPS fix on that exact edge.
- **`unmatched`** — Valhalla could not confidently place this input point at
  all. No `edge_index` key is present.

**Adapter takeaway — two separate bugs this would otherwise ship with:**
1. A naive `matched_points.filter(p => p.type === "matched")` (the obvious
   first design, and what the plan before this task assumed) throws away 26 of
   60 points on this trace — nearly half. `interpolated` points are real path
   geometry and belong in the reconstructed shape.
2. Any code doing `edges[p.edge_index]` without checking `p.type !== "unmatched"`
   (or `"edge_index" in p`) first will throw on `undefined` the first time a
   real trace produces an unmatched point — which happened 3 times in this one
   60-point sample, so it is not a rare edge case on real GPS density.

## 3. Coverage vs. error — the exact rule

**Rule: `HTTP 400` + `error_code: 444` is the "couldn't snap this shape to any
road in the loaded tiles" signal.** It fires identically whether the cause is
"zero tiles loaded at all" or "real tiles loaded, but this point is outside all
of them" — both were tested and produced byte-identical error bodies. Any other
`error_code` at `HTTP 400` is a **request-shape problem** (bad costing, missing
field, malformed JSON, over the trace-point cap), not a coverage gap. Valhalla
never returned a `5xx` in any of these tests — genuine engine crashes were not
observed and would presumably differ from all of the below, but no case in this
probe triggered one.

### "No coverage" (South Atlantic, `lat: -30.0, lon: -20.0`, real Korea tiles loaded)

```
HTTP 400
{
  "error_code": 444,
  "error": "Map Match algorithm failed to find path: map_snap algorithm failed to snap the shape points to the correct shape.",
  "status_code": 400,
  "status": "Bad Request"
}
```

Identical body was produced by a second, independent test against a **freshly
started service with zero tiles loaded at all** (empty `/custom_files`, Seoul
coordinates) — confirming `error_code: 444` really means "nothing to snap to
here," not something specific to the Atlantic test point.

### "No coverage" also fires *inside* the built region, off any road

The claim that matters most for the adapter's design isn't the Atlantic case —
it's whether `error_code: 444` can be trusted to mean "this coordinate needs a
wider extract." It can't. Tested a point well inside the built Korea bbox
(`[124.5, 33.0, 132.0, 38.7]`) but nowhere near a mapped road — Soyang Lake,
`37.935, 127.85`:

```
HTTP 400
{
  "error_code": 444,
  "error": "Map Match algorithm failed to find path: map_snap algorithm failed to snap the shape points to the correct shape.",
  "status_code": 400,
  "status": "Bad Request"
}
```

Byte-identical to the South Atlantic response above. **This means `error_code:
444` alone cannot drive a "widen the extracts" operator action** — a point
inside every built extract can produce exactly the same signal as a point
outside all of them. Any tooling built on top of `no_coverage` rows (an alert,
a dashboard suggesting which region to extend) needs a second signal to tell
the two cases apart — e.g. checking the failed point's lat/lon against the
`bbox` of each `MAP_EXTRACTS` entry (`src/lib/map-extracts.ts`) before deciding
whether "outside every extract" is even a plausible explanation. This probe
doesn't build that check — it only establishes that `error_code: 444` by
itself can't.

### Contrast: genuine request/validation errors (same `HTTP 400`, different `error_code`)

| Case | `error_code` | `error` |
|---|---|---|
| Invalid costing name (`"flying_carpet"`) | `125` | `No costing method found: 'flying_carpet'` |
| Missing `shape` field | `114` | `Insufficiently specified required parameter 'shape' or 'encoded_polyline'` |
| Malformed JSON body | `100` | `Failed to parse json request` |
| Over `max_trace_points` (16001 points) | `153` | `Too many shape points: (16001). The limit is 16000` |
| Trace too long (Busan→Seoul, ~250km) | `154` | `Path distance exceeds the max distance limit: 200000 meters` |

The `154` case, pasted in full:

```
HTTP 400
{
  "error_code": 154,
  "error": "Path distance exceeds the max distance limit: 200000 meters",
  "status_code": 400,
  "status": "Bad Request"
}
```

`154` comes from the same `service_limits.trace` config block as `max_shape`
(§5) — the full block, read back from the generated `valhalla.json`:

```json
{
  "max_distance": 200000.0,
  "max_gps_accuracy": 100.0,
  "max_search_radius": 100.0,
  "max_shape": 16000,
  "max_alternates": 3,
  "max_alternates_shape": 100
}
```

`max_distance` (200km) is the one that produced `154` above. `max_search_radius`
(100m) and `max_gps_accuracy` (100m) weren't independently triggered in this
probe, but they shape match behavior the same way: `max_search_radius` bounds
how far Valhalla will look from an input point for a candidate edge (relevant
to how far "off-road" a point can be and still match), and `max_gps_accuracy`
caps the per-point accuracy value the request can claim. Both are worth the
adapter's awareness even without a paste of a triggered failure for each.

**Adapter takeaway**: classify strictly on `error_code`, not on `status_code`
alone — every case above is `HTTP 400`. `error_code === 444` → `no_coverage`,
though see the caveat above — it isn't proof the extract needs widening.
`error_code === 154` is a different bucket from the other request-shape
errors (125/114/100/153): those are caller bugs (fix the request), but `154`
is "this trace is legitimate, just too long for one call" — a well-formed
OwnTracks track spanning an intercity trip will genuinely exceed 200km. The
correct response to `154` is **chunk the trace and retry**, not surface it as
a failure needing investigation; treating it the same as 125/114/100 would page
an operator for a perfectly normal long trip. Any other 4xx `error_code` this
probe didn't produce would be the actual "unexpected engine error" bucket.

## 4. Costing support

All five costings the brief asked about return `HTTP 200` with real matched
edges/points against the Korean tile set:

```
auto: HTTP 200
pedestrian: HTTP 200
bicycle: HTTP 200
motorcycle: HTTP 200
bus: HTTP 200
```

`motorcycle` and `bus` are both real, working costings — not silently falling
back to `auto` or erroring.

The generated `valhalla.json`'s `service_limits` block independently confirms a
broader set of accepted costing names, each with its own limits sub-block: `auto`,
`bus`, `taxi`, `pedestrian`, `motor_scooter`, `motorcycle`, `bicycle`,
`multimodal`, `transit`, `truck`. Also spot-checked `motor_scooter`/`taxi` return
`HTTP 200` (validation passes) against the zero-tile instance, though only the
brief's five were matched against real Korea coverage.

## 5. `max_trace_points` real limit

**`16000`**, from `service_limits.trace.max_shape` — the default `valhalla_build_config`
writes when not overridden (this repo's config generation does not override it).
Confirmed by binary search at the boundary:

```
1000 points:  HTTP 200
3000 points:  HTTP 200
6500 points:  HTTP 200
10000 points: HTTP 200
16000 points: HTTP 200
16001 points: HTTP 400  error_code 153  "Too many shape points: (16001). The limit is 16000"
20000 points: HTTP 400  error_code 153  "Too many shape points: (20000). The limit is 16000"
```

The brief's own probe script only tested up to 10000 — comfortably under the
real cap, so it would never have observed the boundary. `scripts/probe-valhalla.ts`
now also tests `16000`/`16001`/`20000` to actually exercise the cutoff.

This is a config value (`--service-limits-trace-max-shape`), not compiled in — it
could be raised if a future adapter needs longer traces, but ships at 16000.

## 6. Image facts (what makes this run at all)

**The brief's assumptions were wrong.** `ghcr.io/valhalla/valhalla:latest` is a
bare image:

```
docker image inspect ghcr.io/valhalla/valhalla:latest --format '{{.Config.Entrypoint}} {{.Config.Cmd}}'
[] [/bin/bash]
```

- **No `/valhalla` directory anywhere.** `ls /valhalla` → `No such file or
  directory`.
- **No entrypoint/convenience scripts.** `find / -iname '*entrypoint*'` (excluding
  `/proc`) turns up nothing but apt's own `docker-*.conf` housekeeping files and
  `/.dockerenv`. `cat /valhalla/scripts/*.sh` → `No such file or directory`.
- **No `tile_urls` / `custom_files` / `server_threads` env-var handling.** Those
  are `gis-ops/docker-valhalla` conventions (a different project); this image
  reads none of them. Confirmed by grepping the binaries' own `--help` output —
  none accept or document any such variable, and setting them and starting the
  container changes nothing.
- With Cmd `[/bin/bash]` and no TTY/stdin, the container runs `bash` with no
  input, which exits `0` immediately — under `restart: unless-stopped` (Task 1's
  original compose block) this is a fast restart loop with no log output, which
  is exactly what was observed before this task started.

Base OS: `Ubuntu 24.04.4 LTS (Noble Numbat)`.

Binaries, all present in `/usr/local/bin` (confirmed via `command -v` and `ls`):

- `valhalla_build_config` — Python/argparse. Generates `valhalla.json`. Real
  defaults observed in a fresh generation: `mjolnir.tile_dir = /data/valhalla`,
  `mjolnir.tile_extract = /data/valhalla/tiles.tar` (both overridden by this
  repo's entrypoint), `httpd.service.listen = "tcp://*:8002"` (matches the
  brief's assumed port), `service_limits.trace.max_shape = 16000`.
- `valhalla_build_tiles` — C++/cxxopts. Usage: `valhalla_build_tiles [OPTION...]
  OSM PBF file(s)` — takes **one or more local PBF file paths** (not URLs) plus
  `-c <config.json>`. Downloading is the caller's job — confirmed no URL-fetch
  capability in its `--help`.
- `valhalla_build_extract` — Python/argparse + shapely. Bundles the tile
  directory's many small `.gph` files into **one** tar at the config's
  `mjolnir.tile_extract` path. `-O/--overwrite` replaces a stale tar. This is
  what produces a single-file build artifact — the raw tile output is **not** one
  file (see below).
- `valhalla_service` — C++. Usage: `valhalla_service CONFIG_JSON [CONCURRENCY]`.
  `valhalla_service /custom_files/valhalla.json 2` runs a **foreground**,
  multi-threaded HTTP server bound to `httpd.service.listen` (`tcp://*:8002` by
  default) — one process, no separate worker processes needed at this scale.
- `valhalla_build_admins`, `valhalla_build_timezones` — both optional, both
  **skipped** by this task's entrypoint (see below). `valhalla_build_timezones`
  is worth flagging: **it ignores `--help`** and unconditionally does its real
  job — downloads a shapefile from an external host, builds a SpatiaLite db, and
  writes the finished sqlite file's raw bytes to stdout. Piping it without
  redirection dumps binary data to the terminal. Not run as part of this task.
- ~19 more (`valhalla_add_elevation`, `valhalla_add_landmarks`,
  `valhalla_add_predicted_traffic`, `valhalla_assign_speeds`,
  `valhalla_benchmark_admins`, `valhalla_build_connectivity`,
  `valhalla_build_landmarks`, `valhalla_build_statistics`,
  `valhalla_convert_transit`, `valhalla_expand_bounding_box`,
  `valhalla_export_edges`, `valhalla_ingest_transit`, `valhalla_loki_worker`,
  `valhalla_odin_worker`, `valhalla_query_transit`, `valhalla_thor_worker`,
  `valhalla_validate_transit`, `valhalla_ways_to_edges`) — none needed for this
  task.

Also present and usable by the entrypoint without any extra install step:
`curl` (`/usr/bin/curl`) and `wget` (`/usr/bin/wget`) for downloading PBFs;
`python3` 3.12.3 with `shapely` 2.0.3 (used internally by `valhalla_build_config`
and `valhalla_build_extract`, not by our entrypoint directly).

### Tile output shape

`valhalla_build_tiles` writes **hundreds of small `.gph` files** under
`mjolnir.tile_dir`, not one artifact:

```
/custom_files/valhalla_tiles/0/002, 0/003, 1/044, 1/045, 1/046, 2/000, ...
595 files total, 658MB, South Korea only
```

There is no single "tile artifact filename" to check for out of the box — that's
why the entrypoint runs `valhalla_build_extract` immediately after
`valhalla_build_tiles` to produce **`valhalla_tiles.tar`** (688MB for Korea) as
the single file the stamp-check logic looks for. This also means the running
service reads one file instead of hundreds — `valhalla_service` logs "Tile
extract successfully loaded with tile count: 595" confirming it used the tar, not
the directory, once built.

### Missing admin/timezone databases degrade gracefully

This task's entrypoint does not build `admins.sqlite` or `timezones.sqlite`
(out of scope — not needed for map-matching correctness, only for
country/timezone enrichment on other Valhalla actions). Confirmed this doesn't
break the build; `valhalla_build_tiles`'s own log shows graceful `WARN`-level
degradation, not a failure:

```
[WARN] Admin db /custom_files/valhalla_tiles/admins.sqlite not found. Not saving admin information.
[WARN] Time zone db /custom_files/valhalla_tiles/timezones.sqlite not found.  Not saving time zone information.
```

Exit code was still `0` and every subsequent `/trace_attributes` call worked
normally.

### Build timing (South Korea only, 272MB PBF)

```
valhalla_build_tiles:   48s real / 1m59s user  (multi-threaded)
valhalla_build_extract: <1s
```

Well under a minute once the PBF is on disk. The brief's "수십 분" (tens of
minutes) estimate is accurate for the **full 5-region ~1.4GB `MAP_EXTRACTS`
set**, not for Korea alone — this task deliberately built Korea only (see
"Scope" above).

## 7. Entrypoint verification (Step 5, run for real via `docker compose`)

Ran against the real `docker-compose.yml` service, not simulated. Because this
was genuinely the first build (Task 1 never actually built tiles, only staged
the compose stub), the sequence differs slightly from the brief's assumption
that tiles were "already built" — first run necessarily shows `building tiles`,
not `tiles are current`. Both branches of the decision logic were exercised:

**1. First-ever `docker compose up -d valhalla`** (`EXTRACTS_FINGERPRINT=3ba0a7a3f995`,
`VALHALLA_TILE_URLS=".../south-korea-latest.osm.pbf"`):

```
[valhalla] building tiles (fingerprint=3ba0a7a3f995)
[valhalla] south-korea-latest.osm.pbf already downloaded, reusing
... 51s valhalla_build_tiles ...
[valhalla] tile build finished
[INFO] Tile extract successfully loaded with tile count: 595
```

(The PBF had been pre-copied into the volume's `pbf/` subdirectory ahead of
this run, from the same file already downloaded earlier in this task, purely
to avoid a second multi-minute network fetch — the log line above is the
entrypoint's real "already downloaded, reusing" branch, not a download that
was skipped some other way.)

Verified the service actually answers: `docker exec cistory-valhalla curl
localhost:8002/status` returned the real version/actions payload.

**2. `docker compose restart valhalla`** (same fingerprint, unchanged):

```
[valhalla] tiles are current, skipping build
```

Confirmed — the skip path works.

**3. `EXTRACTS_FINGERPRINT=deadbeef0000 docker compose up -d valhalla`** (forces
a config change → recreate):

```
[valhalla] building tiles (fingerprint=deadbeef0000)
[valhalla] downloading south-korea-latest.osm.pbf
```

Confirmed — a changed fingerprint reliably re-triggers a build. Stopped the
container immediately after observing this (mid-download, before the
destructive `rm -rf $TILE_WORK_DIR/*` step that only runs after all PBFs are
fetched) rather than let a second full rebuild complete — the decision logic
being tested was already proven, and stopping early left the volume's real
tiles/tar/stamp from step 1 untouched. Verified afterward: `.tile_build_stamp`
still reads `fingerprint=3ba0a7a3f995`, `valhalla_tiles.tar` still 688MB.

### Fixed after review: an unset `EXTRACTS_FINGERPRINT` used to force a rebuild on every start

The first version of this entrypoint had a real bug: it wrote the stamp with
`fingerprint=${EXTRACTS_FINGERPRINT:-unset}` (the literal string `"unset"`) but
compared against `${EXTRACTS_FINGERPRINT:-}` (empty string) when deciding
whether to rebuild. `"unset" != ""` is always true, so with `EXTRACTS_FINGERPRINT`
left unset — which was possible, since `docker-compose.yml` defaulted it to
empty and `.env.example` never mentioned it — every single container start
would rebuild from scratch: a full re-download and re-bake of every configured
extract, tens of minutes, with matching down for the whole window because the
tile directory gets wiped (`rm -rf "$TILE_WORK_DIR"/*`) before the rebuild.

Fixed two ways, not just one:
1. Both sides of the comparison now read the same variable consistently (no more
   `"unset"` vs `""` mismatch).
2. `EXTRACTS_FINGERPRINT` being unset/empty is now a **hard refusal** —
   `docker/valhalla/entrypoint.sh` exits 1 immediately, before touching
   anything, the same way it already refused to start with no PBF URLs. An
   unset fingerprint means the rebuild-on-extract-change check can never do
   anything useful, so it's the same class of misconfiguration, not a
   degraded-but-working mode.

Verified both, for real, against the running image:

```
$ docker run --rm -v cistory_cistory_valhalla_tiles:/custom_files \
    -v "$(pwd)/docker/valhalla/entrypoint.sh:/entrypoint.sh:ro" \
    -e VALHALLA_TILE_URLS='https://download.geofabrik.de/asia/south-korea-latest.osm.pbf' \
    --entrypoint /bin/bash ghcr.io/valhalla/valhalla:latest /entrypoint.sh
[valhalla] EXTRACTS_FINGERPRINT is unset — refusing to start. Without a real value the rebuild-on-extract-change check can never do anything (see docs/map-matching/valhalla-probe-findings.md, Fix round 1 §1). Set it to extractsFingerprint() from src/lib/map-extracts.ts.
$ echo $?
1
```

— exits before creating `$TILE_DIR`, before running `valhalla_build_config`,
before touching the volume at all. Re-ran the existing skip-path check (matching
fingerprint `3ba0a7a3f995`, the real value already on this volume's stamp)
afterward to confirm the fix didn't break the working case — still logs
`tiles are current, skipping build` and the service still starts.

`docker-compose.yml`'s `EXTRACTS_FINGERPRINT=${EXTRACTS_FINGERPRINT:-}` default
was deliberately **not** changed to a hard `${EXTRACTS_FINGERPRINT:?err}`
Compose-level guard — tested, and that form breaks `docker compose config`
(and therefore every `docker compose` command, including ones targeting
unrelated services like `postgres`) for the whole file the moment the variable
is unset in the shell, not just for `valhalla`. The entrypoint's own runtime
check is correctly scoped to just this one container failing at start; the
Compose-level `:?` form is not.

This hard refusal, plus the pre-existing "no PBF URLs" refusal, are both real
`exit 1` paths a fresh clone following `.env.example` can hit — a clone that
never set `EXTRACTS_FINGERPRINT` before this fix hits the new refusal
immediately. `docker-compose.yml`'s restart policy for `valhalla` was
`unless-stopped`, which restarts forever on any non-zero exit at ~1min
backoff. Changed to `restart: on-failure:5` — still recovers from a genuine
transient crash a few times, but stops once it's clearly a persistent
misconfiguration rather than looping indefinitely.

### Note on the fingerprint value used for this task

`extractsFingerprint()` over the real, full `MAP_EXTRACTS` (all 5 regions) is
`0cd893ece59f`. Using that value on a Korea-only build's stamp would have been
dishonest — a real deploy later setting `EXTRACTS_FINGERPRINT=0cd893ece59f` with
all 5 URLs would see a matching stamp and **skip building the other 4 regions**,
silently serving partial coverage under a fingerprint that claims full coverage.
Instead, the stamp was written with `fingerprintOf()` (the pure function `src/lib
/map-extracts.ts` already exports) applied to just the `south-korea` entry:
`3ba0a7a3f995`. This is a real value from real exported code, just correctly
scoped to what this task actually built. The first real deployment, using the
true `EXTRACTS_FINGERPRINT` over all 5 regions, will correctly see a mismatch and
build all 5 from scratch — it will not be fooled by this task's Korea-only stamp.

## Final state left behind

- `cistory_cistory_valhalla_tiles` docker volume: **populated** — `valhalla.json`,
  `valhalla_tiles/` (658MB, 595 files), `valhalla_tiles.tar` (688MB),
  `.tile_build_stamp` (`built_at=2026-08-07`, `fingerprint=3ba0a7a3f995`).
- `cistory-valhalla` container: **stopped** (matches the state found at the start
  of this task — not left running).
- All throwaway probe containers/volumes (`cistory-valhalla-probe`,
  `cistory-valhalla-probe2`, `valhalla-scratch-test`, and the unnamed container
  used to verify the unset-`EXTRACTS_FINGERPRINT` refusal) removed.
