import { z } from "zod";

export const COLOR_CARD_STATUSES = ["active", "archived"] as const;
export type ColorCardStatus = (typeof COLOR_CARD_STATUSES)[number];

export interface ColorCard {
  id: string;
  code: string | null;
  buyer_id: string;
  name: string;
  season: string | null;
  status: ColorCardStatus;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ColorCardColor {
  id: string;
  color_card_id: string;
  name: string;
  code: string | null;
  hex: string | null;
  sort_order: number;
  created_at: string;
}

// Optional hex swatch: "" / null → null; otherwise must be #RGB or #RRGGBB.
const hexColor = z.preprocess(
  (v) => (v === "" || v == null ? null : v),
  z
    .string()
    .regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, "Use a hex colour like #1B2A4A")
    .nullable(),
);

export const colorRowInput = z.object({
  name: z.string().min(1, "Colour name required"),
  code: z.string().optional().nullable(),
  hex: hexColor,
  sort_order: z.coerce.number().int().nonnegative().default(0),
});
export type ColorRowInput = z.infer<typeof colorRowInput>;

export const colorCardInput = z.object({
  buyer_id: z.string().uuid("Select a buyer"),
  name: z.string().min(1, "Card name required"),
  season: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  colors: z.array(colorRowInput).default([]),
});
export type ColorCardInput = z.infer<typeof colorCardInput>;

export function colorCardStatusTone(
  status: ColorCardStatus,
): "success" | "neutral" {
  return status === "active" ? "success" : "neutral";
}
