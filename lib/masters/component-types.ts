import { z } from "zod";

// ============================================================================
// Components — master-detail (0228). Legacy EDP2 "Component" form: header
// (Short Name req · Description · All Coordinates · Blocked) plus a
// "Coordinates" grid of free-text coordinate labels. Promoted from the flat
// config_lookups kind 'component'.
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
  blocked: boolean;
  created_at: string;
  updated_at: string;
  coordinates: ComponentCoordinate[];
}

export const componentCoordinateInput = z.object({
  sno: z.coerce.number().int().nonnegative().default(0),
  coordinate: z.string().min(1),
});
export const componentInput = z.object({
  short_name: z.string().min(1, "Short Name is required"),
  description: z.string().optional().nullable(),
  all_coordinates: z.boolean().default(true),
  blocked: z.boolean().default(false),
  coordinates: z.array(componentCoordinateInput).default([]),
});
export type ComponentInput = z.infer<typeof componentInput>;
