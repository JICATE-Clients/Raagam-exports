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
import { DetailSection } from "@/components/masters/detail-section";
import {
  createPrintProcess,
  updatePrintProcess,
  deletePrintProcess,
} from "@/lib/masters/print-process-actions";
import {
  PRINT_PROCESS_FLAGS,
  type PrintProcess,
  type PrintProcessInput,
} from "@/lib/masters/print-process-types";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean; canExport?: boolean };

const BLANK = {
  code: "",
  name: "",
  is_yarn_process: false,
  is_fabric_process: false,
  is_cmt_process: false,
  is_trims_process: false,
  is_pieces_process: false,
  is_active: true,
};

function forSummary(r: PrintProcess | typeof BLANK): string {
  const on = PRINT_PROCESS_FLAGS.filter((f) => r[f.key as keyof typeof r]).map((f) => f.label);
  return on.length ? on.join(", ") : "—";
}

/**
 * Print Process master: unique code + name, process type flags (at least one
 * required), active toggle. Code auto-copies to name if name is empty.
 * Table on desktop, cards on mobile, Sheet editor.
 */
export function PrintProcessMasterScreen({ rows, perms }: { rows: PrintProcess[]; perms: Perms }) {
  const router = useRouter();
  const { success, error } = useToast();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(BLANK);

  const set = (patch: Partial<typeof BLANK>) => setForm((f) => ({ ...f, ...patch }));

  const hasAnyFlag =
    form.is_yarn_process ||
    form.is_fabric_process ||
    form.is_cmt_process ||
    form.is_trims_process ||
    form.is_pieces_process;

  const { query, setQuery, filtered, filterValues, setFilter, activeCount, reset } = useMasterFilter(rows, {
    search: (r, q) =>
      [r.code, r.name, forSummary(r)].filter(Boolean).join(" ").toLowerCase().includes(q),
    filters: {
      status: (r, v) => (v === "active" ? r.is_active : v === "inactive" ? !r.is_active : true),
    },
    initialFilters: { status: "" },
  });

  const pg = usePagination(filtered, 10);

  function openAdd() {
    setEditId(null);
    setForm(BLANK);
    setOpen(true);
  }
  function openEdit(r: PrintProcess) {
    setEditId(r.id);
    setForm({
      code: r.code,
      name: r.name,
      is_yarn_process: r.is_yarn_process,
      is_fabric_process: r.is_fabric_process,
      is_cmt_process: r.is_cmt_process,
      is_trims_process: r.is_trims_process,
      is_pieces_process: r.is_pieces_process,
      is_active: r.is_active,
    });
    setOpen(true);
  }

  function handleCodeChange(val: string) {
    set({ code: val, name: form.name || val });
  }

  function submit() {
    if (!hasAnyFlag) {
      error("At least one process type must be selected.");
      return;
    }
    startTransition(async () => {
      const payload: PrintProcessInput = {
        code: form.code.trim(),
        name: form.name.trim() || form.code.trim(),
        is_yarn_process: form.is_yarn_process,
        is_fabric_process: form.is_fabric_process,
        is_cmt_process: form.is_cmt_process,
        is_trims_process: form.is_trims_process,
        is_pieces_process: form.is_pieces_process,
        is_active: form.is_active,
      };
      const res = editId ? await updatePrintProcess(editId, payload) : await createPrintProcess(payload);
      if (res.ok) {
        success(editId ? "Print process updated." : "Print process added.");
        setOpen(false);
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  function remove(r: PrintProcess) {
    startTransition(async () => {
      const res = await deletePrintProcess(r.id);
      if (res.ok) {
        success("Print process deleted.");
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  const columns: Column<PrintProcess>[] = [
    { header: "Code", cell: (r) => <span className="font-mono text-xs">{r.code}</span> },
    { header: "Name", cell: (r) => <span className="text-sm font-medium">{r.name}</span> },
    {
      header: "For",
      cell: (r) => <span className="text-sm text-muted-foreground">{forSummary(r)}</span>,
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
          searchPlaceholder="Search print process…"
          activeCount={activeCount}
          onReset={() => {
            reset();
            pg.setPage(1);
          }}
        >
          <div>
            <Label htmlFor="pp-filter-status">Status</Label>
            <Select
              id="pp-filter-status"
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
          <DataIoToolbar entityKey="print-processes" rows={filtered} canExport={perms.canExport} />
          {perms.canCreate && (
            <Button size="md" onClick={openAdd}>
              + Add Print Process
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
          empty="No print process records yet."
        />
      </div>

      {/* mobile cards */}
      <div className="space-y-2.5 md:hidden">
        {pg.paged.length === 0 ? (
          <div className="rounded-lg border border-border bg-surface px-4 py-10 text-center text-sm text-muted-foreground">
            No print process records yet.
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
                    {` · ${forSummary(r)}`}
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
        title={editId ? "Edit Print Process" : "New Print Process"}
        footer={
          <>
            <Button variant="outline" size="md" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              size="md"
              disabled={isPending || !form.code.trim() || !hasAnyFlag}
              onClick={submit}
            >
              {isPending ? "Saving…" : "Save"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <Label htmlFor="pp-code">
              Code <span className="text-danger">*</span>
            </Label>
            <Input
              id="pp-code"
              value={form.code}
              onChange={(e) => handleCodeChange(e.target.value)}
              className="text-base md:text-sm"
            />
          </div>
          <div>
            <Label htmlFor="pp-name">
              Name <span className="text-danger">*</span>
            </Label>
            <Input
              id="pp-name"
              value={form.name}
              onChange={(e) => set({ name: e.target.value })}
              className="text-base md:text-sm"
            />
          </div>

          <DetailSection label="Process Types">
            {!hasAnyFlag && (
              <p className="text-xs text-danger">At least one process type must be selected.</p>
            )}
            <div className="grid grid-cols-2 gap-2">
              {PRINT_PROCESS_FLAGS.map((f) => (
                <label key={f.key} className="flex cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    className="h-4 w-4 cursor-pointer accent-primary"
                    checked={form[f.key as keyof typeof form] as boolean}
                    onChange={(e) => set({ [f.key]: e.target.checked } as Partial<typeof BLANK>)}
                  />
                  <span className="text-sm text-foreground">{f.label}</span>
                </label>
              ))}
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
