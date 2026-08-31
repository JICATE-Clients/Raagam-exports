// Verification vectors for the T&A merge — `taRowsToWrite` and
// `mergeTaCompletions` in lib/orders/amendments/types.ts (0481).
//
//     npm run check:ta-merge
//
// `tsx` rather than `--experimental-strip-types`, for the reason
// `check-bom-requirement.mts` gives: the module under test resolves `@/` alias
// imports.
//
// ## WHY THIS FILE EXISTS
//
// `writeChildren` deletes every child row of an amendment and reinserts. For
// `garment_order_amendment_ta_activities` that is not lossless: `actual_date`,
// `status` and `notes` are entered on the T&A DASHBOARD, days or weeks after the
// order was saved. So an operator reopening the order to fix a typo in Pay Terms
// and pressing Save would destroy every completion record on it — silently, with
// no error, because deleting a child grid and writing it back is the ordinary
// thing that writer does.
//
// That is not hypothetical. AGENTS.md and the Material Attribute post-mortem
// record it happening: "BOTH writers replaced child grids wholesale over an ON
// DELETE SET NULL FK; 12/12 lines + 10 answers destroyed and unrecoverable."
//
// A MERGE THAT IS MERELY WRITTEN IS NOT A MERGE THAT IS KNOWN TO WORK. A server
// action cannot be vectored — it needs a Supabase client, a session and a
// database — so the two decisions live in `types.ts` as pure functions and this
// file proves them. `actions.ts` supplies only what a server can: the saved rows
// and the dates.
//
// Every vector below was watched to FAIL against a deliberate mutation before
// being trusted, which is this repo's standing rule: "`0 findings` prints
// identically whether a check inspected the file or returned early."

