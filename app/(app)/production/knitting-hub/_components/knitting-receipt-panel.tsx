"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Field, FieldRow, FIELD_WIDTH_CSS } from "@/components/ui/field";
import { StatusPill } from "@/components/ui/status-pill";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { ChildGrid, type ChildGridColumn } from "@/components/masters/child-grid";
import { DENSE, GRID_HEAD } from "@/components/purchase/doc-surface";
import { fmtDate, fmtMoney, fmtNumber } from "@/lib/format";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { closeKnittingOrder, receiveKnitting } from "@/lib/production/knitting-actions";
import { knitAnalysis, type KnittingOrder } from "@/lib/production/knitting-types";
import type { BinOption, StoreOption } from "@/lib/stores/production-dc-service";

type FabricIn = {
  key: string;
  knit_fabric_id: string;
  fabric: string;
  programmed: number;
  received: number;
  rolls: string;
  net: string;
  gross: string;
  dia: string;
  storeId: string;
  binId: string;
  lot: string;
};

type YarnBack = {
  key: string;
  knit_yarn_id: string;
  yarn: string;
  atKnitter: number;
  bags: string;
  kg: string;
  storeId: string;
  binId: string;
};

const n = (s: string) => {
  const v = Number(s);
  return s.trim() && Number.isFinite(v) ? v : 0;
};

/**
 * KNITTING HUB ▸ Step 3 — Fabric Receipt & Yarn Return, and the live analysis (DB 0827,
 * doc/process/knitting-plan.md Phase 3; spec §2.4–2.5).
 *
 * The keeper types only what arrived: rolls and kg per fabric, and any yarn the knitter sent
 * back. How much of each yarn the fabric used up is DERIVED (fabric kg × blend %) by
 * `knitting_receipt_post`, never typed. The analysis above the form is a sum of posted rows.
 * A loss past the Allowed Loss % is shown red and never blocks a receipt; only Close waits
 * for the MD (D1).
 */
