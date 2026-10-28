import { redirect } from "next/navigation";

/* VENDORS LEFT THE PURCHASE MENU (user 2026-10-28). Raise PO picks its vendor
   from the Master Data vendor (`master_vendors`, 0737), so that is the one
   vendor screen; this URL answers as a redirect so no bookmark breaks. */
export default function VendorsPage() {
  redirect("/masters/associates/vendor");
}
