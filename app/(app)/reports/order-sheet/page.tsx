import { FileText } from "lucide-react";
import { requirePermission } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import {
  OrderDocumentError,
  OrderDocumentGrid,
  type OrderDocumentCard,
} from "@/components/reports/order-document-grid";
import { fmtDate } from "@/lib/format";

/**
 * WHICH ORDER'S SHEET? — the chooser in front of the Garment Order Sheet.
 *
 * The sibling of `/reports/accessories-requirement`, and deliberately its twin:
 * the two documents are the pair a merchandiser works from — construction on one
 * sheet, purchase on the other — so an operator who finds one must recognise the
 * other without being told. Two cards in the catalog, one grid component, one
 * empty-state shape.
 *
 * ## IT LISTS GARMENT ORDERS, NOT SALES ORDERS
 *
 * `getGarmentOrderSheet` refuses an order with no garment order entered against
 * it — "there is nothing to print". So the chooser asks the same question the
 * document does and offers only rows that can answer it, rather than listing all
 * 91 sales orders and letting most of them dead-end.
 *
 * ## ONE ROW PER ORDER, NOT PER AMENDMENT
 *
 * An order may carry several garment order amendments; the sheet resolves the
 * CURRENT one itself (`gos/page.tsx`: "a URL pointing at a superseded amendment
 * would hand somebody a sheet that is wrong in a way nothing on it admits"). So
 * the chooser keys on the order and lets the document pick — offering one card
 * per amendment would be offering to print a superseded directive.
 */
export default async function OrderSheetIndex() {
  await requirePermission("orders", "view");
  const s = await createClient();

  const { data, error } = await s
    .from("garment_order_amendments")
    .select(
      "id, code, amend_date, delivery_date, sales_order_id, " +
        "customer:customers(name), sales_order:sales_orders(order_number)",
    )
    .eq("is_draft", false)
    .order("created_at", { ascending: false });

  type Row = {
    id: string;
    code: string | null;
    amend_date: string | null;
    delivery_date: string | null;
    sales_order_id: string | null;
    customer: { name: string } | null;
    sales_order: { order_number: string | null } | null;
  };

  /* DE-DUPLICATED ON THE ORDER. Rows arrive newest-first, so the first one seen
     for an order is its current amendment — which is the one the document would
     resolve to anyway. */
  const seen = new Set<string>();
  const cards: OrderDocumentCard[] = [];
  for (const r of (data ?? []) as unknown as Row[]) {
    const so = r.sales_order_id;
    if (!so || seen.has(so)) continue;
    seen.add(so);
    cards.push({
      key: r.id,
      href: `/orders/${so}/gos`,
      title: r.sales_order?.order_number ?? r.code ?? "—",
      subtitle: r.customer?.name ?? "—",
      meta:
        (r.amend_date ? `order ${fmtDate(r.amend_date)}` : "") +
        (r.delivery_date ? ` · delivery ${fmtDate(r.delivery_date)}` : ""),
    });
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Garment Order Sheet"
        description="Pick an order to open its order sheet — styles, structures, components"
      />
      {error ? (
        <OrderDocumentError message={error.message} />
      ) : (
        <OrderDocumentGrid
          cards={cards}
          icon={FileText}
          empty={{
            title: "No garment order has been recorded yet",
            body: "The order sheet prints an entered garment order, so there is nothing to show until one exists. Raise one on Orders ▸ Order Setup ▸ Garment Orders.",
            href: "/orders/garment-orders",
            action: "Go to Garment Orders",
          }}
        />
      )}
    </div>
  );
}
