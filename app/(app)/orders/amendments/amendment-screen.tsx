"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Trash2,
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
import { ChildGrid, gridKeyNav, type ChildGridColumn } from "@/components/masters/child-grid";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Combobox } from "@/components/ui/combobox";
import { Sheet } from "@/components/ui/sheet";
import { StyleProcessSheet } from "@/components/orders/style-process-sheet";
import type { StyleProcessRow } from "@/lib/orders/amendments/style-processes";
import {
  excessQty,
  projectionQty,
  totalProductionQty,
} from "@/lib/orders/amendments/approval-qty";
import { orderValue } from "@/lib/orders/amendments/order-value";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardBody } from "@/components/ui/card";
import { DataTable, type Column } from "@/components/ui/data-table";
import { RowActions } from "@/components/ui/row-actions";
import { rowActionsColumn } from "@/components/ui/row-actions-column";
import { StatusPill } from "@/components/ui/status-pill";
import {
  bomStatusHint,
  bomStatusText,
  bomStatusTone,
  type BomStatus,
} from "@/lib/orders/material-bom-amendment/status";
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
import { SectionGrid } from "@/components/masters/section-grid";
import { useToast } from "@/components/ui/toast";
import { PageHeader } from "@/components/ui/page-header";
import { fmtDate, fmtMoney, fmtNumber } from "@/lib/format";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { useCreateIntent } from "@/lib/use-create-intent";
import { isInactive } from "@/lib/masters/inactive";
import { previewOrderNumber } from "@/lib/orders/actions";
import { RecordPicker } from "@/components/masters/record-picker";
import { CountryPicker } from "@/components/masters/country-picker";
import { CurrencyPicker } from "@/components/masters/currency-picker";
import { LookupDialogPicker } from "@/components/masters/lookup-dialog-picker";
import { lookupLabel } from "@/lib/masters/extras-types";
import {
  gsmRange,
  structureProblems,
  FABRIC_TYPE_OPTIONS,
  ITEM_SUB_TYPE_OPTIONS,
  asItemSubType,
  takesDyedColour,
  takesAllOverPrint,
} from "@/lib/orders/amendments/combo-rules";
import { PaymentTermPicker } from "@/components/masters/payment-term-picker";
import {
  createAmendment,
  updateAmendment,
  deleteAmendment,
  loadOrderSeed,
} from "@/lib/orders/amendments/actions";
import type { FabricTypeCounts, SeededAmendmentChildren } from "@/lib/orders/amendments/order-seed";
// From `style-key.ts`, NOT from `order-seed.ts` — that module is `server-only`
// and this is a client component. Same function either way; 0407's note in
// `style-key.ts` says why it was split out rather than copied.
import { styleKey } from "@/lib/orders/amendments/style-key";
import {
  PACK_TYPE_OPTIONS,
  PRICE_TYPE_OPTIONS,
  SEASON_OPTIONS,
  SHIP_MODES,
  PAY_MODES,
  amendmentStatusTone,
  amendmentStatusText,
  orderUnitLabel,
  type GarmentOrderAmendment,
} from "@/lib/orders/amendments/types";
import { styleOptions, type StyleFilterRow } from "@/lib/orders/amendments/style-options";
import type {
  AmendmentFormData,
  PickerRow,
  StylePickerRow,
} from "@/lib/orders/amendments/service";
import { withCreatedColumns } from "@/components/ui/created-columns";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean };

interface Props {
  rows: GarmentOrderAmendment[];
  data: AmendmentFormData;
  /**
   * Has each order's material been planned, and is that plan still current?
   *
   * Keyed by amendment id. Fetched by the loader in its own call rather than
   * embedded on `getAmendments()` — see the note there. An order missing from
   * the map reads as "pending", which is what a brand-new order genuinely is.
   */
  bomStatus: Record<string, { status: BomStatus; qty: number | null }>;
  perms: Perms;
  /** masters:create/edit — gates inline Add/Modify inside config-list pickers. */
  masterPerms: { canCreate: boolean; canEdit: boolean };
  /** The operator's home Unit (`profiles.default_location_id`), or null. */
  defaultLocationId: string | null;
  /**
   * WHICH DOOR THE OPERATOR CAME THROUGH.
   *
   * One screen, two routes: `/orders/garment-orders` raises a garment order
   * (Order Entry ▸ Garment Order) and `/orders/amendments` amends a saved one
   * (Amendments ▸ Order Amendment). Both were the SAME url until 2026-08-13,
   * which is why the screen used to say "New Garment Order" at the top and
   * "Save amendment" at the bottom — there was nothing it could read to tell
   * which job it was doing.
   *
   * The difference is not only wording. `createAmendment` mints a NEW
   * `sales_orders` row, so amend mode must not be able to create at all.
   *
   * NOT called `mode`: that name is already taken below by the list/edit state
   * of this screen, and two `mode`s in one component is how a condition ends up
   * reading the wrong one.
   *
   * Defaults to entry, so the door that RAISES an order is the one a caller
   * gets by forgetting — a missing prop that silently disabled order creation
   * would be the worse failure.
   */
  purpose?: "entry" | "amend";
}

// ---- editable child-row shapes ----
// ---- Phase 2 (0128) editable child-row shapes ----
/**
 * One size under a style line (0407). `key` is React's, `size_id` is the data.
 *
 * NESTED INSIDE `StyleRow` RATHER THAN HELD AS A SIBLING LIST, so a size cannot
 * outlive the style it belongs to: removing a style row removes its sizes in
 * the same `setStyles` call, with nothing to keep in step. The payload flattens
 * them back out and `normalizeStyleSizes` guards the import path, which is the
 * only door that reaches the table without passing through this shape.
 */
type SizeRow = { key: string; size_id: string | null };
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
  /** The style's size set, listed under the row. Order IS the data. */
  sizes: SizeRow[];
  /**
   * The line's Process list (0411), edited in a sheet off the Process button.
   *
   * Nested here and flattened on submit, exactly as `sizes` is: the payload key
   * is the flat `style_processes`, keyed by `style_ref_no`, because
   * `writeChildren` reinserts `..._styles` wholesale and an id would dangle.
   */
  processes: StyleProcessRow[];
};
type DyeingRow = {
  key: string;
  section: "yarn" | "fabric";
  dye_type: string;
  /** Typed on screen (0403). */
  color_name: string;
  /** Pre-0403 colour-card id, carried so a save cannot null it. */
  color_id: string | null;
};
type PrintRow = { key: string; print_id: string | null };
/**
 * Color/Print ▸ one fabric structure of the ORDER (0415).
 *
 * `structure_id` is a fabric CATEGORY — the same value
 * `garment_style_components.fabric_category_id` holds, which is what lets this
 * grid be SEEDED from the order's own style lines instead of retyped.
 * `item_sub_type` is Solid / Melange / Yarn Dyed / Printed, and it is what the
 * combo structure below inherits when the same fabric is picked there.
 */
type StructureRow = { key: string; structure_id: string | null; item_sub_type: string };
/**
 * Combos ▸ Detail ▸ one garment part of one structure (0408).
 *
 * Nested inside its structure, which is nested inside its combo, for the same
 * reason `StyleRow.sizes` is nested: a part cannot outlive the structure it is
 * made of, and removing a structure removes its parts in the same `setCombos`
 * call with nothing to keep in step. `writeComboTree` flattens the three levels
 * on the way out.
 */
type ComboCompRow = {
  key: string;
  coordinate_id: string | null;
  component_id: string | null;
  color_name: string;
  /** "Fabric Print" — ONE field (0410, operator). */
  print_id: string | null;
  processed_as_trim: boolean;
};
/** Combos ▸ Detail ▸ one fabric structure of one combo (0408 · 0409). */
type ComboStructRow = {
  key: string;
  /** A fabric CATEGORY (0409) — SINGLE JERSEY, not Circular Knit. */
  structure_id: string | null;
  fabric_type: string;
  composition_id: string | null;
  gsm: string;
  gsm_tolerance: string;
  item_sub_type: string;
  components: ComboCompRow[];
};
type ComboRow = {
  key: string;
  style_ref_no: string;
  style: string;
  article_no: string;
  combo: string;
  combo_description: string;
  structures: ComboStructRow[];
};
type PriceDetailRow = {
  key: string;
  style_ref_no: string;
  style: string;
  article_no: string;
  price_type: string;
  /** WHICH colourway this rate is for (0416). "" unless the mode prices by colour. */
  combo: string;
  /** WHICH size this rate is for (0416). null unless the mode prices by size. */
  size_id: string | null;
  unit: string;
  price: string;
};
/**
 * Pack type(s) tab (0399) — the legacy grid is S No + Pack Type and nothing
 * else, so the row is its one value.
 */
type PackTypeRow = { key: string; pack_type: string };
/** Quantities ▸ Assort ▸ one size cell (0414). `qty` is a string: it is typed. */
type AssortSizeRow = { key: string; size_id: string | null; qty: string };
/**
 * Quantities ▸ Assort ▸ one line of the Assortments grid (0414).
 *
 * NO `pcs_per_pack` — it is the sum of `sizes` (the pieces in one carton), so a
 * field for it would be a second source of truth for an addition. Same rule
 * `gsmRange` follows on the Combos overlay.
 *
 * Nested inside its quantity row, like `StyleRow.sizes` and
 * `ComboStructRow.components`, so a line cannot outlive the destination it
 * packs for; `writeAssortTree` flattens the levels on the way out.
 */
type AssortLineRow = {
  key: string;
  combo: string;
  no_of_cartons: string;
  sizes: AssortSizeRow[];
};
/** Quantities tab (0398) — the legacy "Quantities Details" grid. */
type QuantityRow = {
  key: string;
  country_id: string | null;
  style_ref_no: string;
  style_no: string;
  consignee_id: string | null;
  assortment_type_id: string | null;
  po_qty: string;
  delivery_date: string;
  earlier_shipment_date: string;
  warehouse_id: string | null;
  discharge_port_id: string | null;
  // ---- the Assort overlay's header (0414), one-to-one with this row ----
  // Master/Inner Carton and Pack Description were withdrawn from the amendment
  // HEADER on 2026-08-10, where they were one answer for a whole order. Legacy
  // asks them per ASSORTMENT, which is what a quantity row is.
  pack: string;
  is_ratio_wise_pack: boolean;
  ratio_for: string;
  is_single_style_pack: boolean;
  master_carton_name: string;
  inner_carton_name: string;
  pack_description: string;
  assort_lines: AssortLineRow[];
};
type ApprovalQtyRow = {
  key: string;
  style_ref_no: string;
  style: string;
  article_no: string;
  /** The colour this line is for (0413). One approval line per style + combo. */
  combo: string;
  combo_description: string;
  /** Ordered pieces of THIS combo — typed, because nothing derives it (0413). */
  qty: string;
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
  /**
   * Saved sizes (0407), regrouped under the style they name.
   *
   * They arrive as ONE flat list because that is how the table stores them, and
   * they are bound to their style by TEXT — so this is the read-side half of
   * `normalizeStyleSizes`, and it compares the key the same way: `styleKey`,
   * trim + upper-case, never `===` on the raw string. Rows saved before the
   * CAPITALS rule are not upper-cased in the database, and a case-sensitive
   * match here would silently drop every size on an older order.
   *
   * A size whose style is no longer on the document is DROPPED rather than
   * shown loose. The normalizer cannot have written one, so this only ever
   * fires against rows that reached the table some other way (`lib/data-io`),
   * and a size with no line to sit under has nowhere to render.
   */
  const sizesByStyle = new Map<string, SizeRow[]>();
  for (const x of src.styleSizes ?? []) {
    const k = styleKey(x.style_ref_no);
    const list = sizesByStyle.get(k);
    const row: SizeRow = { key: newKey(), size_id: x.size_id };
    if (list) list.push(row);
    else sizesByStyle.set(k, [row]);
  }
  /* Same grouping as the sizes above, and for the same reason: the rows arrive
     flat and keyed by `style_ref_no`, and the grid needs them under their line.
     A process whose style is not on the order has nowhere to render; the
     normalizer cannot have written one, so this only fires on rows that reached
     the table another way (`lib/data-io`). */
  const processesByStyle = new Map<string, StyleProcessRow[]>();
  for (const x of src.styleProcesses ?? []) {
    const k = styleKey(x.style_ref_no);
    const list = processesByStyle.get(k);
    const row: StyleProcessRow = {
      key: newKey(),
      kind: x.kind,
      process_id: x.process_id,
      component_id: x.component_id,
      details: txt(x.details),
    };
    if (list) list.push(row);
    else processesByStyle.set(k, [row]);
  }
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
      sizes: sizesByStyle.get(styleKey(x.style_ref_no)) ?? [],
      processes: processesByStyle.get(styleKey(x.style_ref_no)) ?? [],
    })),
    dyeings: src.dyeings.map((x): DyeingRow => ({
      key: newKey(),
      section: x.section,
      dye_type: txt(x.dye_type),
      color_name: txt(x.color_name),
      color_id: x.color_id,
    })),
    prints: src.prints.map((x): PrintRow => ({ key: newKey(), print_id: x.print_id })),
    structures: src.structures.map((x): StructureRow => ({
      key: newKey(),
      structure_id: x.structure_id,
      item_sub_type: x.item_sub_type ?? "",
    })),
    combos: src.combos.map((x): ComboRow => ({
      key: newKey(),
      ...styleCols(x),
      combo: txt(x.combo),
      combo_description: txt(x.combo_description),
      // The Detail tree (0408). Nested all the way down, so a saved document
      // reopens with the same shape the editor writes.
      structures: (x.structures ?? []).map((st): ComboStructRow => ({
        key: newKey(),
        structure_id: st.structure_id,
        fabric_type: txt(st.fabric_type),
        composition_id: st.composition_id,
        gsm: num(st.gsm),
        gsm_tolerance: num(st.gsm_tolerance),
        item_sub_type: txt(st.item_sub_type),
        components: (st.components ?? []).map((c): ComboCompRow => ({
          key: newKey(),
          coordinate_id: c.coordinate_id,
          component_id: c.component_id,
          color_name: txt(c.color_name),
          print_id: c.print_id,
          processed_as_trim: c.processed_as_trim ?? false,
        })),
      })),
    })),
    priceDetails: src.priceDetails.map((x): PriceDetailRow => ({
      key: newKey(),
      ...styleCols(x),
      price_type: txt(x.price_type),
      combo: txt(x.combo),
      size_id: x.size_id,
      unit: txt(x.unit),
      price: num(x.price),
    })),
    approvalQtys: src.approvalQtys.map((x): ApprovalQtyRow => ({
      key: newKey(),
      ...styleCols(x),
      combo: txt(x.combo),
      combo_description: txt(x.combo_description),
      qty: num(x.qty),
      approval_qty: num(x.approval_qty),
    })),
    // `?? []` like `quantities` below: the seed from an order never carries
    // pack types (nothing on the order side records a packing method), so the
    // key is genuinely absent on that path rather than an empty array.
    packTypes: (src.packTypes ?? []).map((x): PackTypeRow => ({
      key: newKey(),
      pack_type: txt(x.pack_type),
    })),
    quantities: (src.quantities ?? []).map((x): QuantityRow => ({
      key: newKey(),
      country_id: x.country_id ?? null,
      style_ref_no: txt(x.style_ref_no),
      style_no: txt(x.style_no),
      consignee_id: x.consignee_id ?? null,
      assortment_type_id: x.assortment_type_id ?? null,
      po_qty: num(x.po_qty),
      delivery_date: txt(x.delivery_date),
      earlier_shipment_date: txt(x.earlier_shipment_date),
      warehouse_id: x.warehouse_id ?? null,
      discharge_port_id: x.discharge_port_id ?? null,
      // ---- the Assort tree (0414) ----
      pack: txt(x.pack),
      is_ratio_wise_pack: x.is_ratio_wise_pack ?? false,
      ratio_for: txt(x.ratio_for),
      is_single_style_pack: x.is_single_style_pack ?? false,
      master_carton_name: txt(x.master_carton_name),
      inner_carton_name: txt(x.inner_carton_name),
      pack_description: txt(x.pack_description),
      assort_lines: (x.assort_lines ?? []).map((l): AssortLineRow => ({
        key: newKey(),
        combo: txt(l.combo),
        no_of_cartons: num(l.no_of_cartons),
        // Size cells come back UNSORTED and are looked up by `size_id`, never
        // by position: the column ORDER is the style's size list, which the
        // overlay derives, so a stored order would be a second answer to it.
        sizes: (l.sizes ?? []).map((z): AssortSizeRow => ({
          key: newKey(),
          size_id: z.size_id,
          qty: num(z.qty),
        })),
      })),
    })),
  };
}

