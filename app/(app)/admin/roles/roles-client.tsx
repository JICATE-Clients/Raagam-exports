"use client";

import { useState, useTransition, useMemo } from "react";
import { useRouter } from "next/navigation";
import { MODULES, ACTIONS, MODULE_LABELS } from "@/lib/auth/types";
import type { RoleRow, PermissionRow, RolePermissionRow } from "./page";
import { DataTable } from "@/components/ui/data-table";
import type { Column } from "@/components/ui/data-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardBody } from "@/components/ui/card";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { createRole, toggleRolePermission } from "@/app/(app)/admin/actions";
import { withCreatedColumns } from "@/components/ui/created-columns";

/* ------------------------------------------------------------------ */
/* Create Role Form                                                     */
/* ------------------------------------------------------------------ */

function CreateRoleForm({ onDone }: { onDone: () => void }) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const result = await createRole({ name, description });
      if (result.ok) {
        success("Role created.");
        setName("");
        setDescription("");
        onDone();
        router.refresh();
      } else {
        toastError(result.error);
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>New Role</CardTitle>
      </CardHeader>
      <CardBody>
        <form onSubmit={handleSubmit} className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="cr-name">Name *</Label>
            <Input
              id="cr-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>
          <div>
            <Label htmlFor="cr-desc">Description</Label>
            <Input
              id="cr-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div className="col-span-2 flex justify-end gap-2 pt-1">
            <Button type="button" variant="outline" size="sm" onClick={onDone}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              size="sm"
              disabled={isPending}
            >
              {isPending ? "Creating…" : "Create Role"}
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Permission Matrix                                                    */
/* ------------------------------------------------------------------ */

function PermissionMatrix({
  role,
  permissions,
  rolePermissions,
}: {
  role: RoleRow;
  permissions: PermissionRow[];
  rolePermissions: RolePermissionRow[];
}) {
  const router = useRouter();
  const { error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();

  // Build map: "module:action" → permission_id
  const permMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of permissions) {
      map.set(`${p.module}:${p.action}`, p.id);
    }
    return map;
  }, [permissions]);

  // Build granted set for this role
  const granted = useMemo(() => {
    return new Set(
      rolePermissions
        .filter((rp) => rp.role_id === role.id)
        .map((rp) => rp.permission_id),
    );
  }, [role.id, rolePermissions]);

  function handleToggle(permId: string, currentlyGranted: boolean) {
    startTransition(async () => {
      const result = await toggleRolePermission(
        role.id,
        permId,
        !currentlyGranted,
      );
      if (result.ok) {
        router.refresh();
      } else {
        toastError(result.error);
      }
    });
  }

  return (
    <div className="-mx-5 overflow-x-auto border-y border-border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-surface-muted">
            <th className="px-3 py-2 text-left text-xs font-bold text-muted-foreground min-w-[180px]">
              Module
            </th>
            {ACTIONS.map((action) => (
              <th
                key={action}
                className="px-3 py-2 text-center text-xs font-bold text-muted-foreground capitalize"
              >
                {action}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {MODULES.map((module) => (
            <tr
              key={module}
              className="border-b border-border last:border-0 hover:bg-surface-muted/60"
            >
              <td className="px-3 py-2 text-sm text-foreground">
                {MODULE_LABELS[module]}
              </td>
              {ACTIONS.map((action) => {
                const permId = permMap.get(`${module}:${action}`);
                const checked = permId ? granted.has(permId) : false;
                return (
                  <td key={action} className="px-3 py-2 text-center">
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={!permId || isPending}
                      onChange={() => {
                        if (permId) handleToggle(permId, checked);
                      }}
                      className="h-4 w-4 cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
                    />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Root export                                                          */
/* ------------------------------------------------------------------ */

export default function RolesClient({
  roles,
  permissions,
  rolePermissions,
}: {
  roles: RoleRow[];
  permissions: PermissionRow[];
  rolePermissions: RolePermissionRow[];
}) {
  const [showCreate, setShowCreate] = useState(false);

  /**
   * A SHEET, ANCHORED TO THE ROW — never an inline expansion at the foot of
   * the whole list. That was the reported bug: the matrix used to render
   * below every role row rather than beside the one clicked, so opening
   * "Editing" on the second role could mean scrolling past a dozen more to
   * find it, with nothing on screen tying the two together.
   *
   * `open` stays a separate flag from `editingRole` (never nulled on close) —
   * the same split every other Sheet-based screen in this app uses (see
   * bank-master-screen.tsx's `editId`/`form`) — so the panel keeps showing
   * the role it was editing while it animates shut instead of going blank.
   */
  const [open, setOpen] = useState(false);
  const [editingRole, setEditingRole] = useState<RoleRow | null>(null);
  const [origin, setOrigin] = useState<DOMRect | null>(null);

  function openPermissions(role: RoleRow, e: React.MouseEvent<HTMLButtonElement>) {
    // `currentTarget`, never `target` — the click can land on a text node
    // inside the button, which has no `getBoundingClientRect` of its own.
    setOrigin(e.currentTarget.getBoundingClientRect());
    setEditingRole(role);
    setOpen(true);
  }

  const roleColumns: Column<RoleRow>[] = [
    { header: "Name", cell: (r) => <span className="font-medium">{r.name}</span> },
    {
      header: "Description",
      cell: (r) => (
        <span className="text-muted-foreground">{r.description ?? "—"}</span>
      ),
    },
    {
      header: "Type",
      cell: (r) =>
        r.is_system ? (
          <span className="text-xs text-muted-foreground">System</span>
        ) : (
          <span className="text-xs text-foreground">Custom</span>
        ),
    },
    {
      /* Not row CRUD — this opens the permission editor for the row, and its
         label reports that state. A labelled column says so; the unnamed
         action cell that <RowActions> owns would not (LAYOUT.md §6a). */
      header: "Permissions",
      align: "right",
      cell: (r) => (
        <Button
          variant={open && editingRole?.id === r.id ? "subtle" : "ghost"}
          size="sm"
          onClick={(e) => openPermissions(r, e)}
        >
          {open && editingRole?.id === r.id ? "Editing" : "Edit Permissions"}
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button
          variant="primary"
          size="md"
          onClick={() => setShowCreate((v) => !v)}
        >
          + New Role
        </Button>
      </div>

      {showCreate && (
        <CreateRoleForm onDone={() => setShowCreate(false)} />
      )}

      <DataTable
        columns={withCreatedColumns(roleColumns, roles)}
        rows={roles}
        getKey={(r) => r.id}
      />

      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={editingRole ? `Permissions — ${editingRole.name}` : "Permissions"}
        // "md", not "sm": this is a hand-rolled <table>, not a ChildGrid, so
        // the ChildGrid breakpoint reasoning in AGENTS.md's "A sub-detail
        // Sheet's size" does not apply — but 16 modules × 6 actions is
        // genuinely wide content (a module label plus six checkbox columns),
        // and "sm"'s ~408px would force it into a horizontal scroll or
        // truncate every module name. "md" gives it room to sit flat.
        size="md"
        origin={origin}
        footer={
          <span className="mr-auto text-xs text-muted-foreground">
            Every change here saves immediately — there is no separate Save
            button.
          </span>
        }
      >
        {editingRole && (
          <PermissionMatrix
            role={editingRole}
            permissions={permissions}
            rolePermissions={rolePermissions}
          />
        )}
      </Sheet>
    </div>
  );
}
