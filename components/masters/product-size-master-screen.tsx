"use client";

import { useMemo, useState, useTransition } from "react";
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
import { DeleteConfirmButton } from "@/components/masters/delete-confirm-button";
import { DetailSection } from "@/components/masters/detail-section";
import { createProductSize, updateProductSize, deleteProductSize } from "@/lib/masters/product-size-actions";
import { SIZE_FOR, type ProductSize, type ProductSizeInput } from "@/lib/masters/product-size-types";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean; canExport?: boolean };

const BLANK = {
  prod_size_id: "",
  width: "",
  length: "",
  height: "",
  prod_cut_size: "",
  size_for: "" as "" | "P" | "F",
  desc1: "",
  desc2: "",
  desc3: "",
  is_active: true,
};

function buildProdSize(width: string, length: string, height: string, sizeFor: string): string {
  const w = Number(width);
  const l = Number(length);
  const h = Number(height);
  if (!w) return "";
  const parts = [w.toString()];
  // For Fabric: length and height are zeroed
  if (sizeFor !== "F") {
    if (l > 0) parts.push(l.toString());
    if (h > 0) parts.push(h.toString());
  }
  return parts.join(" x ");
}

/**
 * Product Size master: unique prod_size_id, width (required >0), optional
 * length/height, size_for (P=Product/F=Fabric), three optional descriptions.
 * prod_size display is auto-calculated. For Fabric, length/height are zeroed.
 * Table on desktop, cards on mobile, Sheet editor.
 */
