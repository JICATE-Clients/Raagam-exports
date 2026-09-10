// Verification vectors for the T&A Approvals tracker merge —
// `taApprovalRowsToWrite` and `mergeTaApprovalCompletions` in
// lib/orders/amendments/types.ts.
//
//     npm run check:ta-approval-merge
//
// `tsx` rather than `--experimental-strip-types`, for the reason
// `check-bom-requirement.mts` gives: the module under test resolves `@/` alias
// imports.
//
// ## WHY THIS FILE EXISTS
//
// Same reason `check-ta-merge.mts` exists for `ta_activities`, one table over:
// `writeChildren` deletes every child row of an amendment and reinserts. For
// `garment_order_amendment_ta_approvals` that is not lossless —
// `actual_sent_date`, `actual_received_date`, `proof_path` and `status` are
// entered on the merchandiser board (`/orders/ta-followup`), days
// or weeks after the order was saved. An operator reopening the order to fix
// a typo and pressing Save must not destroy every dispatch/approval record on
// it — silently, with no error, because deleting a child grid and writing it
// back is the ordinary thing this writer does.
//
// A MERGE THAT IS MERELY WRITTEN IS NOT A MERGE THAT IS KNOWN TO WORK. A
// server action cannot be vectored — it needs a Supabase client, a session
// and a database — so the two decisions live in `types.ts` as pure functions
// and this file proves them. `actions.ts` (`taApprovalRows`) supplies only
// what a server can: the saved rows and the dates.
//
// Every vector below was watched to FAIL against a deliberate mutation before
// being trusted, which is this repo's standing rule: "`0 findings` prints
// identically whether a check inspected the file or returned early."

