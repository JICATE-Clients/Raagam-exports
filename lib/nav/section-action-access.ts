import { NAV, SECTION_ACTIONS } from "@/components/shell/nav";
import { screenOfPath } from "@/lib/permissions/screen-catalog";
import { hasPermission, type Action, type AppUser } from "@/lib/auth/types";

/**
 * A QUICK ACTION IS OFFERED ONLY TO SOMEONE WHO MAY DO IT (2026-10-01).
 *
 * `SECTION_ACTIONS` is a flat list of labels with no permission attached, and
 * its three readers — the context sidebar's "+ New …" button, the mobile
 * create sheet and nav search — printed it as-is. So a login granted View +
 * Edit on HR ▸ Staff, and nothing else, was shown "+ New Staff": the page's own
 * button was correctly gated on `can("hr_payroll", "create")` and the sidebar's
 * copy of it was not. The page refused the form, so nothing was written — but
 * a button promising an action the operator does not hold reads as a grant.
 *
 * One filter, read by all three, answered at SCREEN grain (0658) — the same
 * `hasPermission` the page's server gate uses, so a person whose email access
 * grants only some screens of a module is offered only those screens' actions.
 */

/** The permission an action label needs. Creating is the default: every "New …"
 *  and every Import writes rows (Import is gated on `canCreate` on the pages). */
export function actionPermission(label: string): Action {
  if (/^export\b/i.test(label)) return "export";
  // Opens the register to pick an existing record — Find Order to Amend,
  // Configure Rights — so it changes rows and creates none.
  if (/^(find|configure|recalc)/i.test(label)) return "edit";
  return "create";
}

/** `SECTION_ACTIONS[href]`, minus the ones `user` may not perform there. */
export function allowedSectionActions(
  user: Pick<AppUser, "isSuperAdmin" | "permissions" | "moduleMode" | "screenGrants"> | null,
  href: string,
): string[] {
  const actions = SECTION_ACTIONS[href] ?? [];
  if (actions.length === 0) return actions;
  const screen = screenOfPath(href);
  if (screen) {
    return actions.filter((a) => hasPermission(user, screen.module, actionPermission(a), screen));
  }
  // A MODULE ROOT is not a catalog screen (`/sales`, `/orders`, `/logistics`
  // carry actions), so it answers at module grain from its NAV row. Anything
  // else unknown offers nothing — a missing answer is not a grant.
  const mod = NAV.find((m) => m.href === href)?.module;
  if (!mod) return user?.isSuperAdmin ? actions : [];
  return actions.filter((a) => hasPermission(user, mod, actionPermission(a)));
}
