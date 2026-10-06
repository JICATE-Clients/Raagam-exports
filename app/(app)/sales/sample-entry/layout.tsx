import type { ReactNode } from "react";

import { SkinProvider } from "@/components/ui/skin";

/**
 * SAMPLE ENTRY WEARS THE RAAGAM SKIN, LIKE ORDERS.
 *
 * The spec builds this screen "matching the updated Order Entry interface"
 * (doc/sample/sample-module-specification.md §1), and most of what made it look
 * like a different application side by side with Order Entry was not its markup
 * but this missing wrapper (user 2026-10-06, compared in the browser): the green
 * field boxes, the green-outlined search and Filters, the light-blue primary
 * button, the rail and tab chrome all come from `[data-skin="raagam"]` in
 * `app/globals.css`, which `app/(app)/orders/layout.tsx` turns on for Orders and
 * the Sales module never did.
 *
 * Scoped to THIS ROUTE, not the whole Sales module: the other Sales screens were
 * not part of the request, and skinning them is a separate decision. Read
 * `app/(app)/orders/layout.tsx` for why it is a provider (a Sheet portals out of
 * the wrapper and re-stamps the skin from context) and why `display: contents`.
 */
export default function SampleEntrySkinLayout({ children }: { children: ReactNode }) {
  return <SkinProvider skin="raagam">{children}</SkinProvider>;
}
