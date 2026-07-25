/**
 * Shared focus helpers for the editor surfaces (Sheet, MasterFullScreen).
 * Extracted from components/ui/sheet.tsx so the full-screen editor can reuse
 * the exact same focus-trap / Enter-advance / autofocus-first behavior.
 */

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

export function orderedFocusables(root: HTMLElement): HTMLElement[] {
  const items = focusablesIn(root);
  const rank = (el: HTMLElement) => {
    const region = el.closest<HTMLElement>("[data-focus-region]")?.dataset.focusRegion;
    return REGION_ORDER[region ?? "content"] ?? 0;
  };
  // Stable sort keeps DOM order within each region.
  return items
    .map((el, i) => ({ el, i, r: rank(el) }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map((x) => x.el);
}

/**
 * Legacy ERP "Enter moves forward" (client 2026-07-23 #7): Enter in an input or
 * select advances focus to the next focusable control. Textareas and buttons
 * keep their native Enter, and handlers that already consumed the key
 * (preventDefault) are left alone. `root` is the boundary the advance walks.
 */
export function enterAdvance(e: React.KeyboardEvent, root: HTMLElement | null) {
  if (e.key !== "Enter" || e.defaultPrevented) return;
  const t = e.target;
  if (!(t instanceof HTMLInputElement || t instanceof HTMLSelectElement)) return;
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
  // Region-ordered so Enter walks the data fields, then the footer buttons —
  // never sideways into the header's ✕.
  const items = orderedFocusables(root);
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
 * Focus the first "real" field inside `root` — the first text-like input,
 * select, or textarea, skipping buttons (Cancel/Save/close/icon-buttons) so an
 * editor opens with the cursor in its first data field, not on a button.
 * Returns true if something was focused.
 */
export function focusFirstField(root: HTMLElement | null): boolean {
  if (!root) return false;
  const items = focusablesIn(root);
  const field = items.find(
    (el) =>
      (el instanceof HTMLInputElement &&
        !/^(button|submit|reset|checkbox|radio|hidden)$/.test(el.type)) ||
      el instanceof HTMLSelectElement ||
      el instanceof HTMLTextAreaElement,
  );
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
