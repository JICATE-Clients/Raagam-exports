"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { DataTable, type Column } from "@/components/ui/data-table";
import { withCreatedColumns } from "@/components/ui/created-columns";
import { PaginationBar } from "@/components/ui/pagination";
import { StatusPill } from "@/components/ui/status-pill";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { usePagination } from "@/lib/use-pagination";
import { useMasterFilter } from "@/lib/masters/use-master-filter";
import { FilterBar } from "@/components/ui/filter-bar";
import { DataIoToolbar } from "@/components/data-io/data-io-toolbar";
import { createProcess, updateProcess, deleteProcess } from "@/lib/masters/process-actions";
import { useDuplicateName, dupFieldProps } from "@/lib/masters/use-duplicate-check";
import { DuplicateError } from "@/components/ui/duplicate-error";
import { useSpellSuggest } from "@/lib/masters/use-spell-suggest";
import { SpellSuggestHint } from "@/components/masters/spell-suggest-hint";
import { PROCESS_NAMES } from "@/lib/masters/name-vocabularies";
import { BILLING_ON, type BillingOn, type Process, type ProcessInput } from "@/lib/masters/process-types";
import { DetailSection } from "@/components/masters/detail-section";
import { SectionGrid } from "@/components/masters/section-grid";
import { Field } from "@/components/ui/field";
import { ChildGrid } from "@/components/masters/child-grid";
import { RowActions } from "@/components/ui/row-actions";
import { rowActionsColumn } from "@/components/ui/row-actions-column";
type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean; canExport?: boolean };
type SubRow = { key: string; sub_category: string; short_description: string; hsn_code: string };

