/**
 * Vectors for `lib/orders/trim-ta/engine.ts` — Material BOM (trims) T&A,
 * steps 12–17 (`doc/order/materialbomtana.md`, plan in
 * `doc/order/materialbomtana-plan.md`).
 *
 * The spec's own acceptance tests are QA-MAT-01…03 below. Every other vector is
 * chosen where two plausible implementations DISAGREE (check-ta-schedule.mts's
 * standard):
 *
 *     2026-10-19 is a MONDAY, so "cutting start − 1 day" in WORKING days is
 *     Saturday 10-17; in calendar days it would be Sunday 10-18.
 *
 * Runs under `tsx` (the `@/lib` aliases). `npm run check:trim-ta`.
 */
import {
  crossingDate,
  inHouseTarget,
  isOpenStep,
  summariseByClass,
  thresholdOf,
  trimClassOf,
  trimSchedule,
  type TrimMaterialInput,
  type TrimStep,
} from "../lib/orders/trim-ta/engine";
import { dayOfWeek } from "../lib/calendar";

let failed = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) {
    failed++;
    console.error(`FAIL  ${label}\n      expected ${JSON.stringify(expected)}\n      actual   ${JSON.stringify(actual)}`);
  } else {
    console.log(`ok    ${label}`);
  }
}

const CUT = "2026-10-19"; // Monday
const PACK = "2026-11-02"; // Monday

function sewing(over: Partial<TrimMaterialInput> = {}): TrimMaterialInput {
  return {
    trimClass: "SEWING",
    requiredQty: 1000,
    needsProcess: false,
    freeIssue: false,
    leadDays: null,
    ladder: { trimInward: null, anchorStart: CUT },
    events: {},
    today: "2026-10-12",
    ...over,
  };
}
function packing(over: Partial<TrimMaterialInput> = {}): TrimMaterialInput {
  return sewing({ trimClass: "PACKING", ladder: { trimInward: null, anchorStart: PACK }, ...over });
}
const step = (steps: TrimStep[], code: string) => steps.find((s) => s.code === code)!;
const pick = (s: TrimStep) => ({ status: s.status, target: s.target, actualDate: s.actualDate });

// ---------------------------------------------------------------------------
// 0. The fixture's own premise.
// ---------------------------------------------------------------------------
check("2026-10-19 really is a Monday", dayOfWeek(CUT), 1);
check("2026-11-02 really is a Monday", dayOfWeek(PACK), 1);

// ---------------------------------------------------------------------------
// 1. QA-MAT-01 — staggered in-house dates.
// ---------------------------------------------------------------------------
const thread = trimSchedule(sewing());
const polyBag = trimSchedule(packing());
check("QA-MAT-01: Thread (sewing) GRN target = Cutting start − 1 working day", step(thread, "SEWING_GRN").target, "2026-10-17");
check("QA-MAT-01: Poly Bag (packing) GRN target = Packing start − 1 working day", step(polyBag, "PACKING_GRN").target, "2026-10-31");
check("the two classes are staggered, not one bulk date", step(thread, "SEWING_GRN").target !== step(polyBag, "PACKING_GRN").target, true);
check("sewing trims carry steps 12–15", thread.map((s) => s.number), [12, 13, 14, 15]);
check("packing trims carry 16–17 only (no process steps)", polyBag.map((s) => s.number), [16, 17]);
check(
  "the order's own T&A tab wins over the rule (SEWTRIM dated 10-16)",
  step(trimSchedule(sewing({ ladder: { trimInward: "2026-10-16", anchorStart: CUT } })), "SEWING_GRN").target,
  "2026-10-16",
);
check(
  "no anchor and no trim row → undated, with a sentence (never a guessed date)",
  (() => {
    const s = step(trimSchedule(sewing({ ladder: { trimInward: null, anchorStart: null } })), "SEWING_GRN");
    return [s.target, s.targetNote];
  })(),
  [null, "Cutting start is not scheduled on the order's T&A tab"],
);
check("inHouseTarget names its source", inHouseTarget("PACKING", { trimInward: null, anchorStart: PACK }), { date: "2026-10-31", source: "rule" });

