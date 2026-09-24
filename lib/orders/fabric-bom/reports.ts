import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getOrderProduction } from "@/lib/orders/bom-order-basis";
import { excessQty, projectionQty } from "@/lib/orders/amendments/approval-qty";
import type { ApprovalRow, OrderProductionInput } from "@/lib/orders/material-bom/requirement";
import {
  comboKey,
  comboUpliftBreakdown,
  resolveRouteComponents,
  stageCoversCombo,
  type RouteStage,
} from "./yarn-process";
import {
  asFabricSource,
  clothPurchaseLabel,
  sourceBuysYarn,
  type FabricSource,
} from "./fabric-source";
import { stageRank } from "./stage-routes";
import { letterheadLogoOf, registeredAddressOf } from "./letterhead";
import { fabricAllocationOf, type FabricAllocation } from "./fabric-allocation-report";
import { consolidateContributions, mergeGreigeClothLines, mergeGreigeLines } from "./stage-ledger";
import { layoutTypeLabel, ydPartKey } from "./component-map";
import { mixingDetailRows, type MixingDetailRow, type YdRepeatRow } from "./yarn-dyed";
import { isReportRefusal, type ReportRefusal } from "./report-refusal";
/* THE PRINTING REQUIREMENT (client 2026-09-19) — which groups print, and the
   pure grouping the Printing tab renders. */
import {
  garmentKey,
  garmentTotal,
  mergeGarmentCounts,
  printNamesFor,
  printRequirement,
  printedGroup,
  type PrintLine,
  type PrintRequirement,
} from "./print-route";

/** `50` → "50", `33.333333` → "33.33" — the legacy printout's own rendering
 *  of a share (`GREEN 50%`, `RED 33.33%`). Trailing zeros dropped so a whole
 *  percentage does not read as a measured one. */
function trimPct(v: number): string {
  return String(Number(v.toFixed(2)));
}

/**
 * Two per-BOM printable documents for Orders ▸ Fabric BOM:
 *
 *   `fabricBomEntryRegister`      — the Fabric BOM Entry Register: header,
 *                                   fabric-wise weight table, Process Sequence
 *                                   & Stage Loss Ledger.
 *   `yarnFabricRequirementReport` — the Yarn & Fabric Requirement Report:
 *                                   header, Yarn Purchase Requirement table,
 *                                   Process Stage Ledger.
 *
 * ## NEITHER RECOMPUTES A FIGURE A PURCHASE IS RAISED AGAINST
 *
 * Same rule `lib/orders/fabric-requirement/service.ts`'s header states for the
 * signed Fabric Requirement Sheet: every weight printed here (`required_qty`,
 * `purchase_qty`, a stage's stored `process_qty`) is read straight off
 * `order_fabric_bom_requirements` / `order_fabric_bom_yarns` /
 * `order_fabric_bom_yarn_stages` — the SAME rows the BOM's own Save wrote,
 * never re-derived from the fabric lines or `material_mixings` at print time.
 * Two ways to compute one number is how a printed document and the figure a
 * PO is checked against come to disagree.
 *
 * ## THE STAGE LEDGER IS THE STORED SHAPE, NOT A TRUE SEQUENTIAL LADDER —
 *    DELIBERATELY, FOR NOW
 *
 * `comboUpliftBreakdown` (yarn-process.ts) can compute the true planned-in /
 * planned-out weight at EVERY stage of a multi-stage chain, but that ladder is
 * inherently keyed on (stage, colourway) — a stage naming no colour still
 * differs PER COLOURWAY once an earlier stage was colour-scoped — and nothing
 * persists it today: `order_fabric_bom_yarn_stages.process_qty` is each
 * stage's FINAL grossed weight for the colourways it treats (the Budget's
 * "what did this stage invoice for" figure), not its own incremental input.
 * Reconstructing the true ladder at print time would mean re-deriving
 * `FabricGross[]`/`FabricComposition` live from the BOM's fabric lines and
 * `material_mixings` — exactly the recompute the rule above forbids, because
 * it can silently disagree with the stored `purchase_qty` the moment the
 * order changes after Save. So the ledger below groups by PROCESS NAME and
 * shows each stage's own `loss_pct` and its stored `process_qty` — real,
 * stored, and honest about what it is. Persisting the true per-(stage,combo)
 * ladder is a real next step (a small additive column or child table written
 * by `writeYarns` at save time, using `comboUpliftBreakdown`), not done here.
 *
 * ## THE HEADER'S QTY BREAKDOWN IS DERIVED FROM `OrderProductionInput`,
 *    NEVER A SECOND FORMULA
 *
 * `cutQty` and its four components (Order Qty / Excess Qty / Rejection
 * Allowance Qty / Approval Allowance Qty) are not a column anywhere — Fabric
 * BOM stores only the SUMMED total (`order_fabric_boms.computed_for_qty`,
 * via `fullTarget`/`productionTarget`). The breakdown here re-derives the four
 * components with the SAME two functions that total already comes from
 * (`excessQty`, `projectionQty`, both `lib/orders/amendments/approval-qty.ts`)
 * summed over the order's OWN approval rows — no new arithmetic, just the
 * existing formula's terms kept separate instead of pre-summed. It reads the
 * order LIVE (`getOrderProduction`), same as the header identity fields
 * (customer/delivery/etc) already do in the Fabric Requirement Sheet — this is
 * CONTEXT explaining a stored figure, not a figure a purchase depends on.
 *
 * IT IS HEADER-LEVEL ONLY, AND STAYS THAT WAY — `ApprovalRow` (from
 * `lib/orders/material-bom/requirement.ts`, fed by `bom-order-basis.ts`'s
 * `approval_qtys:garment_order_amendment_approval_qtys(style_ref_no,combo,qty,
 * approval_qty)` select) carries no `size_id`, even though the underlying
 * table has held one, nullable, since 0435 ("Approval Qty is typed at SIZE
 * level only"). Widening that shared select to expose it would ripple into
 * every OTHER reader of `OrderProductionInput` (`materialTarget`,
 * `fullTarget`, the Approval Qty tab itself) for this one report's benefit,
 * and a pre-0435 order's rows carry `size_id` NULL regardless — so a per-size
 * Order/Excess/Rejection/Approval Qty column on `EntryRegisterSizeRow` was
 * investigated (2026-09-11) and NOT added: the size axis this report would
 * need to join on does not reach this file today, and guessing how one
 * style+combo total splits across its sizes is exactly the invented figure
 * this file's own rule above forbids. `EntryRegisterSizeRow` carries `cutQty`
 * only.
 *
 * ## GROSS WEIGHT IS `netReqWt` RUN BACKWARD THROUGH THE FABRIC'S OWN ROUTE
 *
 * `netReqWt` is unchanged — the stored `required_qty`, which already includes
 * the line's own cutting-room `wastage_pct`. `grossWt` (2026-09-11) is that
 * figure marked up by `comboUpliftBreakdown` (`./yarn-process`) over the SAME
 * fabric+combo route `yarnFabricRequirementReport` below already walks for its
 * own stage ledger — one implementation of the backward-markup chain, read by
 * both reports, never a second one written here. `lossPct` is the compounded
 * `(grossWt/netReqWt - 1) x 100` this produces, and `lossChain` carries the
 * per-stage percentages behind it. A fabric+combo with no declared route, or
 * one `comboUpliftBreakdown` refuses, abstains exactly as everywhere else in
 * this file: `grossWt = netReqWt`, `lossPct = null`, `lossChain = []` — never
 * a fabricated zero loss standing in for "nothing was computed".
 *
 * ## GROUPED BY ASSORT COLOUR, THEN BY MANUAL ENTRY (2026-09-11)
 *
 * The client's wireframe reads Assort Colour as the primary section and, under
 * it, one block per component-set with its size rows nested inside. An entry
 * (`order_fabric_bom_manual_entries`, 0494) already IS one fabric structure
 * plus one set of components — "THE ENTRY IS THE COUNTING UNIT" is that
 * migration's own heading — so `(combo, entry_id)` is the natural key rather
 * than a second one re-derived from fabric name + component list + item form.
 * A requirement row with `entry_id = null` (`chk_ofbr_one_parent`: exactly one
 * of `line_id`/`entry_id` is set — a line-based, non-Manual requirement) has no
 * component-set identity to key on, so it groups under a synthetic
 * `combo + "::" + item_id` bucket instead of crashing.
 */

export type { ReportRefusal };
export { isReportRefusal };

// ---------------------------------------------------------------------------
// Shared header
// ---------------------------------------------------------------------------

export type QtyBreakdown = {
  orderQty: number;
  excessQty: number;
  rejectionQty: number;
  approvalQty: number;
  /**
   * Cut Qty — the total to be cut: Order + Excess + Rejection + Approval.
   * Renamed from `sqQty` (client 2026-09-23: the SQ term is retired).
   *
   * `orderQty` is NOT the cut quantity and never carries the "Cut Qty" label
   * (client 2026-09-16) — it did once, and 1,000 read as the cut figure while
   * the real one (1,070) sat two columns along.
   */
  cutQty: number;
  /** EACH ALLOWANCE AS A PERCENTAGE OF THE ORDER QTY — the legacy printout's
   *  own `10 (0.10%)` / `200 (2.00%)` in the Approval and Rej.Allow columns.
   *  Derived here rather than at the two renderers, for the file header's
   *  reason: one arithmetic, printed twice, cannot drift. Null when the order
   *  qty is 0 — a percentage of nothing is not 0%, it is unanswerable. */
  approvalPct: number | null;
  rejectionPct: number | null;
};

export type BomDocHeader = {
  bomId: string;
  /** The order this BOM is keyed to — carried through so a report can resolve
   *  order-level facts (e.g. a structure's GSM) without a second lookup of
   *  something `loadBomDocHeader` already read. */
  garmentOrderId: string;
  bomCode: string | null;
  bomDate: string | null;
  computedAt: string | null;
  scNo: string | null;
  customer: string | null;
  orderNo: string | null;
  styleRefNo: string | null;
  /** The legacy printout's `Style` column, one along from `Style Ref No` —
   *  `garment_styles.name` where the order's style row links one, else that
   *  row's own free-text `description`. Null when the BOM covers styles that
   *  do not agree, the same abstain rule `styleRefNo` above makes, and null
   *  when the order simply never named one. */
  styleName: string | null;
  styleNo: string | null;
  deliveryFromDate: string | null;
  deliveryToDate: string | null;
  excessPct: number | null;
  /** null when the order carries no Approval Qty yet, or a chosen Garment
   *  Rejection Rule has a gap — same refusal `productionTarget` itself makes,
   *  never a total that silently drops the missing buffer. */
  qty: QtyBreakdown | ReportRefusal;
  /** The letterhead — same "two-name fallback" `fabric-requirement/service.ts`
   *  already reads `company_profile` with, so a PDF/Excel export of either
   *  report resolves a name on the same row the Fabric Requirement Sheet does. */
  company: {
    name: string | null;
    /** The REGISTERED address (client spec 2026-09-19) — `registeredAddressOf`
     *  in ./letterhead.ts, which prefers the profile's "Registered office (if
     *  different)" block and falls back to its main one. */
    address: string | null;
    /** The factory UNIT this BOM belongs to — "Head Office", "Unit 2" — the
     *  BOM's own `location_id` (0426), falling back to its order's. Null when
     *  neither names one; the letterhead then prints no unit line. */
    unit: string | null;
    gstin: string | null;
    /** The letterhead logo to draw (2026-09-19) — the Company Profile's, or
     *  the Raagam wordmark placeholder; null = the profile says no logo. See
     *  `letterheadLogoOf` in ./letterhead.ts. */
    logo: string | null;
  };
};

async function loadBomDocHeader(bomId: string): Promise<BomDocHeader | ReportRefusal> {
  const s = await createClient();

  const { data: bomRow, error: bomErr } = await s
    .from("order_fabric_boms")
    .select("id, code, garment_order_id, bom_date, computed_at, is_draft, location_id")
    .eq("id", bomId)
    .maybeSingle();

  if (bomErr) return { refused: `Could not read the Fabric BOM: ${bomErr.message}` };
  if (!bomRow) return { refused: "This Fabric BOM no longer exists." };

  const { data: goRow, error: goErr } = await s
    .from("garment_order_amendments")
    .select(
      "id, po_no, delivery_date, excess_pct, customer:customers(name), " +
        "sales_order:sales_orders(order_number, location_id)",
    )
    .eq("id", bomRow.garment_order_id)
    .maybeSingle();

  if (goErr) return { refused: `Could not read the order: ${goErr.message}` };
  if (!goRow) return { refused: "This Fabric BOM's order no longer exists." };

  const go = goRow as unknown as {
    id: string;
    po_no: string | null;
    delivery_date: string | null;
    excess_pct: number | null;
    customer: { name: string } | null;
    sales_order: { order_number: string | null; location_id: string | null } | null;
  };

  /* THE UNIT (client spec 2026-09-19: "Unit Name (e.g. Unit 2)"). The BOM's own
     `location_id` first — it is the document's unit and all nine live BOMs
     carry one — then its order's. A failed read REFUSES the report rather than
     printing no unit: an empty unit line on a document sent to a supplier reads
     as "this came from nowhere", and `data ?? null` would hide the failure. */
  const locationId =
    (bomRow as { location_id?: string | null }).location_id ?? go.sales_order?.location_id ?? null;
  let unitName: string | null = null;
  if (locationId) {
    const { data: loc, error: locErr } = await s
      .from("locations")
      .select("name")
      .eq("id", locationId)
      .maybeSingle();
    if (locErr) return { refused: `Could not read the BOM's unit: ${locErr.message}` };
    unitName = (loc as { name: string | null } | null)?.name ?? null;
  }

  /* THERE IS NO SINGLE "Style Ref No" ON THE ORDER — `style_ref_no` lives on
     the BOM's own lines (NULL there means "every style", 0495's shape), and
     one BOM can genuinely cover several. So this reads the SAME rows the
     body table will (`order_fabric_bom_lines`), and answers only when every
     line agrees — same abstain rule `fabricAllocationColumns`'s GSM lookup
     uses ("one distinct answer or nothing"), rather than picking the first
     line's style and mislabelling a multi-style document. */
  const [order, coRes, styleRes, orderStyleRes] = await Promise.all([
    getOrderProduction(go.id),
    s.from("company_profile").select("*").limit(1).maybeSingle(),
    s.from("order_fabric_bom_lines").select("style_ref_no").eq("bom_id", bomId),
    /* THE ORDER'S OWN STYLE ROWS, for the `Style` column beside `Style Ref No`
       (legacy printout). Read off the amendment rather than the BOM because
       the BOM's line only carries the REF; the name lives with the order. */
    s
      .from("garment_order_amendment_styles")
      /* `style_name` — legacy's own "Style" column, 0124's own comment on it.
         NOT `name`, which `garment_styles` does not have; the first cut of
         this select asked for one and PostgREST answered 42703, which
         `data ?? []` turned into "this order names no styles" and the header
         printed a blank Style. A FAILED QUERY IS AN ERROR, NOT AN EMPTY LIST
         — checked below, which is what made it findable at all. */
      .select("style_ref_no, description, style:garment_styles!style_id(style_name)")
      .eq("amendment_id", go.id),
  ]);
  if (orderStyleRes.error) {
    return { refused: `Could not read the order's styles: ${orderStyleRes.error.message}` };
  }
  const distinctStyles = [
    ...new Set(
      ((styleRes.data ?? []) as { style_ref_no: string | null }[])
        .map((r) => r.style_ref_no)
        .filter((v): v is string => !!v),
    ),
  ];
  const soleStyleRefNo = distinctStyles.length === 1 ? distinctStyles[0] : null;

  /* THE STYLE'S NAME, AND ONLY WHEN IT IS THIS DOCUMENT'S ONE STYLE. A BOM
     whose lines disagree has no single Style Ref No to print (above) and so
     has no single Style either; printing one row's name beside a blank ref
     would label a multi-style document with one of its styles. */
  const orderStyles = (orderStyleRes.data ?? []) as unknown as {
    style_ref_no: string | null;
    description: string | null;
    style: { style_name: string | null } | null;
  }[];
  const styleRow = soleStyleRefNo
    ? orderStyles.find((r) => r.style_ref_no === soleStyleRefNo)
    : orderStyles.length === 1
      ? orderStyles[0]
      : undefined;
  /* THE LINKED MASTER FIRST, the row's own free text second. `style_id` is
     nullable and is null on every order booked without a Garment Style master
     row, which is the ordinary case here — `description` is what the operator
     actually typed on the Style(s) tab, so it is a real answer and not a
     fallback to nothing. */
  const styleName = styleRow ? (styleRow.style?.style_name ?? styleRow.description ?? null) : null;
  const qty: QtyBreakdown | ReportRefusal = order
    ? qtyBreakdownOf(order)
    : { refused: "No production quantity yet — fill Approval Qty on the order" };

  const co = coRes.data as Record<string, unknown> | null;
  const str = (k: string) => (typeof co?.[k] === "string" ? (co[k] as string) : null);

  return {
    bomId: bomRow.id,
    garmentOrderId: bomRow.garment_order_id,
    bomCode: bomRow.code,
    bomDate: bomRow.bom_date,
    computedAt: bomRow.computed_at,
    scNo: go.sales_order?.order_number ?? null,
    customer: go.customer?.name ?? null,
    company: {
      name: str("name") ?? str("company_name"),
      /* THE REGISTERED ADDRESS (client spec 2026-09-19) — the "Registered
         office (if different)" block when filled, else the main street1..3 /
         city / state / pin block. See `registeredAddressOf`. */
      address: registeredAddressOf(co),
      unit: unitName,
      gstin: str("gstin"),
      logo: letterheadLogoOf(co),
    },
    orderNo: go.po_no,
    // NULL means the BOM's lines don't all agree on one style — the doc's
    // single "Style Ref No" fact doesn't exist for a genuinely multi-style
    // document, so it prints blank rather than one line's style mislabelling
    // the whole register (see the query above).
    styleRefNo: soleStyleRefNo,
    styleName,
    // "Style No" has no resolvable source on this document — `styles`/
    // `style_no` are not columns this schema carries at the order OR line
    // level (checked, not assumed, after `style_ref_no` turned out not to be
    // one either). Left null rather than guessing a second column that
    // doesn't exist.
    styleNo: null,
    // `order_fabric_boms` carries one delivery date, not a window — the doc's
    // "from/to" reads as one date in this schema, and printing it in both
    // slots would invent a range nobody entered.
    deliveryFromDate: go.delivery_date,
    deliveryToDate: go.delivery_date,
    excessPct: go.excess_pct,
    qty,
  };
}

