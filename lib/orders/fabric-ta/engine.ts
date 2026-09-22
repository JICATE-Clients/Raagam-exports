import { addWorkingDays, isRefusal, subtractWorkingDays } from "@/lib/ta/schedule";
import { daysBetween } from "@/lib/calendar";
import { crossingDate, thresholdOf, MAX_TOLERANCE_PCT, type TrimDocEvent } from "@/lib/orders/trim-ta/engine";

/**
 * Fabric BOM T&A — steps 6–11 of `doc/order/fabricbom tanda.md` (Module 2).
 * Plan, and every departure from the spec's literal DDL:
 * `doc/order/fabricbom-tanda-plan.md`.
 *
 * PURE and client-safe. Every rule lives here — the step vocabulary, the
 * targets, what a fabric's source bypasses, the completion threshold, the
 * status — so the service only LOADS and `scripts/check-fabric-ta.mts` proves the
 * behaviour without a database.
 *
 * ## ONE COMPLETION RULE FOR BOTH TRACKERS
 *
 * `thresholdOf` and `crossingDate` are the trims tracker's (steps 12–17), not a
 * copy: "done when the settled quantity meets required × (1 − tolerance), dated
 * by the document that crossed it" is one rule, and two copies of it would be
 * two rules the first time one tracker's tolerance changed.
 *
 * ## TWO SUBJECTS, NOT ONE
 *
 * Steps 6–8 move YARN (bought, received, issued to the knitter); steps 9–11
 * move the FABRIC (greige back from the knitter, out to the dye house, finished
 * in). A yarn feeds several cloths and a cloth is knitted from several yarns,
 * so the grain is (order, yarn) for the first three and (order, fabric) for the
 * last three — which is also the spec's greige consolidation rule: every
 * colourway sharing a yarn is one knitting lot.
 *
 * ## NOTHING HERE IS STORED
 *
 * Status, quantities, OVERDUE and the actual date are derived from the real
 * documents on every read. The only stored input is `order_fabric_ta_marks`
 * (0609): tolerance, a manual done date, remarks, owner.
 */

export type FabricTaSubject = "YARN" | "FABRIC";

export type FabricTaStepCode = "YARN_PO" | "YARN_GRN" | "KNIT_DC" | "KNIT_GRN" | "PROCESS_DC" | "PROCESS_GRN";

/** OVERDUE is derived (target < today on an open step), never stored — the rule
 *  0607 and 0608 already use. */
export type FabricTaStatus = "PENDING" | "IN_PROGRESS" | "COMPLETED" | "OVERDUE" | "BYPASSED";

/** Which document stream a step is judged against. `fabric_grn` is a GRN of a
 *  PO for the FABRIC itself — the only receipt a purchased cloth has. */
export type FabricTaStream =
  | "yarn_po"
  | "yarn_grn"
  | "knit_issue"
  | "knit_receipt"
  | "process_issue"
  | "process_receipt"
  | "fabric_grn";

export interface FabricTaStepDef {
  code: FabricTaStepCode;
  /** The spec's step number, 6–11 — shown, never computed on. */
  number: number;
  subject: FabricTaSubject;
  label: string;
  /** Short document word for the column. */
  doc: string;
  /** The spec's inventory bucket this step moves stock into. */
  bucket: string;
}

/** The six steps, in the spec's order. The one vocabulary. */
export const FABRIC_TA_STEPS: readonly FabricTaStepDef[] = [
  { code: "YARN_PO", number: 6, subject: "YARN", label: "YARN PURCHASE ORDERS", doc: "PO", bucket: "Pending yarn PO" },
  { code: "YARN_GRN", number: 7, subject: "YARN", label: "YARN PURCHASE RECEIPTS", doc: "GRN", bucket: "Yarn store stock" },
  { code: "KNIT_DC", number: 8, subject: "YARN", label: "KNITTING DELIVERY", doc: "Issue", bucket: "In transit (knitting)" },
  { code: "KNIT_GRN", number: 9, subject: "FABRIC", label: "KNITTING RECEIPTS", doc: "Receipt", bucket: "Greige stock" },
  { code: "PROCESS_DC", number: 10, subject: "FABRIC", label: "FABRIC PROCESS DELIVERY", doc: "Issue", bucket: "In transit (dyeing)" },
  { code: "PROCESS_GRN", number: 11, subject: "FABRIC", label: "FABRIC PROCESS RECEIPTS", doc: "Receipt", bucket: "Finished stock" },
];

