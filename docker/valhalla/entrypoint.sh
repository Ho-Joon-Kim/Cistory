#!/bin/bash
# 타일이 없거나 오래됐거나 추출본 목록이 바뀌었을 때만 굽고, 서비스를 띄운다.
#
# ghcr.io/valhalla/valhalla:latest is a BARE image: Entrypoint [], Cmd
# [/bin/bash], no /valhalla directory, no convenience scripts, no tile_urls/
# custom_files env-var handling. Those belong to a different project
# (gis-ops/docker-valhalla) and this image reads none of them — confirmed by
# running `find / -iname '*entrypoint*'` and `ls /valhalla` inside the image
# (docs/map-matching/valhalla-probe-findings.md). Every step below therefore
# calls the real binaries in /usr/local/bin by hand. `docker/valhalla/Dockerfile`
# layers exactly one thing on top of that bare image: `osmium-tool`, needed by
# the merge step below.
#
# 재빌드가 이 컨테이너 안에서 일어나는 것이 핵심이다. 앱의 cron 컨테이너에서
# 돌리면 안 된다 — 수백MB PBF를 받아 타일을 굽는 건 수십 분 CPU 작업이고,
# 이 저장소가 cron을 별도 컨테이너로 분리한 이유가 정확히 그런 작업이 웹
# 이벤트 루프를 막았기 때문이다. 같은 실수를 다른 자리에서 반복하지 않는다.
#
# -E (errtrace) is not optional here: without it, an ERR trap set in this
# top-level scope is silently invisible to failures inside a called shell
# function — errexit still aborts the script, but the trap body (record_failure
# below) never runs. Confirmed by testing both ways: same script, same failing
# command inside a function, `set -e` alone exits silently while `set -Ee`
# actually invokes the trap. build_tiles() below is exactly that shape.
set -Eeuo pipefail

TILE_DIR=/custom_files
STAMP="$TILE_DIR/.tile_build_stamp"
MAX_AGE_DAYS=${TILE_MAX_AGE_DAYS:-365}
CONFIG="$TILE_DIR/valhalla.json"
TILE_WORK_DIR="$TILE_DIR/valhalla_tiles"
# valhalla_build_extract bundles the tile directory's ~600 individual .gph
# files into one tar (confirmed: 595 files / 658MB for Korea alone → one
# 688MB valhalla_tiles.tar in well under a second). That tar is what
# valhalla_build_config's --mjolnir-tile-extract points at below, and its
# presence is what "tiles are built" actually means here — there is no
# single tile artifact filename otherwise; the alternative is a directory of
# hundreds of small files, which is a worse stamp-check target.
TILE_ARTIFACT="$TILE_DIR/valhalla_tiles.tar"
PBF_DIR="$TILE_DIR/pbf"
# Where the merged single-file PBF (see the bisection comment below) is
# staged. Lives directly under $TILE_DIR, not inside $PBF_DIR, so it survives
# on its own line in the final cleanup rather than being an accidental member
# of "everything under pbf/".
MERGED_PBF="$TILE_DIR/merged-extracts.osm.pbf"
# Admin (country/state) database — drives on-the-left vs on-the-right, among
# other things. Persisted on the volume next to valhalla_tiles.tar, rebuilt
# only when tiles are rebuilt (both are derived from the same merged PBF).
# The config's default (`/data/valhalla/admin.sqlite`) doesn't exist anywhere
# on this image — it must be pointed at a real path, same reasoning as
# --mjolnir-tile-dir/--mjolnir-tile-extract below.
ADMIN_DB="$TILE_DIR/admin.sqlite"
# Durable record of the last failed build attempt, for the backoff in
# wait_for_backoff()/record_failure() below — see the comment there for why
# this exists.
FAIL_MARKER="$TILE_DIR/.tile_build_failure"
# The realistic failure mode is a typo'd or dead extract URL, and
# EXTRACTS_FINGERPRINT does NOT change when a URL changes — it hashes each
# MAP_EXTRACTS entry's `name` and `bboxes` only (src/lib/map-extracts.ts),
# never its `url`. Keying the backoff marker on fingerprint alone would mean
# an operator who fixes a bad URL and redeploys still inherits whatever's
# left of the old backoff — up to an hour — before the corrected URL is even
# tried. Hashing VALHALLA_TILE_URLS here and folding it into the marker
# alongside the fingerprint (in wait_for_backoff/record_failure below) means
# a URL fix is treated as a genuinely different attempt and retries right
# away, while a truly unchanged, still-broken configuration keeps backing off.
URLS_HASH=$(printf '%s' "${VALHALLA_TILE_URLS:-}" | sha256sum | cut -d' ' -f1)

