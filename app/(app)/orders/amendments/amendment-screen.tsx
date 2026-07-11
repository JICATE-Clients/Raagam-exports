"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardBody } from "@/components/ui/card";
import { DataTable, type Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import { Tabs, type TabItem } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/toast";
import { PageHeader } from "@/components/ui/page-header";
import { fmtDate } from "@/lib/format";
import { RecordPicker } from "@/components/masters/record-picker";
import { CountryPicker } from "@/components/masters/country-picker";
import { CurrencyPicker } from "@/components/masters/currency-picker";
import { LookupDialogPicker } from "@/components/masters/lookup-dialog-picker";
import {
  createAmendment,
  updateAmendment,
  deleteAmendment,
} from "@/lib/orders/amendments/actions";
import {
  INITIATED_OPTIONS,
  AMEND_TYPE_OPTIONS,
  SEASON_OPTIONS,
  SHIP_MODES,
  PAY_MODES,
  RECEIPT_MODES,
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

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean };

interface Props {
  rows: GarmentOrderAmendment[];
  data: AmendmentFormData;
  perms: Perms;
  /** masters:create/edit — gates inline Add/Modify inside config-list pickers. */
  masterPerms: { canCreate: boolean; canEdit: boolean };
}

// ---- editable child-row shapes ----
type ChargeRow = {
  key: string;
  section: "less" | "add";
  label: string;
  calc_mode: string;
  amount: string;
  unit: string;
  /** client-only: fixed legacy labels (Freight/Piece …) are not editable. */
  fixed: boolean;
};
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
type CountrySizeRow = {
  key: string;
  style_ref_no: string;
  style: string;
  article_no: string;
  countrywise: boolean;
};

// Fixed "Less" rows on the legacy Logistic tab (label read-only).
const LESS_FIXED = [
  "Freight / Piece",
  "Insurance / Piece",
  "Bonus",
  "Buyer Commission",
  "Agent Commission",
  "Discount",
];

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
  // cash discount
  cd1_pct: string;
  cd1_days: string;
  cd2_pct: string;
  cd2_days: string;
  cd3_pct: string;
  cd3_days: string;
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
  cd1_pct: "",
  cd1_days: "",
  cd2_pct: "",
  cd2_days: "",
  cd3_pct: "",
  cd3_days: "",
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
  const [charges, setCharges] = useState<ChargeRow[]>([]);
  const [stylePrices, setStylePrices] = useState<StylePriceRow[]>([]);
  // Phase 2 data-tab grids
  const [styles, setStyles] = useState<StyleRow[]>([]);
  const [dyeings, setDyeings] = useState<DyeingRow[]>([]);
  const [prints, setPrints] = useState<PrintRow[]>([]);
  const [structures, setStructures] = useState<StructureRow[]>([]);
  const [combos, setCombos] = useState<ComboRow[]>([]);
  const [priceDetails, setPriceDetails] = useState<PriceDetailRow[]>([]);
  const [approvalQtys, setApprovalQtys] = useState<ApprovalQtyRow[]>([]);
  const [countrySizes, setCountrySizes] = useState<CountrySizeRow[]>([]);
  const keySeq = useRef(0);
  const newKey = () => `k${keySeq.current++}`;

  // config_lookups split by kind (one query, filtered per picker)
  const { lookups } = data;
  const departmentOpts = useMemo(() => lookups.filter((l) => l.kind === "department"), [lookups]);
  const shipTypeOpts = useMemo(() => lookups.filter((l) => l.kind === "ship_type"), [lookups]);
  const agentOpts = useMemo(() => lookups.filter((l) => l.kind === "agent"), [lookups]);
  const payTermOpts = useMemo(() => lookups.filter((l) => l.kind === "payment_term"), [lookups]);
  const structureOpts = useMemo(() => lookups.filter((l) => l.kind === "structure"), [lookups]);
  const printOpts = useMemo(() => lookups.filter((l) => l.kind === "roll_form_print"), [lookups]);

  // Style picker items {id, code, name}; keep the full rows for auto-fill lookup.
  const styleItems: PickerRow[] = useMemo(
    () => data.styles.map((s) => ({ id: s.id, code: s.code, name: s.name })),
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

  /** Confirmed behaviour: picking an SCNo auto-loads the order's context. */
  function onSelectOrder(orderId: string | null) {
    if (!orderId) {
      set({ sales_order_id: null });
      return;
    }
    const o = data.orders.find((x) => x.id === orderId);
    set({
      sales_order_id: orderId,
      buyer_id: o?.buyer_id ?? form.buyer_id,
      currency_code: o?.currency_code ?? form.currency_code,
      delivery_date: o?.ship_date ?? form.delivery_date,
    });
  }

  function seedCharges(): ChargeRow[] {
    const blankCharge = (section: "less" | "add", label: string, fixed: boolean): ChargeRow => ({
      key: newKey(),
      section,
      label,
      calc_mode: "",
      amount: "",
      unit: "",
      fixed,
    });
    return [
      ...LESS_FIXED.map((l) => blankCharge("less", l, true)),
      blankCharge("less", "", false), // Others 1
      blankCharge("less", "", false), // Others 2
      blankCharge("add", "", false), // Add 1
      blankCharge("add", "", false), // Add 2
    ];
  }

  function openAdd() {
    setEditId(null);
    setForm({ ...BLANK, amend_date: today() });
    setCharges(seedCharges());
    setStylePrices([]);
    setStyles([]);
    setDyeings([]);
    setPrints([]);
    setStructures([]);
    setCombos([]);
    setPriceDetails([]);
    setApprovalQtys([]);
    setCountrySizes([]);
    setMode("edit");
  }

  function openEdit(r: GarmentOrderAmendment) {
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
      cd1_pct: r.cd1_pct ? String(r.cd1_pct) : "",
      cd1_days: r.cd1_days ? String(r.cd1_days) : "",
      cd2_pct: r.cd2_pct ? String(r.cd2_pct) : "",
      cd2_days: r.cd2_days ? String(r.cd2_days) : "",
      cd3_pct: r.cd3_pct ? String(r.cd3_pct) : "",
      cd3_days: r.cd3_days ? String(r.cd3_days) : "",
      amend_in_material_bom: r.amend_in_material_bom,
      amend_in_fabric_bom: r.amend_in_fabric_bom,
      amend_in_garment_process_bom: r.amend_in_garment_process_bom,
      reason_text: r.reason_text ?? "",
    });
    setCharges(
      r.charges.length
        ? r.charges.map((c) => ({
            key: newKey(),
            section: c.section,
            label: c.label ?? "",
            calc_mode: c.calc_mode ?? "",
            amount: c.amount ? String(c.amount) : "",
            unit: c.unit ?? "",
            fixed: LESS_FIXED.includes(c.label ?? ""),
          }))
        : seedCharges(),
    );
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
    setStyles(
      r.styles.map((x) => ({
        key: newKey(),
        style_ref_no: x.style_ref_no ?? "",
        style_id: x.style_id,
        article_no: x.article_no ?? "",
        style_category: x.style_category ?? "",
        style_description: x.style_description ?? "",
        order_unit_id: x.order_unit_id,
        plan_unit_id: x.plan_unit_id,
        po_qty: x.po_qty ? String(x.po_qty) : "",
        description: x.description ?? "",
      })),
    );
    setDyeings(
      r.dyeings.map((x) => ({
        key: newKey(),
        section: x.section,
        dye_type: x.dye_type ?? "",
        color_id: x.color_id,
      })),
    );
    setPrints(r.prints.map((x) => ({ key: newKey(), print_id: x.print_id })));
    setStructures(r.structures.map((x) => ({ key: newKey(), structure_id: x.structure_id })));
    setCombos(
      r.combos.map((x) => ({
        key: newKey(),
        style_ref_no: x.style_ref_no ?? "",
        style: x.style ?? "",
        article_no: x.article_no ?? "",
      })),
    );
    setPriceDetails(
      r.price_details.map((x) => ({
        key: newKey(),
        style_ref_no: x.style_ref_no ?? "",
        style: x.style ?? "",
        article_no: x.article_no ?? "",
        price_type: x.price_type ?? "",
        unit: x.unit ?? "",
        price: x.price ? String(x.price) : "",
      })),
    );
    setApprovalQtys(
      r.approval_qtys.map((x) => ({
        key: newKey(),
        style_ref_no: x.style_ref_no ?? "",
        style: x.style ?? "",
        article_no: x.article_no ?? "",
        approval_qty: x.approval_qty ? String(x.approval_qty) : "",
      })),
    );
    setCountrySizes(
      r.country_sizes.map((x) => ({
        key: newKey(),
        style_ref_no: x.style_ref_no ?? "",
        style: x.style ?? "",
        article_no: x.article_no ?? "",
        countrywise: x.countrywise,
      })),
    );
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
      cd1_pct: numOrNull(form.cd1_pct) ?? 0,
      cd1_days: numOrNull(form.cd1_days) ?? 0,
      cd2_pct: numOrNull(form.cd2_pct) ?? 0,
      cd2_days: numOrNull(form.cd2_days) ?? 0,
      cd3_pct: numOrNull(form.cd3_pct) ?? 0,
      cd3_days: numOrNull(form.cd3_days) ?? 0,
      amend_in_material_bom: form.amend_in_material_bom,
      amend_in_fabric_bom: form.amend_in_fabric_bom,
      amend_in_garment_process_bom: form.amend_in_garment_process_bom,
      reason_text: form.reason_text || null,
      charges: charges.map((c) => ({
        sno: 0,
        section: c.section,
        label: c.label || null,
        calc_mode: c.calc_mode || null,
        amount: numOrNull(c.amount) ?? 0,
        unit: c.unit || null,
      })),
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
      country_sizes: countrySizes.map((r) => ({
        sno: 0,
        style_ref_no: r.style_ref_no || null,
        style: r.style || null,
        article_no: r.article_no || null,
        countrywise: r.countrywise,
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
    if (!confirm(`Delete amendment ${r.code ?? ""}?`)) return;
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
      {
        header: "",
        align: "right",
        cell: (r) => (
          <div className="flex justify-end gap-1">
            {perms.canEdit && (
              <Button variant="outline" size="sm" onClick={() => openEdit(r)}>
                Edit
              </Button>
            )}
            {perms.canDelete && (
              <Button variant="outline" size="sm" onClick={() => del(r)}>
                Delete
              </Button>
            )}
          </div>
        ),
      },
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
          columns={columns}
          rows={rows}
          getKey={(r) => r.id}
          empty="No amendments yet. Use 'New Amendment' to create the first."
        />
      </div>
    );
  }

  // ---------------- EDIT MODE ----------------
  const canSave = !!form.amend_date;

  const lessRows = charges.filter((c) => c.section === "less");
  const addRows = charges.filter((c) => c.section === "add");

  const updateCharge = (key: string, patch: Partial<ChargeRow>) =>
    setCharges((xs) => xs.map((x) => (x.key === key ? { ...x, ...patch } : x)));

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
  const addCountrySize = () =>
    setCountrySizes((xs) => [
      ...xs,
      { key: newKey(), style_ref_no: "", style: "", article_no: "", countrywise: false },
    ]);

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
              <tbody>
                {styles.map((r) => (
                  <tr key={r.key} className="border-b border-border align-top last:border-0">
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
                {styles.length === 0 && <EmptyRow cols={10} label="styles" />}
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
                <p className="py-4 text-center text-xs text-muted-foreground">No prints. Use “Add row”.</p>
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
                <p className="py-4 text-center text-xs text-muted-foreground">No structures. Use “Add row”.</p>
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
              <tbody>
                {combos.map((r) => {
                  const upd = (patch: Partial<ComboRow>) =>
                    setCombos((xs) => xs.map((x) => (x.key === r.key ? { ...x, ...patch } : x)));
                  return (
                    <tr key={r.key} className="border-b border-border last:border-0">
                      <td className="px-2 py-1"><Input value={r.style_ref_no} onChange={(e) => upd({ style_ref_no: e.target.value })} className="h-8" /></td>
                      <td className="px-2 py-1"><Input value={r.style} onChange={(e) => upd({ style: e.target.value })} className="h-8" /></td>
                      <td className="px-2 py-1"><Input value={r.article_no} onChange={(e) => upd({ article_no: e.target.value })} className="h-8" /></td>
                      <td className="px-2 py-1"><RowRemove onClick={() => setCombos((xs) => xs.filter((x) => x.key !== r.key))} /></td>
                    </tr>
                  );
                })}
                {combos.length === 0 && <EmptyRow cols={4} label="combos" />}
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
              <tbody>
                {priceDetails.map((r) => {
                  const upd = (patch: Partial<PriceDetailRow>) =>
                    setPriceDetails((xs) => xs.map((x) => (x.key === r.key ? { ...x, ...patch } : x)));
                  return (
                    <tr key={r.key} className="border-b border-border last:border-0">
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
                {priceDetails.length === 0 && <EmptyRow cols={7} label="prices" />}
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
              <tbody>
                {approvalQtys.map((r) => {
                  const upd = (patch: Partial<ApprovalQtyRow>) =>
                    setApprovalQtys((xs) => xs.map((x) => (x.key === r.key ? { ...x, ...patch } : x)));
                  return (
                    <tr key={r.key} className="border-b border-border last:border-0">
                      <td className="px-2 py-1"><Input value={r.style_ref_no} onChange={(e) => upd({ style_ref_no: e.target.value })} className="h-8" /></td>
                      <td className="px-2 py-1"><Input value={r.style} onChange={(e) => upd({ style: e.target.value })} className="h-8" /></td>
                      <td className="px-2 py-1"><Input value={r.article_no} onChange={(e) => upd({ article_no: e.target.value })} className="h-8" /></td>
                      <td className="px-2 py-1"><Input type="number" value={r.approval_qty} onChange={(e) => upd({ approval_qty: e.target.value })} className="h-8 w-28 text-right" /></td>
                      <td className="px-2 py-1"><RowRemove onClick={() => setApprovalQtys((xs) => xs.filter((x) => x.key !== r.key))} /></td>
                    </tr>
                  );
                })}
                {approvalQtys.length === 0 && <EmptyRow cols={5} label="approval quantities" />}
              </tbody>
            </table>
          </div>
        </GridCard>
      ),
    },
    // ---------------- Country / Sizewise ----------------
    {
      key: "countrysize",
      label: "Country/Sizewise",
      content: (
        <GridCard title="Country / Size Details" onAdd={addCountrySize}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-border bg-surface-muted text-xs text-muted-foreground">
                  <th className="px-2 py-1.5 text-left font-medium">Style Ref No</th>
                  <th className="px-2 py-1.5 text-left font-medium">Style</th>
                  <th className="px-2 py-1.5 text-left font-medium">Article No</th>
                  <th className="px-2 py-1.5 text-center font-medium">Countrywise</th>
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody>
                {countrySizes.map((r) => {
                  const upd = (patch: Partial<CountrySizeRow>) =>
                    setCountrySizes((xs) => xs.map((x) => (x.key === r.key ? { ...x, ...patch } : x)));
                  return (
                    <tr key={r.key} className="border-b border-border last:border-0">
                      <td className="px-2 py-1"><Input value={r.style_ref_no} onChange={(e) => upd({ style_ref_no: e.target.value })} className="h-8" /></td>
                      <td className="px-2 py-1"><Input value={r.style} onChange={(e) => upd({ style: e.target.value })} className="h-8" /></td>
                      <td className="px-2 py-1"><Input value={r.article_no} onChange={(e) => upd({ article_no: e.target.value })} className="h-8" /></td>
                      <td className="px-2 py-1 text-center">
                        <label className="inline-flex items-center gap-2 text-xs">
                          <input type="checkbox" checked={r.countrywise} onChange={(e) => upd({ countrywise: e.target.checked })} className="h-4 w-4 rounded border-border" />
                          <Button type="button" variant="outline" size="sm" disabled title="Countrywise detail — awaiting spec">
                            Detail
                          </Button>
                        </label>
                      </td>
                      <td className="px-2 py-1"><RowRemove onClick={() => setCountrySizes((xs) => xs.filter((x) => x.key !== r.key))} /></td>
                    </tr>
                  );
                })}
                {countrySizes.length === 0 && <EmptyRow cols={5} label="country / size rows" />}
              </tbody>
            </table>
          </div>
        </GridCard>
      ),
    },
    {
      key: "logistic",
      label: "Logistic",
      content: (
        <div className="space-y-4">
          {/* Logistic scalars */}
          <Card>
            <CardBody className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <LookupDialogPicker
                kind="department"
                label="Department"
                options={departmentOpts}
                value={form.department_id}
                onChange={(id) => set({ department_id: id })}
                canCreate={masterPerms.canCreate}
                canEdit={masterPerms.canEdit}
              />
              <LookupDialogPicker
                kind="ship_type"
                label="Ship Type"
                options={shipTypeOpts}
                value={form.ship_type_id}
                onChange={(id) => set({ ship_type_id: id })}
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
              <LookupDialogPicker
                kind="agent"
                label="Agent"
                options={agentOpts}
                value={form.agent_id}
                onChange={(id) => set({ agent_id: id })}
                canCreate={masterPerms.canCreate}
                canEdit={masterPerms.canEdit}
              />
              <div>
                <Label htmlFor="lg-shipmode">Ship Mode</Label>
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
              </div>
              <CountryPicker
                countries={data.countries}
                value={form.country_id}
                onChange={(id) => set({ country_id: id })}
                canCreate={masterPerms.canCreate}
                canEdit={masterPerms.canEdit}
              />
              <CurrencyPicker
                label="Currency"
                currencies={data.currencies}
                value={form.currency_code}
                onChange={(code) => set({ currency_code: code })}
                canCreate={masterPerms.canCreate}
                canEdit={masterPerms.canEdit}
              />
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
              <div>
                <Label htmlFor="lg-recmode">Received (mode)</Label>
                <Select
                  id="lg-recmode"
                  value={form.received_mode}
                  onChange={(e) => set({ received_mode: e.target.value })}
                >
                  <option value="">—</option>
                  {RECEIPT_MODES.map((o) => (
                    <option key={o} value={o}>{o}</option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="lg-paymode">Pay Mode</Label>
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
              </div>
              <LookupDialogPicker
                kind="payment_term"
                label="Pay Terms"
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

          {/* Less / Add charges */}
          <Card>
            <CardBody className="space-y-4">
              <ChargeBlock
                title="Less"
                rows={lessRows}
                onUpdate={updateCharge}
              />
              <ChargeBlock title="Add" rows={addRows} onUpdate={updateCharge} />
            </CardBody>
          </Card>

          {/* Cash Discount */}
          <Card>
            <CardBody>
              <h3 className="mb-2 text-sm font-semibold text-foreground">Cash Discount</h3>
              <div className="space-y-2">
                {([1, 2, 3] as const).map((n) => {
                  const pctKey = `cd${n}_pct` as const;
                  const daysKey = `cd${n}_days` as const;
                  return (
                    <div key={n} className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="w-16 text-muted-foreground">CD of {n}</span>
                      <Input
                        type="number"
                        value={form[pctKey]}
                        onChange={(e) => set({ [pctKey]: e.target.value } as Partial<HeaderForm>)}
                        className="h-8 w-24"
                      />
                      <span className="text-muted-foreground">% if Paid in</span>
                      <Input
                        type="number"
                        value={form[daysKey]}
                        onChange={(e) => set({ [daysKey]: e.target.value } as Partial<HeaderForm>)}
                        className="h-8 w-24"
                      />
                      <span className="text-muted-foreground">Days</span>
                    </div>
                  );
                })}
              </div>
            </CardBody>
          </Card>

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
                <tbody>
                  {stylePrices.map((r) => {
                    const upd = (patch: Partial<StylePriceRow>) =>
                      setStylePrices((xs) => xs.map((x) => (x.key === r.key ? { ...x, ...patch } : x)));
                    return (
                      <tr key={r.key} className="border-b border-border last:border-0">
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

  return (
    <div className="space-y-4">
      <PageHeader
        title={editId ? "Edit Amendment" : "New Amendment"}
        description="Pick an SCNo to load the order, then amend across the tabs. Wire each ⓘ field from stored data."
        actions={
          <Button variant="outline" size="sm" onClick={() => setMode("list")}>
            ← Back to list
          </Button>
        }
      />

      {/* Header band (always visible above the tabs) */}
      <Card>
        <CardBody className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <RecordPicker
            label="SCNo"
            items={orderItems}
            value={form.sales_order_id}
            onChange={onSelectOrder}
          />
          <div>
            <Label htmlFor="hd-date">Date *</Label>
            <Input id="hd-date" type="date" value={form.amend_date} onChange={(e) => set({ amend_date: e.target.value })} />
          </div>
          <div>
            <Label htmlFor="hd-initiated">Initiated</Label>
            <Select id="hd-initiated" value={form.initiated} onChange={(e) => set({ initiated: e.target.value })}>
              <option value="">—</option>
              {INITIATED_OPTIONS.map((o) => (
                <option key={o} value={o}>{o}</option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="hd-type">Type</Label>
            <Select id="hd-type" value={form.amend_type} onChange={(e) => set({ amend_type: e.target.value })}>
              <option value="">—</option>
              {AMEND_TYPE_OPTIONS.map((o) => (
                <option key={o} value={o}>{o}</option>
              ))}
            </Select>
          </div>
          <RecordPicker
            label="Customer"
            items={data.buyers}
            value={form.buyer_id}
            onChange={(id) => set({ buyer_id: id })}
          />
          <div>
            <Label htmlFor="hd-pono">PO No</Label>
            <Input id="hd-pono" value={form.po_no} onChange={(e) => set({ po_no: e.target.value })} />
          </div>
          <RecordPicker
            label="Merchand."
            items={data.merchandisers}
            value={form.merchandiser_id}
            onChange={(id) => set({ merchandiser_id: id })}
          />
          <div>
            <Label htmlFor="hd-season">Season</Label>
            <Select id="hd-season" value={form.season} onChange={(e) => set({ season: e.target.value })}>
              <option value="">—</option>
              {SEASON_OPTIONS.map((o) => (
                <option key={o} value={o}>{o}</option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="hd-year">Yr</Label>
            <Input id="hd-year" type="number" value={form.amend_year} onChange={(e) => set({ amend_year: e.target.value })} placeholder="2026" />
          </div>
          <div>
            <Label htmlFor="hd-deli">Deli.Dt</Label>
            <Input id="hd-deli" type="date" value={form.delivery_date} onChange={(e) => set({ delivery_date: e.target.value })} />
          </div>
          <div>
            <Label htmlFor="hd-excess">Excess %</Label>
            <Input id="hd-excess" type="number" value={form.excess_pct} onChange={(e) => set({ excess_pct: e.target.value })} />
          </div>
          <div className="flex items-end gap-4 pb-1">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.pack} onChange={(e) => set({ pack: e.target.checked })} className="h-4 w-4 rounded border-border" />
              Pack
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.mult_ord} onChange={(e) => set({ mult_ord: e.target.checked })} className="h-4 w-4 rounded border-border" />
              Mult. Ord
            </label>
          </div>
        </CardBody>
      </Card>

      {/* 10 sub-tabs */}
      <Card>
        <CardBody>
          <Tabs items={tabs} defaultKey="logistic" />
        </CardBody>
      </Card>

      {/* Footer */}
      <div className="sticky bottom-0 flex justify-end gap-2 border-t border-border bg-surface/95 py-3 backdrop-blur">
        <Button variant="outline" onClick={() => setMode("list")}>
          Cancel
        </Button>
        {perms.canCreate && (
          <Button variant="outline" disabled={isPending || !canSave} onClick={() => submit(true)}>
            Save as Draft
          </Button>
        )}
        <Button disabled={isPending || !canSave} onClick={() => submit(false)}>
          {isPending ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  );
}

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
function ChargeBlock({
  title,
  rows,
  onUpdate,
}: {
  title: string;
  rows: ChargeRow[];
  onUpdate: (key: string, patch: Partial<ChargeRow>) => void;
}) {
  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold text-foreground">{title}</h3>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] text-sm">
          <thead>
            <tr className="border-b border-border bg-surface-muted text-xs text-muted-foreground">
              <th className="px-2 py-1.5 text-left font-medium">Item</th>
              <th className="px-2 py-1.5 text-left font-medium">Mode</th>
              <th className="px-2 py-1.5 text-right font-medium">Amount</th>
              <th className="px-2 py-1.5 text-left font-medium">Unit</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className="border-b border-border last:border-0">
                <td className="px-2 py-1">
                  {r.fixed ? (
                    <span className="text-sm text-foreground">{r.label}</span>
                  ) : (
                    <Input
                      value={r.label}
                      onChange={(e) => onUpdate(r.key, { label: e.target.value })}
                      placeholder={title === "Add" ? "Add charge…" : "Others…"}
                      className="h-8"
                    />
                  )}
                </td>
                <td className="px-2 py-1">
                  <Input
                    value={r.calc_mode}
                    onChange={(e) => onUpdate(r.key, { calc_mode: e.target.value })}
                    className="h-8"
                  />
                </td>
                <td className="px-2 py-1">
                  <Input
                    type="number"
                    value={r.amount}
                    onChange={(e) => onUpdate(r.key, { amount: e.target.value })}
                    className="h-8 text-right"
                  />
                </td>
                <td className="px-2 py-1">
                  <Input
                    value={r.unit}
                    onChange={(e) => onUpdate(r.key, { unit: e.target.value })}
                    className="h-8"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

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
function EmptyRow({ cols, label }: { cols: number; label: string }) {
  return (
    <tr>
      <td colSpan={cols} className="px-2 py-6 text-center text-xs text-muted-foreground">
        No {label}. Use “Add row”.
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
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-b border-border last:border-0">
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
