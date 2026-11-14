"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Combobox } from "@/components/ui/combobox";
import { MultiSelect } from "@/components/ui/multi-select";
import { Toggle } from "@/components/ui/toggle";
import { Field, FieldRow, FIELD_WIDTH_CSS } from "@/components/ui/field";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { ChildGrid, type ChildGridColumn } from "@/components/masters/child-grid";
import { DENSE, DOC_BOTTOM_BAR, DOC_FRAME, GRID_HEAD } from "@/components/purchase/doc-surface";
import { fmtNumber } from "@/lib/format";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { receiveKnittingGrn } from "@/lib/production/knitting-actions";
import { WIDTH_FORM_LABELS, knitAnalysis, type KnittingOrder, type KnittingOrderListRow } from "@/lib/production/knitting-types";
import type { BinOption, StoreOption } from "@/lib/stores/production-dc-service";

/** What the keeper types on one fabric line, keyed by the KO fabric line id. */
type Typed = { rolls: string; weight: string; dia: string | null; storeId: string | null; binId: string; lot: string };

type Row = {
  key: string;
  fabric: string;
  form: string | null;
  toCome: number;
  rolls: string;
  weight: string;
  dia: string;
  storeId: string;
  binId: string;
  lot: string;
};

const BASE = "/process/knitting-receipts/new";
const n = (s: string) => {
  const v = Number(s);
  return s.trim() && Number.isFinite(v) ? v : 0;
};
const r3 = (x: number) => Math.round(x * 1000) / 1000;

/**
 * PROCESS ▸ KNITTING ▸ FABRIC RECEIPTS ▸ New — MULTI-ORDER FABRIC GRN (Session 3, 0846).
 *
 * One knitter's DC often brings rolls for SEVERAL Knitting Orders. The header is the GRN —
 * Knitter, the Knitting Orders on it (multi-select, that knitter's open ones), Category,
 * GRN Date, Knitter DC No / Date, Vehicle — and under it one block per order: its live process
 * loss and its fabric lines. Gross and Net are ONE "Weight (kg)" (saved as net kg).
 *
 * CLOSE & COMPLETION, ticked, closes every order on the GRN as it saves — whatever balance is
 * still at the knitter is written off with the reason given (asked only when something is left).
 * Post and close are one database call (`knitting_grn_post`): a close that fails saves nothing.
 *
 * The chosen orders live in the URL (?orders=a,b — ?order=a from a Knitting Order link still
 * works), so the server loads each one; everything typed is keyed by fabric line and survives
 * adding or removing an order.
 */
