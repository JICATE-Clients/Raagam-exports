/**
 * Material BOM — material sent out for processing, and what came back.
 *
 * The client's case is a greige button: bought plain, sent to a dyer to be
 * matched to the garment colour, and production-ready only once it returns. The
 * Processes child (`0265`, `0418`) records that trip. This file is the rule for
 * reading it.
 *
 * ## THE GATE IS THE REQUIREMENT, NOT `qty_out`
 *
 * "Has everything come back?" is the obvious question and the wrong one. Every
 * mainstream ERP treats a short return as a PARTIAL RECEIPT that leaves the
 * order open — SAP carries an explicit under-delivery tolerance and marks the
 * order `PDLV` rather than stopping it; ERPNext simply consumes less. In this
 * trade dye loss and shrinkage are normal, expected and estimated rather than
 * measured, so a rule that halted a line over a 6% loss would halt every line.
 *
 * The question that actually decides anything is **does what came back still
 * cover the order?** — and this module already knows that number, because
 * `material_bom_amendment_requirements.required_qty` is stored per line and is
 * what `lib/purchase/bom-ceiling-service.ts` reads to cap a purchase order.
 *
 * That distinction is not academic. Every BOM line carries a Wastage %, and
 * that buffer IS the money spent to absorb this loss:
 *
 *     required 940, sent 1,000, back 960  ->  covered. Nothing to report.
 *     required 990, sent 1,000, back 960  ->  short by 30. Buy the difference.
 *
 * Same arithmetic, opposite verdicts, and a `qty_in < qty_out` test calls both
 * of them a shortage. The first alarm is the expensive one: it is raised on
 * every ordinary job, so it teaches the operator to ignore the column.
 *
 * This is `bom-ceiling-service.ts` run backwards — the ceiling asks whether a
 * PO is buying MORE than the requirement, this asks whether processing left us
 * with LESS — which is why the two belong beside each other and not in
 * `lib/stores/`.
 *
 * ## NOTHING HERE BLOCKS AN ISSUE
 *
 * `issuable` is what came back, always. A shortfall is stated, costed and left
 * on screen; it never becomes a refusal to release the 960 buttons that did
 * arrive. Blocking would stop a production line to protect a number the wastage
 * buffer was already bought to cover.
 *
 * ## THE ONE-YEAR CLOCK IS THE EXPENSIVE FAILURE, AND IT IS NOT OURS
 *
 * Sending goods to a processor is JOB WORK under s.143 of the CGST Act. Rule 55
 * makes a delivery challan mandatory for the movement, those challans are
 * reported quarterly in Form ITC-04, and the liability to file sits with the
 * PRINCIPAL — us, not the dyer. Inputs must return within ONE YEAR or the
 * original movement is retrospectively a deemed supply: tax owed on buttons
 * that only went out to be coloured.
 *
 * So a row that is merely late is a bigger number than a row that is short, and
 * `jobWorkAgeing` exists for that reason alone. It is the half a merchandiser
 * cannot see by looking at quantities.
 *
 * ## NULL IS AN ANSWER. 0 IS NOT.
 *
 * `requirement.ts` records this rule and it holds here with the same force: a
 * shortfall of 0 and an unanswerable shortfall must never render alike. Every
 * branch that cannot answer returns a `Refusal` carrying the SENTENCE the
 * screen prints.
 */

import { isRefusal, type Refusal } from "@/lib/orders/material-bom/requirement";

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/**
 * A Processes row, as much of it as the verdict needs.
 *
 * `sent_on` is the DISPATCH date and the only thing the one-year clock can run
 * from. It is nullable because every row written before it existed has no such
 * date — and a missing date makes the row unageable, never overdue. Guessing
 * one from `created_at` would start a statutory clock from the day a
 * merchandiser opened a form.
 */
export type ProcessReturn = {
  qty_out: number | null;
  qty_in: number | null;
  sent_on: string | null;
};

/**
 * What a Processes row amounts to.
 *
 * `planned` is a first-class state, not a refusal: a row naming a process and a
 * vendor with nothing sent yet is exactly how this grid is filled in.
 */
export type ProcessVerdict =
  | { state: "planned" }
  | { state: "covered"; issuable: number; atVendor: number }
  | { state: "short"; issuable: number; atVendor: number; shortfall: number };

/**
 * Read one Processes row against the requirement its item has to satisfy.
 *
 * `requiredQty` is the SUM of the stored requirement rows for this item — the
 * same `byItem` roll-up `bomCeilingForOrder` builds, and it must be summed the
 * same way. Passing one basis slice's figure instead would compare a whole
 * return against a fraction of the need and report every job as covered.
 */
