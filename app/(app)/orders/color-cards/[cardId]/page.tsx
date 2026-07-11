import { notFound } from "next/navigation";
import Link from "next/link";
import { requirePermission, can } from "@/lib/auth/server";
import {
  getColorCard,
  getColorCardColors,
} from "@/lib/orders/color-cards/service";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { ColorCardDetail } from "./color-card-detail";

export default async function ColorCardDetailPage({
  params,
}: {
  params: Promise<{ cardId: string }>;
}) {
  await requirePermission("orders", "view");
  const { cardId } = await params;

  const [card, colors, canEdit, canDelete] = await Promise.all([
    getColorCard(cardId),
    getColorCardColors(cardId),
    can("orders", "edit"),
    can("orders", "delete"),
  ]);

  if (!card) notFound();

  return (
    <div className="space-y-4">
      <PageHeader
        title={card.name}
        description={`${card.code ?? "—"} · ${card.buyers?.name ?? "Unknown buyer"}`}
        actions={
          <Link href={`/orders/color-cards/customer/${card.buyer_id}`}>
            <Button variant="outline" size="sm">
              ← {card.buyers?.name ?? "Customer"} cards
            </Button>
          </Link>
        }
      />

      <ColorCardDetail
        card={card}
        colors={colors}
        canEdit={canEdit}
        canDelete={canDelete}
      />
    </div>
  );
}
