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
