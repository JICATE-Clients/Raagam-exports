/**
 * The Grey-to-Processed lifecycle, stated explicitly.
 *
 * doc/file.md §6: "Status flow: Raw Grey Purchased -> Out at Process (DC
 * Tracking) -> Finished Stock Received -> Issued to Production."
 *
 * ## NOTHING HERE IS STORED, AND THAT IS THE DESIGN
 *
 * The obvious build is a `lifecycle` column on the process row. It is wrong for
 * the same reason 0459 declines to extend `status`: every one of these four
 * states is already a fact somewhere else, held by a table that keeps it true.
 *
 *   1. Raw Grey Purchased      -> `stock_balances` for the material store
 *                                 (a PO, then a GRN — 0424 caps the PO at the
 *                                 BOM's own requirement).
 *   2. Out at Process          -> a `delivery_challans` row whose dispatch has
 *                                 been posted (`stock_posted_at`), moving the
 *                                 goods material store -> ST-PROC (0447).
 *   3. Finished Stock Received -> `dc_line_items.returned_qty`, posted back the
 *                                 other way (0448 — the return is a DELTA).
 *   4. Issued to Production    -> a `stock_ledger` issue, which
 *                                 `apply_stock_movement` refuses if the goods
 *                                 are still sitting in ST-PROC. That refusal IS
 *                                 the gate the client asked for; 0447 calls it
 *                                 "the gate comes free".
 *
 * A stored copy would be free to disagree with all four — and it would, because
 * goods can be issued, returned and re-issued without the BOM ever being saved
 * again. So this function reads the four sources and NAMES the state. One
 * declaration, several readers, no synchronisation.
 *
 * ## SIX STATES FOR FOUR, AND THE TWO EXTRAS ARE HONESTY
 *
 * §6's state 1 conflates two different situations: the grey has been bought, and
 * the grey has not been bought yet. A screen that shows "Raw Grey Purchased" for
 * both is telling the operator that goods exist. So state 1 is split, and a
 * third state is kept for the case where the stock figure has not been read at
 * all — `planned`. `planned` is a statement about what this module knows, not a
 * claim about the goods; it is what a BOM written months before the greige is
 * ordered looks like, which is the ordinary case (0446, on `stock_posted_at`).
 *
 * NULL IS AN ANSWER, 0 IS NOT: an unread stock figure is `null` and lands in
 * `planned`, never in "0 on hand" — which would read as a shortage and send a
 * buyer after goods that may already be in the store.
 */

import { isRefusal, type Refusal } from "@/lib/orders/material-bom/requirement";
import type { ChainStage } from "@/lib/orders/process-chain/chain";

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

export type LifecycleInput = {
  /** This row's place in the chain (`readChain`). */
  stage: ChainStage;
  qty_out: number | null;
  qty_in: number | null;
  /** The challan this row went out under, if one has been raised. */
  challanCode: string | null;
  /**
   * Whether that challan's dispatch has been POSTED to the stock ledger
   * (`delivery_challans.stock_posted_at`). Raised-but-unposted is the ordinary
   * planning state, not an error: the challan is written first and posted when
   * the goods actually move.
   */
  dispatchPosted: boolean;
  /**
   * Grey stock on hand for this material, in the store this stage draws from.
   * NULL = not read. Only a HEAD consults it; a later stage draws from the stage
   * above, never from grey.
   */
  greyOnHand: number | null;
  /**
   * How much of what this stage returned has since been issued to production.
   * NULL = not read. Only a TERMINAL stage can be issued from — a middle stage's
   * return is work in progress, and 0447's store gate is what physically stops
   * it being issued anyway.
   */
  issuedQty: number | null;
};

export type Lifecycle =
  /** Nothing sent, and the stock figure has not been read. */
  | { state: "planned"; next: string }
  /** §6 state 1, unmet: grey stock read and short of what this stage plans. */
  | { state: "awaiting_grey"; onHand: number; shortBy: number; next: string }
  /** §6 state 1: grey stock on hand covers what this stage plans to send. */
  | { state: "grey_purchased"; onHand: number; next: string }
  /** §6 state 2: material is at the processor. Partial returns live here too —
   *  the actionable fact is what is STILL OUT, and the s.143 clock runs on it. */
  | {
      state: "out_at_process";
      atVendor: number;
      returned: number;
      challan: string | null;
      next: string;
    }
  /** §6 state 3: everything sent has come back. */
  | { state: "finished_received"; received: number; next: string }
  /** §6 state 4. */
  | { state: "issued_to_production"; issued: number; received: number; next: string };

