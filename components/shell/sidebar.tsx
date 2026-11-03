"use client";

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
import { useMenuCollapsed } from "@/components/navigation/menu-collapse";
import { SidebarDock } from "./sidebar-dock";
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
  const menuCollapsed = useMenuCollapsed();
  if (editorOpen) return null;

  const hasMenu = hasModuleMenu(activeModule(pathname, visibleModules(user)), stores.length);
  // Folded by the operator (menu-collapse.ts): the sidebar is then the rail
  // alone, exactly as on a module with no menu — round mark, compact dock.
  const withMenu = hasMenu && !menuCollapsed;

  return (
    /* DIRECTION B (user 2026-11-03, "okay apply the B"): the dark labelled rail
       runs the full height with the round mark at its head, the module menu
       stands beside it, and the account dock sits under the MENU. The brand row
       that spanned rail + menu (2026-10-01) went with the rail's hover panel,
       whose `top-14` it existed to line up with. A page with no module menu
       (Dashboard) carries the compact dock at the foot of the rail instead. */
    <div className="hidden h-full shrink-0 md:flex">
      <GlobalSidebar
        menuFolded={hasMenu && menuCollapsed}
        footer={withMenu ? null : <SidebarDock previewableRoles={previewableRoles} photoUrl={photoUrl} compact />}
      />
      {withMenu && (
        <div className="flex h-full flex-col">
          <div className="flex min-h-0 flex-1">
            <ContextSidebar stores={stores} />
          </div>
          <SidebarDock previewableRoles={previewableRoles} photoUrl={photoUrl} compact={false} />
        </div>
      )}
    </div>
  );
}
