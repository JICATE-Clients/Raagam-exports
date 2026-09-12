import type { ReactNode } from "react";
import { requireUser } from "@/lib/auth/server";
import { getCurrentLocation } from "@/lib/auth/location";
import { listPreviewableRoles } from "@/lib/auth/role-simulation";
import { PermissionProvider } from "@/lib/auth/permission-context";
import { LocationProvider } from "@/lib/auth/location-context";
import { Sidebar } from "@/components/shell/sidebar";
import { Topbar } from "@/components/shell/topbar";
import { RolePreviewBanner } from "@/components/shell/role-preview-banner";
import { WorkspaceTabsBar } from "@/components/shell/workspace-tabs-bar";
import { MobileNav } from "@/components/shell/mobile-nav";
import { SearchProvider } from "@/components/search/search-provider";
import { ShortcutsProvider } from "@/components/shell/shortcuts-provider";
import { KeyboardNavProvider } from "@/components/shell/keyboard-nav-provider";
import { listStoreNavLinks } from "@/lib/stores/service";

export default async function AppLayout({
  children,
}: {
  children: ReactNode;
}) {
  const user = await requireUser();

  // THE UNIT IS RESOLVED ONCE, HERE, FOR THE WHOLE REQUEST.
  //
  // This replaced a direct `from("locations").eq("is_active", true)` that
  // offered EVERY unit to EVERY operator regardless of their roles — harmless
  // while HO was the only one, and an access hole the day Unit 2 has rows.
  // `getCurrentLocation()` goes through `my_locations()` (0483), which
  // delegates to `has_location_access()`, so this list and Phase 1's RLS read
  // one rule.
  const { location, allowed, source } = await getCurrentLocation();

  const stores = await listStoreNavLinks();

  // Only fetched for a real Super Admin — `realIsSuperAdmin`, not
  // `isSuperAdmin`, so the switcher stays reachable while already previewing.
  const previewableRoles = user.realIsSuperAdmin
    ? await listPreviewableRoles()
    : [];

  return (
    <PermissionProvider user={user}>
      <LocationProvider value={{ current: location, allowed, source }}>
      <SearchProvider>
        <ShortcutsProvider>
          <KeyboardNavProvider>
          <div data-app-shell className="flex h-screen overflow-hidden">
            <Sidebar stores={stores} />
            <div className="flex min-w-0 flex-1 flex-col">
              <Topbar previewableRoles={previewableRoles} />
              <RolePreviewBanner />
              <WorkspaceTabsBar />
              {/* `pb-20` below md is clearance for MobileNav's floating bar;
                  `md:pb-6` is ordinary page padding, and a page-mounted
                  MasterFullScreen's footer deliberately sits ON that 24px
                  rather than cancelling it.

                  THE `-mb-6` THIS COMMENT USED TO NAME IS GONE. The card bled
                  over the padding until 2026-08-27, when the client asked for
                  the footer to stop reading as a bar welded to the window
                  ("can we make it curved, plain, without the bar"); the bleed
                  was withdrawn and the card is a card again, with the same 24px
                  under it every other page has. `master-full-screen.tsx` keeps
                  the full history — both complaints, and why the later one
                  wins. A comment naming an offset that no longer exists sends
                  the next reader looking for a bug in the wrong file. */}
              <main className="flex-1 overflow-y-auto p-4 pb-20 md:pb-6">
                {children}
              </main>
              <MobileNav stores={stores} />
            </div>
          </div>
          </KeyboardNavProvider>
        </ShortcutsProvider>
      </SearchProvider>
      </LocationProvider>
    </PermissionProvider>
  );
}
