/**
 * Vectors for Fabric BOM T&A — steps 6–11 (`lib/orders/fabric-ta/engine.ts`).
 * Spec `doc/order/fabricbom tanda.md` Module 2; plan `doc/order/fabricbom-tanda-plan.md`.
 *
 * Each block pins one rule, and each was made to FAIL against a mutation of
 * the engine before being trusted (see the bottom of this file for which).
 *
 * Dates: 2026-10-05 is a Monday. Sunday is the only day off, so one working day
 * before Monday is SATURDAY 2026-10-03.
 *
 * Run: npx tsx scripts/check-fabric-ta.mts
 */
import {
  FABRIC_TA_GAPS,
  fabricTaLadder,
  fabricTaSchedule,
  fabricTaTargets,
  greigeFromStages,
  isOpenFabricStep,
  type FabricTaEvent,
  type FabricTaFabricInput,
  type FabricTaYarnInput,
} from "../lib/orders/fabric-ta/engine";
import { subtractWorkingDays } from "../lib/ta/schedule";

let failed = 0;
let passed = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    passed++;
    console.log(`ok    ${label}`);
  } else {
    failed++;
    console.error(`FAIL  ${label}\n      expected ${JSON.stringify(expected)}\n      actual   ${JSON.stringify(actual)}`);
  }
}
const sub = (d: string, n: number) => subtractWorkingDays(d, n) as string;

const LADDER = { cutStart: "2026-10-05", yarnPurchase: null, knitting: null, dyeing: null };
const T = fabricTaTargets(LADDER);
const TODAY = "2026-09-21";
const ev = (date: string, qty: number, code: string, settled = true): FabricTaEvent => ({ date, qty, code, settled });

// ---------------------------------------------------------------------------
// 1. SPEC §2.2 — Step 11 = Cutting start − 1 day, and the back-schedule.
// ---------------------------------------------------------------------------
check("Step 11 is 1 working day before cutting (Mon → Sat)", T.PROCESS_GRN.date, "2026-10-03");
check("Step 10 is processDays before Step 11", T.PROCESS_DC.date, sub("2026-10-03", FABRIC_TA_GAPS.processDays));
check("Step 9 is one dispatch day before Step 10", T.KNIT_GRN.date, sub(T.PROCESS_DC.date!, FABRIC_TA_GAPS.greigeDispatchDays));
check("Step 8 is knittingDays before Step 9", T.KNIT_DC.date, sub(T.KNIT_GRN.date!, FABRIC_TA_GAPS.knittingDays));
check("Step 7 is one issue day before Step 8", T.YARN_GRN.date, sub(T.KNIT_DC.date!, FABRIC_TA_GAPS.yarnIssueDays));
check("Step 6 is the yarn lead before Step 7", T.YARN_PO.date, sub(T.YARN_GRN.date!, FABRIC_TA_GAPS.yarnLeadDays));
check("Sunday is skipped: 7 working days before Sat 10-03 is Fri 09-25", sub("2026-10-03", 7), "2026-09-25");
check("a back-scheduled target says it is a default", T.PROCESS_DC.note.endsWith("(default)"), true);

// ---------------------------------------------------------------------------
// 2. THE ORDER'S OWN T&A TAB WINS where it has the row.
// ---------------------------------------------------------------------------
{
  const own = fabricTaTargets({ cutStart: "2026-10-05", yarnPurchase: "2026-09-10", knitting: "2026-09-20", dyeing: "2026-09-30" });
  check("DYEING's date is Step 11's", own.PROCESS_GRN.date, "2026-09-30");
  check("KNITTING's date is Step 9's", own.KNIT_GRN.date, "2026-09-20");
  check("YARN PURCHASE's date is Step 7's", own.YARN_GRN.date, "2026-09-10");
  check("...and Step 6 back-schedules from the ladder's Step 7", own.YARN_PO.date, sub("2026-09-10", FABRIC_TA_GAPS.yarnLeadDays));
  const none = fabricTaTargets({ cutStart: null, yarnPurchase: null, knitting: null, dyeing: null });
  check("no cutting date → no target, and a sentence saying why", [none.PROCESS_GRN.date, none.PROCESS_GRN.note], [null, "Cutting is not scheduled on the order's T&A tab"]);
  check("...which every earlier step inherits rather than inventing a date", none.YARN_PO.date, null);
}

