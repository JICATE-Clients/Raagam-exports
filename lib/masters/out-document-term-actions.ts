"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { outDocumentTermInput, type OutDocumentTermInput } from "./out-document-term-types";

type Result = { ok: true } | { ok: false; error: string };

function fail(msg: string): Result {
  return { ok: false, error: msg };
}
function rev(): void {
  revalidatePath("/masters");
  revalidatePath("/masters/materials");
  revalidatePath("/masters/materials/out-document-terms");
}

/** Drop blank-description rows and renumber sno 1..n. */
function normalizeLines(data: OutDocumentTermInput): { sno: number; description: string }[] {
  return data.lines
    .map((l) => ({ ...l, description: l.description.trim() }))
    .filter((l) => l.description.length > 0)
    .map((l, i) => ({ sno: i + 1, description: l.description }));
}

export async function createOutDocumentTerm(data: OutDocumentTermInput): Promise<Result> {
  if (!(await can("masters", "create"))) return fail("Forbidden");
  const p = outDocumentTermInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const { lines: _drop, ...header } = p.data;
  void _drop;
  const { data: created, error } = await s
    .from("out_document_terms")
    .insert(header)
    .select("id")
    .single();
  if (error) return fail(error.message);
  const rows = normalizeLines(p.data);
  if (rows.length) {
    const { error: lErr } = await s
      .from("out_document_term_lines")
      .insert(rows.map((r) => ({ ...r, out_document_term_id: created.id })));
    if (lErr) return fail(lErr.message);
  }
  rev();
  return { ok: true };
}

export async function updateOutDocumentTerm(id: string, data: OutDocumentTermInput): Promise<Result> {
  if (!(await can("masters", "edit"))) return fail("Forbidden");
  const p = outDocumentTermInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const { lines: _drop, ...header } = p.data;
  void _drop;
  const { error } = await s.from("out_document_terms").update(header).eq("id", id);
  if (error) return fail(error.message);
  // Replace the description grid wholesale (small, fully-loaded set).
  const { error: delErr } = await s.from("out_document_term_lines").delete().eq("out_document_term_id", id);
  if (delErr) return fail(delErr.message);
  const rows = normalizeLines(p.data);
  if (rows.length) {
    const { error: lErr } = await s
      .from("out_document_term_lines")
      .insert(rows.map((r) => ({ ...r, out_document_term_id: id })));
    if (lErr) return fail(lErr.message);
  }
  rev();
  return { ok: true };
}

export async function deleteOutDocumentTerm(id: string): Promise<Result> {
  if (!(await can("masters", "delete"))) return fail("Forbidden");
  const s = await createClient();
  const { error } = await s.from("out_document_terms").delete().eq("id", id); // lines cascade
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}
