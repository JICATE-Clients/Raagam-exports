"use client";

import { useEditorOpen } from "@/lib/editor-presence";
import { GlobalSidebar } from "@/components/navigation/GlobalSidebar";
import { ContextSidebar } from "@/components/navigation/ContextSidebar";
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
export function Sidebar({ stores = [] }: { stores?: StoreNavLink[] }) {
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
  if (editorOpen) return null;

  return (
    <div className="hidden h-full shrink-0 md:flex">
      <GlobalSidebar />
      <ContextSidebar stores={stores} />
    </div>
  );
}
