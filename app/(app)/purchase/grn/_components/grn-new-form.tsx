"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createGrn } from "@/lib/purchase/grn-actions";
import { useToast } from "@/components/ui/toast";
import { ChildGrid, type ChildGridColumn } from "@/components/masters/child-grid";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { Field, FieldError, FieldRow, FIELD_WIDTH_CSS } from "@/components/ui/field";
import { StatusPill, type StatusTone } from "@/components/ui/status-pill";
import { Truncated } from "@/components/ui/truncated";
import { FilterPill, type FilterPillOption } from "@/components/ui/filter-pill";
import {
  DENSE,
  DOC_BOTTOM_BAR,
  DOC_CHIP,
  DOC_FRAME,
  DOC_PILL_ROW,
  DOC_RULE,
  GRID_HEAD,
  HINT_CHIP_TONES,
  RailSectionLabel,
  RailTickRow,
  type HintKind,
} from "@/components/purchase/doc-surface";
import { FileText, Layers, LayoutGrid, Package, Store as StoreIcon, User } from "lucide-react";
import { QcFailedSheet, type QcFailChoice } from "@/components/purchase/qc-failed-sheet";
import type {
  GrnBinOption,
  GrnGroupKind,
  GrnProcessOrderOption,
  GrnStoreOption,
  OpenPoLine,
  ReplacementDue,
} from "@/lib/purchase/grn-service";
import type { QcStatus } from "@/lib/purchase/types";
import { acceptedFrom } from "@/lib/purchase/grn-tolerance";
import { focusField } from "@/lib/focus";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { today } from "@/lib/calendar";
import { fmtNumber } from "@/lib/format";
import { pickedBins, splitBinsProblem, withTailBin } from "@/lib/purchase/bin-split";
import { StoreBinCell } from "@/components/purchase/store-bin-editor";
import { cn } from "@/lib/utils";
import { lineKindOf } from "@/lib/purchase/re-po/types";

/**
 * STORE KEEPER GRN ENTRY (2026-09-23; reworked 2026-10-31 to the user's GRN rules).
 *
 * Header, one row (user 2026-11-02, screenshot 3952): Store Location (the working unit) ·
 * GRN Date · Document Type (Invoice / DC) · the vendor's document No · its Date (today) ·
 * Vendor · PO No — the order of the vendor's paper, typed top to bottom. The GRN No sits in
 * the card's own header: the sequence assigns it on save, so a new GRN reads "New".
 * PO No is MULTI-SELECT (same day): one delivery may fill several of one vendor's POs, so
 * ticking POs loads EVERY pending line of each, in the order they were picked. On a
 * Replacement GRN opened from Pending it is the Replacement DC it fills instead, which
 * LOCKS the vendor to that DC's.
 *
 * THE LINE RULES (user 2026-10-31):
 *  - EXCESS LOCKED. Today Recd may not exceed the line's pending balance (ordered − closed
 *    − received − owed back as a replacement). No tolerance band, no override: the box
 *    says so in red and Save waits. `createGrn` refuses the same.
 *  - CLOSE BALANCE. Short of the balance, a "Close bal." tick says the vendor will not send
 *    the rest; on post the remainder closes (0782) without reopening the requirement.
 *  - PENDING QC (0791): delivered, not yet inspected. Posts against the PO but into no
 *    stock, no bin and no bill; Stores ▸ Pending QC decides it and picks the bin there.
 *  - PLACE OF DELIVERY (0792, user 2026-11-02): our unit's store, or DIRECT to a processor
 *    on its open Process Order — the goods then go "at vendor" (the Processing store) and
 *    count as sent on that order. A direct line is QC Passed (inspected at the processor)
 *    and takes no store / bin here; it must be an item on the Process Order.
 *  - SAVE POSTS (user 2026-11-02): "Save & Post GRN" saves and posts in one click.
 *  - QC opens on PASSED. FAILED asks first (`QcFailedSheet`): failed qty, reason, and
 *    Rejection (debit note + Rejection DC + requirement reopens) or Replacement
 *    (Replacement DC, no debit, vendor resends).
 *  - YARN IN BAGS (user 2026-11-02). A yarn line reads No. of Bags × Avg Bag Wt (kg) =
 *    Today Recd: typing Bags fills the kg; typing the kg suggests the whole bags it needs
 *    (rounded UP — the last bag may be part-filled). The bag weight opens on the PO
 *    line's own (0758), else 50 kg. Same rule as Raise PO's bags pop-up.
 *  - STORE · BIN IN A POP-UP (user 2026-11-02, screenshot 161807): the cell is one line
 *    (`StoreBinCell`); the store and bins are edited in a small sheet. Bin 1 takes the
 *    whole accepted qty and locks out a second bin; lower it and a blank row opens for the
 *    balance (lib/purchase/bin-split.ts). The bins must add up to the accepted qty exactly
 *    (0782's `grn_line_bins`, re-checked by `grn_post`).
 *
 * TAB IS THE CONTRACT'S, NOT THIS FILE'S. Inside the grid `tabAlongRow` walks the row's
 * fields; QC and Close bal. sit under `data-focus-optional`, so Tab runs Today Recd → Bin
 * → Lot No → the next row's Today Recd. No keydown handler here.
 */

/* Invoice or DC only (user 2026-10-31, screenshot 3945: "only invoice and bill, remove
   replacement"). A Replacement GRN is not a document TYPE the keeper picks — it opens from
   its Replacement DC's row under Pending, fixed to that DC (`replacement` prop). */
type DocType = "invoice" | "dc";

interface BinSplit {
  key: string;
  binId: string;
  /** Only typed once the line is split; a single bin takes the whole accepted qty. */
  qty: string;
  /** The operator typed the qty — kept as typed (lib/purchase/bin-split.ts). */
  typed?: boolean;
}

interface DraftLine {
  key: string;
  poLineItemId: string;
  purchaseOrderId: string;
  /** Shown under the item once the GRN carries more than one PO. */
  poCode: string | null;
  description: string;
  uomCode: string | null;
  ordered: number;
  receivedSoFar: number;
  /** A yarn line takes its Today Recd in bags (see the header note). */
  isYarn: boolean;
  bags: string;
  bagWt: string;
  /** The most Today Recd may be: what is still pending on this line for THIS GRN. */
  pending: number;
  todayRecd: string;
  /** The vendor's lot (user 2026-10-31: "Lot No", was Roll / Batch) — stored in roll_batch_no. */
  rollBatchNo: string;
  qcStatus: QcStatus;
  /** Set by the QC Failed popup: the failed qty, why, and Rejection / Replacement. */
  fail: QcFailChoice | null;
  /** Vendor will not send the rest — close the balance on post (0782). */
  closeBalance: boolean;
  /** Where the accepted goods go (grn.md §2A) — opens on the unit's material store. */
  storeId: string;
  bins: BinSplit[];
}

/** Where a new line's goods open: the unit's Material store, or for yarn its Yarn store. */
type StoreDefaults = { general: string | null; yarn: string | null };

let splitSeq = 0;
const newSplit = (binId = ""): BinSplit => ({ key: `s${++splitSeq}`, binId, qty: "" });

