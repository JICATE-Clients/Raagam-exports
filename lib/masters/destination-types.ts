import { z } from "zod";

// ============================================================================
// Destinations — Associates master (0233). Legacy EDP2 "Destination" form:
// Short Name · Country (required, → countries) · Name · Inactive.
// ============================================================================
export interface Destination {
  id: string;
  short_name: string | null;
  country_id: string;
  name: string | null;
  inactive: boolean;
  created_at: string;
  updated_at: string;
}

export const destinationInput = z.object({
  short_name: z.string().optional().nullable(),
  country_id: z.string().uuid("Country is required"),
  // MANDATORY, same shape as Port above: Country was insisted on, the name it is
  // chosen by was not.
  name: z.string().trim().min(1, "Name is required"),
  inactive: z.boolean().default(false),
});
export type DestinationInput = z.infer<typeof destinationInput>;
