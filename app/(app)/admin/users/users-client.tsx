"use client";

import { useMemo, useState, useTransition } from "react";
import { FilterBar } from "@/components/ui/filter-bar";
import { useFacetFilter } from "@/components/ui/filter-drawer";
import { useQuickStatus } from "@/components/orders/bom-queue";
import { userFacets, userSearchText, userWord } from "./users-filters";
import Link from "next/link";
import { CircleAlert, CircleCheck, Mail, ShieldCheck, ToggleLeft, ToggleRight, Trash2 } from "lucide-react";
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
import { Select } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { assignRole, removeRole } from "@/app/(app)/admin/actions";
import { createUserFromStaff, resendWelcome, setLoginActive } from "@/lib/users/actions";
import { withCreatedColumns } from "@/components/ui/created-columns";

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
/* Role Management Panel                                               */
/* ------------------------------------------------------------------ */

/* A ROLE NO LONGER CARRIES A LOCATION (0680, client 2026-10-03: "Users &
   Access ▸ Location Allocation is the single source of truth"). A role says
   what a person may DO; which units they may OPEN is their Units allocation
   on User Permissions. The role's location used to open units too — a role
   given "at any location" silently opened every unit — so it is no longer
   asked for, written, or shown. Old rows keep their stored location_id, which
   nothing reads any more. */
