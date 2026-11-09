# The Valhalla base image builds tiles fine from any *one* PBF, but
# valhalla_build_tiles aborts (std::exception, vector::_M_range_check) the
# moment it's given three or more input files — confirmed by bisection, see
# the comment above the merge step in entrypoint.sh for the full story. The
# fix is to hand it a single merged PBF instead, and osmium-tool is what does
# that merge. It isn't in the base image; Ubuntu 24.04 (the base image's own
# OS — see docs/map-matching/valhalla-probe-findings.md) ships it directly,
# so no third-party repo is needed. Nothing else about the base image changes.
#
# 베이스 이미지는 정확한 릴리스로 고정한다 — `:latest`를 쓰지 않는다.
# Valhalla 3.8.0 changed the on-disk tile format (GraphTileHeader lost
# `date_created_` and `checksum_` was redefined), so tiles are only safe to
# serve with the same Valhalla version that built them. With `:latest`, any
# rebuild of this image (`docker compose build`, a fresh host, a pruned
# cache) could silently swap the binary underneath tiles already sitting on
# the `cistory_valhalla_tiles` volume. Pinning makes the version change only
# when someone edits this line on purpose; entrypoint.sh additionally records
# `valhalla_build_tiles --version` in its stamp file and rebuilds tiles when
# it no longer matches, so even a deliberate bump can't load stale tiles.
#
# Pinned by multi-arch index digest (linux/amd64 + linux/arm64), with the tag
# kept alongside for readability — Docker resolves the digest and ignores the
# tag, so a re-pushed `3.9.1` tag can't change what gets built. To bump:
#   docker buildx imagetools inspect ghcr.io/valhalla/valhalla:<new-tag>
# and copy the top-level "Digest:" line (the index, not a per-platform one).
FROM ghcr.io/valhalla/valhalla:3.9.1@sha256:4fd114eb1d26b8fc2f43bcb3df234c1b63a0bf13c277405e5943d5361dc575de

RUN apt-get update \
    && apt-get install -y --no-install-recommends osmium-tool \
    && rm -rf /var/lib/apt/lists/*
