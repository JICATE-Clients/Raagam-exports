import "server-only";

import { can } from "@/lib/auth/server";
import { salesOrderOfBom, vFinalFor, type VFinalState } from "@/lib/orders/amendments/v-final";
import { getReportStyleImages, type ReportStyleImage } from "@/lib/orders/gos/style-images";
import { pickReportThumbnail } from "@/lib/orders/gos/report-thumbnail";
import {
  fabricBomEntryRegister,
  yarnFabricRequirementReport,
  type EntryRegister,
  type YarnFabricRequirementReport,
} from "./reports";
import { isReportRefusal, type ReportRefusal } from "./report-refusal";

export type FabricBomReportsSheetLoad =
  | {
      ok: true;
      register: EntryRegister | ReportRefusal;
      requirement: YarnFabricRequirementReport | ReportRefusal;
      vFinal: VFinalState<"fabric-bom-reports"> | { state: "error"; error: string };
      thumbnail: ReportStyleImage | null;
    }
  | { ok: false; error: string };

/**
 * EVERYTHING THE FABRIC BOM REPORTS SHEET SHOWS ON OPEN, IN ONE REQUEST
 * (2026-09-29, "saving, listing and report opening take 2 seconds"). Served by
 * `GET /api/fabric-bom/<bomId>/reports`.
 *
 * The sheet used to fire four server actions — the Entry Register, the Yarn &
 * Fabric Requirement, V_final and the header thumbnail. Server actions are
 * QUEUED, so its `Promise.all` ran them one after another, and the Requirement
 * built a second Entry Register of its own (~20 queries) because it prints the
 * Fabric Allocation section off one. Here the register is built ONCE and handed
 * to the Requirement, and every independent chain starts at the same moment:
 *
 * - the register (and, reusing it, the Requirement);
 * - the BOM's sales order, which both V_final and the thumbnail's pictures
 *   key on — resolved once, not once each;
 * - the permission check, riding beside the reads the way `getOrderCad` and
 *   `loadWorkFlow` do. The reads are RLS-scoped, so starting them before the
 *   answer is known leaks nothing; a refusal discards them.
 *
 * The thumbnail and V_final never fail the sheet — each resolves to "no
 * picture" / an error note, exactly as their own loaders did.
 */
export async function loadFabricBomReportsSheet(bomId: string): Promise<FabricBomReportsSheetLoad> {
  const allowedP = can("orders", "view");
  allowedP.catch(() => {});
  try {
    const registerP = fabricBomEntryRegister(bomId);
    registerP.catch(() => {});
    const salesOrderP = salesOrderOfBom("fabric", bomId);
    salesOrderP.catch(() => {});

    const [allowed, register, requirement, vFinal, images] = await Promise.all([
      allowedP,
      registerP,
      yarnFabricRequirementReport(bomId, { register: registerP }),
      salesOrderP
        .then((so) => (so ? vFinalFor("fabric-bom-reports", so) : { state: "live" as const }))
        .catch((e: unknown) => ({
          state: "error" as const,
          error: e instanceof Error ? e.message : "Could not read the approved version",
        })),
      salesOrderP.then((so) => (so ? getReportStyleImages(so) : null)).catch(() => null),
    ]);
    if (!allowed) return { ok: false, error: "Forbidden" };

    const header = !isReportRefusal(register) ? register.header : !isReportRefusal(requirement) ? requirement.header : null;
    return {
      ok: true,
      register,
      requirement,
      vFinal,
      thumbnail: header ? pickReportThumbnail(images, header.styleRefNo) : null,
    };
  } catch (e) {
    if (!(await allowedP.catch(() => false))) return { ok: false, error: "Forbidden" };
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
