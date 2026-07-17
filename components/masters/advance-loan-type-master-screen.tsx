"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { DataTable, type Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import {
  createAdvanceLoanType,
  updateAdvanceLoanType,
  deleteAdvanceLoanType,
} from "@/lib/masters/advance-loan-type-actions";
import {
  LOAN_TYPES,
  type AdvanceLoanType,
  type AdvanceLoanTypeInput,
  type LoanType,
} from "@/lib/masters/advance-loan-type-types";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean };

const BLANK = {
  short_name: "",
  description: "",
  loan_type: "Salary Advance" as LoanType,
  inactive: false,
};

/**
 * Legacy "Advance and Loan Type" master (HR). Flat form: Short Name (required) ·
 * Description · Type (Salary Advance / Monthly Repayment / Loan) · Inactive.
 */
export function AdvanceLoanTypeMasterScreen({ rows, perms }: { rows: AdvanceLoanType[]; perms: Perms }) {
  const router = useRouter();
  const { success, error } = useToast();
  const [isPending, startTransition] = useTransition();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(BLANK);

  const set = (patch: Partial<typeof BLANK>) => setForm((f) => ({ ...f, ...patch }));

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [r.short_name, r.description, r.loan_type].filter(Boolean).join(" ").toLowerCase().includes(q),
    );
  }, [rows, query]);

  function openAdd() {
    setEditId(null);
    setForm(BLANK);
    setOpen(true);
  }
  function openEdit(r: AdvanceLoanType) {
    setEditId(r.id);
    setForm({
      short_name: r.short_name,
      description: r.description ?? "",
      loan_type: r.loan_type,
      inactive: r.inactive,
    });
    setOpen(true);
  }

  function submit() {
    startTransition(async () => {
      const payload: AdvanceLoanTypeInput = {
        short_name: form.short_name.trim(),
        description: form.description.trim() || null,
        loan_type: form.loan_type,
        inactive: form.inactive,
      };
      const res = editId
        ? await updateAdvanceLoanType(editId, payload)
        : await createAdvanceLoanType(payload);
      if (res.ok) {
        success(editId ? "Advance / loan type updated." : "Advance / loan type added.");
        setOpen(false);
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  function remove(r: AdvanceLoanType) {
    startTransition(async () => {
      const res = await deleteAdvanceLoanType(r.id);
      if (res.ok) {
        success("Advance / loan type deleted.");
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  const columns: Column<AdvanceLoanType>[] = [
    { header: "Short Name", cell: (r) => <span className="text-sm font-medium text-foreground">{r.short_name}</span> },
    { header: "Description", cell: (r) => <span className="text-sm text-muted-foreground">{r.description ?? "—"}</span> },
    { header: "Type", cell: (r) => <span className="text-sm text-muted-foreground">{r.loan_type}</span> },
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
          placeholder="Search advance / loan type…"
          className="max-w-xs flex-1 basis-full sm:basis-auto"
        />
        <div className="flex-1" />
        {perms.canCreate && (
          <Button size="md" onClick={openAdd}>
            + Add Advance / Loan Type
          </Button>
        )}
      </div>

      {/* desktop table */}
      <div className="hidden md:block">
        <DataTable columns={columns} rows={filtered} getKey={(r) => r.id} empty="No advance / loan types yet." />
      </div>

      {/* mobile cards */}
      <div className="space-y-2.5 md:hidden">
        {filtered.length === 0 ? (
          <div className="rounded-lg border border-border bg-surface px-4 py-10 text-center text-sm text-muted-foreground">
            No advance / loan types yet.
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
                  <div className="truncate text-[15px] font-semibold text-foreground">{r.short_name}</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {r.loan_type}
                    {r.description ? ` · ${r.description}` : ""}
                  </div>
                </div>
                <StatusPill tone={r.inactive ? "danger" : "success"}>
                  {r.inactive ? "Inactive" : "Active"}
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
        title={editId ? "Edit Advance / Loan Type" : "New Advance / Loan Type"}
        footer={
          <>
            <Button variant="outline" size="md" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button size="md" disabled={isPending || !form.short_name.trim()} onClick={submit}>
              {isPending ? "Saving…" : "Save"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="alt-short">
                Short Name <span className="text-danger">*</span>
              </Label>
              <Input
                id="alt-short"
                value={form.short_name}
                onChange={(e) => set({ short_name: e.target.value })}
                required
                className="text-base md:text-sm"
              />
            </div>
            <label className="flex items-end gap-2 pb-2.5">
              <input
                type="checkbox"
                className="h-4 w-4 cursor-pointer accent-primary"
                checked={form.inactive}
                onChange={(e) => set({ inactive: e.target.checked })}
              />
              <span className="text-sm text-foreground">Inactive</span>
            </label>
          </div>
          <div>
            <Label htmlFor="alt-desc">Description</Label>
            <Input
              id="alt-desc"
              value={form.description}
              onChange={(e) => set({ description: e.target.value })}
              className="text-base md:text-sm"
            />
          </div>
          <div>
            <Label htmlFor="alt-type">Type</Label>
            <Select
              id="alt-type"
              value={form.loan_type}
              onChange={(e) => set({ loan_type: e.target.value as LoanType })}
              className="text-base md:text-sm"
            >
              {LOAN_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </Select>
          </div>
        </div>
      </Sheet>
    </div>
  );
}
