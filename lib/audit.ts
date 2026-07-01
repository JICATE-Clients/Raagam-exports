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
    const {
      data: { user },
    } = await supabase.auth.getUser();
    await supabase.from("audit_log").insert({
      user_id: user?.id ?? null,
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
