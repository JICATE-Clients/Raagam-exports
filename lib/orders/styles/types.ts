import { z } from "zod";
import { capsName, capsTextNullable } from "@/lib/validation/formats";
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
// input below. `country_id` and `unit_id` joined them on 2026-08-11. Their
// COLUMNS still exist and still hold whatever they held.
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
/**
 * CAPS (client 2026-08-17 — "fix the Season field to display in CAPITAL CASES
 * instead of small cases").
 *
 * The list itself is the display half here, and that is the whole difference
 * from Style / Article No. beside it. AGENTS.md §CAPITALS names `<Input
 * uppercase>` as the mechanism, but Season is a `<Select>` over a fixed
 * vocabulary — there is no keystroke to intercept and a CSS transform on the
 * trigger would leave the stored word Title-case, which is "merely displayed",
 * the exact thing the rule refuses. So the OPTION VALUES are capital, which
 * makes every new save capital by construction.
 *
 * The write half is still stated separately (`capsTextNullable()` on `season`
 * below), because these four words are not the only thing the column can hold:
 * it is plain `text` (0124) and has always accepted imported free text.
 *
 * THE TWO SEASON LISTS ARE SEPARATE LITERALS AND ONLY THIS ONE MOVED.
 * `lib/orders/amendments/types.ts` has its own copy, still Title-case, and
 * nothing keeps them in step — `lib/orders/amendments/style-options.ts` says so
 * in as many words. That is safe rather than merely tolerated: `styleOptions`
 * compares through `norm` (trim + upper-case on BOTH sides), so a style stored
 * "SUMMER" still matches an order header holding "Summer". Verified against the
 * live database on 2026-08-17 — all 3 styles carry Title-case seasons and no
 * order header carries one at all — so the facet's behaviour is unchanged by
 * this commit.
 */
export const SEASON_OPTIONS = ["SUMMER", "WINTER", "SPRING", "AUTUMN"] as const;
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
  /** The FABRIC category — labelled "Structure" on screen (0405). */
  fabric_category_id: string | null;
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
  fabric_category_id: uuidN,
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
    /**
     * THE APPROVED SAMPLE. Mandatory — but on CREATE, in the action, not here.
     *
     * The client's reason is a measurement: how many marketing samples convert
     * to bulk production. That question is only ever asked of styles entered
     * from now on, and the schema is the wrong place to enforce it because the
     * SAME schema parses an update of a style entered before the rule existed.
     *
     * A non-nullable `.uuid()` here would make every such style unsaveable —
     * open a legacy style to fix a typo in its name and Save is dead, with the
     * only escape being to name a sample that was never taken. That is not a
     * backfill the operator can perform: there are ZERO approved samples in the
     * database today (`samples where status = 'approved'`), so the field has
     * nothing to offer and the record has no way out. It would also block
     * `is_draft` saves, which exist precisely to park an incomplete style.
     *
     * IT IS OPTIONAL EVERYWHERE AS OF 2026-08-13 (client), and the paragraph
     * above is the reason rather than an aside. The split used to be "required
     * on create, grandfathered on update" — but the sentence about ZERO
     * approved samples applies to a NEW style just as completely as to a legacy
     * one, so the create half was a rule with nothing that could satisfy it.
     * The Style master could not be saved at all, and the Garment Order's
     * Style(s) tab requires a style, so order entry stopped behind it.
     *
     * The `uuidN` below has not changed and never needed to: the schema was
     * already permissive, and it was `createGarmentStyle` plus the form's `*`
     * that did the refusing. Both are withdrawn.
     *
     * `lib/data-io`: `garment_styles` is NOT a data-io entity (nothing in
     * `lib/data-io/entities.ts` names it), so no import path bypasses the
     * action. That mattered while a create guard existed; if the guard comes
     * back — the day a sample can be raised from the picker — it must live here
     * or be repeated there, because data-io writes straight to Postgres.
     */
    approved_sample_id: uuidN,
    /**
     * CAPS, AND THE TRANSFORM BELONGS HERE (client 2026-08-14 — "only capital
     * letters, even if the operator types small").
     *
     * The screen half alone would not have been enough and the reason is the
     * standing one: `<Input uppercase>` uppercases the KEYSTROKE, so it cannot
     * reach a name that was stored before this rule or written by any path that
     * is not a person typing. `capsName()` is what makes the stored value
     * capital, which is what "stored, not merely displayed" means in AGENTS.md
     * §CAPITALS.
     *
     * THIS IS THE ONLY EDITABLE STYLE-NAME FIELD IN THE ORDERS MODULE. Every
     * other screen that shows a style — Order Entry, Material BOM, Process
     * Amendment, TA Style — PICKS one from this master rather than typing it, so
     * capitalising the source is what capitalises the module. There is no second
     * place to keep in sync, and a per-screen display transform would have been
     * the per-component patch AGENTS.md warns against.
     *
     * `capsName` also trims and refuses whitespace-only, which is why it
     * replaces the `.min(1)` rather than sitting in front of it — a name of
     * three spaces used to pass that check and would now save as "".
     */
    style_name: capsName("Style name is required"),
    /**
     * CAPS, and the transform belongs HERE for the same reason `article_no`
     * below records: a season is a stored VALUE, and `SEASON_OPTIONS` being
     * capital only covers the four words a person can pick from the dropdown.
     * The column is plain `text` and takes free text from any other writer, so
     * the schema is what makes "summer" stored as "SUMMER" whatever the path.
     * Null and undefined still pass through — a style need not name a season.
     */
    season: capsTextNullable(),
    style_year: z.coerce.number().int().nullable().default(null),
    /** A stored value, so CAPS by the same rule as `style_name`. `nullableText`
     *  is the plain optional string it used to be; `capsTextNullable` is that
     *  with the transform, and it still passes null and undefined through. Not
     *  applied to the two DESCRIPTION fields beside it: free prose is exempt. */
    article_no: capsTextNullable(),
    style_category_id: uuidN,
    item_class_id: uuidN,
    style_description: nullableText,
    // `unit_id` (-> `uoms`, the Stock Unit master) withdrawn 2026-08-11
    // (client): ONE Unit field on this screen, and it is the Piece/Set one
    // below. The two were never the same question — `unit_id` names a stock
    // unit, `unit_kind` answers Piece-or-Set — but only `unit_kind` means
    // anything downstream: it caps the Coordinates grid and seeds the Garment
    // Order's Order Unit, while `unit_id` fed nothing.
    //
    // Absent from the SCHEMA, not just the form, for the same reason as
    // `country_id` and the seven that went on 08-10: `headerOnly(p.data)`
    // writes the parsed object, so a key left here with `.default(null)` would
    // blank the stored unit on every update. `garment_styles.unit_id` keeps its
    // column and its values, and `GarmentStyle.unit_id` above still reads them
    // back — the Garment Order's seeding is being moved onto `unit_kind`
    // separately, and until it is, an existing style's stored value still
    // resolves.
    /** Piece or Set. NULLABLE on purpose: every style predating 0392 has none,
     *  and rejecting those would make old records unsaveable. The FORM marks it
     *  required, so the backfill happens on next edit. */
    unit_kind: z.enum(["piece", "set"]).nullable().default(null),
    size_group_id: uuidN,
    // `country_id` withdrawn 2026-08-11 (client) — see the header note. Absent
    // from the schema, not just the form, for the same reason as the seven that
    // went on 08-10: `headerOnly(p.data)` writes the parsed object, so a key
    // left here with `.default(null)` would blank the stored country on every
    // update. The COLUMN and its values remain.
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
