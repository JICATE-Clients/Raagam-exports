/**
 * Shared focus helpers. The key-handling ones are driven from ONE place —
 * components/shell/keyboard-nav-provider.tsx — so every surface in the app gets
 * the same contract without per-screen wiring. Sheet/MasterFullScreen still use
 * the focus-trap and autofocus helpers directly, because those are overlay
 * concerns rather than field navigation.
 */

/**
 * The slice of a keyboard event the navigation helpers actually read. Both a
 * React SyntheticEvent and a native KeyboardEvent satisfy it, so the same
 * functions serve a JSX `onKeyDown` and the global document listener.
 */
export type NavKeyEvent = {
  key: string;
  defaultPrevented: boolean;
  target: EventTarget | null;
  preventDefault(): void;
};

/**
 * NOTE the `:not([tabindex="-1"])` on every branch. The trailing
 * `[tabindex]:not([tabindex="-1"])` clause is a *separate* comma-branch, so it
 * only governs generic elements — without the per-branch guard,
 * `input:not([disabled])` still matched `<input tabindex="-1">` and every
 * skipTab / auto-generated field stayed an Enter-advance stop and a focus-trap
 * boundary. Native Tab skipped them; nothing else did.
 */
export const FOCUSABLE_SELECTOR =
  'a[href]:not([tabindex="-1"]), button:not([disabled]):not([tabindex="-1"]), input:not([disabled]):not([tabindex="-1"]), select:not([disabled]):not([tabindex="-1"]), textarea:not([disabled]):not([tabindex="-1"]), [tabindex]:not([tabindex="-1"])';

/** Visible focusable elements inside `root`, in DOM order. */
export function focusablesIn(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (el) => el.offsetParent !== null,
  );
}

/**
 * Focusables ordered by *region* rather than DOM order: data fields first, then
 * the footer's Save/Cancel, then the header's close/actions last.
 *
 * An editor surface renders header → content → footer, so in raw DOM order the
 * header ✕ is `items[0]` — it became the first Tab stop and the wrap target of
 * the focus trap, so Tab hit "close" in the middle of data entry (client
 * 2026-07-24 #5). Reordering keeps ✕ reachable by keyboard (unlike
 * `tabindex="-1"`, which would strand keyboard-only users) while moving it out
 * of the typing path. Surfaces opt in by stamping `data-focus-region` on their
 * wrappers; anything unstamped sorts with the content.
 */
const REGION_ORDER: Record<string, number> = { content: 0, footer: 1, header: 2 };

/** Which region an element sits in; unmarked surfaces are all "content". */
export function regionOf(el: HTMLElement): string {
  return el.closest<HTMLElement>("[data-focus-region]")?.dataset.focusRegion ?? "content";
}

