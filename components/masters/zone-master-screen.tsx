"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ChildGrid } from "@/components/masters/child-grid";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Field, FieldRow, type FieldWidth } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { DataTable, type Column } from "@/components/ui/data-table";
import { RowActions } from "@/components/ui/row-actions";
import { rowActionsColumn } from "@/components/ui/row-actions-column";
import { PaginationBar } from "@/components/ui/pagination";
import { StatusPill } from "@/components/ui/status-pill";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { usePagination } from "@/lib/use-pagination";
import { useMasterFilter } from "@/lib/masters/use-master-filter";
import { FilterBar } from "@/components/ui/filter-bar";
import { DataIoToolbar } from "@/components/data-io/data-io-toolbar";
import {
  createZone,
  updateZone,
  deactivateZone,
} from "@/lib/masters/zone-actions";
import type { Zone, ZoneInput } from "@/lib/masters/zone-types";
import { useDuplicateName, dupFieldProps } from "@/lib/masters/use-duplicate-check";
import { DuplicateError } from "@/components/ui/duplicate-error";
import { useSpellSuggest } from "@/lib/masters/use-spell-suggest";
import { SpellSuggestHint } from "@/components/masters/spell-suggest-hint";
import { ZONE_NAMES } from "@/lib/masters/name-vocabularies";
import { createdMeta, withCreatedColumns } from "@/components/ui/created-columns";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean; canExport?: boolean; isSuperAdmin?: boolean };
type ChildRow = { key: string; area_name: string };

const BLANK = {
  zone_short_name: "",
  zone_name: "",
  inactive: false,
};

/**
 * WIDTHS, NOT TWELFTHS (`erp-form-compact`) — the same conversion Country,
 * Consignee and Notify have already had, on the smallest form of the set.
 *
 * Zone Name stood at `size="lg"`, 6 of 12. Inside a `SectionColumn` of a 1180px
 * sheet that is ~284px for a value whose entire vocabulary is CENTRAL · EAST ·
 * NORTH · NORTH EAST · SOUTH · WEST — ten characters at the longest, in a box
 * built for thirty. The old note above the section argued the twelfths honestly
 * and still landed wrong: it reasoned that `sm` would leave the name only 126px
 * and chose `lg` as the lesser evil, which is the choice a fractional track
 * forces. Neither share was ever the right answer, because a share is not a
 * width — the third option is the one the track cannot express.
 *
 *   zone_name  ->  `code`  144   free text with no schema maximum, so it takes
 *                                the step every other master name takes here
 *                                (Country's `name`, Consignee's `IDENTITY_W.name`,
 *                                Notify's short name). A third opinion on a
 *                                party-name width is the drift `lib/ui/sizes.ts`
 *                                exists to stop.
 *
 * NO NEW MEASUREMENTS AND NO HAND-TYPED PIXELS: the value is a step of the
 * vocabulary, picked by content type, not by this screen's longest zone.
 *
 * THE INACTIVE SWITCH HAD A STEP HERE (`range` 112) AND THE CONTROL IS GONE
 * (client 2026-09-09), so the step went with it. Deactivating a zone was never
 * only this switch's job — the list row's own "Deactivate" action does it, and
 * that is the surface the operator reaches it from now. What the removal must
 * NOT do is quietly reactivate a record: `inactive` stays in `BLANK`, `openEdit`
 * still reads it off the row and `submit` still sends it, so an inactive zone
 * edited through this form is saved inactive. Drop the field from the form state
 * and every edit silently switches the record back on.
 */
const FIELD_W = {
  zone_name: "code",
} satisfies Record<string, FieldWidth>;

/**
 * HOW WIDE THE FORM IS — one reader now, the footer's button box, so Cancel and
 * Save end where the row above them ends instead of a screen-width to its right.
 *
 * IT USED TO CAP A `DetailSection` AS WELL, and that card is gone: the client
 * asked for the "Details" and "AREAS" captions off and for Zone Name and Area on
 * ONE row (2026-09-09). A section exists to group and label a set of fields, and
 * with the label removed and one row left there is nothing for it to group — so
 * what was left of it was a bordered box drawing a 16px empty band above a
 * single line. `DetailSection`'s `label` is required and its header div carries
 * `min-h-4`, so "no caption" is not a state that component has; the honest way
 * to say it is not to use one.
 *
 * DERIVED, NOT PICKED. The row is the name field, the gap, and the Areas grid:
 *
 *   144                =  144   Zone Name (FIELD_W above)
 *   + 1 x 12           =   12   `FIELD_ROW`'s gap-x-3
 *   144 + 8 + 32       =  184   the grid: its one column (AREA_COL_W), the row's
 *                               own `gap-2`, and the 32px ✕ track. No index
 *                               (`hideIndex`) and no frame (`frameless`), so
 *                               there is nothing else in it to count.
 *   = 340                       the row, ending exactly there
 *
 * 22rem (352px) leaves 12px over that, the same slack-not-wrap trade Country's
 * cap makes: the buttons must not be the thing that decides where the row
 * breaks.
 */
