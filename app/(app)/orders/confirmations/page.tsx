import { redirect } from "next/navigation";

/**
 * THE CONFIRMATIONS & REVIEW HUB IS GONE (request, 2026-09-04: "meaned remove
 * this sub module" — the whole group, not just its Contract Review child).
 * This route used to render `GroupHub` for the "confirmations" sub-module —
 * the Confirmations & Review row in `lib/nav/module-groups.ts` — and that
 * group no longer exists there, so there is nothing left for it to render.
 *
 * A REDIRECT, NEVER A DELETION — same standing rule as `changes/page.tsx`
 * beside this one: a bookmark to this hub still has to land somewhere. Its
 * three cards (Due Date Confirmations, Contract Review, Price Confirmation)
 * are unchanged and now live as plain children of the `retired` group, so
 * `/orders/retired` is where an operator finds them. `REDIRECTED` in
 * `scripts/check-module-groups.mts` names this route and its target, and the
 * check fails if either this page or the `redirect(...)` below goes missing.
 *
 * No `requirePermission` here, for the same reason as its neighbour: the
 * target page runs the Orders view gate itself.
 */
export default function ConfirmationsHubRedirectPage() {
  redirect("/orders/retired");
}
