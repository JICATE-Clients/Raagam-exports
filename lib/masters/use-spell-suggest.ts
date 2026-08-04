"use client";

// Debounced live "did you mean?" prediction for master Name fields. Returns up
// to 3 known names worth offering while the typed value looks like a typo OR a
// partial of one (else []). Mirrors useDuplicateCheck's 300ms debounce
// deliberately, so the red duplicate error and the suggestion chip resolve
// together instead of flickering one after the other.
//
// `names` are the names already on the screen (the DB rows); `seed` is the
// curated vocabulary from geo-names.ts / name-vocabularies.ts. BOTH are the
// CALLER'S TO SCOPE, and `seed` is REQUIRED rather than defaulted — the earlier
// version of this hook defaulted it to a fibre word list, which is exactly how a
// Packing category name ended up being "corrected" to COTTON (client
// 2026-07-28). A default seed is a suggestion nobody asked for on a screen
// nobody thought about.
//
// ── A CHIP IS A NAME YOU CAN ACTUALLY SAVE ──────────────────────────────────
// The result comes back in TWO lists, and the split is the whole point.
//
// A name that is already a row cannot be saved: `useDuplicateCheck` guards the
// SAME scope the caller used to build `names`, so offering one is offering a
// click that lands on "already exists". On a screen with no vocabulary that was
// every chip it could produce — type COT under Item Class YARN and it offered
// COTTON and POLYCOTTON, both already there (client, 2026-08-04).
//
//   suggestions — free names. Chips. Keyboard-navigable, applied on Enter.
//   existing    — names that are already rows. Rendered as inert text.
//
// `existing` is not a consolation prize: it is the only thing that catches a
// typo-TWIN, which is the reason this hook exists at all. The duplicate guard
// fires on an exact match, so INTARLOCK typed beside an existing INTERLOCK is
// invisible to it — and both of those are sitting in the categories table today.
// So the taken name still gets SAID; it just stops pretending to be a fix.
//
// Which is also why the caller must no longer gate `enabled` on "no duplicate
// error". That gate was written when every candidate was a row, so suppressing
// the strip and suppressing the useless name were the same statement. They come
// apart the moment a screen has a vocabulary: COTTON is no use, COTTON SLUB is
// exactly what the operator wants, and the duplicate error is the moment they
// want it most. The filter above makes the gate redundant anyway — a screen with
// no seed produces no chips during a duplicate, because every candidate is taken.
//
// ── The chips are reachable BY KEYBOARD, and that is not optional ───────────
// These operators are keyboard-only data-entry staff. A suggestion you can only
// accept with a mouse is a suggestion they cannot use, which made the first
// version decorative for the people it was built for.
//
// The gesture is the one the contract already defines for "this field has a
// list" (see the `raagam-keyboard-contract` skill): ↓ moves into the
// suggestions, ↑ moves back out to the field, Enter applies the highlighted one
// and stays put, Esc dismisses the strip without touching the typed text.
//
// What it deliberately does NOT do is put the chips in the Tab order. They
// appear and disappear as the operator types, so tabbing through them would
// make the tab order grow and shrink mid-keystroke — Tab out of Name would land
// somewhere different depending on whether a chip happened to be showing. Tab
// only ever MOVES; ↓ is what opens a list.

import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { normName, splitSuggestions } from "@/lib/masters/name-dictionary";

/** Nothing to say. A frozen literal so a render that produces no suggestions
 *  hands back the SAME object every time — the two lists are read straight into
 *  props, and a fresh `{ suggestions: [], existing: [] }` per keystroke would
 *  re-render the strip on every character that has nothing to show. */
const NOTHING = { suggestions: [] as string[], existing: [] as string[] } as const;

export type SpellSuggest = {
  /** FREE names worth offering, best first — none of these is a row yet, so
   *  every one of them saves. These are the chips. Empty when there is nothing
   *  to say. */
  suggestions: string[];
  /** Close names that are ALREADY ROWS. Never chips — they cannot be saved — but
   *  still worth saying, because this is the only warning a typo-twin gets
   *  (INTARLOCK beside an existing INTERLOCK). Render as inert text. */
  existing: string[];
  /** Index into `suggestions` the keyboard is on, or -1 when the caret is still
   *  "in the field" and Enter should do its normal job. */
  activeIndex: number;
  /** Attach to the Name input. Claims ↓ ↑ Enter Esc only while it has something
   *  to claim them for, and calls preventDefault() when it does — which is what
   *  makes the global keydown provider stand down (it bails on
   *  `defaultPrevented`, not on propagation). */
  onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void;
};

