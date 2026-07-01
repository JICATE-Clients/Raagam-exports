import "server-only";
import { createClient } from "@/lib/supabase/server";
import type {
  Opportunity,
  Style,
  CostSheet,
  CostSheetItem,
  Quote,
  Sample,
} from "@/lib/sales/types";
import type { Buyer, Uom } from "@/lib/masters/types";

// ---------------------------------------------------------------------------
// Extended types returned by service helpers
// ---------------------------------------------------------------------------

interface BuyerJoin {
  name: string;
  code: string;
}

type OpportunityJoinRow = Opportunity & { buyers: BuyerJoin | null };

export type OpportunityRow = Opportunity & {
  buyer_name: string | null;
  buyer_code: string | null;
};

export type CostSheetWithItems = CostSheet & {
  items: CostSheetItem[];
};

// ---------------------------------------------------------------------------
// Opportunities
// ---------------------------------------------------------------------------

export async function getOpportunities(): Promise<OpportunityRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("opportunities")
    .select("*, buyers!buyer_id(name, code)")
    .order("created_at", { ascending: false });

  return ((data ?? []) as OpportunityJoinRow[]).map(
    ({ buyers, ...opp }) => ({
      ...opp,
      buyer_name: buyers?.name ?? null,
      buyer_code: buyers?.code ?? null,
    }),
  );
}

export async function getOpportunity(
  id: string,
): Promise<OpportunityRow | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("opportunities")
    .select("*, buyers!buyer_id(name, code)")
    .eq("id", id)
    .maybeSingle();

  if (!data) return null;
  const { buyers, ...opp } = data as OpportunityJoinRow;
  return {
    ...opp,
    buyer_name: buyers?.name ?? null,
    buyer_code: buyers?.code ?? null,
  };
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

export async function getStyles(opportunityId: string): Promise<Style[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("styles")
    .select("*")
    .eq("opportunity_id", opportunityId)
    .order("created_at", { ascending: false });
  return (data ?? []) as Style[];
}

// ---------------------------------------------------------------------------
// Cost Sheets (with items)
// ---------------------------------------------------------------------------

export async function getCostSheets(
  opportunityId: string,
): Promise<CostSheetWithItems[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("cost_sheets")
    .select("*, cost_sheet_items(*)")
    .eq("opportunity_id", opportunityId)
    .order("version", { ascending: true });

  return ((data ?? []) as (CostSheet & { cost_sheet_items: CostSheetItem[] })[]).map(
    ({ cost_sheet_items, ...sheet }) => ({
      ...sheet,
      items: cost_sheet_items ?? [],
    }),
  );
}

// ---------------------------------------------------------------------------
// Quotes
// ---------------------------------------------------------------------------

export async function getQuotes(opportunityId: string): Promise<Quote[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("quotes")
    .select("*")
    .eq("opportunity_id", opportunityId)
    .order("created_at", { ascending: false });
  return (data ?? []) as Quote[];
}

// ---------------------------------------------------------------------------
// Samples
// ---------------------------------------------------------------------------

export async function getSamples(opportunityId: string): Promise<Sample[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("samples")
    .select("*")
    .eq("opportunity_id", opportunityId)
    .order("created_at", { ascending: false });
  return (data ?? []) as Sample[];
}

// ---------------------------------------------------------------------------
// Master lookups (needed by forms)
// ---------------------------------------------------------------------------

export async function getBuyers(): Promise<Buyer[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("buyers")
    .select("*")
    .eq("is_active", true)
    .order("name");
  return (data ?? []) as Buyer[];
}

export async function getUoms(): Promise<Uom[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("uoms")
    .select("id, code, name, is_active")
    .eq("is_active", true)
    .order("code");
  return (data ?? []) as Uom[];
}
