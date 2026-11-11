"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { Plus, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button, buttonClasses } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { Field, FieldRow } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { StatusPill } from "@/components/ui/status-pill";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { DOC_BOTTOM_BAR, DOC_FRAME, DocRemarksLine } from "@/components/purchase/doc-surface";
import { fmtDate, fmtMoney, fmtNumber } from "@/lib/format";
import { statusTone } from "@/lib/ui/status-tone";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { ToggleGroup } from "@/components/ui/segmented";
import type { BinOption, StockOption, StoreOption } from "@/lib/stores/production-dc-service";
import type { BinStockOption, LotStockOption, OpenProcessOrder, ProcessDc } from "@/lib/stores/process-dc-service";
import { ProcessDcSendForm } from "@/app/(app)/stores/process-dc/_components/process-dc-send-form";
import { KnittingReceiptPanel } from "./knitting-receipt-panel";
import { cancelKnittingOrder, issueKnittingOrder, loadKnitCandidates, saveKnittingOrder } from "@/lib/production/knitting-actions";
import {
  KNIT_STATUS_LABELS,
  PLY_OPTIONS,
  WIDTH_FORM_LABELS,
  expectedRolls,
  yarnRequirement,
  type KnitCandidate,
  type KnitOption,
  type KnitWidthForm,
  type KnittingOrder,
} from "@/lib/production/knitting-types";

const BASE = "/production/knitting-hub";

type YarnRow = {
  key: string;
  yarn_item_id: string;
  yarn_name: string;
  blend_pct: number | null;
  allowance: string;
  bag_weight: string;
  /** Sent on Process DCs so far (saved orders only). */
  dispatched_kg: number;
};

type FabricRow = {
  key: string;
  source_key: string;
  fabric_item_id: string;
  fabric_name: string;
  width_form: KnitWidthForm | null;
  knit_dia: string;
  finished_dia: string;
  gsm: string;
  loop_length: string;
  loop_length_ref: string;
  gauge_id: string;
  ply: string;
  programmed: string;
  roll_weight: string;
  rate: string;
  yarns: YarnRow[];
};

const n = (s: string): number | null => {
  if (!s.trim()) return null;
  const v = Number(s);
  return Number.isFinite(v) ? v : null;
};
const str = (v: number | null | undefined) => (v == null ? "" : String(v));
/** Nothing the operator chose — the blank end row. */
const isBlank = (r: FabricRow) => !r.source_key && !r.programmed.trim();

function rowsFromDoc(doc: KnittingOrder): FabricRow[] {
  return doc.fabrics.map((f) => ({
    key: f.id,
    source_key: f.source_key ?? `saved:${f.id}`,
    fabric_item_id: f.fabric_item_id,
    fabric_name: f.fabric_name,
    width_form: f.width_form,
    knit_dia: f.knit_dia ?? "",
    finished_dia: f.finished_dia ?? "",
    gsm: str(f.gsm),
    loop_length: str(f.loop_length),
    loop_length_ref: str(f.loop_length_ref),
    gauge_id: f.gauge_id ?? "",
    ply: f.ply ?? "",
    programmed: str(f.programmed_kg),
    roll_weight: str(f.roll_weight_kg),
    rate: f.rate_per_kg ? String(f.rate_per_kg) : "",
    yarns: f.yarns.map((y) => ({
      key: y.id,
      yarn_item_id: y.yarn_item_id,
      yarn_name: y.yarn_name,
      blend_pct: y.blend_pct,
      allowance: str(y.allowance_pct),
      bag_weight: str(y.bag_weight_kg),
      dispatched_kg: y.dispatched_kg,
    })),
  }));
}

/**
 * KNITTING HUB ▸ one Knitting Order (DB 0825, doc/process/knitting-plan.md Phase 1).
 *
 * Step 1 is built here: the order header, the fabrics to knit (picked off the RE's current
 * Fabric BOM, one per fabric × dia), each fabric's construction, and its yarn explosion —
 * required kg and bags recomputed on every keystroke (acceptance 1). Steps 2 and 3 (Yarn DC,
 * Fabric Receipt) come in the next phases; until then an ISSUED order's yarn goes out on
 * Stores ▸ Process DC, which already reads it as a process order.
 */
