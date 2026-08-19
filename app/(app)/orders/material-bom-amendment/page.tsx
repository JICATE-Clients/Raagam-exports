import { redirect } from "next/navigation";

/**
 * RENAMED TO `/orders/material-bom` (client 2026-08-19: "the routing also is
 * wrong — the Material BOM, this one is new, not an amendment").
 *
 * The screen creates a material BOM for a confirmed order. It never was an
 * amendment screen: it has one door, and the revision case is handled in place
 * by `bomStatus`'s `recalculate` state rather than by a second route. The word
 * came from the underlying table, `material_bom_amendments` (0265), which took
 * its name from the legacy RP-Software screen — so the URL was naming the
 * storage rather than the work.
 *
 * A REDIRECT, NEVER A DELETION. That is the standing rule for a screen that
 * loses its URL: every bookmark and deep link still has to land somewhere. The
 * pairing is asserted rather than trusted — `REDIRECTED` in
 * `scripts/check-module-groups.mts` names this route AND its target, and the
 * check fails if either this page or the `redirect(...)` below goes missing.
 *
 * ONLY THE ROUTE MOVED. `lib/orders/material-bom-amendment/` and the
 * `material_bom_amendments` table keep their names: renaming those is an import
 * sweep and a migration with nothing user-visible at the end of it, and the
 * comments in `bom-status.ts` and `bom-order-basis.ts` already point at the
 * folder by name. The client's report was about the URL.
 *
 * No `requirePermission` here — the target page runs the Orders view gate
 * itself, and refusing on the way out would deny an operator who is allowed to
 * see the screen they are being sent to.
 */
export default function MaterialBomAmendmentRedirectPage() {
  redirect("/orders/material-bom");
}
