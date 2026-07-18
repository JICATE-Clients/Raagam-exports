import "server-only";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import type {
  Opportunity,
  Style,
  StyleCombo,
  StyleSize,
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

/** A style row enriched with its enquiry (opportunity), customer and unit —
 *  the flat register behind the "Define Styles — By Enquiry No." screen. */
export type StyleRegisterRow = Style & {
  enquiry_code: string | null;
  enquiry_date: string;
  season: string | null;
  buyer_name: string | null;
  buyer_code: string | null;
  unit_code: string | null;
};

type StyleJoinRow = Style & {
  opportunities:
    | (Pick<Opportunity, "code" | "created_at" | "season"> & {
        buyers: BuyerJoin | null;
      })
    | null;
  uoms: { code: string } | null;
};

export async function listAllStyles(): Promise<StyleRegisterRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("styles")
    .select(
      "*, opportunities!inner(code, created_at, season, buyers!buyer_id(name, code)), uoms(code)",
    )
    .order("created_at", { ascending: false });

  return ((data ?? []) as StyleJoinRow[]).map(
    ({ opportunities, uoms, ...style }) => ({
      ...style,
      enquiry_code: opportunities?.code ?? null,
      enquiry_date: opportunities?.created_at ?? style.created_at,
      season: opportunities?.season ?? null,
      buyer_name: opportunities?.buyers?.name ?? null,
      buyer_code: opportunities?.buyers?.code ?? null,
      unit_code: uoms?.code ?? null,
    }),
  );
}

// ---------------------------------------------------------------------------
// Cost Sheets (with items)
// ---------------------------------------------------------------------------

/** A cost sheet enriched with its enquiry (opportunity), customer and style —
 *  the flat register behind the "Prepare Product Cost Sheet — By Enquiry" screen. */
export type CostSheetRegisterRow = CostSheet & {
  enquiry_code: string | null;
  enquiry_date: string;
  season: string | null;
  buyer_name: string | null;
  style_name: string | null;
  style_code: string | null;
};

type CostSheetJoinRow = CostSheet & {
  opportunities:
    | (Pick<Opportunity, "code" | "created_at" | "season"> & {
        buyers: { name: string } | null;
      })
    | null;
  styles: { name: string; style_code: string | null } | null;
};

export async function listAllCostSheetsForRegister(): Promise<
  CostSheetRegisterRow[]
> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("cost_sheets")
    .select(
      "*, opportunities!inner(code, created_at, season, buyers!buyer_id(name)), styles(name, style_code)",
    )
    .order("created_at", { ascending: false });

  return ((data ?? []) as CostSheetJoinRow[]).map(
    ({ opportunities, styles, ...cs }) => ({
      ...cs,
      enquiry_code: opportunities?.code ?? null,
      enquiry_date: opportunities?.created_at ?? cs.created_at,
      season: opportunities?.season ?? null,
      buyer_name: opportunities?.buyers?.name ?? null,
      style_name: styles?.name ?? null,
      style_code: styles?.style_code ?? null,
    }),
  );
}

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

/** A quote enriched for the "Confirm Quotes" grid (buyer + style + costing). */
export type QuoteConfirmRow = Quote & {
  buyer_name: string | null;
  style_code: string | null;
  cost_version: number | null;
};

/** All quotes across opportunities, with display context, for the Confirm Quotes grid. */
export async function listQuotesForConfirmation(): Promise<QuoteConfirmRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("quotes")
    .select(
      "*, buyers(name), cost_sheets(version, styles(style_code)), opportunities(id, title)",
    )
    .order("created_at", { ascending: false });

  return ((data ?? []) as unknown as (Quote & {
    buyers: { name: string | null } | null;
    cost_sheets: { version: number | null; styles: { style_code: string | null } | null } | null;
  })[]).map((q) => ({
    ...q,
    buyer_name: q.buyers?.name ?? null,
    style_code: q.cost_sheets?.styles?.style_code ?? null,
    cost_version: q.cost_sheets?.version ?? null,
  }));
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

/** A sample enriched with its enquiry (opportunity), customer, style and unit —
 *  the flat register behind the "Samples — By Sample No." screen. */
export type SampleRegisterRow = Sample & {
  enquiry_code: string | null;
  season: string | null;
  buyer_name: string | null;
  style_name: string | null;
  style_code: string | null;
  unit_code: string | null;
};

type SampleJoinRow = Sample & {
  opportunities:
    | (Pick<Opportunity, "code" | "season"> & { buyers: { name: string } | null })
    | null;
  styles: { name: string; style_code: string | null } | null;
  uoms: { code: string } | null;
};