import {
  taApprovalRowsToWrite,
  mergeTaApprovalCompletions,
  type SavedTaApprovalRow,
  type TaApprovalRowCore,
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
const typed = (uid: string, approval: string | null): TaApprovalRowCore => ({
  row_uid: uid,
  approval_id: approval,
});

/** A row as it comes back out of the database, with whatever was recorded. */
const saved = (
  uid: string,
  approval: string | null,
  completion: Partial<
    Pick<SavedTaApprovalRow, "actual_sent_date" | "actual_received_date" | "proof_path" | "status">
  > = {},
): SavedTaApprovalRow => ({
  ...typed(uid, approval),
  actual_sent_date: null,
  actual_received_date: null,
  proof_path: null,
  status: "pending",
  ...completion,
});

const dates = (...d: (string | null)[]) => d;

// =============================================================================
// THE VECTOR THIS FILE WAS WRITTEN FOR
// =============================================================================
// An order whose Lab Dip was marked Sent on the merchandiser board a week ago.
// The operator reopens the order, changes nothing about Approvals, and saves.
// The dispatch record must still be there afterwards.

const TRACKER_SAVED: SavedTaApprovalRow[] = [
  saved("uid-fit", "appr-fit"),
  saved("uid-labdip", "appr-labdip", {
    actual_sent_date: "2026-09-01",
    proof_path: "amend-1/appr-labdip/slip.pdf",
    status: "sent",
  }),
  saved("uid-pp", "appr-pp"),
];

const TRACKER_TYPED: TaApprovalRowCore[] = [
  typed("uid-fit", "appr-fit"),
  typed("uid-labdip", "appr-labdip"),
  typed("uid-pp", "appr-pp"),
];

const resaved = mergeTaApprovalCompletions(
  taApprovalRowsToWrite(TRACKER_TYPED, TRACKER_SAVED),
  TRACKER_SAVED,
  dates("2026-09-05", "2026-09-06", "2026-09-10"),
);

check(
  "a dispatch record survives an ordinary save — the whole point of the anchor",
  resaved.find((r) => r.row_uid === "uid-labdip"),
  {
    row_uid: "uid-labdip",
    approval_id: "appr-labdip",
    target_date: "2026-09-06",
    actual_sent_date: "2026-09-01",
    actual_received_date: null,
    proof_path: "amend-1/appr-labdip/slip.pdf",
    status: "sent",
  },
);

check(
  "...and the approvals around it are untouched and still pending",
  resaved.filter((r) => r.status === "pending").map((r) => r.row_uid),
  ["uid-fit", "uid-pp"],
);

// THE ANCHOR IS THE ONLY THING THAT MATCHES. `id` is re-minted by the
// reinsert and there is no `sno` to renumber — a merge keyed on row order
// would pair the wrong dispatch to the wrong approval, which is worse than
// losing it, because a wrong proof file on an approval reads exactly like a
// right one.
const REORDERED: TaApprovalRowCore[] = [
  typed("uid-labdip", "appr-labdip"),
  typed("uid-fit", "appr-fit"),
  typed("uid-pp", "appr-pp"),
];
check(
  "an approval reordered on the grid keeps ITS OWN dispatch record, not its position's",
  mergeTaApprovalCompletions(
    taApprovalRowsToWrite(REORDERED, TRACKER_SAVED),
    TRACKER_SAVED,
    dates(null, null, null),
  ).map((r) => `${r.row_uid}:${r.status}`),
  ["uid-labdip:sent", "uid-fit:pending", "uid-pp:pending"],
);

// =============================================================================
// A NEW ROW, AND THE 0475 LESSON
// =============================================================================
// The column is `not null default 'pending'`, and a default applies ONLY when
// the INSERT omits the column. This writer names it on every row, so without
// the coalesce a brand-new approval would arrive as an explicit NULL and
// violate not-null — failing the whole save, not defaulting quietly.

check(
  "an approval with no saved counterpart starts at pending with nothing recorded",
  mergeTaApprovalCompletions([typed("uid-new", "appr-trims")], TRACKER_SAVED, dates("2026-09-12")),
  [
    {
      row_uid: "uid-new",
      approval_id: "appr-trims",
      target_date: "2026-09-12",
      actual_sent_date: null,
      actual_received_date: null,
      proof_path: null,
      status: "pending",
    },
  ],
);

check(
  "status is never null, so the not-null column can never be violated",
  mergeTaApprovalCompletions(
    [typed("uid-x", "appr-x")],
    // A row read back with a null status is not a shape Postgres can
    // produce — the column is not-null — but the type permits it, and the
    // coalesce is what makes that unreachable branch harmless rather than a
    // 23502 on save.
    [{ ...saved("uid-x", "appr-x"), status: null }],
    dates(null),
  )[0]!.status,
  "pending",
);

// =============================================================================
// A DELETED APPROVAL TAKES ITS DISPATCH RECORD WITH IT — DELIBERATELY
// =============================================================================
// This is the one case where a record is lost, and it must be: removing a
// row from the tracker is a deliberate act ON the tracker, not a side effect
// of saving something else. That distinction is the entire rule.

check(
  "an approval the operator removed is gone, and nothing resurrects it",
  mergeTaApprovalCompletions(
    taApprovalRowsToWrite(
      [typed("uid-fit", "appr-fit"), typed("uid-pp", "appr-pp")],
      TRACKER_SAVED,
    ),
    TRACKER_SAVED,
    dates(null, null),
  ).map((r) => r.row_uid),
  ["uid-fit", "uid-pp"],
);

// =============================================================================
// AN EMPTY INCOMING LIST FALLS BACK TO THE SAVED TRACKER
// =============================================================================
// `ta_approvals` defaults to `[]` in the Zod input, so ANY payload that does
// not know about this grid arrives with an empty list — a stale client, a
// `curl`, a caller written before today. Under a plain delete-and-reinsert
// that would empty the table and take every dispatch/approval record with
// it, which is the disaster the anchor exists to prevent. So an empty list
// means "this save says nothing about Approvals", not "delete them all".

check(
  "a payload that says nothing about Approvals re-emits the stored tracker",
  taApprovalRowsToWrite([], TRACKER_SAVED).map((r) => r.row_uid),
  ["uid-fit", "uid-labdip", "uid-pp"],
);

check(
  "...and the dispatch already logged survives that save too",
  mergeTaApprovalCompletions(
    taApprovalRowsToWrite([], TRACKER_SAVED),
    TRACKER_SAVED,
    dates("2026-09-05", "2026-09-06", "2026-09-10"),
  ).filter((r) => r.status === "sent").length,
  1,
);

check(
  "a brand-new order with nothing on either side writes nothing",
  taApprovalRowsToWrite([], []),
  [],
);

// =============================================================================
// A SHORT DATE LIST LEAVES THE REST UNDATED RATHER THAN SHIFTING THEM
// =============================================================================
// Index-for-index with `rows`, same contract `mergeTaCompletions` states —
// `computeApprovalSchedule` never refuses, but a caller handing over fewer
// dates than rows (a malformed intermediate state) must not silently shift
// dates onto the wrong approval.

check(
  "a short date list leaves the rest undated rather than shifting them",
  mergeTaApprovalCompletions(TRACKER_TYPED, TRACKER_SAVED, dates("2026-09-05")).map(
    (r) => r.target_date,
  ),
  ["2026-09-05", null, null],
);

// AND AN UNDATED ROW IS NOT DESTRUCTIVE OF ITS COMPLETION. An approval
// already marked Sent on the worklist keeps its dispatch even though this
// save could not date it — the two are independent, and losing the second
// because the first has no date would be the original bug wearing a new hat.
check(
  "a dispatch record outlives its own row losing its target date",
  mergeTaApprovalCompletions(TRACKER_TYPED, TRACKER_SAVED, dates(null, null, null))
    .filter((r) => r.actual_sent_date !== null)
    .map((r) => `${r.row_uid}:${r.actual_sent_date}:${r.target_date}`),
  ["uid-labdip:2026-09-01:null"],
);

console.log(
  failed === 0 ? "\nAll T&A Approvals merge vectors passed." : `\n${failed} vector(s) FAILED.`,
);
process.exit(failed === 0 ? 0 : 1);
