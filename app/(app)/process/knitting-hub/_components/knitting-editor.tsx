"use client";

import { Fragment, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { ClipboardList, Clock, FileText, Plus, Store, Tag, TrendingUp, User, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button, buttonClasses } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { FilterPill, type FilterPillOption } from "@/components/ui/filter-pill";
import { Field, FieldRow } from "@/components/ui/field";
import { Truncated } from "@/components/ui/truncated";
import { PageHeader } from "@/components/ui/page-header";
import { StatusPill } from "@/components/ui/status-pill";
import { Segmented } from "@/components/ui/segmented";
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
import { reopenKnitBalance, shortCloseKnitBalance } from "@/lib/production/knitting-actions";
import { cancelKnittingOrder, undoKnittingDc, dispatchKnittingYarn, issueKnittingOrder, loadKnitCandidates, saveKnittingOrder, setKnittingDcCap } from "@/lib/production/knitting-actions";
import type { KnitOrderOption } from "@/lib/production/knitting-service";
import { ORDER_BY_BANDS, type OrderByBand } from "@/lib/purchase/re-po/filters";
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
/** A saved row's key is its database id; a new row's is "new-…" / "<key>-y0". */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type YarnRow = {
  key: string;
  yarn_item_id: string;
  yarn_name: string;
  blend_pct: number | null;
  allowance: string;
  /** Screen-only: the operator typed this row's Allow % (plan 2026-11-12, artifact 35SpewQ1). Until
   *  then it FOLLOWS the header's Allowed Loss % — it used to be copied once, at the fabric pick, so a
   *  header typed afterwards never reached the rows and Required Kg carried no allowance (4130). */
  allowance_typed: boolean;
  bag_weight: string;
  /** DC CAP typed by the store (0837) — blank = the calculated cap (whole bags). */
  cap: string;
  /** The override as last saved — an issued order commits `cap` on blur when the two differ. */
  cap_saved: string;
  /** Sent on Process DCs so far (saved orders only). */
  dispatched_kg: number;
  /** Came back from the knitter — returned, or moved onto another KO (0833). Owed again while open (user 2026-11-14). */
  back_kg: number;
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
  /** 0845 — the RE's approved budget Knitting rate; above it (or none) the MD approves. */
  budget_rate: number | null;
  /** Screen-only: "change" was pressed on a picked fabric, so its picker shows again. */
  picking?: boolean;
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
    budget_rate: f.budget_rate,
    yarns: f.yarns.map((y) => ({
      key: y.id,
      yarn_item_id: y.yarn_item_id,
      yarn_name: y.yarn_name,
      blend_pct: y.blend_pct,
      allowance: str(y.allowance_pct),
      // A saved row that differs from the header was typed by hand; one that matches follows it.
      allowance_typed: str(y.allowance_pct) !== str(doc.allowed_loss_pct),
      bag_weight: str(y.bag_weight_kg),
      cap: str(y.dc_cap_override_kg),
      cap_saved: str(y.dc_cap_override_kg),
      dispatched_kg: y.dispatched_kg,
      back_kg: (y.returned_kg ?? 0) + (y.transferred_kg ?? 0),
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
 * Send Qty. "Delivery Now" saves, issues and dispatches ONE Job Work DC for the rows with a
 * Send Qty (dispatchKnittingYarn); a row left at 0 stays open for a later DC. Fabric Receipts and
 * Yarn Returns are their own screens under Process ▸ Knitting (user 2026-11-12: "remove it from
 * here"), so they are no longer tabs of the order.
 */
/* ── THE HEADER PILLS (user 2026-11-13: Raise PO's filter row, "we need all that filters") ──
   Raise PO's PO Type, Order Type and Item Class have one possible value on a Knitting Order (a
   knitter, an RE, a fabric), so they are not drawn; Budget becomes "Fabric BOM" and Progress
   means "already on another KO". Filters only — nothing here is saved. */
const NO_BUYER = "__none__";
type KoFilters = { buyer: string[]; category: string[]; ship: string[]; bom: string[]; progress: string[] };
type KoFilterKey = keyof KoFilters;
const NO_KO_FILTERS: KoFilters = { buyer: [], category: [], ship: [], bom: [], progress: [] };

const dayNo = (iso: string) => Math.floor(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 86_400_000);

/** Raise PO's bands, measured from today to the RE's ship date (no vendor lead days here). */
function shipBand(ship: string | null, today: string): OrderByBand {
  if (!ship) return "nodate";
  const d = dayNo(ship) - dayNo(today);
  return d < 0 ? "late" : d <= 7 ? "week" : d <= 14 ? "fortnight" : "later";
}

/** The values an RE holds for one pill — a list, since an RE has several fabric categories. */
function koFacet(o: KnitOrderOption, k: KoFilterKey, today: string): string[] {
  switch (k) {
    case "buyer":
      return [o.buyer_id ?? NO_BUYER];
    case "category":
      return o.category_ids;
    case "ship":
      return [shipBand(o.ship_date, today)];
    case "bom":
      return [o.has_bom ? "ready" : "none"];
    case "progress":
      return [o.programmed ? "part" : "new"];
  }
}

export function KnittingEditor({
  doc,
  orders,
  categories = [],
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
  prefillSend = false,
  initialReIds = [],
}: {
  /** A NEW order opened from the list's To Program view starts with this RE picked. */
  initialReIds?: string[];
  /** QUICK RE-ISSUE (client recording 2026-11-14): opened from the list's Send Yarn icon — every
   *  yarn's Send Qty starts at what is still left to send, so one click on Delivery Now dispatches it. */
  prefillSend?: boolean;
  /** What each store / bin of this unit holds — the yarn rows' place list and "In Stock" (user 2026-11-12). */
  binStock?: BinStockOption[];
  /** This knitter's yarn still at the knitter on other open orders (0833). */
  atKnitter?: KnitYarnAtKnitter[];
  /** The stores and bins the yarn is sent from (this unit's). */
  stores?: StoreOption[];
  bins?: BinOption[];
  doc: KnittingOrder | null;
  /** Open REs with their buyer — the Buyer → Orders pills (user 2026-11-13, screenshot 4143). */
  orders: KnitOrderOption[];
  /** Names for the Category pill — the fabric categories on the REs' Fabric BOMs. */
  categories?: { id: string; name: string }[];
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

  // EDITABLE AT ANY STAGE (user 2026-11-14, 0849): only a cancelled order is read-only. Past draft the
  // server saves lines in place and refuses only what would falsify a DC or a receipt.
  const readOnly = !canEdit || doc?.status === "cancelled";
  const issued = !!doc && doc.status !== "draft" && doc.status !== "cancelled";
  /** Yarn may still go out: a draft (issued in the same click) or an open order. */
  const sendable =
    canEdit && (!doc || ["draft", "issued", "in_process", "partially_received"].includes(doc.status)) && !doc?.close_pending &&
    // 0845: By Vendor sends nothing; a Net Rate with the MD (or refused) waits.
    !(doc?.is_by_vendor ?? false) && doc?.rate_approval !== "pending" && doc?.rate_approval !== "rejected";
  /**
   * CANCEL (Session 4, 0844) — also with yarn out: the SQL undoes each sent DC, yarn back to its
   * bin. Not once anything has come back (a receipt), and not past a moved-at-knitter DC, which
   * cannot be undone — both are refused by `knitting_order_cancel` too; hiding is the courtesy.
   */
  const cancellable =
    canEdit &&
    !!doc &&
    ["draft", "issued", "in_process", "partially_received"].includes(doc.status) &&
    !doc.close_pending &&
    doc.receipts.length === 0 &&
    !doc.dcs.some((d) => d.status === "issued" && d.moved_from);
  const yarnOutKg = doc ? doc.dcs.filter((d) => d.status === "issued").reduce((t, d) => t + d.kg, 0) : 0;
  /** Send FROM a holding store, never Processing (the knitter's side) or Transit. */
  const sendStores = stores.filter((x) => x.store_type !== "processing" && x.store_type !== "transit");

  /* SEVERAL REs ON ONE ORDER (client 2026-11-12, 0836): the fabrics of every RE picked here are
     offered, each tagged with its RE, and each saved line keeps its own RE. */
  const [reIds, setReIds] = useState<string[]>(() => doc?.res.map((r) => r.id) ?? initialReIds);
  const [vendorId, setVendorId] = useState(doc?.vendor_id ?? "");
  /** The Buyer pill (screen-only, never saved): narrows the Orders pill as on Raise PO. */
  const [pillFilters, setPillFilters] = useState<KoFilters>(NO_KO_FILTERS);
  const [orderDate, setOrderDate] = useState(doc?.order_date ?? today);
  const [expectedDate, setExpectedDate] = useState(doc?.expected_date ?? "");
  const [allowedLoss, setAllowedLoss] = useState(str(doc?.allowed_loss_pct));
  /* SESSION 1 (0845, user 2026-11-14): GST % on the knitting charge (Net Rate is before GST), and
     BY VENDOR — the knitter uses their own yarn, so the order carries no yarn lines and no DC. */
  const [gstPct, setGstPct] = useState(doc ? str(doc.gst_rate_pct) : "5");
  const [byVendor, setByVendor] = useState(doc?.is_by_vendor ?? false);
  const [notes, setNotes] = useState(doc?.notes ?? "");
  const [candidates, setCandidates] = useState<KnitCandidate[]>(initialCandidates);
  const [customerByRe, setCustomerByRe] = useState<Record<string, string | null>>(initialCustomers);
  const customer = [...new Set(reIds.map((id) => customerByRe[id]).filter((x): x is string => !!x))].join(", ") || null;
  const [note, setNote] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<"cancel" | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  /** The sent DC whose yarn is being taken back to its bin (0841), while its confirm is open. */
  const [undoDc, setUndoDc] = useState<{ id: string; code: string | null; kg: number } | null>(null);
  /* SHORT CLOSE (0847): the RE slice whose remaining balance is being closed by hand, and why. */
  const [shortClose, setShortClose] = useState<{ re: string; key: string; fabric: string; fabricId: string; kg: number } | null>(null);
  const [shortReason, setShortReason] = useState("");
  const [dcDate, setDcDate] = useState(today);

  // Row keys from a counter bumped only in handlers, so render stays pure.
  const keySeq = useRef(0);
  /** A blank block belongs to ONE RE — its picker lists only that RE's Fabric BOM (plan step 5). */
  const blankRow = (re = ""): FabricRow => ({ ...blankRowStatic(), sales_order_id: re, key: `new-${keySeq.current++}` });
  /* LAYOUT D (user 2026-11-11, canvas "Knitting Program Layout"): one BLOCK per fabric — its
     construction on one row, its yarns straight under it. An editable list never opens empty
     (AGENTS.md "Editable sub-tables open with a row"): a new order starts with one block to pick
     into; "Add a fabric" adds the next. A block with nothing picked is never saved. */
  const [rows, setRows] = useState<FabricRow[]>(() => {
    const r0 = doc ? rowsFromDoc(doc) : [];
    // Send Qty = the yarn still to go (DC cap − already sent), when opened to send (prefillSend).
    // CAPPED AT WHAT THIS UNIT'S SENDING STORES HOLD (raagam-5c, 2026-11-14): a Send Qty past stock
    // greys Delivery Now, so the prefill sends what is there; one yarn on two fabrics shares its stock.
    const sendIds = new Set(sendStores.map((x) => x.id));
    const stockLeft = new Map<string, number>();
    for (const b of binStock) if (b.qty > 0 && sendIds.has(b.store_id)) stockLeft.set(b.item_id, (stockLeft.get(b.item_id) ?? 0) + b.qty);
    const r = !prefillSend || doc?.is_by_vendor
      ? r0
      : r0.map((f) => ({
          ...f,
          yarns: f.yarns.map((y) => {
            const cap = n(y.cap) ?? yarnRequirement(n(f.programmed) ?? 0, y.blend_pct ?? 0, n(y.allowance) ?? 0, n(y.bag_weight)).cap;
            const left = Math.max(0, Math.round((cap - y.dispatched_kg + y.back_kg) * 1000) / 1000);
            const have = stockLeft.get(y.yarn_item_id) ?? 0;
            const kg = Math.round(Math.min(left, have) * 1000) / 1000;
            if (kg <= 0) return y;
            stockLeft.set(y.yarn_item_id, have - kg);
            return { ...y, send: String(kg) };
          }),
        }));
    if (readOnly) return r;
    // Every RE of a draft opens with a block to pick into, even one that has no fabric yet.
    const empty = (doc?.res ?? []).filter((re) => !r.some((x) => x.sales_order_id === re.id));
    const seeded = [...r, ...empty.map((re) => ({ ...blankRowStatic(), sales_order_id: re.id, key: `new-first-${re.id}` }))];
    if (seeded.length) return seeded;
    // A new order opened for an RE (To Program): its first block belongs to that RE.
    return initialReIds.length
      ? initialReIds.map((re) => ({ ...blankRowStatic(), sales_order_id: re, key: `new-first-${re}` }))
      : [{ ...blankRowStatic(), key: "new-first" }];
  });

  // By Vendor: the rows keep their yarns (so switching back restores them) but nothing reads them.
  const typed = rows.filter((r) => !isBlank(r)).map((r) => (byVendor ? { ...r, yarns: [] } : r));
  const current = JSON.stringify([reIds, vendorId, orderDate, expectedDate, allowedLoss, gstPct, byVendor, notes.trim().toUpperCase(), typed.map((r) => ({ ...r, key: undefined, picking: undefined, yarns: r.yarns.map((y) => ({ ...y, allowance_typed: undefined, store_id: undefined, bin_id: undefined, send: undefined })) }))]);
  const [baseline, setBaseline] = useState(current);
  const dirty = !readOnly && current !== baseline;
  const sendTyped = rows.some((r) => r.yarns.some((y) => y.send.trim() !== ""));
  useUnsavedGuard(dirty || sendTyped || isPending);

  const candByKey = useMemo(() => new Map(candidates.map((c) => [pickKey(c.sales_order_id, c.key), c])), [candidates]);

  /** By Vendor off again: a row that never had yarns (saved as By Vendor) takes its BOM blend back. */
  function changeByVendor(next: boolean) {
    setByVendor(next);
    if (next) return;
    setRows((rs) =>
      rs.map((r) => {
        if (r.yarns.length || !r.source_key) return r;
        const c = candByKey.get(r.source_key);
        if (!c) return r;
        return {
          ...r,
          yarns: c.yarns.map((y, i) => ({
            key: `${r.key}-y${i}`,
            yarn_item_id: y.yarn_item_id,
            yarn_name: y.yarn_name,
            blend_pct: y.blend_pct,
            allowance: allowedLoss,
            allowance_typed: false,
            bag_weight: bagWtOf(y.yarn_item_id),
            cap: "",
            cap_saved: "",
            dispatched_kg: 0,
            back_kg: 0,
            store_id: "",
            bin_id: "",
            send: "",
          })),
        };
      }),
    );
  }

  function setRow(key: string, patch: Partial<FabricRow>) {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }
  function setYarn(rowKey: string, yarnKey: string, patch: Partial<YarnRow>) {
    setRows((rs) =>
      rs.map((r) => (r.key === rowKey ? { ...r, yarns: r.yarns.map((y) => (y.key === yarnKey ? { ...y, ...patch } : y)) } : r)),
    );
  }

  /** ALLOWED LOSS % FLOWS DOWN (plan step 1): every row that was not typed over follows it. */
  function changeAllowedLoss(v: string) {
    setAllowedLoss(v);
    setRows((rs) => rs.map((r) => ({ ...r, yarns: r.yarns.map((y) => (y.allowance_typed ? y : { ...y, allowance: v })) })));
  }
  /** A row's own Allow %; typing the header's value back makes it follow the header again. */
  function setAllowance(rowKey: string, yarnKey: string, v: string) {
    setYarn(rowKey, yarnKey, { allowance: v, allowance_typed: v.trim() !== allowedLoss.trim() });
  }

  /* ONE BAG WEIGHT PER YARN (plan step 3, 2026-11-12): a bag of a yarn weighs the same whichever
     fabric it is knitted into, so it is typed once, on the rail, and written into every row of that
     yarn. The database still stores it per row (knitting_order_save is unchanged). */
  /** The yarn's bag weight on this order — "" when no row has one, or when saved rows disagree. */
  function bagWtOf(yarnId: string): string {
    const seen = new Set(rows.flatMap((r) => r.yarns.filter((y) => y.yarn_item_id === yarnId && y.bag_weight.trim()).map((y) => y.bag_weight.trim())));
    return seen.size === 1 ? [...seen][0] : "";
  }
  const bagWtMixed = (yarnId: string) =>
    new Set(rows.flatMap((r) => r.yarns.filter((y) => y.yarn_item_id === yarnId && y.bag_weight.trim()).map((y) => y.bag_weight.trim()))).size > 1;
  function setBagWt(yarnId: string, v: string) {
    setRows((rs) => rs.map((r) => ({ ...r, yarns: r.yarns.map((y) => (y.yarn_item_id === yarnId ? { ...y, bag_weight: v } : y)) })));
  }

  /* THE RE RAIL (plan 2026-11-12, artifact 35SpewQ1): one RE on screen at a time, its yarn list
     open on the rail and every other RE folded to one line. A single key, never a set — "two open"
     cannot be written (AGENTS.md "Folds are accordions"). It is never null: one RE is always shown. */
  const [openRe, setOpenRe] = useState<string>(() => doc?.res[0]?.id ?? "");

  /** Every picked RE gets a blank block to pick into (an editable list never opens empty). */
  function seedBlocks(rs: FabricRow[], res: string[]): FabricRow[] {
    // The no-RE starter block goes once an RE exists to hang a block on.
    const kept = res.length ? rs.filter((r) => !(isBlank(r) && !r.sales_order_id)) : rs;
    const missing = res.filter((re) => !kept.some((r) => r.sales_order_id === re));
    const out = [...kept, ...missing.map((re) => blankRow(re))];
    return out.length ? out : [blankRow()];
  }

  function pickOrders(next: string[]) {
    const added = next.filter((id) => !reIds.includes(id));
    const removed = new Set(reIds.filter((id) => !next.includes(id)));
    setReIds(next);
    // A removed RE takes its fabrics with it; the other REs' fabrics stay.
    setRows((rs) => seedBlocks(removed.size ? rs.filter((r) => !removed.has(r.sales_order_id)) : rs, next));
    if (removed.size) setCandidates((cs) => cs.filter((c) => !removed.has(c.sales_order_id)));
    // Show the RE just picked; if the one on screen was removed, the first left.
    if (added.length) setOpenRe(added[0]);
    else if (!next.includes(openRe)) setOpenRe(next[0] ?? "");
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
    // PARTIAL ALLOCATION (0847): the balance is net of PLACED orders only (spec "Available Balance").
    const balance = Math.max(0, Math.round((c.bom_kg - c.placed_kg) * 1000) / 1000);
    setRow(rowKey, {
      picking: false,
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
      budget_rate: c.budget_rate,
      yarns: c.yarns.map((y, i) => ({
        key: `${rowKey}-y${i}`,
        yarn_item_id: y.yarn_item_id,
        yarn_name: y.yarn_name,
        blend_pct: y.blend_pct,
        allowance: allowedLoss,
        allowance_typed: false,
        // ONE BAG WEIGHT PER YARN (plan step 3): a yarn already on the order brings its bag weight.
        bag_weight: bagWtOf(y.yarn_item_id),
        cap: "",
        cap_saved: "",
        dispatched_kg: 0,
        back_kg: 0,
        store_id: "",
        bin_id: "",
        send: "",
      })),
    });
  }

  // ---------- what the screen can answer before Save ----------
  const blendOf = (r: FabricRow) => r.yarns.reduce((t, y) => t + (y.blend_pct ?? 0), 0);
  const blendBad = (r: FabricRow) => !byVendor && (r.yarns.length === 0 || r.yarns.some((y) => y.blend_pct == null) || Math.abs(blendOf(r) - 100) > 0.01);
  const progBad = (r: FabricRow) => !((n(r.programmed) ?? 0) > 0);
  /** PARTIAL ALLOCATION (0847): the RE slice behind a row, and what is still free on it. */
  const sliceOfRow = (r: FabricRow) => (r.source_key ? candByKey.get(r.source_key) : undefined);
  const balanceOf = (r: FabricRow): number | null => {
    const c = sliceOfRow(r);
    return c ? Math.max(0, Math.round((c.bom_kg - c.placed_kg) * 1000) / 1000) : null;
  };
  const overBalance = (r: FabricRow) => {
    const b = balanceOf(r);
    return !readOnly && b != null && (n(r.programmed) ?? 0) > b + 0.0005;
  };
  /** 0845 — the MD must approve: above the RE's budget Knitting rate, or no budget rate at all. */
  const overBudget = (r: FabricRow) => !!r.source_key && (r.budget_rate == null || (n(r.rate) ?? 0) > r.budget_rate + 1e-9);
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
  /** All of this yarn this unit's bins hold — the bins themselves are picked at send (below). */
  const inStock = (y: YarnRow) => placesOf(y).reduce((t, p) => t + p.qty, 0);
  // Net of yarn that came back (returned / moved on) — it is owed again while the order is open.
  const leftToSend = (f: FabricRow, y: YarnRow) => Math.max(0, Math.round((yarnCalc(f, y).cap - y.dispatched_kg + y.back_kg) * 1000) / 1000);
  /** The same yarn has a Send Qty on more than one fabric row — they share one stock. */
  const askedTwice = (y: YarnRow) =>
    typed.reduce((t, r) => t + r.yarns.filter((x) => x.yarn_item_id === y.yarn_item_id && (n(x.send) ?? 0) > 0).length, 0) > 1;
  /* THE BIN PICKS ITSELF (Session 2, 2026-11-14: "remove the Source Bin column from the DC
     dispatch grid"). Every Send Qty draws from one pool per yarn — this unit's bins, OLDEST lot
     first (first_in, then the fuller bin) — filled in row order, so two fabrics sending the same
     yarn never both count the same kilos. A row bigger than one bin is split into a DC line per
     bin; the print folds them back into one line per yarn. Nothing to pick, nothing to get wrong. */
  type Piece = { store_id: string; bin_id: string | null; kg: number };
  const piecesOf = new Map<string, Piece[]>();
  const shortOf = new Map<string, number>();
  {
    const pool = new Map<string, { store_id: string; bin_id: string | null; left: number; first_in: string | null }[]>();
    const poolOf = (item: string) => {
      let p = pool.get(item);
      if (!p) {
        p = binStock
          .filter((b) => b.item_id === item && b.qty > 0 && storeName.has(b.store_id))
          .map((b) => ({ store_id: b.store_id, bin_id: b.bin_id, left: b.qty, first_in: b.first_in ?? null }))
          .sort((a, b) => (a.first_in ?? "9999") < (b.first_in ?? "9999") ? -1 : (a.first_in ?? "9999") > (b.first_in ?? "9999") ? 1 : b.left - a.left);
        pool.set(item, p);
      }
      return p;
    };
    for (const r of typed) {
      for (const y of r.yarns) {
        let want = n(y.send) ?? 0;
        if (want <= 0) continue;
        const out: Piece[] = [];
        for (const b of poolOf(y.yarn_item_id)) {
          if (want <= 1e-9) break;
          const take = Math.min(b.left, want);
          if (take <= 1e-9) continue;
          out.push({ store_id: b.store_id, bin_id: b.bin_id, kg: Math.round(take * 1000) / 1000 });
          b.left -= take;
          want -= take;
        }
        piecesOf.set(y.key, out);
        if (want > 1e-6) shortOf.set(y.key, Math.round(want * 1000) / 1000);
      }
    }
  }
  const sendProblem = (f: FabricRow, y: YarnRow): string | null => {
    const q = n(y.send) ?? 0;
    if (q <= 0) return null;
    if (q > leftToSend(f, y) + 1e-9) return `Only ${fmtNumber(leftToSend(f, y))} left to send`;
    if (!placesOf(y).length) return "None in stock";
    const short = shortOf.get(y.key);
    if (short) {
      return `${fmtNumber(short)} kg more than this unit's bins hold for this yarn${askedTwice(y) ? " after the other fabrics' Send Qty" : ""} (${fmtNumber(inStock(y))} kg)`;
    }
    return null;
  };
  const sends: KnitSendLine[] = typed.flatMap((f, fi) =>
    f.yarns.flatMap((y, yi) => {
      const wt = n(y.bag_weight);
      return (piecesOf.get(y.key) ?? []).map((p) => ({
        fabric_index: fi,
        yarn_index: yi,
        store_id: p.store_id,
        bin_id: p.bin_id,
        kg: p.kg,
        bags: wt && wt > 0 ? Math.round(p.kg / wt) : null,
        bag_weight_kg: wt && wt > 0 ? wt : null,
      }));
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
        gst_rate_pct: n(gstPct),
        is_by_vendor: byVendor,
        fabrics: typed.map((r) => ({
          sales_order_id: r.sales_order_id || reIds[0] || null,
          id: UUID_RE.test(r.key) ? r.key : null,
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
            id: UUID_RE.test(y.key) ? y.key : null,
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
      if (!res.ok) {
        toastError(res.error);
        if (!doc) router.replace(`${BASE}/${id}`);
        return;
      }
      /* NET RATE ABOVE BUDGET (0845): not issued — sent to the MD in My Approvals. Nothing is
         sent until the MD approves; Issue again afterwards. */
      if (res.sentToMd) {
        success("A Net Rate is above the approved budget — sent to the MD for approval. Issue again once approved.");
        if (!doc) router.replace(`${BASE}/${id}`);
        else router.refresh();
        return;
      }
      if (sends.length) await runDispatch(id);
      else success(byVendor ? "Issued — the knitter uses their own yarn; receive the fabric when it comes" : "Issued — send its yarn from the same screen when it is ready");
      if (!doc) router.replace(`${BASE}/${id}`);
      else router.refresh();
    });
  }

  /** An issued order: send the next lot of yarn (partial dispatch). */
  function sendOnly() {
    if (!doc) return;
    start(async () => {
      // An issued order is editable now (0849): unsaved changes are saved before the DC goes out.
      if (dirty) {
        if (!canSave) return toastError("Fix the program first");
        const saved = await saveKnittingOrder(doc.id, payload());
        if (!saved.ok) return toastError(saved.error);
        setBaseline(current);
      }
      const ok = await runDispatch(doc.id);
      if (ok) router.refresh();
    });
  }

  function cancelDoc() {
    if (!doc) return;
    start(async () => {
      const res = await cancelKnittingOrder(doc.id, cancelReason);
      if (!res.ok) return toastError(res.error);
      setConfirm(null);
      setCancelReason("");
      success(yarnOutKg > 0 ? `Knitting order cancelled — ${fmtNumber(yarnOutKg)} kg of yarn is back in its bins` : "Knitting order cancelled");
      router.refresh();
    });
  }

  function undoSentDc() {
    if (!doc || !undoDc) return;
    const dc = undoDc;
    start(async () => {
      const res = await undoKnittingDc(doc.id, dc.id);
      setUndoDc(null);
      if (!res.ok) return toastError(res.error);
      success(`${dc.code ?? "DC"} undone — the yarn is back in its bin`);
      router.refresh();
    });
  }

  /** Close the rest of an RE slice by hand (0847) — it then reads Fully Placed everywhere. */
  function runShortClose() {
    if (!shortClose || !shortReason.trim()) return;
    const sc = shortClose;
    start(async () => {
      const res = await shortCloseKnitBalance({ salesOrderId: sc.re, sliceKey: sc.key, fabricItemId: sc.fabricId, kg: sc.kg, reason: shortReason, orderId: doc?.id ?? null });
      if (!res.ok) return toastError(res.error);
      setShortClose(null);
      setShortReason("");
      setCandidates((cs) => cs.map((c) => (c.sales_order_id === sc.re && c.key === sc.key ? { ...c, short_closed: { kg: sc.kg, reason: shortReason.trim() } } : c)));
      success(`${fmtNumber(sc.kg)} kg of ${sc.fabric} short-closed — the line now reads Fully Placed`);
      router.refresh();
    });
  }
  function runReopen(re: string, key: string) {
    start(async () => {
      const res = await reopenKnitBalance({ salesOrderId: re, sliceKey: key, orderId: doc?.id ?? null });
      if (!res.ok) return toastError(res.error);
      setCandidates((cs) => cs.map((c) => (c.sales_order_id === re && c.key === key ? { ...c, short_closed: null } : c)));
      success("Balance reopened — it can be programmed again");
      router.refresh();
    });
  }

  /* THE RAISE PO PILLS (user 2026-11-13, screenshot 4143: "here we need to give that purchase
     order filter type"): Buyer → Orders → Knitter, the same `FilterPill` row and colours as
     Raise PO's header. No Order Type pill — a Knitting Order only ever takes REs, so it would
     offer one choice. Buyer is a filter only; Orders IS the KO's RE list and Knitter its vendor. */
  /* A choice's count is the REs it would leave with every OTHER pill applied, and a TICKED RE is
     never filtered out — Raise PO's two rules (lib/purchase/re-po/filters.ts). */
  const passes = (o: KnitOrderOption, skip: KoFilterKey | null) =>
    (Object.keys(pillFilters) as KoFilterKey[]).every(
      (k) => k === skip || !pillFilters[k].length || pillFilters[k].some((v) => koFacet(o, k, today).includes(v)),
    );
  const countOf = (k: KoFilterKey, v: string) => orders.filter((o) => passes(o, k) && koFacet(o, k, today).includes(v)).length;
  const anyOf = (k: KoFilterKey) => orders.filter((o) => passes(o, k)).length;
  const setPill = (k: KoFilterKey) => (v: string[]) => setPillFilters((f) => ({ ...f, [k]: v }));
  const buyerOptions: FilterPillOption[] = [
    ...new Map(orders.map((o) => [o.buyer_id ?? NO_BUYER, o.buyer_name ?? "No buyer"])).entries(),
  ]
    .map(([value, label]) => ({ value, label, count: countOf("buyer", value) }))
    .sort((a, b) => (a.value === NO_BUYER ? 1 : b.value === NO_BUYER ? -1 : a.label.localeCompare(b.label)));
  const categoryOptions: FilterPillOption[] = categories.map((c) => ({ value: c.id, label: c.name, count: countOf("category", c.id) }));
  const shipOptions: FilterPillOption[] = ORDER_BY_BANDS.map((b) => ({
    value: b.value,
    label: b.label,
    count: countOf("ship", b.value),
    tone: b.value === "late" ? ("danger" as const) : undefined,
  }));
  const bomOptions: FilterPillOption[] = [
    { value: "ready", label: "Fabric BOM ready", count: countOf("bom", "ready") },
    { value: "none", label: "No Fabric BOM", count: countOf("bom", "none") },
  ];
  const progressOptions: FilterPillOption[] = [
    { value: "new", label: "Not programmed yet", count: countOf("progress", "new") },
    { value: "part", label: "Part programmed", count: countOf("progress", "part") },
  ];
  // A ticked RE stays listed whatever the pills say — a filter never takes a line off the KO.
  const orderOptions: FilterPillOption[] = orders
    .filter((o) => passes(o, null) || reIds.includes(o.id))
    .map((o) => ({ value: o.id, label: o.order_number ?? "(no RE No)", sublabel: o.buyer_name ?? undefined }));
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
    /* PARTIAL ALLOCATION (0847, user 2026-11-14, screenshot 4182): greyed only when nothing is
       left — Fully Placed, or Short-closed by hand. A partly placed slice stays pickable. */
    label: c.short_closed
      ? `${c.fabric_name} (Short-closed)`
      : c.bom_kg - c.placed_kg <= 0.0005 && c.placed_kg > 0
        ? `${c.fabric_name} (Fully Placed — ${c.placed_on ?? "other KOs"})`
        : c.placed_kg > 0
          ? `${c.fabric_name} (Partly Placed — ${c.placed_on ?? "other KOs"})`
          : c.fabric_name,
    disabled: c.short_closed || (c.bom_kg - c.placed_kg <= 0.0005 && c.placed_kg > 0) ? true : undefined,
    sublabel: [
      // Which RE the fabric is on, once the order holds more than one (0836).
      reIds.length > 1 && c.re_no ? `RE ${c.re_no}` : null,
      c.finish_dia ? `FIN DIA ${c.finish_dia}` : "No dia",
      c.width_form ? WIDTH_FORM_LABELS[c.width_form] : null,
      `BOM ${fmtNumber(c.bom_kg)} kg`,
      c.placed_kg ? `placed ${fmtNumber(c.placed_kg)} kg · balance ${fmtNumber(Math.max(0, c.bom_kg - c.placed_kg))} kg` : null,
    ]
      .filter(Boolean)
      .join(" · "),
  }));

  /** Picked by another block — greyed in this block's list (AGENTS.md "Pick once"). */
  /* A block lists ITS RE's fabrics only (plan step 5): each RE has its own pane and its own "+ Add". */
  const optionsFor = (r: FabricRow): ComboboxOption[] =>
    candidateOptions
      .filter((o) => !r.sales_order_id || candByKey.get(o.value)?.sales_order_id === r.sales_order_id)
      // The header's Category pill narrows the fabric list too (spec Session 1, 0845).
      .filter((o) => !pillFilters.category.length || pillFilters.category.includes(candByKey.get(o.value)?.category_id ?? ""))
      .map((o) =>
      o.value === r.source_key
        ? { ...o, disabled: undefined }
        : rows.some((x) => x.key !== r.key && x.source_key === o.value)
          ? { ...o, disabled: true, label: `${o.label} (already added)` }
          : o,
    );

  function addFabric(re: string) {
    setRows((rs) => [...rs, blankRow(re)]);
  }
  function removeFabric(key: string) {
    // The RE keeps a block to pick into when its last fabric goes (seedBlocks).
    setRows((rs) => seedBlocks(rs.filter((x) => x.key !== key), reIds));
  }

  const reLabel = (re: string) => orders.find((o) => o.id === re)?.order_number ?? rows.find((r) => r.sales_order_id === re)?.re_no ?? "RE";

  /** One word on the block's title line: what still needs doing, or that it is ready. */
  const blockState = (r: FabricRow): { tone: "ok" | "warn" | "bad"; text: string } | null => {
    if (!r.source_key) return null;
    // By Vendor (0845) carries no yarns by design — not a missing composition.
    if (!byVendor && r.yarns.length === 0) return { tone: "bad", text: "No composition on the fabric master" };
    if (blendBad(r)) return { tone: "bad", text: `Blend ${fmtNumber(blendOf(r))}% — must be 100%` };
    if (knitDiaBad(r)) return { tone: "bad", text: `Knit Dia to fill${r.finished_dia ? ` for Fin Dia ${r.finished_dia}` : ""}` };
    if (progBad(r)) return { tone: "bad", text: "Program Kg to fill" };
    if (overBalance(r)) return { tone: "bad", text: `Program Qty is more than the balance ${fmtNumber(balanceOf(r) ?? 0)} kg` };
    if (!r.gauge_id || !r.loop_length.trim()) return { tone: "warn", text: "Gauge / loop to fill" };
    return { tone: "ok", text: "Ready" };
  };
  const TONE = { ok: "text-success", warn: "text-warning", bad: "text-danger" } as const;

  /* ---------- the RE rail (plan 2026-11-12) ---------- */
  /** Every picked RE, then any RE a saved line still names that is no longer picked. */
  const reList = [...reIds, ...new Set(rows.map((r) => r.sales_order_id).filter((re) => !!re && !reIds.includes(re)))];
  const shownRe = reList.includes(openRe) ? openRe : (reList[0] ?? "");
  const shownFabrics = typed.filter((x) => x.sales_order_id === shownRe);
  /** The RE rail (RE No + customer) shows once a fabric is picked or a second RE needs switching to. */
  // ALWAYS SHOWN, COMPACT (user 2026-11-14, screenshot 4186: "section is gone, I told to compact it").
  const showRail = true;
  /** A fabric's number within its RE, as the pane shows it. */
  const fabricNo = (f: FabricRow) => rows.filter((r) => r.sales_order_id === f.sales_order_id).findIndex((r) => r.key === f.key) + 1;

  /* WHY ISSUE IS GREYED (plan step 4), said beside the button in the footer. Blocking items only —
     the rail's "Before you issue" list (with warnings) was removed on request (user 2026-11-12). */
  const blocking: string[] = [];
  if (!readOnly) {
    if (!reIds.length) blocking.push("Pick the RE No");
    if (!vendorId) blocking.push("Pick the Knitter");
    if (reIds.length && !typed.length) blocking.push("Pick a fabric from the BOM");
    for (const r of typed) {
      const st = blockState(r);
      if (st?.tone === "bad") blocking.push(`${reLabel(r.sales_order_id)} · fabric ${fabricNo(r)}: ${st.text}`);
    }
    if (sendBad) blocking.push("A Send Qty needs fixing (see the red rows)");
  }
  const TH = "whitespace-nowrap border border-[var(--table-head-border)] bg-[var(--table-head-bg)] px-2 py-1.5 text-left text-[11px] font-semibold text-[var(--table-head-fg)]";
  const THR = `${TH} text-right`;
  /** The store keeper's three columns — a green band, so the sending part reads apart from the plan. */
  const SEND_TH = "!bg-success/10 !text-success !border-success/30";
  const SEND_TD = "bg-success/5";
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
           * KO No 144 · KO Date 144 · Delivery 144 · Allowed Loss 112 on the field row; RE No and
           * Knitter moved to the pill row under it (Buyer → Orders → Knitter, Raise PO's filters,
           * user 2026-11-13). Read-only, the two come back as plain boxes in this row. KO No at 112
           * cut "KO/26-27/0001" off and "Allowed Loss %" at 88 wrapped (screenshot 4115), hence the
           * one-step-wider boxes. align="start" keeps them level while a hint shows.
           */}
          <FieldRow align="start">
            <Field label="KO No" w="code">
              <Input readOnly value={doc?.code ?? nextCode ?? "(auto)"} title={doc ? undefined : "Given on Save"} />
            </Field>
            <Field label="KO Date" required w="code">
              <Input type="date" value={orderDate} readOnly={readOnly} onChange={(e) => setOrderDate(e.target.value)} required />
            </Field>
            {/* GST beside the KO Date (spec Session 1): on the knitting charge; Net Rate is before it. */}
            <Field label="GST %" w="range">
              <Input type="number" min="0" max="28" step="any" value={gstPct} readOnly={readOnly} onChange={(e) => setGstPct(e.target.value)} />
            </Field>
            {readOnly ? (
              <>
                <Field label="RE No" required w="party" hint={customer ? <Truncated text={customer} /> : undefined}>
                  <Input readOnly value={doc?.order_number ?? "—"} />
                </Field>
                <Field label="Knitter" required w="party">
                  <Input readOnly value={doc?.vendor_name ?? "—"} />
                </Field>
              </>
            ) : null}
            <Field label="Delivery Date" w="code">
              <Input type="date" value={expectedDate} readOnly={readOnly} onChange={(e) => setExpectedDate(e.target.value)} />
            </Field>
            <Field label="Allowed Loss %" w="range" hint={readOnly ? undefined : "Fills every yarn row"}>
              <Input type="number" min="0" max="99" step="any" value={allowedLoss} readOnly={readOnly} onChange={(e) => changeAllowedLoss(e.target.value)} />
            </Field>
            {/* BY VENDOR (0845, user 2026-11-14): Yes = the knitter uses their own yarn — no yarn
                lines, no Job Work DC, no stock check; the knitter bills fabric kg x Net Rate. */}
            <Field label="By Vendor" w="code" hint={byVendor ? "Knitter's own yarn" : undefined}>
              <Segmented
                name="ko-by-vendor"
                value={byVendor ? "yes" : "no"}
                disabled={readOnly}
                onChange={(v) => changeByVendor(v === "yes")}
                options={[
                  { value: "no", label: "No" },
                  { value: "yes", label: "Yes" },
                ]}
              />
            </Field>
          </FieldRow>

          {/* THE MD'S WORD ON THE NET RATE (0845) — said once, above the fabrics it is about. */}
          {doc?.rate_approval === "pending" ? (
            <p className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning">
              A Net Rate is above the approved budget (or the RE has no approved budget) — waiting for the MD in My Approvals. Nothing can be issued or sent until then.
            </p>
          ) : doc?.rate_approval === "rejected" ? (
            <p className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
              The MD did not approve the Net Rate{doc.rate_approval_note ? `: ${doc.rate_approval_note}` : ""}. Change the rate and save, then Issue again.
            </p>
          ) : doc?.rate_approval === "approved" && doc.status === "draft" ? (
            <p className="rounded-lg border border-success/40 bg-success/10 px-3 py-2 text-sm text-success">
              The MD approved the Net Rate — it can be issued now.
            </p>
          ) : null}

          {/* THE PILL ROW — Raise PO's header filters (screenshot 2026-11-13 142940). Orders and
              Knitter are required pills: amber until chosen, and they hold the cursor like any
              mandatory field. The customer rides under the row once an RE is ticked. */}
          {readOnly ? null : (
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-x-1 gap-y-2 rounded-xl border border-[#dde4eb] bg-[#fafbfc] px-3 py-2.5">
                <FilterPill
                  id="ko-buyer"
                  label="Buyer"
                  family="order"
                  icon={User}
                  wide
                  multiple
                  options={buyerOptions}
                  anyCount={anyOf("buyer")}
                  value={pillFilters.buyer}
                  emptyText="No open order"
                  onChange={setPill("buyer")}
                />
                <FilterPill
                  id="ko-re"
                  label="Orders"
                  family="order"
                  icon={FileText}
                  required
                  wide
                  multiple
                  placeholder="Choose the RE No"
                  options={orderOptions}
                  value={reIds}
                  emptyText="No open order is left by the pills before it"
                  onChange={pickOrders}
                />
                <FilterPill
                  label="Category"
                  family="item"
                  icon={Tag}
                  multiple
                  disabled={categoryOptions.length === 0}
                  options={categoryOptions}
                  anyCount={anyOf("category")}
                  value={pillFilters.category}
                  emptyText="No Fabric BOM lists a category yet"
                  onChange={setPill("category")}
                />
                <span aria-hidden className="mx-0.5 hidden h-5 w-px shrink-0 bg-[#dde4eb] sm:block" />
                <FilterPill
                  id="ko-knitter"
                  label="Knitter"
                  family="vendor"
                  icon={Store}
                  required
                  wide
                  placeholder="Choose the knitter"
                  options={knitterOptions}
                  value={vendorId}
                  emptyText="No vendor is registered as a knitter"
                  onChange={setVendorId}
                />
                <span aria-hidden className="mx-0.5 hidden h-5 w-px shrink-0 bg-[#dde4eb] sm:block" />
                {/* The three status pills show their icon alone until used, as on Raise PO. */}
                <FilterPill
                  label="Ship date"
                  family="status"
                  icon={Clock}
                  collapse
                  wide
                  multiple
                  options={shipOptions}
                  anyCount={anyOf("ship")}
                  note="Days from today to the RE's ship date"
                  tone={pillFilters.ship.includes("late") ? "danger" : undefined}
                  value={pillFilters.ship}
                  onChange={setPill("ship")}
                />
                <FilterPill
                  label="Fabric BOM"
                  family="status"
                  icon={ClipboardList}
                  collapse
                  wide
                  multiple
                  options={bomOptions}
                  anyCount={anyOf("bom")}
                  note="An RE with no approved Fabric BOM has nothing to knit"
                  value={pillFilters.bom}
                  onChange={setPill("bom")}
                />
                <FilterPill
                  label="Progress"
                  family="status"
                  icon={TrendingUp}
                  collapse
                  wide
                  multiple
                  options={progressOptions}
                  anyCount={anyOf("progress")}
                  note="Part programmed = already on another Knitting Order"
                  value={pillFilters.progress}
                  onChange={setPill("progress")}
                />
              </div>
              {customer ? <p className="px-1 text-xs text-muted-foreground">Customer: {customer}</p> : null}
            </div>
          )}

          {!readOnly && knitters.length === 0 ? (
            <p className="text-sm text-danger">
              No vendor is registered as a knitter. Add the KNITTING process to the knitter&apos;s Vendor master, then reopen this screen.
            </p>
          ) : null}
          {note ? <p className="text-sm text-muted-foreground">{note}</p> : null}

          {/*
           * THE RE RAIL (plan 2026-11-12, artifact 35SpewQ1FcTVtqxPceJGDW; user: "order as side rail like
           * material plan", "yarn issue section in the same rail under the RE No, compact, better colour
           * difference", "auto collapse … directly open, in all time"). Left: every RE of the order, and
           * under the RE on screen its yarn to issue (kg · bags × bag weight · stock); every other RE folds
           * to one line. Right: that RE's fabric blocks only. One RE open at a time, always — a single key.
           * The order total sits at the rail's foot; the "Before you issue" list under it says what greys
           * Issue. This replaces the right-hand yarn rail and the totals line above the blocks.
           */}
          {/* THE RAIL STAYS, COMPACT (user 2026-11-14, screenshot 4186). It once stood down until a fabric
              was picked (screenshot 4182: "0 fabric … wording no read") — that wording is gone now that the
              rail holds only RE No + customer, so it shows always and the narrow width answers "use that gap". */}
          {/* COMPACT RAIL (user 2026-11-14): RE No + customer only, so 18.75rem → 10.5rem ("HO/RE/26-27/0013"
              in mono xs is ~8.5rem; the customer truncates with a reveal). The ~8rem saved goes to the
              fabric table on the right. */}
          <div className={`grid items-start gap-3 ${showRail ? "lg:grid-cols-[10.5rem_minmax(0,1fr)]" : ""}`}>
            {showRail ? (
            <nav aria-label="REs on this knitting order" className="overflow-hidden rounded-lg border border-border lg:sticky lg:top-4">
              {/* RE NO + CUSTOMER ONLY (user 2026-11-14, screenshot 151619: "hold RE number and customer,
                  remove all from this section"). The yarn-to-issue list, the per-RE yarn line, the red
                  count and the order total are gone; Bag Wt is now typed in each fabric's Bags cell, and
                  the footer's "To issue:" line still says what greys Issue. */}
              <div className="bg-[var(--table-head-bg)] px-2 py-1 text-[10.5px] font-bold uppercase tracking-wide text-[var(--table-head-fg)]">
                RE
              </div>
              {reList.length === 0 ? <p className="border-t border-border px-3 py-3 text-sm text-muted-foreground">Pick the RE No.</p> : null}
              {reList.map((re) => {
                const on = re === shownRe;
                return (
                  <button
                    key={re}
                    type="button"
                    tabIndex={-1}
                    aria-current={on ? "true" : undefined}
                    onClick={() => setOpenRe(re)}
                    className={`block w-full border-l-[3px] border-t border-t-border px-2 py-1.5 text-left ${on ? "border-l-primary bg-primary/10" : "border-l-transparent bg-muted/50 hover:bg-muted"}`}
                  >
                    <span className={`block font-mono text-xs font-bold ${on ? "text-primary" : "text-foreground"}`}>{reLabel(re)}</span>
                    {customerByRe[re] ? <Truncated className="block text-[11.5px] text-muted-foreground" text={customerByRe[re] ?? ""} /> : null}
                  </button>
                );
              })}
            </nav>
            ) : null}

            <div className="min-w-0 space-y-3">
              {shownRe ? (
                <div className="flex flex-wrap items-baseline gap-x-3 border-b-2 border-primary/60 pb-1">
                  <span className="font-mono text-sm font-bold text-primary">{reLabel(shownRe)}</span>
                  <span className="text-xs text-muted-foreground">
                    {[
                      customerByRe[shownRe],
                      shownFabrics.length ? `${shownFabrics.length} fabric${shownFabrics.length === 1 ? "" : "s"}` : null,
                      shownFabrics.length ? `${fmtNumber(shownFabrics.reduce((t, x) => t + (n(x.programmed) ?? 0), 0))} kg` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </div>
              ) : null}
                {(shownRe ? rows.filter((r) => r.sales_order_id === shownRe) : rows).map((f) => {
                  const i = fabricNo(f) - 1;
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
                    <section className="overflow-hidden rounded-lg border border-[var(--table-head-border)]" aria-label={`Fabric ${i + 1}`}>
                      {/* TITLE LINE: number, the fabric (or its picker), its blend, what is left to do */}
                      <div className={`flex ${picked && !f.picking ? "flex-nowrap" : "flex-wrap"} items-center gap-x-3 gap-y-1 border-b border-[var(--table-head-border)] bg-[var(--table-head-bg)]/40 px-3 py-2`}>
                        <span className="text-sm font-bold">{i + 1}</span>
                        {/* A PICKED FABRIC READS AS ITS NAME (plan step 6), with "change" to pick again —
                            the picker box stayed open after the pick and cut the name off (4130). */}
                        {picked && (readOnly || f.source_key.startsWith("saved:") || !f.picking) ? (
                          <>
                            {/* Truncates (with a reveal) so a long name never pushes the ✕ to a second line. */}
                            <Truncated className="block min-w-0 max-w-[60%] text-sm font-semibold" text={f.fabric_name} />
                            {!readOnly && !f.source_key.startsWith("saved:") ? (
                              <button type="button" tabIndex={-1} className="text-xs text-primary underline underline-offset-2" onClick={() => setRow(f.key, { picking: true })}>
                                change
                              </button>
                            ) : null}
                          </>
                        ) : (
                          <div id={`ko-fab-${f.key}`} className="min-w-[20rem] max-w-[44rem] flex-[4_1_20rem]">
                            <Combobox
                              options={
                                f.source_key && !candByKey.has(f.source_key)
                                  ? [{ value: f.source_key, label: f.fabric_name || "No longer on the BOM", disabled: true }, ...optionsFor(f)]
                                  : optionsFor(f)
                              }
                              value={f.source_key}
                              onChange={(v) => pickFabric(f.key, v)}
                              placeholder={reIds.length ? (isLoading ? "Loading…" : optionsFor(f).length ? "Pick a fabric from the BOM" : "Nothing to knit on this RE") : "Pick the RE No first"}
                              disabled={!reIds.length}
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
                        {!readOnly && (rows.filter((x) => x.sales_order_id === f.sales_order_id).length > 1 || picked) ? (
                          <Button type="button" variant="ghost" size="icon" aria-label={`Remove ${f.fabric_name || "this fabric"}`} data-row-remove="" onClick={() => removeFabric(f.key)}>
                            <X className="size-4" aria-hidden />
                          </Button>
                        ) : null}
                      </div>

                      {/* PARTIAL ALLOCATION (0847, spec): Total RE Qty · Already Placed · Available Balance,
                          and Short Close for a remainder too small to knit. */}
                      {picked && sliceOfRow(f) ? (() => {
                        const c = sliceOfRow(f)!;
                        const bal = balanceOf(f) ?? 0;
                        const rest = Math.max(0, Math.round((bal - (n(f.programmed) ?? 0)) * 1000) / 1000);
                        return (
                          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-border bg-muted/30 px-3 py-1.5 text-xs">
                            <span>Total RE Qty <b className="tabular-nums">{fmtNumber(c.bom_kg)} kg</b></span>
                            <span>Already Placed <b className="tabular-nums">{fmtNumber(c.placed_kg)} kg</b>{c.placed_on ? <span className="text-muted-foreground"> ({c.placed_on})</span> : null}</span>
                            <span className={overBalance(f) ? "text-danger" : ""}>Available Balance <b className="tabular-nums">{fmtNumber(bal)} kg</b></span>
                            <span className={overBudget(f) ? "text-danger" : ""}>
                              Budget Rate <b className="tabular-nums">{f.budget_rate == null ? "none" : `${fmtMoney(f.budget_rate)}/kg`}</b>
                              {overBudget(f) ? " — goes to the MD" : ""}
                            </span>
                            <span className="flex-1" />
                            {c.short_closed ? (
                              <span className="text-muted-foreground">
                                Short-closed {fmtNumber(c.short_closed.kg)} kg — {c.short_closed.reason}
                                {canEdit ? (
                                  <button type="button" tabIndex={-1} className="ml-2 text-primary underline underline-offset-2" onClick={() => runReopen(c.sales_order_id, c.key)}>
                                    Reopen
                                  </button>
                                ) : null}
                              </span>
                            ) : canEdit && rest > 0.0005 && doc?.status !== "cancelled" ? (
                              <button
                                type="button"
                                tabIndex={-1}
                                className="text-primary underline underline-offset-2"
                                onClick={() => setShortClose({ re: c.sales_order_id, key: c.key, fabric: c.fabric_name, fabricId: c.fabric_item_id, kg: rest })}
                              >
                                Short close the rest ({fmtNumber(rest)} kg)
                              </button>
                            ) : null}
                          </div>
                        );
                      })() : null}

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
                              </colgroup>
                              <thead>
                                <tr>
                                  {/* COLUMN ORDER (client 2026-11-12, doc/process/knitting update.md §2.2):
                                      Finishing Dia · Knitting Dia · Finishing GSM · Knitting GSM · Gauge ·
                                      Loop Length · Ply · Roll Wt · Program Qty · Rate · Value. Loop Ref and
                                      Rolls are gone from entry (their columns stay in the DB).
                                      SESSION 1 (2026-11-14): Value is gone, Rate is the NET RATE (before GST)
                                      with the RE's budget rate under it, and Ply sits against Program Qty. */}
                                  <th className={THW}>Form</th>
                                  <th className={THWR}>Finishing Dia</th>
                                  <th className={THWR}>Knitting Dia *</th>
                                  <th className={THWR}>Finishing GSM</th>
                                  <th className={THWR}>Knitting GSM</th>
                                  <th className={THW}>Gauge</th>
                                  <th className={THWR}>Loop Length</th>
                                  <th className={THWR}>Roll Wt (kg)</th>
                                  <th className={THW}>Ply</th>
                                  <th className={THWR}>Program Qty (kg) *</th>
                                  <th className={THWR}>Net Rate (₹/kg)</th>
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
                                  {/* A required cell LOOKS required while empty (plan step 4): the hold's
                                      1px inset was too faint to read as "fill me" (4130). */}
                                  <td className={`${TD} w-24 ${!readOnly && !f.knit_dia.trim() ? "bg-danger/10" : ""}`}>
                                    {readOnly ? (
                                      <span className={CELLR}>{f.knit_dia || "—"}</span>
                                    ) : (
                                      <Input
                                        id={`ko-kd-${f.key}`}
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
                                      <span className={CELLR}>{f.roll_weight || "—"}</span>
                                    ) : (
                                      <Input type="number" min="0" step="any" aria-label="Roll weight (kg)" className={NUM} value={f.roll_weight} onChange={(e) => setRow(f.key, { roll_weight: e.target.value })} />
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
                                  <td className={`${TD} w-28 ${!readOnly && (progBad(f) || overBalance(f)) ? "bg-danger/10" : ""}`}>
                                    {readOnly ? (
                                      <span className={`${CELLR} font-semibold`}>{fmtNumber(n(f.programmed) ?? 0)}</span>
                                    ) : (
                                      <Input
                                        id={`ko-pq-${f.key}`}
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
                                  {/* NET RATE vs BUDGET (0845): above the RE's approved budget Knitting rate,
                                      or with none to compare, the cell reads red and Issue goes to the MD. The
                                      budget figure sits in the strip above (user 2026-11-14, screenshot 152739:
                                      under the box it wrapped to two lines and doubled the row's height). */}
                                  <td className={`${TD} w-28 ${overBudget(f) ? "bg-danger/10" : ""}`}>
                                    {readOnly ? (
                                      <span className={CELLR}>{f.rate ? fmtMoney(n(f.rate) ?? 0) : "—"}</span>
                                    ) : (
                                      <Input type="number" min="0" step="any" aria-label="Net rate per kg" className={NUM} value={f.rate} onChange={(e) => setRow(f.key, { rate: e.target.value })} />
                                    )}
                                  </td>
                                </tr>
                              </tbody>
                            </table>
                          </div>

                          {/* ITS YARNS, STRAIGHT UNDER IT — blend from the fabric master; kg and bags derived.
                              BY VENDOR (0845): the knitter's own yarn — nothing of ours to list or send. */}
                          {byVendor ? (
                            <p className="border-t border-border px-3 py-2 text-xs text-muted-foreground">
                              By Vendor — the knitter uses their own yarn. No yarn is issued from our store for this fabric.
                            </p>
                          ) : (
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
                                {issued ? <col /> : null}
                                {sendable ? (
                                  <>
                                    <col />
                                    <col />
                                  </>
                                ) : null}
                              </colgroup>
                              <thead>
                                {/* TWO BANDS (plan step 6): what the program needs, then what the store
                                    keeper sends now — one blue heading over all eleven made the store's
                                    three columns impossible to find (4130). */}
                                <tr>
                                  <th colSpan={issued ? 7 : 6} className={`${TH} !text-center !text-[10px] uppercase tracking-wide`}>
                                    Planning
                                  </th>
                                  {sendable ? (
                                    <th colSpan={2} className={`${TH} ${SEND_TH} !text-center !text-[10px] uppercase tracking-wide`}>
                                      Delivery now
                                    </th>
                                  ) : null}
                                </tr>
                                <tr>
                                  <th className={`${THW} pl-7`}>↳ Yarn</th>
                                  <th className={THWR}>Blend %</th>
                                  <th className={THWR}>Allow %</th>
                                  <th className={THWR}>Required Kg</th>
                                  {/* Bags × the bag weight, typed in the cell (one weight per yarn). */}
                                  <th className={THWR}>Bags</th>
                                  <th className={THWR}>DC Cap Kg</th>
                                  {issued ? <th className={THWR}>Sent Kg</th> : null}
                                  {sendable ? (
                                    <>
                                      <th className={`${THWR} ${SEND_TH}`}>In Stock</th>
                                      <th className={`${THWR} ${SEND_TH}`}>Send Qty</th>
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
                                        <span className={`${CELLR} ${y.blend_pct == null ? "text-danger" : ""}`}>{y.blend_pct == null ? "None" : fmtNumber(y.blend_pct)}</span>
                                      </td>
                                      <td className={TD}>
                                        {readOnly ? (
                                          <span className={CELLR}>{y.allowance || "0"}</span>
                                        ) : (
                                          // A typed Allow % reads amber: it no longer follows the header's Allowed Loss %.
                                          <Input
                                            type="number"
                                            min="0"
                                            max="99"
                                            step="any"
                                            aria-label={`Loss allowance %, ${y.yarn_name}`}
                                            title={y.allowance_typed ? "Typed for this row — the header's Allowed Loss % no longer changes it" : "Follows the header's Allowed Loss %"}
                                            className={`${NUM} ${y.allowance_typed ? "font-semibold text-warning" : ""}`}
                                            value={y.allowance}
                                            onChange={(e) => setAllowance(f.key, y.key, e.target.value)}
                                          />
                                        )}
                                      </td>
                                      <td className={TD}>
                                        <span className={`${CELLR} font-semibold`}>{fmtNumber(c.required)}</span>
                                      </td>
                                      {/* BAG WT, TYPED HERE (moved off the RE rail, user 2026-11-14): "bags × [kg]".
                                          One weight per yarn — typing it fills every row of that yarn. */}
                                      <td className={TD}>
                                        {readOnly ? (
                                          <span className={`${CELLR} whitespace-nowrap ${c.bags == null ? "text-muted-foreground" : ""}`}>{c.bags == null ? "—" : `${c.bags} × ${fmtNumber(n(y.bag_weight) ?? 0)}`}</span>
                                        ) : (
                                          <span className="flex items-center justify-end gap-1 whitespace-nowrap px-1 text-xs tabular-nums">
                                            <span className="text-muted-foreground">{c.bags == null ? "—" : c.bags} ×</span>
                                            <span className="w-12 shrink-0">
                                              <Input
                                                type="number"
                                                min="0"
                                                step="any"
                                                aria-label={`Kg in one bag, ${y.yarn_name}`}
                                                title={bagWtMixed(y.yarn_item_id) ? "The fabrics hold different bag weights — type one to set all" : "Kg in one bag — fills every row of this yarn"}
                                                className={NUM}
                                                value={y.bag_weight}
                                                onChange={(e) => setBagWt(y.yarn_item_id, e.target.value)}
                                              />
                                            </span>
                                          </span>
                                        )}
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
                                          <td className={`${TD} ${SEND_TD}`}>
                                            <span className={`${CELLR} ${inStock(y) > 0 ? "" : "text-danger"}`}>{fmtNumber(inStock(y))}</span>
                                          </td>
                                          <td className={`${TD} ${SEND_TD}`}>
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
                                    {sendable ? <td className={SUM_TD} colSpan={2} /> : null}
                                  </tr>
                                ) : null}
                              </tbody>
                            </table>
                          </div>
                          )}
                        </>
                      ) : null}
                    </section>
                    </Fragment>
                  );
                })}
                {!readOnly && shownRe ? (
                  <Button type="button" variant="outline" data-row-add="" onClick={() => addFabric(shownRe)}>
                    <Plus className="size-4" aria-hidden />
                    Add a fabric from {reLabel(shownRe)}
                  </Button>
                ) : null}
                {gaugeOptions.length === 0 && !readOnly ? <p className="text-xs text-muted-foreground">No gauges in the Gauge master yet.</p> : null}
            </div>
          </div>

          {/* NO "Yarn DCs on this order" TABLE, NO RECEIPTS SENTENCE (user 2026-11-12: "remove it from
              here"). The order's DCs print from its report (the list's Report icon → Knitting
              Analysis, whose strip names every DC); a draft DC is on Purchase ▸ Job Work DC; fabric
              and returned yarn are posted on Process ▸ Knitting ▸ Fabric Receipts / Yarn Returns. */}
          {/* YARN ALREADY AT THE KNITTER (client 2026-11-11, 0833) — moved here without a transport DC. */}
          {doc && issued && canEdit && atKnitter.length ? <KnitAtKnitterPanel doc={doc} rows={atKnitter} /> : null}

          <DocRemarksLine maxWidthClass="max-w-none" value={notes} readOnly={readOnly} onChange={setNotes} />
        </div>

        {/* paddingRight clears the round floating button that sat on the last footer button (4130). */}
        <div className={DOC_BOTTOM_BAR} data-focus-region="footer" style={{ paddingRight: "5rem" }}>
          {doc?.status === "cancelled" && doc.cancel_reason ? (
            <span className="text-sm text-muted-foreground">Cancelled — {doc.cancel_reason}</span>
          ) : null}
          {cancellable ? (
            <button
              type="button"
              className="text-sm text-muted-foreground hover:text-foreground hover:underline"
              onClick={() => setConfirm("cancel")}
              disabled={isPending}
            >
              Cancel this knitting order
            </button>
          ) : null}
          {/* UNDO A SENT DC (0841, user 2026-11-13: "return to the bin, that's all") — only while
              nothing has come back, so the yarn is still whole at the knitter. Once every DC is
              undone the order is Issued again, and Cancel / the list's Delete take over. */}
          {canEdit && doc && ["in_process", "partially_received"].includes(doc.status) && !doc.close_pending && doc.receipts.length === 0
            ? doc.dcs
                .filter((d) => d.status === "issued" && !d.moved_from)
                .map((d) => (
                  <button
                    key={d.id}
                    type="button"
                    className="text-sm text-muted-foreground hover:text-foreground hover:underline"
                    onClick={() => setUndoDc({ id: d.id, code: d.code, kg: d.kg })}
                    disabled={isPending}
                  >
                    Undo {d.code ?? "DC"} — yarn back to bin
                  </button>
                ))
            : null}
          {/* WHY ISSUE IS GREYED, BESIDE IT (plan step 4) — the red items of "Before you issue". */}
          {sendable && blocking.length ? (
            <p className="ml-auto max-w-[28rem] truncate text-xs font-medium text-danger" title={blocking.join(" · ")}>
              To issue: {blocking.join(" · ")}
            </p>
          ) : null}
          <div className={`${sendable && blocking.length ? "" : "ml-auto "}flex items-center gap-2`}>
            <Link href={BASE} className={buttonClasses({ variant: "outline" })}>
              {readOnly ? "Close" : "Cancel"}
            </Link>
            {!readOnly ? (
              <Button type="button" onClick={save} variant="outline" disabled={isPending || !canSave || (!!doc && !dirty)}>
                {isPending ? "Saving…" : !doc || doc.status === "draft" ? "Save draft" : "Save"}
              </Button>
            ) : null}
            {/* DC DATE BESIDE THE BUTTON: it used to live in the confirm popup, which Session 2 removed. */}
            {sendable && sends.length ? (
              <Input
                type="date"
                aria-label="DC Date"
                title="DC Date"
                className="w-[9.5rem]"
                value={dcDate}
                max={today || undefined}
                onChange={(e) => setDcDate(e.target.value)}
              />
            ) : null}
            {sendable && (!doc || doc.status === "draft") ? (
              // ONE CLICK, NO POPUP (Session 2, 2026-11-14 — "Delivery Now", reverses the 11-12 confirm):
              // save if needed, issue, and send the rows with a Send Qty. A wrong DC is taken back with
              // "Undo DC" (0841), which is why the click needs no second question.
              <Button type="button" disabled={isPending || !canSave || sendBad} onClick={issue}>
                {isPending ? "Working…" : sends.length ? "Delivery Now" : "Issue to Knitter"}
              </Button>
            ) : null}
            {sendable && doc && doc.status !== "draft" ? (
              <Button type="button" disabled={isPending || sends.length === 0 || sendBad} onClick={sendOnly}>
                {isPending ? "Working…" : "Delivery Now"}
              </Button>
            ) : null}
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={confirm === "cancel"}
        title={`Cancel ${doc?.code ?? "this knitting order"}?`}
        body={
          <div className="space-y-3">
            <p>
              {yarnOutKg > 0
                ? `${fmtNumber(yarnOutKg)} kg of yarn on ${doc?.dcs.filter((d) => d.status === "issued").length ?? 0} DC(s) goes back to the store bins it was sent from, and the DCs are cancelled.`
                : "No yarn has gone out on it."}{" "}
              Its fabric lines are freed for a new Knitting Order. A cancelled order stays on the list, read-only.
            </p>
            <Field label="Reason" required>
              <Input value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} required autoFocus />
            </Field>
          </div>
        }
        confirmLabel="Cancel order"
        cancelLabel="Keep"
        isPending={isPending || !cancelReason.trim()}
        onConfirm={cancelDoc}
        onCancel={() => {
          setConfirm(null);
          setCancelReason("");
        }}
      />
      <ConfirmDialog
        open={!!shortClose}
        title={`Short close ${shortClose ? fmtNumber(shortClose.kg) : ""} kg of ${shortClose?.fabric ?? "this fabric"}?`}
        body={
          <div className="space-y-3">
            <p>No Knitting Order will be raised for this remainder. The RE line then reads Fully Placed and cannot be picked again until it is reopened.</p>
            <Field label="Reason" required>
              <Input value={shortReason} onChange={(e) => setShortReason(e.target.value)} required autoFocus />
            </Field>
          </div>
        }
        confirmLabel="Short close"
        cancelLabel="Keep open"
        isPending={isPending}
        onConfirm={runShortClose}
        onCancel={() => {
          setShortClose(null);
          setShortReason("");
        }}
      />
      <ConfirmDialog
        open={!!undoDc}
        title={`Undo ${undoDc?.code ?? "this DC"}?`}
        body={`${fmtNumber(undoDc?.kg ?? 0)} kg of yarn goes back to the bin it was sent from, and the DC is cancelled. With no other yarn out, ${doc?.code ?? "the order"} returns to Issued — then it can be cancelled or deleted.`}
        confirmLabel="Undo DC"
        cancelLabel="Keep"
        isPending={isPending}
        onConfirm={undoSentDc}
        onCancel={() => setUndoDc(null)}
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
    budget_rate: null,
    yarns: [],
  };
}
