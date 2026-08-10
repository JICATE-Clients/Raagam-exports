"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Trash2,
  Plus,
  Shirt,
  Palette,
  Layers,
  Banknote,
  Package,
  Hash,
  CheckCheck,
  Truck,
  FileText,
  ClipboardList,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { gridKeyNav } from "@/components/masters/child-grid";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardBody } from "@/components/ui/card";
import { DataTable, type Column } from "@/components/ui/data-table";
import { RowActions, rowActionsColumn } from "@/components/ui/row-actions";
import { StatusPill } from "@/components/ui/status-pill";
// `Tabs` itself is gone — the ten sub-tabs are a section RAIL now (see the
// MasterFullScreen call below). The TYPE stays: `placeholderTab` still builds
// {key,label,content} items and `sections` maps them, so the shape a tab
// declares is unchanged and only the chrome around it moved.
import { type TabItem } from "@/components/ui/tabs";
import {
  MasterFullScreen,
  SectionBody,
  type FullScreenSection,
} from "@/components/masters/master-full-screen";
import { Field, FieldGrid } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { PageHeader } from "@/components/ui/page-header";
import { fmtDate } from "@/lib/format";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { RecordPicker } from "@/components/masters/record-picker";
import { CountryPicker } from "@/components/masters/country-picker";
import { CurrencyPicker } from "@/components/masters/currency-picker";
import { LookupDialogPicker } from "@/components/masters/lookup-dialog-picker";
import { PaymentTermPicker } from "@/components/masters/payment-term-picker";
import {
  createAmendment,
  updateAmendment,
  deleteAmendment,
  loadOrderSeed,
} from "@/lib/orders/amendments/actions";
import type { SeededAmendmentChildren } from "@/lib/orders/amendments/order-seed";
import {
  INITIATED_OPTIONS,
  AMEND_TYPE_OPTIONS,
  SEASON_OPTIONS,
  SHIP_MODES,
  PAY_MODES,
  amendmentStatusTone,
  amendmentStatusText,
  type GarmentOrderAmendment,
} from "@/lib/orders/amendments/types";
import type {
  AmendmentFormData,
  PickerRow,
  StylePickerRow,
  DyeColorRow,
} from "@/lib/orders/amendments/service";
import { withCreatedColumns } from "@/components/ui/created-columns";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean };

interface Props {
  rows: GarmentOrderAmendment[];
  data: AmendmentFormData;
  perms: Perms;
  /** masters:create/edit — gates inline Add/Modify inside config-list pickers. */
  masterPerms: { canCreate: boolean; canEdit: boolean };
}

// ---- editable child-row shapes ----
type StylePriceRow = {
  key: string;
  style_ref_no: string;
  style: string;
  price: string;
  csp_type: string;
  csp_price: string;
  fob_buyer_price: string;
  fob_selling_price: string;
};

// ---- Phase 2 (0128) editable child-row shapes ----
type StyleRow = {
  key: string;
  style_ref_no: string;
  style_id: string | null;
  article_no: string;
  style_category: string;
  style_description: string;
  order_unit_id: string | null;
  plan_unit_id: string | null;
  po_qty: string;
  description: string;
};
type DyeingRow = {
  key: string;
  section: "yarn" | "fabric";
  dye_type: string;
  color_id: string | null;
};
type PrintRow = { key: string; print_id: string | null };
type StructureRow = { key: string; structure_id: string | null };
type ComboRow = { key: string; style_ref_no: string; style: string; article_no: string };
type PriceDetailRow = {
  key: string;
  style_ref_no: string;
  style: string;
  article_no: string;
  price_type: string;
  unit: string;
  price: string;
};
type ApprovalQtyRow = {
  key: string;
  style_ref_no: string;
  style: string;
  article_no: string;
  approval_qty: string;
};

/**
 * DB shapes → the editable row shapes above: a client-only `key`, numbers as
 * strings (an `<Input>` holds text), nulls as "".
 *
 * ONE mapping, two callers — `openEdit` loading a saved amendment, and
 * `onSelectOrder` seeding a new one from the order. They were the same twenty
 * lines written twice, which is how a column gets mapped in one path and
 * forgotten in the other.
 *
 * `newKey` is passed in rather than closed over: it is a `useRef` counter that
 * lives inside the component, and two rows sharing a React key is a swapped-row
 * bug that only shows up once the operator starts editing.
 */
function toRows(src: SeededAmendmentChildren, newKey: () => string) {
  const num = (v: number | null | undefined) => (v ? String(v) : "");
  const txt = (v: string | null | undefined) => v ?? "";
  /** The three text columns every style-keyed tab repeats. */
  const styleCols = (x: { style_ref_no: string | null; style: string | null; article_no: string | null }) => ({
    style_ref_no: txt(x.style_ref_no),
    style: txt(x.style),
    article_no: txt(x.article_no),
  });

  return {
    styles: src.styles.map((x): StyleRow => ({
      key: newKey(),
      style_ref_no: txt(x.style_ref_no),
      style_id: x.style_id,
      article_no: txt(x.article_no),
      style_category: txt(x.style_category),
      style_description: txt(x.style_description),
      order_unit_id: x.order_unit_id,
      plan_unit_id: x.plan_unit_id,
      po_qty: num(x.po_qty),
      description: txt(x.description),
    })),
    dyeings: src.dyeings.map((x): DyeingRow => ({
      key: newKey(),
      section: x.section,
      dye_type: txt(x.dye_type),
      color_id: x.color_id,
    })),
    prints: src.prints.map((x): PrintRow => ({ key: newKey(), print_id: x.print_id })),
    structures: src.structures.map((x): StructureRow => ({ key: newKey(), structure_id: x.structure_id })),
    combos: src.combos.map((x): ComboRow => ({ key: newKey(), ...styleCols(x) })),
    priceDetails: src.priceDetails.map((x): PriceDetailRow => ({
      key: newKey(),
      ...styleCols(x),
      price_type: txt(x.price_type),
      unit: txt(x.unit),
      price: num(x.price),
    })),
    approvalQtys: src.approvalQtys.map((x): ApprovalQtyRow => ({
      key: newKey(),
      ...styleCols(x),
      approval_qty: num(x.approval_qty),
    })),
  };
}

type HeaderForm = {
  // order header
  sales_order_id: string | null;
  amend_date: string;
  initiated: string;
  amend_type: string;
  buyer_id: string | null;
  po_no: string;
  po_date: string;
  merchandiser_id: string | null;
  season: string;
  amend_year: string;
  delivery_date: string;
  excess_pct: string;
  pack: boolean;
  mult_ord: boolean;
  // logistic scalars
  department_id: string | null;
  ship_type_id: string | null;
  contact_id: string | null;
  logi_po_date: string;
  agent_id: string | null;
  ship_mode: string;
  country_id: string | null;
  currency_code: string | null;
  received_date: string;
  received_mode: string;
  pay_mode: string;
  pay_terms_id: string | null;
  ex_rate: string;
  avg_rate: string;
  gross_value: string;
  // reason ("Amendment In" panel)
  amend_in_material_bom: boolean;
  amend_in_fabric_bom: boolean;
  amend_in_garment_process_bom: boolean;
  reason_text: string;
};

const BLANK: HeaderForm = {
  sales_order_id: null,
  amend_date: "",
  initiated: "",
  amend_type: "",
  buyer_id: null,
  po_no: "",
  po_date: "",
  merchandiser_id: null,
  season: "",
  amend_year: "",
  delivery_date: "",
  excess_pct: "",
  pack: false,
  mult_ord: false,
  department_id: null,
  ship_type_id: null,
  contact_id: null,
  logi_po_date: "",
  agent_id: null,
  ship_mode: "",
  country_id: null,
  currency_code: null,
  received_date: "",
  received_mode: "",
  pay_mode: "",
  pay_terms_id: null,
  ex_rate: "",
  avg_rate: "",
  gross_value: "",
  amend_in_material_bom: false,
  amend_in_fabric_bom: false,
  amend_in_garment_process_bom: false,
  reason_text: "",
};

