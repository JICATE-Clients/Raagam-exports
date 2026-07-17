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
import {
  createHostelCategory,
  updateHostelCategory,
  deleteHostelCategory,
} from "@/lib/masters/hostel-category-actions";
import type { HostelCategory, HostelCategoryInput } from "@/lib/masters/hostel-category-types";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean };

const BLANK = {
  code: "",
  name: "",
  inactive: false,
};

/**
 * Legacy "Hostel Category" master (HR). The simplest flat master: Code (manual,
 * optional) · Name (required) · Inactive.
 */
export function HostelCategoryMasterScreen({ rows, perms }: { rows: HostelCategory[]; perms: Perms }) {
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
    return rows.filter((r) => [r.code, r.name].filter(Boolean).join(" ").toLowerCase().includes(q));
  }, [rows, query]);

  function openAdd() {
    setEditId(null);
    setForm(BLANK);
    setOpen(true);
  }
  function openEdit(r: HostelCategory) {
    setEditId(r.id);
    setForm({ code: r.code ?? "", name: r.name, inactive: r.inactive });
    setOpen(true);
  }

  function submit() {
    startTransition(async () => {
      const payload: HostelCategoryInput = {
        code: form.code.trim() || null,
        name: form.name.trim(),
        inactive: form.inactive,
      };
      const res = editId
        ? await updateHostelCategory(editId, payload)
        : await createHostelCategory(payload);
      if (res.ok) {
        success(editId ? "Hostel category updated." : "Hostel category added.");
        setOpen(false);
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  function remove(r: HostelCategory) {
    startTransition(async () => {
      const res = await deleteHostelCategory(r.id);
      if (res.ok) {
        success("Hostel category deleted.");
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  const columns: Column<HostelCategory>[] = [
    { header: "Code", cell: (r) => <span className="font-mono text-xs">{r.code ?? "—"}</span> },
    { header: "Name", cell: (r) => <span className="text-sm font-medium text-foreground">{r.name}</span> },
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
          placeholder="Search hostel category…"
          className="max-w-xs flex-1 basis-full sm:basis-auto"
        />
        <div className="flex-1" />
        {perms.canCreate && (
          <Button size="md" onClick={openAdd}>
            + Add Hostel Category
          </Button>
        )}
      </div>

      {/* desktop table */}
      <div className="hidden md:block">
        <DataTable columns={columns} rows={filtered} getKey={(r) => r.id} empty="No hostel categories yet." />
      </div>

      {/* mobile cards */}
      <div className="space-y-2.5 md:hidden">
        {filtered.length === 0 ? (
          <div className="rounded-lg border border-border bg-surface px-4 py-10 text-center text-sm text-muted-foreground">
            No hostel categories yet.
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
                  <div className="mt-0.5 text-xs text-muted-foreground">{r.code ?? "—"}</div>
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
        title={editId ? "Edit Hostel Category" : "New Hostel Category"}
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
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="hc-code">Code</Label>
              <Input
                id="hc-code"
                value={form.code}
                onChange={(e) => set({ code: e.target.value })}
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
            <Label htmlFor="hc-name">
              Name <span className="text-danger">*</span>
            </Label>
            <Input
              id="hc-name"
              value={form.name}
              onChange={(e) => set({ name: e.target.value })}
              required
              className="text-base md:text-sm"
            />
          </div>
        </div>
      </Sheet>
    </div>
  );
}
