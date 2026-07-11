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

/** Colour cards for a single customer (buyer), newest first. */
export async function getColorCardsForBuyer(
  buyerId: string,
): Promise<ColorCardWithBuyer[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("color_cards")
    .select("*, buyers(id, name), color_card_colors(count)")
    .eq("buyer_id", buyerId)
    .order("created_at", { ascending: false });

  return ((data ?? []) as unknown as (ColorCard & {
    buyers: Pick<Buyer, "id" | "name"> | null;
    color_card_colors: { count: number }[];
  })[]).map((c) => ({
    ...c,
    color_count: c.color_card_colors?.[0]?.count ?? 0,
  }));
}

/** One customer (buyer) summary row for the "By Customer" landing grid. */
export type CustomerCardSummary = Pick<Buyer, "id" | "code" | "name" | "country"> & {
  card_count: number;
};

export type Customer = Pick<Buyer, "id" | "code" | "name" | "country">;

/** A single customer (buyer) header for the per-customer colour-cards page. */
export async function getCustomer(buyerId: string): Promise<Customer | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("buyers")
    .select("id, code, name, country")
    .eq("id", buyerId)
    .maybeSingle();
  return (data ?? null) as Customer | null;
}

/**
 * All active customers with their colour-card count for the landing grid.
 * Customers with zero cards are still returned (mirrors the legacy screen).
 */
export async function getCustomersWithCardCounts(): Promise<CustomerCardSummary[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("buyers")
    .select("id, code, name, country, color_cards(count)")
    .eq("is_active", true)
    .order("name");

  return ((data ?? []) as unknown as (Pick<
    Buyer,
    "id" | "code" | "name" | "country"
  > & { color_cards: { count: number }[] })[]).map((b) => ({
    id: b.id,
    code: b.code,
    name: b.name,
    country: b.country,
    card_count: b.color_cards?.[0]?.count ?? 0,
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
