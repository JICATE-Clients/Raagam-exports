// SOURCE: the official Indian GST HSN master.
//
//   https://tutorial.gst.gov.in/downloads/HSN_SAC.xlsx   (668 KB, no key, no auth)
//
// Sheet HSN_MSTR, two columns — HSN_CD, HSN_Description — 21,935 rows on
// 2026-08-04. Sheet SAC_MSTR is services and is ignored.
//
// WHY THIS SOURCE AND NOT A DICTIONARY: it is the nomenclature this business
// already files its invoices under, so its words are the words the trade uses.
// It is also the only free source that reaches past fabric into trims, packing
// and machinery, which is what makes all seven classes reachable at all.
//
// ── WHAT THE ROWS ACTUALLY LOOK LIKE (measured, do not assume) ──────────────
//
// Each row carries its OWN leaf text, not its ancestors' — there is no prefix to
// strip, which is what the first draft of this file expected:
//
//   5209      WOVEN FABRICS OF COTTON, CONTAINING 85% OR MORE BY WEIGHT ...
//   520911    PLAIN WEAVE :
//   52091111  DHOTI
//   52091113  CASEMENT
//   52091240  SEERSUCKER
//   96071110  ZIP FASTENERS
//   48191010  BOXES
//
// So the good names arrive already short. The problem is the other kind of leaf:
// a bare QUALIFIER (GREY, BLEACHED, DYED, PRINTED, OTHER, PARTS) or a
// specification (MEASURING 714.29 DECITEX OR MORE ...). Those are what
// `sanitise()` and GENERIC_LEAVES exist to throw away, and the ones that get
// through are what the human review step is for.
//
// ── THE FILE HAS BROKEN CODES, AND THEY LAND IN THE TEXTILE RANGE ──────────
//
// 35 of the 21,935 rows carry a code that is not a valid HSN code, and the
// failure mode is a LOST LEADING ZERO — which is the worst possible one here,
// because a chapter-05 code missing its zero is indistinguishable from a
// chapter-50 one, and chapter 50 is silk:
//
//   504005  Bladders and stomachs         really 0504 00 05, animal guts
//   506901  Bone meal                     really 0506 90 01
//   511991  Silkworm pupae                really 0511 99 1
//
// The first run of this miner duly proposed BLADDERS AND STOMACHS and BONE MEAL
// as YARN category names. Nothing in `sanitise()` could have caught them: they
// are short, uppercase-able, punctuation-free noun phrases. They were wrong
// because their PROVENANCE was wrong.
//
// The test that catches them is structural rather than a blocklist: a 6- or
// 8-digit code is trustworthy only if its 4-DIGIT PARENT HEADING EXISTS in the
// master. 5040 / 5061 / 5069 / 5119 are not headings (chapter 50 stops at 5007,
// chapter 51 at 5113), so every one of those rows fails. Measured: 35 rows
// rejected out of 21,935 — 24 six-digit, 11 eight-digit — and every single one is
// genuinely malformed, including `52805120 SAARI` (no heading 5280; chapter 52
// stops at 5212) and `44229112 For jute machinery` (chapter 44 stops at 4421).
// No valid textile code is lost.
//
// Codes are also required to be 2, 4, 6 or 8 digits long, which removes the five
// remaining oddities in the file (`30559`, `40210`, `90121`, `3074330`,
// `5119110`). 40 rows fail one rule or the other, which is what the run reports.
//
// Do NOT swap this for a GitHub mirror. `crusher95/hsn-sac-gst-json`'s
// `hsn_all.json` was fetched and inspected on 2026-08-04: SAC services only,
// ~450 records, chapter 52 entirely absent.

import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import ExcelJS from "exceljs";

import { classesForCode, minedClasses } from "./hsn-chapter-map.mts";
import type { MinedTerm, VocabSource } from "./types.mts";
import { USER_AGENT } from "./types.mts";

const URL_XLSX = "https://tutorial.gst.gov.in/downloads/HSN_SAC.xlsx";
const CACHE_DIR = path.join(import.meta.dirname, "..", ".vocab-cache");
const CACHE_FILE = path.join(CACHE_DIR, "HSN_SAC.xlsx");

/**
 * Leaves that are true of thousands of goods and therefore name none of them.
 *
 * GREY / DYED / PRINTED are the interesting entries: they ARE part of real
 * category names (the YARN list already carries DYED YARN, GREY YARN, DYED
 * MELANGE) but on their own they are a finish, not a material. HSN uses them as
 * the leaf under almost every yarn and fabric heading, so left in they would be
 * the most-proposed terms in the whole run and would say nothing.
 */
const GENERIC_LEAVES = new Set([
  "OTHER", "OTHERS", "PARTS", "PARTS THEREOF", "GREY", "GREY (UNBLEACHED)",
  "BLEACHED", "UNBLEACHED", "UNBLEACHED OR BLEACHED", "DYED", "PRINTED",
  "OF YARNS OF DIFFERENT COLOURS", "NOT ELSEWHERE SPECIFIED",
  "SINGLE YARN", "MULTIPLE OR CABLED YARN", "MULTIPLE (FOLDED) OR CABLED YARN",
  "PUT UP FOR RETAIL SALE", "NOT PUT UP FOR RETAIL SALE",
  "OF COTTON", "OF WOOL", "OF SILK", "OF JUTE", "OF MAN-MADE FIBRES",
  "OF SYNTHETIC FIBRES", "OF ARTIFICIAL FIBRES", "OF OTHER TEXTILE MATERIALS",
  "OF WOOL OR FINE ANIMAL HAIR", "OF COTTON YARN", "HANDLOOM", "POWERLOOM",
  "MILL MADE", "MILLMADE", "OTHER THAN HANDLOOM", "SETS", "KITS",
  "IN THE PIECE", "IN PIECES", "MADE UPS", "MADE-UPS", "MENS", "WOMENS",
  "BOYS", "GIRLS", "OF OTHER MATERIALS", "OF BASE METAL", "OF PLASTICS",
  "OF PAPER", "OF PAPERBOARD", "OF GLASS", "OF RUBBER", "OF LEATHER",
]);

