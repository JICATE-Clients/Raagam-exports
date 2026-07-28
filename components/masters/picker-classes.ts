/**
 * The shared look of a picker's closed state — the button a user clicks to open
 * a dialog, and the little ✕ that clears it.
 *
 * These were copy-pasted verbatim into 15 picker components (and the clear
 * button into 9 of them). That was harmless while the string never changed, and
 * became the blocker the moment it had to: the compact density pass needed one
 * height change to reach every picker field, and instead needed fifteen. Pickers
 * are the single most common field type on a master form — `doc/ui/LAYOUT.md`
 * makes `md` (a picker) the DEFAULT field size — so a density scale that skipped
 * them would have missed most of the form.
 *
 * `@2xl/editor:h-8` is the compact height. It keys off the `@container/editor`
 * declared on the editor content wrapper in `components/ui/sheet.tsx` and
 * `components/masters/master-full-screen.tsx`. Because it is a CONTAINER query,
 * a picker rendered inside a ~440px nested picker dialog — or on a phone — never
 * matches it and keeps the full 36px touch target. That fallback is the whole
 * reason this is not a `md:` breakpoint.
 *
 * Static strings, never interpolated: Tailwind v4 scans source text, so a
 * computed class name produces no CSS at all.
 *
 * Compose extras with `cn()` rather than editing these — see `lookup-picker.tsx`
 * (adds `text-foreground`) and `ac-head-picker.tsx` (adds `disabled:` states).
 */

/** The picker's closed-state trigger button. Height must match `Input`. */
export const PICKER_TRIGGER_CLASS =
  "flex h-9 @2xl/editor:h-8 w-full items-center justify-between rounded-md border border-border bg-surface px-3 text-left text-base md:text-sm hover:border-primary";

/** The ✕ beside a filled picker. Height tracks the trigger so they stay flush. */
export const PICKER_CLEAR_CLASS =
  "flex h-9 @2xl/editor:h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border text-muted-foreground hover:text-danger";
