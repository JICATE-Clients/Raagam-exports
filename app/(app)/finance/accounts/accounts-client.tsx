"use client";

import { useState, useTransition } from "react";
import { useCreateIntent } from "@/lib/use-create-intent";
import { useRouter } from "next/navigation";
import type { GlAccount, GlAccountInput } from "@/lib/finance/types";
import { ACCOUNT_TYPES } from "@/lib/finance/types";
import { createAccount, updateAccount } from "@/lib/finance/gl-actions";
import { DataTable } from "@/components/ui/data-table";
import type { Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import type { StatusTone } from "@/components/ui/status-pill";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Card, CardBody } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";

const ACCOUNT_TYPE_LABELS: Record<string, string> = {
  asset: "Asset",
  liability: "Liability",
  equity: "Equity",
  income: "Income",
  expense: "Expense",
};

const ACCOUNT_TYPE_TONES: Record<string, StatusTone> = {
  asset: "info",
  liability: "warning",
  equity: "neutral",
  income: "success",
  expense: "danger",
};

const EMPTY: GlAccountInput = {
  code: "",
  name: "",
  account_type: "asset",
  is_active: true,
};

export function AccountsClient({
  accounts,
  canCreate,
  canEdit,
}: {
  accounts: GlAccount[];
  canCreate: boolean;
  canEdit: boolean;
}) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();
  const [showForm, setShowForm] = useState(false);
  useCreateIntent(() => setShowForm(true));
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<GlAccountInput>(EMPTY);

  function openAdd() {
    setForm(EMPTY);
    setEditId(null);
    setShowForm(true);
  }

  function openEdit(a: GlAccount) {
    setForm({
      code: a.code,
      name: a.name,
      account_type: a.account_type,
      is_active: a.is_active,
    });
    setEditId(a.id);
    setShowForm(true);
  }

  function cancel() {
    setShowForm(false);
    setEditId(null);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const result = editId
        ? await updateAccount(editId, form)
        : await createAccount(form);
      if (result.ok) {
        success(editId ? "Account updated." : "Account created.");
        cancel();
        router.refresh();
      } else {
        toastError(result.error);
      }
    });
  }

  const columns: Column<GlAccount>[] = [
    {
      header: "Code",
      cell: (r) => <span className="font-mono text-xs font-medium">{r.code}</span>,
    },
    {
      header: "Name",
      cell: (r) => <span className="text-sm">{r.name}</span>,
    },
    {
      header: "Type",
      cell: (r) => (
        <StatusPill tone={ACCOUNT_TYPE_TONES[r.account_type] ?? "neutral"}>
          {ACCOUNT_TYPE_LABELS[r.account_type] ?? r.account_type}
        </StatusPill>
      ),
    },
    {
      header: "Status",
      cell: (r) => (
        <StatusPill tone={r.is_active ? "success" : "neutral"}>
          {r.is_active ? "Active" : "Inactive"}
        </StatusPill>
      ),
    },
    ...(canEdit
      ? [
          {
            header: "" as const,
            align: "right" as const,
            cell: (r: GlAccount) => (
              <Button variant="ghost" size="sm" onClick={() => openEdit(r)}>
                Edit
              </Button>
            ),
          },
        ]
      : []),
  ];

  return (
    <div className="space-y-4">
      {canCreate && (
        <div className="flex justify-end">
          <Button variant="primary" size="sm" onClick={openAdd}>
            + New Account
          </Button>
        </div>
      )}

      {showForm && (
        <Card>
          <CardBody>
            <form onSubmit={handleSubmit} className="grid grid-cols-2 gap-3">
              <div className="col-span-2 text-sm font-semibold text-foreground">
                {editId ? "Edit Account" : "New GL Account"}
              </div>

              <div>
                <Label htmlFor="acc-code">Code *</Label>
                <Input
                  id="acc-code"
                  value={form.code}
                  onChange={(e) => setForm({ ...form, code: e.target.value })}
                  placeholder="e.g. 1001"
                  required
                />
              </div>

              <div>
                <Label htmlFor="acc-name">Name *</Label>
                <Input
                  id="acc-name"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="e.g. Cash and Cash Equivalents"
                  required
                />
              </div>

              <div>
                <Label htmlFor="acc-type">Account type *</Label>
                <Select
                  id="acc-type"
                  value={form.account_type}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      account_type: e.target.value as GlAccountInput["account_type"],
                    })
                  }
                >
                  {ACCOUNT_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {ACCOUNT_TYPE_LABELS[t]}
                    </option>
                  ))}
                </Select>
              </div>

              <div className="flex items-end pb-1">
                <label className="flex cursor-pointer items-center gap-2 text-sm text-foreground">
                  <input
                    type="checkbox"
                    checked={form.is_active}
                    onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
                    className="h-4 w-4 cursor-pointer"
                  />
                  Active
                </label>
              </div>

              <div className="col-span-2 flex justify-end gap-2 pt-1">
                <Button type="button" variant="outline" size="sm" onClick={cancel}>
                  Cancel
                </Button>
                <Button type="submit" variant="primary" size="sm" disabled={isPending}>
                  {isPending ? "Saving…" : "Save"}
                </Button>
              </div>
            </form>
          </CardBody>
        </Card>
      )}

      <DataTable
        columns={columns}
        rows={accounts}
        getKey={(r) => r.id}
        empty="No accounts in the chart of accounts."
      />
    </div>
  );
}
