import { can, requirePermission } from "@/lib/auth/server";
import {
  getCostingLetterhead,
  getSampleCostingFormData,
  listSampleCostings,
  listSamplesAwaitingCosting,
} from "@/lib/sales/sample-costing/service";
import { previewCostingNo } from "@/lib/sales/sample-costing/actions";
import { today } from "@/lib/calendar";
import { SampleCostingCopyScreen } from "./costing-3-screen";

/**
 * Sample ▸ Costing 3 — a TEST DUPLICATE of ../page.tsx (user 2026-10-21). Same loaders,
 * same records; the screen is a copy of the real one (costing-3-screen.tsx), listed in
 * the sidebar as "Costing 3" while it is tried.
 */
export default async function SampleCostingCopyPage() {
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
    <SampleCostingCopyScreen
      rows={rows}
      awaiting={awaiting}
      data={data}
      perms={{ canCreate, canEdit, canDelete }}
      nextCostingNo={nextCostingNo}
      letterhead={letterhead}
    />
  );
}
