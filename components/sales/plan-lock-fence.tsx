"use client";

import type { ReactNode, SyntheticEvent } from "react";

/**
 * A LOCKED SAMPLE PLAN TAKES NO EDIT AT ALL (user 2026-10-13: "without raising
 * revision I can edit the fabric plan … totally it should not allow to edit").
 *
 * `MasterFullScreen`'s `locked` makes the PRIMITIVES read-only through
 * `LockScope`, and its own note says what that leaves: a plain button inside a
 * section ("+ Add", a row's ✕, a [Detail] opener) and a hand-rolled control are
 * not `LockScope` readers. The Fabric and Accessories Plans are mostly that —
 * sample-by-sample grids, dia/colour popups, breakup rows — so an approved plan
 * still took typing, and only the missing Save (and the database, 0718 / 0720)
 * stopped it reaching anything. A lock that lets the operator type and then
 * throws the typing away is not a lock.
 *
 * ONE GUARD AT THE BOUNDARY, in the CAPTURE phase, so it runs before any
 * control's own handler: every click, press, keystroke, paste, cut and drop on
 * an interactive element inside a locked plan is stopped — the custom grids,
 * "+ Add", a row's ✕, a popup's opener, a picker's list, `Ctrl+Del`. One rule
 * rather than a `readOnly` threaded through each grid, the per-component patch
 * that always leaves a remainder (AGENTS.md).
 *
 * NOT a disabled `<fieldset>`, which was tried first: it froze the controls
 * that only CHANGE WHAT IS SHOWN as well, so the second sample of an SWO could
 * not even be looked at. Those are let through by marker — `data-lock-allow`
 * on a view control (the sample switcher), and a fold's own
 * `data-row-open` + `aria-expanded` pair. Tab and Escape always pass, so the operator can still move
 * through the plan and leave it.
 *
 * Off when `locked` is false: the wrapper stays (so nothing remounts when a
 * plan is submitted) and every handler stands down.
 */
const INTERACTIVE = "button, input, select, textarea, [role='button'], [role='combobox'], [role='option'], [role='checkbox'], [role='switch'], [contenteditable='true'], label";
// `data-row-open` ALONE IS NOT A VIEW CONTROL: the plan's popup openers carry
// it (Colours & Dias, Yarn Dyed, Shades) and so does "+ Dia", an edit. Only a
// FOLD carries `aria-expanded` with it (process-fold-list), so that pair is
// what passes — letting the marker alone through opened an editable popup.
const ALLOWED = "[data-lock-allow], [data-row-open][aria-expanded]";
const PASS_KEYS = new Set(["Tab", "Escape", "Shift", "Control", "Alt", "Meta"]);

export function PlanLockFence({ locked, children }: { locked: boolean; children: ReactNode }) {
  const stop = (e: SyntheticEvent) => {
    if (!locked) return;
    const t = e.target as Element | null;
    if (!t || !t.closest || t.closest(ALLOWED)) return;
    if (!t.closest(INTERACTIVE)) return;
    e.preventDefault();
    e.stopPropagation();
  };
  const stopKey = (e: React.KeyboardEvent) => {
    if (!locked || PASS_KEYS.has(e.key)) return;
    stop(e);
  };
  const stopAll = (e: SyntheticEvent) => {
    if (!locked) return;
    e.preventDefault();
    e.stopPropagation();
  };
  return (
    <div
      aria-readonly={locked || undefined}
      /* LOOKS LOCKED as well as being locked: a white box with a caret in it
         reads as "type here", which is how the operator found the hole. */
      className={
        locked
          ? "[&_button:not([data-lock-allow]):not([aria-expanded])]:cursor-not-allowed [&_input]:cursor-not-allowed [&_input]:bg-surface-muted [&_input]:text-muted-foreground [&_select]:bg-surface-muted [&_textarea]:bg-surface-muted"
          : undefined
      }
      onPointerDownCapture={stop}
      onMouseDownCapture={stop}
      onClickCapture={stop}
      onKeyDownCapture={stopKey}
      onBeforeInputCapture={stopAll}
      onPasteCapture={stopAll}
      onCutCapture={stopAll}
      onDropCapture={stopAll}
    >
      {children}
    </div>
  );
}
