import Link from "next/link";
import { notFound } from "next/navigation";
import { Plus } from "lucide-react";
import { can, requirePermission } from "@/lib/auth/server";
import { PageHeader } from "@/components/ui/page-header";
import { buttonClasses } from "@/components/ui/button";
import { Truncated } from "@/components/ui/truncated";
import { fmtDate, fmtNumber } from "@/lib/format";
import { getGeneralDc, listDcReturns, listOpenReturnableDcs } from "@/lib/purchase/general-dc-service";
import { getProductionDcSetup } from "@/lib/stores/production-dc-service";
import { DeliveryReturnsList } from "./_components/delivery-returns-list";
import { DcReturnForm } from "./_components/dc-return-form";

/**
 * PURCHASE ▸ PURCHASE STORE ▸ DELIVERY RETURN (0797) — a RETURNABLE General DC coming back:
 * the same item, no loss, no bill. The register of posted returns; `?new=1` picks an open
 * returnable DC; `?dc=<id>` is the return form (also where the DC hub's "Receive back" on a
 * General DC lands).
 */
type Search = { new?: string; dc?: string };

export default async function DeliveryReturnsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const [storesView, purchaseView] = await Promise.all([can("stores", "view"), can("materials_purchase", "view")]);
  if (!storesView && !purchaseView) await requirePermission("stores", "view");
  const sp = await searchParams;
  const canPost = (await can("stores", "edit")) || (await can("materials_purchase", "edit"));

  if (sp.dc) {
    const [dc, setup] = await Promise.all([getGeneralDc(sp.dc), getProductionDcSetup()]);
    if (!dc) notFound();
    return (
      <div className="space-y-4">
        <PageHeader title="Delivery Return" description="Goods sent on a returnable General DC, coming back" />
        {!dc.is_returnable || !["issued", "partially_returned"].includes(dc.status) ? (
          <p className="text-sm text-muted-foreground">
            {dc.code ?? "This DC"} is {dc.is_returnable ? dc.status.replace("_", " ") : "non-returnable"} — nothing is due back on it.
          </p>
        ) : !canPost ? (
          <p className="text-sm text-muted-foreground">You do not have permission to receive a delivery back.</p>
        ) : (
          <DcReturnForm dc={dc} stores={setup.stores} bins={setup.bins} />
        )}
      </div>
    );
  }

  if (sp.new) {
    const open = await listOpenReturnableDcs();
    return (
      <div className="space-y-4">
        <PageHeader title="New Delivery Return" description="Pick the returnable General DC the goods came back on" />
        <Link href="/purchase/delivery-returns" className="text-sm text-muted-foreground hover:text-foreground hover:underline">
          ← Delivery Returns
        </Link>
        {open.length === 0 ? (
          <p className="text-sm text-muted-foreground">No returnable General DC is out with a party right now.</p>
        ) : (
          <ul className="max-w-[56rem] divide-y divide-border rounded-lg border border-border">
            {open.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm">
                <Link href={`/purchase/delivery-returns?dc=${d.id}`} className="font-mono text-xs font-medium text-primary hover:underline">
                  {d.code ?? "—"}
                </Link>
                <Truncated className="min-w-0 flex-1">{d.party}</Truncated>
                <span className="text-muted-foreground">{d.purpose ?? ""}</span>
                <span className="tabular-nums text-muted-foreground">{fmtDate(d.dc_date)}</span>
                {d.expected_return_date ? <span className="tabular-nums text-muted-foreground">due {fmtDate(d.expected_return_date)}</span> : null}
                <span className="tabular-nums">
                  {fmtNumber(d.out)} of {fmtNumber(d.sent)} out
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  const rows = await listDcReturns();
  return (
    <div className="space-y-4">
      <PageHeader
        title="Delivery Return"
        description="Goods sent on a returnable General DC, coming back — same item, no loss, no bill"
        actions={
          canPost ? (
            <Link href="/purchase/delivery-returns?new=1" className={buttonClasses({ size: "md" })}>
              <Plus className="h-4 w-4" aria-hidden />
              Add Delivery Return
            </Link>
          ) : null
        }
      />
      <DeliveryReturnsList rows={rows} />
    </div>
  );
}
