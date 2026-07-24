"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MoreVertical, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export interface DropdownItem {
  label: string;
  icon?: LucideIcon;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
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
}: {
  items: DropdownItem[];
  label?: string;
  /** Override the default 3-dot trigger. */
  trigger?: React.ReactNode;
  align?: "left" | "right";
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
        className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-surface-muted hover:text-foreground"
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
              return (
                <button
                  key={item.label}
                  type="button"
                  role="menuitem"
                  disabled={item.disabled}
                  onClick={() => activate(item)}
                  onMouseEnter={() => setActive(i)}
                  className={cn(
                    "flex w-full items-center gap-2 px-3 py-2 text-left text-sm disabled:opacity-50",
                    i === active && "bg-surface-muted",
                    item.danger ? "text-danger" : "text-foreground",
                  )}
                >
                  {Icon && <Icon className="h-4 w-4 shrink-0" />}
                  {item.label}
                </button>
              );
            })}
          </div>,
          document.body,
        )}
    </>
  );
}