// ---------------------------------------------------------------------------
// 3. SPEC §2.2 — auto-completion when receipts meet the requirement (1000 kg).
// ---------------------------------------------------------------------------
{
  const fab = (events: FabricTaFabricInput["events"], marks: FabricTaFabricInput["marks"] = {}): FabricTaFabricInput => ({
    subject: "FABRIC",
    source: "yarn_knit",
    hasWetProcess: true,
    greigeQty: 1052.6,
    finishedQty: 1000,
    events,
    marks,
    targets: T,
    today: TODAY,
  });
  const s = fabricTaSchedule(fab({ process_receipt: [ev("2026-09-28", 600, "PMR-1"), ev("2026-09-30", 400, "PMR-2")] }));
  const s11 = s.find((x) => x.code === "PROCESS_GRN")!;
  check("600 + 400 = 1000 kg received → Step 11 COMPLETED", s11.status, "COMPLETED");
  check("...dated by the receipt that CROSSED 1000, not the first", s11.actualDate, "2026-09-30");
  check("...from a document, not a person", s11.actualSource, "document");

  const short = fabricTaSchedule(fab({ process_receipt: [ev("2026-09-28", 990, "PMR-1")] })).find((x) => x.code === "PROCESS_GRN")!;
  check("990 of 1000 with no tolerance is still open", short.status, "IN_PROGRESS");
  const tol = fabricTaSchedule(fab({ process_receipt: [ev("2026-09-28", 990, "PMR-1")] }, { PROCESS_GRN: { tolerancePct: 1 } })).find((x) => x.code === "PROCESS_GRN")!;
  check("...and 1 % tolerance closes it (threshold 990)", [tol.status, tol.threshold], ["COMPLETED", 990]);
  const draft = fabricTaSchedule(fab({ process_receipt: [ev("2026-09-28", 1000, "PMR-1", false)] })).find((x) => x.code === "PROCESS_GRN")!;
  check("an unposted receipt shows movement but never completes", draft.status, "IN_PROGRESS");
  const manual = fabricTaSchedule(fab({}, { PROCESS_GRN: { doneOn: "2026-09-20" } })).find((x) => x.code === "PROCESS_GRN")!;
  check("a manual done date wins, labelled manual", [manual.status, manual.actualSource], ["COMPLETED", "manual"]);

  const knit = s.find((x) => x.code === "KNIT_GRN")!;
  check("Step 9 needs the GREIGE weight, not the finished one", knit.requiredQty, 1052.6);
  const dc = s.find((x) => x.code === "PROCESS_DC")!;
  check("Step 10 ships the greige weight too", dc.requiredQty, 1052.6);
}

// ---------------------------------------------------------------------------
// 4. OVERDUE is derived; nothing moving and not late is PENDING.
// ---------------------------------------------------------------------------
{
  const late: FabricTaYarnInput = { subject: "YARN", requiredQty: 500, events: {}, targets: T, today: "2026-12-01" };
  check("past target, nothing done → OVERDUE", fabricTaSchedule(late).map((s) => s.status), ["OVERDUE", "OVERDUE", "OVERDUE"]);
  const early: FabricTaYarnInput = { subject: "YARN", requiredQty: 500, events: { yarn_po: [ev("2026-09-01", 200, "PO-1", false)] }, targets: T, today: "2026-09-01" };
  check("a draft PO before the target → IN_PROGRESS, others PENDING", fabricTaSchedule(early).map((s) => s.status), ["IN_PROGRESS", "PENDING", "PENDING"]);
  const refused: FabricTaYarnInput = { subject: "YARN", requiredQty: null, events: { yarn_grn: [ev("2026-09-01", 9999, "GRN-1")] }, targets: T, today: "2026-09-01" };
  check("a refused requirement never auto-completes, however much arrives", fabricTaSchedule(refused)[1].status, "IN_PROGRESS");
}

