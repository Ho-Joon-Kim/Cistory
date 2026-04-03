/**
 * Location Data Import API
 *
 * POST /api/timeline/locations/import
 * Accepts multipart/form-data with a file (GPX, GeoJSON, Google Takeout JSON).
 * Format auto-detection or explicit via "format" field.
 */

import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth-helpers";
import {
  parseFile,
  importPoints,
} from "@/modules/location/services/import/importer";
import type { ImportFormat } from "@/modules/location/services/import/types";

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

export async function POST(request: NextRequest) {
  try {
    const { user, error: authError } = await getAuthenticatedUser(request);
    if (authError) return authError;

    const formData = await request.formData();
    const file = formData.get("file");

    if (!file || !(file instanceof File)) {
      return NextResponse.json(
        { error: "file 필드가 필요합니다" },
        { status: 400 },
      );
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: "파일 크기는 50MB 이하여야 합니다" },
        { status: 400 },
      );
    }

    const content = await file.text();
    const formatParam = formData.get("format") as string | null;
    const format = (formatParam ?? "auto") as ImportFormat | "auto";

    // Parse the file
    const { points, detectedFormat } = parseFile(content, file.name, format);

    if (detectedFormat === "unknown") {
      return NextResponse.json(
        {
          error:
            "지원하지 않는 파일 형식입니다. GPX, GeoJSON, Google Takeout JSON을 사용하세요.",
        },
        { status: 400 },
      );
    }

    if (points.length === 0) {
      return NextResponse.json(
        { error: "파일에서 위치 데이터를 찾을 수 없습니다" },
        { status: 400 },
      );
    }

    // Import into database
    const result = await importPoints(user.id, points);

    return NextResponse.json({
      format: detectedFormat,
      ...result,
    });
  } catch (error) {
    console.error("Import error:", error);
    return NextResponse.json(
      { error: "위치 데이터 임포트에 실패했습니다" },
      { status: 500 },
    );
  }
}