/**
 * The four terms of `productionTarget`, kept separate and summed over every
 * approval row on the order — see the file header. Refuses exactly where
 * `productionTarget` itself would: a Garment Rejection Rule is chosen and at
 * least one row's quantity falls outside every tier.
 */
/**
 * The panel names a split route names (0528) — `components.short_name`, the
 * same label the Manual entry's own component list prints, so a route branch
 * and the entry it grosses read the same word. Fetched only when some step is
 * component-scoped; a unified route makes no query. Shared by both reports.
 */
/**
 * EACH FABRIC'S SOURCE (0564) — Rule 1 vs Rule 2, per fabric. Both reports need
 * it, and both REFUSE on failure rather than coalescing: `data ?? []` here reads
 * every fabric as Rule 1, so a purchased cloth would be grossed by the knitting
 * it never pays for and the register would print a KNITTING row for it. A
 * plausible document that is simply wrong.
 *
 * ONE FUNCTION BECAUSE IT WAS TWO IDENTICAL SELECTS. Nothing clever happens
 * here; the value is that a change to what "each fabric's source" means cannot
 * reach one report and miss the other.
 *
 * A pre-migration retry lived here on 2026-09-16, between 0564 being written and
 * being applied, and came out the same day once it was. The reason it went is
 * the more useful half: a retry that silently re-issues the select WITHOUT the
 * column is the same failure as the `?? []` above, one level up — it hands back
 * rows that look complete, and an unflagged step restores a knitting loss to a
 * fabric that is bought as cloth. A wrong purchase weight with nothing on
 * screen. Refusing loudly is the better answer even inside a migration window.
 */
async function fetchFabricSources(
  s: Awaited<ReturnType<typeof createClient>>,
  bomId: string,
) {
  return s
    .from("order_fabric_bom_process_scope")
    .select("item_id, source")
    .eq("bom_id", bomId);
}

/**
 * THE PROCESS MASTER'S NAME AND KIND FLAGS, for both reports.
 *
 * ## THIS EXISTS BECAUSE `?? []` SWALLOWED A FAILURE AND IT SHIPPED (2026-09-16)
 *
 * Both reports read this master to turn a route step's `process_id` into a name,
 * and into the kind flags the source ladder needs. Both did it inline, and both
 * took the result as `(res.data ?? []) as ...`. When 0564 added `is_knitting` to
 * those selects, an environment without the column answered the WHOLE select
 * with an error — so the map came back EMPTY and every step in the Process Stage
 * Ledger rendered as "(process not found)", four sections of it, with the
 * arithmetic beneath them intact and correct.
 *
 * That is "A FAILED QUERY IS AN ERROR, NOT AN EMPTY LIST" (AGENTS.md) arriving
 * in the very change that added the column, two guards below a comment making
 * the same argument about `scopeRes`. An empty NAME map does not look like a
 * broken query; it looks like a master nobody has filled in — plausible,
 * unremarkable, believed. A duplicate React key was the only reason anything
 * complained at all, and only because the placeholder string repeated.
 *
 * So the callers check `error`. Report 1 refuses the document; Report 2 pushes
 * onto `stageLedgerRefusals` instead, because every weight on that page comes
 * from the stored route and requirement rather than from any name — a failed
 * label lookup costs labels, and blanking a correct page over it throws work
 * away. Same failure, two right answers, decided by whether the page can say so
 * itself.
 */
async function fetchProcessKindRows(
  s: Awaited<ReturnType<typeof createClient>>,
  processIds?: string[],
) {
  /* `is_print` JOINED 2026-09-19 — which step prints, so an unprinted group's
     ladder leaves the print stage out (`routeForPrint`) exactly as the save
     path's does. */
  /* `is_cloth_purchase` JOINED 2026-09-21 — which step BUYS the cloth (0583),
     so the Budget can leave that section out of Process Rates: a purchase is
     costed once, on Purchase Rates, at the roll weight this same report
     states. The ledger still PRINTS the section — its loss is the purchase
     loss, and the buyer reads it there. */
  const q = s.from("processes").select("id, name, is_knitting, is_dyeing, is_print, is_cloth_purchase");
  return processIds ? q.in("id", processIds) : q;
}

/**
 * THE BOM'S OWN LINES, AS MUCH AS THE PRINT RULE READS (2026-09-19) — which
 * (fabric, colourway, component) carries a `required_print`. Read, not
 * coalesced: an empty answer would read as "nothing is printed", every group's
 * ladder would drop its print stage, and the printing report would come back
 * empty — the "empty REPORT is the dangerous one" failure AGENTS.md names.
 */
async function fetchPrintLines(
  s: Awaited<ReturnType<typeof createClient>>,
  bomId: string,
): Promise<PrintLine[] | ReportRefusal> {
  const { data, error } = await s
    .from("order_fabric_bom_lines")
    .select("item_id, combo, component_id, required_print")
    .eq("bom_id", bomId);
  if (error) return { refused: `Could not read the fabric lines' prints: ${error.message}` };
  return (data ?? []) as PrintLine[];
}

/** "DYEING [WITH BIOWASH]" labels for the sub-categories a route names (0583).
 *  A failed read costs labels only — the plain process name still prints. */
async function fetchSubCategoryNames(
  s: Awaited<ReturnType<typeof createClient>>,
  ids: readonly (string | null | undefined)[],
): Promise<Map<string, string>> {
  const wanted = [...new Set(ids.filter((v): v is string => !!v))];
  if (!wanted.length) return new Map();
  const { data } = await s.from("process_sub_categories").select("id, sub_category").in("id", wanted);
  return new Map(((data ?? []) as { id: string; sub_category: string }[]).map((r) => [r.id, r.sub_category]));
}


async function routeComponentNames(
  s: Awaited<ReturnType<typeof createClient>>,
  ids: readonly (string | null)[],
): Promise<Map<string, string> | ReportRefusal> {
  const names = new Map<string, string>();
  const wanted = [...new Set(ids.filter((id): id is string => !!id))];
  if (wanted.length === 0) return names;
  const { data, error } = await s.from("components").select("id, short_name").in("id", wanted);
  if (error) return { refused: `Could not read the route's components: ${error.message}` };
  for (const c of (data ?? []) as { id: string; short_name: string }[]) names.set(c.id, c.short_name);
  return names;
}

/* EXPORTED for the Budget (0574) — CMT and Garment Processes read the legacy
   Cut Qty per STYLE by calling this over one style's approval rows. One
   arithmetic, so the budget's pieces-made and this report's Cut Qty agree. */
export function qtyBreakdownOf(order: OrderProductionInput): QtyBreakdown | ReportRefusal {
  if (order.approvals.length === 0) {
    return { refused: "No production quantity yet — fill Approval Qty on the order" };
  }

  let orderQtyTotal = 0;
  let excessTotal = 0;
  let approvalTotal = 0;
  let rejectionTotal = 0;

  for (const a of order.approvals as readonly ApprovalRow[]) {
    const qty = Number.isFinite(a.qty) ? a.qty : 0;
    if (qty <= 0) continue;
    const approval = Math.max(0, Number.isFinite(a.approval_qty) ? a.approval_qty : 0);
    const rejection = projectionQty(qty, order.tiers);

    if (order.rejectionRuleChosen && rejection == null) {
      return {
        refused: `${a.combo || a.style_ref_no || "(blank)"}: the Garment Rejection Rule has no tier covering ${qty} pcs — fix the rule or clear it on the order`,
      };
    }

    orderQtyTotal += qty;
    excessTotal += excessQty(qty, order.excessPct);
    approvalTotal += approval;
    rejectionTotal += rejection ?? 0;
  }

  const pct = (part: number) => (orderQtyTotal > 0 ? Number(((part / orderQtyTotal) * 100).toFixed(2)) : null);

  return {
    orderQty: orderQtyTotal,
    excessQty: excessTotal,
    rejectionQty: rejectionTotal,
    approvalQty: approvalTotal,
    cutQty: orderQtyTotal + excessTotal + rejectionTotal + approvalTotal,
    approvalPct: pct(approvalTotal),
    rejectionPct: pct(rejectionTotal),
  };
}

// ---------------------------------------------------------------------------
// Report 1 — Fabric BOM Entry Register
// ---------------------------------------------------------------------------

/** One size of one (combo, entry) block. */
export type EntryRegisterSizeRow = {
  sizeLabel: string;
  cutQty: number;
  /** The per-garment consumption this line was multiplied by — stored on the
   *  requirement row itself (`order_fabric_bom_manual.ts`'s `consumptionMap`),
   *  in `uomCode`'s unit. Not necessarily grams: a fabric's own base UOM
   *  decides that, so this is labelled by its unit rather than assumed. */
  pieceWt: number | null;
  /** The line's OWN wastage % (EndBit / cutting-room buffer) — the ONE loss
   *  this requirement row's `required_qty` already includes. Not the same
   *  thing as the process-stage `lossPct` below. */
  wastagePct: number | null;
  netReqWt: number;
  /** `netReqWt` run BACKWARD through the fabric's own process-stage ladder —
   *  see the file header, "GROSS WEIGHT IS `netReqWt` RUN BACKWARD…". Equal
   *  to `netReqWt` when the group's `lossChain` is empty. */
  grossWt: number;
  /** `(grossWt/netReqWt - 1) x 100`, the COMPOUNDED loss the ladder already
   *  implies — never a second stored percentage. Null when netReqWt is 0
   *  (nothing to divide by) or the group's `lossChain` is empty. */
  lossPct: number | null;
  /** The knitting/finishing diameter or flat/woven width for this size row,
   *  from the Manual entry's size row (`order_fabric_bom_manual_sizes`,
   *  0494) — never re-typed here. */
  /* TEXT SINCE 0566, not a number. The client types the UNIT into this box —
     "23 CM", "25 BOX", "36 x 44" — so a dia is a LABEL the cutting room reads,
     never a figure anything multiplies. Nothing in either report does
     arithmetic with it; both print it. */
  dia: string | null;
  /** The commercial purchase width for the same size row — a second, distinct
   *  figure from `dia` (cloth is knitted at one width and invoiced at another). */
  purchaseWidth: number | null;
  uomCode: string | null;
  styleRefNo: string | null;
};

/** One (combo, entry) block — a fabric structure plus one set of components,
 *  the Manual tab's own counting unit (0494) — with its size rows nested
 *  under it. See the file header, "GROUPED BY ASSORT COLOUR…". */
export type EntryRegisterComponentGroup = {
  /** `entry_id`, or the synthetic `combo + "::" + item_id` fallback for a
   *  line-based requirement row that names no entry. */
  key: string;
  /** e.g. `["BACK", "FRONT BODY", "SLEEVES"]`, already sorted. Empty for the
   *  synthetic-key fallback, which names a fabric but no component set. */
  componentNames: string[];
  fabricName: string;
  itemId: string;
  /** The order's own GSM for this group's structure, resolved for this
   *  group's OWN combo — same "one distinct answer or nothing" abstain rule
   *  the header's Style Ref No already uses. */
  gsm: number | null;
  /** "Open Width" / "Tubular" — the entry's own `width_form` (0495), labelled.
   *  Null when the entry never declared one, or there is no entry. */
  itemForm: string | null;
  /** One entry per stage of this group's own fabric+combo route, e.g.
   *  `[{processName:"Knitting",lossPct:5}, {processName:"Dyeing",lossPct:10}]`.
   *  Empty when no route was declared, or every declared stage refused this
   *  combo — see the file header. */
  lossChain: { processName: string; lossPct: number }[];
  /** WHY `lossChain` IS EMPTY when a route WAS declared — the engine's own
   *  sentence (a "Component Wise" route this entry's panels disagree on,
   *  `resolveRouteComponents`). Null when nothing refused; an empty chain
   *  with a null here is the ordinary "no route declared". */
  routeRefusal: string | null;
  sizes: EntryRegisterSizeRow[];
  subtotal: { cutQty: number; netReqWt: number; grossWt: number };
};

/** One Assort Colour section — the register's primary grouping (2026-09-11). */
export type EntryRegisterColourGroup = {
  /** `null`/`""` both mean "no colourway declared" — passed through as read;
   *  the UI labels it. */
  combo: string | null;
  components: EntryRegisterComponentGroup[];
  subtotal: { cutQty: number; netReqWt: number; grossWt: number };
};

export type StageLedgerRow = {
  className: "Fabric" | "Yarn";
  itemName: string;
  /** THE BRANCH THIS STEP BELONGS TO when the fabric's route is split (0528)
   *  — the un-aggregated route per colour and per panel, exactly as
   *  declared. Both null on a unified route and on every Yarn row. */
  combo: string | null;
  componentName: string | null;
  stageName: string | null;
  processName: string | null;
  lossPct: number | null;
};

export type EntryRegister = {
  header: BomDocHeader;
  groups: EntryRegisterColourGroup[];
  grandTotal: { cutQty: number; netReqWt: number; grossWt: number };
  stageLedger: StageLedgerRow[];
};

