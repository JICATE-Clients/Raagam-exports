/**
 * Shared focus helpers for the editor surfaces (Sheet, MasterFullScreen).
 * Extracted from components/ui/sheet.tsx so the full-screen editor can reuse
 * the exact same focus-trap / Enter-advance / autofocus-first behavior.
 */

export const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Visible focusable elements inside `root`, in DOM order. */
export function focusablesIn(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (el) => el.offsetParent !== null,
  );
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
  const items = focusablesIn(root);
  const idx = items.indexOf(t);
  if (idx === -1) return;
  e.preventDefault();
  items[idx + 1]?.focus();
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
