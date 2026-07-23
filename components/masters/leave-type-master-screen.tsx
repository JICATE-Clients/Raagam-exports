"use client";

import { useState, useTransition } from "react";
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
import { createLeaveType, updateLeaveType, deleteLeaveType } from "@/lib/masters/leave-type-actions";
import {
  LEAVE_APPLIES_TO,
  type LeaveAppliesTo,
  type LeaveType,
  type LeaveTypeInput,
} from "@/lib/masters/leave-type-types";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean };

const blankForm = () => ({
  code: "",
  description: "",
  loss_of_pay: false,
  encash_possible: true,
  applies_to: "Both" as LeaveAppliesTo,
  no_of_days: "0",
  inactive: false,
});

/**
 * Legacy "Leave Type" master (HR). Flat header form: ID (code) · Loss Of Pay ·
 * Inactive · Description · Encash Possible (Yes/No radio) · For (Both/Male/Female)
 * · No of Days (yearly allotment).
 */
export function LeaveTypeMasterScreen({ rows, perms }: { rows: LeaveType[]; perms: Perms }) {
  const router = useRouter();
  const { success, error } = useToast();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(blankForm());

  const set = (patch: Partial<ReturnType<typeof blankForm>>) => setForm((f) => ({ ...f, ...patch }));

  function openAdd() {
    setEditId(null);
    setForm(blankForm());
    setOpen(true);
  }
  function openEdit(r: LeaveType) {
    setEditId(r.id);
    setForm({
      code: r.code ?? "",
      description: r.description ?? "",
      loss_of_pay: r.loss_of_pay,
      encash_possible: r.encash_possible,
      applies_to: r.applies_to ?? "Both",
      no_of_days: String(r.no_of_days),
      inactive: r.inactive,
    });
    setOpen(true);
  }

  function submit() {
    startTransition(async () => {
      const payload: LeaveTypeInput = {
        code: form.code.trim(),
        description: form.description.trim() || null,
        loss_of_pay: form.loss_of_pay,
        encash_possible: form.encash_possible,
        applies_to: form.applies_to,
        no_of_days: Number(form.no_of_days) || 0,
        inactive: form.inactive,
      };
      const res = editId ? await updateLeaveType(editId, payload) : await createLeaveType(payload);
      if (res.ok) {
        success(editId ? "Leave type updated." : "Leave type added.");
        setOpen(false);
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  function remove(r: LeaveType) {
    startTransition(async () => {
      const res = await deleteLeaveType(r.id);
      if (res.ok) {
        success("Leave type deleted.");
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  const columns: Column<LeaveType>[] = [
    { header: "ID", cell: (r) => <span className="font-mono text-xs">{r.code ?? "—"}</span> },
    { header: "Description", cell: (r) => <span className="text-sm">{r.description ?? "—"}</span> },
    { header: "For", cell: (r) => <span className="text-sm text-muted-foreground">{r.applies_to ?? "—"}</span> },
    {
      header: "Days / yr",
      align: "right",
      cell: (r) => <span className="tabular-nums text-sm">{r.no_of_days}</span>,
    },
    {
      header: "Encash",
      cell: (r) => (
        <span className="text-sm text-muted-foreground">{r.encash_possible ? "Yes" : "No"}</span>
      ),
    },
    {
      header: "Status",
      cell: (r) => {
        if (r.inactive) return <StatusPill tone="danger">Inactive</StatusPill>;
        if (r.loss_of_pay) return <StatusPill tone="warning">LOP</StatusPill>;
        return <StatusPill tone="success">Active</StatusPill>;
      },
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
        searchText={(r) => [r.code, r.description, r.applies_to].filter(Boolean).join(" ")}
        searchPlaceholder="Search leave type…"
        statusOf={(r) => (r.inactive ? "inactive" : "active")}
        addLabel="+ Add Leave Type"
        onAdd={openAdd}
        columns={columns}
        empty="No leave types yet."
        mobile={{
          title: (r) => r.code ?? "—",
          meta: (r) => `${r.description ?? "—"} · ${r.applies_to ?? "—"} · ${r.no_of_days}/yr`,
          pill: (r) => (
            <StatusPill tone={r.inactive ? "danger" : r.loss_of_pay ? "warning" : "success"}>
              {r.inactive ? "Inactive" : r.loss_of_pay ? "LOP" : "Active"}
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
        title={editId ? "Edit Leave Type" : "New Leave Type"}
        footer={
          <>
            <Button variant="outline" size="md" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button size="md" disabled={isPending || !form.code.trim()} onClick={submit}>
              {isPending ? "Saving…" : "Save"}
            </Button>
          </>
        }
      >
        <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:col-span-2">
            <div>
              <Label htmlFor="lt-code">
                ID <span className="text-danger">*</span>
              </Label>
              <Input
                id="lt-code"
                value={form.code}
                onChange={(e) => set({ code: e.target.value })}
                required
                className="text-base md:text-sm"
              />
            </div>
            <div className="flex items-end gap-4 pb-1">
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  className="h-4 w-4 cursor-pointer accent-primary"
                  checked={form.loss_of_pay}
                  onChange={(e) => set({ loss_of_pay: e.target.checked })}
                />
                <span className="text-sm text-foreground">Loss Of Pay</span>
              </label>
              {editId && (
                <label className="flex cursor-pointer items-center gap-2">
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
          </div>

          <div>
            <Label htmlFor="lt-desc">Description</Label>
            <Input
              id="lt-desc"
              value={form.description}
              onChange={(e) => set({ description: e.target.value })}
              className="text-base md:text-sm"
            />
          </div>

          {/* Encash Possible + For + No of Days */}
          <div className="sm:col-span-2 rounded-lg border border-border p-3">
            <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
              <div>
                <span className="mr-3 text-sm text-foreground">Encash Possible</span>
                <label className="mr-3 inline-flex cursor-pointer items-center gap-1.5">
                  <input
                    type="radio"
                    name="lt-encash"
                    className="h-4 w-4 cursor-pointer accent-primary"
                    checked={form.encash_possible}
                    onChange={() => set({ encash_possible: true })}
                  />
                  <span className="text-sm text-foreground">Yes</span>
                </label>
                <label className="inline-flex cursor-pointer items-center gap-1.5">
                  <input
                    type="radio"
                    name="lt-encash"
                    className="h-4 w-4 cursor-pointer accent-primary"
                    checked={!form.encash_possible}
                    onChange={() => set({ encash_possible: false })}
                  />
                  <span className="text-sm text-foreground">No</span>
                </label>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="lt-for">For</Label>
                <Select
                  id="lt-for"
                  value={form.applies_to}
                  onChange={(e) => set({ applies_to: e.target.value as LeaveAppliesTo })}
                  className="text-base md:text-sm"
                >
                  {LEAVE_APPLIES_TO.map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="lt-days">No of Days (Yearly)</Label>
                <Input
                  id="lt-days"
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.no_of_days}
                  onChange={(e) => set({ no_of_days: e.target.value })}
                  className="text-base md:text-sm"
                />
              </div>
            </div>
          </div>
        </div>
      </Sheet>
    </div>
  );
}