export async function fabricBomEntryRegister(bomId: string): Promise<EntryRegister | ReportRefusal> {
  const header = await loadBomDocHeader(bomId);
  if (isReportRefusal(header)) return header;

  const s = await createClient();

  const [reqRes, entryRes, yarnRes] = await Promise.all([
    s
      .from("order_fabric_bom_requirements")
      .select(
        "entry_id, item_id, sno, style_ref_no, combo, size_id, slice_label, " +
          "basis_qty, consumption, wastage_pct, required_qty, consumption_uom_id, refusal_reason",
      )
      .eq("bom_id", bomId)
      .order("sno", { ascending: true }),
    s
      .from("order_fabric_bom_manual_entries")
      .select(
        "id, style_ref_no, item_id, width_form, structure_id, " +
          "components:order_fabric_bom_manual_components(component_id, component:components(short_name)), " +
          "sizes:order_fabric_bom_manual_sizes(size_id, dia, purchase_width)",
      )
      .eq("bom_id", bomId),
    // THE YARN LEDGER'S OWN STAGES, for the Class=Yarn rows below — separate
    // from `order_fabric_bom_processes` (Class=Fabric), which is fetched once
    // this document's fabric ids are known, a few lines down.
    s
      .from("order_fabric_bom_yarns")
      .select(
        "item_id, purchase_qty, stages:order_fabric_bom_yarn_stages(stage_id, process_id, loss_pct)",
      )
      .eq("bom_id", bomId),
  ]);

  if (reqRes.error) return { refused: `Could not read the requirement rows: ${reqRes.error.message}` };
  if (entryRes.error) return { refused: `Could not read the BOM's entries: ${entryRes.error.message}` };
  if (yarnRes.error) return { refused: `Could not read the yarn rows: ${yarnRes.error.message}` };

  type ReqRow = {
    entry_id: string | null;
    item_id: string | null;
    style_ref_no: string | null;
    combo: string | null;
    size_id: string | null;
    slice_label: string | null;
    basis_qty: number | null;
    consumption: number | null;
    wastage_pct: number | null;
    required_qty: number | null;
    consumption_uom_id: string | null;
    refusal_reason: string | null;
  };
  const reqRows = (reqRes.data ?? []) as unknown as ReqRow[];

  type EntryRow = {
    id: string;
    style_ref_no: string | null;
    width_form: string | null;
    structure_id: string | null;
    components: { component_id: string | null; component: { short_name: string } | null }[] | null;
    sizes: { size_id: string | null; dia: number | string | null; purchase_width: number | string | null }[] | null;
  };
  const entryRows = (entryRes.data ?? []) as unknown as EntryRow[];

  const itemIds = [...new Set(reqRows.map((r) => r.item_id).filter(Boolean))] as string[];
  const uomIds = [...new Set(reqRows.map((r) => r.consumption_uom_id).filter(Boolean))] as string[];
  const structureIds = [...new Set(entryRows.map((e) => e.structure_id).filter(Boolean))] as string[];

  // `order_fabric_bom_processes` (Class=Fabric of the ledger) DOES carry its
  // own `bom_id` (0492 keys a route to the FABRIC only *within* one BOM,
  // never across documents) — scoped on BOTH, or the same fabric declared on
  // a second, unrelated order's BOM would leak its stages into this ledger.
  const [
    itemRes,
    uomRes,
    stageLookupRes,
    processLookupRes,
    processesRes,
    comboStructuresRes,
    scopeRes,
  ] = await Promise.all([
      itemIds.length ? s.from("items").select("id, name").in("id", itemIds) : Promise.resolve({ data: [], error: null }),
      uomIds.length
        ? s.from("uoms").select("id, code").in("id", uomIds)
        : Promise.resolve({ data: [], error: null }),
      s.from("config_lookups").select("id, name").eq("kind", "fabric_stage"),
      /* THE KIND FLAGS RIDE ALONG (0564). This select already existed for the
         process NAMES; `is_knitting` / `is_dyeing` are two more columns on the
         same rows, and reading them here is what lets the ladder below drop a
         step a purchased fabric does not pay for. A second query for two
         booleans would be a second place for this report and the save path to
         disagree about which step is a Knitting. */
      fetchProcessKindRows(s),
      itemIds.length
        ? s
            .from("order_fabric_bom_processes")
            .select("item_id, combo, component_id, sno, stage_id, process_id, sub_category_id, loss_pct, color_wise_loss, color_losses")
            .eq("bom_id", bomId)
            .in("item_id", itemIds)
            .order("sno", { ascending: true })
        : Promise.resolve({ data: [], error: null }),
      // THE ORDER'S OWN GSM, per (structure, combo) — same route
      // `getOrderFabricSeed` (service.ts) already reads it by, so this can
      // never disagree with what the order itself declares. Only fetched when
      // this document actually names a structure, and only this order's rows.
      structureIds.length
        ? s
            .from("garment_order_amendment_combos")
            .select(
              "combo, structures:garment_order_amendment_combo_structures(structure_id, gsm)",
            )
            .eq("amendment_id", header.garmentOrderId)
        : Promise.resolve({ data: [], error: null }),
      /* WHERE EACH FABRIC COMES FROM (0564). Fetched unconditionally rather
         than gated on `itemIds.length` like its neighbours: a BOM with no
         requirement rows has nothing to ladder anyway, and one fewer branch
         is one fewer way for this to come back empty for the wrong reason. */
      fetchFabricSources(s, bomId),
    ]);
  if (processesRes.error) {
    return { refused: `Could not read the process ledger: ${processesRes.error.message}` };
  }
  /* WHICH GROUPS PRINT (2026-09-19) — so an unprinted colourway's ladder is
     not grossed by the print stage, matching the stored purchase figure. */
  const printLines = await fetchPrintLines(s, bomId);
  if (isReportRefusal(printLines)) return printLines;
  if (comboStructuresRes.error) {
    return { refused: `Could not read the order's GSM: ${comboStructuresRes.error.message}` };
  }
  /* READ, NOT COALESCED AWAY. `data ?? []` here would make every fabric read
     as Rule 1, so a purchased cloth would be grossed by the knitting it never
     pays for and the register would print a KNITTING row for it — a plausible
     document that is simply wrong, which is the failure AGENTS.md records
     under "A FAILED QUERY IS AN ERROR, NOT AN EMPTY LIST". */
  if (scopeRes.error) {
    return { refused: `Could not read each fabric's source: ${scopeRes.error.message}` };
  }

  const itemNames = new Map<string, string>(
    ((itemRes.data ?? []) as { id: string; name: string }[]).map((r) => [r.id, r.name]),
  );
  const uomCodes = new Map<string, string>(
    ((uomRes.data ?? []) as { id: string; code: string }[]).map((r) => [r.id, r.code]),
  );
  const stageNames = new Map<string, string>(
    ((stageLookupRes.data ?? []) as { id: string; name: string }[]).map((r) => [r.id, r.name]),
  );
  /* REFUSED, NOT COALESCED — see `fetchProcessKindRows`. An empty name map
     prints "(process not found)" against every step of a ledger whose figures
     are all correct, which reads as a master nobody filled in rather than as a
     query that failed. */
  if (processLookupRes.error) {
    return { refused: `Could not read the process master: ${processLookupRes.error.message}` };
  }
  const processRowsAll = (processLookupRes.data ?? []) as {
    id: string;
    name: string;
    is_knitting: boolean | null;
    is_dyeing: boolean | null;
    is_print: boolean | null;
  }[];
  const processNames = new Map<string, string>(processRowsAll.map((r) => [r.id, r.name]));
  /** WHAT KIND OF STEP EACH PROCESS IS (0564) — read by the ladder, not by
   *  the display. See `./fabric-source.ts`. */
  const processKinds = new Map<string, { is_knitting: boolean; is_dyeing: boolean; is_print: boolean }>(
    processRowsAll.map((r) => [
      r.id,
      { is_knitting: r.is_knitting ?? false, is_dyeing: r.is_dyeing ?? false, is_print: r.is_print ?? false },
    ]),
  );
  /** EACH FABRIC'S OWN SOURCE (0564). A fabric with no scope row reads Rule 1,
   *  which is what absence has meant on this table since 0528 and what the
   *  column's default says today. */
  const sourceByFabric = new Map<string, FabricSource>(
    ((scopeRes.data ?? []) as { item_id: string; source: string | null }[]).map((r) => [
      r.item_id,
      asFabricSource(r.source),
    ]),
  );

  /* THE FABRIC'S OWN ROUTE, ONE PER ITEM, IN ASCENDING `sno` (fetch order) —
     the same rows Report 2's stage ledger reads. `comboUpliftBreakdown`'s
     backward-markup walk needs the OPPOSITE, PHYSICAL-REVERSE direction (the
     net cutting-room figure belongs to the LAST stage and grows backward
     toward Knitting) — see `yarnFabricRequirementReport`'s own header on why
     feeding it un-reversed would label the wrong stage with the wrong
     weight. Reversed once, in `ladderFor` below, not here — this map stays in
     fetch order so a caller that ever wants the forward reading (none today)
     is not handed a pre-reversed array under a name that doesn't say so. */
  const routeByFabric = new Map<string, RouteStage[]>();
  type ProcessRow = {
    item_id: string;
    combo: string | null;
    component_id: string | null;
    stage_id: string | null;
    process_id: string | null;
    sub_category_id: string | null;
    loss_pct: string | number | null;
    /* 0606 — per-colourway losses on an "Assort Color-Wise Loss" step. */
    color_wise_loss?: boolean | null;
    color_losses?: Record<string, number> | null;
  };
  const processRows = (processesRes.data ?? []) as unknown as ProcessRow[];
  const subNames = await fetchSubCategoryNames(s, processRows.map((p) => p.sub_category_id));
  /** "DYEING [WITH BIOWASH]" — the process name with its sub-category (0583). */
  const stepName = (processId: string, subId: string | null | undefined) => {
    const base = processNames.get(processId) ?? "(process not found)";
    const sub = subId ? subNames.get(subId) : null;
    return sub ? `${base} [${sub}]` : base;
  };
  for (const p of processRows) {
    const list = routeByFabric.get(p.item_id) ?? [];
    const kind = p.process_id ? processKinds.get(p.process_id) : undefined;
    list.push({
      combo: p.combo,
      /* CARRIED SINCE 2026-09-15 — a "Component Wise" route (0528) read
         without it is every panel's steps stacked onto every weight. */
      component_id: p.component_id,
      loss_pct: p.loss_pct == null ? null : Number(p.loss_pct),
      /* 0606 — resolved per colourway by `stagesForGroup`, the same filter
         the save path's ladder walks, so the printed loss is the charged one. */
      color_losses: p.color_wise_loss ? (p.color_losses ?? null) : null,
      stage_id: p.stage_id,
      process_id: p.process_id,
      sub_category_id: p.sub_category_id,
      /* CARRIED SINCE 2026-09-16 (0564) for the same reason — a route read
         without it suppresses nothing, so a purchased cloth would be grossed
         by the knitting somebody else did. */
      is_knitting: kind?.is_knitting ?? false,
      is_dyeing: kind?.is_dyeing ?? false,
      /* 2026-09-19 — `routeForPrint`. */
      is_print: kind?.is_print ?? false,
    });
    routeByFabric.set(p.item_id, list);
  }

  /** `netReqWt` marked up by ONE (fabric, combo)'s own route — see the file
   *  header, "GROSS WEIGHT IS `netReqWt` RUN BACKWARD…". Cached per
   *  (item, combo) since every size row of one (combo, entry) group shares
   *  both. `null` — never a stored zero-loss ladder — when the fabric
   *  declares no route, or none of its declared stages cover this combo
   *  (`comboUpliftBreakdown` returning zero steps, or refusing outright). */
  type Ladder = {
    factor: number;
    lossChain: { processName: string; lossPct: number }[];
    /** The engine's sentence when the route refused this group — carried so
     *  the register can say WHY a declared route grossed nothing, rather
     *  than print the same "—" it prints for "no route". */
    refusal: string | null;
  };
  const ladderCache = new Map<string, Ladder | null>();
  function ladderFor(itemId: string, comboMapKey: string, componentIds: readonly string[]): Ladder | null {
    /* KEYED ON THE PANEL SET TOO (2026-09-15): two entries of one fabric and
       colour naming different panels are two different ladders under a
       "Component Wise" route. */
    const cacheKey = `${itemId}::${comboMapKey}::${[...componentIds].sort().join(",")}`;
    const cached = ladderCache.get(cacheKey);
    if (cached !== undefined) return cached;

    const route = [...(routeByFabric.get(itemId) ?? [])].reverse();
    let result: Ladder | null = null;
    if (route.length > 0) {
      /* THE FABRIC'S OWN SOURCE (0564) — the fourth argument, so a cloth
         bought as greige or dyed rolls is not charged for the steps its
         supplier already ran. `comboUpliftBreakdown` drops them from the
         `steps` array too, so `lossChain` below never names a stage this
         document did not pay for. */
      const ladder = comboUpliftBreakdown(
        route,
        comboMapKey,
        componentIds,
        sourceByFabric.get(itemId) ?? "yarn_knit",
        /* 2026-09-19 — an unprinted group is not charged the print stage. */
        printedGroup(printLines as PrintLine[], itemId, comboMapKey, componentIds),
      );
      if (isReportRefusal(ladder)) {
        result = { factor: 1, lossChain: [], refusal: ladder.refused };
      } else if (ladder.steps.length > 0) {
        result = {
          factor: ladder.factor,
          lossChain: ladder.steps.map((step) => ({
            processName: step.process_id
              ? stepName(step.process_id, step.sub_category_id)
              : "(process not found)",
            lossPct: step.loss_pct,
          })),
          refusal: null,
        };
      }
    }
    ladderCache.set(cacheKey, result);
    return result;
  }

  // structure_id -> combo -> gsm. A combo naming no gsm for a structure is
  // simply absent, never a stored zero.
  const gsmByStructure = new Map<string, Map<string, number>>();
  for (const c of (comboStructuresRes.data ?? []) as unknown as {
    combo: string | null;
    structures: { structure_id: string | null; gsm: number | string | null }[] | null;
  }[]) {
    for (const st of c.structures ?? []) {
      if (!st.structure_id || st.gsm == null) continue;
      const byCombo = gsmByStructure.get(st.structure_id) ?? new Map<string, number>();
      byCombo.set(c.combo ?? "", Number(st.gsm));
      gsmByStructure.set(st.structure_id, byCombo);
    }
  }
  /** One combo's declared value if this line names that combo; otherwise the
   *  structure's value ONLY if every combo declaring it agrees — the same
   *  "one distinct answer or nothing" rule `soleStyleRefNo` uses above, so an
   *  unscoped line never prints one combo's figure as if it were universal. */
  function resolveGsm(structureId: string | null, combo: string | null): number | null {
    if (!structureId) return null;
    const byCombo = gsmByStructure.get(structureId);
    if (!byCombo || byCombo.size === 0) return null;
    if (combo && byCombo.has(combo)) return byCombo.get(combo)!;
    const distinct = [...new Set(byCombo.values())];
    return distinct.length === 1 ? distinct[0] : null;
  }

  const entriesById = new Map<
    string,
    {
      style_ref_no: string | null;
      components: string[];
      componentIds: string[];
      itemForm: string | null;
      structureId: string | null;
      sizes: Map<string, { dia: string | null; purchaseWidth: number | null }>;
    }
  >();
  for (const e of entryRows) {
    const sizes = new Map<string, { dia: string | null; purchaseWidth: number | null }>();
    for (const sz of e.sizes ?? []) {
      sizes.set(sz.size_id ?? "", {
        /* READ AS TEXT AND TRIMMED, whichever shape the transport hands over
           — PostgREST returns a `numeric` as a number and a `text` as a string,
           and this column is mid-migration to text (0566). `String()` is
           correct for both, and is what keeps a pre-0566 row reading "64"
           rather than "64.00". */
        dia: sz.dia == null ? null : String(sz.dia).trim() || null,
        purchaseWidth: sz.purchase_width == null ? null : Number(sz.purchase_width),
      });
    }
    entriesById.set(e.id, {
      style_ref_no: e.style_ref_no,
      components: (e.components ?? [])
        .map((c) => c.component?.short_name ?? "")
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b)),
      componentIds: (e.components ?? []).map((c) => c.component_id).filter((id): id is string => !!id),
      itemForm: layoutTypeLabel(e.width_form) || null,
      structureId: e.structure_id,
      sizes,
    });
  }

  // Built with `components` as a Map (keyed for lookup while grouping) and
  // flattened to the exported array shape in the return statement below.
  type ColourGroupBuild = Omit<EntryRegisterColourGroup, "components"> & {
    components: Map<string, EntryRegisterComponentGroup>;
  };
  const byCombo = new Map<string, ColourGroupBuild>();
  const grandTotal = { cutQty: 0, netReqWt: 0, grossWt: 0 };

  for (const r of reqRows) {
    if (!r.item_id) continue;
    const fabricName = itemNames.get(r.item_id) ?? "(fabric not found)";
    const comboMapKey = comboKey(r.combo);

    let colourGroup = byCombo.get(comboMapKey);
    if (!colourGroup) {
      colourGroup = { combo: r.combo, components: new Map(), subtotal: { cutQty: 0, netReqWt: 0, grossWt: 0 } };
      byCombo.set(comboMapKey, colourGroup);
    }

    // THE MANUAL ENTRY IS THE COUNTING UNIT (0494) — see the file header. A
    // line-based row (`entry_id` null, `chk_ofbr_one_parent`) has no
    // component-set identity, so it gets a synthetic per-(combo, fabric)
    // bucket instead.
    const componentKey = r.entry_id ?? `${comboMapKey}::${r.item_id}`;
    const entry = r.entry_id ? entriesById.get(r.entry_id) : undefined;

    const componentIds = entry?.componentIds ?? [];
    let compGroup = colourGroup.components.get(componentKey);
    if (!compGroup) {
      const ladder = ladderFor(r.item_id, comboMapKey, componentIds);
      compGroup = {
        key: componentKey,
        componentNames: entry?.components ?? [],
        fabricName,
        itemId: r.item_id,
        gsm: resolveGsm(entry?.structureId ?? null, r.combo),
        itemForm: entry?.itemForm ?? null,
        lossChain: ladder?.lossChain ?? [],
        routeRefusal: ladder?.refusal ?? null,
        sizes: [],
        subtotal: { cutQty: 0, netReqWt: 0, grossWt: 0 },
      };
      colourGroup.components.set(componentKey, compGroup);
    }

    const sizeInfo = entry?.sizes.get(r.size_id ?? "");
    const netReqWt = r.required_qty ?? 0;
    const cut = r.basis_qty ?? 0;
    const ladder = ladderFor(r.item_id, comboMapKey, componentIds);
    /* A REFUSED ladder abstains exactly like an absent one — `grossWt =
       netReqWt`, `lossPct` null — and the group's `routeRefusal` says why. */
    const grossWt = ladder && !ladder.refusal ? netReqWt * ladder.factor : netReqWt;
    const lossPct =
      ladder && !ladder.refusal && netReqWt !== 0 ? Number(((grossWt / netReqWt - 1) * 100).toFixed(6)) : null;

    const sizeRow: EntryRegisterSizeRow = {
      sizeLabel: r.slice_label ?? "—",
      cutQty: cut,
      pieceWt: r.consumption,
      wastagePct: r.wastage_pct,
      netReqWt,
      grossWt,
      lossPct,
      dia: sizeInfo?.dia ?? null,
      purchaseWidth: sizeInfo?.purchaseWidth ?? null,
      uomCode: r.consumption_uom_id ? (uomCodes.get(r.consumption_uom_id) ?? null) : null,
      styleRefNo: r.style_ref_no ?? entry?.style_ref_no ?? null,
    };
    compGroup.sizes.push(sizeRow);
    compGroup.subtotal.cutQty += cut;
    compGroup.subtotal.netReqWt += netReqWt;
    compGroup.subtotal.grossWt += grossWt;
    colourGroup.subtotal.cutQty += cut;
    colourGroup.subtotal.netReqWt += netReqWt;
    colourGroup.subtotal.grossWt += grossWt;
    grandTotal.cutQty += cut;
    grandTotal.netReqWt += netReqWt;
    grandTotal.grossWt += grossWt;
  }

  /* THE PANEL NAMES A SPLIT ROUTE NAMES — fetched only when some step is
     component-scoped, off the same `components` master the route's FK points
     at. A unified route makes no query. */
  const componentNames = await routeComponentNames(s, processRows.map((p) => p.component_id));
  if (isReportRefusal(componentNames)) return componentNames;

  const stageLedger: StageLedgerRow[] = [];
  for (const p of processRows) {
    const base = {
      className: "Fabric" as const,
      itemName: itemNames.get(p.item_id) ?? "(fabric not found)",
      componentName: p.component_id ? (componentNames.get(p.component_id) ?? "(component not found)") : null,
      stageName: p.stage_id ? (stageNames.get(p.stage_id) ?? null) : null,
      /* 0583 — with its sub-category, "DYEING [WITH BIOWASH]". */
      processName: p.process_id && processNames.has(p.process_id) ? stepName(p.process_id, p.sub_category_id) : null,
    };
    /* 0606 — AN "ASSORT COLOR-WISE LOSS" STEP IS ITEMISED PER COLOUR (spec
       §4): one ledger line per colourway, each with its own loss. The map's
       keys are the fabric's colourways as the dialog last saved them. */
    const colourLosses = p.color_wise_loss ? Object.entries(p.color_losses ?? {}) : [];
    if (colourLosses.length) {
      for (const [combo, loss] of colourLosses.sort((a, b) => a[0].localeCompare(b[0]))) {
        stageLedger.push({ ...base, combo, lossPct: Number(loss) });
      }
      continue;
    }
    stageLedger.push({
      ...base,
      combo: p.combo || null,
      lossPct: p.loss_pct == null ? null : Number(p.loss_pct),
    });
  }
  for (const y of (yarnRes.data ?? []) as unknown as {
    item_id: string;
    stages: { stage_id: string | null; process_id: string | null; loss_pct: number | null }[] | null;
  }[]) {
    for (const st of y.stages ?? []) {
      stageLedger.push({
        className: "Yarn",
        itemName: itemNames.get(y.item_id) ?? "(yarn not found)",
        combo: null,
        componentName: null,
        stageName: st.stage_id ? (stageNames.get(st.stage_id) ?? null) : null,
        processName: st.process_id ? (processNames.get(st.process_id) ?? null) : null,
        lossPct: st.loss_pct,
      });
    }
  }

  return {
    header,
    groups: [...byCombo.values()].map((g) => ({ ...g, components: [...g.components.values()] })),
    grandTotal,
    stageLedger,
  };
}

