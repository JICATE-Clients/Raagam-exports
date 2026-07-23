"use client";

import { useRef, useState, useTransition } from "react";
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
import { DetailSection } from "@/components/masters/detail-section";
import {
  createSizeGroup,
  updateSizeGroup,
  deactivateSizeGroup,
} from "@/lib/masters/size-group-actions";
import type { SizeGroup, SizeGroupInput } from "@/lib/masters/size-group-types";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean; canExport?: boolean; isSuperAdmin?: boolean };
type ChildRow = { key: string; size_name: string; sort_order: number | null };

const BLANK = {
  size_group_no: "",
  size_group_name: "",
  inactive: false,
};

export function SizeGroupMasterScreen({
  rows,
  perms,
}: {
  rows: SizeGroup[];
  perms: Perms;
}) {
  const router = useRouter();
  const { success, error } = useToast();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(BLANK);
  const [childRows, setChildRows] = useState<ChildRow[]>([]);
  const keyRef = useRef(0);
  const nextKey = () => `sg-${++keyRef.current}`;

  const { query, setQuery, filtered, filterValues, setFilter, activeCount, reset } = useMasterFilter(
    rows,
    {
      search: (r, q) =>
        [r.size_group_no, r.size_group_name]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(q),
      filters: {
        status: (r, v) => (v === "active" ? !r.inactive : v === "inactive" ? !!r.inactive : true),
      },
      initialFilters: { status: "" },
    },
  );

  const pg = usePagination(filtered, 10);

  function openAdd() {
    setEditId(null);
    setForm(BLANK);
    setChildRows([]);
    setOpen(true);
  }
  function openEdit(r: SizeGroup) {
    setEditId(r.id);
    setForm({
      size_group_no: r.size_group_no ?? "",
      size_group_name: r.size_group_name ?? "",
      inactive: r.inactive,
    });
    setChildRows(
      (r.sizes ?? []).map((s) => ({
        key: nextKey(),
        size_name: s.size_name,
        sort_order: s.sort_order,
      })),
    );
    setOpen(true);
  }

  function addChildRow() {
    setChildRows((rs) => [...rs, { key: nextKey(), size_name: "", sort_order: null }]);
  }
  function updateChild(key: string, field: keyof Omit<ChildRow, "key">, value: string) {
    setChildRows((rs) =>
      rs.map((r) =>
        r.key === key
          ? { ...r, [field]: field === "sort_order" ? (value ? Number(value) : null) : value }
          : r,
      ),
    );
  }
  function removeChildRow(key: string) {
    setChildRows((rs) => rs.filter((r) => r.key !== key));
  }

  function submit() {
    startTransition(async () => {
      const payload: SizeGroupInput = {
        size_group_no: form.size_group_no.trim() || null,
        size_group_name: form.size_group_name.trim() || null,
        inactive: form.inactive,
      };
      const children = childRows
        .filter((c) => c.size_name.trim())
        .map((c, i) => ({ size_name: c.size_name.trim(), sort_order: c.sort_order ?? i + 1 }));
      const res = editId
        ? await updateSizeGroup(editId, payload, children)
        : await createSizeGroup(payload, children);
      if (res.ok) {
        success(editId ? "Size group updated." : "Size group added.");
        setOpen(false);
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  function deactivate(r: SizeGroup) {
    startTransition(async () => {
      const res = await deactivateSizeGroup(r.id);
      if (res.ok) {
        success("Size group marked inactive.");
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  const canSave = !!form.size_group_name.trim();

  const columns: Column<SizeGroup>[] = [
    { header: "No", cell: (r) => <span className="font-mono text-xs">{r.size_group_no ?? "---"}</span> },
    { header: "Name", cell: (r) => <span className="text-sm">{r.size_group_name ?? "---"}</span> },
    {
      header: "Sizes",
      align: "right",
      cell: (r) => (
        <span className="tabular-nums text-sm text-muted-foreground">
          {r.sizes?.length || "---"}
        </span>
      ),
    },
    {
      header: "Status",
      cell: (r) => (
        <StatusPill tone={r.inactive ? "danger" : "success"}>
          {r.inactive ? "Inactive" : "Active"}
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
          {perms.canDelete && !r.inactive && (
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground hover:text-danger"
              disabled={isPending}
              onClick={() => deactivate(r)}
            >
              Deactivate
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
          searchPlaceholder="Search size group..."
          activeCount={activeCount}
          onReset={() => {
            reset();
            pg.setPage(1);
          }}
        >
          <div>
            <Label htmlFor="sg-filter-status">Status</Label>
            <Select
              id="sg-filter-status"
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
          <DataIoToolbar entityKey="size_groups" rows={filtered} canExport={perms.canExport} />
          {perms.canCreate && (
            <Button size="md" onClick={openAdd}>
              + Add Size Group
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
          empty="No size group records yet."
        />
      </div>

      {/* mobile cards */}
      <div className="space-y-2.5 md:hidden">
        {pg.paged.length === 0 ? (
          <div className="rounded-lg border border-border bg-surface px-4 py-10 text-center text-sm text-muted-foreground">
            No size group records yet.
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
                    {r.size_group_name ?? r.size_group_no ?? "---"}
                  </div>
                  {r.size_group_no && (
                    <div className="mt-0.5 text-xs text-muted-foreground">{r.size_group_no}</div>
                  )}
                </div>
                <StatusPill tone={r.inactive ? "danger" : "success"}>
                  {r.inactive ? "Inactive" : "Active"}
                </StatusPill>
              </div>
              {(r.sizes?.length ?? 0) > 0 && (
                <div className="mt-2 text-[13px] text-muted-foreground">
                  {r.sizes!.length} size{r.sizes!.length === 1 ? "" : "s"}
                </div>
              )}
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
        title={editId ? "Edit Size Group" : "New Size Group"}
        footer={
          <>
            <Button variant="outline" size="md" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              size="md"
              disabled={isPending || !canSave}
              onClick={submit}
            >
              {isPending ? "Saving..." : "Save"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <DetailSection label="Details">
            <div>
              <Label htmlFor="sg-name">
                Group Name <span className="text-danger">*</span>
              </Label>
              <Input
                id="sg-name"
                uppercase
                value={form.size_group_name}
                onChange={(e) => setForm({ ...form, size_group_name: e.target.value })}
                placeholder="Size group name"
                className="text-base md:text-sm"
              />
              {!editId && (
                <p className="mt-1 text-xs text-muted-foreground">
                  The group no. is generated automatically from the name.
                </p>
              )}
            </div>
          </DetailSection>

          {/* child grid: sizes */}
          <div className="rounded-lg border border-border">
            <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
              <span className="text-sm font-medium">Sizes</span>
              <Button variant="ghost" size="sm" onClick={addChildRow}>
                + Add
              </Button>
            </div>
            <div className="space-y-2 p-3">
              {childRows.length === 0 && (
                <p className="text-xs text-muted-foreground">No sizes yet.</p>
              )}
              {childRows.map((row, i) => (
                <div key={row.key} className="flex items-center gap-2">
                  <span className="w-6 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                    {i + 1}
                  </span>
                  <Input
                    value={row.size_name}
                    onChange={(e) => updateChild(row.key, "size_name", e.target.value)}
                    placeholder="Size name"
                    className="flex-1 text-base md:text-sm"
                  />
                  <Input
                    type="number"
                    value={row.sort_order ?? ""}
                    onChange={(e) => updateChild(row.key, "sort_order", e.target.value)}
                    placeholder="Order"
                    className="w-20 text-base md:text-sm"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="shrink-0 text-muted-foreground hover:text-danger"
                    onClick={() => removeChildRow(row.key)}
                    aria-label="Remove size"
                  >
                    ✕
                  </Button>
                </div>
              ))}
            </div>
          </div>

          {editId && (
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                className="h-4 w-4 cursor-pointer accent-primary"
                checked={form.inactive}
                onChange={(e) => setForm({ ...form, inactive: e.target.checked })}
              />
              <span className="text-sm text-foreground">Inactive</span>
            </label>
          )}
        </div>
      </Sheet>
    </div>
  );
}
