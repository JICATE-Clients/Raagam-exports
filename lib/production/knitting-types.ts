/**
 * KNITTING HUB — shared types and the one formula (doc/process/knitting-plan.md, DB 0825).
 *
 * A Knitting Order IS a Process Order of type knitting (plan §1): its fabrics and their yarn
 * explosion live in `process_order_knit_fabrics` / `process_order_knit_yarns`, and every yarn
 * row is also a `process_order_lines` row, so Stores ▸ Process DC sends the yarn against it
 * with no knitting-specific code.
 *
 * THE FORMULA IS WRITTEN TWICE, ON PURPOSE, AND MUST AGREE: `yarnRequirement` below is the
 * screen's live preview; `knitting_order_save` (0825) computes the stored figure from the
 * same inputs and never takes the browser's number. Change one, change both.
 */

export type KnitWidthForm = "open_width" | "tubular";

export const WIDTH_FORM_LABELS: Record<KnitWidthForm, string> = {
  open_width: "Open Width",
  tubular: "Tubular",
};

export const PLY_OPTIONS = ["Single", "2-Ply", "3-Ply"] as const;

/**
 * Round to 3 decimals the way Postgres `round(x, 3)` does — half away from zero, on the
 * DECIMAL value. A plain `Math.round(n * 1000)` sees 115.11 × 0.95 = 109.3545 as
 * 109354.4999… in binary and gave 109.354 on screen while the saved line said 109.355
 * (KO/26-27/0001, 2026-11-11). `toPrecision(12)` drops the binary noise first.
 */
const r3 = (n: number) => Math.round(Number((n * 1000).toPrecision(12))) / 1000;

/**
 * Yarn needed for one yarn of one fabric:
 *   required = fabric kg × blend% × (1 + allowance%)
 *   bags     = ceil(required ÷ bag weight)                (when a bag weight is given)
 *   cap      = bags × bag weight, else required            — the most one Process DC line may
 *                                                          send (+1 bag rule, user D2)
 */
export function yarnRequirement(
  programmedKg: number,
  blendPct: number,
  allowancePct: number,
  bagWeightKg: number | null,
): { required: number; bags: number | null; cap: number } {
  const required = r3(programmedKg * (blendPct / 100) * (1 + allowancePct / 100));
  if (bagWeightKg && bagWeightKg > 0) {
    const bags = Math.ceil(required / bagWeightKg - 1e-9);
    return { required, bags, cap: r3(bags * bagWeightKg) };
  }
  return { required, bags: null, cap: required };
}

/** Expected rolls = ceil(programmed ÷ roll weight). */
export function expectedRolls(programmedKg: number, rollWeightKg: number | null): number | null {
  if (!rollWeightKg || rollWeightKg <= 0 || !(programmedKg > 0)) return null;
  return Math.ceil(programmedKg / rollWeightKg - 1e-9);
}

/** The Fabric BOM slice a knitting line is programmed from: one fabric at one dia, one form. */
export const knitSourceKey = (fabricId: string, dia: string | null, widthForm: string | null) =>
  `${fabricId}|${(dia ?? "").trim().toUpperCase()}|${widthForm ?? ""}`;

/** One fabric the order's current Fabric BOM needs knitted — a pick for Tab 1. */
export type KnitCandidate = {
  key: string;
  /** The RE this slice is on (0836: one Knitting Order may hold fabrics of several REs). */
  sales_order_id: string;
  re_no: string | null;
  fabric_item_id: string;
  fabric_name: string;
  /** The Fabric BOM's dia is the FINISHED width the garment needs (client 2026-11-11) —
   *  the knitting dia that gives it is typed on the KO. */
  finish_dia: string | null;
  width_form: KnitWidthForm | null;
  gsm: number | null;
  /** The BOM's requirement for this slice (kg, after its own wastage). */
  bom_kg: number;
  /** Already on other (non-cancelled) knitting orders of this RE, kg. */
  programmed_elsewhere_kg: number;
  /** The PLACED knitting order (not draft / cancelled) of this RE that already holds this slice —
   *  the picker greys it "(Program Placed — KO/..)" (0835). Null = free. */
  placed_on: string | null;
  /** The fabric master's blend (`material_mixings`). Empty = no composition. */
  yarns: { yarn_item_id: string; yarn_name: string; blend_pct: number | null }[];
};

export type KnitCandidatesResult =
  | { ok: true; customer: string | null; bom_code: string | null; candidates: KnitCandidate[]; note: string | null }
  | { ok: false; error: string };

