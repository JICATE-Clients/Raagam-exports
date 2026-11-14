"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Trash2 } from "lucide-react";
import { ConfirmBulkButton } from "@/components/ui/selection-bar";
import { Input } from "@/components/ui/input";
import { Field, FieldRow } from "@/components/ui/field";
import { Sheet } from "@/components/ui/sheet";
import { StatusPill } from "@/components/ui/status-pill";
import { Truncated } from "@/components/ui/truncated";
import { useToast } from "@/components/ui/toast";
import { DetailSection } from "@/components/masters/detail-section";
import { MasterListShell } from "@/components/masters/master-list-shell";
import { useFacetFilter } from "@/components/ui/filter-drawer";
import { roleFacets } from "./access-control-filters";
import type { Column } from "@/components/ui/data-table";
import { PermissionTree } from "@/components/permissions/permission-tree";
import { treeSummary } from "@/components/permissions/tree-summary";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { menuCatalog } from "@/lib/permissions/screen-catalog";
import type { PermissionTree as Tree } from "@/lib/permissions/effective";
import { deleteRole, saveRoleAccess } from "@/lib/permissions/actions";
import type { AccessControlData, AccessRole } from "@/lib/permissions/service";

/**
 * ROLES & PERMISSIONS — a role's screens and actions over the one permission
 * tree (0658). Everyone holding the role gets its access.
 *
 * ROLES ONLY SINCE 2026-11-13 (user: "user access control look much
 * cluttered"). This component also rendered the User Permissions list — a
 * second list of the same people as Users, with a second Status switch that
 * meant "email access" while Users' meant "login", and a bin that deleted the
 * login. A person is now set up in ONE editor on Users (`person-access-sheet.tsx`),
 * which uses the same `PermissionTree` and the same `saveUserAccess`, so a
 * role's tree and a person's extra screens still go through one normalisation.
 */

type Props = {
  data: AccessControlData;
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
};

