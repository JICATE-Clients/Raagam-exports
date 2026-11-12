"use client";

import { useState, useTransition, type ReactNode } from "react";
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
import { WIDTH_FORM_LABELS, knitAnalysis, type KnitPartyTarget, type KnittingOrder } from "@/lib/production/knitting-types";
import type { BinOption, StoreOption } from "@/lib/stores/production-dc-service";

type FabricIn = {
  key: string;
  knit_fabric_id: string;
  fabric: string;
  /** The KO line's width form, shown beside the received dia. */
  form: string | null;
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
  yarn_item_id: string;
  yarn: string;
  atKnitter: number;
  /** LOCATION TYPE (client 2026-11-12, 0837): back to our store, or straight to another knitter. */
  where: "own" | "party";
  /** Party Stock: the other knitter's Knitting Order it goes to. */
  toOrderId: string;
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
 * KNITTING HUB ▸ Step 3 Fabric Receipt / Step 4 Yarn Return, and the live analysis (DB 0830,
 * doc/process/knitting-plan.md Phase 3; spec §2.4–2.5). The two are SEPARATE documents
 * (client 2026-11-11, 0831): one panel, `mode` picks which half it posts and lists. Both
 * belong to the same Knitting Order, so the analysis above reads the same on either tab.
 *
 * The keeper types only what arrived: rolls and kg per fabric, and any yarn the knitter sent
 * back. How much of each yarn the fabric used up is DERIVED (fabric kg × blend %) by
 * `knitting_receipt_post`, never typed. The analysis above the form is a sum of posted rows.
 * A loss past the Allowed Loss % is shown red and never blocks a receipt; only Close waits
 * for the MD (D1).
 */
export function KnittingReceiptPanel({
  mode,
  doc,
  orderField,
  partyTargets = [],
  stores,
  bins,
  canEdit,
  today,
}: {
  mode: "fabric" | "yarn_return";
  doc: KnittingOrder;
  /** The Knitting Order picker — the FIRST field of this screen's one header row (user 2026-11-12). */
  orderField: ReactNode;
  /** Other knitters' open Knitting Orders a Party Stock line may go to (0837). */
  partyTargets?: KnitPartyTarget[];
  stores: StoreOption[];
  bins: BinOption[];
  canEdit: boolean;
  today: string;
}) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, start] = useTransition();

  /** Yarn is out and the order is not closed — Close is offered (always direct since 0837). */
  const closable = canEdit && (doc.status === "in_process" || doc.status === "partially_received");
  // An order the OLD flow left waiting for the MD takes no more receipts; it can still be closed.
  const receiving = closable && !doc.close_pending;
  // Receive into a holding store, never Processing (the knitter's side) or Transit.
  const holdStores = stores.filter((s) => s.store_type !== "processing" && s.store_type !== "transit");
  const defaultStore = holdStores.find((s) => s.store_type === "material")?.id ?? holdStores[0]?.id ?? "";

  const fresh = () => ({
    fabrics: doc.fabrics.map<FabricIn>((f) => ({
      key: f.id,
      knit_fabric_id: f.id,
      fabric: f.fabric_name,
      form: f.width_form ? WIDTH_FORM_LABELS[f.width_form] : null,
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
          yarn_item_id: y.yarn_item_id,
          yarn: `${y.yarn_name} — ${f.fabric_name}`,
          atKnitter: y.at_knitter_kg,
          where: "own",
          toOrderId: "",
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
  /** FINAL RECEIPT (user 2026-11-12): post this fabric receipt, then close the order in the same click. */
  const [final, setFinal] = useState(false);

  const isFabric = mode === "fabric";
  const typedFabric = isFabric ? form.fabrics.filter((f) => n(f.net) > 0) : [];
  const typedYarn = isFabric ? [] : form.yarns.filter((y) => n(y.kg) > 0);
  const docs = doc.receipts.filter((r) => r.kind === mode);
  const dirty = typedFabric.length > 0 || typedYarn.length > 0 || !!dcNo.trim();
  useUnsavedGuard(dirty || isPending);

  const a = knitAnalysis(doc.fabrics, doc.allowed_loss_pct);
  const overReturn = (y: YarnBack) => n(y.kg) > y.atKnitter + 1e-9;
  const ownYarn = typedYarn.filter((y) => y.where === "own");
  const partyYarn = typedYarn.filter((y) => y.where === "party");
  /** Party Stock: only another knitter's order that carries this yarn (0837 refuses any other). */
  const targetsFor = (y: YarnBack) => partyTargets.filter((t) => t.yarn_item_ids.includes(y.yarn_item_id));
  const problems =
    typedYarn.some(overReturn) ||
    [...typedFabric, ...ownYarn].some((r) => !r.storeId) ||
    partyYarn.some((y) => !y.toOrderId);
  // The knitter's DC No and Date are asked for on a FABRIC receipt (client 2026-11-12, 0837).
  const dcMissing = isFabric && (!dcNo.trim() || !dcDate);
  const canPostBase = receiving && !!date && (typedFabric.length > 0 || typedYarn.length > 0) && !problems && !dcMissing;

  /*
   * LIVE PROCESS LOSS (client 2026-11-12) — the posted documents plus what is typed now:
   *   issued   = yarn sent, net of yarn moved on to another order (0833 / 0834), less Party Stock typed now
   *   fabric   = fabric received + net kg typed now
   *   returned = yarn returned + own-store kg typed now
   *   loss     = issued − (fabric + returned);  loss % = loss ÷ issued × 100
   * Returned and moved yarn are never loss.
   */
  const r3 = (x: number) => Math.round(x * 1000) / 1000;
  const live = (() => {
    const issued = r3(a.yarn_sent_kg - partyYarn.reduce((t, y) => t + n(y.kg), 0));
    const fabric = r3(a.fabric_received_kg + typedFabric.reduce((t, f) => t + n(f.net), 0));
    const returned = r3(a.yarn_returned_kg + ownYarn.reduce((t, y) => t + n(y.kg), 0));
    const loss = r3(issued - fabric - returned);
    const pct = issued > 0 ? r3((loss / issued) * 100) : null;
    const over = pct != null && a.allowed_loss_pct != null && pct > a.allowed_loss_pct + 0.0005;
    return { issued, fabric, returned, consumed: r3(issued - returned), loss, pct, over };
  })();
  // A final receipt writes the rest off, so it needs the reason whenever anything is left (0830 rule).
  const finalNeedsReason = isFabric && final && live.loss > 0.0005;
  const canPost = canPostBase && !(finalNeedsReason && !reason.trim());

  const setFabric = (key: string, patch: Partial<FabricIn>) =>
    setForm((f) => ({ ...f, fabrics: f.fabrics.map((x) => (x.key === key ? { ...x, ...patch } : x)) }));
  const setYarn = (key: string, patch: Partial<YarnBack>) =>
    setForm((f) => ({ ...f, yarns: f.yarns.map((x) => (x.key === key ? { ...x, ...patch } : x)) }));

  function post() {
    start(async () => {
      const res = await receiveKnitting(doc.id, {
        header: {
          receipt_date: date,
          vendor_dc_no: dcNo.trim() || null,
          vendor_dc_date: dcDate || null,
          vehicle_no: vehicle.trim() || null,
          notes: null,
        },
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
        returns: ownYarn.map((y) => ({
          knit_yarn_id: y.knit_yarn_id,
          kg: n(y.kg),
          bags: y.bags.trim() ? Math.trunc(n(y.bags)) : null,
          store_id: y.storeId,
          bin_id: y.binId || null,
        })),
        party: partyYarn.map((y) => ({ knit_yarn_id: y.knit_yarn_id, to_order_id: y.toOrderId, kg: n(y.kg) })),
      });
      if (!res.ok) {
        setConfirm(null);
        return toastError(res.error);
      }
      if (isFabric && final) {
        // Posted; now close. A close that fails leaves the receipt posted, and says so.
        const closed = await closeKnittingOrder(doc.id, reason);
        setConfirm(null);
        if (!closed.ok) toastError(`The receipt is posted, but the order did not close: ${closed.error}`);
        else success("Final receipt posted — the knitting order is closed");
      } else {
        setConfirm(null);
        success(isFabric ? "Received — fabric is in stock and the yarn it used is accounted for" : "Yarn return posted — it is back on the shelf");
      }
      setFinal(false);
      setReason("");
      setDcNo("");
      setDcDate("");
      setVehicle("");
      setForm(fresh());
      router.refresh();
    });
  }

  function close() {
    start(async () => {
      const res = await closeKnittingOrder(doc.id, reason);
      setConfirm(null);
      if (!res.ok) return toastError(res.error);
      success("Knitting order closed");
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
   * CLIENT ORDER (2026-11-12): Fabric · Received Dia & Form · Rolls · Gross Kg · Net Kg · Store &
   * Bin · Lot. Fabric 200 · Dia & Form 144 · Rolls 72 · Gross 88 · Net 112 · Store & Bin 288 ·
   * Lot 112 = 1016, + 72 chrome = 1088 <= 1155 -> tableFrom="5xl". What is already received sits
   * under the fabric's name. Net Kg is not held mandatory: a fabric that did not arrive today
   * stays blank, and the Post button asks for at least one line.
   */
  const fabricInColumns: ChildGridColumn<FabricIn>[] = [
    {
      header: "Fabric",
      width: FIELD_WIDTH_CSS.party,
      cell: (f) => (
        <span className="text-sm leading-tight">
          <span className="block">{f.fabric}</span>
          <span className="block text-xs tabular-nums text-muted-foreground">
            received {fmtNumber(f.received)} of {fmtNumber(f.programmed)}
          </span>
        </span>
      ),
    },
    {
      header: "Received Dia & Form",
      width: FIELD_WIDTH_CSS.code,
      cell: (f) => (
        <span className="flex items-center gap-1">
          <Input aria-label={`Received dia, ${f.fabric}`} value={f.dia} onChange={(e) => setFabric(f.key, { dia: e.target.value })} />
          {f.form ? <span className="shrink-0 text-xs text-muted-foreground">{f.form}</span> : null}
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
      header: "Gross Kg",
      width: FIELD_WIDTH_CSS.hug,
      align: "right",
      total: { kind: "sum", of: (f) => n(f.gross) },
      cell: (f) => <Input type="number" min="0" step="any" aria-label={`Gross kg, ${f.fabric}`} value={f.gross} onChange={(e) => setFabric(f.key, { gross: e.target.value })} />,
    },
    {
      header: "Net Kg",
      width: FIELD_WIDTH_CSS.range,
      align: "right",
      total: { kind: "sum", of: (f) => n(f.net) },
      cell: (f) => <Input type="number" min="0" step="any" aria-label={`Net kg, ${f.fabric}`} value={f.net} onChange={(e) => setFabric(f.key, { net: e.target.value })} />,
    },
    {
      header: "Store & Bin",
      width: FIELD_WIDTH_CSS.name,
      // pick-once: exempt -- several fabrics may go into the same store and bin
      cell: (f) => (
        <span className="grid grid-cols-2 gap-1">
          {storeSelect(f.storeId, (v) => setFabric(f.key, { storeId: v, binId: "" }), `Store, ${f.fabric}`, n(f.net) > 0)}
          {binSelect(f.storeId, f.binId, (v) => setFabric(f.key, { binId: v }), `Bin, ${f.fabric}`)}
        </span>
      ),
    },
    {
      header: "Lot",
      width: FIELD_WIDTH_CSS.range,
      cell: (f) => <Input aria-label={`Lot, ${f.fabric}`} placeholder="(receipt no)" value={f.lot} onChange={(e) => setFabric(f.key, { lot: e.target.value })} />,
    },
  ];

  /*
   * Yarn 288 · At Knitter 112 · Bags 72 · Kg 112 · Location Type 144 · Store / Knitting Order 176
   * · Bin 112 = 1016 + 72 = 1088 <= 1155. LOCATION TYPE (client 2026-11-12): Own Store sends it
   * back to a store and bin; Party Stock sends it straight to another knitter's Knitting Order
   * (0837 `knitting_transfer_to_party`) — that column then picks the order, and there is no bin.
   */
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
      header: "Location Type",
      width: FIELD_WIDTH_CSS.code,
      // pick-once: exempt -- every line may go to its own store, or to party stock
      cell: (y) => (
        <Select
          aria-label={`Location type, ${y.yarn}`}
          value={y.where}
          onChange={(e) => setYarn(y.key, { where: e.target.value === "party" ? "party" : "own", toOrderId: "" })}
        >
          <option value="own">Own Store</option>
          <option value="party">Party Stock</option>
        </Select>
      ),
    },
    {
      header: "Store / Knitting Order",
      width: FIELD_WIDTH_CSS.term,
      // pick-once: exempt -- several lines may go to the same store or the same other order
      cell: (y) => {
        if (y.where === "own") return storeSelect(y.storeId, (v) => setYarn(y.key, { storeId: v, binId: "" }), `Store, ${y.yarn}`, n(y.kg) > 0);
        const ts = targetsFor(y);
        return ts.length ? (
          <Select aria-label={`Knitting Order the yarn goes to, ${y.yarn}`} value={y.toOrderId} onChange={(e) => setYarn(y.key, { toOrderId: e.target.value })} required={n(y.kg) > 0}>
            <option value=""></option>
            {ts.map((t) => (
              <option key={t.id} value={t.id}>
                {`${t.code ?? "(no number)"} · ${t.vendor_name ?? "—"}`}
              </option>
            ))}
          </Select>
        ) : (
          <span className="block px-2 text-xs text-destructive">No open order of another knitter uses this yarn</span>
        );
      },
    },
    {
      header: "Bin",
      width: FIELD_WIDTH_CSS.range,
      // pick-once: exempt -- returned yarns may share a bin
      cell: (y) => (y.where === "own" ? binSelect(y.storeId, y.binId, (v) => setYarn(y.key, { binId: v }), `Bin, ${y.yarn}`) : <span className="block px-2 text-sm text-muted-foreground">—</span>),
    },
  ];

  const lossTone = a.over_limit ? "text-destructive" : "text-success";

  return (
    // ONE FRAME, ONE HEADER ROW (user 2026-11-12: "that order field only on top — fix it"): the
    // Knitting Order picker leads the same row as the receipt's own fields; no card inside a card.
    <section className="space-y-3">
      <ReceiptHeaderRow
        isFabric={isFabric}
        orderField={orderField}
        knitter={doc.vendor_name}
        disabled={!receiving}
        today={today}
        value={{ date, dcNo, dcDate, vehicle }}
        on={{ date: setDate, dcNo: setDcNo, dcDate: setDcDate, vehicle: setVehicle }}
      />
      {doc.close_pending ? (
        <div className="flex justify-end">
          <StatusPill tone="warning">Left waiting for the MD — close it directly</StatusPill>
        </div>
      ) : null}

      {/* LIVE PROCESS LOSS SUMMARY (client 2026-11-12) — posted documents plus this entry, as typed. */}
      <div className="grid grid-cols-2 gap-3 rounded-lg bg-[var(--table-head-bg)]/30 p-3 text-sm sm:grid-cols-3 lg:grid-cols-6" aria-live="polite">
        <Stat label="Total Issued Yarn" value={`${fmtNumber(live.issued)} kg`} sub={a.balance_kg > 0.0005 ? `${fmtNumber(a.balance_kg)} kg at the knitter` : null} />
        <Stat label="Fabric Received" value={`${fmtNumber(live.fabric)} kg`} sub={a.programmed_kg ? `of ${fmtNumber(a.programmed_kg)} kg programmed` : null} />
        <Stat label="Returned Yarn" value={`${fmtNumber(live.returned)} kg`} sub={null} />
        <Stat label="Net Consumed Yarn" value={`${fmtNumber(live.consumed)} kg`} sub="issued − returned" />
        <Stat label="Actual Process Loss" value={`${fmtNumber(live.loss)} kg`} sub="issued − (fabric + returned)" />
        <div>
          <div className="text-[11px] text-muted-foreground">Actual Loss %</div>
          <div className={`tabular-nums font-semibold ${live.over ? "text-destructive" : ""}`}>{live.pct == null ? "—" : `${fmtNumber(live.pct)} %`}</div>
          <div className="text-[11px] text-muted-foreground">
            {a.allowed_loss_pct == null ? "(no Allowed Loss % set)" : `(Allowed Loss: ${fmtNumber(a.allowed_loss_pct)} %)`}
          </div>
        </div>
      </div>

      {docs.length ? (
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted-foreground">
            <tr>
              <th className="py-1 font-medium">{isFabric ? "Receipt" : "Return"}</th>
              <th className="py-1 font-medium">Date</th>
              <th className="py-1 font-medium">Knitter DC</th>
              {isFabric ? (
                <>
                  <th className="py-1 text-right font-medium">Rolls</th>
                  <th className="py-1 text-right font-medium">Fabric Kg</th>
                  <th className="py-1 text-right font-medium">Draft Bill</th>
                </>
              ) : (
                <th className="py-1 text-right font-medium">Yarn Back Kg</th>
              )}
            </tr>
          </thead>
          <tbody>
            {docs.map((r) => (
              <tr key={r.id} className="border-t border-border">
                <td className="py-1 font-mono text-xs">{r.code ?? "—"}</td>
                <td className="py-1 tabular-nums">{fmtDate(r.receipt_date)}</td>
                <td className="py-1">{r.vendor_dc_no ?? "—"}</td>
                {isFabric ? (
                  <>
                    <td className="py-1 text-right tabular-nums">{r.rolls || "—"}</td>
                    <td className="py-1 text-right tabular-nums">{fmtNumber(r.fabric_kg)}</td>
                    <td className="py-1 text-right tabular-nums">{r.bill == null ? "—" : fmtMoney(r.bill)}</td>
                  </>
                ) : (
                  <td className="py-1 text-right tabular-nums">{fmtNumber(r.returned_kg)}</td>
                )}
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

          {/* default-row: exempt -- one row per fabric on the order, derived */}
          {isFabric ? (
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
          ) : null}

          {!isFabric && !form.yarns.length ? <p className="text-sm text-muted-foreground">The knitter holds no yarn on this order — nothing to return.</p> : null}
          {!isFabric && form.yarns.length ? (
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
          {dcMissing && typedFabric.length ? <p className="text-sm text-destructive">Enter the Knitter DC No and Knitter DC Date the fabric came with.</p> : null}

          {isFabric ? (
            <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" className="size-4" checked={final} onChange={(e) => setFinal(e.target.checked)} />
                Final receipt — close this order
              </label>
              {final && live.loss > 0.0005 ? (
                <Field label="Reason for the write-off" required w="name">
                  <Input value={reason} onChange={(e) => setReason(e.target.value)} required />
                </Field>
              ) : null}
              {final ? (
                <span className={`text-xs ${live.over ? "text-destructive" : "text-muted-foreground"}`}>
                  {live.loss > 0.0005
                    ? `${fmtNumber(live.loss)} kg (${fmtNumber(live.pct ?? 0)} %) still at the knitter is written off as process loss on close.`
                    : "Everything sent is accounted for."}
                </span>
              ) : null}
            </div>
          ) : null}

          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button type="button" variant="outline" disabled={isPending} onClick={() => setConfirm("close")}>
              Close order…
            </Button>
            <Button type="button" disabled={isPending || !canPost} onClick={() => setConfirm("post")}>
              {isFabric ? (final ? "Post & close" : "Post receipt") : "Post return"}
            </Button>
          </div>
        </div>
      ) : null}
      {closable && !receiving ? (
        // Left close_pending by the old MD flow (before 0837): it closes directly now.
        <div className="flex justify-end">
          <Button type="button" variant="outline" disabled={isPending} onClick={() => setConfirm("close")}>
            Close order…
          </Button>
        </div>
      ) : null}

      <ConfirmDialog
        open={confirm === "post"}
        title={isFabric ? `Post this fabric receipt on ${doc.code ?? "the knitting order"}?` : `Post this yarn return on ${doc.code ?? "the knitting order"}?`}
        body={
          isFabric
            ? `${fmtNumber(typedFabric.reduce((t, f) => t + n(f.net), 0))} kg of fabric goes into stock, and the yarn it used (by blend %) comes off what the knitter holds. A draft bill is raised at fabric kg × rate. A posted receipt cannot be changed.${final ? " Then the order closes — whatever is still at the knitter is written off as process loss." : ""}`
            : [
                ownYarn.length ? `${fmtNumber(ownYarn.reduce((t, y) => t + n(y.kg), 0))} kg of yarn comes back from the knitter onto the shelf.` : null,
                partyYarn.length
                  ? `${fmtNumber(partyYarn.reduce((t, y) => t + n(y.kg), 0))} kg goes straight from this knitter to another knitter's order (Party Stock) — a paper DC is raised on that order.`
                  : null,
                "A posted return cannot be changed.",
              ]
                .filter(Boolean)
                .join(" ")
        }
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
              {a.over_limit ? "That is over the Allowed Loss % — it closes now, and the loss stays red on the Knitting Analysis." : "It closes now."}
            </p>
            {a.balance_kg > 0.0005 ? (
              <Field label="Reason" required>
                <Input value={reason} onChange={(e) => setReason(e.target.value)} required />
              </Field>
            ) : null}
          </div>
        }
        confirmLabel="Close"
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

type HeaderValues = { date: string; dcNo: string; dcDate: string; vehicle: string };

/**
 * THE ONE HEADER ROW of Fabric Receipt / Yarn Return ▸ New (user 2026-11-12): Knitting Order ·
 * Receipt Date · Knitter · Knitter DC No · Knitter DC Date · Vehicle No.
 * Knitting Order 200 · Receipt Date 144 · Knitter 200 · DC No 144 · DC Date 144 · Vehicle 144
 * = 976 + 50 gap. Transporter was removed (user 2026-11-12, screenshot 4131: "what is transporter —
 * remove it"); `knitting_receipts.transporter` (0838) stays, unused. Before an order is picked (and
 * on an order that can take nothing more) every field but the picker is disabled. The knitter's
 * DC No and Date are mandatory on a FABRIC receipt (0837).
 */
export function ReceiptHeaderRow({
  isFabric,
  orderField,
  knitter,
  disabled,
  today,
  value,
  on,
}: {
  isFabric: boolean;
  orderField: ReactNode;
  knitter: string | null;
  disabled: boolean;
  today: string;
  value?: HeaderValues;
  on?: { [K in keyof HeaderValues]: (v: string) => void };
}) {
  const v = value ?? { date: "", dcNo: "", dcDate: "", vehicle: "" };
  const live = !disabled && !!on;
  return (
    <FieldRow>
      {orderField}
      <Field label="Receipt Date" required={live} w="code">
        <Input type="date" value={v.date} max={today || undefined} disabled={!live} onChange={(e) => on?.date(e.target.value)} required={live} />
      </Field>
      <Field label="Knitter" w="party">
        <Input readOnly value={knitter ?? ""} placeholder="—" />
      </Field>
      <Field label="Knitter DC No" required={live && isFabric} w="code">
        <Input value={v.dcNo} disabled={!live} onChange={(e) => on?.dcNo(e.target.value)} required={live && isFabric} />
      </Field>
      <Field label="Knitter DC Date" required={live && isFabric} w="code">
        <Input type="date" value={v.dcDate} max={today || undefined} disabled={!live} onChange={(e) => on?.dcDate(e.target.value)} required={live && isFabric} />
      </Field>
      <Field label="Vehicle No" w="code">
        <Input value={v.vehicle} disabled={!live} onChange={(e) => on?.vehicle(e.target.value)} />
      </Field>
    </FieldRow>
  );
}
