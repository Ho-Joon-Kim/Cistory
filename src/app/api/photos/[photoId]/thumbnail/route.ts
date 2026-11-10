import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb, photos, photoThumbnails } from "@/db";
import { ApiError, withAuth } from "@/lib/api-handler";
import { photoIsExposed } from "@/modules/proton/repository";

interface RouteParams {
  params: Promise<{ photoId: string }>;
}

const PhotoId = z.string().uuid();

const NOT_FOUND = "사진을 찾을 수 없습니다";

/**
 * Serves the stored thumbnail of one of the caller's exposed photos. The web
 * container never talks to Proton: a missing row is simply a 404.
 */
export const GET = withAuth<RouteParams>(async ({ user }, { params }) => {
  const parsed = PhotoId.safeParse((await params).photoId);
  if (!parsed.success) throw new ApiError(404, NOT_FOUND, "NOT_FOUND");

  const rows = await getDb()
    .select({ bytes: photoThumbnails.bytes })
    .from(photoThumbnails)
    .innerJoin(photos, eq(photos.id, photoThumbnails.photoId))
    .where(and(eq(photos.id, parsed.data), eq(photos.userId, user.id), photoIsExposed()))
    .limit(1);
  if (rows.length === 0) throw new ApiError(404, NOT_FOUND, "NOT_FOUND");

  return new NextResponse(new Uint8Array(rows[0].bytes), {
    headers: {
      "Cache-Control": "private, max-age=86400",
      "Content-Type": "image/jpeg",
      "X-Content-Type-Options": "nosniff",
    },
  });
});
