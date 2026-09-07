"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldGrid } from "@/components/ui/field";
import { Toggle } from "@/components/ui/toggle";
import { Select } from "@/components/ui/select";
import { type Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { MasterListShell } from "@/components/masters/master-list-shell";
import { createLeaveType, updateLeaveType, deleteLeaveType } from "@/lib/masters/leave-type-actions";
import { deletedToast } from "@/lib/masters/delete-message";
import {
  LEAVE_APPLIES_TO,
  type LeaveAppliesTo,
  type LeaveType,
  type LeaveTypeInput,
} from "@/lib/masters/leave-type-types";
import { useDuplicateName, dupFieldProps } from "@/lib/masters/use-duplicate-check";
import { DuplicateError } from "@/components/ui/duplicate-error";
import { useSpellSuggest } from "@/lib/masters/use-spell-suggest";
import { SpellSuggestHint } from "@/components/masters/spell-suggest-hint";
import { LEAVE_TYPE_NAMES } from "@/lib/masters/name-vocabularies";

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

  const dupError = useDuplicateName({
    table: "leave_types",
    name: form.code,
    nameColumn: "code",
    label: "ID",
    excludeId: editId ?? undefined,
    enabled: !!form.code.trim(),
    rows,
    rowId: (r) => r.id,
    rowValue: (r) => r.code,
  });

  /**
   * "Did you mean CASUAL LEAVE?" — on DESCRIPTION, not on the field `dupError`
   * guards. That is a deliberate departure from the usual pairing (see
   * simple-master-screen.tsx, where the chip always sits on the dup field).
   *
   * The identity of a leave type is its code, so that is what the duplicate
   * check watches; but a code has no spelling to correct, and the description is
   * the thing an operator actually types words into. Wiring the chip to the code
   * would offer other leave types' IDs as "corrections"; wiring it here offers
   * the statutory names, which is what the field is for. The two are independent
   * on this screen and nothing needs them to agree.
   */
  const nameSuggest = useSpellSuggest({
    name: form.description,
    // The row being edited must not suggest its own description back at you.
    names: rows.filter((r) => r.id !== editId).map((r) => r.description ?? "").filter(Boolean),
    seed: LEAVE_TYPE_NAMES,
    enabled: open,
    onApply: (v) => set({ description: v }),
  });

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
        success(deletedToast("Leave type", res));
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
        actions={{ onEdit: openEdit, onDelete: remove }}
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
            <Button size="md" disabled={isPending || !!dupError || !form.code.trim()} onClick={submit}>
              {isPending ? "Saving…" : "Save"}
            </Button>
          </>
        }
      >
        {/*
          Every field `lg` — two to a line at one width — in a capped track. The
          body this replaces hand-wrote `sm:grid-cols-2`, overrode it per child
          with `sm:col-span-2`, nested a second grid inside a THIRD, and wrapped
          the encashment fields in a bordered card. The flags were loose
          checkboxes bottom-aligned with `pb-1` against no label at all.

          The card had no caption, so it was pure frame — a box drawn inside a
          dialog to say "these three belong together", which the row already
          says. Encash Possible, For and No of Days are now three fields like
          every other (client 2026-09-04: "remove them ... that non coloured
          boxes and lines").
        */}
        <FieldGrid className="max-w-3xl">
          {/* Row 1 — ID · Description */}
          <Field label="ID" size="lg" required htmlFor="lt-code">
            <Input
              uppercase
              id="lt-code"
              value={form.code}
              onChange={(e) => set({ code: e.target.value })}
              required
              {...dupFieldProps(dupError, "lt-code")}
            />
            <DuplicateError error={dupError} id="lt-code" />
          </Field>

          <Field label="Description" size="lg" htmlFor="lt-desc">
            <Input
              id="lt-desc"
              uppercase
              value={form.description}
              onChange={(e) => set({ description: e.target.value })}
              // ↓ into the suggestion strip, Enter applies, Esc dismisses.
              onKeyDown={nameSuggest.onKeyDown}
            />
            <SpellSuggestHint
              suggestions={nameSuggest.suggestions}
              existing={nameSuggest.existing}
              activeIndex={nameSuggest.activeIndex}
              onApply={(v) => set({ description: v })}
            />
          </Field>

          {/* Row 2 — For · No of Days */}
          <Field label="For" size="lg" htmlFor="lt-for">
            <Select
              id="lt-for"
              value={form.applies_to}
              onChange={(e) => set({ applies_to: e.target.value as LeaveAppliesTo })}
            >
              {LEAVE_APPLIES_TO.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="No of Days (Yearly)" size="lg" htmlFor="lt-days">
            <Input
              id="lt-days"
              type="number"
              min="0"
              step="0.01"
              value={form.no_of_days}
              onChange={(e) => set({ no_of_days: e.target.value })}
            />
          </Field>

          {/*
            Row 3 — the three booleans, each a field of its own.

            Encash Possible was a Yes/No RADIO PAIR over a boolean, which is two
            controls and a legend to say what a switch says with one. Loss Of Pay
            and Inactive were bare checkboxes with no label above them, so
            nothing lined up with the fields on either side. All three are now
            switches, matching every other boolean in this sub-module.
          */}
          <Field label="Encash Possible" size="lg">
            <div className="flex h-8 items-center">
              <Toggle
                checked={form.encash_possible}
                onChange={(v) => set({ encash_possible: v })}
                label="Encashable"
              />
            </div>
          </Field>

          <Field label="Loss Of Pay" size="lg">
            <div className="flex h-8 items-center">
              <Toggle
                checked={form.loss_of_pay}
                onChange={(v) => set({ loss_of_pay: v })}
                label="Unpaid"
              />
            </div>
          </Field>

          {/*
            Status is always on the form, add included — `submit()` sends
            `inactive` on a create exactly as on an update, so a row could
            always have been saved inactive and nothing on screen let anyone
            say so (client 2026-09-04).
          */}
          <Field label="Status" size="lg">
            <div className="flex h-8 items-center">
              <Toggle
                checked={form.inactive}
                onChange={(v) => set({ inactive: v })}
                label="Inactive"
              />
            </div>
          </Field>
        </FieldGrid>
      </Sheet>
    </div>
  );
}
