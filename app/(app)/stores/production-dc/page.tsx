import { notFound } from "next/navigation";
import { can, requirePermission } from "@/lib/auth/server";
import { PageHeader } from "@/components/ui/page-header";
import { getProductionDc, getProductionDcSetup, listProductionDcs } from "@/lib/stores/production-dc-service";
import { ProductionDcScreen } from "./_components/production-dc-screen";
import { ProductionDcSendForm } from "./_components/production-dc-send-form";
import { ProductionDcReceiveForm } from "./_components/production-dc-receive-form";

/**
 * STORES ▸ PRODUCTION DC — material moved between Raagam HO, Unit 2 and Unit 3
 * (doc/stores/dc-plan.md, 0784). `?send=new|<id>` opens the sender's editor,
 * `?receive=<id>` the receiver's; otherwise the register.
 */
export default async function ProductionDcPage({
  searchParams,
}: {
  searchParams: Promise<{ send?: string; receive?: string }>;
}) {
  await requirePermission("stores", "view");
  const { send, receive } = await searchParams;

  if (send || receive) {
    const [setup, dc] = await Promise.all([
      getProductionDcSetup(),
      send && send !== "new" ? getProductionDc(send) : receive ? getProductionDc(receive) : Promise.resolve(null),
    ]);
    if ((send && send !== "new") || receive) {
      if (!dc) notFound();
    }
    if (!setup.unit) {
      return <p className="text-sm text-muted-foreground">Pick your working unit in the top bar first.</p>;
    }
    if (receive && dc) {
      return (
        <div className="space-y-4">
          <PageHeader title="Receive Production DC" description={`From ${dc.from_unit} — into ${setup.unit.name}'s stores`} />
          <ProductionDcReceiveForm dc={dc} stores={setup.stores} bins={setup.bins} />
        </div>
      );
    }
    return (
      <div className="space-y-4">
        <PageHeader title="Production DC" description="Send material to another unit — it is in transit until that unit receives it" />
        <ProductionDcSendForm
          unit={setup.unit}
          toUnits={setup.toUnits}
          stores={setup.stores}
          bins={setup.bins}
          stock={setup.stock}
          existing={dc && dc.status === "draft" && dc.outgoing ? dc : null}
        />
      </div>
    );
  }

  const [rows, canCreate] = await Promise.all([listProductionDcs(), can("stores", "create")]);
  return (
    <div className="space-y-4">
      <PageHeader title="Production DC" description="Material sent between Raagam HO, Unit 2 and Unit 3" />
      <ProductionDcScreen rows={rows} canCreate={canCreate} />
    </div>
  );
}
