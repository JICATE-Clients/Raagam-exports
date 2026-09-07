import type { ReactNode } from "react";
import { requireUser } from "@/lib/auth/server";
import { getCurrentLocation } from "@/lib/auth/location";
import { PermissionProvider } from "@/lib/auth/permission-context";
import { LocationProvider } from "@/lib/auth/location-context";
import { Sidebar } from "@/components/shell/sidebar";
import { Topbar } from "@/components/shell/topbar";
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

  return (
    <PermissionProvider user={user}>
      <LocationProvider value={{ current: location, allowed, source }}>
      <SearchProvider>
        <ShortcutsProvider>
          <KeyboardNavProvider>
          <div className="flex h-screen overflow-hidden">
            <Sidebar stores={stores} />
            <div className="flex min-w-0 flex-1 flex-col">
              <Topbar />
              <WorkspaceTabsBar />
              {/* `pb-20` below md is clearance for MobileNav's floating bar;
                  `md:pb-6` is ordinary page padding. A page-mounted
                  MasterFullScreen CANCELS the md value with `-mb-6` so its
                  sticky footer reaches the viewport edge instead of floating
                  above a strip of page — change `md:pb-6` here and change that
                  offset with it (components/masters/master-full-screen.tsx). */}
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
