"use client";

import { useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Field, FieldRow } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { previewSampleIwoNumber, saveInternalWorkOrder } from "@/lib/orders/internal-work-orders/actions";
import { IWO_FOR_LABELS, type IwoFor } from "@/lib/orders/internal-work-orders/types";
import { today } from "@/lib/calendar";

/**
 * "+ NEW WORK ORDER" ON THE SAMPLE PLAN SCREENS (0704, user 2026-10-09).
 *
 * Sample ▸ Fabric Plan / Accessories Plan are the IWO plan screens listing only
 * the SAMPLE work orders, and a plan cannot exist without its work order. On the
 * Orders route the way out is "New work order" on the IWO screen; here that
 * would drop the operator out of the Sample module halfway through a plan. So
 * the work order's header is raised in place — For, RE No, Deli Dt, the same
 * fields the plan's header then reads back — through the IWO screen's OWN
 * action (`saveInternalWorkOrder`), which takes the session's unit, numbers it
 * and needs Orders ▸ Create exactly as it does there. Only `is_sample` differs.
 *
 * Shown while the plan has no work order yet. `onCreated` names the new work
 * order on the plan; the parent refreshes so the picker and header can read it.
 */
export function SampleWorkOrderCreate({
  forOptions,
  idPrefix,
  onCreated,
}: {
  /** One entry → no For box (Accessories); two → the operator picks (Yarn / Fabric). */
  forOptions: readonly IwoFor[];
  idPrefix: string;
  onCreated: (iwoId: string) => void;
}) {
  const { success, error: toastError } = useToast();
  const [isPending, start] = useTransition();
  const [iwoFor, setIwoFor] = useState<IwoFor | "">(forOptions.length === 1 ? forOptions[0] : "");
  const [reference, setReference] = useState("");
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

  function create() {
    if (!iwoFor) return;
    start(async () => {
      const res = await saveInternalWorkOrder(null, {
        iwo_date: today(),
        iwo_for: iwoFor,
        reference_no: reference || null,
        deli_date: deli || null,
        remarks: null,
        is_sample: true,
      });
      if (!res.ok) {
        toastError(res.error);
        return;
      }
      success("Sample work order raised.");
      onCreated(res.iwoId);
    });
  }

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
        <Field label="RE No" className="w-[170px]" htmlFor={`${idPrefix}-new-re`}>
          <Input id={`${idPrefix}-new-re`} value={reference} onChange={(e) => setReference(e.target.value)} />
        </Field>
        <Field label="Deli Dt" className="w-[145px]" htmlFor={`${idPrefix}-new-deli`}>
          <Input id={`${idPrefix}-new-deli`} type="date" value={deli} onChange={(e) => setDeli(e.target.value)} />
        </Field>
        <Button type="button" variant="outline" disabled={!iwoFor || isPending} onClick={create}>
          {isPending ? "Raising…" : "+ New work order"}
        </Button>
      </FieldRow>
    </div>
  );
}
