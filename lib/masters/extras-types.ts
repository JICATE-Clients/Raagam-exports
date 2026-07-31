import { z } from "zod";
import { CURRENCY_RE, YARN_COUNT_RE, capsName, capsTextNullable } from "@/lib/validation/formats";

// ============================================================================
// Config lookups — generic kind-discriminated material/spec masters (0218)
// ============================================================================
// Ordered to mirror the legacy EDP2 "Material" sub-module child list.
// Stock unit (uoms) and Material (items) are omitted here — they keep their own
// rich tables/tabs and are surfaced as links in the child selector (0219).
export const LOOKUP_KINDS = [
  "attribute",
  "levy",
  "material_category",
  "material_attribute",
  "yarn_count",
  "yarn_purity",
  "composition",
  "process",
  "component",
  "gauge",
  "knitting_dia",
  "out_doc_term",
  "commodity",
  "item_class",
  "hsn_code",
  "city",
  // SHAPE ONLY — there are no `config_lookups` rows of this kind, and there is
  // no way to create one. States live in `public.states` (0355 repointed every
  // `state_id` FK there; 0374 deleted the last stale copy). The kind survives
  // because `statesAsLookups()` (lookup-compat.ts) and `state-picker.tsx` both
  // build in-memory `ConfigLookup` values stamped `kind: "state"`, and both
  // stop compiling without it.
  //
  // Do NOT add State to the registry in `app/(app)/masters/config-sections.tsx`
  // — that would point the generic lookup master at an empty table. And do not
  // render a State field with `LookupDialogPicker kind="state"`: it reads from
  // `public.states` via the compat shim but WRITES to `config_lookups`, so Add
  // silently saved to the wrong table until 2026-07-31. Use `StatePicker`.
  //
  // `city` above is the genuine article — Cities really are lookups with no
  // master of their own (0355), which is why the two sit here side by side
  // looking alike.
  "state",
  "department",
  "designation",
  "internal_department",
  "ship_type",
  "payment_term",
  "employee_category",
  "team",
  "account_schedule",
  "vendor_group",
  "agent_type",
  "agent",
  "packing_list_format",
  "commercial_invoice_format",
  "shift_category",
  "doc_track",
  "doc_menu",
  "doc_value_type",
  "doc_value_from",
  // Garment Orders ▸ Style master pickers (0124)
  "style_category",
  "coordinate",
  "style_component",
  "structure",
  "trims_category",
  "size",
  // Garment Orders ▸ Order Amendment ▸ Color/Print tab (0128) — no print master exists
  "roll_form_print",
  // Garment Orders ▸ Packing List Advice ▸ Warehouse Name (0130)
  "warehouse",
  // Orders ▸ TA ▸ TA Activity ▸ Type picker (0266)
  "ta_activity_type",
  // Materials ▸ Fabric/Yarn textile logic (0279)
  "fabric_structure",
  "fabric_type",
  "yarn_type",
  // Materials ▸ Levy ▸ Duty Structure ▸ Annexure Category (0282)
  "duty_category",
  // Associates ▸ Vendor ▸ Item Category grid (0369). The legacy "Form" and
  // "Type" are ▾ dropdowns whose contents no screenshot shows, so they are
  // managed lists the operator fills rather than guessed constants.
  "vendor_item_form",
  "vendor_supply_type",
  // Associates ▸ Vendor ▸ Service grid (0372) — same reasoning as the two above.
  "vendor_service_type",
] as const;
export type LookupKind = (typeof LOOKUP_KINDS)[number];
export const LOOKUP_KIND_LABELS: Record<LookupKind, string> = {
  attribute: "Attributes",
  levy: "Levies",
  material_category: "Categories",
  material_attribute: "Material Attributes",
  yarn_count: "Counts",
  yarn_purity: "Yarn Purities",
  composition: "Compositions",
  process: "Processes",
  component: "Components",
  gauge: "Gauges",
  knitting_dia: "Knitting Dias",
  out_doc_term: "Out Document Terms",
  commodity: "Commodities",
  item_class: "Item Classes",
  hsn_code: "HSN Codes",
  city: "Cities",
  state: "States",
  department: "Departments",
  designation: "Designations",
  internal_department: "Internal Departments",
  ship_type: "Ship Types (Incoterms)",
  payment_term: "Payment Terms",
  employee_category: "Employee Categories",
  team: "Teams",
  account_schedule: "Account Schedules",
  vendor_group: "Vendor Groups",
  agent_type: "Agent Types",
  agent: "Agents",
  packing_list_format: "Packing List Formats",
  commercial_invoice_format: "Commercial Invoice Formats",
  shift_category: "Shift Categories",
  doc_track: "Document Tracks",
  doc_menu: "Document Menus",
  doc_value_type: "Document Value Types",
  doc_value_from: "Document Value Sources",
  style_category: "Style Categories",
  coordinate: "Coordinates",
  style_component: "Style Components",
  structure: "Structures",
  trims_category: "Trims Categories",
  size: "Sizes",
  roll_form_print: "Roll Form Prints",
  warehouse: "Warehouses",
  ta_activity_type: "TA Activity Types",
  fabric_structure: "Fabric Structures",
  fabric_type: "Fabric Types",
  yarn_type: "Yarn Types",
  duty_category: "Duty Categories",
  vendor_item_form: "Vendor Item Forms",
  vendor_supply_type: "Vendor Supply Types",
  vendor_service_type: "Vendor Service Types",
};

