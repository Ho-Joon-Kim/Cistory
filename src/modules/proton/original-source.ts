/**
 * Reading a photo's original file from Proton, in memory only.
 *
 * Proton stores a file as encrypted 4 MiB blocks; a ranged read still
 * downloads and decrypts every block it touches. The seekable stream therefore
 * saves bandwidth only on originals larger than one block, which is exactly
 * where it matters (a JPEG's EXIF sits in its first block; a HEIC's may sit
 * in a later one). Nodes uploaded without claimed block sizes cannot seek and
 * fall back to a capped full download.
 *
 * Bytes never leave this process: no logging, no persistence, no error
 * message carries them.
 */
import type { FileDownloader, SeekableReadableStream } from "@protontech/drive-sdk";

/** Largest original ever downloaded whole (observed originals: 0.5–9 MB). */
export const ORIGINAL_MAX_BYTES = 32 * 1024 * 1024;

/**
 * Smallest ranged read issued against the SDK stream. A read that misses the
 * window cache pulls at least this much, so EXIF's many small reads (IFD
 * entries, then the values they point at) cost one SDK call, not dozens.
 */
const READ_WINDOW_BYTES = 256 * 1024;

/** The original is larger than `ORIGINAL_MAX_BYTES` (claimed or actual). */
export class OriginalTooLargeError extends Error {
  constructor() {
    super("Original file exceeds the download cap");
    this.name = "OriginalTooLargeError";
  }
}

/** Random access to an original's clear-text bytes. */
export interface ByteSource {
  /** Claimed clear-text size; Proton marks it untrusted and it may be missing. */
  readonly size: number | undefined;
  /** Up to `length` bytes at `offset`; shorter only at end of file. */
  read(offset: number, length: number): Promise<Uint8Array>;
  /** Clear-text bytes actually pulled through the SDK so far. */
  readonly bytesRead: number;
}

interface Window {
  start: number;
  bytes: Uint8Array;
}

/**
 * A `ByteSource` over the SDK's seekable stream, or null when the node cannot
 * seek (old revisions without claimed block sizes).
 *
 * Reads are cached as windows so the backward seeks EXIF parsing does (header
 * → IFD → value) are served locally instead of re-downloading a block; the
 * SDK's own buffer only ever moves forward.
 */
export function seekableSource(downloader: FileDownloader): ByteSource | null {
  let stream: SeekableReadableStream;
  try {
    stream = downloader.getSeekableStream();
  } catch {
    return null;
  }
  const size = downloader.getClaimedSizeInBytes();
  const windows: Window[] = [];
  let bytesRead = 0;

  const fromCache = (offset: number, length: number): Uint8Array | null => {
    for (const w of windows) {
      const end = w.start + w.bytes.length;
      if (offset >= w.start && offset + length <= end) {
        return w.bytes.subarray(offset - w.start, offset - w.start + length);
      }
      // A window that ends at EOF satisfies any read starting inside it.
      if (offset >= w.start && offset < end && size !== undefined && end >= size) {
        return w.bytes.subarray(offset - w.start);
      }
    }
    return null;
  };

  return {
    size,
    get bytesRead() {
      return bytesRead;
    },
    async read(offset, length) {
      if (length <= 0) return new Uint8Array(0);
      if (size !== undefined && offset >= size) return new Uint8Array(0);
      const cached = fromCache(offset, length);
      if (cached) return cached;
      const want = Math.max(length, READ_WINDOW_BYTES);
      await stream.seek(offset);
      const { value } = await stream.read(want);
      bytesRead += value.length;
      windows.push({ start: offset, bytes: value });
      return value.subarray(0, Math.min(length, value.length));
    },
  };
}

/**
 * Downloads the whole original into memory, verified by the SDK, refusing
 * anything over `maxBytes` before (claimed size) and during the transfer.
 *
 * A completion that fails only on the author signature still has every block
 * decrypted and hash-checked; Proton's own clients offer to keep such files,
 * and photos uploaded by older apps often carry one. It is accepted here.
 */
export async function downloadOriginal(
  downloader: FileDownloader,
  maxBytes: number = ORIGINAL_MAX_BYTES
): Promise<Uint8Array> {
  const claimed = downloader.getClaimedSizeInBytes();
  if (claimed !== undefined && claimed > maxBytes) throw new OriginalTooLargeError();

  const chunks: Uint8Array[] = [];
  let total = 0;
  const sink = new WritableStream<Uint8Array>({
    write(chunk) {
      total += chunk.length;
      if (total > maxBytes) throw new OriginalTooLargeError();
      chunks.push(chunk);
    },
  });
  const controller = downloader.downloadToStream(sink);
  try {
    await controller.completion();
  } catch (error) {
    if (total > maxBytes) throw new OriginalTooLargeError();
    if (!controller.isDownloadCompleteWithSignatureIssues()) throw error;
  }

  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/**
 * Opens one original's downloader, runs `use` with it, and always gives its
 * download slot back.
 *
 * The SDK admits five downloaders per client at a time and frees a slot only
 * when a download ends: a full download's completion, or a seekable stream's
 * end, error or abort. A downloader that was only probed (claimed size over
 * the cap) or a seekable stream read just far enough for EXIF never ends on
 * its own, and after five of those every later `getFileDownloader` would
 * wait until its timeout. So every downloader is ended here: an unused one
 * gets a seekable stream (or, when it cannot seek, a full download started on
 * an already-aborted signal) purely so the abort below can end it.
 *
 * `timeoutMs` bounds everything the downloader does, including waiting for a
 * slot.
 */
export async function withOriginalDownloader<T>(
  open: (signal: AbortSignal) => Promise<FileDownloader>,
  timeoutMs: number,
  use: (downloader: FileDownloader) => Promise<T>
): Promise<T> {
  const controller = new AbortController();
  const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(timeoutMs)]);
  const raw = await open(signal);
  let used = false;
  const downloader: FileDownloader = {
    getClaimedSizeInBytes: () => raw.getClaimedSizeInBytes(),
    getSeekableStream: () => {
      const stream = raw.getSeekableStream();
      used = true;
      return stream;
    },
    downloadToStream: (sink, onProgress) => {
      used = true;
      return raw.downloadToStream(sink, onProgress);
    },
    unsafeDownloadToStream: (sink, onProgress) => {
      used = true;
      return raw.unsafeDownloadToStream(sink, onProgress);
    },
  };
  try {
    return await use(downloader);
  } finally {
    await endDownloader(raw, used, controller);
  }
}

async function endDownloader(
  raw: FileDownloader,
  used: boolean,
  controller: AbortController
): Promise<void> {
  if (used) {
    controller.abort();
    return;
  }
  try {
    // The stream registers its abort listener on creation; abort only after.
    raw.getSeekableStream();
    controller.abort();
    return;
  } catch {
    // Cannot seek: a full download ends (and frees its slot) when it fails.
  }
  controller.abort();
  try {
    await raw.downloadToStream(new WritableStream()).completion();
  } catch {
    // Expected: the signal is already aborted.
  }
}

/** A `ByteSource` over bytes already in memory (full-download fallback, tests). */
export function memorySource(bytes: Uint8Array): ByteSource {
  return {
    size: bytes.length,
    bytesRead: bytes.length,
    async read(offset, length) {
      return bytes.subarray(offset, Math.min(bytes.length, offset + length));
    },
  };
}
