import { isRefusal, subtractWorkingDays } from "@/lib/ta/schedule";
import { daysBetween } from "@/lib/calendar";

/**
 * Material BOM (trims) T&A — steps 12–17 of `doc/order/materialbomtana.md`.
 * Plan and the reasoning behind every departure from the spec's literal DDL:
 * `doc/order/materialbomtana-plan.md`.
 *
 * PURE and client-safe. Every rule of the feature lives here — the step
 * vocabulary, the in-house target, the completion threshold, the status — so
 * the service only LOADS and `scripts/check-trim-ta.mts` can prove the whole
 * behaviour without a database. A rule stated twice (once in a query, once in a
 * render) is two rules the first time one of them is edited.
 *
 * ## THE GRAIN IS (ORDER, MATERIAL), NEVER THE BOM LINE
 *
 * The spec keys its schedule on `material_bom_item_id … ON DELETE CASCADE`.
 * Here that would erase the schedule on every BOM save — the editor deletes and
 * reinserts its lines (`writeChildren`), so a line id lives exactly as long as
 * one save. And a PO or GRN line names an order and a material, never a BOM
 * line, so two lines of the same thread could not be told apart by a receipt
 * anyway. It is also the grain the PO ceiling already judges at.
 *
 * ## NOTHING HERE IS STORED
 *
 * Status, quantities, OVERDUE and the actual date are DERIVED from the real
 * documents every read. The spec's store ledger would be a second copy of the
 * PO / GRN / DC tables this ERP already holds, and a copy drifts. The only
 * stored inputs are what a person decides (`order_trim_ta_marks`, 0608):
 * tolerance, a manual done date, remarks, who owns the step.
 */

export type TrimClass = "SEWING" | "PACKING";

export type TrimStepCode =
  | "SEWING_PO"
  | "SEWING_GRN"
  | "SEWING_PROCESS_DC"
  | "SEWING_PROCESS_GRN"
  | "PACKING_PO"
  | "PACKING_GRN";

/** OVERDUE is a status here but is never stored — it is `target < today`
 *  on a step not yet done, the same rule 0607 uses for the office milestones. */
export type TrimStepStatus = "PENDING" | "IN_PROGRESS" | "COMPLETED" | "OVERDUE" | "BYPASSED";

/** Which document stream a step is judged against. */
export type TrimStepKind = "po" | "grn" | "dc_out" | "dc_in";

export interface TrimStepDef {
  code: TrimStepCode;
  /** The spec's step number, 12–17 — shown to the operator, never computed on. */
  number: number;
  trimClass: TrimClass;
  label: string;
  /** Short document word for the column: PO · GRN · DC. */
  doc: string;
  /** What the operator reads on screen — the spec's LABEL is the register
   *  name, this is the plain one ("Received in store"). */
  short: string;
  kind: TrimStepKind;
}

/** The six steps, in the order the spec numbers them. The one vocabulary. */
export const TRIM_STEPS: readonly TrimStepDef[] = [
  { code: "SEWING_PO", number: 12, trimClass: "SEWING", label: "SEWING MATERIAL PURCHASE ORDERS", doc: "PO", short: "Purchase order", kind: "po" },
  { code: "SEWING_GRN", number: 13, trimClass: "SEWING", label: "SEWING MATERIAL PURCHASE RECEIPTS", doc: "GRN", short: "Received in store", kind: "grn" },
  { code: "SEWING_PROCESS_DC", number: 14, trimClass: "SEWING", label: "SEWING MATERIAL PROCESS DELIVERY", doc: "DC", short: "Sent for processing", kind: "dc_out" },
  { code: "SEWING_PROCESS_GRN", number: 15, trimClass: "SEWING", label: "SEWING MATERIAL PROCESS RECEIPTS", doc: "GRN", short: "Back from processing", kind: "dc_in" },
  { code: "PACKING_PO", number: 16, trimClass: "PACKING", label: "PACKING MATERIAL PURCHASE ORDERS", doc: "PO", short: "Purchase order", kind: "po" },
  { code: "PACKING_GRN", number: 17, trimClass: "PACKING", label: "PACKING MATERIAL PURCHASE RECEIPTS", doc: "GRN", short: "Received in store", kind: "grn" },
];

export const TRIM_STEP_CODES = TRIM_STEPS.map((s) => s.code) as readonly TrimStepCode[];

export function trimStepDef(code: TrimStepCode): TrimStepDef {
  return TRIM_STEPS.find((s) => s.code === code)!;
}

/** Item-class code → trim class. Anything else is not a trim and is skipped. */
export function trimClassOf(itemClassCode: string | null | undefined): TrimClass | null {
  const c = (itemClassCode ?? "").trim().toUpperCase();
  if (c === "SEW") return "SEWING";
  if (c === "PACK") return "PACKING";
  return null;
}

