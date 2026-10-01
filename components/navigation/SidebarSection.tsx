import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A small caption above a run of `SidebarItem`s, per the contextual sidebar's
 * nested-navigation spec (module → section → items). The space BETWEEN
 * sections is the parent's `space-y-*`.
 *
 * NO LINES (user 2026-10-01, sidebar option B). The caption used to trail a
 * hairline to the column's edge and the rows hung off a vertical tree line
 * (client 2026-09-17) — with the column border and its scrollbar that was four
 * kinds of line in 192px. Groups are told apart by SPACE and the grey capitals.
 *
 * FOLDABLE (user 2026-10-01, sub-module menu suggestion 2). Pass `fold` and the
 * caption becomes a button that shows or hides the rows, with a chevron.
 * Which section is open is the caller's `useAccordion` — this component holds
 * no state of its own.
 */
export function SidebarSection({
  label,
  fold,
  children,
}: {
  label?: string;
  fold?: { open: boolean; onToggle: () => void };
  children: ReactNode;
}) {
  // `truncate` + `min-w-0`: a caption too long for the 184px column stays on
  // one line and ellipsises rather than wrapping.
  // THREE LEVELS, NOT ONE (user 2026-10-01, screenshot 3188): module name
  // 16px bold, screens 13px, captions 10px in the quieter `--caption` grey.
  // NOT `ty-sidebar-group`: the compact type scale sets that class to 11px
  // medium, and in capitals with letter-spacing 11px read as large as the
  // 13px screen names beneath it, in the same grey — the menu had no levels.
  const caption = (
    <span className="min-w-0 truncate whitespace-nowrap text-[10px] font-semibold uppercase tracking-wider text-caption">
      {label}
    </span>
  );
  return (
    <div className="space-y-1">
      {label &&
        (fold ? (
          <button
            type="button"
            aria-expanded={fold.open}
            onClick={fold.onToggle}
            className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left transition-colors hover:bg-surface-muted"
          >
            {/* No screen count beside a folded caption (user 2026-10-01: "that
                number listing no need, remove it"); the chevron alone says
                there is more inside. */}
            {caption}
            <ChevronRight
              aria-hidden
              className={cn(
                "ml-auto h-3.5 w-3.5 shrink-0 text-caption transition-transform duration-150",
                fold.open && "rotate-90",
              )}
            />
          </button>
        ) : (
          <div className="px-2 pt-1">{caption}</div>
        ))}
      {(!fold || fold.open) && <div className="space-y-px">{children}</div>}
    </div>
  );
}
