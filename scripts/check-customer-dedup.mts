/**
 * Vectors for the pure Order Info rules exported from
 * `lib/orders/amendments/types.ts` — the ones the SCREEN and the SERVER both
 * call, and which therefore cannot live in `actions.ts` (`"use server"`) or in
 * `service.ts` (`server-only`).
 *
 *   npm run check:customer-dedup
 *
 * **THE NAME IS NARROWER THAN THE CONTENTS, DELIBERATELY UNRENAMED.** It began
 * as the case-duplicate fold and grew two more rules that share the same home
 * and the same reason for having one. Three subjects, in order:
 *
 *   1. `caseFoldKey` / `collapseCaseDuplicates`  the Customer fold
 *   2. `merchandiserOptions`                     empty-and-explain
 *   3. `stylesMissingFiles` / `styleFileMessage` every style carries a document
 *
 * (3) is the one people look for elsewhere: it is a rule about FILES, so the
 * natural place to look is `check-amendment-files.mts`, which covers
 * `normalizeFileRows` instead — which rows get WRITTEN, as against which styles
 * are IN BREACH. That suite now carries a pointer here. Renaming this one was
 * considered and declined: the script name is referenced by `package.json`,
 * `tsconfig`'s exclude list and three lanes' notes, and a misnamed suite costs a
 * reader one redirect, where a misnamed *rule* would cost them a bug. Those are
 * not the same trade.
 *
 * ## WHY THE FOLD GETS A SUITE
 *
 * Because it HIDES REAL MASTER ROWS, and the way it goes wrong is silent.
 *
 * The client asked (2026-08-31) for the Customer dropdown to show one entry
 * where two rows differ only by capitalisation — "ROJA" and "roja". Those are
 * distinct `customers` rows with distinct uuids, so a fold picks a winner. If an
 * order already holds the LOSER, its Customer field renders empty — not wrong,
 * not flagged, blank — and the next save writes that blank over a perfectly good
 * FK. That is the silent data loss AGENTS.md's "Disabled rows" section exists to
 * prevent, arriving through a different door.
 *
 * So `heldId` is a required parameter and the first vector below is the one that
 * matters: the held row wins against every other preference, including against a
 * row that is more "correct" by each of the tie-breaks.
 *
 * Runs under `tsx` for `check-amendment-files.mts`'s reason: the module resolves
 * `@/lib/...` aliases at runtime and Node's ESM resolver does not read them.
 */
import {
  caseFoldKey,
  collapseCaseDuplicates,
  merchandiserOptions,
  styleFileMessage,
  stylesMissingFiles,
  type CaseFoldable,
  type MerchandiserLike,
} from "../lib/orders/amendments/types.ts";

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

const row = (
  id: string,
  name: string,
  over: Partial<CaseFoldable> = {},
): CaseFoldable => ({
  id,
  name,
  code: null,
  dedupe_key: caseFoldKey(name),
  inactive: false,
  ...over,
});

const ids = (r: { rows: CaseFoldable[] }) => r.rows.map((x) => x.id);

// ---------------------------------------------------------------------------
// 1. The key
// ---------------------------------------------------------------------------

check("case is folded", caseFoldKey("roja"), "ROJA");
check("whitespace is trimmed too — an invisible difference is still one", caseFoldKey("  ROJA "), "ROJA");
check("null is a key, not a crash", caseFoldKey(null), "");
check("undefined likewise", caseFoldKey(undefined), "");
check(
  "punctuation is NOT stripped — 'A-1' and 'A1' are two customers, not one",
  caseFoldKey("A-1") === caseFoldKey("A1"),
  false,
);

// ---------------------------------------------------------------------------
// 2. THE HELD ROW ALWAYS SURVIVES. This is the whole reason the rule is not in
//    the service: only the caller knows which uuid the record already holds.
// ---------------------------------------------------------------------------

const pair = [row("id-a", "ROJA"), row("id-b", "roja")];

check(
  "with nothing held, one entry comes back",
  ids(collapseCaseDuplicates(pair, null)).length,
  1,
);
check(
  "the held row wins even when it is the one the tie-break would drop",
  ids(collapseCaseDuplicates(pair, "id-b")),
  ["id-b"],
);
check(
  "…and when it is the one the tie-break would keep",
  ids(collapseCaseDuplicates(pair, "id-a")),
  ["id-a"],
);
check(
  "a held row that is SWITCHED OFF still wins — dropping it would blank the FK",
  ids(
    collapseCaseDuplicates(
      [row("id-a", "ROJA"), row("id-b", "roja", { inactive: true })],
      "id-b",
    ),
  ),
  ["id-b"],
);
check(
  "a held id that matches nothing changes nothing",
  ids(collapseCaseDuplicates(pair, "id-elsewhere")).length,
  1,
);

