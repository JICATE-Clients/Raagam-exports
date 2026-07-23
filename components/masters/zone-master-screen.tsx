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
  createZone,
  updateZone,
  deactivateZone,
} from "@/lib/masters/zone-actions";
import type { Zone, ZoneInput } from "@/lib/masters/zone-types";
import { useDuplicateCheck } from "@/lib/masters/use-duplicate-check";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean; canExport?: boolean; isSuperAdmin?: boolean };
type ChildRow = { key: string; area_name: string };

const BLANK = {
  zone_short_name: "",
  zone_name: "",
  inactive: false,
};

export function ZoneMasterScreen({
  rows,
  perms,
}: {
  rows: Zone[];
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
  const nextKey = () => `zn-${++keyRef.current}`;

  const { query, setQuery, filtered, filterValues, setFilter, activeCount, reset } = useMasterFilter(
    rows,
    {
      search: (r, q) =>
        [r.zone_short_name, r.zone_name]
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

  // Real-time duplicate check on the zone name (mirrors the on-save guard).
  const dupError = useDuplicateCheck({
    table: "zones",
    name: form.zone_name,
    nameColumn: "zone_name",
    excludeId: editId ?? undefined,
    enabled: !!form.zone_name.trim(),
  });

  function openAdd() {
    setEditId(null);
    setForm(BLANK);
    setChildRows([]);
    setOpen(true);
  }
  function openEdit(r: Zone) {
    setEditId(r.id);
    setForm({
      zone_short_name: r.zone_short_name ?? "",
      zone_name: r.zone_name,
      inactive: r.inactive,
    });
    setChildRows(
      (r.areas ?? []).map((a) => ({
        key: nextKey(),
        area_name: a.area_name ?? "",
      })),
    );
    setOpen(true);
  }

  function addChildRow() {
    setChildRows((rs) => [...rs, { key: nextKey(), area_name: "" }]);
  }
  function updateChild(key: string, value: string) {
    setChildRows((rs) =>
      rs.map((r) => (r.key === key ? { ...r, area_name: value } : r)),
    );
  }
  function removeChildRow(key: string) {
    setChildRows((rs) => rs.filter((r) => r.key !== key));
  }

  function submit() {
    startTransition(async () => {
      const payload: ZoneInput = {
        // New records derive the short name from the display name; edits keep
        // the record's original stored short name (it can be a logic key).
        zone_short_name: (editId ? form.zone_short_name.trim() : form.zone_name.trim()) || null,
        zone_name: form.zone_name.trim(),
        inactive: form.inactive,
      };
      const children = childRows
        .filter((c) => c.area_name.trim())
        .map((c) => ({ area_name: c.area_name.trim() }));
      const res = editId
        ? await updateZone(editId, payload, children)
        : await createZone(payload, children);
      if (res.ok) {
        success(editId ? "Zone updated." : "Zone added.");
        setOpen(false);
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  function deactivate(r: Zone) {
    startTransition(async () => {
      const res = await deactivateZone(r.id);
      if (res.ok) {
        success("Zone marked inactive.");
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  const columns: Column<Zone>[] = [
    { header: "Zone Name", cell: (r) => <span className="text-sm">{r.zone_name}</span> },
    {
      header: "Areas",
      align: "right",
      cell: (r) => (
        <span className="tabular-nums text-sm text-muted-foreground">
          {r.areas?.length || "---"}
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
          searchPlaceholder="Search zone..."
          activeCount={activeCount}
          onReset={() => {
            reset();
            pg.setPage(1);
          }}
        >
          <div>
            <Label htmlFor="zn-filter-status">Status</Label>
            <Select
              id="zn-filter-status"
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
          <DataIoToolbar entityKey="zones" rows={filtered} canExport={perms.canExport} />
          {perms.canCreate && (
            <Button size="md" onClick={openAdd}>
              + Add Zone
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
          empty="No zone records yet."
        />
      </div>

      {/* mobile cards */}
      <div className="space-y-2.5 md:hidden">
        {pg.paged.length === 0 ? (
          <div className="rounded-lg border border-border bg-surface px-4 py-10 text-center text-sm text-muted-foreground">
            No zone records yet.
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
                    {r.zone_name}
                  </div>
                </div>
                <StatusPill tone={r.inactive ? "danger" : "success"}>
                  {r.inactive ? "Inactive" : "Active"}
                </StatusPill>
              </div>
              {(r.areas?.length ?? 0) > 0 && (
                <div className="mt-2 text-[13px] text-muted-foreground">
                  {r.areas!.length} area{r.areas!.length === 1 ? "" : "s"}
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
        title={editId ? "Edit Zone" : "New Zone"}
        footer={
          <>
            <Button variant="outline" size="md" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              size="md"
              disabled={isPending || !form.zone_name.trim() || !!dupError}
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
              <Label htmlFor="zn-name">
                Zone Name <span className="text-danger">*</span>
              </Label>
              <Input
                id="zn-name"
                value={form.zone_name}
                onChange={(e) => setForm({ ...form, zone_name: e.target.value })}
                required
                className="text-base md:text-sm"
              />
              {dupError && <p className="mt-1 text-xs text-danger">{dupError}</p>}
            </div>
          </DetailSection>

          {/* child grid: areas */}
          <div className="rounded-lg border border-border">
            <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
              <span className="text-sm font-medium">Areas</span>
              <Button variant="ghost" size="sm" onClick={addChildRow}>
                + Add
              </Button>
            </div>
            <div className="space-y-2 p-3">
              {childRows.length === 0 && (
                <p className="text-xs text-muted-foreground">No areas yet.</p>
              )}
              {childRows.map((row, i) => (
                <div key={row.key} className="flex items-center gap-2">
                  <span className="w-6 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                    {i + 1}
                  </span>
                  <Input
                    value={row.area_name}
                    onChange={(e) => updateChild(row.key, e.target.value)}
                    placeholder="Area name"
                    className="flex-1 text-base md:text-sm"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="shrink-0 text-muted-foreground hover:text-danger"
                    onClick={() => removeChildRow(row.key)}
                    aria-label="Remove area"
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
