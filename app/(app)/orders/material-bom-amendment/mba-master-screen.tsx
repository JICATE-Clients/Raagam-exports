"use client";

import { useCallback, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Boxes, Calculator, ClipboardList, Copy, Workflow } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Field, FieldGrid } from "@/components/ui/field";
import { ChildGrid, type ChildGridColumn } from "@/components/masters/child-grid";
import {
  MasterFullScreen,
  SectionBody,
  type FullScreenSection,
  type MasterFullScreenHandle,
} from "@/components/masters/master-full-screen";
import { PageHeader } from "@/components/ui/page-header";
import { DataTable, type Column } from "@/components/ui/data-table";
import { FilterBar } from "@/components/ui/filter-bar";
import { RowActions } from "@/components/ui/row-actions";
import { rowActionsColumn } from "@/components/ui/row-actions-column";
import { StatusPill } from "@/components/ui/status-pill";
import { useToast } from "@/components/ui/toast";
import { fmtDate, fmtNumber } from "@/lib/format";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { sectionValidity } from "@/lib/screens/validity";
import { RecordPicker } from "@/components/masters/record-picker";
import { NominatedVendorPicker } from "@/components/masters/nominated-vendor-picker";
import { nominatedVendorOptions } from "@/lib/masters/vendor-nominations";
import { LookupDialogPicker } from "@/components/masters/lookup-dialog-picker";
import { BomCopySheet, BomCopyConfirm } from "@/components/orders/bom-copy-sheet";
import {
  copyMaterialBomFrom,
  createMaterialBomAmendment,
  deleteMaterialBomAmendment,
  loadOrderProduction,
  updateMaterialBomAmendment,
} from "@/lib/orders/material-bom-amendment/actions";
import {
  MATERIAL_TYPE_OPTIONS,
  PROCESS_STATUS_OPTIONS,
  REQUIREMENT_BASIS_LABELS,
  SUPPLY_TYPE_OPTIONS,
  type BomCopySource,
  type MaterialBomAmendment,
} from "@/lib/orders/material-bom-amendment/types";
import {
  BOM_STATUSES,
  bomStatusHint,
  bomStatusText,
  bomStatusTone,
  type BomStatus,
} from "@/lib/orders/material-bom-amendment/status";
import type { BomTaskRow, MbaFormData } from "@/lib/orders/material-bom-amendment/service";
import { materialsForCategory } from "@/lib/orders/material-bom-amendment/material-options";
import {
  isRefusal,
  moqRollup,
  productionSlices,
  requirementFor,
  REQUIREMENT_BASES,
  type OrderProductionInput,
  type RequirementBasis,
} from "@/lib/orders/material-bom/requirement";
import {
  describeConversion,
  isUsableConversion,
  toPurchaseQty,
  uomPrecision,
} from "@/lib/uom/convert";
import { withCreatedColumns } from "@/components/ui/created-columns";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean };

interface Props {
  /** ONE ROW PER GARMENT ORDER — the work queue, not a list of documents. */
  tasks: BomTaskRow[];
  /** The BOM documents themselves, for opening one. */
  boms: MaterialBomAmendment[];
  copySources: BomCopySource[];
  data: MbaFormData;
  perms: Perms;
  /** masters:create/edit — gates inline Add/Modify inside config-list pickers. */
  masterPerms: { canCreate: boolean; canEdit: boolean };
}

type ItemRow = {
  key: string;
  category_id: string | null;
  type: string;
  item_id: string | null;
  /**
   * CARRIED, NOT SHOWN. The legacy "Attribute" picker was withdrawn by 0418 —
   * `requirement_basis` replaced it, because a `config_lookups` row whose one
   * live value is the word "STYLE" cannot drive arithmetic. The COLUMN and its
   * stored values are untouched, which is the withdrawal pattern AGENTS.md
   * records for `amend_type`.
   *
   * It has to be round-tripped rather than simply left out: `writeChildren`
   * deletes and reinserts every child row wholesale, so a value the form does
   * not hold is a value the next save destroys. "Leave the column alone" and
   * "drop it from the payload" are the same thing only on a table that is
   * UPDATEd.
   */
  attribute_id: string | null;
  /** The trim's colour, from the SAME list the garment's colours come from, so
   *  "match the thread to the fabric" is a comparison. BLANK ON A COLOUR-WISE
   *  LINE MEANS "matches the garment" — the ordinary case, and the reason the
   *  operator chose Color-wise at all (0419). */
  item_color_id: string | null;
  specification: string;
  size: string;
  requirement_basis: string;
  style_ref_no: string;
  /** The garment panel this material goes on (0423) — descriptive, see MbaItem. */
  component_id: string | null;
  supply_type: string;
  vendor_id: string | null;
  purchase_uom_id: string | null;
  consumption_uom_id: string | null;
  alternate_uom_id: string | null;
  /** The pack size this line buys (0348) — see MbaItem.uom_conversion_id. */
  uom_conversion_id: string | null;
  combination: string;
  moq: string;
  /** The NUMERATOR. */
  no_of_items: string;
  /** The DIVISOR. Never defaulted to 1 — see 0418. */
  per_pieces: string;
  excess_pct: string;
  required_by: string;
};

type ProcRow = {
  key: string;
  item_id: string | null;
  process_id: string | null;
  vendor_id: string | null;
  qty_out: string;
  qty_in: string;
  status: string;
};

type HeaderForm = {
  garment_order_id: string | null;
  amend_date: string;
  remarks: string;
};

const BLANK: HeaderForm = { garment_order_id: null, amend_date: "", remarks: "" };

const blankItem = (key: string): ItemRow => ({
  key,
  category_id: null,
  type: "",
  item_id: null,
  attribute_id: null,
  item_color_id: null,
  specification: "",
  size: "",
  requirement_basis: "",
  style_ref_no: "",
  component_id: null,
  supply_type: "",
  vendor_id: null,
  purchase_uom_id: null,
  consumption_uom_id: null,
  alternate_uom_id: null,
  uom_conversion_id: null,
  combination: "",
  moq: "",
  no_of_items: "",
  per_pieces: "",
  excess_pct: "",
  required_by: "",
});

const blankProc = (key: string): ProcRow => ({
  key,
  item_id: null,
  process_id: null,
  vendor_id: null,
  qty_out: "",
  qty_in: "",
  status: "planned",
});

const today = () => new Date().toISOString().slice(0, 10);
const numOrNull = (v: string) => (v.trim() === "" ? null : Number(v));

