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
  created_at: string;
  updated_at: string;
  // embedded for display (port-service selects countries(id,code,name))
  country?: { id: string; code: string | null; name: string } | null;
}

export const portInput = z.object({
  short_name: z.string().optional().nullable(),
  name: z.string().optional().nullable(),
  country_id: z.string().uuid("Country is required"),
  port_type: z.enum(PORT_TYPES).nullable().default(null),
});
export type PortInput = z.infer<typeof portInput>;
