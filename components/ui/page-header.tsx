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
  /**
   * NO VISIBLE TITLE OR DESCRIPTION, ON ANY PAGE (user 2026-10-01, quoting
   * "Garment Orders — styles, colours, prices, packing, quantities &
   * logistics": "remove the page heading from everywhere totally", and asked to
   * confirm, "every page in the app").
   *
   * Removed HERE, once, rather than at 233 call sites — the sidebar row and the
   * workspace tab already name the screen, so the heading was a third copy of
   * the name and a sentence nobody read, costing ~60px above every list.
   *
   * `title` IS STILL RENDERED, as a screen-reader-only `<h1>`: a page with no
   * heading at all leaves assistive tech nothing to land on, and the prop
   * stays required so the name is still declared at every call site — putting
   * the visible heading back is this one component. `description` is accepted
   * and ignored for the same reason (no call site has to change).
   *
   * With no Back link and no actions the header renders NOTHING visible and
   * takes no margin, so a page's content starts at the top.
   */
  void description;
  const heading = <h1 className="sr-only">{title}</h1>;
  if (!backLink && !actions) return heading;
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
      /* FLOATED RIGHT, SO THE NEXT ROW COMES UP BESIDE IT (user 2026-10-01,
         screenshot 3221: "see the gap?"). With the title gone a block header
         was a whole line holding three buttons on the right and nothing on the
         left, above a toolbar holding nothing on ITS right. A float lets the
         following content rise into that line, and a flex/grid toolbar
         (`FilterBar`'s row, `MasterListShell`'s, `DataIoToolbar`'s) is a
         block formatting context, so it NARROWS to sit beside the float rather
         than running underneath it. `mb-2` keeps a row's gap below the
         buttons when what follows is taller than the toolbar line.
         Phone: a full-width block again (`max-sm:`), as before. */
      className="float-right mb-2 ml-3 flex flex-wrap items-start justify-end gap-3 max-sm:float-none max-sm:mb-3 max-sm:ml-0"
    >
      {/* The visible title block (24px extrabold `ty-page-title` + its
          description) lived here until 2026-10-01 — see the note above. */}
      {heading}
      {/* Back leads the row, then the screen's own actions. Rendered whenever
          EITHER exists — a listing that passes no `actions` (its toolbar lives
          in `MasterListShell` below the header) must still get its way out. */}
      {/* WRAPS, AND NO LABEL BREAKS (2026-09-24, phone at 390px): the row was a
          bare `flex`, so two buttons that did not fit SHRANK and each label broke
          across two lines — "← Back to Order / Management" beside "Raise /
          Revision". A button that does not fit now moves to the next line whole. */}
      {(backLink || actions) && (
        <div className="flex flex-wrap items-center gap-2 [&_a]:whitespace-nowrap [&_button]:whitespace-nowrap">
          {backLink}
          {actions}
        </div>
      )}
    </div>
  );
}