export function KnitFabricGrn({
  orders,
  waiting,
  docs,
  stores,
  bins,
  canEdit,
  today,
}: {
  /** Knitting Orders whose yarn is out and that are not closed. */
  orders: KnittingOrderListRow[];
  /** Issued orders still waiting for their yarn — named, so an empty list explains itself. */
  waiting: KnittingOrderListRow[];
  /** The chosen orders, loaded in full. */
  docs: KnittingOrder[];
  stores: StoreOption[];
  bins: BinOption[];
  canEdit: boolean;
  today: string;
}) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, start] = useTransition();

  const [vendorId, setVendorId] = useState(docs[0]?.vendor_id ?? "");
  const [categoryId, setCategoryId] = useState("");
  const [date, setDate] = useState(today);
  const [dcNo, setDcNo] = useState("");
  const [dcDate, setDcDate] = useState("");
  const [vehicle, setVehicle] = useState("");
  const [typed, setTyped] = useState<Record<string, Typed>>({});
  const [closeAll, setCloseAll] = useState(false);
  const [reason, setReason] = useState("");
  const [confirm, setConfirm] = useState(false);

  // Receive into a holding store, never Processing (the knitter's side) or Transit.
  const holdStores = stores.filter((s) => s.store_type !== "processing" && s.store_type !== "transit");
  const defaultStore = holdStores.find((s) => s.store_type === "material")?.id ?? holdStores[0]?.id ?? "";

  // ---- header options ----------------------------------------------------------------------
  const knitters = [...new Map(orders.flatMap((o) => (o.vendor_id ? [[o.vendor_id, o.vendor_name ?? "—"] as const] : []))).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const ofKnitter = orders.filter((o) => o.vendor_id === vendorId);
  const categories = [...new Map(ofKnitter.flatMap((o) => o.categories.map((c) => [c.id, c.name] as const))).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const chosenIds = docs.map((d) => d.id);
  // The Category narrows the orders offered; an order already chosen is never filtered away.
  const orderOptions = ofKnitter
    .filter((o) => !categoryId || o.categories.some((c) => c.id === categoryId) || chosenIds.includes(o.id))
    .map((o) => ({ id: o.id, label: [o.code ?? "(no number)", o.order_number ? `RE ${o.order_number}` : null].filter(Boolean).join(" · ") }));

  const pickOrders = (ids: string[]) => router.replace(ids.length ? `${BASE}?orders=${ids.join(",")}` : BASE, { scroll: false });
  const pickKnitter = (v: string) => {
    setVendorId(v);
    setCategoryId("");
    if (docs.length) pickOrders([]);
  };

  // ---- rows: one block per chosen order, its fabrics narrowed by the Category ---------------
  const rowOf = (f: KnittingOrder["fabrics"][number]): Row => {
    const t = typed[f.id];
    return {
      key: f.id,
      fabric: f.fabric_name,
      form: f.width_form ? WIDTH_FORM_LABELS[f.width_form] : null,
      toCome: r3(f.programmed_kg - f.received_kg),
      rolls: t?.rolls ?? "",
      weight: t?.weight ?? "",
      dia: t?.dia ?? f.knit_dia ?? "",
      storeId: t?.storeId ?? defaultStore,
      binId: t?.binId ?? "",
      lot: t?.lot ?? "",
    };
  };
  const blocks = docs.map((d) => {
    const rows = d.fabrics.filter((f) => !categoryId || f.category_id === categoryId).map(rowOf);
    const now = rows.reduce((t, r) => t + n(r.weight), 0);
    const a = knitAnalysis(d.fabrics, d.allowed_loss_pct);
    const fabric = r3(a.fabric_received_kg + now);
    // What is left at the knitter once this GRN saves — what Close writes off.
    const left = r3(a.yarn_sent_kg - fabric - a.yarn_returned_kg);
    const pct = a.yarn_sent_kg > 0 ? r3((left / a.yarn_sent_kg) * 100) : null;
    const over = pct != null && a.allowed_loss_pct != null && pct > a.allowed_loss_pct + 0.0005;
    return { doc: d, rows, now, a, fabric, left, pct, over };
  });

  const typedRows = blocks.flatMap((b) => b.rows.filter((r) => n(r.weight) > 0));
  const totalNow = r3(typedRows.reduce((t, r) => t + n(r.weight), 0));
  const leftToWriteOff = closeAll ? r3(blocks.reduce((t, b) => t + Math.max(0, b.left), 0)) : 0;
  const needReason = closeAll && leftToWriteOff > 0.0005;
  const dirty = typedRows.length > 0 || !!dcNo.trim() || docs.length > 0;
  useUnsavedGuard(dirty || isPending);

  const canSave =
    canEdit &&
    docs.length > 0 &&
    typedRows.length > 0 &&
    !!date &&
    !!dcNo.trim() &&
    !!dcDate &&
    !typedRows.some((r) => !r.storeId) &&
    !(needReason && !reason.trim());

  const set = (key: string, patch: Partial<Typed>) =>
    setTyped((m) => {
      const cur = m[key] ?? { rolls: "", weight: "", dia: null, storeId: null, binId: "", lot: "" };
      return { ...m, [key]: { ...cur, ...patch } };
    });

  function save() {
    start(async () => {
      const res = await receiveKnittingGrn({
        header: { receipt_date: date, vendor_id: vendorId, vendor_dc_no: dcNo.trim(), vendor_dc_date: dcDate, vehicle_no: vehicle.trim() || null, category_id: categoryId || null },
        orders: blocks.map((b) => ({
          order_id: b.doc.id,
          fabrics: b.rows
            .filter((r) => n(r.weight) > 0)
            .map((r) => ({
              knit_fabric_id: r.key,
              rolls: r.rolls.trim() ? Math.trunc(n(r.rolls)) : null,
              net_kg: n(r.weight),
              gross_kg: null,
              received_dia: r.dia.trim() || null,
              store_id: r.storeId,
              bin_id: r.binId || null,
              lot_no: r.lot.trim() || null,
            })),
        })),
        close: closeAll,
        reason,
      });
      setConfirm(false);
      if (!res.ok) return toastError(res.error);
      success(closeAll ? "GRN saved — fabric is in stock and the knitting orders are closed" : "GRN saved — fabric is in stock and the yarn it used is accounted for");
      setTyped({});
      router.push("/process/knitting-receipts");
    });
  }

  // ---- grid ------------------------------------------------------------------------------
  const storeSelect = (r: Row) => (
    <Select aria-label={`Store, ${r.fabric}`} value={r.storeId} onChange={(e) => set(r.key, { storeId: e.target.value, binId: "" })} required={n(r.weight) > 0}>
      <option value=""></option>
      {holdStores.map((s) => (
        <option key={s.id} value={s.id}>
          {s.name}
        </option>
      ))}
    </Select>
  );
  const binSelect = (r: Row) => (
    <Select aria-label={`Bin, ${r.fabric}`} value={r.binId} onChange={(e) => set(r.key, { binId: e.target.value })}>
      <option value=""></option>
      {bins
        .filter((b) => !b.store_id || b.store_id === r.storeId)
        .map((b) => (
          <option key={b.id} value={b.id}>
            {b.code}
          </option>
        ))}
    </Select>
  );

  /*
   * # · Fabric 200 · Received Dia & Form 144 · Rolls 72 · Weight (kg) 112 · Store 144 · Bin 112 ·
   * Lot 112 = 896, + 72 chrome = 968 <= 1155 -> tableFrom="5xl". Weight is not held mandatory: a
   * fabric that did not arrive today stays blank, and Save asks for at least one line.
   */
  const grnFabricColumns: ChildGridColumn<Row>[] = [
    {
      header: "Fabric",
      width: FIELD_WIDTH_CSS.party,
      cell: (r) => (
        <span className="text-sm leading-tight">
          <span className="block">{r.fabric}</span>
          {r.toCome > 0.0005 ? <span className="block text-xs tabular-nums text-muted-foreground">{fmtNumber(r.toCome)} kg still to come</span> : null}
        </span>
      ),
    },
    {
      header: "Received Dia & Form",
      width: FIELD_WIDTH_CSS.code,
      cell: (r) => (
        <span className="flex items-center gap-1">
          <Input aria-label={`Received dia, ${r.fabric}`} value={r.dia} onChange={(e) => set(r.key, { dia: e.target.value })} />
          {r.form ? <span className="shrink-0 text-xs text-muted-foreground">{r.form}</span> : null}
        </span>
      ),
    },
    {
      header: "Rolls",
      width: FIELD_WIDTH_CSS.num,
      align: "right",
      total: { kind: "sum", of: (r) => n(r.rolls) },
      cell: (r) => <Input type="number" min="0" step="1" aria-label={`Rolls, ${r.fabric}`} value={r.rolls} onChange={(e) => set(r.key, { rolls: e.target.value })} />,
    },
    {
      header: "Weight (kg)",
      width: FIELD_WIDTH_CSS.range,
      align: "right",
      total: { kind: "sum", of: (r) => n(r.weight) },
      cell: (r) => <Input type="number" min="0" step="any" aria-label={`Weight kg, ${r.fabric}`} value={r.weight} onChange={(e) => set(r.key, { weight: e.target.value })} />,
    },
    {
      header: "Store",
      width: FIELD_WIDTH_CSS.code,
      // pick-once: exempt -- several fabrics may go into the same store
      cell: storeSelect,
    },
    {
      header: "Bin",
      width: FIELD_WIDTH_CSS.range,
      // pick-once: exempt -- several fabrics may share a bin
      cell: binSelect,
    },
    {
      header: "Lot",
      width: FIELD_WIDTH_CSS.range,
      cell: (r) => <Input aria-label={`Lot, ${r.fabric}`} placeholder="(GRN no)" value={r.lot} onChange={(e) => set(r.key, { lot: e.target.value })} />,
    },
  ];

  const tone = (b: (typeof blocks)[number]) =>
    b.a.allowed_loss_pct == null || b.pct == null ? "bg-muted text-muted-foreground" : b.over ? "bg-danger/10 text-danger" : "bg-success/10 text-success";

  return (
    <div className="space-y-2">
      <div className="flex justify-end">
        <Link href="/process/knitting-receipts" className="text-sm text-primary hover:underline">
          ← Fabric Receipts
        </Link>
      </div>
      <div className={DOC_FRAME} data-focus-scope="">
        <div className="space-y-3 p-4">
          {/*
            THE GRN HEADER — GRN No 144 · GRN Date 144 · Knitter 200 · Knitter DC No 144 · Knitter DC Date
            144 · Knitting Orders 288 · Category 176 · Vehicle No 144 (user 2026-11-14 order). The GRN No is given on Save
            (the PRC series — one register with every receipt).
          */}
          <FieldRow>
            {/* GRN No (spec 2026-11-14): read-only, shown before Save so the header reads as the
                spec's — the number itself is given on Save (PRC series). Never a Tab stop. */}
            <Field label="GRN No" w="code">
              <Input readOnly tabIndex={-1} value="" placeholder="Given on Save" aria-label="GRN No — given on Save" />
            </Field>
            <Field label="GRN Date" required w="code">
              <Input type="date" value={date} max={today || undefined} onChange={(e) => setDate(e.target.value)} required />
            </Field>
            <Field label="Knitter" required w="party">
              <Combobox
                options={knitters.map(([id, name]) => ({ value: id, label: name }))}
                value={vendorId}
                onChange={pickKnitter}
                placeholder={knitters.length ? "" : "No knitter has yarn out"}
                required
              />
            </Field>
            <Field label="Knitter DC No" required w="code">
              <Input value={dcNo} onChange={(e) => setDcNo(e.target.value)} required />
            </Field>
            <Field label="Knitter DC Date" required w="code">
              <Input type="date" value={dcDate} max={today || undefined} onChange={(e) => setDcDate(e.target.value)} required />
            </Field>
            {/* ORDER (user 2026-11-14): GRN No · GRN Date · Knitter · Knitter DC No (· DC Date) · Knitting
                Orders (many) — then Category and Vehicle No. */}
            <Field label="Knitting Orders" required w="name">
              <MultiSelect
                compact
                label="Knitting Orders"
                options={orderOptions}
                values={chosenIds}
                onChange={pickOrders}
                disabled={!vendorId}
                placeholder={vendorId ? "" : "Pick the knitter first"}
                emptyLabel={vendorId ? "No open order of this knitter" : "Pick the knitter first"}
                summarizeLabels
                summaryNoun="orders"
                required
              />
            </Field>
            <Field label="Category" w="term">
              <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} disabled={!vendorId}>
                <option value="">All</option>
                {categories.map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Vehicle No" w="code">
              <Input value={vehicle} onChange={(e) => setVehicle(e.target.value)} />
            </Field>
          </FieldRow>

          {orders.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Fabric comes back only after yarn has gone to the knitter, and no Knitting Order has yarn out yet.
              {waiting.length ? (
                <>
                  {" "}
                  Issued, waiting for their yarn:{" "}
                  {waiting.map((o, i) => (
                    <span key={o.id}>
                      {i ? ", " : ""}
                      <Link href={`/process/knitting-hub/${o.id}`} className="text-primary hover:underline">
                        {o.code ?? "(no number)"}
                      </Link>
                    </span>
                  ))}
                  {" "}— send it from the order with Send Yarn.
                </>
              ) : null}
            </p>
          ) : null}

          {blocks.map((b) => (
            // default-row: exempt -- one row per fabric on the knitting order, derived
            <section key={b.doc.id} className={`${DENSE} space-y-1.5`}>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                <Link href={`/process/knitting-hub/${b.doc.id}`} className="font-semibold text-primary hover:underline">
                  {b.doc.code ?? "(no number)"}
                </Link>
                {b.doc.order_number ? <span className="text-muted-foreground">RE {b.doc.order_number}</span> : null}
                <span className="text-xs text-muted-foreground tabular-nums">
                  {`Yarn issued ${fmtNumber(b.a.yarn_sent_kg)} kg · fabric ${fmtNumber(b.fabric)} of ${fmtNumber(b.a.programmed_kg)} kg`}
                </span>
                <span className={`rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums ${tone(b)}`}>
                  {`Balance ${fmtNumber(b.left)} kg · loss ${b.pct == null ? "—" : `${fmtNumber(b.pct)} %`}${b.a.allowed_loss_pct == null ? "" : ` · allowed ${fmtNumber(b.a.allowed_loss_pct)} %`}`}
                </span>
              </div>
              {b.rows.length ? (
                <ChildGrid<Row>
                  columns={grnFabricColumns}
                  rows={b.rows}
                  tableFrom="5xl"
                  flatRows
                  headerClassName={GRID_HEAD}
                  totalsLabel="Total"
                  hideAdd
                  hideRemove
                  keepOne={false}
                  onAdd={() => false}
                  onRemove={() => {}}
                />
              ) : (
                <p className="text-sm text-muted-foreground">No fabric of this category on this order.</p>
              )}
            </section>
          ))}

          {closeAll ? (
            <FieldRow>
              <Field label="Reason for the write-off" required={needReason} w="name">
                <Input value={reason} onChange={(e) => setReason(e.target.value)} required={needReason} disabled={!needReason} placeholder={needReason ? "" : "Nothing left to write off"} />
              </Field>
            </FieldRow>
          ) : null}
        </div>

        {canEdit ? (
          <div className={DOC_BOTTOM_BAR}>
            <Toggle checked={closeAll} onChange={setCloseAll} label="Close & Completion" disabled={!docs.length} />
            {closeAll ? (
              <span className="text-sm text-muted-foreground">
                {`Closes ${docs.length === 1 ? "the order" : `all ${docs.length} orders`} on Save${leftToWriteOff > 0.0005 ? ` — ${fmtNumber(leftToWriteOff)} kg written off` : ""}`}
              </span>
            ) : null}
            <div className="ml-auto flex items-center gap-2">
              <Button type="button" variant="outline" disabled={isPending} onClick={() => router.push("/process/knitting-receipts")}>
                Cancel
              </Button>
              <Button type="button" disabled={isPending || !canSave} onClick={() => setConfirm(true)}>
                Save
              </Button>
            </div>
          </div>
        ) : null}
      </div>

      <ConfirmDialog
        open={confirm}
        title={`Save this GRN for ${docs.length === 1 ? (docs[0].code ?? "the knitting order") : `${docs.length} knitting orders`}?`}
        body={[
          `${fmtNumber(totalNow)} kg of fabric goes into stock, and the yarn it used (by blend %) comes off what the knitter holds. A draft bill is raised per order at fabric kg × rate.`,
          closeAll
            ? `Close & Completion: ${docs.map((d) => d.code ?? "—").join(", ")} close now${leftToWriteOff > 0.0005 ? `, writing off ${fmtNumber(leftToWriteOff)} kg still at the knitter` : ""}.`
            : null,
        ]
          .filter(Boolean)
          .join(" ")}
        confirmLabel="Save"
        tone="primary"
        isPending={isPending}
        onConfirm={save}
        onCancel={() => setConfirm(false)}
      />
    </div>
  );
}
