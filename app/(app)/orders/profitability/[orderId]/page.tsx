import { redirect } from "next/navigation";

/** One order's Profit Check moved to `/orders/profit-check/<order>`; the old link redirects. */
export default async function ProfitabilityOrderRedirect({ params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params;
  redirect(`/orders/profit-check/${orderId}`);
}
