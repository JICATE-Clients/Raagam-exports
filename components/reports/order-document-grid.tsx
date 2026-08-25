import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { Card, CardBody } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

/**
 * "Which order?" — the picker in front of a per-order document.
 *
 * The Garment Order Sheet and the Accessories Requirement are both sheets for
 * ONE order: signed, and handed to a customer or a supplier. They live on the
 * order (`/orders/<id>/gos`, `/orders/<id>/requirement`) because that is what
 * they are views of, and `orders/[orderId]/page.tsx` records why they are header
 * actions rather than sidebar rows — each "has no list to land on, so a sidebar
 * row would need an order picker in front of it".
 *
 * This is that picker, and it is ONE component because there are two documents.
 * Two choosers would be two empty states, two card layouts and two places for
 * the same wording to drift — and the pair is the point: an operator who finds
 * one should recognise the other instantly.
 *
 * ## WHAT IT DOES NOT DO
 *
 * It does not query. Each page fetches its own rows, because the two documents
 * ask different questions of the database: a Requirement needs a saved Material
 * BOM, a Garment Order Sheet needs a garment order. Folding both into one query
 * would make a component that knows about BOMs in order to render a card.
 *
 * ## AN EMPTY LIST SAYS WHY, AND WHERE TO GO
 *
 * A chooser that renders nothing reads as "there are no orders", which is a
 * different and more alarming statement than "none of them can produce this
 * sheet yet". The caller supplies the sentence and the way out.
 */
export type OrderDocumentCard = {
  key: string;
  href: string;
  title: string;
  subtitle: string | null;
  /** The small mono line — when the figures were stored, or the document's date. */
  meta: string | null;
};

export function OrderDocumentGrid({
  cards,
  icon: Icon,
  empty,
}: {
  cards: OrderDocumentCard[];
  icon: LucideIcon;
  empty: { title: string; body: string; href: string; action: string };
}) {
  if (cards.length === 0) {
    return (
      <Card>
        <CardBody>
          <p className="text-sm font-medium">{empty.title}</p>
          <p className="mt-1 text-sm text-muted-foreground">{empty.body}</p>
          <div className="mt-3">
            <Link href={empty.href}>
              <Button variant="outline" size="md">
                {empty.action}
              </Button>
            </Link>
          </div>
        </CardBody>
      </Card>
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {cards.map((c) => (
        <Link key={c.key} href={c.href} className="block">
          <Card className="h-full transition-colors hover:border-primary">
            <CardBody className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                <Icon className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <h2 className="truncate text-sm font-semibold text-foreground">{c.title}</h2>
                {c.subtitle && (
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">{c.subtitle}</p>
                )}
                {c.meta && (
                  <p className="mt-1 truncate font-mono text-[11px] text-muted-foreground">
                    {c.meta}
                  </p>
                )}
              </div>
            </CardBody>
          </Card>
        </Link>
      ))}
    </div>
  );
}

/** A failed read is not an empty list — saying "none" when the query broke sends
 *  the operator to raise something that already exists. */
export function OrderDocumentError({ message }: { message: string }) {
  return (
    <Card>
      <CardBody>
        <p className="text-sm font-medium">Could not read the orders</p>
        <p className="mt-1 text-sm text-muted-foreground">{message}</p>
      </CardBody>
    </Card>
  );
}
