"use client";

import { useEffect, type KeyboardEvent } from "react";
import { cycleTab, restoreFocusIfLost } from "@/lib/focus";

/**
 * Hand the cursor back to the trigger when this picker closes.
 *
 * A portal picker renders into `<body>` and unmounts on pick, and Chrome moves
 * focus to `<body>` when the focused node is removed — without firing `blur`, so
 * nothing downstream can notice. The operator chose a value and the cursor
 * vanished; the only way back to the field was the mouse (client 2026-07-28).
 *
 * Runs on the close transition, after React has removed the portal, so
 * `restoreFocusIfLost` sees the stranded `<body>` and puts the cursor on the
 * field the operator opened the list from. `Sheet` solves the same problem with
 * its own `openerRef`, which is why Sheet-based pickers never had this.
 */
export function usePickerFocusReturn(open: boolean): void {
  useEffect(() => {
    if (open) return;
    restoreFocusIfLost();
  }, [open]);
}

/**
 * The keyboard half of a MODAL picker surface, in one place.
 *
 * Every `components/masters/*-picker.tsx` used to carry its own hand-copied
 * ↑/↓/Enter block, which produced two long-lived bugs. The block was bound to the
 * SEARCH BOX, so the keys died the moment focus moved off it (onto Cancel, or
 * into the result rows); and 12 of the 14 pickers had no Escape handler at all,
 * which stopped being cosmetic when Escape gained a page-level layer — an
 * unconsumed Escape now navigates away from the whole screen.
 *
 * Bind the returned handler on the DIALOG element, not the input:
 *
 *   <div role="dialog" aria-modal="true" onKeyDown={onListKeyDown}>
 *
 * ## Its one caller today, and why the list keys are not here
 *
 * Those 14 pickers are now adapters over `components/ui/data-picker.tsx`, which
 * is the sole consumer. It uses this for FORM mode only — Add / Modify / Delete,
 * where the panel really is a modal — passing `active: false` so only the Escape
 * ladder and the Tab trap apply.
 *
 * Its LIST mode is a dropdown, not a modal, and owns its own ↑/↓/Enter/Tab: the
 * Tab branch below traps focus, which is exactly wrong for a list you must be
 * able to Tab straight past. `Combobox` sets the same precedent. Do not "unify"
 * the two by routing list mode through here — Tab would stop moving, and the
 * only case where it may is the duplicate hold below.
 *
 * ## The one thing this file must NOT try to handle
 *
 * A field showing a live "already exists" error holds the cursor (client
 * 2026-07-31). That is implemented once, in
 * components/shell/keyboard-nav-provider.tsx, on `window` in the CAPTURE phase,
 * and it stops propagation — so a held Tab never reaches React and never
 * reaches this handler. Note the Tab branch below does not read
 * `e.defaultPrevented`: that is precisely why the hold cannot rely on
 * `preventDefault` alone, and why it stops the event at the top of the path
 * instead of asking every handler in the app to start checking.
 *
 * See `.claude/skills/raagam-keyboard-contract`.
 */
export function pickerKeyDown<T>({
  items,
  keyOf,
  highlight,
  setHighlight,
  onPick,
  onClose,
  active = true,
}: {
  /** The rows currently shown, in display order. */
  items: T[];
  /** The value `onPick` receives — usually `r.id`, sometimes `r.code`. */
  keyOf: (item: T) => string;
  highlight: string | null;
  setHighlight: (key: string) => void;
  onPick: (key: string) => void;
  /**
   * Unwind ONE layer. In a picker with an inline Add/Modify form that means
   * form → list; only from the list does it close the dialog.
   */
  onClose: () => void;
  /**
   * Is the LIST the thing on screen? Several pickers swap the dialog body for an
   * Add/Modify form, and there ↑/↓/Enter belong to the form's own fields — the
   * operator is typing a record, not choosing one. Escape and the Tab trap stay
   * live in both modes, because both are about the dialog itself.
   */
  active?: boolean;
}) {
  return (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === "Escape") {
      // preventDefault is the signal every outer layer reads to stand down:
      // Sheet / MasterFullScreen keep the editor open, and the page-level
      // Escape in keyboard-nav-provider does not navigate. stopPropagation
      // alone would NOT do it — React delegates to `document`, the same node
      // those listeners use.
      e.preventDefault();
      e.stopPropagation();
      onClose();
      return;
    }

    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (!active) return;
      e.preventDefault();
      e.stopPropagation();
      if (!items.length) return;
      const idx = items.findIndex((r) => keyOf(r) === highlight);
      // Clamped, not wrapping: an operator holding ↓ should stop at the end of
      // the list rather than silently cycle back to the top.
      const next =
        e.key === "ArrowDown"
          ? items[Math.min(idx + 1, items.length - 1)]
          : items[Math.max(idx <= 0 ? 0 : idx - 1, 0)];
      setHighlight(keyOf(next));
      return;
    }

    if (e.key === "Enter") {
      if (!active) return;
      // A real button (Cancel, ✕, an inline "+ Add") keeps its native Enter.
      // This matters now the handler sits on the dialog rather than the search
      // box: without it, Enter on Cancel would pick a row instead of cancelling.
      if (e.target instanceof HTMLButtonElement) return;
      e.preventDefault();
      e.stopPropagation();
      const pick =
        highlight && items.some((r) => keyOf(r) === highlight) ? highlight : items[0] && keyOf(items[0]);
      if (pick) {
        onPick(pick);
        onClose();
      }
      return;
    }

    if (e.key === "Tab") {
      // Keep Tab inside the dialog. These pickers portal to <body>, so they are
      // outside any Sheet's focus trap; before this, Tab walked straight into
      // the form behind the scrim while the picker was still up.
      //
      // THE SHARED CYCLE, not a local copy (2026-08-04). This block used to walk
      // `orderedFocusables` itself, which meant Tab stopped on Cancel / Back /
      // ✕ here while it stepped over them on every other surface — the picker's
      // Add form is a form like any other. `cycleTab` traps just the same and
      // applies the one rule; a dialog whose only focusables are buttons (a
      // confirm) still cycles them, by its own fallback.
      //
      // It preventDefaults, so the global provider's Tab branch stands down and
      // this stays the innermost owner of the key.
      cycleTab(e, e.currentTarget);
    }
  };
}
