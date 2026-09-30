"use client";

import { createContext, useContext, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { screenOfPath } from "@/lib/permissions/screen-catalog";
import {
  type AppUser,
  type Module,
  type Action,
  hasPermission,
} from "./types";

const PermissionContext = createContext<AppUser | null>(null);

/** Seeded once in the app shell from the server-loaded user. */
export function PermissionProvider({
  user,
  children,
}: {
  user: AppUser;
  children: ReactNode;
}) {
  return (
    <PermissionContext.Provider value={user}>
      {children}
    </PermissionContext.Provider>
  );
}

export function useAppUser(): AppUser {
  const user = useContext(PermissionContext);
  if (!user) {
    throw new Error("useAppUser must be used within a PermissionProvider");
  }
  return user;
}

/** Client-side permission check, e.g. usePermission("orders", "approve").
 *  Screen-aware (0658): it answers for the screen the browser is on, the same
 *  rule `can()` applies on the server for that page. */
export function usePermission(module: Module, action: Action): boolean {
  const user = useContext(PermissionContext);
  const pathname = usePathname();
  return hasPermission(user, module, action, screenOfPath(pathname));
}
