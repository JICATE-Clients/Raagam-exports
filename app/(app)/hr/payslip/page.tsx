import { requirePermission } from "@/lib/auth/server";
import { getWorkersForPayslip, getRunsForPayslip } from "@/lib/hr/payroll-service";
import { PageHeader } from "@/components/ui/page-header";
import { PayslipClient } from "./payslip-client";

export default async function PayslipPage() {
  await requirePermission("hr_payroll", "view");

  const [workers, runs] = await Promise.all([
    getWorkersForPayslip(),
    getRunsForPayslip(),
  ]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Payslips"
        description="View weekly worker payslips for any approved or locked run"
      />

      <PayslipClient workers={workers} runs={runs} />
    </div>
  );
}
