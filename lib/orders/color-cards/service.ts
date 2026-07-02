import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { ColorCard, ColorCardColor } from "./types";
import type { Buyer } from "@/lib/masters/types";

export type ColorCardWithBuyer = ColorCard & {
  buyers: Pick<Buyer, "id" | "name"> | null;
  color_count: number;
};

/** All colour cards with buyer + colour count for the list view. */
export async function getColorCards(): Promise<ColorCardWithBuyer[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("color_cards")
    .select("*, buyers(id, name), color_card_colors(count)")
    .order("created_at", { ascending: false });

  return ((data ?? []) as unknown as (ColorCard & {
    buyers: Pick<Buyer, "id" | "name"> | null;
    color_card_colors: { count: number }[];
  })[]).map((c) => ({
    ...c,
    color_count: c.color_card_colors?.[0]?.count ?? 0,
  }));
}

export type ColorCardDetail = ColorCard & {
  buyers: Pick<Buyer, "id" | "name"> | null;
};

export async function getColorCard(id: string): Promise<ColorCardDetail | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("color_cards")
    .select("*, buyers(id, name)")
    .eq("id", id)
    .single();
  return (data ?? null) as unknown as ColorCardDetail | null;
}

export async function getColorCardColors(
  cardId: string,
): Promise<ColorCardColor[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("color_card_colors")
    .select("*")
    .eq("color_card_id", cardId)
    .order("sort_order");
  return (data ?? []) as ColorCardColor[];
}
