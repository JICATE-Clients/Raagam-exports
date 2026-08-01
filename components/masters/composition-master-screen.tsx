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
import { fmtNumber } from "@/lib/format";
import { usePagination } from "@/lib/use-pagination";
import { useMasterFilter } from "@/lib/masters/use-master-filter";
import { FilterBar } from "@/components/ui/filter-bar";
import { DataIoToolbar } from "@/components/data-io/data-io-toolbar";
import {
  createComposition,
  updateComposition,
  deleteComposition,
} from "@/lib/masters/composition-actions";
import { LookupDialogPicker } from "@/components/masters/lookup-dialog-picker";
import { CategoryPicker } from "@/components/masters/lookup-picker";
import { useDuplicateName, dupFieldProps } from "@/lib/masters/use-duplicate-check";
import { DuplicateError } from "@/components/ui/duplicate-error";
import { useSpellSuggest } from "@/lib/masters/use-spell-suggest";
import { SpellSuggestHint } from "@/components/masters/spell-suggest-hint";
import { ChildGrid } from "@/components/masters/child-grid";
import { DetailSection } from "@/components/masters/detail-section";
import { RowActions, rowActionsColumn } from "@/components/ui/row-actions";
import type { Composition, CompositionInput } from "@/lib/masters/composition-types";
import type { ConfigLookup } from "@/lib/masters/extras-types";
import type { Category } from "@/lib/masters/category-types";
import type { Levy } from "@/lib/masters/levy-types";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean; canExport?: boolean; isSuperAdmin?: boolean };
type LineRow = { key: string; category_id: string; description: string; mixing_pct: string };

const BLANK = { item_class_id: "", short_name: "", name: "", inactive: false };

/**
 * Master-detail CRUD for the legacy "Composition" master: a header (Item Class
 * · Short Name · Name · Inactive) plus a "Mixing" grid naming the fibres the
 * fabric is made of + their mixing %. Composition only ever applies to Fabric,
 * so Item Class uses the same LookupDialogPicker as every other master (search +
 * Add/Modify/Delete), just fed a Fabric-only options list from page.tsx —
 * mirrors Material Attribute's PACK/SEW restriction, category.tsx's picker.
 * Dense table on desktop, cards on mobile, shared <Sheet> editor.
 *
 * THE HEADER IS FABRIC AND THE LINES ARE YARN, which reads like a mistake and
 * is not: a composition belongs to a fabric, and its lines name the yarns
 * inside it. So the line picker is scoped to the YARN item class (0384) while
 * the header picker stays Fabric-only.
 */
