/**
 * Vectors for `lib/orders/amendments/file-rows.ts` — the attached documents
 * (0416) as rows to write.
 *
 *   npm run check:amendment-files
 *
 * ## WHY THIS ONE CHILD NORMALIZER HAS A SUITE AND ELEVEN SIBLINGS DO NOT
 *
 * Because its filter is DIFFERENT from theirs, and the difference is invisible
 * unless you know why. They keep a row if any answer is filled; this one keeps a
 * row only if `storage_path` is. A reader tidying `actions.ts` into consistency
 * would "fix" it to match, and the result is a document row that resolves to
 * nothing when production clicks it months later looking for the buyer's order
 * sheet. That is what these vectors stand in front of.
 *
 * Runs under `tsx` for `check-bom-requirement.mts`'s reason: the module imports
 * a `@/lib/...` alias at runtime and Node's ESM resolver does not read it.
 *
 * ## THE OTHER FILE RULE IS NOT IN THIS SUITE, AND THAT IS WORTH KNOWING
 *
 * "Every style carries at least one document" — `stylesMissingFiles` and
 * `styleFileMessage` — is vectored in **`check-customer-dedup.mts`**, not here
 * (`npm run check:customer-dedup`). Not because it belongs there by subject, but
 * because that suite is where the pure rules exported from
 * `lib/orders/amendments/types.ts` are exercised, and those two live there
 * rather than in `file-rows.ts` so the SCREEN can import them: the screen's
 * `styleFileMissing` and the server's `styleFileProblem` are one predicate, and
 * a suite per module is what keeps the import graph honest.
 *
 * Written down because a reader looking for the file rule looks in the
 * file-named suite first and concludes it is untested (T3-styles, who did
 * exactly that). This file covers `normalizeFileRows` — which rows get WRITTEN;
 * that one covers which styles are IN BREACH.
 */
import { normalizeFileRows, type FileRowInput } from "../lib/orders/amendments/file-rows.ts";

let failed = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) {
    failed++;
    console.error(
      `FAIL  ${label}\n      expected ${JSON.stringify(expected)}\n      actual   ${JSON.stringify(actual)}`,
    );
  } else {
    console.log(`ok    ${label}`);
  }
}

/** Asserts a value is NOT something — the wrong answer a plausible
 *  implementation gives. */
function refute(label: string, actual: unknown, forbidden: unknown) {
  const same = JSON.stringify(actual) === JSON.stringify(forbidden);
  if (same) {
    failed++;
    console.error(`FAIL  ${label}\n      must NOT be ${JSON.stringify(forbidden)}`);
  } else {
    console.log(`ok    ${label}`);
  }
}

const file = (over: Partial<FileRowInput> = {}): FileRowInput => ({
  doc_kind: "order_sheet",
  file_name: "po.pdf",
  storage_path: "abc/po.pdf",
  mime_type: "application/pdf",
  size_bytes: 1024,
  ...over,
});

// ---------------------------------------------------------------------------
// 1. The ordinary case
// ---------------------------------------------------------------------------

check(
  "a complete row survives with sno 1",
  normalizeFileRows([file()]),
  [
    {
      doc_kind: "order_sheet",
      file_name: "po.pdf",
      storage_path: "abc/po.pdf",
      mime_type: "application/pdf",
      size_bytes: 1024,
      style_ref_no: null,
      sno: 1,
    },
  ],
);

check(
  "sno is renumbered from the SURVIVING index, not the input index",
  normalizeFileRows([
    file({ storage_path: "a/1.pdf" }),
    file({ storage_path: "" }), // dropped
    file({ storage_path: "a/3.pdf" }),
  ]).map((r) => [r.storage_path, r.sno]),
  [
    ["a/1.pdf", 1],
    ["a/3.pdf", 2],
  ],
);
refute(
  "…the dropped row does not leave a gap at 3",
  normalizeFileRows([
    file({ storage_path: "a/1.pdf" }),
    file({ storage_path: "" }),
    file({ storage_path: "a/3.pdf" }),
  ]).map((r) => r.sno),
  [1, 3],
);

// ---------------------------------------------------------------------------
// 2. `storage_path` IS THE IDENTITY — the rule that differs from every sibling
// ---------------------------------------------------------------------------

/*
 * A row with a kind and no path is NOT half-answered work. The upload happens
 * the moment the file is chosen and `storage_path` is what it returns, so no
 * path means the upload failed. Writing it puts a document in the grid that
 * resolves to nothing.
 */
check(
  "a row with a kind but no path is DROPPED",
  normalizeFileRows([file({ storage_path: null, file_name: null })]),
  [],
);
check(
  "…even when it carries a file name",
  normalizeFileRows([file({ storage_path: null, file_name: "po.pdf" })]),
  [],
);
check("a whitespace-only path is not a path", normalizeFileRows([file({ storage_path: "   " })]), []);

/*
 * THE SIBLING RULE, ASSERTED AS THE WRONG ANSWER. Every other normalizer in
 * `actions.ts` keeps a row if ANY field is filled. If someone tidies this one
 * into consistency with them, this vector is what fires.
 */
refute(
  "the any-field-filled rule its siblings use would keep this row",
  normalizeFileRows([file({ storage_path: null, file_name: "po.pdf" })]).length,
  1,
);

// ---------------------------------------------------------------------------
// 3. `doc_kind` is optional, because the operator picks it AFTER the upload
// ---------------------------------------------------------------------------

