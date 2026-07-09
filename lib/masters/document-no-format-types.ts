import { z } from "zod";

// ============================================================================
// Document No formats — 3-level nested master-detail (0264). Legacy System
// "Document No format" form:
//   Header : Entry No auto · Date · Track (→ config_lookups 'doc_track')
//   Menu   : Menu (→ 'doc_menu') · Location wise · Starting SlNo · Sample DocNo
//   Segment: Value Type (→ 'doc_value_type') · Value · Seperator · No Of Digits ·
//            Value From (→ 'doc_value_from') · Ref. only
// Every list field is a config_lookups picker (Add/Modify).
// ============================================================================

export interface DocumentNoFormatSegment {
  id: string;
  format_menu_id: string;
  sno: number;
  value_type_id: string | null;
  value: string | null;
  separator: string | null;
  no_of_digits: number | null;
  value_from_id: string | null;
  ref_only: boolean;
}

export interface DocumentNoFormatMenu {
  id: string;
  format_id: string;
  sno: number;
  menu_id: string | null;
  location_wise: boolean;
  starting_sl_no: number;
  sample_doc_no: string | null;
  segments: DocumentNoFormatSegment[];
}

export interface DocumentNoFormat {
  id: string;
  entry_no: number;
  date: string;
  track_id: string | null;
  is_draft: boolean;
  created_at: string;
  updated_at: string;
  menus: DocumentNoFormatMenu[];
}

const uuidN = z.string().uuid().nullable().default(null);
const nullableText = z.string().optional().nullable();

export const documentNoFormatSegmentInput = z.object({
  sno: z.coerce.number().int().nonnegative().default(0),
  value_type_id: uuidN,
  value: nullableText,
  separator: nullableText,
  no_of_digits: z.coerce.number().int().nonnegative().nullable().default(null),
  value_from_id: uuidN,
  ref_only: z.boolean().default(false),
});

export const documentNoFormatMenuInput = z.object({
  sno: z.coerce.number().int().nonnegative().default(0),
  menu_id: uuidN,
  location_wise: z.boolean().default(false),
  starting_sl_no: z.coerce.number().int().nonnegative().default(0),
  sample_doc_no: nullableText,
  segments: z.array(documentNoFormatSegmentInput).default([]),
});

export const documentNoFormatInput = z.object({
  date: z.string().min(1, "Date is required"),
  track_id: uuidN,
  is_draft: z.boolean().default(false),
  menus: z.array(documentNoFormatMenuInput).default([]),
});
export type DocumentNoFormatInput = z.infer<typeof documentNoFormatInput>;
