"use client";

import { useCallback, useRef, useState } from "react";

/**
 * ONE SECTION OPEN AT A TIME — the app's fold rule, in one place (AGENTS.md
 * "Folds are accordions", STANDING).
 *
 * The client has asked for this three times, on three screens, and each time
 * the screen grew its own copy:
 *   - 2026-08-18, Combos ▸ Structure Details: "if the user moved to next
 *     structure details, close the first one automatically" (ChildGrid's
 *     `openRowKey`);
 *   - 2026-08-27, Material BOM Amendment: "add that automatic collapse option
 *     … open the first section, close the second one" (`openGroups`);
 *   - 2026-09-30, Access Control's permission editor: "if user work on the
 *     section open it and then move to the next submodule close the previous
 *     … add this kind of action globally".
 * A rule each new screen has to remember is a rule the next screen forgets;
 * this hook is what a fold uses instead of a `Set` of open keys.
 *
 * THE INVARIANT IS THE SHAPE OF THE STATE: one key or null. There is nowhere
 * to write "two open", so no caller can drift into it.
 *
 * WORKING IN A SECTION OPENS IT. `claim(key)` — or `focusProps(key)` spread on
 * the section's wrapper — opens the section the cursor has moved into and so
 * shuts the one behind. React's `onFocus` bubbles, so one handler on the
 * wrapper catches the header being clicked AND Tab arriving on any field in
 * it: tabbing off the last field of one section onto the next section's
 * header unfolds the next and folds the last, exactly as ChildGrid does. The
 * functional update returns the same key when focus moves within the open
 * section, so React bails out rather than re-rendering on every Tab.
 *
 * A screen may still hold a section open for a reason of its own — a blank
 * mandatory field must never be hidden (AGENTS.md "Mandatory fields") — by
 * OR-ing that into what it renders (`isOpen(k) || blank`). That is a render
 * decision, never a second open key.
 */
export function useAccordion(initial: string | null = null) {
  const [openKey, setOpenKey] = useState<string | null>(initial);
  /**
   * A CLICK ON A SHUT HEADER FOCUSES BEFORE IT CLICKS. Focus claims the section
   * (open), then the click toggles it (shut again) — the header would appear to
   * ignore the operator. So a toggle arriving straight after a claim OPENED that
   * same section leaves it open; a click on an already-open header, where focus
   * changed nothing, still shuts it.
   */
  const justOpened = useRef<{ key: string; at: number } | null>(null);
  /** The open key as the handlers see it, kept in step by every setter. */
  const openRef = useRef<string | null>(initial);

  /** Header click: open a shut section (shutting the rest), or shut the open one. */
  const toggle = useCallback((key: string) => {
    const j = justOpened.current;
    justOpened.current = null;
    if (j && j.key === key && Date.now() - j.at < 400) return;
    const next = openRef.current === key ? null : key;
    openRef.current = next;
    setOpenKey(next);
  }, []);
  /** The cursor moved into this section: it becomes the open one. Never shuts. */
  const claim = useCallback((key: string) => {
    if (openRef.current === key) return;
    justOpened.current = { key, at: Date.now() };
    openRef.current = key;
    setOpenKey(key);
  }, []);
  const close = useCallback(() => {
    openRef.current = null;
    setOpenKey(null);
  }, []);
  const set = useCallback((key: string | null) => {
    openRef.current = key;
    setOpenKey(key);
  }, []);
  const isOpen = (key: string) => openKey === key;
  /** Spread on the section's wrapper element. */
  const focusProps = (key: string) => ({ onFocus: () => claim(key) });

  return { openKey, isOpen, toggle, claim, close, focusProps, setOpenKey: set };
}
