import { PgDialect } from "drizzle-orm/pg-core";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  rows: [] as Array<{ bytes: Buffer }>,
  where: vi.fn(),
  select: vi.fn(),
}));
vi.mock("@/lib/auth-helpers", () => ({ getAuthenticatedUser: mocks.auth }));
vi.mock("@/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/db")>()),
  getDb: () => ({ select: mocks.select }),
}));
// Fails loudly if the route's module graph ever reaches the Proton adapter.
vi.mock("@/lib/adapters/proton/client", () => {
  throw new Error("thumbnail route must not import the Proton adapter");
});

import { GET } from "./route";

const PHOTO_ID = "6f1c2a3e-8d4b-4c5a-9e7f-0a1b2c3d4e5f";
const call = (photoId: string) =>
  GET(new NextRequest(`https://cistory.test/api/photos/${photoId}/thumbnail`), {
    params: Promise.resolve({ photoId }),
  });

beforeEach(() => {
  mocks.rows = [];
  mocks.auth.mockResolvedValue({ user: { id: "owner", email: null }, error: null });
  const chain = {
    from: () => chain,
    innerJoin: () => chain,
    where: (cond: unknown) => {
      mocks.where(cond);
      return chain;
    },
    limit: async () => mocks.rows,
  };
  mocks.select.mockReturnValue(chain);
});

describe("GET /api/photos/[photoId]/thumbnail", () => {
  it("serves the owner's JPEG thumbnail with private cache, image/jpeg and nosniff headers", async () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x01, 0x02]);
    mocks.rows = [{ bytes: jpeg }];

    const response = await call(PHOTO_ID);

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, max-age=86400");
    expect(response.headers.get("Content-Type")).toBe("image/jpeg");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(Buffer.from(await response.arrayBuffer())).toEqual(jpeg);
  });

  it.each([
    ["extended WebP", "image/webp", Buffer.from("RIFF\x10\0\0\0WEBPVP8X\x0a\0\0\0", "latin1")],
    ["simple WebP", "image/webp", Buffer.from("RIFF\x10\0\0\0WEBPVP8 \0\0\0\0", "latin1")],
    ["PNG", "image/png", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0])],
    ["AVIF", "image/avif", Buffer.from("\0\0\0\x1cftypavif\0\0\0\0mif1avifmiaf", "latin1")],
    ["unknown bytes", "application/octet-stream", Buffer.from("GIF89a\0\0", "latin1")],
    ["a RIFF that is not WebP", "application/octet-stream", Buffer.from("RIFF\0\0\0\0WAVEfmt ")],
  ])("serves %s as %s, bytes unchanged", async (_name, contentType, bytes) => {
    mocks.rows = [{ bytes }];

    const response = await call(PHOTO_ID);

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe(contentType);
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes);
  });

  it("scopes the lookup to the caller and to exposed rows, and 404s when nothing matches", async () => {
    // A foreign, details-pending, soft-deleted or thumbnail-less row all come
    // back as "no row" from this predicate.
    const response = await call(PHOTO_ID);

    expect(response.status).toBe(404);
    const { sql, params } = new PgDialect().sqlToQuery(mocks.where.mock.calls[0][0]);
    expect(sql).toContain('"photos"."id" = $1');
    expect(sql).toContain('"photos"."user_id" = $2');
    expect(sql).toContain('"photos"."details_synced_at" is not null');
    expect(sql).toContain('"photos"."deleted_at" is null');
    expect(params).toEqual([PHOTO_ID, "owner"]);
  });

  it("404s a malformed photoId without querying", async () => {
    const response = await call("not-a-uuid");

    expect(response.status).toBe(404);
    expect(mocks.select).not.toHaveBeenCalled();
  });

  it("rejects anonymous requests without querying", async () => {
    mocks.auth.mockResolvedValue({
      user: null,
      error: new Response(null, { status: 401 }),
    });

    expect((await call(PHOTO_ID)).status).toBe(401);
    expect(mocks.select).not.toHaveBeenCalled();
  });
});