const BLANK = {
  name: "",
  short_description: "",
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
 * Master-detail CRUD for the legacy "Process" master: a header (name, billing
 * basis, HSN code, Sl No, "For" applicability + planning flags) plus an optional
 * "Sub Categories" line grid. Table on desktop, cards on mobile, Sheet editor.
 *
 * Commodity was a header field and a list column until the client withdrew the
 * whole Commodities master (2026-08-01); `processes.commodity_id` stays in the
 * database, unread and unwritten.
 */
export function ProcessMasterScreen({
  rows,
  perms,
}: {
  rows: Process[];
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

  const set = (patch: Partial<typeof BLANK>) => setForm((f) => ({ ...f, ...patch }));

  const { query, setQuery, filtered, filterValues, setFilter, activeCount, reset, dateFilter } = useMasterFilter<
    Process,
    { status: string; for: string; billingOn: string }
  >(rows, {
    searchKey: (r) => [r.name, r.short_description, r.billing_on, r.hsn_code].filter(Boolean).join(" "),
    filters: {
      status: (r, v) => (v === "active" ? !r.inactive : v === "inactive" ? !!r.inactive : true),
      for: (r, v) => {
        if (!v) return true;
        const flag = FOR_FLAGS.find((f) => f.key === v);
        return flag ? !!r[flag.key as keyof Process] : true;
      },
      billingOn: (r, v) => r.billing_on === v,
    },
    initialFilters: { status: "", for: "", billingOn: "" },
  });

  const pg = usePagination(filtered, 10);

  // Real-time duplicate check on the process name (mirrors the on-save guard).
  const dupError = useDuplicateName({
    table: "processes",
    name: form.name,
    excludeId: editId ?? undefined,
    enabled: !!form.name.trim(),
    rows,
    rowId: (r) => r.id,
    rowValue: (r) => r.name,
  });

  /**
   * "Did you mean?" — dupError above only fires on an EXACT collision, so a
   * one-character miss sails past it and becomes a second row meaning the same
   * thing as the first. Advisory only: the typed text saves as typed unless the
   * operator accepts a chip. Suppressed while the red error shows — one line
   * under the input, and the name it collided with is the one that is no use.
   */
  const nameSuggest = useSpellSuggest({
    name: form.name ?? "",
    // The row being edited must not suggest its own name back at you.
    names: rows.filter((r) => r.id !== editId).map((r) => r.name ?? "").filter(Boolean),
    seed: PROCESS_NAMES,
    enabled: open,
    onApply: (v) => setForm((f) => ({ ...f, name: v })),
  });

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
        label={r.name}
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
          searchPlaceholder="Search process…"
          activeCount={activeCount}
          dateFilter={{
            ...dateFilter,
            onChange: (v) => {
              dateFilter.onChange(v);
              pg.setPage(1);
            },
          }}
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
        <DataTable columns={withCreatedColumns(columns, rows)} rows={pg.paged} getKey={(r) => r.id} empty="No process records yet." />
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
            <Button size="md" disabled={isPending || !form.name.trim() || !!dupError} onClick={submit}>
              {isPending ? "Saving…" : "Save"}
            </Button>
          </>
        }
      >
        {/* SECTIONS, NOT A HAND-ROLLED SPLIT.
            This was `grid grid-cols-1 lg:grid-cols-2` with every section stacked
            in the LEFT half and the right half holding only the Sub Categories
            grid — which renders solely when the box is ticked, so the usual state
            was a form squeezed into half the sheet with 750px of nothing beside
            it (client 2026-08-04).

            `lg:` was the other half of the bug: a VIEWPORT breakpoint deciding
            the layout of a body whose width comes from the surface. `SectionGrid`
            is a container query (`@4xl/sections`), so the same sections fall back
            to one column inside a nested picker at the same viewport width — the
            landmine doc/ui/LAYOUT.md §2 names. Sections here are peers, so they
            auto-place rather than being pinned into columns. */}
        <SectionGrid>
          {/* `span={2}`: the identity block spans the sheet, so its fields sit on
              the ~1150px track where `sm` (3 of 12) IS the ~280px reference —
              four flush across, LAYOUT.md §3. */}
          <DetailSection label="Details" cols={12} span={2}>
            {/* `full`: Process carries the duplicate error AND the spell-suggest
                strip beneath it, and a field that grows a second line must not
                share a row — every grid row is as tall as its tallest item. */}
            <Field label="Process" required size="full" htmlFor="pr-name">
              <Input
                id="pr-name"
                uppercase
                value={form.name}
                onChange={(e) => set({ name: e.target.value })}
                required
                // ↓ into the suggestion strip, Enter applies, Esc dismisses.
                onKeyDown={nameSuggest.onKeyDown}
                {...dupFieldProps(dupError, "pr-name")}
              />
              <DuplicateError error={dupError} id="pr-name" />
              <SpellSuggestHint
                suggestions={nameSuggest.suggestions}
                existing={nameSuggest.existing}
                activeIndex={nameSuggest.activeIndex}
                duplicate={!!dupError}
                onApply={(v) => setForm((f) => ({ ...f, name: v }))}
              />
            </Field>
            {/* 3 + 3 + 3 + 3 = 12, one flush row. It was a full-width Process, a
                half-width Short Description, then a hand-rolled `grid-cols-3` —
                three different widths down one short form, which is the ragged
                whitespace §3 exists to stop. */}
            <Field label="Short Description" size="sm" htmlFor="pr-desc">
              <Input
                id="pr-desc"
                uppercase
                value={form.short_description}
                onChange={(e) => set({ short_description: e.target.value })}
              />
            </Field>
            <Field label="Billing On" size="sm" htmlFor="pr-billing">
              <Select
                id="pr-billing"
                value={form.billing_on}
                onChange={(e) => set({ billing_on: e.target.value as "" | BillingOn })}
              >
                <option value=""></option>
                {BILLING_ON.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="HSN Code" size="sm" htmlFor="pr-hsn">
              <Input
                uppercase
                id="pr-hsn"
                value={form.hsn_code}
                onChange={(e) => set({ hsn_code: e.target.value })}
              />
            </Field>
            <Field label="Sl No" size="sm" htmlFor="pr-slno">
              <Input
                id="pr-slno"
                type="number"
                value={form.sl_no}
                onChange={(e) => set({ sl_no: Number(e.target.value) || 0 })}
              />
            </Field>
          </DetailSection>

          {/* `cols={2}` is the section's OWN two-up mode, so the five flags pair
              themselves — the hand-rolled `grid grid-cols-2` this replaces was
              one of the four this file was flagged for. */}
          <DetailSection label="For" cols={2}>
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
          </DetailSection>

          {/* Stacked, not paired: these three read as sentences, and two of them
              side by side would wrap where "For"'s single words do not. */}
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

          {/* In a section of its own rather than floating loose under the last
              one, where it read as a stray control belonging to nothing.
              `span={2}` because the grid it gates is full width below. */}
          <DetailSection label="Structure" cols={2} span={2}>
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                className="h-4 w-4 cursor-pointer accent-primary"
                checked={form.has_sub_categories}
                onChange={(e) => toggleHasSubs(e.target.checked)}
              />
              <span className="text-sm text-foreground">Has Sub Categories</span>
            </label>
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
          </DetailSection>
        </SectionGrid>

        {/* FULL WIDTH, below the sections. It was pinned in the right column,
            which is what forced the permanent two-column split — and a child grid
            of three columns is exactly the thing that wants the whole sheet. */}
        {form.has_sub_categories && (
            <ChildGrid<SubRow>
              lockExisting
              label="Sub Categories"
              pageSize={10}
              forceCards
              rows={subs}
              onAdd={addSub}
              onRemove={(s) => removeSub(s.key)}
              addLabel="+ Add sub category"
              renderMobileRow={(s) => (
                <>
                  <Input uppercase value={s.sub_category} onChange={(e) => setSubAt(s.key, { sub_category: e.target.value })} placeholder="Sub Category" className="text-base md:text-sm" />
                  {/* short fields pair up two-per-row inside cards */}
                  <div className="grid grid-cols-2 gap-2">
                    <Input uppercase value={s.short_description} onChange={(e) => setSubAt(s.key, { short_description: e.target.value })} placeholder="Short Description" className="text-base md:text-sm" />
                    <Input uppercase value={s.hsn_code} onChange={(e) => setSubAt(s.key, { hsn_code: e.target.value })} placeholder="HSN Code" className="text-base md:text-sm" />
                  </div>
                </>
              )}
              columns={[
                {
                  header: "Sub Category",
                  cell: (s) => (
                    <Input uppercase value={s.sub_category} onChange={(e) => setSubAt(s.key, { sub_category: e.target.value })} placeholder="Sub Category" className="text-base md:text-sm" />
                  ),
                },
                {
                  header: "Short Description",
                  cell: (s) => (
                    <Input uppercase value={s.short_description} onChange={(e) => setSubAt(s.key, { short_description: e.target.value })} placeholder="Short Description" className="text-base md:text-sm" />
                  ),
                },
                {
                  header: "HSN Code",
                  cell: (s) => (
                    <Input uppercase value={s.hsn_code} onChange={(e) => setSubAt(s.key, { hsn_code: e.target.value })} placeholder="HSN Code" className="text-base md:text-sm" />
                  ),
                },
              ]}
          />
        )}
      </Sheet>
    </div>
  );
}
