"use client";

// Debounced live "did you mean?" prediction for master Name fields. Returns up
// to 3 suggested full names while the typed value looks like a typo OR a partial
// of a known material word (else []). Mirrors useDuplicateCheck's 300ms debounce
// so it drops into the same slot under an Input.
//
// Predicts as you type: "COOTT" already surfaces "COTTON". `names` are existing
// DB names that augment the curated seed dictionary; pass the rows already loaded
// on the screen. Reusable for any name field, not just Category.

import { useEffect, useMemo, useState } from "react";
import { buildWordDictionary, suggestNames } from "@/lib/masters/material-dictionary";

export function useSpellSuggest(args: {
  name: string;
  names?: string[];
  /** Skip while false (e.g. a duplicate error is already showing). Default true. */
  enabled?: boolean;
}): string[] {
  const { name, names, enabled = true } = args;

  // Rebuild the dictionary only when the underlying names actually change.
  const namesKey = (names ?? []).join("");
  const dict = useMemo(
    () => buildWordDictionary(names ?? []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [namesKey],
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
