import "server-only";
import { cache } from "react";
import { createAdminClient, createClient } from "@/lib/supabase/server";

/**
 * HR PHOTOS IN PULSE (user 2026-11-03: "fetch HR module profile image to Pulse").
 *
 * ## ONE "WHICH STAFF ROW IS THIS LOGIN" RULE — `findMyStaff`'s
 *
 * A login resolves to its HR ▸ Staff record exactly as `findMyStaff` in
 * `lib/hr/my-profile.ts` resolves the caller (that one feeds the sidebar dock's
 * photo), so Pulse and the dock can never show two different faces:
 *
 *   1. `profiles.email` (trimmed) = `staff.email`, case-folded (findMyStaff: `ilike`, escaped);
 *   2. else `profiles.employee_code` (trimmed) = `staff.code`, EXACT case (findMyStaff: `eq`).
 *
 * Only an email/code that matches NO staff row falls through — a matched row
 * without a photo is the initials, exactly as in the sidebar.
 *
 * The ROW is chosen first and its photo read second. Filtering to rows that HAVE
 * a photo before matching would let a login whose email row has no photo fall
 * through to a code row that does — a face the sidebar never shows, and quite
 * possibly somebody else's.
 *
 * ## WHY THE SERVICE ROLE
 *
 * `staff` is gated on hr_payroll:view, which a chat member does not hold. ONLY
 * `userId → photo_url` leaves this function (a public URL in the
 * `employee-photos` bucket, 0336 / 0557) — no salary, ID or contact detail.
 * The caller is already past `communication:view`.
 *
 * Read in pages: PostgREST returns at most 1000 rows per request
 * (`db-max-rows`, see `lib/hr/punch-read.ts`), so a single `.limit(5000)` was a
 * silent truncation. `cache()` makes it one pass per request.
 *
 * Never throws: a missing photo is the initials, not a broken Pulse.
 */

const PAGE = 1000;

type StaffRow = { code: string | null; email: string | null; photo_url: string | null };
type ProfileRow = { id: string; email: string | null; employee_code: string | null };

async function readAll<T>(read: (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await read(from, from + PAGE - 1);
    if (error) throw error;
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

export const getUserPhotos = cache(async (): Promise<Record<string, string>> => {
  try {
    const s = createAdminClient();
    const [staff, profiles] = await Promise.all([
      readAll<StaffRow>((a, b) => s.from("staff").select("code, email, photo_url").order("id").range(a, b)),
      readAll<ProfileRow>((a, b) => s.from("profiles").select("id, email, employee_code").order("id").range(a, b)),
    ]);

    // First row wins on a duplicate key, as `limit(1)` does in findMyStaff.
    const byEmail = new Map<string, StaffRow>();
    const byCode = new Map<string, StaffRow>();
    for (const r of staff) {
      // The stored column is compared as stored (no trim) — `ilike` / `eq` do not trim it either.
      const email = r.email?.toLowerCase();
      const code = r.code;
      if (email && !byEmail.has(email)) byEmail.set(email, r);
      if (code && !byCode.has(code)) byCode.set(code, r);
    }

    const out: Record<string, string> = {};
    for (const p of profiles) {
      const email = p.email?.trim().toLowerCase();
      const code = p.employee_code?.trim();
      const row = (email && byEmail.get(email)) || (code && byCode.get(code)) || null;
      const url = row?.photo_url?.trim();
      if (url) out[p.id] = url;
    }
    return out;
  } catch {
    return {};
  }
});

/** 0839: the public bucket that holds channel profile photos. */
export const CHANNEL_PHOTO_BUCKET = "comm-channel-photos";

/**
 * CHANNEL PHOTOS (user 2026-11-12, artifact "Channel Photo Upload"):
 * conversationId → public URL, for the channels the CALLER may read (the
 * table's own RLS decides — this runs as the caller, not the service role).
 * Read beside comm_my_conversations rather than through it, so 0839 did not
 * have to re-create that function. Never throws: before 0839 is applied the
 * column is missing and every channel shows its letter, as before.
 */
export const getChannelPhotos = cache(async (): Promise<Record<string, string>> => {
  try {
    const s = await createClient();
    const out: Record<string, string> = {};
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await s
        .from("comm_conversations")
        .select("id, photo_path")
        .eq("kind", "channel")
        .not("photo_path", "is", null)
        .order("id")
        .range(from, from + PAGE - 1);
      if (error) return out;
      const rows = (data ?? []) as { id: string; photo_path: string | null }[];
      for (const r of rows) {
        if (r.photo_path) out[r.id] = s.storage.from(CHANNEL_PHOTO_BUCKET).getPublicUrl(r.photo_path).data.publicUrl;
      }
      if (rows.length < PAGE) return out;
    }
  } catch {
    return {};
  }
});