// ---------------------------------------------------------------------------
// 3. The preference order, when nothing is held
// ---------------------------------------------------------------------------

check(
  "an ACTIVE row beats a switched-off one, whichever order they arrive in",
  [
    ids(collapseCaseDuplicates([row("id-a", "ROJA", { inactive: true }), row("id-b", "roja")], null)),
    ids(collapseCaseDuplicates([row("id-b", "roja"), row("id-a", "ROJA", { inactive: true })], null)),
  ],
  [["id-b"], ["id-b"]],
);
check(
  "a CODED row beats an uncoded one",
  ids(collapseCaseDuplicates([row("id-a", "ROJA"), row("id-b", "roja", { code: "C1" })], null)),
  ["id-b"],
);
check(
  "a blank code is not a code",
  ids(collapseCaseDuplicates([row("id-a", "ROJA"), row("id-b", "roja", { code: "  " })], null)),
  ["id-a"],
);
check(
  "the last tie-break is the LOWEST id, and it does not depend on input order",
  [
    ids(collapseCaseDuplicates([row("id-b", "roja"), row("id-a", "ROJA")], null)),
    ids(collapseCaseDuplicates([row("id-a", "ROJA"), row("id-b", "roja")], null)),
  ],
  [["id-a"], ["id-a"]],
);

// ---------------------------------------------------------------------------
// 4. It only folds ACTUAL duplicates, and it says what it folded
// ---------------------------------------------------------------------------

check(
  "distinct customers are untouched, in the order they arrived",
  ids(
    collapseCaseDuplicates(
      [row("id-1", "ASMARA"), row("id-2", "OXBOW"), row("id-3", "ROJA")],
      null,
    ),
  ),
  ["id-1", "id-2", "id-3"],
);
check(
  "nothing folded, nothing reported",
  collapseCaseDuplicates([row("id-1", "ASMARA"), row("id-2", "OXBOW")], null).folded,
  [],
);
check(
  "a fold is REPORTED, so the operator can be told to merge the masters",
  collapseCaseDuplicates(pair, null).folded,
  ["ROJA"],
);
check(
  "three spellings of one name collapse to one, reported once",
  (() => {
    const r = collapseCaseDuplicates(
      [row("id-a", "ROJA"), row("id-b", "roja"), row("id-c", "Roja")],
      null,
    );
    return [r.rows.length, r.folded.length];
  })(),
  [1, 1],
);
check("nothing in, nothing out", collapseCaseDuplicates([], null), { rows: [], folded: [] });

// ---------------------------------------------------------------------------
// 5. `merchandiserOptions` — EMPTY-AND-EXPLAIN
//
// AGENTS.md, "Nominated vendors": empty-and-explain, never a fallback to the
// full list. Merchandiser is mandatory from 2026-08-31, so an empty list makes
// Order Entry UNSAVEABLE — and an empty dropdown reads as "nothing set up yet",
// which is a real and unremarkable answer. Without the hint the operator files
// "I cannot save orders" instead of "the merchandiser list is empty".
//
// Live catalog, measured 2026-08-31: `employees` holds ONE row whose designation
// is 'Test Designation', and no config_lookups row contains "merchandiser". So
// the "some employees, none of them merchandisers" branch is the one in force
// today, and the two messages must not be collapsed into one.
// ---------------------------------------------------------------------------

const emp = (
  id: string,
  is_merchandiser: boolean,
  over: Partial<MerchandiserLike> = {},
): MerchandiserLike => ({ id, name: id, is_merchandiser, inactive: false, ...over });

check(
  "only merchandisers are offered",
  merchandiserOptions([emp("m1", true), emp("e2", false)], null).items.map((r) => r.id),
  ["m1"],
);
check(
  "…with no hint, because the list is not empty",
  merchandiserOptions([emp("m1", true), emp("e2", false)], null).hint,
  null,
);

// THE FALLBACK THAT MUST NOT EXIST.
check(
  "employees but no merchandisers offers NOTHING, not everyone",
  merchandiserOptions([emp("e1", false), emp("e2", false)], null).items,
  [],
);
check(
  "…it does not fall back to the full list",
  merchandiserOptions([emp("e1", false), emp("e2", false)], null).items.length === 2,
  false,
);

// TWO EMPTINESSES, TWO MESSAGES. Telling an operator "no employees have been
// entered" when one has been sends them to fix something that is not broken.
const noneSetUp = merchandiserOptions([emp("e1", false)], null);
const noEmployees = merchandiserOptions([], null);
check("an empty list always explains itself", [!!noneSetUp.hint, !!noEmployees.hint], [true, true]);
check(
  "the two emptinesses say different things",
  noneSetUp.hint === noEmployees.hint,
  false,
);
check(
  "…and so do their compact forms",
  [noneSetUp.shortHint, noEmployees.shortHint],
  ["No merchandisers set up", "No employees entered"],
);

