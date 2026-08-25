import Link from "next/link";
import { ClipboardList } from "lucide-react";
import { requirePermission } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { fmtDate, fmtDateTime, fmtNumber } from "@/lib/format";

/**
 * WHICH ORDER'S REQUIREMENT? — the chooser in front of a per-order document.
 *
 * The Accessories Requirement is a sheet for ONE order: signed by three people
 * and handed to a supplier. It lives at `/orders/<id>/requirement`, beside the
 * Garment Order Sheet, because that is what it is a view of.
 *
 * ## SO WHY IS IT IN REPORTS AT ALL
 *
 * Because that is where people looked for it (2026-08-25). A document nobody can
 * find is a document nobody uses, and "it is architecturally a document, not a
 * report" is a true sentence that does not help an operator holding a purchase
 * deadline. The catalog entry costs one card and this page; giving up costs the
 * feature.
 *
 * This is the "order picker in front of it" that `orders/[orderId]/page.tsx`
 * names as the reason these sheets are header actions rather than sidebar rows.
 * It is not a second copy of the document — every row here is a LINK to the one
 * that already exists.
 *
 * ## IT LISTS ORDERS THAT HAVE A BOM, AND SAYS SO WHEN NONE DO
 *
 * A chooser offering orders whose sheet will refuse is a chooser that wastes a
 * click and teaches the operator the feature is broken. So it lists the orders
 * that can actually produce a sheet, and when there are none it says WHY and
 * where to go — rather than rendering an empty list that reads as "no orders".
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
  const rows = ((data ?? []) as unknown as Row[]).filter((r) => r.sales_order_id);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Accessories Requirement"
        description="Pick an order to open its requirement sheet — print, PDF or Excel"
      />

      {/* A FAILED QUERY IS NOT AN EMPTY LIST. Saying "no orders" when the read
          failed sends the operator to raise a BOM that already exists. */}
      {error ? (
        <Card>
          <CardBody>
            <p className="text-sm font-medium">Could not read the Material BOMs</p>
            <p className="mt-1 text-sm text-muted-foreground">{error.message}</p>
          </CardBody>
        </Card>
      ) : rows.length === 0 ? (
        <Card>
          <CardBody>
            <p className="text-sm font-medium">No order has a recorded Material BOM yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              The requirement sheet prints what a saved BOM stored, so there is nothing to show
              until one exists. Raise one on Orders ▸ Material BOM and save it.
            </p>
            <div className="mt-3">
              <Link href="/orders/material-bom">
                <Button variant="outline" size="md">
                  Go to Material BOM
                </Button>
              </Link>
            </div>
          </CardBody>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((r) => (
            <Link key={r.id} href={`/orders/${r.sales_order_id}/requirement`} className="block">
              <Card className="h-full transition-colors hover:border-primary">
                <CardBody className="flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                    <ClipboardList className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <h2 className="truncate text-sm font-semibold text-foreground">
                      {r.sales_order?.order_number ?? r.code ?? "—"}
                    </h2>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      {r.customer?.name ?? "—"}
                      {r.amendment_no != null ? ` · Amendment ${r.amendment_no}` : ""}
                    </p>
                    {/* WHEN THE FIGURES WERE STORED, not when this page loaded —
                        the same thing the sheet's own footer says, for the same
                        reason: a stale requirement must not look current. */}
                    <p className="mt-1 truncate font-mono text-[11px] text-muted-foreground">
                      {r.computed_at
                        ? `stored ${fmtDateTime(r.computed_at)}`
                        : `BOM ${fmtDate(r.amend_date)}`}
                      {r.computed_for_qty != null
                        ? ` · ${fmtNumber(r.computed_for_qty)} pcs`
                        : ""}
                    </p>
                  </div>
                </CardBody>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
