"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ChildGrid } from "@/components/masters/child-grid";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Field, FieldRow } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { DataTable, type Column } from "@/components/ui/data-table";
import { TableRowActionsMenu } from "@/components/ui/table-row-actions-menu";
import { StatusToggle } from "@/components/ui/status-toggle";
import {
  rowActionsColumn,
  ROW_ACTIONS_MENU_WIDTH,
} from "@/components/ui/row-actions-column";
import { isInactive } from "@/lib/masters/inactive";
import { useBlockAction } from "@/components/masters/use-block-action";
import { deletedToast } from "@/lib/masters/delete-message";
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
  deleteZone,
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
 * 180px, AND IT IS HAND-TYPED — the one width in this file that is not a step of
 * `lib/ui/sizes.ts`, and the skill's own rule is what licenses it rather than an
 * exception to it. `erp-form-compact`: "reach for `w={…}` first, and hand-typed
 * pixels only when a row has been tried at these and rejected."
 *
 * THIS ROW HAS NOW BEEN TRIED AT EVERY STEP THAT COULD HOLD A PLACE NAME, and
 * each was reported back the same day (client 2026-09-10): `code` 144, then
 * `term` 176 for "~170", then `party` 200 for "the exact same width
 * (w-[200px])", then 180, then 220, then 180 again. That is the sentence's
 * condition met six times over, not a preference overriding it — and rounding "~170" to
 * `term`'s 176 is what started the sequence. The client is tuning this row by
 * eye against a real screen; a number they can see beats a vocabulary they
 * cannot.
 *
 * WHAT THE VOCABULARY STILL GETS IS THE RULE UNDERNEATH IT. This is not "size to
 * the data" — nobody measured CENTRAL EAST and cut a box to fit it. It is one
 * number for BOTH controls, chosen for the row, which is the question
 * `lib/ui/sizes.ts` says to ask. So it stays local: no seventh step was added
 * there, because a step exists to be reused and this number answers one screen.
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
/**
 * TWO GRAMMARS, ONE NUMBER — the same split `FIELD_WIDTH` / `FIELD_WIDTH_CSS`
 * makes in `field.tsx`, and for the identical reason: a `Field` takes a Tailwind
 * class, a `ChildGridColumn.width` is written into `style`, and neither form can
 * be built from the other because Tailwind v4 scans SOURCE TEXT. Both are
 * literals here so the scanner sees the class, and they sit on adjacent lines so
 * a change to one that misses the other is visible in a two-line diff.
 *
 * Everything else in this file reads one of these, so 180 is stated twice and
 * nowhere else — the grid column, the box around it and the footer cap all
 * follow.
 */
const BOX_W = "w-[180px]"; //  the Zone Name field
const BOX_W_CSS = "180px"; //  the Area column — the same 180

/**
 * AND THE TWO CONTROLS THEMSELVES, ONE STRING (client 2026-09-10: "the exact
 * same fixed dimensions … w-[220px] h-8 text-xs. Remove any flex-1 or w-full so
 * both boxes are 100% equal in width and height").
 *
 * Sizing the two WRAPPERS was not enough to make the two BOXES identical, and
 * that is the lesson here. `Input` is `w-full` by default, so each box was the
 * width of whatever contained it — correct on both sides today and correct only
 * by coincidence, since the grid cell and the `Field` are sized by different
 * props in different files. Stating the width on the control removes the
 * indirection: `cn` is tailwind-merge and `className` is last, so `w-[220px]`
 * REPLACES `w-full` rather than fighting it.
 *
 * `flex-1` was never on either control. The grid cell takes it only when its
 * column declares no `width` (`c.width ? "shrink-0" : "flex-1"`), and this one
 * has declared 220 since `AREA_COL_W` below — so that half of the instruction is
 * already true and is recorded here so the next reader does not go looking.
 *
 * `h-8` FLAT, not the primitive's `h-9 @2xl/editor:h-8`. The pair is deliberate
 * — 36px keeps a full touch target on a phone and 32px is the desktop editor's
 * density — and inside this Sheet the container query already resolves to 32,
 * so this changes nothing on the screen the client is looking at and pins the
 * narrow case to match it.
 *
 * `text-xs md:text-xs`, BOTH HALVES. `Input` sets `text-base md:text-sm`, two
 * classes at two breakpoints, so a bare `text-xs` would win under `md` and lose
 * above it — 12px on a phone and 14px on the desk, which is the opposite of the
 * one thing being asked for.
 */
const INPUT_BOX = `${BOX_W} h-8 text-xs md:text-xs`;

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
 * the same step the zone it belongs to takes (`AREA_COL_W` below) — and it buys
 * the card for free:
 * `hugsContent` is true once every column declares a width, and inline mode's
 * `cardHug` is then an unconditional `w-fit`. The frame stops at the last column
 * instead of trailing grey to the edge of the section.
 */
