"use client";

import { Fragment, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { Plus, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button, buttonClasses } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { MultiSelect } from "@/components/ui/multi-select";
import { Field, FieldRow } from "@/components/ui/field";
import { Truncated } from "@/components/ui/truncated";
import { PageHeader } from "@/components/ui/page-header";
import { StatusPill } from "@/components/ui/status-pill";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { DOC_BOTTOM_BAR, DOC_FRAME, DocRemarksLine } from "@/components/purchase/doc-surface";
import { fmtMoney, fmtNumber } from "@/lib/format";
import { statusTone } from "@/lib/ui/status-tone";
import { useUnsavedGuard } from "@/lib/reload-guard";
import type { BinOption, StoreOption } from "@/lib/stores/production-dc-service";
import type { BinStockOption } from "@/lib/stores/process-dc-service";
import { FieldError } from "@/components/ui/field";
import { KnitAtKnitterPanel } from "./knit-at-knitter-panel";
import { cancelKnittingOrder, dispatchKnittingYarn, issueKnittingOrder, loadKnitCandidates, saveKnittingOrder, setKnittingDcCap } from "@/lib/production/knitting-actions";
import { type KnitYarnAtKnitter,
  KNIT_STATUS_LABELS,
  PLY_OPTIONS,
  WIDTH_FORM_LABELS,
  yarnRequirement,
  type KnitCandidate,
  type KnitOption,
  type KnitSendLine,
  type KnitWidthForm,
  type KnittingOrder,
} from "@/lib/production/knitting-types";

const BASE = "/process/knitting-hub";

type YarnRow = {
  key: string;
  yarn_item_id: string;
  yarn_name: string;
  blend_pct: number | null;
  allowance: string;
  bag_weight: string;
  /** DC CAP typed by the store (0837) — blank = the calculated cap (whole bags). */
  cap: string;
  /** The override as last saved — an issued order commits `cap` on blur when the two differ. */
  cap_saved: string;
  /** Sent on Process DCs so far (saved orders only). */
  dispatched_kg: number;
  /* SEND FROM HERE (user 2026-11-12): the store and bin it leaves from, and the kg going now. */
  store_id: string;
  bin_id: string;
  send: string;
};

type FabricRow = {
  key: string;
  /** "<RE id>#<BOM slice key>" for a pick, "saved:<id>" for a saved line with no slice (0836). */
  source_key: string;
  /** The RE this fabric is knitted for (0836: one Knitting Order, several REs). */
  sales_order_id: string;
  re_no: string;
  fabric_item_id: string;
  fabric_name: string;
  width_form: KnitWidthForm | null;
  knit_dia: string;
  finished_dia: string;
  /** Finishing GSM — the BOM's, read-only. */
  gsm: string;
  /** Knitting GSM (0835) — starts at the finishing GSM, editable. */
  knit_gsm: string;
  loop_length: string;
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
/** A BOM slice is unique only within its RE, so a pick is keyed "<RE>#<slice>" (0836). */
const pickKey = (re: string | null | undefined, sliceKey: string) => `${re ?? ""}#${sliceKey}`;
/** The BOM slice key the database stores — the part after the RE. */
const sliceOf = (pick: string) => (pick.includes("#") ? pick.slice(pick.indexOf("#") + 1) : pick);
/** Nothing the operator chose — the blank end row. */
const isBlank = (r: FabricRow) => !r.source_key && !r.programmed.trim();

function rowsFromDoc(doc: KnittingOrder): FabricRow[] {
  return doc.fabrics.map((f) => ({
    key: f.id,
    source_key: f.source_key ? pickKey(f.sales_order_id ?? doc.sales_order_id, f.source_key) : `saved:${f.id}`,
    sales_order_id: f.sales_order_id ?? doc.sales_order_id ?? "",
    re_no: f.re_no ?? "",
    fabric_item_id: f.fabric_item_id,
    fabric_name: f.fabric_name,
    width_form: f.width_form,
    knit_dia: f.knit_dia ?? "",
    finished_dia: f.finished_dia ?? "",
    gsm: str(f.gsm),
    knit_gsm: str(f.knit_gsm),
    loop_length: str(f.loop_length),
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
      cap: str(y.dc_cap_override_kg),
      cap_saved: str(y.dc_cap_override_kg),
      dispatched_kg: y.dispatched_kg,
      store_id: "",
      bin_id: "",
      send: "",
    })),
  }));
}

/**
 * KNITTING HUB ▸ one Knitting Order (DB 0825, doc/process/knitting-plan.md Phase 1).
 *
 * ONE SCREEN, NO TABS (client recording-1794374987319, user 2026-11-12). The order header, the
 * fabrics to knit (off the RE's current Fabric BOM), each fabric's construction and its yarn
 * explosion — and on every yarn row the store · bin it leaves from, what that bin holds and the
 * Send Qty. "Issue & Send Yarn" saves, issues and dispatches ONE Job Work DC for the rows with a
 * Send Qty (dispatchKnittingYarn); a row left at 0 stays open for a later DC. Fabric Receipts and
 * Yarn Returns are their own screens under Process ▸ Knitting (user 2026-11-12: "remove it from
 * here"), so they are no longer tabs of the order.
 */
