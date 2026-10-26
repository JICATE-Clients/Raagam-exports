import { PageHeader } from "@/components/ui/page-header";
import { RequirementsScreen } from "@/components/resolve/work/requirements-screen";
import { requireRh } from "@/lib/resolve/auth";
import { listRequirements } from "@/lib/resolve/service";

/**
 * Requirements — Raagam Assist's Buy requests for this unit (0751), for
 * Stores / the unit head who approve and give them. `resolve:view`, not a
 * narrower gate: RLS already decides which requests a person sees, and the
 * ticket page's action list decides who may decide them.
 */
export default async function RequirementsPage() {
  await requireRh("view");
  const lists = await listRequirements();
  return (
    <div className="space-y-4">
      <PageHeader title="Requirements" description="Things people asked Stores for — approve, reject, and mark as given" />
      <RequirementsScreen lists={lists} />
    </div>
  );
}