// ---------------------------------------------------------------------------
// 5. WHERE THE CLOTH COMES FROM (0564) bypasses steps.
// ---------------------------------------------------------------------------
{
  const base = { subject: "FABRIC" as const, hasWetProcess: true, greigeQty: 100, finishedQty: 95, events: {}, targets: T, today: TODAY };
  const dyed = fabricTaSchedule({ ...base, source: "dyed_purchase" });
  check("dyed purchase: knitting receipt and process delivery are bypassed", dyed.map((s) => s.status), ["BYPASSED", "BYPASSED", "PENDING"]);
  check("...and Step 11 is judged by fabric GRNs", dyed[2].judgedBy.startsWith("Posted GRNs"), true);
  const grey = fabricTaSchedule({ ...base, source: "greige_purchase", events: { fabric_grn: [ev("2026-09-20", 100, "GRN-9")], knit_receipt: [ev("2026-09-20", 100, "PMR-9")] } });
  check("greige purchase: Step 9 completes on the fabric GRN", grey[0].status, "COMPLETED");
  check("...and reads GRNs, never knitting receipts", grey[0].docCodes, ["GRN-9"]);
  const bypassed = isOpenFabricStep({ status: "BYPASSED" });
  check("a bypassed step is not open (kept out of the queue)", bypassed, false);
}

// ---------------------------------------------------------------------------
// 6. NO WET PROCESS → steps 10/11 bypassed, Step 9 is the cutting gate.
// ---------------------------------------------------------------------------
{
  const s = fabricTaSchedule({ subject: "FABRIC", source: "yarn_knit", hasWetProcess: false, greigeQty: 100, finishedQty: 98, events: {}, targets: T, today: TODAY });
  check("no process after knitting: 10 and 11 bypassed", s.map((x) => x.status), ["PENDING", "BYPASSED", "BYPASSED"]);
  check("...Step 9 takes the cutting gate's date", s[0].target, T.cutGate.date);
  check("...and must deliver what cutting needs", s[0].requiredQty, 98);
  check("a bypassed step carries no target", s[1].target, null);
}

// ---------------------------------------------------------------------------
// 7. GREIGE off the report's stage ladder.
// ---------------------------------------------------------------------------
{
  const F = "fab-1";
  const lines = [
    { itemId: F, combo: "RED", component: null, isKnitting: true, isClothPurchase: false, plannedWt: 510, toOrderedWt: 520.4 },
    { itemId: F, combo: "RED", component: null, isKnitting: false, isClothPurchase: false, plannedWt: 490, toOrderedWt: 510 },
    { itemId: F, combo: "NAVY", component: null, isKnitting: true, isClothPurchase: false, plannedWt: 300, toOrderedWt: 306.1 },
    { itemId: F, combo: "NAVY", component: null, isKnitting: false, isClothPurchase: false, plannedWt: 285, toOrderedWt: 300 },
    { itemId: "other", combo: "RED", component: null, isKnitting: true, isClothPurchase: false, plannedWt: 9999, toOrderedWt: 9999 },
  ];
  const g = greigeFromStages(lines, F);
  check("greige = knitting OUTPUT summed over colourways (one knitting lot)", g.greigeQty, 810);
  check("...never the knitting INPUT (that is the yarn)", g.greigeQty === 520.4 + 306.1, false);
  check("...and a dyeing line makes it a wet-processed fabric", g.hasWetProcess, true);
  const noKnit = greigeFromStages([{ itemId: F, combo: null, component: null, isKnitting: false, isClothPurchase: false, plannedWt: 95, toOrderedWt: 100 }], F);
  check("a route with no knitting step: greige = the weight entering it", noKnit.greigeQty, 100);
  check("a fabric with no route at all has no greige figure — and says the route is UNDECLARED", greigeFromStages([], F), { greigeQty: null, hasWetProcess: false, routeDeclared: false });
  check("a declared route says so", g.routeDeclared, true);
}

