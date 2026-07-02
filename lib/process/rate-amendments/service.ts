import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { ProcessRateAmendment } from "./types";

export type RateAmendmentRow = ProcessRateAmendment & {
  process_rfqs: {
    id: string;
    code: string | null;
    process_type: string;
  } | null;
};

export type ConfirmedRfqOption = {
  id: string;
  code: string | null;
  process_type: string;
  confirmed_rate: number | null;
};

export async function getRateAmendments(): Promise<RateAmendmentRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("process_rate_amendments")
    .select("*, process_rfqs(id, code, process_type)")
    .order("created_at", { ascending: false });
  return (data ?? []) as unknown as RateAmendmentRow[];
}

export async function getConfirmedRfqs(): Promise<ConfirmedRfqOption[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("process_rfqs")
    .select("id, code, process_type, confirmed_rate")
    .eq("status", "confirmed")
    .order("created_at", { ascending: false });
  return (data ?? []) as ConfirmedRfqOption[];
}
