import "server-only";
import { createClient } from "@/lib/supabase/server";
import { withCreators } from "@/lib/created-by";
import { listPlanApprovals } from "@/lib/sales/plan-reports/service";
import type { PlanKind } from "@/lib/sales/plan-reports/types";
import { planRevisionStatusOf, type PlanRevisionRow } from "./types";

/**
 * EVERY SAMPLE PLAN REVISION at this unit (RLS: the log follows its plan,
 * 0718 / 0720) — one row per plan revision, in ENTRY order, each carrying its
 * plan's SWO facts and the status read off the plan (./types.ts).
 *
 * The plan facts come from `listPlanApprovals`, the register Plan Approval
 * itself reads, so an SWO number, season or SMP list can never read one way
 * here and another there.
 */
export async function listPlanRevisions(): Promise<PlanRevisionRow[]> {
  const s = await createClient();
  const cols = "id, entry_id, bom_id, revision_no, reason, origin, raised_at, abandoned_at, abandon_reason, created_at, created_by";
  const [plans, fab, acc] = await Promise.all([
    listPlanApprovals(),
    s.from("iwo_fabric_bom_revisions").select(cols),
    s.from("iwo_material_bom_revisions").select(cols),
  ]);
  // A FAILED QUERY IS AN ERROR, NOT AN EMPTY REGISTER (AGENTS.md).
  if (fab.error) throw new Error(`Could not read the Fabric Plan revisions: ${fab.error.message}`);
  if (acc.error) throw new Error(`Could not read the Accessories Plan revisions: ${acc.error.message}`);

  type Rev = {
    id: string;
    entry_id: string;
    bom_id: string;
    revision_no: number;
    reason: string;
    origin: string | null;
    raised_at: string;
    abandoned_at: string | null;
    abandon_reason: string | null;
    created_at: string;
    created_by: string | null;
  };
  const planOf = new Map(plans.map((p) => [p.key, p]));
  const rows: PlanRevisionRow[] = [];
  const add = (kind: PlanKind, revs: Rev[]) => {
    for (const r of revs) {
      const p = planOf.get(`${kind}:${r.bom_id}`);
      // A plan this unit cannot see, or no longer a sample plan: not listed.
      if (!p) continue;
      rows.push({
        id: r.id,
        entryId: r.entry_id,
        kind,
        bomId: r.bom_id,
        iwoId: p.iwoId,
        swoCode: p.swoCode,
        iwoCode: p.iwoCode,
        season: p.season,
        smpNos: p.smpNos,
        revisionNo: r.revision_no,
        reason: r.reason,
        origin: r.origin,
        raisedAt: r.raised_at,
        status: planRevisionStatusOf(r, p),
        planStatus: p.status,
        planRevisionNo: p.revisionNo,
        abandonedAt: r.abandoned_at,
        abandonReason: r.abandon_reason,
        created_at: r.created_at,
        created_by: r.created_by,
      });
    }
  };
  add("fabric", (fab.data ?? []) as unknown as Rev[]);
  add("accessories", (acc.data ?? []) as unknown as Rev[]);
  // LISTED IN ENTRY ORDER — oldest raise first; within one raise, Fabric first.
  rows.sort((a, b) => a.created_at.localeCompare(b.created_at) || (a.kind === b.kind ? 0 : a.kind === "fabric" ? -1 : 1));
  return withCreators(rows);
}

/** One revision entry — the plan revisions one raise made, Fabric first. Empty = not found here. */
export async function getPlanRevisionEntry(entryId: string): Promise<PlanRevisionRow[]> {
  return (await listPlanRevisions()).filter((r) => r.entryId === entryId);
}
