import { z } from "zod";

// ============================================================================
// Grid Master Types — Phase 2 masters with child detail rows.
// All types aligned to migrations 0333/0334 schema.
// ============================================================================

// --- Count Groups -----------------------------------------------------------
export interface CountGroupCount {
  id: string;
  count_group_id: string;
  sno: number;
  count_lookup_id: string | null;
}

export interface CountGroup {
  id: string;
  code: string;
  name: string;
  category_id: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  details: CountGroupCount[];
}

export const countGroupDetailInput = z.object({
  sno: z.number().int().positive(),
  count_lookup_id: z.string().uuid().nullable().default(null),
});

export const countGroupInput = z.object({
  /** Blank on create → the action auto-generates a unique code from the name
   *  (client 2026-07-23: don't ask users for a code). Edit passes the existing
   *  code through unchanged. */
  code: z.string().optional().default(""),
  name: z.string().min(1, "Name is required"),
  category_id: z.string().uuid().nullable().default(null),
  is_active: z.boolean().default(true),
  details: z.array(countGroupDetailInput).min(1, "At least one count row is required"),
});

export type CountGroupInput = z.infer<typeof countGroupInput>;
export type CountGroupDetailInput = z.infer<typeof countGroupDetailInput>;

// --- Constructions ----------------------------------------------------------
export interface ConstructionCount {
  id: string;
  construction_id: string;
  sno: number;
  count_type: "P" | "T";
  count_lookup_id: string | null;
  item_id: string | null;
}

export interface Construction {
  id: string;
  code: string;
  name: string;
  reed: number;
  epi_on_loom: number;
  reed_count: string | null;
  pick: number;
  construct_for: string;
  weave_tech_desc: string | null;
  category_id: string | null;
  is_direct_purchase: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  details: ConstructionCount[];
}

export const constructionCountInput = z.object({
  sno: z.number().int().positive(),
  count_type: z.enum(["P", "T"]),
  count_lookup_id: z.string().uuid().nullable().default(null),
  item_id: z.string().uuid().nullable().default(null),
});

export const constructionInput = z.object({
  /** Blank on create → the action auto-generates a unique code from the name
   *  (client 2026-07-23: don't ask users for a code). Edit passes the existing
   *  code through unchanged. */
  code: z.string().optional().default(""),
  name: z.string().min(1, "Name is required"),
  reed: z.coerce.number().int().min(0).default(0),
  epi_on_loom: z.coerce.number().int().min(0).default(0),
  reed_count: z.string().nullable().default(null),
  pick: z.coerce.number().min(0).default(0),
  construct_for: z.string().default("G"),
  weave_tech_desc: z.string().nullable().default(null),
  category_id: z.string().uuid().nullable().default(null),
  is_direct_purchase: z.boolean().default(false),
  is_active: z.boolean().default(true),
  details: z.array(constructionCountInput).default([]),
});

export type ConstructionInput = z.infer<typeof constructionInput>;
export type ConstructionCountInput = z.infer<typeof constructionCountInput>;

// --- Yarn Purchase Rates ----------------------------------------------------
export interface YarnPurchaseRateItem {
  id: string;
  rate_id: string;
  sno: number;
  category_id: string | null;
  item_id: string | null;
  purity_id: string | null;
  uom: string;
  rate: number;
}

export interface YarnPurchaseRate {
  id: string;
  code: string;
  entry_date: string;
  effective_from: string;
  created_at: string;
  updated_at: string;
  details: YarnPurchaseRateItem[];
}

export const yarnPurchaseRateItemInput = z.object({
  sno: z.number().int().positive(),
  category_id: z.string().uuid().nullable().default(null),
  item_id: z.string().uuid().nullable().default(null),
  purity_id: z.string().uuid().nullable().default(null),
  uom: z.string().default("KGS"),
  rate: z.coerce.number().positive("Rate must be > 0"),
});

export const yarnPurchaseRateInput = z.object({
  effective_from: z.string().min(1, "Effective from is required"),
  details: z.array(yarnPurchaseRateItemInput).min(1, "At least one rate row is required"),
});

export type YarnPurchaseRateInput = z.infer<typeof yarnPurchaseRateInput>;
export type YarnPurchaseRateItemInput = z.infer<typeof yarnPurchaseRateItemInput>;

// --- Yarn Debit Rates -------------------------------------------------------
export interface YarnDebitRateItem {
  id: string;
  rate_id: string;
  sno: number;
  item_id: string | null;
  rate_per_kg: number;
  rate_per_bundle: number;
}

export interface YarnDebitRate {
  id: string;
  code: string;
  entry_date: string;
  effective_from: string;
  created_at: string;
  updated_at: string;
  details: YarnDebitRateItem[];
}

export const yarnDebitRateItemInput = z.object({
  sno: z.number().int().positive(),
  item_id: z.string().uuid().nullable().default(null),
  rate_per_kg: z.coerce.number().min(0).default(0),
  rate_per_bundle: z.coerce.number().min(0).default(0),
});

export const yarnDebitRateInput = z.object({
  effective_from: z.string().min(1, "Effective from is required"),
  details: z.array(yarnDebitRateItemInput).min(1, "At least one rate row is required"),
});

export type YarnDebitRateInput = z.infer<typeof yarnDebitRateInput>;
export type YarnDebitRateItemInput = z.infer<typeof yarnDebitRateItemInput>;

// --- Sizing Rates -----------------------------------------------------------
export interface SizingRateYarn {
  id: string;
  sizing_rate_id: string;
  sno: number;
  category_id: string | null;
  item_id: string | null;
  rate_ends_upto: number;
  rate_ends_more: number;
}

