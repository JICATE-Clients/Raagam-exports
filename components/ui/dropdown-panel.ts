import type { CSSProperties } from "react";

/**
 * How wide a picker's dropdown panel is.
 *
 * ## The list is sized by its OPTIONS, not by the field
 *
 * Both dropdowns used to take the trigger's width — `data-picker.tsx` with a
 * 260px floor, `combobox.tsx` with none at all — and that is the wrong question
 * asked confidently. A field's width is chosen for the value once CHOSEN, and
 * plenty of them are deliberately narrow: Ship Type on Order Entry's Logistic
 * tab is `xs`, two of twelve columns. The list has to show the values the
 * operator is choosing BETWEEN, which is a different and always longer job.
 *
 * At 260px minus padding and the pencil / trash slots, every Incoterm past the
 * twelfth character was cut — `CARRIAGE & INSURANC…` beside
 * `COST, INSURANCE & FR…`, two rows that differ only in the part that had been
 * removed. The list asked for a decision it had clipped the grounds for
 * (client 2026-08-21, screenshot 2437).
 *
 * ## Three numbers, and each is a different promise
 *
 * - **`width: max-content`** reads the longest row actually in the list, so a
 *   list of Incoterms and a list of customer names each get what they need
 *   without anyone maintaining a per-kind width.
 * - **The floor** is the field's own width, never below `PANEL_MIN`. Nothing
 *   gets narrower than it is today, and a panel narrower than the box it hangs
 *   off reads as a rendering fault.
 * - **The ceiling** is the room to the right of the field, capped at
 *   `MAX_LIST_W`. Past that a genuinely long value clips again — and that is
 *   fine, because a row renders through `<Truncated>` and reveals itself on
 *   hover (AGENTS.md, "Truncated values"). Growing without a cap is how a
 *   picker over free text ends up 900px wide and off the screen.
 *
 * ONE declaration, both readers. The numbers lived in `data-picker.tsx` for an
 * afternoon and `combobox.tsx` had its own (absent) opinion; two panels with two
 * widths is the drift this file exists to prevent — the same lesson
 * `created-columns.tsx` records for a table's last two columns.
 *
 * NOT for the Add / Modify FORM `data-picker.tsx` opens in the same portal. Its
 * fields are `w-full`, so `max-content` would hand the form its inputs'
 * intrinsic width and the box would breathe as the operator types. That branch
 * asks for `mode: "form"` and gets a fixed width.
 */

/** Never narrower than the field, and never below this. */
export const PANEL_MIN = 260;

/** How wide a LIST may grow to fit its longest option. See above for why capped. */
export const MAX_LIST_W = 560;

/** Measured off the trigger. `vw` travels with it so the ceiling is not read during render. */
export type PanelAnchor = { top: number; left: number; width: number; vw: number };

export function dropdownPanelStyle(
  anchor: PanelAnchor,
  mode: "list" | "form" = "list",
): CSSProperties {
  const min = Math.max(anchor.width, PANEL_MIN);
  const base: CSSProperties = {
    position: "fixed",
    top: anchor.top,
    left: anchor.left,
    zIndex: 150,
  };
  if (mode === "form") return { ...base, width: min };
  return {
    ...base,
    width: "max-content",
    minWidth: min,
    // `Math.max` and not just `Math.min`: a field close to the right edge has
    // less room than the floor, and a ceiling below the floor would be a panel
    // that overflows anyway AND has stopped growing. Keep today's behaviour
    // there rather than inventing a reflow.
    maxWidth: Math.max(min, Math.min(MAX_LIST_W, anchor.vw - anchor.left - 8)),
  };
}