/** The spec's default when no vendor lead time is known (§5: `leadTimeDays || 7`). */
export const DEFAULT_LEAD_DAYS = 7;

/** Tolerance is a receipt allowance, not a discount — capped where the DB caps it. */
export const MAX_TOLERANCE_PCT = 10;

// ---------------------------------------------------------------------------
// Rule 3.1 — the in-house target
// ---------------------------------------------------------------------------

/**
 * What the order's own T&A tab says about the dates this rule hangs off.
 * `trimInward` is the stored date of the side activity (SEWTRIM / PACKTRIM,
 * 0561); `anchorStart` is the START of CUT / PACK. Either may be null — a
 * ladder that refused, a Days cell left blank, or an order with no such row.
 */
export interface LadderAnchors {
  trimInward: string | null;
  anchorStart: string | null;
}

export type InHouseTarget =
  | { date: string; source: "ladder" | "rule" }
  | { date: null; refused: string };

/**
 * ## THE ORDER'S OWN T&A TAB WINS, THE SPEC'S "−1" IS THE FALLBACK
 *
 * The order already shows "SEWING TRIMS INWARD" / "PACKING TRIMS INWARD", dated
 * the operator's Days before CUT / PACK. A second rule computing the same date
 * differently would put two in-house dates for one trim on two screens. Where
 * the order has no such row (orders before 0561 were deliberately never
 * injected with one), the spec's own rule applies: anchor START − 1 working day.
 */
export function inHouseTarget(trimClass: TrimClass, ladder: LadderAnchors): InHouseTarget {
  if (ladder.trimInward) return { date: ladder.trimInward, source: "ladder" };
  if (ladder.anchorStart) {
    const d = subtractWorkingDays(ladder.anchorStart, 1);
    if (!isRefusal(d)) return { date: d, source: "rule" };
    return { date: null, refused: d.refused };
  }
  return {
    date: null,
    refused:
      trimClass === "SEWING"
        ? "Cutting start is not scheduled on the order's T&A tab"
        : "Packing start is not scheduled on the order's T&A tab",
  };
}

// ---------------------------------------------------------------------------
// Rule 3.3 — completion from documents
// ---------------------------------------------------------------------------

/**
 * One document's contribution to a step.
 *
 * `settled` separates what COUNTS toward done from what only shows movement: an
 * approved PO counts, a draft or pending-approval one does not (it is a
 * quantity somebody may still change) — but its existence still moves the
 * step to In progress. A posted GRN counts; the stream holds only posted ones.
 */
export interface TrimDocEvent {
  date: string;
  qty: number;
  code: string | null;
  settled: boolean;
}

/** Per-step human input (`order_trim_ta_marks`). All optional. */
export interface TrimStepMark {
  tolerancePct?: number | null;
  doneOn?: string | null;
  remarks?: string | null;
  assignedStaffId?: string | null;
}

export interface TrimMaterialInput {
  trimClass: TrimClass;
  /** The BOM's Final Quantity for the material, in the purchase unit — the same
   *  figure the PO ceiling caps against. NULL when the BOM could not compute it
   *  (a refused slice): then nothing auto-completes, because a threshold built
   *  from a partial sum reads as correct and is not. */
  requiredQty: number | null;
  /** Rule 3.2 — any live line ticked Send Out, or a BOM process row for it. */
  needsProcess: boolean;
  /** Every line of the material is Supply Type = Free Issue: the buyer supplies
   *  it, so no PO is raised and step 12/16 is BYPASSED. */
  freeIssue: boolean;
  /** Largest vendor lead time across the material's lines; null → default 7. */
  leadDays: number | null;
  ladder: LadderAnchors;
  events: Partial<Record<TrimStepKind, TrimDocEvent[]>>;
  marks?: Partial<Record<TrimStepCode, TrimStepMark>>;
  /** The business day to judge OVERDUE against (IST, from `lib/calendar`). */
  today: string;
}

export interface TrimStep {
  code: TrimStepCode;
  number: number;
  label: string;
  short: string;
  doc: string;
  trimClass: TrimClass;
  status: TrimStepStatus;
  target: string | null;
  /** Why there is no target, or where it came from — always a sentence. */
  targetNote: string | null;
  requiredQty: number | null;
  /** Settled quantity so far (issued / received / sent / returned). */
  doneQty: number;
  /** Required × (1 − tolerance). */
  threshold: number | null;
  tolerancePct: number;
  actualDate: string | null;
  actualSource: "document" | "manual" | null;
  /** Documents that fed the step, oldest first. */
  docCodes: string[];
  /** Working-day-agnostic calendar float: target − today (negative = late). */
  float: number | null;
  remarks: string | null;
  assignedStaffId: string | null;
}

