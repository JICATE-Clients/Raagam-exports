"use client";

// Non-blocking "Did you mean <X>?" hint shown under a Name field. Renders up to a
// few predicted words as tappable chips — clicking one applies that full corrected
// name; ignoring them does nothing. Sits in the same slot the red duplicate error
// uses, so screens render at most one line under the input at a time.

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
