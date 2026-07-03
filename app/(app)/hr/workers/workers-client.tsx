"use client";

import { useState, useTransition } from "react";
import { useCreateIntent } from "@/lib/use-create-intent";
import { useRouter } from "next/navigation";
import { WORKER_TYPES, WORKER_TYPE_LABELS, type WorkerInput } from "@/lib/hr/types";
import type { WorkerRow, ContractorRow, LocationOption } from "@/lib/hr/masters-service";
import { createWorker, updateWorker } from "@/lib/hr/masters-actions";
import { fmtMoney, fmtNumber } from "@/lib/format";
import { DataTable } from "@/components/ui/data-table";
import type { Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Card, CardBody } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";
import { DataIoToolbar } from "@/components/data-io/data-io-toolbar";
import { BulkDeleteBar } from "@/components/data-io/bulk-delete-bar";
import { useRowSelection } from "@/lib/data-io/use-row-selection";

const DEFAULTS: WorkerInput = {
  name: "",
  worker_type: "shift",
  contractor_id: null,
  location_id: null,
  biometric_id: null,
  shift_wage_per_day: 0,
  hourly_wage: 0,
  piece_rate: 0,
  esi_applicable: true,
  pf_applicable: true,
  joined_date: null,
  is_active: true,
};

export default function WorkersClient({
  workers,
  contractors,
  locations,
  canCreate = false,
  canExport = false,
  canDelete = false,
}: {
  workers: WorkerRow[];
  contractors: ContractorRow[];
  locations: LocationOption[];
  canCreate?: boolean;
  canExport?: boolean;
  canDelete?: boolean;
}) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();
  const [showForm, setShowForm] = useState(false);
  useCreateIntent(() => setShowForm(true));
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<WorkerInput>(DEFAULTS);
  const sel = useRowSelection();

  const isPieceType =
    form.worker_type === "contractor_piece" || form.worker_type === "company_piece";
  const isContractorPiece = form.worker_type === "contractor_piece";

  function openAdd() {
    setForm(DEFAULTS);
    setEditId(null);
    setShowForm(true);
  }

  function openEdit(w: WorkerRow) {
    setForm({
      name: w.name,
      worker_type: w.worker_type,
      contractor_id: w.contractor_id,
      location_id: w.location_id,
      biometric_id: w.biometric_id,
      shift_wage_per_day: w.shift_wage_per_day,
      hourly_wage: w.hourly_wage,
      piece_rate: w.piece_rate,
      esi_applicable: w.esi_applicable,
      pf_applicable: w.pf_applicable,
      joined_date: w.joined_date,
      is_active: w.is_active,
    });
    setEditId(w.id);
    setShowForm(true);
  }

  function cancel() {
    setShowForm(false);
    setEditId(null);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      // Clear irrelevant fields before saving
      const payload: WorkerInput = { ...form };
      if (!isContractorPiece) payload.contractor_id = null;
      if (!isPieceType) payload.piece_rate = 0;

      const result = editId
        ? await updateWorker(editId, payload)
        : await createWorker(payload);
      if (result.ok) {
        success(editId ? "Worker updated." : "Worker created.");
        cancel();
        router.refresh();
      } else {
        toastError(result.error);
      }
    });
  }

  const columns: Column<WorkerRow>[] = [
    {
      header: "Code",
      cell: (r) => <span className="font-mono text-xs">{r.code ?? "—"}</span>,
    },
    { header: "Name", cell: (r) => r.name },
    {
      header: "Type",
      cell: (r) => WORKER_TYPE_LABELS[r.worker_type],
    },
    {
      header: "Contractor",
      cell: (r) =>
        r.worker_type === "contractor_piece"
          ? (r.contractor_name ?? "—")
          : "—",
    },
    { header: "Location", cell: (r) => r.location_name ?? "—" },
    {
      header: "Shift Wage/Day",
      align: "right",
      cell: (r) => (
        <span className="tabular-nums">{fmtMoney(r.shift_wage_per_day)}</span>
      ),
    },
    {
      header: "Piece Rate",
      align: "right",
      cell: (r) =>
        r.worker_type !== "shift" ? (
          <span className="tabular-nums">{fmtNumber(r.piece_rate)}</span>
        ) : (
          "—"
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
    {
      header: "",
      align: "right",
      cell: (r) => (
        <Button variant="ghost" size="sm" onClick={() => openEdit(r)}>
          Edit
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <DataIoToolbar
          entityKey="workers"
          rows={workers}
          canImport={canCreate}
          canExport={canExport}
        />
        <Button variant="primary" size="sm" onClick={openAdd}>
          + Add Worker
        </Button>
      </div>

      {canDelete && (
        <BulkDeleteBar
          entityKey="workers"
          selectedIds={sel.selectedIds}
          onClear={sel.clear}
          label="workers"
        />
      )}

      {showForm && (
        <Card>
          <CardBody>
            <form onSubmit={handleSubmit} className="grid grid-cols-2 gap-3">
              <div className="col-span-2 text-sm font-semibold text-foreground">
                {editId ? "Edit Worker" : "New Worker"}
              </div>

              <div>
                <Label htmlFor="w-name">Name *</Label>
                <Input
                  id="w-name"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  required
                />
              </div>
              <div>
                <Label htmlFor="w-type">Worker Type *</Label>
                <Select
                  id="w-type"
                  value={form.worker_type}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      worker_type: e.target.value as WorkerInput["worker_type"],
                      contractor_id: null,
                    })
                  }
                >
                  {WORKER_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {WORKER_TYPE_LABELS[t]}
                    </option>
                  ))}
                </Select>
              </div>

              {isContractorPiece && (
                <div className="col-span-2">
                  <Label htmlFor="w-contractor">Contractor *</Label>
                  <Select
                    id="w-contractor"
                    value={form.contractor_id ?? ""}
                    onChange={(e) =>
                      setForm({ ...form, contractor_id: e.target.value || null })
                    }
                    required={isContractorPiece}
                  >
                    <option value="">— Select Contractor —</option>
                    {contractors
                      .filter((c) => c.is_active)
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                  </Select>
                </div>
              )}

              <div>
                <Label htmlFor="w-location">Location</Label>
                <Select
                  id="w-location"
                  value={form.location_id ?? ""}
                  onChange={(e) =>
                    setForm({ ...form, location_id: e.target.value || null })
                  }
                >
                  <option value="">— Select —</option>
                  {locations.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.code ? `${l.code} — ` : ""}{l.name}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="w-biometric">Biometric ID</Label>
                <Input
                  id="w-biometric"
                  value={form.biometric_id ?? ""}
                  onChange={(e) =>
                    setForm({ ...form, biometric_id: e.target.value || null })
                  }
                />
              </div>

              {/* Wage fields: shift wage + hourly for all; piece rate for piece types */}
              <div>
                <Label htmlFor="w-shift-wage">Shift Wage / Day</Label>
                <Input
                  id="w-shift-wage"
                  type="number"
                  min={0}
                  step={0.01}
                  value={form.shift_wage_per_day}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      shift_wage_per_day: parseFloat(e.target.value) || 0,
                    })
                  }
                />
              </div>
              <div>
                <Label htmlFor="w-hourly">Hourly Wage (OT base)</Label>
                <Input
                  id="w-hourly"
                  type="number"
                  min={0}
                  step={0.01}
                  value={form.hourly_wage}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      hourly_wage: parseFloat(e.target.value) || 0,
                    })
                  }
                />
              </div>
              {isPieceType && (
                <div>
                  <Label htmlFor="w-piece-rate">Piece Rate</Label>
                  <Input
                    id="w-piece-rate"
                    type="number"
                    min={0}
                    step={0.01}
                    value={form.piece_rate}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        piece_rate: parseFloat(e.target.value) || 0,
                      })
                    }
                  />
                </div>
              )}

              <div>
                <Label htmlFor="w-joined">Joined Date</Label>
                <Input
                  id="w-joined"
                  type="date"
                  value={form.joined_date ?? ""}
                  onChange={(e) =>
                    setForm({ ...form, joined_date: e.target.value || null })
                  }
                />
              </div>

              <div className="col-span-2 flex items-center gap-4">
                <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.esi_applicable}
                    onChange={(e) =>
                      setForm({ ...form, esi_applicable: e.target.checked })
                    }
                    className="h-4 w-4 cursor-pointer"
                  />
                  ESI applicable
                </label>
                <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.pf_applicable}
                    onChange={(e) =>
                      setForm({ ...form, pf_applicable: e.target.checked })
                    }
                    className="h-4 w-4 cursor-pointer"
                  />
                  PF applicable
                </label>
                <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.is_active}
                    onChange={(e) =>
                      setForm({ ...form, is_active: e.target.checked })
                    }
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
        rows={workers}
        getKey={(r) => r.id}
        empty="No workers yet. Add one above."
        selectable={canDelete}
        selectedKeys={sel.selectedKeys}
        onToggle={sel.toggle}
        onToggleAll={() => sel.toggleAll(workers.map((w) => w.id))}
      />
    </div>
  );
}
