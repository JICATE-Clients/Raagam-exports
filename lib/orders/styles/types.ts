import { z } from "zod";
import { styleProblems } from "./rules";

// ============================================================================
// Garment Orders ▸ Style master (0124, phase 1 content pass 0392). Header +
// three child grids (Coordinates, Components, Sizes). Icon fields reference
// customers / countries / uoms / samples / items / processes / config_lookups.
//
//
// FIELDS THE CLIENT WITHDREW (2026-08-10) — READ BEFORE RE-ADDING ONE
//
// `style_for`, `tech_pack`, `received_date`, `receipt_mode`, `department_id`,
// `contact_id`, `customer_reference` on the header, and `trims` /
// `trims_category_id` on a component, are gone from the form AND from the Zod
// input below. Their COLUMNS still exist and still hold whatever they held.
//
// Leaving them OUT OF THE SCHEMA is the half that matters. A field left in with
// `.default(null)` is not a harmless leftover: `headerOnly(p.data)` writes the
// parsed object, so every update would blank the stored value. Same reasoning
// as `commodity_id` in lib/masters/process-types.ts, which is deliberately
// absent for exactly this reason.
//
// The interfaces below KEEP the columns, because `service.ts` selects `*` and
// the rows really do carry them.
// ============================================================================

// Fixed dropdowns — legacy option lists (confirm exact values via screenshots).
export const SEASON_OPTIONS = ["Summer", "Winter", "Spring", "Autumn"] as const;
export const COMPONENT_TYPE_OPTIONS = ["Circular", "Flat"] as const;

export interface GarmentStyleCoordinate {
  id: string;
  style_id: string;
  sno: number;
  coordinate_id: string | null;
  /** Withdrawn from the form and the input 2026-08-10 (client): a coordinate
   *  is now just a name from the master. The COLUMN remains and still reads
   *  back — but note this is a CHILD table that `writeChildren` deletes and
   *  reinserts on every save, so unlike a withdrawn HEADER field (0392) the
   *  stored value does not survive the next save of its style. Nothing is
   *  lost today: the table is empty. */
  mlist_no: string | null;
}

export interface GarmentStyleComponentProcess {
  id: string;
  component_id: string;
  sno: number;
  process_id: string | null;
}

export interface GarmentStyleComponent {
  id: string;
  style_id: string;
  sno: number;
  coordinate_id: string | null;
  component_id: string | null;
  structure_id: string | null;
  comp_type: string | null;
  /** The fabric — an `items` row of item class FABRIC (0392). */
  item_id: string | null;
  /** Withdrawn from the form 2026-08-10; the columns and their values remain. */
  trims: boolean;
  trims_category_id: string | null;
  /** Printing / embroidery / … from the `processes` master.
   *
   *  WITHDRAWN FROM THE FORM 2026-08-10 (client: the legacy grid has no process
   *  column). Still embedded by the service and still read back — but note this
   *  is a CHILD of a child, and `writeChildren` deletes and recreates every
   *  component on each save, so these rows cascade away with their parent
   *  whatever the schema says. Nothing is lost today: the table is empty. */
  processes: GarmentStyleComponentProcess[];
}

export interface GarmentStyleSize {
  id: string;
  style_id: string;
  sno: number;
  size_id: string | null;
}

export interface GarmentStyle {
  id: string;
  code: string | null;
  blocked: boolean;
  style_date: string;
  style_for: string | null;
  customer_id: string | null;
  approved_sample_id: string | null;
  style_name: string | null;
  season: string | null;
  style_year: number | null;
  article_no: string | null;
  /** A `categories` row, NOT a config_lookup (0394). The Style Category comes
   *  from the Garment master, scoped by `item_class_id` below. */
  style_category_id: string | null;
  /** The Item Class the operator chose; scopes the Category picker. Stored
   *  rather than derived from the category, so a draft saved before a category
   *  is picked still reopens on the right class (0394). */
  item_class_id: string | null;
  style_description: string | null;
  tech_pack: string | null;
  unit_id: string | null;
  /** Piece or Set — drives the coordinate count. Null on every style created
   *  before 0392; see `coordinateLimit` in ./rules. */
  unit_kind: string | null;
  /** The size group last used to FILL the sizes. Provenance only —
   *  `garment_style_sizes` stays the source of truth. */
  size_group_id: string | null;
  country_id: string | null;
  department_id: string | null;
  contact_id: string | null;
  customer_reference: string | null;
  received_date: string | null;
  receipt_mode: string | null;
  description: string | null;
  is_draft: boolean;
  created_at: string;
  updated_at: string;
  // embedded for display / edit
  customer?: { id: string; code: string | null; name: string } | null;
  coordinates: GarmentStyleCoordinate[];
  components: GarmentStyleComponent[];
  sizes: GarmentStyleSize[];
}

