import "server-only";
import { cache } from "react";
import { getAppUser } from "@/lib/auth/server";
import { createAdminClient } from "@/lib/supabase/server";

/**
 * WHO "MINE" IS, for a module overview's Mine · Everyone switch (plan
 * https://claude.ai/artifact/5e8SGWe8DPHC7Ua2fQyaiW, rule 2: "my work first").
 *
 * Two identities, because the modules record ownership two ways:
 *   - `profileId` — the login. A PO is the purchaser's by `created_by`.
 *   - `staffId`   — the HR staff row. An order is the merchandiser's by
 *     `merchandiser_id`, which points at `staff`.
 *
 * WHY THE PRIVILEGED CLIENT. `staff` is readable only with HR access in the
 * current unit (`staff_read`), and a merchandiser usually has neither, so their
 * own session cannot find their own staff row. This reads exactly one thing —
 * the id of the staff row carrying the caller's OWN login email (or employee
 * code) — and returns nothing else, so no one learns anything about anybody.
 * `user.myStaffId` is not reused: it is resolved only for logins with HR access
 * (see `lib/auth/self-service.ts`), which is the case that does not need it.
 *
 * Null when the login has no staff row: such a person owns no orders, and the
 * overview opens on Everyone.
 */
export const myIdentity = cache(async (): Promise<{ profileId: string | null; staffId: string | null }> => {
  const user = await getAppUser();
  if (!user) return { profileId: null, staffId: null };
  const email = user.email?.trim().toLowerCase() || null;
  if (!email) return { profileId: user.id, staffId: null };
  const admin = createAdminClient();
  // `ilike` for case only — the wildcards are escaped, so an address is never a pattern.
  const safe = email.replace(/[\\%_]/g, (c) => `\\${c}`);
  const { data } = await admin
    .from("staff")
    .select("id")
    .ilike("email", safe)
    .eq("is_active", true)
    .limit(1);
  const staffId = ((data ?? []) as { id: string }[])[0]?.id ?? null;
  return { profileId: user.id, staffId };
});
