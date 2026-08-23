/**
 * Vectors for `lib/orders/community/types.ts` — what the RE-Community stream
 * accepts as a message (0458, doc/file.md §4).
 *
 *   npx tsx scripts/check-order-community.mts
 *
 * ## WHY THIS SMALL FUNCTION HAS A SUITE
 *
 * Because both of its rules look like tidying and are not:
 *
 *  - **A file row with no `storage_path` is DROPPED.** The upload happens the
 *    moment the file is chosen, so a row with no path is a row whose upload
 *    FAILED. Keeping it puts an attachment in the stream that resolves to
 *    nothing when the cutting room clicks it looking for a marker PDF — months
 *    later, with no way left to tell what it was. `lib/orders/amendments/
 *    file-rows.ts` records the same rule for the same reason and has its own
 *    suite guarding it.
 *  - **Dropping those rows can empty the message, and the emptiness must be
 *    caught AFTER the filter, not before.** A post carrying one failed upload
 *    and no text has a non-empty `files` array on the way in and nothing at all
 *    on the way out. Checking `files.length` first accepts it, and the stream
 *    grows a blank row nobody wrote.
 *
 * A refusal carries the SENTENCE the screen prints, never `false` and never a
 * throw — so the vectors assert the WORDING too. A refusal whose text nobody
 * checked is a refusal that can silently become "Error".
 *
 * ## THE IMPORT IS THE `@/` ALIAS, NOT A RELATIVE `.ts` PATH
 *
 * Both idioms exist in `scripts/`, and only one of them is free. A relative
 * `"../lib/.../types.ts"` (what `check-amendment-files.mts` does) is a TS5097
 * under this project's tsconfig — `allowImportingTsExtensions` is off — so every
 * script written that way has had to be added to the `exclude` list in
 * `tsconfig.json`, which is now 25 entries long and is a shared file three lanes
 * would collide on. The alias form that `check-bom-explosion.mts` uses type
 * checks as part of the project, needs no exclusion, and `tsx` resolves it at
 * runtime (verified, not assumed). It also means these vectors are covered by
 * `tsc` rather than quietly exempt from it.
 */
import {
  messageContent,
  isRefusal,
  type PostMessageInput,
} from "@/lib/orders/community/types";

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
  if (JSON.stringify(actual) === JSON.stringify(forbidden)) {
    failed++;
    console.error(`FAIL  ${label}\n      must NOT be ${JSON.stringify(forbidden)}`);
  } else {
    console.log(`ok    ${label}`);
  }
}

type F = PostMessageInput["files"][number];

const file = (over: Partial<F> = {}): F => ({
  file_name: "marker.pdf",
  storage_path: "3f1c9e2a-0000-4000-8000-000000000001/marker.pdf",
  mime_type: "application/pdf",
  size_bytes: 12345,
  ...over,
});

const REFUSAL = "Type a message or attach a file.";

// ---------------------------------------------------------------------------
// 1. The ordinary cases
// ---------------------------------------------------------------------------
check(
  "text only — kept, trimmed",
  messageContent({ body: "  Fabric arrives Tuesday  ", files: [] }),
  { body: "Fabric arrives Tuesday", files: [] },
);

check(
  "file only, no text — a marker PDF posted with no comment is a message",
  messageContent({ body: null, files: [file()] }),
  { body: null, files: [file()] },
);

check("text and file together", messageContent({ body: "Marker v2", files: [file()] }), {
  body: "Marker v2",
  files: [file()],
});

// ---------------------------------------------------------------------------
// 2. The empty message
// ---------------------------------------------------------------------------
check("nothing at all is refused", messageContent({ body: null, files: [] }), {
  refused: REFUSAL,
});
check("whitespace is not text", messageContent({ body: "   \n  ", files: [] }), {
  refused: REFUSAL,
});
check("empty string is not text", messageContent({ body: "", files: [] }), {
  refused: REFUSAL,
});

// A blank body must never survive as "" — an empty-string row and a NULL row
// read the same on screen and sort differently in every query that filters on
// `body is null`.
const withFile = messageContent({ body: "   ", files: [file()] });
check("blank text beside a file becomes NULL, not \"\"", withFile, {
  body: null,
  files: [file()],
});

// ---------------------------------------------------------------------------
// 3. THE FAILED UPLOAD. This is what the suite is for.
// ---------------------------------------------------------------------------
check(
  "a file row with no storage_path is dropped — its upload failed",
  messageContent({ body: "See attached", files: [file({ storage_path: "" })] }),
  { body: "See attached", files: [] },
);

check(
  "a whitespace path is no path",
  messageContent({ body: "See attached", files: [file({ storage_path: "   " })] }),
  { body: "See attached", files: [] },
);

check(
  "the good rows of a mixed batch survive",
  messageContent({
    body: null,
    files: [file({ storage_path: "" }), file({ file_name: "b.pdf" })],
  }),
  { body: null, files: [file({ file_name: "b.pdf" })] },
);

// THE ORDERING VECTOR. One failed upload and no text: the input LOOKS like a
// message with an attachment and is nothing at all. An implementation that
// tests `files.length` before filtering accepts this and writes a blank row.
const onlyBroken = messageContent({ body: null, files: [file({ storage_path: "" })] });
check("a lone failed upload with no text is refused", onlyBroken, { refused: REFUSAL });
refute("...and is NOT accepted as an empty message", onlyBroken, { body: null, files: [] });

// ---------------------------------------------------------------------------
// 4. The refusal's shape
// ---------------------------------------------------------------------------
check("a refusal is recognised by isRefusal", isRefusal(onlyBroken), true);
check("a good result is not", isRefusal(withFile), false);
// Never `false`, never `null`, never a thrown error — house style, and the
// screen has nothing to print if the refusal carries no sentence.
refute("a refusal is not a bare false", onlyBroken, false);
refute("a refusal is not null", onlyBroken, null);
check(
  "the refusal carries the sentence the composer prints",
  isRefusal(onlyBroken) ? onlyBroken.refused : null,
  REFUSAL,
);

// ---------------------------------------------------------------------------
// 5. A missing `files` key is not an error — the composer omits it for text
// ---------------------------------------------------------------------------
check(
  "an absent files array behaves as empty",
  messageContent({ body: "hello" } as Pick<PostMessageInput, "body" | "files">),
  { body: "hello", files: [] },
);

console.log(failed === 0 ? "\nAll order-community vectors pass." : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
