import "server-only";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";

/**
 * The Reports-side read of `staff_ta_kpi()` (0547) — one function this file
 * calls, never a hand-written aggregate over `garment_order_amendment_ta_
 * activities`. See the migration's own header for why the score is computed
 * on demand rather than kept in a stored monthly snapshot: nothing here can
 * fall out of sync with the rows it reads, because it never keeps a copy.
 *
 * `p_staff_id: null` is what lets ONE call answer both shapes this report
 * needs — "my own row" for an ordinary operator, "the whole team" for a
 * viewer who holds `orders:export` — because the RPC itself, not this
 * wrapper, is what decides which one a given caller gets. Duplicating that
 * decision here would be a second copy of a permission rule the database
 * already enforces with `SECURITY DEFINER`.
 */
export type StaffKpiRow = {
  staffId: string;
  staffName: string;
  totalAssigned: number;
  stillOpen: number;
  completedOnTime: number;
  completedLate: number;
  buyerAttributedDelays: number;
  /** null = nothing completed in range yet — a provisional, not a failing, score. */
  onTimeScorePercentage: number | null;
  /** null = nothing completed LATE in range — there is no lag to average. */
  avgDelayDays: number | null;
};

type RpcRow = {
  staff_id: string;
  staff_name: string;
  total_assigned: number;
  still_open: number;
  completed_on_time: number;
  completed_late: number;
  buyer_attributed_delays: number;
  on_time_score_percentage: number | null;
  avg_delay_days: number | null;
};

function fromRpc(r: RpcRow): StaffKpiRow {
  return {
    staffId: r.staff_id,
    staffName: r.staff_name,
    totalAssigned: r.total_assigned,
    stillOpen: r.still_open,
    completedOnTime: r.completed_on_time,
    completedLate: r.completed_late,
    buyerAttributedDelays: r.buyer_attributed_delays,
    onTimeScorePercentage: r.on_time_score_percentage,
    avgDelayDays: r.avg_delay_days,
  };
}

/**
 * Every staff member's KPI in range, if the caller holds `orders:export` —
 * otherwise the caller's own row only, per `staff_ta_kpi`'s own rule. Never
 * throws on the "narrowed to just me" outcome; that is the honest answer for
 * an ordinary operator, not an error.
 */
export async function listStaffTaKpi(from: string, to: string): Promise<StaffKpiRow[]> {
  const sb = await createClient();
  const { data, error } = await sb.rpc("staff_ta_kpi", { p_from: from, p_to: to });
  if (error) throw new Error(error.message);
  return ((data ?? []) as RpcRow[]).map(fromRpc);
}

/**
 * ONE staff member's KPI, always — for the badge on the T&A Worklist, which
 * must show the SIGNED-IN OPERATOR'S OWN figure regardless of whether they
 * personally hold `orders:export`. Passing `staffId` explicitly (never
 * `null`) is what pins that: a manager viewing their own worklist would
 * otherwise get the "everyone" shape back, because `orders:export` is
 * exactly the permission that unlocks it.
 */
export async function getMyStaffTaKpi(
  staffId: string,
  from: string,
  to: string,
): Promise<StaffKpiRow | null> {
  const sb = await createClient();
  const { data, error } = await sb.rpc("staff_ta_kpi", {
    p_from: from,
    p_to: to,
    p_staff_id: staffId,
  });
  if (error) throw new Error(error.message);
  const row = ((data ?? []) as RpcRow[])[0];
  return row ? fromRpc(row) : null;
}

/** `orders:export` — whether this login sees every staff member's figure or only their own. */
export async function canSeeTeamKpi(): Promise<boolean> {
  return can("orders", "export");
}