export function CompositionMasterScreen({
  rows,
  itemClasses,
  yarnClassId,
  yarnCategories,
  levies,
  fabricStructures,
  perms,
}: {
  rows: Composition[];
  itemClasses: ConfigLookup[];
  /** config_lookups id of the YARN item class — scopes the line picker and the
   *  categories its "+ Add" creates. */
  yarnClassId: string | null;
  /** Categories already scoped to YARN by the caller (cascading-picker rule). */
  yarnCategories: Category[];
  /** Lookup lists the full Category quick-create sheet needs. Without them
   *  "+ Add" falls back to a name-only form, which would leave the new fibre's
   *  Category Type blank — and that answer gates the Material form's Mixing grid. */
  levies: Levy[];
  fabricStructures: ConfigLookup[];
  perms: Perms;
}) {
  const router = useRouter();
  const { success, error } = useToast();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(BLANK);
  const [lines, setLines] = useState<LineRow[]>([]);
  const keySeq = useRef(0);
  const newKey = () => `l${keySeq.current++}`;

  const fabricClass = itemClasses[0];
  const classLabel = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of itemClasses) m.set(c.id, c.name);
    return m;
  }, [itemClasses]);

  /** Resolve a line's fibre for DISPLAY. The category wins where there is one;
   *  `description` answers for rows entered before 0384, which have no category
   *  to resolve — dropping it would blank the Mixing column on every legacy
   *  composition. Also covers a category since deleted outright. */
  const categoryName = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of yarnCategories) m.set(c.id, c.name || c.short_name || "—");
    return m;
  }, [yarnCategories]);
  const lineLabel = (l: { category_id: string | null; description: string }) =>
    (l.category_id ? categoryName.get(l.category_id) : null) ?? l.description;

  // Real-time duplicate check on Name (mirrors the on-save guard in composition-actions).
  const dupError = useDuplicateName({
    table: "compositions",
    name: form.name ?? "",
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
    // No curated vocabulary: this master has no real-world standard to draw
    // on, so the rows beside what is being typed are the only safe candidates.
    seed: [],
    enabled: open && !dupError,
    onApply: (v) => setForm((f) => ({ ...f, name: v })),
  });

  const { query, setQuery, filtered, filterValues, setFilter, activeCount, reset, dateFilter } = useMasterFilter(rows, {
    search: (r, q) =>
      [r.name, r.short_name, classLabel.get(r.item_class_id), ...r.lines.map(lineLabel)]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q),
    filters: {
      status: (r, v) => (v === "active" ? !r.inactive : v === "inactive" ? !!r.inactive : true),
    },
    initialFilters: { status: "" },
  });

  const pg = usePagination(filtered, 10);

  function openAdd() {
    setEditId(null);
    setForm({ ...BLANK, item_class_id: fabricClass?.id ?? "" });
    setLines([{ key: newKey(), category_id: "", description: "", mixing_pct: "" }]);
    setOpen(true);
  }
  function openEdit(r: Composition) {
    setEditId(r.id);
    setForm({
      item_class_id: r.item_class_id,
      short_name: r.short_name ?? "",
      name: r.name ?? "",
      inactive: r.inactive,
    });
    setLines(
      r.lines.map((l) => ({
        key: newKey(),
        category_id: l.category_id ?? "",
        description: l.description,
        mixing_pct: String(l.mixing_pct),
      })),
    );
    setOpen(true);
  }

  function addLine() {
    setLines((ls) => [...ls, { key: newKey(), category_id: "", description: "", mixing_pct: "" }]);
  }
  function setLineAt(key: string, patch: Partial<LineRow>) {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }
  function removeLine(key: string) {
    setLines((ls) => ls.filter((l) => l.key !== key));
  }

  /**
   * The fibre a mixing line names — a YARN-class category, not free text (0384).
   *
   * `usedIds` is PICK ONCE, and it is not tidiness: the same fibre on two lines
   * is one fibre whose two percentages should have been added together, and it
   * turns the "Total 100%" badge into a sum nobody can read. Same guard, same
   * reason, as the Material master's Mixing grid.
   *
   * `description` is written alongside the id so the list summary, the search
   * text and the server's normalizeLines() keep reading one always-populated
   * column — and so a line stays readable if its category is later deleted.
   *
   * A plain function, not a `useMemo`/component: it is called from inside
   * `ChildGrid`'s column and card renderers, where a hook would run conditionally.
   */
  const fibreCell = (l: LineRow) => (
    <CategoryPicker
      label=""
      title="Yarn"
      categories={yarnCategories}
      value={l.category_id}
      usedIds={lines.filter((x) => x.key !== l.key).map((x) => x.category_id).filter(Boolean)}
      onChange={(v) =>
        setLineAt(l.key, { category_id: v, description: (v && categoryName.get(v)) || "" })
      }
      itemClassId={yarnClassId ?? undefined}
      selectedClassCode="YARN"
      canCreate={perms.canCreate}
      canEdit={perms.canEdit}
      canDelete={perms.canDelete}
      levies={levies}
      fabricStructures={fabricStructures}
    />
  );

  const pctTotal = useMemo(
    () => lines.reduce((sum, l) => sum + (Number(l.mixing_pct) || 0), 0),
    [lines],
  );

  function submit() {
    startTransition(async () => {
      const payload: CompositionInput = {
        item_class_id: form.item_class_id,
        short_name: form.name.trim() || null,
        name: form.name.trim() || null,
        inactive: form.inactive,
        lines: lines
          // A line counts if it names a fibre EITHER way — a legacy row opened
          // for edit still carries only its text until someone re-picks it.
          .filter((l) => l.category_id || l.description.trim())
          .map((l, i) => ({
            sno: i + 1,
            category_id: l.category_id || null,
            description: l.description.trim(),
            mixing_pct: Number(l.mixing_pct) || 0,
          })),
      };
      const res = editId ? await updateComposition(editId, payload) : await createComposition(payload);
      if (res.ok) {
        success(editId ? "Composition updated." : "Composition added.");
        setOpen(false);
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  function remove(r: Composition) {
    startTransition(async () => {
      const res = await deleteComposition(r.id);
      if (res.ok) {
        success("Composition deleted.");
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  const columns: Column<Composition>[] = [
    {
      header: "Item Class",
      cell: (r) => <span className="text-sm">{classLabel.get(r.item_class_id) ?? "—"}</span>,
    },
    { header: "Name", cell: (r) => <span className="text-sm">{r.name ?? r.short_name ?? "—"}</span> },
    {
      header: "Mixing",
      cell: (r) => (
        <span className="text-sm text-muted-foreground">
          {r.lines.length
            ? r.lines.map((l) => `${lineLabel(l)} ${fmtNumber(l.mixing_pct)}%`).join(", ")
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
          searchPlaceholder="Search composition…"
          activeCount={activeCount}
          dateFilter={{
            ...dateFilter,
            onChange: (v) => {
              dateFilter.onChange(v);
              pg.setPage(1);
            },
          }}
          onReset={() => {
            reset();
            pg.setPage(1);
          }}
        >
          <div>
            <Label htmlFor="composition-filter-status">Status</Label>
            <Select
              id="composition-filter-status"
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
          <DataIoToolbar entityKey="compositions" rows={filtered} canExport={perms.canExport} />
          {perms.canCreate && (
            <Button size="md" onClick={openAdd}>
              + Add Composition
            </Button>
          )}
        </div>
      </div>

      {/* desktop table */}
      <div className="hidden md:block">
        <DataTable columns={columns} rows={pg.paged} getKey={(r) => r.id} empty="No composition records yet." />
      </div>

      {/* mobile cards */}
      <div className="space-y-2.5 md:hidden">
        {pg.paged.length === 0 ? (
          <div className="rounded-lg border border-border bg-surface px-4 py-10 text-center text-sm text-muted-foreground">
            No composition records yet.
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
                    {r.name ?? r.short_name ?? classLabel.get(r.item_class_id) ?? "—"}
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {classLabel.get(r.item_class_id) ?? "—"}
                  </div>
                </div>
                <StatusPill tone={r.inactive ? "danger" : "success"}>
                  {r.inactive ? "Inactive" : "Active"}
                </StatusPill>
              </div>
              {r.lines.length > 0 && (
                <div className="mt-2 text-[13px] text-muted-foreground">
                  {r.lines.map((l) => `${lineLabel(l)} ${fmtNumber(l.mixing_pct)}%`).join(", ")}
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
        title={editId ? "Edit Composition" : "New Composition"}
        footer={
          <>
            <Button variant="outline" size="md" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button size="md" disabled={isPending || !form.item_class_id || !form.name.trim() || !!dupError} onClick={submit}>
              {isPending ? "Saving…" : "Save"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {/* Two-column body — header fields LEFT, line-item grid RIGHT (Material
              form design). Stacks on mobile via grid-cols-1. */}
          <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
            {/* LEFT: header fields + status */}
            <div className="space-y-4">
              <DetailSection label="Details" cols={2}>
                {/* Item Class — same LookupDialogPicker every master uses (search +
                    inline Add/Modify/Delete). Composition only ever applies to
                    Fabric, so `itemClasses` from page.tsx is already filtered to
                    that single row — the dialog just naturally lists only Fabric. */}
                <LookupDialogPicker
                  kind="item_class"
                  label="Item Class"
                  required
                  options={itemClasses}
                  value={form.item_class_id}
                  onChange={(v) => setForm({ ...form, item_class_id: v })}
                  canCreate={perms.canCreate}
                  canEdit={perms.canEdit}
                  canDelete={perms.canDelete}
                  isSuperAdmin={perms.isSuperAdmin}
                />

                <div>
                  <Label htmlFor="cmp-name">
                    Name <span className="text-danger">*</span>
                  </Label>
                  <Input
                    id="cmp-name"
                    uppercase
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    required
                    className="text-base md:text-sm"
                    // ↓ into the suggestion strip, Enter applies, Esc dismisses.
                    onKeyDown={nameSuggest.onKeyDown}
                    {...dupFieldProps(dupError, "cmp-name")}
                  />
                  <DuplicateError error={dupError} id="cmp-name" />
                  <SpellSuggestHint
                    suggestions={nameSuggest.suggestions}
                    activeIndex={nameSuggest.activeIndex}
                    onApply={(v) => setForm((f) => ({ ...f, name: v }))}
                  />
                </div>
              </DetailSection>

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

            {/* RIGHT: mixing grid */}
            <div className="space-y-4">
              <ChildGrid<LineRow>
                label="Mixing"
                badge={
                  <span className={`text-xs tabular-nums ${pctTotal === 100 ? "text-success" : "text-muted-foreground"}`}>
                    Total {fmtNumber(pctTotal)}%
                  </span>
                }
                pageSize={10}
                forceCards
                rows={lines}
                onAdd={addLine}
                onRemove={(l) => removeLine(l.key)}
                addLabel="+ Add line"
                columns={[
                  {
                    header: "Yarn",
                    cell: (l) => fibreCell(l),
                  },
                  {
                    header: "%",
                    align: "center",
                    cell: (l) => (
                      <Input type="number" min="0" step="0.01" value={l.mixing_pct} onChange={(e) => setLineAt(l.key, { mixing_pct: e.target.value })} placeholder="%" className="text-base md:text-sm" />
                    ),
                  },
                ]}
                renderMobileRow={(l) => (
                  <>
                    {/* This grid is `forceCards`, so this renderer — not the
                        column above — is what draws every viewport. Both are
                        kept in step so flipping to `inlineCards` later is a
                        one-word change. */}
                    {fibreCell(l)}
                    {/* fields pair up two-per-row inside cards */}
                    <div className="grid grid-cols-2 gap-2">
                      <Input type="number" min="0" step="0.01" value={l.mixing_pct} onChange={(e) => setLineAt(l.key, { mixing_pct: e.target.value })} placeholder="%" className="text-base md:text-sm" />
                    </div>
                  </>
                )}
              />
            </div>
          </div>
        </div>
      </Sheet>
    </div>
  );
}
