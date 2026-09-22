import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { DocumentNoFormat } from "./document-no-format-types";
import { withCreators } from "@/lib/created-by";

export async function listDocumentNoFormats(): Promise<DocumentNoFormat[]> {
  const s = await createClient();
  const { data } = await s
    .from("document_no_formats")
    .select(
      "*, menus:document_no_format_menus(*, segments:document_no_format_segments(*))",
    )
    // LISTED IN ENTRY ORDER — 1, 2, 3 (user 2026-09-22: "in every module the listing … I need like 1,2,3 order wise"). Newest-first was the default before; queues, pickers, logs and "latest" lookups keep their own order.
    .order("entry_no", { ascending: true });
  return withCreators(((data ?? []) as unknown as DocumentNoFormat[]).map((f) => ({
    ...f,
    menus: [...(f.menus ?? [])]
      .sort((a, b) => a.sno - b.sno)
      .map((m) => ({ ...m, segments: [...(m.segments ?? [])].sort((a, b) => a.sno - b.sno) })),
  })));
}
