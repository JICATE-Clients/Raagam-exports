"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { hsnDetailInput, type HsnDetailInput } from "./hsn-detail-types";
import { deleteOrDeactivate } from "./delete-guard";
import { checkDuplicateName } from "./dup-guard";

type Result = { ok: true } | { ok: false; error: string };
type DeleteResult = { ok: true; inactive: boolean; usedBy?: string } | { ok: false; error: string };

function fail(msg: string): { ok: false; error: string } {
  return { ok: false, error: msg };
}
function rev(): void {
  revalidatePath("/masters");
  revalidatePath("/masters/gst");
  revalidatePath("/masters/gst/hsn-detail");
}

export async function createHsnDetail(data: HsnDetailInput): Promise<Result> {
  if (!(await can("masters", "create"))) return fail("Forbidden");
  const p = hsnDetailInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  // One HSN code per (item class, For). The same code legitimately appears under
  // a different class — that is the whole shape of this master — so the check is
  // SCOPED rather than global. `lib/data-io` calls this action directly, so this
  // is the guard; the screen's live check is the courtesy.
  const dup = await checkDuplicateName(s, "hsn_details", p.data.hsn_code, {
    nameColumn: "hsn_code",
    label: "HSN code",
    scope: { item_class_id: p.data.item_class_id ?? null, for_type: p.data.for_type },
  });
  if (!dup.ok) return fail(dup.error);
  const { error } = await s.from("hsn_details").insert(p.data);
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}

export async function updateHsnDetail(id: string, data: HsnDetailInput): Promise<Result> {
  if (!(await can("masters", "edit"))) return fail("Forbidden");
  const p = hsnDetailInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const dup = await checkDuplicateName(s, "hsn_details", p.data.hsn_code, {
    nameColumn: "hsn_code",
    label: "HSN code",
    excludeId: id,
    scope: { item_class_id: p.data.item_class_id ?? null, for_type: p.data.for_type },
  });
  if (!dup.ok) return fail(dup.error);
  const { error } = await s.from("hsn_details").update(p.data).eq("id", id);
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}

export async function deleteHsnDetail(id: string): Promise<DeleteResult> {
  if (!(await can("masters", "delete"))) return fail("Forbidden");
  const s = await createClient();
  const res = await deleteOrDeactivate(s, "hsn_details", id, "inactive");
  if (!res.ok) return fail(res.error);
  rev();
  return { ok: true, inactive: res.inactive, usedBy: res.usedBy };
}
