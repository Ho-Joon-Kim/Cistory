/**
 * Test-only: builds real EXIF (a big-endian TIFF structure) and splices it
 * into a JPEG, so original-EXIF tests run against bytes a camera could have
 * written rather than a mocked parser. Coordinates here are synthetic.
 */

export interface ExifFixture {
  make?: string;
  model?: string;
  /** Signed decimal degrees. */
  lat?: number;
  lon?: number;
  /** GPSImgDirection in degrees, with its reference ('T' true / 'M' magnetic). */
  direction?: number;
  directionRef?: "T" | "M";
  offsetTimeOriginal?: string;
}

const ASCII = 2;
const LONG = 4;
const RATIONAL = 5;
const BYTE = 1;

interface Entry {
  tag: number;
  type: number;
  count: number;
  /** Raw big-endian value bytes; a pointer entry fills this in later. */
  value: Uint8Array;
}

function ascii(text: string): Entry["value"] {
  return new Uint8Array([...Buffer.from(`${text}\0`, "latin1")]);
}

function rationals(values: [number, number][]): Uint8Array {
  const out = new Uint8Array(values.length * 8);
  const view = new DataView(out.buffer);
  values.forEach(([n, d], i) => {
    view.setUint32(i * 8, n);
    view.setUint32(i * 8 + 4, d);
  });
  return out;
}

function long(value: number): Uint8Array {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value);
  return out;
}

/** Degrees, minutes and hundredths of seconds, as cameras write them. */
function dms(decimal: number): [number, number][] {
  const abs = Math.abs(decimal);
  const deg = Math.floor(abs);
  const minFloat = (abs - deg) * 60;
  const min = Math.floor(minFloat);
  const sec = Math.round((minFloat - min) * 60 * 10000);
  return [
    [deg, 1],
    [min, 1],
    [sec, 10000],
  ];
}

/** Serialises IFDs at `start` (TIFF offset); returns the bytes. Value data follows each IFD. */
function writeIfd(entries: Entry[], start: number): Uint8Array {
  const sorted = [...entries].sort((a, b) => a.tag - b.tag);
  const headerSize = 2 + sorted.length * 12 + 4;
  const data: number[] = [];
  const head = new Uint8Array(headerSize);
  const view = new DataView(head.buffer);
  view.setUint16(0, sorted.length);
  sorted.forEach((e, i) => {
    const at = 2 + i * 12;
    view.setUint16(at, e.tag);
    view.setUint16(at + 2, e.type);
    view.setUint32(at + 4, e.count);
    if (e.value.length <= 4) {
      head.set(e.value, at + 8);
    } else {
      view.setUint32(at + 8, start + headerSize + data.length);
      data.push(...e.value);
      if (data.length % 2) data.push(0);
    }
  });
  view.setUint32(headerSize - 4, 0); // no next IFD
  return new Uint8Array([...head, ...data]);
}

function size(entries: Entry[]): number {
  return writeIfd(entries, 0).length;
}

function asciiEntry(tag: number, text: string): Entry {
  const value = ascii(text);
  return { tag, type: ASCII, count: value.length, value };
}

function ifd0Entries(f: ExifFixture): Entry[] {
  const out: Entry[] = [];
  if (f.make) out.push(asciiEntry(0x010f, f.make));
  if (f.model) out.push(asciiEntry(0x0110, f.model));
  return out;
}

function gpsEntries(f: ExifFixture): Entry[] {
  const out: Entry[] = [];
  if (f.lat !== undefined && f.lon !== undefined) {
    out.push({ tag: 0x0000, type: BYTE, count: 4, value: new Uint8Array([2, 3, 0, 0]) });
    out.push(asciiEntry(0x0001, f.lat < 0 ? "S" : "N"));
    out.push({ tag: 0x0002, type: RATIONAL, count: 3, value: rationals(dms(f.lat)) });
    out.push(asciiEntry(0x0003, f.lon < 0 ? "W" : "E"));
    out.push({ tag: 0x0004, type: RATIONAL, count: 3, value: rationals(dms(f.lon)) });
  }
  if (f.direction !== undefined) {
    out.push(asciiEntry(0x0010, f.directionRef ?? "T"));
    const hundredths: [number, number] = [Math.round(f.direction * 100), 100];
    out.push({ tag: 0x0011, type: RATIONAL, count: 1, value: rationals([hundredths]) });
  }
  return out;
}

/** The TIFF payload of an APP1 `Exif\0\0` segment. */
export function buildExifTiff(f: ExifFixture): Uint8Array {
  const ifd0 = ifd0Entries(f);
  const exif = f.offsetTimeOriginal ? [asciiEntry(0x9011, f.offsetTimeOriginal)] : [];
  const gps = gpsEntries(f);

  // Pointer placeholders so IFD0's size is known before the offsets are.
  const exifPointer = { tag: 0x8769, type: LONG, count: 1, value: long(0) };
  const gpsPointer = { tag: 0x8825, type: LONG, count: 1, value: long(0) };
  if (exif.length) ifd0.push(exifPointer);
  if (gps.length) ifd0.push(gpsPointer);

  const ifd0Start = 8;
  const exifStart = ifd0Start + size(ifd0);
  const gpsStart = exifStart + (exif.length ? size(exif) : 0);
  exifPointer.value = long(exifStart);
  gpsPointer.value = long(gpsStart);

  const header = new Uint8Array([0x4d, 0x4d, 0x00, 0x2a, 0, 0, 0, 8]);
  return new Uint8Array([
    ...header,
    ...writeIfd(ifd0, ifd0Start),
    ...(exif.length ? writeIfd(exif, exifStart) : []),
    ...(gps.length ? writeIfd(gps, gpsStart) : []),
  ]);
}

/** Inserts an APP1 Exif segment right after a JPEG's SOI marker. */
export function withExif(jpeg: Uint8Array, f: ExifFixture): Uint8Array {
  if (jpeg[0] !== 0xff || jpeg[1] !== 0xd8) throw new Error("not a JPEG");
  const tiff = buildExifTiff(f);
  const payload = new Uint8Array([...Buffer.from("Exif\0\0", "latin1"), ...tiff]);
  const segLength = payload.length + 2;
  const app1 = new Uint8Array([0xff, 0xe1, segLength >> 8, segLength & 0xff, ...payload]);
  const out = new Uint8Array(jpeg.length + app1.length);
  out.set(jpeg.subarray(0, 2), 0);
  out.set(app1, 2);
  out.set(jpeg.subarray(2), 2 + app1.length);
  return out;
}
