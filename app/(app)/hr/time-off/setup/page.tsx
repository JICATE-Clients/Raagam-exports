import { requirePermission, can } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { SetupScreen } from "@/components/hr/timeoff/setup-screen";
import { listBlackouts, listLeaveTypes, listYears, timeoffViewer } from "@/lib/hr/timeoff-service";

export const metadata = { title: "Leave Setup" };

export default async function Page() {
  await requirePermission("hr_payroll", "view");
  const s = await createClient();
  const [types, years, blackouts, viewer, canDelete, locs] = await Promise.all([
    listLeaveTypes(),
    listYears(),
    listBlackouts(),
    timeoffViewer(),
    can("hr_payroll", "delete"),
    s.from("locations").select("id, name").order("name"),
  ]);
  if (locs.error) throw new Error(locs.error.message);
  return (
    <div className="space-y-4">
      <PageHeader
        title="Leave Setup"
        description="Leave types and their rules, leave years, and dates when no leave can be taken."
      />
      <SetupScreen
        types={types}
        years={years}
        blackouts={blackouts}
        locations={(locs.data ?? []) as { id: string; name: string }[]}
        canEdit={viewer.canEdit}
        canDelete={canDelete && viewer.canEdit}
      />
    </div>
  );
}