export function MbaMasterScreen({
  tasks,
  boms,
  copySources,
  data,
  perms,
  masterPerms,
}: Props) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, start] = useTransition();

  const [mode, setMode] = useState<"list" | "edit">("list");
  const [editId, setEditId] = useState<string | null>(null);
  const [amendmentNo, setAmendmentNo] = useState<number | null>(null);
  const [form, setForm] = useState<HeaderForm>(BLANK);
  const [items, setItems] = useState<ItemRow[]>([]);
  const [procs, setProcs] = useState<ProcRow[]>([]);
  const [dirty, setDirty] = useState(false);

  // The list's own filters. The screen had no Filters panel at all before, so an
  // operator with 200 orders had only the browser's find.
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"" | BomStatus>("");

  /**
   * The picked order's Approval Qty, Combos and Assort rows.
   *
   * Fetched once per ORDER, not per keystroke: the BOM line changes as the
   * operator types and the order's quantities do not, so the Requirement tab
   * recalculates locally against this. `null` while nothing is picked or the
   * fetch is in flight — the tab says which, rather than showing an empty table
   * that reads as "no material needed".
   */
  const [orderProd, setOrderProd] = useState<OrderProductionInput | null>(null);
  const [orderProdError, setOrderProdError] = useState<string | null>(null);
  const [loadingOrder, setLoadingOrder] = useState(false);

  const [copyOpen, setCopyOpen] = useState(false);
  const [pendingCopy, setPendingCopy] = useState<{
    items: ItemRow[];
    procs: ProcRow[];
    vendorsDropped: boolean;
  } | null>(null);

  const shellRef = useRef<MasterFullScreenHandle>(null);
  const keySeq = useRef(0);
  const newKey = () => `k${keySeq.current++}`;

  /**
   * UNSAVED WORK, DECLARED HERE BECAUSE THE OVERLAY CANNOT DECLARE IT.
   *
   * `MasterFullScreen` calls `useModalGuard(open)` on an overlay mount, and
   * `confirmDiscard()` deliberately does NOT read that one — an open overlay is
   * not the same thing as edited data. `dirty`, never `mode === "edit"`: keying
   * it on the editor being open pins the silent PWA auto-update off for as long
   * as the operator sits on the screen.
   */
  useUnsavedGuard(dirty || isPending);

  /**
   * The style a line names, and the panels it declares (0423).
   *
   * Narrowed HERE rather than in the service, per the cascading-picker rule: the
   * layer that knows which style the line names does the narrowing, and the line
   * may name none at all ("All styles"), which is a state only the row knows.
   */
  const styleOf = (ref: string) =>
    ref.trim() ? (selectedOrder?.styles ?? []).find((x) => x.ref === ref) : undefined;
  const componentsOf = (ref: string) => styleOf(ref)?.components ?? [];

  const materialCategories = useMemo(
    () => data.lookups.filter((l) => l.kind === "material_category"),
    [data.lookups],
  );

  /**
   * A line's Category cell narrows the Material picker beside it — the
   * cascading-filter rule, which this grid was breaking in its most literal
   * form: two facets side by side, one of them answering the other's question
   * and neither of them wired.
   *
   * `data.items` already arrives narrowed to accessories (the server refuses to
   * ship anything else); this is the second, per-line half, and it has to live
   * here because it depends on a cell the operator is still typing into.
   */
  const categoryCodeById = useMemo(
    () => new Map(materialCategories.map((c) => [c.id, c.code])),
    [materialCategories],
  );
  const materialsFor = (categoryId: string | null, currentValue: string | null) =>
    materialsForCategory(data.items, {
      categoryCode: categoryId ? categoryCodeById.get(categoryId) : null,
      currentValue,
    });

  /**
   * The SAME colour list the garment's own colours come from (kind
   * `fabric_color`, 0415). One vocabulary is what makes "match the thread to the
   * fabric" a comparison rather than a reconciliation of two spellings — the
   * failure AGENTS.md records under Nominated vendors, where "Nominated" and
   * "nominated" compile, run and quietly match nothing.
   */
  const itemColours = useMemo(
    () => data.lookups.filter((l) => l.kind === "fabric_color"),
    [data.lookups],
  );

  const selectedOrder = useMemo(
    () => data.orders.find((o) => o.id === form.garment_order_id) ?? null,
    [data.orders, form.garment_order_id],
  );

  /** The customer is the ORDER's, never typed here. A BOM belongs to whoever the
   *  order belongs to, and a second copy of that fact is a second thing to keep
   *  true — it also feeds the nominated-vendor rule below. */
  const customerId = selectedOrder?.customer_id ?? null;
  const customerName = selectedOrder?.customer_name ?? null;

  const vendorRule = {
    customerId,
    customerName,
    vendors: data.vendors,
    nominations: data.nominations,
  };

  const orderItems = useMemo(
    () =>
      data.orders.map((o) => ({
        id: o.id,
        code: o.sc_no ?? o.code,
        name: o.customer_name ?? "—",
      })),
    [data.orders],
  );

  // Every mutation marks the record dirty in the same breath as changing it, so
  // the flag cannot drift from the state it describes.
  const set = (patch: Partial<HeaderForm>) => {
    setForm((f) => ({ ...f, ...patch }));
    setDirty(true);
  };
  const mutItems = (fn: (xs: ItemRow[]) => ItemRow[]) => {
    setItems(fn);
    setDirty(true);
  };
  const mutProcs = (fn: (xs: ProcRow[]) => ProcRow[]) => {
    setProcs(fn);
    setDirty(true);
  };
  const updItem = (key: string, patch: Partial<ItemRow>) =>
    mutItems((xs) => xs.map((x) => (x.key === key ? { ...x, ...patch } : x)));
  const updProc = (key: string, patch: Partial<ProcRow>) =>
    mutProcs((xs) => xs.map((x) => (x.key === key ? { ...x, ...patch } : x)));

  /** Load an order's production rows. Failure leaves `orderProd` null and SAYS
   *  so; a silent null would render as "nothing to plan against". */
  const pullOrder = useCallback(
    (orderId: string | null) => {
      setOrderProd(null);
      setOrderProdError(null);
      if (!orderId) return;
      setLoadingOrder(true);
      void loadOrderProduction(orderId)
        .then((res) => {
          if (res.ok) setOrderProd(res.order);
          else setOrderProdError(res.error);
        })
        .finally(() => setLoadingOrder(false));
    },
    [],
  );

  const pickOrder = (id: string | null) => {
    set({ garment_order_id: id });
    pullOrder(id);
  };

  // ---------------- OPENING ----------------

  function openAdd(orderId?: string | null) {
    setEditId(null);
    setAmendmentNo(null);
    setForm({ ...BLANK, amend_date: today(), garment_order_id: orderId ?? null });
    setItems([blankItem(newKey())]);
    setProcs([blankProc(newKey())]);
    setPendingCopy(null);
    setDirty(false);
    setMode("edit");
    pullOrder(orderId ?? null);
  }

  function openEdit(r: MaterialBomAmendment) {
    setEditId(r.id);
    setAmendmentNo(r.amendment_no);
    setForm({
      garment_order_id: r.garment_order_id,
      amend_date: r.amend_date ?? today(),
      remarks: r.remarks ?? "",
    });
    setItems(
      r.items.map((c) => ({
        key: newKey(),
        category_id: c.category_id,
        type: c.type ?? "",
        item_id: c.item_id,
        attribute_id: c.attribute_id,
        item_color_id: c.item_color_id,
        specification: c.specification ?? "",
        size: c.size ?? "",
        requirement_basis: c.requirement_basis ?? "",
        style_ref_no: c.style_ref_no ?? "",
        component_id: c.component_id,
        supply_type: c.supply_type ?? "",
        vendor_id: c.vendor_id,
        purchase_uom_id: c.purchase_uom_id,
        consumption_uom_id: c.consumption_uom_id,
        alternate_uom_id: c.alternate_uom_id,
        uom_conversion_id: c.uom_conversion_id,
        combination: c.combination ?? "",
        moq: c.moq != null ? String(c.moq) : "",
        no_of_items: c.no_of_items != null ? String(c.no_of_items) : "",
        per_pieces: c.per_pieces != null ? String(c.per_pieces) : "",
        excess_pct: c.excess_pct != null ? String(c.excess_pct) : "",
        required_by: c.required_by ?? "",
      })),
    );
    setProcs(
      r.processes.map((p) => ({
        key: newKey(),
        item_id: p.item_id,
        process_id: p.process_id,
        vendor_id: p.vendor_id,
        qty_out: p.qty_out != null ? String(p.qty_out) : "",
        qty_in: p.qty_in != null ? String(p.qty_in) : "",
        status: p.status ?? "planned",
      })),
    );
    setPendingCopy(null);
    setDirty(false);
    setMode("edit");
    pullOrder(r.garment_order_id);
  }

  /** Open the BOM this order already has, or start one for it. The dashboard row
   *  is an ORDER, so a click has to resolve to whichever it is. */
  function openTask(t: BomTaskRow) {
    const bom = t.bom_id ? boms.find((b) => b.id === t.bom_id) : null;
    if (bom) openEdit(bom);
    else if (perms.canCreate) openAdd(t.id);
    else toastError("You cannot create a material BOM");
  }

  // ---------------- COPY ----------------

  const rowsFilled = items.some((r) => r.item_id) || procs.some((r) => r.item_id);

  function applyCopy(next: { items: ItemRow[]; procs: ProcRow[]; vendorsDropped: boolean }) {
    setItems(next.items);
    setProcs(next.procs.length ? next.procs : [blankProc(newKey())]);
    setDirty(true);
    setPendingCopy(null);
    success(
      next.vendorsDropped
        ? "Material list copied — vendors were left blank, they are nominated per customer"
        : "Material list copied",
    );
  }

  function pickCopySource(bomId: string) {
    start(async () => {
      const res = await copyMaterialBomFrom(bomId, customerId);
      if (!res.ok) {
        // NOTHING IS APPLIED ON FAILURE. A half-filled set of grids is worse
        // than none — the same call `amendment-screen.tsx` makes for its seed.
        toastError(res.error);
        return;
      }
      setCopyOpen(false);
      const next = {
        items: res.payload.items.map((c) => ({
          key: newKey(),
          category_id: c.category_id ?? null,
          type: c.type ?? "",
          item_id: c.item_id ?? null,
          attribute_id: c.attribute_id ?? null,
          item_color_id: c.item_color_id ?? null,
          specification: c.specification ?? "",
          size: c.size ?? "",
          requirement_basis: c.requirement_basis ?? "",
          style_ref_no: "",
          // The panel is a property of THIS order's style, and copy deliberately
          // drops the style ref (a source order's styles are not this one's), so
          // the component it named cannot travel either.
          component_id: null,
          supply_type: c.supply_type ?? "",
          vendor_id: c.vendor_id ?? null,
          purchase_uom_id: c.purchase_uom_id ?? null,
          consumption_uom_id: c.consumption_uom_id ?? null,
          alternate_uom_id: c.alternate_uom_id ?? null,
          uom_conversion_id: c.uom_conversion_id ?? null,
          combination: c.combination ?? "",
          moq: c.moq != null ? String(c.moq) : "",
          no_of_items: c.no_of_items != null ? String(c.no_of_items) : "",
          per_pieces: c.per_pieces != null ? String(c.per_pieces) : "",
          excess_pct: c.excess_pct != null ? String(c.excess_pct) : "",
          required_by: "",
        })),
        procs: res.payload.processes.map((p) => ({
          key: newKey(),
          item_id: p.item_id ?? null,
          process_id: p.process_id ?? null,
          vendor_id: p.vendor_id ?? null,
          qty_out: "",
          qty_in: "",
          status: "planned",
        })),
        vendorsDropped: res.payload.vendorsDropped,
      };
      // Ask before overwriting work already on screen; apply straight away when
      // there is none.
      if (rowsFilled) setPendingCopy(next);
      else applyCopy(next);
    });
  }

  // ---------------- SAVE ----------------

  function submit(asDraft: boolean) {
    const payload = {
      garment_order_id: form.garment_order_id,
      customer_id: customerId,
      amend_date: form.amend_date,
      remarks: form.remarks || null,
      is_draft: asDraft,
      items: items.map((c) => ({
        sno: 0,
        category_id: c.category_id,
        type: c.type || null,
        item_id: c.item_id,
        attribute_id: c.attribute_id,
        item_color_id: c.item_color_id,
        specification: c.specification || null,
        size: c.size || null,
        requirement_basis: (c.requirement_basis || null) as RequirementBasis | null,
        style_ref_no: c.style_ref_no || null,
        component_id: c.component_id,
        supply_type: c.supply_type || null,
        vendor_id: c.vendor_id,
        purchase_uom_id: c.purchase_uom_id,
        consumption_uom_id: c.consumption_uom_id,
        alternate_uom_id: c.alternate_uom_id,
        uom_conversion_id: c.uom_conversion_id,
        combination: c.combination || null,
        moq: numOrNull(c.moq),
        no_of_items: numOrNull(c.no_of_items),
        per_pieces: numOrNull(c.per_pieces),
        excess_pct: numOrNull(c.excess_pct) ?? 0,
        required_by: c.required_by || null,
      })),
      processes: procs.map((p) => ({
        sno: 0,
        item_id: p.item_id,
        process_id: p.process_id,
        vendor_id: p.vendor_id,
        qty_out: numOrNull(p.qty_out),
        qty_in: numOrNull(p.qty_in),
        status: p.status as "planned" | "sent" | "part_received" | "received",
      })),
    };
    start(async () => {
      const res = editId
        ? await updateMaterialBomAmendment(editId, payload)
        : await createMaterialBomAmendment(payload);
      if (res.ok) {
        success(editId ? "Material BOM updated" : "Material BOM created");
        setDirty(false);
        setMode("list");
        router.refresh();
      } else {
        toastError(res.error);
      }
    });
  }

  function del(t: BomTaskRow) {
    if (!t.bom_id) return;
    /* No confirm() — <RowActions> asks in the row (LAYOUT.md §6a). */
    start(async () => {
      const res = await deleteMaterialBomAmendment(t.bom_id as string);
      if (res.ok) {
        success("Material BOM deleted");
        router.refresh();
      } else {
        toastError(res.error);
      }
    });
  }

  // ---------------- THE DASHBOARD ----------------

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return tasks.filter((t) => {
      if (statusFilter && t.status !== statusFilter) return false;
      if (!needle) return true;
      return [t.sc_no, t.order_code, t.po_no, t.customer_name].some((v) =>
        (v ?? "").toLowerCase().includes(needle),
      );
    });
  }, [tasks, query, statusFilter]);

  const columns: Column<BomTaskRow>[] = [
    {
      header: "SC No",
      cell: (t) => (
        <button
          type="button"
          onClick={() => openTask(t)}
          className="font-mono text-xs font-medium text-primary hover:underline"
        >
          {t.sc_no ?? t.order_code ?? "—"}
        </button>
      ),
    },
    { header: "Customer", cell: (t) => <span className="text-sm">{t.customer_name ?? "—"}</span> },
    {
      header: "PO No",
      cell: (t) => <span className="font-mono text-xs">{t.po_no ?? "—"}</span>,
    },
    {
      header: "Styles",
      align: "right",
      cell: (t) => <span className="tabular-nums text-sm">{t.style_count}</span>,
    },
    {
      header: "Production",
      align: "right",
      // The multiplier every requirement on this order is built from. A refusal
      // prints its sentence rather than a dash: "no production quantity yet" and
      // "nothing entered" look identical as a dash, and only one is actionable.
      cell: (t) =>
        t.production_qty != null ? (
          <span className="tabular-nums text-sm">{fmtNumber(t.production_qty)}</span>
        ) : (
          <span className="text-xs text-muted-foreground">{t.production_refusal ?? "—"}</span>
        ),
    },
    {
      header: "Delivery",
      align: "right",
      cell: (t) => (
        <span className="tabular-nums text-xs text-muted-foreground">
          {t.delivery_date ? fmtDate(t.delivery_date) : "—"}
        </span>
      ),
    },
    {
      header: "Material BOM",
      cell: (t) => (
        <span title={bomStatusHint(t.status, t.production_qty)}>
          <StatusPill tone={bomStatusTone(t.status)}>{bomStatusText(t.status)}</StatusPill>
        </span>
      ),
    },
    rowActionsColumn((t) => (
      <RowActions
        label={t.sc_no ?? t.order_code}
        onEdit={() => openTask(t)}
        canEdit={perms.canEdit}
        onDelete={t.bom_id ? () => del(t) : undefined}
        canDelete={perms.canDelete && !!t.bom_id}
        isPending={isPending}
      />
    )),
  ];

  // ---------------- THE EDITOR ----------------

  const itemName = (id: string | null) => data.items.find((i) => i.id === id)?.name ?? "—";
  const uomName = (id: string | null) => data.uoms.find((u) => u.id === id)?.name ?? "—";
  const colourName = (id: string | null) =>
    itemColours.find((c) => c.id === id)?.name ?? null;

  /**
   * What colour this requirement row is actually for.
   *
   * A TYPED COLOUR WINS: it is a contrast trim, the same on every row. With none
   * typed, a Color-wise line takes the garment's combo — which is the whole
   * reason the operator chose Color-wise, and the one case where the answer
   * differs row by row. Anything else has no colour to state.
   */
  const colourOf = (r: ItemRow, slice: { combo: string | null }) =>
    colourName(r.item_color_id) ??
    (r.requirement_basis === "colour" ? (slice.combo ?? "—") : "—");

  /** Pack sizes defined on a material, for that BOM line's pack picker. Empty
   *  means the material has no conversions — the ~90% bought in the unit they
   *  are consumed in, or one whose master hasn't been filled in yet. */
  const packsFor = (itemId: string | null) =>
    itemId ? data.conversions.filter((c) => c.item_id === itemId && isUsableConversion(c)) : [];
  const packById = (id: string | null) =>
    id ? (data.conversions.find((c) => c.id === id) ?? null) : null;
  /** `decimal_places_allowed` (0309), not `decimal_places` (0224) — the latter is
   *  0 on every row in the live DB and would round 16.67 Gross to 17, the
   *  round-up the client rejected. `uomPrecision` clamps it either way. */
  const uomDecimals = (id: string | null) =>
    data.uoms.find((u) => u.id === id)?.decimal_places_allowed ?? null;

  /**
   * The Requirement tab, computed live from the SAME functions the server uses
   * on save. That is what stops what the operator approved from differing from
   * what is stored.
   */
  type ReqRow = {
    key: string;
    material: string;
    basis: string;
    slice: string;
    colour: string;
    production: number | null;
    required: number | null;
    refusal: string | null;
    uom: string;
    purchase: number | null;
    purchaseUom: string;
  };

  /** The grid's read-only Calculated Quantity: one line's requirement summed
   *  across every slice it explodes into. It is also the figure MOQ is compared
   *  against — a minimum is per ORDER, never per colour row. */
  type LineTotal = { total: number | null; refusal: string | null; uom: string };

  const { reqRows, lineTotals } = useMemo((): {
    reqRows: ReqRow[];
    lineTotals: Map<string, LineTotal>;
  } => {
    const totals = new Map<string, LineTotal>();
    if (!orderProd) return { reqRows: [], lineTotals: totals };
    const out: ReqRow[] = [];

    for (const r of items) {
      if (!r.item_id) continue;
      const material = itemName(r.item_id);
      const basisLabel = r.requirement_basis
        ? REQUIREMENT_BASIS_LABELS[r.requirement_basis as RequirementBasis]
        : "—";

      const push = (over: Partial<ReqRow>) =>
        out.push({
          key: `${r.key}:${out.length}`,
          material,
          basis: basisLabel,
          slice: "—",
          colour: "—",
          production: null,
          required: null,
          refusal: null,
          uom: uomName(r.consumption_uom_id),
          purchase: null,
          purchaseUom: "—",
          ...over,
        });

      const uomLabel = uomName(r.consumption_uom_id);

      if (!r.requirement_basis) {
        push({ refusal: "Choose how this material splits" });
        totals.set(r.key, {
          total: null,
          refusal: "Choose how this material splits",
          uom: uomLabel,
        });
        continue;
      }

      const slices = productionSlices(r.requirement_basis as RequirementBasis, orderProd);
      if (isRefusal(slices)) {
        push({ refusal: slices.refused });
        totals.set(r.key, { total: null, refusal: slices.refused, uom: uomLabel });
        continue;
      }

      const pack = packById(r.uom_conversion_id);
      // The pack must convert INTO the unit this line is consumed in. A cone of
      // metres against a line counted in pieces yields a number and a category
      // error — so the purchase figure refuses while the requirement stands.
      const packUsable =
        !!pack &&
        isUsableConversion(pack) &&
        (!r.consumption_uom_id || pack.base_uom_id === r.consumption_uom_id);

      // A LINE TOTAL REFUSES IF ANY SLICE DOES. Summing the slices that answered
      // gives a smaller number that reads as correct — the partial-sum failure
      // `order-value.ts` records for a half-priced style.
      let lineTotal: number | null = 0;
      let lineRefusal: string | null = null;

      for (const slice of slices) {
        const value = requirementFor(
          {
            no_of_items: numOrNull(r.no_of_items),
            per_pieces: numOrNull(r.per_pieces),
            excess_pct: numOrNull(r.excess_pct) ?? 0,
            decimals: uomDecimals(r.consumption_uom_id),
          },
          slice,
        );
        const refused = isRefusal(value);
        const qty = refused ? null : value;
        if (refused) {
          lineTotal = null;
          lineRefusal ??= value.refused;
        } else if (lineTotal != null) {
          lineTotal += qty as number;
        }
        push({
          slice: slice.label,
          colour: colourOf(r, slice),
          production: slice.qty,
          required: qty,
          refusal: refused ? value.refused : null,
          purchase:
            qty != null && packUsable && pack
              ? toPurchaseQty(qty, pack, uomPrecision(uomDecimals(pack.alt_uom_id)))
              : null,
          purchaseUom: packUsable && pack ? uomName(pack.alt_uom_id) : "—",
        });
      }

      // MOQ is applied to the LINE, not to a slice. A colour explosion makes six
      // rows for one material; an MOQ of 500 per row orders 3,000 of something
      // the order needs 100 of.
      const moq = numOrNull(r.moq);
      const unitKnown = !!r.purchase_uom_id || !!r.consumption_uom_id;
      let shown = lineTotal;
      let refusal = lineRefusal;
      if (lineTotal != null && moq != null && moq > 0) {
        const roll = moqRollup([lineTotal], moq, unitKnown);
        if (isRefusal(roll)) refusal = roll.refused;
        else shown = roll.afterMoq;
      }
      totals.set(r.key, { total: refusal ? null : shown, refusal, uom: uomLabel });
    }
    return { reqRows: out, lineTotals: totals };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, orderProd, data.items, data.uoms, data.conversions]);

  /**
   * WHAT IS STOPPING A SAVE, AND WHICH SECTION HOLDS IT — derived, never
   * hand-assembled. The two entries mirror the `required` props on the fields
   * below, so the red `*`, the cursor hold and this list cannot disagree.
   *
   * NO `problems` BADGE ON THE RAIL (operator request, 2026-08-10): the sections
   * pass `done`, not `problems`. `onBlockedSave` is what replaces it — Save stays
   * clickable and explains itself instead of going silently dead.
   */
  const validity = sectionValidity({
    sections: [{ key: "bom" }, { key: "items" }, { key: "processes" }, { key: "requirement" }],
    values: form,
    fields: [
      { section: "bom", id: "mba-date", label: "Date", required: true, empty: (f) => !f.amend_date },
      {
        section: "bom",
        id: "mba-order",
        label: "Garment Order",
        required: true,
        empty: (f) => !f.garment_order_id,
      },
    ],
  });

  const revealFirstProblem = () => {
    const p = validity.first;
    if (!p) return;
    toastError(p.message);
    shellRef.current?.goToSection(p.section, p.fieldId ? { fieldId: p.fieldId } : "problem");
  };

  // ---- the item grid ---------------------------------------------------------
  const itemColumns: ChildGridColumn<ItemRow>[] = [
    {
      header: "Category",
      className: "min-w-[150px]",
      cell: (r) => (
        <LookupDialogPicker
          kind="material_category"
          label="Category"
          options={materialCategories}
          value={r.category_id}
          onChange={(id) => updItem(r.key, { category_id: id })}
          canCreate={masterPerms.canCreate}
          canEdit={masterPerms.canEdit}
          compact
        />
      ),
    },
    {
      header: "Material",
      className: "min-w-[160px]",
      required: true,
      cell: (r) => (
        <RecordPicker
          label="Material"
          items={materialsFor(r.category_id, r.item_id)}
          value={r.item_id}
          onChange={(id) => updItem(r.key, { item_id: id })}
          required
          compact
        />
      ),
    },
    {
      header: "Item Color",
      className: "min-w-[150px]",
      // Same list as the garment's colours, so matching is expressible. The
      // placeholder is doing real work: on a Color-wise line an EMPTY cell means
      // "takes the garment's colour", which is a decision, not a gap.
      cell: (r) => (
        <LookupDialogPicker
          kind="fabric_color"
          label="Item Color"
          options={itemColours}
          value={r.item_color_id}
          onChange={(id) => updItem(r.key, { item_color_id: id })}
          canCreate={masterPerms.canCreate}
          canEdit={masterPerms.canEdit}
          compact
        />
      ),
    },
    {
      header: "Specification",
      className: "min-w-[140px]",
      // CAPS, both halves: `uppercase` uppercases the keystroke AND applies the
      // CSS transform that fixes rows saved before the rule, while the Zod
      // schema transforms the write so a data-io import cannot slip past.
      cell: (r) => (
        <Input
          uppercase
          value={r.specification}
          onChange={(e) => updItem(r.key, { specification: e.target.value })}
          className="h-8"
          placeholder="WOVEN 2-FOLD"
        />
      ),
    },
    {
      header: "Size",
      className: "min-w-[120px]",
      // The MATERIAL's size — 50MM X 20MM, 12 INCH, 24 LIGNE. NOT the garment
      // size: a Size-wise line already explodes along that axis, and putting
      // both meanings on one field is how the two collide.
      cell: (r) => (
        <Input
          uppercase
          value={r.size}
          onChange={(e) => updItem(r.key, { size: e.target.value })}
          className="h-8"
          placeholder="50MM X 20MM"
        />
      ),
    },
    {
      header: "Attribute",
      className: "min-w-[130px]",
      // The legacy "Attribute" column. It is what decides whether this material
      // is bought once for the order, once per colour, or once per size — so it
      // is a CHECKed enum, not the free `material_attribute` lookup that used to
      // sit here and whose one live row is the word "STYLE" (0418).
      required: true,
      cell: (r) => (
        <Select
          value={r.requirement_basis}
          onChange={(e) => updItem(r.key, { requirement_basis: e.target.value })}
          className="h-8"
          required
        >
          <option value="">—</option>
          {REQUIREMENT_BASES.map((b) => (
            <option key={b} value={b}>
              {REQUIREMENT_BASIS_LABELS[b]}
            </option>
          ))}
        </Select>
      ),
    },
    {
      header: "Style",
      className: "min-w-[130px]",
      // Blank means every style on the order — the common case, which is why it
      // is not required.
      //
      // THE UNIT RIDES UNDER IT (0423). "1 per piece" on a two-garment Set means
      // something different from "1 per piece" on a single top, and `per_pieces`
      // is typed by the operator — so the fact is SHOWN and never computed with.
      // Turning it into arithmetic would silently double or halve a requirement
      // the operator thought they had entered.
      cell: (r) => {
        const st = styleOf(r.style_ref_no);
        return (
          <div className="space-y-0.5">
            <Select
              value={r.style_ref_no}
              onChange={(e) =>
                updItem(r.key, {
                  style_ref_no: e.target.value,
                  // The panel belongs to the style. Changing the style must drop
                  // a component the new one does not declare — the
                  // cascading-filter rule's "clear a held value ONLY when it
                  // really is out of scope".
                  ...(r.component_id &&
                  !componentsOf(e.target.value).some((c) => c.id === r.component_id)
                    ? { component_id: null }
                    : {}),
                })
              }
              className="h-8"
            >
              <option value="">All styles</option>
              {(selectedOrder?.styles ?? []).map((x) => (
                <option key={x.ref} value={x.ref}>
                  {x.ref}
                </option>
              ))}
            </Select>
            {st?.unit_kind && (
              <span className="block text-[11px] leading-tight text-muted-foreground">
                {st.unit_kind.toUpperCase() === "SET" ? "Set (multi-garment)" : "Piece"}
              </span>
            )}
          </div>
        );
      },
    },
    {
      header: "Component",
      className: "min-w-[140px]",
      /**
       * WHICH PANEL the material goes on (0423) — "interlining or specialized
       * tapes are only required for specific parts of the garment" (client
       * 2026-08-13).
       *
       * DESCRIPTIVE, and that is the client's own call over the alternative: it
       * does not split the requirement, because one collar interlining is needed
       * per garment whichever panel it is cut for. `requirement_basis` is
       * untouched and the requirement table has no component column — 0423
       * asserts that, since the decision is only safe while it holds.
       *
       * Empty-and-explain, twice over: a line on "All styles" has no panel list
       * to offer, and a style that declares no components has none either. Both
       * say which case it is rather than showing an empty dropdown, which reads
       * as "the master is empty" — a different and more alarming thing.
       */
      cell: (r) => {
        const opts = componentsOf(r.style_ref_no);
        return (
          <RecordPicker
            label="Component"
            items={opts}
            value={r.component_id}
            onChange={(id) => updItem(r.key, { component_id: id })}
            disabled={!r.style_ref_no.trim() || opts.length === 0}
            placeholder={
              !r.style_ref_no.trim()
                ? "Pick a style first"
                : opts.length === 0
                  ? "This style declares no parts"
                  : "— Whole garment —"
            }
            compact
          />
        );
      },
    },
    {
      header: "Type",
      className: "min-w-[110px]",
      cell: (r) => (
        <Select
          value={r.type}
          onChange={(e) => updItem(r.key, { type: e.target.value })}
          className="h-8"
        >
          <option value="">—</option>
          {MATERIAL_TYPE_OPTIONS.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </Select>
      ),
    },
    {
      header: "Supply Type",
      className: "min-w-[120px]",
      cell: (r) => (
        <Select
          value={r.supply_type}
          // Changing the type drops a vendor the new type no longer allows.
          // Leaving it would show a value the reopened picker no longer offers —
          // the row would look valid and save a vendor the rule forbids. Asked of
          // the SAME function that builds the picker's options.
          onChange={(e) => {
            const supply_type = e.target.value;
            const { items: allowed } = nominatedVendorOptions({
              ...vendorRule,
              supplyType: supply_type,
            });
            const keepVendor = !r.vendor_id || allowed.some((v) => v.id === r.vendor_id);
            updItem(r.key, keepVendor ? { supply_type } : { supply_type, vendor_id: null });
          }}
          className="h-8"
        >
          <option value="">—</option>
          {SUPPLY_TYPE_OPTIONS.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </Select>
      ),
    },
    {
      header: "Vendor",
      className: "min-w-[150px]",
      // Narrowed per ROW, not per grid: two lines of one BOM can carry different
      // supply types.
      cell: (r) => (
        <NominatedVendorPicker
          {...vendorRule}
          supplyType={r.supply_type}
          value={r.vendor_id}
          onChange={(id) => updItem(r.key, { vendor_id: id })}
          compact
        />
      ),
    },
    {
      header: "No. of Items",
      align: "right",
      className: "min-w-[6rem]",
      required: true,
      // The NUMERATOR of the client's ratio: 2 labels per 1 piece.
      cell: (r) => (
        <Input
          type="number"
          min="0"
          step="0.001"
          value={r.no_of_items}
          onChange={(e) => updItem(r.key, { no_of_items: e.target.value })}
          className="h-8 text-right"
          required
        />
      ),
    },
    {
      header: "Per Pieces",
      align: "right",
      className: "min-w-[6rem]",
      required: true,
      // The DIVISOR: 1 metre makes 4 pieces. NOT defaulted to 1 anywhere — an
      // unfinished line must not compute a number that reaches a purchase order.
      cell: (r) => (
        <Input
          type="number"
          min="0"
          step="0.001"
          value={r.per_pieces}
          onChange={(e) => updItem(r.key, { per_pieces: e.target.value })}
          className="h-8 text-right"
          required
        />
      ),
    },
    {
      header: "Excess %",
      align: "right",
      className: "min-w-[6rem]",
      // THE CLIENT'S WORD, and it collides with one on the ORDER. The order's
      // own Excess % is already inside the production quantity this multiplies,
      // so the two must never be added together. They are on different screens,
      // which is what makes the shared name survivable — but the header strip on
      // the first section states the order's figure explicitly, so an operator
      // can see that this box is a SECOND buffer rather than the same one.
      cell: (r) => (
        <Input
          type="number"
          min="0"
          max="100"
          step="0.01"
          value={r.excess_pct}
          onChange={(e) => updItem(r.key, { excess_pct: e.target.value })}
          className="h-8 text-right"
        />
      ),
    },
    {
      header: "Consumption Uom",
      className: "min-w-[130px]",
      cell: (r) => (
        <RecordPicker
          label="Consumption Uom"
          items={data.uoms}
          value={r.consumption_uom_id}
          onChange={(id) => updItem(r.key, { consumption_uom_id: id })}
          compact
        />
      ),
    },
    {
      header: "Purchase Uom",
      className: "min-w-[130px]",
      cell: (r) => (
        <RecordPicker
          label="Purchase Uom"
          items={data.uoms}
          value={r.purchase_uom_id}
          onChange={(id) => updItem(r.key, { purchase_uom_id: id })}
          compact
        />
      ),
    },
    {
      header: "Alternate Uom",
      className: "min-w-[130px]",
      cell: (r) => (
        <RecordPicker
          label="Alternate Uom"
          items={data.uoms}
          value={r.alternate_uom_id}
          onChange={(id) => updItem(r.key, { alternate_uom_id: id })}
          compact
        />
      ),
    },
    {
      header: "Purchase Pack",
      className: "min-w-[170px]",
      // Which cone/gross size this line buys. Options come from the material's
      // own conversions, so an empty list is the signal to go define them on the
      // Materials master rather than a dead control.
      cell: (r) => {
        const packs = packsFor(r.item_id);
        return (
          <Select
            className="h-8"
            value={r.uom_conversion_id ?? ""}
            disabled={packs.length === 0}
            title={
              packs.length === 0
                ? "No conversions defined on this material — add them under Materials ▸ Units of Measure."
                : undefined
            }
            onChange={(e) => updItem(r.key, { uom_conversion_id: e.target.value || null })}
          >
            <option value="">{packs.length === 0 ? "No conversions" : "Same as consumption"}</option>
            {packs.map((c) => (
              <option key={c.id} value={c.id}>
                {describeConversion(c, uomName)}
              </option>
            ))}
          </Select>
        );
      },
    },
    {
      header: "Calculated Qty",
      align: "right",
      className: "min-w-[8rem]",
      // SYSTEM-GENERATED, and it looks it: a tinted read-only cell rather than
      // an input the operator will try to type into. It is the line's whole
      // requirement — every slice summed, with MOQ applied — which is why it can
      // differ from any single row on the Requirement tab.
      //
      // A REFUSAL PRINTS ITS SENTENCE. Never a dash and never 0: 0 reads as
      // "none needed", the one answer a material requirement never intends.
      cell: (r) => {
        const t = lineTotals.get(r.key);
        if (!orderProd) {
          return (
            <span className="block rounded-sm bg-surface-muted px-2 py-1 text-right text-xs text-muted-foreground">
              Pick an order
            </span>
          );
        }
        if (!t || t.total == null) {
          return (
            <span className="block rounded-sm bg-surface-muted px-2 py-1 text-right text-xs text-muted-foreground">
              {t?.refusal ?? "—"}
            </span>
          );
        }
        return (
          <span className="block rounded-sm bg-info-soft px-2 py-1 text-right text-sm font-semibold tabular-nums text-info">
            {fmtNumber(t.total)}
            <span className="ml-1 text-[10px] font-normal opacity-80">{t.uom}</span>
          </span>
        );
      },
    },
    {
      header: "MOQ",
      align: "right",
      className: "min-w-[6rem]",
      cell: (r) => (
        <Input
          type="number"
          min="0"
          step="0.001"
          value={r.moq}
          onChange={(e) => updItem(r.key, { moq: e.target.value })}
          className="h-8 text-right"
        />
      ),
    },
    {
      header: "Required By",
      className: "min-w-[8rem]",
      cell: (r) => (
        <Input
          type="date"
          value={r.required_by}
          onChange={(e) => updItem(r.key, { required_by: e.target.value })}
          className="h-8"
        />
      ),
    },
    {
      header: "Combination",
      className: "min-w-[120px]",
      cell: (r) => (
        <Input
          value={r.combination}
          onChange={(e) => updItem(r.key, { combination: e.target.value })}
          className="h-8"
        />
      ),
    },
  ];

  const procColumns: ChildGridColumn<ProcRow>[] = [
    {
      header: "Material",
      className: "min-w-[160px]",
      cell: (r) => (
        <RecordPicker
          label="Material"
          // Accessories only, same as the Items grid. No Category cell on this
          // row to cascade from, so it stays the full accessory list with each
          // option prefixed by its class.
          items={materialsFor(null, r.item_id)}
          value={r.item_id}
          onChange={(id) => updProc(r.key, { item_id: id })}
          compact
        />
      ),
    },
    {
      header: "Process",
      className: "min-w-[150px]",
      cell: (r) => (
        <RecordPicker
          label="Process"
          items={data.processes}
          value={r.process_id}
          onChange={(id) => updProc(r.key, { process_id: id })}
          compact
        />
      ),
    },
    {
      header: "Vendor",
      className: "min-w-[150px]",
      // The processor. Same nominated-vendor rule as the items grid — a customer
      // who nominates their trim suppliers nominates their dyers too.
      cell: (r) => (
        <NominatedVendorPicker
          {...vendorRule}
          supplyType="Nominated"
          value={r.vendor_id}
          onChange={(id) => updProc(r.key, { vendor_id: id })}
          compact
        />
      ),
    },
    {
      header: "Qty Out",
      align: "right",
      className: "min-w-[6rem]",
      cell: (r) => (
        <Input
          type="number"
          min="0"
          step="0.001"
          value={r.qty_out}
          onChange={(e) => updProc(r.key, { qty_out: e.target.value })}
          className="h-8 text-right"
        />
      ),
    },
    {
      header: "Qty In",
      align: "right",
      className: "min-w-[6rem]",
      cell: (r) => (
        <Input
          type="number"
          min="0"
          step="0.001"
          value={r.qty_in}
          onChange={(e) => updProc(r.key, { qty_in: e.target.value })}
          className="h-8 text-right"
        />
      ),
    },
    {
      header: "Balance",
      align: "right",
      className: "min-w-[6rem]",
      // DERIVED, never stored: two columns and their difference kept in three
      // places is two chances for them to disagree.
      cell: (r) => {
        const out = numOrNull(r.qty_out);
        const back = numOrNull(r.qty_in);
        if (out == null) return <span className="text-xs text-muted-foreground">—</span>;
        return (
          <span className="tabular-nums text-sm">{fmtNumber(out - (back ?? 0))}</span>
        );
      },
    },
    {
      header: "Status",
      className: "min-w-[120px]",
      cell: (r) => (
        <Select
          value={r.status}
          onChange={(e) => updProc(r.key, { status: e.target.value })}
          className="h-8"
        >
          {PROCESS_STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      ),
    },
  ];

  const reqColumns: Column<ReqRow>[] = [
    { header: "Material", cell: (r) => <span className="text-sm">{r.material}</span> },
    {
      header: "Basis",
      cell: (r) => <span className="text-xs text-muted-foreground">{r.basis}</span>,
    },
    { header: "Slice", cell: (r) => <span className="text-sm">{r.slice}</span> },
    {
      header: "Item Color",
      cell: (r) => <span className="text-sm">{r.colour}</span>,
    },
    {
      header: "Production",
      align: "right",
      cell: (r) => (
        <span className="tabular-nums text-xs text-muted-foreground">
          {r.production != null ? fmtNumber(r.production) : "—"}
        </span>
      ),
    },
    {
      header: "Required",
      align: "right",
      // A REFUSAL PRINTS ITS SENTENCE. Not a dash, and never 0: 0 reads as "none
      // needed", the one answer a material requirement never intends.
      cell: (r) =>
        r.required != null ? (
          <span className="font-medium tabular-nums">{fmtNumber(r.required)}</span>
        ) : (
          <span className="text-xs text-muted-foreground">{r.refusal ?? "—"}</span>
        ),
    },
    { header: "Uom", cell: (r) => <span className="text-xs">{r.uom}</span> },
    {
      header: "Purchase Qty",
      align: "right",
      cell: (r) => (
        <span className="tabular-nums">{r.purchase != null ? fmtNumber(r.purchase) : "—"}</span>
      ),
    },
    { header: "Purchase Uom", cell: (r) => <span className="text-xs">{r.purchaseUom}</span> },
  ];

  const copyBar = pendingCopy ? (
    <BomCopyConfirm
      count={pendingCopy.items.length}
      onAccept={() => applyCopy(pendingCopy)}
      onDismiss={() => setPendingCopy(null)}
    />
  ) : null;

  const sections: FullScreenSection[] = [
    {
      key: "bom",
      label: "Material BOM",
      icon: ClipboardList,
      done: !!form.amend_date && !!form.garment_order_id,
      content: (
        <SectionBody
          title="Material BOM"
          hint="Which confirmed garment order this plans material for."
        >
          <FieldGrid>
            <Field label="Entry No" size="sm" htmlFor="mba-entry">
              <Input id="mba-entry" readOnly value={editId ? "—" : "Auto"} className="font-mono" />
            </Field>
            <Field label="Date" required size="sm" htmlFor="mba-date">
              <Input
                id="mba-date"
                type="date"
                value={form.amend_date}
                onChange={(e) => set({ amend_date: e.target.value })}
              />
            </Field>
            <Field size="sm">
              <RecordPicker
                id="mba-order"
                label="Garment Order (SC No)"
                identity="code"
                items={orderItems}
                value={form.garment_order_id}
                onChange={pickOrder}
                required
              />
            </Field>
            {/* READ-ONLY, FROM THE ORDER. A BOM belongs to whoever the order
                belongs to, and it is what narrows the nominated-vendor pickers —
                a second, typeable copy could disagree with the order and quietly
                widen who may supply it. */}
            <Field label="Customer" size="sm" htmlFor="mba-customer">
              <Input id="mba-customer" readOnly value={customerName ?? "—"} />
            </Field>
            <Field label="A. No" size="sm" htmlFor="mba-ano">
              <Input
                id="mba-ano"
                readOnly
                value={amendmentNo != null ? String(amendmentNo) : "Auto"}
              />
            </Field>
            <Field label="Remarks" size="sm" htmlFor="mba-remarks">
              <Input
                id="mba-remarks"
                value={form.remarks}
                onChange={(e) => set({ remarks: e.target.value })}
                placeholder="Optional"
              />
            </Field>
          </FieldGrid>

          {/* THE MULTIPLIER, STATED. Every requirement on this screen is this
              number times a ratio, so leaving it off-screen makes each figure
              look like it came from nowhere — and a refusal here explains every
              blank on the Requirement tab at once. */}
          <ProductionStrip
            loading={loadingOrder}
            error={orderProdError}
            order={orderProd}
            picked={!!form.garment_order_id}
          />
        </SectionBody>
      ),
    },
    {
      key: "items",
      label: "Items",
      icon: Boxes,
      done: items.some((r) => r.item_id),
      content: (
        <SectionBody title="Items" hint="The materials this order needs, and how many of each.">
          {copyBar}
          {/* NO SIDEWAYS SCROLLBAR — THE ROW WRAPS INSTEAD (operator,
              2026-08-10). 17 columns cannot fit 1180px minus the rail, so the
              responsive table would put the row behind a horizontal scrollbar.
              `forceCards` drops the table for one card per line and
              `renderMobileRow` fills it with the SAME `FieldGrid` the header
              uses, so a line reads as a small form rather than a train carriage.

              `columns` stays the single declaration: labels and cells are read
              off it, so a new column cannot leave the card and header
              disagreeing. */}
          <ChildGrid<ItemRow>
            columns={itemColumns}
            rows={items}
            forceCards
            renderMobileRow={(row, i) => (
              <FieldGrid>
                {itemColumns.map((c, ci) => (
                  // `required` MUST be forwarded here as well as declared on the
                  // column: cards mode calls this instead of the `columns.map()`
                  // that wraps each cell in `RequiredScope`, so without it the
                  // header draws a `*` with no cursor hold behind it. Checked by
                  // `audit_layout.py --check grid-required-mobile`.
                  <Field key={ci} label={c.header} required={c.required} size="sm">
                    {c.cell(row, i)}
                  </Field>
                ))}
              </FieldGrid>
            )}
            seedRow
            onAdd={() => mutItems((xs) => [...xs, blankItem(newKey())])}
            onRemove={(r) => mutItems((xs) => xs.filter((x) => x.key !== r.key))}
            addLabel="+ Add material"
          />
        </SectionBody>
      ),
    },
    {
      key: "processes",
      label: "Processes",
      icon: Workflow,
      done: procs.some((r) => r.item_id || r.process_id),
      content: (
        <SectionBody
          title="Processes"
          hint="Materials sent out before they can be used — greige buttons for dyeing, labels for printing."
        >
          <ChildGrid<ProcRow>
            columns={procColumns}
            rows={procs}
            forceCards
            renderMobileRow={(row, i) => (
              <FieldGrid>
                {procColumns.map((c, ci) => (
                  <Field key={ci} label={c.header} required={c.required} size="sm">
                    {c.cell(row, i)}
                  </Field>
                ))}
              </FieldGrid>
            )}
            seedRow
            onAdd={() => mutProcs((xs) => [...xs, blankProc(newKey())])}
            onRemove={(r) => mutProcs((xs) => xs.filter((x) => x.key !== r.key))}
            addLabel="+ Add process"
          />
        </SectionBody>
      ),
    },
    {
      key: "requirement",
      label: "Requirement",
      icon: Calculator,
      done: reqRows.some((r) => r.required != null),
      content: (
        <SectionBody
          title="Requirement"
          hint="Read-only — production quantity × (No. of Items ÷ Per Pieces), plus wastage."
        >
          {!form.garment_order_id ? (
            <p className="text-xs text-muted-foreground">
              Pick a garment order first — the requirement is a multiple of its production
              quantity.
            </p>
          ) : orderProdError ? (
            <p className="text-xs text-danger">{orderProdError}</p>
          ) : loadingOrder ? (
            <p className="text-xs text-muted-foreground">Reading the order…</p>
          ) : (
            <DataTable
              columns={reqColumns}
              rows={reqRows}
              getKey={(r) => r.key}
              empty="Add a material with a basis and a ratio to see what the order needs."
            />
          )}
        </SectionBody>
      ),
    },
  ];

  return (
    <>
      <div className="space-y-4">
        <PageHeader
          title="Material BOM"
          description="Every sewing and packing accessory a confirmed order needs, and how much of each."
        />

        <div className="flex flex-wrap items-center gap-2">
          <FilterBar
            search={query}
            onSearch={setQuery}
            searchPlaceholder="Search SC No, PO or customer…"
            activeCount={statusFilter ? 1 : 0}
            onReset={statusFilter ? () => setStatusFilter("") : undefined}
            right={`${filtered.length} of ${tasks.length}`}
          >
            <div>
              <label htmlFor="bom-status" className="mb-1 block text-xs text-muted-foreground">
                Material BOM
              </label>
              <Select
                id="bom-status"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as "" | BomStatus)}
              >
                <option value="">All</option>
                {BOM_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {bomStatusText(s)}
                  </option>
                ))}
              </Select>
            </div>
          </FilterBar>
          <div className="flex flex-1 items-center justify-end gap-2">
            {perms.canCreate && (
              <Button size="md" onClick={() => openAdd(null)}>
                + New Material BOM
              </Button>
            )}
          </div>
        </div>

        <DataTable
          columns={withCreatedColumns(columns, filtered)}
          rows={filtered}
          getKey={(t) => t.id}
          empty="No confirmed garment orders yet. A material BOM is planned against an order."
        />
      </div>

      {/* THE EDITOR IS A FULL-SCREEN TAKEOVER, NOT A PAGE PANE (operator request,
          2026-08-10). A page mount sat the rail in normal flow with the module
          sidebar still beside it, so entering a record put two navigation lists
          on screen and left ~1090px for a wide grid. */}
      <MasterFullScreen
        ref={shellRef}
        mount="overlay"
        open={mode === "edit"}
        onClose={() => setMode("list")}
        modeLabel={
          <>
            {editId ? "Editing" : "New"}{" "}
            <span className="font-semibold text-foreground">material BOM</span>
          </>
        }
        header={{
          initials: "MB",
          title: selectedOrder?.sc_no ?? (editId ? "Material BOM" : "New material BOM"),
          badges: dirty ? (
            <span className="text-[11px] font-medium text-warning">● Unsaved</span>
          ) : null,
          meta: (
            <>
              <span>
                {amendmentNo != null ? (
                  <>
                    A. No <span className="font-semibold text-foreground">{amendmentNo}</span>
                  </>
                ) : (
                  "A. No auto"
                )}
              </span>
              {customerName && <span>· {customerName}</span>}
              {form.amend_date && <span>· {fmtDate(form.amend_date)}</span>}
            </>
          ),
          right: (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setCopyOpen(true)}
              disabled={isPending}
            >
              <Copy className="h-4 w-4" aria-hidden />
              Copy from…
            </Button>
          ),
        }}
        sections={sections}
        footer={{
          status: dirty ? "Unsaved changes" : editId ? "All changes saved" : "New material BOM",
          onCancel: () => setMode("list"),
          onSave: () => submit(false),
          saveLabel: "Save material BOM",
          canSave: validity.canSave,
          onBlockedSave: revealFirstProblem,
          onSaveDraft: perms.canCreate ? () => submit(true) : undefined,
          isPending,
        }}
      />

      <BomCopySheet
        open={copyOpen}
        onClose={() => setCopyOpen(false)}
        sources={copySources.filter((s) => !editId || s.bom_id !== editId)}
        onPick={pickCopySource}
        isPending={isPending}
      />
    </>
  );
}

