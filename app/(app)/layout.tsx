import type { ReactNode } from "react";
import { requireUser } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import { PermissionProvider } from "@/lib/auth/permission-context";
import { Sidebar } from "@/components/shell/sidebar";
import { Topbar } from "@/components/shell/topbar";
import { MobileNav } from "@/components/shell/mobile-nav";

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

  return (
    <PermissionProvider user={user}>
      <div className="flex flex-1">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar locations={locations ?? []} />
          <main className="flex-1 overflow-y-auto p-4 pb-20 md:pb-6">
            {children}
          </main>
          <MobileNav />
        </div>
      </div>
    </PermissionProvider>
  );
}