# A missing/empty EXTRACTS_FINGERPRINT isn't a lesser-configured mode — it
# silently defeats the whole point of the stamp check below. Refuse the same
# way the "no PBF URLs" case does further down, rather than let it slide.
#
# Deliberately NOT routed through record_failure()/the backoff below, unlike
# the "no PBF URLs" refusal in build_tiles(). Three reasons: (1) it fires
# before any real work happens — no download, no CPU burn — so it doesn't
# have the "re-processing 1.4GB on every restart" problem the backoff exists
# to bound; (2) it's a deploy-level misconfiguration (a missing
# docker-compose.yml/.env value) that no amount of waiting ever resolves on
# its own, so a backoff would only delay the fix, not enable one; (3) this
# refusal was added specifically to REPLACE a silent bad-rebuild bug with a
# loud, fast, obvious one (see the reference below) — deferring it behind a
# sleep would partly undo that. "No PBF URLs" gets backed off instead because
# a wrong-but-present URL is the realistic failure this backoff was written
# for (see URLS_HASH above); this check is a different kind of error.
if [ -z "${EXTRACTS_FINGERPRINT:-}" ]; then
  echo "[valhalla] EXTRACTS_FINGERPRINT is unset — refusing to start. Without a" \
    "real value the rebuild-on-extract-change check can never do anything (see" \
    "docs/map-matching/valhalla-probe-findings.md, Fix round 1 §1). Set it to" \
    "extractsFingerprint() from src/lib/map-extracts.ts." >&2
  exit 1
fi

# valhalla_build_config has no persistent state of its own — regenerating it
# unconditionally (cheap, <1s) guarantees $CONFIG exists before the final exec
# on BOTH the build and skip paths, rather than depending on a config file
# that a prior run happened to leave behind.
#
# --mjolnir-concurrency bounds how many threads valhalla_build_tiles spends on
# the concurrent parts of the build. Left unset, valhalla_build_tiles falls
# back to std::thread::hardware_concurrency() — one thread per CPU — and each
# thread holds its own tile-construction state, so peak memory scales with
# thread count (confirmed against this image's own source,
# src/argparse_utils.h: valhalla_build_tiles favors its own -j/--concurrency
# CLI flag, then this config's mjolnir.concurrency, then hardware_concurrency()
# only if neither is set).
#
# Real incident this guards against: on a 16-core server, an unbounded build
# ran 16 threads and valhalla_build_tiles was SIGKILLed mid-build —
#   [INFO] Building 1118 tiles with 16 threads...
#   [INFO] Enhancing local graph...
#   /entrypoint.sh: line 226: 86 Killed  valhalla_build_tiles -c "$CONFIG" ...
# — on a box with 15 GiB total RAM, 8.8 GiB already used by other workloads
# (6.9 GiB available) and swap fully exhausted (4.0 of 4.0 GiB), leaving the
# kernel nowhere to page to. The identical five-extract build succeeds on a
# machine with ~13.7 GiB available, so 16-thread peak memory sits somewhere
# between those two figures — enough to OOM-kill 6.9 GiB, not enough to touch
# 13.7 GiB.
#
# Default of 4, not 16 and not 1: this is a once-a-year rebuild
# (TILE_MAX_AGE_DAYS below), so trading build time for headroom is a fair
# trade — favor safety over the ~5 minutes an unbounded build otherwise takes.
# Assuming peak memory scales roughly linearly with thread count (the premise
# above), 4 threads targets on the order of a quarter of the 16-thread peak,
# which should clear the 6.9 GiB host with real margin to spare even with zero
# slack for the other 8.8 GiB of workloads to grow, while still finishing in
# bounded minutes rather than stretching toward how long a single-threaded
# build of ~1.4GB of merged PBF would take. Override per host via
# VALHALLA_BUILD_CONCURRENCY in .env (see .env.example) if a box has memory to
# spare or needs to be even more conservative — do NOT just delete this flag
# because it looks like it's leaving cores idle on a 16-core box; using all of
# them is exactly what got this build killed.
mkdir -p "$TILE_DIR"
valhalla_build_config \
  --mjolnir-tile-dir "$TILE_WORK_DIR" \
  --mjolnir-tile-extract "$TILE_ARTIFACT" \
  --mjolnir-admin "$ADMIN_DB" \
  --mjolnir-concurrency "${VALHALLA_BUILD_CONCURRENCY:-4}" \
  -o "$CONFIG"

