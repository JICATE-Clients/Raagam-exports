"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { writeAudit } from "@/lib/audit";
import { gpaInput, type GpaInput } from "./types";

type Result = { ok: true } | { ok: false; error: string };

function fail(msg: string): Result {
  return { ok: false, error: msg };
}
function rev(): void {
  revalidatePath("/orders/process-amendments");
}

/** Drop blank grid rows (no style picked) and renumber sno within each tab. */
function normalizeLines(data: GpaInput) {
  const byTab: Record<string, number> = {};
  return data.lines
    .filter((l) => !!l.style_id)
    .map((l) => {
      byTab[l.tab] = (byTab[l.tab] ?? 0) + 1;
      return { tab: l.tab, style_id: l.style_id as string, sno: byTab[l.tab] };
    });
}

async function writeLines(
  s: Awaited<ReturnType<typeof createClient>>,
  docId: string,
  data: GpaInput,
): Promise<Result> {
  const { error: delErr } = await s
    .from("garment_process_amendment_lines")
    .delete()
    .eq("doc_id", docId);
  if (delErr) return fail(delErr.message);

  const rows = normalizeLines(data);
  if (rows.length) {
    const { error } = await s
      .from("garment_process_amendment_lines")
      .insert(rows.map((r) => ({ ...r, doc_id: docId })));
    if (error) return fail(error.message);
  }
  return { ok: true };
}

function headerOnly(data: GpaInput) {
  const { lines: _l, ...header } = data;
  void _l;
  return header;
}

export async function createProcessAmendment(data: GpaInput): Promise<Result> {
  if (!(await can("orders", "create"))) return fail("Forbidden");
  const p = gpaInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const { data: created, error } = await s
    .from("garment_process_amendment_docs")
    .insert(headerOnly(p.data))
    .select("id")
    .single();
  if (error || !created) return fail(error?.message ?? "Failed to create amendment");
  const childRes = await writeLines(s, created.id, p.data);
  if (!childRes.ok) return childRes;
  await writeAudit({
    action: "garment_process_amendment.created",
    entityType: "garment_process_amendment",
    entityId: created.id,
  });
  rev();
  return { ok: true };
}

export async function updateProcessAmendment(
  id: string,
  data: GpaInput,
): Promise<Result> {
  if (!(await can("orders", "edit"))) return fail("Forbidden");
  const p = gpaInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const { error } = await s
    .from("garment_process_amendment_docs")
    .update(headerOnly(p.data))
    .eq("id", id);
  if (error) return fail(error.message);
  const childRes = await writeLines(s, id, p.data);
  if (!childRes.ok) return childRes;
  rev();
  return { ok: true };
}

export async function deleteProcessAmendment(id: string): Promise<Result> {
  if (!(await can("orders", "delete"))) return fail("Forbidden");
  const s = await createClient();
  const { error } = await s
    .from("garment_process_amendment_docs")
    .delete()
    .eq("id", id); // lines cascade
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}
