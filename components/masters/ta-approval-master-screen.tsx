"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Field, type FieldSize } from "@/components/ui/field";
import { DetailSection } from "@/components/masters/detail-section";
import { SectionGrid } from "@/components/masters/section-grid";
import { type Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { MasterListShell } from "@/components/masters/master-list-shell";
import { deletedToast } from "@/lib/masters/delete-message";
import {
  createTaApproval,
  updateTaApproval,
  deleteTaApproval,
} from "@/lib/masters/ta-approval-actions";
import {
  TA_APPROVAL_CONDITIONS,
  type TaApproval,
  type TaApprovalCondition,
  type TaApprovalInput,
} from "@/lib/masters/ta-approval-types";
import { useDuplicateName, dupFieldProps } from "@/lib/masters/use-duplicate-check";
import { DuplicateError } from "@/components/ui/duplicate-error";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean };

const blankForm = () => ({
  short_name: "",
  name: "",
  department: "MERCHANDISING",
  apply_condition: "BEFORE_SHIPMENT_DATE" as TaApprovalCondition,
  standard_days: "0",
  sequence: "0",
  requires_proof: true,
  is_active: true,
});

const FIELD_SIZE = {
  short_name: "sm",
  name: "md",
  department: "sm",
  apply_condition: "md",
  standard_days: "sm",
  sequence: "sm",
  requires_proof: "sm",
  inactive: "sm",
} satisfies Record<string, FieldSize>;

const CONDITION_LABEL: Record<TaApprovalCondition, string> = {
  AFTER_ORDER_DATE: "After Order Date",
  BEFORE_SHIPMENT_DATE: "Before Shipment Date",
};

/**
 * The global Approvals Dictionary (doc/approval.md §2) — 18 technical
 * approval milestones (Fit Sample … GPT Testing). Promoted to a real Master
 * Data screen 2026-09-07; the table itself (`ta_approvals`) already backed
 * the T&A tab's Approvals grid and the T&A Worklist before this screen
 * existed, seeded only by migration.
 *
 * `short_name` MATTERS BEYOND THIS SCREEN. It is what
 * `lib/orders/amendments/actions.ts` matches "PPSAMPLE" against to bridge PP
 * Sample into the production ladder, and what the Cutting Room hardlock
 * matches to find that same row — by convention, never a foreign key (see
 * that file's own comment). Renaming a short_name here silently breaks both.
 */
