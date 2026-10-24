/*
 * JPEG inspection and metadata stripping — pure, dependency-free, client-safe.
 *
 * A phone photo carries the reporter's GPS position, the device serial and the
 * time to the second in its EXIF (APP1), and the browser's canvas re-encode
 * that the report screen does is a courtesy the server never trusts. So the
 * server walks the file itself:
 *
 *   SOI  FF D8                         kept
 *   APP0 FF E0  (JFIF)                 kept
 *   APP1–APP15  FF E1 … FF EF          DROPPED — EXIF, XMP, GPS, ICC, maker notes
 *   COM  FF FE                         DROPPED — free text, often a device name
 *   DQT / SOF / DHT / DRI / …          kept
 *   SOS  FF DA … entropy data … EOI    kept VERBATIM up to the last FF D9
 *
 * Anything after the final EOI is cut — some cameras append a trailer (a second
 * thumbnail, a "Samsung" block) that would carry metadata straight past a strip
 * that only looked at the header.
 */

export const MAX_PHOTO_BYTES = 2 * 1024 * 1024;

export type JpegSegment = { marker: number; offset: number; length: number };

export type JpegInspection =
  | { ok: true; segments: JpegSegment[]; sosOffset: number; end: number }
  | { ok: false; error: string };

const NOT_JPEG = "The photo must be a JPEG image";
const BROKEN = "The photo is damaged or incomplete — take it again";

/** Markers that stand alone (no length field): TEM and RST0–7. SOI/EOI are handled apart. */
function standalone(m: number): boolean {
  return m === 0x01 || (m >= 0xd0 && m <= 0xd7);
}

export function inspectJpeg(bytes: Uint8Array): JpegInspection {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) {
    return { ok: false, error: NOT_JPEG };
  }
  if (bytes.length > MAX_PHOTO_BYTES) return { ok: false, error: "The photo is larger than 2 MB" };

  const segments: JpegSegment[] = [];
  let i = 2;
  while (i < bytes.length) {
    if (bytes[i] !== 0xff) return { ok: false, error: BROKEN };
    // Fill bytes: any number of FF before the marker code.
    while (i < bytes.length && bytes[i] === 0xff) i++;
    if (i >= bytes.length) return { ok: false, error: BROKEN };
    const marker = bytes[i];
    const start = i - 1;
    i++;
    if (marker === 0xd9) return { ok: false, error: BROKEN }; // EOI before any image data
    if (standalone(marker)) {
      segments.push({ marker, offset: start, length: 2 });
      continue;
    }
    if (i + 2 > bytes.length) return { ok: false, error: BROKEN };
    const len = (bytes[i] << 8) | bytes[i + 1];
    if (len < 2 || i + len > bytes.length) return { ok: false, error: BROKEN };
    segments.push({ marker, offset: start, length: len + 2 });
    if (marker === 0xda) {
      // Entropy-coded data follows; the image ends at the LAST EOI.
      let end = -1;
      for (let j = bytes.length - 2; j >= i + len; j--) {
        if (bytes[j] === 0xff && bytes[j + 1] === 0xd9) {
          end = j + 2;
          break;
        }
      }
      if (end < 0) return { ok: false, error: BROKEN };
      if (!segments.some((s) => s.marker >= 0xc0 && s.marker <= 0xcf && s.marker !== 0xc4 && s.marker !== 0xc8 && s.marker !== 0xcc)) {
        return { ok: false, error: BROKEN }; // no frame header (SOFn) before the scan
      }
      return { ok: true, segments, sosOffset: start, end };
    }
    i += len;
  }
  return { ok: false, error: BROKEN };
}

/** APP1–APP15 and COM — the segments that carry metadata. */
export function isMetadataMarker(m: number): boolean {
  return (m >= 0xe1 && m <= 0xef) || m === 0xfe;
}

/**
 * The same image with every metadata segment removed. Throws the operator's
 * sentence when the bytes are not a complete JPEG — call `inspectJpeg` first
 * to get it as a value instead.
 */
export function stripJpegMetadata(bytes: Uint8Array): Uint8Array {
  const info = inspectJpeg(bytes);
  if (!info.ok) throw new Error(info.error);
  const keep = info.segments.filter((s) => s.marker !== 0xda && !isMetadataMarker(s.marker));
  const scanLen = info.end - info.sosOffset;
  const total = 2 + keep.reduce((n, s) => n + s.length, 0) + scanLen;
  const out = new Uint8Array(total);
  out[0] = 0xff;
  out[1] = 0xd8;
  let o = 2;
  for (const s of keep) {
    out.set(bytes.subarray(s.offset, s.offset + s.length), o);
    o += s.length;
  }
  out.set(bytes.subarray(info.sosOffset, info.end), o);
  return out;
}
