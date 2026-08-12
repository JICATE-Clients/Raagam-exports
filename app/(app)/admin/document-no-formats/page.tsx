import { redirect } from "next/navigation";

/**
 * MOVED TO MASTER DATA ▸ SYSTEM (client 2026-08-12).
 *
 * Document No Format is the legacy Configure ▸ System screen. The 2026-07-18
 * dissolution of that submodule filed it under Administration ▸ Organisation;
 * restoring System put the row back where an operator migrating from
 * RP-Software looks for it.
 *
 * A REDIRECT, NEVER A DELETION. That is the standing rule for a screen that
 * loses its sidebar row: every bookmark, deep link and `?tab=` handoff still
 * has to land somewhere. The pairing is asserted rather than trusted —
 * `REDIRECTED` in `scripts/check-module-groups.mts` names this route AND its
 * target, and assertion 6 fails if either the page or the `redirect(...)` call
 * below goes missing. Verified by BREAKING it first: pointed at
 * `/masters/system` and the check reported
 * "declared as redirecting to /masters/system/document-no-format, but does not".
 *
 * No `requirePermission` here: the target page runs the Master Data view gate
 * itself, and checking `system_admin` on the way out would refuse an operator
 * who is allowed to see the screen they are being sent to.
 */
export default function AdminDocumentNoFormatsPage() {
  redirect("/masters/system/document-no-format");
}