import {
  taRowsToWrite,
  mergeTaCompletions,
  type SavedTaRow,
  type TaRowCore,
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

/** A row as the payload types it — no completion columns; the input has none. */
const typed = (uid: string, sno: number, activity: string | null, days: number | null): TaRowCore => ({
  row_uid: uid,
  sno,
  activity_id: activity,
  days_required: days,
});

/** A row as it comes back out of the database, with whatever was recorded. */
const saved = (
  uid: string,
  sno: number,
  activity: string | null,
  days: number | null,
  completion: Partial<Pick<SavedTaRow, "actual_date" | "status" | "notes">> = {},
): SavedTaRow => ({
  ...typed(uid, sno, activity, days),
  actual_date: null,
  status: "pending",
  notes: null,
  ...completion,
});

const dates = (...d: (string | null)[]) => d;

// =============================================================================
// THE VECTOR THIS FILE WAS WRITTEN FOR
// =============================================================================
// An order whose Knitting step was ticked done three weeks ago. The operator
// reopens the order, changes nothing about T&A, and saves. The completion must
// still be there afterwards.

const LADDER_SAVED: SavedTaRow[] = [
  saved("uid-fabric", 1, "act-fabric", 2),
  saved("uid-knit", 2, "act-knit", 5, {
    actual_date: "2026-09-14",
    status: "done",
    notes: "GREIGE IN ON TIME",
  }),
  saved("uid-ship", 3, "act-ship", 1),
];

const LADDER_TYPED: TaRowCore[] = [
  typed("uid-fabric", 1, "act-fabric", 2),
  typed("uid-knit", 2, "act-knit", 5),
  typed("uid-ship", 3, "act-ship", 1),
];

const resaved = mergeTaCompletions(
  taRowsToWrite(LADDER_TYPED, LADDER_SAVED),
  LADDER_SAVED,
  dates("2026-10-01", "2026-10-06", "2026-10-09"),
);

check(
  "A COMPLETION SURVIVES AN ORDINARY SAVE — the whole point of the anchor",
  resaved.find((r) => r.row_uid === "uid-knit"),
  {
    row_uid: "uid-knit",
    sno: 2,
    activity_id: "act-knit",
    days_required: 5,
    target_date: "2026-10-06",
    actual_date: "2026-09-14",
    status: "done",
    notes: "GREIGE IN ON TIME",
  },
);

check(
  "...and the steps around it are untouched and still pending",
  resaved.filter((r) => r.status === "pending").map((r) => r.row_uid),
  ["uid-fabric", "uid-ship"],
);

// THE ANCHOR IS THE ONLY THING THAT MATCHES. `id` is re-minted by the reinsert
// and `sno` is renumbered by the normalizer, so a merge keyed on either would
// pair the wrong completion to the wrong step — which is worse than losing it,
// because a wrong date on a T&A ladder reads exactly like a right one.
const REORDERED: TaRowCore[] = [
  typed("uid-knit", 1, "act-knit", 5),
  typed("uid-fabric", 2, "act-fabric", 2),
  typed("uid-ship", 3, "act-ship", 1),
];
check(
  "a step moved up the ladder keeps ITS OWN completion, not its position's",
  mergeTaCompletions(
    taRowsToWrite(REORDERED, LADDER_SAVED),
    LADDER_SAVED,
    dates(null, null, null),
  ).map((r) => `${r.sno}:${r.row_uid}:${r.status}`),
  ["1:uid-knit:done", "2:uid-fabric:pending", "3:uid-ship:pending"],
);

// The Days edit an operator actually came to make. It lands; the completion
// beside it does not move.
check(
  "editing Days on a completed step changes the days and nothing else",
  mergeTaCompletions(
    taRowsToWrite(
      [typed("uid-knit", 1, "act-knit", 7)],
      [LADDER_SAVED[1]!],
    ),
    [LADDER_SAVED[1]!],
    dates("2026-10-02"),
  ),
  [
    {
      row_uid: "uid-knit",
      sno: 1,
      activity_id: "act-knit",
      days_required: 7,
      target_date: "2026-10-02",
      actual_date: "2026-09-14",
      status: "done",
      notes: "GREIGE IN ON TIME",
    },
  ],
);

// =============================================================================
// A NEW ROW, AND THE 0475 LESSON
// =============================================================================
// The column is `not null default 'pending'`, and a default applies ONLY when
// the INSERT omits the column. This writer names it on every row, so without the
// coalesce a brand-new step would arrive as an explicit NULL and violate
// not-null — failing the whole save, not defaulting quietly.

check(
  "a step with no saved counterpart starts at pending with nothing recorded",
  mergeTaCompletions([typed("uid-new", 1, "act-cut", 3)], LADDER_SAVED, dates("2026-10-03")),
  [
    {
      row_uid: "uid-new",
      sno: 1,
      activity_id: "act-cut",
      days_required: 3,
      target_date: "2026-10-03",
      actual_date: null,
      status: "pending",
      notes: null,
    },
  ],
);

check(
  "status is never null, so the not-null column can never be violated",
  mergeTaCompletions(
    [typed("uid-x", 1, null, null)],
    // A row read back with a null status is not a shape Postgres can produce —
    // the column is not-null — but the type permits it, and the coalesce is what
    // makes that unreachable branch harmless rather than a 23502 on save.
    [{ ...saved("uid-x", 1, null, null), status: null }],
    dates(null),
  )[0]!.status,
  "pending",
);

// =============================================================================
// A DELETED STEP TAKES ITS COMPLETION WITH IT — DELIBERATELY
// =============================================================================
// This is the one case where a completion is lost, and it must be: removing a
// row from the ladder is a deliberate act ON the ladder, not a side effect of
// saving something else. That distinction is the entire rule.

check(
  "a step the operator removed is gone, and nothing resurrects it",
  mergeTaCompletions(
    taRowsToWrite(
      [typed("uid-fabric", 1, "act-fabric", 2), typed("uid-ship", 2, "act-ship", 1)],
      LADDER_SAVED,
    ),
    LADDER_SAVED,
    dates(null, null),
  ).map((r) => r.row_uid),
  ["uid-fabric", "uid-ship"],
);

// =============================================================================
// AN EMPTY INCOMING LIST FALLS BACK TO THE SAVED LADDER
// =============================================================================
// `ta_activities` defaults to `[]` in the Zod input, so ANY payload that does
// not know about this tab arrives with an empty list — a stale client, a `curl`,
// a caller written before today. Under a plain delete-and-reinsert that would
// empty the table and take every completion with it, which is the disaster the
// anchor exists to prevent. So an empty list means "this save says nothing about
// the ladder", not "delete the ladder".

check(
  "a payload that says nothing about T&A re-emits the stored ladder",
  taRowsToWrite([], LADDER_SAVED).map((r) => `${r.sno}:${r.row_uid}`),
  ["1:uid-fabric", "2:uid-knit", "3:uid-ship"],
);

check(
  "...and the completions on it survive that save too",
  mergeTaCompletions(
    taRowsToWrite([], LADDER_SAVED),
    LADDER_SAVED,
    dates("2026-10-01", "2026-10-06", "2026-10-09"),
  ).filter((r) => r.status === "done").length,
  1,
);

check(
  "a brand-new order with nothing on either side writes nothing",
  taRowsToWrite([], []),
  [],
);

// =============================================================================
// `sno` IS DENSE, AND THE SAVED ORDER IS NOT RE-SORTED
// =============================================================================

check(
  "sno is renumbered 1..n whatever the payload sent",
  taRowsToWrite(
    [typed("uid-a", 7, "act-a", 1), typed("uid-b", 7, "act-b", 1), typed("uid-c", 99, "act-c", 1)],
    [],
  ).map((r) => r.sno),
  [1, 2, 3],
);

// THE LADDER IS THE OPERATOR'S SEQUENCE. `taRowsToWrite` re-emits the saved rows
// in the order it is GIVEN them — it never sorts — because a function that
// re-ordered a ladder would move dates nobody edited. `actions.ts` sorts by
// `sno` before calling it, since PostgREST makes no ordering promise; this
// asserts that the pure half does not sort behind that caller's back.
check(
  "the saved ladder is re-emitted in the order it was handed over, not sorted",
  taRowsToWrite(
    [],
    [saved("uid-ship", 3, "act-ship", 1), saved("uid-fabric", 1, "act-fabric", 2)],
  ).map((r) => r.row_uid),
  ["uid-ship", "uid-fabric"],
);

// =============================================================================
// A REFUSED LADDER DATES NOTHING — AND SINCE 2026-08-31 THIS IS THE ORDINARY
// PATH, NOT THE DRAFT PATH
// =============================================================================
// `actions.ts` passes all-null dates when `orderTaLadder` refused. That used to
// reach the merge only on a DRAFT, because a real save returned the refusal
// instead of writing — so the non-draft refusal was unreachable BY CONSTRUCTION
// and these vectors did not cover it.
//
// The client then made the T&A tab optional ("make it optional now will
// implement it later as required"), the server gate came out, and the
// previously-unreachable state became the everyday one. **A vector suite whose
// coverage was bounded by a guard has a hole the moment the guard moves**, and
// the hole is silent: every existing vector still passed.
//
// So `is_draft` is deliberately absent from these names now. It no longer
// discriminates anything here, and a vector named after a distinction the code
// has stopped drawing is a vector that will be read as proving one.
//
// What must NOT happen, on either path, is a date invented to fill the column.

check(
  "a refused ladder stores no dates, and no completion is lost (draft or not)",
  mergeTaCompletions(
    taRowsToWrite(LADDER_TYPED, LADDER_SAVED),
    LADDER_SAVED,
    dates(null, null, null),
  ).map((r) => `${r.target_date}|${r.status}`),
  ["null|pending", "null|done", "null|pending"],
);

// THE PATH THE REVERSAL CREATED. An ordinary save of a ladder nobody finished:
// the rows persist, undated, and the operator's Days and activities are kept
// exactly as typed. Before 2026-08-31 this save was rejected outright, so
// nothing was written at all — the difference this vector pins down.
check(
  "an unfinished ladder still SAVES its rows, undated, with the typed values intact",
  mergeTaCompletions(
    taRowsToWrite(
      [
        typed("uid-fabric", 1, "act-fabric", 2),
        typed("uid-knit", 2, "act-knit", null), // the box nobody filled in
        typed("uid-ship", 3, "act-ship", 1),
      ],
      LADDER_SAVED,
    ),
    LADDER_SAVED,
    dates(null, null, null),
  ),
  [
    { row_uid: "uid-fabric", sno: 1, activity_id: "act-fabric", days_required: 2,
      target_date: null, actual_date: null, status: "pending", notes: null },
    { row_uid: "uid-knit", sno: 2, activity_id: "act-knit", days_required: null,
      target_date: null, actual_date: "2026-09-14", status: "done",
      notes: "GREIGE IN ON TIME" },
    { row_uid: "uid-ship", sno: 3, activity_id: "act-ship", days_required: 1,
      target_date: null, actual_date: null, status: "pending", notes: null },
  ],
);

// AND THE UNDATING IS NOT DESTRUCTIVE OF THE COMPLETION. A step already ticked
// done on the dashboard keeps its `actual_date` even though the ladder around it
// can no longer be dated — the two are independent, and losing the second
// because the first is unresolvable would be the original bug wearing a new hat.
check(
  "a completion outlives its own row losing its target date",
  mergeTaCompletions(taRowsToWrite(LADDER_TYPED, LADDER_SAVED), LADDER_SAVED, dates(null, null, null))
    .filter((r) => r.actual_date !== null)
    .map((r) => `${r.row_uid}:${r.actual_date}:${r.target_date}`),
  ["uid-knit:2026-09-14:null"],
);

check(
  "a short date list leaves the rest undated rather than shifting them",
  mergeTaCompletions(LADDER_TYPED, LADDER_SAVED, dates("2026-10-01")).map((r) => r.target_date),
  ["2026-10-01", null, null],
);

console.log(
  failed === 0 ? "\nAll T&A merge vectors passed." : `\n${failed} vector(s) FAILED.`,
);
process.exit(failed === 0 ? 0 : 1);
