"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { type Column } from "@/components/ui/data-table";
import { MasterListShell } from "@/components/masters/master-list-shell";
import { DeleteConfirmButton } from "@/components/masters/delete-confirm-button";
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
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editEntryNo, setEditEntryNo] = useState<number | null>(null);
  const [form, setForm] = useState(blankForm());

  const set = (patch: Partial<ReturnType<typeof blankForm>>) => setForm((f) => ({ ...f, ...patch }));

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
        searchText={(r) => [String(r.entry_no), r.entry_date, r.effective_from].join(" ")}
        searchPlaceholder="Search by entry / date…"
        addLabel="+ Add PF/ESI Control"
        onAdd={openAdd}
        columns={columns}
        empty="No PF/ESI controls yet."
        mobile={{
          title: (r) => `Entry #${r.entry_no} · effective ${r.effective_from}`,
          meta: (r) =>
            `Employee ${pct(r.emp_pf_pct)}/${pct(r.emp_esi_pct)} · Employer ${pct(r.empr_pf_pct)}/${pct(r.empr_esi_pct)}`,
          onEdit: openEdit,
          onDelete: remove,
        }}
        isPending={isPending}
      />

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
        <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
          <div className="grid grid-cols-2 gap-3 sm:col-span-2">
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
          <div className="sm:col-span-2 rounded-lg border border-border p-3">
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
          <div className="sm:col-span-2 rounded-lg border border-border p-3">
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
