import { redirect } from "next/navigation";

/**
 * Moved 2026-10-31 into the one Delivery Challans hub (Purchase ▸ Receiving ▸ Delivery
 * Challans): the register, the Send form and Receive stock now open there in a drawer. Old
 * links keep working — each maps onto the hub's own address.
 */
export default async function ProductionDcPage({
  searchParams,
}: {
  searchParams: Promise<{ send?: string; receive?: string }>;
}) {
  const { send, receive } = await searchParams;
  if (receive) redirect(`/purchase/dc?receive=${receive}&type=production`);
  if (send === "new") redirect("/purchase/dc?new=production&type=production");
  if (send) redirect(`/purchase/dc?edit=${send}&type=production`);
  redirect("/purchase/dc?type=production");
}
