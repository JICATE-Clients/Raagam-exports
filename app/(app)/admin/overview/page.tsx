import { requirePermission } from "@/lib/auth/server";
import { createAdminClient } from "@/lib/supabase/server";
import { NAV } from "@/components/shell/nav";
import { JOBS, type JobKey } from "@/lib/jobs/registry";
import { listJobRuns } from "@/lib/jobs/service";
import { adminOverview, type JobRow, type LoginRow } from "@/lib/overview/admin";
import { asOfNow } from "@/lib/overview/words";
import { NeedsDoing, Strip, VizCard } from "@/components/viz/kit";
import { LoadError } from "@/components/analytics/board-ui";
import { MoreLinks, OverviewHeader, Say } from "@/components/overview/frame";
import { AccessMap, type AccessModule, type AccessRole } from "@/components/overview/access-map";

/**
 * ADMINISTRATION ▸ OVERVIEW — "Who can get in, and is the system running?" (wave 2,
 * 2026-11-06; plan https://claude.ai/artifact/5e8SGWe8DPHC7Ua2fQyaiW). Replaces the redirect to
 * Users (2026-10-01), which stays the first screen in the sidebar.
 *
 * WHY THE PRIVILEGED CLIENT. Logins, staff and role holders are read exactly as the Users screen
 * reads them (`app/(app)/admin/users/page.tsx`): `profiles_read_own` lets a session see only its
 * own profile, so counting logins needs the service role — and only AFTER the
 * `system_admin:view` check below, which is the same gate Users stands behind. Scheduled Jobs
 * reads through the person's own session (0677's policy). No Mine · Everyone switch: nothing
 * here belongs to one person.
 */
export default async function AdminOverviewPage() {
  await requirePermission("system_admin", "view");
  const asOf = asOfNow();
  const header = <OverviewHeader title="Administration" question="Who can get in, and is the system running?" who={null} mine={0} everyone={0} asOf={asOf} />;

  const admin = createAdminClient();
  const [profiles, staff, roles, grants, held, jobsRes] = await Promise.all([
    admin.from("profiles").select("id, email, employee_code, is_active, is_super_admin, must_change_password"),
    admin.from("staff").select("code, email, is_active, blocked"),
    admin.from("roles").select("id, name").order("name"),
    admin.from("role_permissions").select("role_id, permission:permissions!permission_id(module, action)"),
    admin.from("user_roles").select("user_id, role_id"),
    listJobRuns().then((r) => ({ ok: true as const, r })).catch((e: unknown) => ({ ok: false as const, message: e instanceof Error ? e.message : String(e) })),
  ]);
  const failed = [profiles, staff, roles, grants, held].find((x) => x.error);
  if (failed?.error) {
    return (
      <div className="space-y-3">
        {header}
        <LoadError message={failed.error.message} />
      </div>
    );
  }

  type P = { id: string; email: string | null; employee_code: string | null; is_active: boolean | null; is_super_admin: boolean | null; must_change_password: boolean | null };
  const ps = (profiles.data ?? []) as P[];
  const logins: LoginRow[] = ps.map((p) => ({ id: p.id, active: p.is_active !== false, tempPassword: p.must_change_password === true, superAdmin: p.is_super_admin === true }));

  /* Staff with no email cannot be given a login; staff with one but no login yet can. A login
     belongs to a staff row by email or by staff code — the Users screen's own pairing. */
  const emails = new Set(ps.map((p) => p.email?.trim().toLowerCase()).filter(Boolean));
  const codes = new Set(ps.map((p) => p.employee_code?.trim().toLowerCase()).filter(Boolean));
  type S = { code: string | null; email: string | null; is_active: boolean | null; blocked: boolean | null };
  const live = ((staff.data ?? []) as S[]).filter((x) => x.is_active !== false && !x.blocked);
  const staffNoEmail = live.filter((x) => !x.email?.trim()).length;
  const staffNoLogin = live.filter((x) => x.email?.trim() && !emails.has(x.email.trim().toLowerCase()) && !codes.has((x.code ?? "").trim().toLowerCase())).length;

  const jobs: JobRow[] = jobsRes.ok
    ? (Object.keys(JOBS) as JobKey[]).map((k) => ({ key: k, label: JOBS[k].label, health: jobsRes.r.health[k] ?? "never" }))
    : [];

  /* The access map: module grain (`<module>:view`), people = active logins holding the role. */
  const activeIds = new Set(ps.filter((p) => p.is_active !== false).map((p) => p.id));
  const grantMap = new Map<string, Set<string>>();
  for (const g of (grants.data ?? []) as unknown as { role_id: string; permission: { module: string; action: string } | null }[]) {
    if (g.permission?.action !== "view") continue;
    grantMap.set(g.role_id, (grantMap.get(g.role_id) ?? new Set<string>()).add(g.permission.module));
  }
  const holders = new Map<string, Set<string>>();
  for (const h of (held.data ?? []) as { user_id: string; role_id: string }[]) {
    if (!activeIds.has(h.user_id)) continue;
    holders.set(h.role_id, (holders.get(h.role_id) ?? new Set<string>()).add(h.user_id));
  }
  const accessRoles: AccessRole[] = ((roles.data ?? []) as { id: string; name: string }[])
    .map((r) => ({ id: r.id, name: r.name, users: holders.get(r.id)?.size ?? 0, all: r.name === "Super Admin", grants: grantMap.get(r.id) ?? new Set<string>() }))
    .sort((a, b) => Number(b.all) - Number(a.all) || b.users - a.users || a.name.localeCompare(b.name));
  // One column per module on the rail (hidden ones too are still modules a role can open — but the
  // rail is what the operator recognises, so it is the rail's list, in the rail's order).
  const seen = new Set<string>();
  const modules: AccessModule[] = NAV.filter((n) => !n.hidden && n.module && n.module !== "dashboard")
    .filter((n) => (seen.has(n.module) ? false : (seen.add(n.module), true)))
    .map((n) => ({ key: n.module, label: n.label }));

  const o = adminOverview({ logins, staffNoEmail, staffNoLogin, jobs });

  return (
    <div className="space-y-2.5">
      {header}
      <Say lines={o.say} />
      <Strip compact cells={o.strip} />
      <VizCard title="Who can open what?" question="Roles down the side, modules across · a filled dot opens the module · People = active logins holding the role">
        <AccessMap roles={accessRoles} modules={modules} />
        <p className="px-3.5 pb-3 text-[11.5px] text-muted-foreground">
          Module level only: a role narrowed screen by screen still shows the module as open. The exact screens are on Roles &amp; Permissions.
        </p>
      </VizCard>
      {!jobsRes.ok ? <LoadError message={`Scheduled jobs: ${jobsRes.message}`} /> : null}
      <NeedsDoing compact cells={o.needs} />
      <MoreLinks
        links={[
          { href: "/admin/users", label: "Users" },
          { href: "/admin/access-control", label: "Roles & Permissions" },
          { href: "/admin/jobs", label: "Scheduled Jobs" },
        ]}
      />
    </div>
  );
}
