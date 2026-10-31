import { redirect } from "next/navigation";

/** A short address for the Delivery Challans hub (user 2026-10-31); it lives under Purchase ▸ Receiving. */
export default function DeliveryChallansPage() {
  redirect("/purchase/dc");
}
