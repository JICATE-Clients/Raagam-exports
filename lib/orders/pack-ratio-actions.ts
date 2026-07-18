"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { packRatioInput, excessOrderInput } from "./pack-ratio-types";
import type { PackRatioInput, ExcessOrderInput } from "./pack-ratio-types";

type Result = { ok: true } | { ok: false; error: string };
type CreateResult = { ok: true; id: string } | { ok: false; error: string };

function fail(msg: string): { ok: false; error: string } { return { ok: false, error: msg }; }
function rev(): void { revalidatePath("/orders"); revalidatePath("/orders/pack-ratios"); revalidatePath("/orders/excess-orders"); }

export async function createPackRatio(data: PackRatioInput): Promise<CreateResult> {
  if (!(await can("orders", "create"))) return fail("Forbidden");
  const p = packRatioInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const pcs_per_master = (p.data.pcs_per_inner ?? 0) * (p.data.inner_per_master ?? 0);
  const { data: row, error } = await s.from("order_pack_ratios").insert({ ...p.data, pcs_per_master }).select("id").single();
  if (error) return fail(error.message);
  rev();
  return { ok: true, id: row.id };
}

export async function deletePackRatio(id: string): Promise<Result> {
  if (!(await can("orders", "delete"))) return fail("Forbidden");
  const s = await createClient();
  const { error } = await s.from("order_pack_ratios").delete().eq("id", id);
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Pack Ratio Lines (size matrix rows)
// ---------------------------------------------------------------------------

export async function addPackRatioLine(
  packRatioId: string,
  data: {
    style_no?: string | null; combo?: string | null; no_of_cartons?: number;
    pcs_per_pack?: number; order_qty?: number;
    size1_qty?: number; size2_qty?: number; size3_qty?: number; size4_qty?: number;
    size5_qty?: number; size6_qty?: number; size7_qty?: number; size8_qty?: number;
  },
): Promise<CreateResult> {
  if (!(await can("orders", "create"))) return fail("Forbidden");
  const s = await createClient();
  const { data: existing } = await s.from("order_pack_ratio_lines").select("sno").eq("pack_ratio_id", packRatioId).order("sno", { ascending: false }).limit(1);
  const sno = ((existing?.[0] as { sno: number } | undefined)?.sno ?? 0) + 1;
  const { data: row, error } = await s.from("order_pack_ratio_lines").insert({
    pack_ratio_id: packRatioId, sno,
    style_no: data.style_no ?? null,
    combo: data.combo ?? null,
    no_of_cartons: data.no_of_cartons ?? 0,
    pcs_per_pack: data.pcs_per_pack ?? 0,
    order_qty: data.order_qty ?? 0,
    size1_qty: data.size1_qty ?? 0, size2_qty: data.size2_qty ?? 0,
    size3_qty: data.size3_qty ?? 0, size4_qty: data.size4_qty ?? 0,
    size5_qty: data.size5_qty ?? 0, size6_qty: data.size6_qty ?? 0,
    size7_qty: data.size7_qty ?? 0, size8_qty: data.size8_qty ?? 0,
  }).select("id").single();
  if (error) return fail(error.message);
  rev();
  return { ok: true, id: row.id };
}

export async function deletePackRatioLine(id: string): Promise<Result> {
  if (!(await can("orders", "delete"))) return fail("Forbidden");
  const s = await createClient();
  const { error } = await s.from("order_pack_ratio_lines").delete().eq("id", id);
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}

export async function createExcessOrder(data: ExcessOrderInput): Promise<CreateResult> {
  if (!(await can("orders", "create"))) return fail("Forbidden");
  const p = excessOrderInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const { items, ...header } = p.data;
  const { data: row, error } = await s.from("excess_orders").insert(header).select("id").single();
  if (error) return fail(error.message);
  if (items.length > 0) {
    const { error: childErr } = await s.from("excess_order_items").insert(
      items.map((item, i) => ({ excess_order_id: row.id, sno: i + 1, ...item })),
    );
    if (childErr) return fail(childErr.message);
  }
  rev();
  return { ok: true, id: row.id };
}

export async function confirmExcessOrder(id: string): Promise<Result> {
  if (!(await can("orders", "edit"))) return fail("Forbidden");
  const s = await createClient();
  const { error } = await s.from("excess_orders").update({ status: "confirmed" }).eq("id", id);
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}

export async function deleteExcessOrder(id: string): Promise<Result> {
  if (!(await can("orders", "delete"))) return fail("Forbidden");
  const s = await createClient();
  const { error } = await s.from("excess_orders").delete().eq("id", id);
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}
