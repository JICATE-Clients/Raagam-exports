// ============================================================================
// Communication Hub — does a file's CONTENT match the type it claims? (0761)
//
// The browser names a file's type from its extension, and an uploader can name
// anything. Before an upload may be attached, the server reads its first bytes
// (lib/comms/attachment-actions.ts) and asks this function. A mismatch — an
// .exe renamed report.pdf, a web page renamed notes.txt — is deleted and
// refused.
//
// SIGNATURES, NOT PARSING: this checks the magic number each format starts
// with. It is not a malware scanner and does not claim to be one; there is no
// scanning service in this deployment (see the Task 05 report). What it does
// guarantee is that a file shown as an image is an image, a "PDF" opens as a
// PDF, and no Windows / Linux executable or HTML page arrives under a business
// document's name.
//
// Office files: DOCX / XLSX / PPTX are ZIP containers (PK\x03\x04); DOC / XLS
// are OLE compound files (D0 CF 11 E0 …). A ZIP that is really something else
// would pass the signature — the bucket's MIME allowlist and the download-only
// handling of Office files are what bound that.
//
// Pure: no server import, so scripts/check-comms-attachments.mts tests it on
// real byte patterns.
// ============================================================================

/** How many leading bytes the server reads to decide. */
export const SNIFF_BYTES = 8192;

const starts = (b: Uint8Array, sig: number[], at = 0) => sig.every((v, i) => b[at + i] === v);
const ascii = (s: string) => Array.from(s, (c) => c.charCodeAt(0));

const PDF = ascii("%PDF-");
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG = [0xff, 0xd8, 0xff];
const GIF87 = ascii("GIF87a");
const GIF89 = ascii("GIF89a");
const RIFF = ascii("RIFF");
const WEBP = ascii("WEBP");
const ZIP = [0x50, 0x4b, 0x03, 0x04];
const OLE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const EXE = ascii("MZ");
const ELF = [0x7f, 0x45, 0x4c, 0x46];

/** Leading text, lower-cased, past a BOM and whitespace — for the HTML test. */
function leadingText(b: Uint8Array): string {
  let i = starts(b, [0xef, 0xbb, 0xbf]) ? 3 : 0;
  while (i < b.length && (b[i] === 0x20 || b[i] === 0x09 || b[i] === 0x0a || b[i] === 0x0d)) i++;
  return String.fromCharCode(...b.slice(i, i + 16)).toLowerCase();
}

/**
 * Null when `bytes` (the file's first SNIFF_BYTES) fit `mime`; otherwise the
 * sentence the operator reads. `mime` is what STORAGE recorded for the object.
 */
export function sniffProblem(mime: string, bytes: Uint8Array): string | null {
  const m = mime.toLowerCase();
  if (bytes.length === 0) return "The file is empty.";
  // Never, whatever it claims to be.
  if (starts(bytes, EXE) || starts(bytes, ELF)) return "Programs cannot be shared here.";

  const wrong = "The file's contents do not match its type. It was not attached.";
  switch (m) {
    case "application/pdf":
      return starts(bytes, PDF) ? null : wrong;
    case "image/png":
      return starts(bytes, PNG) ? null : wrong;
    case "image/jpeg":
      return starts(bytes, JPEG) ? null : wrong;
    case "image/gif":
      return starts(bytes, GIF87) || starts(bytes, GIF89) ? null : wrong;
    case "image/webp":
      return starts(bytes, RIFF) && starts(bytes, WEBP, 8) ? null : wrong;
    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
    case "application/vnd.openxmlformats-officedocument.presentationml.presentation":
      return starts(bytes, ZIP) ? null : wrong;
    case "application/msword":
      return starts(bytes, OLE) ? null : wrong;
    case "application/vnd.ms-excel":
      // Excel opens a CSV saved as .xls, and some systems export one that way;
      // either the OLE container or plain text is a real spreadsheet.
      return starts(bytes, OLE) || isPlainText(bytes) ? null : wrong;
    case "text/plain":
    case "text/csv":
      return isPlainText(bytes) ? null : wrong;
    default:
      return "That file type cannot be shared here.";
  }
}

/** Text: no NUL byte, no known binary header, and not a web page. */
function isPlainText(b: Uint8Array): boolean {
  if (b.includes(0)) return false;
  if (starts(b, PDF) || starts(b, PNG) || starts(b, JPEG) || starts(b, ZIP) || starts(b, OLE)) return false;
  const lead = leadingText(b);
  return !/^<(!doctype|html|script|svg|\?xml|iframe|body|head)/.test(lead);
}
