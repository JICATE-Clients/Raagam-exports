import { notFound } from "next/navigation";
import Link from "next/link";
import { requirePermission } from "@/lib/auth/server";
import { getOrder } from "@/lib/orders/service";
import {
  getOrderChannel,
  getChannelMembers,
  getChannelMessages,
} from "@/lib/orders/community/service";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { CommunityStream } from "@/components/orders/community-stream";
import { CommunityMembers } from "@/components/orders/community-members";

/**
 * RE-Community — one order's collaboration channel (doc/file.md §4).
 *
 * ## `orders:view` GETS YOU TO THE PAGE AND NO FURTHER
 *
 * `requirePermission` here is the ROUTE guard, and it is not the channel guard.
 * Everything below is filtered by RLS on membership (0458 §8), so a holder of
 * `orders:view` who is not a member reaches this page and finds an empty stream
 * and no members — which is correct, and is why the composer says so rather than
 * letting them type into a channel that would refuse the insert.
 *
 * The route is a page rather than a tab on `/orders/[orderId]` on purpose: a
 * conversation is read at full height, and a tab panel inside a detail page
 * would put a scrolling stream inside a scrolling page.
 */
export default async function OrderCommunityPage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  const user = await requirePermission("orders", "view");
  const { orderId } = await params;

  const [order, channel] = await Promise.all([
    getOrder(orderId),
    // GET-OR-CREATE. An order saved before 0458 applied has no channel until
    // somebody opens this page; the trigger also swallows its own failures
    // (0458 §6) so that an order can never fail to save because its chat room
    // could not be made. This call is what heals both.
    getOrderChannel(orderId),
  ]);

  if (!order) notFound();

  const [messages, members] = channel
    ? await Promise.all([
        getChannelMessages(channel.id),
        getChannelMembers(channel.id),
      ])
    : [[], []];

  const isMember = members.some((m) => m.user_id === user.id);

  return (
    <div className="flex h-full flex-col gap-4">
      <PageHeader
        title="RE-Community"
        // The RE Number verbatim, whichever of its two live shapes this order
        // carries (`U2/RE//2526/2047` legacy, `HO/RE/26-27/0001` current). Never
        // normalised, padded or re-spaced: the floor tracks by exactly the
        // string on the order, and "tidying" the legacy double slash would make
        // the screen disagree with 86 of the 91 orders in the system.
        description={`${channel?.re_number ?? order.order_number ?? "Order"} · ${
          order.buyers?.name ?? ""
        }`}
        actions={
          <Link href={`/orders/${orderId}`}>
            <Button variant="outline" size="md">
              ← Order
            </Button>
          </Link>
        }
      />

      {!channel ? (
        <Card>
          <CardBody>
            <p className="text-sm text-muted-foreground">
              This order has no community channel.
            </p>
          </CardBody>
        </Card>
      ) : (
        <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[1fr_16rem]">
          <Card className="flex min-h-0 flex-col">
            <CardBody className="flex min-h-0 flex-1 flex-col">
              <CommunityStream
                salesOrderId={orderId}
                channelId={channel.id}
                messages={messages}
                currentUserId={user.id}
                canPost={isMember}
              />
            </CardBody>
          </Card>

          <Card>
            <CardBody>
              <CommunityMembers members={members} />
            </CardBody>
          </Card>
        </div>
      )}
    </div>
  );
}
