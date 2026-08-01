"use server";

// Thin server action wrapping the shared on-save duplicate guard so screens can
// validate a name in real time (as the user types). The authoritative check is
// still the on-submit guard inside each create/update action — this only powers
// the inline "already exists" hint. See lib/masters/dup-guard.ts.

import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { checkDuplicateName } from "@/lib/masters/dup-guard";

export async function checkDuplicate(
  table: string,
  name: string,
  opts: {
    nameColumn?: string;
    excludeId?: string;
    scope?: Record<string, string | null>;
    label?: string;
  } = {},
  // `kind` is carried through deliberately: only a real `"duplicate"` may hold
  // the cursor on the field. dup-guard.ts is `server-only`, so the type is
  // restated here rather than imported — a client component reading the result
  // cannot pull it from there.
): Promise<{ ok: true } | { ok: false; kind: "duplicate" | "failed"; error: string }> {
  // Gate on read permission; if forbidden, stay silent (the on-save guard is authoritative).
  if (!(await can("masters", "view"))) return { ok: true };
  const s = await createClient();
  return checkDuplicateName(s, table, name, opts);
}
