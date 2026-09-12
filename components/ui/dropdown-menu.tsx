"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, MoreVertical, type LucideIcon } from "lucide-react";
import { StatusDot } from "@/components/ui/status-pill";
import type { StatusTone } from "@/lib/ui/tone";
import { cn } from "@/lib/utils";

export interface DropdownItem {
  label: string;
  icon?: LucideIcon;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
  /**
   * A heading printed above this item, when it differs from the item before it.
   *
   * ## IT IS A PROPERTY OF THE ITEM, NOT A SEPARATE `divider` ENTRY
   *
   * The obvious alternative — letting `items` hold `{ kind: "heading" }` rows —
   * breaks the keyboard, and breaks it silently. `onMenuKeyDown` walks `items`
   * by INDEX and `activate` reads `items[active]`, so a non-actionable entry in
   * that array becomes a stop ↑/↓ can land on and Enter does nothing from. This
   * spelling cannot produce that state: every element of `items` is still an
   * action, headings are drawn beside them, and the index arithmetic is
   * untouched.
   *
   * Purely decorative — `aria-hidden`, no role. A screen reader gets the item's
   * own label, which is why a section must never carry meaning the label omits.
   */
  section?: string;
  /**
   * Draw a rule above this item.
   *
   * ## A PROPERTY OF THE ITEM, FOR THE SAME REASON `section` IS ONE
   *
   * The obvious spelling - a `{ kind: "separator" }` entry in `items` - is the
   * bug `section` above already records: `onMenuKeyDown` walks `items` by INDEX
   * and `activate` reads `items[active]`, so a non-actionable element of that
   * array becomes a stop the arrows can land on and Enter does nothing from.
   * Every element of `items` stays an action; the rule is drawn beside one.
   *
   * Rendered as a real `role="separator"` element rather than a border on the
   * button, so a screen reader announces the grouping instead of inferring it
   * from a line it cannot see. It is skipped at index 0, where it would only
   * underline the menu's own top border.
   */
  separatorBefore?: boolean;
  /**
   * A filled status dot in place of the icon - the Active (green) / Inactive
   * (grey) pair in a row-actions menu.
   *
   * `StatusDot` is the app's one dot, so these are the same green and grey the
   * `StatusPill` beside them uses. `icon` still works and wins if both are set;
   * an item should not carry two glyphs.
   */
  dot?: StatusTone;
  /**
   * Makes this item a RADIO rather than a plain command: `role="menuitemradio"`
   * plus `aria-checked`, and a tick on the right when true.
   *
   * Use it for items that report a state the menu can switch between (Active /
   * Inactive), never for one that merely performs an action. `undefined` - the
   * default, and what every existing menu passes - leaves the item a plain
   * `menuitem`, so this lands without touching the ~40 menus already open.
   *
   * A CHECKED ITEM IS STILL CLICKABLE, deliberately. Disabling it would grey
   * out the one line that says what the row currently IS, and re-selecting the
   * current state is a harmless no-op the handler can drop.
   */
  checked?: boolean;
}

/**
 * Small action menu (checklist "Quick Actions"): a trigger button that opens a
 * popover list of actions — Edit / Duplicate / Export / Delete etc. Keyboard:
 * Enter/Space or click opens; ↑/↓ move; Enter activates; Esc or outside-click
 * closes. The menu is portaled with fixed positioning measured from the trigger,
 * so it never clips inside a table's overflow. Defaults to a 3-dot trigger.
 */
