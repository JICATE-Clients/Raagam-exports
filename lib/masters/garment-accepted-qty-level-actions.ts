"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import type { GarmentAcceptedQtyLevelInput } from "./garment-accepted-qty-level-types";

type Failure = { ok: false; error: string };
type Result = { ok: true } | Failure;
type CreateResult = { ok: true; id: string } | Failure;

function fail(msg: string): Failure {
  return { ok: false, error: msg };
}

function rev(): void {
  revalidatePath("/masters");
}

export async function createGarmentAcceptedQtyLevel(
  data: GarmentAcceptedQtyLevelInput,
): Promise<CreateResult> {
  if (!(await can("masters", "create"))) return fail("Forbidden");
  if (!data.entry_date) return fail("Entry date is required.");
  if (!data.effective_from) return fail("Effective from is required.");
  if (!data.details.length) return fail("At least one detail row is required.");

  const s = await createClient();

  // Generate code: GAQL-YYYYMMDD-NNN
  const { count } = await s
    .from("garment_accepted_qty_levels")
    .select("id", { count: "exact", head: true });
  const seq = String((count ?? 0) + 1).padStart(3, "0");
  const dateStr = data.entry_date.replace(/-/g, "");
  const code = `GAQL-${dateStr}-${seq}`;

  const { data: hdr, error: hErr } = await s
    .from("garment_accepted_qty_levels")
    .insert({
      code,
      entry_date: data.entry_date,
      effective_from: data.effective_from,
    })
    .select("id")
    .single();
  if (hErr) return fail(hErr.message);

  const detailRows = data.details.map((d, i) => ({
    header_id: hdr.id,
    sno: i + 1,
    range_type: d.range_type,
    from_qty: d.from_qty,
    to_qty: d.to_qty,
    no_of_pieces: d.no_of_pieces,
    major_allowed: d.major_allowed,
    minor_allowed: d.minor_allowed,
    critical_allowed: d.critical_allowed,
    allowed: d.allowed,
  }));
  const { error: dErr } = await s
    .from("garment_accepted_qty_level_details")
    .insert(detailRows);
  if (dErr) {
    await s.from("garment_accepted_qty_levels").delete().eq("id", hdr.id);
    return fail(dErr.message);
  }

  rev();
  return { ok: true, id: hdr.id };
}

export async function updateGarmentAcceptedQtyLevel(
  id: string,
  data: GarmentAcceptedQtyLevelInput,
): Promise<Result> {
  if (!(await can("masters", "edit"))) return fail("Forbidden");
  if (!data.entry_date) return fail("Entry date is required.");
  if (!data.effective_from) return fail("Effective from is required.");
  if (!data.details.length) return fail("At least one detail row is required.");

  const s = await createClient();

  const { error: hErr } = await s
    .from("garment_accepted_qty_levels")
    .update({
      entry_date: data.entry_date,
      effective_from: data.effective_from,
    })
    .eq("id", id);
  if (hErr) return fail(hErr.message);

  // Replace all details
  await s.from("garment_accepted_qty_level_details").delete().eq("header_id", id);
  const detailRows = data.details.map((d, i) => ({
    header_id: id,
    sno: i + 1,
    range_type: d.range_type,
    from_qty: d.from_qty,
    to_qty: d.to_qty,
    no_of_pieces: d.no_of_pieces,
    major_allowed: d.major_allowed,
    minor_allowed: d.minor_allowed,
    critical_allowed: d.critical_allowed,
    allowed: d.allowed,
  }));
  const { error: dErr } = await s
    .from("garment_accepted_qty_level_details")
    .insert(detailRows);
  if (dErr) return fail(dErr.message);

  rev();
  return { ok: true };
}

export async function deleteGarmentAcceptedQtyLevel(id: string): Promise<Result> {
  if (!(await can("masters", "delete"))) return fail("Forbidden");
  const s = await createClient();
  await s.from("garment_accepted_qty_level_details").delete().eq("header_id", id);
  const { error } = await s.from("garment_accepted_qty_levels").delete().eq("id", id);
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}
