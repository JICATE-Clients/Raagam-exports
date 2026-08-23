/**
 * THE GARMENT ORDER SHEET — the shape of the printed document.
 *
 * The GOS is the shop floor's directive: what to build, in which colours, in
 * which sizes, out of which fabric. It is read by people who track work by the
 * RE Number and by nothing else, so every field here is a fact the floor acts
 * on and none of it is procurement detail.
 *
 * ## THE TRIM CLUTTER PREVENTION POLICY IS EXPRESSED AS AN ABSENCE
 *
 * There is no trims field on this type, and there is no path from here to
 * `material_bom_*`. Buttons, sewing threads and labels belong to the
 * Accessories Requirement Sheet; a GOS that carried them would be a different
 * document. The policy is enforced by the type having nowhere to put them
 * rather than by a filter somebody has to remember to apply — a filter can be
 * widened by a well-meaning "while we're here", a missing field cannot.
 *
 * Two things that ARE on the combo tree and are still not printed:
 * `processed_as_trim` and the structure's `fabric_type` ('main' /
 * 'trims_fabric'). Both were withdrawn from the order screen on 2026-08-17
 * ("these details are covered elsewhere") — the columns survive so stored values
 * are not destroyed, but they are not facts the cutting room is asked to read.
 *
 * ## EVERYTHING HERE IS PLAIN DATA
 *
 * No functions, no Dates, no class instances: the sheet is built on the server
 * and rendered by a component, and a resolver function cannot cross that
 * boundary (the same reason `OrderProductionInput.sizeNames` is a map rather
 * than a lookup). Names are resolved once, into strings, before the sheet is
 * built.
 */

/**
 * A question the sheet cannot answer, carrying the sentence the page prints.
 *
 * NEVER `0`, NEVER `[]`, NEVER A THROW. A GOS with an empty size matrix reads
 * as "this order has no quantities yet", which is a real and unremarkable state
 * — indistinguishable from a matrix that failed to resolve. That confusion is
 * the exact failure `assortSizeWeights` was written to end on the Material BOM
 * side, and a printed sheet is worse than a screen: nobody is there to notice.
 *
 * THIS IS THE FOURTH COPY OF THIS TYPE IN THE REPO
 * (`lib/orders/material-bom/requirement.ts`, `lib/orders/bom-explosion/exploder.ts`,
 * `lib/orders/budget/totals.ts`). It is declared locally rather than imported so
 * this module has no edge into another lane's engine over one structural type —
 * but four copies is what a missing shared module looks like, and hoisting it to
 * `lib/refusal.ts` is a one-import change in each. Flagged, not done here.
 */
export type Refusal = { refused: string };

export function isRefusal(v: unknown): v is Refusal {
  return typeof v === "object" && v !== null && typeof (v as Refusal).refused === "string";
}

/**
 * The mandatory header block.
 *
 * ## NEITHER NUMBER ON THIS SHEET IS COMPOSED. BOTH ARE READ.
 *
 * `reNumber` is `sales_orders.order_number`, generated in the database by 0395
 * and rendered VERBATIM. TWO SHAPES ARE LIVE and both must survive untouched:
 *
 *     HO/RE/26-27/0001     new    (0431 put the dash in the fiscal year)
 *     U2/RE//2526/2047     legacy (DOUBLE slash after RE, and no dash)
 *
 * The legacy series is 86 of the 91 orders in this database, so it is the
 * ordinary case and not the edge one. Nothing here parses, pads, normalises or
 * "fixes" the double slash: a sheet quoting a number the floor cannot find is a
 * tracking failure across 500+ people. 0431's header explains why it cannot be
 * tidied at source either — the fiscal-year segment is the counter's PRIMARY
 * KEY, so changing it re-mints numbers that have already been issued.
 *
 * `sNo` is read too. See it below; the sheet mints nothing.
 */
export type GosHeader = {
  /**
   * S No — `garment_order_amendments.code`, live values `GOA-0008`…
   *
   * AN EXISTING SERIAL, NOT A THIRD SCHEME. The spec calls this an "internal
   * system sequence", and the sheet serialises ONE Garment Order document,
   * which is one amendment row, which already carries a number. The spec's
   * `STL/2026-27/001` example is the STYLE serial — a different sequence, whose
   * live form is `STL/26-27/0007` and which each style block states itself.
   *
   * THIS FIELD HELD A COMPUTED POSITION UNTIL 2026-08-23 ("amendment 1 of 3").
   * That was a number this code invented: it read as a serial on paper, and it
   * CHANGED for the same document the moment another amendment was raised — two
   * prints of one sheet disagreeing about their own S No.
   */
  sNo: string | null;
  /** RE Number (ஆரி நம்பர்) — the floor's primary key. Verbatim; see above. */
  reNumber: string | null;
  customerName: string | null;
  countryName: string | null;
  /**
   * The approved sample this order traces back to — `garment_styles.
   * approved_sample_id`, resolved to `samples.code` (SMP-0001).
   *
   * NULL WHEN THE ORDER CARRIES MORE THAN ONE STYLE, deliberately. The linkage
   * is a property of a style, not of a PO, so on a multi-style order there is
   * no single answer and the header would have to pick one — printing one
   * style's traceability under a heading that covers all of them. Each style
   * block carries its own; the header states it only when there is exactly one
   * style and the two readings cannot diverge.
   *
   * It is also null on every order today: `samples` has no rows in this
   * database, which is why the field stopped being mandatory on the Style
   * screen (client 2026-08-13). A blank here is an honest "not recorded", not a
   * lookup that failed.
   */
  approvedSampleNo: string | null;
  /** The customer's own PO number. */
  poNo: string | null;
  poDate: string | null;
  /** `sales_orders.order_date` — when WE booked it, distinct from the PO date. */
  orderDate: string | null;
  season: string | null;
  /** The order's delivery date. Destinations may each carry their own; see
   *  `destinations`, which is printed only when they disagree with this one. */
  deliveryDate: string | null;
  merchandiser: string | null;
  /** `true` when the amendment has not been confirmed. Printed as a watermark:
   *  a draft on the shop floor is a directive nobody has approved. */
  isDraft: boolean;
};