export function orderedFocusables(root: HTMLElement): HTMLElement[] {
  const items = focusablesIn(root);
  const rank = (el: HTMLElement) => REGION_ORDER[regionOf(el)] ?? 0;
  // Stable sort keeps DOM order within each region.
  return items
    .map((el, i) => ({ el, i, r: rank(el) }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map((x) => x.el);
}

/**
 * Legacy ERP "Enter moves forward" (client 2026-07-23 #7): Enter in a field
 * advances focus to the next focusable control. Textareas and real buttons
 * (Save / Cancel / + Add) keep their native Enter, and handlers that already
 * consumed the key (preventDefault) are left alone. `root` is the boundary the
 * advance walks.
 *
 * `[data-field-trigger]` — a dialog-picker trigger. It is a <button> for
 * accessibility, but to the operator it IS a field, sitting in a row of inputs
 * and styled identically. Without this, Enter fell through to the button's
 * native activation and OPENED the picker, so Enter meant "next field" on a
 * text box and "open a dialog" on the picker beside it — roughly every other
 * field on a masters form (client 2026-07-25). Enter now advances everywhere;
 * Space and click still open the picker.
 */
const FIELD_TRIGGER = "[data-field-trigger]";

export function enterAdvance(e: NavKeyEvent, root: HTMLElement | null) {
  if (e.key !== "Enter" || e.defaultPrevented) return;
  const t = e.target;
  const isTrigger = t instanceof HTMLElement && t.matches(FIELD_TRIGGER);
  if (!(t instanceof HTMLInputElement || t instanceof HTMLSelectElement || isTrigger)) return;
  if (t instanceof HTMLInputElement && /^(button|submit|reset)$/.test(t.type)) return;
  // Don't advance out of a field that's currently invalid (client 2026-07-24):
  // keep the user on it until the validation message clears. Fields flag this
  // via aria-invalid — ValidatedInput sets it on error, and any field with a
  // live error (e.g. a duplicate-name check) can set it too.
  if (t.getAttribute("aria-invalid") === "true") {
    e.preventDefault();
    return;
  }
  if (!root) return;
  // Confined to the region the cursor is already in. Enter used to walk out of
  // the last data field and land on the footer's FIRST button — which is
  // Cancel, not Save — so a second Enter discarded the whole form without a
  // confirmation (client 2026-07-25). Enter now stops at the end of the fields;
  // Ctrl+S or Tab still reaches the footer.
  const region = regionOf(t as HTMLElement);
  const items = orderedFocusables(root).filter((el) => regionOf(el) === region);
  const idx = items.indexOf(t);
  e.preventDefault();
  if (idx !== -1) {
    items[idx + 1]?.focus();
    return;
  }
  // The field is itself skipped (tabindex="-1", e.g. an auto-generated Name the
  // user clicked into) so it has no index. Advance to the first control that
  // follows it in the document instead of doing nothing.
  const after = items.find(
    (el) => t.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING,
  );
  after?.focus();
}

/**
 * ↓/↑ on a dialog-picker trigger OPENS its list — the same thing ↓ does on a
 * Combobox, so every "choose a stored value" field answers the arrow key.
 *
 * Without this, Count (a `<Select>`, so really a Combobox `<input>`) opened on
 * ↓ while Category (a picker `<button>`) sat dead beside it in the same row.
 * Marking triggers as fields fixed Enter and fixed grid arrows, but a plain
 * form has no arrow handling at all — arrows there are purely native, and a
 * native button ignores them (client 2026-07-25).
 *
 * Inside a child grid the arrows keep meaning "previous / next row" — that is
 * `gridKeyNav`'s contract and it runs first — so this only fires on form
 * fields. Returns true when it consumed the key.
 */
export function arrowOpensPicker(e: NavKeyEvent): boolean {
  if (e.defaultPrevented) return false;
  if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return false;
  const t = e.target;
  if (!(t instanceof HTMLElement) || !t.matches(FIELD_TRIGGER)) return false;
  if (t.closest("[data-grid-row]")) return false;
  e.preventDefault();
  t.click(); // the trigger's existing onClick opens the dialog
  return true;
}

/**
 * Controls that own ↑/↓ themselves, so the global navigation must not steal
 * them. Everything NOT in this list navigates.
 *
 * `number` is deliberately absent: arrows natively spin a number input, and in
 * an ERP the operator types the figure and moves on — a stray arrow silently
 * editing a quantity is a data bug, not a feature. Navigating is both more
 * consistent and safer. Flip this single predicate if that turns out wrong.
 */
function ownsArrowKeys(t: HTMLElement): boolean {
  // A child grid: ↑/↓ move a ROW, in the same column (child-grid.tsx gridKeyNav).
  if (t.closest("[data-grid-row]")) return true;
  // Caret movement across lines.
  if (t instanceof HTMLTextAreaElement) return true;
  // A native <select> (touch/SSR) changes its VALUE on arrows.
  if (t instanceof HTMLSelectElement) return true;
  // A Combobox opens / browses its own list.
  if (t.getAttribute("role") === "combobox") return true;
  // Radios have native group semantics; the rest have segment/step semantics
  // that would be surprising to lose.
  if (
    t instanceof HTMLInputElement &&
    /^(radio|range|date|time|datetime-local|month|week)$/.test(t.type)
  ) {
    return true;
  }
  return false;
}

/**
 * Is the caret already at the edge of `el`, so a ←/→ may leave the field?
 *
 * ←/→ natively move the CARET, so hijacking them unconditionally would break
 * ordinary typing. The rule is the spreadsheet one: move on only when there is
 * nowhere left to go inside the field.
 *
 * `selectionStart` is only defined for text/search/url/tel/password — it is
 * null (or throws) on number, email, date and time. That is not an edge case
 * here: the app has ~253 `type="number"` and ~150 `type="date"` inputs. For a
 * NUMBER, "caret unreadable" is treated as at-the-edge, because arrowing within
 * a number is worth little and walking fields is what an operator wants. DATE
 * never reaches this function — `ownsArrowKeys` keeps it, since ←/→ there move
 * between day/month/year segments.
 *
 * A non-collapsed selection returns false: let the arrow collapse it first.
 */
export function atCaretEdge(el: HTMLElement, dir: "prev" | "next"): boolean {
  if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) {
    return true; // buttons, pickers, anything with no text to traverse
  }
  let start: number | null;
  let end: number | null;
  try {
    start = el.selectionStart;
    end = el.selectionEnd;
  } catch {
    return true; // number/email — caret not addressable, so treat as the edge
  }
  if (start === null || end === null) return true;
  if (start !== end) return false;
  return dir === "prev" ? start === 0 : start === el.value.length;
}

/**
 * THE GLOBAL ARROW CONTRACT: ↓ moves to the next field, ↑ to the previous —
 * everywhere, on every control that does not own arrows itself.
 *
 * The app had no form-level arrow handling at all: arrows worked only where an
 * individual control happened to implement them, so a dropdown responded, a
 * picker did nothing, a text box did nothing, and a number box silently changed
 * its value. That is why "arrow keys don't work here" kept being reported field
 * by field (client 2026-07-25) — there was nothing to fix centrally, so each
 * report produced another patch.
 *
 * Order is SEQUENTIAL (the same order Tab and Enter use), not spatial. With
 * `DetailSection cols={12}` and mixed field widths, "the field visually below"
 * is ambiguous and expensive to get right; "the next field" is predictable and
 * already the order the operator learned from Tab.
 *
 * Confined to the focused element's region, so ↓ cannot walk out of the fields
 * into Cancel/Save. Returns true when it consumed the key.
 */
export function arrowNavigate(e: NavKeyEvent, root: HTMLElement | null): boolean {
  if (e.defaultPrevented) return false;
  const vertical = e.key === "ArrowDown" || e.key === "ArrowUp";
  const horizontal = e.key === "ArrowLeft" || e.key === "ArrowRight";
  if (!vertical && !horizontal) return false;
  const t = e.target;
  if (!(t instanceof HTMLElement) || ownsArrowKeys(t)) return false;
  if (!root) return false;

  // ←/→ only leave the field once the caret has nowhere left to go, so typing
  // and in-place corrections still work. ↑/↓ have no such conflict.
  const forward = e.key === "ArrowDown" || e.key === "ArrowRight";
  if (horizontal && !atCaretEdge(t, forward ? "next" : "prev")) return false;

  const region = regionOf(t);
  const items = orderedFocusables(root).filter((el) => regionOf(el) === region);
  const idx = items.indexOf(t);
  if (idx === -1) return false;
  const next = items[forward ? idx + 1 : idx - 1];
  if (!next) return false;

  e.preventDefault();
  next.focus();
  if (next instanceof HTMLInputElement || next instanceof HTMLTextAreaElement) {
    const len = next.value.length;
    try {
      next.setSelectionRange(len, len);
    } catch {
      /* number/email inputs reject selection ranges */
    }
  }
  return true;
}

/**
 * Focus the first "real" field inside `root` — the first text-like input,
 * select, or textarea, skipping buttons (Cancel/Save/close/icon-buttons) so an
 * editor opens with the cursor in its first data field, not on a button.
 * Returns true if something was focused.
 *
 * If there is no text-like field at all, fall back to the first focusable in
 * REGION order (content before footer before header). Without the fallback this
 * returned false and focus stayed wherever it was — outside the dialog — for
 * any overlay whose first control is a checkbox, a picker button, or a
 * confirm/cancel pair. That is the "the dialog opened but the keyboard does
 * nothing" symptom (client 2026-07-25). Region order matters here: the plain
 * DOM-first focusable would be the header's ✕.
 */
export function focusFirstField(root: HTMLElement | null): boolean {
  if (!root) return false;
  const items = focusablesIn(root);
  const field =
    items.find(
      (el) =>
        (el instanceof HTMLInputElement &&
          !/^(button|submit|reset|checkbox|radio|hidden)$/.test(el.type)) ||
        el instanceof HTMLSelectElement ||
        el instanceof HTMLTextAreaElement,
    ) ?? orderedFocusables(root)[0];
  if (field) {
    field.focus();
    // Put the caret at the end of any existing text for edit forms.
    if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) {
      const len = field.value.length;
      try {
        field.setSelectionRange(len, len);
      } catch {
        /* number/email inputs don't support selection ranges */
      }
    }
    return true;
  }
  return false;
}
