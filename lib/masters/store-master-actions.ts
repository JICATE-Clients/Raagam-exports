"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { getCurrentLocation } from "@/lib/auth/location";
import { storeInput, type StoreInput } from "./store-master-types";
import { checkDuplicateName } from "./dup-guard";
import { deleteOrDeactivate } from "./delete-guard";
import { generateUniqueCode } from "./auto-code";

/*
 * STORE MASTER ACTIONS (0800). Writes go through the `stores` table's own policies:
 * the Stores permission and the CURRENT unit. So a store is always made in the unit
 * the operator is working in, and the duplicate-name check, read through the same
 * policies, compares within that unit only: "Material Store" exists in every unit by
 * design, and only a second one in the SAME unit is a duplicate.
 */
type Failure = { ok: false; error: string };
type Result = { ok: true } | Failure;
type CreateResult = { ok: true; id: string } | Failure;
type DeleteResult = { ok: true; inactive: boolean; usedBy?: string } | Failure;

const fail = (msg: string): Failure => ({ ok: false, error: msg });

function rev() {
  revalidatePath("/masters");
  revalidatePath("/masters/materials");
  revalidatePath("/masters/materials/stores");
  revalidatePath("/masters/materials/bins");
  revalidatePath("/stores");
}

/** The database refuses a second system store in one unit; say it in words. */
function friendly(message: string): string {
  if (message.includes("stores_one_system_type_per_unit")) {
    return "This unit already has a store of that type. Only Storage stores can repeat in a unit.";
  }
  if (message.includes("stores_code_key")) return "That store code is already used. Pick another, or leave Code blank.";
  return message;
}

export async function createStore(data: StoreInput): Promise<CreateResult> {
  if (!(await can("stores", "create"))) return fail("You do not have permission to add a store");
  const p = storeInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const { location } = await getCurrentLocation();
  if (!location) return fail("Pick your working unit in the top bar first");
  const s = await createClient();
  const dup = await checkDuplicateName(s, "stores", p.data.name, { scope: { location_id: location.id } });
  if (!dup.ok) return fail(dup.error);
  const code = p.data.code || (await generateUniqueCode(s, "stores", `${location.code ?? ""} ${p.data.name}`, { maxLen: 12 }));
  const { data: row, error } = await s
    .from("stores")
    .insert({ ...p.data, code, location_id: location.id })
    .select("id")
    .single();
  if (error) return fail(friendly(error.message));
  rev();
  return { ok: true, id: row.id };
}

export async function updateStore(id: string, data: StoreInput): Promise<Result> {
  if (!(await can("stores", "edit"))) return fail("You do not have permission to edit a store");
  const p = storeInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const { data: was } = await s.from("stores").select("store_type, location_id").eq("id", id).maybeSingle();
  if (!was) return fail("That store was not found in your unit");
  // The type is fixed once saved: a Material store turned Storage would silently stop
  // receiving GRNs, and the routing functions would find no Material store at all.
  if ((was as { store_type: string }).store_type !== p.data.store_type) {
    return fail("A store's type cannot be changed once saved");
  }
  const dup = await checkDuplicateName(s, "stores", p.data.name, {
    excludeId: id,
    scope: { location_id: (was as { location_id: string }).location_id },
  });
  if (!dup.ok) return fail(dup.error);
  // Code is fixed once saved too; only name, prefix and status change.
  const { error } = await s
    .from("stores")
    .update({ name: p.data.name, bin_prefix: p.data.bin_prefix, is_active: p.data.is_active })
    .eq("id", id);
  if (error) return fail(friendly(error.message));
  rev();
  return { ok: true };
}

export async function deleteStore(id: string): Promise<DeleteResult> {
  if (!(await can("stores", "delete"))) return fail("You do not have permission to delete a store");
  const s = await createClient();
  const res = await deleteOrDeactivate(s, "stores", id, "is_active");
  if (!res.ok) return fail(res.error);
  rev();
  return { ok: true, inactive: res.inactive, usedBy: res.usedBy };
}
