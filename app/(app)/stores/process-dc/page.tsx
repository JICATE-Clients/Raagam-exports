import { redirect } from "next/navigation";

/**
 * Moved 2026-10-31 into the one Delivery Challans hub (Purchase ▸ Receiving ▸ Delivery
 * Challans): the register, the Send form and Receive back now open there in a drawer. Old
 * links keep working — each maps onto the hub's own address.
 */
export default async function ProcessDcPage({
  searchParams,
}: {
  searchParams: Promise<{ send?: string; order?: string; receive?: string }>;
}) {
  const { send, order, receive } = await searchParams;
  if (receive) redirect(`/purchase/dc?receive=${receive}&type=process`);
  if (send === "new") redirect(`/purchase/dc?new=process&type=process${order ? `&order=${order}` : ""}`);
  if (send) redirect(`/purchase/dc?edit=${send}&type=process`);
  redirect("/purchase/dc?type=process");
}
