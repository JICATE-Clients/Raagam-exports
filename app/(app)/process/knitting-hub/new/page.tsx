import { requirePermission } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import { today } from "@/lib/calendar";
import { getProductionDcSetup } from "@/lib/stores/production-dc-service";
import { listBinStock } from "@/lib/stores/process-dc-service";
import { getKnitCandidates, getKnitGauges, getKnitOrderOptions, getKnitters } from "@/lib/production/knitting-service";
import { KnittingEditor } from "../_components/knitting-editor";

export default async function NewKnittingOrderPage({ searchParams }: { searchParams: Promise<{ re?: string }> }) {
  await requirePermission("stores", "create");
  // ?re=<RE id> — opened from the list's To Program view: the RE is already picked.
  const { re } = await searchParams;
  // The yarn rows pick a store · bin and can send at once (user 2026-11-12), so stock comes too.
  const supabase = await createClient();
  const [choices, knitters, gauges, setup, binStock, next] = await Promise.all([
    getKnitOrderOptions(),
    getKnitters(),
    getKnitGauges(),
    getProductionDcSetup(),
    listBinStock({ withAge: true }),
    // The KO No this order will most likely get — shown instead of "(auto)" (user 2026-11-12).
    supabase.rpc("next_knitting_order_no"),
  ]);
  const cand = re && choices.orders.some((o) => o.id === re) ? await getKnitCandidates(re, null) : null;
  return (
    <KnittingEditor
      doc={null}
      orders={choices.orders}
      categories={choices.categories}
      knitters={knitters}
      gauges={gauges}
      initialCandidates={cand?.ok ? cand.candidates : []}
      initialCustomers={cand?.ok && re ? { [re]: cand.customer } : {}}
      initialReIds={cand?.ok && re ? [re] : []}
      nextCode={next.error ? null : ((next.data as string | null) ?? null)}
      today={today()}
      canEdit
      stores={setup.stores}
      bins={setup.bins}
      binStock={binStock}
    />
  );
}
