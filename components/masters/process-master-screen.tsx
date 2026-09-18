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
import { baseStageProblem } from "@/lib/masters/process-types";
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
type SubRow = { key: string; sub_category: string };
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
  is_conversion: false,
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
const blankSub = (key: string): SubRow => ({ key, sub_category: "" });

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
 * - **Sub-category HSN Code, Requires Designwise Delivery, and Is Print / Is
 *   Dyeing / Is Knitting Process** — removed by the client on 2026-09-18 as
 *   unnecessary. The first two had no reader and 0571 dropped their columns.
 *   The three KIND flags are read by the Fabric BOM, so they left the FORM
 *   only: they stay in the database as system-maintained data, seeded by
 *   migrations — see `Process` in `lib/masters/process-types.ts` for why the
 *   Fabric Stages grid cannot stand in for them. Use Conversion Process was
 *   kept.
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
      is_conversion: r.is_conversion,
      has_sub_categories: r.has_sub_categories,
      inactive: r.inactive,
    });
    const loaded = r.sub_categories.map((c) => ({ key: newKey(), sub_category: c.sub_category }));
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
  /* DERIVED, NEVER HAND-ASSEMBLED (AGENTS.md, the Save footer's `canSave`):
     the same function the server action refuses with, so the button and the
     save cannot disagree about what a base tick may be. */
  const baseProblem = baseStageProblem({
    for_fabric: form.for_fabric,
    fabric_stages: stageRows,
  });

  /* AN ADVISORY, NOT A REFUSAL — a stage may legitimately have two entry steps
     (GREIGE has KNITTING and FABRIC PURCHASE), so this only says what is
     already true elsewhere and leaves the decision alone. Read off the rows the
     list already holds; the editing row is excluded so a saved process never
     warns about itself. */
  const baseElsewhere = stageRows
    .filter((s) => s.stage_id && s.is_base)
    .flatMap((s) => {
      const other = rows.find(
        (r) =>
          r.id !== editId &&
          (r.fabric_stages ?? []).some((f) => f.stage_id === s.stage_id && f.is_base),
      );
      return other ? [other.name] : [];
    });

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
        is_conversion: form.is_conversion,
        has_sub_categories: form.has_sub_categories,
        inactive: form.inactive,
        sub_categories: form.has_sub_categories
          ? subs
              .filter((s) => s.sub_category.trim())
              .map((s, i) => ({ sno: i + 1, sub_category: s.sub_category.trim() }))
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
    /* NO "Designwise" COLUMN — its flag left the master on 2026-09-18 (see
       `Process` in process-types.ts). */
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
            <Button
              size="md"
              disabled={isPending || !form.name.trim() || !!dupError || !!baseProblem}
              onClick={submit}
            >
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
              "these three" while there were five, then six, and now two — the
              count was never the argument, the sentence length is.)

              FOUR FLAGS LEFT THIS SECTION ON 2026-09-18 (client: "unnecessary
              backend flags"). Requires Designwise Delivery had no reader and
              its column is gone (0571). Is Print / Is Dyeing / Is Knitting
              Process are still READ by the Fabric BOM, so their columns stay
              and migrations seed them; they are just no longer the operator's
              to tick. Do not re-add them here without the client asking — and
              do not "derive them from Fabric Stages" either; `Process` in
              process-types.ts records why that under-buys. */}
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
            {/* The one flag the client KEPT (2026-09-18), for the 10–20% of
                processes run as a conversion job. Labelled in their words —
                "Use Conversion Process" — rather than the old "Is …", which
                read like the kind flags that left beside it. */}
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                className="h-4 w-4 cursor-pointer accent-primary"
                checked={form.is_conversion}
                onChange={(e) => set({ is_conversion: e.target.checked })}
              />
              <span className="text-sm text-foreground">Use Conversion Process</span>
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
              grids it gates are rendered BELOW this `SectionGrid`, in a row of
              their own (compact tables side by side since 2026-09-18), so
              this section's span never decided their width. */}
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

        {/* ## TWO COMPACT TABLES, SIDE BY SIDE (client 2026-09-18, option B)

            Sub Categories used to be `forceCards` + `flatRows`: one full-pane
            card per row. It was sized for the two fields a row once held, and
            after Short Description (0565) and HSN Code (0571) left, a 7-letter
            name got a ~1,470px box with `flatRows`' `py-3` making a ~32px gap
            under every row (screenshot 2026-09-18 123322: "why this much gap").
            The client picked, from a mockup, a real table for it with Fabric
            Stages moved up beside it.

            THIS IS THE COLOR/PRINT DETAILS PATTERN (garment-order-screen.tsx),
            not a new one: `SectionGrid wrap`, one flex basis per pane, and
            `tableAlways` on each grid. `tableAlways` is needed because a
            pane this narrow sits below `ChildGrid`'s `@lg` (512px) table
            breakpoint, so without it both grids would fall back to the stacked
            cards we are replacing. That is safe only because both tables fit
            a phone (≤ 22.5rem); the rule is written on the prop.

            EACH BASIS IS DERIVED FROM ITS COLUMNS, not rounded. `ChildGrid`'s
            table is `#` 2.5rem (`w-10`) + the declared widths + ✕ 3rem, plus
            the frame's 2px. The ✕ is 3rem because its `<th>` is
            `w-12 min-w-12`; its `<col>` says 2rem but under `table-fixed` the
            header cell's min-width wins. The first cut of this row used 2rem
            and both tables came out ~10px wider than their panes.
              Sub Categories  2.5 + 15        + 3 = 20.5rem → basis 21rem
              Fabric Stages   2.5 + 8.5 + 8.5 + 3 = 22.5rem → basis 23rem
            Change a column width and change its basis with it.

            A PHONE IS THE TIGHT CASE. The Sheet body is `px-5`, which leaves
            ~348px (21.75rem): Sub Categories fits; Fabric Stages (360px) goes
            ~12px over and scrolls that much. Getting below that would take
            either wrapping the "BASE PROCESS" header or a Stage box too small
            for a stage name, both of which were the complaint on a desk.

            GROW 0, UNLIKE THE COLOR/PRINT PANES (`flex-[1_1_…]`). Those three
            fill a row between them; these two are meant to sit next to each
            other at the left, as in the mockup. Grow 1 would stretch each pane
            to half the sheet and push Fabric Stages out to the middle, with the
            tables' hug leaving empty space inside each pane. `flex-wrap` still
            drops Fabric Stages under Sub Categories on a narrow pane. */}
        {(form.has_sub_categories || form.for_fabric) && (
          <SectionGrid wrap>
            {form.has_sub_categories && (
              <div className="min-w-0 flex-[0_1_21rem]">
                <ChildGrid<SubRow>
                  lockExisting
                  label="Sub Categories"
                  pageSize={10}
                  tableAlways
                  rows={subs}
                  onAdd={addSub}
                  onRemove={(s) => removeSub(s.key)}
                  addLabel="+ Add sub category"
                  /* ONE CELL PER ROW. The row carried a Short Description
                     until 2026-09-16 (0565) and an HSN Code until 2026-09-18
                     (0571); the client removed both. HSN is stated once, on the
                     process header above, which is the only HSN anything reads.
                     No `renderMobileRow`: `tableAlways` never renders cards, so
                     a second copy of the cell would be dead code. */
                  columns={[
                    {
                      header: "Sub Category",
                      /* 15rem: whatever keeps this table within a phone's
                         width. See the row's arithmetic above. */
                      width: "15rem",
                      cell: (s) => (
                        <Input uppercase value={s.sub_category} onChange={(e) => setSubAt(s.key, { sub_category: e.target.value })} className="text-base md:text-sm" />
                      ),
                    },
                  ]}
                />
              </div>
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
         * value. It is seeded once by 0563 and operator-maintained from then on.
         *
         * The Is Print / Is Dyeing / Is Knitting ticks that once sat in Planning
         * above (removed from the form 2026-09-18) looked like the one-stage
         * special case of this grid and are NOT: a stage can have two bases
         * (0570 — KNITTING and FABRIC PURCHASE both open GREIGE), so "base of
         * Greige" cannot tell the knitting step from the purchase.
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
          <div className="min-w-0 flex-[0_1_23rem]">
          <ChildGrid<StageRow>
            label="Fabric Stages"
            /* NO `forceCards` / `renderMobileRow`, deliberately. A grid that
               renders its own row states every cell TWICE (once in `columns`,
               once in the row), and under `forceCards` the `columns` half is
               then dead weight that nothing renders: the trap AGENTS.md
               records for `ChildGridColumn.required`, where the header `*` draws
               from a declaration the control never receives. `tableAlways`,
               because this pane (23rem) is below the `@lg` table breakpoint; see
               the row's note above for the widths and why they fit a phone. */
            tableAlways
            rows={stageRows}
            onAdd={addStage}
            onRemove={(s) => removeStage(s.key)}
            addLabel="+ Add stage"
            columns={[
              {
                header: "Stage",
                /* 8.5rem (136px), down from 12 when the grid moved into its
                   half-row pane (2026-09-18). The live stages are GREIGE · DYED
                   · WASH · PRINT: after the cell's `px-1.5` and the control's
                   `px-3` that leaves ~100px, with the chevron overlaid rather
                   than reserving space (`combobox.tsx`), and GREIGE needs ~55.
                   The width went to Base Process, whose header must fit on one
                   line. */
                width: "8.5rem",
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
                /* A width is required here, not optional: `hugsContent` (and
                   with it the compact `w-auto table-fixed` table) turns on only
                   when EVERY column declares one. Without it the table goes back
                   to `w-full min-w-[420px]`, wider than its pane.

                   8.5rem, NOT 7 (client screenshot 2026-09-18 124421: the
                   header broke onto two lines). `GRID_HEADER_TEXT` is 12.5px
                   bold, upper case, 0.06em tracking, so "BASE PROCESS" is ~111px
                   of text plus the `<th>`'s `px-2` and its border: ~128px. 8.5rem
                   is 136px, a little spare for font rendering that differs from
                   one machine to the next. */
                width: "8.5rem",
                align: "center",
                cell: (s) => (
                  /* LEVEL WITH THE PICKER, NOT AT THE CELL'S TOP. Every
                     `ChildGrid` cell is `align-top`, deliberately (its own note:
                     centring made mixed-height rows look like a staircase). So
                     a 16px checkbox starts where a 32px (`h-8`) control starts,
                     and sits visibly high beside the Stage picker (same
                     screenshot). `h-8 items-center` puts it on the control's
                     centre line, the same thing the grid's own ✕ cell does
                     (`flex h-8 items-center justify-center`). */
                  <div className="flex h-8 items-center justify-center">
                    <input
                      type="checkbox"
                      className="h-4 w-4 cursor-pointer accent-primary"
                      checked={s.is_base}
                      onChange={(e) => setStageAt(s.key, { is_base: e.target.checked })}
                      aria-label="Base process for this stage"
                    />
                  </div>
                ),
              },
            ]}
          />
          {/* THE REFUSAL, where the tick that caused it is (client
              2026-09-18, after COMPACTING [OPEN WIDTH] was saved as the base
              of all four stages). Red and beside the grid rather than a toast
              on Save: the operator is looking at the four ticks, and a
              message that arrives after the button is one they read with the
              cause off screen. Save is disabled on the same value, so the two
              cannot disagree. */}
          {baseProblem && (
            <p role="alert" className="mt-1.5 text-xs font-medium text-danger">
              {baseProblem}
            </p>
          )}
          {/* AN ADVISORY AND NOT A SECOND REFUSAL — a stage may legitimately
              have two entry steps (GREIGE: KNITTING and FABRIC PURCHASE), so
              this says what is already true elsewhere and leaves the decision
              alone. Amber, unwired to Save: the "advisory stays plain amber
              text" half of AGENTS.md's duplicate rule. */}
          {!baseProblem && baseElsewhere.length > 0 && (
            <p className="mt-1.5 text-xs text-warning">
              {baseElsewhere.length === 1
                ? `${baseElsewhere[0]} is already an entry step of that stage. Two are allowed, so this is only worth a look.`
                : `${baseElsewhere.slice(0, 2).join(" and ")} are already entry steps of those stages. Two are allowed, so this is only worth a look.`}
            </p>
          )}
          </div>
        )}
          </SectionGrid>
        )}
      </Sheet>
    </div>
  );
}
