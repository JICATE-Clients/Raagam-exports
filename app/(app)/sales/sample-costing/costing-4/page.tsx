import { can, requirePermission } from "@/lib/auth/server";
import {
  getCostingLetterhead,
  getSampleCostingFormData,
  listSampleCostings,
  listSamplesAwaitingCosting,
} from "@/lib/sales/sample-costing/service";
import { previewCostingNo } from "@/lib/sales/sample-costing/actions";
import { today } from "@/lib/calendar";
import { SampleCosting4Screen } from "./costing-4-screen";

/**
 * Sample ▸ Costing 4 — a TEST DUPLICATE of ../costing-3/page.tsx (user 2026-10-21). Same
 * loaders, same records; the screen is a copy of Costing 3 (costing-4-screen.tsx), listed
 * in the sidebar as "Costing 4" while it is tried.
 */
export default async function SampleCosting4Page() {
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
    <SampleCosting4Screen
      rows={rows}
      awaiting={awaiting}
      data={data}
      perms={{ canCreate, canEdit, canDelete }}
      nextCostingNo={nextCostingNo}
      letterhead={letterhead}
    />
  );
}
