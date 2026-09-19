"use server";

import { can } from "@/lib/auth/server";
import { materialBomRequirementReport } from "./requirement-report";

/**
 * THE MATERIAL BOM'S REPORT, for the editor's Reports sheet — a server action so
 * the client component that renders it never talks to Supabase directly, the
 * same shape as `loadFabricBomEntryRegister`.
 *
 * Named `load…Report` on purpose: `check:order-reports` recognises a report by
 * its loader's NAME and refuses any file that renders one without reading
 * `ORDER_REPORTS` — which is what keeps this report on Order Entry's Reports
 * strip as well as behind the editor's button.
 */
export async function loadMaterialBomRequirementReport(bomId: string) {
  if (!(await can("orders", "view"))) return { refused: "Forbidden" };
  return materialBomRequirementReport(bomId);
}
