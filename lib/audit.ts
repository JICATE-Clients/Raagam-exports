import "server-only";
import { createClient } from "@/lib/supabase/server";

/** Append an audit-trail entry for the current user. Best-effort (never throws). */
export async function writeAudit(entry: {
  action: string;
  entityType?: string;
  entityId?: string;
  locationId?: string | null;
  metadata?: Record<string, unknown>;
}) {
  try {
    const supabase = await createClient();
    /* getClaims(), not getUser(): the id is read from the JWT verified locally
       (ES256), not by a round trip to Supabase Auth — this runs at the end of
       nearly every save, so that trip was paid on every one (2026-09-24). */
    const { data } = await supabase.auth.getClaims();
    await supabase.from("audit_log").insert({
      user_id: data?.claims?.sub ?? null,
      action: entry.action,
      entity_type: entry.entityType ?? null,
      entity_id: entry.entityId ?? null,
      location_id: entry.locationId ?? null,
      metadata: entry.metadata ?? {},
    });
  } catch {
    // auditing must never break the main operation
  }
}
