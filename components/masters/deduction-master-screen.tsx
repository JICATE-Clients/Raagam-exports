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
  createDeduction,
  updateDeduction,
  deleteDeduction,
} from "@/lib/masters/deduction-actions";
import type { Deduction, DeductionInput, CalcType } from "@/lib/masters/deduction-types";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean };

const blankForm = () => ({
  name: "",
  sequence: "0",
  calc_type: "" as "" | CalcType,
  base_head: false,
  blocked: false,
});

/**
 * Legacy "Deduction" master (HR). Flat header form: auto ID, Name, Sequence,
 * Type (Fixed / Variable radio), Base Head. The simpler sibling of Allowance —
 * no eligibility flags, and the Type radio is the calc mode itself.
 */
export function DeductionMasterScreen({ rows, perms }: { rows: Deduction[]; perms: Perms }) {
  const router = useRouter();
  const { success, error } = useToast();
  const [isPending, startTransition] = useTransition();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editEntryNo, setEditEntryNo] = useState<number | null>(null);
  const [form, setForm] = useState(blankForm());

  const set = (patch: Partial<ReturnType<typeof blankForm>>) => setForm((f) => ({ ...f, ...patch }));

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [String(r.entry_no), r.name, r.calc_type].filter(Boolean).join(" ").toLowerCase().includes(q),
    );
  }, [rows, query]);

  function openAdd() {
    setEditId(null);
    setEditEntryNo(null);
    setForm(blankForm());
    setOpen(true);
  }
  function openEdit(r: Deduction) {
    setEditId(r.id);
    setEditEntryNo(r.entry_no);
    setForm({
      name: r.name,
      sequence: String(r.sequence),
      calc_type: r.calc_type ?? "",
      base_head: r.base_head,
      blocked: r.blocked,
    });
    setOpen(true);
  }

  function submit() {
    startTransition(async () => {
      const payload: DeductionInput = {
        name: form.name.trim(),
        sequence: Number(form.sequence) || 0,
        calc_type: form.calc_type || null,
        base_head: form.base_head,
        blocked: form.blocked,
      };
      const res = editId ? await updateDeduction(editId, payload) : await createDeduction(payload);
      if (res.ok) {
        success(editId ? "Deduction updated." : "Deduction added.");
        setOpen(false);
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  function remove(r: Deduction) {
    startTransition(async () => {
      const res = await deleteDeduction(r.id);
      if (res.ok) {
        success("Deduction deleted.");
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  const columns: Column<Deduction>[] = [
    { header: "ID", cell: (r) => <span className="font-mono text-xs">{r.entry_no}</span> },
    { header: "Name", cell: (r) => <span className="text-sm font-medium text-foreground">{r.name}</span> },
    { header: "Type", cell: (r) => <span className="text-sm text-muted-foreground">{r.calc_type ?? "—"}</span> },
    {
      header: "Base Head",
      cell: (r) => <span className="text-sm text-muted-foreground">{r.base_head ? "Yes" : "—"}</span>,
    },
    { header: "Seq", align: "right", cell: (r) => <span className="tabular-nums text-sm">{r.sequence}</span> },
    {
      header: "Status",
      cell: (r) => (
        <StatusPill tone={r.blocked ? "danger" : "success"}>{r.blocked ? "Blocked" : "Active"}</StatusPill>
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
          placeholder="Search deduction…"
          className="max-w-xs flex-1 basis-full sm:basis-auto"
        />
        <div className="flex-1" />
        {perms.canCreate && (
          <Button size="md" onClick={openAdd}>
            + Add Deduction
          </Button>
        )}
      </div>

      {/* desktop table */}
      <div className="hidden md:block">
        <DataTable columns={columns} rows={filtered} getKey={(r) => r.id} empty="No deductions yet." />
      </div>

      {/* mobile cards */}
      <div className="space-y-2.5 md:hidden">
        {filtered.length === 0 ? (
          <div className="rounded-lg border border-border bg-surface px-4 py-10 text-center text-sm text-muted-foreground">
            No deductions yet.
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
                    {r.calc_type ?? "—"}
                    {r.base_head ? " · Base Head" : ""}
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
        title={editId ? `Edit Deduction #${editEntryNo}` : "New Deduction"}
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
              <Label htmlFor="dd-id">ID</Label>
              <Input id="dd-id" value={editEntryNo ?? "(auto)"} disabled className="text-base md:text-sm" />
            </div>
            <label className="flex items-end gap-2 pb-2.5">
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
            <Label htmlFor="dd-name">Name *</Label>
            <Input
              id="dd-name"
              value={form.name}
              onChange={(e) => set({ name: e.target.value })}
              className="text-base md:text-sm"
            />
          </div>

          <div>
            <Label htmlFor="dd-seq">Sequence</Label>
            <Input
              id="dd-seq"
              type="number"
              min="0"
              value={form.sequence}
              onChange={(e) => set({ sequence: e.target.value })}
              className="text-base md:text-sm"
            />
          </div>

          {/* Type + Base Head band */}
          <div className="rounded-lg border border-border p-3">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Type
            </div>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
              <label className="flex cursor-pointer items-center gap-1.5">
                <input
                  type="radio"
                  name="dd_calc_type"
                  className="h-4 w-4 cursor-pointer accent-primary"
                  checked={form.calc_type === "Fixed"}
                  onChange={() => set({ calc_type: "Fixed" })}
                />
                <span className="text-sm text-foreground">Fixed</span>
              </label>
              <label className="flex cursor-pointer items-center gap-1.5">
                <input
                  type="radio"
                  name="dd_calc_type"
                  className="h-4 w-4 cursor-pointer accent-primary"
                  checked={form.calc_type === "Variable"}
                  onChange={() => set({ calc_type: "Variable" })}
                />
                <span className="text-sm text-foreground">Variable</span>
              </label>
              <div className="flex-1" />
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  className="h-4 w-4 cursor-pointer accent-primary"
                  checked={form.base_head}
                  onChange={(e) => set({ base_head: e.target.checked })}
                />
                <span className="text-sm text-foreground">Base Head</span>
              </label>
            </div>
          </div>
        </div>
      </Sheet>
    </div>
  );
}
