// Verification vectors for the T&A approvals merge — `taApprovalRowsToWrite`
// and `mergeTaApprovalCompletions` in lib/orders/amendments/types.ts (0537).
//
//     npm run check:ta-approval-merge
//
// Same reason `check-ta-merge.mts` exists, one table over: `actual_sent_date`,
// `actual_received_date`, `proof_path` and `status` are entered on the
// merchandiser board days or weeks after the order was saved, so a plain
// delete-and-reinsert on an unrelated edit would destroy them silently. Every
// vector below was watched to FAIL against a deliberate mutation of the
// implementation before being trusted.

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

const typed = (uid: string, approval: string | null): TaApprovalRowCore => ({
  row_uid: uid,
  approval_id: approval,
});

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
// A PP Sample already sent and approved three weeks ago, with a proof file on
// file. The operator reopens the order to fix something unrelated and saves.
// The sent/received record and the proof must still be there afterwards.

const APPROVALS_SAVED: SavedTaApprovalRow[] = [
  saved("uid-fit", "appr-fit"),
  saved("uid-pp", "appr-pp", {
    actual_sent_date: "2026-09-01",
    actual_received_date: "2026-09-04",
    proof_path: "garment-order-docs/pp-courier-slip.pdf",
    status: "received",
  }),
  saved("uid-trims", "appr-trims"),
];

const APPROVALS_TYPED: TaApprovalRowCore[] = [
  typed("uid-fit", "appr-fit"),
  typed("uid-pp", "appr-pp"),
  typed("uid-trims", "appr-trims"),
];

const resaved = mergeTaApprovalCompletions(
  taApprovalRowsToWrite(APPROVALS_TYPED, APPROVALS_SAVED),
  APPROVALS_SAVED,
  dates("2026-10-10", "2026-09-05", "2026-08-20"),
);

check(
  "a received approval survives an ordinary save, proof and all",
  resaved.find((r) => r.row_uid === "uid-pp"),
  {
    row_uid: "uid-pp",
    approval_id: "appr-pp",
    target_date: "2026-09-05",
    actual_sent_date: "2026-09-01",
    actual_received_date: "2026-09-04",
    proof_path: "garment-order-docs/pp-courier-slip.pdf",
    status: "received",
  },
);

check(
  "...and the approvals around it are untouched and still pending",
  resaved.filter((r) => r.status === "pending").map((r) => r.row_uid),
  ["uid-fit", "uid-trims"],
);

// =============================================================================
// A NEW ROW STARTS PENDING, NEVER NULL (0475's lesson, one table over)
// =============================================================================

check(
  "an approval with no saved counterpart starts pending with nothing recorded",
  mergeTaApprovalCompletions(
    [typed("uid-new", "appr-lapdip")],
    APPROVALS_SAVED,
    dates("2026-09-20"),
  ),
  [
    {
      row_uid: "uid-new",
      approval_id: "appr-lapdip",
      target_date: "2026-09-20",
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
    [typed("uid-x", null)],
    [{ ...saved("uid-x", null), status: null }],
    dates(null),
  )[0]!.status,
  "pending",
);

// =============================================================================
// A REMOVED APPROVAL TAKES ITS RECORD WITH IT — DELIBERATELY
// =============================================================================

check(
  "an approval the operator removed is gone, and nothing resurrects it",
  mergeTaApprovalCompletions(
    taApprovalRowsToWrite(
      [typed("uid-fit", "appr-fit"), typed("uid-trims", "appr-trims")],
      APPROVALS_SAVED,
    ),
    APPROVALS_SAVED,
    dates(null, null),
  ).map((r) => r.row_uid),
  ["uid-fit", "uid-trims"],
);

// =============================================================================
// AN EMPTY INCOMING LIST FALLS BACK TO THE SAVED LIST
// =============================================================================

check(
  "a payload that says nothing about approvals re-emits the stored list",
  taApprovalRowsToWrite([], APPROVALS_SAVED).map((r) => r.row_uid),
  ["uid-fit", "uid-pp", "uid-trims"],
);

check(
  "...and the received record on it survives that save too",
  mergeTaApprovalCompletions(
    taApprovalRowsToWrite([], APPROVALS_SAVED),
    APPROVALS_SAVED,
    dates(null, null, null),
  ).filter((r) => r.status === "received").length,
  1,
);

check(
  "a brand-new order with nothing on either side writes nothing",
  taApprovalRowsToWrite([], []),
  [],
);

// =============================================================================
// THE PP BRIDGE'S OWN DATE ARRIVES THROUGH THE SAME `targetDates` SLOT
// =============================================================================
// The caller (actions.ts) resolves PP Sample's date from the production
// ladder's PPAPPR step and every other approval's from approval-schedule.ts
// BEFORE calling this function — this merge does not know or care which
// engine produced which entry, it only carries dates across positionally.
// This vector exists so a future reader does not "simplify" the merge into
// something that special-cases PP Sample; it must never need to.

check(
  "the merge is indifferent to which engine produced a date — it only carries it",
  mergeTaApprovalCompletions(
    [typed("uid-pp", "appr-pp")],
    [],
    dates("2026-09-30"), // could equally be approval-schedule.ts's own answer
  )[0]!.target_date,
  "2026-09-30",
);

console.log(
  failed === 0 ? "\nAll T&A approval merge vectors passed." : `\n${failed} vector(s) FAILED.`,
);
process.exit(failed === 0 ? 0 : 1);
