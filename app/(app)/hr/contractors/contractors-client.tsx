"use client";

import { useState, useTransition } from "react";
import { useCreateIntent } from "@/lib/use-create-intent";
import { useRouter } from "next/navigation";
import type { ContractorInput } from "@/lib/hr/types";
import type { ContractorRow, LocationOption } from "@/lib/hr/masters-service";
import { createContractor, updateContractor } from "@/lib/hr/masters-actions";
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

const DEFAULTS: ContractorInput = {
  name: "",
  contact_person: null,
  phone: null,
  location_id: null,
  is_active: true,
};

export default function ContractorsClient({
  contractors,
  locations,
  canCreate = false,
  canExport = false,
  canDelete = false,
}: {
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
  const [form, setForm] = useState<ContractorInput>(DEFAULTS);
  const sel = useRowSelection();

  function openAdd() {
    setForm(DEFAULTS);
    setEditId(null);
    setShowForm(true);
  }

  function openEdit(c: ContractorRow) {
    setForm({
      name: c.name,
      contact_person: c.contact_person,
      phone: c.phone,
      location_id: c.location_id,
      is_active: c.is_active,
    });
    setEditId(c.id);
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
        ? await updateContractor(editId, form)
        : await createContractor(form);
      if (result.ok) {
        success(editId ? "Contractor updated." : "Contractor created.");
        cancel();
        router.refresh();
      } else {
        toastError(result.error);
      }
    });
  }

  const columns: Column<ContractorRow>[] = [
    {
      header: "Code",
      cell: (r) => <span className="font-mono text-xs">{r.code ?? "—"}</span>,
    },
    { header: "Name", cell: (r) => r.name },
    { header: "Contact Person", cell: (r) => r.contact_person ?? "—" },
    { header: "Phone", cell: (r) => r.phone ?? "—" },
    { header: "Location", cell: (r) => r.location_name ?? "—" },
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
          entityKey="contractors"
          rows={contractors}
          canImport={canCreate}
          canExport={canExport}
        />
        <Button variant="primary" size="sm" onClick={openAdd}>
          + Add Contractor
        </Button>
      </div>

      {canDelete && (
        <BulkDeleteBar
          entityKey="contractors"
          selectedIds={sel.selectedIds}
          onClear={sel.clear}
          label="contractors"
        />
      )}

      {showForm && (
        <Card>
          <CardBody>
            <form onSubmit={handleSubmit} className="grid grid-cols-2 gap-3">
              <div className="col-span-2 text-sm font-semibold text-foreground">
                {editId ? "Edit Contractor" : "New Contractor"}
              </div>

              <div className="col-span-2">
                <Label htmlFor="c-name">Name *</Label>
                <Input
                  id="c-name"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  required
                />
              </div>
              <div>
                <Label htmlFor="c-contact">Contact Person</Label>
                <Input
                  id="c-contact"
                  value={form.contact_person ?? ""}
                  onChange={(e) =>
                    setForm({ ...form, contact_person: e.target.value || null })
                  }
                />
              </div>
              <div>
                <Label htmlFor="c-phone">Phone</Label>
                <Input
                  id="c-phone"
                  value={form.phone ?? ""}
                  onChange={(e) =>
                    setForm({ ...form, phone: e.target.value || null })
                  }
                />
              </div>
              <div>
                <Label htmlFor="c-location">Location</Label>
                <Select
                  id="c-location"
                  value={form.location_id ?? ""}
                  onChange={(e) =>
                    setForm({ ...form, location_id: e.target.value || null })
                  }
                >
                  <option value="">— Select —</option>
                  {locations.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="flex items-center gap-2 pt-5">
                <input
                  type="checkbox"
                  id="c-active"
                  checked={form.is_active}
                  onChange={(e) =>
                    setForm({ ...form, is_active: e.target.checked })
                  }
                  className="h-4 w-4 cursor-pointer"
                />
                <label htmlFor="c-active" className="text-sm text-foreground cursor-pointer">
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
        rows={contractors}
        getKey={(r) => r.id}
        empty="No contractors yet. Add one above."
        selectable={canDelete}
        selectedKeys={sel.selectedKeys}
        onToggle={sel.toggle}
        onToggleAll={() => sel.toggleAll(contractors.map((c) => c.id))}
      />
    </div>
  );
}