export interface SizingRate {
  id: string;
  code: string;
  entry_date: string;
  effective_from: string;
  entry_type: string;
  base_rate: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  details: SizingRateYarn[];
}

export const sizingRateYarnInput = z.object({
  sno: z.number().int().positive(),
  category_id: z.string().uuid().nullable().default(null),
  item_id: z.string().uuid().nullable().default(null),
  rate_ends_upto: z.coerce.number().min(0).default(0),
  rate_ends_more: z.coerce.number().min(0).default(0),
});

export const sizingRateInput = z.object({
  effective_from: z.string().min(1, "Effective from is required"),
  entry_type: z.string().default("N"),
  base_rate: z.coerce.number().min(0).default(0),
  is_active: z.boolean().default(true),
  details: z.array(sizingRateYarnInput).min(1, "At least one yarn row is required"),
});

export type SizingRateInput = z.infer<typeof sizingRateInput>;
export type SizingRateYarnInput = z.infer<typeof sizingRateYarnInput>;

// --- Warp Length Allowances -------------------------------------------------
export interface WarpLengthAllowanceDetail {
  id: string;
  allowance_id: string;
  sno: number;
  range_type: "U" | "B" | "A";
  from_warp_length: number;
  to_warp_length: number;
  warp_length: number;
  fabric_length: number;
  weft_waste_pct: number;
  shuttle_loom: boolean;
  shuttleless_loom: boolean;
  hand_loom: boolean;
}

export interface WarpLengthAllowance {
  id: string;
  code: string;
  entry_date: string;
  effective_from: string;
  created_at: string;
  updated_at: string;
  details: WarpLengthAllowanceDetail[];
}

export const warpLengthAllowanceDetailInput = z.object({
  sno: z.number().int().positive(),
  range_type: z.enum(["U", "B", "A"]).default("B"),
  from_warp_length: z.coerce.number().min(0).default(0),
  to_warp_length: z.coerce.number().min(0).default(0),
  warp_length: z.coerce.number().int().min(0).default(0),
  fabric_length: z.coerce.number().int().min(0).default(0),
  weft_waste_pct: z.coerce.number().min(0).max(100).default(0),
  shuttle_loom: z.boolean().default(false),
  shuttleless_loom: z.boolean().default(false),
  hand_loom: z.boolean().default(false),
});

export const warpLengthAllowanceInput = z.object({
  effective_from: z.string().min(1, "Effective from is required"),
  details: z
    .array(warpLengthAllowanceDetailInput)
    .min(1, "At least one allowance row is required"),
});

export type WarpLengthAllowanceInput = z.infer<typeof warpLengthAllowanceInput>;
export type WarpLengthAllowanceDetailInput = z.infer<typeof warpLengthAllowanceDetailInput>;

// --- Process Sequences ------------------------------------------------------
export interface ProcessSequenceStep {
  id: string;
  sequence_id: string;
  sno: number;
  stage: string | null;
  process_id: string | null;
  process_group: string | null;
  loss_pct: number;
  loss_for: string;
  rate: number;
  expected_loss_pct: number;
  vendor_id: string | null;
  description: string | null;
}

export interface ProcessSequence {
  id: string;
  code: string;
  name: string;
  item_class_type: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  details: ProcessSequenceStep[];
}

export const processSequenceStepInput = z.object({
  sno: z.number().int().positive(),
  stage: z.string().nullable().default(null),
  process_id: z.string().uuid().nullable().default(null),
  process_group: z.string().nullable().default(null),
  loss_pct: z.coerce.number().min(0).max(100).default(0),
  loss_for: z.string().default("P"),
  rate: z.coerce.number().min(0).default(0),
  expected_loss_pct: z.coerce.number().min(0).max(100).default(0),
  vendor_id: z.string().uuid().nullable().default(null),
  description: z.string().nullable().default(null),
});

export const processSequenceInput = z.object({
  /** Blank on create → the action auto-generates a unique code from the name
   *  (client 2026-07-23: don't ask users for a code). Edit passes the existing
   *  code through unchanged. */
  code: z.string().optional().default(""),
  name: z.string().min(1, "Name is required"),
  item_class_type: z.string().min(1, "Item class type is required"),
  is_active: z.boolean().default(true),
  details: z.array(processSequenceStepInput).min(1, "At least one step is required"),
});

export type ProcessSequenceInput = z.infer<typeof processSequenceInput>;
export type ProcessSequenceStepInput = z.infer<typeof processSequenceStepInput>;

// --- Process Sequence Groups ------------------------------------------------
export interface ProcessSequenceGroupMember {
  id: string;
  group_id: string;
  sno: number;
  sequence_id: string | null;
}

export interface ProcessSequenceGroup {
  id: string;
  code: string;
  name: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  details: ProcessSequenceGroupMember[];
}

export const processSequenceGroupMemberInput = z.object({
  sno: z.number().int().positive(),
  sequence_id: z.string().uuid().nullable().default(null),
});

export const processSequenceGroupInput = z.object({
  /** Blank on create → the action auto-generates a unique code from the name
   *  (client 2026-07-23: don't ask users for a code). Edit passes the existing
   *  code through unchanged. */
  code: z.string().optional().default(""),
  name: z.string().min(1, "Name is required"),
  is_active: z.boolean().default(true),
  details: z
    .array(processSequenceGroupMemberInput)
    .min(1, "At least one sequence row is required"),
});

export type ProcessSequenceGroupInput = z.infer<typeof processSequenceGroupInput>;
export type ProcessSequenceGroupMemberInput = z.infer<typeof processSequenceGroupMemberInput>;
