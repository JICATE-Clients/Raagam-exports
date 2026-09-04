import { redirect } from "next/navigation";

/**
 * THE AMENDMENTS HUB IS GONE (request, 2026-09-04: "remove the amendment
 * child from order module"). This route used to render `GroupHub` for the
 * "changes" sub-module — the Amendments row in `lib/nav/module-groups.ts` —
 * and that group no longer exists there, so there is nothing left for it to
 * render.
 *
 * A REDIRECT, NEVER A DELETION — same standing rule as
 * `material-bom-amendment/page.tsx` beside this one: a bookmark to this hub
 * still has to land somewhere. Its three cards (Order Amendment, Process
 * Amendment, Approve Amendment) are unchanged and now live as plain children
 * of the `retired` group, so `/orders/retired` is where an operator finds
 * them. `REDIRECTED` in `scripts/check-module-groups.mts` names this route
 * and its target, and the check fails if either this page or the
 * `redirect(...)` below goes missing.
 *
 * No `requirePermission` here, for the same reason as its neighbour: the
 * target page runs the Orders view gate itself.
 */
export default function AmendmentsHubRedirectPage() {
  redirect("/orders/retired");
}