needs_build() {
  [ ! -f "$STAMP" ] && return 0
  [ ! -f "$TILE_ARTIFACT" ] && return 0
  local built_fp
  built_fp=$(grep '^fingerprint=' "$STAMP" | cut -d= -f2 || echo "")
  # 추출본 목록이 바뀌면 fingerprint가 바뀐다 — 새 도시를 추가했다는 뜻이므로
  # 다음 기동에 다시 굽는다. EXTRACTS_FINGERPRINT is guaranteed non-empty here
  # (checked above), so both sides of this comparison are real values, never
  # the literal string "unset" on one side and "" on the other.
  [ "$built_fp" != "$EXTRACTS_FINGERPRINT" ] && return 0
  local age_days
  age_days=$(( ( $(date +%s) - $(stat -c %Y "$STAMP") ) / 86400 ))
  [ "$age_days" -ge "$MAX_AGE_DAYS" ] && return 0
  return 1
}

# --- Failure backoff ---------------------------------------------------
#
# Real incident that motivated this: with `restart: unless-stopped` and no
# backoff of its own, a build that fails partway through re-reads the full
# ~1.4GB of PBFs and dies at the same place on every restart — observed
# running four full cycles at roughly 2 minute 12 second intervals, each one
# burning a CPU core and re-downloading/re-processing gigabytes for nothing.
# `restart: unless-stopped` itself stays — see the block comment on the
# `valhalla` service in docker-compose.yml for why `on-failure:N` was tried
# and reverted (it doesn't survive a Docker daemon restart). The backoff
# belongs here instead, in front of the actual work.
#
# Design: a failed build attempt writes attempt count + fingerprint +
# urls_hash + epoch to $FAIL_MARKER. The next start computes an exponential
# delay from that attempt count (1m, 2m, 4m, ... capped at 1h) and sleeps out
# any remaining portion of it before touching the network or the tile
# directory. A transient failure (a flaky download, a momentarily-unreachable
# extract host) typically succeeds on the very next attempt, which is only
# ever a few minutes away — it recovers on its own. A deterministic failure
# (a genuinely bad extract URL, a real Valhalla bug) keeps failing every
# time, so the delay keeps doubling and CPU burn drops from every ~2 minutes
# to at most once an hour — bounded, not eliminated. Nothing here ever stops
# retrying altogether: once the real problem is fixed, the next scheduled
# attempt succeeds and clears $FAIL_MARKER on its own — no operator has to
# shell in and delete a marker file to get a retry to happen.
#
# "The real problem is fixed" needs both fingerprint AND urls_hash tracked,
# not just fingerprint. The realistic version of "fixed" is an operator
# correcting a typo'd or dead extract URL — and EXTRACTS_FINGERPRINT does not
# change when a URL changes (it hashes each extract's name/bboxes only, see
# src/lib/map-extracts.ts). Keying the marker on fingerprint alone would mean
# a corrected URL still inherits whatever's left of the old backoff — up to
# an hour — before actually being retried, which makes the "no operator
# hand-clearing needed" claim above true only in a technically-eventually
# sense. URLS_HASH (defined above) closes that gap: either value changing is
# treated as a different attempt, ineligible to inherit the old delay.
BACKOFF_BASE_SECONDS=60
BACKOFF_MAX_SECONDS=3600

