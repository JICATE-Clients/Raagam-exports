import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { OutDocumentTerm } from "./out-document-term-types";

export async function listOutDocumentTerms(): Promise<OutDocumentTerm[]> {
  const s = await createClient();
  const { data } = await s
    .from("out_document_terms")
    .select("*, lines:out_document_term_lines(*)")
    .order("entry_no");
  return ((data ?? []) as OutDocumentTerm[]).map((t) => ({
    ...t,
    lines: [...(t.lines ?? [])].sort((x, y) => x.sno - y.sno),
  }));
}
