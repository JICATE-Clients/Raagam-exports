/**
 * SAMPLE PLAN REPORTS + APPROVAL — the shared, client-safe half (user
 * 2026-10-13: "we need to prepare like order entry report kind of report for
 * sample module fabric plan and accessories plan … understood based on it …
 * separate approval screen like order entry").
 *
 * Two documents, one per plan of an SWO, read by three surfaces:
 *   - the report pages (`/sales/sample-…-plan/<plan>/report`), Download PDF /
 *     Print beside them, as every order report has;
 *   - Sample ▸ Plan Approval, where the approver reads the SAME document
 *     before deciding — the plan is approved on what the report says;
 *   - the PDF exporter, which prints the same object the screen renders, so
 *     the file and the screen can never disagree.
 *
 * Pure: no `@/lib/supabase`, no JSX. The loaders are ./service.ts.
 */

export type PlanKind = "fabric" | "accessories";

/**
 * A sample plan's approval (0718 Fabric, 0720 Accessories): `open` →
 * `submitted` → `approved`, or `returned` by the approver (editable again,
 * resubmit). Submitted and approved LOCK the plan in the database; Raise
 * Revision reopens an approved one as the next revision.
 */
export type PlanApprovalStatus = "open" | "submitted" | "approved" | "returned";

export const PLAN_KIND_LABEL: Record<PlanKind, string> = {
  fabric: "Fabric Plan",
  accessories: "Accessories Plan",
};

/** Where each plan's editor lives — the approval screen's "Open plan". */
export const PLAN_EDITOR_PATH: Record<PlanKind, string> = {
  fabric: "/sales/sample-fabric-plan",
  accessories: "/sales/sample-accessories-plan",
};

export const planReportHref = (kind: PlanKind, bomId: string) => `${PLAN_EDITOR_PATH[kind]}/${bomId}/report`;

/** What a list and a badge call each state. */
export function planApprovalLabel(status: PlanApprovalStatus, revisionNo: number): string {
  switch (status) {
    case "submitted":
      return revisionNo > 0 ? `Rev ${revisionNo} with approver` : "With approver";
    case "approved":
      return revisionNo > 0 ? `Approved · Rev ${revisionNo}` : "Approved";
    case "returned":
      return "Sent back";
    default:
      return revisionNo > 0 ? `Revision ${revisionNo} open` : "Not submitted";
  }
}

export function planApprovalTone(status: PlanApprovalStatus, revisionNo: number): "success" | "info" | "warning" | "neutral" {
  if (status === "approved") return "success";
  if (status === "submitted") return "info";
  if (status === "returned" || revisionNo > 0) return "warning";
  return "neutral";
}

// ---------------------------------------------------------------------------
// The documents
// ---------------------------------------------------------------------------

export type PlanSample = { styleId: string; smpNo: string | null; sampleNo: string | null; styleName: string };

/** One purchase line as it was approved before a revision reopened the plan. */
export type ApprovedLine = { item_id: string | null; name: string | null; purchase_qty: number | null; uom: string | null };

export type PlanReportHeader = {
  kind: PlanKind;
  bomId: string;
  iwoId: string;
  swoCode: string | null;
  iwoCode: string | null;
  planDate: string | null;
  season: string | null;
  description: string | null;
  samples: PlanSample[];
  isDraft: boolean;
  status: PlanApprovalStatus;
  revisionNo: number;
  submittedAt: string | null;
  decidedAt: string | null;
  decisionRemark: string | null;
  approvedAt: string | null;
  company: { name: string | null; unit: string | null; logo: string | null };
  /** The revision that reopened the plan (the newest one), with what had been
   *  approved before it — null before any revision. */
  revision: { revisionNo: number; reason: string; raisedAt: string; approved: ApprovedLine[] } | null;
};

export type FabricPlanFabricRow = {
  /** "SMP/26-27/0001 · POLO" — or "—" for a row no sample names. */
  sample: string;
  fabric: string;
  structure: string | null;
  stage: string | null;
  form: string | null;
  gsm: number | null;
  colour: string | null;
  dia: string | null;
  print: string | null;
  part: string | null;
  reqKg: number;
};

export type FabricPlanYarnRow = {
  yarn: string;
  buyStage: string | null;
  colourBy: string | null;
  plannedKg: number | null;
  purchaseQty: number | null;
  uom: string | null;
  refusal: string | null;
  shades: { colour: string; plannedKg: number | null; purchaseQty: number | null }[];
};