export const FABRIC_TA_STEP_CODES = FABRIC_TA_STEPS.map((s) => s.code) as readonly FabricTaStepCode[];

export function fabricTaStepDef(code: FabricTaStepCode): FabricTaStepDef {
  return FABRIC_TA_STEPS.find((s) => s.code === code)!;
}

export { MAX_TOLERANCE_PCT };

// ---------------------------------------------------------------------------
// Targets — spec §2.2, "Step 11 Target Date <= Cutting Start Date - 1 Day"
// ---------------------------------------------------------------------------

/**
 * THE DEFAULT GAPS BETWEEN STEPS, in WORKING days (Sunday off — the house rule
 * for every T&A date; the spec's own arithmetic is calendar days).
 *
 * The spec dates only Step 11. Back-scheduling the rest needs a gap per step,
 * and the spec gives none, so these are stated here, once, and printed beside
 * every target they produce as "(default)" — a number the operator can see is a
 * default is one they can question. The order's own T&A tab overrides three of
 * them (YARN PURCHASE, KNITTING, DYEING — see `FabricLadder`).
 */
export const FABRIC_TA_GAPS = {
  /** Step 10 → 11: greige at the dye house until finished rolls return. */
  processDays: 7,
  /** Step 9 → 10: greige received, then dispatched to the dye house. */
  greigeDispatchDays: 1,
  /** Step 8 → 9: yarn at the knitter until greige rolls return. */
  knittingDays: 5,
  /** Step 7 → 8: yarn received, then issued to the knitter. */
  yarnIssueDays: 1,
  /** Step 6 → 7: the yarn supplier's lead time (the trims tracker's default too). */
  yarnLeadDays: 7,
} as const;

/**
 * What the order's own T&A tab says. `cutStart` is CUTTING's stored date; the
 * other three are the optional YARN PURCHASE / KNITTING / DYEING rows, present
 * only where the order added them. Any may be null.
 */
export interface FabricLadder {
  cutStart: string | null;
  yarnPurchase: string | null;
  knitting: string | null;
  dyeing: string | null;
}

export type FabricTaTarget = { date: string | null; note: string };

/**
 * The six targets for one order.
 *
 * ## THE ORDER'S OWN T&A TAB WINS, THE BACK-SCHEDULE FILLS THE GAPS
 *
 * Same stance as the trims tracker: an order that already dates DYEING on its
 * T&A tab has told us when finished fabric is due, and a second rule computing
 * the same day differently would put two dates for one event on two screens.
 * Where the row is absent, the spec's rule applies (Step 11 = Cutting − 1) and
 * each earlier step is back-scheduled from the next by `FABRIC_TA_GAPS`.
 *
 * ## `cutGate` — WHEN THERE IS NO DYEING
 *
 * A fabric with no step after knitting has no Step 10/11; its KNITTING RECEIPT
 * is then the roll arriving for cutting and takes Step 11's date. The caller
 * picks it per fabric; both are computed here so the rule stays in one place.
 */
export function fabricTaTargets(
  ladder: FabricLadder,
): Record<FabricTaStepCode, FabricTaTarget> & { cutGate: FabricTaTarget } {
  const G = FABRIC_TA_GAPS;
  const back = (from: FabricTaTarget, days: number, what: string): FabricTaTarget => {
    if (!from.date) return { date: null, note: from.note };
    const d = subtractWorkingDays(from.date, days);
    if (isRefusal(d)) return { date: null, note: d.refused };
    return { date: d, note: `${days} working day${days === 1 ? "" : "s"} ${what} (default)` };
  };

  let cutGate: FabricTaTarget;
  if (ladder.cutStart) {
    const d = subtractWorkingDays(ladder.cutStart, 1);
    cutGate = isRefusal(d)
      ? { date: null, note: d.refused }
      : { date: d, note: "1 working day before cutting starts" };
  } else {
    cutGate = { date: null, note: "Cutting is not scheduled on the order's T&A tab" };
  }

  const s11: FabricTaTarget = ladder.dyeing
    ? { date: ladder.dyeing, note: "DYEING on the order's T&A tab" }
    : cutGate;
  const s10 = back(s11, G.processDays, "for processing before finished rolls are due");
  const s9: FabricTaTarget = ladder.knitting
    ? { date: ladder.knitting, note: "KNITTING on the order's T&A tab" }
    : back(s10, G.greigeDispatchDays, "before dispatch to the dye house");
  const s8 = back(s9, G.knittingDays, "for knitting before greige is due");
  const s7: FabricTaTarget = ladder.yarnPurchase
    ? { date: ladder.yarnPurchase, note: "YARN PURCHASE on the order's T&A tab" }
    : back(s8, G.yarnIssueDays, "before yarn is issued to the knitter");
  const s6 = back(s7, G.yarnLeadDays, "supplier lead before yarn is due");

  return {
    YARN_PO: s6,
    YARN_GRN: s7,
    KNIT_DC: s8,
    KNIT_GRN: s9,
    PROCESS_DC: s10,
    PROCESS_GRN: s11,
    cutGate,
  };
}

