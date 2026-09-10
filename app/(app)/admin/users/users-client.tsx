"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type {
  ProfileRow,
  UserRoleEntry,
  RoleOption,
  LocationOption,
} from "./page";
import { DataTable } from "@/components/ui/data-table";
import type { Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardBody } from "@/components/ui/card";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { createUser, assignRole, removeRole } from "@/app/(app)/admin/actions";
import { withCreatedColumns } from "@/components/ui/created-columns";

/* ------------------------------------------------------------------ */
/* Create User Form                                                     */
/* ------------------------------------------------------------------ */

const USER_FORM_DEFAULTS = {
  email: "",
  password: "",
  fullName: "",
  employeeCode: "",
  locationId: "",
};

function CreateUserForm({
  locations,
  onDone,
}: {
  locations: LocationOption[];
  onDone: () => void;
}) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();
  const [form, setForm] = useState(USER_FORM_DEFAULTS);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const result = await createUser({
        email: form.email,
        password: form.password,
        fullName: form.fullName,
        employeeCode: form.employeeCode || undefined,
        locationId: form.locationId || undefined,
      });
      if (result.ok) {
        success("User created.");
        setForm(USER_FORM_DEFAULTS);
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
        <CardTitle>New User</CardTitle>
      </CardHeader>
      <CardBody>
        <form onSubmit={handleSubmit} className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="cu-name">Full Name *</Label>
            <Input
              id="cu-name"
              value={form.fullName}
              onChange={(e) => setForm({ ...form, fullName: e.target.value })}
              required
            />
          </div>
          <div>
            <Label htmlFor="cu-email">Email *</Label>
            <Input
              id="cu-email"
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              required
            />
          </div>
          <div>
            <Label htmlFor="cu-password">Temporary Password *</Label>
            <Input
              id="cu-password"
              type="password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              required
              minLength={8}
            />
          </div>
          <div>
            <Label htmlFor="cu-emp">Employee Code</Label>
            <Input
              id="cu-emp"
              value={form.employeeCode}
              onChange={(e) =>
                setForm({ ...form, employeeCode: e.target.value })
              }
            />
          </div>
          <div className="col-span-2">
            <Label htmlFor="cu-loc">Default Location</Label>
            <Select
              id="cu-loc"
              value={form.locationId}
              onChange={(e) => setForm({ ...form, locationId: e.target.value })}
            >
              <option value=""></option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </Select>
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
              {isPending ? "Creating…" : "Create User"}
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Role Management Panel                                               */
/* ------------------------------------------------------------------ */

function RolePanel({
  userId,
  userRoles,
  roles,
  locations,
}: {
  userId: string;
  userRoles: UserRoleEntry[];
  roles: RoleOption[];
  locations: LocationOption[];
}) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();
  const [roleId, setRoleId] = useState(roles[0]?.id ?? "");
  const [locationId, setLocationId] = useState("");

  function handleAssign(e: React.FormEvent) {
    e.preventDefault();
    if (!roleId) return;
    startTransition(async () => {
      const result = await assignRole(
        userId,
        roleId,
        locationId || null,
      );
      if (result.ok) {
        success("Role assigned.");
        router.refresh();
      } else {
        toastError(result.error);
      }
    });
  }

  function handleRemove(userRoleId: string) {
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
          Current Roles
        </p>
        {userRoles.length === 0 ? (
          <p className="text-sm text-muted-foreground">No roles assigned.</p>
        ) : (
          <div className="space-y-1">
            {userRoles.map((ur) => (
              <div
                key={ur.id}
                className="flex items-center justify-between rounded-md border border-border bg-surface-muted px-3 py-1.5"
              >
                <span className="text-sm text-foreground">{ur.role_name}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={isPending}
                  onClick={() => handleRemove(ur.id)}
                  className="text-danger hover:text-danger"
                >
                  Remove
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Assign role form — stacked, not the old 2-column grid: a "sm" Sheet's
          ~368px of content splits into two ~175px <Select>s that badly crowd a
          location name, and the mockup this replaces (approved by the operator)
          showed both fields stacked full-width instead. */}
      <form onSubmit={handleAssign} className="space-y-3 border-t border-border pt-3">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Assign Role
        </p>
        <div>
          <Label htmlFor="ar-role">Role *</Label>
          <Select
            id="ar-role"
            value={roleId}
            onChange={(e) => setRoleId(e.target.value)}
            required
          >
            <option value=""></option>
            {roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="ar-loc">Location (optional)</Label>
          <Select
            id="ar-loc"
            value={locationId}
            onChange={(e) => setLocationId(e.target.value)}
          >
            <option value="">Any</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex justify-end">
          <Button
            type="submit"
            variant="primary"
            size="sm"
            disabled={isPending || !roleId}
          >
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
  profiles,
  userRoles,
  roles,
  locations,
}: {
  profiles: ProfileRow[];
  userRoles: UserRoleEntry[];
  roles: RoleOption[];
  locations: LocationOption[];
}) {
  const [showCreate, setShowCreate] = useState(false);

  /**
   * A SHEET, ANCHORED TO THE ROW — the same fix just applied to Roles &
   * Permissions, mirrored. "Manage" used to open a Card ABOVE the whole table,
   * so a user near the bottom of a long list opened their panel off-screen at
   * the TOP — the same disconnect, in the opposite direction. `open` stays
   * separate from `managingUser` (never nulled on close) so the panel keeps
   * naming the user it was managing while it animates shut.
   */
  const [open, setOpen] = useState(false);
  const [managingUser, setManagingUser] = useState<ProfileRow | null>(null);
  const [origin, setOrigin] = useState<DOMRect | null>(null);

  function openManage(user: ProfileRow, e: React.MouseEvent<HTMLButtonElement>) {
    setOrigin(e.currentTarget.getBoundingClientRect());
    setManagingUser(user);
    setOpen(true);
  }

  // Group roles by user id
  const rolesByUser: Record<string, UserRoleEntry[]> = {};
  for (const ur of userRoles) {
    if (!rolesByUser[ur.user_id]) rolesByUser[ur.user_id] = [];
    rolesByUser[ur.user_id].push(ur);
  }

  const columns: Column<ProfileRow>[] = [
    {
      header: "Name",
      cell: (r) => (
        <span className="font-medium text-foreground">
          {r.full_name ?? "—"}
          {r.is_super_admin && (
            <span className="ml-1.5 text-xs text-muted-foreground">(super admin)</span>
          )}
        </span>
      ),
    },
    {
      header: "Email / Phone",
      cell: (r) => (
        <span className="text-sm text-muted-foreground">
          {r.email ?? r.phone ?? "—"}
        </span>
      ),
    },
    {
      header: "Roles",
      cell: (r) => {
        const assigned = rolesByUser[r.id] ?? [];
        if (assigned.length === 0)
          return <span className="text-xs text-muted-foreground">None</span>;
        return (
          <div className="flex flex-wrap gap-1">
            {assigned.map((ur) => (
              <StatusPill key={ur.id} tone="info">
                {ur.role_name}
              </StatusPill>
            ))}
          </div>
        );
      },
    },
    {
      header: "Status",
      cell: (r) => (
        <StatusPill tone={r.is_active ? "success" : "neutral"}>
          {r.is_active ? "Active" : "Inactive"}
        </StatusPill>
      ),
    },
    {
      /* Not row CRUD — opens the per-user roles/locations Sheet, and its label
         reports that state, the same as the Roles page's Permissions column
         (LAYOUT.md §6a). */
      header: "Manage",
      align: "right",
      cell: (r) => (
        <Button
          variant={open && managingUser?.id === r.id ? "subtle" : "ghost"}
          size="sm"
          onClick={(e) => openManage(r, e)}
        >
          {open && managingUser?.id === r.id ? "Editing" : "Manage"}
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
          + New User
        </Button>
      </div>

      {showCreate && (
        <CreateUserForm
          locations={locations}
          onDone={() => setShowCreate(false)}
        />
      )}

      <DataTable
        columns={withCreatedColumns(columns, profiles)}
        rows={profiles}
        getKey={(r) => r.id}
        empty="No users found."
      />

      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={
          managingUser
            ? `Roles — ${managingUser.full_name ?? managingUser.email ?? "User"}`
            : "Roles"
        }
        // "sm", not "md": unlike the permission matrix this is narrow content
        // — a short role list plus a two-field assign form — exactly the
        // "small config dialog" size exists for.
        size="sm"
        origin={origin}
        footer={
          <span className="mr-auto text-xs text-muted-foreground">
            Role changes save immediately — there is no separate Save button.
          </span>
        }
      >
        {managingUser && (
          <RolePanel
            userId={managingUser.id}
            userRoles={rolesByUser[managingUser.id] ?? []}
            roles={roles}
            locations={locations}
          />
        )}
      </Sheet>
    </div>
  );
}
