"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DataTable, type Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { AccountGroupPicker } from "@/components/masters/account-group-picker";
import { CostHeadPicker } from "@/components/masters/cost-head-picker";
import {
  createAccountHead,
  updateAccountHead,
  deleteAccountHead,
} from "@/lib/masters/account-head-actions";
import type { AccountHead, AccountHeadInput } from "@/lib/masters/account-head-types";
import type { AccountGroup } from "@/lib/masters/account-group-types";
import type { CostHead } from "@/lib/finance/cost-heads/types";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean };

const blankForm = () => ({
  short_name: "",
  name: "",
  blocked: false,
  debit_group_id: null as string | null,
  credit_group_id: null as string | null,
  cost_head_id: null as string | null,
});

/**
 * CRUD for the legacy "Account Head" master (Associates) — a flat ledger head:
 * Short Name · Blocked · Name · Group Under [If Debits · If Credits] · Cost head.
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
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(blankForm());

  const set = (patch: Partial<ReturnType<typeof blankForm>>) => setForm((f) => ({ ...f, ...patch }));

  const groupName = useMemo(() => {
    const m = new Map<string, string>();
    for (const g of accountGroups) m.set(g.id, g.name);
    return m;
  }, [accountGroups]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [r.short_name, r.name].filter(Boolean).join(" ").toLowerCase().includes(q),
    );
  }, [rows, query]);

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
      blocked: r.blocked,
      debit_group_id: r.debit_group_id,
      credit_group_id: r.credit_group_id,
      cost_head_id: r.cost_head_id,
    });
    setOpen(true);
  }

  function submit() {
    startTransition(async () => {
      const payload: AccountHeadInput = {
        short_name: form.short_name.trim() || null,
        name: form.name.trim(),
        blocked: form.blocked,
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
        success("Account head deleted.");
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  const columns: Column<AccountHead>[] = [
    { header: "Short Name", cell: (r) => <span className="text-sm">{r.short_name ?? "—"}</span> },
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
        <StatusPill tone={r.blocked ? "danger" : "success"}>
          {r.blocked ? "Blocked" : "Active"}
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
          {perms.canDelete && (
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground hover:text-danger"
              disabled={isPending}
              onClick={() => remove(r)}
            >
              Delete
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      {/* toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search account head…"
          className="max-w-xs flex-1 basis-full sm:basis-auto"
        />
        <div className="flex-1" />
        {perms.canCreate && (
          <Button size="md" onClick={openAdd}>
            + Add Account Head
          </Button>
        )}
      </div>

      {/* desktop table */}
      <div className="hidden md:block">
        <DataTable columns={columns} rows={filtered} getKey={(r) => r.id} empty="No account heads yet." />
      </div>

      {/* mobile cards */}
      <div className="space-y-2.5 md:hidden">
        {filtered.length === 0 ? (
          <div className="rounded-lg border border-border bg-surface px-4 py-10 text-center text-sm text-muted-foreground">
            No account heads yet.
          </div>
        ) : (
          filtered.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => perms.canEdit && openEdit(r)}
              className="block w-full rounded-xl border border-border bg-surface p-4 text-left active:bg-surface-muted"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[15px] font-semibold text-foreground">{r.name}</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {r.short_name ?? "—"}
                    {r.debit_group_id ? ` · Dr ${groupName.get(r.debit_group_id) ?? "—"}` : ""}
                  </div>
                </div>
                <StatusPill tone={r.blocked ? "danger" : "success"}>
                  {r.blocked ? "Blocked" : "Active"}
                </StatusPill>
              </div>
            </button>
          ))
        )}
      </div>

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
        <div className="space-y-4">
          <div className="flex items-start gap-3">
            <div className="flex-1">
              <Label htmlFor="ah-short">Short Name</Label>
              <Input
                id="ah-short"
                value={form.short_name}
                onChange={(e) => set({ short_name: e.target.value })}
                className="text-base md:text-sm"
              />
            </div>
            <label className="mt-7 flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                className="h-4 w-4 cursor-pointer accent-primary"
                checked={form.blocked}
                onChange={(e) => set({ blocked: e.target.checked })}
              />
              <span className="text-sm text-foreground">Blocked</span>
            </label>
          </div>

          <div>
            <Label htmlFor="ah-name">
              Name <span className="text-danger">*</span>
            </Label>
            <Input
              id="ah-name"
              value={form.name}
              onChange={(e) => set({ name: e.target.value })}
              className="text-base md:text-sm"
            />
          </div>

          {/* Group Under */}
          <div className="rounded-lg border border-border">
            <div className="border-b border-border px-3 py-2.5 text-sm font-medium text-foreground">
              Group Under
            </div>
            <div className="grid grid-cols-1 gap-3 p-3 sm:grid-cols-2">
              <AccountGroupPicker
                groups={accountGroups}
                value={form.debit_group_id}
                onChange={(id) => set({ debit_group_id: id })}
                label="If Debits"
              />
              <AccountGroupPicker
                groups={accountGroups}
                value={form.credit_group_id}
                onChange={(id) => set({ credit_group_id: id })}
                label="If Credits"
              />
            </div>
          </div>

          <CostHeadPicker
            costHeads={costHeads}
            value={form.cost_head_id}
            onChange={(id) => set({ cost_head_id: id })}
            label="Cost head"
          />
        </div>
      </Sheet>
    </div>
  );
}