function RolePanel({
  userId,
  userRoles,
  roles,
}: {
  userId: string;
  userRoles: UserRoleEntry[];
  roles: RoleOption[];
}) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();
  /* No pre-filled role (users 2026-09-30 redesign): the old default picked the
     first role in the list, so "Assign" on an untouched form granted it. */
  const [roleId, setRoleId] = useState("");
  /** The held role whose bin is asking "remove it?" — an inline confirm. */
  const [removingId, setRemovingId] = useState<string | null>(null);

  const holds = (rid: string) => userRoles.some((ur) => ur.role_id === rid);
  const offered = roles.filter((r) => !holds(r.id));

  function handleAssign(e: React.FormEvent) {
    e.preventDefault();
    if (!roleId || holds(roleId)) return;
    startTransition(async () => {
      const result = await assignRole(userId, roleId, null);
      if (result.ok) {
        success("Role assigned.");
        setRoleId("");
        router.refresh();
      } else {
        toastError(result.error);
      }
    });
  }

  function handleRemove(userRoleId: string) {
    setRemovingId(null);
    startTransition(async () => {
      const result = await removeRole(userRoleId);
      if (result.ok) {
        success("Role removed.");
        router.refresh();
      } else {
        toastError(result.error);
      }
    });
  }

  return (
    <div className="space-y-4">
      {/* Current roles */}
      <div>
        <p className="mb-2 text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Holds
        </p>
        {userRoles.length === 0 ? (
          <p className="text-sm text-muted-foreground">No roles assigned yet.</p>
        ) : (
          <div className="space-y-1.5">
            {userRoles.map((ur) =>
              removingId === ur.id ? (
                /* INLINE CONFIRM — a removed grant takes screens away from
                   someone at once, so the bin asks before it acts. */
                <div key={ur.id} className="space-y-2 rounded-md border border-danger/40 bg-danger/5 px-3 py-2">
                  <span className="text-sm font-semibold text-foreground">{ur.role_name}</span>
                  <div className="flex items-center gap-2">
                    <span className="mr-auto text-sm text-danger">Remove this role?</span>
                    <Button type="button" variant="outline" size="sm" onClick={() => setRemovingId(null)}>
                      Keep
                    </Button>
                    <Button
                      type="button"
                      variant="danger"
                      size="sm"
                      disabled={isPending}
                      onClick={() => handleRemove(ur.id)}
                    >
                      Remove
                    </Button>
                  </div>
                </div>
              ) : (
                <div
                  key={ur.id}
                  className="flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-1.5"
                >
                  <span className="min-w-0 flex-1 text-sm font-semibold text-foreground">{ur.role_name}</span>
                  <RowIconAction
                    label="Remove role"
                    name={ur.role_name}
                    icon={Trash2}
                    danger
                    onClick={() => setRemovingId(ur.id)}
                  />
                </div>
              ),
            )}
          </div>
        )}
      </div>

      <form onSubmit={handleAssign} className="space-y-3 border-t border-border pt-3">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Assign another
        </p>
        <div>
          <Label htmlFor="ar-role">Role *</Label>
          <Select
            id="ar-role"
            value={roleId}
            onChange={(e) => setRoleId(e.target.value)}
            required
          >
            <option value="">{offered.length ? "Pick a role" : "Holds every role"}</option>
            {offered.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </Select>
        </div>
        <p className="text-xs text-muted-foreground">
          Which units this person can open is set under{" "}
          <Link href="/admin/user-permissions" className="text-primary underline-offset-2 hover:underline">
            Users &amp; Access ▸ User Permissions ▸ Units
          </Link>
          , not here.
        </p>
        <div className="flex justify-end">
          <Button type="submit" variant="primary" size="sm" disabled={isPending || !roleId}>
            {isPending ? "Assigning…" : "Assign Role"}
          </Button>
        </div>
      </form>
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
}: {
  rows: UserRow[];
  userRoles: UserRoleEntry[];
  roles: RoleOption[];
  meId: string;
}) {
  const router = useRouter();
  const [delivery, setDelivery] = useState<Delivery | null>(null);
  const [busy, startBusy] = useTransition();
  /** The row whose button is asking "are you sure?" — see `sendWelcome`. */
  const [confirmingKey, setConfirmingKey] = useState<string | null>(null);
  const { success, error: toastError } = useToast();

  const [open, setOpen] = useState(false);
  /* BULK (user 2026-09-30: "select check box in front … for bulk setting the
     data") — ticked rows, keyed by `UserRow.key`, and the Assign-role sheet. */
  const sel = useRowSelection();
  const [bulkRoleOpen, setBulkRoleOpen] = useState(false);
  const [bulkRoleId, setBulkRoleId] = useState("");
  const [managing, setManaging] = useState<ProfileRow | null>(null);
  const [origin, setOrigin] = useState<DOMRect | null>(null);

  function openManage(p: ProfileRow) {
    /* `RowIconAction` hands no event over; the clicked icon is the focused
       element, so the sheet still grows out of it. */
    const el = document.activeElement;
    setOrigin(el instanceof HTMLElement ? el.getBoundingClientRect() : null);
    setManaging(p);
    setOpen(true);
  }

  /**
   * SEND WELCOME MAIL — a manual trigger now, automation later (user
   * 2026-09-30). No login yet → the login is created and the mail goes out in
   * one step. A login already → a NEW temporary password is issued and sent
   * (the old one is never stored, so it cannot be re-sent). For someone who
   * has already chosen their own password that REPLACES it, so their row asks
   * for a second click first.
   */
  function sendWelcome(r: UserRow) {
    const p = r.profile;
    if (p && !p.must_change_password && confirmingKey !== r.key) {
      setConfirmingKey(r.key);
      return;
    }
    setConfirmingKey(null);
    startBusy(async () => {
      const result = p
        ? await resendWelcome(p.id)
        : await createUserFromStaff({ staffId: r.staffId!, sendWelcome: true });
      if (!result.ok) {
        toastError(result.error);
        return;
      }
      success(result.emailed ? `Welcome mail sent to ${result.email}.` : "Welcome mail not sent — see the note above the list.");
      if (result.emailed || result.tempPassword) setDelivery(result);
      router.refresh();
    });
  }

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

  /**
   * Run one row's own action over every ticked row, SKIPPING the rows that
   * single action would refuse (no email, your own login, a super admin, …)
   * instead of failing the batch. One toast: done · skipped · failed.
   */
  function runBulk(
    items: UserRow[],
    skip: (r: UserRow) => boolean,
    act: (r: UserRow) => Promise<{ ok: boolean; error?: string }>,
    /** A function when the wording depends on what the run did. */
    doneWord: string | (() => string),
    after?: () => void,
  ) {
    const todo = items.filter((r) => !skip(r));
    const skipped = items.length - todo.length;
    if (todo.length === 0) {
      toastError(`None of the ${items.length} selected can take this — they were all skipped.`);
      return;
    }
    startBusy(async () => {
      let ok = 0;
      let firstError: string | null = null;
      for (const r of todo) {
        const res = await act(r);
        if (res.ok) ok++;
        else firstError ??= res.error ?? "Failed";
      }
      const tail = [skipped ? `${skipped} skipped` : "", ok < todo.length ? `${todo.length - ok} failed: ${firstError}` : ""]
        .filter(Boolean)
        .join(" · ");
      const word = typeof doneWord === "function" ? doneWord() : doneWord;
      if (ok) success(`${ok} ${word}${tail ? ` (${tail})` : ""}`);
      else toastError(tail);
      sel.clear();
      after?.();
      router.refresh();
    });
  }

  /* Bulk welcome mail goes ONLY to people with no login yet or still on a
     temporary password. For someone who chose their own password a resend
     REPLACES it — the single row asks twice for that; a bulk button would
     do it to many at once, so it does not do it at all. */
  const bulkMailSkip = (r: UserRow) => !!mailBlocked(r) || (!!r.profile && !r.profile.must_change_password);
  const bulkMail = () =>
    runBulk(
      selectedRows,
      bulkMailSkip,
      async (r) => {
        const res = r.profile
          ? await resendWelcome(r.profile.id)
          : await createUserFromStaff({ staffId: r.staffId!, sendWelcome: true });
        return res.ok ? { ok: true } : { ok: false, error: res.error };
      },
      "welcome mail(s) sent",
    );
  const bulkLogin = (active: boolean) =>
    runBulk(
      selectedRows,
      (r) => !r.profile || !!statusBlocked(r.profile) || r.profile.is_active === active,
      (r) => setLoginActive(r.profile!.id, active),
      active ? "login(s) switched on" : "login(s) switched off",
    );
  /* A PERSON WITH NO LOGIN YET GETS ONE FIRST (user 2026-09-30: "can't able
     to assign role" — the ticked row was an HR Staff member without a login,
     and the only answer was "they were all skipped"). A role hangs off a
     login, so the login is created here — quietly, no welcome mail — and the
     role follows; "Send welcome mail" stays the separate, deliberate step.
     Still skipped: a super admin (every permission already), someone who
     already holds this role here, and a no-login row with no email in HR
     (a login cannot be made without one), each named in the toast. */
  const bulkAssignSkip = (r: UserRow): string | null => {
    if (!r.profile) return r.email ? null : "no email in HR";
    if (r.profile.is_super_admin) return "super admin";
    const mine = rolesByUser[r.profile.id] ?? [];
    return mine.some((ur) => ur.role_id === bulkRoleId) ? "already has this role" : null;
  };
  const bulkAssign = () => {
    if (!bulkRoleId) return;
    let created = 0;
    const why = selectedRows.map(bulkAssignSkip).filter((w): w is string => !!w);
    if (why.length === selectedRows.length) {
      const counts = new Map<string, number>();
      for (const w of why) counts.set(w, (counts.get(w) ?? 0) + 1);
      toastError(
        `Nothing to assign — ${[...counts].map(([w, n]) => (selectedRows.length > 1 ? `${n} ${w}` : w)).join(" · ")}.`,
      );
      return;
    }
    runBulk(
      selectedRows,
      (r) => !!bulkAssignSkip(r),
      async (r) => {
        let userId = r.profile?.id;
        if (!userId) {
          const made = await createUserFromStaff({ staffId: r.staffId!, sendWelcome: false });
          if (!made.ok) return { ok: false, error: made.error };
          userId = made.userId;
          created++;
          if (!userId) return { ok: false, error: "The login was created but its id did not come back — reload and assign again." };
        }
        // No location: a role says what they may DO; units are their allocation (0680).
        if ((rolesByUser[userId] ?? []).some((ur) => ur.role_id === bulkRoleId)) return { ok: true };
        const res = await assignRole(userId, bulkRoleId, null);
        return res.ok ? { ok: true } : { ok: false, error: res.error };
      },
      // A login made here has a password nobody was told — say so, or the admin
      // reads "assigned" as "they can sign in now".
      () =>
        created
          ? `role(s) assigned — ${created} new login(s) created; send their welcome mail from the row or the bulk bar so they can sign in`
          : "role(s) assigned",
      () => {
        setBulkRoleOpen(false);
        setBulkRoleId("");
      },
    );
  };

  /* THE REDESIGN (user-approved canvas, 2026-09-30) — one fixed set of columns
     on Pending, Updated and All, so switching the box never re-lays the table;
     every cell one line of height except a role list, which stacks. */

  /** Why the mail icon cannot run on this row, or null when it can. */
  function mailBlocked(r: UserRow): string | null {
    const p = r.profile;
    if (!r.email) return "Add an email for this person in HR & Payroll ▸ People ▸ Staff first.";
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
        const assigned = r.profile ? (rolesByUser[r.profile.id] ?? []) : [];
        if (assigned.length === 0)
          return <span className="text-xs text-muted-foreground">{r.profile ? "No role yet" : "—"}</span>;
        /* One chip per role. No location: units are the person's allocation on
           User Permissions, not a property of a role (0680). */
        return (
          <div className="flex flex-col items-start gap-1">
            {assigned.map((ur) => (
              <span
                key={ur.id}
                className="inline-flex h-6 items-center whitespace-nowrap rounded-full bg-info/10 px-2 text-xs font-medium text-info"
              >
                {ur.role_name}
              </span>
            ))}
          </div>
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
        const confirming = confirmingKey === r.key;
        return (
          <span className="inline-flex gap-1">
            <RowIconAction
              label={
                confirming
                  ? "Click again to confirm — this resets their password"
                  : p
                    ? "Resend welcome mail"
                    : "Send welcome mail"
              }
              name={r.name}
              icon={Mail}
              danger={confirming}
              disabledReason={busy ? "Working…" : mailBlocked(r)}
              onClick={() => sendWelcome(r)}
            />
            <RowIconAction
              label="Roles"
              name={r.name}
              icon={ShieldCheck}
              disabledReason={
                !p
                  ? "Needs a login first — send the welcome mail."
                  : p.is_super_admin
                    ? "Super admin has all access — no roles to assign."
                    : null
              }
              onClick={() => p && openManage(p)}
            />
          </span>
        );
      },
    },
  ];

  /* THE SUMMARY STRIP — one line above the table on every tab (same height,
     so the table never jumps). On Pending with people who have no email it is
     the way forward: 19 orange cells said the same thing with no link. */
  const noEmail = rows.filter((r) => !r.profile && !r.email).length;
  const withLogin = rows.filter((r) => r.profile);
  const temp = withLogin.filter((r) => r.profile!.must_change_password).length;
  const off = withLogin.filter((r) => !r.profile!.is_active).length;
  const warnStrip = quick.value === "pending" && noEmail > 0;

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

      {warnStrip ? (
        <div className="flex min-h-13 flex-wrap items-center gap-3 rounded-lg border border-warning/40 bg-warning/10 px-4 py-2">
          <Mail className="size-4 shrink-0 text-warning" aria-hidden />
          <p className="min-w-0 flex-1 text-sm">
            <strong className="font-semibold">
              {noEmail} {noEmail === 1 ? "person can't" : "people can't"} get a login yet
            </strong>{" "}
            <span className="text-muted-foreground">
              — HR & Payroll ▸ People ▸ Staff has no email for them. Add it there and they are ready to invite.
            </span>
          </p>
          <Link
            href="/hr/staff"
            className="inline-flex h-9 items-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            Open Staff master
          </Link>
        </div>
      ) : (
        <div className="flex min-h-13 items-center gap-3 rounded-lg border border-border bg-surface px-4 py-2">
          <CircleCheck className="size-4 shrink-0 text-success" aria-hidden />
          <p className="text-sm">
            <strong className="font-semibold">
              {withLogin.length} {withLogin.length === 1 ? "user can" : "users can"} sign in
            </strong>
            <span className="text-muted-foreground">
              {temp ? ` — ${temp} still on a temporary password` : ""}
              {off ? `${temp ? " ·" : " —"} ${off} switched off` : ""}
              {noEmail ? `${temp || off ? " ·" : " —"} ${noEmail} without an email` : ""}
            </span>
          </p>
        </div>
      )}

      <SelectionBar count={selectedRows.length} onClear={sel.clear}>
        <Button type="button" variant="outline" size="sm" disabled={busy} onClick={bulkMail}>
          <Mail className="h-4 w-4" aria-hidden />
          Send welcome mail
        </Button>
        <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => bulkLogin(true)}>
          <ToggleRight className="h-4 w-4" aria-hidden />
          Login on
        </Button>
        <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => bulkLogin(false)}>
          <ToggleLeft className="h-4 w-4" aria-hidden />
          Login off
        </Button>
        <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => setBulkRoleOpen(true)}>
          <ShieldCheck className="h-4 w-4" aria-hidden />
          Assign role
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

      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={managing ? `Roles — ${managing.full_name ?? managing.email ?? "User"}` : "Roles"}
        size="sm"
        origin={origin}
        footer={
          <span className="mr-auto text-xs text-muted-foreground">
            Role changes save immediately — there is no separate Save button.
          </span>
        }
      >
        {managing && (
          <RolePanel
            userId={managing.id}
            userRoles={rolesByUser[managing.id] ?? []}
            roles={roles}
          />
        )}
      </Sheet>

      <Sheet
        open={bulkRoleOpen}
        onClose={() => setBulkRoleOpen(false)}
        title={`Assign a role to ${selectedRows.length} selected`}
        size="sm"
        footer={
          <>
            <Button type="button" variant="ghost" size="sm" onClick={() => setBulkRoleOpen(false)}>
              Cancel
            </Button>
            <Button type="button" variant="primary" size="sm" disabled={busy || !bulkRoleId} onClick={bulkAssign}>
              {busy ? "Assigning…" : "Assign role"}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <div>
            <Label htmlFor="bulk-role">Role *</Label>
            <Select id="bulk-role" value={bulkRoleId} onChange={(e) => setBulkRoleId(e.target.value)} required>
              <option value="">Pick a role</option>
              {roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </Select>
          </div>
        </div>
      </Sheet>
    </div>
  );
}
