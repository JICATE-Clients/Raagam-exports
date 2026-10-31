"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChildGrid, type ChildGridColumn } from "@/components/masters/child-grid";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { FieldError, FIELD_WIDTH_CSS } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Truncated } from "@/components/ui/truncated";
import { useToast } from "@/components/ui/toast";
import { receiveProductionDc } from "@/lib/stores/production-dc-actions";
import type { BinOption, ProductionDc, StoreOption } from "@/lib/stores/production-dc-service";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { fmtDate, fmtNumber } from "@/lib/format";

/**
 * PRODUCTION DC — RECEIVE (0784), at the unit it was sent to. Every line is settled in one
 * go: what arrived goes into this unit's store and bin, the rest is a SHORTAGE with a
 * mandatory reason (written off the sender's In Transit store). Received opens on the
 * sent qty, so a clean delivery is one click.
 */

type Line = {
  key: string;
  item: string;
  uom: string | null;
  sent: number;
  received: string;
  reason: string;
  storeId: string;
  binId: string;
};

function num(s: string): number {
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

export function ProductionDcReceiveForm({ dc, stores, bins }: { dc: ProductionDc; stores: StoreOption[]; bins: BinOption[] }) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();
  const defaultStore = stores.find((s) => s.store_type === "material")?.id ?? stores[0]?.id ?? "";
  const [lines, setLines] = useState<Line[]>(() =>
    dc.lines.map((l) => ({
      key: l.id,
      item: l.item_name,
      uom: l.uom,
      sent: l.sent_qty,
      received: String(l.sent_qty),
      reason: "",
      storeId: defaultStore,
      binId: "",
    })),
  );
  const [dirty, setDirty] = useState(false);
  useUnsavedGuard(dirty || isPending);

  function update(key: string, patch: Partial<Omit<Line, "key">>) {
    setDirty(true);
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }
  const short = (l: Line) => Math.max(0, Math.round((l.sent - num(l.received)) * 1000) / 1000);
  const problemOf = (l: Line): string | null =>
    num(l.received) < 0 || num(l.received) > l.sent + 1e-9 ? `Between 0 and ${fmtNumber(l.sent)}` : null;
  const blocked = lines.some((l) => problemOf(l) || (short(l) > 0 && !l.reason.trim()) || (num(l.received) > 0 && !l.storeId));
  const canSave = !isPending && lines.length > 0 && !blocked;

  function receive() {
    if (!canSave) return;
    startTransition(async () => {
      const result = await receiveProductionDc(
        dc.id,
        lines.map((l) => ({
          line_id: l.key,
          received_qty: num(l.received),
          shortage_reason: short(l) > 0 ? l.reason.trim() : null,
          store_id: l.storeId || null,
          bin_id: l.binId || null,
        })),
      );
      if (result.ok) {
        setDirty(false);
        success("Received into this unit's stock");
        router.push("/stores/production-dc");
      } else {
        toastError(result.error);
      }
    });
  }

  /*
   * Item 288 · Sent 88 · Received 88 · Short 88 · Reason 176 · Store 112 · Bin 112 = 952,
   * + 40 (`#`; no ✕ — the lines are the DC's own) = 992 <= 1155 -> tableFrom="5xl".
   */
  const columns: ChildGridColumn<Line>[] = [
    { header: "Item", width: FIELD_WIDTH_CSS.name, cell: (l) => <Truncated className="text-sm">{l.item}</Truncated> },
    {
      header: "Sent",
      width: FIELD_WIDTH_CSS.hug,
      align: "right",
      cell: (l) => (
        <span className="tabular-nums text-sm">
          {fmtNumber(l.sent)} <span className="text-xs text-muted-foreground">{l.uom ?? ""}</span>
        </span>
      ),
    },
    {
      header: "Received",
      width: FIELD_WIDTH_CSS.hug,
      required: true,
      cell: (l) => {
        const problem = problemOf(l);
        return (
          <>
            <Input
              type="number"
              min={0}
              max={l.sent}
              inputMode="decimal"
              aria-label={`Received, ${l.item}`}
              aria-invalid={problem ? true : undefined}
              aria-describedby={problem ? `pdcr-${l.key}-error` : undefined}
              className="h-8 text-right tabular-nums"
              value={l.received}
              onChange={(e) => update(l.key, { received: e.target.value })}
            />
            <FieldError id={`pdcr-${l.key}-error`}>{problem}</FieldError>
          </>
        );
      },
    },
    {
      header: "Short",
      width: FIELD_WIDTH_CSS.hug,
      align: "right",
      cell: (l) =>
        short(l) > 0 ? <span className="tabular-nums text-sm font-semibold text-danger">{fmtNumber(short(l))}</span> : null,
    },
    {
      header: "Shortage Reason",
      width: FIELD_WIDTH_CSS.term,
      cell: (l) => {
        // Mandatory exactly when something is short — and only then on the Tab path.
        const needed = short(l) > 0;
        return (
          <div data-focus-optional={needed ? undefined : ""}>
            <Input
              aria-label={`Shortage reason, ${l.item}`}
              required={needed}
              disabled={!needed}
              className="h-8"
              value={l.reason}
              onChange={(e) => update(l.key, { reason: e.target.value })}
            />
          </div>
        );
      },
    },
    {
      header: "Store",
      width: FIELD_WIDTH_CSS.range,
      cell: (l) => (
        <Select aria-label={`Store, ${l.item}`} className="h-8" value={l.storeId} onChange={(e) => update(l.key, { storeId: e.target.value })}>
          {stores.length === 0 ? <option value="">No store in this unit</option> : null}
          {stores.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </Select>
      ),
    },
    {
      header: "Bin",
      width: FIELD_WIDTH_CSS.range,
      cell: (l) => (
        <Select aria-label={`Bin, ${l.item}`} className="h-8" value={l.binId} onChange={(e) => update(l.key, { binId: e.target.value })}>
          <option value="">{bins.length === 0 ? "No bins yet" : "—"}</option>
          {bins.map((b) => (
            <option key={b.id} value={b.id}>
              {b.code}
            </option>
          ))}
        </Select>
      ),
    },
  ];

  return (
    <div data-focus-scope className="space-y-5">
      <Card className="max-w-[68rem]">
        <CardHeader>
          <CardTitle>Receive Production DC {dc.code ?? ""}</CardTitle>
        </CardHeader>
        <CardBody>
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-5">
            {[
              ["From", dc.from_unit],
              ["To", dc.to_unit],
              ["DC Date", fmtDate(dc.dc_date)],
              ["Vehicle", dc.vehicle_no ?? "—"],
              ["E-way Bill", dc.eway_bill_no ?? "—"],
            ].map(([k, v]) => (
              <div key={k}>
                <dt className="text-xs text-muted-foreground">{k}</dt>
                <dd className="mt-0.5 font-medium">{v}</dd>
              </div>
            ))}
          </dl>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Items Received</CardTitle>
          <span className="text-xs text-muted-foreground">Received opens on what was sent — lower it if less arrived, and say why</span>
        </CardHeader>
        <CardBody>
          {/* default-row: exempt -- the rows are the DC's own lines, derived; nothing is added here */}
          <ChildGrid<Line>
            columns={columns}
            rows={lines}
            tableFrom="5xl"
            flatRows
            hideAdd
            hideRemove
            keepOne={false}
            onAdd={() => false}
            onRemove={() => {}}
          />
        </CardBody>
      </Card>

      <div data-focus-region="footer" className="flex flex-wrap items-center gap-3">
        <Button variant="outline" onClick={() => router.push("/stores/production-dc")} disabled={isPending}>
          Cancel
        </Button>
        <Button onClick={receive} disabled={!canSave}>
          {isPending ? "Receiving…" : "Receive"}
        </Button>
        {!canSave && !isPending && blocked ? (
          <span className="text-sm text-muted-foreground">Give a reason for every shortage and pick a store</span>
        ) : null}
      </div>
    </div>
  );
}