export type FabricPlanRouteStep = { stage: string | null; process: string; type: string | null; lossPct: number | null };

export type FabricPlanReport = {
  header: PlanReportHeader;
  fabrics: FabricPlanFabricRow[];
  /** Σ Req Kg per sample, in sample order — the first thing an approver checks
   *  against Grouping's kilos. */
  bySample: { sample: string; kg: number }[];
  fabricTotalKg: number;
  yarns: FabricPlanYarnRow[];
  /** Null when a yarn refused or two units disagree — a 0 there would read
   *  as "buy nothing" (the order report's own rule). */
  yarnTotal: { qty: number; uom: string | null } | null;
  routes: { fabric: string; steps: FabricPlanRouteStep[] }[];
};

export type AccessoriesPlanItemRow = {
  sno: number;
  category: string | null;
  item: string;
  specification: string | null;
  colour: string | null;
  consumptionUom: string | null;
  plannedQty: number | null;
  moq: number | null;
  roundTo: number | null;
  requiredQty: number | null;
  purchaseQty: number | null;
  purchaseUom: string | null;
  advised: boolean;
  foc: boolean;
  sendOut: boolean;
  refusal: string | null;
  breakup: { sample: string; colour: string | null; size: string | null; qty: number | null }[];
};

export type AccessoriesPlanReport = {
  header: PlanReportHeader;
  items: AccessoriesPlanItemRow[];
  processes: { item: string; stage: string | null; process: string; lossPct: number | null; vendor: string | null }[];
};

export type PlanReport = { kind: "fabric"; report: FabricPlanReport } | { kind: "accessories"; report: AccessoriesPlanReport };

// ---------------------------------------------------------------------------
// What changed since the last approval
// ---------------------------------------------------------------------------

export type PlanChange = { name: string; uom: string | null; before: number | null; now: number | null; kind: "added" | "removed" | "changed" };

/**
 * A REVISION'S PURCHASE LINES AGAINST WHAT WAS APPROVED BEFORE IT — what the
 * approver of a revised plan actually has to decide on. Matched by material
 * (summed per material + unit, as the purchase gate sums them), never by
 * position: a reordered plan is not a changed one. Unchanged lines are left
 * out; an empty list means the revision changed no purchase quantity.
 */
export function planChanges(before: readonly ApprovedLine[], now: readonly ApprovedLine[]): PlanChange[] {
  // By the material's NAME and unit: the snapshot (SQL) carries ids, the
  // report's lines carry the same `items.name` and no id, and the name is
  // what both sides share. Case and spacing are not a change.
  const key = (l: ApprovedLine) => `${(l.name ?? "").trim().toUpperCase()}|${l.uom ?? ""}`;
  const sum = (lines: readonly ApprovedLine[]) => {
    const m = new Map<string, { name: string; uom: string | null; qty: number | null }>();
    for (const l of lines) {
      const k = key(l);
      const held = m.get(k);
      const q = l.purchase_qty == null ? null : Number(l.purchase_qty);
      if (!held) m.set(k, { name: l.name?.trim() || "A material", uom: l.uom, qty: q });
      else held.qty = held.qty == null || q == null ? null : Math.round((held.qty + q) * 1e6) / 1e6;
    }
    return m;
  };
  const a = sum(before);
  const b = sum(now);
  const out: PlanChange[] = [];
  for (const [k, x] of b) {
    const was = a.get(k);
    if (!was) out.push({ name: x.name, uom: x.uom, before: null, now: x.qty, kind: "added" });
    else if (was.qty !== x.qty) out.push({ name: x.name, uom: x.uom, before: was.qty, now: x.qty, kind: "changed" });
  }
  for (const [k, x] of a) if (!b.has(k)) out.push({ name: x.name, uom: x.uom, before: x.qty, now: null, kind: "removed" });
  return out;
}

/** The plan's purchase lines in the shape a revision snapshot stores. */
export function currentPurchaseLines(r: PlanReport): ApprovedLine[] {
  if (r.kind === "fabric") {
    return r.report.yarns.map((y) => ({ item_id: null, name: y.yarn, purchase_qty: y.purchaseQty, uom: y.uom }));
  }
  return r.report.items.map((i) => ({ item_id: null, name: i.item, purchase_qty: i.purchaseQty, uom: i.purchaseUom }));
}
