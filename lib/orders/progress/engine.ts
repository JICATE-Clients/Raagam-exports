/**
 * Order progress tracker + delivery risk — the ONE rule (doc/order/digitalisation-plan.md §1).
 *
 * Pure and client-safe: the tracker screen, the nightly alert sweep and
 * `scripts/check-order-progress.mts` all read this file, so the screen and the
 * alert can never disagree about whether an order is at risk.
 *
 * ## NOTHING HERE IS STORED
 *
 * Every stage is DERIVED from documents the teams already make — the Work Flow
 * milestones (0607), the order's T&A ladder, production entries, inspections,
 * shipments and purchase lines. A tracker that needed its own data entry would
 * be one more screen to fall behind, and the first thing it would show is
 * that nobody had filled it in.
 *
 * ## WHY THE FABRIC / TRIM T&A ENGINES ARE NOT USED FOR RISK
 *
 * They read the Fabric BOM requirement report through RLS, so they only run
 * inside a signed-in session — and the nightly sweep has none. A risk rule
 * that ran on the screen and not in the alert would alert on a different
 * answer than the one the MD is looking at. The tracker links to those tabs for
 * item-level detail instead.
 */

import { addDays, daysBetween } from "@/lib/calendar";
import { taSpanEnd } from "@/lib/orders/ta/order-ladder";
import {
  WORK_FLOW_MILESTONES,
  workFlowView,
  type WorkFlowDisplayState,
  type WorkFlowView,
} from "@/lib/orders/work-flow/types";
import type { StatusTone } from "@/lib/ui/tone";

// ============================================================================
// INPUT — what the service reads, per RE
// ============================================================================

export type ProgressInput = {
  /** `sales_orders.status`: confirmed · in_production · shipped · closed · cancelled. */
  orderStatus: string | null;
  /** Σ po_qty over the current document's quantity rows. NULL = no rows. */
  orderQty: number | null;
  /** Earliest quantity-row delivery date, else the document header's. */
  deliveryDate: string | null;
  workFlow: { code: string; target_date: string | null; actual_date: string | null; status: string }[];
  /** The order's T&A ladder rows, keyed by the activity's short name (CUT, SEW, …). */
  ladder: { shortName: string; target_date: string | null; days_required: number | null; actual_date: string | null }[];
  /** Purchase lines raised against the RE (`po_line_items.sales_order_id`). */
  poLines: { quantity: number; received_qty: number }[];
  /** `production_entries` for the RE. */
  production: { stage: string; entry_date: string; good_qty: number }[];
  inspections: { inspection_date: string | null; result: string | null; status: string | null }[];
  /** Lines on shipments that have actually left (shipped / delivered / closed). */
  shipped: { date: string | null; qty: number }[];
};

// ============================================================================
// OUTPUT
// ============================================================================

export type StageGroup = "office" | "material" | "production" | "shipment";

export const STAGE_GROUP_LABELS: Record<StageGroup, string> = {
  office: "Office",
  material: "Material",
  production: "Production",
  shipment: "Shipment",
};

export type ProgressStage = {
  key: string;
  label: string;
  group: StageGroup;
  /** The date the stage must be FINISHED by. NULL = nothing plans it. */
  plan: string | null;
  actual: string | null;
  view: WorkFlowView;
  /** Pieces done / pieces needed — production and shipment stages only. */
  qtyDone: number | null;
  qtyTarget: number | null;
  /** One sentence on what the stage is judged by, or why it cannot be. */
  note: string | null;
  /** Where the work is done. */
  href: string | null;
};

export type RiskLevel = "late" | "at_risk" | "on_track" | "no_plan" | "shipped" | "closed" | "cancelled";

export type OrderRisk = {
  level: RiskLevel;
  /** Delivery date pushed out by the worst lateness. NULL unless at_risk. */
  projected: string | null;
  /** Calendar days: past delivery (late) or the projected slip (at_risk). */
  daysLate: number;
  /** The stage holding the order up, in words. */
  cause: string | null;
};

export const RISK_LABELS: Record<RiskLevel, string> = {
  late: "Late",
  at_risk: "At risk",
  on_track: "On track",
  no_plan: "No T&A plan",
  shipped: "Shipped",
  closed: "Closed",
  cancelled: "Cancelled",
};

export const RISK_TONES: Record<RiskLevel, StatusTone> = {
  late: "danger",
  at_risk: "warning",
  on_track: "success",
  no_plan: "neutral",
  shipped: "info",
  closed: "neutral",
  cancelled: "neutral",
};

/** Levels the alert sweep notifies on, worst last. */
export const ALERT_LEVELS = ["at_risk", "late"] as const;
export type AlertLevel = (typeof ALERT_LEVELS)[number];

export function isAlertLevel(level: RiskLevel): level is AlertLevel {
  return (ALERT_LEVELS as readonly string[]).includes(level);
}

