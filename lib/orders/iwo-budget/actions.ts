"use server";

import { can } from "@/lib/auth/server";
import { pullIwoCostLines } from "./service";
import type { IwoPullResult } from "./pull";

/**
 * "Pull from BOM" — the IWO Budget screen's one door to the pull (Phase 4).
 * Read-only: it returns the lines, and the budget's own Save writes them.
 */
export async function loadIwoCostLines(iwoId: string): Promise<IwoPullResult> {
  if (!(await can("orders", "view"))) return { refused: "Forbidden" };
  return pullIwoCostLines(iwoId);
}
