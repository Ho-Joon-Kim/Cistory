/**
 * Photo read tools: `photos` (metadata only) and `photo_thumbnails` (stored
 * thumbnails as MCP image content, at most 3 per call).
 *
 * Both follow the Proton exposure rule (`photoIsExposed`: details screened by
 * the NSFW pre-block, not deleted upstream) and additionally skip trashed
 * photos. An unscreened row has no path out of either tool. Original files are
 * never fetched (the web container never talks to Proton).
 */

import type { ContentBlock } from "@modelcontextprotocol/server";
import { z } from "zod";
import { distanceM } from "@/lib/geo";
import { sniffThumbnailFormat, THUMBNAIL_CONTENT_TYPES } from "@/modules/proton/thumbnail-format";
import { defineTool, type McpTool } from "../server";
import { parseTimeRange } from "../time";
import {
  cursorField,
  decodeCursor,
  encodeCursor,
  kstIso,
  limitField,
  NO_RECORDS,
  PAGE_DEFAULT_LIMIT,
  RANGE_ARG_RULES,
  READ_ANNOTATIONS,
  rangeFields,
  rangeOutput,
} from "./common";
import {
  listExposedPhotos,
  loadExposedThumbnails,
  type PhotoBounds,
  type PhotoCursor,
  type PhotoMetadataRow,
} from "./data";

export const MAX_THUMBNAILS_PER_CALL = 3;
const PHOTOS_MAX_DAYS = 366;
const METERS_PER_DEGREE_LAT = 111_320;

function boundsAround(lat: number, lon: number, radiusM: number): PhotoBounds {
  const dLat = radiusM / METERS_PER_DEGREE_LAT;
  const cos = Math.max(Math.cos((lat * Math.PI) / 180), 0.01);
  const dLon = radiusM / (METERS_PER_DEGREE_LAT * cos);
  return { minLat: lat - dLat, maxLat: lat + dLat, minLon: lon - dLon, maxLon: lon + dLon };
}

function serializePhoto(row: PhotoMetadataRow) {
  return {
    id: row.id,
    capturedAt: kstIso(row.capturedAt),
    mediaType: row.mediaType,
    width: row.width,
    height: row.height,
    durationSec: row.durationSec,
    lat: row.lat,
    lon: row.lon,
    // `owntracks` is an estimate from the location log, never the camera's GPS.
    locationSource: row.locationSource,
    locationIsEstimate: row.locationSource === "owntracks",
    locationGapSec: row.locationGapSec,
    device: row.device,
    isLivePhotoPart: row.mainPhotoNodeUid !== null,
    hasThumbnail: Boolean(row.hasThumbnail),
  };
}

export const photosTool = defineTool({
  name: "photos",
  kind: "read",
  scope: "read",
  title: "사진 메타데이터",
  description:
    "기간(기본 최근 7일, 최대 366일) 안에 찍은 사진의 메타데이터(촬영 시각·위치·크기·기기)를 오래된 순으로 " +
    "돌려줍니다. near로 위치 반경 안의 사진만 고를 수 있습니다. 커서 페이지(기본 100건, 최대 500건). " +
    "이미지는 photo_thumbnails로 받으세요. 검사를 통과한 사진만 나옵니다.",
  annotations: READ_ANNOTATIONS,
  inputSchema: z.object({
    ...rangeFields,
    near: z
      .object({
        lat: z.number().min(-90).max(90),
        lon: z.number().min(-180).max(180),
        radiusM: z.number().positive().max(50_000).describe("반경(미터, 최대 50km)."),
      })
      .optional()
      .describe("이 지점 반경 안에서 찍은 사진만."),
    limit: limitField(),
    cursor: cursorField,
  }),
  argRules: { ...RANGE_ARG_RULES, near: "drop" },
  run: async (ctx, input) => {
    const range = parseTimeRange(input, { now: ctx.now, maxDays: PHOTOS_MAX_DAYS });
    const limit = input.limit ?? PAGE_DEFAULT_LIMIT;
    const cursor = input.cursor
      ? decodeCursor<PhotoCursor>(input.cursor, (raw) => {
          const r = raw as Partial<PhotoCursor>;
          return typeof r?.capturedAt === "string" &&
            Number.isFinite(Date.parse(r.capturedAt)) &&
            typeof r.id === "string"
            ? { capturedAt: r.capturedAt, id: r.id }
            : null;
        })
      : null;
    const near = input.near ?? null;

    const rows = await listExposedPhotos(ctx.db, ctx.userId, {
      range,
      bounds: near ? boundsAround(near.lat, near.lon, near.radiusM) : null,
      cursor,
      limit,
    });
    const hasMore = rows.length > limit;
    const scanned = hasMore ? rows.slice(0, limit) : rows;
    // The box over-selects corners; the exact circle is applied here. The cursor
    // follows the last *scanned* row so a filtered-out row is never revisited.
    const page = near
      ? scanned.filter(
          (r) =>
            r.lat !== null &&
            r.lon !== null &&
            distanceM(near.lat, near.lon, r.lat, r.lon) <= near.radiusM
        )
      : scanned;
    const last = scanned.at(-1);

    return {
      structured: {
        range: rangeOutput(range),
        photos: page.map(serializePhoto),
        message: page.length === 0 && !cursor && !hasMore ? NO_RECORDS : null,
        nextCursor:
          hasMore && last
            ? encodeCursor({ capturedAt: last.capturedAt.toISOString(), id: last.id })
            : null,
      },
      count: page.length,
    };
  },
});

export const photoThumbnailsTool = defineTool({
  name: "photo_thumbnails",
  kind: "read",
  scope: "read",
  title: "사진 썸네일",
  description:
    `photos가 돌려준 사진 id의 썸네일을 이미지로 돌려줍니다. 한 번에 최대 ${MAX_THUMBNAILS_PER_CALL}장이며, ` +
    "그보다 많이 요청하면 앞의 3장만 주고 나머지 id는 deferredPhotoIds로 알려 줍니다(다음 호출로 요청).",
  annotations: READ_ANNOTATIONS,
  inputSchema: z.object({
    photoIds: z.array(z.string().uuid()).min(1).max(50).describe("사진 id 목록."),
  }),
  argRules: { photoIds: "count" },
  run: async (ctx, input) => {
    const unique = [...new Set(input.photoIds)];
    const batch = unique.slice(0, MAX_THUMBNAILS_PER_CALL);
    const deferred = unique.slice(MAX_THUMBNAILS_PER_CALL);
    const thumbnails = await loadExposedThumbnails(ctx.db, ctx.userId, batch);

    const items: Record<string, unknown>[] = [];
    const content: ContentBlock[] = [];
    for (const id of batch) {
      const bytes = thumbnails.get(id);
      const format = bytes ? sniffThumbnailFormat(bytes) : null;
      if (!bytes || !format) {
        items.push({ photoId: id, status: "not_found" });
        continue;
      }
      const mimeType = THUMBNAIL_CONTENT_TYPES[format];
      items.push({ photoId: id, status: "ok", mimeType, imageIndex: content.length });
      content.push({ type: "image", data: Buffer.from(bytes).toString("base64"), mimeType });
    }

    return {
      structured: {
        items,
        deferredPhotoIds: deferred,
        message:
          deferred.length > 0
            ? `한 번에 ${MAX_THUMBNAILS_PER_CALL}장까지만 보냅니다. 나머지 ${deferred.length}장은 deferredPhotoIds로 다시 요청하세요.`
            : null,
      },
      count: content.length,
      content,
    };
  },
});

export const PHOTOS_TOOLS: McpTool[] = [photosTool, photoThumbnailsTool];
