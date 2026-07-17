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
  createDesignation,
  updateDesignation,
  deleteDesignation,
} from "@/lib/masters/designation-actions";
import {
  DESIGNATION_FOR,
  designationForLabel,
  type Designation,
  type DesignationFor,
  type DesignationInput,
} from "@/lib/masters/designation-types";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean };

const BLANK = {
  name: "",
  for_type: "staff" as DesignationFor,
  inactive: false,
};

/**
 * Legacy HR "Designation" master. Flat form: Designation (name) · For
 * (Staff / Worker / Staff-Worker) · Inactive, with Save / Save-As-Drafts
 * (draft persists with `is_draft = true`).
 */
export function DesignationMasterScreen({ rows, perms }: { rows: Designation[]; perms: Perms }) {
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
      [r.name, designationForLabel(r.for_type)].join(" ").toLowerCase().includes(q),
    );
  }, [rows, query]);

  function openAdd() {
    setEditId(null);
    setForm(BLANK);
    setOpen(true);
  }
  function openEdit(r: Designation) {
    setEditId(r.id);
    setForm({ name: r.name, for_type: r.for_type, inactive: r.inactive });
    setOpen(true);
  }

  function submit(asDraft: boolean) {
    startTransition(async () => {
      const payload: DesignationInput = {
        name: form.name.trim(),
        for_type: form.for_type,
        inactive: form.inactive,
        is_draft: asDraft,
      };
      const res = editId ? await updateDesignation(editId, payload) : await createDesignation(payload);
      if (res.ok) {
        success(editId ? "Designation updated." : asDraft ? "Saved as draft." : "Designation added.");
        setOpen(false);
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  function remove(r: Designation) {
    startTransition(async () => {
      const res = await deleteDesignation(r.id);
      if (res.ok) {
        success("Designation deleted.");
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  function statusPill(r: Designation) {
    if (r.is_draft) return <StatusPill tone="warning">Draft</StatusPill>;
    if (r.inactive) return <StatusPill tone="danger">Inactive</StatusPill>;
    return <StatusPill tone="success">Active</StatusPill>;
  }

  const columns: Column<Designation>[] = [
    { header: "Designation", cell: (r) => <span className="text-sm">{r.name}</span> },
    {
      header: "For",
      cell: (r) => <span className="text-sm text-muted-foreground">{designationForLabel(r.for_type)}</span>,
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
          placeholder="Search designation…"
          className="max-w-xs flex-1 basis-full sm:basis-auto"
        />
        <div className="flex-1" />
        {perms.canCreate && (
          <Button size="md" onClick={openAdd}>
            + Add Designation
          </Button>
        )}
      </div>

      {/* desktop table */}
      <div className="hidden md:block">
        <DataTable columns={columns} rows={filtered} getKey={(r) => r.id} empty="No designations yet." />
      </div>

      {/* mobile cards */}
      <div className="space-y-2.5 md:hidden">
        {filtered.length === 0 ? (
          <div className="rounded-lg border border-border bg-surface px-4 py-10 text-center text-sm text-muted-foreground">
            No designations yet.
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
                    For {designationForLabel(r.for_type)}
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
        title={editId ? "Edit Designation" : "New Designation"}
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
          <div>
            <Label htmlFor="de-name">
              Designation <span className="text-danger">*</span>
            </Label>
            <Input
              id="de-name"
              value={form.name}
              onChange={(e) => set({ name: e.target.value })}
              required
              className="text-base md:text-sm"
            />
          </div>
          <div>
            <Label htmlFor="de-for">For</Label>
            <Select
              id="de-for"
              value={form.for_type}
              onChange={(e) => set({ for_type: e.target.value as DesignationFor })}
              className="text-base md:text-sm"
            >
              {DESIGNATION_FOR.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </Select>
          </div>
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              className="h-4 w-4 cursor-pointer accent-primary"
              checked={form.inactive}
              onChange={(e) => set({ inactive: e.target.checked })}
            />
            <span className="text-sm text-foreground">Inactive</span>
          </label>
        </div>
      </Sheet>
    </div>
  );
}