export function KnittingEditor({
  doc,
  orders,
  knitters,
  gauges,
  initialCandidates,
  initialCustomers,
  nextCode = null,
  today,
  canEdit,
  stores = [],
  bins = [],
  binStock = [],
  atKnitter = [],
}: {
  /** What each store / bin of this unit holds — the yarn rows' place list and "In Stock" (user 2026-11-12). */
  binStock?: BinStockOption[];
  /** This knitter's yarn still at the knitter on other open orders (0833). */
  atKnitter?: KnitYarnAtKnitter[];
  /** The stores and bins the yarn is sent from (this unit's). */
  stores?: StoreOption[];
  bins?: BinOption[];
  doc: KnittingOrder | null;
  orders: { id: string; order_number: string | null }[];
  knitters: KnitOption[];
  gauges: KnitOption[];
  initialCandidates: KnitCandidate[];
  /** Each RE's customer, keyed by RE id (0836). */
  initialCustomers: Record<string, string | null>;
  /** The KO No a NEW order will most likely get (next_knitting_order_no, read-only peek). The real
   *  number is minted on Save, so a second user saving first can take it. */
  nextCode?: string | null;
  today: string;
  canEdit: boolean;
}) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, start] = useTransition();
  const [isLoading, startLoad] = useTransition();

  const readOnly = !canEdit || (!!doc && doc.status !== "draft");
  const issued = !!doc && doc.status !== "draft" && doc.status !== "cancelled";
  /** Yarn may still go out: a draft (issued in the same click) or an open order. */
  const sendable =
    canEdit && (!doc || ["draft", "issued", "in_process", "partially_received"].includes(doc.status)) && !doc?.close_pending;
  /** Send FROM a holding store, never Processing (the knitter's side) or Transit. */
  const sendStores = stores.filter((x) => x.store_type !== "processing" && x.store_type !== "transit");

  /* SEVERAL REs ON ONE ORDER (client 2026-11-12, 0836): the fabrics of every RE picked here are
     offered, each tagged with its RE, and each saved line keeps its own RE. */
  const [reIds, setReIds] = useState<string[]>(() => doc?.res.map((r) => r.id) ?? []);
  const [vendorId, setVendorId] = useState(doc?.vendor_id ?? "");
  const [orderDate, setOrderDate] = useState(doc?.order_date ?? today);
  const [expectedDate, setExpectedDate] = useState(doc?.expected_date ?? "");
  const [allowedLoss, setAllowedLoss] = useState(str(doc?.allowed_loss_pct));
  const [notes, setNotes] = useState(doc?.notes ?? "");
  const [candidates, setCandidates] = useState<KnitCandidate[]>(initialCandidates);
  const [customerByRe, setCustomerByRe] = useState<Record<string, string | null>>(initialCustomers);
  const customer = [...new Set(reIds.map((id) => customerByRe[id]).filter((x): x is string => !!x))].join(", ") || null;
  const [note, setNote] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<"issue" | "send" | "cancel" | null>(null);
  const [dcDate, setDcDate] = useState(today);

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
  const current = JSON.stringify([reIds, vendorId, orderDate, expectedDate, allowedLoss, notes.trim().toUpperCase(), typed.map((r) => ({ ...r, key: undefined, yarns: r.yarns.map((y) => ({ ...y, store_id: undefined, bin_id: undefined, send: undefined })) }))]);
  const [baseline, setBaseline] = useState(current);
  const dirty = !readOnly && current !== baseline;
  const sendTyped = rows.some((r) => r.yarns.some((y) => y.send.trim() !== ""));
  useUnsavedGuard(dirty || sendTyped || isPending);

  const candByKey = useMemo(() => new Map(candidates.map((c) => [pickKey(c.sales_order_id, c.key), c])), [candidates]);

  function setRow(key: string, patch: Partial<FabricRow>) {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }
  function setYarn(rowKey: string, yarnKey: string, patch: Partial<YarnRow>) {
    setRows((rs) =>
      rs.map((r) => (r.key === rowKey ? { ...r, yarns: r.yarns.map((y) => (y.key === yarnKey ? { ...y, ...patch } : y)) } : r)),
    );
  }

  function pickOrders(next: string[]) {
    const added = next.filter((id) => !reIds.includes(id));
    const removed = new Set(reIds.filter((id) => !next.includes(id)));
    setReIds(next);
    // A removed RE takes its fabrics with it; the other REs' fabrics stay.
    if (removed.size) {
      setRows((rs) => {
        const kept = rs.filter((r) => !removed.has(r.sales_order_id));
        return kept.length ? kept : [blankRow()];
      });
      setCandidates((cs) => cs.filter((c) => !removed.has(c.sales_order_id)));
    }
    if (!next.length) setNote(null);
    if (!added.length) return;
    startLoad(async () => {
      const got = await Promise.all(added.map((id) => loadKnitCandidates(id, doc?.id ?? null).then((res) => ({ id, res }))));
      const notes: string[] = [];
      const reNo = (id: string) => orders.find((o) => o.id === id)?.order_number ?? "This RE";
      for (const { id, res } of got) {
        if (!res.ok) {
          notes.push(`${reNo(id)}: ${res.error}`);
          continue;
        }
        if (res.note) notes.push(next.length > 1 ? `${reNo(id)}: ${res.note}` : res.note);
        setCandidates((cs) => [...cs.filter((c) => c.sales_order_id !== id), ...res.candidates]);
        setCustomerByRe((m) => ({ ...m, [id]: res.customer }));
      }
      setNote(notes.length ? notes.join(" · ") : null);
    });
  }

  function pickFabric(rowKey: string, sourceKey: string) {
    const c = candByKey.get(sourceKey);
    if (!c) return setRow(rowKey, { source_key: "" });
    const balance = Math.max(0, Math.round((c.bom_kg - c.programmed_elsewhere_kg) * 1000) / 1000);
    setRow(rowKey, {
      source_key: pickKey(c.sales_order_id, c.key),
      sales_order_id: c.sales_order_id,
      re_no: c.re_no ?? "",
      fabric_item_id: c.fabric_item_id,
      fabric_name: c.fabric_name,
      width_form: c.width_form,
      // The BOM dia is the FINISHED dia; the knitting dia that gives it is typed here (client 11-11).
      finished_dia: c.finish_dia ?? "",
      knit_dia: "",
      gsm: str(c.gsm),
      knit_gsm: str(c.gsm),
      // ATM-style: the BOM's balance still to knit, editable.
      programmed: balance ? String(balance) : "",
      yarns: c.yarns.map((y, i) => ({
        key: `${rowKey}-y${i}`,
        yarn_item_id: y.yarn_item_id,
        yarn_name: y.yarn_name,
        blend_pct: y.blend_pct,
        allowance: allowedLoss,
        bag_weight: "",
        cap: "",
        cap_saved: "",
        dispatched_kg: 0,
        store_id: "",
        bin_id: "",
        send: "",
      })),
    });
  }

  // ---------- what the screen can answer before Save ----------
  const blendOf = (r: FabricRow) => r.yarns.reduce((t, y) => t + (y.blend_pct ?? 0), 0);
  const blendBad = (r: FabricRow) => r.yarns.length === 0 || r.yarns.some((y) => y.blend_pct == null) || Math.abs(blendOf(r) - 100) > 0.01;
  const progBad = (r: FabricRow) => !((n(r.programmed) ?? 0) > 0);
  const knitDiaBad = (r: FabricRow) => !r.knit_dia.trim();
  const anyBad = typed.some((r) => !r.source_key || progBad(r) || knitDiaBad(r) || blendBad(r));
  const canSave = !readOnly && !!vendorId && reIds.length > 0 && typed.length > 0 && !anyBad;

  /** `calc` is the calculated cap (whole bags); `cap` is what binds — the store's override, else calc (0837). */
  const yarnCalc = (r: FabricRow, y: YarnRow) => {
    const base = yarnRequirement(n(r.programmed) ?? 0, y.blend_pct ?? 0, n(y.allowance) ?? 0, n(y.bag_weight));
    const typed = n(y.cap);
    return { ...base, calc: base.cap, cap: typed != null && typed > 0 ? typed : base.cap };
  };

  /** An issued order's DC Cap, committed on blur (0837): blank = back to the calculated cap. */
  function commitCap(f: FabricRow, y: YarnRow) {
    if (!doc || y.cap.trim() === y.cap_saved.trim()) return;
    const kg = n(y.cap);
    start(async () => {
      const res = await setKnittingDcCap(doc.id, y.key, kg);
      if (!res.ok) {
        toastError(res.error);
        setYarn(f.key, y.key, { cap: y.cap_saved });
        return;
      }
      setYarn(f.key, y.key, { cap_saved: y.cap });
      success(kg == null ? `${y.yarn_name}: DC Cap back to ${fmtNumber(res.cap)} kg` : `${y.yarn_name}: DC Cap set to ${fmtNumber(res.cap)} kg`);
      router.refresh();
    });
  }
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

  /* ---------- the send columns (user 2026-11-12) ---------- */
  /*
   * WHERE IT GOES FROM, INLINE (user 2026-11-12, screenshot 4113: "instead of this dialog box …
   * inline mode"). ONE dropdown per yarn row listing only the places that HOLD that yarn — a bin
   * with its stock, or a store's un-binned stock — e.g. "Material Store · MAT06 — 300". With a
   * single place it is chosen by itself; with none the row says so and cannot send.
   */
  const storeName = new Map(sendStores.map((x) => [x.id, x.name]));
  const binCode = new Map(bins.map((b) => [b.id, b.code]));
  /* SHORT LABEL (user 2026-11-12, screenshot 100438: "Material Store · MAT06 — …" was cut off):
     BIN FIRST, then its stock — "MAT06 — 300". The store is named only when the yarn sits in more
     than one store; otherwise every row would repeat the same "Material Store". */
  const placesOf = (y: YarnRow) => {
    const held = binStock.filter((b) => b.item_id === y.yarn_item_id && b.qty > 0 && storeName.has(b.store_id));
    const manyStores = new Set(held.map((b) => b.store_id)).size > 1;
    return held
      .map((b) => {
        const bin = b.bin_id ? (binCode.get(b.bin_id) ?? "bin") : "No bin";
        return {
          value: `${b.store_id}|${b.bin_id ?? ""}`,
          store_id: b.store_id,
          bin_id: b.bin_id ?? "",
          qty: b.qty,
          label: `${bin} — ${fmtNumber(b.qty)}${manyStores ? ` · ${storeName.get(b.store_id)}` : ""}`,
        };
      })
      .sort((a, b) => b.qty - a.qty);
  };
  /** The row's pick — or the only place there is. */
  const placeOf = (y: YarnRow) => {
    const all = placesOf(y);
    return y.store_id ? (all.find((p) => p.store_id === y.store_id && p.bin_id === y.bin_id) ?? null) : all.length === 1 ? all[0] : null;
  };
  const storeOf = (y: YarnRow) => placeOf(y)?.store_id ?? "";
  /** In the chosen BIN when one is picked; else the whole store. */
  /** The picked place's stock; with nothing picked, all of it across the stores. */
  const inStock = (y: YarnRow) => placeOf(y)?.qty ?? placesOf(y).reduce((t, p) => t + p.qty, 0);
  /** Bins of the row's store that hold its yarn — plus the one already chosen. */
  const leftToSend = (f: FabricRow, y: YarnRow) => Math.max(0, Math.round((yarnCalc(f, y).cap - y.dispatched_kg) * 1000) / 1000);
  const sendProblem = (f: FabricRow, y: YarnRow): string | null => {
    const q = n(y.send) ?? 0;
    if (q <= 0) return null;
    if (q > leftToSend(f, y) + 1e-9) return `Only ${fmtNumber(leftToSend(f, y))} left to send`;
    if (!placeOf(y)) return placesOf(y).length ? "Pick a bin" : "None in stock";
    // The typed kg is the dispatcher's (a bag of 58.4 kg, not 60) — never more than the bin holds.
    if (q > inStock(y) + 1e-9) {
      const p = placeOf(y);
      const where = p?.bin_id ? `Bin ${binCode.get(p.bin_id) ?? "?"}` : `${storeName.get(p?.store_id ?? "") ?? "the store"} (no bin)`;
      return `Send Qty (${fmtNumber(q)} kg) exceeds available stock in ${where} (${fmtNumber(inStock(y))} kg)`;
    }
    return null;
  };
  const sends: KnitSendLine[] = typed.flatMap((f, fi) =>
    f.yarns.flatMap((y, yi) => {
      const kg = n(y.send) ?? 0;
      if (kg <= 0) return [];
      const wt = n(y.bag_weight);
      return [{ fabric_index: fi, yarn_index: yi, store_id: storeOf(y), bin_id: placeOf(y)?.bin_id || null, kg, bags: wt && wt > 0 ? Math.round(kg / wt) : null, bag_weight_kg: wt && wt > 0 ? wt : null }];
    }),
  );
  const sendBad = typed.some((f) => f.yarns.some((y) => !!sendProblem(f, y)));
  const sendKg = sends.reduce((t, x) => t + x.kg, 0);

  /** Raise and dispatch the DC for the typed rows; then clear them. */
  async function runDispatch(orderId: string): Promise<boolean> {
    const res = await dispatchKnittingYarn(orderId, dcDate || today, sends);
    if (!res.ok) {
      toastError(res.error);
      return false;
    }
    success(`Job Work DC dispatched — ${fmtNumber(sendKg)} kg of yarn is at the knitter`);
    setRows((rs) => rs.map((r) => ({ ...r, yarns: r.yarns.map((y) => ({ ...y, send: "" })) })));
    return true;
  }

  function save() {
    if (!canSave) return;
    start(async () => {
      const res = await saveKnittingOrder(doc?.id ?? null, payload());
      if (!res.ok) return toastError(res.error);
      success("Knitting order saved");
      setBaseline(current);
      if (!doc) router.replace(`${BASE}/${res.id}`);
      else router.refresh();
    });
  }

  function payload() {
    return {
        vendor_id: vendorId,
        // The header keeps the FIRST RE (0836); each fabric names its own.
        sales_order_id: reIds[0] ?? null,
        order_date: orderDate || null,
        expected_date: expectedDate || null,
        allowed_loss_pct: n(allowedLoss),
        notes: notes.trim() || null,
        fabrics: typed.map((r) => ({
          sales_order_id: r.sales_order_id || reIds[0] || null,
          fabric_item_id: r.fabric_item_id,
          source_key: r.source_key.startsWith("saved:") ? null : sliceOf(r.source_key),
          width_form: r.width_form,
          knit_dia: r.knit_dia || null,
          finished_dia: r.finished_dia || null,
          gsm: n(r.gsm),
          knit_gsm: n(r.knit_gsm),
          loop_length: n(r.loop_length),
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
            dc_cap_kg: n(y.cap),
          })),
        })),
    };
  }

  /**
   * ISSUE & SEND YARN — one click (user 2026-11-12, "Save Knitting Program & Generate Job Work DC"):
   * save if anything changed, issue to the knitter, then dispatch the rows with a Send Qty. Three
   * server calls in a row, each its own transaction: a step that fails stops the rest and says
   * so — what already went through stays done (the order saved, or issued with no DC yet).
   */
  function issue() {
    start(async () => {
      let id = doc?.id ?? null;
      if (!id || dirty) {
        if (!canSave) return toastError("Fix the program first");
        const saved = await saveKnittingOrder(id, payload());
        if (!saved.ok) return toastError(saved.error);
        id = saved.id;
        setBaseline(current);
      }
      const res = await issueKnittingOrder(id);
      setConfirm(null);
      if (!res.ok) {
        toastError(res.error);
        if (!doc) router.replace(`${BASE}/${id}`);
        return;
      }
      if (sends.length) await runDispatch(id);
      else success("Issued — send its yarn from the same screen when it is ready");
      if (!doc) router.replace(`${BASE}/${id}`);
      else router.refresh();
    });
  }

  /** An issued order: send the next lot of yarn (partial dispatch). */
  function sendOnly() {
    if (!doc) return;
    start(async () => {
      const ok = await runDispatch(doc.id);
      setConfirm(null);
      if (ok) router.refresh();
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

  const reOptions = orders.map((o) => ({ id: o.id, label: o.order_number ?? "(no RE No)" }));
  const manyRes = reIds.length > 1 || new Set(rows.map((r) => r.sales_order_id).filter(Boolean)).size > 1;
  const knitterOptions: ComboboxOption[] = knitters
    .filter((k) => !k.inactive || k.id === vendorId)
    .map((k) => ({ value: k.id, label: k.inactive ? `${k.name} (not a knitter)` : k.name }));
  const gaugeOptions = gauges.filter((g) => !g.inactive);

  /* ONE PROGRAM PER FABRIC (user 2026-11-12, doc/process/knitting update.md §2.1): a BOM slice
     another PLACED knitting order of this RE already holds is greyed "(Program Placed — KO/..)".
     A block already holding it keeps it (that option is the block's own value); a draft elsewhere
     does not block. The database refuses it too (0835 `knitting_fabric_placed_by`). */
  const candidateOptions: ComboboxOption[] = candidates.map((c) => ({
    value: pickKey(c.sales_order_id, c.key),
    label: c.placed_on ? `${c.fabric_name} (Program Placed — ${c.placed_on})` : c.fabric_name,
    disabled: c.placed_on ? true : undefined,
    sublabel: [
      // Which RE the fabric is on, once the order holds more than one (0836).
      reIds.length > 1 && c.re_no ? `RE ${c.re_no}` : null,
      c.finish_dia ? `FIN DIA ${c.finish_dia}` : "No dia",
      c.width_form ? WIDTH_FORM_LABELS[c.width_form] : null,
      `BOM ${fmtNumber(c.bom_kg)} kg`,
      c.programmed_elsewhere_kg ? `on other KOs ${fmtNumber(c.programmed_elsewhere_kg)} kg` : null,
    ]
      .filter(Boolean)
      .join(" · "),
  }));

  /** Picked by another block — greyed in this block's list (AGENTS.md "Pick once"). */
  const optionsFor = (r: FabricRow): ComboboxOption[] =>
    candidateOptions.map((o) =>
      o.value === r.source_key
        ? { ...o, disabled: undefined }
        : rows.some((x) => x.key !== r.key && x.source_key === o.value)
          ? { ...o, disabled: true, label: `${o.label} (already added)` }
          : o,
    );

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
    const m = new Map<string, { id: string; name: string; kg: number; bags: number; noBag: boolean }>();
    for (const r of typed) {
      for (const y of r.yarns) {
        const c = yarnCalc(r, y);
        const t = m.get(y.yarn_item_id) ?? { id: y.yarn_item_id, name: y.yarn_name, kg: 0, bags: 0, noBag: false };
        t.kg += c.required;
        if (c.bags == null) t.noBag = true;
        else t.bags += c.bags;
        m.set(y.yarn_item_id, t);
      }
    }
    return [...m.values()].sort((x, y) => y.kg - x.kg);
  })();
  /** The order of the REs on screen: as picked, then any a saved line names that is no longer picked. */
  const reRank = (re: string) => {
    const i = reIds.indexOf(re);
    return i === -1 ? reIds.length : i;
  };
  /* ONE RE AFTER ANOTHER (screenshot 4126, user 2026-11-12: "mixed yarn listing … no clear
     separation"): with several REs the fabric blocks are drawn grouped by RE under its own
     heading, and the yarn summary is split by RE with a subtotal each. Display order only — the
     rows keep the order they were added in, which is what Save numbers. */
  const ordered = manyRes ? [...rows].sort((a, b) => reRank(a.sales_order_id) - reRank(b.sales_order_id)) : rows;
  const reLabel = (re: string) => orders.find((o) => o.id === re)?.order_number ?? rows.find((r) => r.sales_order_id === re)?.re_no ?? "RE";
  const yarnByRe = (() => {
    const groups = new Map<string, { re: string; kg: number; bags: number; noBag: boolean; yarns: Map<string, { id: string; name: string; kg: number; bags: number; noBag: boolean }> }>();
    for (const r of typed) {
      const g = groups.get(r.sales_order_id) ?? { re: r.sales_order_id, kg: 0, bags: 0, noBag: false, yarns: new Map() };
      for (const y of r.yarns) {
        const c = yarnCalc(r, y);
        const t = g.yarns.get(y.yarn_item_id) ?? { id: y.yarn_item_id, name: y.yarn_name, kg: 0, bags: 0, noBag: false };
        t.kg += c.required;
        g.kg += c.required;
        if (c.bags == null) {
          t.noBag = true;
          g.noBag = true;
        } else {
          t.bags += c.bags;
          g.bags += c.bags;
        }
        g.yarns.set(y.yarn_item_id, t);
      }
      groups.set(r.sales_order_id, g);
    }
    return [...groups.values()]
      .sort((a, b) => reRank(a.re) - reRank(b.re))
      .map((g) => ({ ...g, yarns: [...g.yarns.values()].sort((x, y) => y.kg - x.kg) }));
  })();
  const totalBags = typed.reduce((t, r) => t + r.yarns.reduce((u, y) => u + (yarnCalc(r, y).bags ?? 0), 0), 0);

  /** One word on the block's title line: what still needs doing, or that it is ready. */
  const blockState = (r: FabricRow): { tone: "ok" | "warn" | "bad"; text: string } | null => {
    if (!r.source_key) return null;
    if (r.yarns.length === 0) return { tone: "bad", text: "No composition on the fabric master" };
    if (blendBad(r)) return { tone: "bad", text: `Blend ${fmtNumber(blendOf(r))}% — must be 100%` };
    if (knitDiaBad(r)) return { tone: "bad", text: `Knit Dia to fill${r.finished_dia ? ` for Fin Dia ${r.finished_dia}` : ""}` };
    if (progBad(r)) return { tone: "bad", text: "Program Kg to fill" };
    if (!r.gauge_id || !r.loop_length.trim()) return { tone: "warn", text: "Gauge / loop to fill" };
    return { tone: "ok", text: "Ready" };
  };
  const TONE = { ok: "text-success", warn: "text-warning", bad: "text-destructive" } as const;
  const TH = "whitespace-nowrap border border-[var(--table-head-border)] bg-[var(--table-head-bg)] px-2 py-1.5 text-left text-[11px] font-semibold text-[var(--table-head-fg)]";
  const THR = `${TH} text-right`;
  /** A heading that may wrap to two lines — the fixed-layout spec table (screenshot 4117). */
  /* `!` because the sheet stylesheet (globals.css, `[data-grid-style="sheet"] thead th`) forces
     nowrap + ellipsis on every heading, which turned "Finishing GSM" into "Finishing…" (4118). */
  const THW = `${TH.replace("whitespace-nowrap", "")} !whitespace-normal !overflow-visible leading-tight align-bottom`;
  const THWR = `${THW} text-right`;
  const TD = "h-9 border border-border p-0 align-middle";
  const CELL = "block whitespace-nowrap px-2 text-sm";
  const CELLR = "block px-2 text-right text-sm tabular-nums";
  const NUM = "text-right tabular-nums";

  const status = doc?.status ?? "draft";
  const title = doc ? (doc.code ?? "Knitting Order") : "New Knitting Order";
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

      {/* FULL PAGE (user 2026-11-11: "use the full page screen instead of this layout section").
          It was capped at 72rem; the frame now takes the pane's whole width and at least its
          height, so the sticky bottom bar sits on the window's edge even on a short order. */}
      {/* A SECTION, NOT A <form> (2026-11-11): tab 2 holds the Job Work DC form and tab 3 the
          receipt, each with its own buttons — and `<Button>` defaults to type="submit", so inside
          a form every one of them would also submit the order. Save is an explicit click; Enter
          off the last field and Ctrl+S still press the footer's last button (lib/focus.ts). */}
      <div className={`${DOC_FRAME} flex min-h-[calc(100dvh-10rem)] flex-col`} data-focus-scope="">
        <div className="flex-1 space-y-4 p-4">
          {/*
           * KO No 144 · KO Date 144 · RE No 176 · Knitter 200 · Delivery 144 · Allowed Loss 112
           * = 920 + 5 x 12 gap = 980px. KO No at 112 cut "KO/26-27/0001" off, and "Allowed Loss %"
           * at 88 wrapped its label to two lines and dropped its box below the row (screenshot
           * 4115, 2026-11-12) — both are one step wider now. It was 1100px with a Customer box, and on the client's
           * laptop Allowed Loss % fell to a second line (2026-11-12). Customer is read-only and
           * follows the RE, so it now rides under RE No as the field's hint instead of costing
           * 186px of the row. align="start" keeps the boxes level while that hint shows.
           */}
          <FieldRow align="start">
            <Field label="KO No" w="code">
              <Input readOnly value={doc?.code ?? nextCode ?? "(auto)"} title={doc ? undefined : "Given on Save"} />
            </Field>
            <Field label="KO Date" required w="code">
              <Input type="date" value={orderDate} readOnly={readOnly} onChange={(e) => setOrderDate(e.target.value)} required />
            </Field>
            {/* THE REs SIT IN THE BOX (screenshot 4124): the chip line stacked one RE per row under a
                176px box and pushed the whole header down. Up to two RE Nos read in the box, a third
                counts ("3 REs selected"), and every fabric block below carries its own RE tag. */}
            <Field label="RE No" required w="party" hint={customer ? <Truncated text={customer} /> : undefined}>
              {readOnly ? (
                <Input readOnly value={doc?.order_number ?? "—"} />
              ) : (
                <MultiSelect compact label="RE No" options={reOptions} values={reIds} onChange={pickOrders} required summarizeLabels hideChips summaryNoun="REs" autoOpenClose />
              )}
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
            <Field label="Allowed Loss %" w="range">
              <Input type="number" min="0" max="99" step="any" value={allowedLoss} readOnly={readOnly} onChange={(e) => setAllowedLoss(e.target.value)} />
            </Field>
          </FieldRow>

          {!readOnly && knitters.length === 0 ? (
            <p className="text-sm text-destructive">
              No vendor is registered as a knitter. Add the KNITTING process to the knitter&apos;s Vendor master, then reopen this screen.
            </p>
          ) : null}
          {note ? <p className="text-sm text-muted-foreground">{note}</p> : null}

          {/* ONE SCREEN (user 2026-11-12): the totals sit where the tab bar was. */}
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
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
                  <dt className="inline">Value </dt>
                  <dd className="inline text-sm font-semibold tabular-nums text-foreground">{totals.value ? fmtMoney(totals.value) : "—"}</dd>
                </div>
              </dl>
            ) : null}
          </div>

          {(
            <div className="flex flex-wrap items-start gap-4">
              <div className="min-w-0 flex-[999_1_640px] space-y-3">
                {ordered.map((f, i) => {
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
                    <Fragment key={f.key}>
                    {manyRes && f.sales_order_id && (i === 0 || ordered[i - 1].sales_order_id !== f.sales_order_id) ? (
                      <div className={`flex items-baseline gap-3 border-b-2 border-primary/60 pb-1 ${i === 0 ? "" : "pt-3"}`}>
                        <span className="font-mono text-sm font-bold text-primary">{reLabel(f.sales_order_id)}</span>
                        <span className="text-xs text-muted-foreground">
                          {[
                            customerByRe[f.sales_order_id],
                            `${ordered.filter((x) => x.sales_order_id === f.sales_order_id && x.source_key).length} fabric(s)`,
                            `${fmtNumber(ordered.filter((x) => x.sales_order_id === f.sales_order_id).reduce((t, x) => t + (n(x.programmed) ?? 0), 0))} kg`,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      </div>
                    ) : null}
                    <section className="overflow-hidden rounded-lg border border-[var(--table-head-border)]" aria-label={`Fabric ${i + 1}`}>
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
                              placeholder={reIds.length ? (isLoading ? "Loading…" : candidates.length ? "Pick a fabric from the BOM" : "Nothing to knit on this order") : "Pick the RE No first"}
                              disabled={!reIds.length}
                            />
                          </div>
                        )}
                        {/* WHICH RE (0836) — on every block once the order holds more than one. */}
                        {picked && manyRes && f.re_no ? (
                          <span className="rounded bg-[var(--table-head-bg)] px-1.5 py-0.5 font-mono text-[11px] font-semibold text-[var(--table-head-fg)]">RE {f.re_no}</span>
                        ) : null}
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
                            {/* FITS WITHOUT SCROLLING (user 2026-11-12, screenshot 4117): twelve one-line
                                headings set the width and the row scrolled sideways once the yarn
                                rail took its share. Fixed layout splits the pane between the
                                columns, and a heading too long for its share wraps to two lines
                                (THW) instead of widening it. Labels stay the client's words. */}
                            <table className="w-full table-fixed border-collapse">
                              {/* Form holds "Open Width" / "Tubular" (it spilled into the next cell at an
                                  even share, 4118); the rest share what is left. */}
                              <colgroup>
                                <col className="w-[6.5rem]" />
                                {/* Finishing Dia … Roll Wt share what is left; Program Qty holds "1,234.567"
                                    (it clipped 319.75 to "319.7" at an even share, 4124). */}
                                <col />
                                <col />
                                <col />
                                <col />
                                <col />
                                <col />
                                <col />
                                <col />
                                <col className="w-[6.5rem]" />
                                <col />
                                <col />
                              </colgroup>
                              <thead>
                                <tr>
                                  {/* COLUMN ORDER (client 2026-11-12, doc/process/knitting update.md §2.2):
                                      Finishing Dia · Knitting Dia · Finishing GSM · Knitting GSM · Gauge ·
                                      Loop Length · Ply · Roll Wt · Program Qty · Rate · Value. Loop Ref and
                                      Rolls are gone from entry (their columns stay in the DB). */}
                                  <th className={THW}>Form</th>
                                  <th className={THWR}>Finishing Dia</th>
                                  <th className={THWR}>Knitting Dia *</th>
                                  <th className={THWR}>Finishing GSM</th>
                                  <th className={THWR}>Knitting GSM</th>
                                  <th className={THW}>Gauge</th>
                                  <th className={THWR}>Loop Length</th>
                                  <th className={THW}>Ply</th>
                                  <th className={THWR}>Roll Wt (kg)</th>
                                  <th className={THWR}>Program Qty (kg) *</th>
                                  <th className={THWR}>Rate/kg</th>
                                  <th className={THWR}>Value</th>
                                </tr>
                              </thead>
                              <tbody>
                                <tr>
                                  <td className={TD}>
                                    <span className={CELL}>{f.width_form ? WIDTH_FORM_LABELS[f.width_form] : "—"}</span>
                                  </td>
                                  {/* FIN DIA is the BOM's (the width the garment needs); KNIT DIA is the
                                      machine dia that knits to it — asked for, and holds the cursor until typed
                                      (client 2026-11-11). */}
                                  <td className={TD}>
                                    <span className={CELLR}>{f.finished_dia || "—"}</span>
                                  </td>
                                  <td className={`${TD} w-24`}>
                                    {readOnly ? (
                                      <span className={CELLR}>{f.knit_dia || "—"}</span>
                                    ) : (
                                      <Input
                                        aria-label={f.finished_dia ? `Knitting dia for finished dia ${f.finished_dia}` : "Knitting dia"}
                                        className={NUM}
                                        value={f.knit_dia}
                                        required
                                        placeholder={f.finished_dia ? `for ${f.finished_dia}` : undefined}
                                        onChange={(e) => setRow(f.key, { knit_dia: e.target.value })}
                                      />
                                    )}
                                  </td>
                                  {/* FINISHING GSM is the BOM's (read-only); KNITTING GSM starts at it and
                                      may be changed for the machine (0835). */}
                                  <td className={TD}>
                                    <span className={CELLR}>{f.gsm || "—"}</span>
                                  </td>
                                  <td className={`${TD} w-24`}>
                                    {readOnly ? (
                                      <span className={CELLR}>{f.knit_gsm || f.gsm || "—"}</span>
                                    ) : (
                                      <Input
                                        type="number"
                                        min="0"
                                        step="any"
                                        aria-label="Knitting GSM"
                                        className={NUM}
                                        value={f.knit_gsm}
                                        placeholder={f.gsm || undefined}
                                        onChange={(e) => setRow(f.key, { knit_gsm: e.target.value })}
                                      />
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
                                  <td className={`${TD} w-24`}>
                                    {readOnly ? (
                                      <span className={CELLR}>{f.loop_length || "—"}</span>
                                    ) : (
                                      <Input type="number" min="0" step="any" aria-label="Loop length" className={NUM} value={f.loop_length} onChange={(e) => setRow(f.key, { loop_length: e.target.value })} />
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
                                  <td className={`${TD} w-24`}>
                                    {readOnly ? (
                                      <span className={CELLR}>{f.roll_weight || "—"}</span>
                                    ) : (
                                      <Input type="number" min="0" step="any" aria-label="Roll weight (kg)" className={NUM} value={f.roll_weight} onChange={(e) => setRow(f.key, { roll_weight: e.target.value })} />
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
                            {/* FITS ITS BLOCK (screenshot 4124): auto layout made the yarn row wider than the
                                fabric row above it, so it scrolled sideways and Send Qty sat off screen.
                                Fixed layout: the numbers get set widths, the yarn name takes the rest and
                                truncates with a reveal, long headings wrap (THW). */}
                            <table className="w-full table-fixed border-collapse">
                              {/* SHARES, NOT FIXED rem: at ~800px fixed widths left the yarn name 0px. The
                                  yarn name and From Bin ("MAT06 — 300") hold a share; the figures split
                                  the rest evenly. */}
                              <colgroup>
                                <col className={sendable ? "w-[20%]" : "w-[28%]"} />
                                <col />
                                <col />
                                <col />
                                <col />
                                <col />
                                <col />
                                {issued ? <col /> : null}
                                {sendable ? (
                                  <>
                                    <col className="w-[15%]" />
                                    <col />
                                    <col />
                                  </>
                                ) : null}
                              </colgroup>
                              <thead>
                                <tr>
                                  <th className={`${THW} pl-7`}>↳ Yarn</th>
                                  <th className={THWR}>Blend %</th>
                                  <th className={THWR}>Allow %</th>
                                  <th className={THWR}>Required Kg</th>
                                  <th className={THWR}>Bag Wt</th>
                                  <th className={THWR}>Bags</th>
                                  <th className={THWR}>DC Cap Kg</th>
                                  {issued ? <th className={THWR}>Sent Kg</th> : null}
                                  {sendable ? (
                                    <>
                                      <th className={THW}>From Bin</th>
                                      <th className={THWR}>In Stock</th>
                                      <th className={THWR}>Send Qty</th>
                                    </>
                                  ) : null}
                                </tr>
                              </thead>
                              <tbody>
                                {f.yarns.map((y) => {
                                  const c = yarnCalc(f, y);
                                  return (
                                    <tr key={y.key}>
                                      <td className={TD}>
                                        <Truncated className="block px-2 pl-7 text-sm" text={y.yarn_name || "—"} />
                                      </td>
                                      <td className={TD}>
                                        <span className={`${CELLR} ${y.blend_pct == null ? "text-destructive" : ""}`}>{y.blend_pct == null ? "None" : fmtNumber(y.blend_pct)}</span>
                                      </td>
                                      <td className={TD}>
                                        {readOnly ? (
                                          <span className={CELLR}>{y.allowance || "0"}</span>
                                        ) : (
                                          <Input type="number" min="0" max="99" step="any" aria-label={`Loss allowance %, ${y.yarn_name}`} className={NUM} value={y.allowance} onChange={(e) => setYarn(f.key, y.key, { allowance: e.target.value })} />
                                        )}
                                      </td>
                                      <td className={TD}>
                                        <span className={`${CELLR} font-semibold`}>{fmtNumber(c.required)}</span>
                                      </td>
                                      <td className={TD}>
                                        {readOnly ? (
                                          <span className={CELLR}>{y.bag_weight || "—"}</span>
                                        ) : (
                                          <Input type="number" min="0" step="any" aria-label={`Kg in one bag, ${y.yarn_name}`} className={NUM} value={y.bag_weight} onChange={(e) => setYarn(f.key, y.key, { bag_weight: e.target.value })} />
                                        )}
                                      </td>
                                      <td className={TD}>
                                        <span className={CELLR}>{c.bags ?? "—"}</span>
                                      </td>
                                      {/* DC CAP — CALCULATED, OR TYPED BY THE STORE (client 2026-11-12, 0837): the truck
                                          or the lot released may say otherwise. Blank shows the calculated cap as its
                                          placeholder; a typed one reads amber. A draft saves it with the order; an
                                          issued order commits it on leaving the box. */}
                                      <td className={TD} title={`Calculated: ${fmtNumber(c.calc)} kg (whole bags)`}>
                                        {!readOnly || (issued && sendable) ? (
                                          <Input
                                            type="number"
                                            min="0"
                                            step="any"
                                            aria-label={`DC Cap kg, ${y.yarn_name}`}
                                            className={`${NUM} ${n(y.cap) != null ? "text-warning font-semibold" : ""}`}
                                            /* Placeholders are off app-wide, so the box SHOWS the calculated cap until
                                               the store types another; typing the calculated figure back (or clearing
                                               the box) drops the override. */
                                            value={y.cap !== "" ? y.cap : String(c.calc)}
                                            onFocus={(e) => e.target.select()}
                                            onChange={(e) => {
                                              const v = e.target.value;
                                              setYarn(f.key, y.key, { cap: v === "" || n(v) === c.calc ? "" : v });
                                            }}
                                            onBlur={() => (readOnly ? commitCap(f, y) : undefined)}
                                          />
                                        ) : (
                                          <span className={`${CELLR} ${n(y.cap) != null ? "text-warning font-semibold" : "text-muted-foreground"}`}>{fmtNumber(c.cap)}</span>
                                        )}
                                      </td>
                                      {issued ? (
                                        <td className={TD}>
                                          <span className={CELLR}>{y.dispatched_kg ? fmtNumber(y.dispatched_kg) : "—"}</span>
                                        </td>
                                      ) : null}
                                      {sendable ? (
                                        <>
                                          <td className={TD}>
                                            {placesOf(y).length ? (
                                              <Select
                                                aria-label={`From store · bin, ${y.yarn_name}`}
                                                value={placeOf(y)?.value ?? ""}
                                                onChange={(e) => {
                                                  const [st, bn] = e.target.value.split("|");
                                                  setYarn(f.key, y.key, { store_id: st ?? "", bin_id: bn ?? "" });
                                                }}
                                              >
                                                {placesOf(y).length > 1 ? <option value="">Pick a bin</option> : null}
                                                {placesOf(y).map((pl) => (
                                                  <option key={pl.value} value={pl.value}>
                                                    {pl.label}
                                                  </option>
                                                ))}
                                              </Select>
                                            ) : (
                                              <span className={`${CELL} text-destructive`}>Not in stock</span>
                                            )}
                                          </td>
                                          <td className={TD}>
                                            <span className={`${CELLR} ${inStock(y) > 0 ? "" : "text-destructive"}`}>{fmtNumber(inStock(y))}</span>
                                          </td>
                                          <td className={TD}>
                                            <Input
                                              type="number"
                                              min="0"
                                              step="any"
                                              aria-label={`Send qty (kg), ${y.yarn_name}`}
                                              aria-invalid={sendProblem(f, y) ? true : undefined}
                                              aria-describedby={sendProblem(f, y) ? `ko-send-${y.key}` : undefined}
                                              placeholder={leftToSend(f, y) ? `≤ ${fmtNumber(leftToSend(f, y))}` : "sent"}
                                              className={NUM}
                                              value={y.send}
                                              onChange={(e) => setYarn(f.key, y.key, { send: e.target.value })}
                                            />
                                            <FieldError id={`ko-send-${y.key}`}>{sendProblem(f, y)}</FieldError>
                                          </td>
                                        </>
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
                                    {sendable ? <td className={SUM_TD} colSpan={3} /> : null}
                                  </tr>
                                ) : null}
                              </tbody>
                            </table>
                          </div>
                        </>
                      ) : null}
                    </section>
                    </Fragment>
                  );
                })}
                {!readOnly ? (
                  <Button type="button" variant="outline" data-row-add="" onClick={addFabric} disabled={!reIds.length}>
                    <Plus className="size-4" aria-hidden />
                    Add a fabric from the BOM
                  </Button>
                ) : null}
                {gaugeOptions.length === 0 && !readOnly ? <p className="text-xs text-muted-foreground">No gauges in the Gauge master yet.</p> : null}
              </div>

              {/* THE STORE'S VIEW — the same yarn across fabrics, added up; stays beside the blocks */}
              {byYarn.length ? (
                /* A HEADED TABLE, NOT A LIST (user 2026-11-12: "this section need some clear view"):
                   it was name / bare number pairs with no unit and no column names. Now each yarn
                   reads Need kg · Bags · In Stock (this unit's sending stores, every bin); a yarn the
                   store cannot cover shows its In Stock in red. No title (user, same day: "keep it
                   clean") — the column heads say what it is. */
                <aside className="sticky top-4 max-w-[26rem] min-w-[20rem] flex-[1_1_320px] overflow-hidden rounded-lg border border-border" aria-label="Yarn to issue, all fabrics">
                  {/* FIXED LAYOUT (screenshot 4116): auto layout let the four columns outgrow the
                      ~330px rail and `overflow-hidden` cut In Stock off. The numbers get set widths
                      and the yarn name takes what is left, truncating with a reveal. The head band
                      is painted on each <th> from the shared tokens — the thead fill did not show. */}
                  <table className="w-full table-fixed text-sm">
                    <colgroup>
                      <col />
                      <col className="w-[5rem]" />
                      <col className="w-[3rem]" />
                      <col className="w-[4.5rem]" />
                    </colgroup>
                    <thead>
                      <tr className="text-xs">
                        <th className="bg-[var(--table-head-bg)] px-2 py-1.5 text-left font-medium text-[var(--table-head-fg)]">Yarn</th>
                        <th className="bg-[var(--table-head-bg)] px-2 py-1.5 text-right font-medium text-[var(--table-head-fg)]">Need kg</th>
                        <th className="bg-[var(--table-head-bg)] px-2 py-1.5 text-right font-medium text-[var(--table-head-fg)]">Bags</th>
                        <th className="bg-[var(--table-head-bg)] px-2 py-1.5 text-right font-medium text-[var(--table-head-fg)]">In Stock</th>
                      </tr>
                    </thead>
                    <tbody>
                      {/* One block per RE once there are several (screenshot 4126); In Stock is the store's
                          whole stock of that yarn, and reads red when the ORDER's total need of it is short. */}
                      {(manyRes ? yarnByRe : [{ re: "", kg: totals.yarn, bags: totalBags, noBag: false, yarns: byYarn }]).map((g) => (
                        <Fragment key={g.re || "all"}>
                          {manyRes ? (
                            <tr className="border-t-2 border-border bg-[var(--table-head-bg)]/40">
                              <td colSpan={4} className="px-2 py-1 font-mono text-xs font-bold text-primary">
                                {g.re ? reLabel(g.re) : "No RE"}
                              </td>
                            </tr>
                          ) : null}
                          {g.yarns.map((y) => {
                            const stock = binStock
                              .filter((b) => b.item_id === y.id && b.qty > 0 && storeName.has(b.store_id))
                              .reduce((t, b) => t + b.qty, 0);
                            const short = (byYarn.find((t) => t.id === y.id)?.kg ?? y.kg) - stock;
                            return (
                              <tr key={y.id} className="border-t border-border align-top">
                                <td className="min-w-0 px-2 py-1.5">
                                  <Truncated text={y.name} />
                                </td>
                                <td className="px-2 py-1.5 text-right font-semibold tabular-nums">{fmtNumber(y.kg)}</td>
                                <td className="px-2 py-1.5 text-right tabular-nums">{y.noBag ? "—" : y.bags}</td>
                                <td className={`px-2 py-1.5 text-right tabular-nums ${short > 1e-9 ? "text-destructive" : ""}`}>{fmtNumber(stock)}</td>
                              </tr>
                            );
                          })}
                          {manyRes ? (
                            <tr className="border-t border-border text-xs text-muted-foreground">
                              <td className="px-2 py-1">Subtotal</td>
                              <td className="px-2 py-1 text-right tabular-nums">{fmtNumber(g.kg)}</td>
                              <td className="px-2 py-1 text-right tabular-nums">{g.noBag ? "—" : g.bags || "—"}</td>
                              <td />
                            </tr>
                          ) : null}
                        </Fragment>
                      ))}
                      <tr className="border-t-2 border-border font-semibold">
                        <td className="px-2 py-1.5">Total</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{fmtNumber(totals.yarn)}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{totalBags || "—"}</td>
                        <td className="px-2 py-1.5" />
                      </tr>
                    </tbody>
                  </table>
                </aside>
              ) : null}
            </div>
          )}

          {/* NO "Yarn DCs on this order" TABLE, NO RECEIPTS SENTENCE (user 2026-11-12: "remove it from
              here"). The order's DCs print from its report (the list's Report icon → Knitting
              Analysis, whose strip names every DC); a draft DC is on Purchase ▸ Job Work DC; fabric
              and returned yarn are posted on Process ▸ Knitting ▸ Fabric Receipts / Yarn Returns. */}
          {/* YARN ALREADY AT THE KNITTER (client 2026-11-11, 0833) — moved here without a transport DC. */}
          {doc && issued && canEdit && atKnitter.length ? <KnitAtKnitterPanel doc={doc} rows={atKnitter} /> : null}

          <DocRemarksLine maxWidthClass="max-w-none" value={notes} readOnly={readOnly} onChange={setNotes} />
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
              <Button type="button" onClick={save} variant="outline" disabled={isPending || !canSave || (!!doc && !dirty)}>
                {isPending ? "Saving…" : "Save draft"}
              </Button>
            ) : null}
            {sendable && (!doc || doc.status === "draft") ? (
              // ONE CLICK (user 2026-11-12): save if needed, issue, and send the rows with a Send Qty.
              <Button type="button" disabled={isPending || !canSave || sendBad} onClick={() => setConfirm("issue")}>
                {sends.length ? "Issue & Send Yarn" : "Issue to Knitter"}
              </Button>
            ) : null}
            {sendable && doc && doc.status !== "draft" ? (
              <Button type="button" disabled={isPending || sends.length === 0 || sendBad} onClick={() => setConfirm("send")}>
                Send Yarn (Job Work DC)
              </Button>
            ) : null}
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={confirm === "issue"}
        title={`Issue ${doc?.code ?? "this knitting order"}${sends.length ? " and send the yarn" : ""}?`}
        body={
          <div className="space-y-2">
            <p>The program goes to the knitter and can no longer be changed.</p>
            {sends.length ? (
              <>
                <p>
                  A Job Work DC goes out now with {fmtNumber(sendKg)} kg on {sends.length} yarn line{sends.length === 1 ? "" : "s"}; rows left at 0 stay open for a later DC.
                </p>
                <Field label="DC Date" w="code">
                  <Input type="date" value={dcDate} max={today || undefined} onChange={(e) => setDcDate(e.target.value)} />
                </Field>
              </>
            ) : (
              <p>No Send Qty is typed — the yarn can be sent from this screen later.</p>
            )}
          </div>
        }
        confirmLabel={sends.length ? "Issue & Send" : "Issue"}
        tone="primary"
        isPending={isPending}
        onConfirm={issue}
        onCancel={() => setConfirm(null)}
      />
      <ConfirmDialog
        open={confirm === "send"}
        title={`Send ${fmtNumber(sendKg)} kg of yarn to the knitter?`}
        body={
          <div className="space-y-2">
            <p>
              One Job Work DC on {doc?.code ?? "this order"} with {sends.length} yarn line{sends.length === 1 ? "" : "s"}. The rest stays open for a later DC.
            </p>
            <Field label="DC Date" w="code">
              <Input type="date" value={dcDate} max={today || undefined} onChange={(e) => setDcDate(e.target.value)} />
            </Field>
          </div>
        }
        confirmLabel="Send"
        tone="primary"
        isPending={isPending}
        onConfirm={sendOnly}
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
    sales_order_id: "",
    re_no: "",
    fabric_item_id: "",
    fabric_name: "",
    width_form: null,
    knit_dia: "",
    finished_dia: "",
    gsm: "",
    knit_gsm: "",
    loop_length: "",
    gauge_id: "",
    ply: "",
    programmed: "",
    roll_weight: "",
    rate: "",
    yarns: [],
  };
}