check(
  "a file with no kind yet is kept, with a null kind",
  normalizeFileRows([file({ doc_kind: null })]).map((r) => [r.storage_path, r.doc_kind]),
  [["abc/po.pdf", null]],
);
refute(
  "…a missing kind does not drop the row",
  normalizeFileRows([file({ doc_kind: null })]).length,
  0,
);

// ---------------------------------------------------------------------------
// 4. Cleaning
// ---------------------------------------------------------------------------

check(
  "blank strings become null, never empty strings",
  normalizeFileRows([file({ file_name: "  ", mime_type: "" })])[0],
  {
    doc_kind: "order_sheet",
    file_name: null,
    storage_path: "abc/po.pdf",
    mime_type: null,
    size_bytes: 1024,
    style_ref_no: null,
    sno: 1,
  },
);
check(
  "a path is trimmed, since it is the key a signed URL is minted from",
  normalizeFileRows([file({ storage_path: "  abc/po.pdf  " })])[0].storage_path,
  "abc/po.pdf",
);
check(
  "a missing size is null, not 0 — 0 would read as an empty file",
  normalizeFileRows([file({ size_bytes: undefined })])[0].size_bytes,
  null,
);
check("nothing in, nothing out", normalizeFileRows([]), []);

// ---------------------------------------------------------------------------
// 5. THE STYLE LINK (0479) — and the SECOND rule in this file that differs from
//    its siblings on purpose
//
// A document now belongs to a style line. The five per-style normalizers in
// `actions.ts` DROP a child whose style is not among the ones the save is
// writing. This one DEMOTES it: the reference is nulled and the row is kept.
//
// The asymmetry is about the bucket. A size whose style vanished is a size with
// no meaning. A file whose style ref was retyped still has an object in
// `garment-order-docs` that this row is the only reference to — dropping the
// row orphans those bytes with nothing left to reach or delete them by.
// Demoting keeps the document in the header's attachment corner, where it can
// be re-filed or removed properly.
//
// So the row COUNT never changes across this pass. That is what these vectors
// pin, because "make it consistent with normalizeStyleSizes" is the tidy-up
// that would silently start deleting documents.
// ---------------------------------------------------------------------------

const live = (...keys: string[]) => new Set(keys);

check(
  "a document under a live style survives, carrying its key",
  normalizeFileRows([file({ style_ref_no: "ST-1" })], live("ST-1")).map((r) => [
    r.style_ref_no,
    r.sno,
  ]),
  [["ST-1", 1]],
);

// THE ONE THAT MATTERS, and the one the siblings answer the other way.
check(
  "a document under a style this save is NOT writing is DEMOTED, not dropped",
  normalizeFileRows([file({ style_ref_no: "ST-GONE" })], live("ST-1")).map((r) => [
    r.style_ref_no,
    r.storage_path,
  ]),
  [[null, "abc/po.pdf"]],
);
refute(
  "the sibling rule — drop a child whose style is not live — would orphan its bucket object",
  normalizeFileRows([file({ style_ref_no: "ST-GONE" })], live("ST-1")).length,
  0,
);
check(
  "demotion never changes the row count, whatever the style list says",
  [
    normalizeFileRows([file({ style_ref_no: "ST-GONE" })], live("ST-1")).length,
    normalizeFileRows([file({ style_ref_no: "ST-GONE" })], live()).length,
    normalizeFileRows([file({ style_ref_no: "ST-1" })], live("ST-1")).length,
  ],
  [1, 1, 1],
);

check(
  "keys are compared case- and whitespace-insensitively, like styleKey()",
  normalizeFileRows([file({ style_ref_no: "  st-1  " })], live("ST-1")).map(
    (r) => r.style_ref_no,
  ),
  ["st-1"],
);
refute(
  "…so a case difference does not silently demote a document off its style",
  normalizeFileRows([file({ style_ref_no: "st-1" })], live("ST-1"))[0].style_ref_no,
  null,
);

// Every stored row today has a null style. It must pass through untouched.
check(
  "an ORDER-LEVEL document (no style) is untouched",
  normalizeFileRows([file({ style_ref_no: null })], live("ST-1")).map((r) => [
    r.style_ref_no,
    r.sno,
  ]),
  [[null, 1]],
);
check(
  "…and when the order has no styles at all",
  normalizeFileRows([file({ style_ref_no: null })], live()).map((r) => r.sno),
  [1],
);

// An ABSENT set is "do not resolve references"; an EMPTY set is "this order has
// no styles". Collapsing the two would demote every style-filed document the
// moment a caller forgot to pass the set.
check(
  "no set at all leaves every reference alone",
  normalizeFileRows([file({ style_ref_no: "ST-ANYTHING" })])[0].style_ref_no,
  "ST-ANYTHING",
);
check(
  "an EMPTY set is not the same answer — it demotes",
  normalizeFileRows([file({ style_ref_no: "ST-ANYTHING" })], live())[0].style_ref_no,
  null,
);

check(
  "sno is ONE sequence across the order, not one per style",
  normalizeFileRows(
    [
      file({ storage_path: "a/1.pdf", style_ref_no: "ST-1" }),
      file({ storage_path: "a/2.pdf", style_ref_no: "ST-2" }),
      file({ storage_path: "a/3.pdf", style_ref_no: null }),
    ],
    live("ST-1", "ST-2"),
  ).map((r) => r.sno),
  [1, 2, 3],
);

check(
  "a blank style ref is a null style, not a style named \"\"",
  normalizeFileRows([file({ style_ref_no: "   " })], live("ST-1"))[0]?.style_ref_no,
  null,
);

console.log(failed === 0 ? "\nOK — every amendment file vector holds." : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
