import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getOrderProduction } from "@/lib/orders/bom-order-basis";
import { excessQty, projectionQty } from "@/lib/orders/amendments/approval-qty";
import type { ApprovalRow, OrderProductionInput } from "@/lib/orders/material-bom/requirement";
import { comboUpliftBreakdown } from "./yarn-process";
import { layoutTypeLabel } from "./component-map";
import { isReportRefusal, type ReportRefusal } from "./report-refusal";

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
 * "SQ Qty" and its four components (Order Qty / Excess Qty / Rejection
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
  sqQty: number;
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
  company: { name: string | null; address: string | null; gstin: string | null };
};

async function loadBomDocHeader(bomId: string): Promise<BomDocHeader | ReportRefusal> {
  const s = await createClient();

  const { data: bomRow, error: bomErr } = await s
    .from("order_fabric_boms")
    .select("id, code, garment_order_id, bom_date, computed_at, is_draft")
    .eq("id", bomId)
    .maybeSingle();

  if (bomErr) return { refused: `Could not read the Fabric BOM: ${bomErr.message}` };
  if (!bomRow) return { refused: "This Fabric BOM no longer exists." };

  const { data: goRow, error: goErr } = await s
    .from("garment_order_amendments")
    .select(
      "id, po_no, delivery_date, excess_pct, customer:customers(name), " +
        "sales_order:sales_orders(order_number)",
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
    sales_order: { order_number: string | null } | null;
  };

  /* THERE IS NO SINGLE "Style Ref No" ON THE ORDER — `style_ref_no` lives on
     the BOM's own lines (NULL there means "every style", 0495's shape), and
     one BOM can genuinely cover several. So this reads the SAME rows the
     body table will (`order_fabric_bom_lines`), and answers only when every
     line agrees — same abstain rule `fabricAllocationColumns`'s GSM lookup
     uses ("one distinct answer or nothing"), rather than picking the first
     line's style and mislabelling a multi-style document. */
  const [order, coRes, styleRes] = await Promise.all([
    getOrderProduction(go.id),
    s.from("company_profile").select("*").limit(1).maybeSingle(),
    s.from("order_fabric_bom_lines").select("style_ref_no").eq("bom_id", bomId),
  ]);
  const distinctStyles = [
    ...new Set(
      ((styleRes.data ?? []) as { style_ref_no: string | null }[])
        .map((r) => r.style_ref_no)
        .filter((v): v is string => !!v),
    ),
  ];
  const soleStyleRefNo = distinctStyles.length === 1 ? distinctStyles[0] : null;
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
      address: str("address") ?? str("address_line1"),
      gstin: str("gstin"),
    },
    orderNo: go.po_no,
    // NULL means the BOM's lines don't all agree on one style — the doc's
    // single "Style Ref No" fact doesn't exist for a genuinely multi-style
    // document, so it prints blank rather than one line's style mislabelling
    // the whole register (see the query above).
    styleRefNo: soleStyleRefNo,
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
function qtyBreakdownOf(order: OrderProductionInput): QtyBreakdown | ReportRefusal {
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

  return {
    orderQty: orderQtyTotal,
    excessQty: excessTotal,
    rejectionQty: rejectionTotal,
    approvalQty: approvalTotal,
    sqQty: orderQtyTotal + excessTotal + rejectionTotal + approvalTotal,
  };
}

// ---------------------------------------------------------------------------
// Report 1 — Fabric BOM Entry Register
// ---------------------------------------------------------------------------

