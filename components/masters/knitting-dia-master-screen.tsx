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

const BLANK = { dia: "", description: "", inactive: false };

/**
 * Legacy "Knitting Dia" master — a simple flat list (Dia req numeric ·
 * Description · Inactive). Backed by `config_lookups` kind `knitting_dia`:
 * dia→code, description→name (falls back to dia), inactive→!is_active. Reuses
 * the shared lookup actions (no dedicated table).
 */
export function KnittingDiaMasterScreen({ rows, perms }: { rows: ConfigLookup[]; perms: Perms }) {
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
    // name falls back to code when there's no distinct description
    setForm({
      dia: r.code ?? "",
      description: r.name === r.code ? "" : r.name,
      inactive: !r.is_active,
    });
    setEditId(r.id);
    setOpen(true);
  }

  function submit() {
    startTransition(async () => {
      const dia = form.dia.trim();
      const payload = {
        kind: "knitting_dia" as const,
        code: dia || null,
        name: form.description.trim() || dia, // Description optional → fall back to Dia
        notes: null,
        is_active: !form.inactive,
      };
      const res = editId ? await updateLookup(editId, payload) : await createLookup(payload);
      if (res.ok) {
        success(editId ? "Knitting Dia updated." : "Knitting Dia added.");
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
        success("Knitting Dia deleted.");
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  const columns: Column<ConfigLookup>[] = [
    { header: "Dia", cell: (r) => <span className="font-mono text-sm tabular-nums">{r.code ?? "—"}</span> },
    {
      header: "Description",
      cell: (r) => (
        <span className="text-sm text-muted-foreground">{r.name === r.code ? "—" : r.name}</span>
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
          searchPlaceholder="Search knitting dia…"
          activeCount={activeCount}
          onReset={() => {
            reset();
            pg.setPage(1);
          }}
        >
          <div>
            <Label htmlFor="knitting-dia-filter-status">Status</Label>
            <Select
              id="knitting-dia-filter-status"
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
          <DataIoToolbar entityKey="knitting-dias" rows={filtered} canExport={perms.canExport} />
          {perms.canCreate && (
            <Button size="md" onClick={openAdd}>
              + Add Knitting Dia
            </Button>
          )}
        </div>
      </div>

      {/* desktop table */}
      <div className="hidden md:block">
        <DataTable columns={columns} rows={pg.paged} getKey={(r) => r.id} empty="No knitting dia records yet." />
      </div>

      {/* mobile cards */}
      <div className="space-y-2.5 md:hidden">
        {pg.paged.length === 0 ? (
          <div className="rounded-lg border border-border bg-surface px-4 py-10 text-center text-sm text-muted-foreground">
            No knitting dia records yet.
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
                  <div className="truncate text-[15px] font-semibold text-foreground">{r.code ?? "—"}</div>
                  {r.name !== r.code && (
                    <div className="mt-0.5 text-xs text-muted-foreground">{r.name}</div>
                  )}
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
        title={editId ? "Edit Knitting Dia" : "New Knitting Dia"}
        footer={
          <>
            <Button variant="outline" size="md" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button size="md" disabled={isPending || !form.dia.trim()} onClick={submit}>
              {isPending ? "Saving…" : "Save"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <Label htmlFor="kd-dia">
              Dia <span className="text-danger">*</span>
            </Label>
            <Input
              id="kd-dia"
              type="number"
              step="any"
              min="0"
              value={form.dia}
              onChange={(e) => setForm({ ...form, dia: e.target.value })}
              required
              className="text-base md:text-sm"
            />
          </div>
          <div>
            <Label htmlFor="kd-desc">Description</Label>
            <Input
              id="kd-desc"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
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
