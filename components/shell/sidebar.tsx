"use client";

import type { CSSProperties } from "react";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useEditorOpen } from "@/lib/editor-presence";
import { useAppUser } from "@/lib/auth/permission-context";
import { GlobalSidebar } from "@/components/navigation/GlobalSidebar";
import { ContextSidebar } from "@/components/navigation/ContextSidebar";
import {
  activeModule,
  hasModuleMenu,
  visibleModules,
} from "@/components/navigation/navigation-config";
import type { PreviewableRole } from "@/lib/auth/role-simulation";
import { DOCK_HEIGHT, SidebarDock } from "./sidebar-dock";
import type { StoreNavLink } from "./sidebar-types";

export type { StoreNavLink };

/**
 * Two-level app navigation: `GlobalSidebar` (the icon rail, level 1) beside
 * `ContextSidebar` (the active module's sub-navigation, level 2). Both derive
 * everything from the current route and the signed-in user's permissions —
 * see `components/navigation/navigation-config.ts` for the shared logic and
 * `doc/` for nothing, because there is no separate route list to keep in
 * sync: `components/shell/nav.ts` and `lib/nav/module-groups.ts` stay the one
 * source of truth this just renders.
 */
export function Sidebar({
  stores = [],
  previewableRoles = [],
  photoUrl = null,
}: {
  stores?: StoreNavLink[];
  /** Every role a Super Admin may preview — feeds the dock's preview list. */
  previewableRoles?: PreviewableRole[];
  /** The operator's HR staff photo, for the dock's avatar. */
  photoUrl?: string | null;
}) {
  /**
   * A full-page record editor takes the whole width.
   *
   * The editor carries its own section rail, so leaving this up gives the
   * operator two vertical navigations with the form squeezed between them
   * (client 2026-08-10). Returning null rather than adding a `hidden` class so
   * the nav's own scroll position and hover state are rebuilt fresh on the
   * way back — a hidden-but-mounted sidebar would keep a scroll offset from
   * before the editor opened.
   *
   * Mobile is unaffected: both halves below are `md:flex`/`md:block` and
   * `MobileNav` is the nav there.
   */
  const editorOpen = useEditorOpen();
  // ABOVE THE EARLY RETURN — see "Hooks above every early return" in AGENTS.md.
  const pathname = usePathname();
  const user = useAppUser();
  if (editorOpen) return null;

  const withMenu = hasModuleMenu(activeModule(pathname, visibleModules(user)), stores.length);

  return (
    <div
      className="hidden h-full shrink-0 flex-col md:flex"
      // The dock's height, read by the rail (`GlobalSidebar`), whose fixed
      // panel must end above it — see `SidebarDock`'s DOCK_HEIGHT.
      style={{ "--dock-h": `${withMenu ? DOCK_HEIGHT.full : DOCK_HEIGHT.compact}px` } as CSSProperties}
    >
      {/* THE BRAND ROW SPANS THE WHOLE SIDEBAR (user 2026-10-01: "raagam logo
          looks squeezed"). The wordmark sat in the module menu's own 48px
          header at 36px tall, and before that in the 56px rail at 40px wide;
          across rail + menu (236px) it gets the room to read. Where there is
          no module menu (Dashboard) the sidebar is only the rail, so the row
          shows the round mark instead. `h-14` is what the rail's `top-14`
          flyout opens beneath — change both together. */}
      {/* CENTRED (user 2026-10-01, screenshot 3181), in both states — the
          rail's open panel draws a centred twin at the same width. */}
      <div className="flex h-14 shrink-0 items-center justify-center">
        {withMenu ? (
          <Image
            src="/brand/raagam-wordmark.png"
            alt="Raagam Exports"
            width={431}
            height={184}
            priority
            className="h-11 w-auto"
          />
        ) : (
          <Image
            src="/brand/raagam-mark.png"
            alt="Raagam Exports"
            width={1024}
            height={1024}
            priority
            className="h-9 w-9"
          />
        )}
      </div>
      <div className="flex min-h-0 flex-1">
        <GlobalSidebar wide={withMenu} />
        <ContextSidebar stores={stores} />
      </div>
      {/* THE DOCK (user 2026-10-01): unit, role preview and account, spanning
          rail + menu the way the brand row spans the top. Rail-only pages
          (Dashboard) get the badge alone. */}
      <SidebarDock previewableRoles={previewableRoles} photoUrl={photoUrl} compact={!withMenu} />
    </div>
  );
}
