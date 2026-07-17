"use client";

import { useMemo, useRef, useState, useTransition } from "react";
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
import { createProcess, updateProcess, deleteProcess } from "@/lib/masters/process-actions";
import { BILLING_ON, type BillingOn, type Process, type ProcessInput } from "@/lib/masters/process-types";
import type { Commodity } from "@/lib/masters/commodity-types";
import type { ConfigLookup } from "@/lib/masters/extras-types";
import { CommodityPicker } from "@/components/masters/commodity-picker";
import { DetailSection } from "@/components/masters/detail-section";
import { ChildGrid } from "@/components/masters/child-grid";
import { DeleteConfirmButton } from "@/components/masters/delete-confirm-button";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean; canExport?: boolean };
type SubRow = { key: string; sub_category: string; short_description: string; hsn_code: string };

const BLANK = {
  name: "",
  short_description: "",
  commodity_id: "",
  billing_on: "" as "" | BillingOn,
  hsn_code: "",
  for_yarn: false,
  for_fabric: false,
  for_trims: false,
  for_garments: false,
  for_components: false,
  no_planning: false,
  designwise_delivery: false,
  is_conversion: false,
  has_sub_categories: false,
  sl_no: 9,
  inactive: false,
};

const FOR_FLAGS: { key: keyof typeof BLANK; label: string }[] = [
  { key: "for_yarn", label: "Yarn" },
  { key: "for_fabric", label: "Fabric" },
  { key: "for_trims", label: "Trims" },
  { key: "for_garments", label: "Garments" },
  { key: "for_components", label: "Components" },
];

/**
 * Master-detail CRUD for the legacy "Process" master: a header (name, commodity,
 * billing basis, HSN code, Sl No, "For" applicability + planning flags) plus an
 * optional "Sub Categories" line grid. Commodity is sourced from the real
 * `commodities` table (not the stale config_lookups snapshot). Table on
 * desktop, cards on mobile, Sheet editor.
 */