export type KnitYarn = {
  id: string;
  yarn_item_id: string;
  yarn_name: string;
  blend_pct: number;
  allowance_pct: number;
  required_kg: number;
  bag_weight_kg: number | null;
  required_bags: number | null;
  /** DC CAP typed by the store (0837); null = the calculated cap (whole bags). */
  dc_cap_override_kg: number | null;
  /** The Process Order line behind the yarn — what a Yarn DC line points at (0825). */
  process_order_line_id: string | null;
  /** What has gone out on Process DCs against this yarn (kg). */
  dispatched_kg: number;
  /** Phase 3 (0830): knitted into fabric · back on the shelf · written off at close. */
  used_kg: number;
  returned_kg: number;
  written_off_kg: number;
  /** 0833: moved, still at the knitter, onto another Knitting Order (no DC, no transport). */
  transferred_kg: number;
  /** Still at the knitter = dispatched − used − returned − written off − moved to another order. */
  at_knitter_kg: number;
};

export type KnitFabric = {
  id: string;
  sno: number;
  /** The RE this fabric is knitted for (0836) — its stock belongs to that RE. */
  sales_order_id: string | null;
  re_no: string | null;
  fabric_item_id: string;
  fabric_name: string;
  source_key: string | null;
  width_form: KnitWidthForm | null;
  knit_dia: string | null;
  finished_dia: string | null;
  /** FINISHING GSM — the BOM's (0835 relabel; the column stays `gsm`). */
  gsm: number | null;
  /** KNITTING GSM (0835) — what the knitter knits to; defaults to the finishing GSM. */
  knit_gsm: number | null;
  loop_length: number | null;
  loop_length_ref: number | null;
  gauge_id: string | null;
  ply: string | null;
  programmed_kg: number;
  roll_weight_kg: number | null;
  expected_rolls: number | null;
  rate_per_kg: number;
  yarns: KnitYarn[];
  /** Fabric received back so far (0830). */
  received_kg: number;
  received_rolls: number;
};

/** One fabric receipt (0830) — what the knitter delivered, on one of their DCs. */
export type KnitReceipt = {
  id: string;
  /** 0831: a Fabric Receipt (PRC-n) or a Yarn Return (KYR-n) — never both on one document. */
  kind: "fabric" | "yarn_return";
  code: string | null;
  receipt_date: string;
  vendor_dc_no: string | null;
  rolls: number;
  fabric_kg: number;
  returned_kg: number;
  bill: number | null;
};

/** The live reconciliation (spec §2.5): every figure is a sum of posted documents. */
export type KnitAnalysis = {
  programmed_kg: number;
  fabric_received_kg: number;
  yarn_sent_kg: number;
  yarn_used_kg: number;
  yarn_returned_kg: number;
  written_off_kg: number;
  /** Still at the knitter — "yarn to be returned / process loss". */
  balance_kg: number;
  /** balance ÷ sent × 100 (null before any yarn has gone out). */
  loss_pct: number | null;
  allowed_loss_pct: number | null;
  over_limit: boolean;
};

/** Spec §3.3, from the order's own rows. */
export function knitAnalysis(fabrics: readonly KnitFabric[], allowed: number | null): KnitAnalysis {
  let programmed = 0, received = 0, sent = 0, used = 0, returned = 0, off = 0, bal = 0;
  for (const f of fabrics) {
    programmed += f.programmed_kg;
    received += f.received_kg;
    for (const y of f.yarns) {
      // Yarn moved on to another order (0833) was never this order's to lose.
      sent += y.dispatched_kg - y.transferred_kg;
      used += y.used_kg;
      returned += y.returned_kg;
      off += y.written_off_kg;
      bal += y.at_knitter_kg;
    }
  }
  const r = (n: number) => Math.round(n * 1000) / 1000;
  const loss = sent > 0 ? Math.round((bal / sent) * 100 * 1000) / 1000 : null;
  return {
    programmed_kg: r(programmed),
    fabric_received_kg: r(received),
    yarn_sent_kg: r(sent),
    yarn_used_kg: r(used),
    yarn_returned_kg: r(returned),
    written_off_kg: r(off),
    balance_kg: r(bal),
    loss_pct: loss,
    allowed_loss_pct: allowed,
    over_limit: loss != null && (allowed == null ? bal > 0.0005 : loss > allowed + 0.0005),
  };
}

export type KnittingOrderStatus =
  | "draft" | "issued" | "in_process" | "partially_received" | "received" | "closed" | "cancelled";

/** The knitting words for the process order statuses (spec: Draft → Yarn Issued → In Knitting → Completed). */
export const KNIT_STATUS_LABELS: Record<KnittingOrderStatus, string> = {
  draft: "Draft",
  issued: "Issued",
  in_process: "In Knitting",
  partially_received: "Partly Received",
  received: "Received",
  closed: "Completed",
  cancelled: "Cancelled",
};

