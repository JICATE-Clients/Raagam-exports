import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { DocumentNoFormat } from "./document-no-format-types";

export async function listDocumentNoFormats(): Promise<DocumentNoFormat[]> {
  const s = await createClient();
  const { data } = await s
    .from("document_no_formats")
    .select(
      "*, menus:document_no_format_menus(*, segments:document_no_format_segments(*))",
    )
    .order("entry_no", { ascending: false });
  return ((data ?? []) as unknown as DocumentNoFormat[]).map((f) => ({
    ...f,
    menus: [...(f.menus ?? [])]
      .sort((a, b) => a.sno - b.sno)
      .map((m) => ({ ...m, segments: [...(m.segments ?? [])].sort((a, b) => a.sno - b.sno) })),
  }));
}