export function ProcessMasterScreen({
  rows,
  commodities,
  itemClasses,
  perms,
}: {
  rows: Process[];
  commodities: Commodity[];
  itemClasses: ConfigLookup[];
  perms: Perms;
}) {
  const router = useRouter();
  const { success, error } = useToast();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(BLANK);
  const [subs, setSubs] = useState<SubRow[]>([]);
  const keySeq = useRef(0);
  const newKey = () => `s${keySeq.current++}`;

  const commodityLabel = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of commodities) m.set(c.id, c.short_name ?? c.name ?? "—");
    return m;
  }, [commodities]);

  const set = (patch: Partial<typeof BLANK>) => setForm((f) => ({ ...f, ...patch }));

  const { query, setQuery, filtered, filterValues, setFilter, activeCount, reset } = useMasterFilter<
    Process,
    { status: string; for: string; billingOn: string; commodity: string }
  >(rows, {
    search: (r, q) =>
      [r.name, r.short_description, r.billing_on, r.hsn_code]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q),
    filters: {
      status: (r, v) => (v === "active" ? !r.inactive : v === "inactive" ? !!r.inactive : true),
      for: (r, v) => {
        if (!v) return true;
        const flag = FOR_FLAGS.find((f) => f.key === v);
        return flag ? !!r[flag.key as keyof Process] : true;
      },
      billingOn: (r, v) => r.billing_on === v,
      commodity: (r, v) => r.commodity_id === v,
    },
    initialFilters: { status: "", for: "", billingOn: "", commodity: "" },
  });

  const pg = usePagination(filtered, 10);

  function openAdd() {
    setEditId(null);
    setForm(BLANK);
    setSubs([]);
    setOpen(true);
  }
  function openEdit(r: Process) {
    setEditId(r.id);
    setForm({
      name: r.name,
      short_description: r.short_description ?? "",
      commodity_id: r.commodity_id ?? "",
      billing_on: r.billing_on ?? "",
      hsn_code: r.hsn_code ?? "",
      for_yarn: r.for_yarn,
      for_fabric: r.for_fabric,
      for_trims: r.for_trims,
      for_garments: r.for_garments,
      for_components: r.for_components,
      no_planning: r.no_planning,
      designwise_delivery: r.designwise_delivery,
      is_conversion: r.is_conversion,
      has_sub_categories: r.has_sub_categories,
      sl_no: r.sl_no,
      inactive: r.inactive,
    });
    setSubs(
      r.sub_categories.map((c) => ({
        key: newKey(),
        sub_category: c.sub_category,
        short_description: c.short_description ?? "",
        hsn_code: c.hsn_code ?? "",
      })),
    );
    setOpen(true);
  }

  function toggleHasSubs(checked: boolean) {
    set({ has_sub_categories: checked });
    if (checked && subs.length === 0)
      setSubs([{ key: newKey(), sub_category: "", short_description: "", hsn_code: "" }]);
  }
  function addSub() {
    setSubs((ss) => [...ss, { key: newKey(), sub_category: "", short_description: "", hsn_code: "" }]);
  }
  function setSubAt(key: string, patch: Partial<SubRow>) {
    setSubs((ss) => ss.map((s) => (s.key === key ? { ...s, ...patch } : s)));
  }
  function removeSub(key: string) {
    setSubs((ss) => ss.filter((s) => s.key !== key));
  }

  function submit() {
    startTransition(async () => {
      const payload: ProcessInput = {
        name: form.name.trim(),
        short_description: form.short_description.trim() || null,
        commodity_id: form.commodity_id || null,
        billing_on: form.billing_on ? form.billing_on : null,
        hsn_code: form.hsn_code.trim() || null,
        for_yarn: form.for_yarn,
        for_fabric: form.for_fabric,
        for_trims: form.for_trims,
        for_garments: form.for_garments,
        for_components: form.for_components,
        no_planning: form.no_planning,
        designwise_delivery: form.designwise_delivery,
        is_conversion: form.is_conversion,
        has_sub_categories: form.has_sub_categories,
        sl_no: form.sl_no,
        inactive: form.inactive,
        sub_categories: form.has_sub_categories
          ? subs
              .filter((s) => s.sub_category.trim())
              .map((s, i) => ({
                sno: i + 1,
                sub_category: s.sub_category.trim(),
                short_description: s.short_description.trim() || null,
                hsn_code: s.hsn_code.trim() || null,
              }))
          : [],
      };
      const res = editId ? await updateProcess(editId, payload) : await createProcess(payload);
      if (res.ok) {
        success(editId ? "Process updated." : "Process added.");
        setOpen(false);
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  function remove(r: Process) {
    startTransition(async () => {
      const res = await deleteProcess(r.id);
      if (res.ok) {
        success("Process deleted.");
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  function forSummary(r: Process): string {
    const on = FOR_FLAGS.filter((f) => r[f.key as keyof Process]).map((f) => f.label);
    return on.length ? on.join(", ") : "—";
  }

  const columns: Column<Process>[] = [
    { header: "Process", cell: (r) => <span className="text-sm">{r.name}</span> },
    {
      header: "Commodity",
      cell: (r) => (
        <span className="text-sm text-muted-foreground">
          {r.commodity_id ? commodityLabel.get(r.commodity_id) ?? "—" : "—"}
        </span>
      ),
    },
    {
      header: "HSN Code",
      cell: (r) => <span className="text-sm text-muted-foreground">{r.hsn_code ?? "—"}</span>,
    },
    {
      header: "Billing On",
      cell: (r) => <span className="text-sm text-muted-foreground">{r.billing_on ?? "—"}</span>,
    },
    { header: "For", cell: (r) => <span className="text-sm text-muted-foreground">{forSummary(r)}</span> },
    {
      header: "Sub-cats",
      align: "right",
      cell: (r) => (
        <span className="tabular-nums text-sm text-muted-foreground">
          {r.has_sub_categories ? r.sub_categories.length : "—"}
        </span>
      ),
    },
    {
      header: "Designwise",
      cell: (r) => <span className="text-sm text-muted-foreground">{r.designwise_delivery ? "Yes" : "—"}</span>,
    },
    {
      header: "Sl No",
      align: "right",
      cell: (r) => <span className="tabular-nums text-sm text-muted-foreground">{r.sl_no}</span>,
    },
    { header: "Created Dt", cell: (r) => <span className="text-sm">{r.created_at.slice(0, 10)}</span> },
    { header: "Created User", cell: (r) => <span className="text-sm">{r.created_by || "—"}</span> },
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
          searchPlaceholder="Search process…"
          activeCount={activeCount}
          onReset={reset}
        >
          <Select
            value={filterValues.status ?? ""}
            onChange={(e) => {
              setFilter("status", e.target.value);
              pg.setPage(1);
            }}
            aria-label="Filter status"
            className="h-9 text-base md:text-sm"
          >
            <option value="">All status</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </Select>
          <Select
            value={filterValues.for ?? ""}
            onChange={(e) => {
              setFilter("for", e.target.value);
              pg.setPage(1);
            }}
            aria-label="Filter for"
            className="h-9 text-base md:text-sm"
          >
            <option value="">All For</option>
            {FOR_FLAGS.map((f) => (
              <option key={f.key} value={f.key}>
                {f.label}
              </option>
            ))}
          </Select>
          <Select
            value={filterValues.billingOn ?? ""}
            onChange={(e) => {
              setFilter("billingOn", e.target.value);
              pg.setPage(1);
            }}
            aria-label="Filter billing on"
            className="h-9 text-base md:text-sm"
          >
            <option value="">All billing</option>
            {BILLING_ON.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </Select>
          <Select
            value={filterValues.commodity ?? ""}
            onChange={(e) => {
              setFilter("commodity", e.target.value);
              pg.setPage(1);
            }}
            aria-label="Filter commodity"
            className="h-9 text-base md:text-sm"
          >
            <option value="">All commodities</option>
            {commodities.map((c) => (
              <option key={c.id} value={c.id}>
                {c.short_name ?? c.name ?? "—"}
              </option>
            ))}
          </Select>
        </FilterBar>
        <div className="flex flex-1 items-center justify-end gap-2">
          <DataIoToolbar entityKey="processes" rows={filtered} canExport={perms.canExport} />
          {perms.canCreate && (
            <Button size="md" onClick={openAdd}>
              + Add Process
            </Button>
          )}
        </div>
      </div>

      {/* desktop table */}
      <div className="hidden md:block">
        <DataTable columns={columns} rows={pg.paged} getKey={(r) => r.id} empty="No process records yet." />
      </div>

      {/* mobile cards */}
      <div className="space-y-2.5 md:hidden">
        {pg.paged.length === 0 ? (
          <div className="rounded-lg border border-border bg-surface px-4 py-10 text-center text-sm text-muted-foreground">
            No process records yet.
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
                    {r.billing_on ?? "—"} · For: {forSummary(r)}
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
        title={editId ? "Edit Process" : "New Process"}
        footer={
          <>
            <Button variant="outline" size="md" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button size="md" disabled={isPending || !form.name.trim()} onClick={submit}>
              {isPending ? "Saving…" : "Save"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <DetailSection label="Details">
            <div>
              <Label htmlFor="pr-name">
                Process <span className="text-danger">*</span>
              </Label>
              <Input
                id="pr-name"
                value={form.name}
                onChange={(e) => set({ name: e.target.value })}
                required
                className="text-base md:text-sm"
              />
            </div>
            <div>
              <Label htmlFor="pr-desc">Short Description</Label>
              <Input
                id="pr-desc"
                value={form.short_description}
                onChange={(e) => set({ short_description: e.target.value })}
                className="text-base md:text-sm"
              />
            </div>
            <CommodityPicker
              commodities={commodities}
              itemClasses={itemClasses}
              value={form.commodity_id}
              onChange={(v) => set({ commodity_id: v })}
              canCreate={perms.canCreate}
              canEdit={perms.canEdit}
              canDelete={perms.canDelete}
            />
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label htmlFor="pr-billing">Billing On</Label>
                <Select
                  id="pr-billing"
                  value={form.billing_on}
                  onChange={(e) => set({ billing_on: e.target.value as "" | BillingOn })}
                  className="text-base md:text-sm"
                >
                  <option value="">— Select —</option>
                  {BILLING_ON.map((b) => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="pr-hsn">HSN Code</Label>
                <Input
                  id="pr-hsn"
                  value={form.hsn_code}
                  onChange={(e) => set({ hsn_code: e.target.value })}
                  className="text-base md:text-sm"
                />
              </div>
              <div>
                <Label htmlFor="pr-slno">Sl No</Label>
                <Input
                  id="pr-slno"
                  type="number"
                  value={form.sl_no}
                  onChange={(e) => set({ sl_no: Number(e.target.value) || 0 })}
                  className="text-base md:text-sm"
                />
              </div>
            </div>
          </DetailSection>

          <DetailSection label="For">
            <div className="grid grid-cols-2 gap-2">
              {FOR_FLAGS.map((f) => (
                <label key={f.key} className="flex cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    className="h-4 w-4 cursor-pointer accent-primary"
                    checked={form[f.key] as boolean}
                    onChange={(e) => set({ [f.key]: e.target.checked })}
                  />
                  <span className="text-sm text-foreground">{f.label}</span>
                </label>
              ))}
            </div>
          </DetailSection>

          <DetailSection label="Planning">
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                className="h-4 w-4 cursor-pointer accent-primary"
                checked={form.no_planning}
                onChange={(e) => set({ no_planning: e.target.checked })}
              />
              <span className="text-sm text-foreground">Doesn&apos;t require planning for Receipt / Delivery</span>
            </label>
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                className="h-4 w-4 cursor-pointer accent-primary"
                checked={form.designwise_delivery}
                onChange={(e) => set({ designwise_delivery: e.target.checked })}
              />
              <span className="text-sm text-foreground">Requires Designwise Delivery</span>
            </label>
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                className="h-4 w-4 cursor-pointer accent-primary"
                checked={form.is_conversion}
                onChange={(e) => set({ is_conversion: e.target.checked })}
              />
              <span className="text-sm text-foreground">Is Conversion Process</span>
            </label>
          </DetailSection>

          {/* Sub Categories */}
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              className="h-4 w-4 cursor-pointer accent-primary"
              checked={form.has_sub_categories}
              onChange={(e) => toggleHasSubs(e.target.checked)}
            />
            <span className="text-sm font-medium text-foreground">Has Sub Categories</span>
          </label>
          {form.has_sub_categories && (
            <ChildGrid<SubRow>
              label="Sub Categories"
              rows={subs}
              onAdd={addSub}
              onRemove={(s) => removeSub(s.key)}
              addLabel="+ Add sub category"
              columns={[
                {
                  header: "Sub Category",
                  cell: (s) => (
                    <Input value={s.sub_category} onChange={(e) => setSubAt(s.key, { sub_category: e.target.value })} placeholder="Sub Category" className="text-base md:text-sm" />
                  ),
                },
                {
                  header: "Short Description",
                  cell: (s) => (
                    <Input value={s.short_description} onChange={(e) => setSubAt(s.key, { short_description: e.target.value })} placeholder="Short Description" className="text-base md:text-sm" />
                  ),
                },
                {
                  header: "HSN Code",
                  cell: (s) => (
                    <Input value={s.hsn_code} onChange={(e) => setSubAt(s.key, { hsn_code: e.target.value })} placeholder="HSN Code" className="text-base md:text-sm" />
                  ),
                },
              ]}
            />
          )}

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
