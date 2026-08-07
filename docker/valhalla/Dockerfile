# ghcr.io/valhalla/valhalla:latest builds tiles fine from any *one* PBF, but
# valhalla_build_tiles aborts (std::exception, vector::_M_range_check) the
# moment it's given three or more input files — confirmed by bisection, see
# the comment above the merge step in entrypoint.sh for the full story. The
# fix is to hand it a single merged PBF instead, and osmium-tool is what does
# that merge. It isn't in the base image; Ubuntu 24.04 (the base image's own
# OS — see docs/map-matching/valhalla-probe-findings.md) ships it directly,
# so no third-party repo is needed. Nothing else about the base image changes.
FROM ghcr.io/valhalla/valhalla:latest

RUN apt-get update \
    && apt-get install -y --no-install-recommends osmium-tool \
    && rm -rf /var/lib/apt/lists/*