/**
 * The order's production quantity, and where it came from.
 *
 * A REFUSAL IS SHOWN, NOT SWALLOWED. "This order has no Approval Qty rows" and
 * "the requirement is zero" produce the same empty table, and only the first is
 * something an operator can act on — which is the failure AGENTS.md names under
 * Cascading filters, where an empty report reads as a real result.
 */
function ProductionStrip({
  loading,
  error,
  order,
  picked,
}: {
  loading: boolean;
  error: string | null;
  order: OrderProductionInput | null;
  picked: boolean;
}) {
  if (!picked) return null;

  let body: React.ReactNode;
  if (loading) body = <span className="text-muted-foreground">Reading the order…</span>;
  else if (error) body = <span className="text-danger">{error}</span>;
  else if (!order) body = <span className="text-muted-foreground">—</span>;
  else {
    const total = order.approvals.reduce((a, r) => a + (Number(r.qty) || 0), 0);
    body = (
      <span className="text-muted-foreground">
        {order.approvals.length} approval {order.approvals.length === 1 ? "line" : "lines"} ·{" "}
        {order.combos.length} {order.combos.length === 1 ? "combo" : "combos"} · PO{" "}
        <span className="font-medium tabular-nums text-foreground">{fmtNumber(total)}</span> pcs ·
        excess {order.excessPct}%
        {order.rejectionRuleChosen ? " · rejection rule applied" : " · no rejection rule"}
      </span>
    );
  }

  return (
    <div className="rounded-md border border-border bg-surface-muted px-3 py-2 text-xs">
      <span className="mr-2 font-medium text-foreground">Planning against:</span>
      {body}
    </div>
  );
}
