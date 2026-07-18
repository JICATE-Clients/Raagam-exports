import { requirePermission } from "@/lib/auth/server";
import { PageHeader } from "@/components/ui/page-header";
import { listOrderBookings } from "@/lib/orders/booking-service";
import { OrderBookingClient } from "./order-booking-client";

export default async function OrderBookingPage() {
  await requirePermission("orders", "view");
  const rows = await listOrderBookings();

  return (
    <div className="space-y-4">
      <PageHeader
        title="Order Booking"
        description="Formal order confirmations with certifications and shipping terms."
      />
      <OrderBookingClient rows={rows} />
    </div>
  );
}
