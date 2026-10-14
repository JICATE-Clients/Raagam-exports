import type { BomDocHeader } from "@/lib/orders/fabric-bom/reports";
import type { RequirementSheetData } from "@/lib/orders/requirement/service";
import type { SheetNames, StoredRequirement } from "@/lib/orders/requirement/sheet";
import type { PlanReportHeader } from "./types";

/**
 * THE SAMPLE ACCESSORIES PLAN, AS ORDER ENTRY'S ACCESSORIES PLAN REPORT (user
 * 2026-10-14: "the report is take reference same format from order entry
 * accessories plan report format").
 *
 * Order Entry's Accessories Plan prints the **Accessories Requirement** — the
 * sheet format: masthead and order facts, Quantity to cut, the trims' count
 * tiles, TRIMS PURCHASE (Category · Item Name · Consumption · Color · Size ·
 * Specification · UOM · Required Qty) and the sign-off. Its loader reads an
 * order's `material_bom_amendment_requirements`, which a sample plan does not
 * have — but its RENDERER (`RequirementSheetDocument`) and its PDF / Excel
 * (`exportAccessoriesRequirementPdf`, `exportAccessoriesCsv`) read nothing but
 * a `RequirementSheetData`. So this file builds that object from the sample
 * plan's STORED rows, and the sample prints through the very same document.
 * The Fabric Plan does the same with the Yarn & Fabric Requirement
 * (./yarn-fabric.ts).
 *
 * THE MAPPING, decided once here:
 *  - RE No → the SWO No; Order No → the SMP Numbers; Style → the style names
 *    (never the PRD number — client 2026-10-14: PRD is a bulk production
 *    number); Quantity to cut → the samples' pieces, with no excess, approval
 *    or rejection on a sample, so Order = Cut.
 *  - One stored row per (line, colour, size). A line whose breakup names one
 *    colour and size is ONE row carrying the line's own stored Required Qty.
 *    A colour- or size-wise line is one row per colour · size, the stored
 *    Required Qty shared in proportion to each part's planned quantity — the
 *    loss is one factor across the line (Required = Planned × (1 + loss)), so
 *    the parts add back to the stored figure; nothing else is re-derived.
 *  - Consumption reads "<planned> <unit> / <pieces> PCS": the quantity
 *    planned against the pieces of the samples that use it — the sample's own
 *    ratio, where an order prints its per-garment one. Unknown pieces → "—".
 *  - Specification is the line's own typed text, blank when none (Order
 *    Entry's 2026-09-29 rule).
 *
 * Pure: the loader (./service.ts) reads, this shapes.
 */

export type SampleAccessoryLine = {
  id: string;
  sno: number;
  itemId: string;
  itemName: string;
  category: string | null;
  specification: string | null;
  colourId: string | null;
  consumptionUomId: string | null;
  plannedQty: number | null;
  requiredQty: number | null;
  refusal: string | null;
  /** The line's own SMP (0710) — the breakup's when the line has no slices. */
  sampleStyleId: string | null;
  slices: { sampleStyleId: string | null; colourId: string | null; size: string | null; plannedQty: number | null }[];
};

export type SampleAccessoriesInput = {
  header: PlanReportHeader;
  /** The plan's last save — printed as "Requirement stored …". */
  savedAt: string | null;
  lines: SampleAccessoryLine[];
  uoms: Record<string, { code: string; decimals: number | null }>;
  colours: Record<string, string>;
};

const r6 = (v: number) => Number(v.toFixed(6));
const distinct = (xs: (string | null | undefined)[]) => [...new Set(xs.map((x) => (x ?? "").trim()).filter(Boolean))];

/**
 * The order documents' header (`BomDocHeader`) for a sample plan — the facts
 * band and Quantity to cut every Order Entry sheet opens on.
 */