export type EntryRegisterLine = {
  itemId: string;
  fabricName: string;
  combo: string | null;
  sizeLabel: string;
  sqQty: number;
  /** The per-garment consumption this line was multiplied by — stored on the
   *  requirement row itself (`order_fabric_bom_manual.ts`'s `consumptionMap`),
   *  in `uomCode`'s unit. Not necessarily grams: a fabric's own base UOM
   *  decides that, so this is labelled by its unit rather than assumed. */
  pieceWt: number | null;
  /** The line's OWN wastage % (EndBit / cutting-room buffer) — the ONE loss
   *  this requirement row's `required_qty` already includes. Not the same
   *  thing as the Process Sequence ledger's `loss_pct`: `processes.ts`'s own
   *  header forbids compounding that in here too ("one number, one author,
   *  two readers") — see `lossPct` below. */
  wastagePct: number | null;
  netReqWt: number;
  grossWt: number;
  /** `(grossWt/netReqWt - 1) x 100`, the COMBINED compounded loss the two
   *  figures already imply — never a second stored percentage. Null when
   *  netReqWt is 0 (nothing to divide by). */
  lossPct: number | null;
  uomCode: string | null;
  components: string[];
  styleRefNo: string | null;
  /** "Open Width" / "Tubular" — the entry's own `width_form` (0495), labelled.
   *  Null when the entry never declared one. */
  itemForm: string | null;
  /** The knitting/finishing diameter or flat/woven width for this line's own
   *  size, from the Manual entry's size row (`order_fabric_bom_manual_sizes`,
   *  0494) — never re-typed here. */
  dia: number | null;
  /** The commercial purchase width for the same size row — a second, distinct
   *  figure from `dia` (cloth is knitted at one width and invoiced at another). */
  purchaseWidth: number | null;
  /** The order's own GSM for this line's structure, resolved for this line's
   *  OWN combo — same "one distinct answer or nothing" abstain rule the
   *  header's Style Ref No already uses: a structure whose GSM disagrees
   *  across combos (and this line names none in particular) prints blank
   *  rather than picking one combo's figure at random. */
  gsm: number | null;
};

export type EntryRegisterGroup = {
  itemId: string;
  fabricName: string;
  lines: EntryRegisterLine[];
  subtotal: { sqQty: number; netReqWt: number; grossWt: number };
};

export type StageLedgerRow = {
  className: "Fabric" | "Yarn";
  itemName: string;
  stageName: string | null;
  processName: string | null;
  lossPct: number | null;
};