/** Owed back as a replacement, per PO line — that qty comes in on its DC's row, not here. */
function owedByLine(replacements: ReplacementDue[]): Map<string, number> {
  const owed = new Map<string, number>();
  for (const d of replacements) for (const x of d.lines) owed.set(x.po_line_item_id, (owed.get(x.po_line_item_id) ?? 0) + x.due);
  return owed;
}

/**
 * A PO's lines as the grid's rows, in the PO's own order — only lines with something
 * pending. For a Replacement, only the DC's owed lines, each capped at what it owes.
 */
function linesOfPo(
  openPoLines: OpenPoLine[],
  poId: string,
  storeDefaults: StoreDefaults,
  owed: Map<string, number>,
  repl: ReplacementDue | null,
): DraftLine[] {
  const due = new Map((repl?.lines ?? []).map((x) => [x.po_line_item_id, x.due]));
  return openPoLines
    .filter((l) => l.purchase_order_id === poId)
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((l) => ({
      key: l.id,
      poLineItemId: l.id,
      purchaseOrderId: l.purchase_order_id,
      poCode: l.po_code,
      description: l.description,
      uomCode: l.uom_code,
      ordered: l.quantity,
      receivedSoFar: l.received_qty,
      pending: repl ? (due.get(l.id) ?? 0) : Math.max(0, l.open_balance - (owed.get(l.id) ?? 0)),
      todayRecd: "",
      isYarn: lineKindOf(l.item_class) === "yarn",
      bags: "",
      bagWt: lineKindOf(l.item_class) === "yarn" ? String(l.bag_weight ?? DEFAULT_BAG_KG) : "",
      rollBatchNo: "",
      qcStatus: "passed" as QcStatus,
      fail: null,
      closeBalance: false,
      // YARN OPENS ON THE YARN STORE (user 2026-11-02), when the unit has one.
      storeId: (lineKindOf(l.item_class) === "yarn" ? (storeDefaults.yarn ?? storeDefaults.general) : storeDefaults.general) ?? "",
      bins: [newSplit()],
    }))
    .filter((l) => l.pending > 1e-9);
}

/**
 * SEVERAL POs' lines, PO by PO in the order they were picked. A line already on screen
 * keeps what was typed into it — unticking one PO must not wipe the others' entries.
 */
function linesOfPos(
  openPoLines: OpenPoLine[],
  poIds: string[],
  storeDefaults: StoreDefaults,
  owed: Map<string, number>,
  current: DraftLine[],
): DraftLine[] {
  const kept = new Map(current.map((l) => [l.key, l]));
  return poIds.flatMap((id) => linesOfPo(openPoLines, id, storeDefaults, owed, null).map((l) => kept.get(l.key) ?? l));
}

const QC_OPTIONS: { value: QcStatus; label: string }[] = [
  { value: "passed", label: "Passed" },
  { value: "failed", label: "Failed" },
  { value: "pending", label: "Pending QC" },
];