const FORM_W = "max-w-[22rem]";

/**
 * AND THE AREAS GRID HUGS TOO — the child half of the same rule, and the reason
 * this screen was picked out.
 *
 * The grid declared no width on its one column, and `inlineCards` gives an
 * undeclared column `flex-1`: an area name got the whole ~584px of the right-hand
 * `SectionColumn`, one box per line, eight lines of it. That is rule 1 exactly —
 * a control stretched to its container rather than sized to its content — and it
 * is the same defect `ChildGrid`'s `narrow` prop records from the table side
 * ("a one-column grid renders a two-character size in a 1200px control").
 *
 * `narrow` is the wrong tool here: it caps the ROOT at `max-w-lg` (512px), which
 * is a cap this grid is already inside, and its width is coupled to the
 * responsive table's breakpoint that `inlineCards` does not use. Declaring the
 * COLUMN's width is the tool that fits — an area is a place name, so it takes
 * `code`'s 144 like the zone it belongs to — and it buys the card for free:
 * `hugsContent` is true once every column declares a width, and inline mode's
 * `cardHug` is then an unconditional `w-fit`. The frame stops at the last column
 * instead of trailing grey to the edge of the section.
 */
const AREA_COL_W = "9rem"; // 144px — `code`, as FIELD_W.zone_name

/**
 * ONE ROW, TWO CONTROLS, NO CAPTIONS — what the three removals above add up to,
 * written here because the JSX below reads as three unrelated prop changes.
 *
 * `Areas` was a `SectionColumn` beside the fields, i.e. a second column of a
 * `SectionGrid`, with its own caption band. To put its box on the SAME LINE as
 * Zone Name it has to be a child of that field's own `FieldRow`, and then two
 * things that were invisible while it sat in its own column start to matter:
 *
 * - `flushRows` — an inline grid puts its first control 31px down (an 18px header
 *   band, a 6px gap, a 7px card inset) where a `Field` puts its control at 14px.
 *   Side by side without it, the two boxes are 17px out of step. This is the prop
 *   that exists for exactly "a grid sharing a row with a plain `Field`", and
 *   Material ▸ Fabric ▸ Composition is the screen that paid for it.
 * - `hideIndex` — the `#` track costs 16px plus the row's 8px gap, so every area
 *   box would sit 24px right of where the grid's own "+ Add area" button starts.
 *   `flushRows` answers the vertical half of the alignment and this is the
 *   horizontal one, which is why they always arrive together.
 *
 * AND THE CAPTION IS NOT MERELY DELETED. `flushRows` allows the grid exactly one
 * band, so `label` no longer draws a caption above the rows at all — it fills the
 * COLUMN-HEADER slot while the grid is empty and hands that slot to the real
 * header the moment a row exists. So it reads "Area" in both states, level with
 * "Zone Name" beside it, and the uppercase "AREAS" band is gone rather than
 * relocated. Passing no label instead would leave an empty grid with no band at
 * all, dropping its "+ Add area" 14px above the field beside it — the
 * misalignment `ChildGrid` records from screenshot 2170.
 */

