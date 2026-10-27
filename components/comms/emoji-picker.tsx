"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Input } from "@/components/ui/input";
import { COMMON_REACTIONS, EMOJI_CATEGORIES, emojiName, searchEmoji } from "@/lib/comms/emoji";
import { cn } from "@/lib/utils";

const COLS = 8;

/**
 * The reaction picker (0760). Native Unicode from `lib/comms/emoji.ts` — no
 * images, no dependency — so it is the same catalog the server's
 * comm_allowed_emoji() accepts: nothing on offer here can be refused there.
 *
 * Keyboard: it opens with the search box focused; ↓ moves into the grid, the
 * arrows walk it (8 to a row), Enter picks, Escape closes without picking —
 * and so does a click outside. It opens UPWARD when there is no room below,
 * so a picker on the newest message is not cut off by the composer.
 *
 * `role="dialog"` is deliberate: the hub's keyboard contract and the reload
 * guard both recognise an open dialog, so Enter here picks an emoji instead of
 * being read as "send".
 */
export function EmojiPicker({
  onPick,
  onClose,
  anchor,
}: {
  onPick: (emoji: string) => void;
  onClose: () => void;
  /** The button that opened it — for choosing up or down, and for focus return. */
  anchor: HTMLElement | null;
}) {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<string>("common");
  const boxRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [up] = useState(() => {
    if (!anchor || typeof window === "undefined") return false;
    const r = anchor.getBoundingClientRect();
    return window.innerHeight - r.bottom < 360 && r.top > 360;
  });

  const shown = useMemo(() => {
    if (q.trim()) return searchEmoji(q).map((x) => x.e);
    if (cat === "common") return [...COMMON_REACTIONS];
    return EMOJI_CATEGORIES.find((c) => c.key === cat)?.emojis.map((x) => x.e) ?? [];
  }, [q, cat]);

  useEffect(() => {
    searchRef.current?.focus();
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node) && !anchor?.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [anchor, onClose]);

  function close() {
    onClose();
    anchor?.focus();
  }

  function cells(): HTMLButtonElement[] {
    return Array.from(boxRef.current?.querySelectorAll<HTMLButtonElement>("[data-emoji-cell]") ?? []);
  }

  function onKey(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
      return;
    }
    const list = cells();
    const at = list.indexOf(document.activeElement as HTMLButtonElement);
    if (e.target === searchRef.current) {
      if (e.key === "ArrowDown" && list.length) {
        e.preventDefault();
        list[0].focus();
      } else if (e.key === "Enter" && list.length) {
        // Enter in the search box picks the first match — type "thum", Enter.
        e.preventDefault();
        onPick(list[0].dataset.emojiCell!);
      }
      return;
    }
    if (at < 0) return;
    const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: COLS, ArrowUp: -COLS }[e.key];
    if (step === undefined) return;
    e.preventDefault();
    const next = at + step;
    if (next < 0) searchRef.current?.focus();
    else list[Math.min(next, list.length - 1)]?.focus();
  }

  return (
    <div
      ref={boxRef}
      role="dialog"
      aria-label="Pick a reaction"
      onKeyDown={onKey}
      className={cn(
        "absolute right-0 z-30 w-[min(20rem,calc(100vw-2rem))] rounded-lg border border-border bg-surface p-2 shadow-lg",
        up ? "bottom-full mb-1" : "top-full mt-1",
      )}
    >
      {/* caps-input: exempt -- a search box; the query is not a stored value */}
      <Input
        ref={searchRef}
        type="search"
        uppercase={false}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search emoji"
        aria-label="Search emoji"
        className="mb-2"
      />
      {!q.trim() && (
        <div role="tablist" aria-label="Emoji categories" className="mb-1 flex flex-wrap gap-1">
          {[{ key: "common", label: "Common" }, ...EMOJI_CATEGORIES].map((c) => (
            // button-shape: exempt -- a category tab inside the picker, a 22px text chip, not an action button
            <button
              key={c.key}
              type="button"
              role="tab"
              aria-selected={cat === c.key}
              onClick={() => setCat(c.key)}
              className={cn(
                "rounded px-1.5 py-0.5 text-[11px] font-medium",
                cat === c.key ? "bg-primary-soft text-primary" : "text-muted-foreground hover:bg-surface-muted",
              )}
            >
              {c.label}
            </button>
          ))}
        </div>
      )}
      {shown.length === 0 ? (
        <p className="py-6 text-center text-xs text-muted-foreground">No emoji match “{q.trim()}”.</p>
      ) : (
        <div role="grid" aria-label="Emoji" className="grid max-h-56 grid-cols-8 gap-0.5 overflow-y-auto">
          {shown.map((e) => (
            // button-shape: exempt -- one emoji cell in a picker grid, a square glyph not a worded button
            <button
              key={e}
              type="button"
              data-emoji-cell={e}
              role="gridcell"
              aria-label={`React with ${emojiName(e)}`}
              title={emojiName(e)}
              onClick={() => onPick(e)}
              className="flex h-8 w-8 items-center justify-center rounded text-lg hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {e}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
