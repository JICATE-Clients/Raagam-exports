"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { writeAudit } from "@/lib/audit";
import { departmentReturnInput, type DepartmentReturnInput } from "./department-return-types";
import { getReturnableRequisitions } from "./department-return-service";

type Err = { ok: false; error: string };
type R = { ok: true } | Err;

const LIST = "/purchase/department-returns";

function bad(m: string): Err {
  return { ok: false, error: m };
}
function revalidate(id?: string) {
  revalidatePath(LIST);
  if (id) revalidatePath(`${LIST}/${id}`);
  revalidatePath("/purchase/store");
}

/**
 * Create or update a DRAFT return — header and its lines in one call. Lines are
 * replaced (delete + insert); the DB refuses both once the return is posted.
 * Each qty is held to what is still returnable here as a courtesy; the post
 * function re-checks it with the MRS locked, which is the guard.
 */
export async function saveDepartmentReturn(
  id: string | null,
  payload: DepartmentReturnInput,
): Promise<{ ok: true; id: string } | Err> {
  if (!(await can("stores", id ? "edit" : "create"))) return bad("Forbidden");
  const p = departmentReturnInput.safeParse(payload);
  if (!p.success) return bad(p.error.issues[0]?.message ?? "Invalid input");
  const { lines, ...header } = p.data;

  const mrs = (await getReturnableRequisitions(header.material_requisition_id)).find(
    (m) => m.id === header.material_requisition_id,
  );
  if (!mrs) return bad("That requisition is not issued, or is not in your unit");
  const byLine = new Map(mrs.lines.map((l) => [l.mrs_line_id, l]));
  const seen = new Set<string>();
  for (const l of lines) {
    const src = byLine.get(l.mrs_line_id);
    if (!src) return bad("A line is not on the chosen requisition");
    if (seen.has(l.mrs_line_id)) return bad(`${src.item_name} is entered twice`);
    seen.add(l.mrs_line_id);
    if (l.return_qty > src.returnable_qty + 1e-9)
      return bad(`${src.item_name}: return qty ${l.return_qty} is more than the ${src.returnable_qty} still returnable`);
  }

  const s = await createClient();
  let docId = id;
  if (docId) {
    const { error } = await s.from("department_returns").update(header).eq("id", docId);
    if (error) return bad(error.message);
    const { error: dErr } = await s.from("department_return_lines").delete().eq("return_id", docId);
    if (dErr) return bad(dErr.message);
  } else {
    // store_id / department are copied from the MRS by the DB trigger; sent so the
    // insert policy's unit check has a store to test.
    const { data, error } = await s
      .from("department_returns")
      .insert({ ...header, store_id: mrs.store_id, department: mrs.department })
      .select("id")
      .single();
    if (error || !data) return bad(error?.message ?? "Failed to create");
    docId = data.id as string;
  }

  const { error: lErr } = await s.from("department_return_lines").insert(
    lines.map((l, i) => ({
      return_id: docId,
      mrs_line_id: l.mrs_line_id,
      // Overwritten from the MRS line by the DB trigger; NOT NULL needs a value.
      item_id: byLine.get(l.mrs_line_id)!.item_id,
      return_qty: l.return_qty,
      bin_id: l.bin_id || null,
      lot_no: l.lot_no ?? null,
      sort_order: i,
    })),
  );
  if (lErr) return bad(lErr.message);

  revalidate(docId);
  return { ok: true, id: docId };
}

/** Draft → posted: one `return` stock_ledger row per line, in one DB transaction. */
export async function postDepartmentReturn(id: string): Promise<R> {
  if (!(await can("stores", "edit"))) return bad("Forbidden");
  const s = await createClient();
  const { error } = await s.rpc("department_return_post", { p_id: id });
  if (error) return bad(error.message);
  await writeAudit({ action: "department_return.posted", entityType: "department_return", entityId: id });
  revalidate(id);
  return { ok: true };
}

export async function cancelDepartmentReturn(id: string): Promise<R> {
  if (!(await can("stores", "edit"))) return bad("Forbidden");
  const s = await createClient();
  const { error } = await s.from("department_returns").update({ status: "cancelled" }).eq("id", id);
  if (error) return bad(error.message);
  revalidate(id);
  return { ok: true };
}

export async function deleteDepartmentReturn(id: string): Promise<R> {
  if (!(await can("stores", "delete"))) return bad("Forbidden");
  const s = await createClient();
  const { data, error } = await s.from("department_returns").delete().eq("id", id).select("id");
  if (error) return bad(error.message);
  if (!data?.length) return bad("Nothing was deleted — you may not have access to this return");
  revalidate();
  return { ok: true };
}
