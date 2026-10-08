import { can, requirePermission } from "@/lib/auth/server";
import {
  getCostingLetterhead,
  getSampleCostingFormData,
  listSampleCostings,
} from "@/lib/sales/sample-costing/service";
import { previewCostingNo } from "@/lib/sales/sample-costing/actions";
import { today } from "@/lib/calendar";
import { SampleCostingScreen } from "./sample-costing-screen";

/**
 * Sample ▸ Sample Costing — the list, with the cost sheet editor as a page
 * mode of it. doc/sample/sample-costing-specification.md; data model 0688 /
 * 0689 (on `cost_sheets`, so Quotes still link).
 */
export default async function SampleCostingPage() {
  await requirePermission("sales", "view");

  const [rows, data, letterhead, canCreate, canEdit, canDelete, nextCostingNo] = await Promise.all([
    listSampleCostings(),
    getSampleCostingFormData(),
    getCostingLetterhead(),
    can("sales", "create"),
    can("sales", "edit"),
    can("sales", "delete"),
    previewCostingNo(today()),
  ]);

  return (
    <SampleCostingScreen
      rows={rows}
      data={data}
      perms={{ canCreate, canEdit, canDelete }}
      nextCostingNo={nextCostingNo}
      letterhead={letterhead}
    />
  );
}
