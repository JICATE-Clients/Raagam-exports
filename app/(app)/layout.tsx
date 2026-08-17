import type { ReactNode } from "react";
import { requireUser } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import { PermissionProvider } from "@/lib/auth/permission-context";
import { Sidebar } from "@/components/shell/sidebar";
import { Topbar } from "@/components/shell/topbar";
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

  const supabase = await createClient();
  const { data: locations } = await supabase
    .from("locations")
    .select("id, code, name")
    .eq("is_active", true)
    .order("code");

  const stores = await listStoreNavLinks();

  return (
    <PermissionProvider user={user}>
      <SearchProvider>
        <ShortcutsProvider>
          <KeyboardNavProvider>
          <div className="flex h-screen overflow-hidden">
            <Sidebar stores={stores} />
            <div className="flex min-w-0 flex-1 flex-col">
              <Topbar locations={locations ?? []} />
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
    </PermissionProvider>
  );
}
