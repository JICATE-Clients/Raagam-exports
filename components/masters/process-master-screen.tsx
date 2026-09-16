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
import { LookupDialogPicker } from "@/components/masters/lookup-dialog-picker";
import type { ConfigLookup } from "@/lib/masters/extras-types";
import { RowActions } from "@/components/ui/row-actions";
import { rowActionsColumn } from "@/components/ui/row-actions-column";
type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean; canExport?: boolean };
type SubRow = { key: string; sub_category: string; hsn_code: string };
/** One row of the Fabric Stages grid — see `ProcessFabricStage` (0563). */
type StageRow = { key: string; stage_id: string; is_base: boolean };

const BLANK = {
  name: "",
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
  is_print: false,
  is_dyeing: false,
  is_knitting: false,
  has_sub_categories: false,
  inactive: false,
};

/**
 * ONE BLANK FABRIC-STAGE ROW.
 *
 * Every key is blank / false, which is the half of AGENTS.md's "Editable
 * sub-tables open with a row" that is easy to skip: the seeded row IS saved
 * unless the save side drops it, so a "helpful" default stage here would turn
 * `normalizeFabricStages`'s `!s.stage_id` test into the constant `true` wearing
 * the shape of evidence, and every fabric process would acquire a stage mapping
 * nobody typed.
 */
const blankStage = (key: string): StageRow => ({ key, stage_id: "", is_base: false });

/** One blank Sub Category row — same rule as `blankStage`: every key empty, and
 *  `normalizeSubCategories` drops a row whose `sub_category` was never typed. */
const blankSub = (key: string): SubRow => ({ key, sub_category: "", hsn_code: "" });

const FOR_FLAGS: { key: keyof typeof BLANK; label: string }[] = [
  { key: "for_yarn", label: "Yarn" },
  { key: "for_fabric", label: "Fabric" },
  { key: "for_trims", label: "Trims" },
  { key: "for_garments", label: "Garments" },
  { key: "for_components", label: "Components" },
];

/**
 * Master-detail CRUD for the legacy "Process" master: a header (name, billing
 * basis, HSN code, "For" applicability + planning flags) plus an optional
 * "Sub Categories" line grid and, for a fabric process, the "Fabric Stages"
 * mapping. Table on desktop, cards on mobile, Sheet editor.
 *
 * ## Three fields have LEFT this master, and each left for a different reason
 *
 * - **Commodity** — a header field and a list column until the client withdrew
 *   the whole Commodities master (2026-08-01). `processes.commodity_id` stays in
 *   the database, unread and unwritten: the master went, the stored values still
 *   mean something.
 * - **Short Description** and **Sl No** — removed by the client in the form
 *   review of doc/order/fabriprocess.md §4 (2026-09-16). Unlike Commodity these
 *   went from the DATABASE too (0565), because `processes` is a `lib/data-io`
 *   entity and an import descriptor is a write path straight to Postgres — a
 *   field left standing in the Zod schema is a door this form has closed and a
 *   spreadsheet can still walk through. Sl No in particular was the legacy
 *   hand-typed step order, and step order is now governed by the 5 standard
 *   process routes: "manual serial numbers cause sequencing errors".
 */
