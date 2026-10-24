import { hasPermission, type Action, type AppUser } from "@/lib/auth/types";

/**
 * THE ONE PLACE the spec's Resolve Hub keys are spelled as RBAC actions
 * (doc/resolve/resolve-hub-plan.md §3). The permission tree only offers the
 * fixed six actions, so the spec's five keys borrow five of them:
 *
 *   view      → resolve:view     report a problem, see your own reports (every role)
 *   work      → resolve:edit     claim / start / fix jobs
 *   triage    → resolve:approve  assign, spot-check, cancel, reclassify
 *   analytics → resolve:export   numbers and the CSV export
 *   admin     → resolve:create   trades, places & QR, teams, routing, unit settings
 *
 * Client-safe: screens call `rhAllows`, server code calls `canRh` / `requireRh`
 * (lib/resolve/auth.ts). Never write `"resolve", "approve"` at a call site.
 */
export const RH = {
  view: "view",
  work: "edit",
  triage: "approve",
  analytics: "export",
  admin: "create",
} as const satisfies Record<string, Action>;

export type RhKey = keyof typeof RH;

export function rhAllows(user: AppUser | null, key: RhKey): boolean {
  return hasPermission(user, "resolve", RH[key]);
}