// PO target = in-house − lead, working days. 10-17 − 7 → 10-09 (crosses Sunday 10-11).
check("PO target = in-house − 7 working days (spec default)", step(thread, "SEWING_PO").target, "2026-10-09");
check("PO target uses the vendor's lead when known (3 → 10-14)", step(trimSchedule(sewing({ leadDays: 3 })), "SEWING_PO").target, "2026-10-14");

// ---------------------------------------------------------------------------
// 2. QA-MAT-02 — conditional process bypass.
// ---------------------------------------------------------------------------
const careLabel = trimSchedule(sewing({ needsProcess: false }));
check(
  "QA-MAT-02: Care Label, no job-work → 14 & 15 BYPASSED",
  [step(careLabel, "SEWING_PROCESS_DC").status, step(careLabel, "SEWING_PROCESS_GRN").status],
  ["BYPASSED", "BYPASSED"],
);
check(
  "QA-MAT-02: bypassed steps are excluded from the active store queue",
  careLabel.filter(isOpenStep).map((s) => s.number),
  [12, 13],
);
const tipped = trimSchedule(sewing({ needsProcess: true }));
check(
  "a processed trim keeps 14 & 15 live, dated on the in-house day",
  [pick(step(tipped, "SEWING_PROCESS_DC")), pick(step(tipped, "SEWING_PROCESS_GRN"))],
  [
    { status: "PENDING", target: "2026-10-17", actualDate: null },
    { status: "PENDING", target: "2026-10-17", actualDate: null },
  ],
);

// ---------------------------------------------------------------------------
// 3. QA-MAT-03 — automated GRN closure, stamped with the CROSSING document's date.
// ---------------------------------------------------------------------------
const buttons = trimSchedule(
  sewing({
    events: {
      grn: [
        { date: "2026-10-10", qty: 400, code: "GRN-1", settled: true },
        { date: "2026-10-14", qty: 600, code: "GRN-2", settled: true },
      ],
    },
  }),
);
check(
  "QA-MAT-03: receipts equal to the BOM count → Step 13 COMPLETED on the crossing GRN's date",
  pick(step(buttons, "SEWING_GRN")),
  { status: "COMPLETED", target: "2026-10-17", actualDate: "2026-10-14" },
);
check("…and the stamp says it came from a document", step(buttons, "SEWING_GRN").actualSource, "document");
check(
  "a partial receipt is IN_PROGRESS, not done",
  step(trimSchedule(sewing({ events: { grn: [{ date: "2026-10-10", qty: 400, code: "GRN-1", settled: true }] } })), "SEWING_GRN").status,
  "IN_PROGRESS",
);
check(
  "crossing is found in DATE order, not the order rows arrive in",
  crossingDate(
    [
      { date: "2026-10-14", qty: 600, code: "B", settled: true },
      { date: "2026-10-10", qty: 400, code: "A", settled: true },
    ],
    400,
  ),
  { date: "2026-10-10", qty: 400 },
);

// ---------------------------------------------------------------------------
// 4. Tolerance — SUM(received) >= required × (1 − tolerance).
// ---------------------------------------------------------------------------
const got950 = { grn: [{ date: "2026-10-10", qty: 950, code: "GRN-1", settled: true }] };
check("950 of 1000 at 0% tolerance is not done", step(trimSchedule(sewing({ events: got950 })), "SEWING_GRN").status, "IN_PROGRESS");
check(
  "950 of 1000 at 5% tolerance IS done",
  step(trimSchedule(sewing({ events: got950, marks: { SEWING_GRN: { tolerancePct: 5 } } })), "SEWING_GRN").status,
  "COMPLETED",
);
check("tolerance is clamped to 10%", thresholdOf(1000, 50), 900);
check("float noise does not miss a threshold (0.1 + 0.2 ≥ 0.3)", crossingDate([
  { date: "2026-10-10", qty: 0.1, code: "A", settled: true },
  { date: "2026-10-11", qty: 0.2, code: "B", settled: true },
], thresholdOf(0.3, 0)), { date: "2026-10-11", qty: 0.3 });