/**
 * Kinds whose `code` is an industry-standard abbreviation the operator actually
 * speaks in. Incoterms are the only one today: nobody in a shipping office says
 * "delivered duty paid", they say DDP — but the expansion is what makes the term
 * unambiguous on screen, so both belong there: `DELIVERED DUTY PAID (DDP)`.
 *
 * This is the deliberate exception to codes being backend-only (client
 * 2026-07-23). That rule exists because a code is normally an internally
 * generated key — "CAT-014" beside a category name is noise. An Incoterm code is
 * the opposite: it IS the name of the thing in the trade, and the long form is
 * the gloss. Do NOT widen this set to a kind whose codes are generated, and
 * remember that a value added through the UI has no code of its own (see below).
 */
export const CODE_IN_LABEL_KINDS: ReadonlySet<LookupKind> = new Set<LookupKind>(["ship_type"]);

/**
 * How a `config_lookups` row reads on screen: `COST, INSURANCE & FREIGHT (CIF)`
 * for the kinds above, the bare name for every other kind.
 *
 * Use it for BOTH the picker list and every read-only echo of the same value
 * (view sheets, listing columns), so a field and the record card beside it never
 * disagree about what the operator picked.
 *
 * Composed at render time, never stored: the abbreviation already lives in
 * `code`, so writing it into `name` as well would let the two drift — and the
 * picker's Modify form edits `name` directly, so the composed string would be
 * saved back as the name the first time anyone opened it.
 *
 * Three rows are deliberately left alone:
 *  - **No code, or a code equal to the name.** Every value added through the UI
 *    lands here: there is no Code input anywhere (`data-picker.tsx`), and
 *    `createLookupValue` defaults a blank code to the name. So an operator's own
 *    ship type reads "MY TERM", never "MY TERM (MY TERM)". Only the seeded
 *    Incoterms — and anything imported with a real code — carry the bracket.
 *  - **A name that already ends in its own parenthetical.** The seeded CFR row
 *    reads "COST & FREIGHT (C&F)" — the alias Indian exporters actually say,
 *    baked into the name back when this list rendered names alone (0241). It
 *    keeps that rather than stacking a second bracket; rename the row to
 *    "COST & FREIGHT" from the picker's pencil to get "(CFR)" instead.
 */
export function lookupLabel(
  kind: LookupKind,
  row: { code?: string | null; name?: string | null },
): string {
  const name = (row.name ?? "").trim();
  const code = (row.code ?? "").trim();
  if (!code || !CODE_IN_LABEL_KINDS.has(kind)) return name;
  if (name.toUpperCase() === code.toUpperCase()) return name;
  if (/\([^()]*\)$/.test(name)) return name;
  return `${name} (${code})`;
}

export interface ConfigLookup {
  id: string;
  kind: LookupKind;
  code: string | null;
  name: string;
  /** Functional grouping distinct from Code — only meaningful for
   *  kind='item_class' (e.g. FABRIC's type is "FAB"; Button groups under
   *  "GEN" despite being its own class). Null/absent for every other kind
   *  (0287) — optional so the many inline-add optimistic-update call sites
   *  across the masters screens don't all need updating for one edge kind. */
  type_code?: string | null;
  notes: string | null;
  is_active: boolean;
  /** Item Class only (0338): when true, the Attribute screen shows a value-adding
   *  section for this class; when false it shows the class with no values. Optional
   *  so the many inline-add call sites constructing ConfigLookup don't all need it. */
  has_attribute?: boolean;
  /** Legacy attribution (e.g. "SELVARAJ", "admin") — free text, not a
   *  profiles FK, since config_lookups must carry legacy usernames that
   *  don't correspond to real Supabase Auth accounts (0290). Populated
   *  server-side on create; not user-editable via the form. Optional so
   *  the many inline-add optimistic-update call sites across the masters
   *  screens don't all need updating (mirrors `type_code` above, 0287). */
  created_by?: string | null;
  created_at: string;
  updated_at: string;
}

