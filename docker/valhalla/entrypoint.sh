#!/bin/bash
# 타일이 없거나 오래됐거나 추출본 목록이 바뀌었을 때만 굽고, 서비스를 띄운다.
#
# ghcr.io/valhalla/valhalla:latest is a BARE image: Entrypoint [], Cmd
# [/bin/bash], no /valhalla directory, no convenience scripts, no tile_urls/
# custom_files env-var handling. Those belong to a different project
# (gis-ops/docker-valhalla) and this image reads none of them — confirmed by
# running `find / -iname '*entrypoint*'` and `ls /valhalla` inside the image
# (docs/map-matching/valhalla-probe-findings.md). Every step below therefore
# calls the real binaries in /usr/local/bin by hand.
#
# 재빌드가 이 컨테이너 안에서 일어나는 것이 핵심이다. 앱의 cron 컨테이너에서
# 돌리면 안 된다 — 수백MB PBF를 받아 타일을 굽는 건 수십 분 CPU 작업이고,
# 이 저장소가 cron을 별도 컨테이너로 분리한 이유가 정확히 그런 작업이 웹
# 이벤트 루프를 막았기 때문이다. 같은 실수를 다른 자리에서 반복하지 않는다.
set -euo pipefail

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

needs_build() {
  [ ! -f "$STAMP" ] && return 0
  [ ! -f "$TILE_ARTIFACT" ] && return 0
  local built_fp
  built_fp=$(grep '^fingerprint=' "$STAMP" | cut -d= -f2 || echo "")
  # 추출본 목록이 바뀌면 fingerprint가 바뀐다 — 새 도시를 추가했다는 뜻이므로
  # 다음 기동에 다시 굽는다.
  [ "$built_fp" != "${EXTRACTS_FINGERPRINT:-}" ] && return 0
  local age_days
  age_days=$(( ( $(date +%s) - $(stat -c %Y "$STAMP") ) / 86400 ))
  [ "$age_days" -ge "$MAX_AGE_DAYS" ] && return 0
  return 1
}

if needs_build; then
  echo "[valhalla] building tiles (fingerprint=${EXTRACTS_FINGERPRINT:-unset})"
  mkdir -p "$TILE_DIR" "$TILE_WORK_DIR" "$PBF_DIR"

  # valhalla_build_config has no persistent state of its own — regenerating it
  # on every build is cheap (<1s) and keeps it in sync with this script's paths
  # rather than depending on a config file baked earlier by hand.
  valhalla_build_config \
    --mjolnir-tile-dir "$TILE_WORK_DIR" \
    --mjolnir-tile-extract "$TILE_ARTIFACT" \
    -o "$CONFIG"

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
    exit 1
  fi

  # valhalla_build_tiles accepts multiple OSM PBF files in one invocation and
  # merges them into a single unified tile set — confirmed against the
  # Korea-only extract (48s, 595 tiles, 658MB) in the probe.
  rm -rf "${TILE_WORK_DIR:?}"/*
  valhalla_build_tiles -c "$CONFIG" "${pbf_files[@]}"

  # Bundles TILE_WORK_DIR into TILE_ARTIFACT (the -O flag overwrites a stale
  # tar from a previous build). Optional for correctness — valhalla_service
  # falls back to reading the directory tile-by-tile if the tar is missing —
  # but it's what this script uses as its single-file "build done" marker,
  # and it also means the eventual service reads one file instead of hundreds.
  valhalla_build_extract -c "$CONFIG" -O

  rm -rf "$PBF_DIR"

  {
    echo "built_at=$(date -u +%Y-%m-%d)"
    echo "fingerprint=${EXTRACTS_FINGERPRINT:-unset}"
  } > "$STAMP"
  echo "[valhalla] tile build finished"
else
  echo "[valhalla] tiles are current, skipping build"
fi

exec valhalla_service "$CONFIG" "${VALHALLA_CONCURRENCY:-2}"
