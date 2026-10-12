"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Droplets } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Field, FieldRow } from "@/components/ui/field";
import { Sheet } from "@/components/ui/sheet";
import { StatusPill } from "@/components/ui/status-pill";
import { useToast } from "@/components/ui/toast";
import { dyeingWorkOrderLines } from "@/lib/orders/iwo-fabric-bom/dyeing";
import { raiseIwoDyeingOrder } from "@/lib/orders/iwo-fabric-bom/dyeing-actions";
import type { IwoFabricBom } from "@/lib/orders/iwo-fabric-bom/types";
import { PROC_STATUS_LABELS, type ProcStatus } from "@/lib/stores/process-types";
import { today } from "@/lib/calendar";

const kg = (n: number) => n.toLocaleString("en-IN", { minimumFractionDigits: 3, maximumFractionDigits: 3 });

/**
 * SAMPLE ▸ FABRIC PLAN ▸ DYEING WORK ORDER (client decision 2026-10-12).
 *
 * The SWO's one dyeing work order, raised from its saved plan: a Stores process
 * order whose Issue Qty is the GREIGE weight (finished ÷ (1 − dyeing loss)) and
 * whose Return Qty is the finished weight (`lib/orders/iwo-fabric-bom/dyeing.ts`).
 *
 * The preview here runs the SAME `dyeingWorkOrderLines` over the SAVED plan the
 * server will read (`bom`, never the editor's unsaved state), and the button
 * stands down while the editor is dirty — so the figures the planner confirms
 * are the figures the document carries. Only the dye house and the date go to
 * the server; it recomputes the rest.
 */
export function IwoDyeingOrder({
  iwoId,
  bom,
  isDyeing,
  fabricName,
  orders,
  vendors,
  canRaise,
  dirty,
}: {
  iwoId: string;
  /** The plan as SAVED — null until it is. */
  bom: IwoFabricBom | null;
  isDyeing: (processId: string) => boolean;
  fabricName: (itemId: string) => string;
  orders: { id: string; code: string | null; status: string }[];
  vendors: { id: string; name: string }[];
  canRaise: boolean;
  dirty: boolean;
}) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [vendorId, setVendorId] = useState("");
  const [expected, setExpected] = useState("");

  const lines = bom
    ? dyeingWorkOrderLines(
        bom.iwo_fabric_bom_lines.map((l) => ({ item_id: l.item_id, color_name: l.color_name, req_kgs: l.req_kgs })),
        bom.iwo_fabric_bom_processes.map((st) => ({
          item_id: st.item_id,
          process_id: st.process_id,
          loss_pct: st.loss_pct,
          color_losses: st.color_losses ?? null,
        })),
        isDyeing,
      )
    : [];
  const live = orders.find((o) => o.status !== "cancelled") ?? null;

  /** Why the button cannot raise one — the first reason, said beside it. */
  const blocked = !canRaise
    ? "Needs Stores ▸ Create."
    : !bom
      ? "Save the Fabric Plan first."
      : bom.is_draft
        ? "The plan is a draft — save it to raise the dyeing order."
        : dirty
          ? "Save your changes first — the order is computed from the saved plan."
          : live
            ? `${live.code ?? "A dyeing order"} is already raised.`
            : !lines.length
              ? "Nothing on this plan is dyed (no coloured line on a route with a DYEING step)."
              : null;

  const raise = () =>
    start(async () => {
      const res = await raiseIwoDyeingOrder(iwoId, { vendor_id: vendorId, expected_date: expected || null });
      if (!res.ok) {
        toastError(res.error);
        return;
      }
      success(`Dyeing order ${res.code ?? ""} raised — Stores ▸ Process Orders issues it.`);
      setOpen(false);
      router.refresh();
    });

  const totalGreige = lines.reduce((t, l) => t + l.greige_kg, 0);
  const totalFinished = lines.reduce((t, l) => t + l.finished_kg, 0);

  return (
    <div className="mt-4 rounded-control border border-border p-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="flex items-center gap-1.5 text-sm font-medium">
          <Droplets className="size-4 text-muted-foreground" aria-hidden />
          Dyeing work order
        </span>
        {orders.map((o) => (
          <Link key={o.id} href={`/stores/process-orders/${o.id}`} className="flex items-center gap-1.5 text-sm text-primary hover:underline">
            <span className="font-mono">{o.code ?? "—"}</span>
            <StatusPill tone={o.status === "cancelled" ? "danger" : "info"}>{PROC_STATUS_LABELS[o.status as ProcStatus] ?? o.status}</StatusPill>
          </Link>
        ))}
        {!orders.length && <span className="text-sm text-muted-foreground">None raised yet.</span>}
        <Button type="button" variant="outline" disabled={!!blocked} onClick={() => setOpen(true)} className="ml-auto">
          Raise dyeing order
        </Button>
      </div>
      {blocked && !live && <p className="mt-1 text-xs text-muted-foreground">{blocked}</p>}

      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        size="sm"
        title="Raise dyeing work order"
        footer={
          <>
            <Button variant="outline" disabled={isPending} onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button disabled={isPending || !vendorId} onClick={raise}>
              {isPending ? "Raising…" : "Raise dyeing order"}
            </Button>
          </>
        }
      >
        <FieldRow className="[&_input]:h-9">
          <Field label="Dye house" required className="w-full max-w-[260px]" htmlFor="dyo-vendor">
            <Select id="dyo-vendor" value={vendorId} onChange={(e) => setVendorId(e.target.value)}>
              <option value="" />
              {vendors.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Expected Dt" className="w-[145px]" htmlFor="dyo-date">
            <Input id="dyo-date" type="date" min={today()} value={expected} onChange={(e) => setExpected(e.target.value)} />
          </Field>
        </FieldRow>
        {/* BOTH WEIGHTS, as the client asked: the dye house processes and
            invoices on the greige it receives; stores checks the finished
            weight when the cloth comes back. */}
        <table className="mt-4 w-full text-xs">
          <thead className="text-muted-foreground">
            <tr className="border-b border-border">
              <th className="py-1.5 text-left font-medium">Fabric · Colour</th>
              <th className="py-1.5 text-right font-medium">Finished kg (Return)</th>
              <th className="py-1.5 text-right font-medium">Loss %</th>
              <th className="py-1.5 text-right font-medium">Greige kg (Issue)</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={`${l.item_id}|${l.color_name}`} className="border-b border-border/60">
                <td className="py-1.5">{`${fabricName(l.item_id) || "Fabric"} · ${l.color_name}`}</td>
                <td className="py-1.5 text-right tabular-nums">{kg(l.finished_kg)}</td>
                <td className="py-1.5 text-right tabular-nums">{l.loss_pct}</td>
                <td className="py-1.5 text-right font-medium tabular-nums">{kg(l.greige_kg)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td className="py-1.5 font-medium">Total</td>
              <td className="py-1.5 text-right tabular-nums">{kg(totalFinished)}</td>
              <td />
              <td className="py-1.5 text-right font-semibold tabular-nums">{kg(totalGreige)}</td>
            </tr>
          </tfoot>
        </table>
        <p className="mt-2 text-xs text-muted-foreground">
          Greige = finished ÷ (1 − dyeing loss), the loss taken from each fabric&apos;s DYEING step (per colour where the step is colour-wise).
        </p>
      </Sheet>
    </div>
  );
}
