import { redirect } from "next/navigation";

/**
 * Order Profit Check moved to `/orders/profit-check` (user 2026-10-01: "update
 * the link too"). A screen that changes its URL keeps the old one as a
 * redirect, never a 404 — bookmarks and shared links still land.
 */
export default function ProfitabilityRedirect() {
  redirect("/orders/profit-check");
}