wait_for_backoff() {
  [ -f "$FAIL_MARKER" ] || return 0
  local failed_fp failed_urls_hash attempt last_epoch now shift_exp backoff next_retry remaining
  failed_fp=$(grep '^fingerprint=' "$FAIL_MARKER" | cut -d= -f2 || echo "")
  failed_urls_hash=$(grep '^urls_hash=' "$FAIL_MARKER" | cut -d= -f2 || echo "")
  if [ "$failed_fp" != "$EXTRACTS_FINGERPRINT" ] || [ "$failed_urls_hash" != "$URLS_HASH" ]; then
    # fingerprint나 URL 중 하나라도 달라졌다 — 추출본 목록을 바꿨거나(운영자가
    # 재배포) 잘못된 URL을 고쳤다는 뜻이므로 예전 실패의 백오프를 물려받지
    # 않는다. URL만 바뀐 경우 fingerprint는 그대로다 —
    # extractsFingerprint()는 name/bboxes만 해시하고 url은 보지 않는다
    # (src/lib/map-extracts.ts) — 그래서 fingerprint 하나만으로는 이 케이스를
    # 못 잡는다.
    echo "[valhalla] $FAIL_MARKER is for a different configuration (fingerprint=$failed_fp, urls_hash=${failed_urls_hash:0:12}) — not backing off"
    return 0
  fi
  attempt=$(grep '^attempt=' "$FAIL_MARKER" | cut -d= -f2 || echo 1)
  last_epoch=$(grep '^last_attempt_epoch=' "$FAIL_MARKER" | cut -d= -f2 || echo 0)
  [ -z "$attempt" ] && attempt=1
  [ -z "$last_epoch" ] && last_epoch=0
  shift_exp=$(( attempt - 1 ))
  [ "$shift_exp" -gt 10 ] && shift_exp=10
  backoff=$(( BACKOFF_BASE_SECONDS << shift_exp ))
  [ "$backoff" -gt "$BACKOFF_MAX_SECONDS" ] && backoff=$BACKOFF_MAX_SECONDS
  now=$(date +%s)
  next_retry=$(( last_epoch + backoff ))
  if [ "$now" -lt "$next_retry" ]; then
    remaining=$(( next_retry - now ))
    echo "[valhalla] attempt #$attempt failed $(( now - last_epoch ))s ago; backing off for ${remaining}s more before retrying"
    sleep "$remaining"
  fi
}

record_failure() {
  local prev_fp prev_urls_hash prev_attempt next_attempt
  prev_fp=""
  prev_urls_hash=""
  if [ -f "$FAIL_MARKER" ]; then
    prev_fp=$(grep '^fingerprint=' "$FAIL_MARKER" | cut -d= -f2 || echo "")
    prev_urls_hash=$(grep '^urls_hash=' "$FAIL_MARKER" | cut -d= -f2 || echo "")
  fi
  # Only continue the existing attempt count when this failure is for the
  # SAME configuration as the one on disk. Otherwise (first-ever failure, or
  # the fingerprint/URLs changed since the last failure) start over at 1 —
  # a fresh configuration hasn't earned the old one's backoff multiplier,
  # even if it goes on to fail for an unrelated reason.
  if [ "$prev_fp" = "$EXTRACTS_FINGERPRINT" ] && [ "$prev_urls_hash" = "$URLS_HASH" ]; then
    prev_attempt=$(grep '^attempt=' "$FAIL_MARKER" | cut -d= -f2 || echo 0)
    [ -z "$prev_attempt" ] && prev_attempt=0
  else
    prev_attempt=0
  fi
  next_attempt=$(( prev_attempt + 1 ))
  {
    echo "attempt=$next_attempt"
    echo "last_attempt_epoch=$(date +%s)"
    echo "fingerprint=$EXTRACTS_FINGERPRINT"
    echo "urls_hash=$URLS_HASH"
  } > "$FAIL_MARKER"
  echo "[valhalla] build attempt #$next_attempt failed; recorded to $FAIL_MARKER"
}

