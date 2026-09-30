import "server-only";
import { can } from "@/lib/auth/server";
import { getGarmentOrderSheet } from "@/lib/orders/gos/service";
import { withCadStatus } from "@/lib/orders/gos/cad-status";
import { getReportStyleImages } from "@/lib/orders/gos/style-images";
import { getDocLetterhead } from "@/lib/orders/gos/letterhead";
import { getOrderBudgetReport } from "@/lib/orders/budget/report";
import { currentFabricBom, isFabricSheetRefusal } from "@/lib/orders/fabric-requirement/service";
import { fabricBomEntryRegister, yarnFabricRequirementReport } from "@/lib/orders/fabric-bom/reports";
import { pickReportThumbnail } from "@/lib/orders/gos/report-thumbnail";
import {
  currentMaterialBom,
  materialBomRequirementReport,
} from "@/lib/orders/material-bom-amendment/requirement-report";
import type { OrderFullData, OrderFullDataPart } from "./types";

/**
 * ONE PART OF AN ORDER'S FULL DATA — the LIVE path of each report's own page,
 * called in the same order with the same functions, so the pop-up and the
 * page cannot show two documents under one name:
 *
 *   gos       `app/(app)/orders/[orderId]/gos/page.tsx`
 *   budget    `app/(app)/orders/[orderId]/budget/page.tsx`
 *   fabric    `app/(app)/orders/[orderId]/reports/[report]/page.tsx` (fabric branch)
 *   material  the same route's material branch
 *
 * LIVE, NEVER V_FINAL. While a revision is open the report pages print the
 * approved copy frozen at raise by default (0619). The MD reviewing an
 * approval is deciding the PROPOSAL, so this reads what the page's
 * `?version=proposed` reads; the pop-up says so, and links each page for the
 * frozen copy.
 *
 * `orders:view` is the pages' own gate. A failure is the part's sentence,
 * never a thrown error: one tab that cannot load must not blank the others.
 */
export async function loadOrderFullData(
  salesOrderId: string,
  part: OrderFullDataPart,
): Promise<OrderFullData> {
  if (!(await can("orders", "view"))) return { part, refused: "You do not have permission to view orders." };
  try {
    if (part === "gos") {
      const [sheet, styleImages, company] = await Promise.all([
        getGarmentOrderSheet(salesOrderId).then((s) => withCadStatus(s, salesOrderId)),
        getReportStyleImages(salesOrderId),
        getDocLetterhead(salesOrderId),
      ]);
      return { part, sheet, styleImages, company };
    }
    if (part === "budget") {
      return { part, data: await getOrderBudgetReport(salesOrderId) };
    }
    if (part === "fabric") {
      const imagesP = getReportStyleImages(salesOrderId).catch(() => null);
      const current = await currentFabricBom(salesOrderId);
      if (isFabricSheetRefusal(current)) return { part, refused: current.refused };
      const [register, requirement] = await Promise.all([
        fabricBomEntryRegister(current.bom.id),
        yarnFabricRequirementReport(current.bom.id),
      ]);
      const header = !("refused" in register) ? register.header : !("refused" in requirement) ? requirement.header : null;
      const thumbnail = pickReportThumbnail(await imagesP, header?.styleRefNo);
      return { part, register, requirement, thumbnail };
    }
    const current = await currentMaterialBom(salesOrderId);
    if ("refused" in current) return { part, refused: current.refused };
    return { part, requirement: await materialBomRequirementReport(current.id) };
  } catch (e) {
    return { part, refused: e instanceof Error ? e.message : "This part of the order could not be loaded." };
  }
}
