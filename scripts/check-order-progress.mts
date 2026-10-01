/**
 * Vectors for `lib/orders/progress/engine.ts` — Order Progress tracker + the
 * delivery-risk rule (doc/order/digitalisation-plan.md §1).
 *
 * Each vector sits where two plausible implementations DISAGREE
 * (check-work-flow.mts's standard): plan = a stage's START vs its FINISH, the
 * worst lateness vs the first, office lateness counted vs not, shipped past
 * delivery read as late vs shipped.
 *
 *     2026-10-12 is a MONDAY; 2026-10-18 a SUNDAY (the only day off).
 *
 * Runs under `tsx` (the `@/lib` aliases). `npm run check:order-progress`.
 */
import { buildProgress, crossingDate, type ProgressInput } from "../lib/orders/progress/engine";

let failed = 0;
let passed = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) {
    failed++;
    console.error(`FAIL  ${label}\n      expected ${JSON.stringify(expected)}\n      actual   ${JSON.stringify(actual)}`);
  } else passed++;
}

const ladderRow = (shortName: string, target_date: string, days_required = 1, actual_date: string | null = null) => ({
  shortName,
  target_date,
  days_required,
  actual_date,
});

/** An order delivering 2026-11-06 with a full ladder, nothing done. */
function base(over: Partial<ProgressInput> = {}): ProgressInput {
  return {
    orderStatus: "confirmed",
    orderQty: 1000,
    deliveryDate: "2026-11-06",
    workFlow: [],
    ladder: [
      ladderRow("MATIH", "2026-10-09"),
      ladderRow("PPAPPR", "2026-10-10"),
      ladderRow("CUT", "2026-10-12", 3), // Mon → finishes Wed 2026-10-14
      ladderRow("SEW", "2026-10-15", 5), // Thu → Fri, Sat, (Sun off), Mon, Tue = 2026-10-20
      ladderRow("PACK", "2026-10-27", 2),
      ladderRow("INSP", "2026-10-29", 1),
    ],
    poLines: [],
    production: [],
    inspections: [],
    shipped: [],
    ...over,
  };
}

const stage = (p: ReturnType<typeof buildProgress>, key: string) => p.stages.find((s) => s.key === key)!;

// ---- 1. A stage's plan is the day it must FINISH, not the day it starts.
{
  // Cutting starts Mon 12th for 3 days → must finish Wed 14th. On Tue 13th it is not late.
  // Everything before it is marked done so only Cutting is judged.
  const done = base({
    ladder: base().ladder.map((l) => (l.shortName === "MATIH" || l.shortName === "PPAPPR" ? { ...l, actual_date: l.target_date } : l)),
  });
  const p = buildProgress(done, "2026-10-13");
  check("1a plan = finish date", stage(p, "CUT").plan, "2026-10-14");
  check("1b not overdue before the finish date", stage(p, "CUT").view.state, "pending");
  check("1c risk on track", p.risk.level, "on_track");
  // Sewing's 5 days skip the Sunday.
  check("1d span skips Sunday", stage(p, "SEW").plan, "2026-10-20");
}

// ---- 2. Late material/production stage → at risk; projected = delivery + the WORST lateness.
{
  const p = buildProgress(
    base({ ladder: base().ladder.map((l) => (l.shortName === "MATIH" || l.shortName === "PPAPPR" ? { ...l, actual_date: l.target_date } : l)) }),
    "2026-10-22",
  );
  // Cutting 8 days late (14 → 22), Sewing 2 days late (20 → 22): Cutting is the worst.
  check("2a at risk", p.risk.level, "at_risk");
  check("2b worst lateness", p.risk.daysLate, 8);
  check("2c projected = delivery + worst", p.risk.projected, "2026-11-14");
  check("2d cause names the stage", p.risk.cause, "Cutting is 8 days late");
}
{
  // The worst stage is NOT the first in the timeline: PP approval (listed before
  // Cutting) planned for Fri 16th is 6 days late; Cutting is 8. "First late
  // stage" and "worst late stage" disagree here, and only the worst is right.
  const p = buildProgress(
    base({
      ladder: [ladderRow("MATIH", "2026-10-09", 1, "2026-10-09"), ladderRow("PPAPPR", "2026-10-16"), ladderRow("CUT", "2026-10-12", 3)],
    }),
    "2026-10-22",
  );
  check("2e worst, not first", [p.risk.daysLate, p.risk.cause], [8, "Cutting is 8 days late"]);
}

// ---- 3. Office milestones alone never set risk (scheduled forward, not from delivery).
{
  const p = buildProgress(
    base({
      ladder: [ladderRow("CUT", "2026-12-01", 2)],
      workFlow: [{ code: "FABRIC_BOM", target_date: "2026-10-01", actual_date: null, status: "pending" }],
    }),
    "2026-10-10",
  );
  check("3a office row is overdue on screen", stage(p, "FABRIC_BOM").view.state, "overdue");
  check("3b but the order is on track", p.risk.level, "on_track");
}

