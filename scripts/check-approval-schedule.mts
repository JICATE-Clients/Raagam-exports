import { computeApprovalSchedule } from "../lib/orders/ta/approval-schedule.ts";

let failures = 0;
function check(name: string, cond: boolean) {
  if (!cond) {
    failures++;
    console.error(`FAIL: ${name}`);
  }
}

// Vector 1: AFTER_ORDER_DATE, no weekend involved.
// 2026-09-01 is a Tuesday; +3 days = 2026-09-04, a Friday. No roll needed.
{
  const [r] = computeApprovalSchedule({
    approvals: [{ approvalId: "a1", label: "Fit Sample", direction: "AFTER_ORDER_DATE", leadTimeDays: 3 }],
    orderDate: "2026-09-01",
    exFactoryDate: "2026-10-01",
  });
  check("forward, no weekend: 2026-09-04", r.targetDate === "2026-09-04");
  check("forward, no weekend: not conflicted", !r.isConflicted);
}

// Vector 2: AFTER_ORDER_DATE lands on a Sunday — must roll FORWARD to Monday.
// 2026-09-01 (Tue) + 5 days = 2026-09-06, a Sunday. Rolls to 2026-09-07 (Mon).
{
  const [r] = computeApprovalSchedule({
    approvals: [{ approvalId: "a1", label: "Fit Sample", direction: "AFTER_ORDER_DATE", leadTimeDays: 5 }],
    orderDate: "2026-09-01",
    exFactoryDate: "2026-10-01",
  });
  check("forward Sunday rolls to Monday", r.targetDate === "2026-09-07");
}

// Vector 3: BEFORE_SHIPMENT_DATE lands on a Sunday — must roll BACKWARD to Saturday.
// 2026-09-13 (Sun) - 7 days = 2026-09-06, ALSO a Sunday. Rolls to 2026-09-05 (Sat).
{
  const [r] = computeApprovalSchedule({
    approvals: [{ approvalId: "a1", label: "Lap Dip", direction: "BEFORE_SHIPMENT_DATE", leadTimeDays: 7 }],
    orderDate: "2026-09-01",
    exFactoryDate: "2026-09-13",
  });
  check("backward Sunday rolls to Saturday", r.targetDate === "2026-09-05");
}

// Vector 4: conflict detection — target lands after the ship date. Never refuses.
// 2026-09-01 (Tue) + 20 days = 2026-09-21 (Mon, no roll) — well past 2026-09-10.
{
  const [r] = computeApprovalSchedule({
    approvals: [{ approvalId: "a1", label: "SMS", direction: "AFTER_ORDER_DATE", leadTimeDays: 20 }],
    orderDate: "2026-09-01",
    exFactoryDate: "2026-09-10",
  });
  check("overshoot is flagged conflicted", r.isConflicted);
  check("overshoot is NEVER refused (has a real date)", r.targetDate === "2026-09-21");
  check("overshoot carries an explanatory message", !!r.errorMessage);
}

// Vector 5: BEFORE_SHIPMENT_DATE with no ex-factory date yet — conflict, not a crash.
{
  const [r] = computeApprovalSchedule({
    approvals: [{ approvalId: "a1", label: "Trims Approval", direction: "BEFORE_SHIPMENT_DATE", leadTimeDays: 10 }],
    orderDate: "2026-09-01",
    exFactoryDate: null,
  });
  check("no ex-factory date -> conflicted with a message", r.isConflicted && !!r.errorMessage);
}

// Vector 6: a registered holiday (not a Sunday) also rolls, same direction rules.
// 2026-09-04 is a Friday; declared a holiday. Forward walk must skip past it.
{
  const [r] = computeApprovalSchedule({
    approvals: [{ approvalId: "a1", label: "Photo Sample", direction: "AFTER_ORDER_DATE", leadTimeDays: 3 }],
    orderDate: "2026-09-01",
    exFactoryDate: "2026-10-01",
    holidays: new Set(["2026-09-04"]),
  });
  check("forward rolls past a registered holiday too", r.targetDate === "2026-09-05");
}

if (failures > 0) {
  console.error(`\n${failures} vector(s) failed.`);
  process.exit(1);
}
console.log(`check:approval-schedule — all vectors passed.`);
