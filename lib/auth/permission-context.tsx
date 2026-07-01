"use client";

import { createContext, useContext, type ReactNode } from "react";
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

/** Client-side permission check, e.g. usePermission("orders", "approve"). */
export function usePermission(module: Module, action: Action): boolean {
  const user = useContext(PermissionContext);
  return hasPermission(user, module, action);
}
