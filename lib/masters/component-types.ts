import { z } from "zod";
import { capsName, capsTextNullable } from "@/lib/validation/formats";

// ============================================================================
// Components — master-detail (0228). Legacy EDP2 "Component" form: header
// (Short Name req · Description · All Coordinates · Inactive) plus a
// "Coordinates" grid of free-text coordinate labels. Promoted from the flat
// config_lookups kind 'component'.
//
// THE SCREEN NOW ASKS FOR THE NAME AND NOTHING ELSE (client 2026-08-05, "remove
// the description field and maintain only name … and that check box"), which is
// the minimal-forms rule: a masters form asks for what the operator must decide,
// the legacy columns STAY and keep round-tripping. So `description`,
// `all_coordinates` and `coordinates` are OPTIONAL here and mean **"not sent =
// not changed"** — see the update action, which patches only the keys present.
//
// They are optional rather than defaulted, and the difference is load-bearing
// twice over. `coordinates: []` as a default would make every rename WIPE a
// component's coordinate list, silently, because the update replaces that grid
// wholesale. And `lib/data-io` inserts the PARSED object straight into the
// table (actions.ts), so a defaulted `coordinates: []` went to Postgres as a
// column that does not exist and failed every Components import — the defaults
// were reachable from two directions and wrong from both.
// ============================================================================
export interface ComponentCoordinate {
  id: string;
  component_id: string;
  sno: number;
  coordinate: string;
}
export interface Component {
  id: string;
  short_name: string;
  description: string | null;
  all_coordinates: boolean;
  inactive: boolean;
  created_at: string;
  updated_at: string;
  coordinates: ComponentCoordinate[];
}

export const componentCoordinateInput = z.object({
  sno: z.coerce.number().int().nonnegative().default(0),
  coordinate: z.string().min(1),
});
export const componentInput = z.object({
  // CAPS belongs in the schema, not only in the action: `lib/data-io` parses an
  // import with this same schema and writes straight to Postgres, so an
  // action-level toUpperCase misses every spreadsheet row (AGENTS.md, CAPITALS).
  short_name: capsName("Name is required"),
  description: capsTextNullable(),
  /** Absent = leave as it is. See the header note. */
  all_coordinates: z.boolean().optional(),
  inactive: z.boolean().default(false),
  /** Absent = leave the coordinate rows alone; `[]` CLEARS them. */
  coordinates: z.array(componentCoordinateInput).optional(),
});
export type ComponentInput = z.infer<typeof componentInput>;