/** A Yarn DC (Process DC, 0786) raised against the knitting order. */
export type KnitDc = {
  id: string;
  code: string | null;
  dc_date: string | null;
  status: string;
  kg: number;
  bags: number | null;
  /** 0833: a PAPER DC — yarn already at the knitter, moved here from this Knitting Order. */
  moved_from: string | null;
};

/** Yarn of this knitter, at the knitter on ANOTHER open Knitting Order (0833) — can be moved here. */
export type KnitYarnAtKnitter = {
  from_yarn_id: string;
  from_order_code: string | null;
  from_re_no: string | null;
  yarn_item_id: string;
  yarn_name: string;
  fabric: string;
  at_knitter_kg: number;
};

export type KnittingOrder = {
  id: string;
  code: string | null;
  status: KnittingOrderStatus;
  vendor_id: string;
  vendor_name: string | null;
  /** The FIRST RE of the order (0836 keeps the header column for lists and filters). */
  sales_order_id: string | null;
  /** Every RE on the order, joined — "HO/RE/26-27/0017, HO/RE/26-27/0013". */
  order_number: string | null;
  /** The REs on the order, in the order their fabrics were added (0836). */
  res: { id: string; order_number: string | null }[];
  order_date: string | null;
  expected_date: string | null;
  allowed_loss_pct: number | null;
  notes: string | null;
  total_amount: number;
  created_at: string;
  created_by: string | null;
  fabrics: KnitFabric[];
  dcs: KnitDc[];
  receipts: KnitReceipt[];
  /** 0830 — a close past the Allowed Loss % waits for the MD. */
  close_pending: boolean;
  close_reason: string | null;
  close_remark: string | null;
};

export type KnittingOrderListRow = {
  id: string;
  code: string | null;
  status: KnittingOrderStatus;
  vendor_name: string | null;
  order_number: string | null;
  order_date: string | null;
  expected_date: string | null;
  programmed_kg: number;
  fabric_count: number;
  created_at: string;
  created_by: string | null;
};

export type KnitOption = { id: string; name: string; inactive?: boolean };

/** What the editor sends; the server recomputes every derived figure. */
export type KnittingOrderInput = {
  vendor_id: string;
  sales_order_id: string | null;
  order_date: string | null;
  expected_date: string | null;
  allowed_loss_pct: number | null;
  notes: string | null;
  fabrics: {
    /** The fabric's own RE (0836); blank = the header's. */
    sales_order_id: string | null;
    fabric_item_id: string;
    source_key: string | null;
    width_form: KnitWidthForm | null;
    knit_dia: string | null;
    finished_dia: string | null;
    gsm: number | null;
    /** Blank = the finishing GSM (knitting_order_save, 0835). */
    knit_gsm: number | null;
    loop_length: number | null;
    /* loop_length_ref is no longer sent (client 2026-11-12, "Loop Ref" removed); the column stays. */
    gauge_id: string | null;
    ply: string | null;
    programmed_kg: number;
    roll_weight_kg: number | null;
    rate_per_kg: number;
    /** `dc_cap_kg`: the store's DC Cap (0837); null = calculated. */
    yarns: { yarn_item_id: string; blend_pct: number; allowance_pct: number; bag_weight_kg: number | null; dc_cap_kg: number | null }[];
  }[];
};

/** What the receipt form sends (0830); the server derives every yarn figure. */
export type KnitReceiptInput = {
  /** `transporter` (0837). A FABRIC receipt needs vendor_dc_no + vendor_dc_date (0837). */
  header: { receipt_date: string; vendor_dc_no: string | null; vendor_dc_date: string | null; vehicle_no: string | null; transporter?: string | null; notes: string | null };
  fabrics: { knit_fabric_id: string; rolls: number | null; net_kg: number; gross_kg: number | null; received_dia: string | null; store_id: string; bin_id: string | null; lot_no: string | null }[];
  returns: { knit_yarn_id: string; kg: number; bags: number | null; store_id: string; bin_id: string | null }[];
  /** PARTY STOCK (0837): yarn this knitter sends straight to another knitter's Knitting Order. */
  party?: { knit_yarn_id: string; to_order_id: string; kg: number }[];
};

/** An open Knitting Order of ANOTHER knitter that Party Stock yarn may go to (0837). */
export type KnitPartyTarget = {
  id: string;
  code: string | null;
  vendor_name: string | null;
  /** The yarn items it carries — Party Stock must be a yarn the target uses. */
  yarn_item_ids: string[];
};

/** One yarn row's Send Qty on the program (user 2026-11-12) — by position, see dispatchKnittingYarn. */
export type KnitSendLine = {
  fabric_index: number;
  yarn_index: number;
  store_id: string;
  bin_id: string | null;
  kg: number;
  bags: number | null;
  bag_weight_kg: number | null;
};