const today = () => new Date().toISOString().slice(0, 10);
const numOrNull = (v: string) => (v.trim() ? Number(v) : null);

export function AmendmentScreen({ rows, data, perms, masterPerms }: Props) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, start] = useTransition();

  const [mode, setMode] = useState<"list" | "edit">("list");
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<HeaderForm>(BLANK);
  const [stylePrices, setStylePrices] = useState<StylePriceRow[]>([]);
  // Phase 2 data-tab grids
  const [styles, setStyles] = useState<StyleRow[]>([]);
  const [dyeings, setDyeings] = useState<DyeingRow[]>([]);
  const [prints, setPrints] = useState<PrintRow[]>([]);
  const [structures, setStructures] = useState<StructureRow[]>([]);
  const [combos, setCombos] = useState<ComboRow[]>([]);
  const [priceDetails, setPriceDetails] = useState<PriceDetailRow[]>([]);
  const [approvalQtys, setApprovalQtys] = useState<ApprovalQtyRow[]>([]);
  const keySeq = useRef(0);
  const newKey = () => `k${keySeq.current++}`;

  /**
   * An SCNo the operator picked whose data is waiting on their answer, because
   * replacing the tabs would discard rows they had already entered. Null when
   * there is nothing to ask about — which is the common case.
   */
  const [pendingSeed, setPendingSeed] = useState<{
    orderId: string;
    orderNo: string;
    seed: SeededAmendmentChildren;
  } | null>(null);
  /** True once a seed has come back, so an empty tab can say WHY it is empty. */
  const [seeded, setSeeded] = useState(false);

  /** Push a set of child rows into the eight grids. One call, one mapping. */
  const applyRows = (src: SeededAmendmentChildren) => {
    const r = toRows(src, newKey);
    setStyles(r.styles);
    setDyeings(r.dyeings);
    setPrints(r.prints);
    setStructures(r.structures);
    setCombos(r.combos);
    setPriceDetails(r.priceDetails);
    setApprovalQtys(r.approvalQtys);
  };

  /** Has the operator put anything in the eight data tabs worth protecting? */
  const tabsHaveRows =
    styles.length > 0 ||
    dyeings.length > 0 ||
    prints.length > 0 ||
    structures.length > 0 ||
    combos.length > 0 ||
    priceDetails.length > 0 ||
    approvalQtys.length > 0;

  // Inline editor, not a Sheet / MasterFullScreen, so nothing registers it with
  // the reload guard automatically — see mba-master-screen.tsx for the full
  // reasoning. The stakes are highest here: this form carries a header plus
  // eight child grids, so a silent auto-update mid-amendment discards the lot.
  useUnsavedGuard(mode === "edit" || isPending);

  // config_lookups split by kind (one query, filtered per picker)
  const { lookups } = data;
  const shipTypeOpts = useMemo(() => lookups.filter((l) => l.kind === "ship_type"), [lookups]);
  // From the Payment Term MASTER, not `lookups` — `pay_terms_id` is an FK into
  // `public.payment_terms` since 0375, and the lookup rows it used to read are
  // gone. Filtering `lookups` here would silently render an empty list.
  const payTermOpts = data.paymentTerms;
  const structureOpts = useMemo(() => lookups.filter((l) => l.kind === "structure"), [lookups]);
  const printOpts = useMemo(() => lookups.filter((l) => l.kind === "roll_form_print"), [lookups]);

  // Style picker items {id, code, name}; keep the full rows for auto-fill lookup.
  const styleItems: PickerRow[] = useMemo(
    () => data.styles.map((s) => ({ id: s.id, code: s.code, name: s.name, blocked: s.blocked })),
    [data.styles],
  );
  const styleById = useMemo(() => {
    const m = new Map<string, StylePickerRow>();
    for (const s of data.styles) m.set(s.id, s);
    return m;
  }, [data.styles]);

  // Dye-colour picker items scoped to the amendment's buyer (colours belong to a
  // colour card, which belongs to a buyer). Falls back to all when no buyer yet.
  const dyeColorItems: PickerRow[] = useMemo(() => {
    const rows: DyeColorRow[] = form.buyer_id
      ? data.dyeColors.filter((c) => !c.buyer_id || c.buyer_id === form.buyer_id)
      : data.dyeColors;
    return rows.map((c) => ({
      id: c.id,
      code: c.code,
      name: c.card_label ? `${c.name} · ${c.card_label}` : c.name,
    }));
  }, [data.dyeColors, form.buyer_id]);

  // SCNo picker items (normalized to {id, code: order#, name: buyer}).
  const orderItems: PickerRow[] = useMemo(
    () =>
      data.orders.map((o) => ({
        id: o.id,
        code: o.order_number,
        name: o.buyer_name ?? "(no buyer)",
      })),
    [data.orders],
  );

  const set = (patch: Partial<HeaderForm>) => setForm((f) => ({ ...f, ...patch }));

  /**
   * Confirmed behaviour: picking an SCNo auto-loads the order's context — the
   * header fields, and (since the seeding pass) the eight data tabs, so the
   * amendment starts as the order STANDS and the operator edits the deltas.
   * A document that starts blank cannot be compared to anything.
   */
  function onSelectOrder(orderId: string | null) {
    setPendingSeed(null);
    if (!orderId) {
      set({ sales_order_id: null });
      setSeeded(false);
      return;
    }
    const o = data.orders.find((x) => x.id === orderId);
    set({
      sales_order_id: orderId,
      buyer_id: o?.buyer_id ?? form.buyer_id,
      currency_code: o?.currency_code ?? form.currency_code,
      delivery_date: o?.ship_date ?? form.delivery_date,
    });

    // A SAVED amendment's rows are never replaced by the order's current state:
    // they record what was decided, and the order has moved on since.
    if (editId) return;

    start(async () => {
      const res = await loadOrderSeed(orderId);
      if (!res.ok) {
        // Leave the tabs exactly as they were — a half-filled set of grids is
        // worse than none, because nothing on screen says which half is real.
        toastError(res.error);
        return;
      }
      if (tabsHaveRows) {
        setPendingSeed({
          orderId,
          orderNo: o?.order_number ?? "this order",
          seed: res.seed,
        });
        return;
      }
      applyRows(res.seed);
      setSeeded(true);
    });
  }

  /** The operator chose to replace their rows with the pending order's. */
  function acceptPendingSeed() {
    if (!pendingSeed) return;
    applyRows(pendingSeed.seed);
    setSeeded(true);
    setPendingSeed(null);
  }

  function openAdd() {
    setEditId(null);
    setForm({ ...BLANK, amend_date: today() });
    setStylePrices([]);
    setStyles([]);
    setDyeings([]);
    setPrints([]);
    setStructures([]);
    setCombos([]);
    setPriceDetails([]);
    setApprovalQtys([]);
    setPendingSeed(null);
    setSeeded(false);
    setMode("edit");
  }

  function openEdit(r: GarmentOrderAmendment) {
    setPendingSeed(null);
    setSeeded(false);
    setEditId(r.id);
    setForm({
      sales_order_id: r.sales_order_id,
      amend_date: r.amend_date ?? today(),
      initiated: r.initiated ?? "",
      amend_type: r.amend_type ?? "",
      buyer_id: r.buyer_id,
      po_no: r.po_no ?? "",
      po_date: r.po_date ?? "",
      merchandiser_id: r.merchandiser_id,
      season: r.season ?? "",
      amend_year: r.amend_year != null ? String(r.amend_year) : "",
      delivery_date: r.delivery_date ?? "",
      excess_pct: r.excess_pct ? String(r.excess_pct) : "",
      pack: r.pack,
      mult_ord: r.mult_ord,
      department_id: r.department_id,
      ship_type_id: r.ship_type_id,
      contact_id: r.contact_id,
      logi_po_date: r.logi_po_date ?? "",
      agent_id: r.agent_id,
      ship_mode: r.ship_mode ?? "",
      country_id: r.country_id,
      currency_code: r.currency_code,
      received_date: r.received_date ?? "",
      received_mode: r.received_mode ?? "",
      pay_mode: r.pay_mode ?? "",
      pay_terms_id: r.pay_terms_id,
      ex_rate: r.ex_rate ? String(r.ex_rate) : "",
      avg_rate: r.avg_rate ? String(r.avg_rate) : "",
      gross_value: r.gross_value ? String(r.gross_value) : "",
      amend_in_material_bom: r.amend_in_material_bom,
      amend_in_fabric_bom: r.amend_in_fabric_bom,
      amend_in_garment_process_bom: r.amend_in_garment_process_bom,
      reason_text: r.reason_text ?? "",
    });
    setStylePrices(
      r.style_prices.map((p) => ({
        key: newKey(),
        style_ref_no: p.style_ref_no ?? "",
        style: p.style ?? "",
        price: p.price ? String(p.price) : "",
        csp_type: p.csp_type ?? "",
        csp_price: p.csp_price ? String(p.csp_price) : "",
        fob_buyer_price: p.fob_buyer_price ? String(p.fob_buyer_price) : "",
        fob_selling_price: p.fob_selling_price ? String(p.fob_selling_price) : "",
      })),
    );
    // The saved rows, through the same mapping the order seed uses. A saved
    // amendment always wins over the order: it records what was decided, and
    // the order has moved on since.
    applyRows({
      styles: r.styles,
      dyeings: r.dyeings,
      prints: r.prints,
      structures: r.structures,
      combos: r.combos,
      priceDetails: r.price_details,
      approvalQtys: r.approval_qtys,
    });
    setMode("edit");
  }

  function submit(asDraft: boolean) {
    const payload = {
      is_draft: asDraft,
      sales_order_id: form.sales_order_id,
      amend_date: form.amend_date,
      initiated: form.initiated || null,
      amend_type: form.amend_type || null,
      buyer_id: form.buyer_id,
      po_no: form.po_no || null,
      po_date: form.po_date || null,
      merchandiser_id: form.merchandiser_id,
      season: form.season || null,
      amend_year: form.amend_year ? Number(form.amend_year) : null,
      delivery_date: form.delivery_date || null,
      excess_pct: numOrNull(form.excess_pct) ?? 0,
      pack: form.pack,
      mult_ord: form.mult_ord,
      department_id: form.department_id,
      ship_type_id: form.ship_type_id,
      contact_id: form.contact_id,
      logi_po_date: form.logi_po_date || null,
      agent_id: form.agent_id,
      ship_mode: form.ship_mode || null,
      country_id: form.country_id,
      currency_code: form.currency_code,
      received_date: form.received_date || null,
      received_mode: form.received_mode || null,
      pay_mode: form.pay_mode || null,
      pay_terms_id: form.pay_terms_id,
      ex_rate: numOrNull(form.ex_rate) ?? 0,
      avg_rate: numOrNull(form.avg_rate) ?? 0,
      gross_value: numOrNull(form.gross_value) ?? 0,
      amend_in_material_bom: form.amend_in_material_bom,
      amend_in_fabric_bom: form.amend_in_fabric_bom,
      amend_in_garment_process_bom: form.amend_in_garment_process_bom,
      reason_text: form.reason_text || null,
      style_prices: stylePrices.map((p) => ({
        sno: 0,
        style_ref_no: p.style_ref_no || null,
        style: p.style || null,
        price: numOrNull(p.price) ?? 0,
        csp_type: p.csp_type || null,
        csp_price: numOrNull(p.csp_price) ?? 0,
        fob_buyer_price: numOrNull(p.fob_buyer_price) ?? 0,
        fob_selling_price: numOrNull(p.fob_selling_price) ?? 0,
      })),
      styles: styles.map((r) => ({
        sno: 0,
        style_ref_no: r.style_ref_no || null,
        style_id: r.style_id,
        article_no: r.article_no || null,
        style_category: r.style_category || null,
        style_description: r.style_description || null,
        order_unit_id: r.order_unit_id,
        plan_unit_id: r.plan_unit_id,
        po_qty: numOrNull(r.po_qty) ?? 0,
        description: r.description || null,
      })),
      dyeings: dyeings.map((r) => ({
        sno: 0,
        section: r.section,
        dye_type: r.dye_type || null,
        color_id: r.color_id,
      })),
      prints: prints.map((r) => ({ sno: 0, print_id: r.print_id })),
      structures: structures.map((r) => ({ sno: 0, structure_id: r.structure_id })),
      combos: combos.map((r) => ({
        sno: 0,
        style_ref_no: r.style_ref_no || null,
        style: r.style || null,
        article_no: r.article_no || null,
      })),
      price_details: priceDetails.map((r) => ({
        sno: 0,
        style_ref_no: r.style_ref_no || null,
        style: r.style || null,
        article_no: r.article_no || null,
        price_type: r.price_type || null,
        unit: r.unit || null,
        price: numOrNull(r.price) ?? 0,
      })),
      approval_qtys: approvalQtys.map((r) => ({
        sno: 0,
        style_ref_no: r.style_ref_no || null,
        style: r.style || null,
        article_no: r.article_no || null,
        approval_qty: numOrNull(r.approval_qty) ?? 0,
      })),
    };
    start(async () => {
      const res = editId
        ? await updateAmendment(editId, payload)
        : await createAmendment(payload);
      if (res.ok) {
        success(editId ? "Amendment updated" : "Amendment created");
        setMode("list");
        router.refresh();
      } else {
        toastError(res.error);
      }
    });
  }

  function del(r: GarmentOrderAmendment) {
    /* No confirm() — <RowActions> asks in the row (LAYOUT.md §6a). */
    start(async () => {
      const res = await deleteAmendment(r.id);
      if (res.ok) {
        success("Amendment deleted");
        router.refresh();
      } else {
        toastError(res.error);
      }
    });
  }

  // ---------------- LIST MODE ----------------
  if (mode === "list") {
    const columns: Column<GarmentOrderAmendment>[] = [
      {
        header: "Code",
        cell: (r) => (
          <button
            type="button"
            onClick={() => perms.canEdit && openEdit(r)}
            className="font-mono text-xs font-medium text-primary hover:underline"
          >
            {r.code ?? "—"}
          </button>
        ),
      },
      {
        header: "Order #",
        cell: (r) => (
          <span className="font-mono text-xs">{r.sales_order?.order_number ?? "—"}</span>
        ),
      },
      { header: "Customer", cell: (r) => <span className="text-sm">{r.buyer?.name ?? "—"}</span> },
      {
        header: "Type",
        cell: (r) => <span className="text-sm text-muted-foreground">{r.amend_type ?? "—"}</span>,
      },
      {
        header: "Date",
        cell: (r) => <span className="tabular-nums text-sm">{fmtDate(r.amend_date)}</span>,
      },
      {
        header: "Status",
        cell: (r) => <StatusPill tone={amendmentStatusTone(r)}>{amendmentStatusText(r)}</StatusPill>,
      },
      rowActionsColumn((r) => (
        <RowActions
          label={r.code}
          onEdit={() => openEdit(r)}
          canEdit={perms.canEdit}
          onDelete={() => del(r)}
          canDelete={perms.canDelete}
          isPending={isPending}
        />
      )),
    ];

    return (
      <div className="space-y-4">
        <PageHeader
          title="Garment Order Amendment"
          description="Amend a confirmed garment order across styles, prices, packing, quantities & logistics — and record why."
          actions={
            perms.canCreate ? <Button onClick={openAdd}>New Amendment</Button> : undefined
          }
        />
        <DataTable
          columns={withCreatedColumns(columns, rows)}
          rows={rows}
          getKey={(r) => r.id}
          empty="No amendments yet. Use 'New Amendment' to create the first."
        />
      </div>
    );
  }

  // ---------------- EDIT MODE ----------------
  /**
   * The five Logistics fields the client made mandatory gate Save too.
   *
   * `required` on the field holds the CURSOR, which stops an operator tabbing
   * past a blank one — but it cannot stop someone who never focused it at all.
   * Requiredness that does not reach the Save button is half a rule; AGENTS.md
   * calls the two "enforcers" of one declaration.
   */
  const canSave =
    !!form.amend_date &&
    !!form.ship_type_id &&
    !!form.ship_mode &&
    !!form.pay_mode &&
    !!form.pay_terms_id &&
    !!form.currency_code;

  // ---- Phase 2 grid row updaters / adders / removers ----
  const updateStyle = (key: string, patch: Partial<StyleRow>) =>
    setStyles((xs) => xs.map((x) => (x.key === key ? { ...x, ...patch } : x)));
  const addStyle = () =>
    setStyles((xs) => [
      ...xs,
      {
        key: newKey(),
        style_ref_no: "",
        style_id: null,
        article_no: "",
        style_category: "",
        style_description: "",
        order_unit_id: null,
        plan_unit_id: null,
        po_qty: "",
        description: "",
      },
    ]);
  /** Picking a Style auto-fills article / category / description (legacy behaviour). */
  const pickStyle = (key: string, id: string | null) => {
    const s = id ? styleById.get(id) : null;
    updateStyle(key, {
      style_id: id,
      article_no: s?.article_no ?? "",
      style_category: s?.style_category ?? "",
      style_description: s?.style_description ?? "",
    });
  };

  const addDyeing = (section: "yarn" | "fabric") =>
    setDyeings((xs) => [...xs, { key: newKey(), section, dye_type: "", color_id: null }]);
  const addPrint = () => setPrints((xs) => [...xs, { key: newKey(), print_id: null }]);
  const addStructure = () =>
    setStructures((xs) => [...xs, { key: newKey(), structure_id: null }]);
  const addCombo = () =>
    setCombos((xs) => [...xs, { key: newKey(), style_ref_no: "", style: "", article_no: "" }]);
  const addPriceDetail = () =>
    setPriceDetails((xs) => [
      ...xs,
      { key: newKey(), style_ref_no: "", style: "", article_no: "", price_type: "", unit: "", price: "" },
    ]);
  const addApprovalQty = () =>
    setApprovalQtys((xs) => [
      ...xs,
      { key: newKey(), style_ref_no: "", style: "", article_no: "", approval_qty: "" },
    ]);

  /**
   * Rail completion dots — "this section has data".
   *
   * Free here, and worth having: the reason ten items became a rail is that a
   * strip could not tell the operator where anything was. It reads the SAME
   * state `tabsHaveRows` above reads, so the two cannot drift.
   *
   * `packtypes` / `quantities` are the two placeholder sections and are
   * deliberately absent — a dot claiming a not-yet-wired tab holds data would
   * lie about the one thing the operator most needs to know is missing.
   */
  const sectionDone: Record<string, boolean> = {
    styles: styles.length > 0,
    colors: dyeings.length > 0 || prints.length > 0 || structures.length > 0,
    combos: combos.length > 0,
    prices: priceDetails.length > 0,
    approvalqty: approvalQtys.length > 0,
    // Was `charges.length > 0`, and the charges are gone. The five fields
    // the client made mandatory are the honest signal now.
    logistic:
      !!form.ship_type_id && !!form.ship_mode && !!form.pay_mode &&
      !!form.pay_terms_id && !!form.currency_code,
  };

  const tabs: TabItem[] = [
    // ---------------- Style(s) ----------------
    {
      key: "styles",
      label: "Style(s)",
      content: (
        <GridCard title="Styles Details" onAdd={addStyle}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1000px] text-sm">
              <thead>
                <tr className="border-b border-border bg-surface-muted text-xs text-muted-foreground">
                  <th className="px-2 py-1.5 text-left font-medium">Style Ref No</th>
                  <th className="px-2 py-1.5 text-left font-medium">Style</th>
                  <th className="px-2 py-1.5 text-left font-medium">Article No</th>
                  <th className="px-2 py-1.5 text-left font-medium">Category</th>
                  <th className="px-2 py-1.5 text-left font-medium">Order Unit</th>
                  <th className="px-2 py-1.5 text-left font-medium">Plan Unit</th>
                  <th className="px-2 py-1.5 text-right font-medium">PO Qty</th>
                  <th className="px-2 py-1.5 text-left font-medium">Description</th>
                  <th className="px-2 py-1.5 text-center font-medium">Process</th>
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody data-grid-body onKeyDown={(e) => gridKeyNav(e, addStyle)}>
                {styles.map((r) => (
                  <tr key={r.key} data-grid-row className="border-b border-border align-top last:border-0">
                    <td className="px-2 py-1">
                      <Input value={r.style_ref_no} onChange={(e) => updateStyle(r.key, { style_ref_no: e.target.value })} className="h-8 min-w-[120px]" />
                    </td>
                    <td className="px-2 py-1 min-w-[200px]">
                      <RecordPicker label="Style" compact items={styleItems} value={r.style_id} onChange={(id) => pickStyle(r.key, id)} />
                    </td>
                    <td className="px-2 py-1 text-xs text-muted-foreground">{r.article_no || "—"}</td>
                    <td className="px-2 py-1 text-xs text-muted-foreground">{r.style_category || "—"}</td>
                    <td className="px-2 py-1 min-w-[140px]">
                      <RecordPicker label="Order Unit" compact items={data.uoms} value={r.order_unit_id} onChange={(id) => updateStyle(r.key, { order_unit_id: id })} />
                    </td>
                    <td className="px-2 py-1 min-w-[140px]">
                      <RecordPicker label="Plan Unit" compact items={data.uoms} value={r.plan_unit_id} onChange={(id) => updateStyle(r.key, { plan_unit_id: id })} />
                    </td>
                    <td className="px-2 py-1">
                      <Input type="number" value={r.po_qty} onChange={(e) => updateStyle(r.key, { po_qty: e.target.value })} className="h-8 w-24 text-right" />
                    </td>
                    <td className="px-2 py-1">
                      <Input value={r.description} onChange={(e) => updateStyle(r.key, { description: e.target.value })} className="h-8 min-w-[140px]" />
                    </td>
                    <td className="px-2 py-1 text-center">
                      <Button type="button" variant="outline" size="sm" disabled title="Nested Process screen — awaiting spec">
                        Process
                      </Button>
                    </td>
                    <td className="px-2 py-1">
                      <RowRemove onClick={() => setStyles((xs) => xs.filter((x) => x.key !== r.key))} />
                    </td>
                  </tr>
                ))}
                {styles.length === 0 && <EmptyRow cols={10} label="styles" seeded={seeded} />}
              </tbody>
            </table>
          </div>
        </GridCard>
      ),
    },
    // ---------------- Color / Print Details ----------------
    {
      key: "colors",
      label: "Color/Print Details",
      content: (
        <div className="space-y-4">
          {/* Yarn dyeing */}
          <GridCard title="Yarn Dyeing" onAdd={() => addDyeing("yarn")}>
            <DyeTable
              rows={dyeings.filter((d) => d.section === "yarn")}
              colorItems={dyeColorItems}
              onUpdate={(key, patch) => setDyeings((xs) => xs.map((x) => (x.key === key ? { ...x, ...patch } : x)))}
              onRemove={(key) => setDyeings((xs) => xs.filter((x) => x.key !== key))}
            />
          </GridCard>
          {/* Fabric dyeing */}
          <GridCard title="Fabric Dyeing" onAdd={() => addDyeing("fabric")}>
            <DyeTable
              rows={dyeings.filter((d) => d.section === "fabric")}
              colorItems={dyeColorItems}
              onUpdate={(key, patch) => setDyeings((xs) => xs.map((x) => (x.key === key ? { ...x, ...patch } : x)))}
              onRemove={(key) => setDyeings((xs) => xs.filter((x) => x.key !== key))}
            />
          </GridCard>
          {/* Roll-form prints */}
          <GridCard title="Roll Form Prints" onAdd={addPrint}>
            <div className="space-y-2">
              {prints.map((r) => (
                <div key={r.key} className="flex items-center gap-2">
                  <div className="min-w-[240px] flex-1">
                    <LookupDialogPicker
                      kind="roll_form_print"
                      label="Print"
                      compact
                      options={printOpts}
                      value={r.print_id}
                      onChange={(id) => setPrints((xs) => xs.map((x) => (x.key === r.key ? { ...x, print_id: id } : x)))}
                      canCreate={masterPerms.canCreate}
                      canEdit={masterPerms.canEdit}
                    />
                  </div>
                  <RowRemove onClick={() => setPrints((xs) => xs.filter((x) => x.key !== r.key))} />
                </div>
              ))}
              {prints.length === 0 && (
                <p className="py-4 text-center text-xs text-muted-foreground">{seeded ? "This order records no prints." : "No prints."} Use “Add row”.</p>
              )}
            </div>
          </GridCard>
          {/* Structures */}
          <GridCard title="Structures" onAdd={addStructure}>
            <div className="space-y-2">
              {structures.map((r) => (
                <div key={r.key} className="flex items-center gap-2">
                  <div className="min-w-[240px] flex-1">
                    <LookupDialogPicker
                      kind="structure"
                      label="Structure"
                      compact
                      options={structureOpts}
                      value={r.structure_id}
                      onChange={(id) => setStructures((xs) => xs.map((x) => (x.key === r.key ? { ...x, structure_id: id } : x)))}
                      canCreate={masterPerms.canCreate}
                      canEdit={masterPerms.canEdit}
                    />
                  </div>
                  <RowRemove onClick={() => setStructures((xs) => xs.filter((x) => x.key !== r.key))} />
                </div>
              ))}
              {structures.length === 0 && (
                <p className="py-4 text-center text-xs text-muted-foreground">{seeded ? "This order records no structures." : "No structures."} Use “Add row”.</p>
              )}
            </div>
          </GridCard>
        </div>
      ),
    },
    // ---------------- Combos ----------------
    {
      key: "combos",
      label: "Combos",
      content: (
        <GridCard title="Combos Details" onAdd={addCombo}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b border-border bg-surface-muted text-xs text-muted-foreground">
                  <th className="px-2 py-1.5 text-left font-medium">Style Ref No</th>
                  <th className="px-2 py-1.5 text-left font-medium">Style</th>
                  <th className="px-2 py-1.5 text-left font-medium">Article No</th>
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody data-grid-body onKeyDown={(e) => gridKeyNav(e, addCombo)}>
                {combos.map((r) => {
                  const upd = (patch: Partial<ComboRow>) =>
                    setCombos((xs) => xs.map((x) => (x.key === r.key ? { ...x, ...patch } : x)));
                  return (
                    <tr key={r.key} data-grid-row className="border-b border-border last:border-0">
                      <td className="px-2 py-1"><Input value={r.style_ref_no} onChange={(e) => upd({ style_ref_no: e.target.value })} className="h-8" /></td>
                      <td className="px-2 py-1"><Input value={r.style} onChange={(e) => upd({ style: e.target.value })} className="h-8" /></td>
                      <td className="px-2 py-1"><Input value={r.article_no} onChange={(e) => upd({ article_no: e.target.value })} className="h-8" /></td>
                      <td className="px-2 py-1"><RowRemove onClick={() => setCombos((xs) => xs.filter((x) => x.key !== r.key))} /></td>
                    </tr>
                  );
                })}
                {combos.length === 0 && <EmptyRow cols={4} label="combos" seeded={seeded} />}
              </tbody>
            </table>
          </div>
        </GridCard>
      ),
    },
    // ---------------- Prices ----------------
    {
      key: "prices",
      label: "Prices",
      content: (
        <GridCard title="Price Details" onAdd={addPriceDetail}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-b border-border bg-surface-muted text-xs text-muted-foreground">
                  <th className="px-2 py-1.5 text-left font-medium">Style Ref No</th>
                  <th className="px-2 py-1.5 text-left font-medium">Style</th>
                  <th className="px-2 py-1.5 text-left font-medium">Article No</th>
                  <th className="px-2 py-1.5 text-left font-medium">Price Type</th>
                  <th className="px-2 py-1.5 text-left font-medium">Unit</th>
                  <th className="px-2 py-1.5 text-right font-medium">Price</th>
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody data-grid-body onKeyDown={(e) => gridKeyNav(e, addPriceDetail)}>
                {priceDetails.map((r) => {
                  const upd = (patch: Partial<PriceDetailRow>) =>
                    setPriceDetails((xs) => xs.map((x) => (x.key === r.key ? { ...x, ...patch } : x)));
                  return (
                    <tr key={r.key} data-grid-row className="border-b border-border last:border-0">
                      <td className="px-2 py-1"><Input value={r.style_ref_no} onChange={(e) => upd({ style_ref_no: e.target.value })} className="h-8" /></td>
                      <td className="px-2 py-1"><Input value={r.style} onChange={(e) => upd({ style: e.target.value })} className="h-8" /></td>
                      <td className="px-2 py-1"><Input value={r.article_no} onChange={(e) => upd({ article_no: e.target.value })} className="h-8" /></td>
                      <td className="px-2 py-1"><Input value={r.price_type} onChange={(e) => upd({ price_type: e.target.value })} className="h-8" /></td>
                      <td className="px-2 py-1"><Input value={r.unit} onChange={(e) => upd({ unit: e.target.value })} className="h-8" /></td>
                      <td className="px-2 py-1"><Input type="number" value={r.price} onChange={(e) => upd({ price: e.target.value })} className="h-8 w-28 text-right" /></td>
                      <td className="px-2 py-1"><RowRemove onClick={() => setPriceDetails((xs) => xs.filter((x) => x.key !== r.key))} /></td>
                    </tr>
                  );
                })}
                {priceDetails.length === 0 && <EmptyRow cols={7} label="prices" seeded={seeded} />}
              </tbody>
            </table>
          </div>
        </GridCard>
      ),
    },
    placeholderTab("packtypes", "Pack type(s)"),
    placeholderTab("quantities", "Quantities"),
    // ---------------- Approval Qty ----------------
    {
      key: "approvalqty",
      label: "Approval Qty",
      content: (
        <GridCard title="Approval Quantity" onAdd={addApprovalQty}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-border bg-surface-muted text-xs text-muted-foreground">
                  <th className="px-2 py-1.5 text-left font-medium">Style Ref No</th>
                  <th className="px-2 py-1.5 text-left font-medium">Style</th>
                  <th className="px-2 py-1.5 text-left font-medium">Article No</th>
                  <th className="px-2 py-1.5 text-right font-medium">Approval Qty</th>
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody data-grid-body onKeyDown={(e) => gridKeyNav(e, addApprovalQty)}>
                {approvalQtys.map((r) => {
                  const upd = (patch: Partial<ApprovalQtyRow>) =>
                    setApprovalQtys((xs) => xs.map((x) => (x.key === r.key ? { ...x, ...patch } : x)));
                  return (
                    <tr key={r.key} data-grid-row className="border-b border-border last:border-0">
                      <td className="px-2 py-1"><Input value={r.style_ref_no} onChange={(e) => upd({ style_ref_no: e.target.value })} className="h-8" /></td>
                      <td className="px-2 py-1"><Input value={r.style} onChange={(e) => upd({ style: e.target.value })} className="h-8" /></td>
                      <td className="px-2 py-1"><Input value={r.article_no} onChange={(e) => upd({ article_no: e.target.value })} className="h-8" /></td>
                      <td className="px-2 py-1"><Input type="number" value={r.approval_qty} onChange={(e) => upd({ approval_qty: e.target.value })} className="h-8 w-28 text-right" /></td>
                      <td className="px-2 py-1"><RowRemove onClick={() => setApprovalQtys((xs) => xs.filter((x) => x.key !== r.key))} /></td>
                    </tr>
                  );
                })}
                {approvalQtys.length === 0 && <EmptyRow cols={5} label="approval quantities" seeded={seeded} />}
              </tbody>
            </table>
          </div>
        </GridCard>
      ),
    },
    // Country/Sizewise WITHDRAWN 2026-08-10 (client): the information is
    // already captured in the quantity breakdown. The table
    // `garment_order_amendment_country_sizes` and its rows are untouched —
    // `actions.ts` no longer lists it, and that list drives the DELETE as well
    // as the insert, so stored rows are frozen rather than wiped.
    {
      key: "logistic",
      label: "Logistic",
      content: (
        <div className="space-y-4">
          {/* Logistic scalars */}
          <Card>
            <CardBody className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {/* Department, Agent and Received (mode) withdrawn 2026-08-10
                  (client). Their columns and stored values remain; they left the
                  Zod input too, which is what stops a save nulling them. */}
              <LookupDialogPicker
                kind="ship_type"
                label="Ship Type"
                options={shipTypeOpts}
                value={form.ship_type_id}
                onChange={(id) => set({ ship_type_id: id })}
                required
                canCreate={masterPerms.canCreate}
                canEdit={masterPerms.canEdit}
              />
              <RecordPicker
                label="Contact"
                items={data.contacts}
                value={form.contact_id}
                onChange={(id) => set({ contact_id: id })}
              />
              <div>
                <Label htmlFor="lg-podate">PO Date</Label>
                <Input
                  id="lg-podate"
                  type="date"
                  value={form.logi_po_date}
                  onChange={(e) => set({ logi_po_date: e.target.value })}
                />
              </div>
              {/* `<Field required>` rather than a bare Label: a `<Select>` reads
                  requiredness from context (`select.tsx` → `useRequiredHold`), so
                  the star and the cursor hold both come from this one prop. */}
              <Field label="Ship Mode" required htmlFor="lg-shipmode">
                <Select
                  id="lg-shipmode"
                  value={form.ship_mode}
                  onChange={(e) => set({ ship_mode: e.target.value })}
                >
                  <option value="">—</option>
                  {SHIP_MODES.map((o) => (
                    <option key={o} value={o}>{o}</option>
                  ))}
                </Select>
              </Field>
              <CountryPicker
                countries={data.countries}
                value={form.country_id}
                onChange={(id) => set({ country_id: id })}
                canCreate={masterPerms.canCreate}
                canEdit={masterPerms.canEdit}
              />
              {/* `CurrencyPicker` has no `required` prop of its own, so the
                  scope comes from the wrapper — its inner `DataPicker` ORs the
                  context (`data-picker.tsx:292`). `compact` because the Field
                  now draws the label. */}
              <Field label="Currency" required>
                <CurrencyPicker
                  label="Currency"
                  compact
                  currencies={data.currencies}
                  value={form.currency_code}
                  onChange={(code) => set({ currency_code: code })}
                  canCreate={masterPerms.canCreate}
                  canEdit={masterPerms.canEdit}
                />
              </Field>
              <div>
                <Label htmlFor="lg-exrate">Ex-Rate</Label>
                <Input
                  id="lg-exrate"
                  type="number"
                  value={form.ex_rate}
                  onChange={(e) => set({ ex_rate: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="lg-recdate">Received</Label>
                <Input
                  id="lg-recdate"
                  type="date"
                  value={form.received_date}
                  onChange={(e) => set({ received_date: e.target.value })}
                />
              </div>
              <Field label="Pay Mode" required htmlFor="lg-paymode">
                <Select
                  id="lg-paymode"
                  value={form.pay_mode}
                  onChange={(e) => set({ pay_mode: e.target.value })}
                >
                  <option value="">—</option>
                  {PAY_MODES.map((o) => (
                    <option key={o} value={o}>{o}</option>
                  ))}
                </Select>
              </Field>
              <PaymentTermPicker
                label="Pay Terms"
                required
                options={payTermOpts}
                value={form.pay_terms_id}
                onChange={(id) => set({ pay_terms_id: id })}
                canCreate={masterPerms.canCreate}
                canEdit={masterPerms.canEdit}
              />
              <div>
                <Label htmlFor="lg-avgrate">Avg Rate</Label>
                <Input
                  id="lg-avgrate"
                  type="number"
                  value={form.avg_rate}
                  onChange={(e) => set({ avg_rate: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="lg-gross">Gross Value</Label>
                <Input
                  id="lg-gross"
                  type="number"
                  value={form.gross_value}
                  onChange={(e) => set({ gross_value: e.target.value })}
                />
              </div>
            </CardBody>
          </Card>

          {/* Less / Add charges and Cash Discount withdrawn 2026-08-10
              (client): "remove the complexity for now to keep the logic simple".
              Both were on THIS tab, not Prices.

              Their tables and columns are untouched —
              `garment_order_amendment_charges` and `cd1_pct … cd3_days` keep
              whatever they hold. They left the Zod input too, and
              `actions.ts` no longer deletes the charges rows, so a save on an
              existing amendment leaves the stored charges exactly as they are
              rather than wiping them. */}
          {/* Style-wise price grid */}
          <GridCard
            title="Style Prices"
            onAdd={() =>
              setStylePrices((xs) => [
                ...xs,
                {
                  key: newKey(),
                  style_ref_no: "",
                  style: "",
                  price: "",
                  csp_type: "",
                  csp_price: "",
                  fob_buyer_price: "",
                  fob_selling_price: "",
                },
              ])
            }
          >
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] text-sm">
                <thead>
                  <tr className="border-b border-border bg-surface-muted text-xs text-muted-foreground">
                    <th className="px-2 py-1.5 text-left font-medium">Style Ref No</th>
                    <th className="px-2 py-1.5 text-left font-medium">Style</th>
                    <th className="px-2 py-1.5 text-right font-medium">Price</th>
                    <th className="px-2 py-1.5 text-left font-medium">CSP Type</th>
                    <th className="px-2 py-1.5 text-right font-medium">CSP Price</th>
                    <th className="px-2 py-1.5 text-right font-medium">FOB Buyer</th>
                    <th className="px-2 py-1.5 text-right font-medium">FOB Selling</th>
                    <th className="w-10" />
                  </tr>
                </thead>
                <tbody
                  data-grid-body
                  onKeyDown={(e) =>
                    gridKeyNav(e, () =>
                      setStylePrices((xs) => [
                        ...xs,
                        {
                          key: newKey(),
                          style_ref_no: "",
                          style: "",
                          price: "",
                          csp_type: "",
                          csp_price: "",
                          fob_buyer_price: "",
                          fob_selling_price: "",
                        },
                      ]),
                    )
                  }
                >
                  {stylePrices.map((r) => {
                    const upd = (patch: Partial<StylePriceRow>) =>
                      setStylePrices((xs) => xs.map((x) => (x.key === r.key ? { ...x, ...patch } : x)));
                    return (
                      <tr key={r.key} data-grid-row className="border-b border-border last:border-0">
                        <td className="px-2 py-1">
                          <Input value={r.style_ref_no} onChange={(e) => upd({ style_ref_no: e.target.value })} className="h-8" />
                        </td>
                        <td className="px-2 py-1">
                          <Input value={r.style} onChange={(e) => upd({ style: e.target.value })} className="h-8" />
                        </td>
                        <td className="px-2 py-1">
                          <Input type="number" value={r.price} onChange={(e) => upd({ price: e.target.value })} className="h-8 text-right" />
                        </td>
                        <td className="px-2 py-1">
                          <Input value={r.csp_type} onChange={(e) => upd({ csp_type: e.target.value })} className="h-8" />
                        </td>
                        <td className="px-2 py-1">
                          <Input type="number" value={r.csp_price} onChange={(e) => upd({ csp_price: e.target.value })} className="h-8 text-right" />
                        </td>
                        <td className="px-2 py-1">
                          <Input type="number" value={r.fob_buyer_price} onChange={(e) => upd({ fob_buyer_price: e.target.value })} className="h-8 text-right" />
                        </td>
                        <td className="px-2 py-1">
                          <Input type="number" value={r.fob_selling_price} onChange={(e) => upd({ fob_selling_price: e.target.value })} className="h-8 text-right" />
                        </td>
                        <td className="px-2 py-1">
                          <RowRemove onClick={() => setStylePrices((xs) => xs.filter((x) => x.key !== r.key))} />
                        </td>
                      </tr>
                    );
                  })}
                  {stylePrices.length === 0 && (
                    <tr>
                      <td colSpan={8} className="px-2 py-6 text-center text-xs text-muted-foreground">
                        No style prices. Use “Add row”.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </GridCard>
        </div>
      ),
    },
    {
      key: "reason",
      label: "Reason",
      content: (
        <Card>
          <CardBody className="space-y-4">
            <div>
              <h3 className="mb-2 text-sm font-semibold text-foreground">Amendment In</h3>
              <div className="flex flex-wrap gap-6">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={form.amend_in_material_bom}
                    onChange={(e) => set({ amend_in_material_bom: e.target.checked })}
                    className="h-4 w-4 rounded border-border"
                  />
                  Material BOM
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={form.amend_in_fabric_bom}
                    onChange={(e) => set({ amend_in_fabric_bom: e.target.checked })}
                    className="h-4 w-4 rounded border-border"
                  />
                  Fabric BOM
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={form.amend_in_garment_process_bom}
                    onChange={(e) => set({ amend_in_garment_process_bom: e.target.checked })}
                    className="h-4 w-4 rounded border-border"
                  />
                  Garment Process BOM
                </label>
              </div>
            </div>
            <div>
              <Label htmlFor="rs-text">Reason</Label>
              <Textarea
                id="rs-text"
                value={form.reason_text}
                onChange={(e) => set({ reason_text: e.target.value })}
                rows={4}
                placeholder="Why is this order being amended?"
              />
            </div>
          </CardBody>
        </Card>
      ),
    },
  ];

  /**
   * The document header, as the FIRST rail section.
   *
   * Every field is `size="sm"` — the standing "ONE SIZE, EVERY FIELD" rule
   * (3 of 12, four per row, ~280px). Nothing here is sized to its own data, so
   * a Yr box and an SCNo picker line up down the page.
   *
   * `Field required` on Date replaces a literally typed `"Date *"`: one
   * declaration now draws the red star AND holds the cursor while the box is
   * blank, which is what `canSave = !!form.amend_date` has always meant but had
   * no way to say. Every picker takes `compact` so it does not draw a second
   * label inside the one `Field` already provides.
   */
  const orderInfoSection: FullScreenSection = {
    key: "orderinfo",
    label: "Order Info",
    icon: ClipboardList,
    done: !!form.sales_order_id,
    content: (
      <SectionBody
        title="Order Info"
        hint="Which order is being amended, and this amendment's own details."
      >
        {/* ONE FieldGrid for the whole section — SectionBody has no grid of its
            own, and two stacked grids agree on the left edge but not the row gap. */}
        <FieldGrid>
          <Field label="SCNo" size="sm">
            <RecordPicker
              label="SCNo"
              compact
              items={orderItems}
              value={form.sales_order_id}
              onChange={onSelectOrder}
            />
          </Field>
          <Field label="Date" required size="sm" htmlFor="hd-date">
            <Input id="hd-date" type="date" value={form.amend_date} onChange={(e) => set({ amend_date: e.target.value })} />
          </Field>
          <Field label="Initiated" size="sm" htmlFor="hd-initiated">
            <Select id="hd-initiated" value={form.initiated} onChange={(e) => set({ initiated: e.target.value })}>
              <option value="">—</option>
              {INITIATED_OPTIONS.map((o) => (
                <option key={o} value={o}>{o}</option>
              ))}
            </Select>
          </Field>
          <Field label="Type" size="sm" htmlFor="hd-type">
            <Select id="hd-type" value={form.amend_type} onChange={(e) => set({ amend_type: e.target.value })}>
              <option value="">—</option>
              {AMEND_TYPE_OPTIONS.map((o) => (
                <option key={o} value={o}>{o}</option>
              ))}
            </Select>
          </Field>
          <Field label="Customer" size="sm">
            <RecordPicker
              label="Customer"
              compact
              items={data.buyers}
              value={form.buyer_id}
              onChange={(id) => set({ buyer_id: id })}
            />
          </Field>
          <Field label="PO No" size="sm" htmlFor="hd-pono">
            <Input id="hd-pono" value={form.po_no} onChange={(e) => set({ po_no: e.target.value })} />
          </Field>
          <Field label="Merchand." size="sm">
            <RecordPicker
              label="Merchand."
              compact
              items={data.merchandisers}
              value={form.merchandiser_id}
              onChange={(id) => set({ merchandiser_id: id })}
            />
          </Field>
          <Field label="Season" size="sm" htmlFor="hd-season">
            <Select id="hd-season" value={form.season} onChange={(e) => set({ season: e.target.value })}>
              <option value="">—</option>
              {SEASON_OPTIONS.map((o) => (
                <option key={o} value={o}>{o}</option>
              ))}
            </Select>
          </Field>
          <Field label="Yr" size="sm" htmlFor="hd-year">
            <Input id="hd-year" type="number" value={form.amend_year} onChange={(e) => set({ amend_year: e.target.value })} placeholder="2026" />
          </Field>
          <Field label="Deli.Dt" size="sm" htmlFor="hd-deli">
            <Input id="hd-deli" type="date" value={form.delivery_date} onChange={(e) => set({ delivery_date: e.target.value })} />
          </Field>
          <Field label="Excess %" size="sm" htmlFor="hd-excess">
            <Input id="hd-excess" type="number" value={form.excess_pct} onChange={(e) => set({ excess_pct: e.target.value })} />
          </Field>
          {/* The tick's word moves up into the field label and the cell gets
              `min-h-9 items-center`, so it centres on the same 36px control
              height as the Select beside it instead of floating at the top of
              its row. Same shape as Customer ▸ Also Notify. */}
          <Field label="Pack" size="sm" htmlFor="hd-pack">
            <label className="flex min-h-9 w-fit cursor-pointer items-center gap-2">
              <input id="hd-pack" type="checkbox" className="h-4 w-4 cursor-pointer accent-primary" checked={form.pack} onChange={(e) => set({ pack: e.target.checked })} />
              <span className="text-sm text-foreground">Yes</span>
            </label>
          </Field>
          <Field label="Mult. Ord" size="sm" htmlFor="hd-multord">
            <label className="flex min-h-9 w-fit cursor-pointer items-center gap-2">
              <input id="hd-multord" type="checkbox" className="h-4 w-4 cursor-pointer accent-primary" checked={form.mult_ord} onChange={(e) => set({ mult_ord: e.target.checked })} />
              <span className="text-sm text-foreground">Yes</span>
            </label>
          </Field>
        </FieldGrid>
      </SectionBody>
    ),
  };

  /**
   * The ten tabs, as rail sections, behind the header.
   *
   * A `map` rather than ten rewritten literals: the tab bodies are ~650 lines
   * of working JSX and this change is about the SHELL around them, not their
   * contents. Rewriting both at once would make a layout change and a behaviour
   * change indistinguishable in review.
   */
  const sections: FullScreenSection[] = [
    orderInfoSection,
    ...tabs.map((t) => ({
      key: t.key,
      label: t.label,
      icon: SECTION_ICONS[t.key] ?? FileText,
      done: sectionDone[t.key],
      content: t.content,
    })),
  ];

  return (
    // `flex h-full flex-col` is what a page-mounted MasterFullScreen requires:
    // it takes `flex-1 min-h-0` and needs a definite height to divide. `h-full`
    // resolves against `<main className="flex-1 overflow-y-auto">` in
    // app/(app)/layout.tsx, which is a flex item of a `h-screen` column. Leave
    // this as `space-y-4` and the editor sizes to its content instead, stranding
    // the footer above a strip of empty page.
    <div className="flex h-full flex-col gap-4">
      <PageHeader
        title={editId ? "Edit Amendment" : "New Amendment"}
        description="Pick an SCNo to load the order, then amend across the tabs. Wire each ⓘ field from stored data."
        actions={
          <Button variant="outline" size="md" onClick={() => setMode("list")}>
            ← Back to list
          </Button>
        }
      />

      {/* The header band that used to sit here is now the FIRST RAIL SECTION,
          "Order Info" — see `orderInfoSection` above. It was a flat 13-field
          `lg:grid-cols-4` on a full-bleed CardBody, so every box stretched to
          ~370px against the ~280px the layout rules fix a field at, and it
          hand-rolled `<div><Label/><Input/></div>` pairs, a literal "Date *"
          asterisk and two raw checkboxes — none of which the field primitives
          could see. Moving it into the rail puts every field on this screen in
          one place and one convention.

          The `pendingSeed` bar below deliberately did NOT move with it. It is a
          transient decision the operator must not miss, and a section is hidden
          the moment they navigate away from it. */}

      {/* Asked INLINE, not in a `confirm()` or a modal — LAYOUT.md §6a, the same
          reason Delete confirms inside its own row. It is also why this needs no
          `useModalGuard`: an inline bar is not an overlay, so the reload guard's
          DOM scan has nothing to miss. */}
      {pendingSeed && (
        <div className="rounded-md border border-warning/40 bg-warning/10 px-4 py-3">
          <p className="text-sm font-medium text-foreground">
            Replace the tabs with {pendingSeed.orderNo}&rsquo;s data?
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            The rows you have entered in the eight data tabs will be lost. The
            header has already moved to the new order.
          </p>
          <div className="mt-2 flex gap-2">
            <Button size="sm" onClick={acceptPendingSeed}>
              Replace
            </Button>
            <Button size="sm" variant="outline" onClick={() => setPendingSeed(null)}>
              Keep mine
            </Button>
          </div>
        </div>
      )}

      {/* THE TEN SUB-TABS ARE A SECTION RAIL, NOT A TOP STRIP (2026-08-09).
          `components/ui/tabs.tsx` gave ten items no arrow-key navigation, no
          roving tab stop, no `registerContentEdge` and no per-item state — a
          horizontally-scrolling row of underlined text with no way to tell which
          one held the error blocking Save. `MasterFullScreen` answers all four,
          and `mount="page"` is what lets a route use it without the overlay
          eating the sidebar.

          No `initialSection`: it falls back to sections[0], which is Style(s) —
          the tab the legacy screen opens on. It briefly carried
          defaultKey="logistic" from building that tab, so the screen opened on
          the charge blocks and read as the wrong screen entirely. */}
      <MasterFullScreen
        mount="page"
        open
        // No `header`: the route's own PageHeader above already names the
        // record, and a second identity band would announce it twice.
        onClose={() => setMode("list")}
        modeLabel={null}
        // The same signal `tabsHaveRows` computes for the discard prompt — real
        // rows the operator would lose — rather than `mode === "edit"`, which is
        // always true here and would pin the reload guard on permanently.
        dirty={tabsHaveRows}
        sections={sections}
        /**
         * Same footer contract as the Associates / Materials masters —
         * `customer-master-screen.tsx:1642` is the reference. `status` names the
         * save state, and `saveLabel` names the entity rather than reading a
         * bare "Save" that could belong to any record on any screen.
         *
         * `status` keys off `tabsHaveRows` rather than a `dirty` flag, because
         * this screen has never had one: its edits land in eight separate row
         * arrays and a header, with no single place that observes a change. So
         * it says "Unsaved changes" once real rows exist, and never claims "All
         * changes saved", which it cannot honestly know. Adding the flag is a
         * separate change — see the business-logic pass.
         */
        footer={{
          status: tabsHaveRows ? "Unsaved changes" : editId ? "Editing amendment" : "New amendment",
          onCancel: () => setMode("list"),
          onSave: () => submit(false),
          saveLabel: "Save amendment",
          canSave,
          onSaveDraft: perms.canCreate ? () => submit(true) : undefined,
          isPending,
        }}
      />
    </div>
  );
}

/**
 * One icon per section, keyed by the tab key it already had.
 *
 * A rail item is icon + label + status dot, so the icon is structural here in a
 * way it never was on the text-only strip. A module-level constant rather than
 * an inline lookup: it is a fixed vocabulary, and keeping it in one place makes
 * a missing entry obvious. An unknown key falls back to `FileText` rather than
 * rendering nothing, so a new tab is plain but never broken.
 */
const SECTION_ICONS: Record<string, LucideIcon> = {
  styles: Shirt,
  colors: Palette,
  combos: Layers,
  prices: Banknote,
  packtypes: Package,
  quantities: Hash,
  approvalqty: CheckCheck,
  logistic: Truck,
  reason: FileText,
};

// ---------- small building blocks ----------

/** A not-yet-wired tab — its screenshot hasn't been provided. Never dropped. */
function placeholderTab(key: string, label: string): TabItem {
  return {
    key,
    label,
    content: (
      <div className="rounded-md border border-dashed border-border bg-surface-muted/40 px-4 py-10 text-center">
        <p className="text-sm font-medium text-foreground">{label}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Awaiting the legacy screenshot — this tab will be wired (fields + data
          connectivity) when the {label} screen is shared.
        </p>
      </div>
    ),
  };
}

/** The Logistic "Less" / "Add" charge block: fixed + free-label rows. */
function GridCard({
  title,
  onAdd,
  children,
}: {
  title: string;
  onAdd: () => void;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardBody>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          <Button type="button" variant="subtle" size="sm" onClick={onAdd}>
            <Plus className="mr-1 h-3.5 w-3.5" /> Add row
          </Button>
        </div>
        {children}
      </CardBody>
    </Card>
  );
}

function RowRemove({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Remove row"
      className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-surface-muted hover:text-danger"
    >
      <Trash2 className="h-4 w-4" />
    </button>
  );
}

/** A spanning "no rows yet" placeholder line inside a grid table body. */
/**
 * `seeded` distinguishes the two ways a tab is empty, and they read identically
 * without it: nothing picked yet, versus an order that genuinely records no
 * rows of this kind. A correct seed on a thin order otherwise looks like a
 * seed that failed — which is exactly how a working feature gets reported
 * broken.
 */
function EmptyRow({ cols, label, seeded }: { cols: number; label: string; seeded?: boolean }) {
  return (
    <tr>
      <td colSpan={cols} className="px-2 py-6 text-center text-xs text-muted-foreground">
        {seeded ? <>This order records no {label}. Use “Add row”.</> : <>No {label}. Use “Add row”.</>}
      </td>
    </tr>
  );
}

/** The Yarn / Fabric dyeing grid (Type + colour picker), shared by both sections. */
function DyeTable({
  rows,
  colorItems,
  onUpdate,
  onRemove,
}: {
  rows: DyeingRow[];
  colorItems: PickerRow[];
  onUpdate: (key: string, patch: Partial<DyeingRow>) => void;
  onRemove: (key: string) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[420px] text-sm">
        <thead>
          <tr className="border-b border-border bg-surface-muted text-xs text-muted-foreground">
            <th className="px-2 py-1.5 text-left font-medium">Type</th>
            <th className="px-2 py-1.5 text-left font-medium">Colour</th>
            <th className="w-10" />
          </tr>
        </thead>
        <tbody data-grid-body onKeyDown={(e) => gridKeyNav(e, () => {})}>
          {rows.map((r) => (
            <tr key={r.key} data-grid-row className="border-b border-border last:border-0">
              <td className="px-2 py-1">
                <Input
                  value={r.dye_type}
                  onChange={(e) => onUpdate(r.key, { dye_type: e.target.value })}
                  className="h-8 min-w-[140px]"
                />
              </td>
              <td className="px-2 py-1 min-w-[240px]">
                <RecordPicker
                  label="Colour"
                  compact
                  items={colorItems}
                  value={r.color_id}
                  onChange={(id) => onUpdate(r.key, { color_id: id })}
                />
              </td>
              <td className="px-2 py-1">
                <RowRemove onClick={() => onRemove(r.key)} />
              </td>
            </tr>
          ))}
          {rows.length === 0 && <EmptyRow cols={3} label="rows" />}
        </tbody>
      </table>
    </div>
  );
}
