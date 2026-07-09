import { z } from "zod";

// ============================================================================
// Out Document Terms — master-detail (0229). Legacy EDP2 "Out Document Term"
// form: header (auto Entry No · Date · Type · Process → processes · Item Class →
// item_class master) + a Description line grid.
// ============================================================================
export const OUT_DOC_TERM_TYPES = ["Purchase", "Process"] as const;
export type OutDocTermType = (typeof OUT_DOC_TERM_TYPES)[number];

export interface OutDocumentTermLine {
  id: string;
  out_document_term_id: string;
  sno: number;
  description: string;
}
export interface OutDocumentTerm {
  id: string;
  entry_no: number;
  entry_date: string;
  type: OutDocTermType | null;
  process_id: string | null;
  item_class_id: string | null;
  created_at: string;
  updated_at: string;
  lines: OutDocumentTermLine[];
}

export const outDocumentTermLineInput = z.object({
  sno: z.coerce.number().int().nonnegative().default(0),
  description: z.string().min(1),
});
export const outDocumentTermInput = z.object({
  entry_date: z.string().min(1, "Date is required"),
  type: z.enum(OUT_DOC_TERM_TYPES).nullable().default(null),
  process_id: z.string().uuid().nullable().default(null),
  item_class_id: z.string().uuid().nullable().default(null),
  lines: z.array(outDocumentTermLineInput).default([]),
});
export type OutDocumentTermInput = z.infer<typeof outDocumentTermInput>;