type HeaderForm = {
  // order header
  sales_order_id: string | null;
  /** The Unit the SC No is numbered under. Lives on `sales_orders`, not here. */
  location_id: string | null;
  amend_date: string;
  customer_id: string | null;
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
  /** Supplies Approval Qty's Projection buffer (0413). Null = no projection. */
  rejection_rule_id: string | null;
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
  location_id: null,
  amend_date: "",
  customer_id: null,
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
  rejection_rule_id: null,
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

/**
 * The width of the Style picker column, stated ONCE.
 *
 * Three grids on this screen open the same picker over the same style lines —
 * Combos, Prices and Approval Qty — and each had hand-typed its own width, which
 * is how Combos ended up at 16rem beside a 12rem Combo and a 14rem Combo
 * Description (client 2026-08-12, screenshot 2264). Tab from one section to the
 * next then moved the same field sideways. A column width that repeats is a
 * column width that drifts.
 */
const STYLE_COL_W = "14rem";

export function AmendmentScreen({
  rows,
  bomStatus,
  data,
  perms,
  masterPerms,
  defaultLocationId,
  purpose = "entry",
}: Props) {
  /** Read this, never `purpose` directly, so every site asks the same question. */
  const amending = purpose === "amend";

  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, start] = useTransition();

  const [mode, setMode] = useState<"list" | "edit">("list");
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<HeaderForm>(BLANK);
  // Phase 2 data-tab grids
  const [styles, setStyles] = useState<StyleRow[]>([]);
  /** Which style line's Process sheet is open, by row key (0411). */
  const [processFor, setProcessFor] = useState<string | null>(null);
  const [dyeings, setDyeings] = useState<DyeingRow[]>([]);
  const [prints, setPrints] = useState<PrintRow[]>([]);
  const [structures, setStructures] = useState<StructureRow[]>([]);
  const [combos, setCombos] = useState<ComboRow[]>([]);
  /** Which combo's Structure Details overlay is open (0408). */
  const [detailComboKey, setDetailComboKey] = useState<string | null>(null);
  /** Which quantity row's Assortments overlay is open (0414). */
  const [assortQtyKey, setAssortQtyKey] = useState<string | null>(null);
  const [priceDetails, setPriceDetails] = useState<PriceDetailRow[]>([]);
  const [approvalQtys, setApprovalQtys] = useState<ApprovalQtyRow[]>([]);
  const [packTypes, setPackTypes] = useState<PackTypeRow[]>([]);
  const [quantities, setQuantities] = useState<QuantityRow[]>([]);
  const keySeq = useRef(0);
  const newKey = () => `k${keySeq.current++}`;

  /**
   * ONE BLANK ROW PER GRID, shared by the "+ Add" button and by the row every
   * grid OPENS ON (see `openOneRow` below). Two copies of a row's blank shape is
   * how a field added to one and not the other becomes `undefined` in half the
   * rows — so the shape is stated once, here.
   */
  const blankStyle = (): StyleRow => ({
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
    sizes: [],
    processes: [],
  });
  const blankDyeing = (section: "yarn" | "fabric"): DyeingRow => ({
    key: newKey(),
    section,
    dye_type: "",
    color_name: "",
    color_id: null,
  });
  const blankPrint = (): PrintRow => ({ key: newKey(), print_id: null });
  const blankStructure = (): StructureRow => ({
    key: newKey(),
    structure_id: null,
    item_sub_type: "",
  });
  const blankCombo = (): ComboRow => ({
    key: newKey(),
    style_ref_no: "",
    style: "",
    article_no: "",
    combo: "",
    combo_description: "",
    structures: [],
  });
  const blankPriceDetail = (): PriceDetailRow => ({
    key: newKey(),
    style_ref_no: "",
    style: "",
    article_no: "",
    price_type: "",
    combo: "",
    size_id: null,
    unit: "",
    price: "",
  });
  const blankQuantity = (): QuantityRow => ({
    key: newKey(),
    country_id: null,
    style_ref_no: "",
    style_no: "",
    consignee_id: null,
    assortment_type_id: null,
    po_qty: "",
    delivery_date: "",
    earlier_shipment_date: "",
    warehouse_id: null,
    discharge_port_id: null,
    pack: "",
    is_ratio_wise_pack: false,
    ratio_for: "",
    is_single_style_pack: false,
    master_carton_name: "",
    inner_carton_name: "",
    pack_description: "",
    assort_lines: [],
  });
  const blankApprovalQty = (): ApprovalQtyRow => ({
    key: newKey(),
    style_ref_no: "",
    style: "",
    article_no: "",
    combo: "",
    combo_description: "",
    qty: "",
    approval_qty: "",
  });
  const blankPackType = (): PackTypeRow => ({ key: newKey(), pack_type: "" });

  /**
   * EVERY GRID OPENS ON ONE BLANK ROW (client 2026-08-11).
   *
   * A tab whose only affordance is "+ Add" makes the operator click before they
   * can type, on every tab, on every order — and Tab lands on FIELDS, so an
   * empty grid has nothing to tab into and nothing to stand on and press Enter.
   * That is the same trap AGENTS.md records under the keyboard contract:
   * "replacing a grid's permanently-open blank row with a button removes the
   * keyboard's only way in".
   *
   * SAFE BECAUSE THE SERVER ALREADY DROPS EMPTY ROWS. Every `normalize*` in
   * `lib/orders/amendments/actions.ts` filters a row with nothing in it before
   * insert ("A row the grid seeded and nobody answered is not a quantity"), so
   * an untouched opening row is never stored. This adds no rule; it relies on
   * one that is already there.
   *
   * TOPS UP, NEVER RESETS — `xs.length ? xs : [blank]`. Called after loading a
   * saved document and after seeding from an order, where most grids already
   * have rows and must not be disturbed.
   */
  const openOneRow = () => {
    setStyles((xs) => (xs.length ? xs : [blankStyle()]));
    // Two grids over ONE array: Color/Print shows Yarn and Fabric dyeing
    // separately, so each section needs its own opening row.
    setDyeings((xs) => {
      const missing = (["yarn", "fabric"] as const).filter(
        (sec) => !xs.some((d) => d.section === sec),
      );
      return missing.length ? [...xs, ...missing.map(blankDyeing)] : xs;
    });
    setPrints((xs) => (xs.length ? xs : [blankPrint()]));
    setStructures((xs) => (xs.length ? xs : [blankStructure()]));
    setCombos((xs) => (xs.length ? xs : [blankCombo()]));
    setPriceDetails((xs) => (xs.length ? xs : [blankPriceDetail()]));
    setApprovalQtys((xs) => (xs.length ? xs : [blankApprovalQty()]));
    setPackTypes((xs) => (xs.length ? xs : [blankPackType()]));
    setQuantities((xs) => (xs.length ? xs : [blankQuantity()]));
  };

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

  /**
   * What the order's fabrics are made of, for the Color/Print hint. Null on a
   * SAVED amendment (`openEdit` builds its rows from stored children, not from a
   * fresh read of the order) — which is honest: the order has moved on since,
   * and the amendment records what was decided.
   */
  const [fabricTypes, setFabricTypes] = useState<FabricTypeCounts | null>(null);

  /** Push a set of child rows into the eight grids. One call, one mapping. */
  const applyRows = (src: SeededAmendmentChildren) => {
    // Set here rather than at the four call sites, for the same reason the row
    // mapping lives here: one call, one mapping.
    setFabricTypes(src.fabricTypes ?? null);
    const r = toRows(src, newKey);
    setStyles(r.styles);
    setDyeings(r.dyeings);
    setPrints(r.prints);
    setStructures(r.structures);
    setCombos(r.combos);
    setPriceDetails(r.priceDetails);
    setApprovalQtys(r.approvalQtys);
    setPackTypes(r.packTypes);
    setQuantities(r.quantities);
    // Covers BOTH callers — a saved document reopened, and a seed from an
    // order. Tops up only the grids that came back empty.
    openOneRow();
  };

  /**
   * Has the operator put anything in the data tabs worth protecting?
   *
   * COUNTS FILLED ROWS, NOT ROWS. Every grid now OPENS on a blank row
   * (`openOneRow`), so `length > 0` is true the instant the editor opens and
   * would make all three readers of this flag lie at once: the discard prompt
   * would challenge a form nobody has typed in, `dirty` would pin the reload
   * guard on, and the order seed would ask permission to replace rows that hold
   * nothing.
   *
   * `key` and `section` are excluded because neither is data the operator
   * entered — `key` is the React identity and `section` is which of the two
   * dyeing grids a row belongs to, both stamped by the blank factory itself.
   */
  const rowFilled = (r: Record<string, unknown>) =>
    Object.entries(r).some(
      ([k, v]) => k !== "key" && k !== "section" && v !== "" && v != null,
    );
  const tabsHaveRows = [
    styles,
    dyeings,
    prints,
    structures,
    combos,
    priceDetails,
    approvalQtys,
    packTypes,
    quantities,
  ].some((rows) => (rows as Record<string, unknown>[]).some(rowFilled));

  // Inline editor, not a Sheet / MasterFullScreen, so nothing registers it with
  // the reload guard automatically — see mba-master-screen.tsx for the full
  // reasoning. The stakes are highest here: this form carries a header plus
  // eight child grids, so a silent auto-update mid-amendment discards the lot.
  useUnsavedGuard(mode === "edit" || isPending);

  /**
   * THE SC NO BOX. Two sources, never both: a saved order shows its STORED
   * number, a new one shows a prediction.
   *
   * `previewOrderNumber` shares `sales_order_no_format()` and
   * `fiscal_year_segment()` with the trigger that assigns, which is what makes
   * them impossible to drift apart — formatting `<loc>/RE/<fy>/<nnnn>` here
   * would be a second implementation of both, and the box would confidently
   * show a number different from the one saved.
   *
   * BOTH ARGUMENTS MOVE THE ANSWER: the counter is per (location, fiscal year),
   * so a preview pinned to one Unit is wrong for exactly the branch orders that
   * per-location numbering exists for. Hence both in the dependency list.
   *
   * A PREDICTION, NOT A RESERVATION — the peek does not consume the counter, so
   * abandoning the form burns nothing, at the cost that two operators entering
   * at once see the same number and only the first to save gets it. The trigger
   * stays the sole authority, so the STORED value is always right.
   */
  const [savedOrderNo, setSavedOrderNo] = useState<string | null>(null);
  const [previewNo, setPreviewNo] = useState<string | null>(null);
  useEffect(() => {
    if (mode !== "edit" || editId) return;
    let cancelled = false;
    // No `if (!location_id) setPreviewNo(null)` guard: `previewOrderNumber`
    // already answers null for a blank Unit, so clearing the Unit clears the
    // box through the SAME path that fills it. A synchronous setState in an
    // effect body would cascade a render, and react-hooks flags it.
    previewOrderNumber(form.location_id, form.amend_date || null).then((n) => {
      if (!cancelled) setPreviewNo(n);
    });
    return () => {
      cancelled = true;
    };
  }, [mode, editId, form.location_id, form.amend_date]);


  // config_lookups split by kind (one query, filtered per picker)
  const { lookups } = data;
  const shipTypeOpts = useMemo(() => lookups.filter((l) => l.kind === "ship_type"), [lookups]);
  // From the Payment Term MASTER, not `lookups` — `pay_terms_id` is an FK into
  // `public.payment_terms` since 0375, and the lookup rows it used to read are
  // gone. Filtering `lookups` here would silently render an empty list.
  const payTermOpts = data.paymentTerms;
  /*
   * `fabric_structure` HAS NO PICKER ON THIS SCREEN ANY MORE (0415).
   *
   * It fed the Color/Print tab's Structures grid, and 0396 had repointed that
   * grid from the empty `structure` kind to this one — correctly, at the level
   * it then believed the cell meant. 0405, 0409 and now 0415 settled that the
   * cell means a fabric CATEGORY (SINGLE JERSEY), and Circular Knit / Flat Knit
   * / Woven is the FAMILY that category belongs to.
   *
   * The three rows are not orphaned by this: `categories.fabric_structure_id`
   * still points at them, which is how `isCircularKnit` decides whether GSM is
   * compulsory. The family is DERIVED from the picked category now — read
   * through `categoryById`, never asked as its own question, so the two can no
   * longer disagree on one row.
   */

  const printOpts = useMemo(() => lookups.filter((l) => l.kind === "roll_form_print"), [lookups]);
  /**
   * The colour master (0415) — see the Colour cell in `dyeColumns`.
   *
   * Starts EMPTY on a fresh database and that is correct, not a gap: the list is
   * the names this business actually uses, and it fills through the picker's own
   * "+ Add". Seeding it with NAVY / RED would be the defaulted word list the
   * near-miss rule exists to prevent.
   */
  const colorOpts = useMemo(() => lookups.filter((l) => l.kind === "fabric_color"), [lookups]);
  /**
   * The Size list for the sub-grid under a style line (0407).
   *
   * `lookups` already holds every kind (`listConfigLookups` selects them all),
   * so this needs no new query — and it is the SAME list the Style master's
   * size grid picks from, which is what makes a size created here immediately
   * available there and vice versa.
   */
  const sizeOpts = useMemo(() => lookups.filter((l) => l.kind === "size"), [lookups]);

  // ---- Combos ▸ Structure Details option lists (0408 · 0409) ---------------

  /**
   * Structure offers FABRIC CATEGORIES — SINGLE JERSEY, 1X1 LYCRA RIB, COLLAR
   * (0409, and the same list the Style master's component Structure uses).
   *
   * SCOPED TO THE FABRIC ITEM CLASS, here rather than in the service, because
   * this is the layer that knows which class the cell means — the cascading
   * rule's "the narrowing goes where the class is known". Unscoped it would
   * offer all 39 categories including yarn counts and packing items, none of
   * which a garment is knitted from.
   *
   * A HELD VALUE IS NOT FILTERED OUT. Same rule as "Disabled rows": a category
   * a saved row already names must keep resolving, or a filled cell renders
   * empty and blanks itself on the next save.
   */
  const fabricClassId = useMemo(
    () =>
      lookups.find(
        (l) => l.kind === "item_class" && (l.code ?? "").toUpperCase() === "FABRIC",
      )?.id ?? null,
    [lookups],
  );
  const structureItems = useMemo(
    () =>
      data.categories
        .filter((c) => !fabricClassId || c.item_class_id === fabricClassId)
        .map((c) => ({
          id: c.id,
          code: c.short_name,
          name: c.name ?? c.short_name ?? "(unnamed category)",
          inactive: isInactive(c),
        })),
    [data.categories, fabricClassId],
  );
  /** Every fabric category by id — the knit family lives on it (0409). */
  const categoryById = useMemo(
    () => new Map(data.categories.map((c) => [c.id, c])),
    [data.categories],
  );
  /**
   * The picked Structure's knit family CODE — `circular` / `flat_knit` / `woven`.
   *
   * Two hops, both deliberate: the row names a category, the category names its
   * family. That is what makes GSM-compulsory a consequence of one answer
   * rather than a second question the operator could contradict.
   */
  const familyCodeOf = (structureId: string | null): string | null => {
    const cat = structureId ? categoryById.get(structureId) : null;
    const fam = cat?.fabric_structure_id
      ? lookups.find((l) => l.id === cat.fabric_structure_id)
      : null;
    return fam?.code ?? null;
  };
  /** The family's NAME, for the hint beside the Structure cell. */
  const familyNameOf = (structureId: string | null): string => {
    const cat = structureId ? categoryById.get(structureId) : null;
    const fam = cat?.fabric_structure_id
      ? lookups.find((l) => l.id === cat.fabric_structure_id)
      : null;
    return fam?.name ?? "";
  };
  /**
   * The colours THIS amendment declared, offered to a component's Fabric Color.
   *
   * 0397's rule — "a combo's colours come exclusively from the Color/Print
   * tab's Yarn and Fabric Dyeing lists" — kept as a rule the screen OFFERS
   * rather than a constraint that rejects. An order whose dyeing rows are not
   * entered yet would otherwise have an unusable cell, which is the
   * empty-and-explain failure the nominated-vendor rule already names: a guard
   * that cannot be satisfied is not stricter, it is broken.
   */
  /**
   * The STYLE a combo names, resolved through the Style(s) grid.
   *
   * A combo row carries `style_ref_no` (the text key every style-keyed tab
   * resolves on), not a `style_id` — so the style is found the same way Price
   * Details finds it, through the line the operator picked. `styleKey` rather
   * than `===`, because rows saved before the CAPITALS rule are not upper-cased.
   */
  const styleOfCombo = (r: ComboRow): StylePickerRow | null => {
    const line = styles.find((x) => styleKey(x.style_ref_no) === styleKey(r.style_ref_no));
    return line?.style_id ? (styleById.get(line.style_id) ?? null) : null;
  };

  /**
   * COORDINATE AND COMPONENT COME FROM THE STYLE ENTRY (client 2026-08-12:
   * "Component Name: pulled from the Style Entry").
   *
   * A PO cannot specify the colour of a sleeve on a style that has no sleeve,
   * so the two pickers offer what `garment_style_components` declares — and
   * picking the coordinate narrows the components to the ones that belong to
   * it, because the style declares the PAIR (FRONT BODY *of* PIECES), not two
   * independent lists. That is the cascading-picker rule with the narrowing at
   * the layer that knows the parent, exactly as AGENTS.md states it.
   *
   * A HELD VALUE ALWAYS SURVIVES. Same rule as "Disabled rows": a component a
   * saved row already names must keep resolving even if the style has since
   * dropped it, or a filled cell renders empty and blanks itself on next save.
   *
   * A STYLE THAT DECLARES NO PARTS FALLS BACK TO THE FULL MASTER, and says so.
   * This is deliberately NOT the nominated-vendor "empty and explain" — there,
   * offering everything was a data-integrity hole, because the customer's
   * approval is the whole point of the field. Here the style's list is a
   * CONVENIENCE, most styles predate the Components grid entirely, and an
   * unusable cell would block an order over a master nobody has filled in yet.
   */
  const scopedCoordinates = (r: ComboRow, held: string | null) => {
    const st = styleOfCombo(r);
    const ids = new Set(
      (st?.components ?? []).map((c) => c.coordinate_id).filter(Boolean) as string[],
    );
    if (ids.size === 0) return data.coordinates;
    return data.coordinates.filter((o) => ids.has(o.id) || o.id === held);
  };
  const scopedComponents = (r: ComboRow, coordinateId: string | null, held: string | null) => {
    const st = styleOfCombo(r);
    const pairs = st?.components ?? [];
    const ids = new Set(
      pairs
        .filter((c) => !coordinateId || c.coordinate_id === coordinateId)
        .map((c) => c.component_id)
        .filter(Boolean) as string[],
    );
    if (ids.size === 0) return data.componentRows;
    return data.componentRows.filter((o) => ids.has(o.id) || o.id === held);
  };
  /**
   * THE STRUCTURES THIS STYLE IS BUILT FROM ("Fabric Structure: also pulled
   * from the Style Entry", client 2026-08-12).
   *
   * `garment_style_components.fabric_category_id` is the style's own Structure
   * per part (0405), so the distinct set of those is the fabric list the style
   * declares. Same three clauses as the coordinate/component scoping beside it:
   * a held value always survives, an undeclared style falls back to the full
   * fabric-category list, and the screen says when it is falling back.
   */
  const scopedStructures = (r: ComboRow, held: string | null) => {
    const ids = new Set(
      (styleOfCombo(r)?.components ?? [])
        .map((c) => c.fabric_category_id)
        .filter(Boolean) as string[],
    );
    if (ids.size === 0) return structureItems;
    return structureItems.filter((o) => ids.has(o.id) || o.id === held);
  };

  /** Does the style declare its parts at all? Drives the hint, not the list. */
  const styleDeclaresParts = (r: ComboRow) =>
    (styleOfCombo(r)?.components ?? []).some(
      (c) => c.coordinate_id || c.component_id || c.fabric_category_id,
    );

  /**
   * THE PRINTS THIS ORDER DECLARED — not the whole `roll_form_print` master
   * (client 2026-08-12: "Fab Print is mapped to the Color/Print Details defined
   * specifically for that unique PO").
   *
   * Fabric Print is the ALL-OVER / rotary print — the fabric arrives patterned —
   * as opposed to a placement print on a cut panel. The Color/Print Details tab
   * is where an order says which of those it uses, and this cell picks one of
   * them. Offering the full master instead would make that tab advisory: the
   * operator would name a print here that the order never declared, and nobody
   * would learn the tab needed filling in. Same argument, same shape, as the
   * nominated-vendor rule.
   *
   * SO THERE IS NO INLINE CREATE HERE, deliberately. Creating a `roll_form_print`
   * lookup row from this cell would add a row to the master and still not
   * declare it on the Color/Print tab — a button that looks like it fixes the
   * empty list and does not.
   */
  const declaredPrintOptions = (st: ComboStructRow, held: string | null) => {
    // GATED ON "PRINTED" (client 2026-08-12: Fab Print "is used when a
    // component's fabric type is identified as Printed"), by the same function
    // that decides the colour list — so the two cells can never both claim the
    // row, and a blank Fabric Type claims neither.
    if (!takesAllOverPrint(st.item_sub_type)) {
      return held ? printOpts.filter((o) => o.id === held) : [];
    }
    const ids = new Set(prints.map((p) => p.print_id).filter(Boolean) as string[]);
    return printOpts.filter((o) => ids.has(o.id) || o.id === held);
  };

  const declaredColourOptions = useMemo(
    () =>
      Array.from(
        new Set(dyeings.map((d) => d.color_name.trim().toUpperCase()).filter(Boolean)),
      ).map((c) => ({ value: c, label: c })),
    [dyeings],
  );

  /**
   * The Fabric Color list FOR A GIVEN STRUCTURE.
   *
   * Solid → the order's declared dyeing colours. Melange / yarn-dyed → none,
   * because the colour did not come from a dyeing row. Fabric Type not answered
   * yet → none either, and that is the important branch: a guard phrased as
   * "restrict only in case X" leaks through every state that is not X, which is
   * exactly how the nominated-vendor rule was reported broken twice. Free text
   * still works in every branch, so nothing is blocked.
   */
  const colourOptionsFor = (st: ComboStructRow) =>
    takesDyedColour(st.item_sub_type) ? declaredColourOptions : [];


  /**
   * Style picker rows, carrying the column the filter narrows on.
   * The full master rows stay in `styleById` for auto-fill lookup.
   */
  const styleFilterRows: StyleFilterRow[] = useMemo(
    () =>
      data.styles.map((s) => ({
        id: s.id,
        code: s.code,
        name: s.name,
        blocked: s.blocked,
        season: s.season,
      })),
    [data.styles],
  );

  /**
   * The Style options for ONE row (client: "Once a customer and season are
   * selected, the Style field should only list relevant styles").
   *
   * SEASON ONLY, BUT NO LONGER BLOCKED. Until 0404 the customer half was
   * unbuildable: styles key on `customers` and this order keyed on `buyers`,
   * with an empty bridge between them, so a customer filter would either empty
   * the picker on every order or narrow nothing while looking like it works.
   * 0404 repointed this order's party at `customers`, so both sides now key on
   * one table and `data.styles` already carries `customer_id`.
   *
   * TURNING IT ON IS A SEPARATE, DELIBERATE CHANGE — it is a visible change to
   * what the picker offers, and with one style in the master it can legitimately
   * empty the list for a customer. `style-options.ts` holds the rule and takes
   * the argument; adding `customer: form.customer_id` below is the whole edit.
   *
   * Per ROW, not per grid, for one reason only: `currentValue`. The style a line
   * already holds must survive a filter that would now exclude it — the header's
   * Season edited after the line was saved — or the field renders empty and the
   * next save blanks the FK. The narrowing itself is identical on every row.
   */
  const styleOptionsFor = (currentValue: string | null) =>
    styleOptions({ styles: styleFilterRows, season: form.season, currentValue });

  const styleById = useMemo(() => {
    const m = new Map<string, StylePickerRow>();
    for (const s of data.styles) m.set(s.id, s);
    return m;
  }, [data.styles]);

  /**
   * The Style(s) TAB'S ROWS as picker items — not the style master.
   *
   * Prices are per style LINE of this PO: with Mult. Ord on, the operator adds
   * "a pricing row for every individual style included in the PO" (client
   * 2026-08-10), and those are the lines above, not every style in the business.
   */
  const styleLineItems: PickerRow[] = useMemo(
    () =>
      styles.map((r) => ({
        id: r.key,
        code: r.style_ref_no || null,
        name:
          (r.style_id ? styleById.get(r.style_id)?.name : null) ??
          (r.style_ref_no || "(unnamed line)"),
      })),
    [styles, styleById],
  );

  /**
   * Which style line a price row names, resolved from the TEXT it stores.
   *
   * `price_details` keeps `style_ref_no` / `style` / `article_no` as text (0128),
   * so a reopened amendment has the words but not the line's key. Matching on the
   * ref no is what makes the picker show a selection after a round trip instead
   * of looking empty over filled fields. A blank ref matches nothing on purpose —
   * otherwise every unfilled row would claim the first line.
   */
  const styleLineKeyOf = (refNo: string) =>
    refNo.trim() ? (styles.find((x) => x.style_ref_no.trim() === refNo.trim())?.key ?? null) : null;

  /**
   * The style line's Order Unit — PCS or SET, off the picked style's own
   * `unit_kind` (client 2026-08-11).
   *
   * Read through `style_id`, not off a column of this row: the unit is a fact
   * the STYLE owns (it is the same value that caps its Coordinates grid), so
   * there is nothing here to store and nothing to keep in step. `orderUnitLabel`
   * carries the full reasoning and the reason `uoms` cannot answer this.
   *
   * The text half is unchanged: Price Details still stores this word in its own
   * `unit` column, which is what "pulled from the Order Unit established in the
   * initial Style Entry" means — it just no longer comes from a UoM master.
   */
  const unitTextOf = (r: StyleRow) =>
    orderUnitLabel(r.style_id ? styleById.get(r.style_id)?.unit_kind : null);

  /*
   * COLOUR IS TYPED, SO THERE IS NO COLOUR OPTION LIST (2026-08-11).
   *
   * `dyeColorItems` scoped `color_card_colors` to the amendment's buyer and fed
   * both dyeing grids. Colour Cards is withdrawn as a screen and it was the
   * app's only colour data — `public.colors` was dropped by 0382 as "not
   * applicable to the business process" — so the picker had no source left and
   * no route to gain one. A dropdown that can only ever be empty is worse than
   * a text box: it reads as a master the operator failed to fill.
   */

  /**
   * UNREACHABLE SINCE 2026-08-11, AND KEPT ON PURPOSE.
   *
   * `orderItems` and `onSelectOrder` below fed the SCNo dropdown, and through it
   * the whole order-seeding flow — `loadOrderSeed`, `pendingSeed`, the amber
   * "replace the tabs" bar, `seeded`, `fabricTypes`. That dropdown is gone: the
   * SC No is now MINTED on this screen (see the SCNo field in Order Info),
   * because this is where a garment order is entered, and an order's number is
   * its own identity rather than a pick from orders that already exist.
   *
   * What that removes is the AMENDMENT path: there is currently no way to point
   * this screen at an existing order and amend it. Deleting the machinery would
   * take `seedAmendmentFromOrder`, its eight-tab mapping and
   * `scripts/check-amendment-diff.mts`'s only consumer with it, so it stays
   * until the shape of amendments is decided — as a second mode here, or as its
   * own screen. The two unused-variable warnings are the honest signal that a
   * decision is outstanding; do not silence them with a `_` prefix.
   */
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

  /**
   * THE UNIT A NEW ORDER STARTS ON — so the SCNo box shows a real number the
   * moment the form opens instead of "(auto)".
   *
   * The operator's own `profiles.default_location_id` first; failing that, the
   * first ACTIVE unit. That fallback is a guess, and it is a safe one here for a
   * reason specific to this field: the SC No's FIRST SEGMENT IS THE UNIT CODE,
   * so a prefilled unit announces itself in the very box the operator is reading
   * — `HO/RE/2627/0008` says "HO" more loudly than an empty Unit picker does.
   * Changing the Unit re-previews, so a wrong guess is visible and one click to
   * correct, before anything is saved.
   *
   * `isInactive` rather than reading `is_active` by hand: the flag is spelled
   * three ways across the schema and only that helper knows all three.
   */
  const startingLocationId = useMemo(() => {
    if (defaultLocationId) return defaultLocationId;
    return data.locations.find((l) => !isInactive(l))?.id ?? null;
  }, [defaultLocationId, data.locations]);

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
    // THE CUSTOMER IS NO LONGER AUTO-FILLED FROM THE ORDER (0404). It used to
    // be `buyer_id: o?.buyer_id ?? form.buyer_id` — but the order's party is a
    // `buyers` row and this field now holds a `customers` one, so copying it
    // across would write a uuid the FK rejects. Leaving the customer as typed is
    // the honest behaviour; this path is in any case unreachable since the SC No
    // became minted rather than picked (see the note on the SCNo field).
    set({
      sales_order_id: orderId,
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
    // THE AMEND DOOR CANNOT CREATE, and the refusal lives HERE rather than on
    // the button, because the button is not the only caller: `?new=1` reaches
    // this through `useCreateIntent` below, which is how the ＋ quick action and
    // the command palette both open a form. Guarding only the button would
    // leave two routes into a create that mints a brand-new `sales_orders` row
    // from a screen headed "Order Amendment".
    if (amending) return;
    setEditId(null);
    setSavedOrderNo(null);
    setPreviewNo(null);
    // Yr PREFILLED WITH THE CURRENT YEAR, and still editable (client
    // 2026-08-11). In `openAdd` and NOT in `BLANK`: this is the only path that
    // starts a new order, so a default stated here can never reach a loaded
    // one. `openEdit` builds its own literal off the record and sets
    // `amend_year` from `r.amend_year`, which is what must keep winning.
    setForm({
      ...BLANK,
      amend_date: today(),
      amend_year: String(new Date().getFullYear()),
      location_id: startingLocationId,
    });
    setStyles([]);
    setDyeings([]);
    setPrints([]);
    setStructures([]);
    setCombos([]);
    setPriceDetails([]);
    setApprovalQtys([]);
    // Every grid the editor holds is cleared here, and the list has to stay
    // complete: `setQuantities` was missing, so opening a saved amendment and
    // then clicking + Add carried the previous document's quantity rows into a
    // blank form — where they read as data the operator entered.
    setPackTypes([]);
    setQuantities([]);
    setPendingSeed(null);
    setSeeded(false);
    openOneRow();
    setMode("edit");
  }

  /**
   * The ＋ quick action and the command palette both navigate to `?new=1`, and
   * this hook is what turns that into an open form. Without it the action was
   * DEAD — it landed on the list and did nothing, which reads as the app being
   * broken rather than as a missing feature.
   *
   * DECLARED AFTER `openAdd` ON PURPOSE. It used to sit up with the other hooks
   * and the React Compiler lint rejected it: `openAdd` now closes over
   * `openOneRow` and `startingLocationId`, both `const`, so reading it earlier
   * would capture a binding that has not been initialised yet. A hook still runs
   * on every render from here, which is the only rule that matters.
   */
  useCreateIntent(() => {
    if (perms.canCreate) openAdd();
  });

  function openEdit(r: GarmentOrderAmendment) {
    setSavedOrderNo(r.sales_order?.order_number ?? null);
    setPreviewNo(null);
    setPendingSeed(null);
    setSeeded(false);
    setEditId(r.id);
    setForm({
      sales_order_id: r.sales_order_id,
      location_id: r.sales_order?.location_id ?? null,  // Unit is read-only from here on
      amend_date: r.amend_date ?? today(),
      customer_id: r.customer_id,
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
      rejection_rule_id: r.rejection_rule_id,
      ex_rate: r.ex_rate ? String(r.ex_rate) : "",
      avg_rate: r.avg_rate ? String(r.avg_rate) : "",
      gross_value: r.gross_value ? String(r.gross_value) : "",
      amend_in_material_bom: r.amend_in_material_bom,
      amend_in_fabric_bom: r.amend_in_fabric_bom,
      amend_in_garment_process_bom: r.amend_in_garment_process_bom,
      reason_text: r.reason_text ?? "",
    });
    // The saved rows, through the same mapping the order seed uses. A saved
    // amendment always wins over the order: it records what was decided, and
    // the order has moved on since.
    applyRows({
      styles: r.styles,
      styleSizes: r.style_sizes,
      styleProcesses: r.style_processes,
      dyeings: r.dyeings,
      prints: r.prints,
      structures: r.structures,
      combos: r.combos,
      priceDetails: r.price_details,
      approvalQtys: r.approval_qtys,
      packTypes: r.pack_types,
      quantities: r.quantities,
    });
    setMode("edit");
  }

  function submit(asDraft: boolean) {
    /**
     * The narrowing guard for the two mandatory FKs.
     *
     * Not belt-and-braces for its own sake: `amendmentInput` now types them as
     * `string`, and the compiler refused the payload until this existed — which
     * is the type system pointing out that `canSave` is a BUTTON state, and a
     * button state is not a proof. Ctrl+S, a stale click and a future caller all
     * reach `submit` without passing through it.
     *
     * A toast rather than a silent return, because a save that does nothing and
     * says nothing reads as the app being broken.
     */
    if (!form.location_id || !form.customer_id) {
      toastError(
        !form.location_id
          ? "Pick the Unit — the SC No is numbered under it."
          : "Customer is required.",
      );
      return;
    }
    const payload = {
      is_draft: asDraft,
      sales_order_id: form.sales_order_id,
      location_id: form.location_id,
      amend_date: form.amend_date,
      customer_id: form.customer_id,
      po_no: form.po_no || null,
      po_date: form.po_date || null,
      merchandiser_id: form.merchandiser_id,
      season: form.season || null,
      amend_year: form.amend_year ? Number(form.amend_year) : null,
      delivery_date: form.delivery_date || null,
      excess_pct: numOrNull(form.excess_pct) ?? 0,
      rejection_rule_id: form.rejection_rule_id,
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
      /**
       * FLATTENED OUT OF THE STYLE ROWS (0407). They are nested on screen so a
       * size cannot outlive its line, and flat in the payload because that is
       * how the table stores them — `style_ref_no` carries the binding across.
       *
       * `sno: 0` like every other grid here: `normalizeStyleSizes` renumbers,
       * and it numbers PER STYLE, so each line's sizes read 1..n on their own.
       *
       * A SIZE ON A LINE WITH NO REF IS STILL SENT, and the normalizer drops
       * it. Filtering here as well would be a second copy of that rule, and the
       * one that matters is the one `lib/data-io` also passes through.
       */
      style_sizes: styles.flatMap((r) =>
        r.sizes.map((z) => ({
          sno: 0,
          style_ref_no: r.style_ref_no || null,
          size_id: z.size_id,
        })),
      ),
      /* Flattened like `style_sizes` above, and just as deliberately unfiltered:
         `normalizeStyleProcesses` drops the blank, the orphaned and the
         duplicated, and it is the copy `lib/data-io` also passes through. A
         second filter here would be a second answer. */
      style_processes: styles.flatMap((r) =>
        r.processes.map((z) => ({
          sno: 0,
          style_ref_no: r.style_ref_no || null,
          kind: z.kind,
          process_id: z.process_id,
          component_id: z.component_id,
          details: z.details || null,
        })),
      ),
      dyeings: dyeings.map((r) => ({
        sno: 0,
        section: r.section,
        dye_type: r.dye_type || null,
        color_name: r.color_name || null,
        color_id: r.color_id,
      })),
      prints: prints.map((r) => ({ sno: 0, print_id: r.print_id })),
      structures: structures.map((r) => ({
        sno: 0,
        structure_id: r.structure_id,
        // Narrowed, not cast — see `asItemSubType`. The column carries a CHECK
        // since 0415, and an `as` here would trade a field-level message for a
        // raw Postgres error.
        item_sub_type: asItemSubType(r.item_sub_type),
      })),
      combos: combos.map((r) => ({
        sno: 0,
        style_ref_no: r.style_ref_no || null,
        style: r.style || null,
        article_no: r.article_no || null,
        combo: r.combo || null,
        combo_description: r.combo_description || null,
        // The tree travels NESTED (0408). A component's parent is a uuid the
        // database assigns during this save, so a flat list would have nothing
        // to point at — `writeComboTree` inserts the levels in order and
        // resolves each from the one above.
        structures: r.structures.map((st) => ({
          sno: 0,
          structure_id: st.structure_id,
          fabric_type: st.fabric_type || null,
          composition_id: st.composition_id,
          gsm: numOrNull(st.gsm),
          gsm_tolerance: numOrNull(st.gsm_tolerance),
          item_sub_type: st.item_sub_type || null,
          components: st.components.map((c) => ({
            sno: 0,
            coordinate_id: c.coordinate_id,
            component_id: c.component_id,
            color_name: c.color_name || null,
            print_id: c.print_id,
            processed_as_trim: c.processed_as_trim,
          })),
        })),
      })),
      price_details: priceDetails.map((r) => ({
        sno: 0,
        style_ref_no: r.style_ref_no || null,
        style: r.style || null,
        article_no: r.article_no || null,
        price_type: r.price_type || null,
        // Sent whatever the current mode is, never blanked to match it: a stale
        // Color-wise row is what the operator is meant to SEE and clear, and a
        // save that quietly stripped its colour would hide the mismatch the
        // grid is flagging (and make `styleRate`'s refusal unexplainable).
        combo: r.combo || null,
        size_id: r.size_id,
        unit: r.unit || null,
        price: numOrNull(r.price) ?? 0,
      })),
      // Sent whatever the Pack toggle says. The tab HIDES when Pack is off, and
      // hiding a grid is not the same as emptying it — a document packed, then
      // un-ticked by accident, then saved would lose its methods with nothing on
      // screen to show what went. The operator removes a row by removing it.
      pack_types: packTypes.map((r) => ({ sno: 0, pack_type: r.pack_type || null })),
      quantities: quantities.map((r) => ({
        sno: 0,
        country_id: r.country_id,
        style_ref_no: r.style_ref_no || null,
        style_no: r.style_no || null,
        consignee_id: r.consignee_id,
        assortment_type_id: r.assortment_type_id,
        po_qty: Number(r.po_qty) || 0,
        delivery_date: r.delivery_date || null,
        earlier_shipment_date: r.earlier_shipment_date || null,
        warehouse_id: r.warehouse_id,
        discharge_port_id: r.discharge_port_id,
        // ---- the Assort tree (0414) ----
        // Travels NESTED: a line's `quantity_id` and a cell's `line_id` are
        // uuids the database assigns during this save, so a flat list would
        // have nothing to point at. `writeAssortTree` resolves each level.
        pack: r.pack || null,
        is_ratio_wise_pack: r.is_ratio_wise_pack,
        ratio_for: r.ratio_for || null,
        is_single_style_pack: r.is_single_style_pack,
        master_carton_name: r.master_carton_name || null,
        inner_carton_name: r.inner_carton_name || null,
        pack_description: r.pack_description || null,
        assort_lines: r.assort_lines.map((l) => ({
          sno: 0,
          combo: l.combo || null,
          no_of_cartons: numOrNull(l.no_of_cartons) ?? 0,
          sizes: l.sizes.map((z) => ({
            size_id: z.size_id,
            // `?? 0` and NOT `|| 0`: an explicit 0 is a real ratio entry
            // ("this carton has no XL") and must survive the round trip.
            qty: numOrNull(z.qty) ?? 0,
          })),
        })),
      })),
      approval_qtys: approvalQtys.map((r) => ({
        sno: 0,
        style_ref_no: r.style_ref_no || null,
        style: r.style || null,
        article_no: r.article_no || null,
        combo: r.combo || null,
        combo_description: r.combo_description || null,
        qty: numOrNull(r.qty) ?? 0,
        approval_qty: numOrNull(r.approval_qty) ?? 0,
      })),
    };
    start(async () => {
      const res = editId
        ? await updateAmendment(editId, payload)
        : await createAmendment(payload);
      if (res.ok) {
        success(
          amending
            ? "Amendment updated"
            : editId
              ? "Garment order updated"
              : "Garment order created",
        );
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
        success(amending ? "Amendment deleted" : "Garment order deleted");
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
        // "SC No", the same name the editor's field carries (see the SCNo Field
        // in Order Info). It read "Order #" here — one value under two names,
        // and this is the number the whole business tracks an order by, so the
        // list and the record have to call it the same thing.
        header: "SC No",
        cell: (r) => (
          <span className="font-mono text-xs">{r.sales_order?.order_number ?? "—"}</span>
        ),
      },
      { header: "Customer", cell: (r) => <span className="text-sm">{r.customer?.name ?? "—"}</span> },
      /* "Type" WITHDRAWN 2026-08-11 (client): "the company exclusively produces
         garments", so a Garment / Fabric / Made-ups toggle answers a question
         that has one answer. The column went with the field — a list column the
         operator can no longer fill reads as data they forgot to enter, and it
         would show a value on legacy rows only. `amend_type` and its stored rows
         are untouched; see the note where the field was. */
      {
        header: "Date",
        cell: (r) => <span className="tabular-nums text-sm">{fmtDate(r.amend_date)}</span>,
      },
      /* MATERIAL BOM — the same pill the BOM dashboard shows, from the same
         module (`lib/orders/material-bom-amendment/status.ts`).

         It is here because the question "has this order's material been
         planned?" is asked from BOTH sides: the merchandiser works down the BOM
         queue, and whoever is looking at the order wants to know without
         opening another screen. Two screens declaring their own tone map is what
         the ~8 copy-pasted `bomStatusTone` functions across `planning/**` are.

         BEFORE Status, so `withCreatedColumns` still finds the trailing run it
         splices the Created pair ahead of. */
      {
        header: "Material BOM",
        cell: (r) => {
          const b = bomStatus[r.id];
          const st: BomStatus = b?.status ?? "pending";
          return (
            <span title={bomStatusHint(st, b?.qty ?? null)}>
              <StatusPill tone={bomStatusTone(st)}>{bomStatusText(st)}</StatusPill>
            </span>
          );
        },
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
        {/* NAMED FOR WHAT THIS SCREEN IS (client 2026-08-11), and since
            2026-08-13 for which DOOR it was opened by. It is the garment order
            screen — the legacy header and the ten-section rail — reached from
            Order Entry ▸ Garment Order to raise one, and from Amendments ▸
            Order Amendment to change one.

            THE AMEND DOOR OFFERS NO CREATE, and that is a data rule rather than
            a wording one: `createAmendment` mints a fresh `sales_orders` row, so
            a "New" button under a heading that says amendment would raise a
            second order every time an operator meant to correct the first. */}
        <PageHeader
          title={amending ? "Order Amendments" : "Garment Orders"}
          description={
            amending
              ? "Amend a saved garment order — styles, colours, prices, packing, quantities & logistics."
              : "Garment orders — styles, colours, prices, packing, quantities & logistics."
          }
          actions={
            perms.canCreate && !amending ? (
              <Button onClick={openAdd}>New Garment Order</Button>
            ) : undefined
          }
        />
        <DataTable
          columns={withCreatedColumns(columns, rows)}
          rows={rows}
          getKey={(r) => r.id}
          empty={
            amending
              ? "No garment orders to amend yet. Raise one under Order Entry ▸ Garment Order."
              : "No garment orders yet. Use 'New Garment Order' to create the first."
          }
        />
      </div>
    );
  }

  // ---------------- EDIT MODE ----------------
  /**
   * Every mandatory field gates Save too — SCNo and Customer (client
   * 2026-08-10) and the five Logistics fields.
   *
   * `required` on the field holds the CURSOR, which stops an operator tabbing
   * past a blank one — but it cannot stop someone who never focused it at all.
   * Requiredness that does not reach the Save button is half a rule; AGENTS.md
   * calls the two "enforcers" of one declaration.
   */
  const canSave =
    !!form.location_id &&
    !!form.customer_id &&
    !!form.amend_date &&
    !!form.ship_type_id &&
    !!form.ship_mode &&
    !!form.pay_mode &&
    !!form.pay_terms_id &&
    !!form.currency_code;

  // ---- Phase 2 grid row updaters / adders / removers ----
  const updateStyle = (key: string, patch: Partial<StyleRow>) =>
    setStyles((xs) => xs.map((x) => (x.key === key ? { ...x, ...patch } : x)));
  const addStyle = () => setStyles((xs) => [...xs, blankStyle()]);
  /**
   * Picking a Style fills everything the Style Entry already knows, so the
   * operator types only what the buyer's order sheet adds (client 2026-08-10).
   *
   * IT NO LONGER SEEDS A UNIT ANYONE SEES. Order Unit and Plan Unit were both
   * `uoms` pickers prefilled from the style's one `unit_id`; the client withdrew
   * Plan Unit and reduced Order Unit to PCS/SET on 2026-08-11, and the cell now
   * DERIVES that from `unit_kind` on every read rather than being handed a value
   * once. So there is no unit prefill left to get right — which also retires the
   * "prefill, not a lock" argument Fabric's Base UoM had to relearn three times:
   * it applies to a value the operator may overrule, and this one has no operator
   * input to overrule it with.
   *
   * THE TWO FK COLUMNS ARE STILL SEEDED, AND THAT IS DELIBERATE. `order_unit_id`
   * and `plan_unit_id` are frozen, not deleted: `writeChildren` deletes and
   * reinserts a grid wholesale, so a column that stops being written is NULLED on
   * the next save rather than left alone. Seeding them from `unit_id` keeps a
   * resaved line holding exactly what it would have held. `unit_id` is null on
   * every style entered from 2026-08-11 (the Style screen withdrew the field that
   * fills it), so in practice this now seeds null — which is the honest value for
   * a column nothing asks about.
   *
   * PO Qty is deliberately NOT seeded: it is the one number that comes off the
   * buyer's order sheet and nowhere else.
   *
   * STYLE REF NO IS THE STYLE'S CODE, not a typed value (client 2026-08-11 —
   * the column left the grid because it is system-generated). It is the key
   * Price Details, Quantities and Approval Qty all resolve on, so it has to be
   * filled by whatever the operator DOES answer, and the style code
   * (`STL/2627/0001`) is the one stable identifier the line has. Two lines
   * naming the same style would share a ref, and the first would win the
   * lookup — but a PO carrying one style twice is a duplicate line, not a case
   * to encode.
   *
   * THE REF STAYS AN OPAQUE STRING AND IS STILL TEXT, NOT AN FK. Keying styles
   * by text is deliberate here (a `style_id` FK is the known-wrong fix and has
   * been rejected before), so this fills the existing text column and adds
   * nothing. Nothing anywhere parses it: `styleKey` (order-seed.ts) and `norm`
   * (diff.ts) trim and upper-case and stop there, and every other reader
   * compares whole strings. That matters as of 0402, which puts SLASHES in the
   * code — `STL/2627/0001` — so any split-on-a-delimiter added later would
   * shred the key rather than read it.
   *
   * ONLY A NEWLY PICKED STYLE GETS A GENERATED REF. Rows loaded from a saved
   * amendment keep whatever text they already hold — `toRows` copies it through
   * untouched and this runs on the pick, so an older order's hand-typed ref is
   * never rewritten into the new format.
   *
   * IT ALSO FILLS THE SIZE LIST (0407) — the second half of the legacy
   * behaviour, and the half that was missing. Screenshot 2255 shows the
   * sub-grid empty with the picker open; 2256, four seconds later, shows it
   * holding the style's nine sizes. So the sizes are not typed here either:
   * they are what the picked style IS, exactly like Article No above.
   *
   * A RE-PICK REPLACES THEM, and that is the same rule as every other line
   * below, not a separate decision. A line now naming a different style but
   * still listing the previous one's sizes is the "reads as data" failure the
   * paragraph below describes, and it is worse in a list than in a cell —
   * nine wrong rows look far more deliberate than one wrong word.
   *
   * AN EMPTY SIZE SET IS COPIED THROUGH AS EMPTY. Filling a style's sizes is
   * optional on the Style master, so `[]` means "this style has not said" —
   * the grid then renders a line saying exactly that, rather than a blank box
   * the operator has to interpret. Never fall back to some other style's set,
   * and never to the style's Size GROUP: the group's sizes are text names
   * bridged to `config_lookups` by name, unmatched names drop silently, and
   * the Style screen already exposes that bridge as an explicit "Fill sizes"
   * button precisely because it is a shortcut and not the source of truth.
   *
   * Clearing the Style clears what it filled. Leaving a previous style's article
   * number and units behind on a line that now names a different style is worse
   * than a blank row, because it reads as data.
   */
  const pickStyle = (key: string, id: string | null) => {
    const s = id ? styleById.get(id) : null;
    updateStyle(key, {
      style_id: id,
      style_ref_no: s?.code ?? "",
      article_no: s?.article_no ?? "",
      style_category: s?.style_category ?? "",
      style_description: s?.style_description ?? "",
      // Frozen columns, neither on screen — see the note above. `?? null` rather
      // than `?? ""`: these are FK columns to `uoms`, and "" is not a uuid.
      order_unit_id: s?.unit_id ?? null,
      plan_unit_id: s?.unit_id ?? null,
      // The line's Description is the style's remarks, falling back to its
      // description — the two fields legacy shows as "Style Description".
      description: s ? (s.description ?? s.style_description ?? "") : "",
      // `newKey()` per size, never the size's own id: two rows could otherwise
      // share a React key the moment a style lists a size twice, and a
      // duplicated key is a swapped-row bug that only shows once the operator
      // starts editing (the same reason `toRows` takes `newKey` as an argument).
      sizes: (s?.sizes ?? []).map((z) => ({ key: newKey(), size_id: z.size_id })),
    });

    /*
     * THE FABRICS FLOW IN WITH THE STYLE (0415, client 2026-08-12: "if the
     * fabric structures are already defined in the Style Entry, they should
     * flow into this tab automatically to avoid duplicate data entry").
     *
     * ON THE PICK, NOT IN AN EFFECT. An effect watching the declared set would
     * re-add a structure the operator deliberately removed the moment anything
     * else re-rendered it — the grid would argue back. Seeding from the one
     * action that introduces a new fabric is both the smallest rule and the
     * predictable one: pick a style, its fabrics appear; remove one, it stays
     * removed until a style that declares it is picked again.
     *
     * ADDITIVE, AND IT NEVER REMOVES. A structure already on the tab may have a
     * Type answered against it, and a style swapped on one line says nothing
     * about the fabrics another line still needs. It also fills the blank
     * opening row rather than leaving it above the seeded ones (`openOneRow`
     * gives every grid one), so picking the first style does not leave a stray
     * empty structure at the top of the list.
     */
    const declared = (s?.components ?? [])
      .map((c) => c.fabric_category_id)
      .filter(Boolean) as string[];
    if (declared.length) {
      setStructures((xs) => {
        const have = new Set(xs.map((x) => x.structure_id).filter(Boolean));
        const missing = declared.filter((id) => !have.has(id));
        if (!missing.length) return xs;
        const seeded = missing.map((id) => ({ ...blankStructure(), structure_id: id }));
        const blankAt = xs.findIndex((x) => !x.structure_id && !x.item_sub_type);
        if (blankAt === -1) return [...xs, ...seeded];
        return [...xs.slice(0, blankAt), ...seeded, ...xs.slice(blankAt + 1)];
      });
    }
  };

  // ---- the Size sub-grid under a style line (0407) --------------------------

  const mutSizes = (styleKeyId: string, fn: (xs: SizeRow[]) => SizeRow[]) =>
    setStyles((xs) => xs.map((x) => (x.key === styleKeyId ? { ...x, sizes: fn(x.sizes) } : x)));

  const setSize = (styleKeyId: string, sizeKey: string, id: string | null) =>
    mutSizes(styleKeyId, (zs) => zs.map((z) => (z.key === sizeKey ? { ...z, size_id: id } : z)));

  /**
   * Add a blank size row — and DECLINE while the last one is still blank.
   *
   * `return false` is `ChildGrid`'s decline protocol (`gridKeyNav`'s `addRow`),
   * and returning it here does two things at once: it stops Enter stacking
   * blank size rows, and it lets that Enter ESCALATE to the outer Styles grid,
   * which is what makes "Enter, Enter" walk out of a finished size list and on
   * to the next style. The Material Attributes values grid (`addOption`) is
   * where this shape is established.
   */
  const addSize = (styleKeyId: string) => {
    const row = styles.find((x) => x.key === styleKeyId);
    if (row && row.sizes.length && !row.sizes[row.sizes.length - 1].size_id) return false;
    mutSizes(styleKeyId, (zs) => [...zs, { key: newKey(), size_id: null }]);
  };

  const addDyeing = (section: "yarn" | "fabric") =>
    setDyeings((xs) => [...xs, blankDyeing(section)]);
  const addPrint = () => setPrints((xs) => [...xs, blankPrint()]);
  const addStructure = () => setStructures((xs) => [...xs, blankStructure()]);
  const addCombo = () => setCombos((xs) => [...xs, blankCombo()]);

  // ---- Combos ▸ Structure Details, the tree mutators (0408) ----------------
  //
  // Three levels, one setter. Every edit rebuilds the path from the combo down,
  // which is what makes removing a structure take its components with it
  // without a second list to keep in step — the same reason a style's sizes are
  // nested inside `StyleRow` rather than held beside it.
  const mutStructs = (comboKey: string, fn: (xs: ComboStructRow[]) => ComboStructRow[]) =>
    setCombos((xs) =>
      xs.map((x) => (x.key === comboKey ? { ...x, structures: fn(x.structures) } : x)),
    );
  const patchStruct = (comboKey: string, structKey: string, patch: Partial<ComboStructRow>) =>
    mutStructs(comboKey, (sts) =>
      sts.map((st) => (st.key === structKey ? { ...st, ...patch } : st)),
    );

  /**
   * Pick a fabric here and its Fabric Type arrives with it (0415).
   *
   * The Color/Print tab declares Solid / Melange / Yarn Dyed / Printed once per
   * structure; this is where that answer is spent, since it decides whether the
   * row's components ask for a dyed colour or an all-over print. Both grids now
   * store the same category id, which is the whole reason the lookup is possible
   * — before 0415 this tab held a fabric category and that one held a knit
   * family, so there was nothing to match on.
   *
   * SEEDS, NEVER OVERWRITES. The combo cell stays editable, so a structure that
   * is Solid on the order can still be Printed in one colourway; and a Type the
   * operator already set here is not undone by re-picking the same fabric. That
   * is the same contract `pickStyle` has with Article No — one place answers,
   * the other inherits, and a deliberate difference survives.
   */
  const pickComboStructure = (comboKey: string, structKey: string, id: string | null) => {
    const declared = id ? structures.find((s) => s.structure_id === id)?.item_sub_type : null;
    mutStructs(comboKey, (sts) =>
      sts.map((st) =>
        st.key === structKey
          ? {
              ...st,
              structure_id: id,
              item_sub_type: st.item_sub_type || declared || "",
            }
          : st,
      ),
    );
  };
  const blankStruct = (): ComboStructRow => ({
    key: newKey(),
    structure_id: null,
    fabric_type: "",
    composition_id: null,
    gsm: "",
    gsm_tolerance: "",
    item_sub_type: "",
    components: [],
  });
  const addStruct = (comboKey: string) =>
    mutStructs(comboKey, (sts) => [...sts, blankStruct()]);

  const mutComps = (
    comboKey: string,
    structKey: string,
    fn: (xs: ComboCompRow[]) => ComboCompRow[],
  ) =>
    mutStructs(comboKey, (sts) =>
      sts.map((st) => (st.key === structKey ? { ...st, components: fn(st.components) } : st)),
    );
  const patchComp = (
    comboKey: string,
    structKey: string,
    compKey: string,
    patch: Partial<ComboCompRow>,
  ) =>
    mutComps(comboKey, structKey, (cs) =>
      cs.map((c) => (c.key === compKey ? { ...c, ...patch } : c)),
    );
  /**
   * Add a part — and DECLINE while the last one names nothing.
   *
   * `return false` is `ChildGrid`'s decline protocol, and it does two jobs:
   * it stops Enter stacking blanks, and it lets that Enter escalate to the
   * structure grid above so "Enter, Enter" walks out of a finished parts list
   * on to the next structure. Same shape as the size grid and as Material
   * Attributes' `addOption`, which is where it was first worked out.
   */
  const addComp = (comboKey: string, structKey: string) => {
    const st = combos
      .find((c) => c.key === comboKey)
      ?.structures.find((x) => x.key === structKey);
    const last = st?.components[st.components.length - 1];
    if (last && !last.coordinate_id && !last.component_id && !last.color_name.trim()) {
      return false;
    }
    mutComps(comboKey, structKey, (cs) => [
      ...cs,
      {
        key: newKey(),
        coordinate_id: null,
        component_id: null,
        color_name: "",
        print_id: null,
        processed_as_trim: false,
      },
    ]);
  };
  const addPriceDetail = () => setPriceDetails((xs) => [...xs, blankPriceDetail()]);
  const addApprovalQty = () => setApprovalQtys((xs) => [...xs, blankApprovalQty()]);

  /**
   * THE ONE GRID WITH A CEILING. There are four packing methods and a method
   * named twice says nothing the first row did not, so a fifth row could only
   * ever hold a duplicate or a blank.
   *
   * `return false` is `ChildGrid`'s own decline protocol (`gridKeyNav`'s
   * `addRow`), which is why the cap lives here rather than in a disabled
   * button: Enter off the last cell adds a row too, and a guard on the button
   * alone would leave the keyboard path uncapped.
   */
  const addPackType = () => {
    if (packTypes.length >= PACK_TYPE_OPTIONS.length) return false;
    setPackTypes((xs) => [...xs, blankPackType()]);
  };

  /**
   * The methods this row may choose: the four, minus what OTHER rows took.
   *
   * Filtering at the source is what makes the duplicate impossible rather than
   * merely rejected — the operator never picks a method twice, so the unique
   * index (0399) and `normalizePackTypes` are backstops for the import path,
   * not error messages anyone reads.
   *
   * A HELD VALUE ALWAYS SURVIVES THE FILTER, including one this build no longer
   * names. A `<Select>` matches on value, so an unlisted value renders as blank
   * — a filled cell showing empty, blanked on the next save. Same rule as
   * "Disabled rows": the row that survives is the one the record already holds.
   */
  const packTypeOptions = (row: PackTypeRow): string[] => {
    const taken = new Set(
      packTypes.filter((x) => x.key !== row.key).map((x) => x.pack_type).filter(Boolean),
    );
    const free: string[] = PACK_TYPE_OPTIONS.filter((o) => !taken.has(o));
    if (row.pack_type && !free.includes(row.pack_type)) free.push(row.pack_type);
    return free;
  };


  /**
   * Rail completion dots — "this section has data".
   *
   * Free here, and worth having: the reason ten items became a rail is that a
   * strip could not tell the operator where anything was. It reads the SAME
   * state `tabsHaveRows` above reads, so the two cannot drift.
   *
   * Every section is keyed now — `packtypes` (0399) was the last placeholder,
   * and while a tab was unwired it was deliberately ABSENT from this map rather
   * than given a `false`: a dot claiming a not-yet-built tab holds data lies
   * about the one thing the operator most needs to know is missing.
   */
  const has = (rows: unknown[]) =>
    (rows as Record<string, unknown>[]).some(rowFilled);
  const sectionDone: Record<string, boolean> = {
    // `has(...)`, not `.length > 0` — a grid's opening blank row is not data,
    // and a dot over an untouched tab is exactly the confident lie the rail was
    // built to remove.
    //
    // `styles` is NOT keyed here any more — the Style(s) grid merged into Order
    // Info, and that section carries its own `done` (which reads `has(styles)`,
    // the same expression this entry held). A key left here would be read by
    // nothing and would drift.
    colors: has(dyeings) || has(prints) || has(structures),
    combos: has(combos),
    prices: has(priceDetails),
    approvalqty: has(approvalQtys),
    packtypes: has(packTypes),
    quantities: has(quantities),
    // Was `charges.length > 0`, and the charges are gone. The five fields
    // the client made mandatory are the honest signal now.
    logistic:
      !!form.ship_type_id && !!form.ship_mode && !!form.pay_mode &&
      !!form.pay_terms_id && !!form.currency_code,
  };

  /**
   * Styles Details, as COLUMNS rather than as a table.
   *
   * The grid below renders these through `FieldGrid`/`Field` in a card per row
   * (LAYOUT.md §6: past ~5 real inputs a row runs out of width, and this one has
   * six). Keeping them as a `columns` array rather than inlining the fields is
   * what lets the card and the table fallback describe the same row — the shape
   * `style-master-screen.tsx` uses for the same reason.
   */
  const styleColumns: ChildGridColumn<StyleRow>[] = [
    /* STYLE REF NO IS NO LONGER TYPED — IT IS THE PICKED STYLE'S CODE.
       Withdrawn as a column 2026-08-11 (client): it is system-generated, so
       asking for it was asking the operator to invent a key. The FIELD stays
       and `pickStyle` fills it, which is not tidiness — `(sales_order_id,
       style_ref_no)` is the Orders module key and THREE other tabs resolve on
       this text: Price Details (`styleLineKeyOf`), Quantities (`refNoOptions`)
       and Approval Qty (`poQtyOf`). Delete the value along with the column and
       the Price Details picker blanks itself the moment a style is chosen. */
    {
      header: "Style",
      // A line with no style is not a line. Red ⓘ on the legacy grid.
      required: true,
      cell: (r) => {
        /* NARROWED BY THE HEADER'S CUSTOMER AND SEASON (client). `styleOptions`
           holds the rule and the reasoning; `shortHint` is set only when the
           narrowing left nothing, and then it replaces the "— Select Style —"
           placeholder so the empty box explains itself in the one line a grid
           cell has. The wider `hint` is rendered ONCE above the grid instead of
           per row — see the note there. */
        const opts = styleOptionsFor(r.style_id);
        return (
        <div className="space-y-1">
          <RecordPicker
            label="Style"
            compact
            items={opts.items}
            value={r.style_id}
            onChange={(id) => pickStyle(r.key, id)}
            placeholder={opts.shortHint ?? undefined}
          />
          {/* Article No and Category are DERIVED by `pickStyle`, never typed, so
              they are not columns — they are what the picked style IS. Legacy
              agrees: its header is two rows deep, pairing "Style / Article No"
              and "Style Category / Style Description" in single columns. The app
              had flattened those pairs into four columns, which is most of why
              the table needed `min-w-[1000px]` and scrolled sideways. */}
          {(r.article_no || r.style_category) && (
            <p className="text-xs text-muted-foreground">
              {[r.article_no, r.style_category].filter(Boolean).join(" · ")}
            </p>
          )}
        </div>
        );
      },
    },
    {
      header: "Order Unit",
      /*
       * PCS OR SET, AND NO LONGER ASKED (client 2026-08-11: "Order Unit
       * (PCS/SET) is sufficient").
       *
       * This was a `uoms` picker offering nos / mtr / kg / gross / yard / set.
       * It is now the picked style's `unit_kind` — the SAME value that caps that
       * style's Coordinates grid — so a Set style can no longer be ordered in
       * kilograms, and the question is not put to the operator at all: a style
       * either IS one garment or IS a set of coordinates.
       *
       * `readOnly`, never `disabled` — `Input` sets `tabIndex={-1}` on a
       * readOnly field itself, so it leaves the Tab path with no per-screen
       * opt-out, and the value stays selectable. And NOT `required`, which it
       * used to be: a readOnly field has no exit, so a hold on a blank one would
       * cage the operator. The requiredness moved to its SOURCE, the Style
       * picker above, which is already `required` — the same shape the composed
       * SC No and Material's composed name use (AGENTS.md, "Mandatory fields").
       *
       * BLANK MEANS THE STYLE HAS NOT ANSWERED, and is left blank on purpose:
       * `unit_kind` is null on every style predating 0392, and stamping PCS on
       * those would put an invented unit beside a real PO Qty. The Style screen
       * makes the field `required`, so a legacy style answers the next time
       * anyone edits it.
       */
      cell: (r) => <Input readOnly className="h-8" value={unitTextOf(r)} placeholder="—" />,
    },
    /* PLAN UNIT WITHDRAWN 2026-08-11 (client): Order Unit (PCS/SET) suffices.
       The COLUMN and its stored rows are untouched, and `plan_unit_id` stays in
       the row shape, in `toRows` and in the save payload — `writeChildren`
       deletes and reinserts a grid wholesale, so a field dropped from the
       payload is nulled on the next save rather than frozen. `pickStyle` keeps
       seeding it from the style's one `unit_id`, which is where it came from
       when it was on screen.

       ORDER UNIT'S OWN `order_unit_id` IS FROZEN THE SAME WAY, and for the same
       reason — the column, its rows, the row shape, `toRows`, the save payload
       and `pickStyle`'s seeding all stay exactly as they were. What changed is
       only what the CELL above reads. It could not have been repurposed even if
       we wanted to: it is a uuid FK to `uoms`, and `uoms` has no piece row to
       point at. */
    {
      header: "PO Qty",
      align: "right",
      // The one number that comes off the buyer’s order sheet and nowhere else,
      // which is exactly why nothing can seed it and why it must be asked for.
      required: true,
      cell: (r) => (
        <Input
          type="number"
          className="text-right"
          value={r.po_qty}
          onChange={(e) => updateStyle(r.key, { po_qty: e.target.value })}
        />
      ),
    },
    {
      header: "Description",
      cell: (r) => (
        <Input
          value={r.description}
          onChange={(e) => updateStyle(r.key, { description: e.target.value })}
        />
      ),
    },
    {
      /**
       * LAST (client 2026-08-12). It was briefly moved BEFORE Description on
       * 2026-08-12 (screenshot 2265) and this is not a flip-flop — the reason
       * for that move expired.
       *
       * At the time the row broke over three lines, and a trailing Process
       * started a line of its own with its label and button alone against three
       * empty columns. Moving it up filled that line. The row is now SIX
       * fields on ONE line (`xs`, six spans of 2 summing to 12), so there is no
       * second line for a trailing column to strand itself on, and the ordering
       * is free to say what the operator does: pick a style, see its sizes,
       * answer the line, then open the nested Process screen last.
       *
       * The lesson worth keeping is that the earlier position was a workaround
       * for a wrapping bug, not a statement about Process — so when the wrap
       * was fixed properly, the workaround had to come out with it.
       */
      header: "Process",
      cell: (r) => (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setProcessFor(r.key)}
          /* The count is on the button because the list lives behind it: with
             the sheet closed there is otherwise nothing on the line to say a
             style HAS processes, and an operator would have to open each one to
             find out. Same reason `ChildGrid` puts a badge on a collapsed
             section. */
        >
          {r.processes.length ? `Process (${r.processes.length})` : "Process"}
        </Button>
      ),
    },
  ];

  /**
   * Yarn / Fabric dyeing, prints and structures — one or two inputs a row, which
   * LAYOUT.md §6 puts in the "<=3 -> inlineCards" band: a flex row per record
   * under one shared header, never a stacked card. Carding a two-input row would
   * be worse than the table it replaces.
   *
   * EVERY COLUMN DECLARES A `width`, and that is not per-column taste — it is
   * the condition for the whole grid to hug its content. `hugsContent` is
   * `columns.every((c) => c.width)` (child-grid.tsx), all-or-nothing on purpose,
   * and in the `inlineCards` branch an unsized column is `flex-1` while a sized
   * one is `shrink-0`. So ONE column left unsized does not merely go unstyled:
   * it absorbs every spare pixel of the row and drops the grid back to full
   * width. That was the state here -- Type carried `10rem`, Colour carried
   * nothing, and a single Colour dropdown rendered ~1080px wide while Print and
   * Structure each took the entire section (client 2026-08-11, screenshots
   * 2246/2247). Add a column to any of these three and it needs a width, or all
   * four grids stretch again.
   */
  const dyeColumns: ChildGridColumn<DyeingRow>[] = [
    {
      header: "Type",
      width: "10rem",
      cell: (r) => (
        <Input
          value={r.dye_type}
          onChange={(e) =>
            setDyeings((xs) => xs.map((x) => (x.key === r.key ? { ...x, dye_type: e.target.value } : x)))
          }
        />
      ),
    },
    {
      header: "Colour",
      /**
       * A MASTER ROW AGAIN (0415) — `config_lookups` kind 'fabric_color', with
       * the inline create and edit the ⓘ/⊕ convention asks for (client
       * 2026-08-12: "all colours and print designs must be wired to their
       * respective Master Data ... so that naming conventions ('Navy Blue' vs
       * 'Dark Blue') remain consistent across the company").
       *
       * THIS REVERSES 0403, AND ONLY BECAUSE ITS PREMISE EXPIRED. That change
       * made the cell free text with sound reasoning — Colour Cards had just been
       * withdrawn and `public.colors` was dropped by 0382, so "a dropdown that
       * can only ever be empty is worse than a text box: it reads as a master the
       * operator failed to fill." What is different is not the argument but the
       * source: a lookup kind carries inline create, so the list fills itself
       * from the first order that needs a colour instead of waiting on a master
       * screen. It is deliberately UNSEEDED for the reason the near-miss rule
       * records — inventing NAVY and RED here is the 2026-07-28 mistake.
       *
       * `color_name` IS STILL THE VALUE, written from the picked row's name.
       * `declaredColourOptions` (which feeds the Combos tab's colour list) and
       * `garment_order_amendment_combo_components.color_name` both read text, so
       * routing them through the id would be a second migration for no gain —
       * and a colour typed before 0415 still resolves. Same id + text pairing
       * `style_id` / `style` already uses two grids up.
       *
       * THE WIDTH IS NOT OPTIONAL: `hugsContent` is `columns.every((c) => c.width)`,
       * so dropping it here would stretch all four grids on this tab.
       */
      width: "16rem",
      cell: (r) => (
        <LookupDialogPicker
          kind="fabric_color"
          label="Colour"
          compact
          options={colorOpts}
          value={r.color_id}
          onChange={(id) =>
            setDyeings((xs) =>
              xs.map((x) =>
                x.key === r.key
                  ? {
                      ...x,
                      color_id: id,
                      // Cleared means cleared. Keeping the old text beside a
                      // blank id would leave the Combos tab offering a colour
                      // this order no longer declares.
                      color_name: id ? (colorOpts.find((o) => o.id === id)?.name ?? "") : "",
                    }
                  : x,
              ),
            )
          }
          canCreate={masterPerms.canCreate}
          canEdit={masterPerms.canEdit}
        />
      ),
    },
  ];

  const printColumns: ChildGridColumn<PrintRow>[] = [
    {
      header: "Print",
      width: "16rem",
      cell: (r) => (
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
      ),
    },
  ];

  /**
   * THE FABRIC CATEGORIES THIS ORDER'S STYLES DECLARE (0415).
   *
   * "If the fabric structures are already defined in the Style Entry, they
   * should flow into this tab automatically to avoid duplicate data entry"
   * (client 2026-08-12). The style's parts each name a
   * `garment_style_components.fabric_category_id` (0405), so the distinct set of
   * those across the order's style lines IS the fabric list — there is nothing
   * for the operator to retype.
   *
   * The same three clauses `scopedStructures` uses one grid down, because a
   * narrowing with any of them missing is a narrowing that empties a real field:
   * a held value always survives, and a style declaring no parts falls back to
   * the full fabric-category list. The fallback is not a nicety here — 0 style
   * components carry a category today, so without it this grid would offer
   * nothing at all on every order until the Style master catches up.
   *
   * THE FALLBACK IS NOW SILENT (client 2026-08-12). A line under the grid used
   * to announce it ("Showing every fabric category …"); the client had it
   * removed. `styleStructuresDeclared` still drives the narrowing itself — only
   * the sentence went — so a full list and a scoped one now look alike on
   * screen. That is the accepted trade, not an oversight: if it ever needs
   * saying again, say it here rather than re-deriving the condition.
   */
  // A PLAIN DERIVED VALUE, NOT A `useMemo`. This point in the component is past
  // whatever makes `react-hooks/rules-of-hooks` treat a hook here as
  // conditional, and adding a second offender to a file that already has one is
  // not the way to earn a memo. There is nothing to memoise anyway: it is a walk
  // over the order's style lines, a handful of rows, and the Set is consumed in
  // the same render — `scopedStructures` beside it derives per row and per call.
  const orderStructureIds = (() => {
    const ids = new Set<string>();
    for (const s of styles) {
      for (const c of styleById.get(s.style_id ?? "")?.components ?? []) {
        if (c.fabric_category_id) ids.add(c.fabric_category_id);
      }
    }
    return ids;
  })();

  /** Do the order's styles declare their fabrics at all? Drives the hint. */
  const styleStructuresDeclared = orderStructureIds.size > 0;

  const scopedOrderStructures = (held: string | null) =>
    styleStructuresDeclared
      ? structureItems.filter((o) => orderStructureIds.has(o.id) || o.id === held)
      : structureItems;

  const structureColumns: ChildGridColumn<StructureRow>[] = [
    {
      header: "Structure",
      width: "16rem",
      /**
       * A FABRIC CATEGORY — SINGLE JERSEY, 1X1 LYCRA RIB (0415), not the knit
       * family this cell used to offer.
       *
       * It was a `LookupDialogPicker` over `config_lookups` kind
       * 'fabric_structure', whose three rows are Circular Knit / Flat Knit /
       * Woven. 0409's header settles which level is meant: the legacy screen's
       * Structure column reads SINGLE JERSEY, and Circular Knit is the FAMILY
       * that category belongs to — `categories.fabric_structure_id` already
       * holds the link, so the family stays derived rather than asked twice.
       *
       * NO INLINE CREATE, and that is a change from the old cell. A fabric
       * category is a Master Data row with an item class, a commodity and a
       * knit family behind it; conjuring one from an order line would create a
       * half-filled master. The picker offers what the styles declared, which is
       * where a new fabric properly enters.
       */
      cell: (r) => (
        <RecordPicker
          label="Structure"
          compact
          items={scopedOrderStructures(r.structure_id)}
          value={r.structure_id}
          onChange={(id) =>
            setStructures((xs) => xs.map((x) => (x.key === r.key ? { ...x, structure_id: id } : x)))
          }
        />
      ),
    },
    {
      header: "Type",
      width: "10rem",
      /**
       * Solid / Melange / Yarn Dyed / Printed (0415) — "users should be able to
       * see the Type for each fabric structure immediately to understand which
       * processing deadlines (T&A) will apply" (client 2026-08-12).
       *
       * ONE VOCABULARY, `ITEM_SUB_TYPE_OPTIONS`, shared with the combo structure
       * row it seeds. Not `required`: a blank is a real state that offers
       * NEITHER a colour nor a print list, and a hold here would cage the
       * operator on a row they are still reading off the buyer's sheet.
       */
      cell: (r) => (
        <Select
          value={r.item_sub_type}
          onChange={(e) =>
            setStructures((xs) =>
              xs.map((x) => (x.key === r.key ? { ...x, item_sub_type: e.target.value } : x)),
            )
          }
        >
          <option value="">—</option>
          {ITEM_SUB_TYPE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      ),
    },
  ];

  /**
   * Combos — two text inputs, LAYOUT.md §6's "<=3 -> inlineCards" band.
   *
   * Style Ref No withdrawn 2026-08-11 with the Styles tab's own column: it is
   * system-generated there, so a hand-typed copy of it here could only ever
   * disagree. `ComboRow` keeps the field and the save keeps writing it, so the
   * stored column is frozen rather than nulled.
   */
  /**
   * Combos Details.
   *
   * WAS two free-text boxes restating the Style(s) tab — the same defect the
   * Prices tab had before 2026-08-11, and fixed the same way: one picker over
   * the PO's own style lines fills Style Ref No, Style and Article No, none of
   * which the operator should be retyping.
   *
   * FLAT, ONE ROW PER COMBO, where legacy nests combos under a style row
   * (screenshot 2261). Same data either way — `garment_order_amendment_combos`
   * has always carried `style_ref_no` — and this is the shape the sibling
   * Prices tab already uses, so the two read alike. The nesting legacy spends
   * on the spine is spent here on the Detail tree instead, which is where it
   * carries information the flat form cannot.
   */
  /*
   * ONE WIDTH FOR THE THREE VALUE COLUMNS. Style / Combo / Combo Description
   * were 16 / 12 / 14rem — three boxes of three sizes holding three ordinary
   * text values, which is what "imbalanced" named (client 2026-08-12,
   * screenshot 2264). The widths were never carrying meaning here: none of the
   * three is a number, a code of fixed length, or a field the operator reads at
   * a glance across rows, so a ragged row was cost with nothing bought. Detail
   * stays narrower because it is a button, not a value.
   */
  const comboColumns: ChildGridColumn<ComboRow>[] = [
    {
      header: "Style",
      required: true,
      width: STYLE_COL_W,
      cell: (r) => (
        <div className="space-y-1">
          <RecordPicker
            label="Style"
            compact
            items={styleLineItems}
            identity="code"
            value={styleLineKeyOf(r.style_ref_no)}
            onChange={(key) => {
              const line = key ? styles.find((x) => x.key === key) : null;
              setCombos((xs) =>
                xs.map((x) =>
                  x.key === r.key
                    ? {
                        ...x,
                        style_ref_no: line?.style_ref_no ?? "",
                        style: (line?.style_id ? styleById.get(line.style_id)?.name : null) ?? "",
                        article_no: line?.article_no ?? "",
                      }
                    : x,
                ),
              );
            }}
          />
          {r.article_no && <p className="text-xs text-muted-foreground">{r.article_no}</p>}
        </div>
      ),
    },
    {
      header: "Combo",
      // A combo with no name is not a colourway — it is what the Prices and
      // Quantities tabs count against, and "" counts against nothing.
      required: true,
      width: "14rem",
      cell: (r) => (
        <Input
          uppercase
          value={r.combo}
          onChange={(e) =>
            setCombos((xs) =>
              xs.map((x) => (x.key === r.key ? { ...x, combo: e.target.value } : x)),
            )
          }
        />
      ),
    },
    {
      header: "Combo Description",
      width: "14rem",
      cell: (r) => (
        <Input
          uppercase
          value={r.combo_description}
          onChange={(e) =>
            setCombos((xs) =>
              xs.map((x) => (x.key === r.key ? { ...x, combo_description: e.target.value } : x)),
            )
          }
        />
      ),
    },
    {
      header: "Detail",
      width: "8rem",
      /**
       * The legacy [Detail] button (screenshot 2261) — it opens the Structure
       * Details screen for THIS combo.
       *
       * GATED ON THE COMBO HAVING A NAME. The overlay's header is the combo's
       * identity and its whole subject is "the fabrics of this colourway", so
       * opening it on an unnamed row would ask the operator to describe
       * something that does not exist yet. The count on the button is what
       * makes the tree visible from the outside — otherwise a combo carrying
       * three structures looks exactly like one carrying none.
       */
      cell: (r) => (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!r.combo.trim()}
          title={r.combo.trim() ? undefined : "Name the combo first"}
          onClick={() => setDetailComboKey(r.key)}
        >
          Detail
          {r.structures.length > 0 && (
            <span className="ml-1 text-xs text-muted-foreground">
              ({r.structures.length})
            </span>
          )}
        </Button>
      ),
    },
  ];

  /**
   * Price Details.
   *
   * WAS six free-text boxes, including three that restated the Style(s) tab and
   * a Price Type the operator had to remember the wording of. The client's spec
   * is explicit that the first three are "read-only and automatically wired from
   * the Style(s) tab" (2026-08-10), so they stop being inputs: one picker over
   * the PO's own style lines fills all three, and Unit comes with them.
   *
   * That leaves THREE real inputs — style, price type, price — which moves this
   * grid out of LAYOUT.md §6's "6-8 -> stacked card" band into "<=3 ->
   * inlineCards": one row per price, which is also what bulk entry wants.
   */
  /**
   * Which axes a price mode prices along — the SAME question `order-value.ts`
   * asks, phrased for the screen.
   *
   * Two readers, one rule: the cells grey themselves out by it and `styleRate`
   * weights by it. They are separate implementations only because the module is
   * shared with the server-rendered Order Sheet and must not import a screen;
   * if a fifth mode ever appears, both switch on the same tuple in types.ts and
   * a mode missing from either shows up as a cell that will not enable.
   */
  const priceAxes = (mode: string) => {
    const m = (mode ?? "").trim().toLowerCase();
    return {
      colour: m === "color-wise" || m === "color-wise size-wise",
      size: m === "size-wise" || m === "color-wise size-wise",
    };
  };

  /** The colourways declared for ONE style on the Combos tab. */
  const comboOptionsForStyle = (refNo: string) => {
    const key = styleKey(refNo);
    return Array.from(
      new Set(
        combos
          .filter((c) => !key || styleKey(c.style_ref_no) === key)
          .map((c) => c.combo.trim().toUpperCase())
          .filter(Boolean),
      ),
    );
  };

  /** The sizes THIS style line carries (0407), resolved to names for the list. */
  const sizeOptionsForStyle = (refNo: string) => {
    const key = styleKey(refNo);
    const line = styles.find((s) => styleKey(s.style_ref_no) === key);
    const seen = new Set<string>();
    return (line?.sizes ?? [])
      .map((z) => z.size_id)
      .filter((id): id is string => {
        if (!id || seen.has(id)) return false;
        seen.add(id);
        return true;
      })
      .map((id) => ({ id, name: sizeOpts.find((o) => o.id === id)?.name ?? "(size)" }));
  };

  /**
   * Choosing a mode OPENS THE GRID FOR IT — one row per colourway, per size, or
   * per combination (client 2026-08-12).
   *
   * NOTHING IS EVER DELETED (operator decision 2026-08-12). Switching a style
   * from Color-wise to Style-wise leaves the colour rows exactly where they are,
   * marked as stale by `priceRowStale` below, for the operator to clear
   * deliberately. The alternative — replacing that style's rows — makes the
   * average resolvable a moment sooner and loses typed money to a mis-click on a
   * dropdown, with no undo. Money is the one thing on this screen worth being
   * slow about.
   *
   * The consequence is deliberate and visible: while both sets exist the style's
   * rows disagree about the mode, so `styleRate` refuses and names it. That
   * refusal IS the prompt to tidy up.
   *
   * SEEDS ONLY WHAT IS MISSING, so re-picking the same mode never stacks
   * duplicates, and a combination already priced keeps its rate. The row the
   * operator changed becomes the first of the set rather than being left over
   * beside it — otherwise every mode change would cost them a delete.
   */
  const applyPriceMode = (row: PriceDetailRow, mode: string) => {
    const axes = priceAxes(mode);
    const combosFor = comboOptionsForStyle(row.style_ref_no);
    const sizesFor = sizeOptionsForStyle(row.style_ref_no).map((z) => z.id);

    // Every (colour, size) pair the new mode wants a rate for. Style-wise wants
    // exactly one nameless row, which is the row already being edited.
    const wanted: { combo: string; size_id: string | null }[] = !axes.colour && !axes.size
      ? [{ combo: "", size_id: null }]
      : axes.colour && axes.size
        ? combosFor.flatMap((c) => sizesFor.map((z) => ({ combo: c, size_id: z })))
        : axes.colour
          ? combosFor.map((c) => ({ combo: c, size_id: null }))
          : sizesFor.map((z) => ({ combo: "", size_id: z }));

    setPriceDetails((xs) => {
      const key = styleKey(row.style_ref_no);
      const first = wanted[0] ?? { combo: "", size_id: null };
      const next = xs.map((x) =>
        x.key === row.key
          ? { ...x, price_type: mode, combo: first.combo, size_id: first.size_id }
          : x,
      );
      // What this style already prices under the NEW mode — the edited row
      // included, so the first wanted pair is never seeded twice.
      const have = new Set(
        next
          .filter((x) => styleKey(x.style_ref_no) === key && x.price_type === mode)
          .map((x) => `${x.combo.trim().toUpperCase()}|${x.size_id ?? ""}`),
      );
      const missing = wanted.filter(
        (w) => !have.has(`${w.combo.trim().toUpperCase()}|${w.size_id ?? ""}`),
      );
      if (!missing.length) return next;
      const at = next.findIndex((x) => x.key === row.key);
      const seeded = missing.map((w) => ({
        ...blankPriceDetail(),
        style_ref_no: row.style_ref_no,
        style: row.style,
        article_no: row.article_no,
        unit: row.unit,
        price_type: mode,
        combo: w.combo,
        size_id: w.size_id,
      }));
      return [...next.slice(0, at + 1), ...seeded, ...next.slice(at + 1)];
    });
  };

  /**
   * Is this row left over from a mode its style no longer uses?
   *
   * The flag half of "keep rows, never delete them". A style's CURRENT mode is
   * the one on its most recently touched row, which is not knowable — so this
   * asks the honest question instead: does this style hold rows of more than one
   * mode, and is this row not on the majority one? Any row of a minority mode is
   * shown as stale, which is exactly the set the operator has to resolve before
   * `styleRate` will answer.
   */
  const priceRowStale = (r: PriceDetailRow) => {
    const key = styleKey(r.style_ref_no);
    if (!key || !r.price_type) return false;
    const modes = new Map<string, number>();
    for (const x of priceDetails) {
      if (styleKey(x.style_ref_no) !== key || !x.price_type) continue;
      modes.set(x.price_type, (modes.get(x.price_type) ?? 0) + 1);
    }
    if (modes.size < 2) return false;
    const top = [...modes.entries()].sort((a, b) => b[1] - a[1])[0][0];
    return r.price_type !== top;
  };

  const priceDetailColumns: ChildGridColumn<PriceDetailRow>[] = [
    {
      header: "Style",
      required: true,
      width: STYLE_COL_W,
      cell: (r) => (
        <div className="space-y-1">
          <RecordPicker
            label="Style"
            compact
            items={styleLineItems}
            identity="code"
            value={styleLineKeyOf(r.style_ref_no)}
            onChange={(key) => {
              const line = key ? styles.find((x) => x.key === key) : null;
              setPriceDetails((xs) =>
                xs.map((x) =>
                  x.key === r.key
                    ? {
                        ...x,
                        style_ref_no: line?.style_ref_no ?? "",
                        style: (line?.style_id ? styleById.get(line.style_id)?.name : null) ?? "",
                        article_no: line?.article_no ?? "",
                        // "Unit ... is pulled from the Order Unit established in
                        // the initial Style Entry" — so it arrives with the line
                        // rather than being asked for again.
                        unit: line ? unitTextOf(line) : "",
                      }
                    : x,
                ),
              );
            }}
          />
          {(r.article_no || r.unit) && (
            <p className="text-xs text-muted-foreground">
              {[r.article_no, r.unit && `per ${r.unit}`].filter(Boolean).join(" · ")}
            </p>
          )}
        </div>
      ),
    },
    {
      header: "Price Type",
      required: true,
      width: "11rem",
      /**
       * THE MODE, and it drives the two cells after it (client 2026-08-12:
       * "when a user selects a mode like Color wise or Size wise, the system
       * automatically opens a grid listing the relevant colors or sizes").
       *
       * Choosing it SEEDS the rows — one per colourway, per size, or per
       * combination — through `applyPriceMode`. The dropdown stays per ROW
       * rather than moving to the style, because that is where the column has
       * always been and a saved row must keep answering for itself.
       */
      cell: (r) => (
        <div className="space-y-1">
          <Select
            value={r.price_type}
            onChange={(e) => applyPriceMode(r, e.target.value)}
          >
            <option value="">—</option>
            {PRICE_TYPE_OPTIONS.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </Select>
          {/* THE FLAG HALF of "keep rows, never delete them". Without it a
              left-over row from a previous mode is indistinguishable from a
              current one, and the only symptom is that the Logistic tab's Avg
              Rate quietly refuses to answer. Amber and advisory — it never
              holds the cursor (AGENTS.md: a hold is only for an error that
              genuinely blocks Save, and this row is valid, just superseded). */}
          {priceRowStale(r) && (
            <p className="text-xs text-warning">Stale — this style now prices {""}
              {priceDetails.find(
                (x) => styleKey(x.style_ref_no) === styleKey(r.style_ref_no) && !priceRowStale(x),
              )?.price_type ?? "differently"}
              . Remove it or the order&rsquo;s value cannot be calculated.
            </p>
          )}
        </div>
      ),
    },
    {
      header: "Colour",
      width: "10rem",
      /**
       * WHICH colourway this rate is for — the combos the Combos tab declared,
       * which is why Prices sits after it in the rail.
       *
       * DISABLED, NOT HIDDEN, when the mode does not price by colour. A hidden
       * cell would make the row's own columns shift under the shared header
       * band (`inlineCards` draws one header for every row), so a Style-wise row
       * beside a Color-wise one would put its Price under the Colour heading.
       * Greyed-and-empty says the same thing and keeps the grid a grid.
       */
      cell: (r) => {
        const on = priceAxes(r.price_type).colour;
        return (
          <Select
            value={r.combo}
            disabled={!on}
            onChange={(e) =>
              setPriceDetails((xs) =>
                xs.map((x) => (x.key === r.key ? { ...x, combo: e.target.value } : x)),
              )
            }
          >
            <option value="">{on ? "—" : ""}</option>
            {comboOptionsForStyle(r.style_ref_no).map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        );
      },
    },
    {
      header: "Size",
      width: "9rem",
      /** WHICH size — the style line's OWN size set (0407), not every size in
       *  the master: a rate for a size this style is not made in prices nothing,
       *  and could never be matched to a quantity. */
      cell: (r) => {
        const on = priceAxes(r.price_type).size;
        return (
          <Select
            value={r.size_id ?? ""}
            disabled={!on}
            onChange={(e) =>
              setPriceDetails((xs) =>
                xs.map((x) => (x.key === r.key ? { ...x, size_id: e.target.value || null } : x)),
              )
            }
          >
            <option value="">{on ? "—" : ""}</option>
            {sizeOptionsForStyle(r.style_ref_no).map((z) => (
              <option key={z.id} value={z.id}>
                {z.name}
              </option>
            ))}
          </Select>
        );
      },
    },
    {
      header: "Price",
      align: "right",
      required: true,
      width: "8rem",
      // The rate off the buyer's order sheet. Its CURRENCY is the document's,
      // set on the Logistic tab — there is deliberately no per-row currency.
      cell: (r) => (
        <Input
          type="number"
          className="text-right"
          value={r.price}
          onChange={(e) =>
            setPriceDetails((xs) =>
              xs.map((x) => (x.key === r.key ? { ...x, price: e.target.value } : x)),
            )
          }
        />
      ),
    },
  ];

  /**
   * Approval Quantity — the production TARGET, not just a sample count.
   *
   *     PO Qty + Excess Qty + Approval Qty = Total Production Qty
   *
   * (client 2026-08-10). Only the middle term was ever asked for on screen; the
   * other three are derived, which is why this grid has two real inputs and not
   * five — §6's "<=3 -> inlineCards" band.
   *
   * EXCESS ROUNDS UP, deliberately and for the reason `rejectionFor` already
   * records: "shipping 59 when 60 were needed is precisely the failure this rule
   * exists to prevent. The cost of the other direction is at most one garment."
   * Two allowances on one order must not round opposite ways.
   */
  const excessPct = Number(form.excess_pct) || 0;

  /**
   * The order's value — Logistic's Avg Rate and Gross Value (client 2026-08-12).
   *
   * Style(s) PO Qty x the Prices tab's rate, summed. `styles` and `priceDetails`
   * hold their numbers as STRINGS (every grid cell is an `<Input>`), so they are
   * coerced here rather than in `order-value.ts` — that module is shared with the
   * server-rendered Order Sheet, where the same rows arrive as real numbers, and
   * a module that coerced would be papering over whichever caller was wrong.
   */
  /* A PLAIN DERIVED VALUE, NOT A `useMemo` — the third one on this screen, and
     the same reason as `orderStructureIds` and `declaredComboOptions`: this line
     is BELOW the `if (mode === "list")` early return, so a hook here runs on the
     editor render and is skipped on the list render, and React counts hooks by
     position. `npx eslint` names it exactly ("React Hook \"useMemo\" is called
     conditionally ... after an early return?"); `npm run build` does not fail on
     lint, which is why three of these reached the browser instead of the editor.
     Nothing to memoise: two passes over the order's own style lines. */
  /**
   * The Quantities tab flattened to (style, combo, size, pieces) — the WEIGHTS a
   * Color-wise or Size-wise rate is averaged by (0416).
   *
   * The tree is quantity row ▸ assort line ▸ size, and the pieces of one size in
   * one line are `no_of_cartons x that size's per-carton qty` — the same
   * multiplication `lineQtyOf` already does for the line's total, applied one
   * level down. Flattened HERE rather than in `order-value.ts` because the tree
   * shape is this screen's business; the module only needs three keys and a
   * number, which is what makes it testable without building an assortment.
   */
  const pricingWeights = quantities.flatMap((q) =>
    q.assort_lines.flatMap((l) =>
      l.sizes.map((z) => ({
        style_ref_no: q.style_ref_no,
        combo: l.combo,
        size_id: z.size_id,
        qty: (Number(l.no_of_cartons) || 0) * (Number(z.qty) || 0),
      })),
    ),
  );

  const orderVal = orderValue(
    styles.map((r) => ({ style_ref_no: r.style_ref_no, po_qty: Number(r.po_qty) || 0 })),
    priceDetails.map((r) => ({
      style_ref_no: r.style_ref_no,
      price_type: r.price_type,
      combo: r.combo,
      size_id: r.size_id,
      price: Number(r.price) || 0,
    })),
    pricingWeights,
  );

  /**
   * The tiers of the rule chosen on the header, or null when none is.
   *
   * `tiers` ride along with the option (see `getRejectionRuleRows`) precisely so
   * this needs no round trip — the grid recalculates on every keystroke.
   */
  const rejectionTiers =
    data.rejectionRules.find((x) => x.id === form.rejection_rule_id)?.tiers ?? null;
  /** The PO Qty of the Style(s) line this row names. 0 when it names none. */
  const poQtyOf = (r: ApprovalQtyRow) => {
    const key = r.style_ref_no.trim();
    if (!key) return 0;
    return Number(styles.find((x) => x.style_ref_no.trim() === key)?.po_qty) || 0;
  };
  /**
   * THE ROW'S QUANTITY IS ITS OWN `qty`, NOT THE STYLE'S PO QTY (0413).
   *
   * The tab now breaks a style down by COLOUR, and the buyer's split across
   * colours is not something the schema holds — so it is typed per row. Reading
   * the style's PO Qty here instead would give every colour of a style the same
   * (whole-order) quantity and total them to several times the order.
   *
   * `poQtyOf` survives above as the STYLE's figure, used only to show the
   * operator what the colours should add up to.
   */
  const qtyOf = (r: ApprovalQtyRow) => Number(r.qty) || 0;
  const excessQtyOf = (r: ApprovalQtyRow) => excessQty(qtyOf(r), excessPct);
  const approvalOf = (r: ApprovalQtyRow) => Number(r.approval_qty) || 0;
  /** NULL when unanswerable — no rule chosen, or a gap between tiers. Never 0. */
  const projectionOf = (r: ApprovalQtyRow) => projectionQty(qtyOf(r), rejectionTiers);
  const totalQtyOf = (r: ApprovalQtyRow) =>
    totalProductionQty(
      { qty: qtyOf(r), approvalQty: approvalOf(r) },
      excessPct,
      rejectionTiers,
    );

  /**
   * A derived figure — read-only, so it cannot be edited into disagreeing with
   * the sum it comes from.
   *
   * A BOXED `readOnly` INPUT RATHER THAN BARE TEXT (2026-08-12). It was a
   * `<span>`, which lines up under a right-aligned `<th>` in a TABLE — but this
   * grid is carded, and in a card the label sits left while a right-aligned
   * span floats at the far edge of a ~280px field, reading as detached from the
   * thing it is labelled by (operator screenshot, 12:26).
   *
   * `readOnly`, never `disabled`: `Input` gives a readOnly field `tabIndex={-1}`
   * itself, so it leaves the Tab path exactly as the span did, and the value
   * stays selectable. It is also what every other derived figure on this
   * document already is — Gsm Range on the Combos overlay, Ratio Total and Qty
   * on the Assortments grid — so the same idea stops having two appearances.
   */
  const derivedCell = (n: number) => (
    <Input readOnly className="h-8 text-right" value={fmtNumber(n)} />
  );

  // ---------------- Pack type(s) (0399) ----------------

  /**
   * ONE column, because the legacy grid has one: S No + Pack Type.
   *
   * `required`, so a row that exists names a method — the tab's entire content
   * is this cell, and a blank one is a row that says nothing. The hold is
   * satisfiable with the keyboard alone: `keyFills` lets ↓ open a `<select>`'s
   * list and the arrows pick within it, and Ctrl+Del still removes a row the
   * operator should not have added (AGENTS.md, "Mandatory fields").
   *
   * A `<Select>` and not a picker: four fixed options, no master behind them,
   * nothing to search — the same call the Prices tab's Price Type makes.
   */
  const packTypeColumns: ChildGridColumn<PackTypeRow>[] = [
    {
      header: "Pack Type",
      required: true,
      // Sized for the same reason the dyeing/print/structure columns are: this
      // grid is `inlineCards`, where an unsized column is `flex-1` and a lone
      // one therefore takes the entire section. `hugsContent` is
      // `columns.every((c) => c.width)`, so with one column this single key is
      // the whole condition — drop it and the Select spans the row again.
      width: "16rem",
      cell: (r) => (
        <Select
          value={r.pack_type}
          onChange={(e) =>
            setPackTypes((xs) =>
              xs.map((x) => (x.key === r.key ? { ...x, pack_type: e.target.value } : x)),
            )
          }
        >
          <option value="">—</option>
          {packTypeOptions(r).map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </Select>
      ),
    },
  ];

  // ---------------- Quantities (0398) ----------------

  /**
   * Ref No offers THIS AMENDMENT'S OWN STYLES, not the style master.
   *
   * `(sales_order_id, style_ref_no)` is the Orders module key, so a quantity row
   * must name a style the amendment actually carries — otherwise nothing
   * downstream can resolve it. Same rule as Style ▸ Components ▸ Coordinate, and
   * the client's "green arrow: data from a previous tab".
   *
   * The value a row already holds SURVIVES the list even if that style is later
   * removed from the Styles tab: dropping it would show a filled cell as empty
   * and blank it on the next save.
   */
  const refNoOptions = (held: string) => {
    const rows = styles
      .filter((x) => x.style_ref_no.trim())
      .map((x) => ({ id: x.style_ref_no, code: null, name: x.style_ref_no }));
    if (held && !rows.some((r) => r.id === held)) {
      rows.push({ id: held, code: null, name: `${held} (not on Styles)` });
    }
    return rows;
  };

  /** The style NAME behind a ref no, read off the Styles tab so the two cannot
   *  disagree. Empty when the ref names no style the amendment carries. */
  const styleNoForRef = (ref: string) =>
    data.styles.find(
      (st) => st.id === styles.find((x) => x.style_ref_no === ref)?.style_id,
    )?.name ?? "";

  const setQty = (key: string, patch: Partial<QuantityRow>) =>
    setQuantities((xs) => xs.map((x) => (x.key === key ? { ...x, ...patch } : x)));

  const assortmentTypes = lookups.filter((l) => l.kind === "assortment_type");

  // ---- Quantities ▸ Assort (0414) ------------------------------------------

  /**
   * THE SIZES OF THE STYLE THIS DESTINATION SHIPS — the overlay's columns.
   *
   * `styleKey`, never `===`: rows saved before the CAPITALS rule are not
   * upper-cased, and this is the module's join key (the precedent is
   * `styleOfCombo`). `refNoOptions` can hold a ref no longer on the Styles tab,
   * so an empty list is a real answer and the overlay says so rather than
   * rendering a grid with no columns.
   */
  const sizesOfQuantity = (q: QuantityRow): SizeRow[] =>
    styles.find((x) => styleKey(x.style_ref_no) === styleKey(q.style_ref_no))?.sizes ?? [];

  const mutAssort = (qtyKey: string, fn: (xs: AssortLineRow[]) => AssortLineRow[]) =>
    setQuantities((xs) =>
      xs.map((x) => (x.key === qtyKey ? { ...x, assort_lines: fn(x.assort_lines) } : x)),
    );
  const patchAssort = (qtyKey: string, lineKey: string, patch: Partial<AssortLineRow>) =>
    mutAssort(qtyKey, (ls) => ls.map((l) => (l.key === lineKey ? { ...l, ...patch } : l)));

  /**
   * Set one size cell of one line.
   *
   * The cell is created on first keystroke rather than pre-seeded for every
   * size: a line that names no XL should store nothing about XL, and seeding a
   * row of zeroes would make `assortLineFilled` treat an untouched line as
   * answered. An explicit typed 0 is kept — that one IS a statement.
   */
  const setAssortSize = (qtyKey: string, lineKey: string, sizeId: string, qty: string) =>
    mutAssort(qtyKey, (ls) =>
      ls.map((l) => {
        if (l.key !== lineKey) return l;
        const hit = l.sizes.find((z) => z.size_id === sizeId);
        return {
          ...l,
          sizes: hit
            ? l.sizes.map((z) => (z.size_id === sizeId ? { ...z, qty } : z))
            : [...l.sizes, { key: newKey(), size_id: sizeId, qty }],
        };
      }),
    );
  const assortSizeQty = (l: AssortLineRow, sizeId: string): string =>
    l.sizes.find((z) => z.size_id === sizeId)?.qty ?? "";

  const addAssortLine = (qtyKey: string) => {
    const q = quantities.find((x) => x.key === qtyKey);
    const last = q?.assort_lines[q.assort_lines.length - 1];
    // Decline while the last line is untouched — `ChildGrid`'s protocol, so
    // Enter escalates instead of stacking blanks.
    if (last && !last.combo.trim() && !last.no_of_cartons.trim() && !last.sizes.length) {
      return false;
    }
    mutAssort(qtyKey, (ls) => [
      ...ls,
      { key: newKey(), combo: "", no_of_cartons: "", sizes: [] },
    ]);
  };

  /**
   * The assortment arithmetic — DERIVED, never stored (operator 2026-08-12).
   *
   *   Ratio Total = Σ size cells  = the pieces in ONE carton = PcsPerPack
   *   Line Qty    = NoOf Cartons × Ratio Total
   *   Total Qty   = Σ line quantities
   *
   * Storing any of the three would be a second source of truth for an
   * addition — the same rule `gsmRange` follows on the Combos overlay, and the
   * reason `pcs_per_pack` has no column.
   */
  /**
   * IS THIS ORDER PACKED TO AN ASSORTMENT?
   *
   * Client rule (2026-08-13): the ratio grid is for orders where "Assort" is
   * chosen in the packing options. Until now the Assort button opened for any
   * row naming a style, so a Solid Colour / Solid Size order — one colour and
   * one size per carton, nothing to ration — offered a ratio matrix anyway.
   *
   * IT READS THE ORDER'S PACK TYPES, NOT THE ROW'S `pack`. That column is a
   * free-text carton note the operator types INSIDE this very overlay, so
   * gating on it would be circular: you would have to open the sheet to earn
   * the right to open it. The pack TYPE is a header decision — the Pack type(s)
   * section, gated on the Pack toggle — and three of its four values assort on
   * at least one axis.
   *
   * EMPTY-AND-EXPLAIN, never a silent disable. Each refusal names the switch
   * that turns it on; a greyed button with no reason is the failure the
   * nominated-vendor rule records, where the operator never learns what is
   * missing.
   */
  const assortGate: { ok: boolean; why?: string } = !form.pack
    ? { ok: false, why: "Turn Pack on in Order Info to declare a pack type" }
    : packTypes.filter((p) => p.pack_type.trim()).length === 0
      ? { ok: false, why: "Declare a Pack type first — see the Pack type(s) section" }
      : packTypes.some((p) => /assort/i.test(p.pack_type))
        ? { ok: true }
        : {
            ok: false,
            why: "Pack type is Solid Colour / Solid Size — one colour and one size per carton, so there is no ratio to set",
          };

  const ratioTotalOf = (l: AssortLineRow) =>
    l.sizes.reduce((a, z) => a + (Number(z.qty) || 0), 0);

  /**
   * `is_ratio_wise_pack` DOES SOMETHING NOW.
   *
   * It was stored, rendered as a checkbox and read by nothing, so the grid
   * computed the same total whether it was ticked or not. Its own column
   * comment (0414) already said what it means: *"when true the line's size
   * cells are the ratio inside ONE carton and multiply by `no_of_cartons`"*.
   * So this is a documented meaning being honoured, not a new rule.
   *
   * Ticked — the cells are a RATIO (1S : 2M : 1L), four pieces per carton, and
   * twelve cartons is 48 pieces. Unticked — the cells are the pieces
   * themselves, already counted across the whole line, and multiplying by the
   * carton count would inflate the order by that factor.
   *
   * The distinction has to be visible, which is why the overlay states which
   * reading is in force rather than leaving the operator to infer it from a
   * total that silently changed.
   */
  const lineQtyOf = (l: AssortLineRow, ratioWise: boolean) =>
    ratioWise ? (Number(l.no_of_cartons) || 0) * ratioTotalOf(l) : ratioTotalOf(l);
  const assortTotalOf = (q: QuantityRow) =>
    q.assort_lines.reduce((a, l) => a + lineQtyOf(l, q.is_ratio_wise_pack), 0);

  /**
   * The combos this amendment declared, for the line's Combo cell.
   *
   * A PLAIN DERIVED VALUE, NOT A `useMemo` — the same call, and the same reason,
   * as `orderStructureIds` above. This point in the component is BELOW the
   * `if (mode === "list")` early return at the top, so a hook here runs on the
   * editor render and is skipped on the list render. React counts hooks by
   * position, so switching between the two threw "Rendered more hooks than
   * during the previous render" and blanked the route (2026-08-12).
   *
   * `orderStructureIds` was the hook React named, because it is the FIRST one
   * past the return; this was the second, and fixing only the first would have
   * moved the error rather than ended it. When a hooks-order error names a line,
   * check for siblings below it before believing it is the only one.
   *
   * Nothing is lost by dropping the memo: it is a pass over the order's own
   * combos, a handful of rows, consumed in the same render.
   */
  const declaredComboOptions = Array.from(
    new Set(combos.map((c) => c.combo.trim().toUpperCase()).filter(Boolean)),
  ).map((c) => ({ value: c, label: c }));

  /**
   * Quantities Details — TEN columns, and therefore CARDS (see the grid below).
   *
   * NO `width` ON ANY COLUMN, deliberately. They each carried one, ~100rem in
   * total, to force `table-fixed` so the table would scroll instead of
   * collapsing every picker to "— S…". The grid is carded now, so a per-column
   * width is both dead and contrary to the standing one-width rule: every field
   * is `<Field size="sm">` so a Year box and a Consignee picker line up down the
   * page. Leaving them would have preserved, in code, the argument for the
   * layout that was just removed.
   */
  const quantityColumns: ChildGridColumn<QuantityRow>[] = [
    {
      header: "Country",
      cell: (r) => (
        <CountryPicker
          countries={data.countries}
          value={r.country_id}
          onChange={(id) => setQty(r.key, { country_id: id })}
          canCreate={masterPerms.canCreate}
          canEdit={masterPerms.canEdit}
          required={false}
          compact
        />
      ),
    },
    {
      header: "Ref No",
      cell: (r) => (
        <RecordPicker
          label="Ref No"
          compact
          items={refNoOptions(r.style_ref_no)}
          value={r.style_ref_no || null}
          // Style No follows the ref, so the two are answered once.
          onChange={(v) =>
            setQty(r.key, { style_ref_no: v ?? "", style_no: styleNoForRef(v ?? "") })
          }
        />
      ),
    },
    {
      header: "Consignee",
      cell: (r) => (
        <RecordPicker
          label="Consignee"
          compact
          items={data.consignees}
          value={r.consignee_id}
          onChange={(id) => setQty(r.key, { consignee_id: id })}
        />
      ),
    },
    {
      header: "Assortment Type",
      cell: (r) => (
        <LookupDialogPicker
          kind="assortment_type"
          label="Assortment Type"
          options={assortmentTypes}
          value={r.assortment_type_id}
          onChange={(id) => setQty(r.key, { assortment_type_id: id })}
          canCreate={masterPerms.canCreate}
          canEdit={masterPerms.canEdit}
          compact
        />
      ),
    },
    {
      header: "PO Qty",
      align: "right",
      total: { kind: "sum", of: (r) => Number(r.po_qty) || 0 },
      /**
       * PO QTY AND THE ASSORTMENT TOTAL MUST NOT DISAGREE IN SILENCE.
       *
       * The overlay computes cartons × ratio, and this figure is typed off the
       * buyer's order sheet. Nothing compared them, so an operator could set up
       * twelve cartons of a 1:2:1 ratio (48 pieces) against a PO Qty of 50 and
       * see no sign of it — and this is the number the order is invoiced on.
       *
       * FLAGGED, NEVER OVERWRITTEN. Writing the computed total over a typed one
       * discards the figure the buyer actually sent, and the assortment is the
       * likelier of the two to be half-entered. So it says so and offers the
       * swap; the operator decides which is right.
       *
       * Silent while the assortment is empty — a line with no ratio rows is not
       * disagreeing with anything, it simply has not been filled in.
       */
      cell: (r) => {
        const computed = assortTotalOf(r);
        const typed = Number(r.po_qty) || 0;
        const mismatch = r.assort_lines.length > 0 && computed > 0 && computed !== typed;
        return (
          <div className="space-y-1">
            <Input
              className="h-8 text-right"
              inputMode="decimal"
              value={r.po_qty}
              onChange={(e) => setQty(r.key, { po_qty: e.target.value })}
            />
            {mismatch && (
              <button
                type="button"
                tabIndex={-1}
                onClick={() => setQty(r.key, { po_qty: String(computed) })}
                className="block w-full text-right text-[11px] leading-tight text-warning hover:underline"
                title="Use the assortment total"
              >
                Assort: {fmtNumber(computed)} — use
              </button>
            )}
          </div>
        );
      },
    },
    {
      header: "Delivery Dt",
      cell: (r) => (
        <Input
          type="date"
          className="h-8"
          value={r.delivery_date}
          onChange={(e) => setQty(r.key, { delivery_date: e.target.value })}
        />
      ),
    },
    {
      header: "Earlier Shipment Dt",
      cell: (r) => (
        <Input
          type="date"
          className="h-8"
          value={r.earlier_shipment_date}
          onChange={(e) => setQty(r.key, { earlier_shipment_date: e.target.value })}
        />
      ),
    },
    {
      header: "Style No",
      // Filled by Ref No. `readOnly` takes it out of the Tab path on its own and
      // can never hold the cursor, which is what a derived field must do.
      cell: (r) => <Input readOnly className="h-8" value={r.style_no} placeholder="—" />,
    },
    {
      header: "WareHouse",
      cell: (r) => (
        <RecordPicker
          label="WareHouse"
          compact
          items={data.warehouses}
          value={r.warehouse_id}
          onChange={(id) => setQty(r.key, { warehouse_id: id })}
        />
      ),
    },
    {
      header: "Discharge Port",
      cell: (r) => (
        <RecordPicker
          label="Discharge Port"
          compact
          items={data.ports}
          value={r.discharge_port_id}
          onChange={(id) => setQty(r.key, { discharge_port_id: id })}
        />
      ),
    },
    {
      header: "Assort",
      /**
       * The legacy [Click] that opens the Assortments screen (operator
       * screenshot 2026-08-12, 11:27), built at last — 0398 deferred it with
       * "adding it later is additive", and this is that addition.
       *
       * GATED TWICE, and each half answers a different "there is nothing to
       * fill in here".
       *
       * ON THE ROW NAMING A STYLE — the overlay's grid has one column per SIZE,
       * and the sizes are the style's; with no style there are no columns.
       * Same shape as the Combos [Detail] gate.
       *
       * AND ON THE ORDER BEING PACKED TO AN ASSORTMENT (`assortGate`, client
       * 2026-08-13) — a Solid Colour / Solid Size order has one colour and one
       * size in a carton, so there is no ratio to set. Each refusal names the
       * switch that turns it on rather than greying out in silence.
       *
       * The count is what makes the tree visible from outside — a destination
       * carrying three assortment lines otherwise looks exactly like one
       * carrying none.
       */
      cell: (r) => (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!r.style_ref_no.trim() || !assortGate.ok}
          title={
            !r.style_ref_no.trim() ? "Pick a Ref No first" : assortGate.why
          }
          onClick={() => setAssortQtyKey(r.key)}
        >
          Assort
          {r.assort_lines.length > 0 && (
            <span className="ml-1 text-xs text-muted-foreground">
              ({r.assort_lines.length})
            </span>
          )}
        </Button>
      ),
    },
  ];

  /**
   * Approval Quantity — EIGHT columns, and therefore cards.
   *
   * NO `width` ON ANY COLUMN. Every one of them carried one, on the reasonable
   * grounds that they "record the intended proportions if this ever goes back
   * to a table". They did something else as well: `hugsContent` is
   * `columns.every(c => c.width)` and it puts `w-fit` on the CARD wrapper, not
   * only on the table branch — so this fully-declared carded grid stopped
   * half-way across the pane while the Quantities grid beside it filled the
   * width (operator screenshot 2026-08-12, 12:26). Same cause and same fix as
   * that grid had.
   *
   * Nothing is lost: a card lays its cells out through `<Field size="sm">`,
   * which is the standing one-width rule, and a table would want its widths
   * chosen for a table anyway.
   */
  const approvalQtyColumns: ChildGridColumn<ApprovalQtyRow>[] = [
    {
      header: "Style",
      required: true,
      cell: (r) => (
        <div className="space-y-1">
          <RecordPicker
            label="Style"
            compact
            items={styleLineItems}
            identity="code"
            value={styleLineKeyOf(r.style_ref_no)}
            onChange={(key) => {
              const line = key ? styles.find((x) => x.key === key) : null;
              setApprovalQtys((xs) =>
                xs.map((x) =>
                  x.key === r.key
                    ? {
                        ...x,
                        style_ref_no: line?.style_ref_no ?? "",
                        style: (line?.style_id ? styleById.get(line.style_id)?.name : null) ?? "",
                        article_no: line?.article_no ?? "",
                      }
                    : x,
                ),
              );
            }}
          />
          {r.article_no && <p className="text-xs text-muted-foreground">{r.article_no}</p>}
        </div>
      ),
    },
    {
      /**
       * The STYLE's total, as context — what this line's colours should add up
       * to. It sits here, beside the Style it belongs to, and NOT between Qty
       * and Excess where it was first placed: Excess derives from `Qty`, and a
       * different quantity standing between the two reads as its source.
       * Adjacency in a numeric row is an implied relationship.
       */
      header: "Style PO Qty",
      align: "right",
      cell: (r) => derivedCell(poQtyOf(r)),
      total: { kind: "derived", value: (rows) => fmtNumber(rows.reduce((a, r) => a + poQtyOf(r), 0)) },
    },
    {
      /**
       * THE COLOUR (0413). Offered from the Combos tab for the style this row
       * names — the cascading-picker rule: a colour that is not on the order is
       * not an answer here.
       *
       * A `<Select>` and not a picker: the list is this order's own combos, a
       * handful of rows with nothing to search, and the same call Pack type(s)
       * and Price Type already make. `usedIds` has no equivalent on a native
       * select, so the duplicate guard is the normalizer plus 0413's unique
       * index rather than a withheld option.
       */
      header: "Combo",
      cell: (r) => {
        const opts = combos.filter(
          (c) => styleKey(c.style_ref_no) === styleKey(r.style_ref_no) && c.combo.trim(),
        );
        return (
          <Select
            value={r.combo}
            className="h-8"
            onChange={(e) => {
              const combo = e.target.value;
              const hit = opts.find((c) => c.combo === combo);
              setApprovalQtys((xs) =>
                xs.map((x) =>
                  x.key === r.key
                    ? { ...x, combo, combo_description: hit?.combo_description ?? "" }
                    : x,
                ),
              );
            }}
          >
            {/* Empty-and-explain: with no style picked there are no combos to
                offer, and a bare "—" would read as "this order has no colours". */}
            <option value="">
              {r.style_ref_no.trim() ? "— Select Combo —" : "Pick a Style first"}
            </option>
            {opts.map((c) => (
              <option key={c.key} value={c.combo}>{c.combo}</option>
            ))}
          </Select>
        );
      },
    },
    {
      /**
       * ORDERED PIECES OF THIS COLOUR — typed, because nothing in the schema
       * holds it (0413, and the migration header records why an even split was
       * rejected).
       *
       * The style's own PO Qty is shown in the column beside it so the operator
       * can see what the colours should add up to; the two are deliberately not
       * wired together, since a part-shipped or amended order legitimately
       * differs.
       */
      header: "Qty",
      align: "right",
      cell: (r) => (
        <Input
          type="number"
          className="text-right"
          value={r.qty}
          onChange={(e) =>
            setApprovalQtys((xs) =>
              xs.map((x) => (x.key === r.key ? { ...x, qty: e.target.value } : x)),
            )
          }
        />
      ),
      total: { kind: "sum", of: qtyOf },
    },
    {
      header: `Excess (${excessPct || 0}%)`,
      align: "right",
      cell: (r) => derivedCell(excessQtyOf(r)),
      total: { kind: "derived", value: (rows) => fmtNumber(rows.reduce((a, r) => a + excessQtyOf(r), 0)) },
    },
    {
      header: "Approval Qty",
      align: "right",
      // The one figure nothing can derive: pieces for buyer testing and office
      // records. Not `required` — zero is a legitimate answer.
      cell: (r) => (
        <Input
          type="number"
          className="text-right"
          value={r.approval_qty}
          onChange={(e) =>
            setApprovalQtys((xs) =>
              xs.map((x) => (x.key === r.key ? { ...x, approval_qty: e.target.value } : x)),
            )
          }
        />
      ),
      // `of` returns a number: the row holds the half-typed STRING from the box.
      total: { kind: "sum", of: approvalOf },
    },
    {
      /**
       * PROJECTION — the defect buffer, from the Rejection Rule on the header.
       *
       * A DASH IS NOT A ZERO, and that distinction is the whole reason this
       * column reads `projectionOf` rather than coalescing. Three states end up
       * blank and only one of them means "none needed": no rule chosen, a rule
       * whose tiers leave this quantity in a GAP, and a genuine zero allowance.
       * Printing 0 for the first two tells the floor no buffer is required —
       * the one answer a rejection rule never intends. The title says which.
       */
      header: "Projection",
      align: "right",
      cell: (r) => {
        const n = projectionOf(r);
        if (n == null) {
          return (
            // The unanswerable case, in the SAME box `derivedCell` draws — a
            // dash floating where a figure would sit is what made this column
            // read as broken rather than as "no rule chose a buffer". `title`
            // still carries which of the two reasons it is.
            <Input
              readOnly
              className="h-8 text-right"
              value="—"
              title={
                !form.rejection_rule_id
                  ? "No Rejection Rule chosen on this order"
                  : "This quantity falls outside the rule's tiers"
              }
            />
          );
        }
        return derivedCell(n);
      },
      total: {
        kind: "derived",
        value: (rows) =>
          fmtNumber(rows.reduce((a, r) => a + (projectionOf(r) ?? 0), 0)),
      },
    },
    {
      header: "Total Production",
      align: "right",
      cell: (r) => (
        <span className="block text-right text-sm font-medium tabular-nums text-foreground">
          {fmtNumber(totalQtyOf(r))}
        </span>
      ),
      total: { kind: "derived", value: (rows) => fmtNumber(rows.reduce((a, r) => a + totalQtyOf(r), 0)) },
    },
  ];

  /**
   * THE STYLE(S) GRID — no longer a rail section of its own.
   *
   * MERGED INTO ORDER INFO (client 2026-08-11): "merge the Order Info header
   * and the Style tab into a single unified view", so the facts an order is
   * opened with — who it is for and what it is for — are entered without
   * paging. `style-master-screen.tsx` did the same three-into-one merge the
   * same week; its counter-decision beside it (Components stayed separate)
   * is the argument to read if this section ever grows long enough to push
   * the grid below a screenful of form.
   *
   * HELD AS A CONST because `orderInfoSection` is declared ~600 lines below
   * and this is ~90 lines of working JSX. Moving it rather than rewriting it
   * is what keeps this a LAYOUT change: nothing about the grid's behaviour
   * can hide inside the diff.
   */
  /**
   * THE SIZE LIST UNDER A STYLE LINE (0407) — the nested grid the legacy screen
   * expands beneath each row (`S No · Size`, screenshots 2255 -> 2256).
   *
   * HAND-ROLLED, NOT A SECOND `ChildGrid`, and that is deliberate. `ChildGrid`
   * has no row-detail slot: a nested grid is markup the CALLER emits, held
   * together by DOM markers alone (AGENTS.md, "A ROW'S NESTED GRID IS PART OF
   * THE ROW"). Material Attributes' values list is the same shape and the file
   * to compare against.
   *
   * RENDERED AFTER THE ROW'S OWN FIELDS, which is not styling — `tabFieldsIn`
   * walks the row in DOM ORDER, so Tab reaches the sizes only by standing
   * beneath the cells. (The arrows read a different axis on purpose:
   * `ownDescendants` is scoped to the nearest `data-grid-row`, so ↑/↓ inside
   * the size list stay inside it.)
   *
   * THE FOUR MARKERS EACH BUY ONE KEY, and none is decoration:
   *
   *   `data-grid-body`  + `onKeyDown={gridKeyNav}` on the SAME element —
   *                       `gridKeyNav` reads `e.currentTarget`, so splitting
   *                       them silently disables the arrows and Enter.
   *   `data-grid-row`   the arrow axis, one per size.
   *   `data-row-remove` Ctrl+Del. Tab has not visited a ✕ since it began
   *                       landing on fields only, so this is the keyboard's
   *                       ONLY way to drop a size.
   *   `data-row-add`    what `enterNestedGrid` clicks when Tab steps off the
   *                       row's last cell into a list that has no rows yet.
   *                       Without it the FIRST size of a line is mouse-only —
   *                       the exact defect AGENTS.md records under "An empty
   *                       nested grid is entered by OPENING its first row",
   *                       and the one `document-no-format-master-screen.tsx`
   *                       still has.
   *
   * NOT `required`. A style may legitimately carry no sizes, so a hold on a
   * blank one would cage the operator on a question the record does not need
   * answered — and `useRequiredHold` refuses movement, which on a list with
   * nothing to pick from is unsatisfiable rather than merely strict.
   *
   * `usedIds` IS THE DUPLICATE GUARD, at the source. A line naming "M" twice
   * says nothing the first row did, so the second pick is never OFFERED rather
   * than rejected afterwards; 0407's unique index is the backstop for
   * `lib/data-io`, which writes past this screen entirely.
   */
  /** A size's own words, for the ✕'s label. `aria-label` must START "Remove" —
   *  that prefix is one of the two ways `gridKeyNav` finds the button for
   *  Ctrl+Del (the other is `data-row-remove`, which is also set). */
  const sizeLabel = (id: string | null) => {
    const row = id ? sizeOpts.find((o) => o.id === id) : null;
    return row ? lookupLabel("size", row) : "";
  };

  /**
   * THE STRUCTURE DETAILS OVERLAY (0408 · 0409) — what the Combos tab's
   * [Detail] button opens (legacy screenshots 2259 · 2260).
   *
   * A `Sheet`, not a hand-rolled `fixed inset-0`. That is the reload-guard
   * rule: `Sheet` registers with `lib/reload-guard.ts` itself, so a silent
   * auto-update cannot land mid-edit and throw the tree away, and a bare div
   * would be invisible to the guard's `role="dialog"` scan. It also resets
   * `RequiredScope` at its portal boundary, which matters here because the
   * button that opens it sits in a `required` grid cell — without that reset,
   * every optional field inside would inherit "required", stamp
   * `data-required-empty` and hold the cursor (the New Yarn defect, 2026-08-06).
   *
   * ONE OVERLAY, NOT ONE PER ROW. It reads `detailComboKey` and renders the
   * combo it names, so the grid stays a grid.
   */
  const detailCombo = combos.find((c) => c.key === detailComboKey) ?? null;

  // ---- Quantities ▸ Assort ▸ the Assortments overlay (0414) ----------------

  const assortQty = quantities.find((q) => q.key === assortQtyKey) ?? null;

  /** The read-only identity band — carried in from the quantity row. */
  const assortHeader = (q: QuantityRow) => (
    <FieldGrid>
      {(
        [
          ["Country", data.countries.find((c) => c.id === q.country_id)?.name ?? ""],
          ["Style Ref No", q.style_ref_no],
          ["Style", q.style_no],
          [
            "Assortment Type",
            assortmentTypes.find((a) => a.id === q.assortment_type_id)?.name ?? "",
          ],
          ["Qty", q.po_qty],
          ["Delivery Dt", fmtDate(q.delivery_date) || ""],
        ] as [string, string][]
      ).map(([label, value]) => (
        <Field key={label} label={label} size="sm">
          <Input readOnly className="h-8" value={value} placeholder="—" />
        </Field>
      ))}
    </FieldGrid>
  );

  /**
   * THE ASSORTMENTS GRID — the repo's first grid whose COLUMNS come from data.
   *
   * `ChildGridColumn<T>[]` has always been a plain array and one caller already
   * `.map()`s a literal (`stylePriceColumns`), but nothing until now built the
   * list from fetched rows. Here the size columns ARE the style's sizes, so the
   * shape of the grid is a property of the record.
   *
   * WIDTH IS THE WHOLE PROBLEM AND THE LAYOUT CONTRACT ANSWERS IT. Three fixed
   * columns plus N sizes is well past the ~6 a table can hold, so this is
   * `forceCards` + `renderMobileRow` reading off `columns` — the same route the
   * ten-column Quantities grid took. A size cell is `<Field size="xs">`
   * (col-span-2, six per wrapped row, documented as "2-4 chars — %, qty, a
   * small count"), which is not merely the right width: `FIELD_TRACK` and its
   * span map are LITERAL constants because Tailwind v4 scans source text, so a
   * computed span class would produce no CSS at all. `xs` is the only option
   * and it happens to be correct.
   */
  const assortColumns = (q: QuantityRow): ChildGridColumn<AssortLineRow>[] => [
    {
      header: "Combo",
      cell: (l) => (
        // The colourways THIS order declared on the Combos tab, offered rather
        // than enforced — an order whose combos are not entered yet must still
        // be packable. Same reading as the component grid's Fabric Color.
        <Combobox
          options={declaredComboOptions}
          value={l.combo}
          onChange={(v) => patchAssort(q.key, l.key, { combo: v.toUpperCase() })}
          placeholder={declaredComboOptions.length ? "Select…" : "Type a combo"}
          clearable
        />
      ),
    },
    {
      header: "NoOf Cartons",
      align: "right",
      cell: (l) => (
        <Input
          type="number"
          className="h-8 text-right"
          inputMode="decimal"
          value={l.no_of_cartons}
          onChange={(e) => patchAssort(q.key, l.key, { no_of_cartons: e.target.value })}
        />
      ),
    },
    ...sizesOfQuantity(q)
      .filter((z) => z.size_id)
      .map((z): ChildGridColumn<AssortLineRow> => ({
        header: sizeLabel(z.size_id) || "—",
        align: "right",
        cell: (l) => (
          <Input
            type="number"
            className="h-8 text-right"
            inputMode="decimal"
            value={assortSizeQty(l, z.size_id!)}
            onChange={(e) => setAssortSize(q.key, l.key, z.size_id!, e.target.value)}
          />
        ),
      })),
    {
      header: "PcsPerPack",
      align: "right",
      // Ratio Total under its legacy name — the pieces in one carton. Read-only
      // and column-less in the database for the same reason Gsm Range is.
      cell: (l) => (
        <Input readOnly className="h-8 text-right" value={fmtNumber(ratioTotalOf(l))} />
      ),
    },
    {
      header: "Qty",
      align: "right",
      cell: (l) => (
        <Input
          readOnly
          className="h-8 text-right"
          value={fmtNumber(lineQtyOf(l, q.is_ratio_wise_pack))}
        />
      ),
    },
  ];

  const assortGrid = (q: QuantityRow) => {
    const cols = assortColumns(q);
    const sizes = sizesOfQuantity(q).filter((z) => z.size_id);
    return (
      <>
        {/* EMPTY-AND-EXPLAIN. With no sizes the grid has no size columns at
            all, and a matrix of Combo + Cartons alone would look like the
            feature is broken rather than like the style has not said. */}
        {sizes.length === 0 && (
          <p className="text-xs text-muted-foreground">
            This style lists no sizes, so there are no size columns to fill. Add them
            on Order Info ▸ Styles Details ▸ Sizes.
          </p>
        )}
        <ChildGrid<AssortLineRow>
          label="Assortments"
          columns={cols}
          rows={q.assort_lines}
          forceCards
          renderMobileRow={(row, i) => (
            <FieldGrid>
              {cols.map((c, ci) => (
                <Field
                  key={ci}
                  label={c.header}
                  required={c.required}
                  // The three named columns keep the standing field width; a
                  // size cell is `xs` so six wrap per row instead of one line
                  // of sixteen running off the side.
                  size={ci >= 2 && ci < 2 + sizes.length ? "xs" : "sm"}
                >
                  {c.cell(row, i)}
                </Field>
              ))}
            </FieldGrid>
          )}
          rowSummary={(row) =>
            row.combo.trim() || <span className="text-muted-foreground">New assortment</span>
          }
          onAdd={() => addAssortLine(q.key)}
          onRemove={(l) => mutAssort(q.key, (ls) => ls.filter((x) => x.key !== l.key))}
          addLabel="+ Add assortment"
        />
      </>
    );
  };

  /** The read-only identity band across the top — carried in, never typed. */
  const detailHeader = (r: ComboRow) => (
    <FieldGrid>
      {(
        [
          ["Style Ref No", r.style_ref_no],
          ["Style No", r.style],
          ["Style Desc.", r.article_no],
          ["Combo", r.combo],
          ["Combo Description", r.combo_description],
        ] as [string, string][]
      ).map(([label, value]) => (
        <Field key={label} label={label} size="sm">
          {/* `readOnly`, never `disabled` — `Input` gives a readOnly field
              `tabIndex={-1}` itself, so it leaves the Tab path with no
              per-screen opt-out while the value stays selectable. */}
          <Input readOnly className="h-8" value={value} placeholder="—" />
        </Field>
      ))}
    </FieldGrid>
  );

  /**
   * The parts made of one structure — the overlay's nested grid.
   *
   * Hand-rolled for the same reason the size grid is: `ChildGrid` has no
   * row-detail slot, so a nested grid is markup the caller emits and the four
   * DOM markers are the whole contract. `data-grid-body` must carry
   * `gridKeyNav` on the SAME element (it reads `e.currentTarget`);
   * `data-row-add` is what `enterNestedGrid` clicks so Tab can enter a parts
   * list that has no rows yet.
   */
  const componentGrid = (r: ComboRow, st: ComboStructRow) => (
    // `r`, not just its key: the Coordinate / Component / Fabric Color options
    // are all properties of the combo's STYLE and its Fabric Type.

    /*
     * ONE PANEL, ALWAYS DRAWN — with rows or without (operator, 2026-08-12:
     * "add component and add structure is in some aligned and look
     * imbalanced").
     *
     * It used to be a bare `pl-4` with no border, so a structure that had a
     * component looked boxed and one that did not looked like loose text, and
     * "+ Add component" ended up sitting an inch above "+ Add structure" at a
     * different indent — two buttons of different scope reading as a pair. The
     * panel is what says "everything in here belongs to the structure above";
     * without it the nesting was carried by indentation alone, which is exactly
     * the 22px-of-chrome / no-shared-left-edge problem `listRows` documents.
     */
    <div className="rounded-md border border-border/60 bg-muted/20 p-3">
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Coordinates &amp; components
      </div>
      <div
        data-grid-body
        className="space-y-2"
        onKeyDown={(e) => gridKeyNav(e, () => addComp(r.key, st.key))}
      >
        {st.components.map((c, j) => (
          <div
            key={c.key}
            data-grid-row
            className="rounded-md border border-border bg-surface p-3"
          >
            <div className="mb-2 flex items-center gap-2">
              <span className="text-xs font-medium text-muted-foreground">#{j + 1}</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                data-row-remove
                className="ml-auto shrink-0 text-muted-foreground hover:text-danger"
                onClick={() =>
                  mutComps(r.key, st.key, (cs) => cs.filter((x) => x.key !== c.key))
                }
                aria-label="Remove component"
              >
                <Trash2 className="h-4 w-4 shrink-0" />
              </Button>
            </div>
            <FieldGrid>
              <Field label="Coordinate" size="sm">
                {/* The style's own coordinates (client 2026-08-12). */}
                <RecordPicker
                  label="Coordinate"
                  compact
                  items={scopedCoordinates(r, c.coordinate_id)}
                  value={c.coordinate_id}
                  onChange={(id) =>
                    patchComp(r.key, st.key, c.key, {
                      coordinate_id: id,
                      // CLEAR A COMPONENT THAT FALLS OUT OF SCOPE, and only
                      // then — the cascading-filter rule's second clause.
                      // Narrowing the coordinate around a component the style
                      // still pairs with it must keep that component.
                      ...(c.component_id &&
                      !scopedComponents(r, id, null).some((o) => o.id === c.component_id)
                        ? { component_id: null }
                        : {}),
                    })
                  }
                />
              </Field>
              <Field label="Component" size="sm">
                {/* Narrowed by the coordinate beside it: the style declares the
                    PAIR (FRONT BODY *of* PIECES), so an unscoped list would
                    offer a collar under a coordinate that has none. */}
                <RecordPicker
                  label="Component"
                  compact
                  items={scopedComponents(r, c.coordinate_id, c.component_id)}
                  value={c.component_id}
                  onChange={(id) => patchComp(r.key, st.key, c.key, { component_id: id })}
                />
              </Field>
              <Field label="Fabric Color" size="sm">
                {/*
                 * THE ORDER'S OWN DYEING PALETTE, and only when the fabric is
                 * SOLID (client 2026-08-12).
                 *
                 * A solid fabric is dyed to a colour this order declared on the
                 * Color/Print Details tab, so that tab is the list. A MELANGE
                 * or YARN-DYED fabric is not: melange takes its colour from the
                 * purchased yarn and yarn-dyed is coloured before knitting —
                 * which is the same fact the Color/Print tab already states to
                 * explain why neither needs a dyeing row. Offering the dyeing
                 * palette there would present the wrong list as authoritative.
                 *
                 * A Combobox, so free text always works: the field is never
                 * blocked, it is only GUIDED — 0397's rule stays a rule.
                 */}
                <Combobox
                  options={colourOptionsFor(st)}
                  value={c.color_name}
                  onChange={(v) =>
                    patchComp(r.key, st.key, c.key, { color_name: v.toUpperCase() })
                  }
                  placeholder={
                    colourOptionsFor(st).length ? "Select…" : "Type a colour"
                  }
                  clearable
                />
              </Field>
              <Field label="Fabric Print" size="sm">
                {/* ONE FIELD (0410), and scoped to the prints THIS order
                    declared (2026-08-12) — the all-over / rotary print, not a
                    placement print. No inline create: adding a lookup row here
                    would not declare it on the Color/Print tab. */}
                <RecordPicker
                  label="Fabric Print"
                  compact
                  items={declaredPrintOptions(st, c.print_id)}
                  value={c.print_id}
                  onChange={(id) => patchComp(r.key, st.key, c.key, { print_id: id })}
                  placeholder={
                    !takesAllOverPrint(st.item_sub_type)
                      ? "Set Fabric Type to Printed"
                      : declaredPrintOptions(st, c.print_id).length
                        ? undefined
                        : "Declare a print on Color/Print Details first"
                  }
                />
              </Field>
            </FieldGrid>
            {/* A BOOLEAN IS NOT A FIELD BOX. Wrapped in a `Field` it drew a
                label above a 16px tick floating in a 36px-tall slot, which is
                what made this row look ragged beside four filled inputs. This
                is the same inline `<label>` the Amendment In panel uses. */}
            <label className="mt-2 flex w-fit items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={c.processed_as_trim}
                onChange={(e) =>
                  patchComp(r.key, st.key, c.key, { processed_as_trim: e.target.checked })
                }
                className="h-4 w-4 rounded border-border"
              />
              Processed as Trim
            </label>
          </div>
        ))}
        {st.components.length === 0 && (
          <p className="text-xs text-muted-foreground">
            No parts listed for this structure yet.
          </p>
        )}
        {/* SAY WHEN THE NARROWING IS NOT HAPPENING. The Coordinate and
            Component lists fall back to the full masters for a style that
            declares no parts — a fallback the operator cannot see is a fallback
            they will read as "the style has all of these". */}
        {!styleDeclaresParts(r) && (
          <p className="text-xs text-muted-foreground">
            This style lists no components, so every coordinate and component is
            offered. Add them on the Style master to narrow these.
          </p>
        )}
        <Button
          type="button"
          variant="outline"
          size="sm"
          data-row-add
          onClick={() => addComp(r.key, st.key)}
        >
          + Add component
        </Button>
      </div>
    </div>
  );

  /**
   * The structures of one combo — the overlay's outer grid.
   *
   * `forceCards listRows` for the same reason the Style(s) grid uses them:
   * eight real inputs per row plus a nested parts list, which LAYOUT.md §6 puts
   * well past the width a table row has (the legacy grid scrolls sideways; ours
   * must not).
   */
  // NAMED `combo...` because the Color/Print tab already owns
  // `structureColumns`, and that grid is the amendment's OWN list of fabric
  // structures — a different question on a different tab. Two `structureColumns`
  // in one file is the collision this rename removes rather than shadows.
  //
  // EMPTY ON PURPOSE: `renderMobileRow` owns the whole row here, and a column
  // declaring `required` that the row never reads would draw a header `*` with
  // nothing behind it (`--check grid-required-mobile`). The `required` that
  // matters is on the Structure control inside the row.
  const comboStructureColumns: ChildGridColumn<ComboStructRow>[] = [];

  const structureGrid = (r: ComboRow) => (
    <ChildGrid<ComboStructRow>
      label="Structure Details"
      columns={comboStructureColumns}
      rows={r.structures}
      /*
       * `forceCards` WITHOUT `listRows` (operator, 2026-08-12: the two grids
       * "look imbalanced").
       *
       * `listRows` means the ROW draws its own header — so this file rendered a
       * hand-rolled `#N` + family chip + ✕ band, and a structure with no
       * components came out as loose text while one with components sat inside
       * the panel its parts drew. Two rows of the same grid looked like two
       * different kinds of thing.
       *
       * Handing the band back to `ChildGrid` boxes every row identically,
       * removes ~20 lines of duplicated chrome, and puts the ✕ exactly where it
       * sits on every other carded grid in the app. `rowSummary` is the
       * supported way to keep the identity beside the `#N` — which is precisely
       * what the family chip was.
       */
      forceCards
      /* A blank row has no identity yet and says so in muted text rather than
         rendering an empty line — `rowSummary`'s own documented guidance. The
         family is the honest summary once a Structure is picked: it is the fact
         that decides whether GSM is compulsory. */
      rowSummary={(st) =>
        familyNameOf(st.structure_id) || (
          <span className="text-muted-foreground">New structure</span>
        )
      }
      onAdd={() => addStruct(r.key)}
      onRemove={(st) => mutStructs(r.key, (sts) => sts.filter((x) => x.key !== st.key))}
      addLabel="+ Add structure"
      renderMobileRow={(st) => {
        const problems = structureProblems(st, familyCodeOf(st.structure_id));
        const range = gsmRange(st.gsm, st.gsm_tolerance);
        return (
          <div className="space-y-3">
            <FieldGrid>
              <Field label="Structure" required size="sm">
                {/* A fabric CATEGORY (0409). The knit family beside it is
                    DERIVED from this one answer — never asked again, so the
                    two cannot disagree. */}
                <RecordPicker
                  label="Structure"
                  compact
                  required
                  items={scopedStructures(r, st.structure_id)}
                  value={st.structure_id}
                  onChange={(id) => pickComboStructure(r.key, st.key, id)}
                />
              </Field>
              <Field label="Type" size="sm">
                {/* Main Fabric / Trims Fabric — `order_fabrics.fabric_type`.
                    NOT the Style master's "Type", which is a different question
                    wearing the same word (see combo-rules.ts). */}
                <Select
                  value={st.fabric_type}
                  onChange={(e) => patchStruct(r.key, st.key, { fabric_type: e.target.value })}
                >
                  <option value="">—</option>
                  {FABRIC_TYPE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Composition" size="sm">
                <RecordPicker
                  label="Composition"
                  compact
                  items={data.compositions}
                  value={st.composition_id}
                  onChange={(id) => patchStruct(r.key, st.key, { composition_id: id })}
                />
              </Field>
              <Field label="Gsm" size="sm">
                <Input
                  type="number"
                  className="text-right"
                  value={st.gsm}
                  onChange={(e) => patchStruct(r.key, st.key, { gsm: e.target.value })}
                />
              </Field>
              <Field label="Tolerance" size="sm">
                <Input
                  type="number"
                  className="text-right"
                  value={st.gsm_tolerance}
                  onChange={(e) => patchStruct(r.key, st.key, { gsm_tolerance: e.target.value })}
                />
              </Field>
              <Field label="Gsm Range" size="sm">
                {/* DERIVED, never stored (0408) — 200 ± 5 is 195 - 205. A
                    column for it would be a second source of truth for a
                    subtraction. */}
                <Input readOnly className="h-8" value={range} placeholder="—" />
              </Field>
              <Field label="Fabric Type" size="sm">
                <Select
                  value={st.item_sub_type}
                  onChange={(e) => patchStruct(r.key, st.key, { item_sub_type: e.target.value })}
                >
                  <option value="">—</option>
                  {ITEM_SUB_TYPE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              </Field>
            </FieldGrid>
            {/* ADVISORY, NOT A HOLD. "Circular Knit -> GSM compulsory" is a
                property of the CASE, so it cannot be a `required` prop — and it
                must not stamp `data-required-empty`, which would cage the
                operator on a row whose structure they are still choosing. */}
            {problems.length > 0 && (
              <p className="text-xs text-warning">{problems.join(" · ")}</p>
            )}
            {componentGrid(r, st)}
          </div>
        );
      }}
    />
  );

  const sizeGrid = (r: StyleRow) => (
    /* NO HEADING AND NO `pl-4` — the `<Field label="Sizes">` around this owns
       both (client 2026-08-12, screenshot 154120: "+ Add size" sat ~7px below
       every other control on the row).

       Both were right when this grid rendered BELOW the row: it needed its own
       caption and an indent to read as nested. As a CELL it needs neither, and
       keeping them cost the alignment twice over — a hand-rolled `text-xs`
       caption is not the same height as `Field`'s label, so the content beneath
       started lower than its neighbours, and `pl-4` pushed it right of a label
       that was no longer indented with it. One field, one label, drawn by the
       primitive: LAYOUT.md §3's whole point. */
    <div>
      <div
        data-grid-body
        className="space-y-1"
        onKeyDown={(e) => gridKeyNav(e, () => addSize(r.key))}
      >
        {r.sizes.map((z, j) => (
          <div key={z.key} data-grid-row className="flex items-center gap-2">
            <span className="w-5 shrink-0 text-right text-[11px] text-muted-foreground">
              {j + 1}
            </span>
            <div className="min-w-0 flex-1 sm:max-w-[14rem]">
              <LookupDialogPicker
                kind="size"
                label="Size"
                compact
                options={sizeOpts}
                value={z.size_id}
                usedIds={r.sizes.filter((x) => x.key !== z.key).map((x) => x.size_id).filter(Boolean) as string[]}
                onChange={(id) => setSize(r.key, z.key, id)}
                canCreate={masterPerms.canCreate}
                canEdit={masterPerms.canEdit}
              />
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              data-row-remove
              className="shrink-0 text-muted-foreground hover:text-danger"
              onClick={() => mutSizes(r.key, (zs) => zs.filter((x) => x.key !== z.key))}
              aria-label={`Remove size ${sizeLabel(z.size_id) || j + 1}`}
            >
              <Trash2 className="h-4 w-4 shrink-0" />
            </Button>
          </div>
        ))}
        {/* EMPTY-AND-EXPLAIN, never a silent blank. Only once a style has been
            picked: before that there is nothing to have fetched, and the line
            would be scolding the operator for not having answered yet. */}
        {r.style_id && r.sizes.length === 0 && (
          <p className="text-xs text-muted-foreground">
            This style has no sizes recorded. Add them here, or fill them on the Style master.
          </p>
        )}
        <Button
          type="button"
          variant="outline"
          size="sm"
          data-row-add
          onClick={() => addSize(r.key)}
        >
          + Add size
        </Button>
      </div>
    </div>
  );

  const stylesGrid = (
    <>
      {/* CARDS, NOT A TABLE. Six real inputs per row, which LAYOUT.md §6 puts
          in the "6-8 -> stacked card per row" band; the table this replaces
          was `min-w-[1000px]` inside an `overflow-x-auto` and scrolled
          sideways inside the section rail (client 2026-08-10). `listRows`
          means this row draws its own header, which is why the #N band and
          the remove button are rendered below rather than by the grid.

          `pageSize` rather than an inner scrollbar — "no scroll-in-a-box"
          (client 2026-07-25); it self-hides when everything fits. */}
      <ChildGrid<StyleRow>
        label="Styles Details"
        badge={
          form.mult_ord ? (
            <span className="text-[11px] font-medium text-muted-foreground">
              Multiple styles on this PO
            </span>
          ) : (
            <span className="text-[11px] font-medium text-muted-foreground">
              One style per PO · tick Mult. Ord to add more
            </span>
          )
        }
        columns={styleColumns}
        rows={styles}
        forceCards
        listRows
        pageSize={5}
        /**
         * MULT. ORD IS THE CAP, and this is the whole of its meaning.
         *
         * A buyer's PO names one style in ~98% of cases; occasionally one PO
         * covers several distinct styles (a Men's and a Women's tee). Mult.
         * Ord = Yes is the operator saying "this PO is one of those", and
         * until they do, the grid holds exactly one line.
         *
         * `hideAdd` rather than a check inside `addStyle`, because it does
         * two things at once: it removes the button AND makes Enter on the
         * last field DECLINE instead of growing the grid, so the keyboard
         * cannot get past the cap either. Same prop, same reason, as the
         * "Single Yarn fabric = exactly one component" cap on Style master.
         *
         * NON-DESTRUCTIVE ON THE WAY BACK. Un-ticking Mult. Ord on an order
         * that already lists three styles caps further ADDS; it never drops
         * the rows already entered. Silently deleting two styles because a
         * checkbox changed is data loss dressed up as a rule.
         */
        hideAdd={!form.mult_ord && styles.length >= 1}
        onAdd={addStyle}
        onRemove={(r) => setStyles((xs) => xs.filter((x) => x.key !== r.key))}
        addLabel="+ Add style"
        renderMobileRow={(r, i) => (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="shrink-0 text-xs font-medium text-muted-foreground">
                #{i + 1}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                data-row-remove
                className="ml-auto shrink-0 text-muted-foreground hover:text-danger"
                onClick={() => setStyles((xs) => xs.filter((x) => x.key !== r.key))}
                aria-label="Remove style"
              >
                <Trash2 className="h-4 w-4 shrink-0" />
              </Button>
            </div>
            {/* `required={col.required}` is not optional plumbing: with
                `renderMobileRow` supplied, ChildGrid stops wrapping cells in
                its own `RequiredScope` (child-grid.tsx:1119), so this Field
                is the ONLY place a column's declaration can reach. Drop it
                and the `*` and the cursor hold both silently vanish while
                the column still reads `required: true`. */}
            {/**
              * SIX FIELDS, ONE ROW (client 2026-08-12, screenshots 2267 · 2268).
              *
              * `xs` is `col-span-2` on the 12-col `FIELD_TRACK`, and six of them
              * sum to exactly 12 — so Style · Order Unit · PO Qty · Process ·
              * Description · Sizes sit on a single line with nothing left over.
              *
              * THE TWO LAYOUTS BEFORE THIS WERE BOTH WRONG, and the arithmetic
              * is why. At `sm` (`col-span-3`) the row broke four-then-one:
              * Description was orphaned against three empty columns and Sizes
              * was stranded below, because five cells do not divide by four.
              * At `lg` (`col-span-6`) it broke two-and-two-and-two — even, but
              * three lines, which is not what was asked for. Only 2 × 6 puts
              * them on one line, so this is the one span that satisfies the
              * requirement rather than merely tidying the symptom.
              *
              * SIZES IS THE SIXTH CELL and stays LAST. It is the one cell that
              * grows with its data, so at the end of the line its height
              * extends the card downward; earlier in the row it would leave a
              * band of dead space beside five short fields, the trap
              * LAYOUT.md §3 names for a textarea sharing a row.
              *
              * `Field` OWNS ITS LABEL, like every other cell. `sizeGrid` used to
              * draw its own caption and indent, which is what made this the one
              * cell whose control did not line up with the rest of the row.
              *
              * `xs` IS DELIBERATE HERE AND IS NOT THE MASTERS FIELD WIDTH. The
              * one-width rule (LAYOUT.md §3, ~280px) governs a masters FORM; a
              * child-grid row is a table line rendered as fields, and its width
              * is set by how many columns the line carries. Do not "correct"
              * these to `sm` — that is the four-then-one layout the client
              * rejected.
              */}
            {/**
              * SIX FIELDS, ONE ROW, ALL THE SAME WIDTH — back on `FieldGrid`'s
              * standard 12-column track (client 2026-08-12).
              *
              * This row briefly ran on a hand-rolled 14-column track so Sizes
              * could be double width. That was built to order and it worked, but
              * the surplus width read as a HOLE: with no sizes entered the cell
              * holds one "+ Add size" button, so the extra two columns rendered
              * as a gap between Sizes and Order Unit rather than as room. A cell
              * sized for its fullest state is empty space in its commonest one.
              *
              * `xs` is `col-span-2` and six of them sum to exactly 12, so the row
              * fills the standard track with nothing left over and every field
              * is the same width — which is what LAYOUT.md §3's one-width rule
              * says anyway. Getting rid of the custom track and evening the
              * spacing turned out to be the same edit.
              *
              * THE SIZE LIST IS NARROWER FOR IT, and that is the accepted trade:
              * its pickers shrink to the shared width. If that becomes the
              * complaint, the answer is to move the list behind a button like
              * Process — NOT to widen one cell again, which is what produced the
              * gap.
              *
              * `xs` here is deliberate and is NOT the masters field width. That
              * rule governs a masters FORM; a child-grid row is a table line
              * rendered as fields, and its width is set by how many columns the
              * line carries. Do not "correct" these to `sm` — four per row is
              * the layout the client rejected twice.
              */}
            <FieldGrid>
              {styleColumns.flatMap((col) => {
                const field = (
                  <Field
                    key={col.header}
                    label={col.header}
                    required={col.required}
                    size="xs"
                  >
                    {col.cell(r, i)}
                  </Field>
                );
                /**
                 * SIZES SITS SECOND, DIRECTLY AFTER STYLE (client 2026-08-12),
                 * because that is where its data comes from: `pickStyle` fills
                 * this list from the chosen style's own size set, so the field
                 * that answers "which sizes" reads immediately after the field
                 * that decides them.
                 *
                 * Anchored on the Style COLUMN, not on index 0. Injecting after
                 * `ci === 0` would silently follow whatever column happened to
                 * be first if these are ever reordered again — and they have
                 * been reordered three times this week. Anchoring on the header
                 * fails loudly instead: move Style and Sizes moves with it.
                 *
                 * It stays EDITABLE. The order keeps its own copy of the sizes
                 * (0407) precisely so an operator can add or drop one for this
                 * PO without editing the Style master, so this is a listing the
                 * style SEEDS, not a mirror of it.
                 */
                return col.header === "Style"
                  ? [
                      field,
                      <Field
                        key="__sizes"
                        /* The count rides in the label because the grid no longer
                           draws one. `Field` has no badge slot, and a second
                           element beside the label would put this cell's header
                           back out of step with the five plain ones. */
                        label={r.sizes.length ? `Sizes (${r.sizes.length})` : "Sizes"}
                        size="xs"
                      >
                        {sizeGrid(r)}
                      </Field>,
                    ]
                  : [field];
              })}
            </FieldGrid>
          </div>
        )}
      />
      <EmptyNote rows={styles.length} label="styles" seeded={seeded} />
    </>
  );

  /** One blank Style Prices row. Was written out three times — the caption's
   *  onAdd, the grid's keyboard add, and nothing else agreed with either. */
  const tabs: TabItem[] = [
    // ---------------- Color / Print Details ----------------
    {
      key: "colors",
      label: "Color/Print Details",
      content: (
        <div className="space-y-4">
          {/* WHAT THE ORDER'S FABRICS NEED — said, never enforced.
              Melange takes its colour from the purchased yarn and yarn-dyed is
              coloured before knitting, so neither needs a dyeing row. But
              `item_sub_type` is per FABRIC ROW, so a mixed order is normal and
              both grids stay fully usable; hiding one would strand rows already
              saved on a grid that no longer renders (client 2026-08-10). */}
          <FabricTypeHint counts={fabricTypes} />
          {/* TWO GRIDS A ROW, not four stacked (client 2026-08-12, screenshots
              2269 · 2270): Yarn Dyeing beside Fabric Dyeing, then Roll Form
              Prints beside Structures. Stacked, the tab was a metre of scroll
              holding four short lists, and the pair that reads as a pair — the
              two dyeing grids, same two columns, same shape — was split across a
              scroll boundary where they could not be compared.

              `SectionGrid`, never a hand-written `grid-cols-2` (this skill's
              first rule, and the reason 29 grid literals exist in
              `components/masters`). Auto-placement gives exactly the order asked
              for, 1 2 / 3 4, and the container query means the same four grids
              fall back to one column inside anything narrower — a phone, or the
              nested picker this screen opens — with no prop to set. `items-start`
              is what stops the short Prints grid stretching to the height of the
              grid beside it.

              ALL FOUR CARRY `fill`, and that is the half that makes it read as a
              block rather than as four cards that happen to be near each other.
              Every column here declares a width, so each grid hugged its own
              content and the 2×2 came out with four different right edges — Yarn
              Dyeing ~520px above Roll Form Prints ~350px (client 2026-08-12,
              screenshot 2273). `fill` suppresses only the hug: the fields keep
              their declared widths and the slack falls to the right of them. */}
          <SectionGrid>
            {/* Yarn dyeing */}
            <div>
              <ChildGrid<DyeingRow>
                label="Yarn Dyeing"
                columns={dyeColumns}
                rows={dyeings.filter((d) => d.section === "yarn")}
                inlineCards
                fill
                onAdd={() => addDyeing("yarn")}
                onRemove={(r) => setDyeings((xs) => xs.filter((x) => x.key !== r.key))}
                addLabel="+ Add yarn dyeing"
              />
              <EmptyNote
                rows={dyeings.filter((d) => d.section === "yarn").length}
                label="yarn dyeing"
                seeded={seeded}
              />
            </div>
            {/* Fabric dyeing */}
            <div>
              <ChildGrid<DyeingRow>
                label="Fabric Dyeing"
                columns={dyeColumns}
                rows={dyeings.filter((d) => d.section === "fabric")}
                inlineCards
                fill
                onAdd={() => addDyeing("fabric")}
                onRemove={(r) => setDyeings((xs) => xs.filter((x) => x.key !== r.key))}
                addLabel="+ Add fabric dyeing"
              />
              <EmptyNote
                rows={dyeings.filter((d) => d.section === "fabric").length}
                label="fabric dyeing"
                seeded={seeded}
              />
            </div>
            {/* Roll-form prints */}
            <div>
              <ChildGrid<PrintRow>
                label="Roll Form Prints"
                columns={printColumns}
                rows={prints}
                inlineCards
                fill
                onAdd={addPrint}
                onRemove={(r) => setPrints((xs) => xs.filter((x) => x.key !== r.key))}
                addLabel="+ Add print"
              />
              <EmptyNote rows={prints.length} label="prints" seeded={seeded} />
            </div>
            {/* Structures */}
            <div>
              <ChildGrid<StructureRow>
                label="Structures"
                columns={structureColumns}
                rows={structures}
                inlineCards
                fill
                onAdd={addStructure}
                onRemove={(r) => setStructures((xs) => xs.filter((x) => x.key !== r.key))}
                addLabel="+ Add structure"
              />
              <EmptyNote rows={structures.length} label="structures" seeded={seeded} />
            </div>
          </SectionGrid>
        </div>
      ),
    },
    // ---------------- Combos ----------------
    {
      key: "combos",
      label: "Combos",
      content: (
        <>
          <ChildGrid<ComboRow>
            label="Combos Details"
            columns={comboColumns}
            rows={combos}
            inlineCards
            onAdd={addCombo}
            onRemove={(r) => setCombos((xs) => xs.filter((x) => x.key !== r.key))}
            addLabel="+ Add combo"
          />
          <EmptyNote rows={combos.length} label="combos" seeded={seeded} />
        </>
      ),
    },
    // ---------------- Prices ----------------
    {
      key: "prices",
      label: "Prices",
      content: (
        <>
          {/* THREE real inputs now that Style/Article/Unit are wired from the
              Style(s) tab rather than typed — LAYOUT.md §6's "<=3 -> inlineCards"
              band. It was `forceCards` while it had six, which is the point of
              choosing by input count rather than by habit: the same grid moves
              band when its content changes. */}
          <ChildGrid<PriceDetailRow>
            label="Price Details"
            columns={priceDetailColumns}
            rows={priceDetails}
            inlineCards
            onAdd={addPriceDetail}
            onRemove={(r) => setPriceDetails((xs) => xs.filter((x) => x.key !== r.key))}
            addLabel="+ Add price"
          />
          <EmptyNote rows={priceDetails.length} label="prices" seeded={seeded} />
        </>
      ),
    },
    /**
     * Pack type(s) is GATED ON THE Pack TOGGLE (client 2026-08-10): the tab is
     * where solid vs assorted sizes/colours are defined, and that question only
     * arises once the operator says this order is packed to a scheme.
     *
     * The section stays in the rail either way rather than appearing and
     * disappearing as a checkbox is ticked — a rail whose sections come and go
     * loses the operator their place. It says which switch turns it on instead.
     */
    form.pack
      ? {
          key: "packtypes",
          label: "Pack type(s)",
          content: (
            <>
              {/* ONE real input, so §6's "<=3 -> inlineCards" band — and this is
                  the extreme of it: a card per row would be a card around a
                  single dropdown. The `badge` carries the ceiling, because a
                  "+ Add" that declines silently on the fifth click reads as a
                  broken button; "3 of 4 methods" says why before it happens. */}
              <ChildGrid<PackTypeRow>
                label="Pack Type(s)"
                badge={
                  <span className="text-xs text-muted-foreground">
                    {packTypes.filter((r) => r.pack_type).length} of{" "}
                    {PACK_TYPE_OPTIONS.length} methods
                  </span>
                }
                columns={packTypeColumns}
                rows={packTypes}
                inlineCards
                onAdd={addPackType}
                onRemove={(r) => setPackTypes((xs) => xs.filter((x) => x.key !== r.key))}
                addLabel="+ Add pack type"
              />
              {/* WHAT THE FOUR MEAN, under the grid rather than in it. The names
                  are the trade's and the colour and size axes are independent,
                  which is not obvious from the wording alone — and the operator
                  is choosing on behalf of a Packing List they cannot see from
                  here. Static text, so it is not a second place the vocabulary
                  is declared: it reads PACK_TYPE_OPTIONS for the names. */}
              <p className="mt-3 text-xs text-muted-foreground">
                How finished garments are sorted into cartons — the colour and
                size axes are independent. <strong>Solid</strong> means one per
                carton, <strong>Assort</strong> means mixed:{" "}
                {PACK_TYPE_OPTIONS.join(" · ")}.
              </p>
            </>
          ),
        }
      : {
          key: "packtypes",
          label: "Pack type(s)",
          content: (
            <div className="rounded-md border border-dashed border-border bg-surface-muted/40 px-4 py-10 text-center">
              <p className="text-sm font-medium text-foreground">Pack type(s)</p>
              <p className="mt-1 text-xs text-muted-foreground">
                This order is not packed to a scheme, so there are no pack types
                to define (solid vs assorted sizes and colours).
              </p>
              {/* THE NOTE USED TO NAME A CHECKBOX ON ANOTHER SECTION and leave the
                  operator to go and find it — which read as the tab being broken
                  rather than switched off (2026-08-11). The button IS that
                  checkbox: it sets the same header field, so `Pack` in Order Info
                  ticks itself and this panel becomes the grid in place. Nothing
                  navigates, so nothing typed on this section is left behind. */}
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-4"
                onClick={() => set({ pack: true })}
              >
                Turn Pack on
              </Button>
            </div>
          ),
        },
    // ---------------- Quantities ----------------
    {
      key: "quantities",
      label: "Quantities",
      content: (
        <>
          {/*
            * CARDS. Ten columns is the widest grid on the document and it does
            * not fit — 1180px of pane once the 228px rail is taken, against
            * ~100rem of declared width.
            *
            * IT USED TO SCROLL SIDEWAYS, defended here on the grounds that "the
            * legacy grid does too". That is the one justification the operator's
            * standing rule rejects by name (2026-08-10, `raagam-screen-layout`):
            * a grid WRAPS, it never scrolls sideways, because the operator fills
            * the first cell and then drags a bar to reach the last one with the
            * first scrolled out of sight. Copying the legacy screen's scrollbar
            * copies the defect the conversion exists to remove.
            *
            * And it was not even scrolling — it was SQUEEZING. Every picker
            * rendered as "— S…", "— Se…", "— …", so the country, the consignee,
            * the warehouse and the port were mutually indistinguishable on a
            * screen whose whole job is to tell them apart.
            *
            * `Assort` — the legacy [Click] that opens a size breakdown — is
            * still deliberately absent (client 2026-08-11); the table and its
            * Zod type carry no trace of it, so adding it later is additive.
            */}
          <ChildGrid<QuantityRow>
            label="Quantities Details"
            columns={quantityColumns}
            rows={quantities}
            totalsLabel="Total PO Qty"
            forceCards
            /* Labels and cells are read OFF `columns` — never retyped beside it,
               or a new column leaves the card and the header disagreeing. And
               `required={c.required}` is not optional plumbing: with
               `renderMobileRow` supplied, ChildGrid stops wrapping cells in its
               own `RequiredScope`, so this `Field` is the only place a column's
               declaration can reach the control. */
            renderMobileRow={(row, i) => (
              <FieldGrid>
                {quantityColumns.map((c, ci) => (
                  <Field key={ci} label={c.header} required={c.required} size="sm">
                    {c.cell(row, i)}
                  </Field>
                ))}
              </FieldGrid>
            )}
            /* Who the row IS, beside its #N — the country and consignee a card
               is about, so paging through identical boxes does not mean reading
               the fields to tell them apart. */
            rowSummary={(row) =>
              [
                data.countries.find((c) => c.id === row.country_id)?.name,
                data.consignees.find((c) => c.id === row.consignee_id)?.name,
              ]
                .filter(Boolean)
                .join(" · ") || <span className="text-muted-foreground">New quantity</span>
            }
            onAdd={() => setQuantities((xs) => [...xs, blankQuantity()])}
            onRemove={(r) => setQuantities((xs) => xs.filter((x) => x.key !== r.key))}
            addLabel="+ Add quantity"
          />
          <EmptyNote rows={quantities.length} label="quantities" seeded={seeded} />
        </>
      ),
    },
    // ---------------- Approval Qty ----------------
    {
      key: "approvalqty",
      label: "Approval Qty",
      content: (
        <>
          {/* CARDS, NOT `inlineCards` — this grid outgrew that band.
              (client 2026-08-12, screenshot 2275: the row scrolled sideways and
              the headers no longer sat over their cells.)

              §6 puts "<=3 inputs" in the `inlineCards` band, and the comment that
              stood here justified it as "two real inputs (style, approval qty)".
              That was true until the colour breakdown arrived: Combo, Qty, Style
              PO Qty and Projection took it to EIGHT columns and FOUR inputs, at
              which point the premise was gone and only the prop was left.

              Two faults compounded, and both are already written down in this
              repo. §6's own rule — a grid wraps, it never scrolls sideways —
              because eight cells cannot fit the content width beside the 228px
              rail. And `Style` was the one column with no `width`, so in the
              `inlineCards` branch it was `flex-1` among seven `shrink-0`
              siblings and absorbed every spare pixel: the same failure the
              dyeing grids hit and recorded above (2246/2247), where "Colour
              carried nothing and rendered ~1080px wide".

              THE WIDTHS BELOW ARE NOW DEAD. `hugsContent` is a table/inline
              concern; the cards branch ignores every `width`. They are left in
              place deliberately — `hugsContent` is `columns.every(c => c.width)`,
              all-or-nothing, so a half-removal would change nothing while
              pretending to, and they still record the intended proportions if
              this ever goes back to a table.

              The totals band survives the move: `ChildGridColumn.total` sums
              over EVERY row rather than the visible page, so the production
              target is still right on a paginated grid. It renders as a labelled
              strip after the last card instead of a column-aligned footer, and
              the cards branch captions each figure with its own column header
              rather than reading `totalsLabel` — so "Production target" is no
              longer drawn. The prop stays for the table branch. */}
          <ChildGrid<ApprovalQtyRow>
            label="Approval Quantity"
            columns={approvalQtyColumns}
            rows={approvalQtys}
            forceCards
            seedRow
            totalsLabel="Production target"
            /* Labels and cells are read OFF `columns` — never retyped beside it,
               or a new column leaves the card and the header disagreeing. And
               `required={c.required}` is not optional plumbing: with
               `renderMobileRow` supplied, ChildGrid stops wrapping cells in its
               own `RequiredScope`, so this `Field` is the only place a column's
               declaration can reach the control.

               `key={ci}` and NOT `key={c.header}`: the Excess column's header is
               a template literal carrying the header's own percentage, so it
               changes as the operator types in Excess % — a header key would
               remount that field on every keystroke and drop the cursor. */
            renderMobileRow={(row, i) => (
              <FieldGrid>
                {approvalQtyColumns.map((c, ci) => (
                  <Field key={ci} label={c.header} required={c.required} size="sm">
                    {c.cell(row, i)}
                  </Field>
                ))}
              </FieldGrid>
            )}
            /* Who the row IS, beside its #N. Eight boxes of mostly-numbers look
               identical when paged; the style and its colour are what tell two
               approval lines apart. */
            rowSummary={(row) =>
              [row.style_ref_no, row.combo].filter(Boolean).join(" · ") || (
                <span className="text-muted-foreground">New approval line</span>
              )
            }
            onAdd={addApprovalQty}
            onRemove={(r) => setApprovalQtys((xs) => xs.filter((x) => x.key !== r.key))}
            addLabel="+ Add approval qty"
          />
          <EmptyNote rows={approvalQtys.length} label="approval quantities" seeded={seeded} />
        </>
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
            {/* FieldGrid, not a hand-written `grid-cols-1 sm:grid-cols-2
                lg:grid-cols-3`: the 12-column track and the gap are the
                primitive's, decided once, so this section lines up with the
                Order Info fields above rather than agreeing with them by
                coincidence (raagam-screen-layout: a screen composes, it does
                not draw). */}
            <CardBody>
              <FieldGrid>
              {/* Department, Agent and Received (mode) withdrawn 2026-08-10
                  (client). Their columns and stored values remain; they left the
                  Zod input too, which is what stops a save nulling them. */}
              {/* ONE SIZE, EVERY FIELD — `size="sm"` (3 of 12), four per row, so
                  these 12 fields fill three flush rows and line up with the
                  Order Info section rather than agreeing with it by coincidence.
                  The `FieldGrid` above was never the problem: a span comes ONLY
                  from `<Field size>`, so a child that is not a sized `Field`
                  takes ONE of the 12 columns. Nine of these were bare pickers and
                  hand-rolled `<div><Label/><Input/></div>` pairs and rendered
                  ~90px wide, clipping their own values ("— Sel", "dd-m…"), while
                  the three real `<Field>`s passed no `size` and fell back to the
                  retired `md` (4 of 12) and sprawled. Row 1 summed to exactly 12
                  and row 2 to 9, which is where the trailing gap came from
                  (client 2026-08-11).

                  Every picker takes `compact` so the `Field` draws the only
                  label — and `required` MOVES onto the Field with it, because
                  `data-picker.tsx` renders the red `*` inside the same
                  `!compact` branch as the label. Each picker keeps its own
                  `required` too; `DataPicker` ORs the prop with the
                  `RequiredScope` context, so the cursor hold is unchanged. */}
              {/* Contact, PO Date and Received (date) WITHDRAWN 2026-08-12
                  (client): the Logistic tab is Ship Mode / Ship Type / Pay Mode
                  / Payment Terms / Days / Currency / Country, and nothing else.
                  Department, Agent and Received (mode) went the same way on
                  08-10. Their columns and stored values are untouched; they left
                  `amendmentInput` too, which is the half that stops
                  `headerOnly()` nulling them on the next save. */}
              <Field label="Ship Type" required size="sm">
                <LookupDialogPicker
                  kind="ship_type"
                  label="Ship Type"
                  compact
                  options={shipTypeOpts}
                  value={form.ship_type_id}
                  onChange={(id) => set({ ship_type_id: id })}
                  required
                  canCreate={masterPerms.canCreate}
                  canEdit={masterPerms.canEdit}
                />
              </Field>
              {/* `<Field required>` rather than a bare Label: a `<Select>` reads
                  requiredness from context (`select.tsx` → `useRequiredHold`), so
                  the star and the cursor hold both come from this one prop. */}
              <Field label="Ship Mode" required size="sm" htmlFor="lg-shipmode">
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
              {/* `CountryPicker`'s own `required` DEFAULTS TO TRUE, so the star
                  this field has always drawn appears nowhere in the call site.
                  `compact` suppresses that label and its star together, which is
                  why the wrapper has to say `required` out loud — leaving it off
                  would quietly unmark a mandatory field (a122adc). */}
              <Field label="Country" required size="sm">
                <CountryPicker
                  compact
                  countries={data.countries}
                  value={form.country_id}
                  onChange={(id) => set({ country_id: id })}
                  canCreate={masterPerms.canCreate}
                  canEdit={masterPerms.canEdit}
                />
              </Field>
              {/* `CurrencyPicker` has no `required` prop of its own, so the
                  scope comes from the wrapper — its inner `DataPicker` ORs the
                  context (`data-picker.tsx:292`). `compact` because the Field
                  now draws the label. */}
              <Field label="Currency" required size="sm">
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
              <Field label="Ex-Rate" size="sm" htmlFor="lg-exrate">
                <Input
                  id="lg-exrate"
                  type="number"
                  value={form.ex_rate}
                  onChange={(e) => set({ ex_rate: e.target.value })}
                />
              </Field>
              <Field label="Pay Mode" required size="sm" htmlFor="lg-paymode">
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
              <Field label="Pay Terms" required size="sm">
                <PaymentTermPicker
                  label="Pay Terms"
                  compact
                  required
                  options={payTermOpts}
                  value={form.pay_terms_id}
                  onChange={(id) => set({ pay_terms_id: id })}
                  canCreate={masterPerms.canCreate}
                  canEdit={masterPerms.canEdit}
                />
              </Field>
              {/* DAYS IS THE TERM'S, NOT THE ORDER'S (client 2026-08-12).
                  `payment_terms.credit_days` (0242) already states the credit
                  period, and 0375 pointed `pay_terms_id` at that master, so the
                  number is fetched rather than stored a second time — a copy on
                  the order is a copy that can disagree with the term it names.

                  `readOnly` sets `tabIndex={-1}` itself, so this leaves the Tab
                  path and the arrows without being marked up; and a readOnly
                  field never HOLDS the cursor, which is right — the operator
                  cannot fill it, so holding them here would be a cage with no
                  key (AGENTS.md, "Mandatory fields"). */}
              <Field label="Days" size="sm" htmlFor="lg-days">
                <Input
                  id="lg-days"
                  readOnly
                  value={
                    form.pay_terms_id
                      ? String(data.paymentTermDays[form.pay_terms_id] ?? 0)
                      : ""
                  }
                />
              </Field>
              {/* CALCULATED, NOT TYPED (client 2026-08-12): Gross Value is
                  Order Qty x Rate and Avg Rate is the price per garment. Both
                  were free numeric inputs, so the document could state a value
                  its own Style(s) and Prices tabs contradicted.

                  The maths is `order-value.ts` and only `order-value.ts` — the
                  Order Sheet imports the same functions from a server
                  component, which is what stops the printed figure and this one
                  from being derived twice and disagreeing.

                  A DASH IS AN ANSWER HERE. Where a style is priced per colour
                  the rows carry no colour column to weight them by, so there is
                  no single rate; the total refuses rather than under-reporting,
                  because a partial Gross Value looks exactly like a real one. */}
              <Field label="Avg Rate" size="sm" htmlFor="lg-avgrate">
                <Input
                  id="lg-avgrate"
                  readOnly
                  className="text-right"
                  value={orderVal.avgRate == null ? "" : String(orderVal.avgRate)}
                />
              </Field>
              <Field label="Gross Value" size="sm" htmlFor="lg-gross">
                <Input
                  id="lg-gross"
                  readOnly
                  className="text-right"
                  value={
                    orderVal.grossValue == null
                      ? ""
                      : fmtMoney(orderVal.grossValue, form.currency_code || "INR")
                  }
                />
              </Field>
              </FieldGrid>
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
          {/* THE STYLE-WISE PRICE GRID WAS HERE, and is withdrawn
              (client 2026-08-12). It restated the Prices tab: both asked for a
              rate per style, from the same buyer's order sheet, and two boxes
              for one number is how they come to disagree.

              Same treatment as the charges above and for the same reason —
              `garment_order_amendment_style_prices` keeps every row it holds,
              the `style_prices` EMBED still reads them back, and the table is
              absent from `writeChildren`'s insert list so a save neither
              rewrites nor deletes them. Putting it back in that list while the
              form no longer collects prices is what would wipe them. */}
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
    /*
     * The SC No is minted, so it cannot be what marks this section done — Unit
     * and Customer are what the operator actually supplies.
     *
     * `has(styles)` JOINED IT WITH THE MERGE, because the dot means "this
     * section is answered" and the section now holds the styles too. An order
     * with a Customer and no style line is not an order, so a dot there would
     * be the confident lie the rail was given dots to avoid. It is the same
     * `sectionDone.styles` expression this replaces, not a second reading of
     * the same state.
     */
    done: !!form.location_id && !!form.customer_id && has(styles),
    content: (
      <SectionBody
        title="Order Info"
        hint="Who this order is for, and the styles it covers."
      >
        {/* ONE FieldGrid for the header fields — SectionBody has no grid of its
            own, and two stacked FieldGrids agree on the left edge but not the
            row gap. The `ChildGrid` below is not a second one: it is a card
            block that owns its whole row, which is the shape LAYOUT.md §3 puts
            in the `full` band and the shape Customer ▸ Address already uses. */}
        <FieldGrid>
          {/* AUTO, NOT PICKED (client 2026-08-11).
              This was a dropdown of orders that already existed — amendment
              behaviour on the screen an order is ENTERED on. The SC No is now
              this order's own identity: `assign_order_number()` (0395) stamps
              it on insert, and `previewOrderNumber` shows what it will be.

              `readOnly`, never `disabled` — `Input` sets `tabIndex={-1}` on a
              readOnly field itself, so it leaves the Tab path with no
              per-screen opt-out, and it stays selectable so the number can be
              copied. And NOT `required`: a readOnly field has no exit, so a
              hold on it would cage the operator. The requiredness moved to
              Unit and Date, the two fields the number is built from — the same
              shape a composed name uses (AGENTS.md, "Mandatory fields"). */}
          <Field label="SCNo" size="sm" htmlFor="hd-scno">
            <Input
              id="hd-scno"
              readOnly
              value={savedOrderNo ?? previewNo ?? ""}
              placeholder="(auto)"
            />
          </Field>
          {/* REQUIRED because the SC No cannot be built without it — 0395 counts
              per (location, fiscal year) and the trigger refuses a blank one
              rather than invent a shared bucket. READ-ONLY once saved: the
              number is stamped on insert only, so changing the Unit afterwards
              would leave an HO/… number on a different unit's order. */}
          <Field label="Unit" required={!editId} size="sm">
            <RecordPicker
              label="Unit"
              identity="code"
              compact
              disabled={!!editId && !!form.location_id}
              items={data.locations}
              value={form.location_id}
              onChange={(id) => set({ location_id: id })}
            />
          </Field>
          <Field label="Date" required size="sm" htmlFor="hd-date">
            <Input id="hd-date" type="date" value={form.amend_date} onChange={(e) => set({ amend_date: e.target.value })} />
          </Field>
          {/* "Initiated" (By Customer / By Us) WITHDRAWN 2026-08-11 (client).
              Same treatment as the 08-10 withdrawals: the JSX, the form state
              and the ZOD INPUT all go, and the COLUMN and its stored rows are
              left alone. Dropping only the JSX would leave `initiated` in the
              schema, where `headerOnly(p.data)` writes it on every update and
              would null the very values the removal preserves. */}
          {/* "Type" (Garment / Fabric / Made-ups) WITHDRAWN 2026-08-11 (client):
              "the company exclusively produces garments", so the field answers a
              question with one answer. Same treatment as "Initiated" above and
              the 08-10 withdrawals — the JSX, the form state, the payload key,
              the LIST COLUMN and the ZOD INPUT all go; the `amend_type` column
              and its stored rows are left alone. `AMEND_TYPE_OPTIONS` stays in
              types.ts as the only record of the stored vocabulary. */}
          {/* REQUIRED (client 2026-08-10). Costs the operator nothing in the normal
              flow: `onSelectOrder` fills it from the picked order, so choosing an
              SCNo satisfies this field too. It still has to be declared, because
              the Customer can be cleared by hand after the order is picked. */}
          <Field label="Customer" required size="sm">
            <RecordPicker
              label="Customer"
              compact
              items={data.customers}
              value={form.customer_id}
              onChange={(id) => set({ customer_id: id })}
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
          {/* DELI.DT SITS HERE, NOT BELOW Yr (client 2026-08-11). The dictated
              entry run is SCNo → Date → Customer → PO No → Merchandiser →
              Deli.Dt, and Season/Yr standing between Merchand. and Deli.Dt broke
              it in the middle. They stay in the header — the client was explicit
              that they belong here and not on the style rows, where they have
              never been. */}
          <Field label="Deli.Dt" size="sm" htmlFor="hd-deli">
            <Input id="hd-deli" type="date" value={form.delivery_date} onChange={(e) => set({ delivery_date: e.target.value })} />
          </Field>
          <Field label="Season" size="sm" htmlFor="hd-season">
            <Select id="hd-season" value={form.season} onChange={(e) => set({ season: e.target.value })}>
              <option value="">—</option>
              {SEASON_OPTIONS.map((o) => (
                <option key={o} value={o}>{o}</option>
              ))}
            </Select>
          </Field>
          {/**
            * THE LAST FIVE HEADER FIELDS ARE `xs`, NOT `sm` — one row, on purpose
            * (client 2026-08-12).
            *
            * Yr · Excess % · Pack · Mult. Ord · Rejection Rule belong together:
            * they are the order's terms, and the operator reads them as a set.
            * At `sm` (col-span-3) five of them need 15 of the track's 12 columns,
            * so the fifth wrapped to a row of its own. At `xs` (col-span-2) they
            * total 10 and sit on one line, with the spare 2 columns falling at
            * the end of the row rather than between the fields.
            *
            * It tightens them too, which was the other half of the request: Pack
            * and Mult. Ord are `w-fit` checkboxes, so at `sm` most of each cell
            * was trailing space. A narrower cell puts the ticks next to the
            * fields they qualify.
            *
            * The first two rows stay `sm` — four to a row is the default and the
            * dictated order fills them exactly. Only this row has five members.
            */}
          <Field label="Yr" size="xs" htmlFor="hd-year">
            <Input id="hd-year" type="number" value={form.amend_year} onChange={(e) => set({ amend_year: e.target.value })} placeholder="2026" />
          </Field>
          <Field label="Excess %" size="xs" htmlFor="hd-excess">
            <Input id="hd-excess" type="number" value={form.excess_pct} onChange={(e) => set({ excess_pct: e.target.value })} />
          </Field>
          {/* The tick's word moves up into the field label and the cell gets
              `min-h-9 items-center`, so it centres on the same 36px control
              height as the Select beside it instead of floating at the top of
              its row. Same shape as Customer ▸ Also Notify. */}
          <Field label="Pack" size="xs" htmlFor="hd-pack">
            <label className="flex min-h-9 w-fit cursor-pointer items-center gap-2">
              <input id="hd-pack" type="checkbox" className="h-4 w-4 cursor-pointer accent-primary" checked={form.pack} onChange={(e) => set({ pack: e.target.checked })} />
              <span className="text-sm text-foreground">Yes</span>
            </label>
          </Field>
          <Field label="Mult. Ord" size="xs" htmlFor="hd-multord">
            <label className="flex min-h-9 w-fit cursor-pointer items-center gap-2">
              <input id="hd-multord" type="checkbox" className="h-4 w-4 cursor-pointer accent-primary" checked={form.mult_ord} onChange={(e) => set({ mult_ord: e.target.checked })} />
              <span className="text-sm text-foreground">Yes</span>
            </label>
          </Field>
          {/**
            * REJECTION RULE — the source of Approval Qty's Projection (0413).
            *
            * On the HEADER and not on each approval line: the defect allowance
            * is a property of how this order is made, not of one colour, and
            * per-line rules would let two colours of one style disagree about
            * the same factory's wastage.
            *
            * NOT `required`. An order with no rule has no Projection, which is
            * a legitimate state and the one every row predating 0413 is in;
            * requiring it would hold the cursor on a field the operator may
            * have no answer for, on every existing order they open.
            *
            * `RecordPicker` over the whole master, unfiltered — the standing
            * "Disabled rows" rule. `blocked` is 0264's spelling of the flag and
            * `isInactive()` reads it, so a switched-off rule vanishes from the
            * list while an order that already names it still resolves and still
            * computes the same Projection.
            */}
          <Field label="Rejection Rule" size="xs">
            <RecordPicker
              label="Rejection Rule"
              /* `compact` — WITHOUT IT THE LABEL RENDERS TWICE (client 2026-08-12,
                 screenshot 2277). `DataPicker` draws `label` as its own <Label>
                 "unless `compact`" (data-picker.tsx:223), so a picker inside a
                 `<Field label>` must be compact or both print the word. Every
                 other Field+RecordPicker pair on this screen — Coordinate, Unit,
                 Composition — already passes it; this one was the outlier.
                 The prop is still needed on `label` itself: it names the panel
                 and the toasts even when it draws nothing. */
              compact
              items={data.rejectionRules}
              value={form.rejection_rule_id}
              onChange={(id) => set({ rejection_rule_id: id })}
              placeholder="— No projection —"
            />
          </Field>
        </FieldGrid>

        {/* THE STYLE(S) GRID, AND IT MUST RENDER LAST.
            `cycleTab` (lib/focus.ts) walks the pane's field-like nodes in DOM
            order and treats the last one as the SECTION EDGE — the point where
            Tab hands over to Color/Print Details through `registerContentEdge`.
            Put the grid above the fields and Tab re-enters the header after the
            styles instead of leaving the section.

            Nothing wraps it: `SectionBody` already spaces its children, and a
            `DetailSection` here would add a border the two halves never had.
            The grid draws its own "Styles Details" band, which is what keeps
            the word Style on screen now that the rail no longer says it. */}
        {stylesGrid}
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
        title={
          amending
            ? "Amend Garment Order"
            : editId
              ? "Edit Garment Order"
              : "New Garment Order"
        }
        description={
          amending
            ? "Change a saved order across the tabs. The SC No it was numbered under does not move."
            : "Fill the header, then work down the tabs. The SC No is minted on save."
        }
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

      {/* THE SUB-TABS ARE A SECTION RAIL, NOT A TOP STRIP (2026-08-09).
          `components/ui/tabs.tsx` gave ten items no arrow-key navigation, no
          roving tab stop, no `registerContentEdge` and no per-item state — a
          horizontally-scrolling row of underlined text with no way to tell which
          one held the error blocking Save. `MasterFullScreen` answers all four,
          and `mount="page"` is what lets a route use it without the overlay
          eating the sidebar.

          No `initialSection`: it falls back to sections[0], which is Order Info
          — and since the 2026-08-11 merge that is also where the Style(s) grid
          is, so the screen still opens on the two things a new order starts
          with. It briefly carried defaultKey="logistic" from building that tab,
          so the screen opened on the charge blocks and read as the wrong screen
          entirely. */}
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
          // "Unsaved changes" stays the FIRST branch in both doors: it is the
          // dirty signal, and demoting it behind a wording choice would hide
          // the one line here that is about losing work.
          status: tabsHaveRows
            ? "Unsaved changes"
            : amending
              ? "Editing amendment"
              : editId
                ? "Editing garment order"
                : "New garment order",
          onCancel: () => setMode("list"),
          onSave: () => submit(false),
          saveLabel: amending ? "Save amendment" : "Save garment order",
          canSave,
          onSaveDraft: perms.canCreate ? () => submit(true) : undefined,
          isPending,
        }}
      />
      {/*
       * THE STRUCTURE DETAILS OVERLAY (0408 · 0409).
       *
       * Mounted OUTSIDE `MasterFullScreen` rather than inside the Combos
       * section, so it layers above the whole editor the way legacy's does
       * (screenshot 2259 covers the tab strip). `zIndexBase` clears the
       * full-screen surface beneath it.
       *
       * NO FOOTER, AND NO SAVE OF ITS OWN. The tree it edits is part of the
       * amendment and is written by the amendment's Save — a second Save here
       * would imply the structures commit on their own, which they do not.
       * Closing is Escape or ✕, one layer at a time, per the keyboard contract.
       */}
      <Sheet
        open={!!detailCombo}
        onClose={() => setDetailComboKey(null)}
        title={
          detailCombo
            ? `Structure Details — ${detailCombo.combo || "(unnamed combo)"}`
            : "Structure Details"
        }
        zIndexBase={120}
      >
        {detailCombo && (
          <div className="space-y-4">
            {detailHeader(detailCombo)}
            {structureGrid(detailCombo)}
            <EmptyNote rows={detailCombo.structures.length} label="structures" seeded={seeded} />
          </div>
        )}
      </Sheet>

      {/**
       * THE ASSORTMENTS OVERLAY (0414) — what a Quantities row's [Assort]
       * button opens (operator screenshot 2026-08-12, 11:27).
       *
       * Mounted HERE, at the editor root, and NOT inside the grid cell that
       * opens it. `ChildGrid` wraps every cell in a `RequiredScope` and that
       * scope follows the RENDER tree, so a Sheet rendered from inside a cell
       * would have every optional field within it inherit "required", stamp
       * `data-required-empty` and hold the cursor — the New Yarn / Purity
       * defect (2026-08-06). `Sheet` resets the scope at its portal boundary,
       * which only helps if the Sheet is the thing being portaled.
       *
       * No footer and no Save of its own: the tree is part of the amendment and
       * is written by the amendment's Save.
       */}
      <Sheet
        open={!!assortQty}
        onClose={() => setAssortQtyKey(null)}
        title={
          assortQty
            ? `Assortments — ${assortQty.style_ref_no || "(no style)"}`
            : "Assortments"
        }
        zIndexBase={120}
      >
        {assortQty && (
          <div className="space-y-4">
            {assortHeader(assortQty)}
            <FieldGrid>
              <Field label="Pack" size="sm">
                <Input
                  uppercase
                  value={assortQty.pack}
                  onChange={(e) => setQty(assortQty.key, { pack: e.target.value })}
                />
              </Field>
              <Field label="Ratio For" size="sm">
                {/* 0328's tuple, and the column carries the same CHECK — so a
                    free-text box here would fail on save rather than on entry. */}
                <Select
                  value={assortQty.ratio_for}
                  onChange={(e) => setQty(assortQty.key, { ratio_for: e.target.value })}
                >
                  <option value="">—</option>
                  <option value="master">Master</option>
                  <option value="inner">Inner</option>
                </Select>
              </Field>
              <Field label="Master CTN Name" size="sm">
                <Input
                  uppercase
                  value={assortQty.master_carton_name}
                  onChange={(e) =>
                    setQty(assortQty.key, { master_carton_name: e.target.value })
                  }
                />
              </Field>
              <Field label="Inner CTN Name" size="sm">
                <Input
                  uppercase
                  value={assortQty.inner_carton_name}
                  onChange={(e) =>
                    setQty(assortQty.key, { inner_carton_name: e.target.value })
                  }
                />
              </Field>
              <Field label="Pack Description" size="lg">
                <Input
                  uppercase
                  value={assortQty.pack_description}
                  onChange={(e) =>
                    setQty(assortQty.key, { pack_description: e.target.value })
                  }
                />
              </Field>
            </FieldGrid>
            {/* Two booleans, in the app's inline-label shape rather than in
                `Field` boxes — a 16px tick floating in a 36px slot under a
                label is what made the component row read as ragged. */}
            <div className="flex flex-wrap gap-6">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={assortQty.is_ratio_wise_pack}
                  onChange={(e) =>
                    setQty(assortQty.key, { is_ratio_wise_pack: e.target.checked })
                  }
                  className="h-4 w-4 rounded border-border"
                />
                Ratio-wise pack
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={assortQty.is_single_style_pack}
                  onChange={(e) =>
                    setQty(assortQty.key, { is_single_style_pack: e.target.checked })
                  }
                  className="h-4 w-4 rounded border-border"
                />
                Single style pack
              </label>
            </div>
            {/* WHICH READING IS IN FORCE, said rather than inferred. The two
                give different totals from identical cells, so a checkbox that
                silently changed the answer would be the worst kind of switch —
                one whose effect is only visible if you were watching the number
                when you clicked it. */}
            <p className="text-xs text-muted-foreground">
              {assortQty.is_ratio_wise_pack
                ? "Size cells are the ratio inside ONE carton — Qty is cartons × ratio."
                : "Size cells are the pieces themselves — Qty ignores the carton count. Tick Ratio-wise pack to multiply."}
            </p>
            {assortGrid(assortQty)}
            {/* DERIVED, never stored. Ratio Total is the pieces in one carton
                of the LAST line only where legacy shows one figure; the honest
                whole-document number is the sum, which is what Total Qty is. */}
            <div className="flex flex-wrap items-baseline justify-end gap-x-6 border-t-2 border-border pt-2">
              <span className="flex items-baseline gap-1.5">
                <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  Ratio Total
                </span>
                <span className="text-sm font-semibold tabular-nums">
                  {fmtNumber(
                    assortQty.assort_lines.reduce((a, l) => a + ratioTotalOf(l), 0),
                  )}
                </span>
              </span>
              <span className="flex items-baseline gap-1.5">
                <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  Total Qty
                </span>
                <span className="text-sm font-semibold tabular-nums">
                  {fmtNumber(assortTotalOf(assortQty))}
                </span>
              </span>
            </div>
          </div>
        )}
      </Sheet>

      {/**
        * Style(s) ▸ Process (0411).
        *
        * Mounted HERE, at the editor root, and not inside the grid cell that
        * opens it. `ChildGrid` wraps every cell in a `RequiredScope`, and that
        * scope follows the RENDER tree — a sheet rendered from the cell would
        * inherit "required" and hold the cursor on its own empty fields while
        * announcing the wrong field's name (the New Yarn bug, AGENTS.md). The
        * sheet resets the scope at its portal boundary, but only if the boundary
        * is where the cell is not.
        *
        * Keyed by the row KEY, not the index or the style ref: a ref may be
        * blank while the operator is still picking, and two lines may name the
        * same style, which is a duplicate LINE rather than an error.
        */}
      <StyleProcessSheet
        open={!!processFor}
        onClose={() => setProcessFor(null)}
        styleLabel={
          styles.find((x) => x.key === processFor)?.style_ref_no || ""
        }
        header={(() => {
          /* Resolved HERE because this screen already owns both derivations —
             `styleById` for the style's own name and `orderUnitLabel` for the
             unit — and the Order Unit cell on the grid behind this sheet reads
             the very same `unitTextOf`. A second derivation inside the sheet
             would be a second answer to what one line says. */
          const r = styles.find((x) => x.key === processFor);
          return {
            styleRefNo: r?.style_ref_no ?? "",
            articleNo: r?.article_no ?? "",
            orderUnit: r ? unitTextOf(r) : "",
            styleNo: (r?.style_id ? styleById.get(r.style_id)?.name : null) ?? "",
            styleDescription: r?.style_description ?? "",
            poQty: r?.po_qty ?? "",
          };
        })()}
        rows={styles.find((x) => x.key === processFor)?.processes ?? []}
        onChange={(next) =>
          setStyles((xs) => xs.map((x) => (x.key === processFor ? { ...x, processes: next } : x)))
        }
        processes={data.processes}
        /**
         * THIS STYLE'S OWN PARTS (0421), narrowed here because this is the
         * layer that knows which style the open row names — the same split
         * `scopedComponents` makes for the Combos ▸ Detail pickers, and the
         * cascading-picker rule's "the narrowing goes at the caller".
         *
         * A style that declares no components falls back to NOTHING rather than
         * to the whole master. That is the opposite of `scopedComponents`
         * above, and deliberately: there the operator is describing a fabric's
         * use and an undeclared style should not stop them, while here the
         * answer is a panel to print on — offering a collar a style has no
         * sleeve for would be inventing the garment. The cell says which case
         * it is in rather than going quietly empty.
         */
        components={(() => {
          const st = styles.find((x) => x.key === processFor);
          const declared = st?.style_id ? styleById.get(st.style_id)?.components : undefined;
          const ids = new Set(
            (declared ?? []).map((c) => c.component_id).filter(Boolean) as string[],
          );
          return ids.size === 0
            ? []
            : data.componentRows.filter((o) => ids.has(o.id));
        })()}
        newKey={newKey}
        /* No `readOnly`: this editor has no view-only mode to pass on. `openEdit`
           is already gated on `perms.canEdit`, so a viewer never reaches the
           surface at all, and the sibling grids gate nothing either. Wiring a
           flag here that no other grid honours would read as a rule the screen
           does not actually have. */
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
  // No `styles` entry: Style(s) is no longer a section of its own. Order Info
  // declares its icon inline, as it always has.
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

// `placeholderTab()` lived here and is GONE: Pack type(s) (0399) was the last
// tab waiting on a legacy screenshot, so every section of this document is now
// wired and the helper had no callers left. It is in the history if a new tab
// ever has to wait again.

/**
 * One line naming what the order's fabrics are, above the dyeing grids.
 *
 * Renders nothing when the order has no fabric rows or none of them declares a
 * type — a hint that says "0 solid, 0 melange" is noise, and on a saved
 * amendment there is no order read to derive it from at all.
 */
function FabricTypeHint({ counts }: { counts: FabricTypeCounts | null }) {
  if (!counts) return null;
  const named = [
    counts.solid && `${counts.solid} solid`,
    counts.yarn_dyed && `${counts.yarn_dyed} yarn-dyed`,
    counts.melange && `${counts.melange} melange`,
  ].filter(Boolean) as string[];
  if (named.length === 0) return null;

  const notes: string[] = [];
  if (counts.melange) notes.push("melange takes its colour from the yarn");
  if (counts.yarn_dyed) notes.push("yarn-dyed is coloured before knitting, so it skips fabric dyeing");

  return (
    <p className="rounded-md border border-border bg-surface-muted/40 px-3 py-2 text-xs text-muted-foreground">
      <span className="font-medium text-foreground">This order: {named.join(", ")}.</span>
      {notes.length > 0 && <> {notes.join("; ")} — no dyeing row needed for {counts.melange && counts.yarn_dyed ? "those" : "that"}.</>}
    </p>
  );
}

/**
 * "Nothing here yet", for a grid that is empty.
 *
 * `ChildGrid` renders no empty state of its own — an empty `rows` array simply
 * maps to nothing — so this carries over what the hand-rolled `EmptyRow` said,
 * including the distinction that matters:
 *
 * `seeded` separates the two ways a tab is empty, and they read identically
 * without it: nothing picked yet, versus an order that genuinely records no rows
 * of this kind. A correct seed on a thin order otherwise looks like a seed that
 * failed — which is exactly how a working feature gets reported broken.
 */
function EmptyNote({ rows, label, seeded }: { rows: number; label: string; seeded?: boolean }) {
  if (rows > 0) return null;
  return (
    <p className="px-1 pt-1 text-xs text-muted-foreground">
      {seeded ? <>This order records no {label}.</> : <>No {label} yet.</>}
    </p>
  );
}
