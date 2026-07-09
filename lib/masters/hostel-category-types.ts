import { z } from "zod";

// ============================================================================
// Hostel Categories — HR master (0256). Legacy EDP2 "Hostel Category" form: the
// simplest master — Code (manual, optional) · Name (required) · Blocked.
// ============================================================================
export interface HostelCategory {
  id: string;
  code: string | null;
  name: string;
  blocked: boolean;
  created_at: string;
  updated_at: string;
}

export const hostelCategoryInput = z.object({
  code: z.string().optional().nullable(),
  name: z.string().min(1, "Name is required"),
  blocked: z.boolean().default(false),
});
export type HostelCategoryInput = z.infer<typeof hostelCategoryInput>;
