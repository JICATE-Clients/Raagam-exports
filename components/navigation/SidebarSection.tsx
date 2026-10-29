import type { ReactNode } from "react";
import { ChevronRight, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A small caption above a run of `SidebarItem`s, per the contextual sidebar's
 * nested-navigation spec (module → section → items). The space BETWEEN
 * sections is the parent's `space-y-*`.
 *
 * THE GUIDE LINE IS BACK (user 2026-10-01, sidebar-lines option B,
 * https://claude.ai/artifact/6enaeYNyQwMCHoYgDUhu38): the rows of an open
 * group hang off a thin vertical line — the client's 2026-09-17 listing. The
 * caption's trailing hairline came back with it and went again the same hour
 * (screenshot 3201); the caption stands on its own.
 *
 * FOLDABLE (user 2026-10-01, sub-module menu suggestion 2). Pass `fold` and the
 * caption becomes a button that shows or hides the rows, with a chevron after
 * the hairline. Which section is open is the caller's `useAccordion` — this
 * component holds no state of its own.
 *
 * A HEADING, NOT A CAPTION, WHEN IT HAS AN ICON (sidebar plan A, user
 * 2026-10-28, https://claude.ai/artifact/EM8N82rVGzbKtJLhtrLaRS). The 10px
 * capitals read as faint labels rather than menu items, and the column had no
 * colour beside a fully coloured rail. A registry group now passes `icon`: a
 * 26px tile in the sidebar's `--hue` (SIDEBAR_HUE, set by ContextSidebar),
 * FILLED while the screen in view is inside it — the rail's own lit-tile
 * language — then the name at 13.5px semibold. The rows hang off a guide line
 * dropped from the tile's centre, and their text starts where the heading's
 * does. Without `icon` (Recently opened) the old caption is unchanged.
 */
export function SidebarSection({
  label,
  icon: Icon,
  current = false,
  fold,
  children,
}: {
  label?: string;
  /** The group's icon — switches the caption to the heading form above. */
  icon?: LucideIcon;
  /** The screen in view is one of this section's rows. */
  current?: boolean;
  fold?: { open: boolean; onToggle: () => void };
  children: ReactNode;
}) {
  if (label && Icon) {
    const heading = (
      <>
        <span
          aria-hidden
          className={cn(
            "grid h-[26px] w-[26px] shrink-0 place-items-center rounded-[7px] transition-colors",
            // NO TILE UNLESS YOU ARE IN IT (Sarvam sidebar review, user
            // 2026-10-29, fix 5). Every heading drew a blue tile, so a
            // six-group module added six squares beside the rail's own. The
            // unlit heading keeps the same 26px slot — so the guide line and
            // the rows' indent do not move — with a plain grey icon in it.
            current ? "bg-[var(--hue)] text-white" : "text-muted-foreground",
          )}
        >
          <Icon className="h-[15px] w-[15px]" strokeWidth={2} />
        </span>
        <span className="min-w-0 flex-1 truncate">{label}</span>
      </>
    );
    // pl-1.5 + 13px puts the guide line under the tile's centre (19px); the
    // 1px line + pl-2 + the rows' px-3 start their text at 40px, level with
    // the name (pl-1.5 + 26px tile + gap-2).
    const headingClass =
      "flex h-9 w-full items-center gap-2 rounded-lg pl-1.5 pr-2 text-left text-[13.5px] font-semibold text-foreground";
    return (
      <div className="space-y-0.5">
        {fold ? (
          <button
            type="button"
            aria-expanded={fold.open}
            onClick={fold.onToggle}
            className={cn(headingClass, "transition-colors hover:bg-surface-muted")}
          >
            {heading}
            <ChevronRight
              aria-hidden
              className={cn(
                "h-3.5 w-3.5 shrink-0 text-caption transition-transform duration-150",
                fold.open && "rotate-90",
              )}
            />
          </button>
        ) : (
          <div className={headingClass}>{heading}</div>
        )}
        {(!fold || fold.open) && (
          <div className="ml-[19px] space-y-0.5 border-l border-border pl-2">{children}</div>
        )}
      </div>
    );
  }
  // `truncate` + `min-w-0`: a caption too long for the 184px column stays on
  // one line and ellipsises rather than wrapping.
  // THREE LEVELS, NOT ONE (user 2026-10-01, screenshot 3188): module name
  // 16px bold, screens 13px, captions 10px in the quieter `--caption` grey.
  // NOT `ty-sidebar-group`: the compact type scale sets that class to 11px
  // medium, and in capitals with letter-spacing 11px read as large as the
  // 13px screen names beneath it, in the same grey — the menu had no levels.
  const caption = (
    <span className="min-w-0 shrink truncate whitespace-nowrap text-[10px] font-semibold uppercase tracking-wider text-caption">
      {label}
    </span>
  );
  // NO HAIRLINE AFTER THE CAPTION (user 2026-10-01, screenshot 3201: "near
  // that line remove it"). It came back with the one-line listing an hour
  // earlier, and in the 184px column it squeezed "ORDER MANAGEMENT" to
  // "ORDER MANAGEM…". The vertical guide line under an open group stays.
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
          <div className="flex items-center gap-1.5 px-2 pt-1">{caption}</div>
        ))}
      {(!fold || fold.open) && (
        // The vertical guide line the rows hang off — only under a caption;
        // a module's loose, uncaptioned rows have nothing to hang from.
        <div className="space-y-0.5">{children}</div>
      )}
    </div>
  );
}
