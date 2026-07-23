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
import {
  createDefectDetail,
  updateDefectDetail,
  deleteDefectDetail,
} from "@/lib/masters/defect-detail-actions";
import type { DefectDetail, DefectGroup, DefectDetailInput } from "@/lib/masters/defect-detail-types";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean; canExport?: boolean };

const BLANK = {
  defect_catg_id: "",
  defect_id: "",
  defect_det_id: "",
  name: "",
  defect_group_id: "",
  defect_type: "",
  is_active: true,
};

function autoCode(catg: string, id: string, det: string): string {
  const parts = [catg.trim(), id.trim(), det.trim()].filter(Boolean);
  return parts.join(".");
}

/**
 * Defect Detail master: three-part composite code (catg.id.det) plus name,
 * defect group FK picker, optional defect type, and active toggle.
 * Table on desktop, cards on mobile, Sheet editor.
 */
export function DefectDetailMasterScreen({
  rows,
  defectGroups,
  perms,
}: {
  rows: DefectDetail[];
  defectGroups: DefectGroup[];
  perms: Perms;
}) {
  const router = useRouter();
  const { success, error } = useToast();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(BLANK);

  const set = (patch: Partial<typeof BLANK>) => setForm((f) => ({ ...f, ...patch }));

  const groupLabel = useMemo(() => {
    const m = new Map<string, string>();
    for (const g of defectGroups) m.set(g.id, g.name);
    return m;
  }, [defectGroups]);

  const displayCode = autoCode(form.defect_catg_id, form.defect_id, form.defect_det_id);

  const { query, setQuery, filtered, filterValues, setFilter, activeCount, reset } = useMasterFilter(rows, {
    search: (r, q) =>
      [
        r.defect_catg_id,
        r.defect_id,
        r.defect_det_id,
        r.name,
        r.defect_type,
        r.defect_group?.name ?? (r.defect_group_id ? groupLabel.get(r.defect_group_id) : null),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q),
    filters: {
      status: (r, v) => (v === "active" ? r.is_active : v === "inactive" ? !r.is_active : true),
      group: (r, v) => r.defect_group_id === v,
    },
    initialFilters: { status: "", group: "" },
  });

  const pg = usePagination(filtered, 10);

  function openAdd() {
    setEditId(null);
    setForm(BLANK);
    setOpen(true);
  }
  function openEdit(r: DefectDetail) {
    setEditId(r.id);
    setForm({
      defect_catg_id: r.defect_catg_id,
      defect_id: r.defect_id,
      defect_det_id: r.defect_det_id,
      name: r.name,
      defect_group_id: r.defect_group_id ?? "",
      defect_type: r.defect_type ?? "",
      is_active: r.is_active,
    });
    setOpen(true);
  }

  const canSave =
    form.defect_catg_id.trim().length >= 2 &&
    form.defect_id.trim().length >= 2 &&
    form.defect_det_id.trim().length >= 2 &&
    form.name.trim().length > 0;

  function submit() {
    startTransition(async () => {
      const payload: DefectDetailInput = {
        defect_catg_id: form.defect_catg_id.trim(),
        defect_id: form.defect_id.trim(),
        defect_det_id: form.defect_det_id.trim(),
        name: form.name.trim(),
        defect_group_id: form.defect_group_id || null,
        defect_type: form.defect_type.trim() || null,
        is_active: form.is_active,
      };
      const res = editId
        ? await updateDefectDetail(editId, payload)
        : await createDefectDetail(payload);
      if (res.ok) {
        success(editId ? "Defect detail updated." : "Defect detail added.");
        setOpen(false);
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  function remove(r: DefectDetail) {
    startTransition(async () => {
      const res = await deleteDefectDetail(r.id);
      if (res.ok) {
        success("Defect detail deleted.");
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  function groupName(r: DefectDetail): string {
    return r.defect_group?.name ?? (r.defect_group_id ? groupLabel.get(r.defect_group_id) ?? "—" : "—");
  }

  const columns: Column<DefectDetail>[] = [
    {
      header: "Code",
      cell: (r) => (
        <span className="font-mono text-xs">
          {autoCode(r.defect_catg_id, r.defect_id, r.defect_det_id)}
        </span>
      ),
    },
    { header: "Name", cell: (r) => <span className="text-sm font-medium">{r.name}</span> },
    { header: "Defect Group", cell: (r) => <span className="text-sm">{groupName(r)}</span> },
    {
      header: "Type",
      cell: (r) => <span className="text-sm text-muted-foreground">{r.defect_type ?? "—"}</span>,
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
          searchPlaceholder="Search defect detail…"
          activeCount={activeCount}
          onReset={() => {
            reset();
            pg.setPage(1);
          }}
        >
          <div>
            <Label htmlFor="dd-filter-status">Status</Label>
            <Select
              id="dd-filter-status"
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
            <Label htmlFor="dd-filter-group">Defect Group</Label>
            <Select
              id="dd-filter-group"
              value={filterValues.group}
              onChange={(e) => {
                setFilter("group", e.target.value);
                pg.setPage(1);
              }}
              className="text-base md:text-sm"
            >
              <option value="">All</option>
              {defectGroups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </Select>
          </div>
        </FilterBar>
        <div className="flex flex-1 items-center justify-end gap-2">
          <DataIoToolbar entityKey="defect-details" rows={filtered} canExport={perms.canExport} />
          {perms.canCreate && (
            <Button size="md" onClick={openAdd}>
              + Add Defect Detail
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
          empty="No defect detail records yet."
        />
      </div>

      {/* mobile cards */}
      <div className="space-y-2.5 md:hidden">
        {pg.paged.length === 0 ? (
          <div className="rounded-lg border border-border bg-surface px-4 py-10 text-center text-sm text-muted-foreground">
            No defect detail records yet.
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
                    {autoCode(r.defect_catg_id, r.defect_id, r.defect_det_id)}
                    {r.defect_type ? ` · ${r.defect_type}` : ""}
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
        title={editId ? "Edit Defect Detail" : "New Defect Detail"}
        footer={
          <>
            <Button variant="outline" size="md" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button size="md" disabled={isPending || !canSave} onClick={submit}>
              {isPending ? "Saving…" : "Save"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <DetailSection label="Code Components">
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label htmlFor="dd-catg">
                  Category ID <span className="text-danger">*</span>
                </Label>
                <Input
                  id="dd-catg"
                  value={form.defect_catg_id}
                  onChange={(e) => set({ defect_catg_id: e.target.value })}
                  className="text-base md:text-sm"
                  minLength={2}
                />
              </div>
              <div>
                <Label htmlFor="dd-id">
                  Defect ID <span className="text-danger">*</span>
                </Label>
                <Input
                  id="dd-id"
                  value={form.defect_id}
                  onChange={(e) => set({ defect_id: e.target.value })}
                  className="text-base md:text-sm"
                  minLength={2}
                />
              </div>
              <div>
                <Label htmlFor="dd-det">
                  Detail ID <span className="text-danger">*</span>
                </Label>
                <Input
                  id="dd-det"
                  value={form.defect_det_id}
                  onChange={(e) => set({ defect_det_id: e.target.value })}
                  className="text-base md:text-sm"
                  minLength={2}
                />
              </div>
            </div>
            {displayCode && (
              <div>
                <Label>Generated Code</Label>
                <div className="rounded-md border border-border bg-surface-muted px-3 py-2 font-mono text-sm text-muted-foreground">
                  {displayCode}
                </div>
              </div>
            )}
          </DetailSection>

          <DetailSection label="Details" cols={2}>
            <div>
              <Label htmlFor="dd-name">
                Name <span className="text-danger">*</span>
              </Label>
              <Input
                id="dd-name"
                value={form.name}
                onChange={(e) => set({ name: e.target.value })}
                className="text-base md:text-sm"
              />
            </div>
            <div>
              <Label htmlFor="dd-group">Defect Group</Label>
              <Select
                id="dd-group"
                value={form.defect_group_id}
                onChange={(e) => set({ defect_group_id: e.target.value })}
                className="text-base md:text-sm"
              >
                <option value="">— None —</option>
                {defectGroups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="dd-type">Defect Type</Label>
              <Input
                id="dd-type"
                value={form.defect_type}
                onChange={(e) => set({ defect_type: e.target.value })}
                className="text-base md:text-sm"
              />
            </div>
          </DetailSection>

          {editId && (
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                className="h-4 w-4 cursor-pointer accent-primary"
                checked={!form.is_active}
                onChange={(e) => set({ is_active: !e.target.checked })}
              />
              <span className="text-sm text-foreground">Inactive</span>
            </label>
          )}
        </div>
      </Sheet>
    </div>
  );
}
