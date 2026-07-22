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
import {
  createProductionSection,
  updateProductionSection,
  deleteProductionSection,
} from "@/lib/masters/production-section-actions";
import {
  SECTION_FOR,
  SECTION_FOR_LABELS,
  type ProductionSection,
  type ProductionSectionInput,
} from "@/lib/masters/production-section-types";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean; canExport?: boolean };

const BLANK = {
  code: "",
  name: "",
  section_for: "" as "" | (typeof SECTION_FOR)[number],
  is_active: true,
};

/**
 * Production Section master: unique code, name (auto-copies from code if empty),
 * section_for (C/S/I/E/W/F/P), active toggle.
 * Table on desktop, cards on mobile, Sheet editor.
 */
export function ProductionSectionMasterScreen({
  rows,
  perms,
}: {
  rows: ProductionSection[];
  perms: Perms;
}) {
  const router = useRouter();
  const { success, error } = useToast();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(BLANK);

  const set = (patch: Partial<typeof BLANK>) => setForm((f) => ({ ...f, ...patch }));

  const { query, setQuery, filtered, filterValues, setFilter, activeCount, reset } = useMasterFilter(rows, {
    search: (r, q) =>
      [r.code, r.name, r.section_for ? SECTION_FOR_LABELS[r.section_for] : null]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q),
    filters: {
      status: (r, v) => (v === "active" ? r.is_active : v === "inactive" ? !r.is_active : true),
      sectionFor: (r, v) => r.section_for === v,
    },
    initialFilters: { status: "", sectionFor: "" },
  });

  const pg = usePagination(filtered, 10);

  function openAdd() {
    setEditId(null);
    setForm(BLANK);
    setOpen(true);
  }
  function openEdit(r: ProductionSection) {
    setEditId(r.id);
    setForm({
      code: r.code,
      name: r.name,
      section_for: r.section_for ?? "",
      is_active: r.is_active,
    });
    setOpen(true);
  }

  function handleCodeChange(val: string) {
    set({ code: val, name: form.name || val });
  }

  function submit() {
    startTransition(async () => {
      const code = form.code.trim();
      const payload: ProductionSectionInput = {
        code,
        name: form.name.trim() || code,
        section_for: form.section_for || null,
        is_active: form.is_active,
      };
      const res = editId
        ? await updateProductionSection(editId, payload)
        : await createProductionSection(payload);
      if (res.ok) {
        success(editId ? "Production section updated." : "Production section added.");
        setOpen(false);
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  function remove(r: ProductionSection) {
    startTransition(async () => {
      const res = await deleteProductionSection(r.id);
      if (res.ok) {
        success("Production section deleted.");
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  const columns: Column<ProductionSection>[] = [
    { header: "Code", cell: (r) => <span className="font-mono text-xs">{r.code}</span> },
    { header: "Name", cell: (r) => <span className="text-sm font-medium">{r.name}</span> },
    {
      header: "Section For",
      cell: (r) => (
        <span className="text-sm text-muted-foreground">
          {r.section_for ? SECTION_FOR_LABELS[r.section_for] : "—"}
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
          searchPlaceholder="Search production section…"
          activeCount={activeCount}
          onReset={() => {
            reset();
            pg.setPage(1);
          }}
        >
          <div>
            <Label htmlFor="psc-filter-status">Status</Label>
            <Select
              id="psc-filter-status"
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
            <Label htmlFor="psc-filter-for">Section For</Label>
            <Select
              id="psc-filter-for"
              value={filterValues.sectionFor}
              onChange={(e) => {
                setFilter("sectionFor", e.target.value);
                pg.setPage(1);
              }}
              className="text-base md:text-sm"
            >
              <option value="">All</option>
              {SECTION_FOR.map((v) => (
                <option key={v} value={v}>
                  {SECTION_FOR_LABELS[v]}
                </option>
              ))}
            </Select>
          </div>
        </FilterBar>
        <div className="flex flex-1 items-center justify-end gap-2">
          <DataIoToolbar entityKey="production-sections" rows={filtered} canExport={perms.canExport} />
          {perms.canCreate && (
            <Button size="md" onClick={openAdd}>
              + Add Section
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
          empty="No production section records yet."
        />
      </div>

      {/* mobile cards */}
      <div className="space-y-2.5 md:hidden">
        {pg.paged.length === 0 ? (
          <div className="rounded-lg border border-border bg-surface px-4 py-10 text-center text-sm text-muted-foreground">
            No production section records yet.
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
                    {r.section_for ? ` · ${SECTION_FOR_LABELS[r.section_for]}` : ""}
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
        title={editId ? "Edit Production Section" : "New Production Section"}
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
            <Label htmlFor="psc-code">
              Code <span className="text-danger">*</span>
            </Label>
            <Input
              id="psc-code"
              value={form.code}
              onChange={(e) => handleCodeChange(e.target.value)}
              className="text-base md:text-sm"
            />
          </div>
          <div>
            <Label htmlFor="psc-name">
              Name <span className="text-danger">*</span>
            </Label>
            <Input
              id="psc-name"
              value={form.name}
              onChange={(e) => set({ name: e.target.value })}
              className="text-base md:text-sm"
            />
          </div>
          <div>
            <Label htmlFor="psc-for">Section For</Label>
            <Select
              id="psc-for"
              value={form.section_for}
              onChange={(e) => set({ section_for: e.target.value as typeof form.section_for })}
              className="text-base md:text-sm"
            >
              <option value="">— Select —</option>
              {SECTION_FOR.map((v) => (
                <option key={v} value={v}>
                  {SECTION_FOR_LABELS[v]}
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