# Called only as a plain statement (never as an if/while/&&/|| condition),
# so top-level `set -e` stays in effect inside it and a failing command
# aborts immediately instead of falling through to the next step — bash
# suspends -e for an entire function body when the function call itself is
# what's being tested by if/while, which is exactly the failure-swallowing
# bug this shape avoids.
build_tiles() {
  mkdir -p "$TILE_WORK_DIR" "$PBF_DIR"

  # VALHALLA_TILE_URLS is a space-separated list of PBF URLs (one per
  # src/lib/map-extracts.ts entry), matching what docker-compose.yml already
  # passes through from .env.example. curl is present in the base image
  # (confirmed: /usr/bin/curl), so no extra install step is needed.
  pbf_files=()
  for url in ${VALHALLA_TILE_URLS:-}; do
    name=$(basename "$url")
    if [ -f "$PBF_DIR/$name" ]; then
      echo "[valhalla] $name already downloaded, reusing"
    else
      echo "[valhalla] downloading $name"
      curl -fL --retry 3 -o "$PBF_DIR/$name" "$url"
    fi
    pbf_files+=("$PBF_DIR/$name")
  done

  if [ "${#pbf_files[@]}" -eq 0 ]; then
    echo "[valhalla] VALHALLA_TILE_URLS is empty — nothing to build, refusing to start with no tiles" >&2
    # An explicit `exit` does NOT fire the ERR trap (confirmed empirically —
    # unlike a command returning nonzero under errexit, bash treats `exit` as
    # the script ending on purpose, not a failure to react to), so
    # on_build_error would never run for this path and it would bypass the
    # backoff entirely, straight back into the restart loop it exists to
    # prevent. Record it by hand before exiting. Unlike the
    # EXTRACTS_FINGERPRINT refusal above, this one gets backed off on purpose:
    # a wrong-but-present URL (the realistic failure this backoff was written
    # for) fails via curl's own nonzero exit inside the loop above, which
    # already goes through the ERR trap normally — but an empty
    # VALHALLA_TILE_URLS is the same category of "bad extract configuration",
    # just caught here instead, and there's no reason to treat it differently.
    record_failure
    exit 1
  fi

  # --- Merge before building -------------------------------------------
  #
  # DO NOT delete this merge step and go back to handing valhalla_build_tiles
  # the PBF list directly, even though its own --help says it accepts
  # multiple files and even though two files at a time works fine. Bisected
  # empirically against this exact image (ghcr.io/valhalla/valhalla:latest,
  # 3.8.3-14582d257):
  #   - all five of this project's extracts build fine ALONE
  #   - every TWO-file combination succeeds
  #   - every THREE-file combination fails: many
  #     `Failed tile 2/NNNNNN/0: vector::_M_range_check: __n (which is N) >=
  #     this->size() (which is 0)` errors, then `terminate called after
  #     throwing an instance of 'std::exception'`
  #   - it's the file COUNT, not size — 2 files totalling 733MB succeeds, 3
  #     files totalling only 617MB fails
  #   - not memory: 318MB used of 13.7GB available, never OOM-killed
  #   - building admin.sqlite first does not help (still fails on 3+ files)
  # A two-extract config (e.g. Korea + one neighbor) will look completely
  # fine in local testing and then fall over the day a third region is
  # added — that gap is exactly why this is a merge-first pipeline instead
  # of a "looks redundant, valhalla_build_tiles already takes multiple
  # files" cleanup target. Validated end to end: `osmium merge` on all five
  # extracts took ~20s and produced a 1413MB file, and
  # valhalla_build_tiles on that single file succeeded with 1875 tiles in
  # ~276s (1875 rather than the 1883 individual per-extract total, because
  # Vietnam and Hong Kong share a coarse tile that merges — expected).
  #
  # Skipped for a single extract: `osmium merge` with one input is pointless
  # work on a file that can already be hundreds of megabytes.
  local build_input
  if [ "${#pbf_files[@]}" -eq 1 ]; then
    build_input="${pbf_files[0]}"
  else
    echo "[valhalla] merging ${#pbf_files[@]} extracts into one file (valhalla_build_tiles aborts on 3+ inputs — see comment above)"
    osmium merge -O -o "$MERGED_PBF" "${pbf_files[@]}"
    build_input="$MERGED_PBF"
  fi

  # Admin (country/state) database, built from the same single input as the
  # tiles. Not the fix for the 3+-file crash (verified separately: building
  # this first does not prevent it) — this is a correctness fix for a
  # dataset that spans both driving sides: Hong Kong and Japan drive on the
  # left, Korea/Taiwan/Vietnam drive on the right, and without admin data
  # Valhalla has no way to know which. $CONFIG's `admin` key was pointed at
  # $ADMIN_DB above, so valhalla_build_tiles below picks this up
  # automatically.
  echo "[valhalla] building admin database"
  valhalla_build_admins -c "$CONFIG" "$build_input"

  rm -rf "${TILE_WORK_DIR:?}"/*
  valhalla_build_tiles -c "$CONFIG" "$build_input"

  # Bundles TILE_WORK_DIR into TILE_ARTIFACT (the -O flag overwrites a stale
  # tar from a previous build). Optional for correctness — valhalla_service
  # falls back to reading the directory tile-by-tile if the tar is missing —
  # but it's what this script uses as its single-file "build done" marker,
  # and it also means the eventual service reads one file instead of hundreds.
  valhalla_build_extract -c "$CONFIG" -O

  # The merged file (if any) and the raw per-extract downloads have done
  # their job once the tar exists — cleaning both up here is what keeps this
  # volume from permanently carrying ~1.4GB of intermediate PBF state on top
  # of the tiles it actually needs to serve.
  rm -rf "$PBF_DIR" "$MERGED_PBF"
}

on_build_error() {
  local exit_code=$?
  if [ "$exit_code" -eq 137 ]; then
    # 137 = 128 + SIGKILL(9). A bare "Killed" from bash with no context is
    # what made the OOM incident documented at --mjolnir-concurrency above
    # take a round trip to diagnose — a build this size dying with exit 137
    # is almost always the kernel OOM killer, not a Valhalla crash, so say so
    # and point at the knob that controls it instead of leaving a silent exit
    # code for the backoff below to retry blindly against.
    echo "[valhalla] build was killed (exit 137) — this is almost always the" \
      "kernel OOM killer, not a Valhalla bug. Lower VALHALLA_BUILD_CONCURRENCY" \
      "(currently ${VALHALLA_BUILD_CONCURRENCY:-4}) in .env, or free up host" \
      "memory, then let the backoff below retry." >&2
  fi
  record_failure
  exit "$exit_code"
}

if needs_build; then
  wait_for_backoff
  echo "[valhalla] building tiles (fingerprint=$EXTRACTS_FINGERPRINT)"
  trap on_build_error ERR
  build_tiles
  trap - ERR
  rm -f "$FAIL_MARKER"

  {
    echo "built_at=$(date -u +%Y-%m-%d)"
    echo "fingerprint=$EXTRACTS_FINGERPRINT"
  } > "$STAMP"
  echo "[valhalla] tile build finished"
else
  echo "[valhalla] tiles are current, skipping build"
fi

exec valhalla_service "$CONFIG" "${VALHALLA_CONCURRENCY:-2}"
