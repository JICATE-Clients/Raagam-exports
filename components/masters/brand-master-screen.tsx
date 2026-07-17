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
import { CountryPicker } from "@/components/masters/country-picker";
import { usePagination } from "@/lib/use-pagination";
import { useMasterFilter } from "@/lib/masters/use-master-filter";
import { FilterBar } from "@/components/masters/filter-bar";
import { DataIoToolbar } from "@/components/data-io/data-io-toolbar";
import { DeleteConfirmButton } from "@/components/masters/delete-confirm-button";
import { DetailSection } from "@/components/masters/detail-section";
import { createBrand, updateBrand, deleteBrand } from "@/lib/masters/brand-actions";
import type { Brand, BrandInput } from "@/lib/masters/brand-types";
import type { Country } from "@/lib/masters/country-types";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean; canExport?: boolean; isSuperAdmin?: boolean };

const BLANK = {
  brand_short_name: "",
  brand_name: "",
  country_id: "",
  website: "",
  phone: "",
  fax: "",
  inactive: false,
};

/**
 * Brand master (Materials): Short Name · Name (req) · Country (opt, via the
 * ⓘ CountryPicker with Add/Modify) · Website · Phone · Fax · Blocked.
 * Dense table on desktop, cards on mobile, shared <Sheet> editor.
 */