/**
 * THE AREA BOX IS THE ZONE NAME BOX — the same width, by construction rather
 * than by agreement (client 2026-09-10: "zone name input box size same to area
 * input box"). Both controls hold the same kind of value, a place name typed by
 * hand, so the row reads as two boxes rather than as a wide one and a narrow
 * one.
 *
 * READ OUT OF `BOX_W_CSS`, NOT RETYPED. This line was `"11rem"` with a comment
 * saying it matched the field beside it, which is exactly the shape that goes
 * wrong: change the field and the grid keeps the old number, silently and with a
 * comment still claiming otherwise. The width has moved three times since, and
 * this line has been correct through all three without being touched.
 */
const AREA_COL_W = BOX_W_CSS; // 180px — the Zone Name box, by construction

/**
 * AND THE BOX AROUND IT, WHICH IS NOT DECORATION — it is what gives `ChildGrid`
 * a width to lay itself out in.
 *
 * `ChildGrid`'s outer element is the `@container` one (`container-type:
 * inline-size`, so `contain: inline-size` with it), and a size-contained box
 * contributes NOTHING to its own intrinsic width. As a bare flex item that
 * resolves to max-content 0: the card inside keeps its `w-fit` and spills out of
 * a parent measured at nothing. Its own comment records the same cycle from the
 * other side — "a content-sized container-query element is a cycle the browser
 * resolves by collapsing it" — which is why `hugsContent` puts `w-fit` on the
 * INNER card and never on that div.
 *
 * So the grid gets a definite width from its parent instead. That is what
 * `material-master-screen.tsx` does by handing the composition grid a
 * `<Field size="xl">` cell, and what Notify's contacts grid does with
 * `CONTACTS_W`; a plain sized `<div>` is the same answer without a label slot
 * this row has no room for.
 *
 * DERIVED IN CSS, not retyped as a class. The box is the column plus the grid
 * row's own `gap-2` (8px) and its 32px ✕ track — 2.5rem between them — so it is
 * stated as a `calc()` off `AREA_COL_W` and follows the column the day that
 * changes. A Tailwind `w-[…rem]` could not: it would have to be a literal for
 * the scanner, and a literal is what would have needed retyping when the step
 * moved from 176 to 200 an hour later.
 */
const AREA_BOX_W = `calc(${AREA_COL_W} + 2.5rem)`; // 220px today

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
 * DERIVED, NOT PICKED. The row is the name field, the gap, and the Areas box:
 *
 *   180                =  180   Zone Name (BOX_W above)
 *   + 1 x 12           =   12   the row's gap — `gap="row"`, i.e. `gap-x-3`,
 *                               and NOT the 10px `nowrap` brings by itself. See
 *                               the note on the row below.
 *   180 + 8 + 32       =  220   the Areas box (AREA_BOX_W): its one column
 *                               (AREA_COL_W), the row's own `gap-2`, and the
 *                               32px ✕ track. No index (`hideIndex`) and no
 *                               frame (`frameless`), so there is nothing else
 *                               in it to count.
 *   = 412                       the row, ending exactly there
 *   + 0.75rem          =   12   slack, the same trade Country's cap makes: the
 *                               buttons must not be the thing that decides where
 *                               the row breaks.
 *   = 424
 *
 * AND IT IS THE SUM, NOT A NUMBER THAT MATCHED THE SUM ONCE. Every term above
 * traces back to `BOX_W_CSS`, so changing that one number moves the field,
 * the grid column, the box around it and this cap together. A hand-typed
 * `max-w-[26rem]` was correct on the day it was written and would have gone
 * quietly wrong on the next width change — which arrived the SAME DAY, when the
 * step moved from `term` to `party`. Nothing here was edited for it.
 *
 * Declared here, below `AREA_BOX_W`, because it reads it; the JSX puts it on the
 * footer as an inline `maxWidth`, since a `calc()` cannot be a Tailwind class.
 */
const FORM_W = `calc(${AREA_COL_W} + 0.75rem + ${AREA_BOX_W} + 0.75rem)`;

