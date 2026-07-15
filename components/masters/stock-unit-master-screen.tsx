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
import {
  createStockUnit,
  updateStockUnit,
  deleteStockUnit,
} from "@/lib/masters/stock-unit-actions";
import { type StockUnit, type StockUnitInput } from "@/lib/masters/stock-unit-types";
import type { ConfigLookup } from "@/lib/masters/extras-types";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean; canExport?: boolean };

type Form = {
  code: string;
  name: string;
  description: string;
  decimal_places: string;
  for_all_item_classes: boolean;
  item_classes: string[];
  inactive: boolean;
};

const BLANK: Form = {
  code: "",
  name: "",
  description: "",
  decimal_places: "0",
  for_all_item_classes: true,
  item_classes: [],
  inactive: false,
};

export function StockUnitMasterScreen({
  rows,
  itemClasses,
  perms,
}: {
  rows: StockUnit[];
  itemClasses: ConfigLookup[];
  perms: Perms;
}) {
  const router = useRouter();
  const { success, error } = useToast();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<Form>(BLANK);

  const { query, setQuery, filtered, filterValues, setFilter, activeCount, reset } = useMasterFilter(
    rows,
    {
      search: (r, q) =>
        [r.code, r.name, r.description].filter(Boolean).join(" ").toLowerCase().includes(q),
      filters: {
        status: (r, v) => (v === "active" ? !!r.is_active : v === "inactive" ? !r.is_active : true),
        itemClass: (r, v) => r.for_all_item_classes || r.item_classes.includes(v),
        forAll: (r, v) =>
          v === "yes" ? r.for_all_item_classes : v === "no" ? !r.for_all_item_classes : true,
      },
      initialFilters: { status: "", itemClass: "", forAll: "" },
    },
  );

  const pg = usePagination(filtered, 10);

  const set = (patch: Partial<Form>) => setForm((f) => ({ ...f, ...patch }));
  const toggleClass = (cls: string) =>
    setForm((f) => ({
      ...f,
      item_classes: f.item_classes.includes(cls)
        ? f.item_classes.filter((c) => c !== cls)
        : [...f.item_classes, cls],
    }));

  function openAdd() {
    setEditId(null);
    setForm(BLANK);
    setOpen(true);
  }
  function openEdit(r: StockUnit) {
    setEditId(r.id);
    setForm({
      code: r.code,
      name: r.name,
      description: r.description ?? "",
      decimal_places: String(r.decimal_places),
      for_all_item_classes: r.for_all_item_classes,
      item_classes: r.item_classes ?? [],
      inactive: !r.is_active,
    });
    setOpen(true);
  }

  function submit() {
    startTransition(async () => {
      const payload: StockUnitInput = {
        code: form.code,
        name: form.name,
        description: form.description || null,
        decimal_places: Number(form.decimal_places) || 0,
        for_all_item_classes: form.for_all_item_classes,
        item_classes: form.for_all_item_classes
          ? []
          : form.item_classes.filter((c) =>
              itemClasses.some((ic) => ic.code === c),
            ),
        is_active: !form.inactive,
      };
      const res = editId ? await updateStockUnit(editId, payload) : await createStockUnit(payload);
      if (res.ok) {
        success(editId ? "Stock unit updated." : "Stock unit added.");
        setOpen(false);
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  function remove(r: StockUnit) {
    startTransition(async () => {
      const res = await deleteStockUnit(r.id);
      if (res.ok) {
        success("Stock unit deleted.");
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  const classesLabel = (r: StockUnit) =>
    r.for_all_item_classes ? "All" : r.item_classes.length ? r.item_classes.join(", ") : "—";

  const columns: Column<StockUnit>[] = [
    { header: "Code", cell: (r) => <span className="font-mono text-xs">{r.code}</span> },
    { header: "Name", cell: (r) => <span className="text-sm">{r.name}</span> },
    {
      header: "Decimals",
      align: "right",
      cell: (r) => <span className="tabular-nums text-sm">{r.decimal_places}</span>,
    },
    {
      header: "Item Classes",
      cell: (r) => <span className="text-sm text-muted-foreground">{classesLabel(r)}</span>,
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
        <FilterBar
          search={query}
          onSearch={(v) => {
            setQuery(v);
            pg.setPage(1);
          }}
          searchPlaceholder="Search stock units…"
          activeCount={activeCount}
          onReset={reset}
        >
          <div>
            <Label htmlFor="su-filter-status">Status</Label>
            <Select
              id="su-filter-status"
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
            <Label htmlFor="su-filter-itemclass">Item Class</Label>
            <Select
              id="su-filter-itemclass"
              value={filterValues.itemClass}
              onChange={(e) => {
                setFilter("itemClass", e.target.value);
                pg.setPage(1);
              }}
              className="text-base md:text-sm"
            >
              <option value="">All</option>
              {itemClasses.map((c) => {
                const code = c.code ?? c.name;
                return (
                  <option key={c.id} value={code}>
                    {c.code ? `${c.code} — ${c.name}` : c.name}
                  </option>
                );
              })}
            </Select>
          </div>
          <div>
            <Label htmlFor="su-filter-forall">For All Item Classes</Label>
            <Select
              id="su-filter-forall"
              value={filterValues.forAll}
              onChange={(e) => {
                setFilter("forAll", e.target.value);
                pg.setPage(1);
              }}
              className="text-base md:text-sm"
            >
              <option value="">All</option>
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </Select>
          </div>
        </FilterBar>
        <div className="flex flex-1 items-center justify-end gap-2">
          <DataIoToolbar entityKey="stock-units" rows={filtered} canExport={perms.canExport} />
          {perms.canCreate && (
            <Button size="md" onClick={openAdd}>
              + Add Stock Unit
            </Button>
          )}
        </div>
      </div>

      {/* desktop table */}
      <div className="hidden md:block">
        <DataTable columns={columns} rows={pg.paged} getKey={(r) => r.id} empty="No stock units yet." />
      </div>

      {/* mobile cards */}
      <div className="space-y-2.5 md:hidden">
        {pg.paged.length === 0 ? (
          <div className="rounded-lg border border-border bg-surface px-4 py-10 text-center text-sm text-muted-foreground">
            No stock units yet.
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
                  <div className="mt-0.5 font-mono text-xs text-muted-foreground">
                    {r.code} · {r.decimal_places} dp
                  </div>
                </div>
                <StatusPill tone={r.is_active ? "success" : "neutral"}>
                  {r.is_active ? "Active" : "Inactive"}
                </StatusPill>
              </div>
              <div className="mt-2 text-[13px] text-muted-foreground">Classes: {classesLabel(r)}</div>
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
        title={editId ? "Edit Stock Unit" : "New Stock Unit"}
        footer={
          <>
            <Button variant="outline" size="md" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              size="md"
              disabled={isPending || !form.code.trim() || !form.name.trim()}
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
              <Label htmlFor="su-code">
                Code <span className="text-danger">*</span>
              </Label>
              <Input
                id="su-code"
                value={form.code}
                onChange={(e) => set({ code: e.target.value })}
                placeholder="KG"
                className="text-base md:text-sm"
              />
            </div>
            <div>
              <Label htmlFor="su-dp">No. of Decimal Places</Label>
              <Input
                id="su-dp"
                type="number"
                min="0"
                max="6"
                value={form.decimal_places}
                onChange={(e) => set({ decimal_places: e.target.value })}
                className="text-base md:text-sm"
              />
            </div>
          </div>
          <div>
            <Label htmlFor="su-name">
              Unit of Measurement <span className="text-danger">*</span>
            </Label>
            <Input
              id="su-name"
              value={form.name}
              onChange={(e) => set({ name: e.target.value })}
              placeholder="Kilogram"
              className="text-base md:text-sm"
            />
          </div>
          <div>
            <Label htmlFor="su-desc">Description</Label>
            <Textarea
              id="su-desc"
              rows={2}
              value={form.description}
              onChange={(e) => set({ description: e.target.value })}
              className="text-base md:text-sm"
            />
          </div>

          {/* item classes */}
          <div className="rounded-lg border border-border">
            <label className="flex cursor-pointer items-center gap-2 border-b border-border px-3 py-2.5">
              <input
                type="checkbox"
                className="h-4 w-4 cursor-pointer accent-primary"
                checked={form.for_all_item_classes}
                onChange={(e) => set({ for_all_item_classes: e.target.checked })}
              />
              <span className="text-sm font-medium text-foreground">For all Item Classes</span>
            </label>
            {!form.for_all_item_classes && (
              <div className="flex flex-wrap gap-x-5 gap-y-2 p-3">
                {itemClasses.map((c) => {
                  const code = c.code ?? c.name;
                  return (
                    <label key={c.id} className="flex cursor-pointer items-center gap-2">
                      <input
                        type="checkbox"
                        className="h-4 w-4 cursor-pointer accent-primary"
                        checked={form.item_classes.includes(code)}
                        onChange={() => toggleClass(code)}
                      />
                      <span className="text-sm text-foreground">
                        {c.code ? `${c.code} — ${c.name}` : c.name}
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>

          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              className="h-4 w-4 cursor-pointer accent-primary"
              checked={form.inactive}
              onChange={(e) => set({ inactive: e.target.checked })}
            />
            <span className="text-sm text-foreground">Inactive (inactive)</span>
          </label>
        </div>
      </Sheet>
    </div>
  );
}