export type EntryRegister = {
  header: BomDocHeader;
  groups: EntryRegisterGroup[];
  grandTotal: { sqQty: number; netReqWt: number; grossWt: number };
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
          "components:order_fabric_bom_manual_components(component:components(short_name)), " +
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
    components: { component: { short_name: string } | null }[] | null;
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
  const [itemRes, uomRes, stageLookupRes, processLookupRes, processesRes, comboStructuresRes] =
    await Promise.all([
      itemIds.length ? s.from("items").select("id, name").in("id", itemIds) : Promise.resolve({ data: [], error: null }),
      uomIds.length
        ? s.from("uoms").select("id, code").in("id", uomIds)
        : Promise.resolve({ data: [], error: null }),
      s.from("config_lookups").select("id, name").eq("kind", "fabric_stage"),
      s.from("processes").select("id, name"),
      itemIds.length
        ? s
            .from("order_fabric_bom_processes")
            .select("item_id, stage_id, process_id, loss_pct")
            .eq("bom_id", bomId)
            .in("item_id", itemIds)
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
    ]);
  if (processesRes.error) {
    return { refused: `Could not read the process ledger: ${processesRes.error.message}` };
  }
  if (comboStructuresRes.error) {
    return { refused: `Could not read the order's GSM: ${comboStructuresRes.error.message}` };
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
  const processNames = new Map<string, string>(
    ((processLookupRes.data ?? []) as { id: string; name: string }[]).map((r) => [r.id, r.name]),
  );

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
      itemForm: string | null;
      structureId: string | null;
      sizes: Map<string, { dia: number | null; purchaseWidth: number | null }>;
    }
  >();
  for (const e of entryRows) {
    const sizes = new Map<string, { dia: number | null; purchaseWidth: number | null }>();
    for (const sz of e.sizes ?? []) {
      sizes.set(sz.size_id ?? "", {
        dia: sz.dia == null ? null : Number(sz.dia),
        purchaseWidth: sz.purchase_width == null ? null : Number(sz.purchase_width),
      });
    }
    entriesById.set(e.id, {
      style_ref_no: e.style_ref_no,
      components: (e.components ?? [])
        .map((c) => c.component?.short_name ?? "")
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b)),
      itemForm: layoutTypeLabel(e.width_form) || null,
      structureId: e.structure_id,
      sizes,
    });
  }

  const byFabric = new Map<string, EntryRegisterGroup>();
  const grandTotal = { sqQty: 0, netReqWt: 0, grossWt: 0 };

  for (const r of reqRows) {
    if (!r.item_id) continue;
    const fabricName = itemNames.get(r.item_id) ?? "(fabric not found)";
    let group = byFabric.get(r.item_id);
    if (!group) {
      group = { itemId: r.item_id, fabricName, lines: [], subtotal: { sqQty: 0, netReqWt: 0, grossWt: 0 } };
      byFabric.set(r.item_id, group);
    }

    const entry = r.entry_id ? entriesById.get(r.entry_id) : undefined;
    const sizeInfo = entry?.sizes.get(r.size_id ?? "");
    const gross = r.required_qty ?? 0;
    const sq = r.basis_qty ?? 0;
    // NET is not stored separately from GROSS on the requirement row — only
    // the post-loss `required_qty` is. Printing a net figure here would
    // invent one; the doc's "Net Req Wt" and "Total Wt" collapse to the same
    // stored figure until a net column exists, and `lossPct` is left null
    // (never a fabricated 0.00%) to say so rather than implying no loss.
    const line: EntryRegisterLine = {
      itemId: r.item_id,
      fabricName,
      combo: r.combo,
      sizeLabel: r.slice_label ?? "—",
      sqQty: sq,
      pieceWt: r.consumption,
      wastagePct: r.wastage_pct,
      netReqWt: gross,
      grossWt: gross,
      lossPct: null,
      uomCode: r.consumption_uom_id ? (uomCodes.get(r.consumption_uom_id) ?? null) : null,
      components: entry?.components ?? [],
      styleRefNo: r.style_ref_no ?? entry?.style_ref_no ?? null,
      itemForm: entry?.itemForm ?? null,
      dia: sizeInfo?.dia ?? null,
      purchaseWidth: sizeInfo?.purchaseWidth ?? null,
      gsm: resolveGsm(entry?.structureId ?? null, r.combo),
    };
    group.lines.push(line);
    group.subtotal.sqQty += sq;
    group.subtotal.netReqWt += gross;
    group.subtotal.grossWt += gross;
    grandTotal.sqQty += sq;
    grandTotal.netReqWt += gross;
    grandTotal.grossWt += gross;
  }

  const stageLedger: StageLedgerRow[] = [];
  for (const p of (processesRes.data ?? []) as unknown as {
    item_id: string;
    stage_id: string | null;
    process_id: string | null;
    loss_pct: string | number | null;
  }[]) {
    stageLedger.push({
      className: "Fabric",
      itemName: itemNames.get(p.item_id) ?? "(fabric not found)",
      stageName: p.stage_id ? (stageNames.get(p.stage_id) ?? null) : null,
      processName: p.process_id ? (processNames.get(p.process_id) ?? null) : null,
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
        stageName: st.stage_id ? (stageNames.get(st.stage_id) ?? null) : null,
        processName: st.process_id ? (processNames.get(st.process_id) ?? null) : null,
        lossPct: st.loss_pct,
      });
    }
  }

  return {
    header,
    groups: [...byFabric.values()],
    grandTotal,
    stageLedger,
  };
}

// ---------------------------------------------------------------------------
// Report 2 — Yarn & Fabric Requirement Report
// ---------------------------------------------------------------------------

export type YarnRequirementLine = {
  itemId: string;
  yarnName: string;
  purchaseQty: number | null;
  uomCode: string | null;
  refusalReason: string | null;
};

