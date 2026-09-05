import { type ReactNode } from "react";
import { BackLink } from "@/components/ui/back-link";

export function PageHeader({
  title,
  description,
  actions,
  back = true,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  /**
   * "← Back to <the screen above>", DERIVED and on by default.
   *
   * A child listing screen had no way back to the hub it was opened from
   * (client 2026-08-17): 88 of the 118 registered leaf screens rendered this
   * header with no back affordance at all. The destination is not declared here
   * — `lib/nav/back-target.ts` reads it off the same registry the sidebar and
   * every hub page read, so a screen that changes group changes its own Back,
   * and a new one is correct the day it is registered.
   *
   * ON BY DEFAULT because the alternative was 110 identical call-site edits,
   * which is the fan-out this exists to end. It costs nothing where it does not
   * apply: `backTarget` answers `null` for a module root, a group hub (which
   * draws its own breadcrumb), a document detail route beneath a leaf, and every
   * module outside the registry — so nothing renders on any of them.
   *
   * `back={false}` is for the ONE case the registry cannot see: a screen that
   * swaps a LIST and an EDITOR at the same URL, whose editor branch already
   * shows "← Back to list". There the derived link is a second, differently
   * aimed Back beside the screen's own, on a surface the client has already
   * called cramped. Eight screens are in that shape and they are enumerated,
   * not guessed — `mode === "list"` plus a `setMode(` in the same file, all
   * eight under `/orders`. Pass it on the EDITOR branch only; the list branch
   * is exactly what the default is for.
   */
  back?: boolean;
}) {
  const backLink = back ? <BackLink /> : null;
  return (
    <div
      /**
       * THE PAGE HEADER IS CHROME, NOT FIELDS.
       *
       * `regionOf` resolves through `closest("[data-focus-region]")`, so this one
       * attribute covers every `actions` button on every screen — "← Back to
       * list", "New Amendment", a Download — wherever a PageHeader sits inside a
       * `data-focus-scope`.
       *
       * Without it those buttons default to `"content"` and sort WITH the fields,
       * so Tab off the last field of a page editor lands on "← Back to list"
       * rather than wrapping. That is the same rule the keyboard contract states
       * for a Sheet's ✕ ("an unmarked ✕ sorts with the fields: stamp the
       * header"), applied where ~51 page-level editors need it.
       *
       * Inert outside an editor: a list page declares no focus scope, so nothing
       * reads this and native Tab order is unchanged.
       */
      data-focus-region="header"
      /* `mb-3`, down from `mb-4` (client 2026-09-05: "compact it" — this
         component sits above every page in the app, so a smaller step than
         the footer's, applied here rather than per screen. */
      className="mb-3 flex flex-wrap items-start justify-between gap-3"
    >
      <div>
        <h1 className="text-xl font-semibold text-foreground">{title}</h1>
        {description && (
          <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {/* Back leads the row, then the screen's own actions. Rendered whenever
          EITHER exists — a listing that passes no `actions` (its toolbar lives
          in `MasterListShell` below the header) must still get its way out. */}
      {(backLink || actions) && (
        <div className="flex items-center gap-2">
          {backLink}
          {actions}
        </div>
      )}
    </div>
  );
}
