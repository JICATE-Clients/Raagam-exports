import "server-only";
import { createAdminClient } from "@/lib/supabase/server";
import { drainOutbox } from "./outbox";

/**
 * The `resolve-escalation` job (plan §5): `rh_escalation_sweep()` decides who
 * hears about which overdue job and writes the activity rows (and so the
 * outbox rows); `rh_escalations`' unique (ticket, level, fix_round) makes a
 * second run a no-op. Then the outbox is drained so the alerts go now rather
 * than at the next five-minute tick.
 */
export async function sweepResolveEscalation(): Promise<{
  level1: number;
  level3: number;
  level7: number;
  digests: number;
  sent: number;
  skipped: number;
  failed: number;
  error?: string;
}> {
  const { data, error } = await createAdminClient().rpc("rh_escalation_sweep");
  const r = (Array.isArray(data) ? data[0] : data) as { level1?: number; level3?: number; level7?: number; digests?: number } | null;
  const counts = { level1: Number(r?.level1) || 0, level3: Number(r?.level3) || 0, level7: Number(r?.level7) || 0,
    digests: Number(r?.digests) || 0,
  };
  if (error) return { ...counts, sent: 0, skipped: 0, failed: 0, error: `Escalation sweep: ${error.message}` };
  const d = await drainOutbox({ limit: 500 });
  return { ...counts, sent: d.sent, skipped: d.skipped, failed: d.failed, ...(d.error ? { error: d.error } : {}) };
}
