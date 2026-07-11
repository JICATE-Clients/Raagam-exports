"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { writeAudit } from "@/lib/audit";
import { packingAdviceInput, type PackingAdviceInput } from "./types";

type Result = { ok: true } | { ok: false; error: string };

function fail(msg: string): Result {
  return { ok: false, error: msg };
}
function rev(): void {
  revalidatePath("/orders/packing-advice");
  revalidatePath("/orders");
}

const clean = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);

/** Drop fully-empty line rows, renumber sort_order. */
function normalizeLines(data: PackingAdviceInput) {
  return data.lines
    .map((l) => ({
      ctn_from: clean(l.ctn_from),
      ctn_to: clean(l.ctn_to),
      ctns: Number(l.ctns) || 0,
      sc_no_id: l.sc_no_id,
      po_no: clean(l.po_no),
      country_id: l.country_id,
      ref_no: clean(l.ref_no),
      assort_type: clean(l.assort_type),
      customer_order_no: clean(l.customer_order_no),
      multiple_pack: !!l.multiple_pack,
      qty_per_ctn: Number(l.qty_per_ctn) || 0,
      total_qty: Number(l.total_qty) || 0,
      unit_id: l.unit_id,
      measurement: clean(l.measurement),
    }))
    .filter(
      (l) =>
        l.ctn_from ||
        l.ctn_to ||
        l.ctns ||
        l.sc_no_id ||
        l.po_no ||
        l.country_id ||
        l.ref_no ||
        l.assort_type ||
        l.customer_order_no ||
        l.qty_per_ctn ||
        l.total_qty ||
        l.unit_id ||
        l.measurement,
    )
    .map((l, i) => ({ ...l, sort_order: i + 1 }));
}

/** Replace the line grid wholesale for a given advice id. */
async function writeLines(
  s: Awaited<ReturnType<typeof createClient>>,
  adviceId: string,
  data: PackingAdviceInput,
): Promise<Result> {
  const { error: delErr } = await s
    .from("packing_advice_lines")
    .delete()
    .eq("advice_id", adviceId);
  if (delErr) return fail(delErr.message);

  const rows = normalizeLines(data);
  if (rows.length) {
    const { error } = await s
      .from("packing_advice_lines")
      .insert(rows.map((r) => ({ ...r, advice_id: adviceId })));
    if (error) return fail(error.message);
  }
  return { ok: true };
}

/** Strip the line array so only header columns hit packing_advices. */
function headerOnly(data: PackingAdviceInput) {
  const { lines: _l, ...header } = data;
  void _l;
  return header;
}

export async function createPackingAdvice(data: PackingAdviceInput): Promise<Result> {
  if (!(await can("orders", "create"))) return fail("Forbidden");
  const p = packingAdviceInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const { data: created, error } = await s
    .from("packing_advices")
    .insert(headerOnly(p.data))
    .select("id")
    .single();
  if (error || !created) return fail(error?.message ?? "Failed to create packing advice");
  const lineRes = await writeLines(s, created.id, p.data);
  if (!lineRes.ok) return lineRes;
  await writeAudit({
    action: "packing_advice.created",
    entityType: "packing_advice",
    entityId: created.id,
  });
  rev();
  return { ok: true };
}

export async function updatePackingAdvice(
  id: string,
  data: PackingAdviceInput,
): Promise<Result> {
  if (!(await can("orders", "edit"))) return fail("Forbidden");
  const p = packingAdviceInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const { error } = await s
    .from("packing_advices")
    .update(headerOnly(p.data))
    .eq("id", id);
  if (error) return fail(error.message);
  const lineRes = await writeLines(s, id, p.data);
  if (!lineRes.ok) return lineRes;
  await writeAudit({
    action: "packing_advice.updated",
    entityType: "packing_advice",
    entityId: id,
  });
  rev();
  return { ok: true };
}

export async function deletePackingAdvice(id: string): Promise<Result> {
  if (!(await can("orders", "delete"))) return fail("Forbidden");
  const s = await createClient();
  const { error } = await s.from("packing_advices").delete().eq("id", id); // lines cascade
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}
