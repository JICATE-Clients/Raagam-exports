"use server";

import { can } from "@/lib/auth/server";
import { getLineForPayslip } from "@/lib/hr/payroll-service";
import type { LineWithName } from "@/lib/hr/payroll-service";

export async function getLineForPayslipAction(
  runId: string,
  workerId: string,
): Promise<LineWithName | null> {
  if (!(await can("hr_payroll", "view"))) throw new Error("Forbidden");
  return getLineForPayslip(runId, workerId);
}
