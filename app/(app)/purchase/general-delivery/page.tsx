import { redirect } from "next/navigation";

/**
 * PURCHASE ▸ PURCHASE STORE ▸ GENERAL DELIVERY left the sidebar 2026-11-04 (user: "all
 * outward material dispatches are handled in a single Delivery Challan workspace"). A General
 * DC (0796) was always a kind of the ONE Delivery Challan, so its row only ever opened the hub
 * on the General tab — two sidebar rows, one screen. The address answers so bookmarks land on
 * that tab. Its print page (`[dcId]/print`) and send form (`_components`) stay where they are:
 * the hub renders the form, and the register's Print links point at the print page.
 */
export default function GeneralDeliveryPage() {
  redirect("/purchase/dc?type=general");
}