// ---------------------------------------------------------------------------
// Report 2 — Yarn & Fabric Requirement Report
// ---------------------------------------------------------------------------

/** One fabric's contribution to one yarn's total — the drill-down drawer's
 *  own rows. Computed LIVE from the same declared inputs the stage ladder
 *  already walks (never stored — see the file header on why the ladder
 *  itself is live), so it can drift from the summed `purchaseQty` only if
 *  the order's fabrics/routes changed since the BOM was last saved. */
export type YarnFabricContribution = {
  fabricName: string;
  combo: string | null;
  /** The panel(s) this contribution was grossed for, when the fabric's route
   *  is split "Component Wise" (0528) — e.g. "FRONT BODY, BACK BODY". Null
   *  on a unified route. */
  component: string | null;
  wt: number;
};

export type YarnRequirementLine = {
  itemId: string;
  yarnName: string;
  /** GREY on every live row today — yarn is bought undyed, and dyeing is the
   *  fabric's own later stage (see the Process Stage Ledger). Not a stored
   *  column: `order_fabric_bom_yarns` names no stage of its own, so this is
   *  the one state every row is actually in, stated rather than invented. */
  stageState: "GREY";
  /** Always "YARN" — the legacy PDF's own Type column, constant on every
   *  yarn row (Type varies only in the FABRIC ledger, where it distinguishes
   *  Solid/Melange/Yarn Dyed). */
  itemType: "YARN";
  /** `material_mixings.shade` where every mixing row naming this yarn (across
   *  every fabric on THIS bom) agrees — the same "one distinct answer or
   *  nothing" abstain rule `resolveGsm` uses above. Most yarn is undyed and
   *  carries no shade at all, which is the ordinary `null` case, not a gap. */
  color: string | null;
  purchaseQty: number | null;
  uomCode: string | null;
  refusalReason: string | null;
  /** Which fabrics fed this total, unmerged — the drill-down drawer's data.
   *  Empty when nothing could be computed (e.g. a fabric's own share
   *  refused); never partial silently. */
  byFabric: YarnFabricContribution[];
};

/** One FABRIC's own step within one process section — legacy's "Details /
 *  Dia-Size / Planned / Loss % / To Ordered", per (fabric, combo). Genuinely
 *  keyed to the FABRIC (2026-09-11), not a yarn: the legacy PDF's KNITTING /
 *  DYEING / BRUSHING / COMPACTING / STENTERING sections list cloth
 *  descriptions ("SOLID 3T FLEECE BRUSHED..."), because the route this walks
 *  is `order_fabric_bom_processes` — the Fabric Process tab's own declared
 *  sequence — never a yarn-level stage (see `yarnPurchase`'s header on why). */
export type StageBreakdownLine = {
  /** The fabric's `items.id` — the IDENTITY `fabricName` is only a label for.
   *  Added for the Budget's Fabric Processes pull (0573), which keys a line
   *  to the fabric and cannot key on a name two cloths may share. */
  itemId: string | null;
  fabricName: string;
  combo: string | null;
  /** The panel(s) this line's weight belongs to under a "Component Wise"
   *  route (0528) — the branch, un-aggregated, exactly as the Fabric Process
   *  tab declared it. Null on a unified route. */
  component: string | null;
  lossPct: number;
  plannedWt: number;
  toOrderedWt: number;

  /* ---- THE LEGACY PRINTOUT'S OWN `Details` CELL AND ITS NEIGHBOURS --------
     Legacy renders one Details cell reading
       `YD SINGLE JERSEY (20'S COMBED COTTON GREEN 50% , … ) / Tubular 180 GSM`
     with `[GHGFGF554JBHHBBBHH]` beneath it, and a `Dia/Size` column beside.
     The PARTS are carried separately rather than pre-joined into one string,
     because the two renderers set them differently — the PDF puts the YD combo
     name on its own line, the screen tags it — and a renderer cannot take a
     sentence back apart. */

  /** The knitting/finishing diameter, from this fabric+combo's own Manual size
   *  rows. One distinct answer or nothing — sizes that disagree print blank
   *  rather than one size's dia standing for the block. TEXT since 0566 — see
 *  `EntryRegisterSizeRow.dia`. */
  dia: string | null;
  /** The cloth's own colour: a solid's `color_name` off the fabric line, or a
   *  yarn-dyed cloth's YD Combo Name. NOT the assort colourway — that is
   *  `combo` above, which still bands the section. Null when the line named
   *  neither. */
  fabricColour: string | null;
  /** The knitting floor's name for the yarn-dyed combination
   *  (`order_fabric_bom_yd_combinations.yd_combo_name`), printed under the
   *  Details cell. Null on a solid. */
  ydComboName: string | null;
  /** `(10'S COMBED COTTON 100%)` / `(20'S COMBED COTTON GREEN 50% , 20'S
   *  COMBED COTTON RED 33.33% …)` — the cloth's composition, colour-wise on a
   *  yarn-dyed cloth and blend-wise on a solid. Null when the master declares
   *  no composition. */
  mixingText: string | null;
  /** "Open Width" / "Tubular" — the Manual entry's own `width_form`. */
  formLabel: string | null;
  gsm: number | null;
  /** THE PIECE / METRE COUNT, for a cloth bought by the piece or the metre —
   *  legacy's `Nos/Mtrs` sub-column, which is what a flat-knit collar or cuff
   *  is actually ordered in. Null for a cloth bought by weight, where the Wt
   *  column already is the answer and a count would be a second one.
   *
   *  GROSSED BY THE SAME LADDER FACTOR AS THE WEIGHT, never its own: more
   *  pieces are knitted to survive the same losses, and two factors over one
   *  route is how a count and a weight come to disagree about the same cloth. */
  plannedNos: number | null;
  toOrderedNos: number | null;
  /** The unit `plannedNos`/`toOrderedNos` are counted in — the cloth's own
   *  `items.base_uom_id`, which is the unit it is BOUGHT in. (The weight
   *  columns are kilograms; see 0562.) */
  nosUomCode: string | null;
  /** The print the order names for this group ("AOP") — set on a PRINT
   *  section's lines only (2026-09-19). */
  printName?: string | null;
  /** GARMENTS CUT and kg of cloth PER GARMENT (before wastage) — PRINT lines
   *  only, for the Printing Requirement (client 2026-09-19, 1A). See
   *  `PrintRequirementRow` in ./print-route.ts. */
  cutPieces?: number | null;
  pieceWt?: number | null;
};

/**
 * One colour of one yarn in the YARN DYEING block — the legacy printout's
 * second Yarn Requirement section, under YARN PURCHASE.
 *
 * ## IT IS THE KNITTING GROSS, SPLIT BY THE MIXING % ALREADY DERIVED
 *
 * `plannedWt` is the yarn's gross-at-knitting for the cloth this repeat
 * belongs to, times that repeat's `mixing_pct` — `mixingDetailRows`
 * (./yarn-dyed.ts) owns that percentage and is called here rather than
 * re-derived, so the dye house's weight and the panel the planner typed it on
 * can never disagree. Legacy's own numbers are the shape: 1021.000 kg of
 * single jersey splitting 50 / 33.33 / 16.67 into 510.500 / 340.299 / 170.201.
 *
 * ## THE COLOUR NAME COMES FROM THE COMBINATION, NOT THE REPEAT
 *
 * A repeat is a stripe POSITION (`mixingDetailRows` labels them "Color 1",
 * "Color 2"… and says at length why), and the actual colour standing at that
 * position is per assort colourway — `order_fabric_bom_yd_combination_colors`
 * (0560), ordered by its own `sno`. So the name is looked up BY POSITION in
 * the combination for this line's combo. A position the combination does not
 * reach keeps the positional label rather than borrowing another combo's
 * colour.
 *
 * ## EACH COLOUR CARRIES ITS OWN DYEING LOSS (0568)
 *
 * The legacy PDF carries a DIFFERENT dyeing loss per colour (GREEN 5.00, RED
 * 4.00, WHITE 3.00), and so does this block: `lossPct` is the shade's own
 * `order_fabric_bom_yd_combination_colors.dyeing_loss_pct`, typed on Yarn
 * Dyed Details beside the colour it is a property of. (This paragraph used to
 * say no column could hold it; 0568 added one and the comment lagged.) A
 * colour-wise STEP loss (0606) is a different axis — per ASSORT colourway, on
 * a route step — and reaches the stage sections, not this block. `lossPct` 0
 * is real: no dye loss was declared for that shade.
 */
export type YarnDyeingLine = {
  yarnItemId: string;
  yarnName: string;
  /** The actual colour at this stripe position for this colourway, e.g.
   *  "GREEN" — or the positional label when the combination does not name
   *  one. */
  colorName: string;
  /** The assort colourway this dyeing belongs to. */
  combo: string | null;
  /** This colour's share of the CLOTH, 0-100 (`MixingDetailRow.mixing_pct`). */
  mixingPct: number;
  plannedWt: number;
  lossPct: number;
  toOrderedWt: number;
  uomCode: string | null;
};

/** One Assort Colour's total within one process section — "downstream
 *  process ledgers group and total weights under each Assort Color header"
 *  (client spec, 2026-09-15). Always computed; a renderer draws the colour
 *  band only when a section holds more than one colour. */
export type StageColourSubtotal = {
  combo: string | null;
  plannedTotal: number;
  toOrderedTotal: number;
};

export type StageBreakdownGroup = {
  /**
   * `processes.id` — THE GROUP'S IDENTITY, and what a renderer must key on.
   *
   * `processName` is a LABEL and cannot be one. Two processes may legitimately
   * be named the same ("COMPACTING" on two commodities), and an unresolved
   * name collapses every group onto the one string `"(process not found)"` —
   * which is how this arrived: 0564 added `processes.is_knitting`, the select
   * below started asking for it before the migration was applied, PostgREST
   * answered 42703, and all four sections rendered under one name. React then
   * refused the duplicate keys, and the on-screen collapse toggle — also keyed
   * by name — folded all four sections at once.
   */
  processId: string;
  processName: string;
  /** Is this a PRINT process (`processes.is_print`)? (2026-09-19) — the
   *  Printing Requirement tab lifts exactly these sections out. */
  isPrint?: boolean;
  /** Does this step BUY the cloth (`processes.is_cloth_purchase`, 0583)?
   *  (2026-09-21) — the Budget's Process Rates leave exactly these sections
   *  out: the cloth is costed ONCE, on Purchase Rates, at the roll weight
   *  `clothPurchase` states (client: "Fabric Purchase … appearing inside the
   *  Process Rates section as well … double-counting"). Printed here still —
   *  its loss is the purchase loss, and the buyer reads it off this ledger. */
  isClothPurchase?: boolean;
  /** THE STAGES THIS PROCESS'S STEPS RUN IN (2026-09-20) — for the report's
   *  stage colours (`sectionStyle` in ./report-colours.ts). Usually one;
   *  COMPACTING after dyeing and after printing is two. Empty when no step
   *  named a stage. */
  stages?: { id: string; code: string | null; name: string }[];
  /** SORTED BY COLOUR, THEN COMPONENT, THEN FABRIC — so the colour subtotals
   *  in `byColour` sit under contiguous runs, never interleaved. */
  lines: StageBreakdownLine[];
  byColour: StageColourSubtotal[];
  plannedTotal: number;
  toOrderedTotal: number;
};

/**
 * ONE LINE OF THE FABRIC PURCHASE REQUIREMENT — the demand that REPLACES the
 * yarn for a cloth the factory does not knit (0564,
 * `doc/order/fabriprocess.md` §2).
 *
 * "On the Material Requirement Sheet, the demand shifts directly to Greige
 * Fabric Roll Weight (in Kg) rather than raw grey yarn." That is what this
 * section is: `purchaseWt` is the cutting-floor net grossed by the fabric's
 * route with Knitting (and, for `dyed_purchase`, Dyeing) suppressed — the
 * losses the factory still incurs after the roll lands, and no others.
 *
 * ## THE UNIT IS READ, NOT NAMED
 *
 * `uomCode` comes off `order_fabric_bom_requirements.consumption_uom_id`,
 * which is the kilogram on every row this app writes (0562). §2 asks for
 * kilograms and this is kilograms — but it is kilograms because the stored
 * row says so, not because the word appears in a spec. A report that
 * hard-codes a unit keeps printing it after the unit changes.
 *
 * ## IT IS NOT AGGREGATED ACROSS COLOURWAYS AND THAT IS DELIBERATE
 *
 * A greige roll order is placed per colour lot exactly as a yarn purchase is
 * (`yarnPurchase` rounds per colourway "because a purchase per colour is a
 * real lot"), and a component-wise route grosses two panels differently. One
 * line per (fabric, colourway, branch) is the grain those decisions were made
 * at; a renderer that wants one line per fabric can sum these, and one that
 * sums them for the operator has thrown away the split it would need to
 * place the order.
 */
