"use client";

/**
 * Style(s) ▸ Process — the screen behind the Process button on a style line.
 *
 * Client spec, 2026-08-12: "if the user clicks the process it will open process
 * screen, inside there Type field is listing two default — Garment Process,
 * Component Process — and then that process tab wired with the process master
 * data."
 *
 * So: a small grid of Type + Process rows. Type is the two-valued discriminator
 * (`lib/orders/amendments/style-processes.ts`), and it chooses which of the
 * Process master's own applicability flags — `for_garments` / `for_components`
 * (0227) — filters the picker beside it. Storage is 0411.
 *
 * ## Why a `Sheet`, and why that is not a style choice
 *
 * The Process button lives in a `ChildGrid` CELL, and `ChildGrid` wraps every
 * cell in a `RequiredScope`. `RequiredScope` is React context, so it follows the
 * RENDER tree — a surface rendered from inside that cell would inherit
 * "required" and stamp `data-required-empty` on every empty field it contains,
 * holding the cursor and announcing the wrong field's name. That is exactly the
 * New Yarn bug AGENTS.md records (client 2026-08-06).
 *
 * `Sheet` resets the scope at its portal boundary, which is what makes the Type
 * and Process cells below answer for themselves. It also registers with
 * `lib/reload-guard.ts`, so a deploy cannot silently reload the tab out from
 * under a half-filled process list. Neither is true of a hand-rolled
 * `fixed inset-0` div, which the guard's DOM scan cannot see at all.
 *
 * ## Edits apply live; there is no Apply button
 *
 * The rows are the parent's state, patched through `onChange` as they are typed,
 * exactly like every other child grid on this screen. The amendment's own
 * footer Save is what persists them. A local draft committed on "Apply" would
 * read as a second save inside a screen that already has one, and would put the
 * operator's work somewhere the unsaved-changes guard is not looking.
 */

import { useMemo } from "react";
import { Sheet } from "@/components/ui/sheet";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Field, FieldRow } from "@/components/ui/field";
import { ChildGrid, type ChildGridColumn } from "@/components/masters/child-grid";
import { RecordPicker } from "@/components/masters/record-picker";
import { SubSheetFooter } from "@/components/orders/sub-sheet-footer";
import {
  PROCESS_KIND_OPTIONS,
  componentsForKind,
  isProcessKind,
  processesForKind,
  styleProcessRowStarted,
  type ComponentOption,
  type ProcessKind,
  type ProcessOption,
  type StyleProcessRow,
} from "@/lib/orders/amendments/style-processes";

/**
 * The style line's identity, shown read-only above the grid.
 *
 * RESOLVED BY THE PARENT, not looked up here. Order Unit and Style No are
 * derived on the screen from `styleById` and `orderUnitLabel`, and re-deriving
 * them in this sheet would be a second answer to "what does this line say" —
 * the kind that stays right until one of the two is changed.
 */
export type StyleProcessHeader = {
  styleRefNo: string;
  articleNo: string;
  orderUnit: string;
  styleNo: string;
  styleDescription: string;
  poQty: string;
};