/**
 * Where one stage stands.
 *
 * ## THE ORDER OF THE TESTS IS THE RULE
 *
 * They are NOT ranked "furthest state wins". A stage with 600 back and 400 still
 * at the dyer reads `out_at_process` even when some of the 600 has already been
 * issued, because the fact worth acting on is that 400 units are at a processor
 * and the one-year job-work clock (CGST s.143) is running on them. Ranking by
 * furthest state would show `issued_to_production` — a state that reads as
 * finished — on a row with a statutory deadline attached. That is the expensive
 * failure `process-return.ts` describes: "a row that is merely late is a bigger
 * number than a row that is short".
 */
export function lifecycleOf(input: LifecycleInput): Lifecycle | Refusal {
  const { stage } = input;
  const sent = num(input.qty_out) ?? 0;
  const back = num(input.qty_in) ?? 0;
  const issued = num(input.issuedQty);
  const onHand = num(input.greyOnHand);

  if (sent < 0) return { refused: "Sent quantity cannot be negative" };
  if (back < 0) return { refused: "Received quantity cannot be negative" };
  if (back > sent && sent > 0) {
    // Same refusal `processVerdict` makes, for the same reason: it is a typo or
    // a mixed-up item, and it would make `atVendor` negative — which reads as a
    // credit rather than as an error.
    return { refused: "More has come back than went out — check the quantities" };
  }
  if (input.dispatchPosted && sent === 0) {
    // A posted dispatch moved stock. A row claiming nothing went out is
    // describing a ledger entry that exists.
    return { refused: "Stock has been moved for this stage but it shows nothing sent" };
  }
  if (issued != null && issued > back) {
    return { refused: "More has been issued to production than has come back from this stage" };
  }

  // ---- nothing has gone out yet -------------------------------------------
  if (sent === 0) {
    if (stage.prev_row_uid != null) {
      /*
       * A LATER STAGE IS NEVER "awaiting grey". Its input is the stage above,
       * and `dispatchCeiling` is what says whether there is anything to forward.
       * Reporting a grey shortage here would send a buyer after material that is
       * already bought and sitting at a dyer.
       */
      return { state: "planned", next: "Waiting for the stage before this one to return material" };
    }
    if (onHand == null) {
      return { state: "planned", next: "Read stock for this material, or send it out" };
    }
    // What the head plans to send is `qty_out`, which is 0 in this branch — so
    // there is nothing to be short OF until a quantity is typed. Any stock at
    // all therefore reads as purchased; none reads as awaiting.
    if (onHand > 0) {
      return { state: "grey_purchased", onHand, next: "Raise a Delivery Challan to send it out" };
    }
    return {
      state: "awaiting_grey",
      onHand,
      shortBy: 0,
      next: "Buy the grey stock this chain starts from",
    };
  }

  // ---- something has gone out ---------------------------------------------
  const atVendor = sent - back;

  if (atVendor > 0) {
    return {
      state: "out_at_process",
      atVendor,
      returned: back,
      challan: input.challanCode,
      next: input.challanCode
        ? `Record the return against challan ${input.challanCode}`
        : "Raise a Delivery Challan for this movement",
    };
  }

  // Everything is back.
  if (issued != null && issued > 0) {
    return {
      state: "issued_to_production",
      issued,
      received: back,
      next:
        issued < back
          ? `${trim(back - issued)} still in stock`
          : "Fully issued",
    };
  }

  return {
    state: "finished_received",
    received: back,
    next: stage.terminal
      ? "Ready to issue to production"
      : "Send it on to the next process",
  };
}

/**
 * The whole grey-shortage question a HEAD can answer once a quantity is typed.
 *
 * Kept separate from `lifecycleOf` because it is the only branch that needs the
 * planned quantity AND the stock figure together, and folding it in would make
 * `grey_purchased` mean two different things depending on whether `qty_out` had
 * been filled in yet.
 */
export function greyShortfall(
  qtyOut: number | null,
  greyOnHand: number | null,
): { shortBy: number } | Refusal {
  const want = num(qtyOut);
  const have = num(greyOnHand);
  if (want == null) return { refused: "Enter how much this stage sends out" };
  if (have == null) return { refused: "Stock for this material has not been read" };
  return { shortBy: Math.max(want - have, 0) };
}

/** Trailing zeros off, so "40" and not "40.000". */
function trim(n: number): string {
  return String(Number(n.toFixed(3)));
}

export { isRefusal };
export type { Refusal };
