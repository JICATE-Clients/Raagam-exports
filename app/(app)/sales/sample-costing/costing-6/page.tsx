import { can, requirePermission } from "@/lib/auth/server";
import {
  getCostingLetterhead,
  getSampleCostingFormData,
  listSampleCostings,
  listSamplesAwaitingCosting,
} from "@/lib/sales/sample-costing/service";
import { previewCostingNo } from "@/lib/sales/sample-costing/actions";
import { today } from "@/lib/calendar";
import { SampleCosting6Screen } from "./costing-6-screen";

/**
 * Sample ▸ Costing 6 — a TEST DUPLICATE of ../costing-5/page.tsx (user 2026-10-22). Same
 * loaders, same records; the screen is a copy of Costing 5 (costing-6-screen.tsx), listed
 * in the sidebar as "Costing 6" while it is tried.
 */
export default async function SampleCosting6Page() {
  await requirePermission("sales", "view");

  const [rows, awaiting, data, letterhead, canCreate, canEdit, canDelete, nextCostingNo] = await Promise.all([
    listSampleCostings(),
    // Saved sample styles with no costing yet — listed as "Not costed".
    listSamplesAwaitingCosting(),
    getSampleCostingFormData(),
    getCostingLetterhead(),
    can("sales", "create"),
    can("sales", "edit"),
    can("sales", "delete"),
    previewCostingNo(today()),
  ]);

  return (
    <SampleCosting6Screen
      rows={rows}
      awaiting={awaiting}
      data={data}
      perms={{ canCreate, canEdit, canDelete }}
      nextCostingNo={nextCostingNo}
      letterhead={letterhead}
    />
  );
}
