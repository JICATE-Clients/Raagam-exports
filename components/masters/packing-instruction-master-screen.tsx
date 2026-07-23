"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { DataTable, type Column } from "@/components/ui/data-table";
import { PaginationBar } from "@/components/ui/pagination";
import { StatusPill } from "@/components/ui/status-pill";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { usePagination } from "@/lib/use-pagination";
import { useMasterFilter } from "@/lib/masters/use-master-filter";
import { FilterBar } from "@/components/masters/filter-bar";
import { DataIoToolbar } from "@/components/data-io/data-io-toolbar";
import { DetailSection } from "@/components/masters/detail-section";
import { DeleteConfirmButton } from "@/components/masters/delete-confirm-button";
import {
  createPackingInstruction,
  updatePackingInstruction,
  deletePackingInstruction,
} from "@/lib/masters/packing-instruction-actions";
import type { PackingInstruction, PackingInstructionInput } from "@/lib/masters/packing-instruction-types";
import { useDuplicateCheck } from "@/lib/masters/use-duplicate-check";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean; canExport?: boolean; isSuperAdmin?: boolean };

const BLANK = {
  packing_no: "",
  packing_type: "",
  packing_type_new_old: "N",
  reference: "",
  instructions: "",
  packing_charges: "",
  inactive: false,
};