export function sampleDocHeader(h: PlanReportHeader, computedAt: string | null): BomDocHeader {
  const dates = h.samples.map((x) => x.deliveryDate).filter((d): d is string => !!d).sort();
  const pieces = h.samples.reduce((t, x) => t + (x.qty ?? 0), 0);
  return {
    bomId: h.bomId,
    garmentOrderId: h.iwoId,
    bomCode: h.iwoCode,
    bomDate: h.planDate,
    computedAt,
    // The SWO stands where an order prints its RE No.
    scNo: h.swoCode ?? h.iwoCode,
    customer: distinct(h.samples.map((x) => x.customer)).join(", ") || null,
    orderNo: distinct(h.samples.map((x) => x.smpNo)).join(", ") || null,
    styleRefNo: distinct(h.samples.map((x) => x.styleName)).join(", ") || null,
    styleName: h.description,
    styleNo: null,
    deliveryFromDate: dates[0] ?? null,
    deliveryToDate: dates[dates.length - 1] ?? null,
    earlierShipmentDate: dates[0] ?? null,
    excessPct: null,
    // A sample is cut to its pieces: no excess, approval or rejection allowance.
    qty: { orderQty: pieces, excessQty: 0, rejectionQty: 0, approvalQty: 0, cutQty: pieces, approvalPct: null, rejectionPct: null },
    company: {
      name: h.company.name,
      address: h.company.address ?? null,
      unit: h.company.unit,
      gstin: h.company.gstin ?? null,
      logo: h.company.logo,
    },
  };
}

export function sampleAccessoriesRequirement(input: SampleAccessoriesInput): RequirementSheetData {
  const { header: h } = input;
  const piecesOf = new Map(h.samples.map((x) => [x.styleId, x.qty ?? 0]));
  const names: SheetNames = { items: {}, uoms: input.uoms, sizes: {}, colours: input.colours, lines: {} };
  const rows: StoredRequirement[] = [];

  for (const l of input.lines) {
    names.items[l.itemId] = { name: l.itemName, category: l.category };
    names.lines![l.id] = { supplyType: null, specification: l.specification };

    // The line's parts, by colour · size — the line's own colour where a part names none.
    type Part = { colourId: string | null; size: string | null; planned: number; styles: Set<string> };
    const parts = new Map<string, Part>();
    const slices = l.slices.length
      ? l.slices
      : [{ sampleStyleId: l.sampleStyleId, colourId: null, size: null, plannedQty: l.plannedQty }];
    for (const sl of slices) {
      const colourId = sl.colourId ?? l.colourId;
      const size = sl.size?.trim() || null;
      const key = `${colourId ?? ""}|${size ?? ""}`;
      const part = parts.get(key) ?? { colourId, size, planned: 0, styles: new Set<string>() };
      part.planned = r6(part.planned + (sl.plannedQty ?? 0));
      if (sl.sampleStyleId) part.styles.add(sl.sampleStyleId);
      parts.set(key, part);
    }

    const list = [...parts.values()];
    const planned = l.plannedQty ?? list.reduce((t, p) => t + p.planned, 0);
    for (const p of list) {
      // One part carries the stored figure itself; several share it by planned quantity.
      const required =
        l.requiredQty == null
          ? null
          : list.length === 1
            ? l.requiredQty
            : planned > 0
              ? r6((l.requiredQty * p.planned) / planned)
              : null;
      const pieces = [...p.styles].reduce((t, id) => t + (piecesOf.get(id) ?? 0), 0);
      const sizeKey = p.size ? `size:${p.size}` : null;
      if (sizeKey) names.sizes[sizeKey] = p.size!;
      rows.push({
        item_id: l.itemId,
        item_line_id: l.id,
        sno: l.sno,
        slice_label: p.size,
        size_id: sizeKey,
        item_color_id: p.colourId,
        no_of_items: p.planned > 0 ? p.planned : null,
        per_pieces: pieces > 0 ? pieces : null,
        required_qty: required,
        refusal_reason: required == null ? (l.refusal ?? "Required quantity not worked out — save the plan again.") : null,
        consumption_uom_id: l.consumptionUomId,
      });
    }
  }

  const docHeader = sampleDocHeader(h, input.savedAt);
  const pieces = h.samples.reduce((t, x) => t + (x.qty ?? 0), 0);
  return {
    bom: {
      id: h.bomId,
      code: h.iwoCode,
      amendmentNo: h.revisionNo,
      amendDate: h.planDate,
      computedAt: input.savedAt,
      computedForQty: pieces || null,
    },
    order: {
      scNo: docHeader.scNo,
      customer: docHeader.customer,
      orderNo: docHeader.orderNo,
      orderDate: h.planDate,
      deliveryDate: docHeader.deliveryFromDate,
      excessPct: null,
    },
    company: { name: h.company.name, address: h.company.address ?? null, gstin: h.company.gstin ?? null, email: null },
    header: docHeader,
    rows,
    names,
  };
}
