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
import { useDuplicateCheck } from "@/lib/masters/use-duplicate-check";
import { FilterBar } from "@/components/masters/filter-bar";
import { DataIoToolbar } from "@/components/data-io/data-io-toolbar";
import { DetailSection } from "@/components/masters/detail-section";
import {
  createShadeGroup,
  updateShadeGroup,
  deactivateShadeGroup,
} from "@/lib/masters/shade-group-actions";
import type { ShadeGroup, ShadeGroupInput } from "@/lib/masters/shade-group-types";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean; canExport?: boolean; isSuperAdmin?: boolean };
type ChildRow = { key: string; shade_id: string; short_name: string; shade_name: string };

const BLANK = {
  short_name: "",
  name: "",
  hours_reqd: "",
  inactive: false,
};

export function ShadeGroupMasterScreen({
  rows,
  perms,
}: {
  rows: ShadeGroup[];
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
  const nextKey = () => `shg-${++keyRef.current}`;

  // Real-time duplicate check on Name (mirrors the on-save guard in shade-group-actions).
  const dupError = useDuplicateCheck({
    table: "shade_groups",
    name: form.name ?? "",
    excludeId: editId ?? undefined,
    enabled: !!form.name.trim(),
  });

  const { query, setQuery, filtered, filterValues, setFilter, activeCount, reset } = useMasterFilter(
    rows,
    {
      search: (r, q) =>
        [r.short_name, r.name]
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
  function openEdit(r: ShadeGroup) {
    setEditId(r.id);
    setForm({
      short_name: r.short_name ?? "",
      name: r.name,
      hours_reqd: r.hours_reqd != null ? String(r.hours_reqd) : "",
      inactive: r.inactive,
    });
    setChildRows(
      (r.shades ?? []).map((s) => ({
        key: nextKey(),
        shade_id: s.shade_id ?? "",
        short_name: s.short_name ?? "",
        shade_name: s.shade_name ?? "",
      })),
    );
    setOpen(true);
  }

  function addChildRow() {
    setChildRows((rs) => [...rs, { key: nextKey(), shade_id: "", short_name: "", shade_name: "" }]);
  }
  function updateChild(key: string, field: keyof Omit<ChildRow, "key">, value: string) {
    setChildRows((rs) =>
      rs.map((r) => (r.key === key ? { ...r, [field]: value } : r)),
    );
  }
  function removeChildRow(key: string) {
    setChildRows((rs) => rs.filter((r) => r.key !== key));
  }

  function submit() {
    startTransition(async () => {
      const payload: ShadeGroupInput = {
        // merged: Short Name = Name on create; edits keep the stored short name
        short_name: editId ? form.short_name.trim() || null : form.name.trim() || null,
        name: form.name.trim(),
        hours_reqd: form.hours_reqd ? Number(form.hours_reqd) : null,
        inactive: form.inactive,
      };
      const children = childRows
        .filter((c) => c.shade_id.trim() || c.short_name.trim() || c.shade_name.trim())
        .map((c) => ({
          shade_id: c.shade_id.trim() || null,
          short_name: c.short_name.trim() || null,
          shade_name: c.shade_name.trim() || null,
        }));
      const res = editId
        ? await updateShadeGroup(editId, payload, children)
        : await createShadeGroup(payload, children);
      if (res.ok) {
        success(editId ? "Shade group updated." : "Shade group added.");
        setOpen(false);
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  function deactivate(r: ShadeGroup) {
    startTransition(async () => {
      const res = await deactivateShadeGroup(r.id);
      if (res.ok) {
        success("Shade group marked inactive.");
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  const columns: Column<ShadeGroup>[] = [
    { header: "Name", cell: (r) => <span className="text-sm">{r.name}</span> },
    {
      header: "Hours",
      align: "right",
      cell: (r) => (
        <span className="tabular-nums text-sm text-muted-foreground">
          {r.hours_reqd != null ? r.hours_reqd : "---"}
        </span>
      ),
    },
    {
      header: "Shades",
      align: "right",
      cell: (r) => (
        <span className="tabular-nums text-sm text-muted-foreground">
          {r.shades?.length || "---"}
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
          searchPlaceholder="Search shade group..."
          activeCount={activeCount}
          onReset={() => {
            reset();
            pg.setPage(1);
          }}
        >
          <div>
            <Label htmlFor="shg-filter-status">Status</Label>
            <Select
              id="shg-filter-status"
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
          <DataIoToolbar entityKey="shade_groups" rows={filtered} canExport={perms.canExport} />
          {perms.canCreate && (
            <Button size="md" onClick={openAdd}>
              + Add Shade Group
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
          empty="No shade group records yet."
        />
      </div>

      {/* mobile cards */}
      <div className="space-y-2.5 md:hidden">
        {pg.paged.length === 0 ? (
          <div className="rounded-lg border border-border bg-surface px-4 py-10 text-center text-sm text-muted-foreground">
            No shade group records yet.
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
                    {r.name}
                  </div>
                  {r.short_name && (
                    <div className="mt-0.5 text-xs text-muted-foreground">{r.short_name}</div>
                  )}
                </div>
                <StatusPill tone={r.inactive ? "danger" : "success"}>
                  {r.inactive ? "Inactive" : "Active"}
                </StatusPill>
              </div>
              {(r.shades?.length ?? 0) > 0 && (
                <div className="mt-2 text-[13px] text-muted-foreground">
                  {r.shades!.length} shade{r.shades!.length === 1 ? "" : "s"}
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
        title={editId ? "Edit Shade Group" : "New Shade Group"}
        footer={
          <>
            <Button variant="outline" size="md" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              size="md"
              disabled={isPending || !form.name.trim() || !!dupError}
              onClick={submit}
            >
              {isPending ? "Saving..." : "Save"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <DetailSection label="Details">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="shg-hours">Hours Reqd</Label>
                <Input
                  id="shg-hours"
                  type="number"
                  step="any"
                  value={form.hours_reqd}
                  onChange={(e) => setForm({ ...form, hours_reqd: e.target.value })}
                  placeholder="Processing hours"
                  className="text-base md:text-sm"
                />
              </div>
            </div>
            <div>
              <Label htmlFor="shg-name">
                Name <span className="text-danger">*</span>
              </Label>
              <Input
                id="shg-name"
                uppercase
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                required
                className="text-base md:text-sm"
              />
              {dupError && <p className="mt-1 text-xs text-danger">{dupError}</p>}
            </div>
          </DetailSection>

          {/* child grid: shades */}
          <div className="rounded-lg border border-border">
            <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
              <span className="text-sm font-medium">Shades</span>
              <Button variant="ghost" size="sm" onClick={addChildRow}>
                + Add
              </Button>
            </div>
            <div className="space-y-2 p-3">
              {childRows.length === 0 && (
                <p className="text-xs text-muted-foreground">No shades yet.</p>
              )}
              {childRows.map((row, i) => (
                <div key={row.key} className="flex items-center gap-2">
                  <span className="w-6 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                    {i + 1}
                  </span>
                  <Input
                    value={row.shade_id}
                    onChange={(e) => updateChild(row.key, "shade_id", e.target.value)}
                    placeholder="ID"
                    className="w-20 text-base md:text-sm"
                  />
                  <Input
                    value={row.short_name}
                    onChange={(e) => updateChild(row.key, "short_name", e.target.value)}
                    placeholder="Short"
                    className="w-24 text-base md:text-sm"
                  />
                  <Input
                    value={row.shade_name}
                    onChange={(e) => updateChild(row.key, "shade_name", e.target.value)}
                    placeholder="Shade name"
                    className="flex-1 text-base md:text-sm"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="shrink-0 text-muted-foreground hover:text-danger"
                    onClick={() => removeChildRow(row.key)}
                    aria-label="Remove shade"
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