export type ClothPurchaseLine = {
  fabricId: string;
  fabricName: string;
  source: FabricSource;
  /** "Greige Fabric Roll Weight" / "Dyed Fabric Roll Weight" — the heading
   *  this line belongs under, from `clothPurchaseLabel`. Never invented at
   *  the renderer: the two sources buy physically different cloth. */
  label: string;
  combo: string | null;
  /** The panel(s) this weight belongs to under a "Component Wise" route —
   *  same meaning as `StageBreakdownLine.component`, null on a unified one. */
  component: string | null;
  /** The cutting-floor requirement, before the route's own losses. */
  netWt: number;
  /** What to buy. */
  purchaseWt: number;
  uomCode: string | null;
};

export type YarnFabricRequirementReport = {
  header: BomDocHeader;
  yarns: YarnRequirementLine[];
  /** Sum of `purchaseQty` across every yarn sharing ONE unit — null (never a
   *  guess) the moment two yarns are stored in different units, the same
   *  "cannot be added" refusal `yarnPurchase` itself makes one level down. */
  yarnGrandTotal: { qty: number; uomCode: string | null } | null;
  /** The YARN DYEING block — see `YarnDyeingLine`. Empty when this BOM's
   *  cloths declare no yarn-dyed repeats, which is every all-solid document;
   *  a renderer draws no section rather than an empty one. */
  yarnDyeing: YarnDyeingLine[];
  /** Plan and To Ordered summed across `yarnDyeing`, on the same "one unit or
   *  nothing" rule as `yarnGrandTotal`. */
  yarnDyeingTotal: { plannedWt: number; toOrderedWt: number; uomCode: string | null } | null;
  /** THE FABRIC PURCHASE REQUIREMENT (0564) — see `ClothPurchaseLine`. Empty
   *  on an all-Rule-1 document, which is every BOM in this database before
   *  today; a renderer draws no section rather than an empty one, the same
   *  way `yarnDyeing` is handled. */
  clothPurchase: ClothPurchaseLine[];
  /** Summed across `clothPurchase` on the same "one unit or nothing" rule as
   *  `yarnGrandTotal` — never kilograms added onto metres. */
  clothPurchaseTotal: { qty: number; uomCode: string | null } | null;
  /** CHRONOLOGICAL — Knitting first, the last-declared finishing stage last,
   *  by each process's own lowest `sno` on `order_fabric_bom_processes`
   *  (the order the Fabric Process tab was typed in, and the legacy PDF's own
   *  section order: KNITTING, DYEING, BRUSHING, COMPACTING, STENTERING).
   *  Never alphabetical and never Map insertion order, both of which would
   *  scatter the sections a mill supervisor reads top-to-bottom. */
  stageBreakdown: StageBreakdownGroup[];
  /**
   * THE PRINTING REQUIREMENT (client 2026-09-19) — the PRINT sections of
   * `stageBreakdown`, lifted out: per colourway, the weight SENT to the
   * printer (the step's input, `toOrderedWt` in the backward walk) and the
   * weight coming back (its output, `plannedWt`). Printed groups only, because
   * `routeForPrint` keeps the print stage out of every unprinted group's
   * ladder. Empty when no route prints.
   */
  printing: PrintRequirement;
  /**
   * THE FABRIC ALLOCATION (CUTTING) SECTION (client 2026-09-19, 3A) — the
   * report's last block: per colourway, component set and dia, the cloth that
   * reaches the cutting table (net of and including cutting wastage). Read off
   * the Entry Register rather than re-derived — see
   * `./fabric-allocation-report.ts`. The register's own refusal, when it has
   * one, stands in its place: the rest of this report does not depend on it.
   */
  allocation: FabricAllocation | ReportRefusal;
  /** WEIGHTS THE LEDGER COULD NOT PLACE, in the engine's own words — an
   *  entry whose panels run different "Component Wise" routes, or a loss out
   *  of range. Listed under the ledger rather than dropped: a section that
   *  is silently short of one entry's weight reads as a complete answer,
   *  which is this file's named worst failure. */
  stageLedgerRefusals: string[];
};

