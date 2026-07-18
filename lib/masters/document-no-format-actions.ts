"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import {
  documentNoFormatInput,
  type DocumentNoFormatInput,
} from "./document-no-format-types";

type Result = { ok: true } | { ok: false; error: string };

function fail(msg: string): Result {
  return { ok: false, error: msg };
}
function rev(): void {
  revalidatePath("/admin");
  revalidatePath("/admin/document-no-formats");
}

const clean = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);

type SegIn = DocumentNoFormatInput["menus"][number]["segments"][number];
type MenuIn = DocumentNoFormatInput["menus"][number];

/** Drop empty segment rows and renumber sno within a menu. */
function normalizeSegments(segments: SegIn[]) {
  return segments
    .map((s) => ({
      value_type_id: s.value_type_id ?? null,
      value: clean(s.value),
      separator: clean(s.separator),
      no_of_digits: s.no_of_digits ?? null,
      value_from_id: s.value_from_id ?? null,
      ref_only: s.ref_only,
    }))
    .filter(
      (s) =>
        s.value_type_id || s.value || s.separator || s.no_of_digits != null || s.value_from_id,
    )
    .map((s, i) => ({ ...s, sno: i + 1 }));
}

/** Drop empty menu rows (no menu + no segments) and renumber sno. */
function normalizeMenus(menus: MenuIn[]) {
  return menus
    .map((m) => ({
      menu_id: m.menu_id ?? null,
      location_wise: m.location_wise,
      starting_sl_no: m.starting_sl_no,
      sample_doc_no: clean(m.sample_doc_no),
      segments: normalizeSegments(m.segments),
    }))
    .filter((m) => m.menu_id || m.segments.length > 0)
    .map((m, i) => ({ ...m, sno: i + 1 }));
}

/** Replace the whole menu/segment tree for a format id. */
async function writeTree(
  s: Awaited<ReturnType<typeof createClient>>,
  formatId: string,
  data: DocumentNoFormatInput,
): Promise<Result> {
  // Deleting menus cascades their segments.
  const { error: delErr } = await s
    .from("document_no_format_menus")
    .delete()
    .eq("format_id", formatId);
  if (delErr) return fail(delErr.message);

  for (const menu of normalizeMenus(data.menus)) {
    const { segments, ...menuRow } = menu;
    const { data: created, error } = await s
      .from("document_no_format_menus")
      .insert({ ...menuRow, format_id: formatId })
      .select("id")
      .single();
    if (error) return fail(error.message);
    if (segments.length) {
      const { error: segErr } = await s
        .from("document_no_format_segments")
        .insert(segments.map((seg) => ({ ...seg, format_menu_id: created.id })));
      if (segErr) return fail(segErr.message);
    }
  }
  return { ok: true };
}

export async function createDocumentNoFormat(data: DocumentNoFormatInput): Promise<Result> {
  if (!(await can("masters", "create"))) return fail("Forbidden");
  const p = documentNoFormatInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const { menus: _drop, ...header } = p.data;
  void _drop;
  const { data: created, error } = await s
    .from("document_no_formats")
    .insert(header)
    .select("id")
    .single();
  if (error) return fail(error.message);
  const treeRes = await writeTree(s, created.id, p.data);
  if (!treeRes.ok) return treeRes;
  rev();
  return { ok: true };
}

export async function updateDocumentNoFormat(
  id: string,
  data: DocumentNoFormatInput,
): Promise<Result> {
  if (!(await can("masters", "edit"))) return fail("Forbidden");
  const p = documentNoFormatInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const { menus: _drop, ...header } = p.data;
  void _drop;
  const { error } = await s.from("document_no_formats").update(header).eq("id", id);
  if (error) return fail(error.message);
  const treeRes = await writeTree(s, id, p.data);
  if (!treeRes.ok) return treeRes;
  rev();
  return { ok: true };
}

export async function deleteDocumentNoFormat(id: string): Promise<Result> {
  if (!(await can("masters", "delete"))) return fail("Forbidden");
  const s = await createClient();
  const { error } = await s.from("document_no_formats").delete().eq("id", id); // tree cascades
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}
