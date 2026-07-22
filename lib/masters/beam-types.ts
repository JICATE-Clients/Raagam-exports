import { z } from "zod";

// ============================================================================
// Beams — master (beams). location_type: O=Own, P=Party.
// vendor_id is only required/used when location_type='P'.
// ============================================================================
export const LOCATION_TYPES = ["O", "P"] as const;
export type LocationType = (typeof LOCATION_TYPES)[number];

export interface Beam {
  id: string;
  beam_no: string;
  tare_wt: number | null;
  loom_type: string | null;
  location_type: LocationType | null;
  vendor_id: string | null;
  flange_width: number | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  // embedded for display
  vendor?: { id: string; name: string } | null;
}

export interface BeamVendorOption {
  id: string;
  name: string;
}

export const beamInput = z.object({
  beam_no: z.string().min(1, "Beam No is required"),
  tare_wt: z.coerce.number().min(0, "Tare weight must be 0 or greater").nullable().default(null),
  loom_type: z.string().optional().nullable(),
  location_type: z.enum(LOCATION_TYPES).nullable().default(null),
  vendor_id: z.string().uuid().nullable().default(null),
  flange_width: z.coerce.number().min(0, "Flange width must be 0 or greater").nullable().default(null),
  is_active: z.boolean().default(true),
});
export type BeamInput = z.infer<typeof beamInput>;
