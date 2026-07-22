import "server-only";
import { createClient } from "@/lib/supabase/server";
import type {
  CountGroup,
  Construction,
  YarnPurchaseRate,
  YarnDebitRate,
  SizingRate,
  WarpLengthAllowance,
  ProcessSequence,
  ProcessSequenceGroup,
} from "./grid-master-types";

export async function listCountGroups(): Promise<CountGroup[]> {
  const s = await createClient();
  const { data } = await s
    .from("count_groups")
    .select("*, details:count_group_counts(*)")
    .order("code");
  return (data ?? []) as CountGroup[];
}

export async function listConstructions(): Promise<Construction[]> {
  const s = await createClient();
  const { data } = await s
    .from("constructions")
    .select("*, details:construction_counts(*)")
    .order("code");
  return (data ?? []) as Construction[];
}

export async function listYarnPurchaseRates(): Promise<YarnPurchaseRate[]> {
  const s = await createClient();
  const { data } = await s
    .from("yarn_purchase_rates")
    .select("*, details:yarn_purchase_rate_items(*)")
    .order("effective_from", { ascending: false });
  return (data ?? []) as YarnPurchaseRate[];
}

export async function listYarnDebitRates(): Promise<YarnDebitRate[]> {
  const s = await createClient();
  const { data } = await s
    .from("yarn_debit_rates")
    .select("*, details:yarn_debit_rate_items(*)")
    .order("effective_from", { ascending: false });
  return (data ?? []) as YarnDebitRate[];
}

export async function listSizingRates(): Promise<SizingRate[]> {
  const s = await createClient();
  const { data } = await s
    .from("sizing_rates")
    .select("*, details:sizing_rate_yarns(*)")
    .order("effective_from", { ascending: false });
  return (data ?? []) as SizingRate[];
}

export async function listWarpLengthAllowances(): Promise<WarpLengthAllowance[]> {
  const s = await createClient();
  const { data } = await s
    .from("warp_length_allowances")
    .select("*, details:warp_length_allowance_details(*)")
    .order("effective_from", { ascending: false });
  return (data ?? []) as WarpLengthAllowance[];
}

export async function listProcessSequences(): Promise<ProcessSequence[]> {
  const s = await createClient();
  const { data } = await s
    .from("process_sequences")
    .select("*, details:process_sequence_steps(*)")
    .order("code");
  return (data ?? []) as ProcessSequence[];
}

export async function listProcessSequenceGroups(): Promise<ProcessSequenceGroup[]> {
  const s = await createClient();
  const { data } = await s
    .from("process_sequence_groups")
    .select("*, details:process_sequence_group_members(*)")
    .order("code");
  return (data ?? []) as ProcessSequenceGroup[];
}
