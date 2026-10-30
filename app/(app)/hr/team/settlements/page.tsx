import { Suspense } from "react";
import { requirePermission } from "@/lib/auth/server";
import { PageHeader } from "@/components/ui/page-header";
import { SettlementsScreen } from "@/components/hr/lifecycle/settlements-screen";
import { getLcSettings, lifecycleViewer, listExits, listSettlements } from "@/lib/hr/lifecycle-service";

export const metadata = { title: "Full & Final" };

export default async function Page() {
  await requirePermission("hr_payroll", "view");
  const [rows, exits, settings, viewer] = await Promise.all([listSettlements(), listExits(), getLcSettings(), lifecycleViewer()]);
  return (
    <div className="space-y-4">
      <PageHeader
        title="Full & Final"
        description="Gratuity, leave encashment, dues and recoveries for each exit — approved, then marked paid."
      />
      <Suspense>
        <SettlementsScreen
          rows={rows}
          exits={exits}
          canEdit={viewer.canEdit}
          gratuity={{ min_years: settings.gratuity_min_years, cap: settings.gratuity_cap }}
        />
      </Suspense>
    </div>
  );
}
