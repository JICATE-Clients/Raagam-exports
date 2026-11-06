import { canViewHref, requirePermission } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import { MODULE_GROUPS } from "@/lib/nav/module-groups";
import { today } from "@/lib/dashboard/range";
import { myIdentity } from "@/lib/overview/me";
import { TRIP_STAGES, transportOverview, type ReqRow, type TripRow, type VehicleRow } from "@/lib/overview/transport";
import { asOfNow, relDays, whenOf } from "@/lib/overview/words";
import { GlowBars, NeedsDoing, Strip, VizCard, nameColour, type Mood } from "@/components/viz/kit";
import { StagePipe } from "@/components/analytics/pictures";
import { LoadError, NoAccess } from "@/components/analytics/board-ui";
import { MoreLinks, OverviewHeader, Row3, Say, WhenList, whoOf } from "@/components/overview/frame";

/**
 * TRANSPORT ▸ OVERVIEW — "What is waiting for a vehicle, and what is on the road?" (wave 2,
 * 2026-11-06; plan https://claude.ai/artifact/5e8SGWe8DPHC7Ua2fQyaiW). Replaces `ModuleHub`,
 * which only redirected to the first sub-module.
 *
 * Read through the person's own session (RLS, the top-bar unit), each part only when its screen
 * is theirs to open. "Mine" is the requests the operator raised. Every embed names its FK column:
 * a request points at `transport_places` twice (from and to), so a bare embed is PGRST201.
 */
