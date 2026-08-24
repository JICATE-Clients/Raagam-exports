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

console.log(failed === 0 ? "\nOK — every amendment file vector holds." : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
