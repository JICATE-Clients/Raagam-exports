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
  createDomesticProductDesign,
  updateDomesticProductDesign,
  deleteDomesticProductDesign,
} from "@/lib/masters/simple-master-actions";

type Row = { id: string; design_no: string; description: string; is_active: boolean };
type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean; canExport?: boolean };

const BLANK = { design_no: "", description: "", inactive: false };

export function DomesticProductDesignMasterScreen({ rows, perms }: { rows: Row[]; perms: Perms }) {
  const router = useRouter();
  const { success, error } = useToast();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(BLANK);

  const { query, setQuery, filtered, filterValues, setFilter, activeCount, reset } = useMasterFilter(
    rows,
    {
      search: (r, q) =>
        [r.design_no, r.description].filter(Boolean).join(" ").toLowerCase().includes(q),
      filters: {
        status: (r, v) => (v === "active" ? !!r.is_active : v === "inactive" ? !r.is_active : true),
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
  function openEdit(r: Row) {
    setEditId(r.id);
    setForm({ design_no: r.design_no, description: r.description, inactive: !r.is_active });
    setOpen(true);
  }

  function submit() {
    startTransition(async () => {
      const design_no = form.design_no.trim();
      const description = form.description.trim() || design_no;
      const payload = { design_no, description, is_active: !form.inactive };
      const res = editId
        ? await updateDomesticProductDesign(editId, payload)
        : await createDomesticProductDesign(payload);
      if (res.ok) {
        success(editId ? "Domestic product design updated." : "Domestic product design added.");
        setOpen(false);
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  function remove(r: Row) {
    startTransition(async () => {
      const res = await deleteDomesticProductDesign(r.id);
      if (res.ok) {
        success(res.inactive ? "Domestic product design marked inactive." : "Domestic product design deleted.");
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  const columns: Column<Row>[] = [
    { header: "Design No", cell: (r) => <span className="font-mono text-xs">{r.design_no}</span> },
    { header: "Description", cell: (r) => <span className="text-sm">{r.description}</span> },
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
      <div className="flex flex-wrap items-center gap-2">
        <FilterBar
          search={query}
          onSearch={(v) => { setQuery(v); pg.setPage(1); }}
          searchPlaceholder="Search domestic product design..."
          activeCount={activeCount}
          onReset={() => { reset(); pg.setPage(1); }}
        >
          <div>
            <Label htmlFor="dpd-filter-status">Status</Label>
            <Select
              id="dpd-filter-status"
              value={filterValues.status}
              onChange={(e) => { setFilter("status", e.target.value); pg.setPage(1); }}
              className="text-base md:text-sm"
            >
              <option value="">All</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </Select>
          </div>
        </FilterBar>
        <div className="flex flex-1 items-center justify-end gap-2">
          <DataIoToolbar entityKey="domestic-product-designs" rows={filtered} canExport={perms.canExport} />
          {perms.canCreate && (
            <Button size="md" onClick={openAdd}>
              + Add Domestic Product Design
            </Button>
          )}
        </div>
      </div>

      <div className="hidden md:block">
        <DataTable columns={columns} rows={pg.paged} getKey={(r) => r.id} empty="No domestic product design records yet." />
      </div>

      <div className="space-y-2.5 md:hidden">
        {pg.paged.length === 0 ? (
          <div className="rounded-lg border border-border bg-surface px-4 py-10 text-center text-sm text-muted-foreground">
            No domestic product design records yet.
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
                  <div className="truncate text-[15px] font-semibold text-foreground">{r.description}</div>
                  <div className="mt-0.5 font-mono text-xs text-muted-foreground">{r.design_no}</div>
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

      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={editId ? "Edit Domestic Product Design" : "New Domestic Product Design"}
        footer={
          <>
            <Button variant="outline" size="md" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button size="md" disabled={isPending || !form.design_no.trim()} onClick={submit}>
              {isPending ? "Saving..." : "Save"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <Label htmlFor="dpd-no">
              Design No <span className="text-danger">*</span>
            </Label>
            <Input
              id="dpd-no"
              value={form.design_no}
              onChange={(e) => setForm({ ...form, design_no: e.target.value })}
              required
              className="text-base md:text-sm"
            />
          </div>
          <div>
            <Label htmlFor="dpd-description">
              Description <span className="text-danger">*</span>
            </Label>
            <Input
              id="dpd-description"
              value={form.description}
              placeholder={form.design_no || undefined}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              className="text-base md:text-sm"
            />
            {!form.description.trim() && form.design_no.trim() && (
              <p className="mt-1 text-xs text-muted-foreground">Defaults to design no if left blank.</p>
            )}
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