// NO MENU PATH IS NAMED — there is no registered Employee master row to name,
// and `check:nav-paths` would resolve one if it were written.
check(
  "no hint names a menu path",
  [noneSetUp.hint, noEmployees.hint].some((h) => (h ?? "").includes("▸")),
  false,
);

// THE HELD EMPLOYEE. Same rescue nominatedVendorOptions performs.
check(
  "an employee the order already names survives, even once they are not a merchandiser",
  merchandiserOptions([emp("m1", true), emp("was", false)], "was").items.map((r) => r.id),
  ["m1", "was"],
);
check(
  "…and even when they have been switched off",
  merchandiserOptions([emp("off", false, { inactive: true })], "off").items.map((r) => r.id),
  ["off"],
);
check(
  "the rescue clears the compact hint — a box with the held row in it is not empty",
  merchandiserOptions([emp("was", false)], "was").shortHint,
  null,
);
check(
  "…but keeps the paragraph, because the reason the OTHERS are missing still holds",
  !!merchandiserOptions([emp("was", false)], "was").hint,
  true,
);
check(
  "a held id that matches no employee cannot conjure a row",
  merchandiserOptions([emp("e1", false)], "gone").items,
  [],
);

// ---------------------------------------------------------------------------
// 6. `stylesMissingFiles` — the fourth enforcer
//
// The rule ("every style carries a document") lived only on the screen, where
// both halves decide a BUTTON STATE. `submit` is reachable without it, so the
// server action now calls this same predicate. AGENTS.md on the duplicate
// guard: "The screen check is a courtesy; this one is the guard."
//
// One predicate, three callers, for the reason the star/hold rule exists: a
// server stricter than the screen is a live Save button that fails, and a
// server looser than the screen is no rule at all.
// ---------------------------------------------------------------------------

const st = (style_ref_no: string | null) => ({ style_ref_no });
const doc = (style_ref_no: string | null, storage_path = "buck/et/a.pdf") => ({
  style_ref_no,
  storage_path,
});

check(
  "a style with a document is not reported",
  stylesMissingFiles([st("ST-1")], [doc("ST-1")]),
  [],
);
check(
  "a style with no document is reported, by its reference as typed",
  stylesMissingFiles([st("ST-1")], []),
  ["ST-1"],
);
check(
  "each missing style is named once, in order",
  stylesMissingFiles([st("ST-1"), st("ST-2"), st("ST-3")], [doc("ST-2")]),
  ["ST-1", "ST-3"],
);

// KEYED THROUGH styleKey's FOLD. Reporting a style as missing its document
// while the document sits on it is the worst failure available to a rule that
// blocks Save.
check(
  "a document attached under a differently-cased ref still counts",
  stylesMissingFiles([st("ST-1")], [doc("st-1")]),
  [],
);
check(
  "…and one with stray whitespace",
  stylesMissingFiles([st("ST-1")], [doc("  ST-1 ")]),
  [],
);

// AN ORDER-LEVEL DOCUMENT SATISFIES NOTHING. It belongs to the order, so
// counting it would let one upload clear the rule for every style at once.
check(
  "an order-level document does not satisfy a style",
  stylesMissingFiles([st("ST-1")], [doc(null)]),
  ["ST-1"],
);

// A FAILED UPLOAD IS NOT A DOCUMENT — the same test normalizeFileRows keys the
// whole table on. Counting it lets a style pass on an attachment that resolves
// to nothing when production clicks it.
check(
  "a row with no storage_path does not satisfy the rule",
  stylesMissingFiles([st("ST-1")], [doc("ST-1", "")]),
  ["ST-1"],
);
check(
  "…nor one whose path is only whitespace",
  stylesMissingFiles([st("ST-1")], [doc("ST-1", "   ")]),
  ["ST-1"],
);

// A LINE WITH NO REFERENCE HAS NOTHING TO ATTACH A FILE TO. Refusing the save
// over it would make a blank row somebody tabbed into an unsaveable order —
// the same abstention comboTreeProblem makes for a part that says nothing.
check(
  "a style with no reference is not reported",
  stylesMissingFiles([st(null), st("")], []),
  [],
);
check(
  "…and does not mask a real one beside it",
  stylesMissingFiles([st(null), st("ST-1")], []),
  ["ST-1"],
);

check("no styles, no problems", stylesMissingFiles([], []), []);

check(
  "the message names WHAT to attach, so a blocked Save is actionable",
  styleFileMessage("ST-1"),
  "ST-1: attach the tech pack, sketch or spec image for this style before saving.",
);

console.log(
  failed === 0 ? "\nOK — every customer dedup vector holds." : `\n${failed} FAILED`,
);
process.exit(failed === 0 ? 0 : 1);