export async function yarnFabricRequirementReport(
  bomId: string,
): Promise<YarnFabricRequirementReport | ReportRefusal> {
  /* THE REGISTER STARTS FIRST AND IS AWAITED LAST (2026-09-24, "T&A tab takes
     2 seconds" — the Fabric BOM T&A tab reads this report). It needs nothing
     but `bomId`, and it used to begin only after every read below had
     finished, adding its own chain of round trips to the end of this one. The
     `.catch` only marks the promise handled for the early refusals that never
     await it; the `await` at the bottom still sees any rejection. */
  const registerP = fabricBomEntryRegister(bomId);
  registerP.catch(() => {});

  const s = await createClient();

  /* THE YARN SUMMARY TABLE READS STORED FIGURES ONLY — see the file header.
     `purchase_qty` is what a yarn purchase order is actually raised against,
     computed by `writeYarns` at Save time from this exact same route data
     (`yarnPurchase`, 2026-09-11). The STAGE LEDGER below, by contrast, is
     genuinely live-computed — it has never been persisted in ladder form (see
     `comboUpliftBreakdown`'s header), so there is nothing stored to read.
     Read beside the header, not after it: it keys on `bomId` alone. */
  const [header, { data: yarnRows, error: yarnErr }] = await Promise.all([
    loadBomDocHeader(bomId),
    s
      .from("order_fabric_bom_yarns")
      .select("item_id, purchase_qty, uom_id, refusal_reason, stages:order_fabric_bom_yarn_stages(loss_pct)")
      .eq("bom_id", bomId),
  ]);
  if (isReportRefusal(header)) return header;

  if (yarnErr) return { refused: `Could not read the yarn purchase rows: ${yarnErr.message}` };

  const rows = (yarnRows ?? []) as unknown as {
    item_id: string;
    purchase_qty: number | null;
    uom_id: string | null;
    refusal_reason: string | null;
    stages: { loss_pct: number | string | null }[] | null;
  }[];

  /* THE YARN'S OWN TREATMENTS, COMPOUNDED — `/(1-L)` per stage, sequentially,
     which is `comboUplift`'s form and `yarnPurchase`'s own reading of the same
     rows. Read here for the YARN DYEING block's To Ordered column. A loss at
     or past 100% is skipped rather than dividing by zero: the column that
     stores it already refuses one (`check (loss_pct >= 0 and loss_pct < 100)`),
     so this is a guard against a value no writer can produce, not a branch. */
  const yarnOwnFactor = new Map<string, number>();
  for (const r of rows) {
    let factor = 1;
    for (const st of r.stages ?? []) {
      const loss = st.loss_pct == null ? 0 : Number(st.loss_pct);
      if (!Number.isFinite(loss) || loss <= 0 || loss >= 100) continue;
      factor /= 1 - loss / 100;
    }
    yarnOwnFactor.set(r.item_id, factor);
  }

  /* THE "NO YARN STORED" REFUSAL MOVED DOWN ON 2026-09-16 (0564), AND THE
     REASON IS THE WHOLE POINT OF DEFAULT RULE 2.
     It used to fire here, before anything else was read, on the reasonable
     assumption that a Fabric BOM with no yarn rows had not been computed yet.
     Under Rule 2 that assumption is false: a document whose every fabric is
     bought as greige or dyed rolls has no yarn to store and never will, and
     refusing it would hide the one section it DOES have — the fabric purchase
     requirement that replaced the yarn. So the verdict waits until the
     fabrics' sources have been read, a few dozen lines down, where the two
     cases can be told apart. */
  const noStoredYarn = rows.length === 0;

  const yarnItemIds = [...new Set(rows.map((r) => r.item_id))];
  const uomIds = [...new Set(rows.map((r) => r.uom_id).filter(Boolean))] as string[];

  /* THE STAGE LEDGER'S OWN INPUTS — the fabric's net (summed
     `required_qty`, i.e. the Manual tab's already-lossed cutting requirement,
     per (fabric, combo)) and that fabric's OWN declared route. Both are
     stored, declarative facts; only the LADDER built from them is computed
     here. */
  const [reqRes, uomRes, entryRes, lineRes, ydRepeatRes, ydComboRes, comboStructRes, scopeRes] = await Promise.all([
    s
      /* `consumption_uom_id` JOINED THE SELECT ON 2026-09-16 (0564) for the
         FABRIC PURCHASE section's unit. It is the kilogram on every row this
         app writes (0562) — read rather than assumed, because a report that
         hard-codes a unit is a report that keeps printing it after the unit
         changes. */
      .from("order_fabric_bom_requirements")
      /* `consumption` JOINED 2026-09-19 for the Printing Requirement's Piece
         Wt (client decision 1A) — kg per garment, checked live against every
         row: required_qty = basis_qty x consumption x (1 + wastage%). */
      .select("item_id, combo, required_qty, entry_id, size_id, style_ref_no, basis_qty, consumption, consumption_uom_id")
      .eq("bom_id", bomId),
    uomIds.length ? s.from("uoms").select("id, code").in("id", uomIds) : Promise.resolve({ data: [], error: null }),
    /* WHICH PANELS EACH ENTRY COVERS — what a "Component Wise" route (0528)
       is resolved against. The requirement row itself names only its entry.
       ITS SIZES RIDE ALONG since 2026-09-16, for the legacy printout's
       `Dia/Size` and `Nos/Mtrs` columns: `cons_qty` (cloth units per garment)
       is folded into the requirement's stored `consumption` and so cannot be
       recovered from the requirement row alone. */
    s
      .from("order_fabric_bom_manual_entries")
      .select(
        "id, item_id, yd_part, width_form, structure_id, " +
          "components:order_fabric_bom_manual_components(component_id), " +
          "sizes:order_fabric_bom_manual_sizes(size_id, dia, cons_qty)",
      )
      .eq("bom_id", bomId),
    /* THE CLOTH'S OWN COLOUR — a solid's `color_name`, typed on the fabric
       LINE (the yarn-dyed case is answered by the combinations below). */
    /* `component_id, required_print` JOINED 2026-09-19 — which groups print
       (`printedGroup`), for the ladder and the Printing section. */
    s.from("order_fabric_bom_lines").select("item_id, combo, color_name, component_id, required_print").eq("bom_id", bomId),
    /* THE YARN-DYED SPLIT (0512) — the stripes, and (0560) the colours each
       colourway puts at each stripe position. Both feed the YARN DYEING block
       and the colour-wise Mixing % inside a Details cell. */
    s
      .from("order_fabric_bom_yd_repeats")
      .select("item_id, yd_part, sno, yarn_item_id, dye_type, color_name, uom_id, value, twisted_yarn")
      .eq("bom_id", bomId)
      .order("sno", { ascending: true }),
    s
      .from("order_fabric_bom_yd_combinations")
      .select(
        "item_id, yd_part, combo, yd_combo_name, " +
          /* `dyeing_loss_pct` RIDES ALONG (0568) — the same rows this select
             already fetched for their colour NAMES, so the shade and the loss
             that is a property of it cannot be read from two different places. */
          "colors:order_fabric_bom_yd_combination_colors(sno, yarn_color, dyeing_loss_pct)",
      )
      .eq("bom_id", bomId),
    /* THE ORDER'S OWN GSM, per (structure, combo) — the same read Report 1
       makes, for the same `/ Tubular 180 GSM` tail on the Details cell. */
    s
      .from("garment_order_amendment_combos")
      .select("combo, structures:garment_order_amendment_combo_structures(structure_id, gsm)")
      .eq("amendment_id", header.garmentOrderId),
    /* WHERE EACH FABRIC COMES FROM (0564) — Default Rule 1 vs Rule 2. It
       decides three things on this document: which steps the stage ledger
       walks, whether a cloth's gross is split across its yarns at all, and
       whether it raises a FABRIC PURCHASE line instead. */
    fetchFabricSources(s, bomId),
  ]);
  if (reqRes.error) return { refused: `Could not read the requirement rows: ${reqRes.error.message}` };
  if (entryRes.error) return { refused: `Could not read the BOM's entries: ${entryRes.error.message}` };
  if (lineRes.error) return { refused: `Could not read the fabric lines: ${lineRes.error.message}` };
  if (ydRepeatRes.error) return { refused: `Could not read the yarn-dyed repeats: ${ydRepeatRes.error.message}` };
  if (ydComboRes.error) return { refused: `Could not read the yarn-dyed combinations: ${ydComboRes.error.message}` };
  if (comboStructRes.error) return { refused: `Could not read the order's GSM: ${comboStructRes.error.message}` };
  /* READ, NOT COALESCED AWAY — see Report 1's identical guard. A failure here
     would make every purchased cloth read as knitted in-house, printing yarn
     it does not buy and omitting the roll weight it does. */
  if (scopeRes.error) return { refused: `Could not read each fabric's source: ${scopeRes.error.message}` };

  /** EACH FABRIC'S OWN SOURCE (0564); absence is Rule 1. */
  const sourceByFabric = new Map<string, FabricSource>(
    ((scopeRes.data ?? []) as { item_id: string; source: string | null }[]).map((r) => [
      r.item_id,
      asFabricSource(r.source),
    ]),
  );
  const sourceOf = (fabricId: string): FabricSource => sourceByFabric.get(fabricId) ?? "yarn_knit";

  /* THE VERDICT THE GUARD ABOVE DEFERRED. No yarn rows AND no fabric bought
     as cloth means the BOM genuinely has not been computed; no yarn rows WITH
     a purchased fabric is Rule 2 working exactly as asked, and the report
     goes on to print the roll weights. */
  if (noStoredYarn && ![...sourceByFabric.values()].some((src) => !sourceBuysYarn(src))) {
    return {
      refused:
        "This Fabric BOM has no stored yarn purchase yet — open Yarn Process and save, so the figures this report prints are the ones that were approved.",
    };
  }

  const reqRows = (reqRes.data ?? []) as unknown as {
    item_id: string | null;
    combo: string | null;
    required_qty: number | null;
    entry_id: string | null;
    size_id: string | null;
    style_ref_no: string | null;
    basis_qty: number | null;
    consumption: number | null;
    consumption_uom_id: string | null;
  }[];
  /** The unit the requirement is stored in — the kilogram (0562), read from
   *  the rows rather than assumed. One distinct answer or nothing, the same
   *  abstain rule this file applies to GSM and to Style Ref No. */
  const reqUomIds = [...new Set(reqRows.map((r) => r.consumption_uom_id).filter(Boolean))] as string[];
  type EntryFacts = {
    itemId: string | null;
    widthForm: string | null;
    structureId: string | null;
    panels: string[];
    sizes: Map<string, { dia: string | null; consQty: number }>;
  };
  const entryFacts = new Map<string, EntryFacts>(
    (
      (entryRes.data ?? []) as unknown as {
        id: string;
        item_id: string | null;
        width_form: string | null;
        structure_id: string | null;
        components: { component_id: string | null }[] | null;
        sizes: { size_id: string | null; dia: number | string | null; cons_qty: number | string | null }[] | null;
      }[]
    ).map((e) => [
      e.id,
      {
        itemId: e.item_id,
        widthForm: e.width_form,
        structureId: e.structure_id,
        panels: (e.components ?? []).map((c) => c.component_id).filter((id): id is string => !!id),
        sizes: new Map(
          (e.sizes ?? [])
            .filter((sz) => !!sz.size_id)
            .map((sz) => [
              sz.size_id as string,
              {
                dia: sz.dia == null ? null : String(sz.dia).trim() || null,
                /* `consQtyOf`'s OWN RULE — null means one, never zero. Read
                   through the same reading `manual.ts` states, so a blank cell
                   counts a garment's one piece of cloth here too. */
                consQty: sz.cons_qty == null ? 1 : Number(sz.cons_qty),
              },
            ]),
        ),
      },
    ]),
  );
  const panelsByEntry = new Map<string, string[]>([...entryFacts].map(([id, e]) => [id, e.panels]));

  /* WHICH YD PART EACH ENTRY WEIGHS (0596). A Top and a Bottom knitted from one
     yarn-dyed cloth to different stripe ratios are two instances of that cloth
     for everything stripe-shaped below — Mixing Details, the Details cell's
     colour-wise text, the YD combination name and the YARN DYEING block. */
  const partByEntry = new Map<string, string>(
    ((entryRes.data ?? []) as unknown as { id: string; yd_part: string | null }[]).map((e) => [
      e.id,
      ydPartKey(e.yd_part),
    ]),
  );
  /** THE STRIPE ADDRESS OF ONE CLOTH INSTANCE — the fabric id alone when it has
   *  no part (so every document before 0596 keys exactly as it did), else the
   *  fabric and its part. */
  const ydInstance = (fabricId: string, part: string) => (part ? `${fabricId}#${part}` : fabricId);

  /* NET PER (FABRIC, COMBO, ENTRY-PANELS) — the panel set is part of the key
     since 2026-09-15, because under a "Component Wise" route two entries of
     one fabric and colour naming different panels are grossed by DIFFERENT
     ladders. Collapsed to (fabric, combo, resolved branch) once the route is
     known, a few lines down. */
  /* THE COUNT AND THE DIA RIDE WITH THE NET, because they are summed and
     agreed over exactly the same rows it is. `nos` is Σ (Cut Qty x cloth units
     per garment) — the piece or metre count legacy prints for a flat-knit
     collar; `dias` collects the distinct answers so the block can abstain
     rather than print one size's dia as the block's. */
  /* `dias` IS A SET OF STRINGS SINCE 0566. The abstain below is unchanged —
     one distinct answer or nothing — and it reads a shade stricter on text:
     "64" and "64 CM" are two answers where two numerics 64 and 64.00 were one.
     That is the right stricter, because the unit is now part of what the
     planner said. */
  /* `garments` / `consWt` (2026-09-19) — for the Printing Requirement's Cut
     Pcs and Piece Wt (client 1A), over the same rows as `net`.

     GARMENTS ARE COUNTED ONCE PER (STYLE, SIZE), NEVER SUMMED ACROSS ENTRIES.
     A body and its sleeves are often two Manual entries of one cloth, and each
     entry's rows carry the SAME garments — summing them would double the count
     and halve the piece weight. So the count keeps the largest `basis_qty` seen
     for a (style, size), while `consWt` (Σ basis x consumption, the cloth BEFORE
     wastage) does sum across panels: body + sleeves is the garment's cloth. */
  type NetSlice = {
    net: number;
    nos: number;
    garments: Map<string, number>;
    consWt: number;
    dias: Set<string>;
    panels: string[];
    /** YD PART (0596) — "" for the cloth's only part. */
    part: string;
  };

  const netByFabricComboPanels = new Map<string, Map<string, Map<string, NetSlice>>>();
  const structureByFabric = new Map<string, string>();
  const widthFormByFabric = new Map<string, string>();
  for (const r of reqRows) {
    if (!r.item_id) continue;
    const byCombo = netByFabricComboPanels.get(r.item_id) ?? new Map<string, Map<string, NetSlice>>();
    const key = r.combo ?? "";
    const byPanels = byCombo.get(key) ?? new Map<string, NetSlice>();
    const entry = r.entry_id ? entryFacts.get(r.entry_id) : undefined;
    const panels = entry?.panels ?? [];
    /* THE PART IS IN THE KEY (0596) — a Top and a Bottom of one cloth are
       grossed alike but dyed to different stripes, so they must not sum here. */
    const part = r.entry_id ? (partByEntry.get(r.entry_id) ?? "") : "";
    const panelKey = `${part}|${[...panels].sort().join(",")}`;
    const held = byPanels.get(panelKey) ?? {
      net: 0,
      nos: 0,
      garments: new Map<string, number>(),
      consWt: 0,
      dias: new Set<string>(),
      panels,
      part,
    };
    held.net += r.required_qty ?? 0;
    /* Within ONE entry a (style, size) appears once, so this adds; across
       entries `mergeGarmentCounts` keeps the max. */
    const gKey = garmentKey(r.style_ref_no, r.size_id);
    held.garments.set(gKey, (held.garments.get(gKey) ?? 0) + (r.basis_qty ?? 0));
    held.consWt += (r.basis_qty ?? 0) * (r.consumption ?? 0);
    const size = entry && r.size_id ? entry.sizes.get(r.size_id) : undefined;
    /* A REFUSED ROW CARRIES `basis_qty` 0 and contributes nothing, which is
       right: it has no weight either. */
    if (size) {
      held.nos += (r.basis_qty ?? 0) * size.consQty;
      if (size.dia != null) held.dias.add(size.dia);
    }
    byPanels.set(panelKey, held);
    byCombo.set(key, byPanels);
    netByFabricComboPanels.set(r.item_id, byCombo);
    if (entry?.structureId) structureByFabric.set(r.item_id, entry.structureId);
    if (entry?.widthForm) widthFormByFabric.set(r.item_id, entry.widthForm);
  }

  const fabricItemIds = [...netByFabricComboPanels.keys()];
  const processesRes = fabricItemIds.length
    ? await s
        .from("order_fabric_bom_processes")
        .select("item_id, combo, component_id, sno, stage_id, process_id, sub_category_id, loss_pct, color_wise_loss, color_losses")
        .eq("bom_id", bomId)
        .in("item_id", fabricItemIds)
        .order("sno", { ascending: true })
    : { data: [] as unknown[], error: null };
  if ((processesRes as { error: { message: string } | null }).error) {
    return {
      refused: `Could not read the process ledger: ${(processesRes as { error: { message: string } }).error.message}`,
    };
  }

  const routeRows = (processesRes.data ?? []) as unknown as {
    item_id: string;
    combo: string | null;
    component_id: string | null;
    sno: number;
    loss_pct: string | number | null;
    stage_id: string | null;
    process_id: string | null;
    sub_category_id: string | null;
    color_wise_loss?: boolean | null;
    color_losses?: Record<string, number> | null;
  }[];
  /* KEPT IN ASCENDING `sno` (fetch order) — CHRONOLOGICAL, Knitting first.
     `sno` is also how `minSnoByProcess` (below) orders the display groups. */
  const routeByFabric = new Map<string, (RouteStage & { sno: number })[]>();
  const minSnoByProcess = new Map<string, number>();
  for (const p of routeRows) {
    if (!p.process_id) continue;
    const list = routeByFabric.get(p.item_id) ?? [];
    list.push({
      combo: p.combo,
      /* CARRIED SINCE 2026-09-15 — see `stagesForGroup` for what a route
         read without it did to every weight. */
      component_id: p.component_id,
      loss_pct: p.loss_pct == null ? null : Number(p.loss_pct),
      /* 0606 — see the Entry Register's route builder above. */
      color_losses: p.color_wise_loss ? (p.color_losses ?? null) : null,
      /* CARRIED SINCE 2026-09-19 — `routeForPrint` finds the print STAGE by
         it. The save path's route (`routesByFabricOf`) always carried it, so
         this is the report catching up, not a new reading. */
      stage_id: p.stage_id,
      process_id: p.process_id,
      sub_category_id: p.sub_category_id,
      sno: p.sno,
    });
    routeByFabric.set(p.item_id, list);
    minSnoByProcess.set(p.process_id, Math.min(minSnoByProcess.get(p.process_id) ?? Infinity, p.sno));
  }

  /* THE DRILL-DOWN'S OWN INPUT — `material_mixings`, fetched directly rather
     than through `getBomYarnComposition` (service.ts) so `shade` can ride
     along in the same query; that helper's own callers don't need it and
     widening its shape for one reader risks it drifting for the others. */
  const mixRes = fabricItemIds.length
    ? await s.from("material_mixings").select("item_id, component_item_id, blend_pct, shade").in("item_id", fabricItemIds)
    : { data: [] as unknown[], error: null };
  const mixRows = (mixRes.data ?? []) as unknown as {
    item_id: string | null;
    component_item_id: string | null;
    blend_pct: number | null;
    shade: string | null;
  }[];
  const compositionByFabric = new Map<string, { fabric_id: string; fabric_name: string; components: { yarn_id: string; blend_pct: number | null }[] }>();
  const shadesByYarn = new Map<string, Set<string>>();
  for (const m of mixRows) {
    if (!m.item_id || !m.component_item_id) continue;
    const comp = compositionByFabric.get(m.item_id) ?? {
      fabric_id: m.item_id,
      fabric_name: "", // filled in below, once `itemNames` exists
      components: [],
    };
    comp.components.push({ yarn_id: m.component_item_id, blend_pct: m.blend_pct });
    compositionByFabric.set(m.item_id, comp);
    if (m.shade) {
      const set = shadesByYarn.get(m.component_item_id) ?? new Set<string>();
      set.add(m.shade);
      shadesByYarn.set(m.component_item_id, set);
    }
  }

  const allItemIds = [...new Set([...yarnItemIds, ...fabricItemIds])];
  const processIds = [...new Set(routeRows.map((p) => p.process_id).filter(Boolean))] as string[];
  const [itemRes, processRes, stageRes] = await Promise.all([
    /* `base_uom_id` IS THE CLOTH'S BUYING UNIT and is read for exactly one
       purpose: labelling the `Nos/Mtrs` count. It is NOT the unit of any
       weight on this document — those are kilograms by construction (0562),
       which is the confusion this select's own comment exists to stop
       recurring. */
    allItemIds.length
      ? s.from("items").select("id, name, base_uom_id").in("id", allItemIds)
      : Promise.resolve({ data: [], error: null }),
    /* THE KIND FLAGS RIDE ALONG (0564) — two more columns on the rows this
       select already fetched for their NAMES. See Report 1's identical note
       on why this is not a second query. */
    processIds.length
      ? fetchProcessKindRows(s, processIds)
      : Promise.resolve({ data: [], error: null }),
    /* THE FABRIC STAGES (2026-09-19) — code + name, so `stageRank` can tell
       which sections are greige and merge their colourways. A failed read
       merges nothing: the ledger stays per colourway, as it always was. */
    s.from("config_lookups").select("id, code, name").eq("kind", "fabric_stage"),
  ]);

  const itemRows = (itemRes.data ?? []) as { id: string; name: string; base_uom_id: string | null }[];
  const itemNames = new Map<string, string>(itemRows.map((r) => [r.id, r.name]));
  const baseUomByItem = new Map<string, string>(
    itemRows.filter((r) => !!r.base_uom_id).map((r) => [r.id, r.base_uom_id as string]),
  );
  const uomCodes = new Map<string, string>(((uomRes.data ?? []) as { id: string; code: string }[]).map((r) => [r.id, r.code]));
  /* NOT A HARD REFUSE HERE, DELIBERATELY, AND THE DIFFERENCE FROM REPORT 1 IS
     THE POINT. This report already carries `stageLedgerRefusals` (below), which
     names the failure ON the page while the figures — which do not depend on
     any process NAME — still print. A `return { refused }` here was written and
     removed on 2026-09-16: it blanked a document whose arithmetic was entirely
     sound because a label lookup failed. Report 1 has no such channel, so there
     it refuses. Same failure, two correct answers, decided by whether the page
     can say so itself. */
  const processMasterRows = (processRes.data ?? []) as {
    id: string;
    name: string;
    is_knitting: boolean | null;
    is_dyeing: boolean | null;
    is_print: boolean | null;
    is_cloth_purchase: boolean | null;
  }[];
  const processNames = new Map<string, string>(processMasterRows.map((r) => [r.id, r.name]));
  /** WHAT KIND OF STEP EACH PROCESS IS (0564) — see `./fabric-source.ts`. */
  const processKinds = new Map<
    string,
    { is_knitting: boolean; is_dyeing: boolean; is_print: boolean; is_cloth_purchase: boolean }
  >(
    processMasterRows.map((r) => [
      r.id,
      {
        is_knitting: r.is_knitting ?? false,
        is_dyeing: r.is_dyeing ?? false,
        is_print: r.is_print ?? false,
        is_cloth_purchase: r.is_cloth_purchase ?? false,
      },
    ]),
  );
  /* 0583 — "DYEING [WITH BIOWASH]" section headings. */
  const subNames = await fetchSubCategoryNames(s, routeRows.map((p) => p.sub_category_id));
  /* WHICH GROUPS PRINT (2026-09-19) — off the lines this report already read. */
  const printLines = (lineRes.data ?? []) as unknown as PrintLine[];
  /* THE ROUTE'S OWN KIND FLAGS, STAMPED AFTER THE FACT — `routeByFabric` is
     built above, before the `processes` master has been read (it is the source
     of `processIds`), so the two cannot be assembled in one pass without a
     third query. Stamped in place rather than rebuilt: the array's ORDER is
     ascending `sno` and is load-bearing for the backward walk below. */
  for (const list of routeByFabric.values()) {
    for (const st of list) {
      const kind = st.process_id ? processKinds.get(st.process_id) : undefined;
      st.is_knitting = kind?.is_knitting ?? false;
      st.is_dyeing = kind?.is_dyeing ?? false;
      st.is_print = kind?.is_print ?? false;
    }
  }
  // Real fabric names into the compositions built above, now that they exist.
  for (const comp of compositionByFabric.values()) comp.fabric_name = itemNames.get(comp.fabric_id) ?? "(fabric not found)";

  /* THE CLOTHS' BUYING UNITS, resolved to codes. A second `uoms` read rather
     than widening the one above: that one is keyed on the requirement rows'
     own unit (now always the kilogram), and these are a different set. */
  const baseUomIds = [
    ...new Set([...baseUomByItem.values(), ...reqUomIds]),
  ].filter((id) => !uomCodes.has(id));
  if (baseUomIds.length) {
    const { data: extraUoms, error: extraErr } = await s.from("uoms").select("id, code").in("id", baseUomIds);
    if (extraErr) return { refused: `Could not read the cloths' units: ${extraErr.message}` };
    for (const u of (extraUoms ?? []) as { id: string; code: string }[]) uomCodes.set(u.id, u.code);
  }
  /* THE WEIGHT COLUMNS' OWN UNIT (0564) — the requirement's, which is the
     kilogram. One distinct answer or nothing: a BOM whose requirement rows
     somehow carry two units prints no unit rather than one of them, the same
     way `yarnGrandTotal` refuses to add across units one section down. */
  const reqUomCode = reqUomIds.length === 1 ? (uomCodes.get(reqUomIds[0]) ?? null) : null;
  /* A COUNT IS ONLY PRINTED FOR A CLOTH BOUGHT BY THE PIECE OR THE METRE.
     Where the cloth is bought by weight the Wt column already IS the answer,
     and a second figure beside it in the same unit invites the reader to add
     them. Matched by CODE against the live master's own vocabulary (CONE, DZN,
     GROSS, KGS, LTR, MTR, NOS, PCS). */
  const COUNTED_UNITS = new Set(["NOS", "PCS", "MTR", "MTRS", "METER", "METERS", "METRE", "METRES", "DZN", "GROSS", "CONE"]);
  function countUnitOf(fabricId: string): string | null {
    const uomId = baseUomByItem.get(fabricId);
    const code = uomId ? uomCodes.get(uomId) : null;
    if (!code) return null;
    return COUNTED_UNITS.has(code.trim().toUpperCase()) ? code : null;
  }

  /* THE SOLID'S OWN COLOUR, per (fabric, combo) — one distinct answer or
     nothing, the abstain rule this file uses everywhere. */
  const lineColour = new Map<string, Set<string>>();
  for (const l of (lineRes.data ?? []) as unknown as {
    item_id: string | null;
    combo: string | null;
    color_name: string | null;
  }[]) {
    if (!l.item_id || !l.color_name) continue;
    const key = `${l.item_id}::${l.combo ?? ""}`;
    const set = lineColour.get(key) ?? new Set<string>();
    set.add(l.color_name);
    lineColour.set(key, set);
  }

  /* THE YARN-DYED COMBINATION, per (fabric, combo) — its floor name and the
     colours it puts at each stripe POSITION, ordered by the nested rows' own
     `sno` (0560: "Color ID (C01, C02…) IS NOT A COLUMN … DERIVED from sno"). */
  type YdCombo = { ydComboName: string | null; colours: string[]; losses: number[] };
  const ydComboByFabricCombo = new Map<string, YdCombo>();
  for (const c of (ydComboRes.data ?? []) as unknown as {
    item_id: string | null;
    combo: string | null;
    yd_combo_name: string | null;
    colors: { sno: number | null; yarn_color: string | null; dyeing_loss_pct: number | string | null }[] | null;
    yd_part?: string | null;
  }[]) {
    if (!c.item_id) continue;
    /* SORTED ONCE, READ TWICE — the colour and its loss must come off the SAME
       stripe position, so they are taken from one ordered pass rather than two
       (0560 · 0568). */
    const byPosition = [...(c.colors ?? [])].sort((a, b) => (a.sno ?? 0) - (b.sno ?? 0));
    ydComboByFabricCombo.set(`${ydInstance(c.item_id, ydPartKey(c.yd_part))}::${c.combo ?? ""}`, {
      ydComboName: c.yd_combo_name,
      colours: byPosition.map((x) => x.yarn_color ?? ""),
      losses: byPosition.map((x) => Number(x.dyeing_loss_pct ?? 0)),
    });
  }

  /* THE STRIPES, per fabric — `mixingDetailRows` (./yarn-dyed.ts) turns these
     into each stripe's share of the CLOTH, and is called rather than reasoned
     about here: the panel the planner typed and the weight a dye house is
     given must come from one function. */
  const repeatsByFabric = new Map<string, YdRepeatRow[]>();
  for (const r of (ydRepeatRes.data ?? []) as unknown as {
    item_id: string | null;
    sno: number | null;
    yarn_item_id: string | null;
    dye_type: string | null;
    color_name: string | null;
    uom_id: string | null;
    value: number | string | null;
    twisted_yarn: string | null;
    yd_part?: string | null;
  }[]) {
    if (!r.item_id) continue;
    /* KEYED BY CLOTH INSTANCE (0596) — see `ydInstance`. */
    const inst = ydInstance(r.item_id, ydPartKey(r.yd_part));
    const list = repeatsByFabric.get(inst) ?? [];
    list.push({
      key: `${r.item_id}:${r.sno ?? list.length}`,
      sno: r.sno ?? list.length + 1,
      yarn_item_id: r.yarn_item_id,
      dye_type: r.dye_type === "grey" ? "grey" : "dyed",
      color_name: r.color_name ?? "",
      uom_id: r.uom_id,
      value: r.value == null ? null : Number(r.value),
      twisted_yarn: r.twisted_yarn ?? "",
    });
    repeatsByFabric.set(inst, list);
  }
  /** One fabric's Mixing Details, derived once and read by both the Details
   *  cell's colour-wise text and the YARN DYEING block. */
  const mixingByFabric = new Map<string, MixingDetailRow[]>();
  for (const [inst, repeats] of repeatsByFabric) {
    /* The instance key starts with the fabric id, which is what the
       composition is filed under. */
    const fabricId = inst.split("#")[0];
    mixingByFabric.set(
      inst,
      mixingDetailRows(repeats, compositionByFabric.get(fabricId) ?? null, (id) =>
        id ? (itemNames.get(id) ?? "(yarn not found)") : "",
      ),
    );
  }

  /* THE ORDER'S GSM, per (structure, combo) — Report 1's own `resolveGsm`
     rule, restated here over this report's own fetch rather than shared:
     the two reports resolve it for different grains (an ENTRY's structure
     there, a FABRIC's here) and one helper taking both would need to know
     which. */
  const gsmByStructure = new Map<string, Map<string, number>>();
  for (const c of (comboStructRes.data ?? []) as unknown as {
    combo: string | null;
    structures: { structure_id: string | null; gsm: number | string | null }[] | null;
  }[]) {
    for (const st of c.structures ?? []) {
      if (!st.structure_id || st.gsm == null) continue;
      const byCombo = gsmByStructure.get(st.structure_id) ?? new Map<string, number>();
      byCombo.set(c.combo ?? "", Number(st.gsm));
      gsmByStructure.set(st.structure_id, byCombo);
    }
  }
  function resolveGsm(fabricId: string, combo: string): number | null {
    const structureId = structureByFabric.get(fabricId);
    if (!structureId) return null;
    const byCombo = gsmByStructure.get(structureId);
    if (!byCombo || byCombo.size === 0) return null;
    if (combo && byCombo.has(combo)) return byCombo.get(combo)!;
    const distinct = [...new Set(byCombo.values())];
    return distinct.length === 1 ? distinct[0] : null;
  }

  /**
   * THE `Details` CELL'S COMPOSITION TEXT.
   *
   * Legacy prints a yarn-dyed cloth COLOUR-WISE — `(20'S COMBED COTTON GREEN
   * 50% , 20'S COMBED COTTON RED 33.33% , 20'S COMBED COTTON WHITE 16.67% )` —
   * and a solid BLEND-WISE: `(25'S VISCOSE 95% , 20 DENIER ELASTANE 5% )`. The
   * two are the same sentence over different axes, so this picks the axis by
   * whether the cloth declares stripes at all, never by a stored fabric type.
   *
   * A SINGLE-YARN SOLID WITH NO PERCENTAGE reads `100%`, which is what the
   * master means by a lone component carrying no `blend_pct` (`yarnShareOf`'s
   * "the whole cloth" branch) — never a blank where a share belongs.
   */
  function mixingTextFor(fabricId: string, combo: string, part = ""): string | null {
    const mixing = mixingByFabric.get(ydInstance(fabricId, part));
    if (mixing && mixing.length) {
      const yd = ydComboByFabricCombo.get(`${ydInstance(fabricId, part)}::${combo}`);
      const parts = mixing.map((m, i) => {
        const colour = yd?.colours[i] || m.color_name;
        const pct = m.mixing_pct;
        return `${m.yarn_name} ${colour}${pct == null ? "" : ` ${trimPct(pct)}%`}`;
      });
      return parts.length ? `(${parts.join(" , ")} )` : null;
    }
    const comp = compositionByFabric.get(fabricId);
    if (!comp || comp.components.length === 0) return null;
    const parts = comp.components.map((c) => {
      const name = itemNames.get(c.yarn_id) ?? "(yarn not found)";
      const pct = c.blend_pct ?? (comp.components.length === 1 ? 100 : null);
      return `${name}${pct == null ? "" : ` ${trimPct(pct)}%`}`;
    });
    return `(${parts.join(" , ")} )`;
  }

  const componentNames = await routeComponentNames(s, routeRows.map((p) => p.component_id));
  if (isReportRefusal(componentNames)) return componentNames;
  const stageLedgerRefusals: string[] = [];

  /* A FAILED PROCESS SELECT IS SAID, NOT SWALLOWED.
     `processRes.data ?? []` above reads a failure as "this database has no
     processes", and every section then heads itself "(process not found)" —
     which is exactly how 2026-09-16's report reached the operator, over a
     select that had started asking for a column (`is_knitting`, 0564) whose
     migration was not applied yet.

     NOT A WHOLE-REPORT REFUSAL, deliberately: every WEIGHT on the page is
     computed from `order_fabric_bom_processes` and the stored requirement, so
     the arithmetic is unaffected and the document is still worth reading. What
     is lost is the section LABELS. So it goes in the same list the ledger
     already uses for "something I could not resolve, printed rather than
     dropped" — which is what turns an inexplicable page into one that names
     its own cause. */
  if (processRes.error) {
    stageLedgerRefusals.push(
      `Process names could not be read, so each section below is headed "(process not found)" — ${processRes.error.message}`,
    );
  }

  /* THE LADDER, PER (FABRIC, COMBO) — `comboUpliftBreakdown` is the SAME
     function `yarnPurchase` calls internally per fabric (see its 2026-09-11
     header), so this walk cannot disagree with the stored `purchase_qty`
     as long as the order's declared route hasn't changed since Save.
     REVERSED before walking: `order_fabric_bom_processes.sno` is the
     PHYSICAL/chronological order (Knitting=1, ..., the last finishing stage
     highest) — the same order the Fabric Process tab was typed in and Report
     1's ledger displays. The backward-markup walk needs the OPPOSITE
     direction: `net` (the Manual tab's cutting requirement) is the smallest
     figure and belongs to the LAST physical stage, growing backward toward
     Knitting's own gross-yarn-equivalent figure — proven against the legacy
     PDF's own numbers in `check-fabric-bom-reports.mts` ("Dyeing's own step
     alone, 1460.029 -> 1536.873" only holds with Dyeing walked before
     Knitting). Feeding the ascending-`sno` array in unreversed would label
     KNITTING's row with the tiny cutting-floor figure and STENTERING's with
     the full yarn weight — exactly backwards from the legacy printout. */
  const byProcess = new Map<string, StageBreakdownGroup>();
  /** Which fabric stages each section's steps sit in — for the Greige merge. */
  const stagesByProcess = new Map<string, Set<string>>();
  const byYarnFabricWt = new Map<string, Map<string, YarnFabricContribution[]>>(); // yarnId -> fabricId -> contributions
  /** One cloth's contribution to one stripe of one yarn, before the slices of
   *  one dye lot are summed — see the grouping note below the loop. */
  const dyeingSlices: {
    yarnItemId: string;
    yarnName: string;
    colorName: string;
    combo: string | null;
    mixingPct: number;
    plannedWt: number;
    /** This shade's own dye-house loss (0568). */
    lossPct: number;
  }[] = [];
  /** THE RULE 2 DEMAND (0564) — one line per (purchased fabric, colourway,
   *  branch). Collected inside the same loop that computes the ladder, so the
   *  roll weight a buyer is given and the stage ledger beside it are grossed
   *  by one walk of one route. */
  const clothLines: ClothPurchaseLine[] = [];
  for (const [fabricId, byCombo] of netByFabricComboPanels) {
    const fabricName = itemNames.get(fabricId) ?? "(fabric not found)";
    const route = [...(routeByFabric.get(fabricId) ?? [])].reverse();
    const composition = compositionByFabric.get(fabricId);
    /* WHERE THIS CLOTH COMES FROM (0564). Resolved once per fabric: it scopes
       the ladder AND decides whether this cloth's gross is split across yarns
       at all. */
    const source = sourceOf(fabricId);
    const buysYarn = sourceBuysYarn(source);
    for (const [combo, byPanels] of byCombo) {
      /* COLLAPSE (entry-panels) TO (resolved branch) FIRST. Under a unified or
         colour-only route every panel set resolves to the same empty branch
         and the nets sum back into the one line this ledger has always
         printed; under a "Component Wise" route they sum per panel. A panel
         set the route refuses is named under the ledger, never dropped. */
      const byBranch = new Map<
        string,
        {
          net: number;
          nos: number;
          garments: Map<string, number>;
          consWt: number;
          dias: Set<string>;
          branch: string[];
          printed: boolean;
          panels: Set<string>;
          /** YD PART (0596) — kept apart through the collapse, see NetSlice. */
          part: string;
        }
      >();
      for (const { net, nos, garments, consWt, dias, panels, part } of byPanels.values()) {
        const forColour = route.filter((st) => stageCoversCombo(st.combo, combo));
        const branch = resolveRouteComponents(forColour, panels);
        if (isReportRefusal(branch)) {
          stageLedgerRefusals.push(`${fabricName}${combo ? ` · ${combo}` : ""}: ${branch.refused}`);
          continue;
        }
        /* PRINTED IS PART OF THE KEY (2026-09-19). On a unified route every
           panel set resolves to one branch — but a printed body and a plain
           sleeve of the same cloth take DIFFERENT ladders now (the sleeve skips
           the print stage), so they cannot be summed into one weight first. */
        const printed = printedGroup(printLines, fabricId, combo, panels);
        const branchKey = `${part}|${[...branch].sort().join(",")}|${printed ? "P" : ""}`;
        const held = byBranch.get(branchKey) ?? {
          net: 0,
          nos: 0,
          garments: new Map<string, number>(),
          consWt: 0,
          dias: new Set<string>(),
          branch,
          printed,
          panels: new Set<string>(),
          part,
        };
        held.net += net;
        held.nos += nos;
        mergeGarmentCounts(held.garments, garments);
        held.consWt += consWt;
        for (const d of dias) held.dias.add(d);
        for (const p of panels) held.panels.add(p);
        byBranch.set(branchKey, held);
      }

      /* THE DETAILS CELL'S FACTS, resolved once per (fabric, combo) — they do
         not vary by branch or by process, so resolving them inside the step
         loop would be the same lookup a dozen times. */
      /* PER YD PART since 0596 — a Top and a Bottom of one cloth carry their
         own combination name and stripes — so these three are resolved per part
         inside the branch loop below, from these two readers. */
      const ydComboFor = (part: string) => ydComboByFabricCombo.get(`${ydInstance(fabricId, part)}::${combo}`);
      const solidColours = lineColour.get(`${fabricId}::${combo}`);
      /* THE CLOTH'S OWN COLOUR — the yarn-dyed combination's floor name where
         there is one, else the solid's `color_name`, and only when the lines
         agree on one. NOT `combo`, which is the assort colourway and still
         bands the section. */
      const fabricColourFor = (part: string) =>
        ydComboFor(part)?.ydComboName ?? (solidColours && solidColours.size === 1 ? [...solidColours][0] : null);
      const formLabel = layoutTypeLabel(widthFormByFabric.get(fabricId)) || null;
      const gsm = resolveGsm(fabricId, combo);
      const nosUomCode = countUnitOf(fabricId);

      for (const { net, nos, garments, consWt, dias, branch, printed, panels, part } of byBranch.values()) {
        const ydCombo = ydComboFor(part);
        const fabricColour = fabricColourFor(part);
        const mixingText = mixingTextFor(fabricId, combo, part);
        const pcs = garmentTotal(garments);
        /* ONE DISTINCT DIA OR NOTHING — the same abstain this file makes for
           the header's Style Ref No and for GSM. Two sizes knitted at
           different diameters have no single answer, and printing one of them
           would label the whole block with it. */
        const dia = dias.size === 1 ? [...dias][0] : null;
        const component = branch.length
          ? branch.map((id) => componentNames.get(id) ?? "(component not found)").join(", ")
          : null;
        const ladder = comboUpliftBreakdown(route, combo, branch, source, printed);
        if (isReportRefusal(ladder)) {
          // an out-of-range loss: nothing to ladder, not a report crash — but said
          stageLedgerRefusals.push(`${fabricName}${combo ? ` · ${combo}` : ""}: ${ladder.refused}`);
          continue;
        }
        /* THE PRINT NAMED ON THE ORDER for this group — printed on the
           Printing section's lines only. */
        const printName = printed ? printNamesFor(printLines, fabricId, combo, [...panels]).join(", ") || null : null;
        for (const step of ladder.steps) {
          if (!step.process_id) continue;
          const baseName = processNames.get(step.process_id) ?? "(process not found)";
          const subName = step.sub_category_id ? subNames.get(step.sub_category_id) : null;
          const name = subName ? `${baseName} [${subName}]` : baseName;
          const kind = processKinds.get(step.process_id);
          const isPrint = kind?.is_print ?? false;
          const isClothPurchase = kind?.is_cloth_purchase ?? false;
          if (step.stage_id) {
            const at = stagesByProcess.get(step.process_id) ?? new Set<string>();
            at.add(step.stage_id);
            stagesByProcess.set(step.process_id, at);
          }
          let group = byProcess.get(step.process_id);
          if (!group) {
            group = {
              processId: step.process_id,
              processName: name,
              isPrint,
              isClothPurchase,
              lines: [],
              byColour: [],
              plannedTotal: 0,
              toOrderedTotal: 0,
            };
            byProcess.set(step.process_id, group);
          } else if (group.processName !== name) {
            /* One process run with two different sub-categories on this BOM:
               the section keeps the plain process name rather than claiming
               one sub-category for both. Keyed by `processId` either way — the
               Budget's pull reads that identity. */
            group.processName = baseName;
          }
          const plannedWt = Number((net * step.factorBefore).toFixed(6));
          const toOrderedWt = Number((net * step.factorAfter).toFixed(6));
          group.lines.push({
            itemId: fabricId,
            fabricName,
            combo: combo || null,
            component,
            lossPct: step.loss_pct,
            plannedWt,
            toOrderedWt,
            dia,
            fabricColour,
            ydComboName: ydCombo?.ydComboName ?? null,
            mixingText,
            formLabel,
            gsm,
            /* THE SAME TWO FACTORS THE WEIGHT USES — see `plannedNos`'s own
               doc. Null where the cloth is bought by weight. */
            plannedNos: nosUomCode ? Number((nos * step.factorBefore).toFixed(3)) : null,
            toOrderedNos: nosUomCode ? Number((nos * step.factorAfter).toFixed(3)) : null,
            nosUomCode,
            printName: isPrint ? printName : null,
            /* PRINT LINES ONLY, like `printName`: the Printing Requirement's
               Cut Pcs / Piece Wt (client 1A). Left off every other line so the
               greige merge, which sums lines, never has to add them. */
            cutPieces: isPrint ? pcs : null,
            pieceWt: isPrint && pcs > 0 ? Number((consWt / pcs).toFixed(4)) : null,
          });
          group.plannedTotal += plannedWt;
          group.toOrderedTotal += toOrderedWt;
        }

        // THE DRILL-DOWN: the fabric's own GROSS-AT-KNITTING for this combo —
        // the ladder's final factor, i.e. exactly what `yarnPurchase` grosses
        // this fabric's net by before splitting it across its yarns — split by
        // each yarn's declared blend share, same rule (`yarnShareOf`'s own
        // logic) reused inline so this drawer can never invent a split its own
        // save path would refuse.
        /* THE RULE 2 DEMAND LINE (0564). `net * ladder.factor` is the SAME
           product the drill-down and the yarn-dyeing block below take — one
           gross, three readers — and it is `clothPurchase`'s own arithmetic
           in `./yarn-process.ts` (the cutting-floor net grossed by the
           SUPPRESSED ladder, so no knitting the supplier already did is
           charged here). `check-fabric-bom-reports.mts` §9 pins the two
           together against the same route rather than trusting the sentence. */
        if (!buysYarn) {
          const label = clothPurchaseLabel(source);
          if (label) {
            clothLines.push({
              fabricId,
              fabricName,
              source,
              label,
              combo: combo || null,
              component,
              netWt: Number(net.toFixed(6)),
              purchaseWt: Number((net * ladder.factor).toFixed(6)),
              uomCode: reqUomCode,
            });
          }
        }

        /* `buysYarn` GATES THE SPLIT (0564), not just the total. A cloth
           bought as greige or dyed rolls buys NO yarn, so splitting its gross
           across the yarns its master says it is made of would put a weight
           in the drill-down drawer that no purchase order will ever be raised
           for — and the drawer's own totals are what a reader checks the
           stored `purchase_qty` against. The cloth's demand is the FABRIC
           PURCHASE section below instead. */
        if (composition && buysYarn) {
          const gross = net * ladder.factor;
          for (const comp of composition.components) {
            const declared = composition.components.filter((c) => c.yarn_id === comp.yarn_id);
            if (declared[0] !== comp) continue; // one contribution per yarn per (fabric, combo), not one per mixing row
            const everyPctKnown = declared.every((c) => c.blend_pct != null);
            const share = everyPctKnown
              ? declared.reduce((sum, c) => sum + (c.blend_pct ?? 0), 0) / 100
              : composition.components.length === declared.length
                ? 1
                : null;
            if (share == null) continue; // an undeclared multi-yarn blend: the drawer omits it rather than guessing
            const byFabricMap = byYarnFabricWt.get(comp.yarn_id) ?? new Map<string, YarnFabricContribution[]>();
            const list = byFabricMap.get(fabricId) ?? [];
            list.push({ fabricName, combo: combo || null, component, wt: Number((gross * share).toFixed(6)) });
            byFabricMap.set(fabricId, list);
            byYarnFabricWt.set(comp.yarn_id, byFabricMap);
          }
        }

        /* THE YARN DYEING BLOCK'S OWN INPUT — the SAME gross-at-knitting the
           drill-down above splits by blend, split instead by each stripe's
           `mixing_pct` (its share of the CLOTH, which is what a dye house is
           given). One gross, two splits, and they answer different questions:
           the blend split says which YARN to buy, this one says which COLOUR
           of it to dye. See `YarnDyeingLine`. */
        const mixing = mixingByFabric.get(ydInstance(fabricId, part));
        /* GATED ON `buysYarn` TOO (0564), and for a sharper reason than the
           drill-down above: this block is what a DYE HOUSE is given. A cloth
           bought ready-dyed has no yarn to send them, and a cloth bought
           greige is dyed as cloth rather than as yarn — either way the yarn
           dyeing weights here would be an instruction to treat yarn nobody
           owns. */
        if (mixing?.length && buysYarn) {
          const gross = net * ladder.factor;
          const yd = ydComboFor(part);
          mixing.forEach((m, i) => {
            if (m.mixing_pct == null || !m.yarn_item_id) return; // a share the panel refused: named there, not guessed here
            dyeingSlices.push({
              yarnItemId: m.yarn_item_id,
              yarnName: m.yarn_name,
              colorName: yd?.colours[i] || m.color_name,
              /* THE PART RIDES ON THE COLOURWAY LABEL (0596) — "WHITE · TOP" —
                 so a Top and a Bottom dyed to different stripes print as two
                 lots with their own weights rather than summing into one. */
              combo: [combo, part].filter(Boolean).join(" · ") || null,
              mixingPct: Number(m.mixing_pct.toFixed(4)),
              plannedWt: Number(((gross * m.mixing_pct) / 100).toFixed(6)),
              /* THIS SHADE'S OWN DYE-HOUSE LOSS (0568), off the combination's
                 colour row at the same stripe POSITION the colour name came
                 from. Undeclared reads 0 and grosses by nothing. */
              lossPct: Number(yd?.losses[i] ?? 0),
            });
          });
        }
      }
    }
  }

  /* ONE ROW PER (YARN, COLOURWAY, COLOUR) — a yarn dyed one colour for one
     colourway across two cloths is ONE dye lot, so the slices are summed
     rather than listed per cloth. The legacy printout groups the same way:
     three rows for 20'S COMBED COTTON, one per colour, not one per fabric. */
  const dyeingByKey = new Map<string, YarnDyeingLine>();
  for (const slice of dyeingSlices) {
    const key = `${slice.yarnItemId}::${slice.combo ?? ""}::${slice.colorName}`;
    const held = dyeingByKey.get(key);
    if (held) {
      held.plannedWt = Number((held.plannedWt + slice.plannedWt).toFixed(6));
      held.mixingPct = Number((held.mixingPct + slice.mixingPct).toFixed(4));
      continue;
    }
    dyeingByKey.set(key, {
      yarnItemId: slice.yarnItemId,
      yarnName: slice.yarnName,
      colorName: slice.colorName,
      combo: slice.combo,
      mixingPct: slice.mixingPct,
      plannedWt: slice.plannedWt,
      /* THE SHADE'S OWN LOSS (0568), not the yarn's. Until this column existed
         every colour of a yarn showed that yarn's single stage loss, so the
         legacy sheet's GREEN 5.00 / RED 4.00 / WHITE 3.00 could not be
         reproduced at all and the grey purchase was the dyed weight
         un-grossed. */
      lossPct: slice.lossPct,
      toOrderedWt: 0, // grossed below, once this lot's weight is complete
      uomCode: null, // filled below, from the yarn's own stored purchase row
    });
  }
  /* GROSSED AFTER SUMMING, not before: a lot's grey requirement is its whole
     dyed weight divided once, and rounding each cloth's contribution through
     the divisor first drifts from the total `purchase_qty` carries. */
  for (const line of dyeingByKey.values()) {
    line.toOrderedWt = Number((line.plannedWt / (1 - line.lossPct / 100)).toFixed(6));
  }
  const text = (v: string | null) => v ?? "";

  /* THE GREIGE STAGE IS ONE LOT, NOT ONE PER COLOURWAY (client 2026-09-19).
     Grey cloth is knitted (and heat-set) before any colour exists, so a
     KNITTING or HEAT SETTING section prints ONE line per fabric with the
     combined weight — "1070 KGS", not a line per garment colourway. Colour
     begins at the dyeing stage, and every section from there on keeps its
     colourway lines. A section counts as greige only when EVERY step in it
     sits in a rank-0 stage (`stageRank`).

     Kept apart even here: a YARN-DYED cloth (it has its colour pattern
     before it is knitted — `ydComboName`), a different panel branch, and a
     different loss %. Merging those would print one line for cloth that is
     knitted as different lots. */
  const stageRows = (stageRes.data ?? []) as { id: string; code: string | null; name: string }[];
  const isGreigeStage = (id: string) => {
    const st = stageRows.find((x) => x.id === id);
    return !!st && stageRank(st) === 0;
  };
  for (const [processId, group] of byProcess) {
    const stageIds = stagesByProcess.get(processId);
    /* The section's stages, for its colour (2026-09-20). */
    group.stages = [...(stageIds ?? [])]
      .map((id) => stageRows.find((st) => st.id === id))
      .filter((st): st is { id: string; code: string | null; name: string } => !!st);
    if (!stageIds || ![...stageIds].every(isGreigeStage)) continue;
    group.lines = mergeGreigeLines(group.lines);
  }

  for (const group of byProcess.values()) {
    group.plannedTotal = Number(group.plannedTotal.toFixed(6));
    group.toOrderedTotal = Number(group.toOrderedTotal.toFixed(6));
    /* THE ASSORT COLOUR SUBTOTALS — lines sorted so each colour's run is
       contiguous, one total per run. A no-colour line sorts first. */
    group.lines.sort(
      (a, b) =>
        text(a.combo).localeCompare(text(b.combo)) ||
        text(a.component).localeCompare(text(b.component)) ||
        a.fabricName.localeCompare(b.fabricName),
    );
    const byColour = new Map<string, StageColourSubtotal>();
    for (const l of group.lines) {
      const key = text(l.combo);
      const held = byColour.get(key) ?? { combo: l.combo, plannedTotal: 0, toOrderedTotal: 0 };
      held.plannedTotal += l.plannedWt;
      held.toOrderedTotal += l.toOrderedWt;
      byColour.set(key, held);
    }
    group.byColour = [...byColour.values()].map((c) => ({
      ...c,
      plannedTotal: Number(c.plannedTotal.toFixed(6)),
      toOrderedTotal: Number(c.toOrderedTotal.toFixed(6)),
    }));
  }
  // CHRONOLOGICAL — see the type's own doc.
  const stageBreakdown = [...byProcess.entries()]
    .sort((a, b) => (minSnoByProcess.get(a[0]) ?? 0) - (minSnoByProcess.get(b[0]) ?? 0))
    .map(([, g]) => g);

  /* A YARN NOBODY BUYS IS NOT A PURCHASE LINE (2026-09-19, Rule 2). A BOM
     saved before this rule stored a null-purchase row for a yarn every cloth of
     which is bought as rolls; listing it printed a red refusal and — through
     `anyYarnRefused` — hid the Total Yarn Purchase Requirement for the whole
     BOM. Dropped here so an old document reads right before its next save
     (which no longer stores such a row at all). */
  const yarnsUsed = new Set([...compositionByFabric.values()].flatMap((c) => c.components.map((x) => x.yarn_id)));
  const yarnsBought = new Set(
    [...compositionByFabric.values()]
      .filter((c) => sourceBuysYarn(sourceOf(c.fabric_id)))
      .flatMap((c) => c.components.map((x) => x.yarn_id)),
  );
  const yarns: YarnRequirementLine[] = rows
    .filter((r) => !(yarnsUsed.has(r.item_id) && !yarnsBought.has(r.item_id)))
    .map((r) => {
    const shades = shadesByYarn.get(r.item_id);
    /* GREY YARN IS NOT SPLIT BY COLOURWAY (client 2026-09-19): one line per
       (fabric, panel branch) with the combined weight, the same consolidation
       the purchase total now takes. */
    const byFabric = consolidateContributions([...(byYarnFabricWt.get(r.item_id)?.values() ?? [])].flat());
    return {
      itemId: r.item_id,
      yarnName: itemNames.get(r.item_id) ?? "(yarn not found)",
      stageState: "GREY",
      itemType: "YARN",
      color: shades && shades.size === 1 ? [...shades][0] : null,
      purchaseQty: r.purchase_qty,
      uomCode: r.uom_id ? (uomCodes.get(r.uom_id) ?? null) : null,
      refusalReason: r.refusal_reason,
      byFabric,
    };
  });

  const uomSet = new Set(yarns.map((y) => y.uomCode).filter(Boolean));
  /* A REFUSED YARN HAS NO WEIGHT, AND A TOTAL THAT SKIPS IT IS NOT A TOTAL.
     `purchaseQty ?? 0` was summing a null as nothing, so a document where
     EVERY yarn refused printed `TOTAL YARN PURCHASE REQUIREMENT 0` under the
     refusal that explained why — a figure that reads "buy nothing" rather
     than "not answered", which is the same failure `check-yarn-process.mts`
     already refutes one level down ("…and never answers 0, which on a
     purchase line reads as 'buy nothing'"). It is null now, and the renderers
     print the refusals instead. */
  const anyYarnRefused = yarns.some((y) => y.purchaseQty == null);
  /* `yarns.length > 0` JOINED THE TEST ON 2026-09-16 (0564), and it is the
     same bug this branch already exists to prevent, arriving by a new door.
     Until today a document always had yarn rows, so an empty `yarns` was
     unreachable and `[].reduce(..., 0)` was never evaluated. A Rule 2 BOM
     whose every fabric is bought as cloth legitimately has none — and would
     have printed "TOTAL YARN PURCHASE REQUIREMENT 0.000" under a FABRIC
     PURCHASE section listing what to actually buy. A zero on a purchase line
     reads as "buy nothing", which is exactly what the comment below says. */
  const yarnGrandTotal =
    yarns.length > 0 && uomSet.size <= 1 && !anyYarnRefused
      ? {
          qty: Number(yarns.reduce((sum, y) => sum + (y.purchaseQty ?? 0), 0).toFixed(6)),
          uomCode: [...uomSet][0] ?? null,
        }
      : null; // mixed units really do exist across yarns — never sum kg onto metres

  /* THE DYEING BLOCK'S UNIT IS THE YARN'S OWN PURCHASE UNIT — the weight
     being dyed is a slice of the weight being bought, so borrowing the
     purchase row's label is reading one fact, not asserting a second. */
  const purchaseUomByYarn = new Map<string, string | null>(yarns.map((y) => [y.itemId, y.uomCode]));
  const yarnDyeing = [...dyeingByKey.values()]
    .map((l) => ({ ...l, uomCode: purchaseUomByYarn.get(l.yarnItemId) ?? null }))
    /* YARN, THEN COLOURWAY, THEN COLOUR — so one yarn's colours read as a
       block with its own total, the way the legacy printout groups them. */
    .sort(
      (a, b) =>
        a.yarnName.localeCompare(b.yarnName) ||
        (a.combo ?? "").localeCompare(b.combo ?? "") ||
        a.colorName.localeCompare(b.colorName),
    );

  const dyeUoms = new Set(yarnDyeing.map((l) => l.uomCode).filter(Boolean));
  const yarnDyeingTotal =
    yarnDyeing.length && dyeUoms.size <= 1
      ? {
          plannedWt: Number(yarnDyeing.reduce((sum, l) => sum + l.plannedWt, 0).toFixed(6)),
          toOrderedWt: Number(yarnDyeing.reduce((sum, l) => sum + l.toOrderedWt, 0).toFixed(6)),
          uomCode: [...dyeUoms][0] ?? null,
        }
      : null;

  /* THE FABRIC PURCHASE SECTION (0564), sorted the way its lines are read:
     by heading (a greige order and a dyed order go to different suppliers),
     then cloth, then colourway, then panel. */
  /* GREIGE ROLLS MERGE PER FABRIC (2026-09-19) — no colour exists yet; dyed
     rolls keep their colourway lines. See `mergeGreigeClothLines`. */
  const clothPurchase = mergeGreigeClothLines(clothLines).sort(
    (a, b) =>
      a.label.localeCompare(b.label) ||
      a.fabricName.localeCompare(b.fabricName) ||
      text(a.combo).localeCompare(text(b.combo)) ||
      text(a.component).localeCompare(text(b.component)),
  );
  const clothUoms = new Set(clothPurchase.map((l) => l.uomCode).filter(Boolean));
  const clothPurchaseTotal =
    clothPurchase.length && clothUoms.size <= 1
      ? {
          qty: Number(clothPurchase.reduce((sum, l) => sum + l.purchaseWt, 0).toFixed(6)),
          uomCode: [...clothUoms][0] ?? null,
        }
      : null;

  /* THE REGISTER, READ ONCE MORE FOR THE ALLOCATION SECTION — its rows are
     what the section regroups, and building them a second way here would be
     two implementations of one document. */
  const register = await registerP;

  return {
    header,
    yarns,
    yarnGrandTotal,
    yarnDyeing,
    yarnDyeingTotal,
    clothPurchase,
    clothPurchaseTotal,
    stageBreakdown,
    /* THE PRINTING REQUIREMENT — the print sections, already in the ledger's
       colour → component → fabric order, regrouped per colourway. */
    printing: printRequirement(
      stageBreakdown
        .filter((g) => g.isPrint)
        .flatMap((g) =>
          g.lines.map((l) => ({
            processName: g.processName,
            fabricName: l.fabricName,
            combo: l.combo ?? "",
            component: l.component ?? "",
            print: l.printName ?? "",
            dia: l.dia ?? "",
            cutPieces: l.cutPieces ?? null,
            pieceWt: l.pieceWt ?? null,
            lossPct: l.lossPct,
            sentWt: l.toOrderedWt,
            receivedWt: l.plannedWt,
          })),
        ),
    ),
    allocation: isReportRefusal(register) ? register : fabricAllocationOf(register),
    stageLedgerRefusals,
  };
}
