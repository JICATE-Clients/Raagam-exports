import { z } from "zod";

// ============================================================================
// Holidays — HR master (0256). Legacy EDP2 "Holiday" form: auto Entry No · Date
// · category (National/Festival/Others) · Holiday name · Type (Paid Holiday/LOP)
// · Date Range checkbox + holiday date (single, or from→to). Flat header master.
// ============================================================================

export const HOLIDAY_CATEGORIES = ["National", "Festival", "Others"] as const;
export const HOLIDAY_PAY_TYPES = ["Paid Holiday", "LOP"] as const;
export type HolidayCategory = (typeof HOLIDAY_CATEGORIES)[number];
export type HolidayPayType = (typeof HOLIDAY_PAY_TYPES)[number];

export interface Holiday {
  id: string;
  entry_no: number;
  entry_date: string;
  category: HolidayCategory | null;
  name: string;
  pay_type: HolidayPayType | null;
  is_date_range: boolean;
  holiday_date: string;
  end_date: string | null;
  created_at: string;
  updated_at: string;
}

export const holidayInput = z.object({
  entry_date: z.string().min(1, "Date is required"),
  category: z.enum(HOLIDAY_CATEGORIES).nullable().default(null),
  name: z.string().min(1, "Holiday name is required"),
  pay_type: z.enum(HOLIDAY_PAY_TYPES).nullable().default(null),
  is_date_range: z.boolean().default(false),
  holiday_date: z.string().min(1, "Holiday date is required"),
  end_date: z.string().optional().nullable(),
});
export type HolidayInput = z.infer<typeof holidayInput>;
