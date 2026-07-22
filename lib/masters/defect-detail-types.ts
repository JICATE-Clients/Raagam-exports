import { z } from "zod";

// ============================================================================
// Defect Details — master (defect_details). Three-level hierarchy:
// category (defect_catg_id) → defect (defect_id) → detail (defect_det_id).
// Display code is auto-assembled as "catg.id.det". FK to defect_groups.
// ============================================================================
export interface DefectDetail {
  id: string;
  defect_catg_id: string;
  defect_id: string;
  defect_det_id: string;
  name: string;
  defect_group_id: string | null;
  defect_type: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  // embedded for display
  defect_group?: { id: string; name: string } | null;
}

export interface DefectGroup {
  id: string;
  name: string;
}

export const defectDetailInput = z.object({
  defect_catg_id: z.string().min(2, "Category ID must be at least 2 characters"),
  defect_id: z.string().min(2, "Defect ID must be at least 2 characters"),
  defect_det_id: z.string().min(2, "Detail ID must be at least 2 characters"),
  name: z.string().min(1, "Name is required"),
  defect_group_id: z.string().uuid().nullable().default(null),
  defect_type: z.string().optional().nullable(),
  is_active: z.boolean().default(true),
});
export type DefectDetailInput = z.infer<typeof defectDetailInput>;
