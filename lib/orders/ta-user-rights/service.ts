import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { PickerItem } from "@/components/masters/record-picker";
import type { TaUserRight } from "./types";

export type ActivityRow = { id: string; short_name: string; name: string };

export type TaUserRightsFormData = {
  users: PickerItem[];
  activities: ActivityRow[];
};

/** User picker options + the activity rows for the matrix. */
export async function getTaUserRightsFormData(): Promise<TaUserRightsFormData> {
  const s = await createClient();
  const [userRes, actRes] = await Promise.all([
    s
      .from("profiles")
      .select("id, full_name, email, employee_code")
      .eq("is_active", true)
      .order("full_name"),
    s
      .from("ta_activities")
      .select("id, short_name, name")
      .eq("is_active", true)
      .order("name"),
  ]);

  const users: PickerItem[] = (
    (userRes.data ?? []) as {
      id: string;
      full_name: string | null;
      email: string | null;
      employee_code: string | null;
    }[]
  ).map((u) => ({
    id: u.id,
    code: u.employee_code,
    name: u.full_name ?? u.email ?? "User",
  }));

  return { users, activities: (actRes.data ?? []) as ActivityRow[] };
}

/** All rights rows (admin-only screen, small dataset) — client filters by user. */
export async function getAllTaUserRights(): Promise<TaUserRight[]> {
  const s = await createClient();
  const { data } = await s.from("ta_user_rights").select("*");
  return (data ?? []) as TaUserRight[];
}

export type TaUserRightsSummaryRow = {
  user_id: string;
  name: string;
  code: string | null;
  count: number;
};

/** Users who already have ≥1 rights row, for the "Configured users" list. */
export async function getTaUserRightsSummary(): Promise<TaUserRightsSummaryRow[]> {
  const s = await createClient();
  const { data } = await s
    .from("ta_user_rights")
    .select("user_id, user:profiles(id, full_name, email, employee_code)");

  const byUser = new Map<string, TaUserRightsSummaryRow>();
  for (const r of (data ?? []) as unknown as {
    user_id: string;
    user: {
      id: string;
      full_name: string | null;
      email: string | null;
      employee_code: string | null;
    } | null;
  }[]) {
    const existing = byUser.get(r.user_id);
    if (existing) {
      existing.count += 1;
    } else {
      byUser.set(r.user_id, {
        user_id: r.user_id,
        name: r.user?.full_name ?? r.user?.email ?? "User",
        code: r.user?.employee_code ?? null,
        count: 1,
      });
    }
  }
  return [...byUser.values()].sort((a, b) => a.name.localeCompare(b.name));
}
