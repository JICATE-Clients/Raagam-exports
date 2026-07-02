import "server-only";
import { createClient } from "@/lib/supabase/server";

/** Cross-opportunity register rows (read-only global views for the sidebar). */
export interface CostSheetRow {
  id: string;
  opportunity_id: string | null;
  version: number;
  status: string;
  created_at: string;
  opportunity_title: string | null;
  opportunity_code: string | null;
}
export interface QuoteRow {
  id: string;
  opportunity_id: string | null;
  fob_price: number;
  status: string;
  created_at: string;
  opportunity_title: string | null;
  opportunity_code: string | null;
}
export interface SampleRow {
  id: string;
  opportunity_id: string | null;
  type: string;
  status: string;
  created_at: string;
  opportunity_title: string | null;
  opportunity_code: string | null;
}

function oppField(row: Record<string, unknown>, field: string): string | null {
  const o = row.opportunities as Record<string, unknown> | null;
  return (o?.[field] as string | null) ?? null;
}

export async function listAllCostSheets(): Promise<CostSheetRow[]> {
  const s = await createClient();
  const { data } = await s
    .from("cost_sheets")
    .select("id, opportunity_id, version, status, created_at, opportunities(title, code)")
    .order("created_at", { ascending: false });
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: r.id as string,
    opportunity_id: (r.opportunity_id as string | null) ?? null,
    version: (r.version as number) ?? 1,
    status: (r.status as string) ?? "",
    created_at: r.created_at as string,
    opportunity_title: oppField(r, "title"),
    opportunity_code: oppField(r, "code"),
  }));
}

export async function listAllQuotes(): Promise<QuoteRow[]> {
  const s = await createClient();
  const { data } = await s
    .from("quotes")
    .select("id, opportunity_id, fob_price, status, created_at, opportunities(title, code)")
    .order("created_at", { ascending: false });
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: r.id as string,
    opportunity_id: (r.opportunity_id as string | null) ?? null,
    fob_price: (r.fob_price as number) ?? 0,
    status: (r.status as string) ?? "",
    created_at: r.created_at as string,
    opportunity_title: oppField(r, "title"),
    opportunity_code: oppField(r, "code"),
  }));
}

export async function listAllSamples(): Promise<SampleRow[]> {
  const s = await createClient();
  const { data } = await s
    .from("samples")
    .select("id, opportunity_id, type, status, created_at, opportunities(title, code)")
    .order("created_at", { ascending: false });
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: r.id as string,
    opportunity_id: (r.opportunity_id as string | null) ?? null,
    type: (r.type as string) ?? "",
    status: (r.status as string) ?? "",
    created_at: r.created_at as string,
    opportunity_title: oppField(r, "title"),
    opportunity_code: oppField(r, "code"),
  }));
}
