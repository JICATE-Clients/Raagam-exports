import type { ReactNode } from "react";

import { SkinProvider } from "@/components/ui/skin";

/**
 * THE PURCHASE MODULE WEARS THE RAAGAM SKIN (user 2026-10-23: "the UI of the
 * purchase module does not match the order and sample module … the table header
 * bg").
 *
 * The tinted table header, the green field boxes, the green-outlined search and
 * Filters and the button colours of Orders are not in any Orders screen — they are
 * `[data-skin="raagam"]` in `app/globals.css`, switched on by a layout like this
 * one. Purchase had none, so every Purchase screen drew in the app's default look
 * however closely it copied an Orders screen (the trap orders-precedent.md §0
 * records for Sample Entry). One file turns it on for the whole module.
 *
 * Same provider as `app/(app)/orders/layout.tsx` — read that file for why it is a
 * provider and not a bare `<div data-skin>` (a `Sheet` portals out and re-stamps
 * the skin from context) and why it renders `display: contents`.
 *
 * TO REVERT: delete this file; nothing under `app/(app)/purchase` names the skin.
 */
export default function PurchaseSkinLayout({ children }: { children: ReactNode }) {
  return <SkinProvider skin="raagam">{children}</SkinProvider>;
}
