import { notFound } from "next/navigation";
import Link from "next/link";
import { requirePermission, can } from "@/lib/auth/server";
import {
  getPackingAdvice,
  getPackingAdviceLines,
} from "@/lib/orders/packing-advice/service";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { PackingAdviceDetail } from "./packing-advice-detail";

export default async function PackingAdviceDetailPage({
  params,
}: {
  params: Promise<{ adviceId: string }>;
}) {
  await requirePermission("orders", "view");
  const { adviceId } = await params;

  const [advice, lines, canEdit, canDelete] = await Promise.all([
    getPackingAdvice(adviceId),
    getPackingAdviceLines(adviceId),
    can("orders", "edit"),
    can("orders", "delete"),
  ]);

  if (!advice) notFound();

  return (
    <div className="space-y-4">
      <PageHeader
        title={`Packing Advice ${advice.code ?? ""}`}
        description={advice.sales_orders?.order_number ?? "Order"}
        actions={
          <Link href="/orders/packing-advice">
            <Button variant="outline" size="sm">
              ← All packing advices
            </Button>
          </Link>
        }
      />

      <PackingAdviceDetail
        advice={advice}
        lines={lines}
        canEdit={canEdit}
        canDelete={canDelete}
      />
    </div>
  );
}
