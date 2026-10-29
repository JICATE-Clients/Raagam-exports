"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Combobox } from "@/components/ui/combobox";
import { Field, FieldRow } from "@/components/ui/field";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Truncated } from "@/components/ui/truncated";
import { withCreatedColumns } from "@/components/ui/created-columns";
import { useToast } from "@/components/ui/toast";
import { fmtDateTime } from "@/lib/format";
import { useAccordion } from "@/lib/ui/use-accordion";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { dispatchTrip } from "@/lib/logistics/transport/actions";
import { utilisationPct } from "@/lib/logistics/transport/logic";
import {
  TRANSPORT_SOURCE_KIND_LABEL,
  VEHICLE_TYPE_LABEL,
  type PoolGroup,
  type Requisition,
  type VehicleOption,
} from "@/lib/logistics/transport/types";
import { UtilisationBar, fmtKg } from "../_shared/transport-ui";

type Crew = { vehicle_id: string; driver_name: string; driver_phone: string; start_odometer_km: string };
const BLANK_CREW: Crew = { vehicle_id: "", driver_name: "", driver_phone: "", start_odometer_km: "" };

const poolColumns: Column<Requisition>[] = [
  { header: "Request No", cell: (r) => <span className="text-sm font-medium">{r.req_no}</span> },
  {
    header: "Order",
    cell: (r) => <span className="text-sm">{r.source_kind === "ho" ? TRANSPORT_SOURCE_KIND_LABEL.ho : (r.source_no ?? "—")}</span>,
  },
  { header: "From", cell: (r) => <Truncated text={r.origin_name} className="max-w-[12rem] text-sm" /> },
  { header: "Material", cell: (r) => <Truncated text={r.material_type} className="max-w-[10rem] text-sm" /> },
  { header: "Weight", align: "right", cell: (r) => <span className="text-sm tabular-nums">{fmtKg(r.material_weight_kg)}</span> },
  { header: "Leaves By", cell: (r) => <span className="text-sm tabular-nums">{fmtDateTime(r.required_dispatch_at)}</span> },
];

/**
 * Logistics ▸ Transport ▸ Dispatch — the pending pool, grouped by where it is
 * going (plan D4), and the one place a trip is created.
 *
 * ONE DESTINATION PER TRIP, BY CONSTRUCTION. The groups are an accordion
 * (AGENTS.md "Folds are accordions", `useAccordion`): one is open at a time,
 * and the ticks belong to the open one — opening another destination starts its
 * own selection. A trip has one destination geofence, so a mixed load could
 * never be tracked; the shape makes it unaskable rather than refusing it late.
 *
 * The system SUGGESTS and never assigns: nothing is ticked on opening, the
 * operator chooses what goes on the vehicle and watches the bar fill.
 *
 * OVERLOAD IS SAID UNDER THE VEHICLE FIELD (skill "A warning sits UNDER THE FIELD
 * it is about"), and Dispatch is disabled while it stands — never a footer line.
 */
