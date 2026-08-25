import { ClipboardList } from "lucide-react";
import { requirePermission } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import {
  OrderDocumentError,
  OrderDocumentGrid,
  type OrderDocumentCard,
} from "@/components/reports/order-document-grid";
import { fmtDate, fmtDateTime, fmtNumber } from "@/lib/format";

/**
 * WHICH ORDER'S REQUIREMENT? — the chooser in front of a per-order document.
 *
 * The Accessories Requirement is a sheet for ONE order, signed by three people
 * and handed to a supplier. It lives at `/orders/<id>/requirement`, beside the
 * Garment Order Sheet, because that is what it is a view of.
 *
 * ## SO WHY IS IT IN REPORTS AT ALL
 *
 * Because that is where people looked for it (2026-08-25). A document nobody can
 * find is a document nobody uses, and "it is architecturally a document, not a
 * report" is a true sentence that does not help an operator holding a purchase
 * deadline. The card costs this page; giving up costs the feature.
 *
 * ## IT LISTS ORDERS THAT CAN ACTUALLY PRODUCE A SHEET
 *
 * A chooser offering orders whose sheet will refuse wastes a click and teaches
 * the operator the feature is broken. So the query is the same one the document
 * makes — the latest NON-DRAFT Material BOM — and when none exist it says why.
 */
export default async function AccessoriesRequirementIndex() {
  await requirePermission("orders", "view");
  const s = await createClient();

  const { data, error } = await s
    .from("material_bom_amendments")
    .select(
      "id, code, amendment_no, amend_date, computed_at, computed_for_qty, sales_order_id, " +
        "customer:customers(name), sales_order:sales_orders(order_number)",
    )
    .eq("is_draft", false)
    .order("created_at", { ascending: false });

  type Row = {
    id: string;
    code: string | null;
    amendment_no: number | null;
    amend_date: string | null;
    computed_at: string | null;
    computed_for_qty: number | null;
    sales_order_id: string | null;
    customer: { name: string } | null;
    sales_order: { order_number: string | null } | null;
  };

  const cards: OrderDocumentCard[] = ((data ?? []) as unknown as Row[])
    .filter((r) => r.sales_order_id)
    .map((r) => ({
      key: r.id,
      href: `/orders/${r.sales_order_id}/requirement`,
      title: r.sales_order?.order_number ?? r.code ?? "—",
      subtitle:
        (r.customer?.name ?? "—") +
        (r.amendment_no != null ? ` · Amendment ${r.amendment_no}` : ""),
      /* WHEN THE FIGURES WERE STORED, not when this page loaded — the same thing
         the sheet's own footer says, so a stale requirement cannot look current
         in one place and dated in the other. */
      meta:
        (r.computed_at ? `stored ${fmtDateTime(r.computed_at)}` : `BOM ${fmtDate(r.amend_date)}`) +
        (r.computed_for_qty != null ? ` · ${fmtNumber(r.computed_for_qty)} pcs` : ""),
    }));

  return (
    <div className="space-y-4">
      <PageHeader
        title="Accessories Requirement"
        description="Pick an order to open its requirement sheet — print, PDF or Excel"
      />
      {error ? (
        <OrderDocumentError message={error.message} />
      ) : (
        <OrderDocumentGrid
          cards={cards}
          icon={ClipboardList}
          empty={{
            title: "No order has a recorded Material BOM yet",
            body: "The requirement sheet prints what a saved BOM stored, so there is nothing to show until one exists. Raise one on Orders ▸ Material BOM and save it.",
            href: "/orders/material-bom",
            action: "Go to Material BOM",
          }}
        />
      )}
    </div>
  );
}
