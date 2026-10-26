import "server-only";
import { can, requirePermission } from "@/lib/auth/server";
import type { AppUser } from "@/lib/auth/types";
import { RH, type RhKey } from "./permissions";

/** Boolean Resolve Hub permission check for server code (screen-aware). */
export function canRh(key: RhKey): Promise<boolean> {
  return can("resolve", RH[key]);
}

/** Resolve Hub permission or redirect — for pages. Actions use `canRh`. */
export function requireRh(key: RhKey): Promise<AppUser> {
  return requirePermission("resolve", RH[key]);
}
