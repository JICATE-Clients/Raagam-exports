import "server-only";
import { createClient } from "@/lib/supabase/server";

// ============================================================================
// Simple master list functions — one per table.
// These match the actions in simple-master-actions.ts.
//
// `created_at` is selected on every one of them and shown by no column. It
// feeds the Created Date filter, which `useMasterFilter` offers only when the
// rows actually carry the value (lib/date-filter.ts) — so dropping it from a
// select here does not break a build or a type, it just silently removes the
// filter from that screen. Keep it in the list.
// ============================================================================

export async function listYarnCompositions() {
  const s = await createClient();
  const { data } = await s
    .from("yarn_compositions")
    .select("id, code, name, is_active, created_at")
    .order("code");
  return (data ?? []) as { id: string; code: string; name: string; is_active: boolean; created_at: string }[];
}

export async function listDefectGroupsSimple() {
  const s = await createClient();
  const { data } = await s
    .from("defect_groups")
    .select("id, code, name, is_active, created_at")
    .order("code");
  return (data ?? []) as { id: string; code: string; name: string; is_active: boolean; created_at: string }[];
}

// The seven other list functions that stood here — StyleStockCategory,
// SpecialInstruction, BeamType, Design, DomesticProductDesign, LabTestStandard
// and ProductType — went with their masters on 2026-08-01 (client: not
// applicable). Their tables are dropped in 0382, so leaving the queries behind
// would have left code pointing at tables that no longer exist.
