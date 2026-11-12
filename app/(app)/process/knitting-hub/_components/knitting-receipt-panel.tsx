"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Field, FieldRow, FIELD_WIDTH_CSS } from "@/components/ui/field";
import { StatusPill } from "@/components/ui/status-pill";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Sheet, type SheetOrigin } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { ChildGrid, type ChildGridColumn } from "@/components/masters/child-grid";
import { DENSE, DOC_BOTTOM_BAR, GRID_HEAD } from "@/components/purchase/doc-surface";
import { Segmented } from "@/components/ui/segmented";
import { fmtNumber } from "@/lib/format";
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
  /**
   * SPLIT (user 2026-11-12): a second line for the SAME yarn — part back to our store, part to
   * another knitter. Holds the original line's key; null on the line the order derived. Both
   * RPCs take any number of lines per `knit_yarn_id` and draw each from the DCs in turn.
   */
  splitOf: string | null;
};

const n =(s: string) => {
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
          splitOf: null,
        })),
    ),
  });
  const [form, setForm] = useState(fresh);
  const [date, setDate] = useState(today);
  const [dcNo, setDcNo] = useState("");
  const [dcDate, setDcDate] = useState("");
  const [vehicle, setVehicle] = useState("");
  /** `postClose` — POST & CLOSE ORDER (user 2026-11-12): the last fabric, then the order closes, one click. */
  const [confirm, setConfirm] = useState<"post" | "close" | "postClose" | null>(null);
  const [reason, setReason] = useState("");
  /** The button the close sheet grows out of (AGENTS.md "A sub-detail Sheet's size"). */
  const [origin, setOrigin] = useState<SheetOrigin | null>(null);

  const isFabric = mode === "fabric";
  const typedFabric = isFabric ? form.fabrics.filter((f) => n(f.net) > 0) : [];
  const typedYarn = isFabric ? [] : form.yarns.filter((y) => n(y.kg) > 0);
  const dirty = typedFabric.length > 0 || typedYarn.length > 0 || !!dcNo.trim();
  useUnsavedGuard(dirty || isPending);

  const a = knitAnalysis(doc.fabrics, doc.allowed_loss_pct);
  /** A split yarn's lines together may not exceed what the knitter holds of it. */
  const yarnKg = (id: string) => form.yarns.reduce((t, x) => (x.knit_yarn_id === id ? t + n(x.kg) : t), 0);
  const overReturn = (y: YarnBack) => n(y.kg) > 0 && yarnKg(y.knit_yarn_id) > y.atKnitter + 1e-9;
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
  const canPost = canPostBase;

  const setFabric = (key: string, patch: Partial<FabricIn>) =>
    setForm((f) => ({ ...f, fabrics: f.fabrics.map((x) => (x.key === key ? { ...x, ...patch } : x)) }));
  const setYarn = (key: string, patch: Partial<YarnBack>) =>
    setForm((f) => ({ ...f, yarns: f.yarns.map((x) => (x.key === key ? { ...x, ...patch } : x)) }));
  /** One split per yarn: the new line sits under it, going the other way. */
  const isSplit = (y: YarnBack) => form.yarns.some((x) => x.splitOf === (y.splitOf ?? y.key));
  const splitYarn = (y: YarnBack) =>
    setForm((f) => {
      const i = f.yarns.findIndex((x) => x.key === y.key);
      const line: YarnBack = { ...y, key: `${y.key}:split`, splitOf: y.key, where: y.where === "own" ? "party" : "own", toOrderId: "", bags: "", kg: "", binId: "" };
      return { ...f, yarns: [...f.yarns.slice(0, i + 1), line, ...f.yarns.slice(i + 1)] };
    });
  const unsplit = (y: YarnBack) => setForm((f) => ({ ...f, yarns: f.yarns.filter((x) => x.key !== y.key) }));

  function post(final: boolean) {
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
   * COMPACT GRID (user 2026-11-12, approved design): # · Fabric · Received Dia & Form · Rolls ·
   * Gross Kg · Net Kg · Store · Bin · Lot. Fabric 200 · Dia & Form 144 · Rolls 72 · Gross 88 ·
   * Net 112 · Store 144 · Bin 112 · Lot 112 = 984, + 72 chrome = 1056 <= 1155 -> tableFrom="5xl".
   * Net Kg is not held mandatory: a fabric that did not arrive today stays blank, and the Post
   * button asks for at least one line.
   */
  const fabricInColumns: ChildGridColumn<FabricIn>[] = [
    {
      header: "Fabric",
      width: FIELD_WIDTH_CSS.party,
      cell: (f) => {
        const toCome = r3(f.programmed - f.received);
        return (
          <span className="text-sm leading-tight">
            <span className="block">{f.fabric}</span>
            {toCome > 0.0005 ? <span className="block text-xs tabular-nums text-muted-foreground">{fmtNumber(toCome)} kg still to come</span> : null}
          </span>
        );
      },
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

  /*
   * # · Yarn 200 · At Knitter 112 · Goes to 200 · Bags 72 · Kg Back 112 · Store / Bin (or
   * Knitting Order) 288 · Split 88 = 1072, + 72 chrome = 1144 <= 1155. GOES TO (client
   * 2026-11-12, 0837): Own Store sends it back to a store and bin; Party Stock sends it straight
   * to another knitter's Knitting Order (`knitting_transfer_to_party`) — one picker, no bin.
   * A Party Stock line is tinted warm (`data-party-row`, read by the grid wrapper below).
   */
  const yarnBackColumns: ChildGridColumn<YarnBack>[] = [
    {
      header: "Yarn",
      width: FIELD_WIDTH_CSS.party,
      cell: (y) => (
        <span className="text-sm" data-party-row={y.where === "party" ? "" : undefined}>
          {y.yarn}
        </span>
      ),
    },
    {
      header: "At Knitter",
      width: FIELD_WIDTH_CSS.range,
      align: "right",
      cell: (y) => <span className="tabular-nums text-sm">{y.splitOf ? "" : fmtNumber(y.atKnitter)}</span>,
    },
    {
      header: "Goes to",
      width: FIELD_WIDTH_CSS.party,
      // pick-once: exempt -- every line may go to its own store, or to party stock
      cell: (y) => (
        <Segmented<"own" | "party">
          // Radios group by `name` across the page — the line's own key keeps each row its own group.
          name={`goes-to-${y.key}`}
          className="h-7"
          value={y.where}
          onChange={(v) => setYarn(y.key, { where: v, toOrderId: "" })}
          options={[
            { value: "own", label: "Own Store" },
            { value: "party", label: "Party Stock" },
          ]}
        />
      ),
    },
    {
      header: "Bags",
      width: FIELD_WIDTH_CSS.num,
      align: "right",
      total: { kind: "sum", of: (y) => n(y.bags) },
      cell: (y) => <Input type="number" min="0" step="1" aria-label={`Bags returned, ${y.yarn}`} value={y.bags} onChange={(e) => setYarn(y.key, { bags: e.target.value })} />,
    },
    {
      header: "Kg Back",
      width: FIELD_WIDTH_CSS.range,
      align: "right",
      total: { kind: "sum", of: (y) => n(y.kg) },
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
      header: "Store / Bin",
      width: FIELD_WIDTH_CSS.name,
      // pick-once: exempt -- several lines may go to the same store, bin or other order
      cell: (y) => {
        if (y.where === "own")
          return (
            <span className="grid grid-cols-2 gap-1">
              {storeSelect(y.storeId, (v) => setYarn(y.key, { storeId: v, binId: "" }), `Store, ${y.yarn}`, n(y.kg) > 0)}
              {binSelect(y.storeId, y.binId, (v) => setYarn(y.key, { binId: v }), `Bin, ${y.yarn}`)}
            </span>
          );
        const ts = targetsFor(y);
        return ts.length ? (
          <Select aria-label={`Knitting Order the yarn goes to, ${y.yarn}`} value={y.toOrderId} onChange={(e) => setYarn(y.key, { toOrderId: e.target.value })} required={n(y.kg) > 0}>
            <option value="">Knitting Order…</option>
            {ts.map((t) => (
              <option key={t.id} value={t.id}>
                {`${t.code ?? "(no number)"} · ${t.vendor_name ?? "—"}`}
              </option>
            ))}
          </Select>
        ) : (
          <span className="block px-2 text-xs text-destructive">No other knitter&apos;s open order uses this yarn</span>
        );
      },
    },
    {
      header: "Split",
      width: FIELD_WIDTH_CSS.hug,
      cell: (y) =>
        y.splitOf ? (
          <Button type="button" size="sm" variant="ghost" data-row-remove="" aria-label={`Remove split line, ${y.yarn}`} onClick={() => unsplit(y)}>
            Remove
          </Button>
        ) : isSplit(y) ? null : (
          <Button type="button" size="sm" variant="ghost" aria-label={`Split ${y.yarn} — part to store, part to party`} onClick={() => splitYarn(y)}>
            Split
          </Button>
        ),
    },
  ];

  /*
   * THE ONE FIGURES LINE (user 2026-11-12, approved design) — posted documents plus what is
   * typed now, never cards. The last figure is the loss tag, red over the Allowed Loss %.
   */
  const pctOf = (x: number) => (live.issued > 0 ? r3((x / live.issued) * 100) : null);
  const typedBack = typedYarn.reduce((t, y) => t + n(y.kg), 0);
  // Yarn Return: what the knitter still holds once this return posts — party moves are not loss.
  const left = r3(a.balance_kg - typedBack);
  const leftPct = pctOf(left);
  const tagPct = isFabric ? live.pct : leftPct;
  const allowedWords = a.allowed_loss_pct == null ? "no allowed % set" : `allowed ${fmtNumber(a.allowed_loss_pct)} %`;
  const fabricPct = pctOf(live.fabric);
  /** Red over the Allowed Loss %, green within, neutral when none is set — the figures line and the close sheet. */
  const toneOf = (pct: number | null) =>
    a.allowed_loss_pct == null || pct == null
      ? "bg-muted text-muted-foreground"
      : pct > a.allowed_loss_pct + 0.0005
        ? "bg-destructive/10 text-destructive"
        : "bg-success/10 text-success";
  const closing = confirm === "close" || confirm === "postClose";
  const postClose = confirm === "postClose";
  // Post & close writes off what is left AFTER this receipt; a bare close, what is left now.
  const closeLeft = postClose ? live.loss : a.balance_kg;
  const closePct = postClose ? live.pct : a.loss_pct;
  const openClose = (kind: "close" | "postClose", el: HTMLElement) => {
    setOrigin(el.getBoundingClientRect());
    setConfirm(kind);
  };

  return (
    // ONE FRAME (user 2026-11-12): header row, one figures line, the grid, and the footer bar.
    <>
      <div className="space-y-3 p-4">
        <ReceiptHeaderRow
          isFabric={isFabric}
          orderField={orderField}
          knitter={doc.vendor_name}
          disabled={!receiving}
          today={today}
          value={{ date, dcNo, dcDate, vehicle }}
          on={{ date: setDate, dcNo: setDcNo, dcDate: setDcDate, vehicle: setVehicle }}
        />

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md bg-surface-muted px-3 py-2 text-sm" aria-live="polite">
          <Figure label="Yarn issued" value={`${fmtNumber(live.issued)} kg`} />
          <Bar />
          {isFabric ? (
            <>
              <Figure label="Fabric received" value={`${fmtNumber(live.fabric)} kg${fabricPct == null ? "" : ` (${fmtNumber(fabricPct)} %)`}`} />
              <Bar />
              <Figure label="Yarn returned" value={`${fmtNumber(live.returned)} kg`} />
            </>
          ) : (
            <>
              <Figure label="Used in fabric" value={`${fmtNumber(a.yarn_used_kg)} kg`} />
              <Bar />
              <Figure label="Returning now" value={`${fmtNumber(r3(typedBack))} kg`} />
            </>
          )}
          <Bar />
          <span className={`rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums ${toneOf(tagPct)}`}>
            {isFabric
              ? `Process loss ${live.pct == null ? "—" : `${fmtNumber(live.pct)} %`} · ${fmtNumber(live.loss)} kg · ${allowedWords}`
              : `Left at knitter ${fmtNumber(left)} kg · ${leftPct == null ? "—" : `${fmtNumber(leftPct)} %`} · ${allowedWords}`}
          </span>
          {doc.close_pending ? <StatusPill tone="warning">Left waiting for the MD — close it directly</StatusPill> : null}
        </div>

        {receiving && isFabric ? (
          // default-row: exempt -- one row per fabric on the order, derived
          <div className={`${DENSE} space-y-1.5`}>
            <h3 className="text-sm font-semibold">Fabric received now</h3>
            <ChildGrid<FabricIn>
              columns={fabricInColumns}
              rows={form.fabrics}
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
          </div>
        ) : null}

        {receiving && !isFabric ? (
          form.yarns.length ? (
            // default-row: exempt -- one row per yarn still at the knitter, derived (a split adds one)
            <div className={`${DENSE} space-y-1.5 [&_tr:has([data-party-row])>td]:bg-warning/10`}>
              <h3 className="text-sm font-semibold">Yarn coming back</h3>
              <ChildGrid<YarnBack>
                  columns={yarnBackColumns}
                rows={form.yarns}
                tableFrom="5xl"
                flatRows
                headerClassName={GRID_HEAD}
                totalsLabel="Total"
                hideAdd
                hideRemove
                keepOne={false}
                onAdd={() => false}
                onRemove={unsplit}
              />
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">The knitter holds no yarn on this order.</p>
          )
        ) : null}
      </div>

      {receiving || closable ? (
        // FOOTER (user 2026-11-12): no tick — Cancel · Post & Close Order · Post receipt.
        <div className={DOC_BOTTOM_BAR}>
          {typedYarn.some(overReturn) ? <span className="text-sm text-destructive">More yarn than the knitter holds</span> : null}
          <div className="ml-auto flex items-center gap-2">
            {closable && !(typedFabric.length || typedYarn.length) ? (
              <Button type="button" variant="outline" disabled={isPending} onClick={(e) => openClose("close", e.currentTarget)}>
                Close order…
              </Button>
            ) : null}
            {receiving ? (
              <>
                <Button type="button" variant="outline" disabled={isPending} onClick={() => router.push(isFabric ? "/process/knitting-receipts" : "/process/knitting-returns")}>
                  Cancel
                </Button>
                {isFabric ? (
                  <Button type="button" variant="outline" className="text-primary" disabled={isPending || !canPost} onClick={(e) => openClose("postClose", e.currentTarget)}>
                    Post &amp; Close Order
                  </Button>
                ) : null}
                <Button type="button" disabled={isPending || !canPost} onClick={() => setConfirm("post")}>
                  {isFabric ? "Post receipt" : "Post return"}
                </Button>
              </>
            ) : null}
          </div>
        </div>
      ) : null}

      <ConfirmDialog
        open={confirm === "post"}
        title={isFabric ? `Post this fabric receipt on ${doc.code ?? "the knitting order"}?` : `Post this yarn return on ${doc.code ?? "the knitting order"}?`}
        body={
          isFabric
            ? `${fmtNumber(typedFabric.reduce((t, f) => t + n(f.net), 0))} kg of fabric goes into stock, and the yarn it used (by blend %) comes off what the knitter holds. A draft bill is raised at fabric kg × rate. A posted receipt cannot be changed.`
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
        onConfirm={() => post(false)}
        onCancel={() => setConfirm(null)}
      />
      {/*
        * POST & CLOSE / CLOSE (user 2026-11-12): a small sheet out of the button — the facts, the
        * write-off reason only when something is left, Back · the one filled action.
        */}
      <Sheet
        open={closing}
        onClose={() => setConfirm(null)}
        size="sm"
        alignToPane
        origin={origin}
        title={
          <span className="block leading-tight">
            <span className="block">{`${postClose ? "Post & close" : "Close"} ${doc.code ?? "the knitting order"}`}</span>
            <span className="block text-xs font-normal text-muted-foreground">
              {`${doc.vendor_name ?? "—"} · ${postClose ? "this is the last fabric for the order" : "closing with no new receipt"}`}
            </span>
          </span>
        }
        footer={
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" disabled={isPending} onClick={() => setConfirm(null)}>
              Back
            </Button>
            <Button type="button" disabled={isPending || (closeLeft > 0.0005 && !reason.trim())} onClick={() => (postClose ? post(true) : close())}>
              {postClose ? "Post & close" : "Close order"}
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          <dl className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-1.5 rounded-md bg-surface-muted px-3 py-2 text-sm">
            {postClose ? (
              <>
                <dt className="text-xs text-muted-foreground">Fabric now</dt>
                <dd className="tabular-nums font-semibold">
                  {`${fmtNumber(r3(typedFabric.reduce((t, f) => t + n(f.net), 0)))} kg → ${fmtNumber(live.fabric)} of ${fmtNumber(a.programmed_kg)} kg`}
                </dd>
              </>
            ) : null}
            <dt className="text-xs text-muted-foreground">Left at knitter — written off</dt>
            <dd className="tabular-nums font-semibold">{`${fmtNumber(closeLeft)} kg`}</dd>
            <dt className="text-xs text-muted-foreground">Process loss</dt>
            <dd className="flex flex-wrap items-center gap-2">
              <span className={`rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums ${toneOf(closePct)}`}>{closePct == null ? "—" : `${fmtNumber(closePct)} %`}</span>
              <span className="text-xs text-muted-foreground">{allowedWords}</span>
            </dd>
          </dl>
          {closeLeft > 0.0005 ? (
            <Field label="Reason for the write-off" required>
              <Input value={reason} onChange={(e) => setReason(e.target.value)} required />
            </Field>
          ) : null}
        </div>
      </Sheet>
    </>
  );
}

/** One figure of the line: a small muted label, the bold value beside it. */
function Figure({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="font-semibold tabular-nums">{value}</span>
    </span>
  );
}

function Bar() {
  return <span aria-hidden className="h-4 w-px bg-border" />;
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
