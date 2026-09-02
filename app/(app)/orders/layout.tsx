import type { ReactNode } from "react";

import { SkinProvider } from "@/components/ui/skin";

/**
 * THE ORDERS MODULE WEARS THE RAAGAM SKIN.
 *
 * The skin itself is `[data-skin="raagam"]` in `app/globals.css` — token
 * overrides plus a handful of rules keyed on PRIMITIVES (`[data-card]`,
 * `[role="tab"]`, `input`, `label.block`, `[data-grid-card]`,
 * `[data-md-list-item]`). None of it names a screen, which is why turning it on
 * for a whole module is this file and nothing else.
 *
 * IT WAS PROVEN ON ONE SCREEN FIRST. Material BOM carried the only
 * `data-skin` wrapper in the app from 2026-08-28 while the client settled the
 * colours and shapes ("in material bom only change this edit if it's okay we can
 * chnaged all other things"). That wrapper is now GONE from
 * `mba-master-screen.tsx` — this layout covers it, and two sources for one
 * decision is how they drift.
 *
 * ## IT IS A PROVIDER, NOT JUST A WRAPPER
 *
 * `SkinProvider` renders the `data-skin` div AND puts the same name on React
 * context. The attribute is what the descendant rules in globals.css match; the
 * context is what reaches a `Sheet`, which `createPortal`s to `document.body` and
 * is therefore OUTSIDE this wrapper in the DOM however deep inside it the sheet
 * sits in the render tree. Combos ▸ Detail opened exactly that way and came up
 * unskinned (client 2026-09-02). A portal keeps context, so the sheet re-stamps
 * the attribute on its own root and lands back inside its screen's skin.
 *
 * ## `display: contents` IS LOAD-BEARING, NOT A TIDINESS
 *
 * A route-group layout wraps every page in the module, and this one exists only
 * to carry an attribute. A normal <div> here would insert a box into the middle
 * of the app shell's layout — `app/(app)/layout.tsx` builds
 * `flex h-screen overflow-hidden` > `flex min-w-0 flex-1 flex-col`, and a page
 * that fills its parent's height would suddenly be measuring against this
 * wrapper instead. `display: contents` removes the box while leaving the ELEMENT
 * in the DOM, so:
 *
 *   - descendant selectors (`[data-skin="raagam"] input`) still match, and
 *   - custom properties still inherit through it,
 *
 * which is everything the skin needs and nothing it does not. The element cannot
 * affect sizing, scrolling or stacking because it generates no box to do it with.
 *
 * ## WHAT THIS DOES NOT CARRY
 *
 * Only the LOOK travels. Material BOM's behavioural decisions stay on that
 * screen and must not be swept across the module: `footerOnLastSection` (the
 * button bar only on the last section), `lineLabel` ("Material N"), the rail no
 * longer folding on open, and the captions / placeholders / meta lines removed
 * there. Each was a judgement about that document, not a rule about Orders.
 *
 * ## TO REVERT
 *
 * Delete this file. Every Orders screen returns to the app's default styling in
 * one step, because nothing under `app/(app)/orders` refers to the skin by name.
 */
export default function OrdersSkinLayout({ children }: { children: ReactNode }) {
  return <SkinProvider skin="raagam">{children}</SkinProvider>;
}
