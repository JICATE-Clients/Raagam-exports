"use client";

import { createContext, useContext, type ReactNode } from "react";

/**
 * WHICH SKIN A SUBTREE IS WEARING, carried as CONTEXT rather than read off the
 * DOM — because the thing that needs it is a PORTAL.
 *
 * `[data-skin="raagam"]` in `app/globals.css` is a descendant selector, so it
 * reaches everything rendered inside the wrapper `app/(app)/orders/layout.tsx`
 * puts up. A `Sheet` breaks that: it `createPortal`s to `document.body`, which
 * is OUTSIDE that wrapper in the DOM however deep inside it the sheet sits in
 * the render tree. So Combos ▸ Detail opened a dialog with grey borders, square
 * corners and the stock blue Save, beside a screen wearing none of those
 * (client 2026-09-02: "if i click the detail it shows like this ur ui change
 * didn't get applied here").
 *
 * REACT CONTEXT IS THE ONE THING THAT CROSSES A PORTAL. A portal moves the DOM
 * node and keeps the render tree, so context passes straight through it — which
 * is the same property `RequiredScope` in `sheet.tsx` already relies on, in the
 * opposite direction (it RESETS at the boundary because context would otherwise
 * leak in). Reading `closest("[data-skin]")` from the sheet would not work: by
 * then the node is a child of `document.body` and has no skinned ancestor.
 *
 * The provider renders the wrapper as well, so a screen declares the skin once
 * and both halves — the DOM attribute for the descendant rules, and the context
 * for anything that portals out — cannot drift apart.
 */
const SkinContext = createContext<string | null>(null);

/** The skin the calling subtree is in, or null. Safe outside a provider. */
export function useSkin(): string | null {
  return useContext(SkinContext);
}

/**
 * `display: contents` IS LOAD-BEARING, not tidiness — this wraps every page of a
 * module, and a real box here lands in the middle of the app shell's
 * `flex h-screen overflow-hidden` > `flex min-w-0 flex-1 flex-col`, so any page
 * sizing against its parent would start measuring against this instead. With
 * `display: contents` the element stays in the DOM — so `[data-skin] …` still
 * matches and the custom properties still inherit — while generating no box to
 * affect sizing, scrolling or stacking with.
 */
export function SkinProvider({
  skin,
  children,
}: {
  skin: string;
  children: ReactNode;
}) {
  return (
    <SkinContext.Provider value={skin}>
      <div data-skin={skin} style={{ display: "contents" }}>
        {children}
      </div>
    </SkinContext.Provider>
  );
}
