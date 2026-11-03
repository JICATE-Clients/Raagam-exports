"use client";

import { usePathname } from "next/navigation";
import { useRecordTabTitle } from "@/lib/workspace-tabs";
import { recordTabTitle, screenTitleForPath } from "@/components/shell/workspace-tabs-bar";

/**
 * Names a record page's workspace tab by its entry number — "GRN/26-27/0004 · Purchase
 * Receipts (GRN)" instead of the route's uuid (screenshot 4001).
 *
 * Two ways a record reaches the screen:
 * - its own route (`/purchase/grn/<id>`): `PageHeader` renders this with its title, so no detail
 *   page opts in; it does nothing off a record route.
 * - INSIDE a list page (`/purchase/dc?view=<id>`, screenshot 4002): the route is the list's, so
 *   nothing in the path says a record is open. The in-page view renders this with `inPage`, and
 *   the tab goes back to the screen's name when the view closes.
 */
export function RecordTabTitle({ entry, inPage = false }: { entry: string | null | undefined; inPage?: boolean }) {
  const pathname = usePathname();
  const screen = screenTitleForPath(pathname);
  const title = !entry ? null : inPage ? `${entry} · ${screen}` : recordTabTitle(pathname, entry);
  useRecordTabTitle({ href: pathname, title, restore: inPage ? screen : undefined });
  return null;
}
