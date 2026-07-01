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
import { useToast } from "@/components/ui/toast";
import { createUser, assignRole, removeRole } from "@/app/(app)/admin/actions";

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
              <option value="">— None —</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.code} — {l.name}
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
  user,
  userRoles,
  roles,
  locations,
  onClose,
}: {
  user: ProfileRow;
  userRoles: UserRoleEntry[];
  roles: RoleOption[];
  locations: LocationOption[];
  onClose: () => void;
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
        user.id,
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
    <Card>
      <CardHeader>
        <CardTitle>
          Roles for {user.full_name ?? user.email ?? "User"}
        </CardTitle>
        <Button variant="ghost" size="sm" onClick={onClose}>
          Close
        </Button>
      </CardHeader>
      <CardBody className="space-y-4">
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

        {/* Assign role form */}
        <form onSubmit={handleAssign} className="border-t border-border pt-3">
          <p className="mb-2 text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Assign Role
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="ar-role">Role *</Label>
              <Select
                id="ar-role"
                value={roleId}
                onChange={(e) => setRoleId(e.target.value)}
                required
              >
                <option value="">— Select —</option>
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
                <option value="">— Any —</option>
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.code} — {l.name}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          <div className="mt-3 flex justify-end">
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
      </CardBody>
    </Card>
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
  const [managingUserId, setManagingUserId] = useState<string | null>(null);

  // Group roles by user id
  const rolesByUser: Record<string, UserRoleEntry[]> = {};
  for (const ur of userRoles) {
    if (!rolesByUser[ur.user_id]) rolesByUser[ur.user_id] = [];
    rolesByUser[ur.user_id].push(ur);
  }

  const managingUser =
    managingUserId != null
      ? profiles.find((p) => p.id === managingUserId) ?? null
      : null;

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
      header: "",
      align: "right",
      cell: (r) => (
        <Button
          variant="ghost"
          size="sm"
          onClick={() =>
            setManagingUserId(managingUserId === r.id ? null : r.id)
          }
        >
          Manage
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button
          variant="primary"
          size="sm"
          onClick={() => {
            setShowCreate((v) => !v);
            setManagingUserId(null);
          }}
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

      {managingUser && (
        <RolePanel
          user={managingUser}
          userRoles={rolesByUser[managingUser.id] ?? []}
          roles={roles}
          locations={locations}
          onClose={() => setManagingUserId(null)}
        />
      )}

      <DataTable
        columns={columns}
        rows={profiles}
        getKey={(r) => r.id}
        empty="No users found."
      />
    </div>
  );
}