// ---------------------------------------------------------------------------
// One subject's schedule
// ---------------------------------------------------------------------------

/** One document's contribution — the trims tracker's own event shape. */
export type FabricTaEvent = TrimDocEvent;

export interface FabricTaMark {
  tolerancePct?: number | null;
  doneOn?: string | null;
  remarks?: string | null;
  assignedStaffId?: string | null;
}

/** Where the cloth comes from (0564) — see `./fabric-source.ts` in fabric-bom. */
export type FabricTaSource = "yarn_knit" | "greige_purchase" | "dyed_purchase";

export interface FabricTaYarnInput {
  subject: "YARN";
  /** The yarn's stored purchase weight on the current Fabric BOM (kg). NULL
   *  when the BOM refused it — then nothing auto-completes, because a threshold
   *  built on a missing figure reads as correct and is not. */
  requiredQty: number | null;
  events: Partial<Record<FabricTaStream, FabricTaEvent[]>>;
  marks?: Partial<Record<FabricTaStepCode, FabricTaMark>>;
  targets: ReturnType<typeof fabricTaTargets>;
  today: string;
}

export interface FabricTaFabricInput {
  subject: "FABRIC";
  source: FabricTaSource;
  /** Does the fabric's route run anything after knitting (dyeing, washing,
   *  compacting…)? No → steps 10/11 are bypassed and Step 9 is the cutting gate. */
  hasWetProcess: boolean;
  /** Greige weight — the knitting stage's OUTPUT, or the greige purchase (kg). */
  greigeQty: number | null;
  /** Finished weight — what cutting needs, or the dyed purchase (kg). */
  finishedQty: number | null;
  events: Partial<Record<FabricTaStream, FabricTaEvent[]>>;
  marks?: Partial<Record<FabricTaStepCode, FabricTaMark>>;
  targets: ReturnType<typeof fabricTaTargets>;
  today: string;
}

export interface FabricTaStep {
  code: FabricTaStepCode;
  number: number;
  label: string;
  doc: string;
  bucket: string;
  status: FabricTaStatus;
  target: string | null;
  /** Where the target came from, or why there is none — always a sentence. */
  targetNote: string | null;
  requiredQty: number | null;
  /** Settled quantity so far. */
  doneQty: number;
  threshold: number | null;
  tolerancePct: number;
  actualDate: string | null;
  actualSource: "document" | "manual" | null;
  docCodes: string[];
  /** Calendar days target − today (negative = late). */
  float: number | null;
  remarks: string | null;
  assignedStaffId: string | null;
  /** What this step is judged against, in words — a purchased cloth's Step 9
   *  reads GRNs, not knitting receipts, and the screen says so. */
  judgedBy: string;
}

/** 6dp — the UOM layer's own ceiling. */
const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

type Plan = {
  code: FabricTaStepCode;
  stream: FabricTaStream | null;
  required: number | null;
  target: FabricTaTarget;
  bypass: string | null;
  judgedBy: string;
};

