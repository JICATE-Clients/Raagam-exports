import type { getGarmentOrderSheet } from "@/lib/orders/gos/service";
import type { getReportStyleImages, ReportStyleImage } from "@/lib/orders/gos/style-images";
import type { DocLetterhead } from "@/lib/orders/gos/letterhead";
import type { getOrderBudgetReport } from "@/lib/orders/budget/report";
import type { fabricBomEntryRegister, yarnFabricRequirementReport } from "@/lib/orders/fabric-bom/reports";
import type { materialBomRequirementReport } from "@/lib/orders/material-bom-amendment/requirement-report";

/**
 * THE ORDER'S FULL DATA, ONE REPORT FAMILY AT A TIME — what the MD's "View full
 * order data" pop-up loads (client 2026-09-30), tab by tab, from
 * `GET /api/orders/<sales order id>/full-data?part=…`.
 *
 * Each part is exactly what that report's own page loads, LIVE (the proposed
 * order when a revision is open — the thing being approved), so the pop-up
 * shows the same document the report page does, never a re-assembly:
 *
 *   gos       Garment Order Sheet  — `/orders/<id>/gos`
 *   budget    Order Budget         — `/orders/<id>/budget`
 *   fabric    the Fabric BOM sheet reports (Entry Register, Yarn & Fabric
 *             Requirement, Printing Requirement) — one load serves all three
 *   material  Material BOM Requirement
 */
export type OrderFullDataPart = "gos" | "budget" | "fabric" | "material";

type Refused = { refused: string };

export type OrderFullData =
  | {
      part: "gos";
      sheet: Awaited<ReturnType<typeof getGarmentOrderSheet>>;
      company: DocLetterhead;
      styleImages: Awaited<ReturnType<typeof getReportStyleImages>>;
    }
  | { part: "budget"; data: Awaited<ReturnType<typeof getOrderBudgetReport>> }
  | {
      part: "fabric";
      register: Awaited<ReturnType<typeof fabricBomEntryRegister>>;
      requirement: Awaited<ReturnType<typeof yarnFabricRequirementReport>>;
      thumbnail: ReportStyleImage | null;
    }
  | { part: "material"; requirement: Awaited<ReturnType<typeof materialBomRequirementReport>> }
  /** The part could not be loaded (no permission, no BOM yet, a failed read) — its sentence. */
  | ({ part: OrderFullDataPart } & Refused);

export const ORDER_FULL_DATA_PARTS: readonly OrderFullDataPart[] = ["gos", "budget", "fabric", "material"];
