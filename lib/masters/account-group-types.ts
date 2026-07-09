import { z } from "zod";

// ============================================================================
// Account Groups — Associates master (0244). Legacy EDP2 "Account Group" form
// (chart-of-accounts groups): Under (self-ref parent) · Blocked · Short Name ·
// Name (required) · Nature of Group · Debit Schedule · Credit Schedule. The two
// Schedule fields point at config_lookups kind 'account_schedule'.
// ============================================================================
export const NATURE_OF_GROUP = ["ASSETS", "LIABILITIES", "INCOME", "EXPENSES"] as const;
export type NatureOfGroup = (typeof NATURE_OF_GROUP)[number];

export interface AccountGroup {
  id: string;
  parent_id: string | null;
  short_name: string | null;
  name: string;
  nature_of_group: NatureOfGroup | null;
  debit_schedule_id: string | null;
  credit_schedule_id: string | null;
  blocked: boolean;
  created_at: string;
  updated_at: string;
}

export const accountGroupInput = z.object({
  parent_id: z.string().uuid().nullable().default(null),
  short_name: z.string().optional().nullable(),
  name: z.string().min(1, "Name is required"),
  nature_of_group: z.enum(NATURE_OF_GROUP).nullable().default(null),
  debit_schedule_id: z.string().uuid().nullable().default(null),
  credit_schedule_id: z.string().uuid().nullable().default(null),
  blocked: z.boolean().default(false),
});
export type AccountGroupInput = z.infer<typeof accountGroupInput>;
