"use server";

import { requireUser } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import { getTimeline } from "./service";
import type { RunTimelineResult } from "./types";

/**
 * ONE RUN'S TIMELINE, fetched by the TAP on a status card (My Approvals ▸ My
 * requests / Decided) — an event, not an effect, and never for every card up front:
 * a phone list of forty requests would be forty round trips nobody looks at.
 *
 * `approval_timeline` reads the run's frozen `steps_snapshot`, so a flow edited
 * since shows the chain this request actually travelled. Actor ids become names
 * through `creator_names()` (SECURITY DEFINER), the one reader that can — a profile
 * row is readable only by its owner.
 */
export async function loadRunTimeline(runId: string): Promise<RunTimelineResult> {
  await requireUser();
  try {
    const rows = await getTimeline(runId);
    const ids = [...new Set(rows.map((r) => r.actor_id).filter((v): v is string => !!v))];
    const names: Record<string, string> = {};
    if (ids.length) {
      const s = await createClient();
      const { data } = await s.rpc("creator_names", { ids });
      for (const p of (data ?? []) as { id: string; full_name: string | null }[]) {
        if (p.full_name?.trim()) names[p.id] = p.full_name;
      }
    }
    return { ok: true, rows, names };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not load the approval history" };
  }
}
