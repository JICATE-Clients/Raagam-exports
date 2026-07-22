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
import { createBeam, updateBeam, deleteBeam } from "@/lib/masters/beam-actions";
import type { Beam, BeamVendorOption, BeamInput } from "@/lib/masters/beam-types";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean; canExport?: boolean };

const BLANK = {
  beam_no: "",
  tare_wt: "",
  loom_type: "",
  location_type: "" as "" | "O" | "P",
  vendor_id: "",
  flange_width: "",
  is_active: true,
};

/**
 * Beam master: unique beam_no, tare weight, loom type, location type (O=Own/P=Party),
 * conditional vendor picker (only when Party), flange width, active toggle.
 * Table on desktop, cards on mobile, Sheet editor.
 */
export function BeamMasterScreen({
  rows,
  vendors,
  perms,
}: {
  rows: Beam[];
  vendors: BeamVendorOption[];
  perms: Perms;
}) {
  const router = useRouter();
  const { success, error } = useToast();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(BLANK);

  const set = (patch: Partial<typeof BLANK>) => setForm((f) => ({ ...f, ...patch }));

  const vendorLabel = useMemo(() => {
    const m = new Map<string, string>();
    for (const v of vendors) m.set(v.id, v.name);
    return m;
  }, [vendors]);

  const { query, setQuery, filtered, filterValues, setFilter, activeCount, reset } = useMasterFilter(rows, {
    search: (r, q) =>
      [
        r.beam_no,
        r.loom_type,
        r.vendor?.name ?? (r.vendor_id ? vendorLabel.get(r.vendor_id) : null),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q),
    filters: {
      status: (r, v) => (v === "active" ? r.is_active : v === "inactive" ? !r.is_active : true),
      locationType: (r, v) => r.location_type === v,
    },
    initialFilters: { status: "", locationType: "" },
  });

  const pg = usePagination(filtered, 10);

  function openAdd() {
    setEditId(null);
    setForm(BLANK);
    setOpen(true);
  }
  function openEdit(r: Beam) {
    setEditId(r.id);
    setForm({
      beam_no: r.beam_no,
      tare_wt: r.tare_wt != null ? r.tare_wt.toString() : "",
      loom_type: r.loom_type ?? "",
      location_type: r.location_type ?? "",
      vendor_id: r.vendor_id ?? "",
      flange_width: r.flange_width != null ? r.flange_width.toString() : "",
      is_active: r.is_active,
    });
    setOpen(true);
  }

  function handleLocationTypeChange(val: "" | "O" | "P") {
    // Clear vendor when switching away from Party
    set({ location_type: val, vendor_id: val === "P" ? form.vendor_id : "" });
  }

  function submit() {
    startTransition(async () => {
      const payload: BeamInput = {
        beam_no: form.beam_no.trim(),
        tare_wt: form.tare_wt !== "" ? Number(form.tare_wt) : null,
        loom_type: form.loom_type.trim() || null,
        location_type: form.location_type || null,
        vendor_id: form.location_type === "P" ? form.vendor_id || null : null,
        flange_width: form.flange_width !== "" ? Number(form.flange_width) : null,
        is_active: form.is_active,
      };
      const res = editId ? await updateBeam(editId, payload) : await createBeam(payload);
      if (res.ok) {
        success(editId ? "Beam updated." : "Beam added.");
        setOpen(false);
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  function remove(r: Beam) {
    startTransition(async () => {
      const res = await deleteBeam(r.id);
      if (res.ok) {
        success("Beam deleted.");
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  function vendorName(r: Beam): string {
    return r.vendor?.name ?? (r.vendor_id ? vendorLabel.get(r.vendor_id) ?? "—" : "—");
  }

  const columns: Column<Beam>[] = [
    { header: "Beam No", cell: (r) => <span className="text-sm font-medium">{r.beam_no}</span> },
    {
      header: "Tare Wt",
      align: "right",
      cell: (r) => (
        <span className="tabular-nums text-sm text-muted-foreground">
          {r.tare_wt != null ? r.tare_wt : "—"}
        </span>
      ),
    },
    {
      header: "Loom Type",
      cell: (r) => <span className="text-sm text-muted-foreground">{r.loom_type ?? "—"}</span>,
    },
    {
      header: "Location",
      cell: (r) => (
        <span className="text-sm text-muted-foreground">
          {r.location_type === "O" ? "Own" : r.location_type === "P" ? "Party" : "—"}
        </span>
      ),
    },
    {
      header: "Vendor",
      cell: (r) => (
        <span className="text-sm text-muted-foreground">
          {r.location_type === "P" ? vendorName(r) : "—"}
        </span>
      ),
    },
    {
      header: "Flange W",
      align: "right",
      cell: (r) => (
        <span className="tabular-nums text-sm text-muted-foreground">
          {r.flange_width != null ? r.flange_width : "—"}
        </span>
      ),
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
          searchPlaceholder="Search beam…"
          activeCount={activeCount}
          onReset={() => {
            reset();
            pg.setPage(1);
          }}
        >
          <div>
            <Label htmlFor="bm-filter-status">Status</Label>
            <Select
              id="bm-filter-status"
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
            <Label htmlFor="bm-filter-loc">Location</Label>
            <Select
              id="bm-filter-loc"
              value={filterValues.locationType}
              onChange={(e) => {
                setFilter("locationType", e.target.value);
                pg.setPage(1);
              }}
              className="text-base md:text-sm"
            >
              <option value="">All</option>
              <option value="O">Own</option>
              <option value="P">Party</option>
            </Select>
          </div>
        </FilterBar>
        <div className="flex flex-1 items-center justify-end gap-2">
          <DataIoToolbar entityKey="beams" rows={filtered} canExport={perms.canExport} />
          {perms.canCreate && (
            <Button size="md" onClick={openAdd}>
              + Add Beam
            </Button>
          )}
        </div>
      </div>

      {/* desktop table */}
      <div className="hidden md:block">
        <DataTable columns={columns} rows={pg.paged} getKey={(r) => r.id} empty="No beam records yet." />
      </div>

      {/* mobile cards */}
      <div className="space-y-2.5 md:hidden">
        {pg.paged.length === 0 ? (
          <div className="rounded-lg border border-border bg-surface px-4 py-10 text-center text-sm text-muted-foreground">
            No beam records yet.
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
                  <div className="truncate text-[15px] font-semibold text-foreground">{r.beam_no}</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {r.loom_type ?? ""}
                    {r.location_type === "P" ? ` · Party: ${vendorName(r)}` : r.location_type === "O" ? " · Own" : ""}
                    {r.tare_wt != null ? ` · Tare: ${r.tare_wt}` : ""}
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
        title={editId ? "Edit Beam" : "New Beam"}
        footer={
          <>
            <Button variant="outline" size="md" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button size="md" disabled={isPending || !form.beam_no.trim()} onClick={submit}>
              {isPending ? "Saving…" : "Save"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <DetailSection label="Details">
            <div>
              <Label htmlFor="bm-no">
                Beam No <span className="text-danger">*</span>
              </Label>
              <Input
                id="bm-no"
                value={form.beam_no}
                onChange={(e) => set({ beam_no: e.target.value })}
                className="text-base md:text-sm"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="bm-tare">Tare Weight</Label>
                <Input
                  id="bm-tare"
                  type="number"
                  min={0}
                  step="any"
                  value={form.tare_wt}
                  onChange={(e) => set({ tare_wt: e.target.value })}
                  className="text-base md:text-sm"
                />
              </div>
              <div>
                <Label htmlFor="bm-flange">Flange Width</Label>
                <Input
                  id="bm-flange"
                  type="number"
                  min={0}
                  step="any"
                  value={form.flange_width}
                  onChange={(e) => set({ flange_width: e.target.value })}
                  className="text-base md:text-sm"
                />
              </div>
            </div>
            <div>
              <Label htmlFor="bm-loom">Loom Type</Label>
              <Input
                id="bm-loom"
                value={form.loom_type}
                onChange={(e) => set({ loom_type: e.target.value })}
                className="text-base md:text-sm"
              />
            </div>
          </DetailSection>

          <DetailSection label="Location">
            <div>
              <Label htmlFor="bm-loc-type">Location Type</Label>
              <Select
                id="bm-loc-type"
                value={form.location_type}
                onChange={(e) => handleLocationTypeChange(e.target.value as "" | "O" | "P")}
                className="text-base md:text-sm"
              >
                <option value="">— Select —</option>
                <option value="O">Own</option>
                <option value="P">Party</option>
              </Select>
            </div>
            {form.location_type === "P" && (
              <div>
                <Label htmlFor="bm-vendor">Vendor</Label>
                <Select
                  id="bm-vendor"
                  value={form.vendor_id}
                  onChange={(e) => set({ vendor_id: e.target.value })}
                  className="text-base md:text-sm"
                >
                  <option value="">— None —</option>
                  {vendors.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                    </option>
                  ))}
                </Select>
              </div>
            )}
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
