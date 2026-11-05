"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Paperclip } from "lucide-react";
import { cn } from "@/lib/utils";

export type AttachItem = "doc" | "media" | "camera" | "audio" | "contact" | "poll" | "event" | "sticker" | "record";

/**
 * WHATSAPP'S 📎 MENU ON PULSE'S MESSAGE BOX (user 2026-10-31, screenshot
 * 152017 and the Pulse Attach Menu mockup: "apply this").
 *
 * Document · Photos & videos · Camera · Audio · Contact · Poll · Event ·
 * New sticker, in WhatsApp's order and colours, then Pulse's own Record (a
 * PO, indent or RE) under a rule — the "Link a record" button that used to sit
 * in the action row lives here now, one job one button.
 *
 * It rises from 📎 above the box (a menu opening downward would leave the
 * screen). ↑ ↓ move, Enter picks, Esc closes and gives focus back to 📎; a
 * click outside closes it.
 *
 * IT OPENS TOWARDS THE ROOM (user 2026-11-05, screenshot 123433: "path cut
 * aagudhu"). It used to hang from 📎's LEFT edge and grow rightward — fine
 * while 📎 sat at the left of the box, but in the chat layout 📎 sits beside
 * Send at the RIGHT edge, so every label ran off the pane and was clipped
 * ("Docum…", "Contac…"). On open it measures the room against the viewport
 * and every clipping ancestor and, if the right side is short, hangs from 📎's
 * right edge instead. Measured, not hard-coded per layout, so a 📎 moved
 * anywhere later is still right. Not a modal — nothing behind it is blocked — so it
 * registers with no reload guard.
 */
const ICON: Record<AttachItem, ReactNode> = {
  doc: (
    <svg viewBox="0 0 24 24" fill="#7f66ff" aria-hidden>
      <path d="M6 2h8l6 6v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zm7 1.5V9h5.5zM8 13h8v1.6H8zm0 3.4h8V18H8z" />
    </svg>
  ),
  media: (
    <svg viewBox="0 0 24 24" fill="#007bfc" aria-hidden>
      <path d="M4 5h13a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zm1 11h11l-3.5-4.5-2.7 3.4-1.9-2.3zM21 8v12H7v1.5h14a1.5 1.5 0 0 0 1.5-1.5V8z" />
    </svg>
  ),
  camera: (
    <svg viewBox="0 0 24 24" fill="#ff2e74" aria-hidden>
      <path d="M9 4h6l1.6 2H20a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3.4zm3 4.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9zm0 2a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5z" />
    </svg>
  ),
  audio: (
    <svg viewBox="0 0 24 24" fill="#ff7f2a" aria-hidden>
      <path d="M12 3a8 8 0 0 0-8 8v6a3 3 0 0 0 3 3h1.5v-7H6v-2a6 6 0 0 1 12 0v2h-2.5v7H17a3 3 0 0 0 3-3v-6a8 8 0 0 0-8-8z" />
    </svg>
  ),
  contact: (
    <svg viewBox="0 0 24 24" fill="#009de2" aria-hidden>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20a8 8 0 0 1 16 0z" />
    </svg>
  ),
  poll: (
    <svg viewBox="0 0 24 24" fill="#ffbc38" aria-hidden>
      <rect x="3" y="4" width="12" height="3.4" rx="1.7" />
      <rect x="3" y="10.3" width="18" height="3.4" rx="1.7" />
      <rect x="3" y="16.6" width="8" height="3.4" rx="1.7" />
    </svg>
  ),
  event: (
    <svg viewBox="0 0 24 24" fill="#ff2e74" aria-hidden>
      <path d="M7 2h2v2h6V2h2v2h2a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2zM5 9v10h14V9zm2 2h3v3H7zm4.5 0h3v3h-3zM16 11h3v3h-3z" />
    </svg>
  ),
  sticker: (
    <svg viewBox="0 0 24 24" fill="#02a698" aria-hidden>
      <path d="M12 2a10 10 0 1 0 10 10V11h-6a5 5 0 0 1-5-5V2zm1 .1V6a3 3 0 0 0 3 3h5.9A10 10 0 0 0 13 2.1zM16.5 15h2v2h2v2h-2v2h-2v-2h-2v-2h2z" />
    </svg>
  ),
  record: (
    <svg viewBox="0 0 24 24" fill="none" stroke="#0e7490" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
      <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" />
      <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
    </svg>
  ),
};

