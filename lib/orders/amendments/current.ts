import "server-only";
import type { createClient } from "@/lib/supabase/server";

type SB = Awaited<ReturnType<typeof createClient>>;

export interface CurrentAmendment {
  id: string;
  code: string | null;
  isDraft: boolean;
  amendDate: string | null;
}

/**
 * The latest amendment per sales order — "current" meaning the one whose own
 * `amend_date`, then `created_at`, sorts last among every amendment on that
 * order.
 *
 * This is the exact tie-break `lib/ta/worklist.ts` `getWorklist()` already
 * computes inline (its own comment: "An order can carry several amendments; a
 * superseded one's schedule is a schedule that was replaced") — extracted here
 * so a second caller (`lib/production/service.ts`) does not re-derive it, and a
 * third does not have the chance to disagree with either. Deliberately does
 * NOT prefer a non-draft amendment over a draft one: `getWorklist()` picks
 * "current" first and drops drafts as a SEPARATE, later step (counted as
 * `droppedDraft`, not folded into "superseded") — a caller that wants drafts
 * excluded does that itself, the same way, rather than this helper silently
 * picking a different amendment than the worklist would have.
 */
export async function currentAmendmentsBySalesOrder(
  sb: SB,
  salesOrderIds: string[],
): Promise<Map<string, CurrentAmendment>> {
  const map = new Map<string, CurrentAmendment>();
  if (!salesOrderIds.length) return map;

  const { data } = await sb
    .from("garment_order_amendments")
    .select("id, code, sales_order_id, is_draft, amend_date, created_at")
    .in("sales_order_id", salesOrderIds);

  type Row = {
    id: string;
    code: string | null;
    sales_order_id: string | null;
    is_draft: boolean | null;
    amend_date: string | null;
    created_at: string | null;
  };

  const bestBySalesOrder = new Map<string, Row>();
  const sortKey = (r: Row) => `${r.amend_date ?? ""}|${r.created_at ?? ""}`;

  for (const row of (data ?? []) as Row[]) {
    const so = row.sales_order_id;
    if (!so) continue;
    const prev = bestBySalesOrder.get(so);
    if (!prev || sortKey(row) > sortKey(prev)) bestBySalesOrder.set(so, row);
  }

  for (const [so, row] of bestBySalesOrder) {
    map.set(so, {
      id: row.id,
      code: row.code,
      isDraft: row.is_draft === true,
      amendDate: row.amend_date,
    });
  }
  return map;
}
