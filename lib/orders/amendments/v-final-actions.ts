"use server";

import { can } from "@/lib/auth/server";
import { salesOrderOfBom, vFinalFor, type VFinalPayloads, type VFinalState } from "./v-final";

/**
 * V_FINAL FOR THE EDITORS' OWN REPORT SHEETS (0619, spec §4B). The Fabric BOM
 * and Material BOM editors open their reports by BOM id; the rule is the same
 * as on the order's report routes — while the order is amending the report is
 * the approved version, frozen at raise — so this resolves the BOM to its RE
 * and asks `vFinalFor` the one question.
 */
export async function loadVFinalForBom<K extends "fabric" | "material">(
  kind: K,
  bomId: string,
): Promise<
  VFinalState<K extends "fabric" ? "fabric-bom-reports" : "material-bom-requirement"> | { state: "error"; error: string }
> {
  if (!(await can("orders", "view"))) return { state: "error", error: "Forbidden" };
  try {
    const so = await salesOrderOfBom(kind, bomId);
    if (!so) return { state: "live" };
    return (await vFinalFor(kind === "fabric" ? "fabric-bom-reports" : "material-bom-requirement", so)) as VFinalState<
      K extends "fabric" ? "fabric-bom-reports" : "material-bom-requirement"
    >;
  } catch (e) {
    return { state: "error", error: e instanceof Error ? e.message : "Could not read the approved version" };
  }
}

export type { VFinalPayloads };
