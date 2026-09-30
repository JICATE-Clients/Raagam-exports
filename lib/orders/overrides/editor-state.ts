import "server-only";
import { createClient } from "@/lib/supabase/server";
import { myActiveOverrides } from "./service";
import type { OverrideEditState } from "./types";

/**
 * THE CALLER'S OVERRIDE EDIT STATE, for the four editors' pages (Phase 5).
 *
 * Asked once per page load and handed down as a plain object: the editors read
 * it with a const (`areaOverride`), never a hook. Two reads, and the second only
 * when the first finds a live key — a user with no grant (everyone, today) costs
 * one RPC and gets `null`, so the editors render exactly as before (AC-17).
 *
 * DISPLAY ONLY. What the editor unlocks is a courtesy; the lock triggers decide
 * every write against the database clock (R-9, R-10).
 */
export async function overrideEditState(): Promise<OverrideEditState | null> {
  const keys = await myActiveOverrides();
  if (keys.length === 0) return null;

  const s = await createClient();
  const { data, error } = await s
    .from("order_budget_revisions")
    .select("garment_order_id")
    .eq("outcome", "reapproved");
  const counts = new Map<string, number>();
  if (!error) {
    for (const r of (data ?? []) as { garment_order_id: string | null }[]) {
      if (r.garment_order_id) counts.set(r.garment_order_id, (counts.get(r.garment_order_id) ?? 0) + 1);
    }
  }
  return {
    keys,
    versions: Object.fromEntries([...counts].map(([id, n]) => [id, `V${n}`])),
  };
}