/** One FABRIC's own step within one process section — legacy's "Details /
 *  Dia-Size / Planned / Loss % / To Ordered", per (fabric, combo). Genuinely
 *  keyed to the FABRIC (2026-09-11), not a yarn: the legacy PDF's KNITTING /
 *  DYEING / BRUSHING / COMPACTING / STENTERING sections list cloth
 *  descriptions ("SOLID 3T FLEECE BRUSHED..."), because the route this walks
 *  is `order_fabric_bom_processes` — the Fabric Process tab's own declared
 *  sequence — never a yarn-level stage (see `yarnPurchase`'s header on why). */
export type StageBreakdownLine = {
  fabricName: string;
  combo: string | null;
  lossPct: number;
  plannedWt: number;
  toOrderedWt: number;
};

export type StageBreakdownGroup = {
  processName: string;
  lines: StageBreakdownLine[];
  plannedTotal: number;
  toOrderedTotal: number;
};

export type YarnFabricRequirementReport = {
  header: BomDocHeader;
  yarns: YarnRequirementLine[];
  stageBreakdown: StageBreakdownGroup[];
};

export async function yarnFabricRequirementReport(
  bomId: string,
): Promise<YarnFabricRequirementReport | ReportRefusal> {
  const header = await loadBomDocHeader(bomId);
  if (isReportRefusal(header)) return header;

  const s = await createClient();

  /* THE YARN SUMMARY TABLE READS STORED FIGURES ONLY — see the file header.
     `purchase_qty` is what a yarn purchase order is actually raised against,
     computed by `writeYarns` at Save time from this exact same route data
     (`yarnPurchase`, 2026-09-11). The STAGE LEDGER below, by contrast, is
     genuinely live-computed — it has never been persisted in ladder form (see
     `comboUpliftBreakdown`'s header), so there is nothing stored to read. */
  const { data: yarnRows, error: yarnErr } = await s
    .from("order_fabric_bom_yarns")
    .select("item_id, purchase_qty, uom_id, refusal_reason")
    .eq("bom_id", bomId);

  if (yarnErr) return { refused: `Could not read the yarn purchase rows: ${yarnErr.message}` };

  const rows = (yarnRows ?? []) as unknown as {
    item_id: string;
    purchase_qty: number | null;
    uom_id: string | null;
    refusal_reason: string | null;
  }[];

  if (rows.length === 0) {
    return {
      refused:
        "This Fabric BOM has no stored yarn purchase yet — open Yarn Process and save, so the figures this report prints are the ones that were approved.",
    };
  }

  const yarnItemIds = [...new Set(rows.map((r) => r.item_id))];
  const uomIds = [...new Set(rows.map((r) => r.uom_id).filter(Boolean))] as string[];

  /* THE STAGE LEDGER'S OWN INPUTS — the fabric's net (summed
     `required_qty`, i.e. the Manual tab's already-lossed cutting requirement,
     per (fabric, combo)) and that fabric's OWN declared route. Both are
     stored, declarative facts; only the LADDER built from them is computed
     here. */
  const [reqRes, uomRes] = await Promise.all([
    s.from("order_fabric_bom_requirements").select("item_id, combo, required_qty").eq("bom_id", bomId),
    uomIds.length ? s.from("uoms").select("id, code").in("id", uomIds) : Promise.resolve({ data: [], error: null }),
  ]);
  if (reqRes.error) return { refused: `Could not read the requirement rows: ${reqRes.error.message}` };

  const reqRows = (reqRes.data ?? []) as unknown as {
    item_id: string | null;
    combo: string | null;
    required_qty: number | null;
  }[];

  const netByFabricCombo = new Map<string, Map<string, number>>();
  for (const r of reqRows) {
    if (!r.item_id) continue;
    const byCombo = netByFabricCombo.get(r.item_id) ?? new Map<string, number>();
    const key = r.combo ?? "";
    byCombo.set(key, (byCombo.get(key) ?? 0) + (r.required_qty ?? 0));
    netByFabricCombo.set(r.item_id, byCombo);
  }

  const fabricItemIds = [...netByFabricCombo.keys()];
  const processesRes = fabricItemIds.length
    ? await s
        .from("order_fabric_bom_processes")
        .select("item_id, combo, sno, stage_id, process_id, loss_pct")
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
    loss_pct: string | number | null;
    process_id: string | null;
  }[];
  const routeByFabric = new Map<string, { combo: string | null; loss_pct: number | null; process_id: string | null }[]>();
  for (const p of routeRows) {
    if (!p.process_id) continue;
    const list = routeByFabric.get(p.item_id) ?? [];
    list.push({ combo: p.combo, loss_pct: p.loss_pct == null ? null : Number(p.loss_pct), process_id: p.process_id });
    routeByFabric.set(p.item_id, list);
  }

  const allItemIds = [...new Set([...yarnItemIds, ...fabricItemIds])];
  const processIds = [...new Set(routeRows.map((p) => p.process_id).filter(Boolean))] as string[];
  const [itemRes, processRes] = await Promise.all([
    allItemIds.length ? s.from("items").select("id, name").in("id", allItemIds) : Promise.resolve({ data: [], error: null }),
    processIds.length ? s.from("processes").select("id, name").in("id", processIds) : Promise.resolve({ data: [], error: null }),
  ]);

  const itemNames = new Map<string, string>(((itemRes.data ?? []) as { id: string; name: string }[]).map((r) => [r.id, r.name]));
  const uomCodes = new Map<string, string>(((uomRes.data ?? []) as { id: string; code: string }[]).map((r) => [r.id, r.code]));
  const processNames = new Map<string, string>(
    ((processRes.data ?? []) as { id: string; name: string }[]).map((r) => [r.id, r.name]),
  );

  const yarns: YarnRequirementLine[] = rows.map((r) => ({
    itemId: r.item_id,
    yarnName: itemNames.get(r.item_id) ?? "(yarn not found)",
    purchaseQty: r.purchase_qty,
    uomCode: r.uom_id ? (uomCodes.get(r.uom_id) ?? null) : null,
    refusalReason: r.refusal_reason,
  }));

  /* THE LADDER, PER (FABRIC, COMBO) — `comboUpliftBreakdown` is the SAME
     function `yarnPurchase` calls internally per fabric (see its 2026-09-11
     header), so this walk cannot disagree with the stored `purchase_qty`
     as long as the order's declared route hasn't changed since Save. */
  const byProcess = new Map<string, StageBreakdownGroup>();
  for (const [fabricId, byCombo] of netByFabricCombo) {
    const fabricName = itemNames.get(fabricId) ?? "(fabric not found)";
    const route = routeByFabric.get(fabricId) ?? [];
    for (const [combo, net] of byCombo) {
      const ladder = comboUpliftBreakdown(route, combo);
      if (isReportRefusal(ladder)) continue; // an out-of-range loss: nothing to ladder, not a report crash
      for (const step of ladder.steps) {
        if (!step.process_id) continue;
        const name = processNames.get(step.process_id) ?? "(process not found)";
        let group = byProcess.get(step.process_id);
        if (!group) {
          group = { processName: name, lines: [], plannedTotal: 0, toOrderedTotal: 0 };
          byProcess.set(step.process_id, group);
        }
        const plannedWt = Number((net * step.factorBefore).toFixed(6));
        const toOrderedWt = Number((net * step.factorAfter).toFixed(6));
        group.lines.push({ fabricName, combo: combo || null, lossPct: step.loss_pct, plannedWt, toOrderedWt });
        group.plannedTotal += plannedWt;
        group.toOrderedTotal += toOrderedWt;
      }
    }
  }
  for (const group of byProcess.values()) {
    group.plannedTotal = Number(group.plannedTotal.toFixed(6));
    group.toOrderedTotal = Number(group.toOrderedTotal.toFixed(6));
  }

  return { header, yarns, stageBreakdown: [...byProcess.values()] };
}