/** 6dp, the UOM layer's own ceiling — so 0.1 + 0.2 meets a threshold of 0.3. */
const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

export function thresholdOf(requiredQty: number, tolerancePct: number): number {
  const tol = Math.min(Math.max(tolerancePct, 0), MAX_TOLERANCE_PCT);
  return round6(requiredQty * (1 - tol / 100));
}

/**
 * The date the settled quantity first met the threshold — the date of the
 * document that CROSSED it, not the day anyone noticed. That is the spec's
 * "auto-stamps actual_completion_date", made truthful: a GRN posted today for
 * goods received last Tuesday stamps last Tuesday.
 */
export function crossingDate(
  events: readonly TrimDocEvent[],
  threshold: number,
): { date: string; qty: number } | null {
  const settled = events
    .filter((e) => e.settled && e.qty > 0)
    .sort((a, b) => (a.date === b.date ? (a.code ?? "").localeCompare(b.code ?? "") : a.date < b.date ? -1 : 1));
  let cum = 0;
  for (const e of settled) {
    cum = round6(cum + e.qty);
    if (cum >= threshold) return { date: e.date, qty: cum };
  }
  return null;
}

function bypassReason(def: TrimStepDef, m: TrimMaterialInput): string | null {
  if ((def.kind === "dc_out" || def.kind === "dc_in") && !m.needsProcess) {
    return "No job-work on this trim — not ticked Send Out and no process on the BOM";
  }
  if (def.kind === "po" && m.freeIssue) return "Free issue — the buyer supplies this trim";
  return null;
}

/**
 * The schedule for ONE material. Sewing trims get 12–15 (14/15 BYPASSED when no
 * job-work); packing trims get 16–17 only — the spec inserts process steps for
 * sewing alone (§5: `isSewing && item.isProcess`).
 */
export function trimSchedule(m: TrimMaterialInput): TrimStep[] {
  const inHouse = inHouseTarget(m.trimClass, m.ladder);
  const lead = m.leadDays != null && m.leadDays >= 0 ? Math.round(m.leadDays) : DEFAULT_LEAD_DAYS;

  return TRIM_STEPS.filter((d) => d.trimClass === m.trimClass).map((def) => {
    const mark = m.marks?.[def.code] ?? {};
    const tolerancePct = Math.min(Math.max(Number(mark.tolerancePct ?? 0) || 0, 0), MAX_TOLERANCE_PCT);
    const events = m.events[def.kind] ?? [];
    const settledQty = round6(events.filter((e) => e.settled).reduce((s, e) => s + e.qty, 0));
    const docCodes = [
      ...new Set(
        [...events]
          .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
          .map((e) => e.code)
          .filter((c): c is string => !!c),
      ),
    ];

    // TARGET. PO = in-house − lead (working days); every other step = in-house
    // (the spec dates 14 and 15 on the in-house day too).
    let target: string | null = inHouse.date;
    let targetNote: string | null =
      "date" in inHouse && inHouse.date
        ? inHouse.source === "ladder"
          ? "From the order's T&A tab"
          : "1 working day before the anchor's start"
        : (inHouse as { refused: string }).refused;
    if (def.kind === "po" && inHouse.date) {
      const po = subtractWorkingDays(inHouse.date, lead);
      if (isRefusal(po)) {
        target = null;
        targetNote = po.refused;
      } else {
        target = po;
        targetNote = `${lead} working day${lead === 1 ? "" : "s"} lead before in-house${m.leadDays == null ? " (default)" : ""}`;
      }
    }

    const base: TrimStep = {
      code: def.code,
      number: def.number,
      label: def.label,
      short: def.short,
      doc: def.doc,
      trimClass: def.trimClass,
      status: "PENDING",
      target,
      targetNote,
      requiredQty: m.requiredQty,
      doneQty: settledQty,
      threshold: m.requiredQty != null && m.requiredQty > 0 ? thresholdOf(m.requiredQty, tolerancePct) : null,
      tolerancePct,
      actualDate: null,
      actualSource: null,
      docCodes,
      float: null,
      remarks: mark.remarks ?? null,
      assignedStaffId: mark.assignedStaffId ?? null,
    };

    // Rule 3.2 — bypassed steps carry no target: nothing is owed on them.
    const bypass = bypassReason(def, m);
    if (bypass) return { ...base, status: "BYPASSED", target: null, targetNote: bypass };

    // A person's word beats the derivation — it covers what the system cannot
    // see (a PO raised outside the ERP, a free-issue receipt with no GRN).
    if (mark.doneOn) return { ...base, status: "COMPLETED", actualDate: mark.doneOn, actualSource: "manual" };

    // Rule 3.3 — auto-completion.
    if (base.threshold != null) {
      const crossed = crossingDate(events, base.threshold);
      if (crossed) return { ...base, status: "COMPLETED", actualDate: crossed.date, actualSource: "document" };
    }

    const moving = events.some((e) => e.qty > 0);
    const float = target ? daysBetween(m.today, target) : null;
    const late = target != null && target < m.today;
    return { ...base, float, status: late ? "OVERDUE" : moving ? "IN_PROGRESS" : "PENDING" };
  });
}

