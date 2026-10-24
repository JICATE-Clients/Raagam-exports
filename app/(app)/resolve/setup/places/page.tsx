import { PageHeader } from "@/components/ui/page-header";
import { PlacesScreen } from "@/components/resolve/admin/places-screen";
import { createClient } from "@/lib/supabase/server";
import { requireRh } from "@/lib/resolve/auth";
import { listPeople, listPlaces, listTrades } from "@/lib/resolve/service";

/** Assets are the Admin module's register (`system_admin` RLS). A Resolve admin
 *  without that access simply gets no Asset field — linking one is optional,
 *  and a refused read must not take the Places screen down with it. */
async function readAssets(): Promise<{ id: string; name: string; inactive: boolean }[]> {
  const s = await createClient();
  const { data, error } = await s.from("assets").select("id, name, status").order("name");
  if (error) return [];
  return ((data ?? []) as { id: string; name: string; status: string | null }[]).map((a) => ({
    id: a.id,
    name: a.name,
    inactive: a.status === "disposed" || a.status === "inactive",
  }));
}

export default async function PlacesPage() {
  await requireRh("admin");
  const [rows, people, trades, assets] = await Promise.all([
    listPlaces(),
    listPeople(),
    listTrades({ includeInactive: true }),
    readAssets(),
  ]);
  const perms = { canCreate: true, canEdit: true, canDelete: true };
  return (
    <div className="space-y-4">
      <PageHeader title="Places & QR" description="Rooms, machines and assets in this unit, and the QR stickers that report against them" />
      <PlacesScreen
        rows={rows}
        perms={perms}
        people={people}
        trades={trades.map((t) => ({ id: t.id, name: t.name, inactive: t.inactive }))}
        assets={assets}
      />
    </div>
  );
}
