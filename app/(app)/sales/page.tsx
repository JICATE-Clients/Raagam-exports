import { redirect } from "next/navigation";

/**
 * THE OPPORTUNITIES PIPELINE IS RETIRED (user 2026-10-06: "update our new
 * sample entry child and remove the old one"). Sample ▸ Sample Entry
 * (`/sales/sample-entry`, 0683) merges the legacy Create Opportunities and
 * Define Styles into one document over the same `opportunities` table.
 *
 * A REDIRECT, NEVER A DELETION — this is the module root, so the "Sample"
 * sidebar label, every "← Back" link in the module and every bookmark still
 * land somewhere. The QUERY IS CARRIED: the ＋ quick action builds
 * `/sales?new=1&a=…` (`SECTION_ACTIONS["/sales"]`), and dropping it would open
 * the list instead of a new entry. The target runs the Sales view gate itself.
 */
export default async function SalesRootRedirectPage({
  searchParams,
}: {
  searchParams: Promise<{ [k: string]: string | string[] | undefined }>;
}) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(await searchParams)) {
    for (const one of Array.isArray(v) ? v : v == null ? [] : [v]) q.append(k, one);
  }
  const qs = q.toString();
  redirect(`/sales/sample-entry${qs ? `?${qs}` : ""}`);
}
