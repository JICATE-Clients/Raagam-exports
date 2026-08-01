import { requirePermission } from "@/lib/auth/server";
import { PageHeader } from "@/components/ui/page-header";
import { listOrderBookings } from "@/lib/orders/booking-service";
import { OrderBookingClient } from "./order-booking-client";

export default async function OrderBookingPage() {
  await requirePermission("orders", "view");
  // The Certifications checkbox list used to be fetched here from the
  // `certifications` master. That master was removed (2026-08-01, client) and
  // the section with it — a picker whose only source of options is gone offers
  // nothing and can never be filled. `order_booking_certifications` still holds
  // whatever earlier bookings recorded.
  const rows = await listOrderBookings();

  return (
    <div className="space-y-4">
      <PageHeader
        title="Order Booking"
        description="Formal order confirmations with shipping terms."
      />
      <OrderBookingClient rows={rows} />
    </div>
  );
}
