"use client";

// Non-blocking "Did you mean <X>?" hint shown under a Name field. Renders up to
// a few known names as tappable chips — clicking one applies that name;
// ignoring them does nothing and the typed text saves as typed. Sits in the same
// slot the red duplicate error uses, so screens render at most one line under
// the input at a time.

export function SpellSuggestHint({
  suggestions,
  onApply,
}: {
  suggestions: string[];
  onApply: (value: string) => void;
}) {
  if (suggestions.length === 0) return null;
  return (
    <p className="mt-1 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
      Did you mean
      {suggestions.map((s) => (
        <button
          key={s}
          type="button"
          // Tab only MOVES between fields (see the raagam-keyboard-contract
          // skill). These chips appear and disappear as the user types, so
          // leaving them in the tab order would grow and shrink the tab order
          // mid-keystroke — Tab from Name would land somewhere different
          // depending on whether a suggestion happened to be showing. Pointer
          // only; a keyboard user just finishes typing the name.
          tabIndex={-1}
          onClick={() => onApply(s)}
          className="rounded border border-border px-1.5 py-0.5 font-medium text-primary hover:bg-primary/10"
        >
          {s}
        </button>
      ))}
      ?
    </p>
  );
}
