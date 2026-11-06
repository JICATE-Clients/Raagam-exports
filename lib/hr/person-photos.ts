"use server";

import { can } from "@/lib/auth/server";
import { createAdminClient } from "@/lib/supabase/server";

/**
 * EVERY PERSON'S PHOTO, ONCE — "staff:<id>" / "worker:<id>" → photo URL
 * (user 2026-11-06: "wherever we pick the name it should come with the profile
 * picture"). `PersonAvatar` reads this map so a list or a picker draws a face
 * from the person's id alone, without each HR service selecting the column.
 *
 * Service role, like `lib/comms/photos.ts`: an HOD or a self-service employee
 * reads no staff rows but the people they are shown still have faces. ONLY
 * id → photo URL leaves here (a public URL in the `employee-photos` bucket,
 * 0336 / 0557) — no name, salary, ID or contact detail — and only to someone
 * already inside HR (hr_payroll:view). Never throws: no photos is initials.
 */
export async function loadPersonPhotos(): Promise<Record<string, string>> {
  try {
    if (!(await can("hr_payroll", "view"))) return {};
    const s = createAdminClient();
    const out: Record<string, string> = {};
    for (const [table, kind] of [["staff", "staff"], ["workers", "worker"]] as const) {
      // Paged: PostgREST returns at most 1000 rows a request.
      for (let from = 0; ; from += 1000) {
        const { data, error } = await s
          .from(table)
          .select("id, photo_url")
          .not("photo_url", "is", null)
          .order("id")
          .range(from, from + 999);
        if (error) break;
        const rows = (data ?? []) as { id: string; photo_url: string | null }[];
        for (const r of rows) {
          const url = r.photo_url?.trim();
          if (url) out[`${kind}:${r.id}`] = url;
        }
        if (rows.length < 1000) break;
      }
    }
    return out;
  } catch {
    return {};
  }
}
