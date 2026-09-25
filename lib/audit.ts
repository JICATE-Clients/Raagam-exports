import "server-only";
import { after } from "next/server";
import { createClient } from "@/lib/supabase/server";

type AuditEntry = {
  action: string;
  entityType?: string;
  entityId?: string;
  locationId?: string | null;
  metadata?: Record<string, unknown>;
};

async function insertAudit(entry: AuditEntry) {
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

/**
 * Append an audit-trail entry for the current user. Best-effort (never throws).
 *
 * WRITTEN AFTER THE RESPONSE (`after()`, 2026-09-25, "saving and approving are
 * slow"). ~59 files await this as the last step of a save, and its insert is
 * one more ~260 ms round trip the operator sat through for a row they never
 * read. It was already best-effort — its failure never changed the save's
 * answer — so nothing waited on it for a REASON. `after()` in a Server Action
 * or Route Handler may still read cookies (next/dist/docs after.md), so the
 * row keeps its user. Outside a request scope (a script) `after` throws, and
 * the entry is simply written inline as before.
 *
 * Callers keep `await writeAudit(...)`: it now resolves at once.
 */
export async function writeAudit(entry: AuditEntry) {
  try {
    after(() => insertAudit(entry));
  } catch {
    await insertAudit(entry);
  }
}