/** One destination's own dates, when the order ships to more than one place. */
export type GosDestination = {
  label: string;
  poNo: string | null;
  deliveryDate: string | null;
  earlierShipmentDate: string | null;
  qty: number;
};

/** One column of the size matrix. */
export type GosSizeColumn = { sizeId: string; label: string };

/**
 * One row of the size matrix — a colourway and its size curve.
 *
 * `cells` is index-aligned with the matrix's `columns`. A cell is `null` when
 * this colourway declares NO break-up for that size, and a number (including 0)
 * when it declares one. THE DISTINCTION IS LOAD-BEARING: an explicit 0 means
 * "this carton has no XL" and is a decision the packer made; a blank means the
 * question was never asked. Printing both as "0" would turn an unanswered
 * question into an instruction to make none.
 */
export type GosMatrixRow = {
  combo: string;
  cells: (number | null)[];
  total: number;
  /** True when this colourway carries quantities but was never declared on the
   *  Combos tab — printed with a mark rather than dropped. */
  undeclared: boolean;
};

export type GosMatrix = {
  columns: GosSizeColumn[];
  rows: GosMatrixRow[];
  /** Index-aligned with `columns`. */
  columnTotals: number[];
  total: number;
};

/**
 * One panel of the garment, in the fabric it is cut from.
 *
 * `colours` is index-aligned with the style's colourway list: the same physical
 * panel in each colour the order runs. A `null` there means this colourway does
 * not use this panel in this structure — which is a real answer on an order
 * where one colourway is pieced differently, not a gap.
 */
export type GosPanel = {
  coordinate: string | null;
  component: string | null;
  structure: string | null;
  gsm: number | null;
  gsmTolerance: number | null;
  colours: (GosPanelColour | null)[];
};

export type GosPanelColour = {
  colour: string | null;
  print: string | null;
};

/**
 * One coordinate — one garment of the set, or the whole garment on a Piece.
 *
 * A Piece style has exactly one; a Set has two to six (`COORDINATE_LIMITS` in
 * `lib/orders/styles/rules.ts`, which is where that rule already lived). The
 * grouping is what makes a Set legible on paper: a floor reading "TOP ▸ FRONT
 * BODY / BACK BODY / SLEEVE" then "BOTTOM ▸ …" can see which garment each panel
 * belongs to, which a flat panel list does not say.
 */
export type GosCoordinateBlock = {
  coordinate: string;
  panels: GosPanel[];
};

export type GosStyle = {
  styleRef: string;
  /**
   * THE STYLE'S OWN SERIAL — `STL/26-27/0007`, the sequence 0431 is named for.
   *
   * There is deliberately no per-style "S No" beside it. The one that used to
   * sit here was an array index nothing issued, and a second number printed
   * next to a real one is a number somebody has to reconcile.
   */
  styleCode: string | null;
  styleName: string | null;
  articleNo: string | null;
  description: string | null;
  /** 'piece' | 'set' | null — null on every style created before 0392. */
  unitKind: string | null;
  /** "Piece" / "Set", or null when the style has not answered. */
  unitKindLabel: string | null;
  /** Distinct coordinates this order's colourways actually name. */
  coordinateCount: number;
  /**
   * A sentence when the coordinate count contradicts the unit kind — a Piece
   * with two coordinates, a Set with seven. NOT a refusal: the sheet still
   * prints, because the floor needs it today and the correction is a
   * merchandising job. Silence would be the wrong answer in the other
   * direction; a Piece cut as two garments is a costing error worth seeing.
   */
  coordinateWarning: string | null;
  /** `garment_styles.approved_sample_id` resolved to `samples.code`. */
  approvedSampleNo: string | null;
  poQty: number;
  /** The colourways, in the order the Combos tab lists them. */
  colourways: string[];
  matrix: GosMatrix | Refusal;
  coordinates: GosCoordinateBlock[];
};

/**
 * Pieces that belong to no declared style.
 *
 * An assortment line names a style, or inherits the destination's; with several
 * styles declared and a line naming none of them, its pieces cannot be placed.
 * They are REPORTED rather than dropped — a quantity silently missing from a
 * shop-floor sheet is fabric that never gets cut.
 */
export type GosOrphan = { ref: string; combo: string; qty: number };

export type GosSheet = {
  header: GosHeader;
  destinations: GosDestination[];
  styles: GosStyle[];
  /** Sum of every style's matrix total. */
  grandTotal: number;
  orphans: GosOrphan[];
  /** ISO timestamp of the render, printed in the footer. */
  printedAt: string;
};
