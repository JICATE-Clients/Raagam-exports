import Link from "next/link";
import { buttonClasses } from "@/components/ui/button";

/**
 * "+ Raise Revision" on an APPROVED order's lock banner (user 2026-09-24).
 *
 * A LINK, NOT AN ACTION. The Order Revisions register is the one door a
 * revision is raised through (user 2026-09-23: Order Entry's three-dot menu
 * carries no Amend items), so this only shortens the walk to it — it lands on
 * the register's raise page with this order already picked, and the entry's
 * modules and mandatory remarks are still asked there. Raising from here would
 * be a second door with none of those questions.
 *
 * `orderId` is the garment order's id — the same key the lock maps use and the
 * `?order=` the raise page reads.
 */
export function RaiseRevisionLink({ orderId }: { orderId: string }) {
  return (
    <Link
      href={`/orders/order-amendments/new?order=${orderId}`}
      className={buttonClasses({ size: "sm", className: "shrink-0" })}
    >
      + Raise Revision
    </Link>
  );
}