export async function listAllSamplesForRegister(): Promise<SampleRegisterRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("samples")
    .select(
      "*, opportunities!inner(code, season, buyers!buyer_id(name)), styles(name, style_code), uoms(code)",
    )
    .order("created_at", { ascending: false });

  return ((data ?? []) as SampleJoinRow[]).map(
    ({ opportunities, styles, uoms, ...sample }) => ({
      ...sample,
      enquiry_code: opportunities?.code ?? null,
      season: opportunities?.season ?? null,
      buyer_name: opportunities?.buyers?.name ?? null,
      style_name: styles?.name ?? null,
      style_code: styles?.style_code ?? null,
      unit_code: uoms?.code ?? null,
    }),
  );
}

// ---------------------------------------------------------------------------
// Product Development requests (Sales view of Planning's pd_requests)
// ---------------------------------------------------------------------------

/** A PD request as seen from Sales, enriched with enquiry/customer/style/unit.
 *  Read via the admin client so sales-only users (no `planning:view`) can see
 *  the requests they raise. */
export interface SalesPdRequestRow {
  id: string;
  code: string | null;
  opportunity_id: string | null;
  title: string;
  description: string | null;
  stage: string;
  status: string;
  created_at: string;
  sample_type: string | null;
  sample_qty: number | null;
  delivery_date: string | null;
  customer_reference: string | null;
  enquiry_code: string | null;
  buyer_name: string | null;
  style_name: string | null;
  style_code: string | null;
  unit_code: string | null;
}

function nested(row: Record<string, unknown>, rel: string, field: string): string | null {
  const o = row[rel] as Record<string, unknown> | null;
  return (o?.[field] as string | null) ?? null;
}

export async function listSalesPdRequests(): Promise<SalesPdRequestRow[]> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("pd_requests")
    .select(
      "*, opportunities(code), buyers(name), styles(name, style_code), uoms(code)",
    )
    .order("created_at", { ascending: false });

  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: r.id as string,
    code: (r.code as string | null) ?? null,
    opportunity_id: (r.opportunity_id as string | null) ?? null,
    title: (r.title as string) ?? "",
    description: (r.description as string | null) ?? null,
    stage: (r.stage as string) ?? "",
    status: (r.status as string) ?? "",
    created_at: r.created_at as string,
    sample_type: (r.sample_type as string | null) ?? null,
    sample_qty: (r.sample_qty as number | null) ?? null,
    delivery_date: (r.delivery_date as string | null) ?? null,
    customer_reference: (r.customer_reference as string | null) ?? null,
    enquiry_code: nested(r, "opportunities", "code"),
    buyer_name: nested(r, "buyers", "name"),
    style_name: nested(r, "styles", "name"),
    style_code: nested(r, "styles", "style_code"),
    unit_code: nested(r, "uoms", "code"),
  }));
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

// ---------------------------------------------------------------------------
// Brands & Seasons (for Market Enquiry pickers)
// ---------------------------------------------------------------------------

export type BrandOption = { id: string; brand_name: string; brand_short_name: string | null };
export type SeasonOption = { id: string; season: string; season_yr: string | null; season_name: string | null };

export async function getBrands(): Promise<BrandOption[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("brands")
    .select("id, brand_name, brand_short_name")
    .eq("blocked", false)
    .order("brand_name");
  return (data ?? []) as BrandOption[];
}

export async function getSeasons(): Promise<SeasonOption[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("seasons")
    .select("id, season, season_yr, season_name")
    .eq("blocked", false)
    .order("season_name");
  return (data ?? []) as SeasonOption[];
}

// ---------------------------------------------------------------------------
// Style Combos & Sizes (child grids)
// ---------------------------------------------------------------------------

export async function getStyleCombos(styleId: string): Promise<StyleCombo[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("style_combos")
    .select("*, style_combo_sizes(*)")
    .eq("style_id", styleId)
    .order("sno");
  return ((data ?? []) as (StyleCombo & { style_combo_sizes: StyleCombo["sizes"] })[]).map(
    ({ style_combo_sizes, ...combo }) => ({
      ...combo,
      sizes: [...(style_combo_sizes ?? [])].sort((a, b) => a.sno - b.sno),
    }),
  );
}

export async function getStyleSizes(styleId: string): Promise<StyleSize[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("style_sizes")
    .select("*")
    .eq("style_id", styleId)
    .order("sno");
  return (data ?? []) as StyleSize[];
}
