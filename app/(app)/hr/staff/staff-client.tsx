"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { StaffInput } from "@/lib/hr/types";
import type { StaffRow, LocationOption } from "@/lib/hr/masters-service";
import { createStaff, updateStaff } from "@/lib/hr/masters-actions";
import { fmtMoney } from "@/lib/format";
import { DataTable } from "@/components/ui/data-table";
import type { Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Card, CardBody } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";

const DEFAULTS: StaffInput = {
  name: "",
  designation: null,
  location_id: null,
  monthly_salary: 0,
  esi_applicable: true,
  pf_applicable: true,
  joined_date: null,
  is_active: true,
};

export default function StaffClient({
  staff,
  locations,
}: {
  staff: StaffRow[];
  locations: LocationOption[];
}) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<StaffInput>(DEFAULTS);

  function openAdd() {
    setForm(DEFAULTS);
    setEditId(null);
    setShowForm(true);
  }

  function openEdit(s: StaffRow) {
    setForm({
      name: s.name,
      designation: s.designation,
      location_id: s.location_id,
      monthly_salary: s.monthly_salary,
      esi_applicable: s.esi_applicable,
      pf_applicable: s.pf_applicable,
      joined_date: s.joined_date,
      is_active: s.is_active,
    });
    setEditId(s.id);
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
        ? await updateStaff(editId, form)
        : await createStaff(form);
      if (result.ok) {
        success(editId ? "Staff updated." : "Staff created.");
        cancel();
        router.refresh();
      } else {
        toastError(result.error);
      }
    });
  }

  const columns: Column<StaffRow>[] = [
    {
      header: "Code",
      cell: (r) => <span className="font-mono text-xs">{r.code ?? "—"}</span>,
    },
    { header: "Name", cell: (r) => r.name },
    { header: "Designation", cell: (r) => r.designation ?? "—" },
    { header: "Location", cell: (r) => r.location_name ?? "—" },
    {
      header: "Monthly Salary",
      align: "right",
      cell: (r) => (
        <span className="tabular-nums">{fmtMoney(r.monthly_salary)}</span>
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
      <div className="flex justify-end">
        <Button variant="primary" size="sm" onClick={openAdd}>
          + Add Staff
        </Button>
      </div>

      {showForm && (
        <Card>
          <CardBody>
            <form onSubmit={handleSubmit} className="grid grid-cols-2 gap-3">
              <div className="col-span-2 text-sm font-semibold text-foreground">
                {editId ? "Edit Staff" : "New Staff"}
              </div>

              <div>
                <Label htmlFor="s-name">Name *</Label>
                <Input
                  id="s-name"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  required
                />
              </div>
              <div>
                <Label htmlFor="s-designation">Designation</Label>
                <Input
                  id="s-designation"
                  value={form.designation ?? ""}
                  onChange={(e) =>
                    setForm({ ...form, designation: e.target.value || null })
                  }
                />
              </div>
              <div>
                <Label htmlFor="s-location">Location</Label>
                <Select
                  id="s-location"
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
                <Label htmlFor="s-salary">Monthly Salary</Label>
                <Input
                  id="s-salary"
                  type="number"
                  min={0}
                  step={0.01}
                  value={form.monthly_salary}
                  onChange={(e) =>
                    setForm({ ...form, monthly_salary: parseFloat(e.target.value) || 0 })
                  }
                />
              </div>
              <div>
                <Label htmlFor="s-joined">Joined Date</Label>
                <Input
                  id="s-joined"
                  type="date"
                  value={form.joined_date ?? ""}
                  onChange={(e) =>
                    setForm({ ...form, joined_date: e.target.value || null })
                  }
                />
              </div>
              <div className="flex items-center gap-4 pt-5">
                <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.esi_applicable}
                    onChange={(e) =>
                      setForm({ ...form, esi_applicable: e.target.checked })
                    }
                    className="h-4 w-4 cursor-pointer"
                  />
                  ESI
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
                  PF
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
        rows={staff}
        getKey={(r) => r.id}
        empty="No staff yet. Add one above."
      />
    </div>
  );
}
