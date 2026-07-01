"use client";

import { useState } from "react";
import { Bell, ChevronDown, LogOut } from "lucide-react";
import { signOut } from "@/lib/auth/actions";
import { useAppUser } from "@/lib/auth/permission-context";
import { cn } from "@/lib/utils";

interface Location {
  id: string;
  code: string;
  name: string;
}

export function Topbar({ locations }: { locations: Location[] }) {
  const user = useAppUser();
  const [menuOpen, setMenuOpen] = useState(false);
  const [locationId, setLocationId] = useState(
    user.defaultLocationId ?? locations[0]?.id ?? "",
  );

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-surface px-4">
      {/* Location switcher (two GST entities) */}
      <div className="flex items-center gap-2">
        <span className="hidden text-xs text-muted-foreground sm:inline">
          Location
        </span>
        <select
          value={locationId}
          onChange={(e) => setLocationId(e.target.value)}
          className="h-8 rounded-md border border-border bg-surface px-2 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {locations.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
      </div>

      <div className="flex items-center gap-1">
        <button
          type="button"
          className="relative flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-surface-muted"
          aria-label="Alerts"
        >
          <Bell className="h-4 w-4" />
        </button>

        <div className="relative">
          <button
            type="button"
            onClick={() => setMenuOpen((o) => !o)}
            className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-surface-muted"
          >
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
              {(user.fullName ?? user.email ?? "?").charAt(0).toUpperCase()}
            </span>
            <span className="hidden max-w-[10rem] truncate sm:inline">
              {user.fullName ?? user.email}
            </span>
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          </button>

          {menuOpen && (
            <>
              <div
                className="fixed inset-0 z-10"
                onClick={() => setMenuOpen(false)}
              />
              <div className="absolute right-0 top-full z-20 mt-1 w-56 rounded-md border border-border bg-surface p-1 shadow-lg">
                <div className="border-b border-border px-3 py-2">
                  <p className="truncate text-sm font-medium">
                    {user.fullName ?? "—"}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {user.email ?? user.phone}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {user.isSuperAdmin
                      ? "Super Admin"
                      : user.roleNames.join(", ") || "No roles assigned"}
                  </p>
                </div>
                <form action={signOut}>
                  <button
                    type="submit"
                    className={cn(
                      "flex w-full items-center gap-2 rounded px-3 py-2 text-sm",
                      "text-foreground hover:bg-surface-muted",
                    )}
                  >
                    <LogOut className="h-4 w-4" /> Sign out
                  </button>
                </form>
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