export function ProcessMasterScreen({
  rows,
  stages,
  perms,
}: {
  rows: Process[];
  /** `config_lookups` kind 'fabric_stage' (0563) — GREIGE · DYED · WASH · PRINT
   *  on the live master, which is the operator's own naming and not 0492's
   *  seeded GREY: the list is theirs to rename and extend, and 0563 binds to
   *  whatever rows it finds rather than adding its own. The grid shows `name`
   *  and never reasons about the code. An open list, so `LookupDialogPicker`
   *  lets a fifth stage be added inline. */
  stages: ConfigLookup[];
  perms: Perms;
}) {
  const router = useRouter();
  const { success, error } = useToast();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(BLANK);
  const [subs, setSubs] = useState<SubRow[]>([]);
  const [stageRows, setStageRows] = useState<StageRow[]>([]);
  const keySeq = useRef(0);
  const newKey = () => `s${keySeq.current++}`;

  const set = (patch: Partial<typeof BLANK>) => setForm((f) => ({ ...f, ...patch }));

  const { query, setQuery, filtered, filterValues, setFilter, activeCount, reset, dateFilter } = useMasterFilter<
    Process,
    { status: string; for: string; billingOn: string }
  >(rows, {
    // No `short_description` — the field went with 0565 (see the header note).
    searchKey: (r) => [r.name, r.billing_on, r.hsn_code].filter(Boolean).join(" "),
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

  /**
   * THE SEEDING HAPPENS IN THE OPEN HANDLERS, not through `ChildGrid seedRow`.
   *
   * AGENTS.md ▸ "Editable sub-tables open with a row" names both shapes and the
   * third statement is the one screens forget: **opening the editor for a new
   * record has to run the factory again**. A `useState` initialiser fires once
   * per mount and this Sheet does not remount between records, so seeding at
   * init would show the PREVIOUS process's stage rows the second time New is
   * pressed. Both handlers below therefore seed unconditionally.
   *
   * `[]`, `null` and `undefined` all mean "no lines yet" and fall back to the
   * same one row, so an EXISTING fabric process with no mapping opens ready to
   * type rather than showing a bare "+ Add" button.
   */
  function openAdd() {
    setEditId(null);
    setForm(BLANK);
    setSubs([]);
    setStageRows([blankStage(newKey())]);
    setOpen(true);
  }
  function openEdit(r: Process) {
    setEditId(r.id);
    setForm({
      name: r.name,
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
      is_print: r.is_print,
      is_dyeing: r.is_dyeing,
      is_knitting: r.is_knitting,
      has_sub_categories: r.has_sub_categories,
      inactive: r.inactive,
    });
    const loaded = r.sub_categories.map((c) => ({
      key: newKey(),
      sub_category: c.sub_category,
      hsn_code: c.hsn_code ?? "",
    }));
    // A record that HAS sub-categories switched on but no lines saved against it
    // opens with a row standing ready, the same as a new one — the second of the
    // three statements in the rule above, and the one an `openEdit` that merely
    // maps the server rows always misses.
    setSubs(loaded.length || !r.has_sub_categories ? loaded : [blankSub(newKey())]);
    setStageRows(
      r.fabric_stages?.length
        ? r.fabric_stages.map((s) => ({
            key: newKey(),
            stage_id: s.stage_id,
            is_base: s.is_base,
          }))
        : [blankStage(newKey())],
    );
    setOpen(true);
  }

  function toggleHasSubs(checked: boolean) {
    set({ has_sub_categories: checked });
    if (checked && subs.length === 0) setSubs([blankSub(newKey())]);
  }
  function addSub() {
    setSubs((ss) => [...ss, blankSub(newKey())]);
  }
  function setSubAt(key: string, patch: Partial<SubRow>) {
    setSubs((ss) => ss.map((s) => (s.key === key ? { ...s, ...patch } : s)));
  }
  function removeSub(key: string) {
    setSubs((ss) => ss.filter((s) => s.key !== key));
  }

  /**
   * TICKING "Fabric" REVEALS THE STAGE GRID, so it has to open with a row too.
   *
   * Both open handlers already seed one, so this only fires where every row was
   * removed and the flag is switched back on — the same guard `toggleHasSubs`
   * carries one section up, and for the same reason: revealing an empty typing
   * surface is the defect, not an empty array.
   */
  function toggleFor(key: keyof typeof BLANK, checked: boolean) {
    set({ [key]: checked });
    if (key === "for_fabric" && checked && stageRows.length === 0)
      setStageRows([blankStage(newKey())]);
  }
  function addStage() {
    setStageRows((ss) => [...ss, blankStage(newKey())]);
  }
  function setStageAt(key: string, patch: Partial<StageRow>) {
    setStageRows((ss) => ss.map((s) => (s.key === key ? { ...s, ...patch } : s)));
  }
  function removeStage(key: string) {
    setStageRows((ss) => ss.filter((s) => s.key !== key));
  }

  function submit() {
    startTransition(async () => {
      const payload: ProcessInput = {
        name: form.name.trim(),
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
        is_print: form.is_print,
        is_dyeing: form.is_dyeing,
        is_knitting: form.is_knitting,
        has_sub_categories: form.has_sub_categories,
        inactive: form.inactive,
        sub_categories: form.has_sub_categories
          ? subs
              .filter((s) => s.sub_category.trim())
              .map((s, i) => ({
                sno: i + 1,
                sub_category: s.sub_category.trim(),
                hsn_code: s.hsn_code.trim() || null,
              }))
          : [],
        /* THE BLANK-ROW FILTER, and it tests `stage_id` and nothing else.
           `is_base` must never join it. A tick defaulting to `false` in an
           OR-chain counts an untouched seeded row as evidence of a mapping —
           the phantom-line bug `scripts/check-blank-row-filter.mts` exists for —
           and an AND (`stage_id && is_base`) is worse still, because `false` is
           the NORMAL value here: 9 of the 11 pairings 0563 seeds are secondary
           steps with the box unticked (Heat Setting, Stentering, both
           Compactings), so requiring it would drop every one of them on save.
           The symptom would not even be an error — it would be T1's picker
           quietly withholding Stentering and Compacting afterwards, reading as
           the route rule being wrong rather than as rows having been dropped.
           A stage picked with the box unticked is a complete classification.
           The action re-applies this (`normalizeFabricStages`), which is the
           guard; this is the courtesy. */
        fabric_stages: form.for_fabric
          ? stageRows
              .filter((s) => s.stage_id)
              .map((s) => ({ stage_id: s.stage_id, is_base: s.is_base }))
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
    /* NO "Sl No" COLUMN. It was here, last before Status, and the client removed
       the field outright (doc/order/fabriprocess.md §4). Nothing sorts by it —
       this list is ordered by name in `listProcesses`, and the one feed that DID
       order by the column (`lib/orders/fabric-plan/service.ts`) now orders by
       name too. */
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
          {/* ## THE ROW WAS RE-SETTLED WHEN TWO OF ITS FOUR FIELDS LEFT (2026-09-16)

              It used to be `span={2}` — the identity block spanning the sheet, so
              its fields sat on the ~1150px track where `sm` (3 of 12) IS the
              ~280px reference, four flush across (LAYOUT.md §3). Short
              Description and Sl No then went (doc/order/fabriprocess.md §4) and
              `sm + sm` left two thirds of a full-width row empty — and
              underfilling is the defect that SHIPS, because leftover columns
              read as page padding rather than as a layout bug.

              Two answers were available and only one obeys both rules. Promoting
              the survivors to `lg + lg` sums to 12 and makes an HSN code ~560px
              wide, which is stretching an innocent field — the thing LAYOUT.md
              §3 tells you not to do when a group cannot tile. Dropping `span={2}`
              instead changes the TRACK, not the fields: the section becomes one
              ~565px column of the `SectionGrid` (still above `@lg/section`'s
              32rem, so the 12-track stays on), and there `lg` (6 of 12) IS the
              ~280px reference. 6 + 6 = 12, flush, at the one width every field on
              this form already takes.

              The section also stopped being wide enough to justify spanning: with
              two fields in it there is no four-across row left to protect, and
              "For" now sits BESIDE Details instead of below it.

              THAT MOVE HAS A SECOND HALF — see `Structure` below. Taking a span
              off one section re-deals every section after it, and the four here
              only tile 2 × 2 once Structure gives up its span too. Changing one
              and not the other trades a half-empty field row for a half-empty
              section row, which is the same defect one scale up. */}
          <DetailSection label="Details" cols={12}>
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
            {/* 6 + 6 = 12, one flush row — see the section's own note above for
                why the arithmetic changed and why it is the TRACK that moved
                rather than the fields. Before Short Description and Sl No left it
                read 3 + 3 + 3 + 3 = 12 on the full-sheet track; before THAT it
                was a full-width Process, a half-width Short Description and a
                hand-rolled `grid-cols-3` — three different widths down one short
                form, which is the ragged whitespace §3 exists to stop. */}
            <Field label="Billing On" size="lg" htmlFor="pr-billing">
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
            <Field label="HSN Code" size="lg" htmlFor="pr-hsn">
              <Input
                uppercase
                id="pr-hsn"
                value={form.hsn_code}
                onChange={(e) => set({ hsn_code: e.target.value })}
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
                  onChange={(e) => toggleFor(f.key, e.target.checked)}
                />
                <span className="text-sm text-foreground">{f.label}</span>
              </label>
            ))}
          </DetailSection>

          {/* Stacked, not paired: these read as sentences, and two of them side
              by side would wrap where "For"'s single words do not. (It said
              "these three" while there were five and now six — the count was
              never the argument, the sentence length is.) */}
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
            {/* 0528 — read by the Fabric BOM ▸ Fabric Process picker to refuse
                "Print" until the order has an AOP / Roll form print declared. */}
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                className="h-4 w-4 cursor-pointer accent-primary"
                checked={form.is_print}
                onChange={(e) => set({ is_print: e.target.checked })}
              />
              <span className="text-sm text-foreground">Is Print Process</span>
            </label>
            {/* 0557 — read by the Fabric BOM ▸ Fabric Process picker to
                withhold Dyeing from a Yarn-Dyed fabric's offered route. */}
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                className="h-4 w-4 cursor-pointer accent-primary"
                checked={form.is_dyeing}
                onChange={(e) => set({ is_dyeing: e.target.checked })}
              />
              <span className="text-sm text-foreground">Is Dyeing Process</span>
            </label>
            {/* 0564 — read by the Fabric BOM demand engine to DROP Knitting
                from the ladder of a fabric bought as ready-knitted greige or
                dyed rolls (§2's Default Rule 2). Third of the same shape as the
                two above, and the one whose consequence is worth knowing before
                you decide: LEAVING IT UNTICKED ERRS UPWARD, NEVER DOWNWARD. The
                yarn half of the suppression ignores this flag entirely, so an
                unticked box cannot make the app buy too little yarn; what it
                costs is a greige demand grossed by a knitting loss the cloth
                never had — an over-buy of a percent or two. Do NOT tick it on
                Knitting Dia, Flat Knitting or Knit Fabric Inspection: it means
                the step that MAKES greige cloth, not any process with KNIT in
                its name. */}
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                className="h-4 w-4 cursor-pointer accent-primary"
                checked={form.is_knitting}
                onChange={(e) => set({ is_knitting: e.target.checked })}
              />
              <span className="text-sm text-foreground">Is Knitting Process</span>
            </label>
          </DetailSection>

          {/* In a section of its own rather than floating loose under the last
              one, where it read as a stray control belonging to nothing.

              IT USED TO CARRY `span={2}`, "because the grid it gates is full
              width below", and that argument died with Details' own span
              (2026-09-16). The four sections auto-place into a two-column grid,
              so with Details at one column the spans read Details · For ·
              Planning · Structure(2) — and a `col-span-2` item cannot start in
              the second column, so Structure dropped to a row of its own and
              left a HOLE beside Planning. Under-filling is the defect that
              ships, at the section scale exactly as at the field scale. At
              `span={1}` the four tile 2 × 2 with nothing left over, and the
              section holds two checkboxes that never needed the width. The
              grids it gates are rendered BELOW `SectionGrid` entirely, so they
              are full width either way. */}
          <DetailSection label="Structure" cols={2}>
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
              flatRows
              rows={subs}
              onAdd={addSub}
              onRemove={(s) => removeSub(s.key)}
              addLabel="+ Add sub category"
              renderMobileRow={(s) => (
                <>
                  <Input uppercase value={s.sub_category} onChange={(e) => setSubAt(s.key, { sub_category: e.target.value })} placeholder="Sub Category" className="text-base md:text-sm" />
                  {/* The row's second cell used to be a Short Description beside
                      this one, two-per-row inside the card; the client removed
                      that field from both places it appeared (2026-09-16,
                      doc/order/fabriprocess.md §4) and 0565 dropped the column,
                      so HSN Code now takes the line on its own. */}
                  <Input uppercase value={s.hsn_code} onChange={(e) => setSubAt(s.key, { hsn_code: e.target.value })} placeholder="HSN Code" className="text-base md:text-sm" />
                </>
              )}
              columns={[
                {
                  header: "Sub Category",
                  cell: (s) => (
                    <Input uppercase value={s.sub_category} onChange={(e) => setSubAt(s.key, { sub_category: e.target.value })} className="text-base md:text-sm" />
                  ),
                },
                {
                  header: "HSN Code",
                  cell: (s) => (
                    <Input uppercase value={s.hsn_code} onChange={(e) => setSubAt(s.key, { hsn_code: e.target.value })} className="text-base md:text-sm" />
                  ),
                },
              ]}
          />
        )}

        {/**
         * FABRIC STAGES (0563) — which stages this process may run in, and where
         * it is that stage's mandatory entry step.
         *
         * ## WHY A GRID AND NOT A FLAG
         *
         * Knitting is the base of Greige, Dyeing of Dyed, Washing of Wash and
         * Printing of Print — one stage each, so a flag would have done. But
         * Stentering and Compacting are secondary steps in three different
         * stages at once, and a process's stage list is therefore a SET, not a
         * value. `is_print` (0528) and `is_dyeing` (0557) up in Planning are the
         * one-stage shape; this is the general one, and like both of those it is
         * seeded once by its migration and operator-maintained from then on.
         *
         * ## "BASE" IS A TICK PER ROW AND NOT A CHOICE ACROSS THE STAGE
         *
         * A stage may legitimately have more than one base — §3 of the spec
         * reads "Dyeing (or Yarn Dyeing)" — so `is_base` is a checkbox on each
         * pairing rather than a radio picking one winner per stage. Nothing here
         * demands that a stage HAVE a base either, and a save-time guard
         * insisting on one would be wrong rather than strict: two of the four
         * live stages (Wash, Print) have none on day one, because the master
         * holds no WASHING row and no `for_fabric` PRINTING row for 0563 to seed
         * from. T1's rule stands down and offers the stage's ordinary list
         * instead; this screen is where an operator fills the gap.
         *
         * ## WHY IT IS GATED ON `for_fabric`
         *
         * A stage is a state of CLOTH — greige, dyed, washed, printed — and the
         * whole point of the mapping is that the stage decides which physical
         * stock ledger a weight lands in. A garment or trims process running "in
         * the Dyed stage" is not a thing that ledger can mean, so the grid is not
         * offered there. `normalizeFabricStages` in `process-actions.ts` refuses
         * it on the save side too: a gate that only hides a control is a gate an
         * import walks straight through.
         *
         * ## THE STAGE CELL IS NOT MARKED `required`, DELIBERATELY
         *
         * A `*` here would hold the cursor in the seeded blank row (AGENTS.md ▸
         * Mandatory fields), so opening any fabric process would cage the
         * operator in a cell before they had read the form — and it would be
         * claiming something false. AN UNCLASSIFIED PROCESS IS A PERMITTED
         * STATE, not missing data: T1's rule reads an empty mapping as "offered
         * in every stage", which is what keeps a master the seed does not name
         * (FABRIC PURCHASE, deliberately) from going unpickable everywhere the
         * day 0563 applies. Enforcement comes from CLASSIFYING here, one process
         * at a time, never from withholding by default. The blank row this grid
         * opens with is dropped on save, so leaving it untouched says nothing.
         */}
        {form.for_fabric && (
          <ChildGrid<StageRow>
            label="Fabric Stages"
            /* NO `forceCards` / `renderMobileRow`, unlike the Sub Categories grid
               above — and that is deliberate rather than an oversight. A grid
               that renders its own row states every cell TWICE (once in
               `columns`, once in the row), and under `forceCards` the `columns`
               half is then dead weight that nothing renders: the trap AGENTS.md
               records for `ChildGridColumn.required`, where the header `*` draws
               from a declaration the control never receives. Two cells is small
               enough to say once. The responsive default gives a real two-column
               table on the sheet and falls back to cards in a narrow pane. */
            rows={stageRows}
            onAdd={addStage}
            onRemove={(s) => removeStage(s.key)}
            addLabel="+ Add stage"
            columns={[
              {
                header: "Stage",
                width: "12rem",
                cell: (s) => (
                  <LookupDialogPicker
                    kind="fabric_stage"
                    label="Stage"
                    compact
                    options={stages}
                    value={s.stage_id || null}
                    onChange={(id) => setStageAt(s.key, { stage_id: id })}
                    /* PICK-ONCE: `unique (process_id, stage_id)` is the DB's half
                       of the rule, and withholding the taken ones is how the
                       operator finds that out BEFORE pressing Save. Scoped per
                       row, so a row never withholds its own stage from itself —
                       which would show a filled field as empty. */
                    usedIds={stageRows.filter((o) => o.key !== s.key).map((o) => o.stage_id)}
                    canCreate={perms.canCreate}
                    canEdit={perms.canEdit}
                  />
                ),
              },
              {
                /* "Base process" = the stage's MANDATORY first step — Knitting
                   for Greige, Dyeing for Dyed, Washing for Washed, Printing for
                   Printed. Everything else in a stage is a secondary step. */
                header: "Base Process",
                cell: (s) => (
                  <input
                    type="checkbox"
                    className="h-4 w-4 cursor-pointer accent-primary"
                    checked={s.is_base}
                    onChange={(e) => setStageAt(s.key, { is_base: e.target.checked })}
                    aria-label="Base process for this stage"
                  />
                ),
              },
            ]}
          />
        )}
      </Sheet>
    </div>
  );
}