// ---------------------------------------------------------------------------
// 5. What must NOT complete a step.
// ---------------------------------------------------------------------------
check(
  "a DRAFT / unapproved PO for the full quantity is In progress, not issued",
  // today 10-01, before the PO target of 10-09, so lateness cannot mask the answer
  step(
    trimSchedule(sewing({ today: "2026-10-01", events: { po: [{ date: "2026-10-01", qty: 1000, code: "PO-1", settled: false }] } })),
    "SEWING_PO",
  ).status,
  "IN_PROGRESS",
);
check(
  "an unresolved requirement never auto-completes, whatever arrives",
  step(trimSchedule(sewing({ requiredQty: null, events: got950 })), "SEWING_GRN").status,
  "IN_PROGRESS",
);
check(
  "overdue is derived: target 10-17 passed, nothing received",
  step(trimSchedule(sewing({ today: "2026-10-20" })), "SEWING_GRN").status,
  "OVERDUE",
);
check("a target that is today is not yet overdue", step(trimSchedule(sewing({ today: "2026-10-17" })), "SEWING_GRN").status, "PENDING");

// ---------------------------------------------------------------------------
// 6. Free issue and the manual stamp.
// ---------------------------------------------------------------------------
const free = trimSchedule(sewing({ freeIssue: true }));
check("free issue → PO BYPASSED, receipt still owed", [step(free, "SEWING_PO").status, step(free, "SEWING_GRN").status], ["BYPASSED", "PENDING"]);
check(
  "a manual Done-on wins and says so",
  (() => {
    const s = step(trimSchedule(sewing({ today: "2026-10-20", marks: { SEWING_GRN: { doneOn: "2026-10-15" } } })), "SEWING_GRN");
    return [s.status, s.actualDate, s.actualSource];
  })(),
  ["COMPLETED", "2026-10-15", "manual"],
);

// ---------------------------------------------------------------------------
// 7. Classification.
// ---------------------------------------------------------------------------
check("item class SEW → SEWING, PACK → PACKING, FABRIC → not a trim", [trimClassOf("SEW"), trimClassOf(" pack "), trimClassOf("FABRIC")], ["SEWING", "PACKING", null]);

// ---------------------------------------------------------------------------
// 8. Class-wise roll-up — the "sewing items / packing items wise" view.
// ---------------------------------------------------------------------------
{
  const buttonsDone = { itemName: "BUTTON", trimClass: "SEWING" as const, steps: buttons };
  const labelOpen = { itemName: "CARE LABEL", trimClass: "SEWING" as const, steps: careLabel };
  const bag = { itemName: "POLY BAG", trimClass: "PACKING" as const, steps: polyBag };
  const roll = summariseByClass([buttonsDone, labelOpen, bag]);
  const grn = roll.SEWING.find((s) => s.code === "SEWING_GRN")!;
  check("class-wise: sewing GRN is 1 of 2 done and still PENDING, naming the open trim", [grn.status, grn.doneCount, grn.totalCount, grn.openItems], ["PENDING", 1, 2, ["CARE LABEL"]]);
  check("class-wise: no actual date until the LAST item is in", grn.actualDate, null);
  check("class-wise: process steps BYPASSED when no sewing trim needs job-work", roll.SEWING.find((s) => s.code === "SEWING_PROCESS_DC")!.status, "BYPASSED");
  check("class-wise: packing has its own two rows", roll.PACKING.map((s) => s.number), [16, 17]);
  const allDone = summariseByClass([buttonsDone, { ...buttonsDone, itemName: "THREAD" }]);
  const g2 = allDone.SEWING.find((s) => s.code === "SEWING_GRN")!;
  check("class-wise: all items in → COMPLETED on the last item's date", [g2.status, g2.actualDate, g2.doneCount], ["COMPLETED", "2026-10-14", 2]);
  const oneLate = summariseByClass([buttonsDone, { itemName: "ZIP", trimClass: "SEWING", steps: trimSchedule(sewing({ today: "2026-10-20" })) }]);
  check("class-wise: one overdue item makes the class step OVERDUE", oneLate.SEWING.find((s) => s.code === "SEWING_GRN")!.status, "OVERDUE");
  check("class-wise: target is the EARLIEST item target", summariseByClass([buttonsDone, { itemName: "Z", trimClass: "SEWING", steps: trimSchedule(sewing({ ladder: { trimInward: "2026-10-10", anchorStart: CUT } })) }]).SEWING.find((s) => s.code === "SEWING_GRN")!.target, "2026-10-10");
}

if (failed) {
  console.error(`\n${failed} vector(s) FAILED`);
  process.exit(1);
}
console.log("\nall trim T&A vectors pass");
