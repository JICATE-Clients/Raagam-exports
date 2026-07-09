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
  createEmployeeCategory,
  updateEmployeeCategory,
  deleteEmployeeCategory,
} from "@/lib/masters/employee-category-actions";
import {
  EMPLOYEE_CATEGORY_FOR,
  employeeCategoryForLabel,
  type EmployeeCategory,
  type EmployeeCategoryFor,
  type EmployeeCategoryInput,
} from "@/lib/masters/employee-category-types";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean };

const BLANK = {
  short_name: "",
  name: "",
  for_type: "staff" as EmployeeCategoryFor,
  blocked: false,
};

/**
 * Legacy HR "Employee Category" master. Flat form: Short Name · Name · For
 * (Staff / Worker / Staff-Worker) · Blocked, with Save / Save-As-Draft
 * (draft persists with `is_draft = true`). Twin of the Designation master.
 */
export function EmployeeCategoryMasterScreen({ rows, perms }: { rows: EmployeeCategory[]; perms: Perms }) {
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
      [r.short_name, r.name, employeeCategoryForLabel(r.for_type)]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  }, [rows, query]);

  function openAdd() {
    setEditId(null);
    setForm(BLANK);
    setOpen(true);
  }
  function openEdit(r: EmployeeCategory) {
    setEditId(r.id);
    setForm({
      short_name: r.short_name ?? "",
      name: r.name,
      for_type: r.for_type,
      blocked: r.blocked,
    });
    setOpen(true);
  }

  function submit(asDraft: boolean) {
    startTransition(async () => {
      const payload: EmployeeCategoryInput = {
        short_name: form.short_name.trim() || null,
        name: form.name.trim(),
        for_type: form.for_type,
        blocked: form.blocked,
        is_draft: asDraft,
      };
      const res = editId
        ? await updateEmployeeCategory(editId, payload)
        : await createEmployeeCategory(payload);
      if (res.ok) {
        success(editId ? "Employee category updated." : asDraft ? "Saved as draft." : "Employee category added.");
        setOpen(false);
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  function remove(r: EmployeeCategory) {
    startTransition(async () => {
      const res = await deleteEmployeeCategory(r.id);
      if (res.ok) {
        success("Employee category deleted.");
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  function statusPill(r: EmployeeCategory) {
    if (r.is_draft) return <StatusPill tone="warning">Draft</StatusPill>;
    if (r.blocked) return <StatusPill tone="danger">Blocked</StatusPill>;
    return <StatusPill tone="success">Active</StatusPill>;
  }

  const columns: Column<EmployeeCategory>[] = [
    { header: "Short Name", cell: (r) => <span className="text-sm">{r.short_name ?? "—"}</span> },
    {
      header: "Name",
      cell: (r) => <span className="text-sm font-medium text-foreground">{r.name}</span>,
    },
    {
      header: "For",
      cell: (r) => <span className="text-sm text-muted-foreground">{employeeCategoryForLabel(r.for_type)}</span>,
    },
    { header: "Status", cell: (r) => statusPill(r) },
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
          placeholder="Search employee category…"
          className="max-w-xs flex-1 basis-full sm:basis-auto"
        />
        <div className="flex-1" />
        {perms.canCreate && (
          <Button size="md" onClick={openAdd}>
            + Add Employee Category
          </Button>
        )}
      </div>

      {/* desktop table */}
      <div className="hidden md:block">
        <DataTable columns={columns} rows={filtered} getKey={(r) => r.id} empty="No employee categories yet." />
      </div>

      {/* mobile cards */}
      <div className="space-y-2.5 md:hidden">
        {filtered.length === 0 ? (
          <div className="rounded-lg border border-border bg-surface px-4 py-10 text-center text-sm text-muted-foreground">
            No employee categories yet.
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
                  <div className="truncate text-[15px] font-semibold text-foreground">{r.name}</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {r.short_name ? `${r.short_name} · ` : ""}For {employeeCategoryForLabel(r.for_type)}
                  </div>
                </div>
                {statusPill(r)}
              </div>
            </button>
          ))
        )}
      </div>

      {/* editor */}
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={editId ? "Edit Employee Category" : "New Employee Category"}
        footer={
          <>
            <Button variant="outline" size="md" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="outline"
              size="md"
              disabled={isPending || !form.name.trim()}
              onClick={() => submit(true)}
            >
              Save as Draft
            </Button>
            <Button size="md" disabled={isPending || !form.name.trim()} onClick={() => submit(false)}>
              {isPending ? "Saving…" : "Save"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="flex items-start gap-3">
            <div className="flex-1">
              <Label htmlFor="ec-short">Short Name</Label>
              <Input
                id="ec-short"
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
            <Label htmlFor="ec-name">
              Name <span className="text-danger">*</span>
            </Label>
            <Input
              id="ec-name"
              value={form.name}
              onChange={(e) => set({ name: e.target.value })}
              required
              className="text-base md:text-sm"
            />
          </div>

          <div>
            <Label htmlFor="ec-for">For</Label>
            <Select
              id="ec-for"
              value={form.for_type}
              onChange={(e) => set({ for_type: e.target.value as EmployeeCategoryFor })}
              className="text-base md:text-sm"
            >
              {EMPLOYEE_CATEGORY_FOR.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </Select>
          </div>
        </div>
      </Sheet>
    </div>
  );
}
