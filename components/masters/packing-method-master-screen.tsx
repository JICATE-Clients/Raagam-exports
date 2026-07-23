"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
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
import {
  createPackingMethod,
  updatePackingMethod,
  deactivatePackingMethod,
} from "@/lib/masters/packing-method-actions";
import type { PackingMethod, PackingMethodInput } from "@/lib/masters/packing-method-types";
import { useDuplicateCheck } from "@/lib/masters/use-duplicate-check";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean; canExport?: boolean; isSuperAdmin?: boolean };
type ChildRow = { key: string; sort_order: string; category_name: string };

const BLANK = {
  packing_type: "",
  reference: "",
  description: "",
  packing_charges: "",
  effective_from: "",
  inactive: false,
};

export function PackingMethodMasterScreen({
  rows,
  perms,
}: {
  rows: PackingMethod[];
  perms: Perms;
}) {
  const router = useRouter();
  const { success, error } = useToast();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(BLANK);
  const [childRows, setChildRows] = useState<ChildRow[]>([]);
  const keyRef = useRef(0);
  const nextKey = () => `pm-${++keyRef.current}`;

  const { query, setQuery, filtered, filterValues, setFilter, activeCount, reset } = useMasterFilter(
    rows,
    {
      search: (r, q) =>
        [r.packing_type, r.reference, r.description]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(q),
      filters: {
        status: (r, v) => (v === "active" ? !r.inactive : v === "inactive" ? !!r.inactive : true),
      },
      initialFilters: { status: "" },
    },
  );

  const pg = usePagination(filtered, 10);

  // Real-time duplicate check on the packing type (mirrors the on-save guard).
  const dupError = useDuplicateCheck({
    table: "packing_methods",
    name: form.packing_type,
    nameColumn: "packing_type",
    excludeId: editId ?? undefined,
    enabled: !!form.packing_type.trim(),
  });

  function openAdd() {
    setEditId(null);
    setForm(BLANK);
    setChildRows([]);
    setOpen(true);
  }
  function openEdit(r: PackingMethod) {
    setEditId(r.id);
    setForm({
      packing_type: r.packing_type,
      reference: r.reference ?? "",
      description: r.description ?? "",
      packing_charges: r.packing_charges != null ? String(r.packing_charges) : "",
      effective_from: r.effective_from ?? "",
      inactive: r.inactive,
    });
    setChildRows(
      (r.categories ?? []).map((c) => ({
        key: nextKey(),
        sort_order: c.sort_order != null ? String(c.sort_order) : "",
        category_name: c.category_name,
      })),
    );
    setOpen(true);
  }

  function addChildRow() {
    setChildRows((rs) => [...rs, { key: nextKey(), sort_order: "", category_name: "" }]);
  }
  function updateChild(key: string, field: "sort_order" | "category_name", value: string) {
    setChildRows((rs) =>
      rs.map((r) => (r.key === key ? { ...r, [field]: value } : r)),
    );
  }
  function removeChildRow(key: string) {
    setChildRows((rs) => rs.filter((r) => r.key !== key));
  }

  function submit() {
    startTransition(async () => {
      const payload: PackingMethodInput = {
        packing_type: form.packing_type.trim(),
        reference: form.reference.trim() || null,
        description: form.description.trim() || null,
        packing_charges: form.packing_charges ? Number(form.packing_charges) : null,
        effective_from: form.effective_from || null,
        inactive: form.inactive,
      };
      const children = childRows
        .filter((c) => c.category_name.trim())
        .map((c) => ({
          sort_order: c.sort_order ? Number(c.sort_order) : null,
          category_name: c.category_name.trim(),
        }));
      const res = editId
        ? await updatePackingMethod(editId, payload, children)
        : await createPackingMethod(payload, children);
      if (res.ok) {
        success(editId ? "Packing method updated." : "Packing method added.");
        setOpen(false);
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  function deactivate(r: PackingMethod) {
    startTransition(async () => {
      const res = await deactivatePackingMethod(r.id);
      if (res.ok) {
        success("Packing method marked inactive.");
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  const columns: Column<PackingMethod>[] = [
    { header: "Packing Type", cell: (r) => <span className="text-sm">{r.packing_type}</span> },
    {
      header: "Reference",
      cell: (r) => (
        <span className="text-sm text-muted-foreground">{r.reference ?? "---"}</span>
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
      header: "Categories",
      align: "right",
      cell: (r) => (
        <span className="tabular-nums text-sm text-muted-foreground">
          {r.categories?.length || "---"}
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
          {perms.canDelete && !r.inactive && (
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground hover:text-danger"
              disabled={isPending}
              onClick={() => deactivate(r)}
            >
              Deactivate
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
        <FilterBar
          search={query}
          onSearch={(v) => {
            setQuery(v);
            pg.setPage(1);
          }}
          searchPlaceholder="Search packing method..."
          activeCount={activeCount}
          onReset={() => {
            reset();
            pg.setPage(1);
          }}
        >
          <div>
            <Label htmlFor="pm-filter-status">Status</Label>
            <Select
              id="pm-filter-status"
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
          <DataIoToolbar entityKey="packing_methods" rows={filtered} canExport={perms.canExport} />
          {perms.canCreate && (
            <Button size="md" onClick={openAdd}>
              + Add Packing Method
            </Button>
          )}
        </div>
      </div>

      {/* desktop table */}
      <div className="hidden md:block">
        <DataTable
          columns={columns}
          rows={pg.paged}
          getKey={(r) => r.id}
          empty="No packing method records yet."
        />
      </div>

      {/* mobile cards */}
      <div className="space-y-2.5 md:hidden">
        {pg.paged.length === 0 ? (
          <div className="rounded-lg border border-border bg-surface px-4 py-10 text-center text-sm text-muted-foreground">
            No packing method records yet.
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
                  {r.reference && (
                    <div className="mt-0.5 truncate text-xs text-muted-foreground">
                      {r.reference}
                    </div>
                  )}
                </div>
                <StatusPill tone={r.inactive ? "danger" : "success"}>
                  {r.inactive ? "Inactive" : "Active"}
                </StatusPill>
              </div>
              {(r.categories?.length ?? 0) > 0 && (
                <div className="mt-2 text-[13px] text-muted-foreground">
                  {r.categories!.length} categor{r.categories!.length === 1 ? "y" : "ies"}
                </div>
              )}
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
        title={editId ? "Edit Packing Method" : "New Packing Method"}
        footer={
          <>
            <Button variant="outline" size="md" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              size="md"
              disabled={isPending || !form.packing_type.trim() || !!dupError}
              onClick={submit}
            >
              {isPending ? "Saving..." : "Save"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <DetailSection label="Details" cols={2}>
            <div>
              <Label htmlFor="pm-type">
                Packing Type <span className="text-danger">*</span>
              </Label>
              <Input
                id="pm-type"
                value={form.packing_type}
                onChange={(e) => setForm({ ...form, packing_type: e.target.value })}
                required
                className="text-base md:text-sm"
              />
              {dupError && <p className="mt-1 text-xs text-danger">{dupError}</p>}
            </div>
            <div>
              <Label htmlFor="pm-ref">Reference</Label>
              <Input
                id="pm-ref"
                value={form.reference}
                onChange={(e) => setForm({ ...form, reference: e.target.value })}
                className="text-base md:text-sm"
              />
            </div>
            <div>
              <Label htmlFor="pm-desc">Description</Label>
              <Input
                id="pm-desc"
                uppercase
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                className="text-base md:text-sm"
              />
            </div>
            <div>
              <Label htmlFor="pm-charges">Packing Charges</Label>
              <Input
                id="pm-charges"
                type="number"
                step="any"
                value={form.packing_charges}
                onChange={(e) => setForm({ ...form, packing_charges: e.target.value })}
                className="text-base md:text-sm"
              />
            </div>
            <div>
              <Label htmlFor="pm-effective">Effective From</Label>
              <Input
                id="pm-effective"
                type="date"
                value={form.effective_from}
                onChange={(e) => setForm({ ...form, effective_from: e.target.value })}
                className="text-base md:text-sm"
              />
            </div>
          </DetailSection>

          {/* child grid: categories */}
          <div className="rounded-lg border border-border">
            <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
              <span className="text-sm font-medium">Categories</span>
              <Button variant="ghost" size="sm" onClick={addChildRow}>
                + Add
              </Button>
            </div>
            <div className="space-y-2 p-3">
              {childRows.length === 0 && (
                <p className="text-xs text-muted-foreground">No categories yet.</p>
              )}
              {childRows.map((row, i) => (
                <div key={row.key} className="flex items-center gap-2">
                  <span className="w-6 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                    {i + 1}
                  </span>
                  <Input
                    type="number"
                    placeholder="Order"
                    value={row.sort_order}
                    onChange={(e) => updateChild(row.key, "sort_order", e.target.value)}
                    className="w-20 shrink-0 text-base md:text-sm"
                  />
                  <Input
                    placeholder="Category name"
                    value={row.category_name}
                    onChange={(e) => updateChild(row.key, "category_name", e.target.value)}
                    className="flex-1 text-base md:text-sm"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="shrink-0 text-muted-foreground hover:text-danger"
                    onClick={() => removeChildRow(row.key)}
                    aria-label="Remove category"
                  >
                    ✕
                  </Button>
                </div>
              ))}
            </div>
          </div>

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
