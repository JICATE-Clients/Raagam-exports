import { z } from "zod";
import { capsName } from "@/lib/validation/formats";

// ============================================================================
// Compositions — master-detail (0225). Legacy EDP2 "Composition" form: header
// (Item Class → config_lookups item_class) with a "Mixing" grid naming the
// fibres the fabric is made of + their mixing %.
//
// The fibre stopped being free text in 0384: a line names a CATEGORY of the
// YARN item class. `description` stays and stays populated — it is the fallback
// for rows entered before that, and the screen mirrors the picked category's
// name into it so one column is always readable.
// ============================================================================
export interface CompositionLine {
  id: string;
  composition_id: string;
  sno: number;
  /** YARN-class `categories` row this line names. Null on pre-0384 rows. */
  category_id: string | null;
  /** The fibre name as text — mirrors the category on rows saved since 0384,
   *  and is the only value pre-0384 rows have. Never blank on a saved line. */
  description: string;
  mixing_pct: number;
}
export interface Composition {
  id: string;
  item_class_id: string;
  short_name: string | null;
  name: string | null;
  inactive: boolean;
  created_at: string;
  updated_at: string;
  lines: CompositionLine[];
}

export const compositionLineInput = z.object({
  sno: z.coerce.number().int().nonnegative().default(0),
  category_id: z.string().uuid().nullable().default(null),
  // NOT `.min(1)`: a line that names a category is a real line, and requiring
  // the mirrored text as well would let one un-mirrored name fail the whole
  // save. normalizeLines() drops a line carrying neither.
  description: z.string().default(""),
  mixing_pct: z.coerce.number().min(0).default(0),
});
export const compositionInput = z.object({
  item_class_id: z.string().uuid("Item Class is required"),
  short_name: z.string().optional().nullable(),
  // MANDATORY: `name` is what every picker shows and what the operator chooses a
  // composition by — a nameless row is unusable wherever it appears. The screen
  // has always declared `required` on it; this is the half that also holds for
  // `lib/data-io` imports, which never reach the screen.
  // `capsName`, not `capsTextNullable`: same CAPS transform, blank refused.
  name: capsName("Name is required"),
  inactive: z.boolean().default(false),
  lines: z.array(compositionLineInput).default([]),
});
export type CompositionInput = z.infer<typeof compositionInput>;
