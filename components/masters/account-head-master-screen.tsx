"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { SectionGrid } from "@/components/masters/section-grid";
import { type Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { MasterListShell } from "@/components/masters/master-list-shell";
import { DeleteConfirmButton } from "@/components/masters/delete-confirm-button";
import { DetailSection } from "@/components/masters/detail-section";
import { AccountGroupPicker } from "@/components/masters/account-group-picker";
import { CostHeadPicker } from "@/components/masters/cost-head-picker";
import {
  createAccountHead,
  updateAccountHead,
  deleteAccountHead,
} from "@/lib/masters/account-head-actions";
import { deletedToast } from "@/lib/masters/delete-message";
import type { AccountHead, AccountHeadInput } from "@/lib/masters/account-head-types";
import type { AccountGroup } from "@/lib/masters/account-group-types";
import type { CostHead } from "@/lib/finance/cost-heads/types";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean };

const blankForm = () => ({
  short_name: "",
  name: "",
  inactive: false,
  debit_group_id: null as string | null,
  credit_group_id: null as string | null,
  cost_head_id: null as string | null,
});

/**
 * CRUD for the legacy "Account Head" master (Associates) — a flat ledger head:
 * Short Name · Inactive · Name · Group Under [If Debits · If Credits] · Cost head.
 * The three ⓘ fields list stored data: If Debits / If Credits via the shared
 * AccountGroupPicker (over account_groups), Cost head via CostHeadPicker (over
 * the finance cost_heads master) — both select-only (edited on their own masters).
 */
export function AccountHeadMasterScreen({
  rows,
  accountGroups,
  costHeads,
  perms,
}: {
  rows: AccountHead[];
  accountGroups: AccountGroup[];
  costHeads: CostHead[];
  perms: Perms;
}) {
  const router = useRouter();
  const { success, error } = useToast();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(blankForm());

  const set = (patch: Partial<ReturnType<typeof blankForm>>) => setForm((f) => ({ ...f, ...patch }));

  const groupName = useMemo(() => {
    const m = new Map<string, string>();
    for (const g of accountGroups) m.set(g.id, g.name);
    return m;
  }, [accountGroups]);

  function openAdd() {
    setEditId(null);
    setForm(blankForm());
    setOpen(true);
  }
  function openEdit(r: AccountHead) {
    setEditId(r.id);
    setForm({
      short_name: r.short_name ?? "",
      name: r.name,
      inactive: r.inactive,
      debit_group_id: r.debit_group_id,
      credit_group_id: r.credit_group_id,
      cost_head_id: r.cost_head_id,
    });
    setOpen(true);
  }

  function submit() {
    startTransition(async () => {
      const payload: AccountHeadInput = {
        // Create derives the code from Name; edit keeps the record's original
        // stored short_name (it can be a logic key referenced elsewhere).
        short_name: editId ? form.short_name || null : form.name.trim() || null,
        name: form.name.trim(),
        inactive: form.inactive,
        debit_group_id: form.debit_group_id,
        credit_group_id: form.credit_group_id,
        cost_head_id: form.cost_head_id,
      };
      const res = editId ? await updateAccountHead(editId, payload) : await createAccountHead(payload);
      if (res.ok) {
        success(editId ? "Account head updated." : "Account head added.");
        setOpen(false);
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  function remove(r: AccountHead) {
    startTransition(async () => {
      const res = await deleteAccountHead(r.id);
      if (res.ok) {
        success(deletedToast("Account head", res));
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  const columns: Column<AccountHead>[] = [
    {
      header: "Name",
      cell: (r) => <span className="text-sm font-medium text-foreground">{r.name}</span>,
    },
    {
      header: "If Debits",
      cell: (r) => (
        <span className="text-sm text-muted-foreground">
          {r.debit_group_id ? (groupName.get(r.debit_group_id) ?? "—") : "—"}
        </span>
      ),
    },
    {
      header: "If Credits",
      cell: (r) => (
        <span className="text-sm text-muted-foreground">
          {r.credit_group_id ? (groupName.get(r.credit_group_id) ?? "—") : "—"}
        </span>
      ),
    },
    {
      header: "Status",
      cell: (r) => (
        <StatusPill tone={r.inactive ? "danger" : "success"}>
          {r.inactive ? "Inactive" : "Active"}
        </StatusPill>
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
        searchText={(r) => [r.short_name, r.name].filter(Boolean).join(" ")}
        searchPlaceholder="Search account head…"
        statusOf={(r) => (r.inactive ? "inactive" : "active")}
        addLabel="+ Add Account Head"
        onAdd={openAdd}
        columns={columns}
        empty="No account heads yet."
        mobile={{
          title: (r) => r.name,
          meta: (r) =>
            r.debit_group_id ? `Dr ${groupName.get(r.debit_group_id) ?? "—"}` : null,
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
        title={editId ? "Edit Account Head" : "New Account Head"}
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
        {/* "Group Under" is a real legacy grouping, so it stays its own section
            rather than dissolving into a flat list — two small sections side by
            side (LAYOUT.md §1/§4). Both pickers render their own labels.

            The 12-col track here is HALF a sheet wide. Each section gets ~560px
            of the 1180, so one column is ~34px and `sm` buys a 126px control —
            too narrow for a picker holding "CURRENT LIABILITIES". `lg` is the
            honest floor in this column, and two per column is already four
            across the sheet, which is the density the four-per-row rule is
            after (client 2026-07-29). Both sections are flush at 6 + 6 = 12; a
            row past 12 wraps its last field onto an otherwise empty line. */}
        <SectionGrid>
          <DetailSection label="Details" cols={12}>
            <Field label="Name" size="lg" required htmlFor="ah-name">
              <Input
                id="ah-name"
                uppercase
                value={form.name}
                onChange={(e) => set({ name: e.target.value })}
              />
            </Field>
            <Field size="lg">
              <CostHeadPicker
                costHeads={costHeads}
                value={form.cost_head_id}
                onChange={(id) => set({ cost_head_id: id })}
                label="Cost head"
              />
            </Field>
            {/* A tick, alone on the second row either way — `sm` fits the
                caption in this narrow column and stops it inheriting `md`. */}
            {editId && (
              <Field size="sm">
                <label className="flex cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    className="h-4 w-4 cursor-pointer accent-primary"
                    checked={form.inactive}
                    onChange={(e) => set({ inactive: e.target.checked })}
                  />
                  <span className="text-sm text-foreground">Inactive</span>
                </label>
              </Field>
            )}
          </DetailSection>
          <DetailSection label="Group Under" cols={12}>
            <Field size="lg">
              <AccountGroupPicker
                groups={accountGroups}
                value={form.debit_group_id}
                onChange={(id) => set({ debit_group_id: id })}
                label="If Debits"
              />
            </Field>
            <Field size="lg">
              <AccountGroupPicker
                groups={accountGroups}
                value={form.credit_group_id}
                onChange={(id) => set({ credit_group_id: id })}
                label="If Credits"
              />
            </Field>
          </DetailSection>
        </SectionGrid>
      </Sheet>
    </div>
  );
}
