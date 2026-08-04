"use client";

// Non-blocking hint shown under a Name field, in two halves that mean opposite
// things:
//
//   "Did you mean [COTTON SLUB] [ORGANIC COTTON] ?"   ← FREE names. Chips.
//   "COTTON, POLYCOTTON already exist"                ← TAKEN names. Inert text.
//
// The split is the whole design. A name that is already a row cannot be saved —
// the duplicate guard checks the same scope the suggestions were drawn from — so
// offering one as a chip is offering a click that lands on "already exists".
// That was every chip this strip could produce on a screen with no vocabulary:
// typing COT under Item Class YARN offered COTTON and POLYCOTTON, both already
// there (client 2026-08-04).
//
// The taken names are still SAID, because they are the only warning a typo-TWIN
// ever gets: the duplicate guard fires on an exact match, so INTARLOCK typed
// beside an existing INTERLOCK is invisible to it, and both of those are in the
// categories table right now. They just stop pretending to be a fix — no button,
// no role="option", nothing focusable, so ↓ walks the chips and never lands on a
// name it cannot apply.
//
// Sits in the same slot as the red duplicate error. The chips now show ALONGSIDE
// that error — it is the moment a free name is most wanted, and the error even
// holds the cursor in the field (`data-dup-error`), so the chips under it are
// the way out. The grey half stands down there instead: the red line already
// says a name is taken, and naming a second, different taken name at that moment
// is noise.
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
  existing = [],
  activeIndex = -1,
  duplicate = false,
  onApply,
}: {
  /** Free names — every one of these saves. Rendered as chips. */
  suggestions: string[];
  /** Names that are already rows. Rendered as inert text, never as chips. */
  existing?: string[];
  /** Which chip the keyboard is on, or -1 for none. */
  activeIndex?: number;
  /** True while the red duplicate error is showing, which suppresses the
   *  taken-names half only — the chips stay, and are the way out of it. */
  duplicate?: boolean;
  onApply: (value: string) => void;
}) {
  const taken = duplicate ? [] : existing;
  if (suggestions.length === 0 && taken.length === 0) return null;

  return (
    <p className="mt-1 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
      {taken.length > 0 && (
        // Deliberately not a list of controls. These names cannot be applied, so
        // anything clickable or arrow-reachable here would be the dead end this
        // component exists to remove.
        <span>
          <span className="font-medium text-foreground/70">{taken.join(", ")}</span>{" "}
          {taken.length === 1 ? "already exists" : "already exist"}
        </span>
      )}
      {taken.length > 0 && suggestions.length > 0 && <span aria-hidden>·</span>}
      {suggestions.length > 0 && (
        <>
          Did you mean
          {/* `role="listbox"` / `role="option"` because that is what this behaves
              as: the input drives a highlight through it with the arrow keys. A
              bare <button> does not support aria-selected, so without the roles
              the highlight would be colour only — invisible to a screen reader. */}
          <span role="listbox" aria-label="Name suggestions" className="flex flex-wrap items-center gap-1">
            {suggestions.map((s, i) => (
              <button
                key={s}
                type="button"
                role="option"
                // Tab only MOVES between fields (see the raagam-keyboard-contract
                // skill). These chips appear and disappear as the user types, so
                // leaving them in the tab order would grow and shrink the tab
                // order mid-keystroke — Tab from Name would land somewhere
                // different depending on whether a suggestion happened to be
                // showing. The keyboard reaches them with ↓, which is the
                // contract's gesture for "open this field's list"; Tab is not it.
                tabIndex={-1}
                // The strip behaves as a listbox the input drives, so the
                // highlight is announced rather than being colour alone.
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
        </>
      )}
    </p>
  );
}
