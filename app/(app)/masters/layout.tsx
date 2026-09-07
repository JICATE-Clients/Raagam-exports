import type { ReactNode } from "react";

import { SkinProvider } from "@/components/ui/skin";

/**
 * MASTER DATA WEARS THE RAAGAM SKIN, on the same terms Orders does.
 *
 * This is the second module to turn it on, and it is deliberately the SAME ONE
 * LINE rather than anything master-specific: the skin is `[data-skin="raagam"]`
 * in `app/globals.css`, keyed entirely on PRIMITIVES (`[data-card]`,
 * `[role="tab"]`, `input`, `label.block`, `[data-grid-card]`,
 * `[data-md-list-item]`). Nothing in it names a screen or a module, which is
 * exactly why extending it costs a file and not a sweep — see
 * `app/(app)/orders/layout.tsx`, which carries the full reasoning.
 *
 * ## WHY IT HAD TO BE THE WHOLE MODULE, NOT JUST HR
 *
 * The report was about the HR masters ("New Allowance" came up with grey
 * borders, square corners and the stock blue Save while Orders wore the skin —
 * client 2026-09-04). Scoping the fix to `/masters/hr` would have answered that
 * screenshot and left a SEAM down the middle of Master Data: Allowance skinned,
 * Yarn and Customer beside it not, with no rule an operator could infer. A look
 * that changes depending on which master you opened is worse than one that is
 * uniformly plain.
 *
 * ## IT REACHES THE SHEETS, WHICH IS THE HALF THAT LOOKS BROKEN
 *
 * Every master edits in a `Sheet`, and a Sheet `createPortal`s to
 * `document.body` — OUTSIDE this wrapper in the DOM however deep inside it the
 * sheet sits in the render tree. A plain wrapper would therefore skin the list
 * behind the sheet and not the sheet itself. `SkinProvider` also puts the name
 * on React CONTEXT, which is the one thing that crosses a portal, and
 * `sheet.tsx` re-stamps `data-skin` on its own root from it. That is why the
 * provider is the thing being rendered here and not a bare
 * `<div data-skin="raagam">`.
 *
 * ## TO REVERT
 *
 * Delete this file. Master Data returns to the app's default styling in one
 * step, because nothing under `app/(app)/masters` refers to the skin by name.
 */
export default function MastersSkinLayout({ children }: { children: ReactNode }) {
  return <SkinProvider skin="raagam">{children}</SkinProvider>;
}
