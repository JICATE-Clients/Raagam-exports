import { redirect } from "next/navigation";

/**
 * MY WORK WAS RETIRED INTO THE TA WORKLIST (user 2026-10-01: "remove that my
 * work, already we have TA Worklist"). Its T&A card WAS the worklist narrowed
 * to "mine"; its approvals and alerts counts now sit at the top of that
 * worklist; every other card (orders, CAD, revisions) already had its own
 * screen. A URL that was handed out keeps working — a redirect, never a 404.
 */
export default function MyWorkRedirect() {
  redirect("/orders/ta-worklist?scope=mine");
}