export function TaApprovalMasterScreen({ rows, perms }: { rows: TaApproval[]; perms: Perms }) {
  const router = useRouter();
  const { success, error } = useToast();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(blankForm());

  const set = (patch: Partial<ReturnType<typeof blankForm>>) => setForm((f) => ({ ...f, ...patch }));

  const dupError = useDuplicateName({
    table: "ta_approvals",
    name: form.name,
    label: "name",
    excludeId: editId ?? undefined,
    enabled: !!form.name.trim(),
    rows,
    rowId: (r) => r.id,
    rowValue: (r) => r.name,
  });

  function openAdd() {
    setEditId(null);
    setForm(blankForm());
    setOpen(true);
  }
  function openEdit(r: TaApproval) {
    setEditId(r.id);
    setForm({
      short_name: r.short_name,
      name: r.name,
      department: r.department,
      apply_condition: r.apply_condition,
      standard_days: String(r.standard_days),
      sequence: String(r.sequence),
      requires_proof: r.requires_proof,
      is_active: r.is_active,
    });
    setOpen(true);
  }

  function submit() {
    startTransition(async () => {
      const payload: TaApprovalInput = {
        short_name: form.short_name.trim().toUpperCase(),
        name: form.name.trim(),
        department: form.department.trim() || "MERCHANDISING",
        apply_condition: form.apply_condition,
        standard_days: Number(form.standard_days) || 0,
        sequence: Number(form.sequence) || 0,
        requires_proof: form.requires_proof,
        is_active: form.is_active,
      };
      const res = editId
        ? await updateTaApproval(editId, payload)
        : await createTaApproval(payload);
      if (res.ok) {
        success(editId ? "Approval updated." : "Approval added.");
        setOpen(false);
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  function remove(r: TaApproval) {
    startTransition(async () => {
      const res = await deleteTaApproval(r.id);
      if (res.ok) {
        success(deletedToast("Approval", res));
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  const columns: Column<TaApproval>[] = [
    { header: "Short Name", cell: (r) => <span className="font-mono text-xs">{r.short_name}</span> },
    { header: "Name", cell: (r) => <span className="text-sm">{r.name}</span> },
    { header: "Department", cell: (r) => <span className="text-sm text-muted-foreground">{r.department}</span> },
    {
      header: "Applies",
      cell: (r) => <span className="text-sm text-muted-foreground">{CONDITION_LABEL[r.apply_condition]}</span>,
    },
    { header: "Std Days", align: "right", cell: (r) => <span className="tabular-nums text-sm">{r.standard_days}</span> },
    {
      header: "Proof",
      cell: (r) => <span className="text-sm text-muted-foreground">{r.requires_proof ? "Required" : "Optional"}</span>,
    },
    {
      header: "Status",
      cell: (r) => (
        <StatusPill tone={r.is_active ? "success" : "danger"}>{r.is_active ? "Active" : "Inactive"}</StatusPill>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <MasterListShell
        rows={rows}
        getKey={(r) => r.id}
        perms={perms}
        searchText={(r) => [r.short_name, r.name, r.department].filter(Boolean).join(" ")}
        searchPlaceholder="Search approval…"
        statusOf={(r) => (r.is_active ? "active" : "inactive")}
        addLabel="+ Add Approval"
        onAdd={openAdd}
        columns={columns}
        actions={{ onEdit: openEdit, onDelete: remove }}
        empty="No approval milestones yet."
        mobile={{
          title: (r) => r.name,
          meta: (r) => `${r.department} · ${CONDITION_LABEL[r.apply_condition]}`,
          pill: (r) => (
            <StatusPill tone={r.is_active ? "success" : "danger"}>
              {r.is_active ? "Active" : "Inactive"}
            </StatusPill>
          ),
          onEdit: openEdit,
          onDelete: remove,
        }}
        isPending={isPending}
      />

      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={editId ? `Edit ${form.name || "Approval"}` : "New Approval"}
        footer={
          <>
            <Button variant="outline" size="md" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              size="md"
              disabled={isPending || !!dupError || !form.short_name.trim() || !form.name.trim()}
              onClick={submit}
            >
              {isPending ? "Saving…" : "Save"}
            </Button>
          </>
        }
      >
        <SectionGrid>
          <DetailSection label="Details" cols={12}>
            <Field label="Short Name" required size={FIELD_SIZE.short_name} htmlFor="ta-appr-short">
              <Input
                id="ta-appr-short"
                value={form.short_name}
                onChange={(e) => set({ short_name: e.target.value })}
              />
            </Field>
            <Field label="Name" required size={FIELD_SIZE.name} htmlFor="ta-appr-name">
              <Input
                id="ta-appr-name"
                value={form.name}
                onChange={(e) => set({ name: e.target.value })}
                {...dupFieldProps(dupError, "ta-appr-name")}
              />
              <DuplicateError error={dupError} id="ta-appr-name" />
            </Field>
            <Field label="Department" size={FIELD_SIZE.department} htmlFor="ta-appr-dept">
              <Input
                id="ta-appr-dept"
                value={form.department}
                onChange={(e) => set({ department: e.target.value })}
              />
            </Field>
            <Field label="Applies" size={FIELD_SIZE.apply_condition} htmlFor="ta-appr-cond">
              <Select
                id="ta-appr-cond"
                value={form.apply_condition}
                onChange={(e) => set({ apply_condition: e.target.value as TaApprovalCondition })}
              >
                {TA_APPROVAL_CONDITIONS.map((c) => (
                  <option key={c} value={c}>
                    {CONDITION_LABEL[c]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Standard Days" size={FIELD_SIZE.standard_days} htmlFor="ta-appr-days">
              <Input
                id="ta-appr-days"
                type="number"
                min="0"
                value={form.standard_days}
                onChange={(e) => set({ standard_days: e.target.value })}
              />
            </Field>
            <Field label="Sequence" size={FIELD_SIZE.sequence} htmlFor="ta-appr-seq">
              <Input
                id="ta-appr-seq"
                type="number"
                min="0"
                value={form.sequence}
                onChange={(e) => set({ sequence: e.target.value })}
              />
            </Field>
            <Field size={FIELD_SIZE.requires_proof}>
              <label className="flex h-8 cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  className="h-4 w-4 cursor-pointer accent-primary"
                  checked={form.requires_proof}
                  onChange={(e) => set({ requires_proof: e.target.checked })}
                />
                <span className="text-sm text-foreground">Requires Proof</span>
              </label>
            </Field>
            {editId && (
              <Field size={FIELD_SIZE.inactive}>
                <label className="flex h-8 cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    className="h-4 w-4 cursor-pointer accent-primary"
                    checked={!form.is_active}
                    onChange={(e) => set({ is_active: !e.target.checked })}
                  />
                  <span className="text-sm text-foreground">Inactive</span>
                </label>
              </Field>
            )}
          </DetailSection>
        </SectionGrid>
      </Sheet>
    </div>
  );
}
