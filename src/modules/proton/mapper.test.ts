import { NodeType, type PhotoNode } from "@protontech/drive-sdk";
import { describe, expect, it } from "vitest";
import { isValidCoordinate, mapPhotoNode } from "./mapper";

function photoNode(overrides: Record<string, unknown> = {}, metadata?: object): PhotoNode {
  return {
    uid: "vol~node1",
    type: NodeType.Photo,
    mediaType: "image/jpeg",
    treeEventScopeId: "scope",
    photo: {
      captureTime: new Date("2026-03-04T15:30:00.000Z"),
      relatedPhotoNodeUids: [],
      albums: [],
      tags: [],
    },
    activeRevision: { claimedAdditionalMetadata: metadata },
    ...overrides,
  } as unknown as PhotoNode;
}

function mapped(node: PhotoNode) {
  const result = mapPhotoNode(node);
  if (!result.ok) throw new Error(`expected ok, got ${result.reason}`);
  return result.photo;
}

describe("mapPhotoNode", () => {
  it("takes capturedAt from photo.captureTime as-is (true UTC, no shift)", () => {
    const photo = mapped(photoNode());
    expect(photo.capturedAt.getTime()).toBe(Date.parse("2026-03-04T15:30:00.000Z"));
    expect(photo.nodeUid).toBe("vol~node1");
    expect(photo.mediaType).toBe("image/jpeg");
  });

  it("keeps exif lat/lon from claimedAdditionalMetadata.Location", () => {
    const photo = mapped(photoNode({}, { Location: { Latitude: 37.5665, Longitude: 126.978 } }));
    expect(photo.lat).toBe(37.5665);
    expect(photo.lon).toBe(126.978);
    expect(photo.claimedMetadata?.Location).toEqual({ Latitude: 37.5665, Longitude: 126.978 });
  });

  it("reports null lat/lon explicitly when the node has no GPS", () => {
    const photo = mapped(photoNode({}, { Camera: { Device: "Pixel" } }));
    expect(photo.lat).toBeNull();
    expect(photo.lon).toBeNull();
    const bare = mapped(photoNode({ activeRevision: undefined }));
    expect(bare.lat).toBeNull();
    expect(bare.lon).toBeNull();
    expect(bare.claimedMetadata).toBeNull();
  });

  it("nulls lat/lon for exact 0,0 but keeps the raw Location in claimedMetadata", () => {
    const photo = mapped(photoNode({}, { Location: { Latitude: 0, Longitude: 0 } }));
    expect(photo.lat).toBeNull();
    expect(photo.lon).toBeNull();
    expect(photo.claimedMetadata?.Location).toEqual({ Latitude: 0, Longitude: 0 });
  });

  it("drops out-of-range, NaN and non-numeric Location through the SDK parser", () => {
    for (const Location of [
      { Latitude: 91, Longitude: 10 },
      { Latitude: 10, Longitude: 181 },
      { Latitude: Number.NaN, Longitude: 10 },
      { Latitude: "37.5", Longitude: "127" },
    ]) {
      const photo = mapped(photoNode({}, { Location }));
      expect(photo.lat).toBeNull();
      expect(photo.lon).toBeNull();
    }
  });

  it("preserves raw tag integers (e.g. 8) without interpreting", () => {
    const node = photoNode();
    (node.photo as { tags: number[] }).tags = [8, 0, 3];
    expect(mapped(node).tags).toEqual([8, 0, 3]);
  });

  it("reads contentHash defensively and mainPhotoNodeUid/relatedPhotoNodeUids", () => {
    expect(mapped(photoNode()).contentHash).toBeNull();
    const node = photoNode();
    Object.assign(node.photo as object, {
      contentHash: "abc123",
      mainPhotoNodeUid: "vol~main",
      relatedPhotoNodeUids: ["vol~r1", "vol~r2"],
    });
    const photo = mapped(node);
    expect(photo.contentHash).toBe("abc123");
    expect(photo.mainPhotoNodeUid).toBe("vol~main");
    expect(photo.relatedPhotoNodeUids).toEqual(["vol~r1", "vol~r2"]);

    const weird = photoNode();
    Object.assign(weird.photo as object, { contentHash: 42 });
    expect(mapped(weird).contentHash).toBeNull();
    expect(mapped(photoNode()).mainPhotoNodeUid).toBeNull();
  });

  it("maps trashTime to trashedAt, Media.Width/Height/Duration and Camera.Device", () => {
    const trashTime = new Date("2026-04-01T00:00:00.000Z");
    const photo = mapped(
      photoNode(
        { trashTime },
        {
          Media: { Width: 4032, Height: 3024, Duration: 12.5 },
          Camera: { Device: "iPhone 15", CaptureTime: "2026:03:04 15:30:00" },
        }
      )
    );
    expect(photo.trashedAt).toEqual(trashTime);
    expect(photo.width).toBe(4032);
    expect(photo.height).toBe(3024);
    expect(photo.durationSec).toBe(12.5);
    expect(photo.device).toBe("iPhone 15");
    expect(mapped(photoNode()).trashedAt).toBeNull();
  });

  it("returns not_photo for Folder/Album and degraded when node.errors is non-empty", () => {
    expect(mapPhotoNode(photoNode({ type: NodeType.Folder }))).toEqual({
      ok: false,
      reason: "not_photo",
    });
    expect(mapPhotoNode(photoNode({ type: NodeType.Album }))).toEqual({
      ok: false,
      reason: "not_photo",
    });
    expect(mapPhotoNode(photoNode({ errors: [new Error("decrypt")] }))).toEqual({
      ok: false,
      reason: "degraded",
    });
  });

  it("returns invalid when the photo attributes or capture time are unusable", () => {
    expect(mapPhotoNode(photoNode({ photo: undefined }))).toEqual({ ok: false, reason: "invalid" });
    const node = photoNode();
    (node.photo as { captureTime: Date }).captureTime = new Date("nope");
    expect(mapPhotoNode(node)).toEqual({ ok: false, reason: "invalid" });
  });
});

describe("isValidCoordinate", () => {
  it("accepts real coordinates and rejects everything else", () => {
    expect(isValidCoordinate(37.5, 127)).toBe(true);
    expect(isValidCoordinate(-90, 180)).toBe(true);
    expect(isValidCoordinate(0, 0)).toBe(false);
    expect(isValidCoordinate(90.1, 0)).toBe(false);
    expect(isValidCoordinate(0, -180.1)).toBe(false);
    expect(isValidCoordinate(Number.NaN, 1)).toBe(false);
    expect(isValidCoordinate(Number.POSITIVE_INFINITY, 1)).toBe(false);
    expect(isValidCoordinate("37", 127)).toBe(false);
    expect(isValidCoordinate(null, undefined)).toBe(false);
  });
});
