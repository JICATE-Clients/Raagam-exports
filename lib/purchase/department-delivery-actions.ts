"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { capsName, capsTextNullable } from "@/lib/validation/formats";

/**
 * DEPARTMENT DELIVERY — write (0365's `interdept_deliveries`). Material handed from one
 * department's store to another's (Stores → Cutting, Cutting → Packing). It records the
 * movement and moves no stock, which is why Department Return (0795) never reads it.
 *
 * Moved into the Delivery Challans hub 2026-11-04 (user: "Department Delivery move it to the
 * delivery challans"). The browser used to insert straight into the two tables, and a failed
 * line insert was ignored — the delivery saved with no items and the toast said "created".
 * Both inserts now run here, and a header whose lines were refused is taken back out.
 *
 * RLS on both tables is `stores:*` (0365), so a Purchase-only user is told so here rather
 * than by a Postgres policy message.
 */

type Result = { ok: true; id: string } | { ok: false; error: string };

const lineInput = z.object({
  item_id: z.string().uuid({ message: "Pick the item on every line" }),
  quantity: z.coerce.number().positive({ message: "Every line needs a qty" }),
});

const deliveryInput = z
  .object({
    from_department: capsName("Type the department it comes from"),
    to_department: capsName("Type the department it goes to"),
    from_store_id: z.string().uuid({ message: "Pick the store it leaves" }),
    to_store_id: z.string().uuid({ message: "Pick the store it goes to" }),
    delivery_date: z.string().nullable().optional(),
    notes: capsTextNullable(),
    lines: z.array(lineInput).min(1, "Add at least one item"),
  })
  .refine((d) => d.from_store_id !== d.to_store_id, { message: "From and To store must differ" });
export type DepartmentDeliveryInput = z.input<typeof deliveryInput>;

export async function createDepartmentDelivery(raw: DepartmentDeliveryInput): Promise<Result> {
  if (!(await can("stores", "create"))) return { ok: false, error: "You do not have permission to raise a Department Delivery (Stores ▸ create)" };
  const parsed = deliveryInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the form" };
  const { lines, ...header } = parsed.data;

  const s = await createClient();
  const { data: delivery, error } = await s
    .from("interdept_deliveries")
    .insert({ ...header, delivery_date: header.delivery_date || null, status: "draft" })
    .select("id")
    .single();
  if (error || !delivery) return { ok: false, error: error?.message ?? "Could not save the delivery" };

  const { error: lineError } = await s
    .from("interdept_delivery_lines")
    .insert(lines.map((l, i) => ({ delivery_id: delivery.id, item_id: l.item_id, quantity: l.quantity, sort_order: i })));
  if (lineError) {
    // Best effort: without stores:delete RLS keeps the empty header, and the message says so.
    const { count } = await s.from("interdept_deliveries").delete({ count: "exact" }).eq("id", delivery.id);
    return {
      ok: false,
      error: count ? `Items not saved: ${lineError.message}` : `Items not saved (${lineError.message}) — the delivery was kept without items`,
    };
  }

  revalidatePath("/purchase/dc");
  return { ok: true, id: delivery.id };
}