export function KnittingReceiptPanel({
  doc,
  stores,
  bins,
  canEdit,
  today,
}: {
  doc: KnittingOrder;
  stores: StoreOption[];
  bins: BinOption[];
  canEdit: boolean;
  today: string;
}) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, start] = useTransition();

  const receiving = canEdit && (doc.status === "in_process" || doc.status === "partially_received") && !doc.close_pending;
  // Receive into a holding store, never Processing (the knitter's side) or Transit.
  const holdStores = stores.filter((s) => s.store_type !== "processing" && s.store_type !== "transit");
  const defaultStore = holdStores.find((s) => s.store_type === "material")?.id ?? holdStores[0]?.id ?? "";

  const fresh = () => ({
    fabrics: doc.fabrics.map<FabricIn>((f) => ({
      key: f.id,
      knit_fabric_id: f.id,
      fabric: f.fabric_name,
      programmed: f.programmed_kg,
      received: f.received_kg,
      rolls: "",
      net: "",
      gross: "",
      dia: f.knit_dia ?? "",
      storeId: defaultStore,
      binId: "",
      lot: "",
    })),
    yarns: doc.fabrics.flatMap((f) =>
      f.yarns
        .filter((y) => y.at_knitter_kg > 0.0005)
        .map<YarnBack>((y) => ({
          key: y.id,
          knit_yarn_id: y.id,
          yarn: `${y.yarn_name} — ${f.fabric_name}`,
          atKnitter: y.at_knitter_kg,
          bags: "",
          kg: "",
          storeId: defaultStore,
          binId: "",
        })),
    ),
  });
  const [form, setForm] = useState(fresh);
  const [date, setDate] = useState(today);
  const [dcNo, setDcNo] = useState("");
  const [dcDate, setDcDate] = useState("");
  const [vehicle, setVehicle] = useState("");
  const [confirm, setConfirm] = useState<"post" | "close" | null>(null);
  const [reason, setReason] = useState("");

  const typedFabric = form.fabrics.filter((f) => n(f.net) > 0);
  const typedYarn = form.yarns.filter((y) => n(y.kg) > 0);
  const dirty = typedFabric.length > 0 || typedYarn.length > 0 || !!dcNo.trim();
  useUnsavedGuard(dirty || isPending);

  const a = knitAnalysis(doc.fabrics, doc.allowed_loss_pct);
  const overReturn = (y: YarnBack) => n(y.kg) > y.atKnitter + 1e-9;
  const problems = typedYarn.some(overReturn) || [...typedFabric, ...typedYarn].some((r) => !r.storeId);
  const canPost = receiving && !!date && (typedFabric.length > 0 || typedYarn.length > 0) && !problems;

  const setFabric = (key: string, patch: Partial<FabricIn>) =>
    setForm((f) => ({ ...f, fabrics: f.fabrics.map((x) => (x.key === key ? { ...x, ...patch } : x)) }));
  const setYarn = (key: string, patch: Partial<YarnBack>) =>
    setForm((f) => ({ ...f, yarns: f.yarns.map((x) => (x.key === key ? { ...x, ...patch } : x)) }));

  function post() {
    start(async () => {
      const res = await receiveKnitting(doc.id, {
        header: { receipt_date: date, vendor_dc_no: dcNo.trim() || null, vendor_dc_date: dcDate || null, vehicle_no: vehicle.trim() || null, notes: null },
        fabrics: typedFabric.map((f) => ({
          knit_fabric_id: f.knit_fabric_id,
          rolls: f.rolls.trim() ? Math.trunc(n(f.rolls)) : null,
          net_kg: n(f.net),
          gross_kg: f.gross.trim() ? n(f.gross) : null,
          received_dia: f.dia.trim() || null,
          store_id: f.storeId,
          bin_id: f.binId || null,
          lot_no: f.lot.trim() || null,
        })),
        returns: typedYarn.map((y) => ({
          knit_yarn_id: y.knit_yarn_id,
          kg: n(y.kg),
          bags: y.bags.trim() ? Math.trunc(n(y.bags)) : null,
          store_id: y.storeId,
          bin_id: y.binId || null,
        })),
      });
      setConfirm(null);
      if (!res.ok) return toastError(res.error);
      success("Received — fabric is in stock and the yarn it used is accounted for");
      setDcNo("");
      setDcDate("");
      setVehicle("");
      router.refresh();
    });
  }

  function close() {
    start(async () => {
      const res = await closeKnittingOrder(doc.id, reason);
      setConfirm(null);
      if (!res.ok) return toastError(res.error);
      success(res.outcome === "closed" ? "Knitting order closed" : "Loss is over the limit — the close is with the MD for approval");
      router.refresh();
    });
  }

  // Mandatory only on a row being received now — a fabric that did not arrive today holds nothing.
  const storeSelect = (value: string, onChange: (v: string) => void, label: string, required: boolean) => (
    <Select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} required={required}>
      <option value=""></option>
      {holdStores.map((s) => (
        <option key={s.id} value={s.id}>
          {s.name}
        </option>
      ))}
    </Select>
  );
  const binSelect = (storeId: string, value: string, onChange: (v: string) => void, label: string) => (
    <Select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value=""></option>
      {bins
        .filter((b) => !b.store_id || b.store_id === storeId)
        .map((b) => (
          <option key={b.id} value={b.id}>
            {b.code}
          </option>
        ))}
    </Select>
  );

  /*
   * Fabric 200 · Received 112 · Rolls 72 · Net Kg 112 · Gross 88 · Dia 88 · Store 144 · Bin 112
   * · Lot 112 = 1040, + 72 chrome = 1112 <= 1155 -> tableFrom="5xl".
   */
  const fabricInColumns: ChildGridColumn<FabricIn>[] = [
    { header: "Fabric", width: FIELD_WIDTH_CSS.party, cell: (f) => <span className="text-sm">{f.fabric}</span> },
    {
      header: "Received",
      width: FIELD_WIDTH_CSS.range,
      align: "right",
      cell: (f) => (
        <span className="text-xs leading-tight">
          <span className="block tabular-nums text-sm">{fmtNumber(f.received)}</span>
          <span className="block tabular-nums text-muted-foreground">of {fmtNumber(f.programmed)}</span>
        </span>
      ),
    },
    {
      header: "Rolls",
      width: FIELD_WIDTH_CSS.num,
      align: "right",
      total: { kind: "sum", of: (f) => n(f.rolls) },
      cell: (f) => <Input type="number" min="0" step="1" aria-label={`Rolls, ${f.fabric}`} value={f.rolls} onChange={(e) => setFabric(f.key, { rolls: e.target.value })} />,
    },
    {
      header: "Net Kg",
      width: FIELD_WIDTH_CSS.range,
      align: "right",
      total: { kind: "sum", of: (f) => n(f.net) },
      cell: (f) => <Input type="number" min="0" step="any" aria-label={`Net kg, ${f.fabric}`} value={f.net} onChange={(e) => setFabric(f.key, { net: e.target.value })} />,
    },
    {
      header: "Gross",
      width: FIELD_WIDTH_CSS.hug,
      align: "right",
      cell: (f) => <Input type="number" min="0" step="any" aria-label={`Gross kg, ${f.fabric}`} value={f.gross} onChange={(e) => setFabric(f.key, { gross: e.target.value })} />,
    },
    {
      header: "Dia",
      width: FIELD_WIDTH_CSS.hug,
      cell: (f) => <Input aria-label={`Received dia, ${f.fabric}`} value={f.dia} onChange={(e) => setFabric(f.key, { dia: e.target.value })} />,
    },
    {
      header: "Store",
      width: FIELD_WIDTH_CSS.code,
      // pick-once: exempt -- several fabrics may go into the same store
      cell: (f) => storeSelect(f.storeId, (v) => setFabric(f.key, { storeId: v, binId: "" }), `Store, ${f.fabric}`, n(f.net) > 0),
    },
    {
      header: "Bin",
      width: FIELD_WIDTH_CSS.range,
      // pick-once: exempt -- several fabrics may share a bin
      cell: (f) => binSelect(f.storeId, f.binId, (v) => setFabric(f.key, { binId: v }), `Bin, ${f.fabric}`),
    },
    {
      header: "Lot",
      width: FIELD_WIDTH_CSS.range,
      cell: (f) => <Input aria-label={`Lot, ${f.fabric}`} placeholder="(receipt no)" value={f.lot} onChange={(e) => setFabric(f.key, { lot: e.target.value })} />,
    },
  ];

  /* Yarn 288 · At Knitter 112 · Bags 72 · Kg 112 · Store 144 · Bin 112 = 840 + 72 = 912. */
  const yarnBackColumns: ChildGridColumn<YarnBack>[] = [
    { header: "Yarn", width: FIELD_WIDTH_CSS.name, cell: (y) => <span className="text-sm">{y.yarn}</span> },
    { header: "At Knitter", width: FIELD_WIDTH_CSS.range, align: "right", cell: (y) => <span className="tabular-nums text-sm">{fmtNumber(y.atKnitter)}</span> },
    {
      header: "Bags",
      width: FIELD_WIDTH_CSS.num,
      align: "right",
      cell: (y) => <Input type="number" min="0" step="1" aria-label={`Bags returned, ${y.yarn}`} value={y.bags} onChange={(e) => setYarn(y.key, { bags: e.target.value })} />,
    },
    {
      header: "Kg Back",
      width: FIELD_WIDTH_CSS.range,
      align: "right",
      cell: (y) => (
        <Input
          type="number"
          min="0"
          step="any"
          aria-label={`Kg returned, ${y.yarn}`}
          aria-invalid={overReturn(y) || undefined}
          title={overReturn(y) ? `Only ${fmtNumber(y.atKnitter)} kg is at the knitter` : undefined}
          value={y.kg}
          onChange={(e) => setYarn(y.key, { kg: e.target.value })}
        />
      ),
    },
    {
      header: "Store",
      width: FIELD_WIDTH_CSS.code,
      // pick-once: exempt -- returned yarns may go back to the same store
      cell: (y) => storeSelect(y.storeId, (v) => setYarn(y.key, { storeId: v, binId: "" }), `Store, ${y.yarn}`, n(y.kg) > 0),
    },
    {
      header: "Bin",
      width: FIELD_WIDTH_CSS.range,
      // pick-once: exempt -- returned yarns may share a bin
      cell: (y) => binSelect(y.storeId, y.binId, (v) => setYarn(y.key, { binId: v }), `Bin, ${y.yarn}`),
    },
  ];

  const lossTone = a.over_limit ? "text-destructive" : "text-success";

  return (
    <section className="max-w-[72rem] space-y-3 rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">3. Fabric Receipt &amp; Yarn Return</h3>
        {doc.close_pending ? <StatusPill tone="warning">Close waiting for MD</StatusPill> : null}
      </div>

      {/* THE LIVE ANALYSIS (spec §2.5) — sums of posted rows only. */}
      <div className="grid grid-cols-2 gap-3 rounded-lg bg-[var(--table-head-bg)]/30 p-3 text-sm sm:grid-cols-4">
        <Stat label="Fabric received" value={`${fmtNumber(a.fabric_received_kg)} of ${fmtNumber(a.programmed_kg)} kg`} sub={a.programmed_kg ? `${fmtNumber((a.fabric_received_kg / a.programmed_kg) * 100)}% fulfilled` : null} />
        <Stat label="Yarn sent" value={`${fmtNumber(a.yarn_sent_kg)} kg`} sub={`used ${fmtNumber(a.yarn_used_kg)} · back ${fmtNumber(a.yarn_returned_kg)}${a.written_off_kg ? ` · written off ${fmtNumber(a.written_off_kg)}` : ""}`} />
        <Stat label="At the knitter" value={`${fmtNumber(a.balance_kg)} kg`} sub="yarn to be returned / process loss" />
        <div>
          <div className="text-[11px] text-muted-foreground">Loss</div>
          <div className={`tabular-nums font-semibold ${a.loss_pct == null ? "" : lossTone}`}>{a.loss_pct == null ? "—" : `${fmtNumber(a.loss_pct)}%`}</div>
          <div className="text-[11px] text-muted-foreground">
            {a.allowed_loss_pct == null ? "no Allowed Loss % set" : `allowed ${fmtNumber(a.allowed_loss_pct)}%`}
            {a.over_limit && a.loss_pct != null ? " — OVER, close needs the MD" : ""}
          </div>
        </div>
      </div>

      {doc.receipts.length ? (
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted-foreground">
            <tr>
              <th className="py-1 font-medium">Receipt</th>
              <th className="py-1 font-medium">Date</th>
              <th className="py-1 font-medium">Knitter DC</th>
              <th className="py-1 text-right font-medium">Rolls</th>
              <th className="py-1 text-right font-medium">Fabric Kg</th>
              <th className="py-1 text-right font-medium">Yarn Back Kg</th>
              <th className="py-1 text-right font-medium">Draft Bill</th>
            </tr>
          </thead>
          <tbody>
            {doc.receipts.map((r) => (
              <tr key={r.id} className="border-t border-border">
                <td className="py-1 font-mono text-xs">{r.code ?? "—"}</td>
                <td className="py-1 tabular-nums">{fmtDate(r.receipt_date)}</td>
                <td className="py-1">{r.vendor_dc_no ?? "—"}</td>
                <td className="py-1 text-right tabular-nums">{r.rolls || "—"}</td>
                <td className="py-1 text-right tabular-nums">{fmtNumber(r.fabric_kg)}</td>
                <td className="py-1 text-right tabular-nums">{r.returned_kg ? fmtNumber(r.returned_kg) : "—"}</td>
                <td className="py-1 text-right tabular-nums">{r.bill == null ? "—" : fmtMoney(r.bill)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}

      {doc.status === "closed" && doc.close_reason ? (
        <p className="text-sm text-muted-foreground">
          Closed — written off: {doc.close_reason}
          {doc.close_remark ? ` · MD: ${doc.close_remark}` : ""}
        </p>
      ) : null}
      {!doc.close_pending && doc.close_remark && doc.status !== "closed" ? (
        <p className="text-sm text-destructive">The MD sent the close back: {doc.close_remark}</p>
      ) : null}

      {receiving ? (
        // A SECTION, NOT A <form>: it sits inside the order's form under tab 3, and a form inside a
        // form is invalid HTML. The order is read-only by now, so its own submit does nothing.
        <div className="space-y-3">
          {/* Receipt Date 144 · Knitter DC No 144 · DC Date 144 · Vehicle No 144 = 576 + 30 gap. */}
          <FieldRow nowrap>
            <Field label="Receipt Date" required w="code">
              <Input type="date" value={date} max={today || undefined} onChange={(e) => setDate(e.target.value)} required />
            </Field>
            <Field label="Knitter DC No" w="code">
              <Input value={dcNo} onChange={(e) => setDcNo(e.target.value)} />
            </Field>
            <Field label="Knitter DC Date" w="code">
              <Input type="date" value={dcDate} onChange={(e) => setDcDate(e.target.value)} />
            </Field>
            <Field label="Vehicle No" w="code">
              <Input value={vehicle} onChange={(e) => setVehicle(e.target.value)} />
            </Field>
          </FieldRow>

          {/* default-row: exempt -- one row per fabric on the order, derived */}
          <div className={DENSE}>
            <ChildGrid<FabricIn>
              label="Fabric received"
              columns={fabricInColumns}
              rows={form.fabrics}
              tableFrom="5xl"
              flatRows
              headerClassName={GRID_HEAD}
              hideAdd
              hideRemove
              keepOne={false}
              onAdd={() => false}
              onRemove={() => {}}
            />
          </div>

          {form.yarns.length ? (
            // default-row: exempt -- one row per yarn still at the knitter, derived
            <div className={DENSE}>
              <ChildGrid<YarnBack>
                label="Yarn returned unknitted"
                columns={yarnBackColumns}
                rows={form.yarns}
                tableFrom="5xl"
                flatRows
                headerClassName={GRID_HEAD}
                hideAdd
                hideRemove
                keepOne={false}
                onAdd={() => false}
                onRemove={() => {}}
              />
            </div>
          ) : null}
          {typedYarn.some(overReturn) ? <p className="text-sm text-destructive">More yarn is being returned than the knitter holds.</p> : null}

          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button type="button" variant="outline" disabled={isPending} onClick={() => setConfirm("close")}>
              Close order…
            </Button>
            <Button type="button" disabled={isPending || !canPost} onClick={() => setConfirm("post")}>
              Post receipt
            </Button>
          </div>
        </div>
      ) : null}

      <ConfirmDialog
        open={confirm === "post"}
        title={`Post this receipt on ${doc.code ?? "the knitting order"}?`}
        body={`${fmtNumber(typedFabric.reduce((t, f) => t + n(f.net), 0))} kg of fabric goes into stock, and the yarn it used (by blend %) comes off what the knitter holds. ${
          typedYarn.length ? `${fmtNumber(typedYarn.reduce((t, y) => t + n(y.kg), 0))} kg of yarn goes back on the shelf. ` : ""
        }A draft bill is raised at fabric kg × rate. A posted receipt cannot be changed.`}
        confirmLabel="Post"
        tone="primary"
        isPending={isPending}
        onConfirm={post}
        onCancel={() => setConfirm(null)}
      />
      <ConfirmDialog
        open={confirm === "close"}
        title={`Close ${doc.code ?? "this knitting order"}?`}
        body={
          <div className="space-y-2">
            <p>
              {a.balance_kg > 0.0005
                ? `${fmtNumber(a.balance_kg)} kg (${fmtNumber(a.loss_pct ?? 0)}%) is still at the knitter and will be written off as process loss.`
                : "Everything sent is accounted for."}{" "}
              {a.over_limit ? "That is over the Allowed Loss %, so the close goes to the MD for approval." : "It closes now."}
            </p>
            {a.balance_kg > 0.0005 ? (
              <Field label="Reason" required>
                <Input value={reason} onChange={(e) => setReason(e.target.value)} required />
              </Field>
            ) : null}
          </div>
        }
        confirmLabel={a.over_limit ? "Send to MD" : "Close"}
        isPending={isPending}
        onConfirm={() => {
          if (a.balance_kg > 0.0005 && !reason.trim()) return toastError("Say why the balance is written off");
          close();
        }}
        onCancel={() => setConfirm(null)}
      />
    </section>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string | null }) {
  return (
    <div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="tabular-nums font-semibold">{value}</div>
      {sub ? <div className="text-[11px] text-muted-foreground">{sub}</div> : null}
    </div>
  );
}
