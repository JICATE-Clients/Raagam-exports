import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/server";
import { PageHeader } from "@/components/ui/page-header";
import { canViewOverrides, listOverrideEdits } from "@/lib/orders/overrides/service";
import { OverrideEditsReport } from "./override-edits-report";

/**
 * Reports ▸ Override Edit Report (doc/email role system.md §7.3, R-18).
 *
 * Every field changed on an APPROVED order under a permission override — the
 * control the spec puts in place of MD approval for these edits (D-8: no
 * notification; the report IS the control). Old → new, who, why, when, which
 * version, grouped by save.
 *
 * THE GATE IS THE DATABASE'S — `can_view_permission_overrides()`: the MD and
 * the admins (D-7). The same function is what the audit tables' RLS reads, so
 * this page and the rows it can read cannot disagree about who may look.
 */
export default async function OverrideEditsReportPage() {
  await requireUser();
  if (!(await canViewOverrides())) redirect("/?denied=reports");

  const rows = await listOverrideEdits();

  return (
    <div className="space-y-4">
      <PageHeader
        title="Override Edit Report"
        description="Post-approval edits made under a permission override — saved directly into the approved version, without a revision or MD approval."
      />
      <OverrideEditsReport rows={rows} />
    </div>
  );
}
