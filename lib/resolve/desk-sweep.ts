import "server-only";
import { createAdminClient } from "@/lib/supabase/server";
import { drainOutbox } from "./outbox";

/**
 * The `resolve-desk` job (service-desk-plan §3): `rh_sd_sweep()` stamps the
 * Service Desk clocks — response and resolution breaches, the 80 % warning,
 * the stale reminder and escalation, and the auto-close of a resolved request
 * nobody confirmed — and writes one activity row per event (and so the outbox
 * rows). Each stamp makes a second run a no-op. Then the outbox is drained so
 * a breach is heard now rather than at the next `resolve-outbox` tick.
 */
export async function sweepResolveDesk(): Promise<{
  response_breached: number;
  resolution_breached: number;
  warned: number;
  stale_reminded: number;
  stale_escalated: number;
  auto_closed: number;
  sent: number;
  skipped: number;
  failed: number;
  error?: string;
}> {
  const { data, error } = await createAdminClient().rpc("rh_sd_sweep");
  const r = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
  const counts = {
    response_breached: Number(r?.response_breached) || 0,
    resolution_breached: Number(r?.resolution_breached) || 0,
    warned: Number(r?.warned) || 0,
    stale_reminded: Number(r?.stale_reminded) || 0,
    stale_escalated: Number(r?.stale_escalated) || 0,
    auto_closed: Number(r?.auto_closed) || 0,
  };
  if (error) return { ...counts, sent: 0, skipped: 0, failed: 0, error: `Service desk sweep: ${error.message}` };
  const d = await drainOutbox({ limit: 500 });
  return { ...counts, sent: d.sent, skipped: d.skipped, failed: d.failed, ...(d.error ? { error: d.error } : {}) };
}