/** The menu is as wide as its longest label ("Record (PO, indent, RE)",
 *  ~205px at 13px); toggle() measures against this upper bound. */
const MENU_W = 220;

const ITEMS: { value: AttachItem; label: string; rule?: boolean }[] = [
  { value: "doc", label: "Document" },
  { value: "media", label: "Photos & videos" },
  { value: "camera", label: "Camera" },
  { value: "audio", label: "Audio" },
  { value: "contact", label: "Contact" },
  { value: "poll", label: "Poll" },
  { value: "event", label: "Event" },
  { value: "sticker", label: "New sticker" },
  { value: "record", label: "Record (PO, indent, RE)", rule: true },
];

export function AttachMenu({ onPick, disabled = false }: { onPick: (item: AttachItem) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const [alignRight, setAlignRight] = useState(false);

  // Measured on the click that opens it (MENU_W bounds the menu's width), so
  // the first frame is already on the right side — no clipped flash.
  function toggle() {
    if (!open && btn.current) {
      let limit = window.innerWidth;
      for (let el = wrap.current?.parentElement; el; el = el.parentElement) {
        if (getComputedStyle(el).overflowX !== "visible") limit = Math.min(limit, el.getBoundingClientRect().right);
      }
      setAlignRight(btn.current.getBoundingClientRect().left + MENU_W > limit - 8);
    }
    setOpen((o) => !o);
  }

  useEffect(() => {
    if (!open) return;
    wrap.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    const onDoc = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  function onKey(e: React.KeyboardEvent) {
    const items = Array.from(wrap.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []);
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      items[(i + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length]?.focus();
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      btn.current?.focus();
    } else if (e.key === "Tab") {
      setOpen(false);
    }
  }

  return (
    <div ref={wrap} className="relative" onKeyDown={open ? onKey : undefined}>
      <button
        ref={btn}
        type="button"
        disabled={disabled}
        onClick={toggle}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Attach"
        title="Attach"
        className={cn(
          "inline-flex h-10 w-10 items-center justify-center rounded-full text-[#54656f] hover:bg-surface-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 dark:text-[#aebac1]",
          open && "bg-surface-muted text-foreground",
        )}
      >
        <Paperclip className={cn("h-5 w-5 transition-transform", open && "-rotate-45")} aria-hidden />
      </button>
      {open && (
        <div
          role="menu"
          aria-label="Attach"
          className={cn(
            // COMPACT (user 2026-11-05, WhatsApp's menu: "more compact"):
            // 30px rows, 16px icons, 13px text, as wide as the longest label.
            "absolute bottom-full z-30 mb-2 w-max min-w-[150px]",
            alignRight ? "right-0" : "left-0",
            "rounded-xl bg-surface p-1 shadow-[0_2px_6px_rgba(11,20,26,.08),0_12px_32px_rgba(11,20,26,.18)] dark:border dark:border-border",
          )}
        >
          {ITEMS.map((it) => (
            <div key={it.value}>
              {it.rule && <div role="separator" className="mx-2 my-[3px] border-t border-border" />}
              <button
                type="button"
                role="menuitem"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  setOpen(false);
                  onPick(it.value);
                }}
                className="flex w-full items-center gap-2.5 whitespace-nowrap rounded-md py-[5px] pl-2.5 pr-3 text-left text-[13px] leading-5 text-foreground hover:bg-surface-muted focus-visible:bg-surface-muted focus-visible:outline-none [&_svg]:h-4 [&_svg]:w-4 [&_svg]:shrink-0"
              >
                {ICON[it.value]}
                {it.label}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
