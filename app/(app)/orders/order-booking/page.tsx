import { requirePermission } from "@/lib/auth/server";
import { PageHeader } from "@/components/ui/page-header";
import { listOrderBookings } from "@/lib/orders/booking-service";
import { OrderBookingClient } from "./order-booking-client";
import { createClient } from "@/lib/supabase/server";

export default async function OrderBookingPage() {
  await requirePermission("orders", "view");
  const s = await createClient();
  const [rows, certsRes] = await Promise.all([
    listOrderBookings(),
    s.from("certifications").select("id, certification_name").eq("blocked", false).order("certification_name"),
  ]);
  const certOptions = (certsRes.data ?? []) as { id: string; certification_name: string }[];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Order Booking"
        description="Formal order confirmations with certifications and shipping terms."
      />
      <OrderBookingClient rows={rows} certOptions={certOptions} />
    </div>
  );
}