/**
 * THE LABEL ROW, STATED BY THE CLIENT AND APPLIED TO BOTH COLUMNS (2026-09-10:
 * "set both labels to h-4 mb-1 text-xs … so their sizes and horizontal baseline
 * match perfectly").
 *
 * 16px of label, 4px of gap, then a 32px box — on BOTH sides, so the two inputs
 * start at the same y and stay there. That is the whole of what makes these twin
 * columns rather than two columns that happen to line up today.
 *
 * IT REPLACES THE `mt-2` THIS FILE CARRIED AN HOUR AGO. That answered the same
 * question from the other end (space the control DOWN from its label) and the two
 * cannot both be live — together they would spend 12px where the instruction
 * asks for 4. The later instruction wins and the earlier one is gone rather than
 * exempted around.
 *
 * `leading-4` RIDES WITH THEM, and it is not decoration. `Label` and the grid's
 * band both carry `LABEL_METRICS`, whose line box is 16px on a phone and
 * `@2xl/editor:leading-[14px]` on a desktop editor — so without pinning it the
 * two labels would agree with each other and disagree with themselves across the
 * container query, inside a fixed `h-4` box. One leading at both densities is
 * what makes `h-4` mean the same thing everywhere.
 *
 * TWO LITERALS FOR ONE RULE, and they cannot be built from one string: these are
 * child-selector variants and Tailwind v4 scans SOURCE TEXT, so an interpolated
 * `[&>label]:` prefix emits no CSS. Same split, same reason, as `BOX_W` /
 * `BOX_W_CSS` above — they sit on adjacent lines so a change to one that misses
 * the other shows up in a two-line diff.
 *
 * THEY REACH THE LABELS FROM THE PARENT because neither label is addressable
 * directly: `Field` renders its own `<Label>` with no className to pass through,
 * and the grid's band is drawn inside `ChildGrid`. A parent-scoped rule is also
 * what makes them WIN — `[&>label]:h-4` is one class plus one element, so it
 * outranks the label's own single class, and a container query adds no
 * specificity of its own.
 */