export function ProductSizeMasterScreen({ rows, perms }: { rows: ProductSize[]; perms: Perms }) {
  const router = useRouter();
  const { success, error } = useToast();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(BLANK);

  const set = (patch: Partial<typeof BLANK>) => setForm((f) => ({ ...f, ...patch }));

  const displaySize = useMemo(
    () => buildProdSize(form.width, form.length, form.height, form.size_for),
    [form.width, form.length, form.height, form.size_for],
  );

  const { query, setQuery, filtered, filterValues, setFilter, activeCount, reset } = useMasterFilter(rows, {
    search: (r, q) =>
      [r.prod_size_id, r.prod_cut_size, r.desc1, r.desc2, r.desc3]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q),
    filters: {
      status: (r, v) => (v === "active" ? r.is_active : v === "inactive" ? !r.is_active : true),
      sizeFor: (r, v) => r.size_for === v,
    },
    initialFilters: { status: "", sizeFor: "" },
  });

  const pg = usePagination(filtered, 10);

  function openAdd() {
    setEditId(null);
    setForm(BLANK);
    setOpen(true);
  }
  function openEdit(r: ProductSize) {
    setEditId(r.id);
    set({
      prod_size_id: r.prod_size_id,
      width: r.width.toString(),
      length: r.length.toString(),
      height: r.height.toString(),
      prod_cut_size: r.prod_cut_size ?? "",
      size_for: r.size_for ?? "",
      desc1: r.desc1 ?? "",
      desc2: r.desc2 ?? "",
      desc3: r.desc3 ?? "",
      is_active: r.is_active,
    });
    setOpen(true);
  }

  function handleSizeForChange(val: "" | "P" | "F") {
    if (val === "F") {
      set({ size_for: val, length: "0", height: "0" });
    } else {
      set({ size_for: val });
    }
  }

  function submit() {
    startTransition(async () => {
      const isFabric = form.size_for === "F";
      const payload: ProductSizeInput = {
        prod_size_id: form.prod_size_id.trim(),
        width: Number(form.width),
        length: isFabric ? 0 : Number(form.length) || 0,
        height: isFabric ? 0 : Number(form.height) || 0,
        prod_cut_size: form.prod_cut_size.trim() || null,
        size_for: form.size_for || null,
        desc1: form.desc1.trim() || null,
        desc2: form.desc2.trim() || null,
        desc3: form.desc3.trim() || null,
        is_active: form.is_active,
      };
      const res = editId ? await updateProductSize(editId, payload) : await createProductSize(payload);
      if (res.ok) {
        success(editId ? "Product size updated." : "Product size added.");
        setOpen(false);
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  function remove(r: ProductSize) {
    startTransition(async () => {
      const res = await deleteProductSize(r.id);
      if (res.ok) {
        success("Product size deleted.");
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  function rowSize(r: ProductSize): string {
    const parts = [r.width.toString()];
    if (r.size_for !== "F") {
      if (r.length > 0) parts.push(r.length.toString());
      if (r.height > 0) parts.push(r.height.toString());
    }
    return parts.join(" x ");
  }

  const columns: Column<ProductSize>[] = [
    { header: "Size ID", cell: (r) => <span className="text-sm font-medium">{r.prod_size_id}</span> },
    { header: "Dimensions", cell: (r) => <span className="text-sm font-mono">{rowSize(r)}</span> },
    {
      header: "For",
      cell: (r) => (
        <span className="text-sm text-muted-foreground">
          {r.size_for === "P" ? "Product" : r.size_for === "F" ? "Fabric" : "—"}
        </span>
      ),
    },
    {
      header: "Cut Size",
      cell: (r) => <span className="text-sm text-muted-foreground">{r.prod_cut_size ?? "—"}</span>,
    },
    {
      header: "Status",
      cell: (r) => (
        <StatusPill tone={r.is_active ? "success" : "danger"}>
          {r.is_active ? "Active" : "Inactive"}
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
          searchPlaceholder="Search product size…"
          activeCount={activeCount}
          onReset={() => {
            reset();
            pg.setPage(1);
          }}
        >
          <div>
            <Label htmlFor="ps-filter-status">Status</Label>
            <Select
              id="ps-filter-status"
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
          <div>
            <Label htmlFor="ps-filter-for">Size For</Label>
            <Select
              id="ps-filter-for"
              value={filterValues.sizeFor}
              onChange={(e) => {
                setFilter("sizeFor", e.target.value);
                pg.setPage(1);
              }}
              className="text-base md:text-sm"
            >
              <option value="">All</option>
              <option value="P">Product</option>
              <option value="F">Fabric</option>
            </Select>
          </div>
        </FilterBar>
        <div className="flex flex-1 items-center justify-end gap-2">
          <DataIoToolbar entityKey="product-sizes" rows={filtered} canExport={perms.canExport} />
          {perms.canCreate && (
            <Button size="md" onClick={openAdd}>
              + Add Product Size
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
          empty="No product size records yet."
        />
      </div>

      {/* mobile cards */}
      <div className="space-y-2.5 md:hidden">
        {pg.paged.length === 0 ? (
          <div className="rounded-lg border border-border bg-surface px-4 py-10 text-center text-sm text-muted-foreground">
            No product size records yet.
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
                  <div className="truncate text-[15px] font-semibold text-foreground">{r.prod_size_id}</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {rowSize(r)}
                    {r.size_for ? ` · ${r.size_for === "P" ? "Product" : "Fabric"}` : ""}
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
        title={editId ? "Edit Product Size" : "New Product Size"}
        footer={
          <>
            <Button variant="outline" size="md" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              size="md"
              disabled={isPending || !form.prod_size_id.trim() || !form.width || Number(form.width) <= 0}
              onClick={submit}
            >
              {isPending ? "Saving…" : "Save"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <DetailSection label="Identity">
            <div>
              <Label htmlFor="ps-id">
                Size ID <span className="text-danger">*</span>
              </Label>
              <Input
                id="ps-id"
                value={form.prod_size_id}
                onChange={(e) => set({ prod_size_id: e.target.value })}
                className="text-base md:text-sm"
              />
            </div>
            <div>
              <Label htmlFor="ps-for">Size For</Label>
              <Select
                id="ps-for"
                value={form.size_for}
                onChange={(e) => handleSizeForChange(e.target.value as "" | "P" | "F")}
                className="text-base md:text-sm"
              >
                <option value="">— Select —</option>
                {SIZE_FOR.map((v) => (
                  <option key={v} value={v}>
                    {v === "P" ? "Product" : "Fabric"}
                  </option>
                ))}
              </Select>
            </div>
          </DetailSection>

          <DetailSection label="Dimensions">
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label htmlFor="ps-width">
                  Width <span className="text-danger">*</span>
                </Label>
                <Input
                  id="ps-width"
                  type="number"
                  min={0.001}
                  step="any"
                  value={form.width}
                  onChange={(e) => set({ width: e.target.value })}
                  className="text-base md:text-sm"
                />
              </div>
              <div>
                <Label htmlFor="ps-length">Length</Label>
                <Input
                  id="ps-length"
                  type="number"
                  min={0}
                  step="any"
                  value={form.length}
                  onChange={(e) => set({ length: e.target.value })}
                  disabled={form.size_for === "F"}
                  className="text-base md:text-sm"
                />
              </div>
              <div>
                <Label htmlFor="ps-height">Height</Label>
                <Input
                  id="ps-height"
                  type="number"
                  min={0}
                  step="any"
                  value={form.height}
                  onChange={(e) => set({ height: e.target.value })}
                  disabled={form.size_for === "F"}
                  className="text-base md:text-sm"
                />
              </div>
            </div>
            {displaySize && (
              <div>
                <Label>Calculated Size</Label>
                <div className="rounded-md border border-border bg-surface-muted px-3 py-2 font-mono text-sm text-muted-foreground">
                  {displaySize}
                </div>
              </div>
            )}
          </DetailSection>

          <DetailSection label="Additional">
            <div>
              <Label htmlFor="ps-cut">Cut Size</Label>
              <Input
                id="ps-cut"
                value={form.prod_cut_size}
                onChange={(e) => set({ prod_cut_size: e.target.value })}
                className="text-base md:text-sm"
              />
            </div>
            <div>
              <Label htmlFor="ps-desc1">Description 1</Label>
              <Input
                id="ps-desc1"
                value={form.desc1}
                onChange={(e) => set({ desc1: e.target.value })}
                className="text-base md:text-sm"
              />
            </div>
            <div>
              <Label htmlFor="ps-desc2">Description 2</Label>
              <Input
                id="ps-desc2"
                value={form.desc2}
                onChange={(e) => set({ desc2: e.target.value })}
                className="text-base md:text-sm"
              />
            </div>
            <div>
              <Label htmlFor="ps-desc3">Description 3</Label>
              <Input
                id="ps-desc3"
                value={form.desc3}
                onChange={(e) => set({ desc3: e.target.value })}
                className="text-base md:text-sm"
              />
            </div>
          </DetailSection>

          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              className="h-4 w-4 cursor-pointer accent-primary"
              checked={!form.is_active}
              onChange={(e) => set({ is_active: !e.target.checked })}
            />
            <span className="text-sm text-foreground">Inactive</span>
          </label>
        </div>
      </Sheet>
    </div>
  );
}