export function processVerdict(
  row: ProcessReturn,
  requiredQty: number | null,
): ProcessVerdict | Refusal {
  const out = num(row.qty_out);
  const back = num(row.qty_in);

  // A row with nothing sent is a plan. Note this is tested before the
  // requirement is: an operator lists the processing a style needs long before
  // the Requirement tab has been computed, and refusing here would paint the
  // whole grid red on a screen that is being filled in correctly.
  if (out == null || out === 0) {
    if (back != null && back > 0) {
      return { refused: "Material has come back that was never recorded as sent" };
    }
    return { state: "planned" };
  }

  if (out < 0) return { refused: "Sent quantity cannot be negative" };
  if (back != null && back < 0) return { refused: "Received quantity cannot be negative" };

  // MORE BACK THAN WENT OUT is not a generous vendor, it is a typo or a mixed-up
  // item — and it would make `atVendor` negative, which reads as a credit.
  if (back != null && back > out) {
    return { refused: "More has come back than went out — check the quantities" };
  }

  const received = back ?? 0;
  const atVendor = out - received;

  // The requirement is only needed once something is actually out, which is why
  // this sits below the `planned` branch rather than at the top.
  const need = num(requiredQty);
  if (need == null) {
    return { refused: "No stored requirement for this material yet — open the Requirement tab" };
  }

  // ISSUABLE IS WHAT CAME BACK, in every branch. See the header.
  if (received >= need) return { state: "covered", issuable: received, atVendor };
  return { state: "short", issuable: received, atVendor, shortfall: need - received };
}

// ---------------------------------------------------------------------------
// The one-year clock (CGST s.143 / Rule 55 / ITC-04)
// ---------------------------------------------------------------------------

/** Where a job-work movement stands against its statutory return deadline. */
export type Ageing =
  | { state: "unageable" }
  | { state: "ok"; dueOn: string; daysLeft: number }
  | { state: "due"; dueOn: string; daysLeft: number }
  | { state: "overdue"; dueOn: string; daysOver: number };

/**
 * One year from dispatch, as an ISO `YYYY-MM-DD` string.
 *
 * ISO AND NOT `fmtDate`, deliberately. AGENTS.md's Dates rule says DD/MM/YYYY
 * is what an operator reads and `fmtDate` owns it — and names the exception
 * this is: a value COMPARED against dates and fed back into queries stays ISO.
 * The screen formats it at the point it prints it.
 *
 * `setUTCFullYear` rather than adding 365 days, so a leap year does not shift
 * the deadline by a day. 29 February + 1 year lands on 1 March, which is what
 * date arithmetic that cannot represent the day is expected to do.
 */
export function jobWorkDeadline(sentOn: string): string | null {
  const d = new Date(`${sentOn}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCFullYear(d.getUTCFullYear() + 1);
  return d.toISOString().slice(0, 10);
}

const DAY = 86_400_000;

/**
 * How close a movement is to becoming a deemed supply.
 *
 * `today` is PASSED IN rather than read from the clock, for the reason
 * `lib/dashboard/range.ts` keeps its own `today()`: a function that reads the
 * clock cannot be given vectors, and this one is asserted in
 * `scripts/check-process-return.mts`.
 *
 * A row still at the vendor is the only one worth ageing — material already
 * back has satisfied s.143 whatever its dates say — so the caller passes
 * `atVendor`, and a returned job resolves to `unageable` rather than to a
 * warning nobody can act on.
 */
export function jobWorkAgeing(
  sentOn: string | null,
  atVendor: number,
  today: string,
  warnDays: number,
): Ageing {
  if (!sentOn || atVendor <= 0) return { state: "unageable" };

  const dueOn = jobWorkDeadline(sentOn);
  if (!dueOn) return { state: "unageable" };

  const due = new Date(`${dueOn}T00:00:00Z`).getTime();
  const now = new Date(`${today}T00:00:00Z`).getTime();
  if (Number.isNaN(due) || Number.isNaN(now)) return { state: "unageable" };

  const days = Math.round((due - now) / DAY);
  if (days < 0) return { state: "overdue", dueOn, daysOver: -days };
  if (days <= warnDays) return { state: "due", dueOn, daysLeft: days };
  return { state: "ok", dueOn, daysLeft: days };
}

/** Re-exported so a caller reading a verdict needs one import, not two. */
export { isRefusal };
export type { Refusal };