// ---------------------------------------------------------------------------
// 8. THE GROUPED LADDER — one row per step, rolled up over the materials
//    (client 2026-09-21: "group it like the Order Entry T&A").
// ---------------------------------------------------------------------------
{
  // Early September: before every back-scheduled target, so nothing is late yet.
  const EARLY = "2026-09-01";
  const yarnA = fabricTaSchedule({ subject: "YARN", requiredQty: 100, events: { yarn_po: [ev("2026-08-20", 100, "PO-1")] }, targets: T, today: EARLY });
  const yarnB = fabricTaSchedule({ subject: "YARN", requiredQty: 50, events: { yarn_po: [ev("2026-08-22", 50, "PO-2")] }, targets: T, today: EARLY });
  const fabK = fabricTaSchedule({ subject: "FABRIC", source: "yarn_knit", hasWetProcess: true, greigeQty: 120, finishedQty: 110, events: {}, targets: T, today: EARLY });
  const fabD = fabricTaSchedule({ subject: "FABRIC", source: "dyed_purchase", hasWetProcess: true, greigeQty: 40, finishedQty: 40, events: {}, targets: T, today: EARLY });
  const ladder = fabricTaLadder(
    [
      { itemName: "YARN A", steps: yarnA },
      { itemName: "YARN B", steps: yarnB },
      { itemName: "FAB K", steps: fabK },
      { itemName: "FAB D", steps: fabD },
    ],
    T,
    EARLY,
  );
  check("six rows, in step order", ladder.map((r) => r.number), [6, 7, 8, 9, 10, 11]);
  const s6 = ladder[0];
  check("Step 6 done when BOTH yarns' POs are settled", s6.status, "COMPLETED");
  check("...dated by the LAST yarn's PO, not the first", s6.actualDate, "2026-08-22");
  check("...quantities summed over the yarns", [s6.doneQty, s6.requiredQty], [150, 150]);
  const s7 = ladder[1];
  check("Step 7 open on both yarns → waiting on both, by name", [s7.status, s7.waitingOn], ["PENDING", ["YARN A", "YARN B"]]);
  const s9 = ladder[3];
  check("Step 9: the dyed purchase is bypassed, so the row counts only the knitted fabric", [s9.total, s9.requiredQty], [1, 120]);
  const s11 = ladder[5];
  check("Step 11 counts both fabrics (finished 110 + bought 40)", [s11.total, s11.requiredQty], [2, 150]);
  const none = fabricTaLadder([{ itemName: "FAB D", steps: fabD }], T, EARLY);
  check("a step every material bypasses is a bypassed row with the reason", [none[3].status, none[3].targetNote?.startsWith("Bought as dyed")], ["BYPASSED", true]);
  const mixed = fabricTaLadder(
    [{ itemName: "YARN A", steps: yarnA }, { itemName: "YARN C", steps: fabricTaSchedule({ subject: "YARN", requiredQty: 10, events: {}, targets: T, today: EARLY }) }],
    T,
    EARLY,
  );
  check("one yarn done, one untouched → the row is IN_PROGRESS, waiting on the other", [mixed[0].status, mixed[0].waitingOn], ["IN_PROGRESS", ["YARN C"]]);
  const lateL = fabricTaLadder([{ itemName: "YARN A", steps: fabricTaSchedule({ subject: "YARN", requiredQty: 10, events: {}, targets: T, today: "2026-12-01" }) }], T, "2026-12-01");
  check("any material overdue → the row is OVERDUE", lateL[0].status, "OVERDUE");
}

/*
 * MADE TO FAIL FIRST (2026-09-21) — each mutation of the engine, and how many
 * vectors above caught it:
 *   cutting gate − 0 instead of − 1 working day ........ 2   (§1)
 *   the order ladder's DYEING ignored ................... 1   (§2)
 *   no dyed-purchase bypass ............................. 2   (§5)
 *   greige = knitting INPUT instead of output ........... 2   (§7)
 *   manual done date ignored ............................ 1   (§3)
 *   no-wet fabric does not bypass Step 10 ............... 2   (§6)
 *   ladder dated by the FIRST material's actual, not the last  3   (§8)
 */
console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
