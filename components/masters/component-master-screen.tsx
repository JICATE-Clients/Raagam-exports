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
import {
  createComponent,
  updateComponent,
  deleteComponent,
} from "@/lib/masters/component-actions";
import type { Component, ComponentInput } from "@/lib/masters/component-types";
import { useDuplicateCheck } from "@/lib/masters/use-duplicate-check";
import { DetailSection } from "@/components/masters/detail-section";
import { ChildGrid } from "@/components/masters/child-grid";
import { DeleteConfirmButton } from "@/components/masters/delete-confirm-button";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean; canExport?: boolean };
type CoordinateRow = { key: string; coordinate: string };

const BLANK = { short_name: "", description: "", all_coordinates: true, inactive: false };

/**
 * Master-detail CRUD for the legacy "Component" master: a header (Short Name
 * req · Description · All Coordinates · Inactive) plus a "Coordinates" grid of
 * free-text coordinate labels. Dense table on desktop, cards on mobile, shared
 * <Sheet> editor.
 */
export function ComponentMasterScreen({
  rows,
  perms,
}: {
  rows: Component[];
  perms: Perms;
}) {
  const router = useRouter();
  const { success, error } = useToast();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(BLANK);
  const [coordinates, setCoordinates] = useState<CoordinateRow[]>([]);
  const keySeq = useRef(0);
  const newKey = () => `c${keySeq.current++}`;

  // Real-time duplicate check on Short Name (mirrors the on-save guard in component-actions).
  const dupError = useDuplicateCheck({
    table: "components",
    name: form.short_name ?? "",
    nameColumn: "short_name",
    excludeId: editId ?? undefined,
    enabled: !!form.short_name.trim(),
  });

  const { query, setQuery, filtered, filterValues, setFilter, activeCount, reset } = useMasterFilter(rows, {
    search: (r, q) =>
      [r.short_name, r.description, ...r.coordinates.map((c) => c.coordinate)]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q),
    filters: {
      status: (r, v) => (v === "active" ? !r.inactive : v === "inactive" ? !!r.inactive : true),
      allCoordinates: (r, v) =>
        v === "yes" ? r.all_coordinates : v === "no" ? !r.all_coordinates : true,
    },
    initialFilters: { status: "", allCoordinates: "" },
  });

  const pg = usePagination(filtered, 10);

  function openAdd() {
    setEditId(null);
    setForm(BLANK);
    setCoordinates([{ key: newKey(), coordinate: "" }]);
    setOpen(true);
  }
  function openEdit(r: Component) {
    setEditId(r.id);
    setForm({
      short_name: r.short_name,
      description: r.description ?? "",
      all_coordinates: r.all_coordinates,
      inactive: r.inactive,
    });
    setCoordinates(r.coordinates.map((c) => ({ key: newKey(), coordinate: c.coordinate })));
    setOpen(true);
  }

  function addCoordinate() {
    setCoordinates((cs) => [...cs, { key: newKey(), coordinate: "" }]);
  }
  function setCoordinateAt(key: string, coordinate: string) {
    setCoordinates((cs) => cs.map((c) => (c.key === key ? { ...c, coordinate } : c)));
  }
  function removeCoordinate(key: string) {
    setCoordinates((cs) => cs.filter((c) => c.key !== key));
  }

  function submit() {
    startTransition(async () => {
      // "All Coordinates" means this component applies to every coordinate,
      // which makes a specific list meaningless — and the list column never
      // shows it either way (`r.all_coordinates ? "All" : ...`). Clear it on
      // save so the DB doesn't carry a stale list nobody can see or edit.
      const payload: ComponentInput = {
        short_name: form.short_name.trim(),
        description: form.description.trim() || null,
        all_coordinates: form.all_coordinates,
        inactive: form.inactive,
        coordinates: form.all_coordinates
          ? []
          : coordinates.filter((c) => c.coordinate.trim()).map((c, i) => ({ sno: i + 1, coordinate: c.coordinate.trim() })),
      };
      const res = editId ? await updateComponent(editId, payload) : await createComponent(payload);
      if (res.ok) {
        success(editId ? "Component updated." : "Component added.");
        setOpen(false);
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  function remove(r: Component) {
    startTransition(async () => {
      const res = await deleteComponent(r.id);
      if (res.ok) {
        success("Component deleted.");
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  const columns: Column<Component>[] = [
    { header: "Short Name", cell: (r) => <span className="text-sm font-medium">{r.short_name}</span> },
    {
      header: "Description",
      cell: (r) => <span className="text-sm text-muted-foreground">{r.description ?? "—"}</span>,
    },
    {
      header: "Coordinates",
      cell: (r) => (
        <span className="text-sm text-muted-foreground">
          {r.all_coordinates
            ? "All"
            : r.coordinates.length
              ? r.coordinates.map((c) => c.coordinate).join(", ")
              : "—"}
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
          searchPlaceholder="Search component…"
          activeCount={activeCount}
          onReset={() => {
            reset();
            pg.setPage(1);
          }}
        >
          <div>
            <Label htmlFor="component-filter-status">Status</Label>
            <Select
              id="component-filter-status"
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
            <Label htmlFor="component-filter-allcoords">All Coordinates</Label>
            <Select
              id="component-filter-allcoords"
              value={filterValues.allCoordinates}
              onChange={(e) => {
                setFilter("allCoordinates", e.target.value);
                pg.setPage(1);
              }}
              className="text-base md:text-sm"
            >
              <option value="">All</option>
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </Select>
          </div>
        </FilterBar>
        <div className="flex flex-1 items-center justify-end gap-2">
          <DataIoToolbar entityKey="components" rows={filtered} canExport={perms.canExport} />
          {perms.canCreate && (
            <Button size="md" onClick={openAdd}>
              + Add Component
            </Button>
          )}
        </div>
      </div>

      {/* desktop table */}
      <div className="hidden md:block">
        <DataTable columns={columns} rows={pg.paged} getKey={(r) => r.id} empty="No component records yet." />
      </div>

      {/* mobile cards */}
      <div className="space-y-2.5 md:hidden">
        {pg.paged.length === 0 ? (
          <div className="rounded-lg border border-border bg-surface px-4 py-10 text-center text-sm text-muted-foreground">
            No component records yet.
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
                    {r.short_name}
                  </div>
                  {r.description && (
                    <div className="mt-0.5 text-xs text-muted-foreground">{r.description}</div>
                  )}
                </div>
                <StatusPill tone={r.inactive ? "danger" : "success"}>
                  {r.inactive ? "Inactive" : "Active"}
                </StatusPill>
              </div>
              <div className="mt-2 text-[13px] text-muted-foreground">
                {r.all_coordinates
                  ? "All coordinates"
                  : r.coordinates.length
                    ? r.coordinates.map((c) => c.coordinate).join(", ")
                    : "No coordinates"}
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
        title={editId ? "Edit Component" : "New Component"}
        footer={
          <>
            <Button variant="outline" size="md" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button size="md" disabled={isPending || !form.short_name.trim() || !!dupError} onClick={submit}>
              {isPending ? "Saving…" : "Save"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <DetailSection label="Details" cols={2}>
            <div>
              <Label htmlFor="cmp-short">
                Short Name <span className="text-danger">*</span>
              </Label>
              <Input
                id="cmp-short"
                uppercase
                value={form.short_name}
                onChange={(e) => setForm({ ...form, short_name: e.target.value })}
                className="text-base md:text-sm"
              />
              {dupError && <p className="mt-1 text-xs text-danger">{dupError}</p>}
            </div>
            <div>
              <Label htmlFor="cmp-desc">Description</Label>
              <Input
                id="cmp-desc"
                uppercase
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                className="text-base md:text-sm"
              />
            </div>
          </DetailSection>

          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              className="h-4 w-4 cursor-pointer accent-primary"
              checked={form.all_coordinates}
              onChange={(e) => setForm({ ...form, all_coordinates: e.target.checked })}
            />
            <span className="text-sm text-foreground">All Coordinates</span>
          </label>

          {/* Coordinates grid — hidden while "All Coordinates" is ticked */}
          {!form.all_coordinates && (
            <ChildGrid<CoordinateRow>
              label="Coordinates"
              rows={coordinates}
              onAdd={addCoordinate}
              onRemove={(c) => removeCoordinate(c.key)}
              addLabel="+ Add line"
              columns={[
                {
                  header: "Coordinate",
                  cell: (c) => (
                    <Input value={c.coordinate} onChange={(e) => setCoordinateAt(c.key, e.target.value)} placeholder="Coordinate" className="text-base md:text-sm" />
                  ),
                },
              ]}
            />
          )}

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