export function AccessControlScreen({ data, canCreate, canEdit, canDelete }: Props) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, start] = useTransition();
  const catalog = menuCatalog();
  // ── Role sheet ──────────────────────────────────────────────────────────────
  const [roleOpen, setRoleOpen] = useState(false);
  const [roleId, setRoleId] = useState<string | null>(null);
  const [roleSystem, setRoleSystem] = useState(false);
  const [roleName, setRoleName] = useState("");
  const [roleDesc, setRoleDesc] = useState("");
  /** 0670: the page this role's holders land on after signing in ("" = none). */
  const [roleHome, setRoleHome] = useState("");
  const [roleTree, setRoleTree] = useState<Tree>({});
  const [roleDirty, setRoleDirty] = useState(false);
  const [roleTried, setRoleTried] = useState(false);

  useUnsavedGuard(isPending || (roleOpen && roleDirty));

  function openRole(r: AccessRole | null) {
    setRoleId(r?.id ?? null);
    setRoleSystem(r?.is_system ?? false);
    setRoleName(r?.name ?? "");
    setRoleDesc(r?.description ?? "");
    setRoleHome(r?.home_path ?? "");
    setRoleTree(r?.tree ?? {});
    setRoleDirty(false);
    setRoleTried(false);
    setRoleOpen(true);
  }

  function saveRole() {
    setRoleTried(true);
    if (!roleName.trim()) {
      document.getElementById("ac-role-name")?.focus();
      return;
    }
    start(async () => {
      const res = await saveRoleAccess({
        roleId,
        name: roleName,
        description: roleDesc,
        tree: roleTree,
        homePath: roleHome || null,
      });
      if (res.ok) {
        success(roleId ? "Role saved" : "Role created");
        setRoleOpen(false);
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

  const roleColumns: Column<AccessRole>[] = [
    { header: "Role", cell: (r) => <span className="text-sm font-medium">{r.name}</span> },
    // CAPPED AT 20rem, ONE LINE (user 2026-10-01, screenshots 3211/3212: the
    // roles list scrolled sideways). Cells never wrap (data-table.tsx, "one
    // line per row at any zoom"), so the longest description set the table's
    // width and pushed Created User and the row icons off a 1080p screen. A
    // longer one now ends in "…" and shows whole on hover (`Truncated`).
    {
      header: "Description",
      className: "max-w-[20rem]",
      cell: (r) =>
        r.description ? (
          <Truncated text={r.description} className="block max-w-[20rem] text-sm" />
        ) : (
          <span className="text-sm">—</span>
        ),
    },
    { header: "Type", cell: (r) => <StatusPill tone={r.is_system ? "info" : "neutral"}>{r.is_system ? "System" : "Custom"}</StatusPill> },
    { header: "Users", cell: (r) => <span className="text-sm tabular-nums">{r.holders}</span> },
    { header: "Access", cell: (r) => <span className="text-sm">{treeSummary(r.tree)}</span> },
  ];

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

  /* THE FILTER DRAWER (user 2026-09-30) — facets in `access-control-filters.tsx`.
     A role list is short and read whole, so there is no Pending · Updated box
     (user 2026-10-01, screenshot 3205). */
  const roleFilter = useFacetFilter(data.roles, roleFacets(data.roles));
  const rolesFaceted = data.roles.filter(roleFilter.matches);

  /* WHO HOLDS THIS ROLE (2026-11-13). The list said "Users: 3" and nothing
     more — finding the three meant opening every person on Users. Each name
     opens that person's editor there. Keyed by name, as `AccessUser.roles` is. */
  const holders = roleId
    ? data.users.filter((u) => u.has_login && u.roles.includes(roleName)).sort((a, b) =>
        (a.full_name ?? a.email).localeCompare(b.full_name ?? b.email),
      )
    : [];

  const rolesTab = (
    <MasterListShell<AccessRole>
      rows={rolesFaceted}
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

  return (
    <>
      {rolesTab}

      {/* ── A role: name + description, then its permissions ──────────────── */}
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
        {/* ONE PAGE, NOT TWO TABS (user 2026-10-01, screenshot 3208): the
            role's name and description on ONE row, the permission tree right
            beneath — Details was two fields behind a tab of its own.
            Row arithmetic: two `name` fields (2 × 288px) + one gap → 37rem,
            capped at 40rem like the section before it.
            NO HOME PAGE FIELD (same instruction: "remove the home page field").
            0670's `home_path` is not touched: a role that has one keeps it —
            `openRole` still loads it and `saveRole` sends it back unchanged —
            the form just no longer offers to change it. */}
        <div className="space-y-4">
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
              <Field label="Description" w="name" htmlFor="ac-role-desc">
                <Input id="ac-role-desc" value={roleDesc} onChange={(e) => { setRoleDesc(e.target.value); setRoleDirty(true); }} />
              </Field>
            </FieldRow>
            {roleSystem && <p className="text-xs text-muted-foreground">A system role keeps its name; its permissions can still be changed.</p>}
            {roleId && (
              <p className="text-sm">
                <span className="text-muted-foreground">Held by: </span>
                {holders.length === 0
                  ? <span className="text-muted-foreground">nobody yet — give it to people on Users.</span>
                  : holders.map((u, i) => (
                      <span key={u.id}>
                        {i > 0 && ", "}
                        <Link
                          href={`/admin/users?user=${encodeURIComponent(u.email)}`}
                          className="text-primary underline-offset-2 hover:underline"
                        >
                          {u.full_name ?? u.email}
                        </Link>
                      </span>
                    ))}
              </p>
            )}
          </DetailSection>

          <div className="space-y-2">
            {/* 0662: Super Admin passes every check through the login's
                flag, whatever this tree says — so the tree is shown, never
                edited, rather than inviting an edit that changes nothing. */}
            {roleName === "Super Admin" && (
              <p className="text-sm text-muted-foreground">
                Super Admin always has full access to every module and screen. Only a super admin can give or remove
                this role (Users ▸ Roles).
              </p>
            )}
            <PermissionTree
              catalog={catalog}
              offered={data.offered}
              value={roleTree}
              readOnly={(!canEdit && !!roleId) || (roleSystem && roleName === "Super Admin")}
              onChange={(t) => { setRoleTree(t); setRoleDirty(true); }}
            />
          </div>
        </div>
      </Sheet>

    </>
  );
}