export function useSpellSuggest(args: {
  name: string;
  /** Names already stored on this screen. Exclude the row being edited — a
   *  record must not suggest its own name back at you. Scope these exactly as
   *  the duplicate check is scoped: that is what makes "already a row" mean
   *  "the guard will reject it", which is how they get sorted out of the chips. */
  names: string[];
  /** Curated vocabulary to offer on top of `names`. Pass [] for none. Without
   *  one there is nothing FREE to suggest, so the strip can only ever warn. */
  seed: string[];
  /** Skip while false — the Sheet is closed, no Item Class chosen yet, and so
   *  on. Do NOT pass `!dupError`: a duplicate is when the free names are most
   *  wanted, and the taken ones are filtered out regardless. */
  enabled?: boolean;
  /** Apply a chosen suggestion to the field. Required for the keyboard path;
   *  the click path calls it through <SpellSuggestHint onApply>. */
  onApply?: (value: string) => void;
}): SpellSuggest {
  const { name, names, seed, enabled = true, onApply } = args;

  // Rebuild the candidate list only when the underlying names/seed actually
  // change — the arrays are rebuilt by the caller on every render.
  const namesKey = names.join(" ");
  const seedKey = seed.join(" ");
  const candidates = useMemo(
    () => [...seed, ...names],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [namesKey, seedKey],
  );

  // The ONLY thing the effect does is let the typing settle; the suggestions
  // themselves are derived, not stored. Holding them in state meant clearing
  // that state from the effect body on every disabling keystroke, which is a
  // cascading render (`react-hooks/set-state-in-effect`) — and it left the
  // previous name's chips on screen until the next timer fired.
  const [settled, setSettled] = useState("");
  /** Dismissed with Esc for THIS settled value; typing again revives the strip. */
  const [dismissed, setDismissed] = useState("");
  /**
   * The highlight, stored WITH the strip it belongs to.
   *
   * Deliberately not "an index plus an effect that resets it": the index is only
   * meaningful for one particular list of chips, so pairing it with that list
   * makes a stale highlight underivable instead of something an effect has to
   * race to correct. Resetting it from an effect body is also the cascading
   * render `react-hooks/set-state-in-effect` exists to catch — the same trap the
   * suggestions themselves were moved out of state to avoid.
   */
  const [active, setActive] = useState<{ key: string; index: number }>({ key: "", index: -1 });

  useEffect(() => {
    const t = setTimeout(() => setSettled(name), 300);
    return () => clearTimeout(t);
  }, [name]);

  /** Names that are already rows, normalised through the matcher's OWN
   *  normaliser so membership is decidable on its output. */
  const taken = useMemo(
    () => new Set(names.map(normName)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [namesKey],
  );

  /**
   * Free names and taken names, in one pass. The rules live in
   * `splitSuggestions` (name-dictionary.ts) rather than here, because they are
   * pure and worth testing without React — scripts/check-name-suggest.mts runs
   * that exact function against the real category rows. A second copy of the
   * caps and the filter in this file would be a copy free to drift from the one
   * under test.
   */
  const { suggestions, existing } = useMemo(() => {
    // `settled !== name` = still typing. Suggestions vanish on the first
    // keystroke and come back 300ms after the last one; a chip that outlives
    // the text it was computed from is a chip that applies the wrong name.
    if (!enabled || settled !== name || !settled.trim()) return NOTHING;
    if (dismissed && dismissed === settled) return NOTHING;
    return splitSuggestions(settled, candidates, taken);
  }, [enabled, settled, name, candidates, dismissed, taken]);

  // A highlight left over from a strip the operator never saw would apply a
  // name they never read, so it only counts while its own strip is on screen.
  const stripKey = suggestions.join(" ");
  const activeIndex = active.key === stripKey ? active.index : -1;

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (suggestions.length === 0) return;
    switch (e.key) {
      case "ArrowDown":
        // Into the strip, then down it. Clamped at the last one rather than
        // wrapping: wrapping past the end reads as "nothing happened".
        e.preventDefault();
        setActive({ key: stripKey, index: Math.min(activeIndex + 1, suggestions.length - 1) });
        break;
      case "ArrowUp":
        // Back up, and off the top returns the caret to the field — so the strip
        // has a way out that does not need Esc.
        if (activeIndex < 0) return; // not in the strip; let the field have it
        e.preventDefault();
        setActive({ key: stripKey, index: activeIndex - 1 });
        break;
      case "Enter":
        // Only claims Enter while a chip is highlighted. Otherwise Enter keeps
        // its contract meaning (advance to the next field / save off the last),
        // which is what an operator who ignored the strip expects.
        if (activeIndex < 0) return;
        e.preventDefault();
        onApply?.(suggestions[activeIndex]);
        setActive({ key: "", index: -1 });
        setDismissed(settled);
        break;
      case "Escape":
        // Dismiss the strip ONLY — one layer per press, and the typed text is
        // never touched. A second Esc then reaches the surface as usual.
        e.preventDefault();
        setActive({ key: "", index: -1 });
        setDismissed(settled);
        break;
    }
  };

  return { suggestions, existing, activeIndex, onKeyDown };
}
