import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { SqDetail, SqGroup, SqDetailNote, SqCancellation, SqPack, SqQuantity } from "./sq-types";

export type SqDetailRow = SqDetail & {
  buyer_name: string | null;
  opportunity_code: string | null;
};

export async function listSqDetails(): Promise<SqDetailRow[]> {
  const s = await createClient();
  const { data } = await s
    .from("sq_details")
    .select("*, buyers:customer_id(name), opportunities(code)")
    .order("created_at", { ascending: false });
  return ((data ?? []) as unknown[]).map((r: unknown) => {
    const row = r as Record<string, unknown>;
    return {
      ...row,
      buyer_name: (row.buyers as { name: string } | null)?.name ?? null,
      opportunity_code: (row.opportunities as { code: string } | null)?.code ?? null,
    } as unknown as SqDetailRow;
  });
}

export async function getSqDetail(id: string): Promise<SqDetail | null> {
  const s = await createClient();
  const { data } = await s.from("sq_details").select("*").eq("id", id).maybeSingle();
  return data as SqDetail | null;
}

export async function getSqPacks(sqDetailId: string): Promise<SqPack[]> {
  const s = await createClient();
  const { data } = await s.from("sq_packs").select("*").eq("sq_detail_id", sqDetailId).order("sno");
  return (data ?? []) as SqPack[];
}

export async function getSqQuantities(sqDetailId: string): Promise<SqQuantity[]> {
  const s = await createClient();
  const { data } = await s.from("sq_quantities").select("*").eq("sq_detail_id", sqDetailId).order("sno");
  return (data ?? []) as SqQuantity[];
}

export async function listSqGroups(): Promise<SqGroup[]> {
  const s = await createClient();
  const { data } = await s.from("sq_groups").select("*").order("created_at", { ascending: false });
  return (data ?? []) as SqGroup[];
}

export async function listSqDetailNotes(sqDetailId: string): Promise<SqDetailNote[]> {
  const s = await createClient();
  const { data } = await s.from("sq_detail_notes").select("*").eq("sq_detail_id", sqDetailId).order("entry_date", { ascending: false });
  return (data ?? []) as SqDetailNote[];
}

export async function listSqCancellations(): Promise<SqCancellation[]> {
  const s = await createClient();
  const { data } = await s.from("sq_cancellations").select("*").order("created_at", { ascending: false });
  return (data ?? []) as SqCancellation[];
}
