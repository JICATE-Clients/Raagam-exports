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
 * ## IT WAS A `Sheet` UNTIL 2026-08-29, AND THE REASON EXPIRED WITH THE MOVE
 *
 * The Process button lived in a `ChildGrid` CELL, and `ChildGrid` wraps every
 * cell in a `RequiredScope`. That scope follows the RENDER tree, so a surface
 * rendered from inside the cell inherited "required" and stamped
 * `data-required-empty` on every empty field within it, holding the cursor and
 * announcing the wrong field's name — the New Yarn bug AGENTS.md records
 * (client 2026-08-06). `Sheet` resets the scope at its portal boundary, and
 * that reset is what the modal was for as much as the presentation was.
 *
 * The client moved this grid onto the style row's own panel (2026-08-29), where
 * `MasterFullScreen` mounts it directly and there is no cell and no scope to
 * escape. **So the constraint did not have to be worked around; it stopped
 * applying.** Verified rather than assumed: `master-full-screen.tsx` declares no
 * `RequiredScope` at all.
 *
 * WHAT WENT WITH IT, so nobody looks for it: `size="md"` and the long argument
 * for why `sm` was wrong; `alignToPane`; `zIndexBase`; the `origin` rect that
 * grew the box out of the button; and `SubSheetFooter`, which existed to explain
 * why a sheet had no Save of its own. All of it was scaffolding for opening in a
 * box. **The `sm`-versus-`md` reasoning is still worth knowing** — a surface is
 * sized by what is ON it, not by how it is opened — and it now lives at the
 * point that decides this grid's width, on `width` below.
 *
 * `Sheet`'s `origin` prop was written for this call site and now has no caller.
 * Left in place, and noted there: it is unused, not broken.
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
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { ChildGrid, type ChildGridColumn } from "@/components/masters/child-grid";
import { RecordPicker } from "@/components/masters/record-picker";
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

/* `StyleProcessHeader` STOOD HERE and was removed with the six read-only fields
   it typed (client 2026-08-28). It was the style line's identity, RESOLVED BY
   THE PARENT rather than looked up here — and on the style row's own panel the
   question it answered ("which line is this?") cannot arise at all: the grid is
   inside the row it belongs to. Nothing here has to be unwired to keep it gone. */

export function StyleProcessGrid({
  rows,
  onChange,
  processes,
  components,
  newKey,
  readOnly = false,
}: {
  rows: StyleProcessRow[];
  onChange: (next: StyleProcessRow[]) => void;
  /** The whole master list, unfiltered — the narrowing is this file's job. */
  processes: ProcessOption[];
  /**
   * THIS STYLE'S OWN PARTS, already narrowed by the parent (0421).
   *
   * Scoped there rather than here, per the cascading-picker rule: the screen is
   * what knows which style this line names and which components it declares. A
   * grid handed the whole components master would offer a collar on a style
   * that has none — and `garment_style_components` is the only thing that knows
   * it does not.
   */
  components: ComponentOption[];
  /**
   * The PARENT's key generator, passed in rather than grown here.
   *
   * These rows live in the parent's state and are re-keyed there when an
   * amendment is loaded from the database, so a counter local to this file
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
         picker covers the rare longer one.

         AND IT IS NOW WHAT MAKES THE SHEET'S OWN WIDTH DERIVABLE. 12+16+12+20rem
         plus ~80px of `#`/remove chrome is ~1040px, which is the number `size`
         above is chosen against. A column that declares no width contributes an
         unknown, and the surface can then only be sized by eye — which is how
         `sm` was picked in the first place. */
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
      /**
       * The widest of the four because it is the only free-text cell — artwork
       * and design notes — but bounded like the rest, or it takes the whole
       * remainder on its own.
       *
       * ## THESE FOUR WIDTHS WERE 7 / 8 / 7 / none FOR ONE EVENING
       *
       * They were cut on 2026-08-29 to fit this grid into a ~512px pane on the
       * style row, when the client asked for it inline as a fourth section, and
       * restored when they asked for the [Click] button back and the pane
       * removed. The originals are what the sheet is sized against, so the two
       * belong together — see `size` there.
       *
       * WHAT THE ROUND TRIP SETTLED, if this is ever re-budgeted: `hugsContent`
       * is `columns.every(c => c.width)`, so leaving ONE column unsized is not a
       * small omission — it flips the grid from hugging its declarations to
       * filling its container, and hands this cell the remainder. That is the
       * right shape for a narrow pane and the wrong one for a modal chosen to
       * fit ~1040px of declared width.
       */
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

  /*
   * NO SURFACE OF ITS OWN — this returns the grid and nothing else.
   *
   * It renders as the fourth pane of the style row's panel, under Coordinate,
   * Sizes and Components (client 2026-08-29). Those three are per-style lists
   * shown inline; this was the only one hidden behind a button, and nothing
   * about it justified the exception.
   *
   * ## IT RENDERS IN ONE PLACE: INSIDE `StyleProcessSheet`
   *
   * For one evening on 2026-08-29 it also rendered inline, as a fourth pane of
   * the style row's panel, and the client removed that again the same night
   * after asking for the [Click] button back. The extraction is what survives —
   * this file holds the grid and the sheet is a thin wrapper around it, which is
   * why restoring the button cost ~120 lines rather than the 430 this file used
   * to be, and why putting the pane back would cost about fifteen.
   *
   * NO SURFACE OF ITS OWN, and that is the point of the split: this component
   * decides columns and nothing about where it sits. A caller supplies the box.
      */
  return (
    <ChildGrid<StyleProcessRow>
      columns={columns}
      rows={rows}
      /* OPENS ON A ROW rather than on a bare button — the keyboard contract,
         not a preference: Tab lands on FIELDS, so a grid whose only affordance
         is "+ Add" has nothing to tab into and nothing to stand on and press
         Enter. The Components grid beside it passes this for the same reason. */
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
  );
}
