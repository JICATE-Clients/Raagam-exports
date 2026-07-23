"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { type Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { MasterListShell } from "@/components/masters/master-list-shell";
import { DeleteConfirmButton } from "@/components/masters/delete-confirm-button";
import { AccountGroupPicker } from "@/components/masters/account-group-picker";
import { LookupDialogPicker } from "@/components/masters/lookup-dialog-picker";
import type { ConfigLookup } from "@/lib/masters/extras-types";
import {
  createAccountGroup,
  updateAccountGroup,
  deleteAccountGroup,
} from "@/lib/masters/account-group-actions";
import {
  NATURE_OF_GROUP,
  type AccountGroup,
  type AccountGroupInput,
  type NatureOfGroup,
} from "@/lib/masters/account-group-types";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean };

const blankForm = () => ({
  parent_id: null as string | null,
  short_name: "",
  name: "",
  nature_of_group: "" as "" | NatureOfGroup,
  debit_schedule_id: null as string | null,
  credit_schedule_id: null as string | null,
  inactive: false,
});

export function AccountGroupMasterScreen({
  rows,
  schedules,
  perms,
}: {
  rows: AccountGroup[];
  schedules: ConfigLookup[];
  perms: Perms;
}) {
  const router = useRouter();
  const { success, error } = useToast();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(blankForm());

  const set = (patch: Partial<ReturnType<typeof blankForm>>) => setForm((f) => ({ ...f, ...patch }));

  const nameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of rows) m.set(r.id, r.name);
    return m;
  }, [rows]);

  function openAdd() {
    setEditId(null);
    setForm(blankForm());
    setOpen(true);
  }
  function openEdit(r: AccountGroup) {
    setEditId(r.id);
    setForm({
      parent_id: r.parent_id,
      short_name: r.short_name ?? "",
      name: r.name,
      nature_of_group: r.nature_of_group ?? "",
      debit_schedule_id: r.debit_schedule_id,
      credit_schedule_id: r.credit_schedule_id,
      inactive: r.inactive,
    });
    setOpen(true);
  }

  function submit() {
    startTransition(async () => {
      const payload: AccountGroupInput = {
        parent_id: form.parent_id,
        // Create derives the code from Name; edit keeps the record's original
        // stored short_name (it can be a logic key referenced elsewhere).
        short_name: editId ? form.short_name || null : form.name.trim() || null,
        name: form.name.trim(),
        nature_of_group: form.nature_of_group ? form.nature_of_group : null,
        debit_schedule_id: form.debit_schedule_id,
        credit_schedule_id: form.credit_schedule_id,
        inactive: form.inactive,
      };
      const res = editId ? await updateAccountGroup(editId, payload) : await createAccountGroup(payload);
      if (res.ok) {
        success(editId ? "Account group updated." : "Account group added.");
        setOpen(false);
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  function remove(r: AccountGroup) {
    startTransition(async () => {
      const res = await deleteAccountGroup(r.id);
      if (res.ok) {
        success("Account group deleted.");
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  const columns: Column<AccountGroup>[] = [
    { header: "Name", cell: (r) => <span className="text-sm font-medium text-foreground">{r.name}</span> },
    {
      header: "Under",
      cell: (r) => (
        <span className="text-sm text-muted-foreground">
          {r.parent_id ? nameById.get(r.parent_id) ?? "—" : "—"}
        </span>
      ),
    },
    { header: "Nature", cell: (r) => <span className="text-sm">{r.nature_of_group ?? "—"}</span> },
    {
      header: "Status",
      cell: (r) => (
        <StatusPill tone={r.inactive ? "danger" : "success"}>{r.inactive ? "Inactive" : "Active"}</StatusPill>
      ),
    },
    {
      header: "",
      align: "right",
      cell: (r) => (
        <div className="flex justify-end gap-1">
          {perms.canEdit && (
            <Button variant="ghost" size="sm" onClick={() => openEdit(r)}>
              Edit
            </Button>
          )}
          {perms.canDelete && <DeleteConfirmButton isPending={isPending} onConfirm={() => remove(r)} />}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <MasterListShell
        rows={rows}
        getKey={(r) => r.id}
        perms={perms}
        searchText={(r) =>
          [r.short_name, r.name, r.nature_of_group, r.parent_id ? nameById.get(r.parent_id) : null]
            .filter(Boolean)
            .join(" ")
        }
        searchPlaceholder="Search account group…"
        statusOf={(r) => (r.inactive ? "inactive" : "active")}
        addLabel="+ Add Account Group"
        onAdd={openAdd}
        columns={columns}
        empty="No account groups yet."
        mobile={{
          title: (r) => r.name,
          meta: (r) =>
            `${r.nature_of_group ?? "—"}${r.parent_id ? ` · under ${nameById.get(r.parent_id) ?? "—"}` : ""}`,
          pill: (r) => (
            <StatusPill tone={r.inactive ? "danger" : "success"}>
              {r.inactive ? "Inactive" : "Active"}
            </StatusPill>
          ),
          onEdit: openEdit,
          onDelete: remove,
        }}
        isPending={isPending}
      />

      {/* editor */}
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={editId ? "Edit Account Group" : "New Account Group"}
        footer={
          <>
            <Button variant="outline" size="md" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button size="md" disabled={isPending || !form.name.trim()} onClick={submit}>
              {isPending ? "Saving…" : "Save"}
            </Button>
          </>
        }
      >
        <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
          <div className="flex items-start gap-3 sm:col-span-2">
            <div className="flex-1">
              <AccountGroupPicker
                groups={rows}
                value={form.parent_id}
                onChange={(id) => set({ parent_id: id })}
                excludeId={editId}
                label="Under"
              />
            </div>
            {editId && (
              <label className="mt-7 flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  className="h-4 w-4 cursor-pointer accent-primary"
                  checked={form.inactive}
                  onChange={(e) => set({ inactive: e.target.checked })}
                />
                <span className="text-sm text-foreground">Inactive</span>
              </label>
            )}
          </div>

          <div>
            <Label htmlFor="ag-name">
              Name <span className="text-danger">*</span>
            </Label>
            <Input
              id="ag-name"
              uppercase
              value={form.name}
              onChange={(e) => set({ name: e.target.value })}
              className="text-base md:text-sm"
            />
          </div>
          <div>
            <Label htmlFor="ag-nature">Nature of Group</Label>
            <Select
              id="ag-nature"
              value={form.nature_of_group}
              onChange={(e) => set({ nature_of_group: e.target.value as "" | NatureOfGroup })}
              className="text-base md:text-sm"
            >
              <option value="">— Select —</option>
              {NATURE_OF_GROUP.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </Select>
          </div>

          <LookupDialogPicker
            kind="account_schedule"
            label="Debit Schedule"
            options={schedules}
            value={form.debit_schedule_id}
            onChange={(id) => set({ debit_schedule_id: id })}
            canCreate={perms.canCreate}
            canEdit={perms.canEdit}
          />
          <LookupDialogPicker
            kind="account_schedule"
            label="Credit Schedule"
            options={schedules}
            value={form.credit_schedule_id}
            onChange={(id) => set({ credit_schedule_id: id })}
            canCreate={perms.canCreate}
            canEdit={perms.canEdit}
          />
        </div>
      </Sheet>
    </div>
  );
}
