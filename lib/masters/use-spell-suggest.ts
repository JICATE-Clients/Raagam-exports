"use client";

// Debounced live "did you mean?" prediction for master Name fields. Returns up
// to 3 suggested full names while the typed value looks like a typo OR a partial
// of a known material word (else []). Mirrors useDuplicateCheck's 300ms debounce
// so it drops into the same slot under an Input.
//
// Predicts as you type: "COOTT" already surfaces "COTTON". `names` are existing
// DB names that augment the curated seed dictionary; pass the rows already loaded
// on the screen. Reusable for any name field, not just Category.
//
// Both halves are the CALLER's to scope: pass only the names that belong beside
// what is being typed, and pass `seed: []` where the fibre words don't apply
// (client 2026-07-28 — Packing names were being "corrected" to COTTON).

import { useEffect, useMemo, useState } from "react";
import { buildWordDictionary, suggestNames } from "@/lib/masters/material-dictionary";

export function useSpellSuggest(args: {
  name: string;
  names?: string[];
  /** Curated words to seed the dictionary with, on top of `names`. Omit for the
   *  fibre/material list; pass `[]` where those words aren't the vocabulary
   *  (e.g. a Packing category — client 2026-07-28). */
  seed?: string[];
  /** Skip while false (e.g. a duplicate error is already showing). Default true. */
  enabled?: boolean;
}): string[] {
  const { name, names, seed, enabled = true } = args;

  // Rebuild the dictionary only when the underlying names/seed actually change.
  // "*" stands for "no seed passed" — distinct from an explicit [], which means
  // "no curated words at all" and must build a different dictionary.
  const namesKey = (names ?? []).join("");
  const seedKey = seed ? seed.join(",") : "*";
  const dict = useMemo(
    () => buildWordDictionary(names ?? [], seed),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [namesKey, seedKey],
  );

  const [suggestions, setSuggestions] = useState<string[]>([]);

  useEffect(() => {
    if (!enabled || !name.trim()) {
      setSuggestions([]);
      return;
    }
    const t = setTimeout(() => {
      setSuggestions(suggestNames(name, dict));
    }, 300);
    return () => clearTimeout(t);
  }, [name, dict, enabled]);

  return suggestions;
}