// ============================================================================
// Attributes (0220, merged into Item Class by 0293). The legacy "Attribute"
// master turned out to be the same data as Item Class (config_lookups kind
// `item_class`) — confirmed against the client's legacy "Attributes - U2"
// report. An "Attribute" row IS an Item Class row; the child grid of named
// values (e.g. GSM, Width) is what Material Attribute Lines actually pick
// from, scoped per Item Class.
// ============================================================================
export type AttributeInputType = "option_list" | "numeric_range";
export interface AttributeValueOption {
  id: string;
  attribute_value_id: string;
  sno: number;
  value: string;
}
export interface AttributeValue {
  id: string;
  item_class_id: string;
  sno: number;
  value: string;
  /** 0341: whether this attribute is a categorical option list (Printed/Laminated)
   *  or a numeric range (GSM 180-200). Drives the material-form question input. */
  input_type: AttributeInputType;
  /** Allowed options for an `option_list` attribute (empty for numeric_range). */
  options: AttributeValueOption[];
}
export interface Attribute extends ConfigLookup {
  values: AttributeValue[];
}

export const attributeValueInput = z.object({
  sno: z.coerce.number().int().nonnegative().default(0),
  value: z.string().min(1),
  input_type: z.enum(["option_list", "numeric_range"]).default("numeric_range"),
  options: z
    .array(z.object({ sno: z.coerce.number().int().nonnegative().default(0), value: z.string().min(1) }))
    .default([]),
});
export const attributeInput = z.object({
  code: z.string().optional().nullable(),
  name: capsName(),
  type_code: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  is_active: z.boolean().default(true),
  values: z.array(attributeValueInput).default([]),
});
export type AttributeInput = z.infer<typeof attributeInput>;
export const lookupInput = z
  .object({
    kind: z.enum(LOOKUP_KINDS),
    code: z.string().optional().nullable(),
    name: capsName(),
    type_code: z.string().optional().nullable(),
    notes: z.string().optional().nullable(),
    is_active: z.boolean().default(true),
  })
  // Yarn Count values are constrained to canonical textile shapes (10'S, 2/10'S,
  // 40 DINER); scoped to kind so every other lookup kind stays free text. Tested
  // uppercased to mirror the server storing names in CAPS (see extras-actions).
  .superRefine((v, ctx) => {
    if (v.kind === "yarn_count" && !YARN_COUNT_RE.test(v.name.trim().toUpperCase())) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["name"],
        message: "Use 10'S, 2/10'S or 40 DINER",
      });
    }
  });
export type LookupInput = z.infer<typeof lookupInput>;

// ============================================================================
// Item Class — its own master (doc/update.md #1-3). Backed by config_lookups
// kind='item_class' (same rows FKs already point at). Split from the Attribute
// screen: Item Class carries Name + Has Attribute; the Attribute screen edits
// the per-class value list (gated by has_attribute).
// ============================================================================
export type ItemClass = ConfigLookup;
export const itemClassInput = z.object({
  code: z.string().optional().nullable(),
  name: capsName(),
  type_code: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  has_attribute: z.boolean().default(false),
  is_active: z.boolean().default(true),
});
export type ItemClassInput = z.infer<typeof itemClassInput>;

// ============================================================================
// Transporters (Associates)
// ============================================================================
export interface Transporter {
  id: string;
  code: string | null;
  name: string;
  contact_person: string | null;
  phone: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}
export const transporterInput = z.object({
  code: z.string().optional().nullable(),
  name: capsName(),
  contact_person: capsTextNullable(),
  phone: z.string().optional().nullable(),
  is_active: z.boolean().default(true),
});
export type TransporterInput = z.infer<typeof transporterInput>;

// ============================================================================
// GST rates
// ============================================================================
export interface GstRate {
  id: string;
  name: string;
  rate_pct: number;
  hsn_code: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}
export const gstRateInput = z.object({
  name: z.string().min(1),
  rate_pct: z.coerce.number().min(0).max(100).default(0),
  hsn_code: z.string().optional().nullable(),
  is_active: z.boolean().default(true),
});
export type GstRateInput = z.infer<typeof gstRateInput>;

// ============================================================================
// Currency management (existing `currencies` table; PK = code)
// ============================================================================
export const currencyInput = z.object({
  code: z.string().min(1).max(8).regex(CURRENCY_RE, "Enter a 3-letter ISO currency code (e.g. INR)"),
  name: z.string().min(1),
  symbol: z.string().optional().nullable(),
});
export type CurrencyInput = z.infer<typeof currencyInput>;