/** Which document stream, which quantity and which target each step reads. */
function planFor(input: FabricTaYarnInput | FabricTaFabricInput): Plan[] {
  const T = input.targets;
  if (input.subject === "YARN") {
    const q = input.requiredQty;
    return [
      { code: "YARN_PO", stream: "yarn_po", required: q, target: T.YARN_PO, bypass: null, judgedBy: "Purchase orders for this yarn, raised for the order" },
      { code: "YARN_GRN", stream: "yarn_grn", required: q, target: T.YARN_GRN, bypass: null, judgedBy: "Posted GRNs against those POs (accepted qty)" },
      { code: "KNIT_DC", stream: "knit_issue", required: q, target: T.KNIT_DC, bypass: null, judgedBy: "Issues of this yarn on the order's knitting process orders" },
    ];
  }

  const f = input;
  const greige = f.greigeQty;
  const finished = f.finishedQty;
  /* NO WET PROCESS → THE GREIGE ROLL IS THE FINISHED ROLL, and Step 9 takes the
     cutting gate's date. Stated once here, read by both steps below. */
  const wet = f.hasWetProcess;
  const s9Target = wet ? T.KNIT_GRN : T.cutGate;
  const noWet = "No process after knitting on this fabric's route — the greige roll goes straight to cutting";

  if (f.source === "dyed_purchase") {
    const bought = "Bought as dyed rolls — no knitting and no processing here";
    return [
      { code: "KNIT_GRN", stream: null, required: null, target: T.KNIT_GRN, bypass: bought, judgedBy: "" },
      { code: "PROCESS_DC", stream: null, required: null, target: T.PROCESS_DC, bypass: bought, judgedBy: "" },
      { code: "PROCESS_GRN", stream: "fabric_grn", required: finished, target: T.PROCESS_GRN, bypass: null, judgedBy: "Posted GRNs against purchase orders for this fabric" },
    ];
  }
  const greigeBought = f.source === "greige_purchase";
  return [
    {
      code: "KNIT_GRN",
      stream: greigeBought ? "fabric_grn" : "knit_receipt",
      required: wet ? greige : (finished ?? greige),
      target: s9Target,
      bypass: null,
      judgedBy: greigeBought
        ? "Posted GRNs against purchase orders for this greige fabric"
        : "Posted receipts of this fabric on the order's knitting process orders",
    },
    {
      code: "PROCESS_DC",
      stream: "process_issue",
      required: greige,
      target: T.PROCESS_DC,
      bypass: wet ? null : noWet,
      judgedBy: "Issues of this fabric on the order's dyeing / washing / finishing process orders",
    },
    {
      code: "PROCESS_GRN",
      stream: "process_receipt",
      required: finished,
      target: T.PROCESS_GRN,
      bypass: wet ? null : noWet,
      judgedBy: "Posted receipts of this fabric on those process orders (accepted qty)",
    },
  ];
}

/**
 * The schedule for ONE yarn (steps 6–8) or ONE fabric (steps 9–11).
 *
 * Per step, in this order: bypassed → a person's manual done date → the
 * document that crossed the threshold → otherwise Overdue / In progress /
 * Pending by the target and whether anything has moved.
 */
export function fabricTaSchedule(input: FabricTaYarnInput | FabricTaFabricInput): FabricTaStep[] {
  return planFor(input).map((p) => {
    const def = fabricTaStepDef(p.code);
    const mark = input.marks?.[p.code] ?? {};
    const tolerancePct = Math.min(Math.max(Number(mark.tolerancePct ?? 0) || 0, 0), MAX_TOLERANCE_PCT);
    const events = p.stream ? (input.events[p.stream] ?? []) : [];
    const doneQty = round6(events.filter((e) => e.settled).reduce((s, e) => s + e.qty, 0));
    const docCodes = [
      ...new Set(
        [...events]
          .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
          .map((e) => e.code)
          .filter((c): c is string => !!c),
      ),
    ];
    const base: FabricTaStep = {
      code: p.code,
      number: def.number,
      label: def.label,
      doc: def.doc,
      bucket: def.bucket,
      status: "PENDING",
      target: p.target.date,
      targetNote: p.target.note,
      requiredQty: p.required,
      doneQty,
      threshold: p.required != null && p.required > 0 ? thresholdOf(p.required, tolerancePct) : null,
      tolerancePct,
      actualDate: null,
      actualSource: null,
      docCodes,
      float: null,
      remarks: mark.remarks ?? null,
      assignedStaffId: mark.assignedStaffId ?? null,
      judgedBy: p.judgedBy,
    };

    // Nothing is owed on a bypassed step, so it carries no target.
    if (p.bypass) return { ...base, status: "BYPASSED", target: null, targetNote: p.bypass, requiredQty: null, threshold: null };

    if (mark.doneOn) return { ...base, status: "COMPLETED", actualDate: mark.doneOn, actualSource: "manual" };

    // Spec §2.2 — "when cumulative GRN receipts equal or exceed planned BOM
    // requirement weight, Step 11 automatically flags COMPLETED" — every step.
    if (base.threshold != null) {
      const crossed = crossingDate(events, base.threshold);
      if (crossed) return { ...base, status: "COMPLETED", actualDate: crossed.date, actualSource: "document" };
    }

    const moving = events.some((e) => e.qty > 0);
    const float = base.target ? daysBetween(input.today, base.target) : null;
    const late = base.target != null && base.target < input.today;
    return { ...base, float, status: late ? "OVERDUE" : moving ? "IN_PROGRESS" : "PENDING" };
  });
}

