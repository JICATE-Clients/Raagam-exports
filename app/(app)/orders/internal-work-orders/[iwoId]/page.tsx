import { redirect } from "next/navigation";

/**
 * The old per-IWO detail page. An IWO is now edited as an overlay of its list
 * (2026-09-18), so this route has nothing of its own to show — but a screen
 * that loses its page KEEPS ITS URL (AGENTS.md, the sidebar section), so a
 * bookmark lands on the list rather than a 404.
 */
export default function IwoDetailRedirect() {
  redirect("/orders/internal-work-orders");
}
