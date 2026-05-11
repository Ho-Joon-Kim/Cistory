/**
 * Location Data Import API (HTTPS polling)
 *
 * POST /api/timeline/locations/import
 *   Accepts multipart/form-data with a file (GPX, GeoJSON, Google Takeout JSON,
 *   optionally gzipped). Spools the upload to a temp file, returns
 *   `{ jobId }` immediately, then continues parsing/inserting in the background.
 *
 * GET  /api/timeline/locations/import?jobId=...
 *   Returns the current `ImportProgress` for the given job (must belong to the
 *   authenticated user).
 *
 * SSE was replaced with polling because Cloudflare cuts long-lived responses
 * once data stops flowing — a 17MB Phone Takeout import spends ~2 min in
 * batched INSERTs with little visible byte output, which Cloudflare treats as
 * idle. Polling keeps every HTTP exchange short.
 */

import { createReadStream, createWriteStream } from "node:fs";
import { unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { createGunzip } from "node:zlib";
import Busboy from "busboy";
import { type NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth-helpers";
import { detectFormat } from "@/modules/location/services/import/format-detector";
import { parseGeoJson } from "@/modules/location/services/import/geojson-parser";
import {
  parseGoogleTakeout,
  streamGoogleTakeout,
} from "@/modules/location/services/import/google-takeout-parser";
import { parseGpx } from "@/modules/location/services/import/gpx-parser";
import { type ImportProgress, importPoints } from "@/modules/location/services/import/importer";
import { createJob, getJob, updateJob } from "@/modules/location/services/import/job-store";
import type { ParsedPoint } from "@/modules/location/services/import/types";

// Hard cap as defense-in-depth. Bounds disk usage of the spooled temp file
// and the bandwidth a single client can push.
const MAX_FILE_SIZE_MB = Number(process.env.IMPORT_MAX_FILE_SIZE_MB ?? "500");
const MAX_FILE_SIZE = MAX_FILE_SIZE_MB * 1024 * 1024;

// Bytes sniffed from the file head for format auto-detection.
const SNIFF_BYTES = 4096;

export async function POST(request: NextRequest) {
  const reqId = Math.random().toString(36).slice(2, 8);
  console.log(`[import:${reqId}] POST received`, {
    contentType: request.headers.get("content-type"),
    contentLength: request.headers.get("content-length"),
    hasBody: !!request.body,
  });

  const { user, error: authError } = await getAuthenticatedUser(request);
  if (authError) {
    console.log(`[import:${reqId}] auth failed`);
    return authError;
  }

  const contentLength = Number.parseInt(request.headers.get("content-length") ?? "", 10);
  if (Number.isFinite(contentLength) && contentLength > MAX_FILE_SIZE + 1024 * 1024) {
    console.log(`[import:${reqId}] reject 413 (content-length=${contentLength})`);
    return NextResponse.json(
      { error: `파일 크기는 ${MAX_FILE_SIZE_MB}MB 이하여야 합니다` },
      { status: 413 }
    );
  }

  const contentType = request.headers.get("content-type");
  if (!contentType?.startsWith("multipart/form-data")) {
    console.log(`[import:${reqId}] reject 400 (bad content-type)`);
    return NextResponse.json({ error: "multipart/form-data 요청이 필요합니다" }, { status: 400 });
  }

  if (!request.body) {
    console.log(`[import:${reqId}] reject 400 (no body)`);
    return NextResponse.json({ error: "요청 본문이 없습니다" }, { status: 400 });
  }

  let upload: SpooledUpload;
  try {
    upload = await spoolUpload({
      reqId,
      contentType,
      body: request.body as ReadableStream<Uint8Array>,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.log(`[import:${reqId}] spool failed: ${msg}`);
    if (msg.includes("파일 크기")) {
      return NextResponse.json({ error: msg }, { status: 413 });
    }
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  const jobId = createJob(user.id);
  console.log(`[import:${reqId}] spooled ${upload.bytes}B → ${upload.tmpPath}, jobId=${jobId}`);

  // Fire and forget. processImport handles its own errors by updating the job
  // store; we never want to leave a jobId without a terminal state.
  void processImport({ reqId, jobId, userId: user.id, upload });

  return NextResponse.json({ jobId });
}

export async function GET(request: NextRequest) {
  const { user, error: authError } = await getAuthenticatedUser(request);
  if (authError) return authError;

  const jobId = new URL(request.url).searchParams.get("jobId");
  if (!jobId) {
    return NextResponse.json({ error: "jobId가 필요합니다" }, { status: 400 });
  }

  const job = getJob(jobId, user.id);
  if (!job) {
    return NextResponse.json({ error: "작업을 찾을 수 없습니다" }, { status: 404 });
  }

  return NextResponse.json(job.progress);
}

interface SpoolArgs {
  reqId: string;
  contentType: string;
  body: ReadableStream<Uint8Array>;
}

interface SpooledUpload {
  tmpPath: string;
  fileName: string;
  bytes: number;
}

/**
 * Receive the multipart body, find the `file` field, and stream it to a temp
 * file. Resolves once the upload is fully on disk so the response can return
 * synchronously. Memory peak is bounded by busboy's internal buffering plus
 * the OS write buffer — no full materialization of the file in JS memory.
 */
function spoolUpload({ reqId, contentType, body }: SpoolArgs): Promise<SpooledUpload> {
  return new Promise((resolve, reject) => {
    const bb = Busboy({
      headers: { "content-type": contentType },
      limits: { fileSize: MAX_FILE_SIZE, files: 1 },
    });

    let settled = false;
    let handled = false;
    let tmpPath: string | null = null;
    let writeStream: ReturnType<typeof createWriteStream> | null = null;
    let bytes = 0;
    let fileName = "upload";

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      fn();
    };

    const cleanupOnFail = async () => {
      if (writeStream && !writeStream.closed) writeStream.destroy();
      if (tmpPath) {
        try {
          await unlink(tmpPath);
        } catch {
          // best effort
        }
      }
    };

    bb.on("file", (_field, fileStream, info) => {
      handled = true;
      fileName = info.filename ?? "upload";
      const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
      tmpPath = join(tmpdir(), `cistory-import-${reqId}-${Date.now()}-${safeName}`);
      writeStream = createWriteStream(tmpPath);

      fileStream.on("limit", () => {
        finish(() => {
          void cleanupOnFail().then(() =>
            reject(new Error(`파일 크기는 ${MAX_FILE_SIZE_MB}MB 이하여야 합니다`))
          );
        });
      });

      fileStream.on("data", (chunk: Buffer) => {
        bytes += chunk.length;
      });

      fileStream.on("error", (e) => {
        finish(() => {
          void cleanupOnFail().then(() => reject(e));
        });
      });

      writeStream.on("error", (e) => {
        finish(() => {
          void cleanupOnFail().then(() => reject(e));
        });
      });

      writeStream.on("finish", () => {
        finish(() => {
          if (!tmpPath) {
            reject(new Error("temp 파일 생성 실패"));
            return;
          }
          resolve({ tmpPath, fileName, bytes });
        });
      });

      fileStream.pipe(writeStream);
    });

    bb.on("close", () => {
      if (handled) return;
      finish(() => reject(new Error("file 필드가 필요합니다")));
    });

    bb.on("error", (e) => {
      finish(() => {
        void cleanupOnFail().then(() => reject(e));
      });
    });

    const nodeBody = Readable.fromWeb(body as unknown as import("node:stream/web").ReadableStream);
    nodeBody.on("error", (e) => {
      finish(() => {
        void cleanupOnFail().then(() => reject(e));
      });
    });
    nodeBody.pipe(bb);
  });
}

interface ProcessArgs {
  reqId: string;
  jobId: string;
  userId: string;
  upload: SpooledUpload;
}

/**
 * Background processor. Reads the spooled file, gunzips if needed, detects
 * format, parses, and feeds points into `importPoints`. Progress updates are
 * written to the in-memory job store for the GET endpoint to surface.
 *
 * Errors are caught and surfaced as `phase: "error"` so the client always
 * sees a terminal state; throwing would orphan the jobId.
 */
async function processImport({ reqId, jobId, userId, upload }: ProcessArgs): Promise<void> {
  const trace = (msg: string, extra?: unknown) => {
    console.log(`[import:${reqId}:${jobId.slice(0, 8)}] ${msg}`, extra ?? "");
  };

  try {
    trace("processing start", { fileName: upload.fileName, bytes: upload.bytes });

    const isGzipped = upload.fileName.toLowerCase().endsWith(".gz");
    const sniffName = upload.fileName.replace(/\.gz$/i, "");

    // Two reads: one for the sniff (small, gunzipped if needed), one for the
    // full parse. Reading from a local temp file twice is cheap; piping
    // through gunzip a second time is also cheap, and avoids the contortions
    // the previous SSE flow needed to "peek then rewind" a single stream.
    const prefixBuf = await readSniffPrefix(upload.tmpPath, isGzipped);
    const detected = detectFormat(sniffName, prefixBuf.toString("utf-8"));
    trace("format detected", { sniffName, detected });

    if (detected === "unknown") {
      updateJob(jobId, {
        phase: "error",
        error: "지원하지 않는 파일 형식입니다. GPX, GeoJSON, Google Takeout JSON을 사용하세요.",
      });
      return;
    }

    updateJob(jobId, { phase: "parsing", progress: 0, totalParsed: 0, format: detected });

    const fullStream = openDecoded(upload.tmpPath, isGzipped);

    let pointSource: ParsedPoint[] | AsyncIterable<ParsedPoint>;
    if (detected === "google-records" || detected === "google-phone-takeout") {
      pointSource = streamGoogleTakeout(fullStream);
    } else {
      const text = await readAllToString(fullStream);
      if (detected === "gpx") {
        pointSource = parseGpx(text);
      } else if (detected === "geojson") {
        pointSource = parseGeoJson(JSON.parse(text));
      } else {
        pointSource = parseGoogleTakeout(JSON.parse(text));
      }
    }

    trace("calling importPoints");
    const result = await importPoints(userId, pointSource, (progress) => {
      updateJob(jobId, { ...progress, format: detected });
    });
    trace("importPoints returned", result);

    if (result.totalParsed === 0) {
      updateJob(jobId, { phase: "error", error: "파일에서 위치 데이터를 찾을 수 없습니다" });
      return;
    }

    updateJob(jobId, {
      phase: "done",
      totalParsed: result.totalParsed,
      inserted: result.imported,
      duplicates: result.duplicates,
      dateRange: result.dateRange,
      format: detected,
      progress: 100,
    });
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error(`[import:${reqId}:${jobId.slice(0, 8)}] processing threw:`, error);
    updateJob(jobId, { phase: "error", error: `임포트 실패: ${errMsg}` } satisfies ImportProgress);
  } finally {
    try {
      await unlink(upload.tmpPath);
    } catch (e) {
      console.warn(`[import:${reqId}:${jobId.slice(0, 8)}] temp cleanup failed`, e);
    }
  }
}

function openDecoded(tmpPath: string, isGzipped: boolean): Readable {
  const raw = createReadStream(tmpPath);
  if (!isGzipped) return raw;
  const gunzip = createGunzip();
  // Suppress the benign ABORT_ERR / ERR_STREAM_PREMATURE_CLOSE that
  // stream-json's destroy() can propagate upstream after it has yielded its
  // last element. The actual import is already complete at that point.
  const benign = (e: NodeJS.ErrnoException) =>
    e.code === "ABORT_ERR" || e.code === "ERR_STREAM_PREMATURE_CLOSE";
  raw.on("error", (e: NodeJS.ErrnoException) => {
    if (!benign(e)) console.error("[import] read stream error:", e);
  });
  gunzip.on("error", (e: NodeJS.ErrnoException) => {
    if (!benign(e)) console.error("[import] gunzip error:", e);
  });
  return raw.pipe(gunzip);
}

async function readSniffPrefix(tmpPath: string, isGzipped: boolean): Promise<Buffer> {
  const src = openDecoded(tmpPath, isGzipped);
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    for await (const chunk of src) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      chunks.push(buf);
      total += buf.length;
      if (total >= SNIFF_BYTES) break;
    }
  } finally {
    src.destroy();
  }
  return Buffer.concat(chunks).subarray(0, SNIFF_BYTES);
}

async function readAllToString(src: Readable): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of src) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf-8");
}