/** An open step is one still owed: not done, not bypassed. */
export function isOpenFabricStep(s: Pick<FabricTaStep, "status">): boolean {
  return s.status !== "COMPLETED" && s.status !== "BYPASSED";
}

export const FABRIC_TA_STATUS_LABEL: Record<FabricTaStatus, string> = {
  PENDING: "Pending",
  IN_PROGRESS: "In progress",
  COMPLETED: "Completed",
  OVERDUE: "Overdue",
  BYPASSED: "Bypassed",
};

// ---------------------------------------------------------------------------
// Greige from the requirement report's stage ladder
// ---------------------------------------------------------------------------

/** One line of the report's stage breakdown, reduced to what this reads. */
export interface StageLineForGreige {
  itemId: string | null;
  combo: string | null;
  component: string | null;
  isKnitting: boolean;
  isClothPurchase: boolean;
  plannedWt: number;
  toOrderedWt: number;
}

/**
 * THE GREIGE WEIGHT OF ONE FABRIC, off the Yarn & Fabric Requirement report's
 * own stage ladder — so the tracker and the printed report cannot disagree.
 *
 * Per (colourway, component) slice: the KNITTING line's Planned Wt, which is
 * what knitting must PRODUCE (the report walks the route backwards, so a line's
 * planned weight is its output). A slice whose route declares no knitting step
 * falls back to the largest weight entering any of its steps — the cloth that
 * enters the route at all. Summed over slices, because the knitter knits one
 * lot for every colourway (the spec's consolidation rule).
 *
 * `hasWetProcess` is whether any line is a step other than knitting or a cloth
 * purchase.
 *
 * `routeDeclared` SEPARATES "NO PROCESS AFTER KNITTING" FROM "NOBODY HAS SAID".
 * A fabric with no line at all has no route on Fabric Process yet, and reading
 * that as "nothing after knitting" would BYPASS steps 10–11 — the tracker
 * claiming nothing is owed on a fabric whose dyeing nobody has declared. The
 * caller keeps those steps open instead, with the greige figure withheld.
 */
export function greigeFromStages(
  lines: readonly StageLineForGreige[],
  fabricId: string,
): { greigeQty: number | null; hasWetProcess: boolean; routeDeclared: boolean } {
  const mine = lines.filter((l) => l.itemId === fabricId);
  if (mine.length === 0) return { greigeQty: null, hasWetProcess: false, routeDeclared: false };
  const bySlice = new Map<string, StageLineForGreige[]>();
  for (const l of mine) {
    const k = `${l.combo ?? ""}\u0000${l.component ?? ""}`;
    const xs = bySlice.get(k);
    if (xs) xs.push(l);
    else bySlice.set(k, [l]);
  }
  let total = 0;
  for (const xs of bySlice.values()) {
    const knit = xs.filter((l) => l.isKnitting);
    total += knit.length
      ? knit.reduce((s, l) => s + l.plannedWt, 0)
      : Math.max(...xs.map((l) => l.toOrderedWt));
  }
  return {
    greigeQty: round6(total),
    hasWetProcess: mine.some((l) => !l.isKnitting && !l.isClothPurchase),
    routeDeclared: true,
  };
}

/** Same tones as the trims tracker, so a status reads the same on both boards. */
export const FABRIC_TA_STATUS_TONE: Record<FabricTaStatus, "success" | "warning" | "danger" | "info" | "neutral"> = {
  PENDING: "neutral",
  IN_PROGRESS: "info",
  COMPLETED: "success",
  OVERDUE: "danger",
  BYPASSED: "neutral",
};

