"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { DataTable, type Column } from "@/components/ui/data-table";
import { PaginationBar } from "@/components/ui/pagination";
import { StatusPill } from "@/components/ui/status-pill";
import { Truncated } from "@/components/ui/truncated";
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
import { RowActions } from "@/components/ui/row-actions";
import { rowActionsColumn } from "@/components/ui/row-actions-column";
import type { Composition, CompositionInput } from "@/lib/masters/composition-types";
import type { ConfigLookup } from "@/lib/masters/extras-types";
import type { Category } from "@/lib/masters/category-types";
import type { Levy } from "@/lib/masters/levy-types";
import { createdMeta, withCreatedColumns } from "@/components/ui/created-columns";
import { mixingList } from "@/lib/masters/mixing-name";

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

  /**
   * THE NAME IS THE MIXING (client 2026-08-19, screenshot 2355). A composition
   * has no identity of its own beyond the yarns in it and their shares, so the
   * operator was being asked to re-type, as prose, the two rows they had just
   * picked below — and any two operators typed it differently, which is how a
   * master ends up with COTTON 50 ELASTANE 50 sitting beside 50% COTTON / 50%
   * ELASTANE meaning the same fabric.
   *
   * Reads exactly as the list's own Mixing column does, and as the Material
   * master's Yarn/Fabric names do inside their brackets — `mixingList` is that
   * one rendering (`ANTHRA MELANGE 50%, ELASTANE 50%`). A composition's name
   * has no head in front of it, so it takes the bare list, not the bracketed
   * form.
   *
   * Only COMPLETE lines join it: a fibre with no share yet, or a share with no
   * fibre, would put a half-line into the name and take it straight back out on
   * the next keystroke. Nothing complete → null, and the effect below leaves the
   * field alone rather than blanking it.
   */
  const composedName = useMemo(() => {
    const filled = lines
      .map((l) => ({
        pct: l.mixing_pct,
        // Same resolution the column and the search text use: the category
        // where there is one, the stored text for a pre-0384 line.
        label: ((l.category_id ? categoryName.get(l.category_id) : null) ?? l.description).trim(),
      }))
      .filter((m) => m.label && m.pct.trim());
    return filled.length ? mixingList(filled).toUpperCase() : null;
  }, [lines, categoryName]);

  // Write it. Depends on `composedName` only — the value-compare is what keeps
  // the effect from looping on its own set(). The operator can still click into
  // Name and overwrite it (Yarn and Fabric behave the same way in the Material
  // master); the next change to a mixing line composes over the top again, which
  // is the trade that keeps one grid and one name from drifting apart.
  useEffect(() => {
    if (composedName) {
      setForm((f) => (f.name === composedName ? f : { ...f, name: composedName }));
    }
  }, [composedName]);

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
   * "Did you mean?" — STOOD DOWN, deliberately, and kept rather than deleted.
   *
   * The chips exist to catch a one-character miss the exact-match duplicate
   * check sails past. That is a typing failure, and since the name above is
   * composed from the picked yarns there is no typing left to fail: a chip here
   * would offer to "correct" the app's own output, and accepting it would put
   * the Name out of step with the grid that produced it until the next
   * keystroke silently composed over it again. Same reason
   * `material-master-screen.tsx` gates its strip on `nameIsComposed`.
   *
   * The duplicate ERROR still applies — two rows naming the same blend is
   * exactly what must be blocked, and the operator clears it by changing a
   * mixing line, not the text.
   */
  const nameSuggest = useSpellSuggest({
    name: form.name ?? "",
    // The row being edited must not suggest its own name back at you.
    names: rows.filter((r) => r.id !== editId).map((r) => r.name ?? "").filter(Boolean),
    // No curated vocabulary: this master has no real-world standard to draw
    // on, so the rows beside what is being typed are the only safe candidates.
    seed: [],
    enabled: false,
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
        // No `|| null` — `name` is mandatory in the schema now, so sending null
        // for a blank one would trade a caught error for a rejected save.
        name: form.name.trim(),
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
        <DataTable columns={withCreatedColumns(columns, pg.paged)} rows={pg.paged} getKey={(r) => r.id} empty="No composition records yet." />
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
                  {/* `Truncated`, not a bare `truncate` class: an ellipsis is a
                      promise the rest is reachable, and a composition name
                      ("POLYCOTTON 60/40 MELANGE") is exactly the length that
                      gets cut on a phone. It writes the `truncate` span itself
                      and only shows the bubble when something really is hidden. */}
                  <Truncated className="text-[15px] font-semibold text-foreground">
                    {r.name ?? r.short_name ?? classLabel.get(r.item_class_id) ?? "—"}
                  </Truncated>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {classLabel.get(r.item_class_id) ?? "—"}
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">{createdMeta(r)}</div>
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
        {/* ONE COLUMN, TOP TO BOTTOM (client 2026-08-04).
            This was a hand-rolled `lg:grid-cols-2` with the two header fields
            LEFT and the Mixing grid RIGHT, copied from the Material form. It
            does not survive the copy: Material fills both columns with ~50
            fields, and a Composition has TWO — so the split drew a card holding
            an Item Class and a Name beside a card holding one mixing row, and
            left the bottom two thirds of a full-screen editor empty.

            LAYOUT.md §4 already answered it: under 7 fields is a flat section,
            not a grouped one. And §1 forbids a screen writing its own
            `grid-cols-*` at all — the audit was flagging this file
            (`--check screen-grid`), which is how the drift was visible before
            anyone opened the screen. Read top to bottom now: who this is, then
            what it is made of. */}
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
                // A composed Name is never a tab stop — the operator reaches it
                // by CLICK on the rare occasion they want to override one, and
                // Tab walks the fields that actually compose it instead. Fixed,
                // not keyed off whether a name has been composed yet: that would
                // make the field a tab stop exactly while the form is blank,
                // which is when it is being tabbed through.
                tabIndex={-1}
                // Emitted even though nothing is typed here: the HOLD stands
                // itself down for a field the operator cannot reach with the
                // keyboard, but the red border and the announcement are what a
                // duplicate blend still needs to say.
                {...dupFieldProps(dupError, "cmp-name")}
              />
              <DuplicateError error={dupError} id="cmp-name" />
              <SpellSuggestHint
                suggestions={nameSuggest.suggestions}
                existing={nameSuggest.existing}
                activeIndex={nameSuggest.activeIndex}
                duplicate={!!dupError}
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

          {/* `inlineCards`, not `forceCards` — LAYOUT.md §6 picks the mode by
              FIELDS PER ROW, and a mixing line has two. `forceCards` is the 6-8
              band, so it drew each line as a stacked box: "#1", then the yarn on
              its own line, then the % on another, ~120px of chrome for two
              controls. This is the same grid Material ▸ Mixing renders, with the
              same 5rem % column — the two screens edit the same idea and should
              not look like different products. `renderMobileRow` goes with it:
              `inlineCards` ignores it by contract, and a second copy of the
              cells was only ever there to keep the card mode in step. */}
          <ChildGrid<LineRow>
            lockExisting
            label="Mixing"
            badge={
              <span className={`text-xs tabular-nums ${pctTotal === 100 ? "text-success" : "text-muted-foreground"}`}>
                Total {fmtNumber(pctTotal)}%
              </span>
            }
            pageSize={10}
            inlineCards
            rows={lines}
            onAdd={addLine}
            onRemove={(l) => removeLine(l.key)}
            addLabel="+ Add line"
            columns={[
              { header: "Yarn", cell: (l) => fibreCell(l) },
              {
                header: "Mixing %",
                align: "center",
                width: "5rem",
                cell: (l) => (
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={l.mixing_pct}
                    onChange={(e) => setLineAt(l.key, { mixing_pct: e.target.value })}
                    placeholder="%"
                    className="text-center"
                  />
                ),
              },
            ]}
          />
        </div>
      </Sheet>
    </div>
  );
}