export type OrderProgress = {
  stages: ProgressStage[];
  risk: OrderRisk;
  shippedQty: number;
};

// ============================================================================
// STAGE STATE — the Work Flow's own vocabulary, for every stage
// ============================================================================

/**
 * Pending / In progress / Overdue / Done / Done late — `workFlowView`'s rule,
 * applied to a derived stage, so one tracker never speaks two dialects. A
 * derived stage has no stored `status`, so "done" and "started" are passed in.
 */
export function stageView(
  s: { done: boolean; started: boolean; plan: string | null; actual: string | null },
  today: string,
): WorkFlowView {
  return workFlowView(
    { status: s.done ? "done" : s.started ? "in_progress" : "pending", target_date: s.plan, actual_date: s.actual },
    today,
  );
}

/** The date a running total first reached `target` — the day a stage finished. */
export function crossingDate(events: { date: string | null; qty: number }[], target: number): string | null {
  let sum = 0;
  const dated = events.filter((e) => e.date).sort((a, b) => (a.date! < b.date! ? -1 : a.date! > b.date! ? 1 : 0));
  for (const e of dated) {
    sum += e.qty;
    if (sum >= target) return e.date;
  }
  return null;
}

const sumQty = (rows: { qty: number }[]) => rows.reduce((s, r) => s + (Number.isFinite(r.qty) ? r.qty : 0), 0);

/** The production stage each ladder row is judged against. */
const PRODUCTION_STAGES: { key: string; shortName: string; label: string; stage: string }[] = [
  { key: "CUT", shortName: "CUT", label: "Cutting", stage: "cutting" },
  { key: "SEW", shortName: "SEW", label: "Sewing", stage: "sewing" },
  { key: "PACK", shortName: "PACK", label: "Packing", stage: "packing" },
];

// ============================================================================
// THE TIMELINE
// ============================================================================

export function buildProgress(input: ProgressInput, today: string): OrderProgress {
  const ladderOf = (short: string) => input.ladder.find((r) => r.shortName === short) ?? null;
  /** A ladder row's FINISH date — the day the next step needs it done. */
  const planOf = (short: string): string | null => {
    const r = ladderOf(short);
    return r?.target_date ? taSpanEnd(r.target_date, r.days_required) : null;
  };
  const manualActual = (short: string) => ladderOf(short)?.actual_date ?? null;

  const stages: ProgressStage[] = [];

  // ---- Office: the eight Work Flow milestones, exactly as the T&A tab shows them.
  for (const def of WORK_FLOW_MILESTONES) {
    const row = input.workFlow.find((w) => w.code === def.code);
    stages.push({
      key: def.code,
      label: def.label,
      group: "office",
      plan: row?.target_date ?? null,
      actual: row?.actual_date ?? null,
      view: row
        ? workFlowView({ status: row.status as "pending" | "in_progress" | "done", target_date: row.target_date, actual_date: row.actual_date }, today)
        : stageView({ done: false, started: false, plan: null, actual: null }, today),
      qtyDone: null,
      qtyTarget: null,
      note: row ? def.doneWhen : "Not started — the order has no Work Flow yet",
      href: def.href,
    });
  }

  // ---- Material: in-house. The ladder's own mark wins; otherwise every purchase
  //      line raised for the RE received in full. Mixed units (kg, pcs, cones)
  //      cannot be summed, so progress is counted in LINES, not quantity.
  {
    const lines = input.poLines;
    const full = lines.filter((l) => l.received_qty >= l.quantity && l.quantity > 0).length;
    const marked = manualActual("MATIH");
    const done = !!marked || (lines.length > 0 && full === lines.length);
    const plan = planOf("MATIH");
    stages.push({
      key: "MATIH",
      label: "Materials in-house",
      group: "material",
      plan,
      actual: marked,
      view: stageView({ done, started: lines.some((l) => l.received_qty > 0) || lines.length > 0, plan, actual: marked }, today),
      qtyDone: null,
      qtyTarget: null,
      note: marked
        ? "Marked on the order's T&A"
        : lines.length
          ? `${full} of ${lines.length} purchase lines received in full`
          : "No purchase orders raised for this order yet",
      href: "/orders/fabric-bom",
    });
  }

  // ---- Production: PP approval (ladder mark), then cut / sew / pack by quantity.
  {
    const plan = planOf("PPAPPR");
    const actual = manualActual("PPAPPR");
    stages.push({
      key: "PPAPPR",
      label: "PP approval",
      group: "production",
      plan,
      actual,
      view: stageView({ done: !!actual, started: false, plan, actual }, today),
      qtyDone: null,
      qtyTarget: null,
      note: actual ? "Marked on the order's T&A" : "Marked done on the order's T&A when the buyer approves",
      href: "/orders/ta-followup",
    });
  }

  const target = input.orderQty && input.orderQty > 0 ? input.orderQty : null;
  for (const p of PRODUCTION_STAGES) {
    const entries = input.production
      .filter((e) => e.stage === p.stage)
      .map((e) => ({ date: e.entry_date, qty: Number(e.good_qty) || 0 }));
    const qty = sumQty(entries);
    const marked = manualActual(p.shortName);
    const crossed = target != null && qty >= target ? crossingDate(entries, target) : null;
    const actual = marked ?? crossed;
    const done = !!marked || (target != null && qty >= target);
    const plan = planOf(p.shortName);
    stages.push({
      key: p.key,
      label: p.label,
      group: "production",
      plan,
      actual,
      view: stageView({ done, started: qty > 0, plan, actual }, today),
      qtyDone: qty,
      qtyTarget: target,
      note: target == null ? "Order quantity unknown — done only when marked on the T&A" : null,
      href: "/production",
    });
  }

  {
    const passes = input.inspections
      .filter((i) => i.result === "pass" && i.status !== "cancelled" && i.inspection_date)
      .map((i) => i.inspection_date!)
      .sort();
    const marked = manualActual("INSP");
    const actual = marked ?? passes.at(-1) ?? null;
    const plan = planOf("INSP");
    stages.push({
      key: "INSP",
      label: "Final inspection",
      group: "production",
      plan,
      actual,
      view: stageView({ done: !!actual, started: input.inspections.length > 0, plan, actual }, today),
      qtyDone: null,
      qtyTarget: null,
      note: actual ? null : input.inspections.length ? "Inspected, not yet passed" : null,
      href: "/production/inspections",
    });
  }

  // ---- Shipment: shipped quantity against the order, planned on the delivery date.
  const shippedQty = sumQty(input.shipped);
  {
    const crossed = target != null && shippedQty >= target ? crossingDate(input.shipped, target) : null;
    const done = target != null ? shippedQty >= target : false;
    stages.push({
      key: "SHIP",
      label: "Shipped",
      group: "shipment",
      plan: input.deliveryDate,
      actual: crossed,
      view: stageView({ done, started: shippedQty > 0, plan: input.deliveryDate, actual: crossed }, today),
      qtyDone: shippedQty,
      qtyTarget: target,
      note: input.deliveryDate ? null : "No delivery date on the order",
      href: "/logistics",
    });
  }

  return { stages, risk: orderRisk(input, stages, today), shippedQty };
}

