"use client";

import { useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Field, FieldRow } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { previewSampleIwoNumber, saveInternalWorkOrder } from "@/lib/orders/internal-work-orders/actions";
import { IWO_FOR_LABELS, type IwoFor } from "@/lib/orders/internal-work-orders/types";
import { raiseSampleGroupIw } from "@/lib/sales/sample-grouping/actions";
import type { SwoAwaitingIw } from "@/lib/sales/sample-grouping/service";
import { fmtKg } from "@/lib/sales/sample-grouping/calc";
import { today } from "@/lib/calendar";

/**
 * "+ NEW WORK ORDER" ON THE SAMPLE PLAN SCREENS (0704, user 2026-10-09).
 *
 * Sample ▸ Fabric Plan / Accessories Plan are the IWO plan screens listing only
 * the SAMPLE work orders, and a plan cannot exist without its work order. On the
 * Orders route the way out is "New work order" on the IWO screen; here that
 * would drop the operator out of the Sample module halfway through a plan. So
 * the work order's header is raised in place through the IWO screen's OWN
 * action (`saveInternalWorkOrder`), which takes the session's unit, numbers it
 * and needs Orders ▸ Create exactly as it does there. Only `is_sample` differs.
 *
 * THE FABRIC PLAN ASKS FOR THE SWO, NOT AN RE NO (0707; client spec "Grouping &
 * SWO", 2026-10-12: "the main header input uses the SWO Number … FAR Number or
 * RE Number are omitted"). Given `swos`, the box offers the approved Sample
 * Work Orders still waiting for their work order and raises it through
 * `raiseSampleGroupIw` — the SAME action Grouping's "Raise IW" runs — so the
 * work order is linked to its SWO and the SWO moves to "IW raised" whichever
 * screen the planner started from. Accessories (no `swos`) keep the typed
 * reference: trims are not bought by the MOQ bag the SWO exists for.
 *
 * Shown while the plan has no work order yet. `onCreated` names the new work
 * order on the plan; the parent refreshes so the picker and header can read it.
 */
export function SampleWorkOrderCreate({
  forOptions,
  idPrefix,
  onCreated,
  swos,
}: {
  /** One entry → no For box (Accessories); two → the operator picks (Yarn / Fabric). */
  forOptions: readonly IwoFor[];
  idPrefix: string;
  onCreated: (iwoId: string) => void;
  /** Sample ▸ Fabric Plan: the approved SWOs with no work order yet. */
  swos?: readonly SwoAwaitingIw[];
}) {
  const { success, error: toastError } = useToast();
  const [isPending, start] = useTransition();
  const [iwoFor, setIwoFor] = useState<IwoFor | "">(forOptions.length === 1 ? forOptions[0] : swos ? "fabric" : "");
  const [reference, setReference] = useState("");
  const [swoId, setSwoId] = useState(swos?.length === 1 ? swos[0].id : "");
  const [deli, setDeli] = useState("");
  /** The SIW/26-27/0001 it will be given (0705) — a prediction, not a reservation. */
  const [nextNo, setNextNo] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    previewSampleIwoNumber(today()).then((n) => {
      if (!cancelled) setNextNo(n);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const ready = !!iwoFor && (!swos || !!swoId);

  function create() {
    if (!ready) return;
    start(async () => {
      const res = swos
        ? await raiseSampleGroupIw(swoId, { iwo_for: iwoFor as "fabric" | "yarn", deli_date: deli || null })
        : await saveInternalWorkOrder(null, {
            iwo_date: today(),
            iwo_for: iwoFor as IwoFor,
            reference_no: reference || null,
            deli_date: deli || null,
            remarks: null,
            is_sample: true,
          });
      if (!res.ok) {
        toastError(res.error);
        return;
      }
      const code = swos?.find((g) => g.id === swoId)?.code;
      success(code ? `Work order raised for ${code}.` : "Sample work order raised.");
      onCreated(res.iwoId);
    });
  }

  // NOTHING TO RAISE AGAINST — the box is simply absent (user 2026-10-12:
  // the "No approved SWO is waiting…" notice was removed on request).
  if (swos && swos.length === 0) return null;

  return (
    <div className="mt-3 rounded-control border border-border p-3">
      <p className="mb-2 text-sm text-muted-foreground">
        No sample work order picked — raise one for this plan
        {nextNo && (
          <>
            {" "}
            (it will be <span className="font-mono text-foreground">{nextNo}</span>)
          </>
        )}
        .
      </p>
      <FieldRow className="items-end [&_input]:h-9">
        {forOptions.length > 1 && (
          <Field label="For" required className="w-[130px]" htmlFor={`${idPrefix}-new-for`}>
            <Select
              id={`${idPrefix}-new-for`}
              value={iwoFor}
              onChange={(e) => setIwoFor(e.target.value as IwoFor | "")}
            >
              <option value="" />
              {forOptions.map((f) => (
                <option key={f} value={f}>
                  {IWO_FOR_LABELS[f]}
                </option>
              ))}
            </Select>
          </Field>
        )}
        {swos ? (
          <Field label="SWO No" required className="w-[320px]" htmlFor={`${idPrefix}-new-swo`}>
            <Select id={`${idPrefix}-new-swo`} value={swoId} onChange={(e) => setSwoId(e.target.value)}>
              <option value="" />
              {swos.map((g) => (
                <option key={g.id} value={g.id}>
                  {`${g.code} · ${g.samples} sample${g.samples === 1 ? "" : "s"} · buy ${fmtKg(g.buy_kg, 1)} kg`}
                </option>
              ))}
            </Select>
          </Field>
        ) : (
          <Field label="RE No" className="w-[170px]" htmlFor={`${idPrefix}-new-re`}>
            <Input id={`${idPrefix}-new-re`} value={reference} onChange={(e) => setReference(e.target.value)} />
          </Field>
        )}
        <Field label="Deli Dt" className="w-[145px]" htmlFor={`${idPrefix}-new-deli`}>
          <Input id={`${idPrefix}-new-deli`} type="date" value={deli} onChange={(e) => setDeli(e.target.value)} />
        </Field>
        <Button type="button" variant="outline" disabled={!ready || isPending} onClick={create}>
          {isPending ? "Raising…" : "+ New work order"}
        </Button>
      </FieldRow>
      {swos && swoId && (
        <p className="mt-2 text-xs text-muted-foreground">
          {swos.find((g) => g.id === swoId)?.label} — Deli Dt left blank takes the earliest sample&apos;s delivery date.
        </p>
      )}
    </div>
  );
}