export function KnittingEditor({
  doc,
  orders,
  knitters,
  gauges,
  initialCandidates,
  initialCustomer,
  today,
  canEdit,
  stores = [],
  bins = [],
  dcSend,
}: {
  /** Tab 2's Job Work DC form, for THIS order only (null order = nothing left to send). */
  dcSend?: { order: OpenProcessOrder | null; stock: StockOption[]; lots: LotStockOption[]; binStock: BinStockOption[]; draft: ProcessDc | null };
  /** Step 3's receive-into stores and bins (this unit's). */
  stores?: StoreOption[];
  bins?: BinOption[];
  doc: KnittingOrder | null;
  orders: { id: string; order_number: string | null }[];
  knitters: KnitOption[];
  gauges: KnitOption[];
  initialCandidates: KnitCandidate[];
  initialCustomer: string | null;
  today: string;
  canEdit: boolean;
}) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, start] = useTransition();
  const [isLoading, startLoad] = useTransition();

  const readOnly = !canEdit || (!!doc && doc.status !== "draft");
  const issued = !!doc && doc.status !== "draft" && doc.status !== "cancelled";
  /** Yarn has gone out (the first dispatch moves the order to In Knitting). */
  const receivable = !!doc && ["in_process", "partially_received", "received", "closed"].includes(doc.status);
  /* THE THREE TABS (spec §1.2, user 2026-11-11 "make them real tabs"). The order opens on the
     furthest step it has reached — a draft on 1, an issued order on 2, one with yarn out on 3. */
  type Tab = "1" | "2" | "3";
  const [tab, setTab] = useState<Tab>(receivable ? "3" : issued ? "2" : "1");

  const [salesOrderId, setSalesOrderId] = useState(doc?.sales_order_id ?? "");
  const [vendorId, setVendorId] = useState(doc?.vendor_id ?? "");
  const [orderDate, setOrderDate] = useState(doc?.order_date ?? today);
  const [expectedDate, setExpectedDate] = useState(doc?.expected_date ?? "");
  const [allowedLoss, setAllowedLoss] = useState(str(doc?.allowed_loss_pct));
  const [notes, setNotes] = useState(doc?.notes ?? "");
  const [candidates, setCandidates] = useState<KnitCandidate[]>(initialCandidates);
  const [customer, setCustomer] = useState<string | null>(initialCustomer);
  const [note, setNote] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<"issue" | "cancel" | null>(null);

  // Row keys from a counter bumped only in handlers, so render stays pure.
  const keySeq = useRef(0);
  const blankRow = (): FabricRow => ({ ...blankRowStatic(), key: `new-${keySeq.current++}` });
  /* LAYOUT D (user 2026-11-11, canvas "Knitting Program Layout"): one BLOCK per fabric — its
     construction on one row, its yarns straight under it. An editable list never opens empty
     (AGENTS.md "Editable sub-tables open with a row"): a new order starts with one block to pick
     into; "Add a fabric" adds the next. A block with nothing picked is never saved. */
  const [rows, setRows] = useState<FabricRow[]>(() => {
    const r = doc ? rowsFromDoc(doc) : [];
    return readOnly || r.length ? r : [{ ...blankRowStatic(), key: "new-first" }];
  });

  const typed = rows.filter((r) => !isBlank(r));
  const current = JSON.stringify([salesOrderId, vendorId, orderDate, expectedDate, allowedLoss, notes.trim().toUpperCase(), typed.map((r) => ({ ...r, key: undefined }))]);
  const [baseline, setBaseline] = useState(current);
  const dirty = !readOnly && current !== baseline;
  useUnsavedGuard(dirty || isPending);

  const candByKey = useMemo(() => new Map(candidates.map((c) => [c.key, c])), [candidates]);

  function setRow(key: string, patch: Partial<FabricRow>) {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }
  function setYarn(rowKey: string, yarnKey: string, patch: Partial<YarnRow>) {
    setRows((rs) =>
      rs.map((r) => (r.key === rowKey ? { ...r, yarns: r.yarns.map((y) => (y.key === yarnKey ? { ...y, ...patch } : y)) } : r)),
    );
  }

  function pickOrder(id: string) {
    setSalesOrderId(id);
    // The fabrics came off the old order's Fabric BOM — they go with it.
    setRows([blankRow()]);
    setCandidates([]);
    setCustomer(null);
    setNote(null);
    if (!id) return;
    startLoad(async () => {
      const res = await loadKnitCandidates(id, doc?.id ?? null);
      if (!res.ok) {
        setNote(res.error);
        return;
      }
      setCandidates(res.candidates);
      setCustomer(res.customer);
      setNote(res.note);
    });
  }

  function pickFabric(rowKey: string, sourceKey: string) {
    const c = candByKey.get(sourceKey);
    if (!c) return setRow(rowKey, { source_key: "" });
    const balance = Math.max(0, Math.round((c.bom_kg - c.programmed_elsewhere_kg) * 1000) / 1000);
    setRow(rowKey, {
      source_key: c.key,
      fabric_item_id: c.fabric_item_id,
      fabric_name: c.fabric_name,
      width_form: c.width_form,
      knit_dia: c.knit_dia ?? "",
      gsm: str(c.gsm),
      // ATM-style: the BOM's balance still to knit, editable.
      programmed: balance ? String(balance) : "",
      yarns: c.yarns.map((y, i) => ({
        key: `${rowKey}-y${i}`,
        yarn_item_id: y.yarn_item_id,
        yarn_name: y.yarn_name,
        blend_pct: y.blend_pct,
        allowance: allowedLoss,
        bag_weight: "",
        dispatched_kg: 0,
      })),
    });
  }

  // ---------- what the screen can answer before Save ----------
  const blendOf = (r: FabricRow) => r.yarns.reduce((t, y) => t + (y.blend_pct ?? 0), 0);
  const blendBad = (r: FabricRow) => r.yarns.length === 0 || r.yarns.some((y) => y.blend_pct == null) || Math.abs(blendOf(r) - 100) > 0.01;
  const progBad = (r: FabricRow) => !((n(r.programmed) ?? 0) > 0);
  const anyBad = typed.some((r) => !r.source_key || progBad(r) || blendBad(r));
  const canSave = !readOnly && !!vendorId && !!salesOrderId && typed.length > 0 && !anyBad;

  const yarnCalc = (r: FabricRow, y: YarnRow) =>
    yarnRequirement(n(r.programmed) ?? 0, y.blend_pct ?? 0, n(y.allowance) ?? 0, n(y.bag_weight));
  const totals = typed.reduce(
    (t, r) => {
      t.fabric += n(r.programmed) ?? 0;
      t.value += (n(r.programmed) ?? 0) * (n(r.rate) ?? 0);
      for (const y of r.yarns) {
        const c = yarnCalc(r, y);
        t.yarn += c.required;
        t.cap += c.cap;
        t.sent += y.dispatched_kg;
      }
      return t;
    },
    { fabric: 0, yarn: 0, cap: 0, sent: 0, value: 0 },
  );

  function save() {
    if (!canSave) return;
    start(async () => {
      const res = await saveKnittingOrder(doc?.id ?? null, {
        vendor_id: vendorId,
        sales_order_id: salesOrderId || null,
        order_date: orderDate || null,
        expected_date: expectedDate || null,
        allowed_loss_pct: n(allowedLoss),
        notes: notes.trim() || null,
        fabrics: typed.map((r) => ({
          fabric_item_id: r.fabric_item_id,
          source_key: r.source_key.startsWith("saved:") ? null : r.source_key,
          width_form: r.width_form,
          knit_dia: r.knit_dia || null,
          finished_dia: r.finished_dia || null,
          gsm: n(r.gsm),
          loop_length: n(r.loop_length),
          loop_length_ref: n(r.loop_length_ref),
          gauge_id: r.gauge_id || null,
          ply: r.ply || null,
          programmed_kg: n(r.programmed) ?? 0,
          roll_weight_kg: n(r.roll_weight),
          rate_per_kg: n(r.rate) ?? 0,
          yarns: r.yarns.map((y) => ({
            yarn_item_id: y.yarn_item_id,
            blend_pct: y.blend_pct ?? 0,
            allowance_pct: n(y.allowance) ?? 0,
            bag_weight_kg: n(y.bag_weight),
          })),
        })),
      });
      if (!res.ok) return toastError(res.error);
      success("Knitting order saved");
      setBaseline(current);
      if (!doc) router.replace(`${BASE}/${res.id}`);
      else router.refresh();
    });
  }

  function issue() {
    if (!doc) return;
    start(async () => {
      const res = await issueKnittingOrder(doc.id);
      setConfirm(null);
      if (!res.ok) return toastError(res.error);
      success("Issued — the yarn can now be sent on a Process DC");
      setTab("2");
      router.refresh();
    });
  }

  function cancelDoc() {
    if (!doc) return;
    start(async () => {
      const res = await cancelKnittingOrder(doc.id);
      setConfirm(null);
      if (!res.ok) return toastError(res.error);
      success("Knitting order cancelled");
      router.refresh();
    });
  }

  const orderOptions: ComboboxOption[] = orders.map((o) => ({ value: o.id, label: o.order_number ?? "(no RE No)" }));
  const knitterOptions: ComboboxOption[] = knitters
    .filter((k) => !k.inactive || k.id === vendorId)
    .map((k) => ({ value: k.id, label: k.inactive ? `${k.name} (not a knitter)` : k.name }));
  const gaugeOptions = gauges.filter((g) => !g.inactive);

  const candidateOptions: ComboboxOption[] = candidates.map((c) => ({
    value: c.key,
    label: c.fabric_name,
    sublabel: [
      c.knit_dia ? `DIA ${c.knit_dia}` : "No dia",
      c.width_form ? WIDTH_FORM_LABELS[c.width_form] : null,
      `BOM ${fmtNumber(c.bom_kg)} kg`,
      c.programmed_elsewhere_kg ? `on other KOs ${fmtNumber(c.programmed_elsewhere_kg)} kg` : null,
    ]
      .filter(Boolean)
      .join(" · "),
  }));

  /** Picked by another block — greyed in this block's list (AGENTS.md "Pick once"). */
  const optionsFor = (r: FabricRow): ComboboxOption[] =>
    candidateOptions.map((o) => (rows.some((x) => x.key !== r.key && x.source_key === o.value) ? { ...o, disabled: true, label: `${o.label} (already added)` } : o));

  function addFabric() {
    setRows((rs) => [...rs, blankRow()]);
  }
  function removeFabric(key: string) {
    setRows((rs) => {
      const left = rs.filter((x) => x.key !== key);
      return left.length ? left : [blankRow()];
    });
  }

  /** The store's view: the same yarn across fabrics, added up (kg and whole bags). */
  const byYarn = (() => {
    const m = new Map<string, { name: string; kg: number; bags: number; noBag: boolean }>();
    for (const r of typed) {
      for (const y of r.yarns) {
        const c = yarnCalc(r, y);
        const t = m.get(y.yarn_item_id) ?? { name: y.yarn_name, kg: 0, bags: 0, noBag: false };
        t.kg += c.required;
        if (c.bags == null) t.noBag = true;
        else t.bags += c.bags;
        m.set(y.yarn_item_id, t);
      }
    }
    return [...m.values()].sort((x, y) => y.kg - x.kg);
  })();
  const totalBags = typed.reduce((t, r) => t + r.yarns.reduce((u, y) => u + (yarnCalc(r, y).bags ?? 0), 0), 0);
  const totalRolls = typed.reduce((t, r) => t + (expectedRolls(n(r.programmed) ?? 0, n(r.roll_weight)) ?? 0), 0);

  /** One word on the block's title line: what still needs doing, or that it is ready. */
  const blockState = (r: FabricRow): { tone: "ok" | "warn" | "bad"; text: string } | null => {
    if (!r.source_key) return null;
    if (r.yarns.length === 0) return { tone: "bad", text: "No composition on the fabric master" };
    if (blendBad(r)) return { tone: "bad", text: `Blend ${fmtNumber(blendOf(r))}% — must be 100%` };
    if (progBad(r)) return { tone: "bad", text: "Program Kg to fill" };
    if (!r.gauge_id || !r.loop_length.trim()) return { tone: "warn", text: "Gauge / loop to fill" };
    return { tone: "ok", text: "Ready" };
  };
  const TONE = { ok: "text-success", warn: "text-warning", bad: "text-destructive" } as const;
  const TH = "whitespace-nowrap border border-[var(--table-head-border)] bg-[var(--table-head-bg)] px-2 py-1.5 text-left text-[11px] font-semibold text-[var(--table-head-fg)]";
  const THR = `${TH} text-right`;
  const TD = "h-9 border border-border p-0 align-middle";
  const CELL = "block whitespace-nowrap px-2 text-sm";
  const CELLR = "block px-2 text-right text-sm tabular-nums";
  const NUM = "text-right tabular-nums";

  const status = doc?.status ?? "draft";
  const title = doc ? (doc.code ?? "Knitting Order") : "New Knitting Order";
  // A tab not reached yet is greyed, with the reason on hover — never hidden.
  const tabs: { value: Tab; label: string; disabled: boolean; title?: string; after?: React.ReactNode }[] = [
    { value: "1", label: "1. Program & Knitting Specs", disabled: false },
    {
      value: "2",
      label: "2. Outward Yarn DC",
      disabled: !issued,
      title: issued ? undefined : "Save the order and Issue it to the knitter first",
      after: issued ? <span className="text-[11px] opacity-80">{fmtNumber(totals.sent)}/{fmtNumber(totals.cap)} kg</span> : null,
    },
    {
      value: "3",
      label: "3. Fabric Receipt & Yarn Return",
      disabled: !receivable,
      title: receivable ? undefined : "Opens once yarn has been dispatched to the knitter",
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title={title}
        description={doc ? [doc.vendor_name, doc.order_number].filter(Boolean).join(" · ") : "Program fabric for a knitter — the yarn and bags work themselves out from the Fabric BOM"}
        actions={
          doc ? (
            // The Knitting Analysis is reached from the list's report icon only (user 2026-11-11).
            <div className="flex items-center gap-2">
              <StatusPill tone={statusTone(status)}>{KNIT_STATUS_LABELS[status]}</StatusPill>
            </div>
          ) : null
        }
      />

      {/* 72rem: the 1016px yarn grid plus the frame's padding. */}
      {/* A SECTION, NOT A <form> (2026-11-11): tab 2 holds the Job Work DC form and tab 3 the
          receipt, each with its own buttons — and `<Button>` defaults to type="submit", so inside
          a form every one of them would also submit the order. Save is an explicit click; Enter
          off the last field and Ctrl+S still press the footer's last button (lib/focus.ts). */}
      <div className={`${DOC_FRAME} max-w-[72rem]`} data-focus-scope="">
        <div className="space-y-4 p-4">
          {/*
           * KO No 112 · KO Date 144 · RE No 176 · Customer 176 · Knitter 200 · Delivery 144 ·
           * Allowed Loss 88 = 1040 + 6 x 10 gap = 1100px. That fits the full 72rem frame only; on a
           * narrower pane it scrolled sideways (KO/26-27/0001, 2026-11-11), so the row WRAPS.
           */}
          <FieldRow>
            <Field label="KO No" w="range">
              <Input readOnly value={doc?.code ?? "(auto)"} />
            </Field>
            <Field label="KO Date" required w="code">
              <Input type="date" value={orderDate} readOnly={readOnly} onChange={(e) => setOrderDate(e.target.value)} required />
            </Field>
            <Field label="RE No" required w="term">
              {readOnly ? (
                <Input readOnly value={doc?.order_number ?? "—"} />
              ) : (
                <Combobox options={orderOptions} value={salesOrderId} onChange={pickOrder} placeholder="Pick the order" required />
              )}
            </Field>
            <Field label="Customer" w="term">
              <Input readOnly value={customer ?? "—"} />
            </Field>
            <Field label="Knitter" required w="party">
              {readOnly ? (
                <Input readOnly value={doc?.vendor_name ?? "—"} />
              ) : (
                <Combobox options={knitterOptions} value={vendorId} onChange={setVendorId} placeholder={knitters.length ? "Pick the knitter" : "No knitter registered"} required />
              )}
            </Field>
            <Field label="Delivery Date" w="code">
              <Input type="date" value={expectedDate} readOnly={readOnly} onChange={(e) => setExpectedDate(e.target.value)} />
            </Field>
            <Field label="Allowed Loss %" w="hug">
              <Input type="number" min="0" max="99" step="any" value={allowedLoss} readOnly={readOnly} onChange={(e) => setAllowedLoss(e.target.value)} />
            </Field>
          </FieldRow>

          {!readOnly && knitters.length === 0 ? (
            <p className="text-sm text-destructive">
              No vendor is registered as a knitter. Add the KNITTING process to the knitter&apos;s Vendor master, then reopen this screen.
            </p>
          ) : null}
          {note ? <p className="text-sm text-muted-foreground">{note}</p> : null}

          {/* The three steps of the spec (doc/process/knitting.md §1.2), as tabs. */}
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <ToggleGroup<Tab> role="tablist" label="Knitting order steps" value={tab} onChange={setTab} options={tabs} />
            {typed.length ? (
              <dl className="ml-auto flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
                <div>
                  <dt className="inline">Fabric </dt>
                  <dd className="inline text-sm font-semibold tabular-nums text-foreground">{fmtNumber(totals.fabric)} kg</dd>
                </div>
                <div>
                  <dt className="inline">Yarn </dt>
                  <dd className="inline text-sm font-semibold tabular-nums text-foreground">{fmtNumber(totals.yarn)} kg</dd>
                </div>
                <div>
                  <dt className="inline">Bags </dt>
                  <dd className="inline text-sm font-semibold tabular-nums text-foreground">{totalBags}</dd>
                </div>
                <div>
                  <dt className="inline">Rolls </dt>
                  <dd className="inline text-sm font-semibold tabular-nums text-foreground">{totalRolls}</dd>
                </div>
                <div>
                  <dt className="inline">Value </dt>
                  <dd className="inline text-sm font-semibold tabular-nums text-foreground">{totals.value ? fmtMoney(totals.value) : "—"}</dd>
                </div>
              </dl>
            ) : null}
          </div>
          {!issued && doc ? <p className="text-xs text-muted-foreground">Step 2 opens after Issue to Knitter; step 3 once the yarn has gone out.</p> : null}

          {tab === "1" ? (
            <div className="flex flex-wrap items-start gap-4">
              <div className="min-w-0 flex-[999_1_640px] space-y-3">
                {rows.map((f, i) => {
                  const st = blockState(f);
                  const picked = !!f.source_key;
                  const sum = f.yarns.reduce(
                    (t, y) => {
                      const c = yarnCalc(f, y);
                      t.kg += c.required;
                      t.bags += c.bags ?? 0;
                      t.cap += c.cap;
                      t.sent += y.dispatched_kg;
                      return t;
                    },
                    { kg: 0, bags: 0, cap: 0, sent: 0 },
                  );
                  const SUM_TD = `${TD} bg-[var(--table-head-bg)]/30`;
                  return (
                    <section key={f.key} className="overflow-hidden rounded-lg border border-[var(--table-head-border)]" aria-label={`Fabric ${i + 1}`}>
                      {/* TITLE LINE: number, the fabric (or its picker), its blend, what is left to do */}
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-[var(--table-head-border)] bg-[var(--table-head-bg)]/40 px-3 py-2">
                        <span className="text-sm font-bold">{i + 1}</span>
                        {picked && (readOnly || f.source_key.startsWith("saved:")) ? (
                          <span className="text-sm font-semibold">{f.fabric_name}</span>
                        ) : (
                          <div className="min-w-[20rem] max-w-[44rem] flex-[4_1_20rem]">
                            <Combobox
                              options={
                                f.source_key && !candByKey.has(f.source_key)
                                  ? [{ value: f.source_key, label: f.fabric_name || "No longer on the BOM", disabled: true }, ...optionsFor(f)]
                                  : optionsFor(f)
                              }
                              value={f.source_key}
                              onChange={(v) => pickFabric(f.key, v)}
                              placeholder={salesOrderId ? (isLoading ? "Loading…" : candidates.length ? "Pick a fabric from the BOM" : "Nothing to knit on this order") : "Pick the RE No first"}
                              disabled={!salesOrderId}
                            />
                          </div>
                        )}
                        {/* The blend, unless the fabric's own name already spells it (most masters
                            compose the name from the mixing grid, "… (COTTON 95%, …)"). */}
                        {picked && f.yarns.length && !f.fabric_name.includes("%") ? (
                          <span className="text-xs text-muted-foreground">
                            {f.yarns.map((y) => `${y.yarn_name} ${y.blend_pct == null ? "?" : fmtNumber(y.blend_pct)}%`).join(" · ")}
                          </span>
                        ) : null}
                        <span className="flex-1" />
                        {st ? <span className={`text-xs font-semibold ${TONE[st.tone]}`}>{st.text}</span> : null}
                        {!readOnly && (rows.length > 1 || picked) ? (
                          <Button type="button" variant="ghost" size="icon" aria-label={`Remove ${f.fabric_name || "this fabric"}`} data-row-remove="" onClick={() => removeFabric(f.key)}>
                            <X className="size-4" aria-hidden />
                          </Button>
                        ) : null}
                      </div>

                      {picked ? (
                        <>
                          {/* THE FABRIC'S ONE ROW — facts from the BOM read-only, then what is typed */}
                          <div className="overflow-x-auto" data-grid-style="sheet" data-grid-cells="flat">
                            <table className="w-full border-collapse">
                              <thead>
                                <tr>
                                  <th className={TH}>Form</th>
                                  <th className={THR}>GSM</th>
                                  <th className={THR}>Knit Dia</th>
                                  <th className={TH}>Fin Dia</th>
                                  <th className={TH}>Gauge</th>
                                  <th className={THR}>Loop</th>
                                  <th className={THR}>Loop Ref</th>
                                  <th className={TH}>Ply</th>
                                  <th className={THR}>Program Kg *</th>
                                  <th className={THR}>Roll Wt</th>
                                  <th className={THR}>Rolls</th>
                                  <th className={THR}>Rate/kg</th>
                                  <th className={THR}>Value</th>
                                </tr>
                              </thead>
                              <tbody>
                                <tr>
                                  <td className={TD}>
                                    <span className={CELL}>{f.width_form ? WIDTH_FORM_LABELS[f.width_form] : "—"}</span>
                                  </td>
                                  <td className={TD}>
                                    <span className={CELLR}>{f.gsm || "—"}</span>
                                  </td>
                                  <td className={TD}>
                                    <span className={CELLR}>{f.knit_dia || "—"}</span>
                                  </td>
                                  <td className={`${TD} w-24`}>
                                    {readOnly ? (
                                      <span className={CELL}>{f.finished_dia || "—"}</span>
                                    ) : (
                                      <Input aria-label="Finished dia" value={f.finished_dia} onChange={(e) => setRow(f.key, { finished_dia: e.target.value })} />
                                    )}
                                  </td>
                                  <td className={`${TD} w-28`}>
                                    {readOnly ? (
                                      <span className={CELL}>{gauges.find((g) => g.id === f.gauge_id)?.name ?? "—"}</span>
                                    ) : (
                                      <Select aria-label="Gauge" value={f.gauge_id} onChange={(e) => setRow(f.key, { gauge_id: e.target.value })}>
                                        <option value=""></option>
                                        {gauges
                                          .filter((g) => !g.inactive || g.id === f.gauge_id)
                                          .map((g) => (
                                            <option key={g.id} value={g.id}>
                                              {g.name}
                                            </option>
                                          ))}
                                      </Select>
                                    )}
                                  </td>
                                  <td className={`${TD} w-20`}>
                                    {readOnly ? (
                                      <span className={CELLR}>{f.loop_length || "—"}</span>
                                    ) : (
                                      <Input type="number" min="0" step="any" aria-label="Loop length" className={NUM} value={f.loop_length} onChange={(e) => setRow(f.key, { loop_length: e.target.value })} />
                                    )}
                                  </td>
                                  <td className={`${TD} w-20`}>
                                    {readOnly ? (
                                      <span className={CELLR}>{f.loop_length_ref || "—"}</span>
                                    ) : (
                                      <Input type="number" min="0" step="any" aria-label="Loop length reference" className={NUM} value={f.loop_length_ref} onChange={(e) => setRow(f.key, { loop_length_ref: e.target.value })} />
                                    )}
                                  </td>
                                  <td className={`${TD} w-24`}>
                                    {readOnly ? (
                                      <span className={CELL}>{f.ply || "—"}</span>
                                    ) : (
                                      <Select aria-label="Ply" value={f.ply} onChange={(e) => setRow(f.key, { ply: e.target.value })}>
                                        <option value=""></option>
                                        {PLY_OPTIONS.map((p) => (
                                          <option key={p} value={p}>
                                            {p}
                                          </option>
                                        ))}
                                      </Select>
                                    )}
                                  </td>
                                  <td className={`${TD} w-28`}>
                                    {readOnly ? (
                                      <span className={`${CELLR} font-semibold`}>{fmtNumber(n(f.programmed) ?? 0)}</span>
                                    ) : (
                                      <Input
                                        type="number"
                                        min="0"
                                        step="any"
                                        aria-label="Program qty (kg)"
                                        className={`${NUM} font-semibold`}
                                        value={f.programmed}
                                        onChange={(e) => setRow(f.key, { programmed: e.target.value })}
                                        required
                                      />
                                    )}
                                  </td>
                                  <td className={`${TD} w-20`}>
                                    {readOnly ? (
                                      <span className={CELLR}>{f.roll_weight || "—"}</span>
                                    ) : (
                                      <Input type="number" min="0" step="any" aria-label="Roll weight (kg)" className={NUM} value={f.roll_weight} onChange={(e) => setRow(f.key, { roll_weight: e.target.value })} />
                                    )}
                                  </td>
                                  <td className={TD}>
                                    <span className={CELLR}>{expectedRolls(n(f.programmed) ?? 0, n(f.roll_weight)) ?? "—"}</span>
                                  </td>
                                  <td className={`${TD} w-24`}>
                                    {readOnly ? (
                                      <span className={CELLR}>{f.rate ? fmtMoney(n(f.rate) ?? 0) : "—"}</span>
                                    ) : (
                                      <Input type="number" min="0" step="any" aria-label="Knitting rate per kg" className={NUM} value={f.rate} onChange={(e) => setRow(f.key, { rate: e.target.value })} />
                                    )}
                                  </td>
                                  <td className={TD}>
                                    <span className={CELLR}>{n(f.rate) ? fmtMoney((n(f.programmed) ?? 0) * (n(f.rate) ?? 0)) : "—"}</span>
                                  </td>
                                </tr>
                              </tbody>
                            </table>
                          </div>

                          {/* ITS YARNS, STRAIGHT UNDER IT — blend from the fabric master; kg and bags derived */}
                          <div className="overflow-x-auto" data-grid-style="sheet" data-grid-cells="flat">
                            <table className="w-full border-collapse">
                              <thead>
                                <tr>
                                  <th className={`${TH} min-w-56 pl-7`}>↳ Yarn</th>
                                  <th className={THR}>Blend %</th>
                                  <th className={THR}>Allow %</th>
                                  <th className={THR}>Required Kg</th>
                                  <th className={THR}>Bag Wt</th>
                                  <th className={THR}>Bags</th>
                                  <th className={THR}>DC Cap Kg</th>
                                  {issued ? <th className={THR}>Sent Kg</th> : null}
                                </tr>
                              </thead>
                              <tbody>
                                {f.yarns.map((y) => {
                                  const c = yarnCalc(f, y);
                                  return (
                                    <tr key={y.key}>
                                      <td className={TD}>
                                        <span className={`${CELL} pl-7`}>{y.yarn_name || "—"}</span>
                                      </td>
                                      <td className={TD}>
                                        <span className={`${CELLR} ${y.blend_pct == null ? "text-destructive" : ""}`}>{y.blend_pct == null ? "None" : fmtNumber(y.blend_pct)}</span>
                                      </td>
                                      <td className={`${TD} w-20`}>
                                        {readOnly ? (
                                          <span className={CELLR}>{y.allowance || "0"}</span>
                                        ) : (
                                          <Input type="number" min="0" max="99" step="any" aria-label={`Loss allowance %, ${y.yarn_name}`} className={NUM} value={y.allowance} onChange={(e) => setYarn(f.key, y.key, { allowance: e.target.value })} />
                                        )}
                                      </td>
                                      <td className={TD}>
                                        <span className={`${CELLR} font-semibold`}>{fmtNumber(c.required)}</span>
                                      </td>
                                      <td className={`${TD} w-20`}>
                                        {readOnly ? (
                                          <span className={CELLR}>{y.bag_weight || "—"}</span>
                                        ) : (
                                          <Input type="number" min="0" step="any" aria-label={`Kg in one bag, ${y.yarn_name}`} className={NUM} value={y.bag_weight} onChange={(e) => setYarn(f.key, y.key, { bag_weight: e.target.value })} />
                                        )}
                                      </td>
                                      <td className={TD}>
                                        <span className={CELLR}>{c.bags ?? "—"}</span>
                                      </td>
                                      <td className={TD}>
                                        <span className={`${CELLR} text-muted-foreground`}>{fmtNumber(c.cap)}</span>
                                      </td>
                                      {issued ? (
                                        <td className={TD}>
                                          <span className={CELLR}>{y.dispatched_kg ? fmtNumber(y.dispatched_kg) : "—"}</span>
                                        </td>
                                      ) : null}
                                    </tr>
                                  );
                                })}
                                {f.yarns.length > 1 ? (
                                  <tr className="font-semibold">
                                    <td className={SUM_TD}>
                                      <span className={`${CELL} pl-7`}>Yarn for this fabric</span>
                                    </td>
                                    <td className={SUM_TD}>
                                      <span className={CELLR}>{fmtNumber(blendOf(f))}</span>
                                    </td>
                                    <td className={SUM_TD} />
                                    <td className={SUM_TD}>
                                      <span className={CELLR}>{fmtNumber(sum.kg)}</span>
                                    </td>
                                    <td className={SUM_TD} />
                                    <td className={SUM_TD}>
                                      <span className={CELLR}>{sum.bags || "—"}</span>
                                    </td>
                                    <td className={SUM_TD}>
                                      <span className={CELLR}>{fmtNumber(sum.cap)}</span>
                                    </td>
                                    {issued ? (
                                      <td className={SUM_TD}>
                                        <span className={CELLR}>{fmtNumber(sum.sent)}</span>
                                      </td>
                                    ) : null}
                                  </tr>
                                ) : null}
                              </tbody>
                            </table>
                          </div>
                        </>
                      ) : null}
                    </section>
                  );
                })}
                {!readOnly ? (
                  <Button type="button" variant="outline" data-row-add="" onClick={addFabric} disabled={!salesOrderId}>
                    <Plus className="size-4" aria-hidden />
                    Add a fabric from the BOM
                  </Button>
                ) : null}
                {gaugeOptions.length === 0 && !readOnly ? <p className="text-xs text-muted-foreground">No gauges in the Gauge master yet.</p> : null}
              </div>

              {/* THE STORE'S VIEW — the same yarn across fabrics, added up; stays beside the blocks */}
              {byYarn.length ? (
                <aside className="sticky top-4 max-w-[21rem] min-w-60 flex-[1_1_260px] space-y-2 rounded-lg border border-border bg-[var(--table-head-bg)]/20 p-3" aria-label="Yarn by count">
                  <h3 className="text-[11px] font-bold tracking-wide text-muted-foreground uppercase">For the store — by yarn</h3>
                  <p className="text-xs text-muted-foreground">The same yarn across fabrics, added up</p>
                  <ul className="space-y-1.5 text-sm">
                    {byYarn.map((y) => (
                      <li key={y.name} className="flex justify-between gap-3">
                        <span>{y.name}</span>
                        <span className="shrink-0 font-semibold tabular-nums">
                          {fmtNumber(y.kg)}
                          {y.noBag ? "" : ` · ${y.bags} bag${y.bags === 1 ? "" : "s"}`}
                        </span>
                      </li>
                    ))}
                    <li className="flex justify-between gap-3 border-t border-border pt-1.5 font-semibold">
                      <span>Total</span>
                      <span className="tabular-nums">
                        {fmtNumber(totals.yarn)} kg{totalBags ? ` · ${totalBags} bags` : ""}
                      </span>
                    </li>
                  </ul>
                </aside>
              ) : null}
            </div>
          ) : null}

          {/* STEP 2 — OUTWARD YARN DC (Phase 2). A Yarn DC is a Process DC against this order:
              the form lists its yarns with the balance still to send (whole bags, 0825), a lot
              picker that only offers lots on hand (oldest first), and dispatch moves the yarn to
              the knitter (0826, lot by lot). */}
          {/* The DCs already raised — only once there are some (user 2026-11-11: an empty
              "No yarn has been sent yet" box above the DC form said nothing the form doesn't). */}
          {tab === "2" && doc && issued && doc.dcs.length > 0 ? (
            <section className="max-w-[62.5rem] space-y-2 rounded-lg border border-border p-3">
              <h3 className="text-sm font-semibold">Yarn DCs on this order</h3>
              {(
                <table className="w-full text-sm">
                  <thead className="text-left text-xs text-muted-foreground">
                    <tr>
                      <th className="py-1 font-medium">DC No</th>
                      <th className="py-1 font-medium">Date</th>
                      <th className="py-1 text-right font-medium">Bags</th>
                      <th className="py-1 text-right font-medium">Kg</th>
                      <th className="py-1 font-medium">Status</th>
                      <th className="py-1" />
                    </tr>
                  </thead>
                  <tbody>
                    {doc.dcs.map((d) => (
                      <tr key={d.id} className="border-t border-border">
                        <td className="py-1 font-mono text-xs">{d.code ?? "—"}</td>
                        <td className="py-1 tabular-nums">{fmtDate(d.dc_date)}</td>
                        <td className="py-1 text-right tabular-nums">{d.bags ?? "—"}</td>
                        <td className="py-1 text-right tabular-nums">{fmtNumber(d.kg)}</td>
                        <td className="py-1">
                          <StatusPill tone={statusTone(d.status)}>{d.status === "draft" ? "Draft" : d.status === "cancelled" ? "Cancelled" : "Dispatched"}</StatusPill>
                        </td>
                        <td className="py-1 text-right">
                          {d.status === "draft" ? (
                            <span className="text-xs text-muted-foreground">continue below</span>
                          ) : d.status !== "cancelled" ? (
                            <Link href={`/stores/process-dc/${d.id}/print`} className="text-primary hover:underline">
                              Print
                            </Link>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          ) : null}

          {/* SEND YARN, HERE (user 2026-11-11: "we need this same here in same tab"). The Job Work DC
              form itself, embedded — the order fixed, a draft carried on — so there is still ONE
              dispatch path (0826's lot-wise check, the +1 bag cap). Keyed on what has gone out, so
              after a dispatch it reopens with the new balances. */}
          {tab === "2" && doc && issued && canEdit ? (
            dcSend?.order ? (
              <ProcessDcSendForm
                key={`${doc.dcs.length}-${totals.sent}`}
                embedded
                orders={[dcSend.order]}
                stores={stores}
                bins={bins}
                stock={dcSend.stock}
                lots={dcSend.lots}
                binStock={dcSend.binStock}
                existing={dcSend.draft}
                initialOrderId={doc.id}
                onDone={() => router.refresh()}
              />
            ) : doc.status !== "closed" && !doc.close_pending ? (
              <p className="text-sm text-muted-foreground">All the yarn on this order has been sent, up to its whole bags.</p>
            ) : null
          ) : null}

          {/* STEP 3 — inside the frame, under its tab. Its Post is its own button, not a submit. */}
          {tab === "3" && doc && receivable ? <KnittingReceiptPanel doc={doc} stores={stores} bins={bins} canEdit={canEdit} today={today} /> : null}

          {tab === "1" ? <DocRemarksLine maxWidthClass="max-w-[62.5rem]" value={notes} readOnly={readOnly} onChange={setNotes} /> : null}
        </div>

        <div className={DOC_BOTTOM_BAR} data-focus-region="footer">
          {canEdit && doc && (doc.status === "draft" || doc.status === "issued") ? (
            <button
              type="button"
              className="text-sm text-muted-foreground hover:text-foreground hover:underline"
              onClick={() => setConfirm("cancel")}
              disabled={isPending}
            >
              Cancel this knitting order
            </button>
          ) : null}
          <div className="ml-auto flex items-center gap-2">
            <Link href={BASE} className={buttonClasses({ variant: "outline" })}>
              {readOnly ? "Close" : "Cancel"}
            </Link>
            {!readOnly ? (
              <Button type="button" onClick={save} variant={doc && !dirty ? "outline" : "primary"} disabled={isPending || !canSave || (!!doc && !dirty)}>
                {isPending ? "Saving…" : "Save"}
              </Button>
            ) : null}
            {!readOnly && doc && !dirty ? (
              <Button type="button" disabled={isPending || doc.fabrics.length === 0} onClick={() => setConfirm("issue")}>
                Issue to Knitter
              </Button>
            ) : null}
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={confirm === "issue"}
        title={`Issue ${doc?.code ?? "this knitting order"}?`}
        body="The order goes to the knitter and can no longer be changed. Its yarn is then sent on Stores ▸ Process DC, up to the whole bags shown."
        confirmLabel="Issue"
        tone="primary"
        isPending={isPending}
        onConfirm={issue}
        onCancel={() => setConfirm(null)}
      />
      <ConfirmDialog
        open={confirm === "cancel"}
        title={`Cancel ${doc?.code ?? "this knitting order"}?`}
        body="No yarn has gone out on it. A cancelled order stays on the list, read-only."
        confirmLabel="Cancel order"
        cancelLabel="Keep"
        isPending={isPending}
        onConfirm={cancelDoc}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
}

function blankRowStatic(): Omit<FabricRow, "key"> {
  return {
    source_key: "",
    fabric_item_id: "",
    fabric_name: "",
    width_form: null,
    knit_dia: "",
    finished_dia: "",
    gsm: "",
    loop_length: "",
    loop_length_ref: "",
    gauge_id: "",
    ply: "",
    programmed: "",
    roll_weight: "",
    rate: "",
    yarns: [],
  };
}
