import "server-only";
import { createClient } from "@/lib/supabase/server";
import { withCreators } from "@/lib/created-by";

// ============================================================================
// Simple master list functions — one per table.
// These match the actions in simple-master-actions.ts.
//
// `created_at` AND `created_by` are selected on every one of them, and the pair
// is spliced in by `SimpleMasterScreen` itself. Neither is shown by a column
// declared here, which is exactly why they are easy to drop: removing either
// breaks no build and no type, it just silently empties something on screen —
// `created_at` takes the Created Date filter with it (`useMasterFilter` offers
// the facet only when the rows carry the value), and `created_by` leaves the
// Created User column a run of dashes, because `withCreators()` can only
// resolve a uuid the query actually fetched. Keep both in the list.
// ============================================================================

export async function listDefectGroupsSimple() {
  const s = await createClient();
  const { data } = await s
    .from("defect_groups")
    .select("id, code, name, is_active, created_at, created_by")
    .order("code");
  return withCreators(
    (data ?? []) as {
      id: string;
      code: string;
      name: string;
      is_active: boolean;
      created_at: string;
      created_by: string | null;
    }[],
  );
}

// The seven other list functions that stood here — StyleStockCategory,
// SpecialInstruction, BeamType, Design, DomesticProductDesign, LabTestStandard
// and ProductType — went with their masters on 2026-08-01 (client: not
// applicable). Their tables are dropped in 0382, so leaving the queries behind
// would have left code pointing at tables that no longer exist.
