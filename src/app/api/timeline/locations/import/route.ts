/**
 * Location Data Import API (SSE Streaming)
 *
 * POST /api/timeline/locations/import
 * Accepts multipart/form-data with a file (GPX, GeoJSON, Google Takeout JSON).
 * Returns SSE stream with parsing and insertion progress.
 *
 * Inspired by Dawarich's broadcast pattern (5s / 100 points throttle).
 * Supports files up to 500MB (Google Takeout).
 */

import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth-helpers";
import {
  parseFile,
  importPoints,
  type ImportProgress,
} from "@/modules/location/services/import/importer";
import type { ImportFormat } from "@/modules/location/services/import/types";

const MAX_FILE_SIZE = 500 * 1024 * 1024; // 500MB

export async function POST(request: NextRequest) {
  const { user, error: authError } = await getAuthenticatedUser(request);
  if (authError) return authError;

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json(
      { error: "요청을 파싱할 수 없습니다" },
      { status: 400 },
    );
  }

  const file = formData.get("file");

  if (!file || !(file instanceof File)) {
    return NextResponse.json(
      { error: "file 필드가 필요합니다" },
      { status: 400 },
    );
  }

  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json(
      { error: "파일 크기는 500MB 이하여야 합니다" },
      { status: 400 },
    );
  }

  const formatParam = formData.get("format") as string | null;
  const format = (formatParam ?? "auto") as ImportFormat | "auto";
  const fileName = file.name;
  const fileSize = file.size;

  // SSE stream for progress
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      function send(data: ImportProgress) {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(data)}\n\n`),
        );
      }

      try {
        // Phase 1: Read file content
        send({
          phase: "parsing",
          progress: 0,
          totalParsed: 0,
        });

        const content = await file.text();

        // Phase 2: Parse
        send({
          phase: "parsing",
          progress: 10,
          totalParsed: 0,
        });

        const { points, detectedFormat } = parseFile(content, fileName, format);

        if (detectedFormat === "unknown") {
          send({
            phase: "error",
            error:
              "지원하지 않는 파일 형식입니다. GPX, GeoJSON, Google Takeout JSON을 사용하세요.",
          });
          controller.close();
          return;
        }

        if (points.length === 0) {
          send({
            phase: "error",
            error: "파일에서 위치 데이터를 찾을 수 없습니다",
          });
          controller.close();
          return;
        }

        send({
          phase: "parsing",
          progress: 15,
          totalParsed: points.length,
          format: detectedFormat,
        });

        // Phase 3: Import with progress callbacks
        const result = await importPoints(user.id, points, (progress) => {
          // Scale progress: 15-95 range for insertion phase
          const scaledProgress = 15 + Math.round((progress.progress ?? 0) * 0.8);
          send({
            ...progress,
            progress: scaledProgress,
            format: detectedFormat,
          });
        });

        // Phase 4: Done
        send({
          phase: "done",
          totalParsed: result.totalParsed,
          inserted: result.imported,
          duplicates: result.duplicates,
          dateRange: result.dateRange,
          format: detectedFormat,
          progress: 100,
        });
      } catch (error) {
        const errMsg =
          error instanceof Error ? error.message : String(error);
        console.error("Import error:", error);
        send({ phase: "error", error: `임포트 실패: ${errMsg}` });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
