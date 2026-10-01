"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { capsName, capsTextNullable } from "@/lib/validation/formats";
import { MANUAL_BUCKETS } from "./types";

/**
 * Order Profitability — the one thing a person writes: CMT & overheads and
 * other income for an order (0667 `order_actual_costs`). Everything else on the
 * statement is derived from documents.
 *
 * Saved as a SET: rows with an id are updated, new rows inserted, rows the
 * screen no longer holds deleted. A blank seeded row (no description and no
 * amount) is dropped here, testing only the fields the operator types — the
 * "seeded row is saved unless the save side drops it" rule (AGENTS.md).
 */

const rowInput = z.object({
  id: z.string().uuid().nullable().optional(),
  bucket: z.enum(MANUAL_BUCKETS),
  description: capsName("Description is required"),
  amount_inr: z.coerce.number().min(0, "Amount cannot be negative"),
  remarks: capsTextNullable(),
});

const saveInput = z.object({
  salesOrderId: z.string().uuid(),
  rows: z.array(z.unknown()),
});

export type SaveManualCostsResult = { ok: true } | { ok: false; error: string };

type RawRow = { id?: string | null; bucket?: string; description?: string | null; amount_inr?: unknown; remarks?: string | null };

const isBlank = (r: RawRow) =>
  !(r.description ?? "").trim() && (r.amount_inr === "" || r.amount_inr == null || Number(r.amount_inr) === 0);

export async function saveManualCosts(salesOrderId: string, rows: RawRow[]): Promise<SaveManualCostsResult> {
  if (!(await can("orders", "edit"))) return { ok: false, error: "You do not have permission to edit orders" };
  const parsed = saveInput.safeParse({ salesOrderId, rows });
  if (!parsed.success) return { ok: false, error: "The order could not be identified" };

  const kept: z.infer<typeof rowInput>[] = [];
  for (const [i, raw] of rows.entries()) {
    if (isBlank(raw)) continue;
    const r = rowInput.safeParse(raw);
    if (!r.success) {
      const issue = r.error.issues[0];
      const field = issue?.path[0] === "description" ? "Description" : issue?.path[0] === "amount_inr" ? "Amount" : "Row";
      return { ok: false, error: `Line ${i + 1}: ${field} — ${issue?.message ?? "invalid"}` };
    }
    kept.push(r.data);
  }

  const sb = await createClient();
  const { data: existing, error: readErr } = await sb
    .from("order_actual_costs")
    .select("id")
    .eq("sales_order_id", salesOrderId);
  if (readErr) return { ok: false, error: `Could not read the saved costs: ${readErr.message}` };

  const keepIds = new Set(kept.map((r) => r.id).filter((x): x is string => !!x));
  const drop = ((existing ?? []) as { id: string }[]).map((r) => r.id).filter((id) => !keepIds.has(id));

  if (drop.length) {
    const { error } = await sb.from("order_actual_costs").delete().in("id", drop).eq("sales_order_id", salesOrderId);
    if (error) return { ok: false, error: `Could not remove a cost line: ${error.message}` };
  }
  for (const r of kept) {
    const values = {
      sales_order_id: salesOrderId,
      bucket: r.bucket,
      description: r.description,
      amount_inr: r.amount_inr,
      remarks: r.remarks || null,
    };
    const { error } = r.id
      ? await sb.from("order_actual_costs").update(values).eq("id", r.id).eq("sales_order_id", salesOrderId)
      : await sb.from("order_actual_costs").insert(values);
    if (error) return { ok: false, error: `Could not save "${r.description}": ${error.message}` };
  }

  revalidatePath("/orders/profit-check");
  revalidatePath(`/orders/profit-check/${salesOrderId}`);
  return { ok: true };
}
