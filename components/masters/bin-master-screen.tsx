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
import { createBin, updateBin, deleteBin } from "@/lib/masters/bin-actions";
import type { Bin, BinInput } from "@/lib/masters/bin-types";

type LocationOption = { id: string; code: string | null; name: string | null };
type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean; canExport?: boolean; isSuperAdmin?: boolean };

const BLANK = {
  bin_code: "",
  location_id: "",
  description: "",
  blocked: false,
};

/**
 * Bin master (Materials): Bin Code (req) · Location (opt, simple dropdown) ·
 * Description · Blocked. Dense table on desktop, cards on mobile, shared
 * <Sheet> editor.
 */
export function BinMasterScreen({
  rows,
  locations,
  perms,
}: {
  rows: Bin[];
  locations: LocationOption[];
  perms: Perms;
}) {
  const router = useRouter();
  const { success, error } = useToast();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(BLANK);

  const set = (patch: Partial<typeof BLANK>) => setForm((f) => ({ ...f, ...patch }));

  const locationLabel = useMemo(() => {
    const m = new Map<string, string>();
    for (const l of locations) m.set(l.id, l.name ?? l.code ?? "—");
    return m;
  }, [locations]);

  const { query, setQuery, filtered, filterValues, setFilter, activeCount, reset } = useMasterFilter(rows, {
    search: (r, q) =>
      [r.bin_code, r.description, r.location?.name ?? (r.location_id ? locationLabel.get(r.location_id) : null)]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q),
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
  function openEdit(r: Bin) {
    setEditId(r.id);
    setForm({
      bin_code: r.bin_code ?? "",
      location_id: r.location_id ?? "",
      description: r.description ?? "",
      blocked: r.blocked,
    });
    setOpen(true);
  }

  function submit() {
    startTransition(async () => {
      const payload: BinInput = {
        bin_code: form.bin_code.trim(),
        location_id: form.location_id || null,
        description: form.description.trim() || null,
        blocked: form.blocked,
      };
      const res = editId ? await updateBin(editId, payload) : await createBin(payload);
      if (res.ok) {
        success(editId ? "Bin updated." : "Bin added.");
        setOpen(false);
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  function remove(r: Bin) {
    startTransition(async () => {
      const res = await deleteBin(r.id);
      if (res.ok) {
        success("Bin deleted.");
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  function locationName(r: Bin): string {
    return r.location?.name ?? (r.location_id ? locationLabel.get(r.location_id) ?? "—" : "—");
  }

  const columns: Column<Bin>[] = [
    { header: "Bin Code", cell: (r) => <span className="text-sm font-medium">{r.bin_code ?? "—"}</span> },
    { header: "Location", cell: (r) => <span className="text-sm">{locationName(r)}</span> },
    { header: "Description", cell: (r) => <span className="text-sm">{r.description ?? "—"}</span> },
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
          searchPlaceholder="Search bin…"
          activeCount={activeCount}
          onReset={() => {
            reset();
            pg.setPage(1);
          }}
        >
          <div>
            <Label htmlFor="bin-filter-status">Status</Label>
            <Select
              id="bin-filter-status"
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
          <DataIoToolbar entityKey="bins" rows={filtered} canExport={perms.canExport} />
          {perms.canCreate && (
            <Button size="md" onClick={openAdd}>
              + Add Bin
            </Button>
          )}
        </div>
      </div>

      {/* desktop table */}
      <div className="hidden md:block">
        <DataTable columns={columns} rows={pg.paged} getKey={(r) => r.id} empty="No bin records yet." />
      </div>

      {/* mobile cards */}
      <div className="space-y-2.5 md:hidden">
        {pg.paged.length === 0 ? (
          <div className="rounded-lg border border-border bg-surface px-4 py-10 text-center text-sm text-muted-foreground">
            No bin records yet.
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
                    {r.bin_code ?? "—"}
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {locationName(r)}
                    {r.description ? ` · ${r.description}` : ""}
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
        title={editId ? "Edit Bin" : "New Bin"}
        footer={
          <>
            <Button variant="outline" size="md" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button size="md" disabled={isPending || !form.bin_code.trim()} onClick={submit}>
              {isPending ? "Saving…" : "Save"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <Label htmlFor="bin-code">
              Bin Code <span className="text-danger">*</span>
            </Label>
            <Input
              id="bin-code"
              value={form.bin_code}
              onChange={(e) => set({ bin_code: e.target.value })}
              className="text-base md:text-sm"
            />
          </div>
          <div>
            <Label htmlFor="bin-location">Location</Label>
            <Select
              id="bin-location"
              value={form.location_id}
              onChange={(e) => set({ location_id: e.target.value })}
              className="text-base md:text-sm"
            >
              <option value="">— None —</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.code ? `${l.code} — ${l.name ?? ""}` : l.name ?? "—"}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="bin-desc">Description</Label>
            <Input
              id="bin-desc"
              value={form.description}
              onChange={(e) => set({ description: e.target.value })}
              className="text-base md:text-sm"
            />
          </div>
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              className="h-4 w-4 cursor-pointer accent-primary"
              checked={form.blocked}
              onChange={(e) => set({ blocked: e.target.checked })}
            />
            <span className="text-sm text-foreground">Inactive</span>
          </label>
        </div>
      </Sheet>
    </div>
  );
}
