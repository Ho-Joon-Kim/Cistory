import { beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_THUMBNAILS_PER_CALL, photosTool, photoThumbnailsTool } from "./photos";
import { callTool, TEST_USER_ID } from "./test-context";

const mocks = vi.hoisted(() => ({
  listExposedPhotos: vi.fn(),
  loadExposedThumbnails: vi.fn(),
}));
vi.mock("./data", () => ({
  listExposedPhotos: mocks.listExposedPhotos,
  loadExposedThumbnails: mocks.loadExposedThumbnails,
}));

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1]);
const ids = [1, 2, 3, 4].map((i) => `0000000${i}-0000-4000-8000-000000000000`);

beforeEach(() => {
  mocks.loadExposedThumbnails.mockImplementation(
    async (_db: unknown, _userId: string, wanted: string[]) =>
      new Map(wanted.filter((id) => id !== ids[1]).map((id) => [id, JPEG]))
  );
});

describe("photo_thumbnails", () => {
  it("returns at most 3 images and defers the rest to the next call", async () => {
    const out = await callTool(photoThumbnailsTool, { photoIds: ids });
    expect(MAX_THUMBNAILS_PER_CALL).toBe(3);
    // Only the first three are ever loaded.
    expect(mocks.loadExposedThumbnails).toHaveBeenCalledWith(
      expect.anything(),
      TEST_USER_ID,
      ids.slice(0, 3)
    );
    expect(out.structured.deferredPhotoIds).toEqual([ids[3]]);
    expect(out.structured.message).toContain("deferredPhotoIds");
    // ids[1] isn't exposed (no thumbnail returned) → not_found, no image.
    expect(out.structured.items).toEqual([
      { photoId: ids[0], status: "ok", mimeType: "image/jpeg", imageIndex: 0 },
      { photoId: ids[1], status: "not_found" },
      { photoId: ids[2], status: "ok", mimeType: "image/jpeg", imageIndex: 1 },
    ]);
    expect(out.content).toHaveLength(2);
    expect(out.content?.[0]).toEqual({
      type: "image",
      data: Buffer.from(JPEG).toString("base64"),
      mimeType: "image/jpeg",
    });
    expect(out.count).toBe(2);
  });

  it("never sends bytes outside the screened format allowlist", async () => {
    mocks.loadExposedThumbnails.mockResolvedValue(new Map([[ids[0], new Uint8Array([1, 2, 3])]]));
    const out = await callTool(photoThumbnailsTool, { photoIds: [ids[0]] });
    expect(out.content).toEqual([]);
    expect(out.structured.items).toEqual([{ photoId: ids[0], status: "not_found" }]);
  });
});

describe("photos", () => {
  const row = (i: number, lat: number | null) => ({
    id: ids[i],
    capturedAt: new Date(`2026-11-1${i}T00:00:00Z`),
    mediaType: "image/jpeg",
    width: 10,
    height: 10,
    durationSec: null,
    lat,
    lon: lat === null ? null : 127,
    locationSource: "owntracks" as const,
    locationGapSec: 30,
    device: "Galaxy",
    mainPhotoNodeUid: null,
    hasThumbnail: true,
  });

  it("serializes metadata only, labels OwnTracks positions as estimates, and pages", async () => {
    mocks.listExposedPhotos.mockResolvedValue([row(0, 37), row(1, 37), row(2, 37)]);
    const out = await callTool(photosTool, { from: "2026-11-01", limit: 2 });
    const photos = out.structured.photos as Record<string, unknown>[];
    expect(photos).toHaveLength(2);
    expect(photos[0]).toMatchObject({
      capturedAt: "2026-11-10T09:00:00+09:00",
      locationIsEstimate: true,
    });
    expect(Object.keys(photos[0])).not.toEqual(
      expect.arrayContaining(["claimedMetadata", "nodeUid", "bytes"])
    );
    const cursor = JSON.parse(
      Buffer.from(out.structured.nextCursor as string, "base64url").toString()
    );
    expect(cursor).toEqual({ capturedAt: "2026-11-11T00:00:00.000Z", id: ids[1] });
  });

  it("filters by radius but advances the cursor past filtered rows", async () => {
    mocks.listExposedPhotos.mockResolvedValue([row(0, 37.5), row(1, 37.6), row(2, 37.5)]);
    const out = await callTool(photosTool, {
      near: { lat: 37.5, lon: 127, radiusM: 500 },
      limit: 2,
    });
    expect((out.structured.photos as { id: string }[]).map((p) => p.id)).toEqual([ids[0]]);
    const options = mocks.listExposedPhotos.mock.calls[0][2];
    expect(options.bounds.minLat).toBeLessThan(37.5);
    const cursor = JSON.parse(
      Buffer.from(out.structured.nextCursor as string, "base64url").toString()
    );
    expect(cursor.id).toBe(ids[1]);
  });
});
