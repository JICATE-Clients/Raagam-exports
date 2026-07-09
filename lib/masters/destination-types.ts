import { z } from "zod";

// ============================================================================
// Destinations — Associates master (0233). Legacy EDP2 "Destination" form:
// Short Name · Country (required, → countries) · Name · Blocked.
// ============================================================================
export interface Destination {
  id: string;
  short_name: string | null;
  country_id: string;
  name: string | null;
  blocked: boolean;
  created_at: string;
  updated_at: string;
}

export const destinationInput = z.object({
  short_name: z.string().optional().nullable(),
  country_id: z.string().uuid("Country is required"),
  name: z.string().optional().nullable(),
  blocked: z.boolean().default(false),
});
export type DestinationInput = z.infer<typeof destinationInput>;