const LABEL_ON_FIELD = "[&>label]:h-4 [&>label]:mb-1 [&>label]:leading-4 [&>label]:text-xs";
const LABEL_ON_GRID =
  "[&>:first-child]:h-4 [&>:first-child]:mb-1 [&>:first-child]:leading-4 [&>:first-child]:text-xs";

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
 *
 * AND THE ROW IS PINNED TO ONE LINE (`nowrap`, client 2026-09-10). `FieldRow`
 * wraps by default and that is the house rule, because a row of many fields
 * folding its tail is better than a page that scrolls sideways. This row has
 * TWO children and nothing to fold: at 404px the only way it breaks is a pane
 * narrower than that, and what appears there is the Areas box alone on a second
 * line, reading as a stray rather than as a wrapped row — the same fault
 * `FIELD_ROW_NOWRAP` records from Customer ▸ Identity. `[&>*]:shrink-0` comes
 * with it and is the half that matters more here: without it flex compresses
 * both children below the widths above and the values clip with no visible
 * cause.
 *
 * `gap="row"` because `nowrap` alone brings 10px, tightened for a BAND of eight
 * narrow controls. Two controls cannot read as a band, so the only question left
 * is whether the pair matches the 12px every other row on this screen uses. The
 * prop's own note in `field.tsx` carries the argument.
 *
 * The `overflow-x-auto` that `nowrap` puts on the outer container is safe here:
 * the two things this row renders below a control — `DuplicateError` and
 * `SpellSuggestHint` — are both IN FLOW, so the container grows to fit them
 * instead of clipping. That is the check `erp-form-compact` asks for before
 * using `nowrap`, and the reason it asks is a picker with an in-flow panel;
 * there is no picker on this row.
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
  /* The Status SWITCH in the listing (client 2026-09-11). `setStatus` does the
     write, the toast and the refresh; `zone` is registered in
     `lib/masters/active-registry.ts`. */
  const { setStatus, isPending: statusPending } = useBlockAction("zone");
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

  /* A REAL DELETE NOW, not the old `deactivateZone` (2026-09-11). The flag
     belongs to the Status switch in the column beside this; leaving a
     "Deactivate" item in the menu would have given one zone two controls for one
     flag. `deleteZone` runs the shared guard, so a zone something points at
     soft-disables instead and `deletedToast` says which of the two happened —
     this screen no longer claims an outcome it cannot know. */
  function remove(r: Zone) {
    startTransition(async () => {
      const res = await deleteZone(r.id);
      if (res.ok) {
        success(deletedToast("Zone", res));
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
      /* A SWITCH, NOT A PILL (client 2026-09-11) — one click calls the status
         API, with no editor in between. Same component as Country, Port, Bank
         and Destination, so no two listings can drift.

         This screen builds its own `DataTable` rather than going through
         `MasterListShell`, so the cell is declared here instead of being spliced
         in. That is the ONLY difference: the switch, its green, the word beside
         it and the `isInactive` read are all `StatusToggle`'s. */
      header: "Status",
      className: "w-32",
      cell: (r) => (
        <StatusToggle
          row={r}
          label={r.zone_name}
          // Blocking is the destructive direction and `setMasterActive` gates it
          // as `delete` server-side.
          disabled={!perms.canDelete || isPending || statusPending}
          onChange={(active) => setStatus(r, active, { label: r.zone_name })}
        />
      ),
    },
    rowActionsColumn(
      (r) => (
        /* One ⋮ per row instead of three inline icons: View, Edit, a rule, then
           Delete behind a confirm dialog. The View is automatic —
           `rowActionsColumn` publishes the row and the menu reads it, exactly as
           `RowActions` did here before, so the eye this screen already had is
           not lost.

           `canDelete` no longer excludes an inactive row. It did while the item
           WAS the deactivate — there was nothing left for it to do on a row
           already off — and that reasoning went with the verb: deleting a
           blocked zone is exactly as meaningful as deleting a live one. */
        <TableRowActionsMenu
          label={r.zone_name}
          onEdit={() => openEdit(r)}
          onDelete={() => remove(r)}
          canEdit={perms.canEdit}
          canDelete={perms.canDelete}
          isPending={isPending}
        />
      ),
      ROW_ACTIONS_MENU_WIDTH,
    ),
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
        {/* `rowClassName` dims a switched-off row's DATA cells and leaves the
            last one alone — the ⋮ must stay legible on a dimmed row, and
            `opacity` on the `<tr>` would take it down with the text. Same rule
            `MasterListShell` applies to the listings it owns. */}
        <DataTable
          columns={withCreatedColumns(columns, pg.paged)}
          rows={pg.paged}
          getKey={(r) => r.id}
          rowClassName={(r) => (isInactive(r) ? "[&>td:not(:last-child)]:opacity-60" : undefined)}
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
          <div
            className="mr-auto flex w-full items-center justify-end gap-2"
            style={{ maxWidth: FORM_W }}
          >
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
            each grow into the space below it.

            `nowrap` + `gap="row"` are the other half of the same row — one line,
            never folded, at 12px (client 2026-09-10, "flex flex-row items-start
            gap-3"). It went 12 → 16 → 12 across three instructions in one hour;
            `gap="wide"` is still in `field.tsx` and still correct for the case it
            names, this row is simply no longer it. The long note above
            `AREA_BOX_W` has the rest, including the overflow check. */}
        <FieldRow nowrap gap="row" align="start">
          <Field label="Zone Name" required htmlFor="zn-name" className={`${BOX_W} ${LABEL_ON_FIELD}`}>
            <Input
              id="zn-name"
              uppercase
              // Both boxes take the SAME string — see `INPUT_BOX`.
              className={INPUT_BOX}
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
          {/* THE SIZED BOX IS LOAD-BEARING — `ChildGrid`'s outer element is size
              contained, so as a bare flex item it measures 0 and the card inside
              it spills. `AREA_BOX_W` above states the width and the arithmetic.

              Inside it: was a hand-rolled row list — its own header band, its own
              `#` column, its own remove button and a `max-h-56` inner scroller,
              i.e. ChildGrid, reimplemented and 3px out of step with it. One field
              per row, so `inlineCards`; `pageSize` replaces the scroll-in-a-box
              (client 2026-07-25). Keyboard nav comes with the component, so the
              local gridKeyNav wiring goes too. */}
          <div style={{ width: AREA_BOX_W }}>
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
              // The other half of `LABEL_ON_FIELD` — see its note. `flushRows`
              // makes the band the grid's ONE label row, and this gives that band
              // the same 16px box and 4px gap the field's own label has, so the
              // two controls under them start at the same y.
              bodyClassName={LABEL_ON_GRID}
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
                      // The other half of `INPUT_BOX` — same width, height and
                      // type size as Zone Name, from one declaration.
                      className={INPUT_BOX}
                      value={row.area_name}
                      onChange={(e) => updateChild(row.key, e.target.value)}
                    />
                  ),
                },
              ]}
              /* "+ Add area", CLEARLY BELOW THE ROWS RATHER THAN JOINED TO THEM
                 (client 2026-09-10). The card's own rhythm gives 12px — a flush
                 row's `pb-1.5` (6px) plus the card's `space-y-1.5` (6px) — and
                 `frameless` is what makes that read as too little here: with no
                 card border to close the rows off, the button sits under the last
                 row's rule and looks like the row after it.

                 `mt-2` is additive in Tailwind v4, where `space-y` is a
                 `margin-block-end` on every child but the last and carries zero
                 specificity (`:where()`), so it lands ON TOP of the 6px rather
                 than replacing it: 14px from the last input's box. In v3 it would
                 have been silently inert — `space-y` was a `margin-top` on the
                 later siblings at a specificity `mt-2` loses to. */
              addClassName="mt-2"
            />
          </div>
        </FieldRow>
      </Sheet>
    </div>
  );
}