// ---- 4. Past delivery and not shipped → late (outranks at_risk).
{
  const p = buildProgress(base(), "2026-11-09");
  check("4a late", p.risk.level, "late");
  check("4b days past delivery", p.risk.daysLate, 3);
}

// ---- 5. Shipped in full → shipped, even after the delivery date.
{
  const p = buildProgress(
    base({ shipped: [{ date: "2026-11-05", qty: 600 }, { date: "2026-11-08", qty: 400 }] }),
    "2026-11-20",
  );
  check("5a shipped", p.risk.level, "shipped");
  check("5b shipped on the day the total crossed", stage(p, "SHIP").actual, "2026-11-08");
  check("5c shipped late", stage(p, "SHIP").view.state, "done_late");
}

// ---- 6. A partial shipment is progress, not shipped.
{
  const p = buildProgress(base({ shipped: [{ date: "2026-11-05", qty: 600 }] }), "2026-11-05");
  check("6a in progress", stage(p, "SHIP").view.state, "in_progress");
  check("6b not shipped", p.risk.level === "shipped", false);
}

// ---- 7. Order status wins: cancelled / closed.
check("7a cancelled", buildProgress(base({ orderStatus: "cancelled" }), "2026-12-30").risk.level, "cancelled");
check("7b closed", buildProgress(base({ orderStatus: "closed" }), "2026-12-30").risk.level, "closed");

// ---- 8. No ladder → no_plan, never "on track".
check("8 no plan", buildProgress(base({ ladder: [] }), "2026-10-01").risk.level, "no_plan");

// ---- 9. Production done by quantity, dated on the crossing day.
{
  const p = buildProgress(
    base({
      production: [
        { stage: "cutting", entry_date: "2026-10-13", good_qty: 700 },
        { stage: "cutting", entry_date: "2026-10-16", good_qty: 300 },
        { stage: "sewing", entry_date: "2026-10-16", good_qty: 50 },
      ],
    }),
    "2026-10-17",
  );
  check("9a cut done on crossing day", stage(p, "CUT").actual, "2026-10-16");
  check("9b finished after plan = done late", stage(p, "CUT").view.state, "done_late");
  check("9c sewing started = in progress", stage(p, "SEW").view.state, "in_progress");
  check("9d qty shown", [stage(p, "CUT").qtyDone, stage(p, "CUT").qtyTarget], [1000, 1000]);
}

// ---- 10. The T&A's own mark finishes a stage with no documents.
{
  const p = buildProgress(base({ ladder: [ladderRow("CUT", "2026-10-12", 3, "2026-10-14")] }), "2026-10-20");
  check("10 marked cut is done", stage(p, "CUT").view.state, "done");
}

// ---- 11. Materials: every purchase line received in full, or nothing.
{
  const all = buildProgress(base({ poLines: [{ quantity: 10, received_qty: 10 }, { quantity: 5, received_qty: 6 }] }), "2026-10-01");
  check("11a all lines received = done", stage(all, "MATIH").view.state, "done");
  const part = buildProgress(base({ poLines: [{ quantity: 10, received_qty: 10 }, { quantity: 5, received_qty: 4 }] }), "2026-10-01");
  check("11b one short = not done", stage(part, "MATIH").view.state, "in_progress");
  check("11c counted in lines", stage(part, "MATIH").note, "1 of 2 purchase lines received in full");
  const none = buildProgress(base(), "2026-10-01");
  check("11d no POs = not started", stage(none, "MATIH").view.state, "pending");
}

// ---- 12. Inspection: only a PASS finishes it.
{
  const fail = buildProgress(base({ inspections: [{ inspection_date: "2026-10-29", result: "fail", status: "completed" }] }), "2026-10-29");
  check("12a failed = in progress", stage(fail, "INSP").view.state, "in_progress");
  const pass = buildProgress(
    base({
      inspections: [
        { inspection_date: "2026-10-29", result: "fail", status: "completed" },
        { inspection_date: "2026-10-30", result: "pass", status: "completed" },
      ],
    }),
    "2026-10-30",
  );
  check("12b pass = done on its date", [stage(pass, "INSP").view.state, stage(pass, "INSP").actual], ["done_late", "2026-10-30"]);
}

// ---- 13. Unknown order qty: production cannot be judged by quantity.
{
  const p = buildProgress(base({ orderQty: null, production: [{ stage: "cutting", entry_date: "2026-10-13", good_qty: 5000 }] }), "2026-10-13");
  check("13 no qty = never done by quantity", stage(p, "CUT").view.state, "in_progress");
}

// ---- 14. crossingDate sorts by date and ignores undated rows.
check(
  "14 crossing",
  crossingDate([{ date: "2026-10-05", qty: 5 }, { date: null, qty: 100 }, { date: "2026-10-01", qty: 5 }], 10),
  "2026-10-05",
);

console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
