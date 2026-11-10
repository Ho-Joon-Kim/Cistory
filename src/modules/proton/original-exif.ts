/**
 * EXIF from a photo's original file: GPS, camera heading and capture UTC offset.
 *
 * Proton's extended attributes often lack a Location the file itself has (a
 * live probe found GPS in 4 of 4 Galaxy S22 HEIC originals Cistory stored
 * without one), so the original is read once per revision. Parsing is chunked
 * through exifr: only the byte ranges the parser asks for are pulled from the
 * `ByteSource`, never the whole file.
 *
 * Nothing here logs: coordinates, headings and offsets are personal data.
 */
import exifr from "exifr";
import { isValidCoordinate } from "./mapper";
import type { ByteSource } from "./original-source";

export interface OriginalExif {
  lat: number | null;
  lon: number | null;
  /** GPSImgDirection, degrees clockwise from `directionRef`'s north, in [0, 360). */
  direction: number | null;
  directionRef: "T" | "M" | null;
  /** OffsetTimeOriginal (else OffsetTimeDigitized) as minutes east of UTC. */
  utcOffsetMin: number | null;
}

export const EMPTY_EXIF: OriginalExif = {
  lat: null,
  lon: null,
  direction: null,
  directionRef: null,
  utcOffsetMin: null,
};

/** First request and each follow-up; exifr asks for more only when a segment needs it. */
const CHUNK_BYTES = 64 * 1024;
/** Follow-up chunk requests per file before giving up on finding EXIF. */
const CHUNK_LIMIT = 8;

const EXIF_OPTIONS = {
  // TIFF/EXIF only: IFD0 holds the pointers to the EXIF and GPS IFDs.
  tiff: true,
  ifd0: true,
  exif: true,
  gps: true,
  ifd1: false,
  interop: false,
  makerNote: false,
  userComment: false,
  xmp: false,
  icc: false,
  iptc: false,
  jfif: false,
  ihdr: false,
  // Raw values ('T', "+09:00"); `latitude`/`longitude` are still computed.
  translateKeys: true,
  translateValues: false,
  reviveValues: false,
  sanitize: true,
  mergeOutput: true,
  silentErrors: true,
  chunked: true,
  firstChunkSize: CHUNK_BYTES,
  chunkSize: CHUNK_BYTES,
  chunkLimit: CHUNK_LIMIT,
};

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** "+09:00" / "-03:30" → minutes; anything else (incl. out-of-range) → null. */
export function parseUtcOffset(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const m = /^([+-])(\d{2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const hours = Number(m[2]);
  const minutes = Number(m[3]);
  if (minutes >= 60) return null;
  const total = hours * 60 + minutes;
  // Real UTC offsets span -12:00 .. +14:00.
  if (total > 14 * 60) return null;
  return m[1] === "-" ? -total : total;
}

function parseDirection(
  raw: Record<string, unknown>
): Pick<OriginalExif, "direction" | "directionRef"> {
  const degrees = finite(raw.GPSImgDirection);
  if (degrees === null || degrees < 0 || degrees > 360)
    return { direction: null, directionRef: null };
  const ref = typeof raw.GPSImgDirectionRef === "string" ? raw.GPSImgDirectionRef.trim() : "";
  return {
    direction: degrees === 360 ? 0 : degrees,
    directionRef: ref === "T" || ref === "M" ? ref : null,
  };
}

/** Maps exifr's merged output to the stored fields, rejecting malformed values. */
export function mapExif(raw: unknown): OriginalExif {
  if (!raw || typeof raw !== "object") return EMPTY_EXIF;
  const r = raw as Record<string, unknown>;
  const hasGps = isValidCoordinate(r.latitude, r.longitude);
  const offset = parseUtcOffset(r.OffsetTimeOriginal) ?? parseUtcOffset(r.OffsetTimeDigitized);
  return {
    lat: hasGps ? (r.latitude as number) : null,
    lon: hasGps ? (r.longitude as number) : null,
    ...parseDirection(r),
    utcOffsetMin: offset,
  };
}

/** exifr's chunked reader base class; it is internal, so it is reached through a registered reader. */
interface ChunkedReaderLike {
  chunked: boolean;
  size: number | undefined;
  input: ByteSource;
  set(chunk: Uint8Array, offset: number, canExtend: boolean): unknown;
  read(): Promise<void>;
  readChunked(): Promise<void>;
}
type ChunkedReaderClass = new (input: ByteSource, options: unknown) => ChunkedReaderLike;

let readerClass: ChunkedReaderClass | null = null;

/**
 * exifr reads files, URLs and Blobs in chunks through a `ChunkedReader`; it
 * has no public hook for other sources. Its URL reader is a direct subclass,
 * so the base class is taken from there and given a `ByteSource` backend.
 */
function sourceReaderClass(): ChunkedReaderClass {
  if (readerClass) return readerClass;
  const urlReader = (exifr as unknown as { fileReaders: Map<string, unknown> }).fileReaders.get(
    "url"
  );
  const Base = urlReader ? Object.getPrototypeOf(urlReader) : null;
  if (typeof Base !== "function" || typeof Base.prototype?.readChunk !== "function") {
    throw new Error("exifr chunked reader unavailable");
  }
  const Reader = class extends (Base as ChunkedReaderClass) {
    async readChunked() {
      this.chunked = true;
      this.size = this.input.size;
      return super.readChunked();
    }
    async _readChunk(offset: number, length: number) {
      const bytes = await this.input.read(offset, length);
      if (bytes.length === 0) {
        this.size = offset;
        return undefined;
      }
      if (bytes.length < length) this.size = offset + bytes.length;
      return this.set(bytes, offset, true);
    }
  };
  readerClass = Reader;
  return Reader;
}

/**
 * Parses EXIF from `source`, reading only what the parser requests. A file
 * without EXIF, an unknown format or a malformed structure is a definite
 * answer (`EMPTY_EXIF`); only a failing `source.read` (network) throws.
 */
export async function readOriginalExif(source: ByteSource): Promise<OriginalExif> {
  const Exifr = (exifr as unknown as { Exifr: new (options: unknown) => ExifrInstance }).Exifr;
  const instance = new Exifr(EXIF_OPTIONS);
  const Reader = sourceReaderClass();
  const file = new Reader(source, instance.options);

  let readFailed: unknown = null;
  const guarded: ByteSource = {
    size: source.size,
    get bytesRead() {
      return source.bytesRead;
    },
    async read(offset, length) {
      try {
        return await source.read(offset, length);
      } catch (error) {
        readFailed ??= error;
        throw error;
      }
    },
  };
  file.input = guarded;

  let output: unknown;
  try {
    await file.read();
    instance.file = file;
    output = await instance.parse();
  } catch {
    output = undefined;
  }
  // exifr swallows reader errors as "no EXIF"; a transport failure must not
  // be recorded as a checked original.
  if (readFailed) throw readFailed;
  return mapExif(output);
}

interface ExifrInstance {
  options: unknown;
  file: unknown;
  parse(): Promise<unknown>;
}
