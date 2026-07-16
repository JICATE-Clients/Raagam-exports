import { z } from "zod";

// ============================================================================
// Levies — tax/levy master (0221). Legacy EDP2 form: header with a Type that
// drives which entirely different field set applies.
// - VAT and CST (0287) — pre-GST era types confirmed from the legacy Levies
//   list (entries dated 2014-2016, "Effective From" 01-07-2017 marking when
//   GST superseded them). Each is a single flat rate + one account head
//   (`vat_cst_pct` / `vat_cst_ac_head`, shared since only one is active at a
//   time) — no CGST/SGST/IGST split, no Annexure.
// - GST types (Intra/Inter/Exempted): CGST/SGST/IGST + Cess, tab reads "GST
//   Structure" — Intra-State uses CGST+SGST; Inter-State uses IGST; Exempted
//   uses none of the three (Cess stays available regardless).
// - DUTY (0282), TDS (0283) and EXCISE DUTY (0284) all use the SAME Annexure
//   block (Category + Category Slno + Calc/Exempt) and a single shared
//   Account Head (`annexure_ac_head`) — only their own 3 rate fields differ:
//   - DUTY: BED / Education Cess on BED / Secondary&Higher-Education Cess on
//     BED, tab reads "Duty Structure".
//   - TDS: TDS% / Surcharge% / Addnl Surcharge%, tab reads "TDS Structure".
//   - EXCISE DUTY: Excise Duty% / Cess% / Edu.Cess%, tab reads "Excise Duty
//     Structure". This "Cess" is a plain % field, unrelated to the GST
//     Structure's Cess (which has its own mode/value/account-head).
//   None of these three show CGST/SGST/IGST/Cess at all.
// ============================================================================

export const LEVY_TYPES = ["VAT", "CST", "GST Intra State", "GST Inter State", "GST Exempted", "DUTY", "TDS", "EXCISE DUTY"] as const;
export type LevyType = (typeof LEVY_TYPES)[number];

export const CESS_MODES = ["percent", "flat"] as const;
export type CessMode = (typeof CESS_MODES)[number];

export const CALC_EXEMPT_MODES = ["calculated", "exempted"] as const;
export type CalcExemptMode = (typeof CALC_EXEMPT_MODES)[number];

export function isDutyType(type: string): boolean {
  return type === "DUTY";
}
export function isTdsType(type: string): boolean {
  return type === "TDS";
}
export function isExciseDutyType(type: string): boolean {
  return type === "EXCISE DUTY";
}
/** Duty, TDS and Excise Duty all share the same Annexure + Account Head block. */
export function usesAnnexure(type: string): boolean {
  return isDutyType(type) || isTdsType(type) || isExciseDutyType(type);
}
/** VAT and CST share a single flat rate + account head (0287). */
export function isVatCstType(type: string): boolean {
  return type === "VAT" || type === "CST";
}

/** Which GST rate components a Type activates (the rest are shown disabled).
 *  Annexure types (Duty/TDS/Excise Duty) and VAT/CST don't use any of
 *  these — their fields are separate blocks. */
export function activeComponents(type: string): {
  cgst: boolean;
  sgst: boolean;
  igst: boolean;
} {
  if (usesAnnexure(type) || isVatCstType(type) || type === "GST Exempted") return { cgst: false, sgst: false, igst: false };
  switch (type) {
    case "GST Inter State":
      return { cgst: false, sgst: false, igst: true };
    case "GST Intra State":
    default:
      return { cgst: true, sgst: true, igst: false };
  }
}

export interface Levy {
  id: string;
  entry_no: number;
  levy_date: string;
  type: string;
  effective_from: string;
  /** VAT/CST Structure field (Type = VAT or CST only, 0287). */
  vat_cst_pct: number;
  vat_cst_ac_head: string | null;
  cgst_pct: number;
  cgst_ac_head: string | null;
  sgst_pct: number;
  sgst_ac_head: string | null;
  igst_pct: number;
  igst_ac_head: string | null;
  cess_mode: CessMode;
  cess_value: number;
  cess_ac_head: string | null;
  /** Duty Structure fields (Type = DUTY only, 0282). */
  bed_pct: number;
  edu_on_bed_pct: number;
  she_on_bed_pct: number;
  /** TDS Structure fields (Type = TDS only, 0283). */
  tds_pct: number;
  surcharge_pct: number;
  addnl_surcharge_pct: number;
  /** Excise Duty Structure fields (Type = EXCISE DUTY only, 0284). */
  excise_duty_pct: number;
  excise_cess_pct: number;
  excise_edu_cess_pct: number;
  /** Annexure — shared by Duty, TDS and Excise Duty (0282/0283/0284). */
  annexure_category_id: string | null;
  annexure_category_sno: number | null;
  /** Annexure label (e.g. "I"), distinct from Category (0286). */
  annexure_no: string | null;
  calc_exempt: CalcExemptMode;
  annexure_ac_head: string | null;
  description: string | null;
  inactive: boolean;
  /** Who entered the record (0286) — joined in levy-service, not a raw column read. */
  created_by: string | null;
  created_by_name: string | null;
  created_at: string;
  updated_at: string;
}

const acHead = z.string().uuid().nullable().default(null);
const pct = z.coerce.number().min(0).max(100).default(0);

export const levyInput = z.object({
  levy_date: z.string().min(1, "Date is required"),
  type: z.enum(LEVY_TYPES),
  effective_from: z.string().min(1, "Effective From is required"),
  vat_cst_pct: pct,
  vat_cst_ac_head: acHead,
  cgst_pct: pct,
  cgst_ac_head: acHead,
  sgst_pct: pct,
  sgst_ac_head: acHead,
  igst_pct: pct,
  igst_ac_head: acHead,
  cess_mode: z.enum(CESS_MODES).default("percent"),
  cess_value: z.coerce.number().min(0).default(0),
  cess_ac_head: acHead,
  bed_pct: pct,
  edu_on_bed_pct: pct,
  she_on_bed_pct: pct,
  tds_pct: pct,
  surcharge_pct: pct,
  addnl_surcharge_pct: pct,
  excise_duty_pct: pct,
  excise_cess_pct: pct,
  excise_edu_cess_pct: pct,
  annexure_category_id: acHead,
  annexure_category_sno: z.coerce.number().int().nullable().default(null),
  annexure_no: z.string().optional().nullable(),
  calc_exempt: z.enum(CALC_EXEMPT_MODES).default("calculated"),
  annexure_ac_head: acHead,
  description: z.string().optional().nullable(),
  inactive: z.boolean().default(false),
});
export type LevyInput = z.infer<typeof levyInput>;
