import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/server";
import { getRejectionPrint } from "@/lib/purchase/rejection-print";
import { RejectionDcPrintSheet } from "@/components/purchase/rejection-dc-print-sheet";
import { PoPrintToolbar } from "@/components/purchase/po-print-toolbar";
import { Card, CardBody } from "@/components/ui/card";

/**
 * THE REJECTION DC PRINT — `/stores/vendor-returns/<id>/print` (doc/purchase/grn.md §2B,
 * grn-plan.md Phase 4): the challan the goods go back on, with the Debit Note copy.
 * A cancelled DC does not print — those goods are not going anywhere.
 */
export default async function RejectionDcPrintPage({ params }: { params: Promise<{ returnId: string }> }) {
  await requirePermission("stores", "view");
  const { returnId } = await params;
  const data = await getRejectionPrint(returnId);
  if (!data) notFound();

  const back = { href: `/stores/vendor-returns/${returnId}`, label: data.code ?? "Vendor return" };

  if (data.status === "cancelled") {
    return (
      <div className="mx-auto max-w-xl">
        <PoPrintToolbar backHref={back.href} backLabel={back.label} printable={false} />
        <Card>
          <CardBody>
            <h1 className="text-base font-bold">{data.code ?? "This challan"} is cancelled</h1>
            <p className="mt-1 text-sm text-muted-foreground">A cancelled return is not sent, so it does not print.</p>
            <Link href={back.href} className="mt-3 inline-block text-sm font-semibold text-[#037bb8] hover:underline">
              Open the return
            </Link>
          </CardBody>
        </Card>
      </div>
    );
  }

  return (
    <div>
      <PoPrintToolbar backHref={back.href} backLabel={back.label} />
      <RejectionDcPrintSheet data={data} />
    </div>
  );
}
