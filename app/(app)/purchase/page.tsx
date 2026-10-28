import { redirect } from "next/navigation";
import { requirePermission, can } from "@/lib/auth/server";

/* PURCHASE OPENS ON RAISE PO (user 2026-10-28: "remove this page, direct list
   the raise po screen"). The module row used to land on a hand-maintained card
   grid duplicating the sidebar's own rows — the same reason Administration
   opens on Users. Raise PO asks `create`, the module only `view`, so a
   view-only operator lands on Purchase Orders rather than being sent to a
   screen the gate would refuse one hop later. */
export default async function PurchasePage() {
  await requirePermission("materials_purchase", "view");
  if (await can("materials_purchase", "create")) {
    redirect("/purchase/requirement-po");
  }
  redirect("/purchase/orders");
}
