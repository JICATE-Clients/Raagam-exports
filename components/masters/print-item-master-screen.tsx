"use client";

import { useState, useTransition } from "react";
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
import { createPrintItem, updatePrintItem, deletePrintItem } from "@/lib/masters/print-item-actions";
import {
  PRINT_ITEM_TYPES,
  PRINT_ITEM_TYPE_LABELS,
  type PrintItem,
  type PrintItemInput,
} from "@/lib/masters/print-item-types";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean; canExport?: boolean };

const BLANK = {
  code: "",
  name: "",
  item_type: "" as "" | "A" | "Y" | "F",
  is_active: true,
};

/**
 * Print Item master: unique code + name, item_type (A=All/Y=Yarn/F=Fabric),
 * active toggle. Code auto-copies to name if name is empty.
 * Table on desktop, cards on mobile, Sheet editor.
 */
export function PrintItemMasterScreen({ rows, perms }: { rows: PrintItem[]; perms: Perms }) {
  const router = useRouter();
  const { success, error } = useToast();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(BLANK);

  const set = (patch: Partial<typeof BLANK>) => setForm((f) => ({ ...f, ...patch }));

  const { query, setQuery, filtered, filterValues, setFilter, activeCount, reset } = useMasterFilter(rows, {
    search: (r, q) =>
      [r.code, r.name, r.item_type ? PRINT_ITEM_TYPE_LABELS[r.item_type] : null]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q),
    filters: {
      status: (r, v) => (v === "active" ? r.is_active : v === "inactive" ? !r.is_active : true),
      itemType: (r, v) => r.item_type === v,
    },
    initialFilters: { status: "", itemType: "" },
  });

  const pg = usePagination(filtered, 10);

  function openAdd() {
    setEditId(null);
    setForm(BLANK);
    setOpen(true);
  }
  function openEdit(r: PrintItem) {
    setEditId(r.id);
    setForm({
      code: r.code,
      name: r.name,
      item_type: r.item_type ?? "",
      is_active: r.is_active,
    });
    setOpen(true);
  }

  function handleCodeChange(val: string) {
    set({ code: val, name: form.name || val });
  }

  function submit() {
    startTransition(async () => {
      const payload: PrintItemInput = {
        code: form.code.trim(),
        name: form.name.trim() || form.code.trim(),
        item_type: form.item_type || null,
        is_active: form.is_active,
      };
      const res = editId ? await updatePrintItem(editId, payload) : await createPrintItem(payload);
      if (res.ok) {
        success(editId ? "Print item updated." : "Print item added.");
        setOpen(false);
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  function remove(r: PrintItem) {
    startTransition(async () => {
      const res = await deletePrintItem(r.id);
      if (res.ok) {
        success("Print item deleted.");
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  const columns: Column<PrintItem>[] = [
    { header: "Code", cell: (r) => <span className="font-mono text-xs">{r.code}</span> },
    { header: "Name", cell: (r) => <span className="text-sm font-medium">{r.name}</span> },
    {
      header: "Item Type",
      cell: (r) => (
        <span className="text-sm text-muted-foreground">
          {r.item_type ? PRINT_ITEM_TYPE_LABELS[r.item_type] : "—"}
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
          searchPlaceholder="Search print item…"
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
          <div>
            <Label htmlFor="pi-filter-type">Item Type</Label>
            <Select
              id="pi-filter-type"
              value={filterValues.itemType}
              onChange={(e) => {
                setFilter("itemType", e.target.value);
                pg.setPage(1);
              }}
              className="text-base md:text-sm"
            >
              <option value="">All</option>
              {PRINT_ITEM_TYPES.map((v) => (
                <option key={v} value={v}>
                  {PRINT_ITEM_TYPE_LABELS[v]}
                </option>
              ))}
            </Select>
          </div>
        </FilterBar>
        <div className="flex flex-1 items-center justify-end gap-2">
          <DataIoToolbar entityKey="print-items" rows={filtered} canExport={perms.canExport} />
          {perms.canCreate && (
            <Button size="md" onClick={openAdd}>
              + Add Print Item
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
          empty="No print item records yet."
        />
      </div>

      {/* mobile cards */}
      <div className="space-y-2.5 md:hidden">
        {pg.paged.length === 0 ? (
          <div className="rounded-lg border border-border bg-surface px-4 py-10 text-center text-sm text-muted-foreground">
            No print item records yet.
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
                    <span className="font-mono">{r.code}</span>
                    {r.item_type ? ` · ${PRINT_ITEM_TYPE_LABELS[r.item_type]}` : ""}
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
        title={editId ? "Edit Print Item" : "New Print Item"}
        footer={
          <>
            <Button variant="outline" size="md" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button size="md" disabled={isPending || !form.code.trim()} onClick={submit}>
              {isPending ? "Saving…" : "Save"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <Label htmlFor="pi-code">
              Code <span className="text-danger">*</span>
            </Label>
            <Input
              id="pi-code"
              value={form.code}
              onChange={(e) => handleCodeChange(e.target.value)}
              className="text-base md:text-sm"
            />
          </div>
          <div>
            <Label htmlFor="pi-name">
              Name <span className="text-danger">*</span>
            </Label>
            <Input
              id="pi-name"
              value={form.name}
              onChange={(e) => set({ name: e.target.value })}
              className="text-base md:text-sm"
            />
          </div>
          <div>
            <Label htmlFor="pi-type">Item Type</Label>
            <Select
              id="pi-type"
              value={form.item_type}
              onChange={(e) => set({ item_type: e.target.value as typeof form.item_type })}
              className="text-base md:text-sm"
            >
              <option value="">— Select —</option>
              {PRINT_ITEM_TYPES.map((v) => (
                <option key={v} value={v}>
                  {PRINT_ITEM_TYPE_LABELS[v]}
                </option>
              ))}
            </Select>
          </div>
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
