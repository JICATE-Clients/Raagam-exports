import { z } from "zod";

// ============================================================================
// Ports — Associates master (0233). Legacy EDP2 "Port" form: Short Name · Name ·
// Country (req → countries FK via the ⓘ picker) · Type (Air/Sea/Sea-Air).
// ============================================================================
export const PORT_TYPES = ["Air", "Sea", "Sea/Air"] as const;
export type PortType = (typeof PORT_TYPES)[number];

export interface Port {
  id: string;
  short_name: string | null;
  name: string | null;
  country_id: string;
  port_type: PortType | null;
  /** true = switched off. 0547; see the note on `portInput.inactive`. */
  inactive: boolean;
  created_at: string;
  updated_at: string;
  // embedded for display (port-service selects countries(id,code,name))
  country?: { id: string; code: string | null; name: string } | null;
}

export const portInput = z.object({
  short_name: z.string().optional().nullable(),
  // MANDATORY: the schema already insisted on the Country that scopes a port but
  // not on the name the operator picks it by, so a nameless port could be saved
  // and would then sit blank in every shipping dropdown. The screen has always
  // declared `required`; this half also covers `lib/data-io` imports.
  name: z.string().trim().min(1, "Name is required"),
  country_id: z.string().uuid("Country is required"),
  port_type: z.enum(PORT_TYPES).nullable().default(null),
  /**
   * Switched off — not offered in any port dropdown (AGENTS.md "Disabled rows").
   *
   * NOT TYPED ON THIS SCREEN. It is the listing's Status switch, which writes
   * through `setMasterActive` and never comes near this schema (client
   * 2026-08-17: the block control lives in the row action, "no more in the
   * creating screen"). It is here because `updatePort` sends the WHOLE record:
   * without the field, editing a blocked port's name would switch it back on,
   * and `lib/data-io` would have no way to express the state at all.
   *
   * `.default(false)` is therefore load-bearing in one direction only — a create
   * omits it and gets an active port. An UPDATE must pass the record's stored
   * value, which is why the screen keeps `inactive` in its form state and round-
   * trips it untouched.
   */
  inactive: z.boolean().default(false),
});
export type PortInput = z.infer<typeof portInput>;
