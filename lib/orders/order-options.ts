import "server-only";
import { createClient } from "@/lib/supabase/server";

/**
 * "Which sales order is this document about?" — one answer, for every Orders
 * screen that asks.
 *
 * ## Why this exists
 *
 * Six screens made the operator TYPE A UUID. `order-booking`,
 * `contract-review`, `due-date-confirmations`, `excess-orders`, `pack-ratios`
 * and `price-confirmation` each rendered
 *
 *     <Label>Sales Order ID *</Label>
 *     <Input value={form.sales_order_id} placeholder="UUID" />
 *
 * which nobody can fill in from memory and nothing on the screen offers. The
 * forms were unusable rather than merely awkward, and each one had reinvented
 * the same dead end — so the fix is one loader, not six pickers.
 *
 * `material-bom-amendment/service.ts` already had the shape (its own
 * `getAcceptedOrdersForBom`); it stays where it is because it also needs
 * `order_qty` for the calculated-quantities projection, which no other screen
 * does. This is the shared, minimal version.
 *
 * ## Cancelled and closed orders are INACTIVE, not absent
 *
 * A cancelled order must not be offered when starting a new document — but a
 * document that already names one has to keep reading correctly. Filtering them
 * out in SQL satisfies the first half and breaks the second: the stored value
 * resolves to nothing, the field renders empty, and the next save blanks the FK.
 * That is AGENTS.md's "Disabled rows" rule, and the reason the flag travels with
 * the row instead of the row being dropped — `DataPicker` hides an `inactive`
 * row from the list while `RecordPicker` still resolves and greys a stored one.
 */

/** Shaped for `RecordPicker` — `PickerItem & Deactivatable`. */
export type OrderOption = {
  id: string;
  code: string | null;
  name: string;
  inactive: boolean;
};

/** A sales order that can no longer start a new document. */
const CLOSED_STATUSES = new Set(["cancelled", "closed"]);

export async function listOrderOptions(): Promise<OrderOption[]> {
  const s = await createClient();
  const { data } = await s
    .from("sales_orders")
    .select("id, order_number, status, buyers(name)")
    .order("created_at", { ascending: false });

  return ((data ?? []) as unknown as {
    id: string;
    order_number: string | null;
    status: string | null;
    buyers: { name: string } | null;
  }[]).map((o) => {
    const buyer = o.buyers?.name ?? null;
    return {
      id: o.id,
      code: o.order_number,
      // What the operator READS in the list, so it leads with the number they
      // know the order by and carries the buyer only as the disambiguator. The
      // picker sorts on this field, which is why the number comes first — sorted
      // by buyer, two orders for the same customer are indistinguishable until
      // you read to the end of the line.
      name: [o.order_number ?? "(no order number)", buyer].filter(Boolean).join(" — "),
      inactive: CLOSED_STATUSES.has((o.status ?? "").trim().toLowerCase()),
    };
  });
}
