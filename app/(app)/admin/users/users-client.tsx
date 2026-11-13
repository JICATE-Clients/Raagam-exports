"use client";

import { useMemo, useState, useTransition } from "react";
import { FilterBar } from "@/components/ui/filter-bar";
import { useFacetFilter } from "@/components/ui/filter-drawer";
import { useQuickStatus } from "@/components/orders/bom-queue";
import { userFacets, userSearchText, userWord } from "./users-filters";
import { CircleAlert, Mail, Pencil, ShieldCheck } from "lucide-react";
import { SelectionBar } from "@/components/ui/selection-bar";
import { useRowSelection } from "@/lib/data-io/use-row-selection";
import { useRouter } from "next/navigation";
import { RowIconAction } from "@/components/ui/row-actions";
import { Tooltip } from "@/components/ui/tooltip";
import type { ProfileRow, UserRoleEntry, RoleOption, UserRow } from "./page";
import { DataTable } from "@/components/ui/data-table";
import type { Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import { StatusToggle } from "@/components/ui/status-toggle";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { setLoginActive } from "@/lib/users/actions";
import { withCreatedColumns } from "@/components/ui/created-columns";
import { Truncated } from "@/components/ui/truncated";
import type { AccessLocation, AccessUser } from "@/lib/permissions/service";
import type { PermissionTree as PermissionTreeT } from "@/lib/permissions/effective";
import type { Action, Module } from "@/lib/auth/types";
import { PersonAccessSheet } from "./person-access-sheet";
import { InviteSheet } from "./invite-sheet";

/**
 * USERS = HR ▸ STAFF (user 2026-09-30, screenshot 3143; the source moved
 * from the Employee master to the `staff` table the same day). There is
 * no "+ New User": every employee is already a row, and **Send welcome mail**
 * on that row creates their login (if they have none) and emails the
 * application link, their email and a temporary password. The Status switch
 * turns a login on or off; there is no eye — everything a row has is on it.
 *
 * Created Date / User are the LOGIN's (`created_at` off its profile) — blank
 * on an employee who has no login yet.
 */
type Delivery = { email: string; emailed: boolean; emailProblem?: string; tempPassword?: string };

function DeliveryNote({ result, onClose }: { result: Delivery; onClose: () => void }) {
  return (
    <div
      role="status"
      className={`rounded-md border px-3 py-2 text-sm ${result.emailed ? "border-success/40 bg-success/10" : "border-warning/40 bg-warning/10"}`}
    >
      {result.emailed ? (
        <p>
          Sign-in details emailed to <strong>{result.email}</strong>. They will choose their own password at first sign-in.
        </p>
      ) : (
        <div className="space-y-1">
          <p>{result.emailProblem}</p>
          {result.tempPassword && (
            <p>
              Give <strong>{result.email}</strong> this temporary password yourself — it is shown only now:{" "}
              <code className="rounded bg-surface px-1.5 py-0.5 font-mono text-base font-semibold">{result.tempPassword}</code>
            </p>
          )}
        </div>
      )}
      <div className="mt-1 flex justify-end">
        <Button type="button" size="sm" variant="ghost" onClick={onClose}>
          Dismiss
        </Button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Root export                                                          */
/* ------------------------------------------------------------------ */

export default function UsersClient({
  rows,
  userRoles,
  roles,
  meId,
  access,
  canEdit,
  initialEmail,
}: {
  rows: UserRow[];
  userRoles: UserRoleEntry[];
  roles: RoleOption[];
  meId: string;
  /** Each person's units and extra screens, keyed by email (2026-11-13 merge). */
  access: {
    users: AccessUser[];
    locations: AccessLocation[];
    offered: Partial<Record<Module, Action[]>>;
    /** Each role's tree by role id — the editor's "Can open" summary. */
    roleTrees: Record<string, PermissionTreeT>;
  };
  canEdit: boolean;
  /** `?user=<email>` — an old User Permissions link opens that person's editor. */
  initialEmail: string | null;
}) {
  const router = useRouter();
  const [delivery, setDelivery] = useState<Delivery | null>(null);
  const [busy, startBusy] = useTransition();
  /* THE INVITE SHEET (user 2026-11-13: "if we invite user should with role and
     unit") — the rows being invited, by key; null when shut. */
  /* `mail: false` is the bulk "Give role & unit": the same sheet, saved without a mail. */
  const [invite, setInvite] = useState<{ keys: string[]; mail: boolean; skipped: string[] } | null>(null);
  const { success, error: toastError } = useToast();

  /* BULK (user 2026-09-30: "select check box in front … for bulk setting the
     data") — ticked rows, keyed by `UserRow.key`, and the Assign-role sheet. */
  const sel = useRowSelection();
  /* THE PERSON EDITOR (2026-11-13) — the row whose roles, units and extra
     screens are open. A key, not a copy: after a save `router.refresh()` hands
     new rows down, and the editor must read them, not a snapshot. */
  const [editingKey, setEditingKey] = useState<string | null>(() =>
    initialEmail ? (rows.find((r) => r.email?.trim().toLowerCase() === initialEmail)?.key ?? null) : null,
  );
  const [origin, setOrigin] = useState<DOMRect | null>(null);

  function openEditor(r: UserRow) {
    /* `RowIconAction` hands no event over; the clicked icon is the focused
       element, so the sheet still grows out of it. */
    const el = document.activeElement;
    setOrigin(el instanceof HTMLElement ? el.getBoundingClientRect() : null);
    setEditingKey(r.key);
  }

  /** A person's email access — as stored, or blank when it was never set up
   *  (the same shape `loadAccessControl` gives an access-only row). Null when
   *  HR holds no email: units and extra screens are keyed on it. */
  const accessByEmail = useMemo(() => new Map(access.users.map((u) => [u.email, u])), [access.users]);
  function accessOf(r: UserRow): AccessUser | null {
    const email = r.email?.trim().toLowerCase();
    if (!email) return null;
    const stored = accessByEmail.get(email);
    if (stored) return stored;
    return {
      id: r.profile?.id ?? `email:${email}`,
      email,
      full_name: r.name,
      employee_code: r.code,
      is_active: r.profile?.is_active ?? false,
      is_super_admin: r.profile?.is_super_admin ?? false,
      has_login: !!r.profile,
      roles: [],
      access: null,
      tree: {},
      blocks: [],
    };
  }

  /**
   * SEND WELCOME MAIL = INVITE (user 2026-11-13). The ✉ no longer mails on the
   * click: it opens `InviteSheet`, which asks for role(s) and unit(s) first and
   * then makes the login, gives them, and mails. The bulk button opens the same
   * sheet for every ticked row it can invite.
   */
  function openInvite(list: UserRow[], mail = true, skipped: string[] = []) {
    const el = document.activeElement;
    setOrigin(el instanceof HTMLElement ? el.getBoundingClientRect() : null);
    setInvite({ keys: list.map((r) => r.key), mail, skipped });
  }

  /**
   * SAY WHO AND WHY (user 2026-11-13: "None of the 1 selected can take a role
   * — no email in HR, or super admin — why this error is coming"). The old
   * toast named two possible reasons for everyone at once and no person. Each
   * skipped row now carries its own reason, by name: the toast when nobody is
   * left, a line inside the sheet when some are.
   */
  function splitBulk(why: (r: UserRow) => string | null) {
    const todo: UserRow[] = [];
    const skipped: string[] = [];
    for (const r of selectedRows) {
      const w = why(r);
      if (w) skipped.push(`${r.name ?? r.email ?? "Someone"} — ${w}`);
      else todo.push(r);
    }
    return { todo, skipped };
  }
  const listed = (lines: string[]) =>
    lines.length <= 3 ? lines.join("; ") : `${lines.slice(0, 3).join("; ")}; and ${lines.length - 3} more`;

  function setStatus(p: ProfileRow, active: boolean) {
    startBusy(async () => {
      const res = await setLoginActive(p.id, active);
      if (!res.ok) {
        toastError(res.error);
        return;
      }
      success(active ? "Login switched on." : "Login switched off — they can no longer sign in.");
      router.refresh();
    });
  }

  const rolesByUser: Record<string, UserRoleEntry[]> = {};
  for (const ur of userRoles) (rolesByUser[ur.user_id] ??= []).push(ur);

  /* THE GLOBAL FILTER DRAWER (user 2026-09-30) — facets in `users-filters.tsx`,
     the same FilterBar + useFacetFilter pair every Orders list uses, plus a
     search over name, employee code, email, phone and role. */
  const facetGroups = useMemo(() => userFacets(rows, userRoles), [rows, userRoles]);
  const facets = useFacetFilter(rows, facetGroups);
  const [search, setSearch] = useState("");
  const q = search.trim().toLowerCase();
  /* The list with search + Filters applied and the box's own word left off —
     what the box counts over, so each figure is what clicking it would show. */
  const base = rows.filter((r) => facets.matches(r) && (!q || userSearchText(r, userRoles).includes(q)));
  /* THE PENDING · UPDATED BOX, exactly as Order Entry draws it (user
     2026-09-30) — `userWord` says what each word means here. */
  // Updated first and opened on (user 2026-10-01: "the updated tab first, next pending").
  const quick = useQuickStatus(userWord, { draft: false, countRows: base, updatedFirst: true });
  const filtered = base.filter(quick.matches);
  const selectedRows = rows.filter((r) => sel.selectedKeys.has(r.key));
  const editing = editingKey ? (rows.find((r) => r.key === editingKey) ?? null) : null;

  /* Bulk welcome mail goes ONLY to people with no login yet or still on a
     temporary password. For someone who chose their own password a resend
     REPLACES it — the single row asks twice for that; a bulk button would
     do it to many at once, so it does not do it at all. */
  const inviteWhy = (r: UserRow): string | null =>
    mailBlocked(r) ??
    (r.profile && !r.profile.must_change_password ? "already signed in with their own password" : null);
  const bulkMail = () => {
    const { todo, skipped } = splitBulk(inviteWhy);
    if (todo.length === 0) {
      toastError(`Can't invite: ${listed(skipped)}.`);
      return;
    }
    openInvite(todo, true, skipped);
  };
  /* GIVE ROLE & UNIT TO MANY (user 2026-11-13, screenshot 4148). Replaces
     "Assign role" (one dropdown, no unit) and drops "Login on / Login off",
     which only repeated each row's Status switch. Opens the Invite sheet
     without the mail: roles and units added to each ticked person, a login
     made quietly where they have none (a role hangs off one). */
  const giveWhy = (r: UserRow): string | null => {
    if (r.profile?.is_super_admin) return "super admin, already has every screen and unit";
    if (!r.email) return "no email in HR & Payroll \u25b8 People \u25b8 Staff, so no login can be made";
    if (!r.profile && !r.staffId) return "not in HR & Payroll \u25b8 People \u25b8 Staff";
    return null;
  };
  const bulkGive = () => {
    const { todo, skipped } = splitBulk(giveWhy);
    if (todo.length === 0) {
      toastError(`Can't give a role: ${listed(skipped)}.`);
      return;
    }
    openInvite(todo, false, skipped);
  };

  /* THE REDESIGN (user-approved canvas, 2026-09-30) — one fixed set of columns
     on Pending, Updated and All, so switching the box never re-lays the table;
     every cell one line of height except a role list, which stacks. */

  /** Why the mail icon cannot run on this row, or null when it can. */
  function mailBlocked(r: UserRow): string | null {
    const p = r.profile;
    if (!r.email) return "Add an email for this person in HR & Payroll ▸ People ▸ Staff first.";
    // A login is made from a staff row; an email-only access row has none.
    if (!p && !r.staffId) return "Not in HR & Payroll ▸ People ▸ Staff — add them there to invite them.";
    if (p?.is_super_admin) return "Super admin — no welcome mail to send.";
    if (p && !p.is_active) return "Login is switched off — switch it on first.";
    return null;
  }
  /** Why the Status switch is locked on this row, or null when it is not. */
  function statusBlocked(p: ProfileRow): string | null {
    if (p.id === meId) return "You can't switch off your own login.";
    if (p.is_super_admin) return "A super admin login stays active.";
    return null;
  }

  const columns: Column<UserRow>[] = [
    {
      header: "User",
      className: "w-60",
      cell: (r) => (
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="flex items-center gap-1.5">
            <span className="truncate font-semibold text-foreground">{r.name ?? "—"}</span>
            {r.profile?.is_super_admin && (
              /* A plain chip, not a StatusPill: the info tone carries a
                 pencil glyph, which read as "editable" (redesign issue 1). */
              <span className="inline-flex h-5 shrink-0 items-center whitespace-nowrap rounded-full bg-info/10 px-2 text-[11px] font-medium text-info">
                Super admin
              </span>
            )}
          </span>
          <span className="font-mono text-[11px] text-muted-foreground">{r.code ?? "—"}</span>
        </div>
      ),
    },
    {
      header: "Email",
      cell: (r) =>
        r.email ? (
          <span className="text-sm text-muted-foreground">{r.email}</span>
        ) : (
          <span className="inline-flex items-center gap-1 whitespace-nowrap text-xs text-warning">
            <CircleAlert className="size-3.5" aria-hidden />
            Email missing
          </span>
        ),
    },
    {
      header: "Roles",
      cell: (r) => {
        if (r.profile?.is_super_admin) return <span className="text-xs text-muted-foreground">All access</span>;
        // A role hangs off a login — none yet, so the mail icon is the next step.
        // A role hangs off a login; the invite (✉) gives one as it makes the login.
        if (!r.profile) return <span className="text-xs text-muted-foreground">Given with the invite</span>;
        const assigned = rolesByUser[r.profile.id] ?? [];
        /* THE CELL IS THE WAY IN (user 2026-11-13, screenshot 4137: "there is no
           option for giving roles access for the user"). After the merge the
           only route to roles was the row's pencil, and nothing on the row said
           "roles" — the old shield icon was labelled Roles. Now the Roles cell
           itself opens the person's editor, whose first section is Roles:
           "+ Give role" when they hold none, the names (one line — a chip per
           line made a row as tall as its role count) when they do. */
        return (
          <button
            type="button"
            onClick={() => openEditor(r)}
            className="block max-w-[16rem] text-left text-sm text-primary underline-offset-2 hover:underline"
            aria-label={`Roles for ${r.name ?? r.email ?? "user"}`}
          >
            {assigned.length === 0 ? (
              <span className="font-medium">+ Give role</span>
            ) : (
              <Truncated text={assigned.map((ur) => ur.role_name).join(", ")} />
            )}
          </button>
        );
      },
    },
    {
      /* UNITS BESIDE ROLES (2026-11-13) — the one setting nothing works
         without, moved here from the retired User Permissions list. */
      header: "Units *",
      /* NAMES, NOT A DROPDOWN (user 2026-11-13, screenshot 4148: "1 units
         select…" said neither which unit nor all of it). Read like the Roles
         column beside it, and like it, the cell opens the person's editor,
         whose Units row is where they are changed. */
      cell: (r) => {
        const a = accessOf(r);
        if (!a) return <span className="text-xs text-muted-foreground">—</span>;
        if (r.profile?.is_super_admin) return <span className="text-xs text-muted-foreground">Every unit</span>;
        const acc = a.access;
        const names = acc?.all_locations
          ? "All units"
          : (acc?.location_ids ?? []).map((id) => access.locations.find((l) => l.id === id)?.name ?? "(inactive unit)").join(", ");
        return (
          <button
            type="button"
            onClick={() => openEditor(r)}
            className={`block max-w-[14rem] text-left text-sm underline-offset-2 hover:underline ${names ? "text-primary" : "font-medium text-danger"}`}
            aria-label={`Units for ${r.name ?? r.email ?? "user"}`}
          >
            {names ? <Truncated text={names} /> : "No unit — set one"}
          </button>
        );
      },
    },
    {
      header: "Login",
      className: "w-40",
      cell: (r) =>
        !r.profile ? (
          <StatusPill tone="neutral" className="whitespace-nowrap">No login yet</StatusPill>
        ) : r.profile.must_change_password ? (
          <StatusPill tone="warning" className="whitespace-nowrap">Temporary password</StatusPill>
        ) : (
          <StatusPill tone="success" className="whitespace-nowrap">Password set</StatusPill>
        ),
    },
    {
      header: "Status",
      className: "w-32",
      cell: (r) => {
        const p = r.profile;
        if (!p) return <span className="text-xs text-muted-foreground">—</span>;
        const why = statusBlocked(p);
        const toggle = (
          <StatusToggle
            row={p}
            label={r.name ?? r.email ?? "user"}
            disabled={busy || !!why}
            onChange={(active) => setStatus(p, active)}
          />
        );
        return why ? (
          <Tooltip label={why} touch>
            {toggle}
          </Tooltip>
        ) : (
          toggle
        );
      },
    },
    {
      /* Empty header on purpose: `withCreatedColumns` recognises the trailing
         action column by it and splices Created Date / User in before it. */
      header: "",
      align: "right",
      className: "w-24",
      cell: (r) => {
        const p = r.profile;
        /* THE WELCOME MAIL IS A ONE-TIME STEP (user 2026-11-13, screenshot
           4138: "its only need to that time only"). The icon shows until the
           person has signed in and chosen their own password — no login yet,
           or still on the temporary one — and then leaves the row. Past that
           point a resend only REPLACED a password they chose; a forgotten
           password is the sign-in page's "Forgot password?". A super admin
           never gets one. The cell is right-aligned, so the pencil stays in
           line down the column when the envelope is gone. */
        const mailDue = !p || (p.must_change_password && !p.is_super_admin);
        return (
          <span className="inline-flex justify-end gap-1">
            {mailDue && <RowIconAction
              label={p ? "Resend welcome mail" : "Invite — role, unit, then mail"}
              name={r.name}
              icon={Mail}
              disabledReason={busy ? "Working…" : mailBlocked(r)}
              onClick={() => openInvite([r])}
            />}
            <RowIconAction
              label="Roles, units & extra screens"
              name={r.name}
              icon={Pencil}
              disabledReason={
                !p && !r.email ? "Add an email for this person in HR & Payroll ▸ People ▸ Staff first." : null
              }
              onClick={() => openEditor(r)}
            />
          </span>
        );
      },
    },
  ];


  return (
    <div className="space-y-4">
      {delivery && <DeliveryNote result={delivery} onClose={() => setDelivery(null)} />}

      <FilterBar
        search={search}
        onSearch={setSearch}
        searchPlaceholder="Search name, code, email or role…"
        activeCount={facets.activeCount}
        onReset={facets.activeCount ? facets.reset : undefined}
        panel={facets.panel}
        leading={quick.segment}
        /* Names the word while one is lit — Order Entry's rule: a bare
           "3 of 12" beside a lit Pending would read as the whole list. */
        right={
          quick.value
            ? `${filtered.length} of ${rows.length} ${quick.value === "pending" ? "Pending" : "Updated"}`
            : `${filtered.length} of ${rows.length}`
        }
      />

      {/* NO SUMMARY STRIP (user 2026-11-13: "remove it i think no need this").
          "26 users can sign in — 3 on a temporary password …" repeated what
          Administration ▸ Overview already counts, and the Login column and
          the Filters drawer answer per person. */}
      <SelectionBar count={selectedRows.length} onClear={sel.clear}>
        <Button type="button" variant="outline" size="sm" disabled={busy} onClick={bulkMail}>
          <Mail className="h-4 w-4" aria-hidden />
          Invite
        </Button>
        <Button type="button" variant="outline" size="sm" disabled={busy} onClick={bulkGive}>
          <ShieldCheck className="h-4 w-4" aria-hidden />
          Give role &amp; unit
        </Button>
      </SelectionBar>

      <DataTable
        /* Decided on ALL rows, not the filtered page: a Pending tab of people with
           no login has no created_at, and the pair would vanish there only —
           the column jump the redesign removes. */
        columns={withCreatedColumns(columns, rows)}
        rows={filtered}
        getKey={(r) => r.key}
        selectable
        selectedKeys={sel.selectedKeys}
        onToggle={sel.toggle}
        onToggleAll={() => sel.toggleAll(filtered.map((r) => r.key))}
        empty={rows.length ? "No one matches these filters." : "No active staff in HR & Payroll ▸ People ▸ Staff."}
      />

      {invite && (
        <InviteSheet
          people={rows.filter((r) => invite.keys.includes(r.key))}
          mail={invite.mail}
          skipped={invite.skipped}
          origin={origin}
          onClose={() => {
            setInvite(null);
            sel.clear();
          }}
          onDelivered={(d) => {
            if (d.emailed || d.tempPassword) setDelivery(d);
          }}
          roles={roles}
          locations={access.locations}
          accessOf={accessOf}
          rolesByUser={rolesByUser}
          roleTrees={access.roleTrees}
          offered={access.offered}
        />
      )}

      {editing && (
        <PersonAccessSheet
          key={editing.key}
          open
          onClose={() => setEditingKey(null)}
          origin={origin}
          name={editing.name ?? editing.email ?? "User"}
          code={editing.code}
          profile={editing.profile}
          access={accessOf(editing)}
          userRoles={editing.profile ? (rolesByUser[editing.profile.id] ?? []) : []}
          roles={roles}
          roleTrees={access.roleTrees}
          locations={access.locations}
          offered={access.offered}
          canEdit={canEdit}
          meId={meId}
        />
      )}

    </div>
  );
}
