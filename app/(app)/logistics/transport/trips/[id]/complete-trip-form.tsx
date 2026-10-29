"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldRow } from "@/components/ui/field";
import { DataTable, type Column } from "@/components/ui/data-table";
import { useToast } from "@/components/ui/toast";
import { fmtMoney } from "@/lib/format";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { completeTrip } from "@/lib/logistics/transport/actions";
import { allocateCost, tripDistanceKm, tripTotalCost } from "@/lib/logistics/transport/logic";
import { TRANSPORT_SOURCE_KIND_LABEL, type TripDetail } from "@/lib/logistics/transport/types";
import { fmtKg } from "../../_shared/transport-ui";

type Costs = { end_odometer_km: string; fuel_cost: string; driver_allowance: string; toll_cost: string; other_cost: string };
const BLANK: Costs = { end_odometer_km: "", fuel_cost: "", driver_allowance: "", toll_cost: "", other_cost: "" };

type PreviewRow = { key: string; order: string; weight_kg: number; weight_pct: number; allocated_cost: number };

const previewColumns: Column<PreviewRow>[] = [
  { header: "Order", cell: (r) => <span className="text-sm">{r.order}</span> },
  { header: "Weight", align: "right", cell: (r) => <span className="text-sm tabular-nums">{fmtKg(r.weight_kg)}</span> },
  { header: "Share", align: "right", cell: (r) => <span className="text-sm tabular-nums">{r.weight_pct.toFixed(2)}%</span> },
  { header: "Cost", align: "right", cell: (r) => <span className="text-sm tabular-nums">{fmtMoney(r.allocated_cost)}</span> },
];

/** Blank is 0 for a cost (nothing spent), and a number otherwise. */
const num = (s: string) => (s.trim() === "" ? 0 : Number(s));

/**
 * The trip's Complete form → the order-wise split (spec §3C, plan D5).
 *
 * THE SPLIT IS PREVIEWED WITH THE SERVER'S OWN FUNCTION. `allocateCost` from
 * logic.ts is what `completeTrip` writes with, so the table under the costs is
 * the allocation that will be saved — to the paisa, remainder on the largest
 * line — not an estimate beside it.
 */
export function CompleteTripForm({ trip }: { trip: TripDetail }) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, start] = useTransition();
  const [c, setC] = useState<Costs>(BLANK);
  const [errors, setErrors] = useState<Partial<Record<keyof Costs, string>>>({});
  const dirty = Object.values(c).some((v) => v.trim() !== "");
  useUnsavedGuard(dirty || isPending);

  const costs = {
    fuel_cost: num(c.fuel_cost),
    driver_allowance: num(c.driver_allowance),
    toll_cost: num(c.toll_cost),
    other_cost: num(c.other_cost),
  };
  const valid = Object.values(costs).every((v) => Number.isFinite(v) && v >= 0);
  const total = valid ? tripTotalCost(costs) : 0;
  const endKm = c.end_odometer_km.trim() === "" ? null : Number(c.end_odometer_km);
  const distance = tripDistanceKm(trip.start_odometer_km, endKm);

  const preview: PreviewRow[] = allocateCost(
    total,
    trip.requisitions.map((r) => ({ key: r.id, weight_kg: r.material_weight_kg })),
  ).map((a) => {
    const r = trip.requisitions.find((x) => x.id === a.key)!;
    return {
      key: a.key,
      order: r.source_kind === "ho" ? TRANSPORT_SOURCE_KIND_LABEL.ho : (r.source_no ?? "—"),
      weight_kg: r.material_weight_kg,
      weight_pct: a.weight_pct,
      allocated_cost: a.allocated_cost,
    };
  });

  function set(k: keyof Costs, v: string) {
    setC((x) => ({ ...x, [k]: v }));
    setErrors((e) => ({ ...e, [k]: undefined }));
  }

  function submit() {
    const bad = (s: string) => s.trim() !== "" && (!Number.isFinite(Number(s)) || Number(s) < 0);
    const next: Partial<Record<keyof Costs, string>> = {
      end_odometer_km: bad(c.end_odometer_km)
        ? "Odometer cannot be negative"
        : endKm != null && trip.start_odometer_km != null && endKm < trip.start_odometer_km
          ? `Below the start reading (${trip.start_odometer_km} km)`
          : undefined,
      fuel_cost: bad(c.fuel_cost) ? "Cannot be negative" : undefined,
      driver_allowance: bad(c.driver_allowance) ? "Cannot be negative" : undefined,
      toll_cost: bad(c.toll_cost) ? "Cannot be negative" : undefined,
      other_cost: bad(c.other_cost) ? "Cannot be negative" : undefined,
    };
    setErrors(next);
    if (Object.values(next).some(Boolean)) return;
    start(async () => {
      const res = await completeTrip(trip.id, { end_odometer_km: endKm, ...costs });
      if (res.ok) {
        success("Trip completed and costed");
        setC(BLANK);
        router.refresh();
      } else {
        toastError(res.error);
      }
    });
  }

  const money = (k: Exclude<keyof Costs, "end_odometer_km">, label: string) => (
    <Field label={label} w="range" htmlFor={`ct-${k}`} error={errors[k]}>
      <Input
        id={`ct-${k}`}
        type="number"
        inputMode="decimal"
        min={0}
        step="0.01"
        value={c[k]}
        onChange={(e) => set(k, e.target.value)}
      />
    </Field>
  );

  return (
    // Cap: five range fields 5 × 112 = 560, + 4 × 12px gap = 608, + 2 × 16px padding = 640px → 40rem.
    <div data-focus-scope className="max-w-[40rem] space-y-3 rounded-lg border border-border bg-surface px-4 py-3">
      <FieldRow align="start">
        <Field
          label="End Odometer (km)"
          w="range"
          htmlFor="ct-end_odometer_km"
          error={errors.end_odometer_km}
          hint={distance != null ? `${distance} km run` : undefined}
        >
          <Input
            id="ct-end_odometer_km"
            type="number"
            inputMode="decimal"
            min={0}
            value={c.end_odometer_km}
            onChange={(e) => set("end_odometer_km", e.target.value)}
          />
        </Field>
        {money("fuel_cost", "Fuel (₹)")}
        {money("driver_allowance", "Allowance (₹)")}
        {money("toll_cost", "Toll (₹)")}
        {money("other_cost", "Other (₹)")}
      </FieldRow>

      <div className="text-sm">
        Total <span className="font-semibold tabular-nums">{fmtMoney(total)}</span>
        <span className="text-muted-foreground"> · split by weight across {preview.length} order line{preview.length === 1 ? "" : "s"}</span>
      </div>
      <DataTable columns={previewColumns} rows={preview} getKey={(r) => r.key} paginate={false} compact />

      <Button size="md" disabled={isPending} onClick={submit}>
        {isPending ? "Completing…" : "Complete trip"}
      </Button>
    </div>
  );
}