const nullableText = z.string().optional().nullable();
const uuidN = z.string().uuid().nullable().default(null);

export const styleCoordinateInput = z.object({
  sno: z.coerce.number().int().nonnegative().default(0),
  coordinate_id: uuidN,
  // `mlist_no` withdrawn 2026-08-10 (client): "not needed". Absent from the
  // schema, not just the form — see the note on the interface above.
});

export const styleComponentProcessInput = z.object({
  sno: z.coerce.number().int().nonnegative().default(0),
  process_id: uuidN,
});

export const styleComponentInput = z.object({
  sno: z.coerce.number().int().nonnegative().default(0),
  coordinate_id: uuidN,
  component_id: uuidN,
  structure_id: uuidN,
  comp_type: nullableText,
  /** The fabric. An `items` id; the screen scopes the picker to item class
   *  FABRIC, which is a caller concern — nothing here can check it without a
   *  round trip, and a rule that needs one does not belong in a schema. */
  item_id: uuidN,
  // `trims` / `trims_category_id` are deliberately absent — see the header.
  // `processes` left on 2026-08-10 too: the legacy Components grid has no
  // process column, so the client had the sub-grid removed. The TABLE
  // `garment_style_component_processes` (0392) and this file's
  // `styleComponentProcessInput` both remain, so restoring it is a UI change
  // rather than a migration.
});

export const styleSizeInput = z.object({
  sno: z.coerce.number().int().nonnegative().default(0),
  size_id: uuidN,
});

export const garmentStyleInput = z
  .object({
    blocked: z.boolean().default(false),
    style_date: z.string().min(1, "Date is required"),
    customer_id: uuidN,
    approved_sample_id: uuidN,
    style_name: z.string().min(1, "Style name is required"),
    season: nullableText,
    style_year: z.coerce.number().int().nullable().default(null),
    article_no: nullableText,
    style_category_id: uuidN,
    item_class_id: uuidN,
    style_description: nullableText,
    unit_id: uuidN,
    /** Piece or Set. NULLABLE on purpose: every style predating 0392 has none,
     *  and rejecting those would make old records unsaveable. The FORM marks it
     *  required, so the backfill happens on next edit. */
    unit_kind: z.enum(["piece", "set"]).nullable().default(null),
    size_group_id: uuidN,
    country_id: uuidN,
    description: nullableText,
    is_draft: z.boolean().default(false),
    // children
    coordinates: z.array(styleCoordinateInput).default([]),
    components: z.array(styleComponentInput).default([]),
    sizes: z.array(styleSizeInput).default([]),
  })
  /**
   * THE CROSS-TAB RULE, COMPILED IN.
   *
   * `styleProblems` is the same function the screen calls to badge the rail and
   * to derive `canSave`. Running it here too is what makes the rule true for a
   * caller that never touches the screen — a `lib/data-io` import, or a future
   * API. AGENTS.md's standing phrasing: the screen check is a courtesy, this
   * one is the guard.
   *
   * `path` is set to the child array so the message lands on the offending
   * section rather than at the root, matching how `materialInput`'s mixing
   * refinement reports.
   *
   * The rail's section keys and the child array names are the same words, so
   * the mapping is a membership test rather than a lookup table — but it is a
   * TEST rather than a bare cast, because a section that is not a child array
   * ("style", "general") must land at the root, not invent a path key nothing
   * in the payload has. Written as a set so adding a rule on a new child is one
   * word here instead of another `===` branch nobody remembers to extend; the
   * previous form hard-coded "coordinates" and would have filed this commit's
   * components problem at the root.
   */
  .superRefine((v, ctx) => {
    const childArrays = new Set(["coordinates", "components", "sizes"]);
    for (const p of styleProblems(v)) {
      ctx.addIssue({
        code: "custom",
        message: p.message,
        path: childArrays.has(p.section) ? [p.section] : [],
      });
    }
  });
export type GarmentStyleInput = z.infer<typeof garmentStyleInput>;

export function styleStatusTone(
  s: Pick<GarmentStyle, "is_draft" | "blocked">,
): "warning" | "danger" | "success" {
  return s.is_draft ? "warning" : s.blocked ? "danger" : "success";
}
export function styleStatusText(
  s: Pick<GarmentStyle, "is_draft" | "blocked">,
): string {
  return s.is_draft ? "Draft" : s.blocked ? "Blocked" : "Active";
}
