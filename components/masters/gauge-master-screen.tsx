"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DataTable, type Column } from "@/components/ui/data-table";
import { PaginationBar } from "@/components/ui/pagination";
import { StatusPill } from "@/components/ui/status-pill";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { usePagination } from "@/lib/use-pagination";
import { createLookup, updateLookup, deleteLookup } from "@/lib/masters/extras-actions";
import type { ConfigLookup } from "@/lib/masters/extras-types";
import { DeleteConfirmButton } from "@/components/masters/delete-confirm-button";
import { FilterBar } from "@/components/masters/filter-bar";
import { DataIoToolbar } from "@/components/data-io/data-io-toolbar";
import { useMasterFilter } from "@/lib/masters/use-master-filter";
import { Select } from "@/components/ui/select";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean; canExport?: boolean };

const BLANK = { short_name: "", name: "", inactive: false };

/**
 * Legacy "Gauge" master — a simple flat list (Short Name req · Name · Inactive).
 * Backed by `config_lookups` kind `gauge`: short_name→code, name→name,
 * inactive→!is_active. Reuses the shared lookup actions (no dedicated table).
 */
export function GaugeMasterScreen({ rows, perms }: { rows: ConfigLookup[]; perms: Perms }) {
  const router = useRouter();
  const { success, error } = useToast();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(BLANK);

  const { query, setQuery, filtered, filterValues, setFilter, activeCount, reset } = useMasterFilter(
    rows,
    {
      search: (r, q) => [r.code, r.name].filter(Boolean).join(" ").toLowerCase().includes(q),
      filters: {
        status: (r, v) => (v === "active" ? r.is_active : v === "inactive" ? !r.is_active : true),
      },
      initialFilters: { status: "" },
    },
  );

  const pg = usePagination(filtered, 10);

  function openAdd() {
    setEditId(null);
    setForm(BLANK);
    setOpen(true);
  }
  function openEdit(r: ConfigLookup) {
    setEditId(r.id);
    setForm({ short_name: r.code ?? "", name: r.name, inactive: !r.is_active });
    setOpen(true);
  }

  function submit() {
    startTransition(async () => {
      const shortName = form.short_name.trim();
      const payload = {
        kind: "gauge" as const,
        code: shortName || null,
        name: form.name.trim() || shortName, // Name optional → fall back to Short Name
        notes: null,
        is_active: !form.inactive,
      };
      const res = editId ? await updateLookup(editId, payload) : await createLookup(payload);
      if (res.ok) {
        success(editId ? "Gauge updated." : "Gauge added.");
        setOpen(false);
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  function remove(r: ConfigLookup) {
    startTransition(async () => {
      const res = await deleteLookup(r.id);
      if (res.ok) {
        success("Gauge deleted.");
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  const columns: Column<ConfigLookup>[] = [
    { header: "Short Name", cell: (r) => <span className="font-mono text-xs">{r.code ?? "—"}</span> },
    { header: "Name", cell: (r) => <span className="text-sm">{r.name}</span> },
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
          searchPlaceholder="Search gauge…"
          activeCount={activeCount}
          onReset={() => {
            reset();
            pg.setPage(1);
          }}
        >
          <div>
            <Label htmlFor="gauge-filter-status">Status</Label>
            <Select
              id="gauge-filter-status"
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
          <DataIoToolbar entityKey="gauges" rows={filtered} canExport={perms.canExport} />
          {perms.canCreate && (
            <Button size="md" onClick={openAdd}>
              + Add Gauge
            </Button>
          )}
        </div>
      </div>

      {/* desktop table */}
      <div className="hidden md:block">
        <DataTable columns={columns} rows={pg.paged} getKey={(r) => r.id} empty="No gauge records yet." />
      </div>

      {/* mobile cards */}
      <div className="space-y-2.5 md:hidden">
        {pg.paged.length === 0 ? (
          <div className="rounded-lg border border-border bg-surface px-4 py-10 text-center text-sm text-muted-foreground">
            No gauge records yet.
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
                  {r.code && <div className="mt-0.5 font-mono text-xs text-muted-foreground">{r.code}</div>}
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
        title={editId ? "Edit Gauge" : "New Gauge"}
        footer={
          <>
            <Button variant="outline" size="md" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button size="md" disabled={isPending || !form.short_name.trim()} onClick={submit}>
              {isPending ? "Saving…" : "Save"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <Label htmlFor="gg-short">
              Short Name <span className="text-danger">*</span>
            </Label>
            <Input
              id="gg-short"
              value={form.short_name}
              onChange={(e) => setForm({ ...form, short_name: e.target.value })}
              required
              className="text-base md:text-sm"
            />
          </div>
          <div>
            <Label htmlFor="gg-name">Name</Label>
            <Input
              id="gg-name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="text-base md:text-sm"
            />
          </div>
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              className="h-4 w-4 cursor-pointer accent-primary"
              checked={form.inactive}
              onChange={(e) => setForm({ ...form, inactive: e.target.checked })}
            />
            <span className="text-sm text-foreground">Inactive</span>
          </label>
        </div>
      </Sheet>
    </div>
  );
}