export function DispatchScreen({
  pool,
  vehicles,
  canDispatch,
}: {
  pool: PoolGroup[];
  vehicles: VehicleOption[];
  canDispatch: boolean;
}) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, start] = useTransition();
  const fold = useAccordion(pool[0]?.destination_place_id ?? null);
  /** Ticks, tagged with the destination they were made in — read only while it is open. */
  const [ticked, setTicked] = useState<{ group: string | null; ids: Set<string> }>({ group: null, ids: new Set() });
  const [crew, setCrew] = useState<Crew>(BLANK_CREW);
  const [errors, setErrors] = useState<Partial<Record<keyof Crew, string>>>({});

  const openGroup = pool.find((g) => g.destination_place_id === fold.openKey) ?? null;
  const ids = ticked.group && ticked.group === fold.openKey ? ticked.ids : new Set<string>();
  const dirty = ids.size > 0 || !!crew.driver_name.trim() || !!crew.vehicle_id;
  useUnsavedGuard(dirty || isPending);

  // Only a vehicle free to take a trip: not switched off, not on another trip,
  // not in the workshop (AGENTS.md "Disabled rows" — gone, not greyed).
  const vehicleOptions = useMemo(
    () =>
      vehicles
        .filter((v) => !v.inactive && v.status === "idle")
        .map((v) => ({
          value: v.id,
          label: v.vehicle_number,
          sublabel: `${VEHICLE_TYPE_LABEL[v.vehicle_type]} · ${fmtKg(v.max_payload_kg)}`,
        })),
    [vehicles],
  );
  const vehicle = vehicles.find((v) => v.id === crew.vehicle_id) ?? null;
  const tickedRows = openGroup ? openGroup.requisitions.filter((r) => ids.has(r.id)) : [];
  const loadKg = tickedRows.reduce((s, r) => s + r.material_weight_kg, 0);
  const pct = vehicle ? utilisationPct(tickedRows.map((r) => r.material_weight_kg), vehicle.max_payload_kg) : 0;
  const overBy = vehicle ? loadKg - vehicle.max_payload_kg : 0;
  const overload = !!vehicle && overBy > 0;

  function toggle(group: string, id: string) {
    setTicked((t) => {
      const next = new Set(t.group === group ? t.ids : []);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { group, ids: next };
    });
  }
  function toggleAll(g: PoolGroup) {
    setTicked((t) => {
      const current = t.group === g.destination_place_id ? t.ids : new Set<string>();
      const all = current.size === g.requisitions.length;
      return { group: g.destination_place_id, ids: all ? new Set() : new Set(g.requisitions.map((r) => r.id)) };
    });
  }
  function setField<K extends keyof Crew>(k: K, v: Crew[K]) {
    setCrew((c) => ({ ...c, [k]: v }));
    setErrors((e) => ({ ...e, [k]: undefined }));
  }

  const odo = crew.start_odometer_km.trim() === "" ? null : Number(crew.start_odometer_km);
  const blocked = !canDispatch || isPending || ids.size === 0 || !vehicle || overload;
  /* EACH REASON UNDER WHAT IT IS ABOUT (user 2026-10-29: "fix the dispatch message
     now"). All three sat in one line beside the Dispatch button, a screen away from
     the table and the field they meant — the orphaned-message pattern AGENTS.md's
     FieldError rule forbids. The tick reason is under the requests table, the vehicle
     reason is the Vehicle field's hint (quiet: nothing is wrong yet, just not done),
     and the permission note — about the operator, not a field — heads the screen. */

  function submit() {
    const next: Partial<Record<keyof Crew, string>> = {
      vehicle_id: crew.vehicle_id ? undefined : "Pick a vehicle",
      driver_name: crew.driver_name.trim() ? undefined : "Driver name is required",
      start_odometer_km: odo != null && (!Number.isFinite(odo) || odo < 0) ? "Odometer cannot be negative" : undefined,
    };
    setErrors(next);
    if (Object.values(next).some(Boolean) || blocked) return;
    start(async () => {
      const res = await dispatchTrip({
        vehicle_id: crew.vehicle_id,
        driver_name: crew.driver_name,
        driver_phone: crew.driver_phone,
        requisition_ids: [...ids],
        start_odometer_km: odo,
      });
      if (res.ok) {
        success("Trip dispatched");
        setTicked({ group: null, ids: new Set() });
        setCrew(BLANK_CREW);
        router.push(`/logistics/transport/trips/${res.data.trip_id}`);
      } else {
        toastError(res.error);
      }
    });
  }

  if (pool.length === 0) {
    return <p className="text-sm text-muted-foreground">No trip requests are waiting for a vehicle.</p>;
  }

  return (
    <div className="space-y-3">
      {!canDispatch && (
        <p role="status" className="text-sm text-muted-foreground">
          You can view the pool but not dispatch.
        </p>
      )}
      {pool.map((g) => {
        const key = g.destination_place_id;
        const open = fold.isOpen(key);
        return (
          <section key={key} className="rounded-lg border border-border bg-surface" {...fold.focusProps(key)}>
            <button
              type="button"
              className="flex w-full items-center gap-3 px-4 py-3 text-left"
              aria-expanded={open}
              onClick={() => fold.toggle(key)}
            >
              {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              <span className="text-sm font-semibold">To {g.destination_name}</span>
              <span className="text-xs text-muted-foreground">
                {g.requisitions.length} request{g.requisitions.length === 1 ? "" : "s"} · {fmtKg(g.total_weight_kg)} · earliest{" "}
                {fmtDateTime(g.earliest_dispatch_at)}
              </span>
            </button>

            {open && (
              <div className="space-y-4 border-t border-border px-4 py-3">
                <DataTable<Requisition>
                  columns={withCreatedColumns(poolColumns, g.requisitions)}
                  rows={g.requisitions}
                  getKey={(r) => r.id}
                  selectable
                  selectedKeys={ids}
                  onToggle={(id) => toggle(key, id)}
                  onToggleAll={() => toggleAll(g)}
                  /* The pool for ONE destination is the trip's manifest being
                     drawn up — every row must be in view to be ticked. */
                  paginate={false}
                  compact
                />
                {canDispatch && ids.size === 0 ? (
                  <p className="-mt-2 text-xs text-muted-foreground">Tick the requests going on this vehicle.</p>
                ) : null}

                {/* Cap: Vehicle party 200 + Driver name 288 + Phone code 144 +
                    Odometer range 112 = 744, + 3 × 12px gap = 780px → 49rem. */}
                <div data-focus-scope className="max-w-[49rem] space-y-3">
                  <FieldRow align="start">
                    <Field
                      label="Vehicle"
                      required
                      w="party"
                      htmlFor="dp-vehicle"
                      hint={canDispatch && !vehicle ? "Pick a vehicle." : undefined}
                      error={
                        errors.vehicle_id ??
                        (overload && vehicle
                          ? `${fmtKg(overBy)} over this vehicle's ${fmtKg(vehicle.max_payload_kg)} payload — untick a request or pick a bigger vehicle`
                          : undefined)
                      }
                    >
                      <Combobox
                        id="dp-vehicle"
                        required
                        options={vehicleOptions}
                        value={crew.vehicle_id}
                        onChange={(v) => setField("vehicle_id", v)}
                      />
                    </Field>
                    <Field label="Driver Name" required w="name" htmlFor="dp-driver" error={errors.driver_name}>
                      <Input id="dp-driver" value={crew.driver_name} onChange={(e) => setField("driver_name", e.target.value)} />
                    </Field>
                    <Field label="Driver Phone" w="code" htmlFor="dp-phone">
                      <Input
                        id="dp-phone"
                        type="tel"
                        inputMode="tel"
                        value={crew.driver_phone}
                        onChange={(e) => setField("driver_phone", e.target.value)}
                      />
                    </Field>
                    <Field label="Start Odometer (km)" w="range" htmlFor="dp-odo" error={errors.start_odometer_km}>
                      <Input
                        id="dp-odo"
                        type="number"
                        inputMode="decimal"
                        min={0}
                        value={crew.start_odometer_km}
                        onChange={(e) => setField("start_odometer_km", e.target.value)}
                      />
                    </Field>
                  </FieldRow>

                  <div className="max-w-[28rem] space-y-1">
                    <div className="text-xs text-muted-foreground">
                      Load {fmtKg(loadKg)}
                      {vehicle ? ` of ${fmtKg(vehicle.max_payload_kg)}` : " — pick a vehicle to see the fill"}
                    </div>
                    <UtilisationBar pct={pct} />
                  </div>

                  <div className="flex items-center gap-3">
                    <Button size="md" disabled={blocked} onClick={submit}>
                      {isPending
                        ? "Dispatching…"
                        : ids.size
                          ? `Dispatch ${ids.size} request${ids.size === 1 ? "" : "s"}`
                          : "Dispatch"}
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