/* ------------------------------------------------------------------- fetching */

/**
 * The workbook bytes, from the cache when we have them.
 *
 * Cached because the file is 668 KB and does not change between two runs an hour
 * apart, and because a reviewer iterating on GENERIC_LEAVES should not re-hit a
 * government server every time. `--refresh` on the miner deletes nothing; it
 * simply bypasses the cache and rewrites it.
 */
async function workbookBytes(refresh: boolean): Promise<Buffer> {
  if (!refresh) {
    try {
      const st = await stat(CACHE_FILE);
      if (st.size > 100_000) {
        const buf = await readFile(CACHE_FILE);
        console.log(`  hsn: cached ${CACHE_FILE} (${st.size} bytes, sha ${sha(buf)})`);
        return buf;
      }
    } catch {
      /* no cache yet — fall through and download */
    }
  }

  console.log(`  hsn: downloading ${URL_XLSX}`);
  const res = await fetch(URL_XLSX, { headers: { "user-agent": USER_AGENT } });
  if (!res.ok) {
    throw new Error(
      `hsn: ${URL_XLSX} returned ${res.status} ${res.statusText}. ` +
        `The GST portal moves this file occasionally — check ` +
        `https://tutorial.gst.gov.in/downloads/ and update URL_XLSX.`,
    );
  }
  const buf = Buffer.from(await res.arrayBuffer());
  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(CACHE_FILE, buf);
  console.log(`  hsn: cached ${buf.length} bytes, sha ${sha(buf)}`);
  return buf;
}

function sha(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex").slice(0, 12);
}

/* ------------------------------------------------------------------- the source */

export function hsnSource(refresh = false): VocabSource {
  return {
    id: "hsn",
    note: "official GST HSN master (tutorial.gst.gov.in), partitioned by hsn-chapter-map.mts",

    async fetch(): Promise<MinedTerm[]> {
      const claimed = minedClasses();
      if (claimed.length === 0) {
        console.log("  hsn: HSN_CLASS_CHAPTERS declares no chapters for any class — skipping");
        return [];
      }
      console.log(`  hsn: chapters declared for ${claimed.join(", ")}`);

      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(await workbookBytes(refresh));

      const ws = wb.getWorksheet("HSN_MSTR");
      if (!ws) {
        throw new Error(
          `hsn: sheet HSN_MSTR not found (sheets: ${wb.worksheets.map((w) => w.name).join(", ")}).`,
        );
      }

      // Read every row first: the validity test needs to know which 4-digit
      // headings exist before it can judge any 6- or 8-digit code.
      const rows: { digits: string; desc: string }[] = [];
      ws.eachRow((row, i) => {
        if (i === 1) return; // header
        const digits = String(row.getCell(1).value ?? "").replace(/\D/g, "");
        const desc = String(row.getCell(2).value ?? "").trim();
        if (digits && desc) rows.push({ digits, desc });
      });

      const headings = new Set(rows.filter((r) => r.digits.length === 4).map((r) => r.digits));

      const out: MinedTerm[] = [];
      let malformed = 0;
      let generic = 0;

      for (const { digits, desc } of rows) {
        if (!isWellFormed(digits, headings)) {
          malformed++;
          continue;
        }

        const classes = classesForCode(digits);
        if (classes.length === 0) continue;

        const term = desc.replace(/\s*:\s*$/, "").trim();
        if (GENERIC_LEAVES.has(term.toUpperCase())) {
          generic++;
          continue;
        }

        for (const classCode of classes) {
          out.push({ term, classCode, source: "hsn", ref: dotted(digits) });
        }
      }

      console.log(
        `  hsn: ${rows.length} rows, ${headings.size} headings, ` +
          `${malformed} malformed codes rejected, ${generic} generic leaves dropped, ` +
          `${out.length} in-scope terms`,
      );
      return out;
    },
  };
}

/**
 * Is this a code the file can be trusted about? See the header.
 *
 * Two rules, and the second is the one that matters: a code below the heading
 * level must have its 4-digit heading present in the master. That is what tells
 * `504005` (chapter 05 with its leading zero eaten) apart from a genuine
 * chapter-50 code, and it does so without a blocklist that would need extending
 * every time the GST portal republishes.
 */
function isWellFormed(digits: string, headings: ReadonlySet<string>): boolean {
  if (digits.length !== 2 && digits.length !== 4 && digits.length !== 6 && digits.length !== 8) {
    return false;
  }
  if (digits.length <= 4) return true;
  return headings.has(digits.slice(0, 4));
}

/** 52091240 -> 5209.12.40, which is how the trade writes it on a document. */
function dotted(code: string): string {
  const d = code.replace(/\D/g, "");
  if (d.length <= 4) return d;
  if (d.length <= 6) return `${d.slice(0, 4)}.${d.slice(4)}`;
  return `${d.slice(0, 4)}.${d.slice(4, 6)}.${d.slice(6)}`;
}
