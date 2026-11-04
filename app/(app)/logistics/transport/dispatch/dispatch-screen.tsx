"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Combobox } from "@/components/ui/combobox";
import { Segmented } from "@/components/ui/segmented";
import { Field, FieldRow } from "@/components/ui/field";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Truncated } from "@/components/ui/truncated";
import { withCreatedColumns } from "@/components/ui/created-columns";
import { useToast } from "@/components/ui/toast";
import { fmtDateTime } from "@/lib/format";
import { useAccordion } from "@/lib/ui/use-accordion";
import { cn } from "@/lib/utils";
import { DENSE, DOC_BOTTOM_BAR, DOC_CHIP, DOC_FRAME, DOC_RULE, DocHint, DocTotals } from "@/components/purchase/doc-surface";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { dispatchTrip } from "@/lib/logistics/transport/actions";
import { utilisationPct } from "@/lib/logistics/transport/logic";
import {
  TRANSPORT_SOURCE_KIND_LABEL,
  VEHICLE_TYPE_LABEL,
  type PlaceOption,
  type PoolGroup,
  type Requisition,
  type VehicleOption,
} from "@/lib/logistics/transport/types";
import { UtilisationBar, fmtKg } from "../_shared/transport-ui";

/** `return_trip` / `return_place_id` blank = untouched: the destination's default applies (see `returnDefault`). */
type Crew = {
  vehicle_id: string;
  driver_name: string;
  driver_phone: string;
  start_odometer_km: string;
  return_trip: "" | "yes" | "no";
  return_place_id: string;
};
const BLANK_CREW: Crew = { vehicle_id: "", driver_name: "", driver_phone: "", start_odometer_km: "", return_trip: "", return_place_id: "" };

/**
 * THE RETURN DEFAULT (user 2026-11-04): Yes when the load is collected from one of
 * OUR units — the truck belongs back there — and No otherwise (one-way external
 * transport). The truck comes home to the place it was loaded at, or, when the
 * requests start from several places, the first of them that is a unit.
 */
function returnDefault(g: PoolGroup | null, places: PlaceOption[]): { yes: boolean; placeId: string } {
  if (!g) return { yes: false, placeId: "" };
  const kindOf = new Map(places.map((p) => [p.id, p.kind]));
  const origins = [...new Set(g.requisitions.map((r) => r.origin_place_id))];
  const unit = origins.find((id) => kindOf.get(id) === "unit");
  return { yes: !!unit, placeId: unit ?? (origins.length === 1 ? origins[0] : "") };
}

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
  places,
  canDispatch,
}: {
  pool: PoolGroup[];
  vehicles: VehicleOption[];
  places: PlaceOption[];
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

  // The return: the operator's choice, else the destination's default.
  const dflt = returnDefault(openGroup, places);
  const roundTrip = crew.return_trip ? crew.return_trip === "yes" : dflt.yes;
  const returnPlaceId = crew.return_place_id || dflt.placeId;
  // Anywhere active except the place it is delivering to (the server refuses that too).
  const returnOptions = places
    .filter((p) => !p.inactive && p.id !== openGroup?.destination_place_id)
    .map((p) => ({ value: p.id, label: p.name }));
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
      return_place_id: roundTrip && !returnPlaceId ? "Pick where the vehicle returns to" : undefined,
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
        return_trip: roundTrip,
        return_place_id: roundTrip ? returnPlaceId : null,
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
          /* ONE FRAME PER DESTINATION — the purchase document surface (doc-surface.tsx),
             so a trip is drawn up on the same paper as a DC or a GRN: a title row of
             chips, the requests frameless on a hairline, the crew on the next
             hairline, and the bottom bar carrying the load and the one filled button. */
          <section key={key} className={DOC_FRAME} {...fold.focusProps(key)}>
            <button
              type="button"
              className={cn("flex w-full flex-wrap items-center gap-x-2 gap-y-2 px-4 py-2.5 text-left", open ? "rounded-t-xl" : "rounded-xl")}
              aria-expanded={open}
              onClick={() => fold.toggle(key)}
            >
              {open ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
              <span className="text-base font-bold">To {g.destination_name}</span>
              <span className={DOC_CHIP}>
                {g.requisitions.length} request{g.requisitions.length === 1 ? "" : "s"}
              </span>
              <span className={DOC_CHIP}>{fmtKg(g.total_weight_kg)}</span>
              <span className={DOC_CHIP} title="Earliest Leaves By">
                Earliest {fmtDateTime(g.earliest_dispatch_at)}
              </span>
            </button>

            {open && (
              <>
                <div className={cn(DOC_RULE, "min-w-0 p-2", DENSE)}>
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
                    bare
                  />
                  {canDispatch && ids.size === 0 ? (
                    <p className="px-2 pt-1.5 text-xs text-muted-foreground">Tick the requests going on this vehicle.</p>
                  ) : null}
                </div>

                {/* Vehicle party 200 + Driver name 288 + Phone code 144 + Odometer
                    range 112 = 744, + 3 × 12px gap = 780px — one row inside the frame. */}
                <div data-focus-scope className={cn(DOC_RULE, "px-4 py-2.5")}>
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
                  {/* THE RETURN (0808): Yes keeps the vehicle until it is back inside
                      the Return To fence; No frees it where it unloads. Return code
                      144 + Return To party 200 — the second line of the crew band. */}
                  <FieldRow align="start" className="mt-2">
                    <Field label="Return Trip" w="code" htmlFor="dp-return">
                      <Segmented<"yes" | "no">
                        name="dp-return"
                        value={roundTrip ? "yes" : "no"}
                        onChange={(v) => setField("return_trip", v)}
                        options={[
                          { value: "yes", label: "Yes" },
                          { value: "no", label: "No" },
                        ]}
                      />
                    </Field>
                    {roundTrip ? (
                      <Field
                        label="Return To"
                        required
                        w="party"
                        htmlFor="dp-return-to"
                        error={errors.return_place_id}
                        hint="Free again once it is back inside this place's fence"
                      >
                        <Combobox
                          id="dp-return-to"
                          required
                          options={returnOptions}
                          value={returnPlaceId}
                          onChange={(v) => setField("return_place_id", v)}
                        />
                      </Field>
                    ) : (
                      <p className="self-center pt-5 text-xs text-muted-foreground">One way — the vehicle is free as soon as it unloads.</p>
                    )}
                  </FieldRow>
                </div>

                {/* THE BOTTOM BAR — what goes on, how full the vehicle is, and Dispatch.
                    The reasons it waits stay UNDER what they are about (2026-10-29), so
                    the chip here only ever says the trip is ready. */}
                <div className={DOC_BOTTOM_BAR} data-focus-region="footer">
                  <DocTotals
                    items={[
                      ["Ticked", ids.size],
                      ["Load", vehicle ? `${fmtKg(loadKg)} of ${fmtKg(vehicle.max_payload_kg)}` : fmtKg(loadKg)],
                    ]}
                  />
                  {vehicle ? <UtilisationBar pct={pct} className="w-44" /> : null}
                  <div className="flex min-w-0 flex-1">
                    {!blocked ? <DocHint kind="ready">Ready to dispatch</DocHint> : null}
                  </div>
                  <Button size="md" disabled={blocked} onClick={submit}>
                    {isPending
                      ? "Dispatching…"
                      : ids.size
                        ? `Dispatch ${ids.size} request${ids.size === 1 ? "" : "s"}`
                        : "Dispatch"}
                  </Button>
                </div>
              </>
            )}
          </section>
        );
      })}
    </div>
  );
}
