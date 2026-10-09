"use client";

import { ChevronDown } from "lucide-react";
import { buttonClasses } from "@/components/ui/button";
import { DropdownMenu, type DropdownItem } from "@/components/ui/dropdown-menu";

/**
 * "More ▾" — the occasional actions of an editor's header band, folded into one
 * outline button (user 2026-10-09, button plan Rule 3: at most three buttons
 * in a header — the next step filled, Reports, and More).
 *
 * Copy from, Compare and the like are used now and then, not on every visit,
 * and a header that grew a button for each one stood six wide on Sample
 * Costing. Nothing is removed by folding them: each is one click deeper.
 *
 * Renders NOTHING when `items` is empty, so a screen passes whatever applies to
 * the record in hand and never has to decide whether the menu should exist.
 * The trigger is drawn by `buttonClasses()` — the one button shape — so it
 * matches the outline buttons beside it, skin included.
 */
export function MoreActions({ items, label = "More actions" }: { items: DropdownItem[]; label?: string }) {
  if (!items.length) return null;
  return (
    <DropdownMenu
      items={items}
      label={label}
      align="right"
      triggerClassName={buttonClasses({ variant: "outline", size: "md" })}
      trigger={
        <>
          More <ChevronDown aria-hidden />
        </>
      }
    />
  );
}
