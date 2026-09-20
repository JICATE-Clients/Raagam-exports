import "server-only";
import { createClient } from "@/lib/supabase/server";
import { notify } from "@/lib/notifications/notify";

/**
 * THE CAD HAND-OFF, AS TWO MESSAGES — `doc/order/newfeature.md` §1.
 *
 * The client's complaint is not that the ERP cannot hold a piece weight. It
 * can, and has since 0460: a sheet per order, a marker per layout, a gram
 * figure per coordinate component, and `seedFabricBomFromCad` pushing those
 * figures into the Fabric BOM's consumption. What §1 describes is the two ENDS
 * of that, which were paper:
 *
 *   "CAD operators print physical paper sheets and manually hand them over to
 *    merchandisers for manual data entry."
 *
 * So the remainder was never a screen. It is: CAD does not know an order
 * exists until somebody walks over, and the merchandiser does not know the
 * weights are ready until somebody walks back.
 *
 * ## BOTH ARE FIRE-AND-FORGET, LIKE `writeAudit`
 *
 * Neither can fail the write that triggered it. A merchandiser whose order
 * saved and then reported an error because a push endpoint was down would
 * retry, and the second attempt would collide with the SC No the first one
 * minted. A missed notification is recoverable from the queue screen — both
 * `/orders/cad` and the CAD queue show the same pending orders without any
 * notification having been sent. The alert makes the queue timely; it is not
 * the only route to the work.
 *
 * ## WHO IS "CAD" IS A ROLE, NOT A LIST OF PEOPLE
 *
 * `CAD Technician` (0460): "Marker layouts and component gram weights". §1
 * calls the same job "CAD Operator" — one job, and the role that already exists
 * is the one the CAD module routes by. Creating a second role for the spec's
 * wording would split the room in half and leave a notification pointed at the
 * empty side (0602's header makes the same argument at length).
 */

/** `orders:view` plus the role — the recipients of the "a new order" alert. */
const CAD_ROLE = "CAD Technician";

type OrderNames = {
  /** The RE No — the universal key, and the only name CAD will recognise. */
  reNo: string | null;
  /** Who owns the order, for the merchandiser leg. NULL when unset. */
  merchandiserId: string | null;
  buyer: string | null;
};

/**
 * Read the two or three facts a message needs.
 *
 * ONE READ FOR BOTH LEGS, and it returns nulls rather than throwing: a
 * notification that cannot name its order is still worth sending with a
 * generic noun, and an exception here would propagate into the caller this file
 * promised never to break.
 */
async function orderNames(garmentOrderId: string): Promise<OrderNames> {
  try {
    const s = await createClient();
    const { data } = await s
      .from("garment_order_amendments")
      /* THE FK COLUMN IS NAMED, though neither embed is ambiguous today
         (verified from `pg_constraint`, 2026-09-20: one FK each). AGENTS.md's
         "A SECOND FK BREAKS EVERY EXISTING EMBED" — the day `sales_orders`
         gains a second reference to `buyers`, a bare embed starts answering
         PGRST201 and this read returns null while every caller reads
         `data ?? null` and reports nothing wrong. One token now. */
      .select(
        "code, sales_order:sales_orders!sales_order_id(order_number, merchandiser_id, buyer:buyers!buyer_id(name))",
      )
      .eq("id", garmentOrderId)
      .maybeSingle();

    type Row = {
      code: string | null;
      sales_order: {
        order_number: string | null;
        merchandiser_id: string | null;
        buyer: { name: string | null } | { name: string | null }[] | null;
      } | null;
    };
    const row = data as unknown as Row | null;
    const so = row?.sales_order ?? null;
    const buyer = Array.isArray(so?.buyer) ? (so?.buyer[0] ?? null) : (so?.buyer ?? null);

    return {
      reNo: so?.order_number ?? row?.code ?? null,
      merchandiserId: so?.merchandiser_id ?? null,
      buyer: buyer?.name ?? null,
    };
  } catch {
    return { reNo: null, merchandiserId: null, buyer: null };
  }
}

/**
 * STAGE 2 of §1's table: a new order exists, tell the CAD room.
 *
 * ## ONLY FOR A NEW RE No, NEVER FOR AN AMENDMENT
 *
 * `createAmendment` creates a document, and a document is not always a new
 * order — an amendment is another `garment_order_amendments` row on an RE that
 * already exists (0517). §1's trigger is "Saving a new Sales Order Entry", so
 * this fires only where a fresh RE was minted.
 *
 * That restraint is the point. An alert per amendment would put the same order
 * in the CAD queue three times over the weeks a style is revised, and the
 * queue's own status (`cadQueueStatus`) already carries whether anything is
 * still unweighed. An alert that repeats about work already done is an alert
 * people learn to close without reading, which costs the one that matters.
 */
export async function notifyCadOfNewOrder(garmentOrderId: string): Promise<void> {
  try {
    const { reNo, buyer } = await orderNames(garmentOrderId);
    const name = reNo ? `Order ${reNo}` : "A new order";
    await notify(
      { role: CAD_ROLE },
      {
        title: `${name} needs marker weights`,
        body: buyer
          ? `${buyer}. Open it from the CAD queue to see the style components and enter the gram weight per panel.`
          : "Open it from the CAD queue to see the style components and enter the gram weight per panel.",
        href: "/orders/cad",
        type: "info",
      },
    );
  } catch {
    // never breaks the order that was just saved — see the header
  }
}

/**
 * STAGE 4 of §1's table: the weights are in, tell the merchandiser.
 *
 * ## IT SAYS WHAT TO DO NEXT, BECAUSE THE PUSH IS NOT THE PUSH
 *
 * §1 asks for "auto-populating Fabric BOM calculations", and that word does a
 * lot of work. The figures do NOT flow into the Fabric BOM on submit and should
 * not: `seedFabricBomFromCad` writes `order_fabric_bom_lines.consumption`, and
 * a document that rewrites a costed line without anyone asking is the same
 * class of surprise 0576 locks the BOMs against. A merchandiser may also have
 * typed a consumption already.
 *
 * So the hand-off is: CAD submits, the merchandiser is told, and the seed runs
 * when they open the Fabric BOM and accept it — one click instead of a walk
 * across the factory and a re-key of thirty numbers, which is the whole of what
 * §1 is actually asking for.
 */
export async function notifyMerchandiserOfCadSubmit(garmentOrderId: string): Promise<void> {
  try {
    const { reNo, merchandiserId } = await orderNames(garmentOrderId);
    const name = reNo ? `Order ${reNo}` : "An order";
    const payload = {
      title: `${name} — CAD piece weights are ready`,
      body: "The marker sheet has been submitted. Open the Fabric BOM to pull the panel weights into consumption.",
      href: "/orders/fabric-bom",
      type: "success" as const,
    };

    /* THE OWNER IF THERE IS ONE, THE DESK IF THERE IS NOT. `merchandiser_id`
       defaults to `auth.uid()` (0006) so it is normally set — but an order
       imported or created by a script has none, and "nobody owns it" must not
       mean "nobody is told". `orders:edit` is the merchandising desk. */
    await notify(
      merchandiserId
        ? { userId: merchandiserId }
        : { permission: { module: "orders", action: "edit" } },
      payload,
    );
  } catch {
    // never breaks the CAD save — see the header
  }
}
