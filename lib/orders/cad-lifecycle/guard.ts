import "server-only";
import { createClient } from "@/lib/supabase/server";

/**
 * THE FABRIC BOM GUARD, read ahead of the write.
 *
 * The DATABASE is the guard — `trg_ofb_cad_guard` refuses the INSERT of an
 * order's Fabric BOM until every current style's PATTERN IS READY (0641, user
 * 2026-09-25: "when the pattern is Ready"; it used to wait for the buyer's
 * approval). This is the same question asked EARLY, so the operator is told
 * when they pick the order — not after typing the whole BOM and pressing Save.
 *
 * SAME LIST, SAME SENTENCE: both read `cad_pattern_blockers()`, so the early
 * message and the database's refusal cannot disagree. A failed read answers
 * null (no early refusal): the trigger still stands behind it, so a failed
 * read costs a late message, never a wrong write.
 */
export async function cadFabricBomProblem(garmentOrderId: string): Promise<string | null> {
  const s = await createClient();
  const [styles, blockers] = await Promise.all([
    s.rpc("cad_style_states", { p_order: garmentOrderId }),
    s.rpc("cad_pattern_blockers", { p_order: garmentOrderId }),
  ]);
  if (styles.error || blockers.error) {
    console.error("[cad-guard] reading the pattern gate:", (styles.error ?? blockers.error)?.message);
    return null;
  }
  const tail = ". The Pattern Master marks it Ready on Orders ▸ CAD ▸ CAD Queue.";
  if (((styles.data ?? []) as unknown[]).length === 0) {
    return "Every style's pattern must be Ready before a Fabric BOM can be created — the order has no styles" + tail;
  }
  const open = (blockers.data ?? []) as { style_ref_no: string; why: string }[];
  if (open.length === 0) return null;
  return (
    "Every style's pattern must be Ready before a Fabric BOM can be created — " +
    open.map((r) => `${r.style_ref_no} (${r.why})`).join(", ") +
    tail
  );
}

/**
 * Is the order's CAD still pending? For the report stamp.
 *
 * PENDING = SOME STYLE'S PATTERN IS NOT READY — the same test as the gate
 * above (`cad_order_pattern_ready`, 0641). It used to be "every style
 * APPROVED by the buyer" (`cad_order_ready`), but there is no Send CAD step
 * any more (user 2026-09-25: assigning the pattern maker IS the send, Pattern
 * Status Ready IS the receive), so nothing reaches Approved and every report
 * would have been stamped for good.
 */
export async function cadOrderPending(garmentOrderId: string): Promise<boolean> {
  const s = await createClient();
  const { data, error } = await s.rpc("cad_order_pattern_ready", { p_order: garmentOrderId });
  if (error) {
    console.error("[cad-guard] reading cad_order_pattern_ready:", error.message);
    // Unknown is shown as pending: the stamp only says "treat as estimates",
    // and leaving it off a report whose CAD may be unapproved is the worse error.
    return true;
  }
  return data !== true;
}
