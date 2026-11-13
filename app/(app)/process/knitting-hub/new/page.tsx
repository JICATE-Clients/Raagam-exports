import { requirePermission } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import { today } from "@/lib/calendar";
import { getProductionDcSetup } from "@/lib/stores/production-dc-service";
import { listBinStock } from "@/lib/stores/process-dc-service";
import { getKnitGauges, getKnitOrderOptions, getKnitters } from "@/lib/production/knitting-service";
import { KnittingEditor } from "../_components/knitting-editor";

export default async function NewKnittingOrderPage() {
  await requirePermission("stores", "create");
  // The yarn rows pick a store · bin and can send at once (user 2026-11-12), so stock comes too.
  const supabase = await createClient();
  const [choices, knitters, gauges, setup, binStock, next] = await Promise.all([
    getKnitOrderOptions(),
    getKnitters(),
    getKnitGauges(),
    getProductionDcSetup(),
    listBinStock(),
    // The KO No this order will most likely get — shown instead of "(auto)" (user 2026-11-12).
    supabase.rpc("next_knitting_order_no"),
  ]);
  return (
    <KnittingEditor
      doc={null}
      orders={choices.orders}
      categories={choices.categories}
      knitters={knitters}
      gauges={gauges}
      initialCandidates={[]}
      initialCustomers={{}}
      nextCode={next.error ? null : ((next.data as string | null) ?? null)}
      today={today()}
      canEdit
      stores={setup.stores}
      bins={setup.bins}
      binStock={binStock}
    />
  );
}
