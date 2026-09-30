"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ToggleLeft, ToggleRight, Trash2 } from "lucide-react";
import { ConfirmBulkButton } from "@/components/ui/selection-bar";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, FieldRow } from "@/components/ui/field";
import { Sheet } from "@/components/ui/sheet";
import { Tabs } from "@/components/ui/tabs";
import { StatusPill } from "@/components/ui/status-pill";
import { useToast } from "@/components/ui/toast";
import { DetailSection } from "@/components/masters/detail-section";
import { MasterListShell } from "@/components/masters/master-list-shell";
import { useFacetFilter } from "@/components/ui/filter-drawer";
import { useQuickStatus } from "@/components/orders/bom-queue";
import { roleFacets, roleWord, userAccessFacets, userAccessWord } from "./access-control-filters";
import type { Column } from "@/components/ui/data-table";
import { PermissionTree } from "@/components/permissions/permission-tree";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { screenCatalog } from "@/lib/permissions/screen-catalog";
import type { PermissionTree as Tree } from "@/lib/permissions/effective";
import { deleteRole, saveRoleAccess, saveUserAccess } from "@/lib/permissions/actions";
import { deleteUserLogin } from "@/lib/users/actions";
import type { AccessControlData, AccessRole, AccessUser } from "@/lib/permissions/service";

/**
 * ACCESS CONTROL — By Role and By User over ONE permission tree (0658; user
 * 2026-09-30: "role and permission and permission override need to merge … the
 * role based system also will work like same without any issue").
 *
 * A role's tree and a person's email access are the same `PermissionTree` and
 * go through the same save normalisation, so the two never drift. Effective
 * access = the person's roles + their ACTIVE email access, enforced identically
 * on menus, pages and buttons (lib/auth/server.ts `can`, `requirePermission`).
 */

type Props = {
  data: AccessControlData;
  meId: string;
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
  initialTab: "roles" | "users";
  initialUser: string | null;
};

/** "3 modules · 1 per screen" — what a tree grants, in a list cell. */
function treeSummary(tree: Tree): string {
  const settings = Object.values(tree).filter(Boolean);
  if (settings.length === 0) return "—";
  const perScreen = settings.filter((s) => s!.mode === "screen").length;
  return `${settings.length} module${settings.length === 1 ? "" : "s"}${perScreen ? ` · ${perScreen} per screen` : ""}`;
}

