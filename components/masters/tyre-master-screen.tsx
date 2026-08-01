"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Info } from "lucide-react";
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
import { RowActions, rowActionsColumn } from "@/components/ui/row-actions";
import { DetailSection } from "@/components/masters/detail-section";
import { useDuplicateName, dupFieldProps } from "@/lib/masters/use-duplicate-check";
import { DuplicateError } from "@/components/ui/duplicate-error";
import { createTyre, updateTyre, deleteTyre } from "@/lib/masters/tyre-actions";
import type { Tyre, TyreInput } from "@/lib/masters/tyre-types";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean; canExport?: boolean };

const BLANK = {
  code: "",
  name: "",
  brand: "",
  tyre_type: "",
  size: "",
  allowed_retreads: "0",
  retreads_done: "0",
  km_per_retread: "",
  is_active: true,
};

/**
 * Tyre master: unique name (code auto-generated server-side), brand, type, size,
 * retread tracking (km_per_retread required >0 when allowed_retreads > 0),
 * active toggle. Table on desktop, cards on mobile.
 */
export function TyreMasterScreen({ rows, perms }: { rows: Tyre[]; perms: Perms }) {
  const router = useRouter();
  const { success, error } = useToast();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(BLANK);

  const set = (patch: Partial<typeof BLANK>) => setForm((f) => ({ ...f, ...patch }));

  const allowedRetreads = Number(form.allowed_retreads) || 0;
  const needsKm = allowedRetreads > 0;

  const { query, setQuery, filtered, filterValues, setFilter, activeCount, reset, dateFilter } = useMasterFilter(rows, {
    searchKey: (r) => [r.code, r.name, r.brand, r.tyre_type, r.size].filter(Boolean).join(" "),
    filters: {
      status: (r, v) => (v === "active" ? r.is_active : v === "inactive" ? !r.is_active : true),
    },
    initialFilters: { status: "" },
  });

  const pg = usePagination(filtered, 10);

  // Real-time duplicate check (mirrors the on-save guard: name is unique).
  const dupNameError = useDuplicateName({
    table: "tyres",
    name: form.name,
    excludeId: editId ?? undefined,
    enabled: !!form.name.trim(),
    rows,
    rowId: (r) => r.id,
    rowValue: (r) => r.name,
  });

  function openAdd() {
    setEditId(null);
    setForm(BLANK);
    setOpen(true);
  }
  function openEdit(r: Tyre) {
    setEditId(r.id);
    setForm({
      code: r.code,
      name: r.name,
      brand: r.brand ?? "",
      tyre_type: r.tyre_type ?? "",
      size: r.size ?? "",
      allowed_retreads: r.allowed_retreads.toString(),
      retreads_done: r.retreads_done.toString(),
      km_per_retread: r.km_per_retread != null ? r.km_per_retread.toString() : "",
      is_active: r.is_active,
    });
    setOpen(true);
  }

  const canSave =
    form.name.trim().length > 0 &&
    !dupNameError &&
    (!needsKm || (form.km_per_retread !== "" && Number(form.km_per_retread) > 0));

  function submit() {
    startTransition(async () => {
      const payload: TyreInput = {
        code: form.code.trim(),
        name: form.name.trim(),
        brand: form.brand.trim() || null,
        tyre_type: form.tyre_type.trim() || null,
        size: form.size.trim() || null,
        allowed_retreads: Number(form.allowed_retreads) || 0,
        retreads_done: Number(form.retreads_done) || 0,
        km_per_retread:
          needsKm && form.km_per_retread !== "" ? Number(form.km_per_retread) : null,
        is_active: form.is_active,
      };
      const res = editId ? await updateTyre(editId, payload) : await createTyre(payload);
      if (res.ok) {
        success(editId ? "Tyre updated." : "Tyre added.");
        setOpen(false);
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  function remove(r: Tyre) {
    startTransition(async () => {
      const res = await deleteTyre(r.id);
      if (res.ok) {
        success("Tyre deleted.");
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  const columns: Column<Tyre>[] = [
    { header: "Name", cell: (r) => <span className="text-sm font-medium">{r.name}</span> },
    { header: "Brand", cell: (r) => <span className="text-sm text-muted-foreground">{r.brand ?? "—"}</span> },
    { header: "Type", cell: (r) => <span className="text-sm text-muted-foreground">{r.tyre_type ?? "—"}</span> },
    { header: "Size", cell: (r) => <span className="text-sm text-muted-foreground">{r.size ?? "—"}</span> },
    {
      header: "Retreads",
      align: "right",
      cell: (r) => (
        <span className="tabular-nums text-sm text-muted-foreground">
          {r.retreads_done}/{r.allowed_retreads}
        </span>
      ),
    },
    {
      header: "Status",
      cell: (r) => (
        <StatusPill tone={r.is_active ? "success" : "danger"}>
          {r.is_active ? "Active" : "Inactive"}
        </StatusPill>
      ),
    },
    rowActionsColumn((r) => (
      <RowActions
        label={r.name}
        onEdit={() => openEdit(r)}
        onDelete={() => remove(r)}
        canEdit={perms.canEdit}
        canDelete={perms.canDelete}
        isPending={isPending}
      />
    )),
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
          searchPlaceholder="Search tyre…"
          activeCount={activeCount}
          dateFilter={{
            ...dateFilter,
            onChange: (v) => {
              dateFilter.onChange(v);
              pg.setPage(1);
            },
          }}
          onReset={() => {
            reset();
            pg.setPage(1);
          }}
        >
          <div>
            <Label htmlFor="tyr-filter-status">Status</Label>
            <Select
              id="tyr-filter-status"
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
          <DataIoToolbar entityKey="tyres" rows={filtered} canExport={perms.canExport} />
          {perms.canCreate && (
            <Button size="md" onClick={openAdd}>
              + Add Tyre
            </Button>
          )}
        </div>
      </div>

      {/* desktop table */}
      <div className="hidden md:block">
        <DataTable columns={columns} rows={pg.paged} getKey={(r) => r.id} empty="No tyre records yet." />
      </div>

      {/* mobile cards */}
      <div className="space-y-2.5 md:hidden">
        {pg.paged.length === 0 ? (
          <div className="rounded-lg border border-border bg-surface px-4 py-10 text-center text-sm text-muted-foreground">
            No tyre records yet.
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
                  <div className="truncate text-[15px] font-semibold text-foreground">{r.name}</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {r.brand ? `${r.brand} · ` : ""}
                    {r.size ? `${r.size} · ` : ""}
                    {`Retreads: ${r.retreads_done}/${r.allowed_retreads}`}
                  </div>
                </div>
                <StatusPill tone={r.is_active ? "success" : "danger"}>
                  {r.is_active ? "Active" : "Inactive"}
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
        title={editId ? "Edit Tyre" : "New Tyre"}
        footer={
          <>
            <Button variant="outline" size="md" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button size="md" disabled={isPending || !canSave} onClick={submit}>
              {isPending ? "Saving…" : "Save"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <DetailSection label="Identity">
            <div>
              <Label htmlFor="tyr-name">
                Name <span className="text-danger">*</span>
              </Label>
              <Input
                id="tyr-name"
                uppercase
                value={form.name}
                onChange={(e) => set({ name: e.target.value })}
                className="text-base md:text-sm"
                {...dupFieldProps(dupNameError, "tyr-name")}
              />
              <DuplicateError error={dupNameError} id="tyr-name" />
            </div>
          </DetailSection>

          <DetailSection label="Details" cols={2}>
            <div>
              <Label htmlFor="tyr-brand">Brand</Label>
              <Input
                uppercase
                id="tyr-brand"
                value={form.brand}
                onChange={(e) => set({ brand: e.target.value })}
                className="text-base md:text-sm"
              />
            </div>
            <div>
              <Label htmlFor="tyr-type">Tyre Type</Label>
              <Input
                uppercase
                id="tyr-type"
                value={form.tyre_type}
                onChange={(e) => set({ tyre_type: e.target.value })}
                className="text-base md:text-sm"
              />
            </div>
            <div>
              <Label htmlFor="tyr-size">Size</Label>
              <Input
                uppercase
                id="tyr-size"
                value={form.size}
                onChange={(e) => set({ size: e.target.value })}
                className="text-base md:text-sm"
              />
            </div>
          </DetailSection>

          <DetailSection label="Retreads" cols={2}>
            <div>
              <Label htmlFor="tyr-allowed">Allowed Retreads</Label>
              <Input
                id="tyr-allowed"
                type="number"
                min={0}
                step={1}
                value={form.allowed_retreads}
                onChange={(e) => set({ allowed_retreads: e.target.value })}
                className="text-base md:text-sm"
              />
            </div>
            <div>
              <Label htmlFor="tyr-done">Retreads Done</Label>
              <Input
                id="tyr-done"
                type="number"
                min={0}
                step={1}
                value={form.retreads_done}
                onChange={(e) => set({ retreads_done: e.target.value })}
                className="text-base md:text-sm"
              />
            </div>
            {needsKm && (
              <div>
                <Label htmlFor="tyr-km" className="flex items-center gap-1">
                  KM per Retread <span className="text-danger">*</span>
                  <span title="Required when retreads are allowed." className="cursor-help text-muted-foreground">
                    <Info className="h-3.5 w-3.5" />
                  </span>
                </Label>
                <Input
                  id="tyr-km"
                  type="number"
                  min={0.001}
                  step="any"
                  value={form.km_per_retread}
                  onChange={(e) => set({ km_per_retread: e.target.value })}
                  className="text-base md:text-sm"
                />
              </div>
            )}
          </DetailSection>

          {editId && (
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                className="h-4 w-4 cursor-pointer accent-primary"
                checked={!form.is_active}
                onChange={(e) => set({ is_active: !e.target.checked })}
              />
              <span className="text-sm text-foreground">Inactive</span>
            </label>
          )}
        </div>
      </Sheet>
    </div>
  );
}