/** An open step is one the store still owes: not done, not bypassed. */
export function isOpenStep(s: Pick<TrimStep, "status">): boolean {
  return s.status !== "COMPLETED" && s.status !== "BYPASSED";
}

/** `StatusTone` values (lib/ui/tone), spelled out so this file stays import-light. */
export const TRIM_STATUS_TONE: Record<TrimStepStatus, "success" | "warning" | "danger" | "info" | "neutral"> = {
  PENDING: "neutral",
  IN_PROGRESS: "info",
  COMPLETED: "success",
  OVERDUE: "danger",
  BYPASSED: "neutral",
};

export const TRIM_STATUS_LABEL: Record<TrimStepStatus, string> = {
  PENDING: "Pending",
  IN_PROGRESS: "In progress",
  COMPLETED: "Completed",
  OVERDUE: "Overdue",
  BYPASSED: "Bypassed",
};

// ---------------------------------------------------------------------------
// The CLASS-WISE view — one row per step for all sewing trims, and one for all
// packing trims (client 2026-09-21: "two options — item wise, and sewing items /
// packing items wise"). A roll-up of the item-wise steps, never a second rule.
// ---------------------------------------------------------------------------

export interface TrimClassStep {
  code: TrimStepCode;
  number: number;
  label: string;
  short: string;
  doc: string;
  trimClass: TrimClass;
  /** The worst status across the class's live items: any OVERDUE → OVERDUE,
   *  else any IN_PROGRESS → IN_PROGRESS, else any PENDING → PENDING, else all
   *  COMPLETED → COMPLETED. BYPASSED only when every item bypasses the step. */
  status: TrimStepStatus;
  /** Earliest target among the live items — the first date the store owes. */
  target: string | null;
  /** The LAST item's completion date — the class is in only when all are. */
  actualDate: string | null;
  /** Items whose step is done, over items that owe the step (bypassed excluded). */
  doneCount: number;
  totalCount: number;
  /** Names of the items still open, so the roll-up says WHICH trims are short. */
  openItems: string[];
}

export function summariseByClass(
  materials: readonly { itemName: string; trimClass: TrimClass; steps: readonly TrimStep[] }[],
): Record<TrimClass, TrimClassStep[]> {
  const out: Record<TrimClass, TrimClassStep[]> = { SEWING: [], PACKING: [] };
  for (const def of TRIM_STEPS) {
    const rows = materials
      .filter((m) => m.trimClass === def.trimClass)
      .map((m) => ({ name: m.itemName, step: m.steps.find((s) => s.code === def.code) }))
      .filter((x): x is { name: string; step: TrimStep } => !!x.step);
    if (rows.length === 0) continue;
    const live = rows.filter((r) => r.step.status !== "BYPASSED");
    const base = { code: def.code, number: def.number, label: def.label, short: def.short, doc: def.doc, trimClass: def.trimClass };
    if (live.length === 0) {
      out[def.trimClass].push({ ...base, status: "BYPASSED", target: null, actualDate: null, doneCount: 0, totalCount: 0, openItems: [] });
      continue;
    }
    const statuses = new Set(live.map((r) => r.step.status));
    const status: TrimStepStatus = statuses.has("OVERDUE")
      ? "OVERDUE"
      : statuses.has("IN_PROGRESS")
        ? "IN_PROGRESS"
        : statuses.has("PENDING")
          ? "PENDING"
          : "COMPLETED";
    const targets = live.map((r) => r.step.target).filter((t): t is string => !!t).sort();
    const done = live.filter((r) => r.step.status === "COMPLETED");
    const actuals = done.map((r) => r.step.actualDate).filter((d): d is string => !!d).sort();
    out[def.trimClass].push({
      ...base,
      status,
      target: targets[0] ?? null,
      actualDate: status === "COMPLETED" ? (actuals[actuals.length - 1] ?? null) : null,
      doneCount: done.length,
      totalCount: live.length,
      openItems: live.filter((r) => r.step.status !== "COMPLETED").map((r) => r.name),
    });
  }
  return out;
}