// ============================================================================
// THE RISK RULE
// ============================================================================

const OPEN: ReadonlySet<WorkFlowDisplayState> = new Set(["pending", "in_progress", "overdue"]);

/**
 * - `late`: today is past the delivery date and the order has not shipped.
 * - `at_risk`: a Material or Production stage is past the date it had to finish
 *   by. The T&A ladder is scheduled BACKWARD from delivery with no slack, so a
 *   stage `n` days late projects delivery `n` days late. Projected = delivery +
 *   the largest such lateness, and that stage is the cause.
 * - `on_track`: neither. `no_plan` when nothing on the ladder carries a date,
 *   because then "nothing is late" means "nothing was planned", not "fine".
 *
 * Office milestones are scheduled FORWARD from order receipt, so their
 * lateness alone says nothing about delivery; it reaches the risk through the
 * material and production stages it delays. They still go red on the timeline.
 */
export function orderRisk(input: Pick<ProgressInput, "orderStatus" | "deliveryDate">, stages: ProgressStage[], today: string): OrderRisk {
  if (input.orderStatus === "cancelled") return { level: "cancelled", projected: null, daysLate: 0, cause: null };
  if (input.orderStatus === "closed") return { level: "closed", projected: null, daysLate: 0, cause: null };

  const ship = stages.find((s) => s.key === "SHIP");
  if (ship && !OPEN.has(ship.view.state)) return { level: "shipped", projected: null, daysLate: 0, cause: null };

  const delivery = input.deliveryDate;
  if (delivery && daysBetween(delivery, today) > 0) {
    return { level: "late", projected: null, daysLate: daysBetween(delivery, today), cause: "Delivery date has passed" };
  }

  const judged = stages.filter((s) => s.group === "material" || s.group === "production");
  let worst: ProgressStage | null = null;
  for (const s of judged) {
    if (s.view.state === "overdue" && (!worst || s.view.daysLate > worst.view.daysLate)) worst = s;
  }
  if (worst && delivery) {
    return {
      level: "at_risk",
      projected: addDays(delivery, worst.view.daysLate),
      daysLate: worst.view.daysLate,
      cause: `${worst.label} is ${worst.view.daysLate} day${worst.view.daysLate === 1 ? "" : "s"} late`,
    };
  }

  if (!delivery || judged.every((s) => !s.plan)) return { level: "no_plan", projected: null, daysLate: 0, cause: null };
  return { level: "on_track", projected: null, daysLate: 0, cause: null };
}
