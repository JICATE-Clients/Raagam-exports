import { can, requirePermission } from "@/lib/auth/server";
import {
  getCostingLetterhead,
  getSampleCostingFormData,
  listSampleCostings,
  listSamplesAwaitingCosting,
} from "@/lib/sales/sample-costing/service";
import { previewCostingNo } from "@/lib/sales/sample-costing/actions";
import { today } from "@/lib/calendar";
import { SampleCostingLedgerScreen } from "./ledger-screen";

/**
 * Sample ▸ Costing ▸ the LEDGER entry — a TEST DUPLICATE of ../page.tsx (user
 * 2026-10-17). Same loaders, same records; only the editor differs
 * (ledger-screen.tsx). Listed in the sidebar as "Costing 2" (2026-10-21) while it is tried.
 */
export default async function SampleCostingLedgerPage() {
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
    <SampleCostingLedgerScreen
      rows={rows}
      awaiting={awaiting}
      data={data}
      perms={{ canCreate, canEdit, canDelete }}
      nextCostingNo={nextCostingNo}
      letterhead={letterhead}
    />
  );
}
