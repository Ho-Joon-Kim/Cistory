/**
 * Location Data Import API (SSE Streaming)
 *
 * POST /api/timeline/locations/import
 * Accepts multipart/form-data with a file (GPX, GeoJSON, Google Takeout JSON).
 * Returns SSE stream with parsing and insertion progress.
 *
 * Memory peak is bounded by streaming JSON parsing for Google Takeout (the
 * common large case): file bytes flow through busboy → stream-json → batched
 * INSERTs without ever materializing the full document. GPX/GeoJSON files
 * (typically small) are still buffered to a string.
 */

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
import type { ParsedPoint } from "@/modules/location/services/import/types";

// Hard cap as defense-in-depth. With streaming Google Takeout import the
// effective memory peak no longer scales with file size, but we still cap
// the upload to protect bandwidth + disk and to bound buffered GPX/GeoJSON.
const MAX_FILE_SIZE_MB = Number(process.env.IMPORT_MAX_FILE_SIZE_MB ?? "500");
const MAX_FILE_SIZE = MAX_FILE_SIZE_MB * 1024 * 1024;

// Bytes sniffed from the file head for format auto-detection. Enough for the
// JSON envelope (`{"locations":[...]}` etc.) and the GPX `<?xml ...><gpx`.
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

  console.log(`[import:${reqId}] starting SSE stream for user ${user.id}`);

  const encoder = new TextEncoder();
  const sse = new ReadableStream({
    async start(controller) {
      const send = (data: ImportProgress) => {
        // Trace every phase transition to disambiguate "runImport done" —
        // we want to know which SSE event actually fired (parsing, error,
        // done, ...) and with what payload.
        const summary = {
          phase: data.phase,
          format: data.format,
          totalParsed: data.totalParsed,
          inserted: data.inserted,
          duplicates: data.duplicates,
          batchIndex: data.batchIndex,
          error: data.error,
        };
        console.log(`[import:${reqId}] send`, summary);
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      // Flush an initial SSE comment so the client + any intermediate proxy
      // commits to the response immediately. Without this, a 30s+ delay
      // between handler entry and the first real event can land as
      // ERR_CONNECTION_CLOSED on the browser side.
      controller.enqueue(encoder.encode(`: connected\n\n`));

      try {
        console.log(`[import:${reqId}] runImport begin`);
        await runImport({
          userId: user.id,
          contentType,
          body: request.body as ReadableStream<Uint8Array>,
          send,
        });
        console.log(`[import:${reqId}] runImport done`);
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        console.error(`[import:${reqId}] runImport threw:`, error);
        send({ phase: "error", error: `임포트 실패: ${errMsg}` });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(sse, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

interface RunImportArgs {
  userId: string;
  contentType: string;
  body: ReadableStream<Uint8Array>;
  send: (data: ImportProgress) => void;
}

/**
 * Pipe the request body through busboy, locate the `file` field, and dispatch
 * to the format-specific parser. Resolves once the import completes (success
 * or error already sent via `send`).
 */
async function runImport({ userId, contentType, body, send }: RunImportArgs): Promise<void> {
  const trace = (msg: string, extra?: unknown) => {
    console.log(`[import:run] ${msg}`, extra ?? "");
  };
  trace("entering runImport");

  const bb = Busboy({
    headers: { "content-type": contentType },
    limits: { fileSize: MAX_FILE_SIZE, files: 1 },
  });

  const nodeBody = Readable.fromWeb(body as unknown as import("node:stream/web").ReadableStream);

  // Race a single file event vs. the body finishing without one.
  const filePromise = new Promise<{ name: string; stream: Readable }>((resolve, reject) => {
    let handled = false;
    bb.on("file", (_field, fileStream, info) => {
      handled = true;
      trace("busboy:file", { filename: info.filename, mimeType: info.mimeType });
      resolve({ name: info.filename ?? "upload", stream: fileStream });
    });
    bb.on("close", () => {
      trace("busboy:close", { handled });
      if (!handled) reject(new Error("file 필드가 필요합니다"));
    });
    bb.on("error", (e) => {
      trace("busboy:error", { message: (e as Error).message });
      reject(e);
    });
    nodeBody.on("error", (e) => {
      trace("nodeBody:error", { message: (e as Error).message });
      reject(e);
    });
    nodeBody.on("end", () => trace("nodeBody:end"));
    nodeBody.on("close", () => trace("nodeBody:close"));
  });

  nodeBody.pipe(bb);

  const { name: fileName, stream: fileStream } = await filePromise;
  trace("got file", { fileName });

  // The streaming JSON pipeline (stream-json) calls `destroy()` in its
  // finally block as soon as it has yielded all top-level array elements
  // it cares about. That destroy propagates upstream — through the busboy
  // file stream and (if gzipped) the gunzip transform — emitting `error`
  // events with code ABORT_ERR / ERR_STREAM_PREMATURE_CLOSE. Without
  // explicit listeners these escalate to uncaughtException and crash the
  // Node process. The data import itself has already finished successfully
  // at that point, so we swallow these specific codes everywhere the
  // upstream chain touches.
  const isBenignAbort = (e: NodeJS.ErrnoException): boolean =>
    e.code === "ABORT_ERR" || e.code === "ERR_STREAM_PREMATURE_CLOSE";

  // busboy emits 'limit' on the file stream when fileSize is exceeded; we
  // surface that here too so the user sees a clean error instead of a
  // truncated parse. Attach this on the raw fileStream regardless of gzip,
  // because the limit applies to compressed bytes.
  fileStream.on("limit", () => {
    fileStream.unpipe?.();
  });
  fileStream.on("error", (e: NodeJS.ErrnoException) => {
    if (isBenignAbort(e)) return;
    console.error("[import] fileStream error:", e);
  });

  // Gzip support: users on Cloudflare can hit the 100MB body limit with raw
  // Google Takeout JSON. Uploading `Records.json.gz` (~10x smaller) and
  // gunzipping here lets the existing streaming pipeline run unchanged.
  const isGzipped = fileName.toLowerCase().endsWith(".gz");
  trace("gzip?", { isGzipped });
  let decoded: Readable = fileStream;
  if (isGzipped) {
    const gunzip = createGunzip();
    fileStream.pipe(gunzip);
    gunzip.on("error", (e: NodeJS.ErrnoException) => {
      if (isBenignAbort(e)) return;
      console.error("[import] gunzip error:", e);
    });
    decoded = gunzip;
  }

  // Sniff a prefix to decide format, then re-prepend it before handing the
  // remainder to the parser. We can't peek-then-rewind a Node Readable.
  const { prefix, prefixedStream, fileTooLarge } = await sniffPrefix(decoded, SNIFF_BYTES);
  trace("sniff done", {
    prefixBytes: prefix.length,
    fileTooLarge,
    prefixHead: prefix.subarray(0, 64).toString("utf-8").replace(/\s+/g, " "),
  });
  prefixedStream.on("error", (e: NodeJS.ErrnoException) => {
    if (isBenignAbort(e)) return;
    console.error("[import] prefixedStream error:", e);
  });

  // Strip a trailing `.gz` so detectFormat sees the inner extension
  // (e.g. Records.json.gz → Records.json).
  const sniffName = fileName.replace(/\.gz$/i, "");
  const detected = detectFormat(sniffName, prefix.toString("utf-8"));
  trace("format detected", { sniffName, detected });

  if (detected === "unknown") {
    // Drain the rest so the request finishes cleanly.
    prefixedStream.resume();
    send({
      phase: "error",
      error: "지원하지 않는 파일 형식입니다. GPX, GeoJSON, Google Takeout JSON을 사용하세요.",
    });
    return;
  }

  send({ phase: "parsing", progress: 0, totalParsed: 0, format: detected });

  let pointSource: ParsedPoint[] | AsyncIterable<ParsedPoint>;

  if (detected === "google-records" || detected === "google-phone-takeout") {
    // Stream — no full materialization.
    pointSource = streamGoogleTakeout(prefixedStream);
  } else {
    // GPX / GeoJSON: small files, buffer to text and use existing parsers.
    const text = await readAllToString(prefixedStream);
    if (detected === "gpx") {
      pointSource = parseGpx(text);
    } else if (detected === "geojson") {
      pointSource = parseGeoJson(JSON.parse(text));
    } else {
      // Includes any future ImportFormat we forgot to wire up.
      pointSource = parseGoogleTakeout(JSON.parse(text));
    }
  }

  if (fileTooLarge) {
    send({ phase: "error", error: `파일 크기는 ${MAX_FILE_SIZE_MB}MB 이하여야 합니다` });
    return;
  }

  trace("calling importPoints", { detected });
  const result = await importPoints(userId, pointSource, (progress) => {
    send({ ...progress, format: detected });
  });
  trace("importPoints returned", result);

  if (result.totalParsed === 0) {
    send({ phase: "error", error: "파일에서 위치 데이터를 찾을 수 없습니다" });
    return;
  }

  send({
    phase: "done",
    totalParsed: result.totalParsed,
    inserted: result.imported,
    duplicates: result.duplicates,
    dateRange: result.dateRange,
    format: detected,
    progress: 100,
  });
}

/** Read up to `bytes` from `src`, return the captured prefix and a Readable that replays prefix + rest. */
async function sniffPrefix(
  src: Readable,
  bytes: number
): Promise<{ prefix: Buffer; prefixedStream: Readable; fileTooLarge: boolean }> {
  const chunks: Buffer[] = [];
  let total = 0;
  let fileTooLarge = false;

  src.on("limit", () => {
    fileTooLarge = true;
  });

  for await (const chunk of src) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    chunks.push(buf);
    total += buf.length;
    if (total >= bytes) break;
  }

  const prefix = Buffer.concat(chunks).subarray(0, bytes);

  // Node Readable that yields the captured prefix first, then the live tail.
  const prefixedStream = Readable.from(
    (async function* () {
      yield Buffer.concat(chunks);
      for await (const chunk of src) {
        yield Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      }
    })()
  );

  return { prefix, prefixedStream, fileTooLarge };
}

async function readAllToString(src: Readable): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of src) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf-8");
}
