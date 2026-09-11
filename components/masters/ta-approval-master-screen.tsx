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
  name: "",
  apply_condition: "BEFORE_SHIPMENT_DATE" as TaApprovalCondition,
  standard_days: "0",
  is_active: true,
});

const FIELD_SIZE = {
  name: "md",
  apply_condition: "md",
  standard_days: "sm",
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
 * Short Name, Department and Sequence are gone from this form (2026-09-11
 * spec): the Name already identifies the row, every approval is Merchandising
 * in practice, and ordering is computed dynamically from T&A lead times
 * rather than a static number. The columns still exist on the row — see
 * `deriveShortName` in `ta-approval-actions.ts` — because `short_name`
 * MATTERS BEYOND THIS SCREEN: `lib/orders/amendments/service.ts` matches
 * "PPSAMPLE" against it to bridge PP Sample into the production ladder, by
 * convention, never a foreign key. The action derives it from Name on create
 * and never touches it on update, so renaming an approval here cannot break
 * that bridge.
 *
 * Requires Proof is gone from this form too (2026-09-11, same pass). Its
 * column also stays — `lib/ta/approvals-worklist-actions.ts` reads it
 * server-side to refuse "Mark Sent" without an attached proof file, a real
 * enforcement gate. New approvals are created with it `true` (every seeded
 * row already is); an existing row's flag is never touched by an edit here.
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
      name: r.name,
      apply_condition: r.apply_condition,
      standard_days: String(r.standard_days),
      is_active: r.is_active,
    });
    setOpen(true);
  }

  function submit() {
    startTransition(async () => {
      const payload: TaApprovalInput = {
        name: form.name.trim(),
        apply_condition: form.apply_condition,
        standard_days: Number(form.standard_days) || 0,
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
    {
      // font-semibold (client 2026-09-07, Archivo weight spec) — this
      // master's identifying column now that Short Name is gone from the grid.
      header: "Name",
      cell: (r) => <span className="text-sm font-semibold">{r.name}</span>,
    },
    {
      header: "Applies",
      cell: (r) => <span className="text-sm text-muted-foreground">{CONDITION_LABEL[r.apply_condition]}</span>,
    },
    { header: "Std Days", align: "right", cell: (r) => <span className="tabular-nums text-sm">{r.standard_days}</span> },
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
        searchText={(r) => r.name}
        searchPlaceholder="Search approval…"
        statusOf={(r) => (r.is_active ? "active" : "inactive")}
        addLabel="+ Add Approval"
        onAdd={openAdd}
        columns={columns}
        actions={{ onEdit: openEdit, onDelete: remove }}
        empty="No approval milestones yet."
        mobile={{
          title: (r) => r.name,
          meta: (r) => CONDITION_LABEL[r.apply_condition],
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
              disabled={isPending || !!dupError || !form.name.trim()}
              onClick={submit}
            >
              {isPending ? "Saving…" : "Save"}
            </Button>
          </>
        }
      >
        <SectionGrid>
          <DetailSection label="Details" cols={12}>
            <Field label="Name" required size={FIELD_SIZE.name} htmlFor="ta-appr-name">
              <Input
                id="ta-appr-name"
                value={form.name}
                onChange={(e) => set({ name: e.target.value })}
                {...dupFieldProps(dupError, "ta-appr-name")}
              />
              <DuplicateError error={dupError} id="ta-appr-name" />
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