export function AccessControlScreen({ data, meId, canCreate, canEdit, canDelete, initialTab, initialUser }: Props) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, start] = useTransition();
  const catalog = screenCatalog();

  const [tab, setTab] = useState<string>(initialTab);

  // ── Role sheet ──────────────────────────────────────────────────────────────
  const [roleOpen, setRoleOpen] = useState(false);
  const [roleId, setRoleId] = useState<string | null>(null);
  const [roleSystem, setRoleSystem] = useState(false);
  const [roleName, setRoleName] = useState("");
  const [roleDesc, setRoleDesc] = useState("");
  const [roleTree, setRoleTree] = useState<Tree>({});
  const [roleTab, setRoleTab] = useState<string>("details");
  const [roleDirty, setRoleDirty] = useState(false);
  const [roleTried, setRoleTried] = useState(false);

  // ── User sheet ──────────────────────────────────────────────────────────────
  const openFromUrl = initialUser ? data.users.find((u) => u.email === initialUser.toLowerCase()) ?? null : null;
  const [user, setUser] = useState<AccessUser | null>(openFromUrl);
  const [userActive, setUserActive] = useState(openFromUrl?.access?.is_active ?? true);
  const [userNote, setUserNote] = useState(openFromUrl?.access?.note ?? "");
  const [userTree, setUserTree] = useState<Tree>(openFromUrl?.tree ?? {});
  const [userDirty, setUserDirty] = useState(false);

  /* AGENTS.md "Auto-reload guard": a silent deploy reload must not eat a tree
     half-edited. Keyed on real edits, not on a sheet merely being open. */
  useUnsavedGuard(isPending || (roleOpen && roleDirty) || (!!user && userDirty));

  function openRole(r: AccessRole | null) {
    setRoleId(r?.id ?? null);
    setRoleSystem(r?.is_system ?? false);
    setRoleName(r?.name ?? "");
    setRoleDesc(r?.description ?? "");
    setRoleTree(r?.tree ?? {});
    setRoleTab(r ? "permissions" : "details");
    setRoleDirty(false);
    setRoleTried(false);
    setRoleOpen(true);
  }

  function saveRole() {
    setRoleTried(true);
    if (!roleName.trim()) {
      setRoleTab("details");
      return;
    }
    start(async () => {
      const res = await saveRoleAccess({ roleId, name: roleName, description: roleDesc, tree: roleTree });
      if (res.ok) {
        success(roleId ? "Role saved" : "Role created");
        setRoleOpen(false);
        router.refresh();
      } else toastError(res.error);
    });
  }

  function openUser(u: AccessUser) {
    setUser(u);
    setUserActive(u.access?.is_active ?? true);
    setUserNote(u.access?.note ?? "");
    setUserTree(u.tree);
    setUserDirty(false);
  }

  function saveUser() {
    if (!user) return;
    const email = user.email;
    start(async () => {
      const res = await saveUserAccess({ email, active: userActive, note: userNote, tree: userTree });
      if (res.ok) {
        success(userActive ? "Access saved" : "Access saved — switched off");
        setUser(null);
        router.refresh();
      } else toastError(res.error);
    });
  }

  /**
   * BULK — tick rows, act on all of them (user 2026-09-30: "select check box in
   * front … for bulk setting the data"). Each action runs the SAME server
   * action a single row uses, one row at a time, and SKIPS what that single
   * row would refuse (a system role, your own login) rather than failing the
   * batch — the toast says how many were done and how many were skipped.
   */
  function runBulk<T>(
    items: T[],
    skip: (t: T) => boolean,
    act: (t: T) => Promise<{ ok: boolean; error?: string }>,
    doneWord: string,
    clear: () => void,
  ) {
    const todo = items.filter((t) => !skip(t));
    const skipped = items.length - todo.length;
    if (todo.length === 0) {
      toastError(`Nothing to do — all ${items.length} selected are ${skipped === 1 ? "one that is" : "ones that are"} protected.`);
      return;
    }
    start(async () => {
      let ok = 0;
      let firstError: string | null = null;
      for (const t of todo) {
        const res = await act(t);
        if (res.ok) ok++;
        else firstError ??= res.error ?? "Failed";
      }
      const tail = [skipped ? `${skipped} skipped` : "", ok < todo.length ? `${todo.length - ok} failed: ${firstError}` : ""]
        .filter(Boolean)
        .join(" · ");
      if (ok) success(`${ok} ${doneWord}${tail ? ` (${tail})` : ""}`);
      else toastError(tail);
      clear();
      router.refresh();
    });
  }

  const roleProtected = (r: AccessRole) => r.is_system || r.holders > 0;
  const userProtected = (u: { id: string; is_super_admin: boolean }) => u.id === meId || u.is_super_admin;

  const roleColumns: Column<AccessRole>[] = [
    { header: "Role", cell: (r) => <span className="text-sm font-medium">{r.name}</span> },
    { header: "Description", cell: (r) => <span className="text-sm">{r.description ?? "—"}</span> },
    { header: "Type", cell: (r) => <StatusPill tone={r.is_system ? "info" : "neutral"}>{r.is_system ? "System" : "Custom"}</StatusPill> },
    { header: "Users", cell: (r) => <span className="text-sm tabular-nums">{r.holders}</span> },
    { header: "Access", cell: (r) => <span className="text-sm">{treeSummary(r.tree)}</span> },
  ];

  /**
   * THE STATUS SWITCH IN THE TABLE (user 2026-09-30: "no more need eye icon …
   * add the status toggle (active/inactive) in front table"). On this tab the
   * switch is the person's EMAIL ACCESS — the Active / Inactive that decides
   * whether their personal grants count on top of their roles. Their LOGIN is
   * switched on the Users screen. One click, no sheet: the tree and note are
   * saved back exactly as they were.
   */
  function setAccessActive(u: AccessUser, active: boolean) {
    if (u.id === meId) {
      toastError("You cannot change your own access.");
      return;
    }
    start(async () => {
      const res = await saveUserAccess({ email: u.email, active, note: u.access?.note ?? null, tree: u.tree });
      if (res.ok) {
        success(active ? "Email access switched on" : "Email access switched off");
        router.refresh();
      } else toastError(res.error);
    });
  }

  /** The bin beside the pencil (user 2026-09-30). The row cluster asks for a
   *  second click itself, so there is no separate confirm here. */
  function removeRole(r: AccessRole) {
    start(async () => {
      const res = await deleteRole(r.id);
      if (res.ok) {
        success(`${r.name} deleted`);
        router.refresh();
      } else toastError(res.error);
    });
  }

  /** Delete the person — their personal access AND their login (user
   *  2026-09-30). A login that made records is retired instead of erased
   *  (see `deleteUserLogin`), and the toast says which happened. */
  function removeUser(u: AccessUser) {
    start(async () => {
      const res = await deleteUserLogin(u.id);
      if (!res.ok) return toastError(res.error);
      success(
        res.retired
          ? `${u.email}: login switched off and all access removed. It is kept because records they entered still name them.`
          : `${u.email} deleted.`,
      );
      router.refresh();
    });
  }

  /** `is_active` on these rows is the EMAIL ACCESS flag the shell's Status
   *  switch reads; the login's own flag rides along as `login_active`.
   *  NEVER SET UP READS ACTIVE: nothing has been switched off, and reading it
   *  as Inactive greyed the whole row — the admin's own included — for a
   *  person who simply has no personal grants (user 2026-09-30). */
  const userRows = data.users.map((u) => ({ ...u, login_active: u.is_active, is_active: u.access?.is_active ?? true }));
  type UserRowT = (typeof userRows)[number];

  /* THE FILTER DRAWER, one per tab (user 2026-09-30) — the same drawer as
     Admin ▸ Users and every Orders list, through the shell's `filterPanel`
     slot. Facets in `access-control-filters.tsx`; each tab passes its rows
     already narrowed, so the shell's search and paging run over the result. */
  const roleFilter = useFacetFilter(data.roles, roleFacets(data.roles));
  const userFilter = useFacetFilter(userRows, userAccessFacets(userRows));
  /* PENDING · UPDATED, one box per tab (user 2026-09-30) — words in
     `access-control-filters.tsx`. Each keeps its own URL param: the two tabs
     share one route, and one `status` param would have them overwrite each
     other. Counts run over the drawer-filtered rows, so a figure is what
     clicking it shows. */
  const rolesFaceted = data.roles.filter(roleFilter.matches);
  const usersFaceted = userRows.filter(userFilter.matches);
  const roleQuick = useQuickStatus(roleWord, { draft: false, countRows: rolesFaceted, param: "role_status" });
  const userQuick = useQuickStatus(userAccessWord, { draft: false, countRows: usersFaceted, param: "user_status" });

  const userColumns: Column<UserRowT>[] = [
    { header: "Name", cell: (u) => <span className="text-sm font-medium">{u.full_name ?? "—"}</span> },
    { header: "Email", cell: (u) => <span className="text-sm">{u.email}</span> },
    { header: "Roles", cell: (u) => <span className="text-sm">{u.is_super_admin ? "Super admin" : u.roles.join(", ") || "—"}</span> },
    { header: "Grants", cell: (u) => <span className="text-sm">{treeSummary(u.tree)}</span> },
    {
      header: "Login",
      cell: (u) => <StatusPill tone={u.login_active ? "success" : "danger"}>{u.login_active ? "Active" : "Deactivated"}</StatusPill>,
    },
  ];

  const rolesTab = (
    <MasterListShell<AccessRole>
      rows={rolesFaceted.filter(roleQuick.matches)}
      filterLeading={roleQuick.segment}
      filterPanel={roleFilter.panel}
      panelActiveCount={roleFilter.activeCount}
      onPanelReset={roleFilter.reset}
      getKey={(r) => r.id}
      perms={{ canCreate, canEdit, canDelete }}
      searchText={(r) => `${r.name} ${r.description ?? ""}`}
      columns={roleColumns}
      addLabel="+ New Role"
      onAdd={canCreate ? () => openRole(null) : undefined}
      view={false}
      actions={{
        onEdit: (r) => openRole(r),
        onDelete: removeRole,
        deleteDisabledReason: (r) =>
          r.is_system
            ? "A system role cannot be deleted"
            : r.holders > 0
              ? `Held by ${r.holders} user${r.holders === 1 ? "" : "s"} — remove it from them first`
              : null,
        menuAs: "icons",
      }}
      rowLabel={(r) => r.name}
      bulkActions={
        canDelete
          ? (sel, clear) => (
              <ConfirmBulkButton
                label={`Delete ${sel.length}`}
                confirmLabel={`Confirm — delete ${sel.filter((r) => !roleProtected(r)).length} (system and held roles are kept)`}
                icon={<Trash2 className="h-4 w-4" aria-hidden />}
                disabled={isPending}
                onConfirm={() => runBulk(sel, roleProtected, (r) => deleteRole(r.id), "deleted", clear)}
              />
            )
          : undefined
      }
      mobile={{ title: (r) => r.name, subtitle: (r) => treeSummary(r.tree) }}
      isPending={isPending}
    />
  );

  const usersTab = (
    <MasterListShell<UserRowT>
      rows={usersFaceted.filter(userQuick.matches)}
      filterLeading={userQuick.segment}
      filterPanel={userFilter.panel}
      panelActiveCount={userFilter.activeCount}
      onPanelReset={userFilter.reset}
      getKey={(u) => u.id}
      // `canDelete` gates both the bin and the Status switch in the shell.
      perms={{ canCreate: false, canEdit, canDelete }}
      searchText={(u) => `${u.full_name ?? ""} ${u.email} ${u.roles.join(" ")}`}
      columns={userColumns}
      view={false}
      actions={{
        onEdit: (u) => openUser(data.users.find((x) => x.id === u.id)!),
        onStatusChange: (u, active) => setAccessActive(data.users.find((x) => x.id === u.id)!, active),
        onDelete: (u) => removeUser(data.users.find((x) => x.id === u.id)!),
        deleteDisabledReason: (u) =>
          u.id === meId
            ? "You cannot delete your own login"
            : u.is_super_admin
              ? "A super admin's login is not deleted from here"
              : null,
        menuAs: "icons",
      }}
      rowLabel={(u) => u.email}
      bulkActions={
        canEdit || canDelete
          ? (sel, clear) => {
              const full = sel.map((u) => data.users.find((x) => x.id === u.id)!);
              const setAll = (active: boolean) =>
                runBulk(
                  full,
                  (u) => u.id === meId,
                  (u) => saveUserAccess({ email: u.email, active, note: u.access?.note ?? null, tree: u.tree }),
                  active ? "switched on" : "switched off",
                  clear,
                );
              return (
                <>
                  {canEdit && (
                    <>
                      <Button type="button" variant="outline" size="sm" disabled={isPending} onClick={() => setAll(true)}>
                        <ToggleRight className="h-4 w-4" aria-hidden />
                        Email access on
                      </Button>
                      <Button type="button" variant="outline" size="sm" disabled={isPending} onClick={() => setAll(false)}>
                        <ToggleLeft className="h-4 w-4" aria-hidden />
                        Email access off
                      </Button>
                    </>
                  )}
                  {canDelete && (
                    <ConfirmBulkButton
                      label={`Delete ${sel.length}`}
                      confirmLabel={`Confirm — delete ${full.filter((u) => !userProtected(u)).length} login(s)`}
                      icon={<Trash2 className="h-4 w-4" aria-hidden />}
                      disabled={isPending}
                      onConfirm={() => runBulk(full, userProtected, (u) => deleteUserLogin(u.id), "deleted", clear)}
                    />
                  )}
                </>
              );
            }
          : undefined
      }
      mobile={{ title: (u) => u.full_name ?? u.email, subtitle: (u) => u.email }}
      isPending={isPending}
    />
  );

  const isMe = user?.id === meId;

  return (
    <>
      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { key: "roles", label: `By Role (${data.roles.length})`, content: rolesTab },
          { key: "users", label: `By User (${data.users.length})`, content: usersTab },
        ]}
      />

      {/* ── A role: Details | Permissions (MyJKKN's shape) ─────────────────── */}
      <Sheet
        open={roleOpen}
        onClose={() => setRoleOpen(false)}
        title={roleId ? `Role · ${roleName}` : "New Role"}
        footer={
          <>
            <Button variant="outline" size="md" onClick={() => setRoleOpen(false)}>Cancel</Button>
            <Button size="md" disabled={isPending || !(roleId ? canEdit : canCreate)} onClick={saveRole}>
              {isPending ? "Saving…" : roleId ? "Save role" : "Create role"}
            </Button>
          </>
        }
      >
        <Tabs
          value={roleTab}
          onChange={setRoleTab}
          items={[
            {
              key: "details",
              label: "Details",
              content: (
                /* name 288 + 2 × 10px padding → 20rem cap for the row; the
                   description takes the section's full width. */
                <DetailSection label="Role" cols={1} className="max-w-[40rem]">
                  <FieldRow>
                    <Field label="Role Name" required w="name" htmlFor="ac-role-name" error={roleTried && !roleName.trim() ? "Give the role a name." : undefined}>
                      <Input
                        id="ac-role-name"
                        value={roleName}
                        readOnly={roleSystem}
                        onChange={(e) => { setRoleName(e.target.value); setRoleDirty(true); }}
                      />
                    </Field>
                  </FieldRow>
                  <Field label="Description" htmlFor="ac-role-desc">
                    <Textarea id="ac-role-desc" rows={3} value={roleDesc} onChange={(e) => { setRoleDesc(e.target.value); setRoleDirty(true); }} />
                  </Field>
                  {roleSystem && <p className="text-xs text-muted-foreground">A system role keeps its name; its permissions can still be changed.</p>}
                </DetailSection>
              ),
            },
            {
              key: "permissions",
              label: "Permissions",
              content: (
                <PermissionTree
                  catalog={catalog}
                  offered={data.offered}
                  value={roleTree}
                  readOnly={!canEdit && !!roleId}
                  onChange={(t) => { setRoleTree(t); setRoleDirty(true); }}
                />
              ),
            },
          ]}
        />
      </Sheet>

      {/* ── A person: email-based access + approved-order corrections ─────── */}
      <Sheet
        open={!!user}
        onClose={() => setUser(null)}
        title={user ? `Access · ${user.full_name ?? user.email}` : "Access"}
        footer={
          <>
            <Button variant="outline" size="md" onClick={() => setUser(null)}>Close</Button>
            <Button size="md" disabled={isPending || !canEdit || isMe} onClick={saveUser}>
              {isPending ? "Saving…" : "Save access"}
            </Button>
          </>
        }
      >
        {user && (
          <div className="space-y-4">
            <DetailSection label="Email-based access" cols={1}>
              <p className="text-sm text-muted-foreground">
                {user.email} · roles: {user.is_super_admin ? "Super admin (already holds everything)" : user.roles.join(", ") || "none"}.
                What you tick here is added to what their roles give — for this person only.
              </p>
              {isMe && <p className="text-sm text-warning">Your own access is set by another administrator.</p>}
              {/* No Status switch and no Note here (user 2026-09-30, screenshots
                  3147 / 3152): status lives in the list's Status column, and the
                  save below carries both the current status and any note already
                  stored through unchanged. */}
            </DetailSection>

            <PermissionTree
              catalog={catalog}
              offered={data.offered}
              value={userTree}
              readOnly={!canEdit || isMe}
              onChange={(t) => { setUserTree(t); setUserDirty(true); }}
            />

          </div>
        )}
      </Sheet>
    </>
  );
}
