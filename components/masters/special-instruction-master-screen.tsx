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
  createSpecialInstruction,
  updateSpecialInstruction,
  deleteSpecialInstruction,
} from "@/lib/masters/simple-master-actions";

type Row = { id: string; code: string; description: string; is_active: boolean };
type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean; canExport?: boolean };

const BLANK = { code: "", description: "", inactive: false };

export function SpecialInstructionMasterScreen({ rows, perms }: { rows: Row[]; perms: Perms }) {
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
        [r.code, r.description].filter(Boolean).join(" ").toLowerCase().includes(q),
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
    setForm({ code: r.code, description: r.description, inactive: !r.is_active });
    setOpen(true);
  }

  function submit() {
    startTransition(async () => {
      const code = form.code.trim();
      const description = form.description.trim() || code;
      const payload = { code, description, is_active: !form.inactive };
      const res = editId
        ? await updateSpecialInstruction(editId, payload)
        : await createSpecialInstruction(payload);
      if (res.ok) {
        success(editId ? "Special instruction updated." : "Special instruction added.");
        setOpen(false);
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  function remove(r: Row) {
    startTransition(async () => {
      const res = await deleteSpecialInstruction(r.id);
      if (res.ok) {
        success(res.inactive ? "Special instruction marked inactive." : "Special instruction deleted.");
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  const columns: Column<Row>[] = [
    { header: "Code", cell: (r) => <span className="font-mono text-xs">{r.code}</span> },
    {
      header: "Description",
      cell: (r) => <span className="text-sm">{r.description}</span>,
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
      <div className="flex flex-wrap items-center gap-2">
        <FilterBar
          search={query}
          onSearch={(v) => { setQuery(v); pg.setPage(1); }}
          searchPlaceholder="Search special instruction..."
          activeCount={activeCount}
          onReset={() => { reset(); pg.setPage(1); }}
        >
          <div>
            <Label htmlFor="si-filter-status">Status</Label>
            <Select
              id="si-filter-status"
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
          <DataIoToolbar entityKey="special-instructions" rows={filtered} canExport={perms.canExport} />
          {perms.canCreate && (
            <Button size="md" onClick={openAdd}>
              + Add Special Instruction
            </Button>
          )}
        </div>
      </div>

      <div className="hidden md:block">
        <DataTable columns={columns} rows={pg.paged} getKey={(r) => r.id} empty="No special instruction records yet." />
      </div>

      <div className="space-y-2.5 md:hidden">
        {pg.paged.length === 0 ? (
          <div className="rounded-lg border border-border bg-surface px-4 py-10 text-center text-sm text-muted-foreground">
            No special instruction records yet.
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
                  <div className="mt-0.5 font-mono text-xs text-muted-foreground">{r.code}</div>
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
        title={editId ? "Edit Special Instruction" : "New Special Instruction"}
        footer={
          <>
            <Button variant="outline" size="md" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button size="md" disabled={isPending || !form.code.trim()} onClick={submit}>
              {isPending ? "Saving..." : "Save"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <Label htmlFor="si-code">
              Code <span className="text-danger">*</span>
            </Label>
            <Input
              id="si-code"
              value={form.code}
              onChange={(e) => setForm({ ...form, code: e.target.value })}
              required
              className="text-base md:text-sm"
            />
          </div>
          <div>
            <Label htmlFor="si-description">
              Description <span className="text-danger">*</span>
            </Label>
            <Input
              id="si-description"
              value={form.description}
              placeholder={form.code || undefined}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              className="text-base md:text-sm"
            />
            {!form.description.trim() && form.code.trim() && (
              <p className="mt-1 text-xs text-muted-foreground">Defaults to code if left blank.</p>
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
