import { requirePermission } from "@/lib/auth/server";
import { PageHeader } from "@/components/ui/page-header";
import { BalancesScreen } from "@/components/hr/timeoff/balances-screen";
import {
  currentYearId,
  getBalanceSheet,
  listEntitlements,
  listLeaveTypes,
  listYears,
  timeoffViewer,
} from "@/lib/hr/timeoff-service";

export const metadata = { title: "Leave Balances" };

export default async function Page({ searchParams }: { searchParams: Promise<{ year?: string }> }) {
  await requirePermission("hr_payroll", "view");
  const sp = await searchParams;
  const [years, thisYear, viewer, types] = await Promise.all([
    listYears(),
    currentYearId(),
    timeoffViewer(),
    listLeaveTypes(),
  ]);
  const yearId = years.some((y) => y.id === sp.year) ? (sp.year as string) : (thisYear ?? years.at(-1)?.id ?? null);
  const [sheet, overrides] = yearId
    ? await Promise.all([getBalanceSheet(yearId), listEntitlements(yearId)])
    : [[], []];
  return (
    <div className="space-y-4">
      <PageHeader
        title="Leave Balances"
        description="What each person has left this leave year. Entitlement comes from the leave type unless it is adjusted here."
      />
      {yearId ? (
        <BalancesScreen
          years={years}
          yearId={yearId}
          sheet={sheet}
          types={types}
          overrides={overrides}
          canEdit={viewer.canEdit}
        />
      ) : (
        <p className="text-sm text-muted-foreground">No leave year yet — add one on Time Off ▸ Leave Setup.</p>
      )}
    </div>
  );
}
