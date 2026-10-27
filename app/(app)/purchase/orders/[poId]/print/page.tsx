import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/server";
import { getPoPrint } from "@/lib/purchase/po-print";
import { PoPrintSheet } from "@/components/purchase/po-print-sheet";
import { PoPrintToolbar } from "@/components/purchase/po-print-toolbar";
import { Card, CardBody } from "@/components/ui/card";

/**
 * THE VENDOR PO PRINT — `/purchase/orders/<id>/print` (user 2026-10-27).
 *
 * PRINTS ONLY ONCE APPROVED. That is the rule Raise PO has stated on its title row
 * from the start ("Print opens after approval", spec point 8): a PO above budget waits
 * for the MD, and a draft is nobody's order yet, so neither may leave the building on
 * paper. Any other status gets the page, not the sheet — with what it is waiting for.
 */
export default async function PoPrintPage({ params }: { params: Promise<{ poId: string }> }) {
  await requirePermission("materials_purchase", "view");
  const { poId } = await params;
  const data = await getPoPrint(poId);
  if (!data) notFound();

  const back = { href: `/purchase/orders/${poId}`, label: data.code ?? "Purchase order" };

  if (data.status !== "approved") {
    const why =
      data.status === "pending_approval"
        ? "It is waiting for the MD's approval — a rate above the approved budget sends a PO to the MD."
        : data.status === "draft"
          ? "It is still a draft. Submit it on Raise PO first."
          : `Its status is ${data.status.replace(/_/g, " ")}.`;
    return (
      <div className="mx-auto max-w-xl">
        <PoPrintToolbar backHref={back.href} backLabel={back.label} printable={false} />
        <Card>
          <CardBody>
            <h1 className="text-base font-bold">{data.code ?? "This purchase order"} cannot be printed yet</h1>
            <p className="mt-1 text-sm text-muted-foreground">Print opens after approval. {why}</p>
            <Link href={back.href} className="mt-3 inline-block text-sm font-semibold text-[#037bb8] hover:underline">
              Open the purchase order
            </Link>
          </CardBody>
        </Card>
      </div>
    );
  }

  return (
    <div>
      <PoPrintToolbar backHref={back.href} backLabel={back.label} />
      <PoPrintSheet data={data} />
    </div>
  );
}
