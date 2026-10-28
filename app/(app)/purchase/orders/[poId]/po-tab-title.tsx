"use client";

import { useRegisterWorkspaceTab } from "@/lib/workspace-tabs";

/** Names the PO page's workspace tab by its PO number — the route's last segment is a
 *  uuid, which is what the tab bar falls back to (screenshot 3818: "90c423f4 4f73 …"). */
export function PoTabTitle({ href, title }: { href: string; title: string }) {
  useRegisterWorkspaceTab({ href, title });
  return null;
}
