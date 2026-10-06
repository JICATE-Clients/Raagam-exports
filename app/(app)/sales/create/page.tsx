import { redirect } from "next/navigation";

/**
 * RETIRED INTO SAMPLE ENTRY (user 2026-10-06: "update our new sample entry
 * child and remove the old one"). This route served Create Opportunities — By Customer;
 * Sample ▸ Sample Entry (`/sales/sample-entry`, 0683) now does that work.
 *
 * A REDIRECT, NEVER A DELETION — a bookmark or a link to this route still has
 * to land somewhere. The target runs the Sales view gate itself.
 */
export default function RetiredSalesRoutePage() {
  redirect("/sales/sample-entry");
}