export function PackingInstructionMasterScreen({
  rows,
  perms,
}: {
  rows: PackingInstruction[];
  perms: Perms;
}) {
  const router = useRouter();
  const { success, error } = useToast();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(BLANK);

  const { query, setQuery, filtered, filterValues, setFilter, activeCount, reset } = useMasterFilter(rows, {
    search: (r, q) =>
      [r.packing_type, r.packing_no, r.reference]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q),
    filters: {
      status: (r, v) => (v === "active" ? !r.inactive : v === "inactive" ? !!r.inactive : true),
    },
    initialFilters: { status: "" },
  });

  const pg = usePagination(filtered, 10);

  // Real-time duplicate check on the packing type (mirrors the on-save guard).
  const dupError = useDuplicateCheck({
    table: "packing_instructions",
    name: form.packing_type,
    nameColumn: "packing_type",
    excludeId: editId ?? undefined,
    enabled: !!form.packing_type.trim(),
  });

  function openAdd() {
    setEditId(null);
    setForm(BLANK);
    setOpen(true);
  }
  function openEdit(r: PackingInstruction) {
    setEditId(r.id);
    setForm({
      packing_no: r.packing_no ?? "",
      packing_type: r.packing_type,
      packing_type_new_old: r.packing_type_new_old ?? "N",
      reference: r.reference ?? "",
      instructions: r.instructions ?? "",
      packing_charges: r.packing_charges != null ? String(r.packing_charges) : "",
      inactive: r.inactive,
    });
    setOpen(true);
  }

  function submit() {
    startTransition(async () => {
      const payload: PackingInstructionInput = {
        packing_no: form.packing_no.trim() || null,
        packing_type: form.packing_type.trim(),
        packing_type_new_old: form.packing_type_new_old || null,
        reference: form.reference.trim() || null,
        instructions: form.instructions.trim() || null,
        packing_charges: form.packing_charges ? Number(form.packing_charges) : null,
        inactive: form.inactive,
      };
      const res = editId
        ? await updatePackingInstruction(editId, payload)
        : await createPackingInstruction(payload);
      if (res.ok) {
        success(editId ? "Packing instruction updated." : "Packing instruction added.");
        setOpen(false);
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  function remove(r: PackingInstruction) {
    startTransition(async () => {
      const res = await deletePackingInstruction(r.id);
      if (res.ok) {
        success("Packing instruction deleted.");
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  const columns: Column<PackingInstruction>[] = [
    { header: "Packing No", cell: (r) => <span className="text-sm">{r.packing_no ?? "---"}</span> },
    { header: "Packing Type", cell: (r) => <span className="text-sm">{r.packing_type}</span> },
    {
      header: "New/Old",
      cell: (r) => (
        <span className="text-sm text-muted-foreground">
          {r.packing_type_new_old === "O" ? "Old" : "New"}
        </span>
      ),
    },
    {
      header: "Charges",
      align: "right",
      cell: (r) => (
        <span className="tabular-nums text-sm text-muted-foreground">
          {r.packing_charges != null ? r.packing_charges : "---"}
        </span>
      ),
    },
    {
      header: "Status",
      cell: (r) => (
        <StatusPill tone={r.inactive ? "danger" : "success"}>
          {r.inactive ? "Inactive" : "Active"}
        </StatusPill>
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
      {/* toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <FilterBar
          search={query}
          onSearch={(v) => {
            setQuery(v);
            pg.setPage(1);
          }}
          searchPlaceholder="Search packing instruction..."
          activeCount={activeCount}
          onReset={() => {
            reset();
            pg.setPage(1);
          }}
        >
          <div>
            <Label htmlFor="pi-filter-status">Status</Label>
            <Select
              id="pi-filter-status"
              value={filterValues.status}
              onChange={(e) => {
                setFilter("status", e.target.value);
                pg.setPage(1);
              }}
              className="text-base md:text-sm"
            >
              <option value="">All</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </Select>
          </div>
        </FilterBar>
        <div className="flex flex-1 items-center justify-end gap-2">
          <DataIoToolbar entityKey="packing_instructions" rows={filtered} canExport={perms.canExport} />
          {perms.canCreate && (
            <Button size="md" onClick={openAdd}>
              + Add Packing Instruction
            </Button>
          )}
        </div>
      </div>

      {/* desktop table */}
      <div className="hidden md:block">
        <DataTable columns={columns} rows={pg.paged} getKey={(r) => r.id} empty="No packing instruction records yet." />
      </div>

      {/* mobile cards */}
      <div className="space-y-2.5 md:hidden">
        {pg.paged.length === 0 ? (
          <div className="rounded-lg border border-border bg-surface px-4 py-10 text-center text-sm text-muted-foreground">
            No packing instruction records yet.
          </div>
        ) : (
          pg.paged.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => perms.canEdit && openEdit(r)}
              className="block w-full rounded-xl border border-border bg-surface p-4 text-left active:bg-surface-muted"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-[15px] font-semibold text-foreground">
                    {r.packing_type}
                  </div>
                  {r.packing_no && (
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      {r.packing_no}
                    </div>
                  )}
                </div>
                <StatusPill tone={r.inactive ? "danger" : "success"}>
                  {r.inactive ? "Inactive" : "Active"}
                </StatusPill>
              </div>
            </button>
          ))
        )}
      </div>

      <PaginationBar
        page={pg.page}
        pageCount={pg.pageCount}
        total={pg.total}
        pageSize={pg.pageSize}
        onPageChange={pg.setPage}
        onPageSizeChange={pg.setPageSize}
      />

      {/* editor */}
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={editId ? "Edit Packing Instruction" : "New Packing Instruction"}
        footer={
          <>
            <Button variant="outline" size="md" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button size="md" disabled={isPending || !form.packing_type.trim() || !!dupError} onClick={submit}>
              {isPending ? "Saving..." : "Save"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <DetailSection label="Details">
            <div>
              <Label htmlFor="pi-type">
                Packing Type <span className="text-danger">*</span>
              </Label>
              <Input
                id="pi-type"
                value={form.packing_type}
                onChange={(e) => setForm({ ...form, packing_type: e.target.value })}
                required
                className="text-base md:text-sm"
              />
              {dupError && <p className="mt-1 text-xs text-danger">{dupError}</p>}
              {!editId && (
                <p className="mt-1 text-xs text-muted-foreground">
                  The packing no. is generated automatically from the packing type.
                </p>
              )}
            </div>
            <div>
              <Label htmlFor="pi-newold">New / Old</Label>
              <Select
                id="pi-newold"
                value={form.packing_type_new_old}
                onChange={(e) => setForm({ ...form, packing_type_new_old: e.target.value })}
                className="text-base md:text-sm"
              >
                <option value="N">New</option>
                <option value="O">Old</option>
              </Select>
            </div>
            <div>
              <Label htmlFor="pi-ref">Reference</Label>
              <Input
                id="pi-ref"
                value={form.reference}
                onChange={(e) => setForm({ ...form, reference: e.target.value })}
                className="text-base md:text-sm"
              />
            </div>
            <div>
              <Label htmlFor="pi-instructions">Instructions</Label>
              <Textarea
                id="pi-instructions"
                rows={4}
                value={form.instructions}
                onChange={(e) => setForm({ ...form, instructions: e.target.value })}
                className="text-base md:text-sm"
              />
            </div>
            <div>
              <Label htmlFor="pi-charges">Packing Charges</Label>
              <Input
                id="pi-charges"
                type="number"
                step="any"
                value={form.packing_charges}
                onChange={(e) => setForm({ ...form, packing_charges: e.target.value })}
                className="text-base md:text-sm"
              />
            </div>
          </DetailSection>

          {editId && (
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                className="h-4 w-4 cursor-pointer accent-primary"
                checked={form.inactive}
                onChange={(e) => setForm({ ...form, inactive: e.target.checked })}
              />
              <span className="text-sm text-foreground">Inactive</span>
            </label>
          )}
        </div>
      </Sheet>
    </div>
  );
}