export function ZoneMasterScreen({
  rows,
  perms,
}: {
  rows: Zone[];
  perms: Perms;
}) {
  const router = useRouter();
  const { success, error } = useToast();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(BLANK);
  const [childRows, setChildRows] = useState<ChildRow[]>([]);
  const keyRef = useRef(0);
  const nextKey = () => `zn-${++keyRef.current}`;

  const { query, setQuery, filtered, filterValues, setFilter, activeCount, reset, dateFilter } = useMasterFilter(
    rows,
    {
      searchKey: (r) => [r.zone_short_name, r.zone_name].filter(Boolean).join(" "),
      filters: {
        status: (r, v) => (v === "active" ? !r.inactive : v === "inactive" ? !!r.inactive : true),
      },
      initialFilters: { status: "" },
    },
  );

  const pg = usePagination(filtered, 10);

  // Real-time duplicate check on the zone name (mirrors the on-save guard).
  const dupError = useDuplicateName({
    table: "zones",
    name: form.zone_name,
    nameColumn: "zone_name",
    excludeId: editId ?? undefined,
    enabled: !!form.zone_name.trim(),
    rows,
    rowId: (r) => r.id,
    rowValue: (r) => r.zone_name,
  });

  /**
   * "Did you mean?" — dupError above only fires on an EXACT collision, so a
   * one-character miss sails past it and becomes a second row meaning the same
   * thing as the first. Advisory only: the typed text saves as typed unless the
   * operator accepts a chip. Suppressed while the red error shows — one line
   * under the input, and the name it collided with is the one that is no use.
   */
  const nameSuggest = useSpellSuggest({
    name: form.zone_name ?? "",
    // The row being edited must not suggest its own name back at you.
    names: rows.filter((r) => r.id !== editId).map((r) => r.zone_name ?? "").filter(Boolean),
    seed: ZONE_NAMES,
    enabled: open,
    onApply: (v) => setForm((f) => ({ ...f, zone_name: v })),
  });

  function openAdd() {
    setEditId(null);
    setForm(BLANK);
    setChildRows([]);
    setOpen(true);
  }
  function openEdit(r: Zone) {
    setEditId(r.id);
    setForm({
      zone_short_name: r.zone_short_name ?? "",
      zone_name: r.zone_name,
      inactive: r.inactive,
    });
    setChildRows(
      (r.areas ?? []).map((a) => ({
        key: nextKey(),
        area_name: a.area_name ?? "",
      })),
    );
    setOpen(true);
  }

  function addChildRow() {
    setChildRows((rs) => [...rs, { key: nextKey(), area_name: "" }]);
  }
  function updateChild(key: string, value: string) {
    setChildRows((rs) =>
      rs.map((r) => (r.key === key ? { ...r, area_name: value } : r)),
    );
  }
  function removeChildRow(key: string) {
    setChildRows((rs) => rs.filter((r) => r.key !== key));
  }

  function submit() {
    startTransition(async () => {
      const payload: ZoneInput = {
        // New records derive the short name from the display name; edits keep
        // the record's original stored short name (it can be a logic key).
        zone_short_name: (editId ? form.zone_short_name.trim() : form.zone_name.trim()) || null,
        zone_name: form.zone_name.trim(),
        inactive: form.inactive,
      };
      const children = childRows
        .filter((c) => c.area_name.trim())
        .map((c) => ({ area_name: c.area_name.trim() }));
      const res = editId
        ? await updateZone(editId, payload, children)
        : await createZone(payload, children);
      if (res.ok) {
        success(editId ? "Zone updated." : "Zone added.");
        setOpen(false);
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  function deactivate(r: Zone) {
    startTransition(async () => {
      const res = await deactivateZone(r.id);
      if (res.ok) {
        success("Zone marked inactive.");
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  const columns: Column<Zone>[] = [
    { header: "Zone Name", cell: (r) => <span className="text-sm">{r.zone_name}</span> },
    {
      header: "Areas",
      align: "right",
      cell: (r) => (
        <span className="tabular-nums text-sm text-muted-foreground">
          {r.areas?.length || "---"}
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
    /* This master never hard-deletes — the row is deactivated, so the verb
       stays "Deactivate" rather than promising something else. Already-inactive
       rows have nothing left to do. */
    rowActionsColumn((r) => (
      <RowActions
        label={r.zone_name}
        onEdit={() => openEdit(r)}
        onDelete={() => deactivate(r)}
        deleteLabel="Deactivate"
        canEdit={perms.canEdit}
        canDelete={perms.canDelete && !r.inactive}
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
          searchPlaceholder="Search zone..."
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
            <Label htmlFor="zn-filter-status">Status</Label>
            <Select
              id="zn-filter-status"
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
          <DataIoToolbar entityKey="zones" rows={filtered} canExport={perms.canExport} />
          {perms.canCreate && (
            <Button size="md" onClick={openAdd}>
              + Add Zone
            </Button>
          )}
        </div>
      </div>

      {/* desktop table */}
      <div className="hidden md:block">
        <DataTable
          columns={withCreatedColumns(columns, pg.paged)}
          rows={pg.paged}
          getKey={(r) => r.id}
          empty="No zone records yet."
        />
      </div>

      {/* mobile cards */}
      <div className="space-y-2.5 md:hidden">
        {pg.paged.length === 0 ? (
          <div className="rounded-lg border border-border bg-surface px-4 py-10 text-center text-sm text-muted-foreground">
            No zone records yet.
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
                    {r.zone_name}
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">{createdMeta(r)}</div>
                </div>
                <StatusPill tone={r.inactive ? "danger" : "success"}>
                  {r.inactive ? "Inactive" : "Active"}
                </StatusPill>
              </div>
              {(r.areas?.length ?? 0) > 0 && (
                <div className="mt-2 text-[13px] text-muted-foreground">
                  {r.areas!.length} area{r.areas!.length === 1 ? "" : "s"}
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
        title={editId ? "Edit Zone" : "New Zone"}
        footer={
          /* `mr-auto` inside the Sheet footer's `justify-end` row: the auto margin
             eats the free space on the RIGHT, so this box sits at the left edge and
             the buttons — right-aligned inside it by `justify-end` — end exactly
             where the row above them ends. Without it they stay pinned to the
             1180px pane and float a screen-width away from a 340px form.
             `FORM_W` is the arithmetic, stated once at the top of this file. */
          <div className={`mr-auto flex w-full ${FORM_W} items-center justify-end gap-2`}>
            <Button variant="outline" size="md" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              size="md"
              disabled={isPending || !form.zone_name.trim() || !!dupError}
              onClick={submit}
            >
              {isPending ? "Saving..." : "Save"}
            </Button>
          </div>
        }
      >
        {/* ONE ROW: Zone Name, then the Areas grid — see the note above
            `AREA_COL_W` for why the grid needs `flushRows` + `hideIndex` to sit
            on that line, and what happened to its caption.

            No `DetailSection` and no `SectionGrid`. Both existed to place two
            captioned cards side by side; there is one row and no caption left to
            place, and a section whose label is gone is a bordered box drawing an
            empty band. `FORM_W` above records the arithmetic the footer aligns to.

            `align="start"`, not `FieldRow`'s default `items-end`: BOTH children
            grow downwards. Zone Name renders a `DuplicateError` and a
            `SpellSuggestHint` under its control, and the grid adds a row every
            time "+ Add area" is pressed. Bottom alignment measures from the
            bottom, so either one growing would shove the other's box up the
            screen — and the name's two hints appear WHILE TYPING, which is worse
            than a hint that is simply there: the row would settle at one height
            and then jump. Top alignment pins both boxes to the same line and lets
            each grow into the space below it. */}
        <FieldRow align="start">
          <Field label="Zone Name" w={FIELD_W.zone_name} required htmlFor="zn-name">
            <Input
              id="zn-name"
              uppercase
              value={form.zone_name}
              onChange={(e) => setForm({ ...form, zone_name: e.target.value })}
              required
              // ↓ into the suggestion strip, Enter applies, Esc dismisses.
              onKeyDown={nameSuggest.onKeyDown}
              {...dupFieldProps(dupError, "zn-name")}
            />
            <DuplicateError error={dupError} id="zn-name" />
            <SpellSuggestHint
              suggestions={nameSuggest.suggestions}
              existing={nameSuggest.existing}
              activeIndex={nameSuggest.activeIndex}
              duplicate={!!dupError}
              onApply={(v) => setForm((f) => ({ ...f, zone_name: v }))}
            />
          </Field>
          {/* Was a hand-rolled row list: its own header band, its own `#` column,
              its own remove button and a `max-h-56` inner scroller — i.e.
              ChildGrid, reimplemented and 3px out of step with it. One field per
              row, so `inlineCards`; `pageSize` replaces the scroll-in-a-box
              (client 2026-07-25). Keyboard nav comes with the component, so the
              local gridKeyNav wiring goes too. */}
          <ChildGrid<{ key: string; area_name: string }>
            lockExisting
            // Shown ONLY while the grid is empty, in the slot the column header
            // takes once a row exists — `flushRows` allows exactly one band, so
            // this is a header that stands in for itself, not a caption.
            label="Area"
            rows={childRows}
            onAdd={addChildRow}
            onRemove={(row) => removeChildRow(row.key)}
            addLabel="+ Add area"
            inlineCards
            // The three props that put this grid ON the row beside Zone Name
            // rather than in a card under its own caption. See `AREA_COL_W`.
            flushRows
            hideIndex
            frameless
            pageSize={8}
            columns={[
              {
                header: "Area",
                // The one column's width, and with it the grid's — see
                // `AREA_COL_W`. Without it `inlineCards` gives this cell
                // `flex-1` and the box takes every pixel the row will give.
                width: AREA_COL_W,
                cell: (row) => (
                  <Input
                    uppercase
                    value={row.area_name}
                    onChange={(e) => updateChild(row.key, e.target.value)}
                  />
                ),
              },
            ]}
          />
        </FieldRow>
      </Sheet>
    </div>
  );
}
