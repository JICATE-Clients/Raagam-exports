import { redirect } from "next/navigation";

/**
 * PURCHASE ▸ PURCHASE STORE ▸ DEPARTMENT DELIVERY left the sidebar 2026-11-04 (user:
 * "Department Delivery move it to the delivery challans"). It is the Department tab of the one
 * Delivery Challans hub now — its list is in the register and its form opens there
 * (`/purchase/dc?new=department`). The address answers so bookmarks land on that tab.
 */
export default function InterdeptPage() {
  redirect("/purchase/dc?type=department");
}