export function StyleProcessSheet({
  open,
  onClose,
  styleLabel,
  header,
  rows,
  onChange,
  processes,
  components,
  newKey,
  readOnly = false,
}: {
  open: boolean;
  onClose: () => void;
  /** The style this list belongs to, for the sheet title. */
  styleLabel: string;
  header: StyleProcessHeader;
  rows: StyleProcessRow[];
  onChange: (next: StyleProcessRow[]) => void;
  /** The whole master list, unfiltered — the narrowing is this file's job. */
  processes: ProcessOption[];
  /**
   * THIS STYLE'S OWN PARTS, already narrowed by the parent (0421).
   *
   * Scoped there rather than here, per the cascading-picker rule: the screen is
   * what knows which style this line names and which components it declares. A
   * sheet handed the whole components master would offer a collar on a style
   * that has none — and `garment_style_components` is the only thing that knows
   * it does not.
   */
  components: ComponentOption[];
  /**
   * The PARENT's key generator, passed in rather than grown here.
   *
   * These rows live in the parent's state and are re-keyed there when an
   * amendment is loaded from the database, so a counter local to this sheet
   * would start at zero beside keys the parent had already issued and collide
   * the moment a saved list was reopened and added to.
   */
  newKey: () => string;
  readOnly?: boolean;
}) {
  const patch = (key: string, next: Partial<StyleProcessRow>) =>
    onChange(rows.map((r) => (r.key === key ? { ...r, ...next } : r)));

  /**
   * Ids already taken, PER TYPE — the same shape 0411's unique key has.
   *
   * Scoping this by `kind` is not a refinement, it is the rule: a process
   * flagged for both garments and components is legitimately named under each
   * Type, and a flat set of taken ids would withhold the second one with no
   * explanation on a screen where it is a correct entry.
   */
  const usedByKind = useMemo(() => {
    const m = new Map<ProcessKind, Set<string>>();
    for (const r of rows) {
      if (!r.kind || !r.process_id) continue;
      const set = m.get(r.kind) ?? new Set<string>();
      set.add(r.process_id);
      m.set(r.kind, set);
    }
    return m;
  }, [rows]);

  const columns: ChildGridColumn<StyleProcessRow>[] = [
    {
      header: "Type",
      width: "12rem",
      cell: (r) => (
        <Select
          value={r.kind ?? ""}
          disabled={readOnly}
          required={styleProcessRowStarted(r)}
          className="h-8"
          onChange={(e) => {
            const next = isProcessKind(e.target.value) ? e.target.value : null;
            /**
             * CHANGING TYPE CLEARS A PROCESS THAT FALLS OUT OF SCOPE, and only
             * one that does. Re-answering Type on a row whose process is valid
             * under both flags must keep it — the cascading-filter rule's
             * "clear a held value ONLY when it really is out of scope". The
             * test is the master's flag, read through the same function the
             * picker offers by, so the two cannot disagree.
             */
            const stillValid =
              !!r.process_id &&
              processesForKind(processes, { kind: next }).some((p) => p.id === r.process_id);
            patch(r.key, { kind: next, process_id: stillValid ? r.process_id : null });
          }}
        >
          <option value=""></option>
          {PROCESS_KIND_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </Select>
      ),
    },
    {
      header: "Process",
      /* WIDTH DECLARED, like Type and Component beside it. Process and Details
         were the only two columns without one, so at full bleed they absorbed
         every pixel the fixed columns did not take — ~430px each to hold "BIT
         PRINTING".

         Declaring all four is also what makes the GRID hug its content instead
         of stretching: `ChildGrid` hugs when every column states a width, which
         is the compact row being asked for rather than a table ruled across
         1600px. 16rem fits a process name; the `Truncated` treatment inside the
         picker covers the rare longer one. */
      width: "16rem",
      cell: (r) => (
        <RecordPicker
          label=""
          items={processesForKind(processes, { kind: r.kind, currentValue: r.process_id })}
          value={r.process_id}
          onChange={(id) => patch(r.key, { process_id: id })}
          usedIds={r.kind ? usedByKind.get(r.kind) : null}
          disabled={readOnly}
          required={styleProcessRowStarted(r)}
          /* Empty-and-explain. With no Type the list is deliberately empty
             (see style-processes.ts), so the placeholder has to say why —
             an empty dropdown with a generic "— Select —" reads as "the
             master has no processes", which is a different and alarming
             thing to tell an operator. */
          placeholder={r.kind ? "— Select Process —" : "Pick a Type first"}
          compact
        />
      ),
    },
    {
      header: "Component",
      width: "12rem",
      /**
       * WHICH CUT PANEL (0421). "Work on cut panels — printing a logo or
       * embroidery — before the garment is sewn" (client 2026-08-13).
       *
       * DISABLED, NOT HIDDEN, under a Garment Process. That work is on the
       * made-up garment, so the question does not apply — but a column that
       * appears and disappears as Type is re-answered reads as a bug, and the
       * Prices tab already made this call for its Colour and Size cells under a
       * mode that does not price on that axis.
       *
       * NOT `required`, even on a started row. A Component Process whose panel
       * is still being decided is a legitimate half-answer, and 0421 leaves the
       * column nullable for exactly that; requiring it would hold the cursor on
       * the cell the operator opened the sheet to think about.
       */
      cell: (r) => (
        <RecordPicker
          label=""
          items={componentsForKind(components, {
            kind: r.kind,
            currentValue: r.component_id,
          })}
          value={r.component_id}
          onChange={(id) => patch(r.key, { component_id: id })}
          disabled={readOnly || r.kind !== "component"}
          /* Empty-and-explain, three ways — the list being empty means
             something different in each, and a bare "— Select —" would say
             none of them. */
          placeholder={
            r.kind === "component"
              ? components.length
                ? "— Select —"
                : "This style declares no components"
              : r.kind
                ? "Not on a garment process"
                : "Pick a Type first"
          }
          compact
        />
      ),
    },
    {
      /**
       * The legacy grid's fourth column (0412), and FREE TEXT on the evidence of
       * the reference screenshot: the Process cell beside it carries the ⓘ glyph
       * every master-backed field in this app carries, and this one carries
       * none. No `width`, so it takes the remaining space, which is what the
       * legacy column does.
       *
       * Not `required`, and not part of what makes a row savable: a process with
       * no remark is a complete answer, and the normalizer keeps it.
       */
      header: "Details",
      /* The widest of the four because it is the only free-text cell — artwork
         and design notes — but bounded like the rest, or it takes the whole
         remainder on its own. See the note on Process. */
      width: "20rem",
      cell: (r) => (
        <Input
          value={r.details}
          disabled={readOnly}
          className="h-8"
          onChange={(e) => patch(r.key, { details: e.target.value })}
        />
      ),
    },
  ];

  return (
    <Sheet
      open={open}
      onClose={onClose}
      /**
       * "lg", AFTER "sm" WAS TRIED AND WAS WRONG (client 2026-08-12, screenshot
       * 2266).
       *
       * `sm` is `max-w-md`, and sheet.tsx's own category for it — "nested
       * pickers / small config dialogs" — fitted the ARGUMENT but not the
       * CONTENT. This surface is a six-field identity block plus a
       * three-column grid, and in 448px `ChildGrid` did what it is supposed to
       * do at that width: it fell back to stacked cards. That drops the column
       * headers, so Type, Process and Details rendered as three unlabelled
       * boxes and the empty Details box read as a stray extra field the
       * operator had not asked for.
       *
       * The lesson is narrower than "use lg": a surface's size is a function of
       * what is ON it, not of how it is opened. Sizing this by the opener — a
       * grid cell, therefore small — is what produced a control that degraded
       * into something unreadable.
       */
      size="lg"
      /**
       * THE WHOLE PANE, not the 1180px reading width (client 2026-08-20:
       * "make full width screen").
       *
       * The same call the Structure Details and Assortments overlays already
       * made, and the third surface to make it — so the three sub-sheets of this
       * editor now open the same way instead of one of them insetting itself.
       *
       * `size="lg"` STAYS AND IS NOT REDUNDANT. It is the sheet's WIDTH CLASS,
       * and the note above records what it costs to get wrong: at `sm` the
       * `ChildGrid` inside fell back to stacked cards and dropped its column
       * headers. `fullBleed` removes the reading-width INSET; the two answer
       * different questions and this surface needs both answered.
       */
      fullBleed
      title={styleLabel ? `Process — ${styleLabel}` : "Process"}
      /* STILL NO SAVE OF ITS OWN — the rows are part of the amendment and are
         written by the amendment's Save, so a Save here would imply they commit
         on their own, and on a NEW order there is no amendment id to commit
         them against.
         
         BUT NO FOOTER AT ALL READ AS BROKEN. The client reported this sheet as
         "missing save button" (2026-08-14): fields, a grid, an "+ Add process"
         button, then nothing but an ✕. `SubSheetFooter` says what actually
         happens rather than leaving it to be inferred — the same footer the
         Structure Details and Assortments overlays now carry, so the three
         cannot answer the question differently. */
      zIndexBase={120}
      footer={<SubSheetFooter onDone={onClose} />}
    >
      {/**
        * THE STYLE LINE, READ-ONLY — the block the legacy screen puts above its
        * Process Details grid (client screenshot 2026-08-12).
        *
        * It is not decoration. The sheet is opened from one row of a grid that
        * may hold several style lines, and once it covers the screen there is
        * nothing else left to say WHICH line these processes belong to. The
        * legacy screen answers that with six fields; so does this.
        *
        * `readOnly` and not `disabled`: `Input` sets `tabIndex={-1}` on a
        * readOnly field itself, so these leave the Tab path without a
        * per-screen opt-out — the same reason the Order Unit cell on the parent
        * grid is readOnly, recorded there at length.
        */}
      {/* `FieldRow`, NOT `FieldGrid` (client 2026-08-20: "but fields size look
          too large, make it compact").

          THIS IS THE COST OF `fullBleed`, PAID PROPERLY. These were `size="md"`
          — `col-span-4` of a twelve-column track — which was right at the old
          1180px reading width and became six ~470px boxes the moment the sheet
          took the whole pane. A SPAN IS A FRACTION OF WHATEVER IT IS GIVEN, so
          widening the container widened every field with it, and `Order Unit`
          got a quarter of a metre to hold "PCS".

          Narrowing the CONTROL inside a fractional cell does not help and is the
          trap `FieldRow`'s own doc records: the cell stays its old width and the
          value floats in dead space, so the surplus reads as a HOLE rather than
          as room. "Nothing short of leaving the fractional track can make a row
          genuinely compact."

          So each field takes the width its data needs and the row ends where its
          content ends. The sums-to-12 rule is not being broken — it is a
          statement about a fractional track, and a content-width row has no
          twelfths to leave over.

          The widths are the data's: a ref and a style name are `term` (176px), a
          description is `name` (288px), a unit is `code` (144px) and a quantity
          is `num` (72px). Still six fields and still the legacy header's six
          facts; only the ruler changed. */}
      <div className="mb-4 rounded-md border bg-muted/30 p-3">
        <FieldRow>
          <Field label="Style Ref No" w="term">
            <Input readOnly value={header.styleRefNo} className="h-8" />
          </Field>
          <Field label="Article No" w="term">
            <Input readOnly value={header.articleNo} className="h-8" />
          </Field>
          <Field label="Style No" w="term">
            <Input readOnly value={header.styleNo} className="h-8" />
          </Field>
          <Field label="Style Description" w="name">
            <Input readOnly value={header.styleDescription} className="h-8" />
          </Field>
          <Field label="Order Unit" w="code">
            <Input readOnly value={header.orderUnit} className="h-8" />
          </Field>
          <Field label="PO Qty" w="num">
            <Input readOnly value={header.poQty} className="h-8 text-right" />
          </Field>
        </FieldRow>
      </div>

      <ChildGrid<StyleProcessRow>
        columns={columns}
        rows={rows}
        seedRow
        hideAdd={readOnly}
        onAdd={() =>
          onChange([
            ...rows,
            { key: newKey(), kind: null, process_id: null, component_id: null, details: "" },
          ])
        }
        onRemove={(r) => onChange(rows.filter((x) => x.key !== r.key))}
        addLabel="+ Add process"
      />
    </Sheet>
  );
}
