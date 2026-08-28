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
import { Sheet, type SheetOrigin } from "@/components/ui/sheet";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
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

/* `StyleProcessHeader` STOOD HERE and was removed with the six read-only fields
   it typed (client 2026-08-28) — see the note at the top of the sheet body,
   which is where the deletion is explained. It was the style line's identity,
   RESOLVED BY THE PARENT rather than looked up here, so nothing about this file
   knew how to rebuild it and nothing here has to be unwired to keep it gone. */

export function StyleProcessSheet({
  open,
  onClose,
  styleLabel,
  rows,
  onChange,
  processes,
  components,
  newKey,
  readOnly = false,
  origin,
}: {
  open: boolean;
  onClose: () => void;
  /** The style this list belongs to, for the sheet title. */
  styleLabel: string;
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
  /**
   * THE PROCESS CELL THIS SHEET WAS OPENED FROM — so it grows out of that row's
   * button instead of out of nowhere (client 2026-08-28).
   *
   * This is the first call site of `Sheet`'s `origin`, and it is the one that
   * motivated the prop: the client asked whether this dialog could JOIN its
   * trigger the way an active rail row joins the pane beside it. It cannot —
   * another plane, it covers its own trigger, and a centred box is
   * position-independent — and `sheet.tsx`'s `origin` note carries all three
   * reasons in full. The motion is what stands in for the join.
   *
   * A RECT, MEASURED IN THE CLICK HANDLER, NOT A REF. The trigger is a `<Button>`
   * in a `ChildGrid` cell on the style row, and that row re-renders as the
   * operator types; on a set-pack order the column set changes shape underneath
   * it. A ref could resolve to `null` exactly when the sheet is opening, which
   * would silently fall back to a centre origin — the failure would be invisible
   * rather than loud. The parent captures the rect at the moment of the click.
   *
   * Optional: with nothing passed the sheet scales from its own centre, which is
   * what it did before this existed.
   */
  origin?: SheetOrigin | null;
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
       * "md" — A CONTAINED BOX, AFTER BEING FULL-SCREEN AND AFTER `sm` FAILED.
       *
       * Client 2026-08-28: "restricts Style Process views to clean, smaller
       * containerized modals to prevent full-screen context loss". So this is
       * back inside a container on the scrim, with the amendment visible around
       * it, instead of a `fixed inset-0` page covering the app chrome.
       *
       * ## THIS IS NOT A RETURN TO THE 08-12 STATE, AND THE NUMBER IS WHY
       *
       * `sm` was tried for exactly this and was wrong (client 2026-08-12,
       * screenshot 2266): sheet.tsx's category for it — "nested pickers / small
       * config dialogs" — fitted the ARGUMENT but not the CONTENT. `max-w-md`
       * is 448px, less the branch's `px-5` leaves ~408px, and `ChildGrid`'s
       * responsive table only appears from `@lg`, **which is 512px of container
       * and not the 1024 the name suggests** (`tableFrom` in child-grid.tsx
       * documents that trap at length). The grid fell to stacked cards, which
       * drops the column headers — Type, Process and Details rendered as three
       * unlabelled boxes and the empty Details box read as a stray extra field
       * nobody had asked for. It missed by ~104px, which is exactly why it
       * looked like it should have worked.
       *
       * `md` is the same contained DOM at `max-w-6xl`: ~1112px of content
       * against the ~1040px this grid's four declared widths and the `#`/remove
       * chrome need before a table would scroll sideways. The table stays a
       * table, and the box still leaves the screen behind it visible.
       *
       * The lesson from 08-12 survives intact and is worth restating, because
       * "smaller" is the word that will tempt the next reader back to `sm`: a
       * surface's size is a function of what is ON it, not of how it is opened
       * or of how small it is described. Sizing this by the opener — a grid
       * cell, therefore small — is what produced a control that degraded into
       * something unreadable.
       *
       * ## `fullBleed` IS GONE, AND WHAT IT BOUGHT IS KEPT
       *
       * It was added on 2026-08-20 ("make full width screen") to drop the
       * 1180px reading cap, and the cap does not exist on this branch at all —
       * there is nothing left for the prop to remove, so passing it would be
       * inert and misleading rather than merely redundant. It is the one of the
       * three sub-sheets whose client instruction has moved on; Structure
       * Details and Assortments were not part of this ask and keep theirs.
       *
       * **What 08-20 actually cost is NOT being reverted with it.** Declaring a
       * width on all four grid columns stays exactly as it is — see its own note
       * below. That change made the sheet size itself from its data instead of
       * from its container, which is what lets it move between containers at
       * all.
       *
       * The other half of 08-20's cost was moving the six read-only header
       * fields off `FieldGrid` spans onto `FieldRow` content widths, and THOSE
       * FIELDS ARE GONE (client 2026-08-28) — the note where they stood carries
       * the reason. That deletion does not reopen this: `size` is chosen against
       * the GRID's ~1040px, which the header never exceeded, so nothing about
       * the number below changes. It is only the second worked example that has
       * gone with the fields it described.
       */
      size="md"
      /* CENTRED OVER THE CONTENT PANE, NOT THE VIEWPORT (client 2026-08-28:
         "just move it near to the style — now it looks unaligned; the centre
         modal stays"). The rail takes 192px off the left, so a viewport-centred
         box sits ~37px left of where the content starts and crosses the
         rail/content divider. This moves the centring box and nothing else —
         see `alignToPane`. It is NOT the withdrawn rail join. */
      alignToPane
      /* Grows out of the Process cell that opened it — see the `origin` prop. */
      origin={origin}
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
        * THE SIX READ-ONLY HEADER FIELDS ARE GONE (client 2026-08-28: "Process —
        * Style ref to PO qty, remove the section, no need this field, remove it
        * from the process tab header also").
        *
        * What stood here, and what it was for: Style Ref No · Article No · Style
        * No · Style Description · Order Unit · PO Qty, read-only, in a bordered
        * band above the grid — the block the legacy screen puts above its own
        * Process Details grid (client screenshot 2026-08-12). The argument for
        * them was that this sheet is opened from ONE row of a grid that may hold
        * several style lines, so something had to say which line these processes
        * belong to.
        *
        * THE CLIENT HAS WITHDRAWN THAT, AND THE REASON IS THEIR INSTRUCTION —
        * nothing structural replaces the fields. Do not restore them on the
        * reasoning above, and do not restore them on the reasoning that the sheet
        * no longer covers the grid: it still does. This is `size="md"` on a
        * scrim, the same contained modal as before (client 2026-08-28: "that
        * previous centred screen is good, I need that"), so the six were removed
        * because they were not wanted, full stop.
        *
        * THE WIDTH DECISIONS ABOVE ARE UNAFFECTED. `size="md"` is chosen against
        * the GRID — 12+16+12+20rem of declared column widths plus ~80px of
        * `#`/remove chrome, ~1040px against ~1112px of content — and the header
        * was always the narrower of the two things on the sheet (~1030px). So
        * removing it takes nothing off what the sheet has to fit, and the grid
        * still clears `ChildGrid`'s 512px container threshold by ~600px and
        * renders as a table rather than stacked cards. `size` must NOT be
        * narrowed to follow this deletion: `sm` was tried and failed for exactly
        * that reason (see its note above).
        *
        * `StyleProcessHeader` and the `header` prop went with them, so the screen
        * no longer resolves `unitTextOf` for this sheet. Every fact the six
        * carried is still on the style row behind the scrim and still in
        * `StyleRow` — nothing was dropped from state, only from display.
        */}
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
