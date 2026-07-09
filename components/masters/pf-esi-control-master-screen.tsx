"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import {
  createPfEsiControl,
  updatePfEsiControl,
  deletePfEsiControl,
} from "@/lib/masters/pf-esi-control-actions";
import type { PfEsiControl, PfEsiControlInput } from "@/lib/masters/pf-esi-control-types";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean };

const todayISO = () => new Date().toISOString().slice(0, 10);
const blankForm = () => ({
  entry_date: todayISO(),
  effective_from: todayISO(),
  emp_pf_pct: "0",
  emp_esi_pct: "0",
  empr_pf_pct: "0",
  empr_esi_pct: "0",
});
const pct = (n: number) => `${n.toFixed(2)}%`;

/**
 * PF ESI Control master (HR). Flat, dated rate-version record — Entry No (auto),
 * Date, Effective From, and Employee/Employer PF % + ESI % contributions.
 */
export function PfEsiControlMasterScreen({ rows, perms }: { rows: PfEsiControl[]; perms: Perms }) {
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
      [String(r.entry_no), r.entry_date, r.effective_from].join(" ").toLowerCase().includes(q),
    );
  }, [rows, query]);

  function openAdd() {
    setEditId(null);
    setEditEntryNo(null);
    setForm(blankForm());
    setOpen(true);
  }
  function openEdit(r: PfEsiControl) {
    setEditId(r.id);
    setEditEntryNo(r.entry_no);
    setForm({
      entry_date: r.entry_date,
      effective_from: r.effective_from,
      emp_pf_pct: String(r.emp_pf_pct),
      emp_esi_pct: String(r.emp_esi_pct),
      empr_pf_pct: String(r.empr_pf_pct),
      empr_esi_pct: String(r.empr_esi_pct),
    });
    setOpen(true);
  }

  function submit() {
    startTransition(async () => {
      const payload: PfEsiControlInput = {
        entry_date: form.entry_date,
        effective_from: form.effective_from,
        emp_pf_pct: Number(form.emp_pf_pct) || 0,
        emp_esi_pct: Number(form.emp_esi_pct) || 0,
        empr_pf_pct: Number(form.empr_pf_pct) || 0,
        empr_esi_pct: Number(form.empr_esi_pct) || 0,
      };
      const res = editId
        ? await updatePfEsiControl(editId, payload)
        : await createPfEsiControl(payload);
      if (res.ok) {
        success(editId ? "PF/ESI control updated." : "PF/ESI control added.");
        setOpen(false);
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  function remove(r: PfEsiControl) {
    startTransition(async () => {
      const res = await deletePfEsiControl(r.id);
      if (res.ok) {
        success("PF/ESI control deleted.");
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  const columns: Column<PfEsiControl>[] = [
    { header: "Entry", cell: (r) => <span className="font-mono text-xs">{r.entry_no}</span> },
    { header: "Effective From", cell: (r) => <span className="text-sm">{r.effective_from}</span> },
    {
      header: "Employee (PF / ESI)",
      align: "right",
      cell: (r) => (
        <span className="tabular-nums text-sm text-muted-foreground">
          {pct(r.emp_pf_pct)} / {pct(r.emp_esi_pct)}
        </span>
      ),
    },
    {
      header: "Employer (PF / ESI)",
      align: "right",
      cell: (r) => (
        <span className="tabular-nums text-sm text-muted-foreground">
          {pct(r.empr_pf_pct)} / {pct(r.empr_esi_pct)}
        </span>
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
          placeholder="Search by entry / date…"
          className="max-w-xs flex-1 basis-full sm:basis-auto"
        />
        <div className="flex-1" />
        {perms.canCreate && (
          <Button size="md" onClick={openAdd}>
            + Add PF/ESI Control
          </Button>
        )}
      </div>

      {/* desktop table */}
      <div className="hidden md:block">
        <DataTable columns={columns} rows={filtered} getKey={(r) => r.id} empty="No PF/ESI controls yet." />
      </div>

      {/* mobile cards */}
      <div className="space-y-2.5 md:hidden">
        {filtered.length === 0 ? (
          <div className="rounded-lg border border-border bg-surface px-4 py-10 text-center text-sm text-muted-foreground">
            No PF/ESI controls yet.
          </div>
        ) : (
          filtered.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => perms.canEdit && openEdit(r)}
              className="block w-full rounded-xl border border-border bg-surface p-4 text-left active:bg-surface-muted"
            >
              <div className="text-[15px] font-semibold text-foreground">
                Entry #{r.entry_no} · effective {r.effective_from}
              </div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                Employee {pct(r.emp_pf_pct)}/{pct(r.emp_esi_pct)} · Employer{" "}
                {pct(r.empr_pf_pct)}/{pct(r.empr_esi_pct)}
              </div>
            </button>
          ))
        )}
      </div>

      {/* editor */}
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={editEntryNo ? `Edit PF/ESI Control #${editEntryNo}` : "New PF/ESI Control"}
        footer={
          <>
            <Button variant="outline" size="md" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              size="md"
              disabled={isPending || !form.entry_date || !form.effective_from}
              onClick={submit}
            >
              {isPending ? "Saving…" : "Save"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="pe-entry">Entry No</Label>
              <Input id="pe-entry" value={editEntryNo ?? "(auto)"} disabled className="text-base md:text-sm" />
            </div>
            <div>
              <Label htmlFor="pe-date">Date</Label>
              <Input
                id="pe-date"
                type="date"
                value={form.entry_date}
                onChange={(e) => set({ entry_date: e.target.value })}
                className="text-base md:text-sm"
              />
            </div>
          </div>
          <div>
            <Label htmlFor="pe-eff">Effective From Date</Label>
            <Input
              id="pe-eff"
              type="date"
              value={form.effective_from}
              onChange={(e) => set({ effective_from: e.target.value })}
              className="text-base md:text-sm"
            />
          </div>

          {/* Employee contribution */}
          <div className="rounded-lg border border-border p-3">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Employee Contribution
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="pe-emp-pf">PF %</Label>
                <Input
                  id="pe-emp-pf"
                  type="number"
                  step="0.01"
                  min="0"
                  value={form.emp_pf_pct}
                  onChange={(e) => set({ emp_pf_pct: e.target.value })}
                  className="text-base md:text-sm"
                />
              </div>
              <div>
                <Label htmlFor="pe-emp-esi">ESI %</Label>
                <Input
                  id="pe-emp-esi"
                  type="number"
                  step="0.01"
                  min="0"
                  value={form.emp_esi_pct}
                  onChange={(e) => set({ emp_esi_pct: e.target.value })}
                  className="text-base md:text-sm"
                />
              </div>
            </div>
          </div>

          {/* Employer contribution */}
          <div className="rounded-lg border border-border p-3">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Employer Contribution
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="pe-empr-pf">PF %</Label>
                <Input
                  id="pe-empr-pf"
                  type="number"
                  step="0.01"
                  min="0"
                  value={form.empr_pf_pct}
                  onChange={(e) => set({ empr_pf_pct: e.target.value })}
                  className="text-base md:text-sm"
                />
              </div>
              <div>
                <Label htmlFor="pe-empr-esi">ESI %</Label>
                <Input
                  id="pe-empr-esi"
                  type="number"
                  step="0.01"
                  min="0"
                  value={form.empr_esi_pct}
                  onChange={(e) => set({ empr_esi_pct: e.target.value })}
                  className="text-base md:text-sm"
                />
              </div>
            </div>
          </div>
        </div>
      </Sheet>
    </div>
  );
}