// ---------------------------------------------------------------------------
// The GROUPED ladder — one row per step (client 2026-09-21: "group it like the
// Order Entry T&A; a single T&A is enough").
// ---------------------------------------------------------------------------

export interface FabricTaLadderRow {
  code: FabricTaStepCode;
  number: number;
  label: string;
  doc: string;
  status: FabricTaStatus;
  /** The step's target — one per order, from `fabricTaTargets`. */
  target: string | null;
  targetNote: string | null;
  /** The LAST actual across the materials: a step is done when its last
   *  material is, and that is the date the order can move on. */
  actualDate: string | null;
  /** How many yarns / fabrics carry this step, and how many are done. */
  total: number;
  done: number;
  /** Σ done / Σ required over the materials carrying the step (kg). `required`
   *  is null when any material's figure is unknown — a partial sum reads as
   *  a whole one. */
  doneQty: number;
  requiredQty: number | null;
  /** Materials still open on this step, by name — what the row is waiting on. */
  waitingOn: string[];
  float: number | null;
}

/**
 * The six-row ladder off the per-material schedules. Rolled up, never
 * recomputed: every figure here is a sum or a max of what `fabricTaSchedule`
 * already decided, so the grouped view and the detailed one cannot disagree.
 *
 * Row status: BYPASSED if every material bypasses it (or none carries it);
 * COMPLETED when every non-bypassed material is done; OVERDUE if any open
 * material is overdue; IN_PROGRESS if anything has moved; else PENDING.
 */
export function fabricTaLadder(
  materials: readonly { itemName: string; steps: readonly FabricTaStep[] }[],
  targets: ReturnType<typeof fabricTaTargets>,
  today: string,
): FabricTaLadderRow[] {
  return FABRIC_TA_STEPS.map((def) => {
    const mine = materials.flatMap((m) => m.steps.filter((s) => s.code === def.code).map((s) => ({ name: m.itemName, s })));
    const live = mine.filter((x) => x.s.status !== "BYPASSED");
    const doneOnes = live.filter((x) => x.s.status === "COMPLETED");
    const target = targets[def.code];
    const base: FabricTaLadderRow = {
      code: def.code,
      number: def.number,
      label: def.label,
      doc: def.doc,
      status: "PENDING",
      target: target.date,
      targetNote: target.note,
      actualDate: null,
      total: live.length,
      done: doneOnes.length,
      doneQty: Math.round(live.reduce((a, x) => a + x.s.doneQty, 0) * 1e6) / 1e6,
      requiredQty: live.length && live.every((x) => x.s.requiredQty != null)
        ? Math.round(live.reduce((a, x) => a + (x.s.requiredQty ?? 0), 0) * 1e6) / 1e6
        : null,
      waitingOn: live.filter((x) => x.s.status !== "COMPLETED").map((x) => x.name),
      float: null,
    };
    if (live.length === 0) {
      const why = mine[0]?.s.targetNote ?? "No material on this BOM carries this step";
      return { ...base, status: "BYPASSED", target: null, targetNote: why };
    }
    if (doneOnes.length === live.length) {
      const last = doneOnes.map((x) => x.s.actualDate).filter((d): d is string => !!d).sort().at(-1) ?? null;
      return { ...base, status: "COMPLETED", actualDate: last };
    }
    const float = base.target ? daysBetween(today, base.target) : null;
    const status: FabricTaStatus = live.some((x) => x.s.status === "OVERDUE")
      ? "OVERDUE"
      : live.some((x) => x.s.status === "IN_PROGRESS" || x.s.status === "COMPLETED")
        ? "IN_PROGRESS"
        : "PENDING";
    return { ...base, status, float };
  });
}

/**
 * WORKING DAYS between two consecutive ladder targets — the "Days" cell of the
 * grouped ladder, so it reads like the Order Entry T&A's Days column (working
 * days, Sunday off, the house rule). `from` ≥ `to` gives 0; either missing
 * gives null (a gap the row cannot state).
 */
export function workingDaysGap(from: string | null, to: string | null): number | null {
  if (!from || !to || to < from) return null;
  let n = 0;
  let cur = from;
  // Bounded: two ladder targets are never more than a few months apart.
  for (let guard = 0; cur < to && guard < 400; guard++) {
    const next = addWorkingDays(cur, 1);
    if (isRefusal(next)) return null;
    cur = next;
    n++;
  }
  return n;
}
