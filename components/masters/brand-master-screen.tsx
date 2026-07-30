"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ValidatedInput } from "@/components/ui/validated-input";
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
import { useDuplicateCheck } from "@/lib/masters/use-duplicate-check";
import { FilterBar } from "@/components/masters/filter-bar";
import { DataIoToolbar } from "@/components/data-io/data-io-toolbar";
import { RowActions, rowActionsColumn } from "@/components/ui/row-actions";
import { DetailSection } from "@/components/masters/detail-section";
import { MobileWhatsAppFields, useIsdLookup } from "@/components/masters/contact-fields";
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
  mobile: "",
  // `as string | null` because this object's type is inferred: a bare `null`
  // would widen to the `null` literal and reject a typed number later.
  // null = "same as mobile" (tick on); "" = tick off, nothing typed yet.
  whatsapp: null as string | null,
  inactive: false,
};

/**
 * Brand master (Materials): Short Name · Name (req) · Country (opt, via the
 * ⓘ CountryPicker with Add/Modify) · Website · Phone · Mobile · WhatsApp · Blocked.
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
  const isdOf = useIsdLookup(countries);
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(BLANK);

  const set = (patch: Partial<typeof BLANK>) => setForm((f) => ({ ...f, ...patch }));

  const countryLabel = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of countries) m.set(c.id, c.name);
    return m;
  }, [countries]);

  // Real-time duplicate check on Name (mirrors the on-save guard in brand-actions).
  const dupError = useDuplicateCheck({
    table: "brands",
    name: form.brand_name ?? "",
    nameColumn: "brand_name",
    excludeId: editId ?? undefined,
    enabled: !!form.brand_name.trim(),
  });

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
      mobile: r.mobile ?? "",
      // NOT `?? ""` — a stored NULL is the "same as mobile" state.
      whatsapp: r.whatsapp,
      inactive: r.inactive,
    });
    setOpen(true);
  }

  function submit() {
    startTransition(async () => {
      const payload: BrandInput = {
        brand_short_name: form.brand_name.trim() || null,
        brand_name: form.brand_name.trim(),
        country_id: form.country_id || null,
        website: form.website.trim() || null,
        phone: form.phone.trim() || null,
        mobile: form.mobile.trim() || null,
        // "" collapses to null — an empty WhatsApp box means "same as mobile".
        whatsapp: form.whatsapp?.trim() || null,
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
    rowActionsColumn((r) => (
      <RowActions
        label={r.brand_name}
        onEdit={() => openEdit(r)}
        onDelete={() => remove(r)}
        canEdit={perms.canEdit}
        canDelete={perms.canDelete}
        isPending={isPending}
      />
    )),
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
            <Button size="md" disabled={isPending || !form.brand_name.trim() || !!dupError} onClick={submit}>
              {isPending ? "Saving…" : "Save"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <DetailSection label="Details" cols={2}>
            <div>
              <Label htmlFor="brd-name">
                Name <span className="text-danger">*</span>
              </Label>
              <Input
                id="brd-name"
                uppercase
                value={form.brand_name}
                onChange={(e) => set({ brand_name: e.target.value })}
                className="text-base md:text-sm"
              />
              {dupError && <p className="mt-1 text-xs text-danger">{dupError}</p>}
            </div>
            <CountryPicker
              countries={countries}
              value={form.country_id || null}
              onChange={(id) => set({ country_id: id })}
              canCreate={perms.canCreate}
              canEdit={perms.canEdit}
            />
            {/* `ValidatedInput`, not a bare `Input` — every other master with
                these two fields already uses it (applicant, consignee, courier,
                customer, vendor). Surfaced by the CAPS audit: a plain Input here
                was the only thing standing between `form.website` and being
                uppercased along with the rest of the form, which would have been
                wrong. `website` and `phone_intl` are `transform: "none"`
                (formats.ts), so they keep their case and gain inline validation. */}
            <div>
              <Label htmlFor="brd-website">Website</Label>
              <ValidatedInput
                format="website"
                id="brd-website"
                value={form.website}
                onChange={(e) => set({ website: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="brd-phone">Phone</Label>
              <ValidatedInput
                format="phone_intl"
                id="brd-phone"
                value={form.phone}
                onChange={(e) => set({ phone: e.target.value })}
              />
            </div>
            <MobileWhatsAppFields
              idPrefix="brd"
              mobile={form.mobile}
              whatsapp={form.whatsapp}
              isdCode={isdOf.get(form.country_id) ?? null}
              onMobileChange={(v) => set({ mobile: v })}
              onWhatsAppChange={(v) => set({ whatsapp: v })}
            />
          </DetailSection>

          {editId && (
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                className="h-4 w-4 cursor-pointer accent-primary"
                checked={form.inactive}
                onChange={(e) => set({ inactive: e.target.checked })}
              />
              <span className="text-sm text-foreground">Inactive</span>
            </label>
          )}
        </div>
      </Sheet>
    </div>
  );
}