export default async function TransportOverviewPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requirePermission(MODULE_GROUPS["/logistics/transport"].module, "view");
  const sp = await searchParams;
  const t = today();
  const asOf = asOfNow();
  const [me, canReq, canBoard, canVeh] = await Promise.all([
    myIdentity(),
    canViewHref("/logistics/transport/requests"),
    canViewHref("/logistics/transport/board"),
    canViewHref("/logistics/transport/vehicles"),
  ]);
  const header = (who: "mine" | "everyone" | null, mine: number, everyone: number) => (
    <OverviewHeader title="Transport" question="What is waiting for a vehicle, and what is on the road?" who={who} mine={mine} everyone={everyone} asOf={asOf} />
  );
  if (!canReq && !canBoard) {
    return (
      <div className="space-y-3">
        {header(null, 0, 0)}
        <NoAccess what="The transport overview" screen="Trip Requests" />
      </div>
    );
  }

  const s = await createClient();
  const none = Promise.resolve({ data: [] as unknown[], error: null });
  const [reqRes, tripRes, vehRes] = await Promise.all([
    canReq
      ? s
          .from("transport_requisitions")
          .select(
            "id, req_no, status, required_dispatch_at, material_type, material_weight_kg, created_by, " +
              "origin:transport_places!origin_place_id(name), dest:transport_places!destination_place_id(name)",
          )
          .in("status", ["pending", "pooled", "assigned", "completed"])
      : none,
    canBoard
      ? s.from("transport_trips").select("id, trip_no, trip_status, driver_name, planned_at, completed_at, vehicle:transport_vehicles!vehicle_id(vehicle_number)")
      : none,
    canVeh ? s.from("transport_vehicles").select("id, vehicle_number, status, inactive") : none,
  ]);
  const failed = [reqRes, tripRes, vehRes].find((r) => r.error);
  if (failed?.error) {
    return (
      <div className="space-y-3">
        {header(null, 0, 0)}
        <LoadError message={failed.error.message} />
      </div>
    );
  }

  type RawReq = {
    id: string;
    req_no: string | null;
    status: string;
    required_dispatch_at: string | null;
    material_type: string | null;
    material_weight_kg: unknown;
    created_by: string | null;
    origin: { name: string | null } | null;
    dest: { name: string | null } | null;
  };
  const allReqs: ReqRow[] = ((reqRes.data ?? []) as unknown as RawReq[]).map((r) => ({
    id: r.id,
    no: r.req_no ?? "Request",
    status: r.status,
    // A date-time; the time words compare the day (IST date of the stored instant is close enough for a due day).
    dispatchAt: r.required_dispatch_at ? r.required_dispatch_at.slice(0, 10) : null,
    from: r.origin?.name?.trim() || "—",
    to: r.dest?.name?.trim() || "—",
    material: r.material_type?.trim() || "",
    weightKg: r.material_weight_kg == null ? null : Number(r.material_weight_kg),
    createdBy: r.created_by,
  }));
  type RawTrip = { id: string; trip_no: string | null; trip_status: string; driver_name: string | null; planned_at: string; completed_at: string | null; vehicle: { vehicle_number: string | null } | null };
  const trips: TripRow[] = ((tripRes.data ?? []) as unknown as RawTrip[]).map((x) => ({
    id: x.id,
    no: x.trip_no ?? "Trip",
    status: x.trip_status,
    vehicle: x.vehicle?.vehicle_number?.trim() || "No vehicle",
    driver: x.driver_name?.trim() || "",
    plannedAt: x.planned_at,
    completedAt: x.completed_at,
  }));
  const vehicles: VehicleRow[] = ((vehRes.data ?? []) as { id: string; vehicle_number: string | null; status: string; inactive: boolean | null }[]).map((v) => ({
    id: v.id,
    no: v.vehicle_number ?? "Vehicle",
    status: v.status,
    inactive: v.inactive === true,
  }));

  const live = (r: ReqRow) => r.status !== "completed";
  const mineReqs = me.profileId ? allReqs.filter((r) => r.createdBy === me.profileId) : [];
  const who = whoOf(sp.who, mineReqs.filter(live).length);
  const reqs = who === "mine" ? mineReqs : allReqs;
  const o = transportOverview(reqs, trips, vehicles, t);

  /* The picture: trips out now, by stage — one block per trip. */
  const STAGE_MOOD: Record<string, Mood> = { planned: "normal", loading: "look", en_route: "normal", unloading: "look", returning: "quiet" };
  const stages = TRIP_STAGES.map((st) => {
    const list = o.out.filter((x) => x.status === st.key);
    return {
      key: st.key,
      label: st.label,
      figure: `${list.length} trip${list.length === 1 ? "" : "s"}`,
      hint: list.length ? list.map((x) => x.vehicle).join(", ") : "none",
      mood: STAGE_MOOD[st.key],
      items: list.map(() => 1),
      href: "/logistics/transport/board",
    };
  });

  /* Which vehicle is used most: trips per vehicle, all time. */
  const perVehicle = new Map<string, number>();
  for (const x of trips) if (x.status !== "cancelled") perVehicle.set(x.vehicle, (perVehicle.get(x.vehicle) ?? 0) + 1);
  const vehBars = [...perVehicle.entries()].sort((a, b) => b[1] - a[1]).slice(0, 7).map(([k, v]) => ({ key: k, label: k, value: v, colour: nameColour(k), display: `${v} trip${v === 1 ? "" : "s"}` }));

  return (
    <div className="space-y-2.5">
      {header(mineReqs.length ? who : null, mineReqs.filter(live).length, allReqs.filter(live).length)}
      <Say lines={o.say} />
      <Strip compact cells={o.strip} />
      {canBoard ? (
        <VizCard title="What is on the road?" question="Trips out now by stage · where a vehicle is cannot be shown yet (no GPS device)">
          <div className="py-3">
            <StagePipe stages={stages} />
          </div>
        </VizCard>
      ) : null}
      <Row3>
        <WhenList
          title="Which requests have no vehicle?"
          question="Pending and pooled requests by their dispatch date"
          empty="Every request has a vehicle."
          more="/logistics/transport/dispatch"
          items={o.waiting.map((r) => ({
            key: r.id,
            when: whenOf(r.dispatchAt, t),
            name: `${r.from} → ${r.to}`,
            code: [r.no, r.material, r.weightKg ? `${r.weightKg.toLocaleString("en-IN")} kg` : ""].filter(Boolean).join(" · "),
            href: "/logistics/transport/dispatch",
            note: r.dispatchAt ? relDays(r.dispatchAt, t) : "no date",
          }))}
        />
        <WhenList
          title="Which trips are out?"
          question="Trips not yet completed, with their stage"
          empty="No trip is out."
          grouped={false}
          more="/logistics/transport/board"
          items={o.out.map((x) => ({
            key: x.id,
            when: "today",
            name: x.vehicle,
            code: [x.no, x.driver].filter(Boolean).join(" · "),
            href: "/logistics/transport/board",
            note: TRIP_STAGES.find((st) => st.key === x.status)?.label ?? x.status,
          }))}
        />
        <VizCard title="Which vehicle is used most?" question="Trips per vehicle, all time" padded>
          <GlowBars rows={vehBars} format={(v) => `${v}`} empty="No trip yet." />
        </VizCard>
      </Row3>
      <NeedsDoing compact cells={o.needs} />
      <MoreLinks
        links={[
          { href: "/logistics/transport/board", label: "Fleet Board" },
          { href: "/logistics/transport/map", label: "Fleet Map" },
        ]}
      />
    </div>
  );
}
