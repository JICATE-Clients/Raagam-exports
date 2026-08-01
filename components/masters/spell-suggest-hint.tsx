"use client";

// Non-blocking "Did you mean <X>?" hint shown under a Name field. Renders up to
// a few known names as chips — choosing one applies that name; ignoring them
// does nothing and the typed text saves as typed. Sits in the same slot the red
// duplicate error uses, so screens render at most one line under the input at a
// time.
//
// Two ways in, because these operators are keyboard-only and a mouse-only
// affordance is one they cannot use:
//   • pointer — click a chip
//   • keyboard — ↓ into the strip, ↑ back out, Enter to apply, Esc to dismiss
// The keys live on the INPUT (useSpellSuggest's `onKeyDown`), not here; this
// component only has to show which chip that keyboard position is on.

import { cn } from "@/lib/utils";

export function SpellSuggestHint({
  suggestions,
  activeIndex = -1,
  onApply,
}: {
  suggestions: string[];
  /** Which chip the keyboard is on, or -1 for none. */
  activeIndex?: number;
  onApply: (value: string) => void;
}) {
  if (suggestions.length === 0) return null;
  return (
    // `role="listbox"` / `role="option"` because that is what this behaves as:
    // the input drives a highlight through it with the arrow keys. A bare
    // <button> does not support aria-selected, so without the roles the
    // highlight would be colour only — invisible to a screen reader.
    <p className="mt-1 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
      Did you mean
      <span role="listbox" aria-label="Name suggestions" className="flex flex-wrap items-center gap-1">
      {suggestions.map((s, i) => (
        <button
          key={s}
          type="button"
          role="option"
          // Tab only MOVES between fields (see the raagam-keyboard-contract
          // skill). These chips appear and disappear as the user types, so
          // leaving them in the tab order would grow and shrink the tab order
          // mid-keystroke — Tab from Name would land somewhere different
          // depending on whether a suggestion happened to be showing. The
          // keyboard reaches them with ↓, which is the contract's gesture for
          // "open this field's list"; Tab is not it.
          tabIndex={-1}
          // The strip behaves as a listbox the input drives, so the highlight is
          // announced rather than being colour alone.
          aria-selected={i === activeIndex}
          onClick={() => onApply(s)}
          className={cn(
            "rounded border px-1.5 py-0.5 font-medium",
            i === activeIndex
              ? "border-primary bg-primary/10 text-primary ring-1 ring-primary"
              : "border-border text-primary hover:bg-primary/10",
          )}
        >
          {s}
        </button>
      ))}
      </span>
      ?
      {/* Only worth saying once the operator is actually in the strip. */}
      {activeIndex >= 0 && (
        <span className="ml-1 text-[11px] text-muted-foreground/70">Enter to apply · Esc to dismiss</span>
      )}
    </p>
  );
}