function num(s: string): number {
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;
/** A yarn bag when the PO named no weight (the client's spec). */
const DEFAULT_BAG_KG = 50;

/* THE BAG ARITHMETIC, both ways. Bags or the weight typed → kg = bags × weight. The kg
   typed → the whole bags it needs, rounded UP by less than one bag (`maxBags`' rule on
   Raise PO), so 115 kg in 50 kg bags reads 3 bags with a part-filled last one. */
function bagsPatch(l: { bags: string; bagWt: string }, typed: { bags?: string; bagWt?: string }) {
  const bags = typed.bags ?? l.bags;
  const bagWt = typed.bagWt ?? l.bagWt;
  const b = Math.max(0, Math.floor(num(bags)));
  const w = num(bagWt);
  return bags !== "" && w > 0 ? { bags: String(b), bagWt, todayRecd: String(round3(b * w)) } : { bags, bagWt };
}
function kgPatch(l: { bagWt: string }, todayRecd: string) {
  const w = num(l.bagWt);
  const kg = num(todayRecd);
  return { todayRecd, bags: w > 0 && kg > 0 ? String(Math.ceil(kg / w - 1e-9)) : "" };
}
const accepted = (l: DraftLine) => acceptedFrom(num(l.todayRecd), l.fail?.qty ?? 0);

/** The line's own refusals — each shown UNDER the field it is about. */
function excessProblem(l: DraftLine): string | null {
  return num(l.todayRecd) > l.pending + 1e-9
    ? `Excess quantity blocked: at most ${fmtNumber(l.pending)} is pending`
    : null;
}
function failProblem(l: DraftLine): string | null {
  return l.fail && l.fail.qty > num(l.todayRecd) ? "Failed qty is more than Today Recd" : null;
}
function splitProblem(l: DraftLine): string | null {
  if (l.qcStatus === "pending") return null; // put away at QC (0791)
  if (num(l.todayRecd) <= 0) return null;
  return splitBinsProblem(l.bins, accepted(l));
}

/** Part / Exact, read off the pending balance (excess is refused, so there is no "over"). */
function lineStatus(l: DraftLine): { tone: StatusTone; label: string } | null {
  const t = num(l.todayRecd);
  if (t <= 0) return null;
  if (excessProblem(l)) return { tone: "danger", label: "Excess" };
  if (round3(t) === round3(l.pending)) return { tone: "success", label: "Full" };
  return l.closeBalance ? { tone: "neutral", label: "Closed" } : { tone: "info", label: "Part" };
}

/* THE HEADER CASCADE (user 2026-11-02): Group Type → Buyer → Vendor → Item Class →
   Order No → PO No. Each facet offers only what the others leave — the Receiving list's
   own Filters panel (grn-screen.tsx), one value per facet here because Vendor is the
   GRN's own vendor, not just a filter. Blank = all. */
const KIND_OPTIONS: { value: GrnGroupKind; label: string }[] = [
  { value: "re", label: "Order / RE" },
  { value: "swo", label: "Sample / SWO" },
  { value: "iwo", label: "Internal / IWO" },
  { value: "general", label: "General" },
];
const NO_BUYER = "__none__";
type Facet = "kind" | "buyer" | "vendor" | "cls" | "order";
const FACETS: Facet[] = ["kind", "buyer", "vendor", "cls", "order"];
type Facets = Record<Facet, string>;
const facetOf = (l: OpenPoLine, k: Facet): string | null =>
  k === "kind"
    ? l.group_kind
    : k === "buyer"
      ? (l.buyer ?? NO_BUYER)
      : k === "vendor"
        ? l.vendor_id || null
        : k === "cls"
          ? (l.item_class_id ?? l.item_class)
          : l.order_id;
function passes(l: OpenPoLine, f: Facets, skip?: Facet): boolean {
  return FACETS.every((k) => k === skip || !f[k] || facetOf(l, k) === f[k]);
}

interface Props {
  openPoLines: OpenPoLine[];
  locations: { id: string; code: string; name: string; postable: boolean }[];
  defaultLocationId: string | null;
  /** The working unit's stores and bins — the line's Store and Bin pickers (0777). */
  stores: GrnStoreOption[];
  bins: GrnBinOption[];
  defaultStoreId: string | null;
  /** Replacement DCs still owed — the Replacement document type picks one (0781). */
  replacements?: ReplacementDue[];
  /** Opened from a Pending row on the Receiving list: that PO, already loaded. */
  initialPoId?: string | null;
  /** Opened from the list's New GRN with one vendor filtered: that vendor, already chosen. */
  initialVendorId?: string | null;
  /** Back to the Receiving list (embedded); omitted = the standalone /new page. */
  onCancel?: () => void;
  /** Opened from a Replacement DC's Pending row: that DC, already chosen. */
  replacement?: ReplacementDue | null;
  /** Open Process Orders a supplier may deliver straight to (0792). */
  processOrders?: GrnProcessOrderOption[];
  /** May "+ Add" a bin from a bin box (masters:create) — made in the working unit. */
  canCreateBin?: boolean;
}

export function GrnNewForm({
  openPoLines,
  locations,
  defaultLocationId,
  stores,
  bins,
  defaultStoreId,
  replacements = [],
  initialPoId = null,
  initialVendorId = null,
  onCancel,
  replacement = null,
  processOrders = [],
  canCreateBin = false,
}: Props) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();
  const owed = owedByLine(replacements);
  /* A store of the unit named "Yarn …" takes yarn lines; none yet → the Material store. */
  const storeDefaults: StoreDefaults = {
    general: defaultStoreId,
    yarn: stores.find((st) => /yarn/i.test(`${st.name} ${st.code}`))?.id ?? null,
  };

  /** The PO a Replacement DC's owed lines belong to (one GRN, one PO). */
  const poOfRepl = (r: ReplacementDue | null) =>
    r ? (openPoLines.find((l) => l.id === r.lines[0]?.po_line_item_id)?.purchase_order_id ?? null) : null;
  const startPoId = poOfRepl(replacement) ?? initialPoId;

  /* STORE LOCATION IS NOT ASKED (user 2026-11-02): a GRN is received into the unit the
     keeper is working in — the top bar's switcher — and createGrn refuses any other. The
     unit's name is shown in the card header instead. */
  const locationId = defaultLocationId ?? "";
  const [grnDate, setGrnDate] = useState(() => today());
  /* THE VENDOR'S PAPER (user 2026-10-31): ONE document came with the goods — an Invoice, a
     Delivery Challan, or a Replacement delivery against our Replacement DC. One type, one
     number, one date (today unless changed). An Invoice is stored in invoice_no, a DC or a
     replacement's challan in dc_no, the date in invoice_date either way. */
  const [docType, setDocType] = useState<DocType>(replacement ? "dc" : "invoice");
  const [docNo, setDocNo] = useState("");
  const [docDate, setDocDate] = useState(() => today());
  /* PLACE OF DELIVERY (0792): our store, or straight to a processor on its Process Order. */
  const [deliveryKind, setDeliveryKind] = useState<"store" | "direct">("store");
  const [deliveryVendorId, setDeliveryVendorId] = useState("");
  const [processOrderId, setProcessOrderId] = useState("");
  const [vehicleRef, setVehicleRef] = useState("");
  /* A Replacement GRN opens fixed to its DC (from its Pending row) — the vendor with it. */
  const repl = replacement;
  const [vendorId, setVendorId] = useState(
    () =>
      replacement?.vendor_id ||
      ((startPoId ? openPoLines.find((l) => l.purchase_order_id === startPoId)?.vendor_id : null) ?? initialVendorId ?? ""),
  );
  /** The POs this GRN receives against — one vendor's, several allowed (2026-11-02). */
  const [poIds, setPoIds] = useState<string[]>(startPoId ? [startPoId] : []);
  const [lines, setLines] = useState<DraftLine[]>(() =>
    startPoId ? linesOfPo(openPoLines, startPoId, storeDefaults, owed, replacement) : [],
  );
  const [dirty, setDirty] = useState(false);
  /** Bins "+ Add"ed on this GRN — offered on every line and split straight away. */
  const [addedBins, setAddedBins] = useState<GrnBinOption[]>([]);
  const allBins = [...bins, ...addedBins];
  const gridRef = useRef<HTMLDivElement>(null);
  // Opened on a PO (from its Pending row): the cursor lands on its first Today Recd once.
  const [landToken] = useState(startPoId ? 1 : 0);
  /** The line whose QC was just set to Failed — its popup is open. */
  const [failKey, setFailKey] = useState<string | null>(null);
  const [failSeq, setFailSeq] = useState(0);

  useUnsavedGuard(dirty || isPending);

  /* THE CURSOR LANDS ON THE FIRST ROW'S TODAY RECD once a PO's lines arrive.
     A focus move after a render, not a key handler: `focusField` is the
     contract's own mover (caret placed, so → still works). */
  useEffect(() => {
    if (landToken === 0) return;
    const el = gridRef.current?.querySelector<HTMLElement>("[data-grn-today]");
    if (el) focusField(el);
  }, [landToken]);

  const isRepl = !!replacement;

  // ---------- options ----------
  /** The other header facets (Vendor is `vendorId`, the GRN's own). */
  const [kind, setKind] = useState("");
  const [buyer, setBuyer] = useState("");
  const [cls, setCls] = useState("");
  const [order, setOrder] = useState("");
  /** The PO No pill: narrows the rail, never the GRN (Raise PO's Orders pill). */
  const [poFilter, setPoFilter] = useState<string[]>([]);
  /** Which ticked PO the grid shows — or "all" (Raise PO's rail selection). */
  const [selKey, setSelKey] = useState<string>(startPoId ?? "all");
  const facets: Facets = isRepl
    ? { kind: "", buyer: "", vendor: "", cls: "", order: "" }
    : { kind, buyer, vendor: vendorId, cls, order };

  // Every open PO line with something still to receive on it (not just owed back).
  const receivable = openPoLines.filter((l) => l.open_balance - (owed.get(l.id) ?? 0) > 1e-9);
  const lineById = new Map(openPoLines.map((l) => [l.id, l]));
  const pos = new Map<string, { id: string; code: string | null; vendorId: string; vendorName: string }>();
  for (const l of receivable) {
    if (!pos.has(l.purchase_order_id)) {
      pos.set(l.purchase_order_id, { id: l.purchase_order_id, code: l.po_code, vendorId: l.vendor_id, vendorName: l.vendor_name });
    }
  }
  /** One option per value the OTHER facets leave, in name order. */
  /** Counted in POs — what the rail would list under that pick. */
  function facetOptions(k: Facet, labelOf: (l: OpenPoLine) => string, f: Facets = facets): FilterPillOption[] {
    const by = new Map<string, { label: string; pos: Set<string> }>();
    for (const l of receivable) {
      const v = facetOf(l, k);
      if (!v || !passes(l, f, k)) continue;
      const e = by.get(v) ?? { label: labelOf(l), pos: new Set<string>() };
      e.pos.add(l.purchase_order_id);
      by.set(v, e);
    }
    return [...by.entries()]
      .sort((x, y) => x[1].label.localeCompare(y[1].label))
      .map(([value, e]) => ({ value, label: e.label, count: e.pos.size }));
  }
  const kindCounts = new Map(facetOptions("kind", () => "").map((o) => [o.value, o.count ?? 0]));
  const buyerOptions = facetOptions("buyer", (l) => l.buyer ?? "Not recorded (IWO / General)");
  const clsOptions = facetOptions("cls", (l) => l.item_class ?? "—");
  const orderOptions = facetOptions("order", (l) => l.order_no ?? "—");
  /* ONLY VENDORS WITH SOMETHING TO DELIVER (grn.md §1, 0777) — on a Replacement, only
     vendors owed a replacement. */
  const vendorOptions: FilterPillOption[] = isRepl
    ? Array.from(new Map(replacements.map((r) => [r.vendor_id, r.vendor_name])).entries())
        .sort((x, y) => x[1].localeCompare(y[1]))
        .map(([value, label]) => ({ value, label }))
    : facetOptions("vendor", (l) => l.vendor_name || "—");
  /** The POs with at least one line every facet lets through. */
  const poInScope = (id: string, f: Facets = facets) => receivable.some((l) => l.purchase_order_id === id && passes(l, f));
  /* THE PO No PILL lists the POs the other pills leave; with no vendor chosen the vendor
     rides under each number. Counted in lines still to receive. */
  const scopePos = Array.from(pos.values()).filter((p) => poInScope(p.id));
  const poOptions: FilterPillOption[] = scopePos.map((p) => ({
    value: p.id,
    label: p.code ?? "(no number)",
    sublabel: vendorId ? undefined : p.vendorName,
    count: receivable.filter((l) => l.purchase_order_id === p.id).length,
  }));
  // ---------- edits ----------
  function touch() {
    setDirty(true);
  }

  /* A FACET CHANGE NARROWS EVERYTHING AFTER IT: a later pick that no line still matches
     goes (the cascading-filters rule — kept when still in scope), and so does a ticked
     PO left with no line in scope. */
  function setFacet(k: Facet, v: string) {
    touch();
    const next: Facets = { ...facets, [k]: v };
    for (const d of FACETS.slice(FACETS.indexOf(k) + 1)) {
      if (next[d] && !receivable.some((l) => facetOf(l, d) === next[d] && passes(l, next, d))) next[d] = "";
    }
    setKind(next.kind);
    setBuyer(next.buyer);
    setVendorId(next.vendor);
    setCls(next.cls);
    setOrder(next.order);
    const kept = poIds.filter((id) => poInScope(id, next));
    if (kept.length !== poIds.length) {
      setPoIds(kept);
      setLines((prev) => linesOfPos(openPoLines, kept, storeDefaults, owed, prev));
    }
  }

  /* ONE GRN, ONE VENDOR (createGrn refuses a mixed GRN): the first PO picked sets the
     vendor, and a PO of any other vendor ticked in the same open list is dropped.
     No cursor jump here — the list stays open across ticks, and moving focus into the
     grid would close it under the operator. Tab off the field reaches Today Recd. */
  function loadPos(next: string[]) {
    const first = next.length ? pos.get(next[0]) : null;
    const vendor = first?.vendorId ?? vendorId;
    const kept = next.filter((id) => pos.get(id)?.vendorId === vendor);
    if (first && vendor !== vendorId) setVendorId(vendor);
    setPoIds(kept);
    setLines((prev) => linesOfPos(openPoLines, kept, storeDefaults, owed, prev));
    setSelKey((cur) => (cur !== "all" && kept.includes(cur) ? cur : kept.length === 1 ? kept[0] : "all"));
  }
  /** The rail's tick: on → onto the GRN (and shown); off → off the GRN. */
  function togglePo(id: string) {
    touch();
    if (poIds.includes(id)) loadPos(poIds.filter((x) => x !== id));
    else {
      loadPos([...poIds, id]);
      setSelKey(id);
    }
  }

  function changeDocType(next: DocType) {
    touch();
    setDocType(next);
  }

  /** The bin rows re-shaped to the blank-end-row rule — after ANY change, since the first
   *  bin's share follows Today Recd and the failed qty too. */
  const reshape = (l: DraftLine): DraftLine => ({ ...l, bins: withTailBin(l.bins, () => newSplit(), accepted(l)) });
  function updateLine(key: string, patch: Partial<Omit<DraftLine, "key">>) {
    touch();
    setLines((prev) => prev.map((l) => (l.key === key ? reshape({ ...l, ...patch }) : l)));
  }
  function updateSplit(lineKey: string, splitKey: string, patch: Partial<Omit<BinSplit, "key">>) {
    touch();
    setLines((prev) =>
      prev.map((l) => (l.key === lineKey ? reshape({ ...l, bins: l.bins.map((b) => (b.key === splitKey ? { ...b, ...patch } : b)) }) : l)),
    );
  }

  // ---------- derived ----------
  /* ITEM CLASS AND ORDER NO NARROW THE LINES TOO: a PO raised across classes or REs
     shows only the lines the header asks for, and only those are saved. A hidden line
     keeps what was typed into it until its facet is cleared. */
  const shownLines = isRepl
    ? lines
    : lines.filter((l) => {
        const src = lineById.get(l.key);
        return !src || passes(src, facets);
      });
  const hiddenCount = lines.length - shownLines.length;
  const receiving = shownLines.filter((l) => num(l.todayRecd) > 0);
  const location = locations.find((l) => l.id === locationId);
  const isDirect = !isRepl && deliveryKind === "direct";
  const procOrder = isDirect ? (processOrders.find((o) => o.id === processOrderId) ?? null) : null;
  /** A direct line must be an input item of the chosen Process Order (grn_post refuses the rest). */
  const notOnOrder = (l: DraftLine): string | null => {
    if (!procOrder) return null;
    const itemId = lineById.get(l.key)?.item_id;
    return itemId && procOrder.item_ids.includes(itemId) ? null : `Not on ${procOrder.code ?? "the Process Order"}`;
  };
  /** Place of Delivery: our store first, then every processor with an open Process Order. */
  const placeOptions: ComboboxOption[] = [
    { value: "store", label: location?.name ? `${location.name} store` : "Our store", sublabel: "Our store" },
    ...Array.from(new Map(processOrders.map((o) => [o.vendor_id, o.vendor_name])).entries())
      .sort((a, b) => a[1].localeCompare(b[1]))
      .map(([vid, name]) => ({ value: `v:${vid}`, label: name, sublabel: "Direct to processor" })),
  ];
  const orderOptions2: ComboboxOption[] = processOrders
    .filter((o) => !deliveryVendorId || o.vendor_id === deliveryVendorId)
    .map((o) => ({ value: o.id, label: o.code ?? "(no number)", sublabel: o.process_type ?? undefined, search: o.vendor_name }));
  const lineProblems = receiving.some(
    (l) => excessProblem(l) || (!isDirect && (failProblem(l) || splitProblem(l))) || (isDirect && notOnOrder(l)),
  );
  const failLine = failKey ? (lines.find((l) => l.key === failKey) ?? null) : null;
  const canSave =
    !isPending &&
    !!location?.postable &&
    !!grnDate &&
    !!vendorId &&
    !!docNo.trim() &&
    !!docDate &&
    poIds.length > 0 &&
    (!isRepl || !!repl) &&
    (!isDirect || (!!deliveryVendorId && !!processOrderId)) &&
    receiving.length > 0 &&
    !lineProblems;

  function handleSave() {
    if (!canSave) return;
    startTransition(async () => {
      const result = await createGrn(
        {
        master_vendor_id: vendorId,
        location_id: locationId || null,
        grn_date: grnDate,
        invoice_no: docType === "invoice" ? docNo.trim() || null : null,
        invoice_date: docDate || null,
        dc_no: docType === "dc" ? docNo.trim() || null : null,
        kind: isRepl ? "replacement" : "regular",
        vendor_return_id: isRepl ? (repl?.id ?? null) : null,
        delivery_kind: isDirect ? "direct" : "store",
        delivery_vendor_id: isDirect ? deliveryVendorId : null,
        process_order_id: isDirect ? processOrderId : null,
        vehicle_ref: vehicleRef.trim() || null,
        notes: null,
        over_receipt_reason: null,
        lines: receiving.map((l, i) => {
          const received = num(l.todayRecd);
          // DIRECT: inspected at the processor — always Passed, nothing failed at our gate.
          const rejected = isDirect ? 0 : (l.fail?.qty ?? 0);
          const acc = acceptedFrom(received, rejected);
          // Only the PICKED bins are stored — the blank end row never is.
          const picked = pickedBins(l.bins);
          const split = picked.length > 1;
          return {
            po_line_item_id: l.poLineItemId,
            purchase_order_id: l.purchaseOrderId,
            description: l.description,
            received_qty: received,
            // Derived, never typed — and recomputed by the action regardless.
            accepted_qty: acc,
            rejected_qty: rejected,
            qc_status: isDirect ? "passed" : l.qcStatus,
            rejection_reason: isDirect ? null : l.fail?.reason || null,
            // A replacement's own failure is still owed on the same DC (the action re-forces it).
            rejection_action: isRepl ? "replace" : (l.fail?.action ?? "replace"),
            roll_batch_no: l.rollBatchNo.trim() || null,
            // PENDING QC (0791): the inspector picks the store and bin on Stores ▸ Pending QC.
            // DIRECT (0792): it lands in the Processing store — no store or bin of ours.
            store_id: isDirect || l.qcStatus === "pending" ? null : l.storeId || null,
            bin_id: isDirect || l.qcStatus === "pending" || split ? null : picked[0]?.binId || null,
            bins: !isDirect && l.qcStatus !== "pending" && split ? picked.map((b) => ({ bin_id: b.binId, qty: num(b.qty) })) : [],
            close_balance: !isRepl && l.closeBalance && received < l.pending,
            sort_order: i,
          };
        }),
        },
        { post: true },
      );

      if (result.ok) {
        setDirty(false);
        success("GRN posted — stock, PO balance and the draft bill are updated");
        router.push(`/purchase/grn/${result.grnId}`);
      } else {
        toastError(result.error);
      }
    });
  }

  /*
   * BESIDE THE PO RAIL (user 2026-11-02, Raise PO's layout): Item 176 · PO Qty 112 ·
   * Today Recd 112 (its Part / Full pill under the box) · QC 112 · Store · Bin 176 (one
   * line; the store and bins open in a pop-up) · Lot No 112 · Close bal. 88 = 888, + 40
   * chrome (the `#`; no ✕) = 928 — inside the ~1,000px the rail leaves at the operator's
   * 125% zoom. Was 1,128 across nine columns with no rail. tableFrom="5xl".
   */
  const grnLineColumns: ChildGridColumn<DraftLine>[] = [
    {
      header: "Item Description",
      width: FIELD_WIDTH_CSS.term,
      cell: (l) =>
        poIds.length > 1 ? (
          <div className="min-w-0 leading-tight">
            <Truncated className="text-sm">{l.description}</Truncated>
            <div className="font-mono text-[11px] text-muted-foreground">{l.poCode ?? ""}</div>
          </div>
        ) : (
          <Truncated className="text-sm">{l.description}</Truncated>
        ),
    },
    {
      // PO QTY AND ITS UNIT, and what is still pending for this GRN — one cell, two lines.
      header: isRepl ? "Owed" : "PO Qty",
      width: FIELD_WIDTH_CSS.range,
      align: "right",
      cell: (l) => (
        <div className="text-right leading-tight">
          <div className="tabular-nums text-sm">
            {fmtNumber(isRepl ? l.pending : l.ordered)} <span className="text-xs text-muted-foreground">{l.uomCode ?? ""}</span>
          </div>
          {isRepl ? null : (
            <div className="text-[11px] tabular-nums text-muted-foreground">pending {fmtNumber(l.pending)}</div>
          )}
        </div>
      ),
    },
    {
      header: "Today Recd",
      width: FIELD_WIDTH_CSS.range,
      cell: (l) => {
        const problem = excessProblem(l);
        return (
          <>
            {l.isYarn ? (
              /* BAGS × WEIGHT, above the kg they make — the order the keeper counts in.
                 The cursor lands on Bags; the weight is off the Tab path (arrows and the
                 mouse reach it), since it is usually the PO's and left alone. */
              <div className="mb-1 flex items-center gap-1 text-[11px] text-muted-foreground">
                <Input
                  type="number"
                  min={0}
                  step={1}
                  inputMode="numeric"
                  data-grn-today
                  aria-label={`No. of bags, ${l.description}`}
                  title="No. of bags"
                  placeholder="bags"
                  className="h-7 w-12 px-1 text-right text-xs tabular-nums"
                  value={l.bags}
                  onChange={(e) => updateLine(l.key, bagsPatch(l, { bags: e.target.value }))}
                />
                <span aria-hidden>×</span>
                <div data-focus-optional>
                  <Input
                    type="number"
                    min={0}
                    inputMode="decimal"
                    aria-label={`Avg bag weight in kg, ${l.description}`}
                    title="Avg bag weight (kg)"
                    className="h-7 w-12 px-1 text-right text-xs tabular-nums"
                    value={l.bagWt}
                    onChange={(e) => updateLine(l.key, bagsPatch(l, { bagWt: e.target.value }))}
                  />
                </div>
              </div>
            ) : null}
            <Input
              type="number"
              min={0}
              max={l.pending}
              inputMode="decimal"
              data-grn-today={l.isYarn ? undefined : true}
              aria-label={l.isYarn ? `Total kg, ${l.description}` : `Today Recd, ${l.description}`}
              aria-invalid={problem ? true : undefined}
              aria-describedby={problem ? `grn-today-${l.key}-error` : undefined}
              className="h-8 text-right tabular-nums"
              value={l.todayRecd}
              onChange={(e) => updateLine(l.key, l.isYarn ? kgPatch(l, e.target.value) : { todayRecd: e.target.value })}
            />
            <FieldError id={`grn-today-${l.key}-error`}>{problem}</FieldError>
            {/* PART / FULL / CLOSED — was its own Status column. */}
            {(() => {
              const st = lineStatus(l);
              return st ? (
                <div className="mt-0.5">
                  <StatusPill tone={st.tone}>{st.label}</StatusPill>
                </div>
              ) : null;
            })()}
          </>
        );
      },
    },
    {
      header: "QC",
      width: FIELD_WIDTH_CSS.range,
      // Off the typing path: the arrows and the mouse reach it, Tab steps over.
      cell: (l) =>
        isDirect ? (
          <span className="text-[11px] text-muted-foreground">Passed · at processor</span>
        ) : (
        <div data-focus-optional>
          <Select
            aria-label={`QC status, ${l.description}`}
            className="h-8"
            value={l.qcStatus}
            onChange={(e) => {
              const next = e.target.value as QcStatus;
              // FAILED ASKS FIRST (user 2026-10-31): Rejection or Replacement, in a popup.
              // The status only becomes Failed once the popup is confirmed.
              if (next === "failed") {
                setFailKey(l.key);
                setFailSeq((n) => n + 1);
                return;
              }
              updateLine(l.key, { qcStatus: next, fail: null });
            }}
          >
            {QC_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
          {l.fail ? (
            // button-shape: exempt -- an inline text link reopening the line's QC Failed choice
            <button
              type="button"
              tabIndex={-1}
              className="mt-0.5 block text-left text-[11px] text-danger hover:underline"
              onClick={() => {
                setFailKey(l.key);
                setFailSeq((n) => n + 1);
              }}
            >
              {fmtNumber(l.fail.qty)} {isRepl || l.fail.action === "replace" ? "Replacement" : "Rejection"}
            </button>
          ) : null}
          <FieldError id={`grn-fail-${l.key}-error`}>{failProblem(l)}</FieldError>
        </div>
        ),
    },
    {
      // ONE BIN, OR SPLIT ACROSS SEVERAL (0782): the split must hold exactly the
      // accepted qty.
      header: "Store · Bin",
      width: FIELD_WIDTH_CSS.term,
      cell: (l) => {
        // PENDING QC (0791): held out of stock — the inspector puts it away.
        if (isDirect) {
          const off = notOnOrder(l);
          return off ? (
            <span className="text-[11px] text-danger">{off}</span>
          ) : (
            <span className="text-[11px] text-muted-foreground">{procOrder?.code ?? "Process Order"}</span>
          );
        }
        if (l.qcStatus === "pending") {
          return <span className="text-[11px] text-muted-foreground">Store &amp; bin chosen at QC</span>;
        }
        // ONE LINE, EDITED IN A POP-UP (user 2026-11-02, screenshot 161807): the store
        // and its bin(s) — Bin 1 takes it all; lower it to open another (bin-split.ts).
        return (
          <StoreBinCell
            id={`grn-bins-${l.key}`}
            description={l.description}
            stores={stores}
            storeId={l.storeId}
            onStore={(v) => updateLine(l.key, { storeId: v })}
            rows={l.bins}
            onRow={(k, p) => updateSplit(l.key, k, p)}
            accepted={accepted(l)}
            uom={l.uomCode}
            bins={allBins}
            canCreateBin={canCreateBin}
            onBinCreated={(nb) => setAddedBins((xs) => [...xs, { id: nb.id, code: nb.code, description: null }])}
          />
        );
      },
    },
    {
      header: "Lot No",
      width: FIELD_WIDTH_CSS.range,
      cell: (l) => (
        <Input
          aria-label={`Lot No, ${l.description}`}
          className="h-8"
          value={l.rollBatchNo}
          onChange={(e) => updateLine(l.key, { rollBatchNo: e.target.value })}
        />
      ),
    },
    {
      // VENDOR WILL NOT SEND THE REST (0782): only offered while short of the balance.
      header: "Close bal.",
      width: FIELD_WIDTH_CSS.hug,
      cell: (l) => {
        const t = num(l.todayRecd);
        if (isRepl || t <= 0 || t >= l.pending - 1e-9) return null;
        return (
          <label data-focus-optional className="flex items-center gap-1 text-[11px]" title="The vendor will not send the rest — close the balance">
            <input
              type="checkbox"
              aria-label={`Close the balance of ${fmtNumber(l.pending - t)}, ${l.description}`}
              checked={l.closeBalance}
              onChange={(e) => updateLine(l.key, { closeBalance: e.target.checked })}
            />
            <span className="tabular-nums text-muted-foreground">{fmtNumber(round3(l.pending - t))}</span>
          </label>
        );
      },
    },
  ];

  const docLabel = docType === "invoice" ? "Invoice" : "DC";

  // ---------- the rail and the bottom bar ----------
  const ticked = poIds.map((id) => pos.get(id)).filter((p): p is NonNullable<typeof p> => !!p);
  const more = scopePos.filter((p) => !poIds.includes(p.id) && (poFilter.length === 0 || poFilter.includes(p.id)));
  const gridLines = selKey === "all" ? shownLines : shownLines.filter((l) => l.purchaseOrderId === selKey);
  /** Per ticked PO: lines receiving today / lines on screen, and any in red. */
  const poBadge = (id: string) => {
    const mine = shownLines.filter((l) => l.purchaseOrderId === id);
    const bad = mine.some((l) => num(l.todayRecd) > 0 && (excessProblem(l) || (!isDirect && (failProblem(l) || splitProblem(l))) || (isDirect && notOnOrder(l))));
    const recd = mine.filter((l) => num(l.todayRecd) > 0).length;
    return bad ? (
      <span className="shrink-0 rounded-full bg-[#fdecea] px-1.5 text-[11px] font-semibold text-[#b42318]">!</span>
    ) : (
      <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
        {recd}/{mine.length}
      </span>
    );
  };
  /* THE FIGURES: what is arriving, summed per unit (kg and pcs never add), and what is
     held for QC. */
  const byUom = new Map<string, number>();
  for (const l of receiving) byUom.set(l.uomCode ?? "", (byUom.get(l.uomCode ?? "") ?? 0) + num(l.todayRecd));
  const pendingQc = isDirect ? 0 : receiving.filter((l) => l.qcStatus === "pending").length;
  const hint: string | null = !location?.postable
    ? "Receive into the unit you are working in — pick it in the top bar"
    : isRepl && !repl
      ? "Pick the Replacement DC"
      : poIds.length === 0
        ? "Tick a PO on the left"
        : !docNo.trim() || !docDate
          ? `Enter the ${docType === "invoice" ? "Invoice" : "DC"} No and Date`
        : isDirect && (!deliveryVendorId || !processOrderId)
          ? "Pick the processor and its Process Order"
          : receiving.length === 0
            ? "Enter Today Recd on at least one line"
            : lineProblems
              ? "Fix the lines marked in red"
              : pendingQc > 0
                ? `Ready · ${pendingQc} line${pendingQc === 1 ? "" : "s"} go to Pending QC`
                : "Ready to post";
  const hintKind: HintKind = canSave ? "ready" : lineProblems ? "md" : "todo";
  const HINT = HINT_CHIP_TONES[hintKind];

  const grid = (
    /* A TIGHT SHEET, NOT BOXES IN CELLS (user 2026-11-02, screenshot 210433: "tight table
       layout like the costing sheet"): the app's sheet grid with flat cells — a ruled line
       between every cell and the field filling it (globals.css data-grid-cells="flat",
       Sample Entry ▸ Quantities). */
    <div ref={gridRef} className={DENSE} data-grid-style="sheet" data-grid-cells="flat">
      {/* default-row: exempt -- the rows are the picked POs' own lines, derived; nothing is added here */}
      <ChildGrid<DraftLine>
        columns={grnLineColumns}
        rows={gridLines}
        tableFrom="5xl"
        flatRows
        hideAdd
        hideRemove
        keepOne={false}
        onAdd={() => false}
        onRemove={() => {}}
        frameless
        headerClassName={GRID_HEAD}
      />
    </div>
  );

  return (
    // `data-grn-editor`: page.tsx hides the page's floating "← Back" while this is open (Raise PO's rule).
    <div data-focus-scope data-grn-editor>
      {/* ONE SURFACE, RAISE PO'S (user 2026-11-02, plan approved): title row · the vendor's
          paper · the pill row · the PO rail beside the lines · the bottom bar, parted by
          hairlines inside one frame. */}
      <div className={cn("max-w-[88rem]", DOC_FRAME)}>
        {/* TITLE ROW: the document, its number (given on save), its date, the unit. */}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-2 px-4 py-2.5">
          <h2 className="text-base font-bold">{isRepl ? "Replacement GRN" : "Goods Receipt Note"}</h2>
          {/* The seq_grn trigger numbers the GRN as it is saved — no number to show before. */}
          <span className={DOC_CHIP} title="The GRN No is given when it is saved">
            GRN No · on save
          </span>
          {/* THE GRN DATE IS THE DATE CHIP — today, and a click changes it. */}
          <label className={cn(DOC_CHIP, "inline-flex items-center gap-1 focus-within:border-[#037bb8]")} title="GRN date">
            <span className="sr-only">GRN Date</span>
            <input
              id="grn-date"
              type="date"
              max="9999-12-31"
              required
              aria-label="GRN Date"
              autoComplete="off"
              data-1p-ignore
              data-lpignore="true"
              data-form-type="other"
              className="h-5 bg-transparent text-xs tabular-nums text-foreground outline-none"
              value={grnDate}
              onChange={(e) => {
                touch();
                setGrnDate(e.target.value);
              }}
            />
          </label>
          {location?.postable ? (
            <span className={DOC_CHIP} title="Received into the unit you are working in">
              {location.name}
            </span>
          ) : (
            <span className="text-xs text-danger">No unit — pick your working unit in the top bar</span>
          )}
          {isRepl ? (
            <span className="ml-auto text-xs text-muted-foreground">
              Receives what a Replacement DC is owed · no new bill — the vendor&apos;s original invoice stands
            </span>
          ) : null}
        </div>

        {/* THE PILL ROW FIRST (user 2026-11-02, screenshot 3985: "move the filters to top and
            details as next"), then the vendor's paper. Raise PO's pills: Group Type → Buyer → Vendor* → Item Class → Order No →
            PO No, each counted in POs and narrowed by the others. PO No only narrows the rail;
            the tick in the rail is what puts a PO on the GRN. */}
        <div className={DOC_PILL_ROW}>
          {isRepl ? (
            <>
              <FilterPill id="grn-vendor" label="Vendor" family="vendor" icon={StoreIcon} required wide disabled options={vendorOptions} value={vendorId} onChange={() => {}} />
              <span className={DOC_CHIP}>Replacement DC · {repl?.code ?? "—"}</span>
            </>
          ) : (
            <>
              <FilterPill
                label="Group Type"
                family="order"
                icon={LayoutGrid}
                anyLabel="All"
                options={KIND_OPTIONS.map((k) => ({ value: k.value, label: k.label, count: kindCounts.get(k.value) ?? 0 }))}
                value={kind}
                onChange={(v) => setFacet("kind", v)}
              />
              <FilterPill
                label="Buyer"
                family="order"
                icon={User}
                wide
                anyLabel="All"
                options={buyerOptions}
                value={buyer}
                onChange={(v) => setFacet("buyer", v)}
              />
              <FilterPill
                id="grn-vendor"
                label="Vendor"
                family="vendor"
                icon={StoreIcon}
                required
                wide
                placeholder="Choose vendor"
                options={vendorOptions}
                value={vendorId}
                emptyText="No vendor has anything pending for these picks"
                onChange={(v) => setFacet("vendor", v)}
              />
              <FilterPill
                label="Item Class"
                family="item"
                icon={Layers}
                anyLabel="All"
                options={clsOptions}
                value={cls}
                onChange={(v) => setFacet("cls", v)}
              />
              <FilterPill
                label="Order No"
                family="order"
                icon={FileText}
                wide
                anyLabel="All"
                options={orderOptions}
                value={order}
                emptyText="No order has anything pending for these picks"
                onChange={(v) => setFacet("order", v)}
              />
              <FilterPill
                label="PO No"
                family="vendor"
                icon={Package}
                wide
                anyLabel="All"
                multiple
                options={poOptions}
                value={poFilter}
                emptyText="No PO has anything pending for these picks"
                onChange={(v) => setPoFilter(v)}
              />
            </>
          )}
        </div>

        {/* THE VENDOR'S PAPER, ONE ROW (user 2026-11-02, screenshot 3961: "make it in single
            row"): Doc Type 112 · No 144 · Date 144 · Vehicle 112 · Place of Delivery 176 — and,
            direct, Process Order 144 — Place of Delivery 200 holds the processor's name (typed to
            search). 112 + 144 + 144 + 112 + 200 + 144 = 856 + 5 × 12 = 916px.
            Each box is sized to its value; no error text under a field, so the labels stay on
            one line. */}
        <div className={cn(DOC_RULE, "px-4 py-2.5")}>
          <FieldRow>
            <Field label="Document Type" w="range" htmlFor="grn-doc-type">
              <Select id="grn-doc-type" value={docType} onChange={(e) => changeDocType(e.target.value as DocType)}>
                <option value="invoice">Invoice</option>
                <option value="dc">DC</option>
              </Select>
            </Field>
            {/* MANDATORY (user 2026-11-03: "invoice field required fields make it"): the vendor's
                paper is what the bill is matched against — a GRN without its No and Date cannot
                be settled. One declaration: the star, the cursor hold, Save, and createGrn. */}
            <Field label={`${docLabel} No`} required w="code" htmlFor="grn-doc-no">
              <Input
                id="grn-doc-no"
                value={docNo}
                onChange={(e) => {
                  touch();
                  setDocNo(e.target.value);
                }}
              />
            </Field>
            <Field label={`${docLabel} Date`} required w="code" htmlFor="grn-doc-date">
              <Input
                id="grn-doc-date"
                type="date"
                max="9999-12-31"
                value={docDate}
                onChange={(e) => {
                  touch();
                  setDocDate(e.target.value);
                }}
              />
            </Field>
            <Field label="Vehicle Ref" w="range" htmlFor="grn-vehicle">
              <Input
                id="grn-vehicle"
                value={vehicleRef}
                onChange={(e) => {
                  touch();
                  setVehicleRef(e.target.value);
                }}
              />
            </Field>
            {isRepl ? null : (
              /* PLACE OF DELIVERY IS TYPED TO SEARCH (user 2026-11-02): our unit's store, or a
                 processor with an open Process Order — picking one IS "direct to processor",
                 so there is no separate Processor box. Only real places: a typed name that is
                 neither is not a place stock can be booked to. */
              <Field label="Place of Delivery" required w="party" htmlFor="grn-delivery">
                <Combobox
                  id="grn-delivery"
                  options={placeOptions}
                  value={isDirect && deliveryVendorId ? `v:${deliveryVendorId}` : "store"}
                  openOnFocus={false}
                  onChange={(v) => {
                    touch();
                    if (!v || v === "store") {
                      setDeliveryKind("store");
                      setDeliveryVendorId("");
                      setProcessOrderId("");
                      return;
                    }
                    const vid = v.slice(2);
                    setDeliveryKind("direct");
                    setDeliveryVendorId(vid);
                    // One open order for that processor → it is the one.
                    const theirs = processOrders.filter((o) => o.vendor_id === vid);
                    setProcessOrderId(theirs.length === 1 ? theirs[0].id : "");
                  }}
                />
              </Field>
            )}
            {isDirect ? (
                <Field label="Process Order" required w="code" htmlFor="grn-process-order">
                  <Combobox
                    id="grn-process-order"
                    options={orderOptions2}
                    value={processOrderId}
                    openOnFocus={false}
                    onChange={(v) => {
                      touch();
                      setProcessOrderId(v);
                      const o = processOrders.find((x) => x.id === v);
                      if (o) setDeliveryVendorId(o.vendor_id);
                    }}
                  />
                </Field>
            ) : null}
          </FieldRow>
        </div>

        {/* THE LINES: the PO rail beside the grid (Raise PO's Orders rail). */}
        {isRepl ? (
          <div className={cn(DOC_RULE, "p-2")}>
            {lines.length === 0 ? (
              <p className="p-6 text-sm text-muted-foreground">Pick the Replacement DC and what it is owed loads here.</p>
            ) : (
              grid
            )}
          </div>
        ) : (
          <div className={cn(DOC_RULE, "md:grid md:grid-cols-[11.5rem_minmax(0,1fr)]")}>
            <nav aria-label="Purchase orders" className="border-b border-[#dde4eb] bg-[#fafbfc] md:border-r md:border-b-0">
              <div className="flex h-8 items-center gap-1.5 border-b border-[#dde4eb] bg-white px-2.5 text-xs whitespace-nowrap text-muted-foreground">
                <span className="font-semibold text-foreground">POs</span>
                <span className="tabular-nums">
                  {ticked.length + more.length}
                  {ticked.length ? ` · ${ticked.length} ✓` : ""}
                </span>
              </div>
              {ticked.length ? (
                <>
                  <RailSectionLabel>On this GRN</RailSectionLabel>
                  {ticked.map((p) => (
                    <RailTickRow
                      key={p.id}
                      on
                      active={selKey === p.id}
                      label={p.code ?? "(no number)"}
                      title={`${p.code ?? ""} · ${p.vendorName}`}
                      badge={poBadge(p.id)}
                      onTick={() => togglePo(p.id)}
                      onOpen={() => setSelKey(p.id)}
                    />
                  ))}
                  {ticked.length > 1 ? (
                    // button-shape: exempt -- a rail row, Raise PO's "All items together"
                    <button
                      type="button"
                      aria-current={selKey === "all" || undefined}
                      onClick={() => setSelKey("all")}
                      className={cn(
                        "flex h-8 w-full items-center gap-1.5 border-b border-[#dde4eb] px-2.5 text-left text-xs font-bold hover:bg-[#eef4f9]",
                        selKey === "all" && "bg-[#eef6fc] shadow-[inset_3px_0_0_#037bb8]",
                      )}
                    >
                      All lines together
                    </button>
                  ) : null}
                  {more.length ? <RailSectionLabel>More POs</RailSectionLabel> : null}
                </>
              ) : null}
              {more.map((p) => (
                <RailTickRow
                  key={p.id}
                  on={false}
                  active={false}
                  label={p.code ?? "(no number)"}
                  title={`${p.code ?? ""} · ${p.vendorName}`}
                  badge={vendorId ? null : <Truncated className="max-w-[5.5rem] text-[10.5px] text-muted-foreground">{p.vendorName}</Truncated>}
                  onTick={() => togglePo(p.id)}
                  onOpen={() => togglePo(p.id)}
                />
              ))}
              {ticked.length + more.length === 0 ? (
                <p className="px-3 py-4 text-sm text-muted-foreground">
                  {receivable.length === 0 ? "No approved PO has anything left to receive." : "No PO matches these picks."}
                </p>
              ) : null}
            </nav>
            <div className="min-w-0 p-2">
              {hiddenCount > 0 ? (
                <p className="px-1 pb-1 text-xs text-muted-foreground">
                  {hiddenCount} more line{hiddenCount === 1 ? "" : "s"} on the ticked PO{poIds.length === 1 ? "" : "s"} hidden by Item Class / Order No — not saved on this GRN
                </p>
              ) : null}
              {gridLines.length === 0 ? (
                <p className="grid h-full min-h-40 place-items-center p-6 text-center text-sm text-muted-foreground">
                  {poIds.length === 0
                    ? "Tick POs on the left. Their pending lines list here; type what arrived today."
                    : "Nothing pending on this PO for these picks."}
                </p>
              ) : (
                grid
              )}
            </div>
          </div>
        )}

        {/* THE BOTTOM BAR (Raise PO's): the figures, why Save waits, and the buttons — kept in
            view while the lines scroll. Enter off the last field and Ctrl+S press its LAST
            button (lib/focus.ts submitTargetOf), so Save sits after Cancel. */}
        <div className={DOC_BOTTOM_BAR} data-focus-region="footer">
          <dl className="flex items-center gap-3 text-[12.5px] whitespace-nowrap tabular-nums">
            <div className="flex items-baseline gap-1.5">
              <dt className="text-muted-foreground">Lines</dt>
              <dd className="font-semibold">{receiving.length}</dd>
            </div>
            {[...byUom.entries()].map(([uom, qty]) => (
              <div key={uom || "-"} className="flex items-center gap-3">
                <span aria-hidden className="h-4 w-px bg-[#dde4eb]" />
                <div className="flex items-baseline gap-1.5">
                  <dt className="text-muted-foreground">Recd</dt>
                  <dd className="font-semibold">
                    {fmtNumber(qty)} {uom}
                  </dd>
                </div>
              </div>
            ))}
            {pendingQc > 0 ? (
              <>
                <span aria-hidden className="h-4 w-px bg-[#dde4eb]" />
                <div className="flex items-baseline gap-1.5">
                  <dt className="text-muted-foreground">Pending QC</dt>
                  <dd className="font-semibold">{pendingQc}</dd>
                </div>
              </>
            ) : null}
          </dl>
          <div className="flex min-w-0 flex-1">
            {hint && !isPending ? (
              <span
                role="status"
                className={cn("inline-flex h-7 max-w-full min-w-0 items-center gap-1.5 rounded-full border px-2.5 text-[12px] font-medium", HINT.box)}
              >
                <span aria-hidden className={cn("size-2 shrink-0 rounded-full", HINT.dot)} />
                <Truncated className="min-w-0">{hint}</Truncated>
              </span>
            ) : null}
          </div>
          <Button variant="ghost" onClick={() => (onCancel ? onCancel() : router.push("/purchase/grn"))} disabled={isPending}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!canSave}>
            {isPending ? "Posting…" : "Save & Post GRN"}
          </Button>
        </div>
      </div>

      {failLine ? (
        <QcFailedSheet
          key={failSeq}
          open
          description={failLine.description}
          received={num(failLine.todayRecd)}
          initial={failLine.fail}
          isReplacement={isRepl}
          onClose={() => setFailKey(null)}
          onConfirm={(choice) => {
            updateLine(failLine.key, { qcStatus: "failed", fail: choice });
            setFailKey(null);
          }}
        />
      ) : null}
    </div>
  );
}
