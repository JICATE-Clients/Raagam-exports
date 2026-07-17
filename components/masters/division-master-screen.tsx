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
import {
  createDivision,
  updateDivision,
  deleteDivision,
} from "@/lib/masters/division-actions";
import type { Division, DivisionInput } from "@/lib/masters/division-types";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean; canExport?: boolean; isSuperAdmin?: boolean };

const BLANK = { division_id: "", division_name: "", document_prefix_id: "", blocked: false };

export function DivisionMasterScreen({
  rows,
  perms,
}: {
  rows: Division[];
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
      [r.division_id, r.division_name].filter(Boolean).join(" ").toLowerCase().includes(q),
    filters: {
      status: (r, v) => (v === "active" ? !r.blocked : v === "inactive" ? !!r.blocked : true),
    },
    initialFilters: { status: "" },
  });

  const pg = usePagination(filtered, 10);

  function openAdd() {
    setEditId(null);
    setForm(BLANK);
    setOpen(true);
  }
  function openEdit(r: Division) {
    setEditId(r.id);
    setForm({
      division_id: r.division_id ?? "",
      division_name: r.division_name ?? "",
      document_prefix_id: r.document_prefix_id ?? "",
      blocked: r.blocked,
    });
    setOpen(true);
  }

  function submit() {
    startTransition(async () => {
      const payload: DivisionInput = {
        division_id: form.division_id.trim() || null,
        division_name: form.division_name.trim() || null,
        document_prefix_id: form.document_prefix_id.trim() || null,
        blocked: form.blocked,
      };
      const res = editId ? await updateDivision(editId, payload) : await createDivision(payload);
      if (res.ok) {
        success(editId ? "Division updated." : "Division added.");
        setOpen(false);
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  function remove(r: Division) {
    startTransition(async () => {
      const res = await deleteDivision(r.id);
      if (res.ok) {
        success("Division deleted.");
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  const columns: Column<Division>[] = [
    { header: "Division ID", cell: (r) => <span className="text-sm">{r.division_id ?? "—"}</span> },
    { header: "Division Name", cell: (r) => <span className="text-sm">{r.division_name ?? "—"}</span> },
    { header: "Doc Prefix", cell: (r) => <span className="text-sm">{r.document_prefix_id ?? "—"}</span> },
    {
      header: "Status",
      cell: (r) => (
        <StatusPill tone={r.blocked ? "danger" : "success"}>
          {r.blocked ? "Inactive" : "Active"}
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
          searchPlaceholder="Search division…"
          activeCount={activeCount}
          onReset={() => {
            reset();
            pg.setPage(1);
          }}
        >
          <div>
            <Label htmlFor="div-filter-status">Status</Label>
            <Select
              id="div-filter-status"
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
          <DataIoToolbar entityKey="divisions" rows={filtered} canExport={perms.canExport} />
          {perms.canCreate && (
            <Button size="md" onClick={openAdd}>
              + Add Division
            </Button>
          )}
        </div>
      </div>

      {/* desktop table */}
      <div className="hidden md:block">
        <DataTable columns={columns} rows={pg.paged} getKey={(r) => r.id} empty="No division records yet." />
      </div>

      {/* mobile cards */}
      <div className="space-y-2.5 md:hidden">
        {pg.paged.length === 0 ? (
          <div className="rounded-lg border border-border bg-surface px-4 py-10 text-center text-sm text-muted-foreground">
            No division records yet.
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
                    {r.division_name ?? "—"}
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {r.division_id ?? "—"}
                  </div>
                </div>
                <StatusPill tone={r.blocked ? "danger" : "success"}>
                  {r.blocked ? "Inactive" : "Active"}
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
        title={editId ? "Edit Division" : "New Division"}
        footer={
          <>
            <Button variant="outline" size="md" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button size="md" disabled={isPending || !form.division_name.trim()} onClick={submit}>
              {isPending ? "Saving…" : "Save"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <Label htmlFor="div-division-id">Division ID</Label>
            <Input
              id="div-division-id"
              value={form.division_id}
              onChange={(e) => setForm({ ...form, division_id: e.target.value })}
              className="text-base md:text-sm"
            />
          </div>
          <div>
            <Label htmlFor="div-division-name">Division Name</Label>
            <Input
              id="div-division-name"
              value={form.division_name}
              onChange={(e) => setForm({ ...form, division_name: e.target.value })}
              className="text-base md:text-sm"
            />
          </div>
          <div>
            <Label htmlFor="div-doc-prefix">Document Prefix ID</Label>
            <Input
              id="div-doc-prefix"
              value={form.document_prefix_id}
              onChange={(e) => setForm({ ...form, document_prefix_id: e.target.value })}
              className="text-base md:text-sm"
            />
          </div>
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              className="h-4 w-4 cursor-pointer accent-primary"
              checked={form.blocked}
              onChange={(e) => setForm({ ...form, blocked: e.target.checked })}
            />
            <span className="text-sm text-foreground">Inactive</span>
          </label>
        </div>
      </Sheet>
    </div>
  );
}