export function BrandMasterScreen({
  rows,
  countries,
  perms,
}: {
  rows: Brand[];
  countries: Country[];
  perms: Perms;
}) {
  const router = useRouter();
  const { success, error } = useToast();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(BLANK);

  const set = (patch: Partial<typeof BLANK>) => setForm((f) => ({ ...f, ...patch }));

  const countryLabel = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of countries) m.set(c.id, c.name);
    return m;
  }, [countries]);

  const { query, setQuery, filtered, filterValues, setFilter, activeCount, reset } = useMasterFilter(rows, {
    search: (r, q) =>
      [r.brand_short_name, r.brand_name, r.country?.name ?? (r.country_id ? countryLabel.get(r.country_id) : null)]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q),
    filters: {
      status: (r, v) => (v === "active" ? !r.inactive : v === "inactive" ? !!r.inactive : true),
      country: (r, v) => r.country_id === v,
    },
    initialFilters: { status: "", country: "" },
  });

  const pg = usePagination(filtered, 10);

  function openAdd() {
    setEditId(null);
    setForm(BLANK);
    setOpen(true);
  }
  function openEdit(r: Brand) {
    setEditId(r.id);
    setForm({
      brand_short_name: r.brand_short_name ?? "",
      brand_name: r.brand_name ?? "",
      country_id: r.country_id ?? "",
      website: r.website ?? "",
      phone: r.phone ?? "",
      fax: r.fax ?? "",
      inactive: r.inactive,
    });
    setOpen(true);
  }

  function submit() {
    startTransition(async () => {
      const payload: BrandInput = {
        brand_short_name: form.brand_short_name.trim() || null,
        brand_name: form.brand_name.trim(),
        country_id: form.country_id || null,
        website: form.website.trim() || null,
        phone: form.phone.trim() || null,
        fax: form.fax.trim() || null,
        inactive: form.inactive,
      };
      const res = editId ? await updateBrand(editId, payload) : await createBrand(payload);
      if (res.ok) {
        success(editId ? "Brand updated." : "Brand added.");
        setOpen(false);
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  function remove(r: Brand) {
    startTransition(async () => {
      const res = await deleteBrand(r.id);
      if (res.ok) {
        success("Brand deleted.");
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  function countryName(r: Brand): string {
    return r.country?.name ?? (r.country_id ? countryLabel.get(r.country_id) ?? "—" : "—");
  }

  const columns: Column<Brand>[] = [
    { header: "Short Name", cell: (r) => <span className="text-sm">{r.brand_short_name ?? "—"}</span> },
    { header: "Name", cell: (r) => <span className="text-sm font-medium">{r.brand_name ?? "—"}</span> },
    { header: "Country", cell: (r) => <span className="text-sm">{countryName(r)}</span> },
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
          searchPlaceholder="Search brand…"
          activeCount={activeCount}
          onReset={() => {
            reset();
            pg.setPage(1);
          }}
        >
          <div>
            <Label htmlFor="brand-filter-status">Status</Label>
            <Select
              id="brand-filter-status"
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
            <Label htmlFor="brand-filter-country">Country</Label>
            <Select
              id="brand-filter-country"
              value={filterValues.country}
              onChange={(e) => {
                setFilter("country", e.target.value);
                pg.setPage(1);
              }}
              className="text-base md:text-sm"
            >
              <option value="">All</option>
              {countries.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </div>
        </FilterBar>
        <div className="flex flex-1 items-center justify-end gap-2">
          <DataIoToolbar entityKey="brands" rows={filtered} canExport={perms.canExport} />
          {perms.canCreate && (
            <Button size="md" onClick={openAdd}>
              + Add Brand
            </Button>
          )}
        </div>
      </div>

      {/* desktop table */}
      <div className="hidden md:block">
        <DataTable columns={columns} rows={pg.paged} getKey={(r) => r.id} empty="No brand records yet." />
      </div>

      {/* mobile cards */}
      <div className="space-y-2.5 md:hidden">
        {pg.paged.length === 0 ? (
          <div className="rounded-lg border border-border bg-surface px-4 py-10 text-center text-sm text-muted-foreground">
            No brand records yet.
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
                    {r.brand_name ?? r.brand_short_name ?? "—"}
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {countryName(r)}
                  </div>
                </div>
                <StatusPill tone={r.inactive ? "danger" : "success"}>
                  {r.inactive ? "Inactive" : "Active"}
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
        title={editId ? "Edit Brand" : "New Brand"}
        footer={
          <>
            <Button variant="outline" size="md" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button size="md" disabled={isPending || !form.brand_name.trim()} onClick={submit}>
              {isPending ? "Saving…" : "Save"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <DetailSection label="Details">
            <div>
              <Label htmlFor="brd-short">Short Name</Label>
              <Input
                id="brd-short"
                value={form.brand_short_name}
                onChange={(e) => set({ brand_short_name: e.target.value })}
                className="text-base md:text-sm"
              />
            </div>
            <div>
              <Label htmlFor="brd-name">
                Name <span className="text-danger">*</span>
              </Label>
              <Input
                id="brd-name"
                value={form.brand_name}
                onChange={(e) => set({ brand_name: e.target.value })}
                className="text-base md:text-sm"
              />
            </div>
            <CountryPicker
              countries={countries}
              value={form.country_id || null}
              onChange={(id) => set({ country_id: id })}
              canCreate={perms.canCreate}
              canEdit={perms.canEdit}
            />
            <div>
              <Label htmlFor="brd-website">Website</Label>
              <Input
                id="brd-website"
                value={form.website}
                onChange={(e) => set({ website: e.target.value })}
                className="text-base md:text-sm"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="brd-phone">Phone</Label>
                <Input
                  id="brd-phone"
                  value={form.phone}
                  onChange={(e) => set({ phone: e.target.value })}
                  className="text-base md:text-sm"
                />
              </div>
              <div>
                <Label htmlFor="brd-fax">Fax</Label>
                <Input
                  id="brd-fax"
                  value={form.fax}
                  onChange={(e) => set({ fax: e.target.value })}
                  className="text-base md:text-sm"
                />
              </div>
            </div>
          </DetailSection>

          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              className="h-4 w-4 cursor-pointer accent-primary"
              checked={form.inactive}
              onChange={(e) => set({ inactive: e.target.checked })}
            />
            <span className="text-sm text-foreground">Inactive</span>
          </label>
        </div>
      </Sheet>
    </div>
  );
}