export function DropdownMenu({
  items,
  label = "Actions",
  trigger,
  align = "right",
  triggerClassName,
}: {
  items: DropdownItem[];
  label?: string;
  /** Override the default 3-dot trigger. */
  trigger?: React.ReactNode;
  align?: "left" | "right";
  /** Replace the trigger button's own classes — for a caller sitting on a
   *  background the default `text-muted-foreground` can't read against (a
   *  colored bar, say). Omit to keep the standard neutral button every other
   *  call site already uses. */
  triggerClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [active, setActive] = useState(0);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const measure = useCallback(() => {
    const el = btnRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const width = 176; // w-44
    setPos({
      top: r.bottom + 4,
      left: align === "right" ? r.right - width : r.left,
    });
  }, [align]);

  useEffect(() => {
    if (!open) return;
    measure();
    const onMove = () => measure();
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    function onDoc(e: MouseEvent) {
      const t = e.target as Node;
      if (btnRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => {
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
      document.removeEventListener("mousedown", onDoc);
    };
  }, [open, measure]);

  function activate(item: DropdownItem) {
    if (item.disabled) return;
    setOpen(false);
    item.onClick();
  }

  function onMenuKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, items.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      const item = items[active];
      if (item) activate(item);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      btnRef.current?.focus();
    }
  }

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          setActive(0);
          setOpen((o) => !o);
        }}
        className={
          triggerClassName ??
          "inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-surface-muted hover:text-foreground"
        }
      >
        {trigger ?? <MoreVertical className="h-4 w-4" />}
      </button>

      {open &&
        pos &&
        createPortal(
          <div
            ref={(el) => {
              menuRef.current = el;
              el?.focus();
            }}
            role="menu"
            tabIndex={-1}
            onKeyDown={onMenuKeyDown}
            style={{ position: "fixed", top: pos.top, left: pos.left, width: 176, zIndex: 150 }}
            className="overflow-hidden rounded-md border border-border bg-surface py-1 shadow-lg focus:outline-none"
          >
            {items.map((item, i) => {
              const Icon = item.icon;
              /* A heading is drawn when the section CHANGES, so consecutive
                 items of one group print it once — and an `items` array that
                 declares no section anywhere renders exactly as it always did.
                 That is what lets this land in the primitive without touching
                 the ~40 menus already using it. */
              const heading =
                item.section && item.section !== items[i - 1]?.section ? item.section : null;
              return (
                <div key={item.label}>
                  {/* Skipped at index 0 - a rule there would only thicken the
                      menu's own top border. Same reasoning as the heading. */}
                  {item.separatorBefore && i > 0 && (
                    <div role="separator" className="my-1 border-t border-border" />
                  )}
                  {heading && (
                    <div
                      aria-hidden
                      className={cn(
                        "px-3 pb-1 text-[10.5px] font-semibold uppercase tracking-[.09em] text-muted-foreground",
                        // A rule above every group but the first: it separates,
                        // where on the first it would just underline the menu's
                        // own top border.
                        i === 0 ? "pt-1" : "mt-1 border-t border-border pt-2",
                      )}
                    >
                      {heading}
                    </div>
                  )}
                <button
                  type="button"
                  role={item.checked === undefined ? "menuitem" : "menuitemradio"}
                  aria-checked={item.checked}
                  disabled={item.disabled}
                  onClick={() => activate(item)}
                  onMouseEnter={() => setActive(i)}
                  className={cn(
                    "flex w-full items-center gap-2 px-3 py-2 text-left text-sm disabled:opacity-50",
                    i === active && "bg-surface-muted",
                    item.danger ? "text-danger" : "text-foreground",
                  )}
                >
                  {/* `icon` wins over `dot` - an item should not carry two
                      glyphs, and every existing menu passes an icon. The dot is
                      boxed to an icon's width so a mixed menu still aligns. */}
                  {Icon ? (
                    <Icon className="h-4 w-4 shrink-0" />
                  ) : item.dot ? (
                    <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                      <StatusDot tone={item.dot} />
                    </span>
                  ) : null}
                  {/* `flex-1` so the tick below sits at the right edge; NO
                      `truncate` - a clipped menu label hides the action the
                      operator is about to take, which is exactly the dead end
                      AGENTS.md "Truncated values" forbids. A long label wraps
                      inside the 176px menu instead, which is also what the bare
                      text node here did before it was wrapped in a span. */}
                  <span className="min-w-0 flex-1">{item.label}</span>
                  {item.checked && <Check className="h-3.5 w-3.5 shrink-0 text-primary" />}
                </button>
                </div>
              );
            })}
          </div>,
          document.body,
        )}
    </>
  );
}
