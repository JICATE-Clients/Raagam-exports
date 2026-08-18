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
import { SubSheetFooter } from "@/components/orders/sub-sheet-footer";
import type { StyleProcessRow } from "@/lib/orders/amendments/style-processes";
import {
  excessQty,
  projectionQty,
  totalProductionQty,
} from "@/lib/orders/amendments/approval-qty";
import { orderValue } from "@/lib/orders/amendments/order-value";
import { Textarea } from "@/components/ui/textarea";
import { Toggle } from "@/components/ui/toggle";
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
} from "@/lib/orders/bom-status";
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
import { Field, FieldGrid, FIELD_TRACK } from "@/components/ui/field";
import { Truncated } from "@/components/ui/truncated";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
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
import { createLookupValue } from "@/lib/masters/lookup-quick";
import { TypeOrPick } from "./type-or-pick";
import { lookupLabel } from "@/lib/masters/extras-types";
import {
  gsmRange,
  structureProblems,
  // FABRIC_TYPE_OPTIONS is deliberately NOT imported any more — the only control
  // that offered it was the withdrawn "Type" field (see the structure card). The
  // constant stays in combo-rules.ts: `fabric_type` is still stored, still copied
  // by `order-seed.ts` and still reported by `diff.ts`, so the vocabulary is
  // still the definition of what those values mean.
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
  dyeTypeOptions,
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
  /**
   * "Type" — 'main' | 'trims_fabric'. WITHDRAWN FROM THE CARD (client
   * 2026-08-17), CARRIED NOT DROPPED: the control is gone, this field is not.
   * `writeComboTree` deletes and reinserts every child row, so dropping it from
   * the payload would NULL every stored Type on the next save. Same treatment
   * `combo_description` has, and the reasoning lives at the card.
   */
  fabric_type: string;
  /**
   * "Composition" — THE FABRIC MATERIAL THAT DECLARES IT (0430), not a row of
   * the `compositions` master this pointed at until 2026-08-17.
   *
   * The cell shows that fabric's mixing blend, so the composition is fetched
   * from the Structure rather than answered a second time — which is the whole
   * of what the client asked for (screenshot 2324). See `fabricsFor`.
   */
  fabric_item_id: string | null;
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
  /**
   * WITHDRAWN FROM THE GRID (client 2026-08-17), CARRIED NOT DROPPED.
   *
   * It was a duplicate of `combo` by construction: `order-seed.ts` COPIES the
   * combo into it on every seeded order, because "the order has one field and
   * legacy shows two, filled identically" (screenshot 2261 — Combo WHITE,
   * ComboDescription WHITE). A column that always mirrors the one beside it is
   * a column that only costs keystrokes.
   *
   * The round trip is not optional: `writeChildren` DELETES AND REINSERTS every
   * child row, so a field the form stops carrying is one the next save NULLS.
   * Same treatment as the withdrawn Type / Alternate Uom / Combination columns
   * on Material BOM and `attribute_id` before them.
   *
   * Still live everywhere else: the seeder writes it, `diff.ts` reports it as
   * "Combo Description", the Approval Qty tab has its OWN field of the same name
   * (`ApprovalQtyRow`) which is untouched, and both non-blank filters in
   * `actions.ts` still count it.
   */
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
  /** The buyer PO this destination belongs to (0427). Only asked while the
   *  header's Multi Order is on; kept and round-tripped either way. */
  po_no: string;
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
        fabric_item_id: st.fabric_item_id,
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
      po_no: txt(x.po_no),
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
  delivery_date: string;
  excess_pct: string;
  pack: boolean;
  /** MULTI STYLE. Legacy column name, "Multi Style" on screen — see 0427. */
  mult_ord: boolean;
  /** MULTI ORDER (0427) — several buyer POs, one per quantity line. */
  multi_order: boolean;
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
  delivery_date: "",
  excess_pct: "",
  pack: false,
  mult_ord: false,
  multi_order: false,
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
  /**
   * WHICH STYLE ROW IS OPEN (client 2026-08-14): finish one style, start the
   * next, and the finished one folds away.
   *
   * A style row is now two lines — five fields and a size list — so three styles
   * is a screenful before the operator reaches "+ Add style". Collapsing the
   * ones not being worked on is what keeps a multi-style PO readable.
   *
   * NULL MEANS "THE LAST ROW", resolved at render rather than seeded into state.
   * Seeding would go stale the moment a row is added, removed or loaded from a
   * saved order, and every one of those paths would have to remember to update
   * it.
   *
   * A COLLAPSED ROW KEEPS ITS STYLE FIELD, and that is a keyboard requirement
   * rather than a design flourish. Tab lands on FIELDS — `data-focus-optional`
   * takes controls OFF that path and nothing puts one on — so a row rendering no
   * field at all would be reachable by mouse only, on a screen whose whole
   * premise is that it is not. One field keeps the row on the Tab path, and
   * focusing it opens the row.
   *
   * UP HERE WITH THE OTHER STATE, NOT DOWN BESIDE `addStyle` WHERE IT READS
   * BETTER. This component returns early — `if (mode === "list")` — so a hook
   * declared after that line runs in edit mode and not in list mode, and this
   * screen crosses that boundary on EVERY load: `mode` starts "list" and
   * `useCreateIntent` opens the form on mount. Declared below the branch it
   * was React's 46th hook in one render and its 45th-and-nothing in the next,
   * which is "Rendered more hooks than during the previous render" — a blank
   * screen on /orders/garment-orders, not a subtle bug. The file already says
   * this three times over derived values that had to stay plain
   * (`orderStructureIds` and the two beside it); this is the same rule from the
   * other side, and the reason those are not memos is the reason this is here.
   */
  const [openStyleKey, setOpenStyleKey] = useState<string | null>(null);
  /** The same fold, on the Quantities grid — see `openStyleKey` for the whole
   *  reasoning, which is identical down to why a folded row keeps one field. */
  const [openQtyKey, setOpenQtyKey] = useState<string | null>(null);
  /**
   * WHICH STYLE'S PRICES ARE OPEN, keyed by `styleKey` rather than by row key —
   * the Prices tab groups its rows by style, so the thing that folds is a GROUP
   * and a row key would not name one.
   *
   * Everything above about `openStyleKey` holds here too: null means the last
   * group, resolved at render; a completed group folds so the next style can be
   * priced; the group keeps its Style field while folded so Tab has somewhere to
   * land. And it lives up here for the same hard reason — a hook below the
   * `if (mode === "list")` return crashes this screen on every load.
   */
  const [openPriceKey, setOpenPriceKey] = useState<string | null>(null);
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
    po_no: "",
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
   * The colour palette, as the type-or-pick cell wants it.
   *
   * THE DISABLED-ROWS RULE IS THIS FUNCTION'S WHOLE JOB, and it is done by hand
   * here for the reason AGENTS.md gives for `<Combobox>` and `<Select>`: those
   * primitives have no inactive state of their own, so "filter at the call site,
   * keeping the row the record already holds" is the caller's to do.
   * `LookupDialogPicker` used to do it inside `DataPicker`.
   */
  const colourPickOptions = (held: string | null) =>
    colorOpts
      .filter((o) => !isInactive(o) || o.id === held)
      .map((o) => ({ id: o.id, name: o.name }));

  /**
   * Add what is being typed to the colour master — the ⊕ half of the icon-field
   * convention, kept alive on a field that also accepts free text.
   *
   * `createLookupValue` is the SAME action `LookupDialogPicker` calls, so a
   * colour added here is parsed by the same Zod schema, guarded by the same
   * duplicate check and immediately available at every other `fabric_color`
   * field. `router.refresh()` is what brings it back into `lookups`; the cell
   * does not wait for that, because the name it just created is already its
   * value.
   */
  const createColour = async (name: string): Promise<string | null> => {
    const res = await createLookupValue("fabric_color", name, null);
    if (!res.ok) {
      toastError(res.error);
      return null;
    }
    success(`Colour "${name}" added`);
    router.refresh();
    return res.id;
  };
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
  /**
   * THE FABRICS UNDER A STRUCTURE — the Composition cell's options (0430).
   *
   * The picker's rows ARE the compositions: `getFabricRows` labels each fabric
   * with its `material_mixings` blend, so 1X1 LYCRA RIB offers
   * "95% 30'S COTTON COMBED / 5% 20'S ELASTANE" rather than a material code
   * nobody reads. That is the same lesson the Structure picker beside it
   * records — a picker over a master-detail table must label its rows from the
   * DETAIL.
   *
   * SCOPED TO THE PICKED STRUCTURE, at the caller: the cascading-picker rule
   * puts the narrowing where the parent is known, and the parent here is the
   * row's own cell. Unscoped, a Single Jersey composition would be offered on a
   * rib.
   *
   * WITH NO STRUCTURE PICKED IT OFFERS NOTHING — deliberately, and it is the
   * one branch worth stating: the field cannot be answered before its parent is,
   * and the alternative ("offer every fabric until a structure narrows it") is
   * the blank-supply-type bug the nominated-vendor rule was written for.
   *
   * EMPTY AND EXPLAIN, never empty and silent — `fabricPlaceholder` says which
   * of the two reasons it is, in the closed box, the way `NominatedVendorPicker`
   * says "Pick Supply Type first". A list that is empty for an unstated reason
   * reads as a broken field, which is precisely how this one was reported.
   *
   * A HELD VALUE ALWAYS SURVIVES the filter — "Disabled rows", and the same
   * `currentValue` shape every other picker on this screen uses. Narrowing the
   * structure around a fabric already chosen must not blank it on the next save.
   */
  const fabricsFor = (structureId: string | null, current: string | null) => {
    const rows = data.fabrics.filter(
      (f) => (structureId && f.category_id === structureId) || (current != null && f.id === current),
    );
    return rows.map((f) => ({ ...f, inactive: isInactive(f) }));
  };

  /**
   * WHY the Composition list is empty, in the words of the thing to do about it.
   *
   * Three states and they are not the same problem: no Structure yet (answer the
   * cell to the left), a Structure whose category holds no fabric (the Material
   * master has nothing to offer — a real gap, and naming it is how anyone finds
   * out), or a normal list, where the default "— Select composition —" is right.
   */
  const fabricPlaceholder = (structureId: string | null, count: number) => {
    if (!structureId) return "— Pick a Structure first —";
    if (count === 0) return "— No fabric under this structure —";
    return undefined;
  };

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
    // AND THE FULL LIST WHEN THE ORDER DECLARES NONE (2026-08-14). The grid that
    // fed this came off the Color/Print tab, so "declared" is now only ever what
    // a previously saved order carries — and the paragraph above turned an
    // inline create down precisely BECAUSE the declaration belonged on that tab.
    // With no tab to send the operator to, an empty list stops being a prompt
    // and becomes a dead end on a Printed component. Same three clauses as
    // `scopedStructures`: a held value always survives, nothing declared falls
    // back to the whole list, a declared set narrows to it.
    if (ids.size === 0) return printOpts;
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
        customer_id: s.customer_id,
      })),
    [data.styles],
  );

  /**
   * The Style options for ONE row (client: "Once a customer and season are
   * selected, the Style field should only list relevant styles").
   *
   * CUSTOMER-FIRST, AND BOTH FACETS ARE LIVE (client 2026-08-14). The order of
   * entry is Customer → Approved Sample No → Style, and the narrowing is what
   * makes that order mean something rather than just being advice.
   *
   * The customer half was unbuildable until 0404: styles key on `customers` and
   * this order keyed on `buyers`, with an empty bridge between them, so the
   * filter would either empty the picker on every order or narrow nothing while
   * looking like it works. 0404 repointed this order's party at `customers`, and
   * the comment that used to sit here said "adding `customer: form.customer_id`
   * below is the whole edit". It was — plus carrying the column into
   * `styleFilterRows` above, which is the half that would have failed silently:
   * a filter reading `undefined` on every row narrows nothing and looks correct.
   *
   * WHY IT IS SAFE TO SWITCH ON. The two worries were that it is a visible change
   * to what the picker offers, and that with a thin master it can legitimately
   * empty the list. Both are answered by `style-options.ts` rather than by
   * hedging here: an unassigned style stays on offer, and an empty list explains
   * WHICH facet emptied it and where to go.
   *
   * Per ROW, not per grid, for one reason only: `currentValue`. The style a line
   * already holds must survive a filter that would now exclude it — the header's
   * Customer or Season edited after the line was saved — or the field renders
   * empty and the next save blanks the FK. The narrowing itself is identical on
   * every row.
   */
  const styleOptionsFor = (currentValue: string | null) =>
    styleOptions({
      styles: styleFilterRows,
      customer: form.customer_id,
      season: form.season,
      currentValue,
    });

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
    // The Yr prefill lived here (current year, editable — client 2026-08-11)
    // until the field was withdrawn on 2026-08-14; see the header comment on the
    // row it left. Nothing replaces it: the year comes from the linked style.
    setForm({
      ...BLANK,
      amend_date: today(),
      location_id: startingLocationId,
    });
    setStyles([]);
    // The pointer at the open style row is cleared with the rows it points at.
    // It holds a ROW KEY, and keys are minted per row, so one carried over from
    // the last document matches nothing here — and "matches nothing" folds every
    // style rather than opening one. Same lesson as the missing `setQuantities`
    // above: clearing the grids and leaving what indexes them is half a reset.
    setOpenStyleKey(null);
    // `openPriceKey` is a styleKey, not a row key, so it survives differently
    // and is cleared for a different reason: the next document's first style may
    // legitimately BE the last one's, and a pointer at it would open a group the
    // operator has not reached yet.
    setOpenPriceKey(null);
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
      delivery_date: r.delivery_date ?? "",
      excess_pct: r.excess_pct ? String(r.excess_pct) : "",
      pack: r.pack,
      mult_ord: r.mult_ord,
      multi_order: r.multi_order,
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
    // Same reset as `openAdd`, for the same reason: the incoming document's
    // style rows carry new keys, so a pointer held from the last one opens no
    // row at all. Null resolves to the LAST style, which is where a loaded order
    // is meant to open.
    setOpenStyleKey(null);
    setOpenPriceKey(null);
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
      delivery_date: form.delivery_date || null,
      excess_pct: numOrNull(form.excess_pct) ?? 0,
      rejection_rule_id: form.rejection_rule_id,
      pack: form.pack,
      mult_ord: form.mult_ord,
      multi_order: form.multi_order,
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
          fabric_item_id: st.fabric_item_id,
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
        /* SENT WHATEVER Multi Order SAYS, for the same reason `pack_types` is
           sent whatever the Pack toggle says: turning the switch off HIDES the
           column, and hiding is not emptying. An order entered with three PO
           numbers, un-ticked by accident and saved would otherwise lose all
           three with nothing on screen to show what went. */
        po_no: r.po_no || null,
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
  /** Opens the new row and folds the finished one — `openStyleKey` is declared
      with the other state, above the list-mode return. */
  const addStyle = () => {
    const row = blankStyle();
    /* MULT. ORD FOLLOWS THE GRID (client 2026-08-17) — see the note on the
       Styles Details grid for why the cap was lifted.

       Adding a second line IS the statement the toggle records, so it is set
       from here rather than left for the operator to find in the header.

       OUTSIDE the `setStyles` updater, deliberately: an updater must be pure —
       React invokes it twice under StrictMode — so a `set()` in there is a side
       effect that can fire twice. `styles` is this render's array and this runs
       from an event handler, so its length is current.

       ONE-WAY ON PURPOSE. It is never cleared here: un-ticking Mult. Ord has
       always been non-destructive (it never dropped rows), and clearing the flag
       when a line is REMOVED would fight an operator who ticked it deliberately
       while still entering the second style. */
    if (styles.length >= 1 && !form.mult_ord) set({ mult_ord: true });
    setStyles((xs) => [...xs, row]);
    // The new row is the one being worked on, so it opens and the finished one
    // folds — which is the whole of what the client asked for.
    setOpenStyleKey(row.key);
  };
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

    /*
     * THE COMBOS TAB TAKES THE STYLE FROM HERE (client 2026-08-17: the Combos
     * section "need to fetch automatically that style from previous section").
     *
     * A combo is a colourway OF a style, and on a one-style PO there is exactly
     * one answer it could have — so asking for it again is asking the operator
     * to re-key something the order already states. Same argument, and the same
     * client sentence, as the fabrics seeding directly above: "if it is already
     * defined, it should flow in automatically to avoid duplicate data entry".
     *
     * ON THE PICK, NOT IN AN EFFECT — the rule the structures block above states
     * in full, and it applies here for the same reason: an effect watching
     * `styles` would refill a combo the operator had deliberately re-pointed the
     * moment anything re-rendered, and the grid would argue back.
     *
     * ONLY WHILE THE ORDER HAS ONE STYLE LINE. With two, which style a combo
     * belongs to is a real question with no derivable answer, and guessing it
     * from whichever line was picked last would put line 2's style onto combos
     * that describe line 1. The picker stays for that case, which is what it is
     * for. `styles` is this render's array and `pickStyle` runs from an event
     * handler, so its length is current.
     *
     * BLANK ROWS ONLY. A combo already naming a style is an answer, not a gap —
     * overwriting it is the "silent data loss dressed up as tidiness" the
     * disabled-rows rule names, and on a LOADED order it would also mark a
     * record dirty that the operator has not touched.
     */
    if (s && styles.length === 1) {
      const ref = s.code ?? "";
      if (ref) {
        setCombos((xs) =>
          xs.map((x) =>
            x.style_ref_no.trim()
              ? x
              : { ...x, style_ref_no: ref, style: s.name ?? "", article_no: s.article_no ?? "" },
          ),
        );
      }
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
  /* UNUSED SINCE 2026-08-14, AND KEPT ON PURPOSE — with `printColumns` and
     `structureColumns` below, these are the whole of what a restore needs, and
     the state they add to is still loaded, seeded and written. `eslint` says so
     as a warning; that is the cost of keeping the pair together rather than
     unpicking `structureColumns` → `scopedOrderStructures` →
     `styleStructuresDeclared` → `orderStructureIds`, a chain three other
     comments use as a landmark for where hooks stop being legal in this file. */
  const addPrint = () => setPrints((xs) => [...xs, blankPrint()]);
  const addStructure = () => setStructures((xs) => [...xs, blankStructure()]);
  /**
   * A NEW COMBO ROW ARRIVES CARRYING THE STYLE, on the same one-style condition
   * `pickStyle` seeds under — otherwise adding the second colourway of a
   * one-style PO would ask for a style the order has already stated, which is
   * the thing the client asked to stop doing.
   *
   * Read off the style LINE rather than the master: `style_ref_no` is the key
   * Prices, Quantities and Approval Qty all resolve on, and the line is where it
   * is authoritative (`pickStyle` fills it there). Seeding from `styleById`
   * instead would reconstruct the same string one hop further from its source.
   */
  const addCombo = () =>
    setCombos((xs) => {
      const only = styles.length === 1 ? styles[0] : null;
      const ref = only?.style_ref_no.trim();
      if (!only || !ref) return [...xs, blankCombo()];
      const name = only.style_id ? (styleById.get(only.style_id)?.name ?? "") : "";
      return [
        ...xs,
        { ...blankCombo(), style_ref_no: ref, style: name, article_no: only.article_no ?? "" },
      ];
    });

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
  /**
   * Picking a Structure FILLS THE ROW AROUND IT — Fabric Type from what the
   * order declared, and Composition from the fabric itself (client 2026-08-17,
   * screenshot 2324: "this section need to fetch from previous tab
   * automatically, now its not doing it").
   *
   * ONLY WHEN THE ANSWER IS UNAMBIGUOUS. A category holding one fabric has one
   * possible composition, so filling it in saves a keystroke and can be no more
   * wrong than the Structure above it; SINGLE JERSEY holds eight, and choosing
   * one of eight is a guess wearing the clothes of a fetch. There the cell is
   * left blank with its list already narrowed to those eight — the operator
   * answers a short question instead of an open one.
   *
   * SEEDS, NEVER OVERWRITES, exactly as `item_sub_type` beside it has since
   * 0415: `st.fabric_item_id ||` keeps an answer the operator has already given.
   * Re-picking the SAME structure therefore changes nothing, and re-picking a
   * DIFFERENT one leaves the old fabric standing — which is why the fabric is
   * cleared first when it belongs to the structure being replaced. Without that
   * clause the row would name a rib's composition under a jersey, and the cell
   * would look filled and correct.
   *
   * ON THE CHANGE, NEVER IN AN EFFECT — the Style master's Type column records
   * why (0405): an effect keyed on the structure also fires when a SAVED order
   * is opened, and would overwrite every stored composition on load.
   */
  const pickComboStructure = (comboKey: string, structKey: string, id: string | null) => {
    const declared = id ? structures.find((s) => s.structure_id === id)?.item_sub_type : null;
    mutStructs(comboKey, (sts) =>
      sts.map((st) => {
        if (st.key !== structKey) return st;
        // A fabric belonging to the structure being replaced is stale, not held.
        const held =
          st.fabric_item_id &&
          data.fabrics.find((f) => f.id === st.fabric_item_id)?.category_id === st.structure_id &&
          st.structure_id !== id
            ? null
            : st.fabric_item_id;
        const only = id ? data.fabrics.filter((f) => f.category_id === id) : [];
        return {
          ...st,
          structure_id: id,
          item_sub_type: st.item_sub_type || declared || "",
          fabric_item_id: held || (only.length === 1 ? only[0].id : null),
        };
      }),
    );
  };
  const blankStruct = (): ComboStructRow => ({
    key: newKey(),
    structure_id: null,
    fabric_type: "",
    fabric_item_id: null,
    gsm: "",
    gsm_tolerance: "",
    item_sub_type: "",
    components: [],
  });

  /**
   * Does this structure row say anything at all?
   *
   * The screen-side twin of `structureFilled` in `actions.ts`, which is what
   * decides whether the row is worth STORING — the two must agree, or the overlay
   * would re-seed rows the server had just saved. `rowFilled` above cannot answer
   * it: `components` is an array, and an empty one is neither `""` nor null, so
   * every blank structure reads as filled through that one.
   */
  const structSaysSomething = (st: ComboStructRow) =>
    !!(
      st.structure_id ||
      st.fabric_type ||
      st.fabric_item_id ||
      st.gsm.trim() ||
      st.gsm_tolerance.trim() ||
      st.item_sub_type ||
      st.components.some(
        (c) => c.coordinate_id || c.component_id || c.color_name.trim() || c.print_id,
      )
    );

  /**
   * OPENING THE DETAIL FILLS IT FROM THE STYLE (client 2026-08-17, screenshot
   * 2328: the overlay opened blank and "we will give the structure and coordinate
   * already in style and order info, based on fetch it automatically").
   *
   * The style already declares every part of the garment —
   * `garment_style_components` rows of {coordinate, component, fabric category} —
   * and this screen has read them since 2026-08-12 to NARROW these very pickers
   * (`scopedStructures`, `scopedCoordinates`, `scopedComponents`). It knew the
   * answer and made the operator retype it: a combo of a 4-part style meant
   * "+ Add structure", then "+ Add component" four times, then picking from lists
   * that already contained exactly those four. Nothing is fetched here that was
   * not already in memory.
   *
   * THE GROUPING — one structure per DISTINCT `fabric_category_id`, holding the
   * parts that name it — IS NEW LOGIC, and worth saying so plainly rather than
   * implying the screen already did it somewhere.
   *
   * What justifies it is the SCHEMA, not a function above: 0409 repoints this
   * screen's `structure_id` at `categories` and its column comment states the
   * correspondence outright — "Matches `garment_style_components.fabric_category_id`
   * (0405)". Same id space, asserted by the migration that made it so.
   *
   * What does NOT justify it, and is the easy misreading: `scopedStructures`
   * collects the same distinct categories, but only to narrow the Structure
   * picker's OPTIONS — it never groups parts. And `scopedComponents` pairs a
   * component to its COORDINATE, not to a structure; it is handed the combo row
   * and never the structure row, even though `componentGrid(r, st)` has `st` in
   * scope. So do not go looking for this rule in either of them.
   *
   * A part with no category is DROPPED from the seed rather than parked under
   * some default — `pickStyle` gives the same treatment (`.filter(Boolean)`), and
   * a component has nowhere to live except under a structure. A style whose parts
   * ALL lack a category therefore seeds nothing, which is the degrade below.
   *
   * ON THE CLICK, NEVER IN AN EFFECT. `pickComboStructure` states the reason
   * directly below: "an effect keyed on the structure also fires when a SAVED
   * order is opened, and would overwrite every stored composition on load." An
   * effect keyed on `detailComboKey` has exactly that failure — every reopen of a
   * saved amendment would restate the style over the operator's own rows. The
   * [Detail] button is the one action that means "show me this combo's parts",
   * so the seed belongs on it, the same way `pickStyle` seeds on the pick.
   *
   * ONCE, AND ONLY INTO A BLANK DETAIL. The moment this combo's Structure
   * Details says ANYTHING, the seed stands down completely — it does not top up,
   * merge or fill the gaps.
   *
   * That is deliberately stricter than "add the categories that have no row yet",
   * which is what this was written as first and which is wrong for a reason
   * `pickStyle` already records: "an effect watching the declared set would re-add
   * a structure the operator deliberately removed the moment anything else
   * re-rendered it — the grid would argue back." [Detail] is not a rare act like
   * picking a style; it is opened to LOOK. A top-up rule would resurrect a
   * deleted structure on every look, and worse, mark a saved order dirty for it.
   *
   * So the rule is the smallest one that answers the complaint as reported — the
   * overlay "opens as blank" — and it cannot argue back, because after the first
   * open there is always something to stand down for. Gsm, Tolerance,
   * Composition and colours are safe by construction rather than by a guard: a
   * detail holding any of them is never seeded into again.
   *
   * IT DEGRADES TO TODAY'S BEHAVIOUR AND SAYS NOTHING. A combo whose style does
   * not resolve (`buyers.customer_id` unlinked, a free-typed ref), a style that
   * declares no parts, or a part with no fabric category seeds nothing and leaves
   * the blank row and the "+ Add structure" button standing. Empty-and-explain is
   * for a field that REFUSES to offer something; this one simply has nothing to
   * offer, and `styleDeclaresParts` already drives the hint that says so.
   *
   * GSM, TOLERANCE AND COLOUR ARE NEVER SEEDED, and that is the data's answer
   * rather than a preference: `garment_style_components` has no such columns.
   * They stay the operator's (client 2026-08-17, same message).
   */
  const seedComboFromStyle = (comboKey: string) => {
    setCombos((xs) =>
      xs.map((r) => {
        if (r.key !== comboKey) return r;
        // Anything answered here at all — including by a previous open, or by a
        // SAVED order loading its stored rows — and the seed is done.
        if (r.structures.some(structSaysSomething)) return r;
        const parts = styleOfCombo(r)?.components ?? [];
        if (!parts.length) return r;

        // One bucket per fabric category, in the order the style declares them —
        // `garment_style_components.sno` is the style's own ordering and the
        // embed selects it, so the parts arrive already sorted.
        const byCategory = new Map<string, typeof parts>();
        for (const p of parts) {
          if (!p.fabric_category_id) continue;
          const bucket = byCategory.get(p.fabric_category_id);
          if (bucket) bucket.push(p);
          else byCategory.set(p.fabric_category_id, [p]);
        }
        if (!byCategory.size) return r;

        const partsOf = (categoryId: string): ComboCompRow[] =>
          (byCategory.get(categoryId) ?? []).map((p) => ({
            key: newKey(),
            coordinate_id: p.coordinate_id ?? null,
            component_id: p.component_id ?? null,
            color_name: "",
            print_id: null,
            processed_as_trim: false,
          }));

        // REPLACES the blank rows rather than appending below them. Everything
        // standing here is blank by the guard above, so there is nothing to keep
        // — and `pickStyle`'s block makes the same move for the same reason: a
        // seeded list under an empty first row is a row the operator has to
        // delete before the form reads as filled in.
        return {
          ...r,
          structures: [...byCategory.keys()].map((id) => ({
            ...blankStruct(),
            structure_id: id,
            components: partsOf(id),
          })),
        };
      }),
    );
  };
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
  /**
   * A NEW STYLE TO PRICE — and it becomes the open group, so the one before it
   * folds (client 2026-08-14: "if user choose another add price button it should
   * fold, how we folding the style in first tab"). Same two lines as `addStyle`,
   * same rule.
   *
   * KEYED BY THE ROW, because a group with no style yet has no `styleKey` to be
   * keyed by — which is why `priceStyleCell` has to move this pointer across
   * when the style is picked and the group's identity changes under it.
   */
  const addPriceDetail = () => {
    const row = blankPriceDetail();
    setPriceDetails((xs) => [...xs, row]);
    setOpenPriceKey(row.key);
  };
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
    // READS ONLY WHAT THE TAB SHOWS. Prints and Structures came off this tab on
    // 2026-08-14 and their state stayed (see the tab body), so keeping them in
    // this expression would light the dot for rows `pickStyle` seeded — a tab
    // reporting "has data" over two visibly empty dyeing grids, which is the
    // confident lie the note above is about.
    colors: has(dyeings),
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
       this text: Price Details (`styleLineKeyOf`), Quantities (matched by TEXT
       since its Ref No became free entry on 2026-08-17) and Approval Qty
       (`poQtyOf`). Delete the value along with the column and
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
        /* THE DERIVED SUB-LINE IS WITHDRAWN (client 2026-08-14). It printed
           `article_no · style_category` under the picker — "23 · TEST" — and
           the client asked for it gone. Reverses the 2026-08-12 note that said
           it stays; that reasoning (Article No and Category are what the picked
           style IS, so they are not columns) still holds and is exactly why
           nothing replaces it with a column.

           THE DATA IS UNTOUCHED, and on this screen that is not automatic.
           `article_no` and `style_category` stay in `StyleRow`, in `toRows` and
           in the save payload: `writeChildren` deletes and reinserts every child
           grid wholesale, so a field dropped from the payload is NULLED on the
           next save rather than merely hidden. Same treatment `trims` and the
           withdrawn Fabric column already have. */
        return (
          <RecordPicker
            label="Style"
            compact
            items={opts.items}
            value={r.style_id}
            onChange={(id) => pickStyle(r.key, id)}
            placeholder={opts.shortHint ?? undefined}
          />
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
    /* THE `Process` COLUMN WITHDRAWN (client 2026-08-17) — see the note where
       its sheet was mounted, at the foot of this file, for what stayed behind
       and why the row data must keep round-tripping.

       THE ROW IS FOUR FIELDS NOW, not five: Style · Order Unit · PO Qty ·
       Description, all `xs` (2 of 12), with Sizes still `full` on its own line
       below. The arithmetic the layout note records is unchanged in the only
       way that matters — the cells occupy 8 of the 12 columns instead of 10, so
       Sizes still cannot share their line and still wraps beneath them. */
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
      /**
       * A FIXED LIST PER SECTION (client 2026-08-17) — Y/D or Melange on a yarn
       * dyeing, Dyed or Melange on a fabric one. It was a free `<Input>`, which
       * is why an operator had to know the trade's abbreviations to enter one.
       *
       * The list comes off the ROW, not the column, because both grids share
       * this one `columns` array and only the row knows which section it is in.
       * `dyeTypeOptions` also re-admits a value already stored that is in
       * neither list — the free-text era's legacy — see its note in types.ts.
       *
       * The blank first option stays: a dyeing row is identified by its COLOUR
       * (that is what `normalizeDyeings` filters on, and what the diff keys on),
       * so a row with a colour and no type is a legitimate half-entered state
       * rather than something to refuse.
       */
      cell: (r) => (
        <Select
          value={r.dye_type}
          onChange={(e) =>
            setDyeings((xs) => xs.map((x) => (x.key === r.key ? { ...x, dye_type: e.target.value } : x)))
          }
        >
          <option value=""></option>
          {dyeTypeOptions(r.section, r.dye_type).map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </Select>
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
      /**
       * TYPE **OR** PICK SINCE 2026-08-17 (client: "allow users to manually
       * type/input color names or numbers, e.g. 0001, rather than forcing a
       * selection strictly from the master list").
       *
       * THIS IS NOT A THIRD FLIP. 0403 made the cell free text, 0415 made it a
       * master row, and reverting to a plain `<Input>` here would be the third —
       * with the consistency 0415 bought ("Navy Blue" vs "Dark Blue") thrown
       * away. So BOTH halves stand: the palette is still offered and still
       * writes `color_id`, and a value that is not in it is now accepted as
       * typed, with `color_id` null. A buyer's "0001" is not a shade the
       * company names; it is a reference on their order sheet.
       *
       * `color_name` IS AND ALWAYS WAS THE VALUE — `declaredColourOptions` and
       * `combo_components.color_name` both read text — so a typed colour reaches
       * the Combos tab exactly as a picked one does. That is what makes the
       * hybrid cheap: nothing downstream has to learn about the id being null.
       *
       * THE ⊕ SURVIVES as the list's last row: typing a name no row carries
       * offers to add it to the master. Without it the master would stop growing
       * the day free text arrived, which is the failure 0415 exists to prevent —
       * the operator gets both answers and picks the one that is true ("this is
       * a colour we use" vs "this is their code for this order").
       *
       * THE PENCIL (edit a colour app-wide) DOES NOT SURVIVE, and that is the
       * one thing this cell loses against `LookupDialogPicker`. Renaming a
       * shared code list from inside an order was always the more destructive
       * half of that convention; the Lookup master still owns it.
       *
       * THE WIDTH IS NOT OPTIONAL: `hugsContent` is `columns.every((c) => c.width)`,
       * so dropping it here would stretch both grids on this tab.
       */
      cell: (r) => (
        <TypeOrPick
          label="Colour"
          createNoun="colour"
          options={colourPickOptions(r.color_id)}
          valueId={r.color_id}
          text={r.color_name}
          inputClassName="h-8"
          onChange={({ id, name }) =>
            setDyeings((xs) =>
              xs.map((x) => (x.key === r.key ? { ...x, color_id: id, color_name: name } : x)),
            )
          }
          onCreate={masterPerms.canCreate ? createColour : undefined}
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
          <option value=""></option>
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
   * ONE WIDTH FOR THE VALUE COLUMNS — Style and Combo, since Combo Description
   * was withdrawn on 2026-08-17 (see the note on `ComboRow`).
   *
   * The three were 16 / 12 / 14rem — three boxes of three sizes holding three
   * ordinary text values, which is what "imbalanced" named (client 2026-08-12,
   * screenshot 2264). The widths were never carrying meaning here: none is a
   * number, a code of fixed length, or a field the operator reads at a glance
   * across rows, so a ragged row was cost with nothing bought. Detail stays
   * narrower because it is a button, not a value.
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
          onClick={() => {
            // Seed BEFORE opening, so the overlay's first paint already shows the
            // style's parts — opening first would render the empty state for a
            // frame and then swap it, which reads as a glitch rather than as a
            // form that arrived filled in. See `seedComboFromStyle`.
            seedComboFromStyle(r.key);
            setDetailComboKey(r.key);
          }}
        >
          {/* No count — see the Process button. Same button-hides-a-list shape,
              same client removal. */}
          Detail
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
    /**
     * A GROUP WITH NO STYLE ENUMERATES NOTHING (client 2026-08-17: "price types
     * must update automatically based on the style").
     *
     * It used to seed from the wrong source, silently, and both halves were
     * wrong in a different direction: `comboOptionsForStyle("")` short-circuits
     * its filter on a blank key and returns EVERY combo on the order, while
     * `sizeOptionsForStyle("")` matches the first style line whose ref is also
     * blank — the line the operator has not picked yet — and returns ITS sizes.
     * So choosing Color-wise before choosing the style opened a grid of another
     * style's colourways, each row `required` and therefore holding the cursor
     * and blocking Save.
     *
     * Setting the mode and seeding nothing is the honest answer: `pickPriceStyle`
     * re-applies the mode the moment a style IS named, so nothing is lost by
     * waiting and the rows that appear are the right style's.
     */
    const known = !!styleKey(row.style_ref_no);
    const combosFor = known ? comboOptionsForStyle(row.style_ref_no) : [];
    const sizesFor = known ? sizeOptionsForStyle(row.style_ref_no).map((z) => z.id) : [];

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

  /*
   * `priceRowStale(row)` STOOD HERE and is gone with the grid that needed it
   * (2026-08-14). It answered "is this row left over from a mode its style no
   * longer uses?" one row at a time, because the flat grid could only ask one
   * row at a time — its whole job was to tell two visually identical rows apart.
   *
   * The question it answered has not gone anywhere: it is "keep rows, never
   * delete them" (operator decision 2026-08-12), and a leftover rate is still
   * what makes `styleRate` refuse and the Logistic tab's Avg Rate go blank. It
   * is now asked ONCE PER STYLE, in `rateGrid`, by the same majority rule this
   * used — `groupMode` below — and the leftovers are listed together under one
   * amber line instead of a repeated note down the grid. One rule, one reader.
   */

  /**
   * THE MODE OF A STYLE, from its rows — the majority one, exactly as
   * `priceRowStale` above has always computed it.
   *
   * ONE FUNCTION, TWO READERS, and that is the point of extracting it. The
   * Prices tab now asks for the mode in ONE place per style rather than on every
   * rate row, so the select needs the same answer the stale flag gives — and a
   * second majority rule beside the first would let a group show "Size-wise"
   * while flagging its size rows as the stale ones.
   */
  function groupMode(rows: PriceDetailRow[]) {
    const modes = new Map<string, number>();
    for (const r of rows) {
      if (!r.price_type) continue;
      modes.set(r.price_type, (modes.get(r.price_type) ?? 0) + 1);
    }
    if (!modes.size) return "";
    return [...modes.entries()].sort((a, b) => b[1] - a[1])[0][0];
  }

  /**
   * THE RATES OF ONE STYLE, which is what the tab lists (client 2026-08-14:
   * "already we choosed the style, why need show for all size — just like the
   * legacy... just show the size and price").
   *
   * The stored shape is unchanged — one `price_details` row per (style, colour,
   * size), which is what `styleRate` and the Logistic tab's Avg Rate read. This
   * groups them for DISPLAY only, and it groups by `styleKey` because that is
   * the key `applyPriceMode`, `priceRowStale` and `styleRate` already group by.
   * A second grouping rule here is how the screen and the valuation would come
   * to disagree about what "this style's rows" means.
   *
   * A ROW WITH NO STYLE IS ITS OWN GROUP, keyed by the row. Otherwise every
   * unanswered row would collapse into one group under the empty key, and "+ Add
   * style price" twice would look like it had done nothing the second time.
   */
  type PriceGroup = { key: string; refNo: string; rows: PriceDetailRow[] };
  const priceGroups: PriceGroup[] = (() => {
    const out: PriceGroup[] = [];
    const seen = new Map<string, PriceGroup>();
    for (const r of priceDetails) {
      const k = styleKey(r.style_ref_no);
      if (!k) {
        out.push({ key: r.key, refNo: "", rows: [r] });
        continue;
      }
      const g = seen.get(k);
      if (g) {
        g.rows.push(r);
        continue;
      }
      const next = { key: k, refNo: r.style_ref_no, rows: [r] };
      seen.set(k, next);
      out.push(next);
    }
    return out;
  })();

  /**
   * THE STYLE, ASKED ONCE FOR THE WHOLE GROUP (client 2026-08-14: "already we
   * choosed the style, why need show for all size").
   *
   * It writes the four identity fields to EVERY row of the group, not to one:
   * they are a property of the style, and a group whose rows disagreed about
   * `style_ref_no` would split into two groups on the next render — the row the
   * operator re-pointed would leave, taking its rates with it.
   *
   * The article number is no longer drawn beside it. It was a caption under this
   * picker on every one of six identical rows, which is exactly the repetition
   * this change removes; it is answered on the Style(s) tab and reaches the
   * saved row untouched.
   */
  const priceStyleCell = (g: PriceGroup) => (
    <RecordPicker
      label="Style"
      compact
      required
      items={styleLineItems}
      identity="code"
      value={styleLineKeyOf(g.refNo)}
      onChange={(key) => {
        const line = key ? styles.find((x) => x.key === key) : null;
        const mine = new Set(g.rows.map((r) => r.key));
        /* THE GROUP'S IDENTITY CHANGES HERE, so the "which group is open"
           pointer has to follow it. A blank group is keyed by its row; the
           moment a style is picked it is keyed by `styleKey`, and a pointer left
           on the old key would stop matching — the group would fold itself out
           from under the operator the instant its last rate was filled. Only the
           pointer AT THIS GROUP moves; another group's stays where it is. */
        setOpenPriceKey((k) =>
          k === g.key ? styleKey(line?.style_ref_no ?? "") || null : k,
        );
        setPriceDetails((xs) =>
          xs.map((x) =>
            mine.has(x.key)
              ? {
                  ...x,
                  style_ref_no: line?.style_ref_no ?? "",
                  style: (line?.style_id ? styleById.get(line.style_id)?.name : null) ?? "",
                  article_no: line?.article_no ?? "",
                  // "Unit ... is pulled from the Order Unit established in the
                  // initial Style Entry" — so it arrives with the line rather
                  // than being asked for again.
                  unit: line ? unitTextOf(line) : "",
                }
              : x,
          ),
        );
        /**
         * AND THE RATE GRID FOLLOWS THE STYLE (client 2026-08-17: "price types
         * must update automatically based on the style").
         *
         * The mode is answered once per style and the grid it opens is a list
         * of THAT style's colourways or sizes — but nothing re-derived it when
         * the style arrived SECOND, which is the order half the operators work
         * in: pick Color-wise, then pick the style, and the grid stayed as it
         * was. Re-applying here is what makes the two orders equivalent.
         *
         * ONLY WHILE NOTHING HAS BEEN ENUMERATED YET (`combo` / `size_id` blank
         * on every row). Re-pointing a group that already carries eight priced
         * colourways at a different style must NOT churn those rows: the
         * operator's typed money is the one thing on this screen worth being
         * slow about (the 2026-08-12 "nothing is ever deleted" decision), and
         * `applyPriceMode` seeds rather than replaces, so re-running it there
         * would leave the new style's rows interleaved with the old style's.
         * That case stays exactly as it was — visibly stale, for the operator
         * to resolve.
         *
         * `line` may be null (the style was cleared), and then there is nothing
         * to enumerate — `applyPriceMode` declines on a blank ref by design.
         */
        const mode = groupMode(g.rows);
        const bare = g.rows.every((r) => !r.combo.trim() && !r.size_id);
        if (line && mode && bare) {
          applyPriceMode({ ...g.rows[0], style_ref_no: line.style_ref_no }, mode);
        }
      }}
    />
  );

  /**
   * THE MODE, now asked once per style rather than once per rate (client
   * 2026-08-12: "when a user selects a mode like Color wise or Size wise, the
   * system automatically opens a grid listing the relevant colors or sizes").
   *
   * The old column carried a note saying the dropdown "stays per ROW ... because
   * a saved row must keep answering for itself". The row still does — nothing
   * rewrites `price_type` on a row the operator did not touch, and a row left on
   * an earlier mode still shows up, below, as a leftover. What changed is only
   * where the question is ASKED: six rows of one style could never legitimately
   * answer it six different ways, and the six identical dropdowns were the
   * clearest half of the repetition being removed.
   *
   * `applyPriceMode` is unchanged and still seeds only what is missing.
   */
  const priceModeCell = (g: PriceGroup, mode: string) => (
    <Select
      required
      value={mode}
      onChange={(e) => applyPriceMode(g.rows[0], e.target.value)}
    >
      <option value=""></option>
      {PRICE_TYPE_OPTIONS.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </Select>
  );

  /** WHICH colourway this rate is for — the combos the Combos tab declared,
   *  which is why Prices sits after it in the rail. It is a COLUMN of the rate
   *  list now, rendered only under a mode that prices by colour, so the cell no
   *  longer has to be drawn disabled to hold a column open in a shared header. */
  const priceColourCell = (r: PriceDetailRow) => (
    <Select
      value={r.combo}
      onChange={(e) =>
        setPriceDetails((xs) =>
          xs.map((x) => (x.key === r.key ? { ...x, combo: e.target.value } : x)),
        )
      }
    >
      <option value=""></option>
      {comboOptionsForStyle(r.style_ref_no).map((c) => (
        <option key={c} value={c}>
          {c}
        </option>
      ))}
    </Select>
  );

  /** WHICH size — the style line's OWN size set (0407), not every size in the
   *  master: a rate for a size this style is not made in prices nothing, and
   *  could never be matched to a quantity. */
  const priceSizeCell = (r: PriceDetailRow) => (
    <Select
      value={r.size_id ?? ""}
      onChange={(e) =>
        setPriceDetails((xs) =>
          xs.map((x) => (x.key === r.key ? { ...x, size_id: e.target.value || null } : x)),
        )
      }
    >
      <option value=""></option>
      {sizeOptionsForStyle(r.style_ref_no).map((z) => (
        <option key={z.id} value={z.id}>
          {z.name}
        </option>
      ))}
    </Select>
  );

  /**
   * The rate off the buyer's order sheet. Its CURRENCY is the document's, set on
   * the Logistic tab — there is deliberately no per-row currency.
   *
   * `required` ON THE CONTROL, which is the sanctioned second declaration when a
   * grid renders its own row (AGENTS.md: "A GRID THAT RENDERS ITS OWN ROW MUST
   * DECLARE `required` TWICE"). It was `ChildGridColumn.required` before this
   * change and the hold must not be lost with the column — an unpriced rate row
   * is the one thing that makes `styleRate` refuse.
   */
  const priceRateCell = (r: PriceDetailRow) => (
    <Input
      type="number"
      required
      className="text-right"
      value={r.price}
      onChange={(e) =>
        setPriceDetails((xs) =>
          xs.map((x) => (x.key === r.key ? { ...x, price: e.target.value } : x)),
        )
      }
    />
  );

  /** One more rate for this style, carrying the group's identity and mode so it
   *  lands in the same group rather than starting a second one. Inserted after
   *  the group's last row, not appended to the document, so a two-style order
   *  keeps its rates together. */
  const addRate = (g: PriceGroup, mode: string) => {
    const src = g.rows[0];
    const last = g.rows[g.rows.length - 1];
    setPriceDetails((xs) => {
      const at = xs.findIndex((x) => x.key === last.key);
      const row: PriceDetailRow = {
        ...blankPriceDetail(),
        style_ref_no: src.style_ref_no,
        style: src.style,
        article_no: src.article_no,
        unit: src.unit,
        price_type: mode,
      };
      return at === -1 ? [...xs, row] : [...xs.slice(0, at + 1), row, ...xs.slice(at + 1)];
    });
  };

  /**
   * THE RATE LIST OF ONE STYLE — the legacy child table (screenshot 2295), where
   * a style's row carries a small `Combo · Price` list beneath it rather than
   * repeating the style down the page.
   *
   * HAND-ROLLED, NOT A NESTED `ChildGrid`, and that is the established idiom in
   * this file rather than a shortcut: `sizeGrid` and the combo parts list are
   * both built this way. A nested `ChildGrid` in `responsive` mode mounts its
   * table AND its cards and hides one by CSS, which `enterNestedGrid` has to
   * work around by hand (`offsetParent`) — a complication worth avoiding for a
   * two-column list. The four markers are what matter and they are all here:
   * `data-grid-body` + `gridKeyNav` (arrows and Enter), `data-grid-row` (the Tab
   * axis), `data-row-remove` (Ctrl+Del) and `data-row-add` INSIDE the body,
   * which is where `enterNestedGrid` looks for Tab's way into an empty list.
   *
   * FIXED WIDTHS PER COLUMN, not `flex-1`: they have to line up down the list,
   * and an unsized item absorbs the row's slack — the same failure `hugsContent`
   * records about a grid column left without a `width`.
   */
  /**
   * ONE WIDTH ACROSS THE PRICES TAB (client 2026-08-18, screenshot 095838:
   * "make this four fields in same size").
   *
   * The four the operator sees under a style price were 128 / 112 / 111 / 117px
   * — Size (`w-32`), Price (`w-28`), and the two "+ Add" buttons at whatever
   * width their labels happened to be. Four near-misses read as a ragged edge,
   * which is worse than four widths that are obviously different: the eye keeps
   * trying to line them up.
   *
   * `w-32` and not something wider, because the client's other standing note on
   * this screen pulls the other way — "reduce this size dialing fields length,
   * now it looks too large, make compact" (screenshot 2335). 128px is the
   * biggest of the four already, so unifying UP to it moves three controls a
   * few pixels rather than making the row grow.
   *
   * A FIXED WIDTH, NOT A FLOOR, and that is the lesson from `ADD_BUTTON_W` two
   * hours earlier on this same file: a `min-w` lets the longest label push its
   * own button wider and the set goes ragged again silently. The longest label
   * this grid can produce is "+ Add colour price" (~121px, `noun` ∈ rate ·
   * size · colour) and the outer one is "+ Add style price" (117px), so both
   * clear 128px with room. If a longer noun ever arrives the constant moves —
   * one edit, all four — and until it does, nothing can drift apart.
   *
   * COLOUR KEEPS ITS OWN. A colour name is a word ("MELANGE GREY"); a size is
   * 1-3 characters and a price is a number. Narrowing it to match would ellipse
   * real values to make an alignment the operator never complained about — and
   * it is not one of the four in the screenshot.
   */
  const PRICE_W = "w-32";
  const PRICE_COLOUR_W = "w-40";

  const rateGrid = (g: PriceGroup, mode: string) => {
    const axes = priceAxes(mode);
    // A row with no mode yet is one of THIS set — it is the blank the operator
    // is about to fill, not a leftover from a mode they have moved off.
    const rows = g.rows.filter((r) => !r.price_type || r.price_type === mode);
    const leftovers = g.rows.filter((r) => r.price_type && r.price_type !== mode);
    const noun = axes.size ? (axes.colour ? "rate" : "size") : axes.colour ? "colour" : "rate";
    /**
     * CAN THIS STYLE CARRY MORE THAN ONE RATE? Only if the mode gives the rates
     * something to differ BY.
     *
     * Style-wise — and a group with no Price Type chosen yet — is one price for
     * the style, so a second rate row is not a second price, it is the same
     * price twice with no way to tell them apart. Avg Rate is
     * quantity-weighted over these rows, so the duplicate does not merely look
     * wrong, it moves the number.
     *
     * That is also what the client was reporting (screenshot 2304,
     * 2026-08-14): "+ Add rate price" and "+ Add style price" one above the
     * other, "doing the same work". On a blank group they genuinely did — the
     * only honest thing either could add was another undifferentiated line. So
     * the inner one stands down until the mode earns it, and the tab is left
     * with the one add button that always means something.
     *
     * `|| rows.length === 0` keeps it alive in the one case that would
     * otherwise be a dead end: switching mode turns every existing rate into a
     * leftover, and with no button and no row there is nothing to add a rate
     * with and nothing for `enterNestedGrid` to click Tab's way in on.
     */
    const canAddRate = axes.colour || axes.size || rows.length === 0;
    return (
      <div className="space-y-1.5">
        {/* The header line the legacy grid has, and the reason the rate rows
            need no labels of their own — six `<Field>`s down the list would put
            14px of label above every rate. The `*` is drawn here for the same
            reason `ChildGrid` draws it in its `<th>`: the hold itself is
            declared on the control (`priceRateCell`). */}
        <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
          {axes.colour && <span className={cn(PRICE_COLOUR_W, "shrink-0")}>Colour</span>}
          {axes.size && <span className={cn(PRICE_W, "shrink-0")}>Size</span>}
          <span className={cn(PRICE_W, "shrink-0")}>Price *</span>
        </div>
        <div
          data-grid-body
          className="space-y-1"
          /* DECLINING (`false`) rather than adding is what lets Enter LEAVE a
             single-rate list — `gridKeyNav` passes a declined key to the parent
             grid. Adding here would mint the same duplicate the button no
             longer offers, off a key instead of a click. */
          onKeyDown={(e) => gridKeyNav(e, () => (canAddRate ? addRate(g, mode) : false))}
        >
          {rows.map((r) => (
            <div key={r.key} data-grid-row className="flex items-center gap-2">
              {axes.colour && <div className={cn(PRICE_COLOUR_W, "shrink-0")}>{priceColourCell(r)}</div>}
              {axes.size && <div className={cn(PRICE_W, "shrink-0")}>{priceSizeCell(r)}</div>}
              <div className={cn(PRICE_W, "shrink-0")}>{priceRateCell(r)}</div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                data-row-remove
                className="shrink-0 text-muted-foreground hover:text-danger"
                onClick={() => setPriceDetails((xs) => xs.filter((x) => x.key !== r.key))}
                aria-label={`Remove ${sizeLabel(r.size_id) || r.combo || "rate"}`}
              >
                <Trash2 className="h-4 w-4 shrink-0" />
              </Button>
            </div>
          ))}
          {/* SHOWN ONLY WHERE A SECOND RATE MEANS SOMETHING — see `canAddRate`.
              When it does show it matches `ChildGrid`'s own add button
              (`variant="outline" size="sm"` at content width), which is the only
              way the pair reads as a pair rather than as two rival controls. */}
          {canAddRate && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              data-row-add
              /* Same width as the Size and Price boxes above it — see PRICE_W. */
              className={PRICE_W}
              onClick={() => addRate(g, mode)}
            >
              + Add {noun} price
            </Button>
          )}
        </div>
        {/* THE FLAG HALF of "keep rows, never delete them" (operator decision
            2026-08-12), and it says it ONCE PER STYLE now rather than once per
            row. Without it a left-over rate from a previous mode is
            indistinguishable from a current one, and the only symptom is that
            the Logistic tab's Avg Rate quietly refuses to answer. Amber and
            advisory — it never holds the cursor, because these rows are valid,
            just superseded. */}
        {leftovers.length > 0 && (
          <div className="space-y-1 rounded-md border border-warning/40 bg-warning/10 p-2">
            <p className="text-xs text-warning">
              {leftovers.length === 1 ? "One rate is" : `${leftovers.length} rates are`} left
              over from {leftovers[0].price_type}. Remove {leftovers.length === 1 ? "it" : "them"}{" "}
              or the order&rsquo;s value cannot be calculated.
            </p>
            {leftovers.map((r) => (
              <div key={r.key} className="flex items-center gap-2 text-xs text-muted-foreground">
                {/* `Truncated`, NOT a bare `truncate` span, and this list is the
                    case the rule is sharpest on: these rows are shown BECAUSE
                    something did not match, so "which combo is left over?" is
                    the one question the block exists to answer — an ellipsis
                    that swallows the answer makes the warning unactionable.
                    Nothing here commits on `mousedown`, so press-and-hold stays
                    on (`touch` defaults true); the ✕ beside them is the only
                    control and it is a real click. The component writes the
                    `truncate` span itself, so the class comes off the call site
                    and a value that fits gets no bubble at all. */}
                <Truncated text={r.combo || "—"} className={cn(PRICE_COLOUR_W, "shrink-0")} />
                <Truncated text={sizeLabel(r.size_id) || "—"} className={cn(PRICE_W, "shrink-0")} />
                <span className={cn(PRICE_W, "shrink-0")}>{r.price || "—"}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  data-focus-optional
                  className="shrink-0 text-muted-foreground hover:text-danger"
                  onClick={() => setPriceDetails((xs) => xs.filter((x) => x.key !== r.key))}
                  aria-label={`Remove leftover ${r.price_type} rate`}
                >
                  <Trash2 className="h-4 w-4 shrink-0" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  /**
   * What the tab knows about one style's prices, computed ONCE and read by both
   * the folded summary and the row body. Two copies of the fold test is how a
   * row comes to summarise itself as complete while rendering as open.
   */
  const priceGroupView = (g: PriceGroup) => {
    const mode = groupMode(g.rows);
    const rates = g.rows.filter((r) => !r.price_type || r.price_type === mode);
    const priced = rates.filter((r) => r.price.trim());
    /* ONLY A COMPLETE GROUP FOLDS — the same rule the Style(s) grid follows, and
       for the same hard reason: a folded group's fields are UNMOUNTED, so a
       blank required rate inside one would have no `data-required-empty` node
       for `onBlockedSave` to land on. Save would refuse and the cursor would
       have nowhere to go. */
    const complete = !!g.refNo && !!mode && rates.length > 0 && priced.length === rates.length;
    const openKey = openPriceKey ?? priceGroups[priceGroups.length - 1]?.key ?? null;
    /* A SINGLE STYLE NEVER FOLDS — there is no next style to move on to, and 98%
       of orders are one style, so the common case is untouched by this. */
    const isOpen = priceGroups.length < 2 || g.key === openKey || !complete;
    const nums = priced.map((r) => Number(r.price)).filter((n) => Number.isFinite(n));
    const lo = nums.length ? Math.min(...nums) : null;
    const hi = nums.length ? Math.max(...nums) : null;
    /* What a folded group says about itself: the mode, how many rates, and the
       spread. Named, not counted, wherever a name is the more useful answer —
       but a rate list is numbers, so here the range IS the useful summary. */
    /* THE LEFTOVER COUNT SURVIVES THE FOLD, and that is not decoration. The
       amber block naming those rows lives inside the row body, so folding the
       group would hide the one thing standing between this order and a value —
       a warning that disappears when the row it belongs to is tidied away is a
       warning the operator never acts on. */
    const leftovers = g.rows.length - rates.length;
    const summary = [
      mode,
      rates.length > 1 ? `${rates.length} rates` : null,
      lo == null ? null : lo === hi ? String(lo) : `${lo} – ${hi}`,
      leftovers > 0 ? `${leftovers} left over` : null,
    ]
      .filter(Boolean)
      .join("  ·  ");
    return { mode, isOpen, complete, summary };
  };

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
          <option value=""></option>
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
   * THE CONSIGNEES OF THIS ORDER'S CUSTOMER (client 2026-08-17: "the consignee
   * input should be filtered based on the specific buyer/customer selected for
   * that order").
   *
   * THE BUYERS/CUSTOMERS TRAP DOES NOT BITE HERE, and it is worth saying why
   * rather than leaving the next reader to re-derive it. AGENTS.md records that
   * `sales_orders.buyer_id` points at `buyers` while consignees and nominations
   * hang off `customers`, with a nullable `buyers.customer_id` between them —
   * so a narrowing keyed off the ORDER would have to cross that bridge and
   * would find it empty. This screen does not go that way: 0404 moved the
   * garment order's own party to `customers`, `garment_order_amendments.
   * customer_id` and `consignees.customer_id` both reference `customers`, and
   * the header's Customer field is the one the operator picked. One table, one
   * comparison, no bridge.
   *
   * FOUR STATES, and three of them are "offer everything" for three different
   * reasons — which is exactly why they are enumerated here instead of being
   * collapsed into one `if`:
   *
   *  - No customer picked yet -> everything. There is nothing to narrow BY, and
   *    a quantity line can legitimately be entered before the header is
   *    finished.
   *  - Customer picked, has consignees -> those, and only those.
   *  - Customer picked, has NONE -> everything, WITH A LINE SAYING SO. Empty
   *    would read as "this customer ships nowhere", which is a claim the data
   *    does not support: `customer_id` is nullable and most consignees predate
   *    anyone filling it in. Same shape as the nominated-vendor rule's
   *    "empty-and-explain", inverted because here the honest fallback is the
   *    full list rather than nothing.
   *  - A row already NAMES a consignee -> it survives whatever the filter says.
   *    Dropping it would show a filled cell as empty and blank the FK on the
   *    next save ("Disabled rows"). Quantities' Ref No used to make the same
   *    move; it no longer needs to, being free text since 2026-08-17 — a typed
   *    value cannot be dropped by a list that is not there.
   */
  const consigneeOptions = (held: string | null) => {
    const cust = form.customer_id;
    const mine = cust ? data.consignees.filter((c) => c.customer_id === cust) : [];
    if (!cust || mine.length === 0) {
      return {
        items: data.consignees,
        hint: cust
          ? "— all consignees (none linked to this customer) —"
          : null,
      };
    }
    const items = mine.some((c) => c.id === held)
      ? mine
      : held
        ? [...mine, ...data.consignees.filter((c) => c.id === held)]
        : mine;
    return { items, hint: null };
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
   * `styleOfCombo`). Ref No is FREE TEXT (2026-08-17), so it routinely names no
   * style line at all — an empty list is the ordinary answer here, not an edge
   * case, and the overlay says so rather than rendering a grid with no columns.
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
   * Quantities Details — EIGHT columns, and therefore CARDS (see the grid below).
   *
   * STYLE NO, WAREHOUSE AND DISCHARGE PORT WERE WITHDRAWN (client 2026-08-17,
   * screenshot 2322), which is what let the remaining eight share one line.
   * Style No was `readOnly` and filled by Ref No, so it printed a value the
   * operator could already read off the field beside it; the two logistics
   * pickers belong to the shipment, not to the quantity line.
   *
   * `QuantityRow` STILL CARRIES ALL THREE and `toPayload` still sends them —
   * the same treatment the withdrawn Combo Description / Material BOM columns
   * got, and for the same hard reason: `writeChildren` deletes and reinserts
   * every child row, so a field the FORM stops carrying is a field the next
   * save NULLS. Style No also keeps being derived from Ref No on change, so a
   * seeded order round-trips unchanged and `diff.ts` can still report all three.
   * Dropping them from the state is a data change, not a layout one, and was
   * not what was asked for.
   *
   * NO `width` ON ANY COLUMN, deliberately. They each carried one, ~100rem in
   * total, to force `table-fixed` so the table would scroll instead of
   * collapsing every picker to "— S…". The grid is carded now, so a per-column
   * width is both dead and contrary to the one-width rule. Width here is the
   * `Field` track's business, and the row states it once (`QTY_NARROW` below).
   * Leaving them would have preserved, in code, the argument for the layout that
   * was just removed.
   */
  /**
   * THE ORDER A QUANTITY LINE IS READ IN (client 2026-08-14) — the six that were
   * the open row's first line, still first. Assortment Type and Earlier Shipment
   * Dt follow them; since 2026-08-17 all eight are on ONE line, so this list no
   * longer decides what is VISIBLE, only what order it comes in and which single
   * field a folded row keeps.
   *
   * BY HEADER, NOT BY INDEX — the same anchoring the Style column uses, and for
   * the same reason: these columns have been reordered before, and a header that
   * stops matching fails loudly where a slice would quietly promote the wrong
   * field.
   */
  const QTY_PRIMARY = [
    "Country",
    "Ref No",
    // Only rendered while Multi Order is on — `byHeader` returns undefined for a
    // column the grid is not carrying and the `.filter(Boolean)` below drops it,
    // so naming it here costs nothing on a single-PO order. Second, beside the
    // style it belongs to, because the PO number is how the operator TELLS two
    // otherwise identical destinations apart.
    "PO No",
    "Consignee",
    "PO Qty",
    "Delivery Dt",
    "Assort",
  ] as const;

  /**
   * ALL EIGHT ON ONE LINE (client 2026-08-17), by giving the short cells a
   * narrower one than the long ones:
   *
   *   4 long × 2 + 4 short × 1 = 12, exactly.
   *
   * Eight at the one width are 16 of 12 and had to wrap. What decides which is
   * which is HOW MANY CHARACTERS THE VALUE HAS, not what kind of control it is:
   * Consignee and Assortment Type hold long phrases ("Assort Colour / Solid
   * Size"), and a native `<input type="date">` renders dd-mm-yyyy plus a
   * calendar button and clips below ~120px — those four take two columns.
   * A country, a ref number, a four-digit PO Qty and a button reading "Assort"
   * fit one (~115px in this pane).
   *
   * Country is the cell this costs something: a long name truncates. It is the
   * row's identity, so it is also the one field a folded row shows and the first
   * thing in the summary line — and every picker reveals its full value on hover
   * (`Truncated`, the truncate-reveal rule), so nothing is unreachable.
   *
   * NO PRIMITIVE CHANGE AND NO HAND-ROLLED GRID — the same mechanism the
   * Approval Qty row uses for its eight (2026-08-14): `Field` merges `className`
   * AFTER its span, so a col-span passed there wins, and `@lg/section:col-span-*`
   * is the layout contract's own vocabulary, which `--check screen-grid` never
   * flags. A custom track would have needed a bare `grid-cols-*`, and a seventh
   * entry in the shared SPAN map would change every screen for this one row.
   */
  /**
   * AND THE SUM HOLDS WITH MULTI ORDER ON, at nine (0427):
   *
   *   3 long x 2 + 6 short x 1 = 12, exactly.
   *
   * The ninth cell has to come from somewhere, and Consignee is what pays for
   * it: of the four long ones it is the only cell whose value merely TRUNCATES.
   * A native `<input type="date">` clips its calendar button below ~120px — the
   * control stops working, not just reading short — and Assortment Type holds
   * the longest phrase on the row ("Assort Colour / Solid Size"). A consignee
   * name at ~115px reads its first word and reveals the rest on hover
   * (`Truncated`, the truncate-reveal rule), which is the same trade Country
   * already makes and the note above already accepts.
   *
   * NOT A SECOND LAYOUT — one line either way. Nine cells at the eight-column
   * split would be 13 of 12 and wrap, stranding the Assort button on a line of
   * its own with eleven empty columns beside it.
   */
  /* RENAMED WITH THE COLUMN (client 2026-08-17: "Assort" -> "Details"). This
     list is matched against `c.header` by STRING, so leaving "Assort" here would
     silently drop the button from the narrow set and re-widen the row — a rename
     that compiles and quietly changes the layout. */
  const QTY_NARROW: readonly string[] = form.multi_order
    ? ["Country", "Ref No", "PO No", "Consignee", "PO Qty", "Details"]
    : ["Country", "Ref No", "PO Qty", "Details"];

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
      /**
       * FREE TEXT, WITH NO LIST AT ALL (client 2026-08-17: "that Ref No field
       * only free text, no more fetching from any table, so remove that wired
       * table connection").
       *
       * This is the SECOND step of the same request and it reverses the first.
       * Earlier the same day the field went from a strict picker to `TypeOrPick`
       * — type OR pick, keeping the style list as the fast path. The client has
       * now asked for the list gone outright, so the wiring goes with it:
       * `refNoOptions` is deleted rather than left unused, because a feeder kept
       * "in case" is what makes the next reader think the list is still meant to
       * be there.
       *
       * `TypeOrPick` STAYS ON THE COLOUR CELL, which is a different answer to a
       * different question — 0415 built the colour master precisely so "Navy
       * Blue" and "Dark Blue" stop being two names for one shade, and that field
       * keeps its list. Only the Reference is unwired.
       *
       * STYLE NO IS STILL DERIVED, and that is not a leftover connection. It
       * reads this order's OWN style lines, not a table, and it exists to CLEAR
       * a style name left behind by a ref that used to match one — without it a
       * typed ref would sit beside the previous ref's style name. A ref that
       * matches nothing resolves to "", which is the honest answer.
       *
       * NOT `uppercase`. `style_ref_no` is `nullableText` in the schema, not
       * `capsTextNullable()`, and AGENTS.md §CAPITALS is explicit that the screen
       * half alone is the wrong half to have — it would shout what an operator
       * types while leaving every stored value as it was.
       */
      cell: (r) => (
        <Input
          className="h-8"
          value={r.style_ref_no}
          onChange={(e) =>
            setQty(r.key, {
              style_ref_no: e.target.value,
              style_no: styleNoForRef(e.target.value),
            })
          }
        />
      ),
    },
    /**
     * THE BUYER PO THIS DESTINATION BELONGS TO (0427) — the "extra column in the
     * quantity tab for multiple PO numbers" the client asked for.
     *
     * CONDITIONAL ON THE SWITCH, so a single-PO order is untouched: the column
     * is spliced in below rather than rendered disabled, because a column that
     * can never be filled is a column the operator has to read past on every
     * row of every order.
     *
     * THE VALUE SURVIVES THE SWITCH GOING OFF. Nothing here or in `submit`
     * clears `po_no` — see the note on the payload. Hiding a column is not
     * emptying it, and a mis-clicked checkbox must not cost three typed PO
     * numbers.
     *
     * Plain text and NOT uppercased, matching the header's own PO No: a buyer's
     * reference is theirs, and the two fields hold the same kind of value.
     */
    ...(form.multi_order
      ? [
          {
            header: "PO No",
            cell: (r: QuantityRow) => (
              <Input
                className="h-8"
                value={r.po_no}
                onChange={(e) => setQty(r.key, { po_no: e.target.value })}
              />
            ),
          } as ChildGridColumn<QuantityRow>,
        ]
      : []),
    {
      header: "Consignee",
      cell: (r) => (
        <RecordPicker
          label="Consignee"
          compact
          items={consigneeOptions(r.consignee_id).items}
          value={r.consignee_id}
          onChange={(id) => setQty(r.key, { consignee_id: id })}
          placeholder={consigneeOptions(r.consignee_id).hint ?? undefined}
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
      header: "Details",
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
      /**
       * BLOCKED WITH `aria-disabled`, NEVER `disabled` (client 2026-08-17: "check
       * why the assort button is not working").
       *
       * It WAS working — it refuses when the order has no assorting pack type,
       * which is the `assortGate` rule above. What was broken is that it could
       * not SAY SO: a truly `disabled` button stops firing pointer events, so its
       * `title` never surfaces, and both reasons this button withholds itself
       * ("Pick a Ref No first", "Turn Pack on in Order Info") were written and
       * unreadable. A greyed control with no reason is precisely the failure the
       * nominated-vendor rule records — and the comment above already claimed
       * "each refusal names the switch that turns it on", which the markup then
       * prevented.
       *
       * Same shape as `RowActions`' `deleteDisabledReason`, for the same reason
       * stated there: focusable + `aria-disabled` keeps it reachable, lets
       * `Tooltip`'s hover AND focus branches show the reason, and is honest to a
       * screen reader because the control genuinely does nothing when clicked.
       * The reason also rides in `aria-label`, since the bubble is decorative.
       */
      cell: (r) => {
        const why = !r.style_ref_no.trim()
          ? "Pick a Ref No first"
          : !assortGate.ok
            ? (assortGate.why ?? "")
            : "";
        const blocked = !!why;
        return (
          <Tooltip label={why || "Open assortment details"} touch={blocked}>
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-disabled={blocked || undefined}
              aria-label={blocked ? `Details — ${why}` : "Details"}
              className={blocked ? "cursor-not-allowed opacity-50" : undefined}
              onClick={blocked ? undefined : () => setAssortQtyKey(r.key)}
            >
              {/* No count — see the Process button. */}
              Details
            </Button>
          </Tooltip>
        );
      },
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
   * Nothing is lost: a card lays its cells out through `<Field size="xs">`,
   * which is this screen's one width — six a row since 2026-08-14 — and a table
   * would want its widths chosen for a table anyway.
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
              {/* Blank once a Style is named — the column header already says
                  "Combo", so "— Select Combo —" was the header repeated inside
                  the box. The OTHER branch stays: "Pick a Style first" is why
                  this list is empty, which nothing else on the row says. */}
              {r.style_ref_no.trim() ? "" : "Pick a Style first"}
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
        <Field key={label} label={label} size="xs">
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
                  size="xs"
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
  /** The Styles-tab line a child row names, by the module's join key. `styleKey`
   *  and never `===`, for the reason `sizesOfQuantity` gives: rows saved before
   *  the CAPITALS rule are not upper-cased. */
  const styleLineOf = (refNo: string) =>
    styles.find((x) => styleKey(x.style_ref_no) === styleKey(refNo)) ?? null;

  const detailHeader = (r: ComboRow) => (
    <FieldGrid>
      {(
        [
          ["Style Ref No", r.style_ref_no],
          ["Style No", r.style],
          /* "STYLE DESC." NAMED THE ARTICLE NUMBER. Four labels, and this one
             printed `article_no` — the two are different facts, and the legacy
             block this header copies (see the read-only band in
             `components/orders/style-process-sheet.tsx`) lists them as separate
             fields: Style Ref No · Article No · Order Unit / Style No · Style
             Description · PO Qty. So the label is corrected and the field it
             was standing in for is added beside it. */
          ["Article No", r.article_no],
          /* DERIVED FROM THE STYLE LINE, NEVER STORED ON THE COMBO (client
             2026-08-17: "the compo section must automatically fetch style
             details once a style is selected").

             `ComboRow` carries the three identity fields the Style picker
             writes on pick, and the description is not one of them — but it
             does not need to be. The combo names a style LINE, the line already
             holds `style_description`, and reading it here means the two can
             never disagree and no column has to be migrated to hold a copy.
             Blank when the line has since been removed from the Styles tab,
             which is honest: nothing on this order says what that style was. */
          ["Style Description", styleLineOf(r.style_ref_no)?.style_description ?? ""],
          ["Combo", r.combo],
          // Combo Description withdrawn with its grid column (2026-08-17). It
          // would now render either an EMPTY read-only box with nothing able to
          // fill it, or — on a seeded order, where the seeder copies `combo`
          // into it — the same word twice in adjacent fields.
        ] as [string, string][]
      ).map(([label, value]) => (
        <Field key={label} label={label} size="xs">
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
  const componentGrid = (r: ComboRow, st: ComboStructRow) => {
    /*
     * SAID ONCE, NOT ONCE PER PART (client 2026-08-17, screenshot 2334: these
     * "fields title for everytime ... making screen two huge").
     *
     * Both sentences are properties of the STRUCTURE — its `item_sub_type`, and
     * the prints THIS order declared — never of an individual part. Carried in
     * the per-row placeholder they printed identically down every line of the
     * panel, which is three copies of one fact and three rows of height for it.
     *
     * Hoisted rather than DELETED, because the field is empty for a reason and
     * an unexplained empty box is the "empty-and-explain" rule broken (AGENTS.md
     * states it for the nominated-vendor list; it is the same shape here).
     */
    const printNote = !takesAllOverPrint(st.item_sub_type)
      ? "Set this structure's Fabric Type to Printed to choose a fabric print."
      : declaredPrintOptions(st, null).length === 0
        ? "Declare a print on Color/Print Details to choose one here."
        : null;

    // `r`, not just its key: the Coordinate / Component / Fabric Color options
    // are all properties of the combo's STYLE and its Fabric Type.
    return (

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
        /* NOT `divide-y`: the empty-state note, the narrowing note and the
           "+ Add component" button are siblings of the rows in here, so a
           divider on the PARENT would draw a line above each of those too. The
           hairline is on the row (`border-t`, cancelled on the first). */
        className="space-y-2"
        onKeyDown={(e) => gridKeyNav(e, () => addComp(r.key, st.key))}
      >
        {st.components.map((c, j) => (
          <div
            key={c.key}
            data-grid-row
            /* `relative pr-10` — the ✕ hangs in the corner instead of standing on
               a line of its own. See the band below.

               NO CARD PER PART (client 2026-08-17, screenshot 2334). A border, a
               background and 12px of padding around each part turned three
               one-line rows into three boxes stacked down the panel. The panel
               above already draws the box that says "these belong to the
               structure"; a second one per row says nothing further and costs
               ~40px each. A hairline separates them instead, cancelled on the
               first row so the panel does not gain a rule under its title. */
            className="relative border-t border-border/60 pr-10 pt-2 first:border-t-0 first:pt-0"
          >
            {/* NO `#N`, AND THEREFORE NO BAND (client 2026-08-17, screenshot
                2332: "remove that #1, #2, all this kind of numbering, making huge
                UI gap"). The number was the only thing this line carried — a
                part is identified by ITS COORDINATE AND COMPONENT, which are the
                first two fields under it, never by being third. The ✕ keeps
                `data-row-remove`, so Ctrl+Del and the mouse are unchanged; it
                just no longer costs a row of height. Same change, same day, in
                `ChildGrid`'s own cards band. */}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              data-row-remove
              /* ANCHORED TO THE BOTTOM, not the top: only the FIRST part carries
                 the column titles (see the fields below), so a top-anchored ✕
                 would sit level with the controls on every row except that one,
                 where the label row pushes them ~20px down. The control line is
                 the bottom of the row in both cases. */
              className="absolute bottom-1 right-0 text-muted-foreground hover:text-danger"
              onClick={() =>
                mutComps(r.key, st.key, (cs) => cs.filter((x) => x.key !== c.key))
              }
              aria-label="Remove component"
            >
              <Trash2 className="h-4 w-4 shrink-0" />
            </Button>
            <FieldGrid>
              {/*
                * THE COLUMN TITLES ARE ON THE FIRST PART ONLY (client
                * 2026-08-17, screenshot 2334: "no need to show this Coordinate /
                * Component / Fabric Color / Fabric Print fields title for
                * everytime because making screen two huge").
                *
                * `Field` already draws no label row at all when `label` is
                * omitted — `{label != null && …}` — as opposed to `label=""`,
                * which RESERVES the row so a control lines up with labelled
                * fields beside it. Omitting is what reclaims the ~20px.
                *
                * WHY THE FIRST ROW RATHER THAN A HEADER STRIP: a strip would be
                * a second `FieldGrid`, and `FieldGrid` establishes its own
                * `@container/section` — so the header and the rows would resolve
                * `@lg/section:col-span-*` against two different containers and
                * could drift apart at the exact widths where alignment matters.
                * Titles on row one are aligned BY CONSTRUCTION, because they are
                * in the same grid as the cells they name, and they degrade
                * correctly when the row wraps at narrow widths.
                *
                * The controls keep their own `label` prop regardless, so the
                * accessible name and `requiredAttrs`' hold message survive on
                * every row (`own?.label || ctx.label`).
                */}
              <Field label={j === 0 ? "Coordinate" : undefined} size="xs">
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
              <Field label={j === 0 ? "Component" : undefined} size="xs">
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
              <Field label={j === 0 ? "Fabric Color" : undefined} size="md">
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
                 *
                 * NO `placeholder`. `Combobox` already defaults to "" for the
                 * reason its own note gives (client 2026-08-17): an unfilled
                 * control shows nothing, because a Combobox sits under a
                 * `<Field label>` or a column title like every other control, so
                 * "Select…" is the label said twice. This call site was
                 * OVERRIDING that default back to "Select…" / "Type a colour" —
                 * the very words the client pointed at in screenshot 2334,
                 * printed once per part. Passing nothing is what lets the
                 * primitive's decision reach this field.
                 */}
                <Combobox
                  options={colourOptionsFor(st)}
                  value={c.color_name}
                  onChange={(v) =>
                    patchComp(r.key, st.key, c.key, { color_name: v.toUpperCase() })
                  }
                  clearable
                />
              </Field>
              <Field label={j === 0 ? "Fabric Print" : undefined} size="md">
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
                />
              </Field>
            </FieldGrid>
            {/* "PROCESSED AS TRIM" WITHDRAWN (client 2026-08-17): "remove
                Processed as Trim and the Garment Process child entry section
                entirely, as these details are covered elsewhere."

                THE COLUMN AND ITS STORED VALUES STAY, and on a CHILD grid that
                is not the same edit as a header withdrawal. `amend_year` left
                `garmentAmendmentInput` because an update writes only the keys
                the schema names, so dropping it there PRESERVES what is stored.
                A combo component is written by `writeComboTree`, which DELETES
                and re-inserts the whole tree — so a field dropped from the
                payload comes back as the column default on the very next save.
                Here the preserving move is the opposite one: `processed_as_trim`
                stays in `ComponentRow`, in `toRows` and in the payload, and only
                the control goes. Same treatment `article_no`, `plan_unit_id` and
                the withdrawn Fabric column already have on this screen.

                It was an inline `<label>`, not a `Field`-wrapped box — see the
                note that stood here, and reuse it if a boolean ever returns to
                this row. */}
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
        {/* WHY FABRIC PRINT IS EMPTY — once for the structure, not once per
            part. See `printNote` at the top of this function. */}
        {printNote && <p className="text-xs text-muted-foreground">{printNote}</p>}
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
  };

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
      /* ONE STRUCTURE OPEN AT A TIME (client 2026-08-14, module-wide). Seven
         fields plus a nested components panel is three or four wrapped lines
         per structure, and a combo with three structures filled the overlay
         before "+ Add structure" came into view. `ChildGrid` owns the fold; the
         `#N` band and the family chip `rowSummary` already draws stay above it,
         so a closed structure still says which one it is. */
      foldRows
      /* Nothing to summarise until a Structure is named — and `rowSummary`
         would be showing "New structure" beside it. */
      canFold={(st) => !!st.structure_id}
      renderFoldedRow={(st) => {
        const parts = st.components?.length ?? 0;
        const summary = [
          data.fabrics.find((f) => f.id === st.fabric_item_id)?.name,
          gsmRange(st.gsm, st.gsm_tolerance) || null,
          ITEM_SUB_TYPE_OPTIONS.find((o) => o.value === st.item_sub_type)?.label,
          parts > 0 ? `${parts} ${parts === 1 ? "part" : "parts"}` : null,
        ]
          .filter(Boolean)
          .join("  ·  ");
        return (
          <FieldGrid>
            {/* THE STRUCTURE STAYS A REAL FIELD — Tab lands on fields, so a
                folded row rendering none is mouse-only, and focusing it is what
                opens the row again. */}
            <Field label="Structure" required size="md">
              <RecordPicker
                label="Structure"
                compact
                required
                items={scopedStructures(r, st.structure_id)}
                value={st.structure_id}
                onChange={(id) => pickComboStructure(r.key, st.key, id)}
              />
            </Field>
            <Field label="" size="xl">
              <div className="flex min-h-8 items-center">
                <Truncated className="text-sm text-muted-foreground">
                  {summary || "Nothing else filled in yet"}
                </Truncated>
              </div>
            </Field>
          </FieldGrid>
        );
      }}
      onAdd={() => addStruct(r.key)}
      onRemove={(st) => mutStructs(r.key, (sts) => sts.filter((x) => x.key !== st.key))}
      addLabel="+ Add structure"
      renderMobileRow={(st) => {
        const problems = structureProblems(st, familyCodeOf(st.structure_id));
        const range = gsmRange(st.gsm, st.gsm_tolerance);
        return (
          <div className="space-y-3">
            <FieldGrid>
              <Field label="Structure" required size="xs">
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
              {/* "Type" (Main Fabric / Trims Fabric) WITHDRAWN FROM THIS CARD
                  (client 2026-08-17, screenshot 2328), CARRIED NOT DROPPED —
                  the same treatment `combo_description` got two hundred lines
                  up, for the same reason: `writeComboTree` DELETES AND REINSERTS
                  every child row, so a field the form stops carrying is one the
                  next save NULLs. `fabric_type` therefore keeps its column, its
                  place in `ComboStructRow`, its Zod key, its line in
                  `writeComboTree`, its vote in `structureFilled()` and its copy
                  in `order-seed.ts`. It also keeps its row in `diff.ts`, labelled
                  "Type": a withdrawn control still has stored values, and an
                  amendment report that stopped mentioning them would be lying by
                  omission about what changed.

                  Nothing read it for logic — unlike `item_sub_type` below, which
                  drives `takesDyedColour` / `takesAllOverPrint` / the structure
                  problems — so removing the control removes exactly the control.

                  IT IS ALSO WHAT PUTS THIS ROW ON ONE LINE. Seven fields at `xs`
                  is 7 x 2 = 14 on a 12-column track, so Fabric Type wrapped alone
                  underneath; the six that remain tile 12 exactly. That is
                  LAYOUT.md §3's own tiling table (6 cells -> `xs` x6), not a
                  coincidence worth re-deriving — and it is why this needs no
                  `FIELD_TRACK_14`, whose doc says it exists only for the case
                  twelve genuinely cannot hold. */}
              <Field label="Composition" size="xs">
                {/* FETCHED FROM THE STRUCTURE, not answered against a master
                    (0430). The options are the fabrics under the picked
                    Structure, labelled by their blend, and a structure holding
                    exactly one fills this in by itself — see
                    `pickComboStructure` and `fabricsFor`. */}
                {(() => {
                  const opts = fabricsFor(st.structure_id, st.fabric_item_id);
                  return (
                    <RecordPicker
                      label="Composition"
                      compact
                      items={opts}
                      value={st.fabric_item_id}
                      placeholder={fabricPlaceholder(st.structure_id, opts.length)}
                      onChange={(id) => patchStruct(r.key, st.key, { fabric_item_id: id })}
                    />
                  );
                })()}
              </Field>
              <Field label="Gsm" size="xs">
                <Input
                  type="number"
                  className="text-right"
                  value={st.gsm}
                  onChange={(e) => patchStruct(r.key, st.key, { gsm: e.target.value })}
                />
              </Field>
              <Field label="Tolerance" size="xs">
                <Input
                  type="number"
                  className="text-right"
                  value={st.gsm_tolerance}
                  onChange={(e) => patchStruct(r.key, st.key, { gsm_tolerance: e.target.value })}
                />
              </Field>
              <Field label="Gsm Range" size="xs">
                {/* DERIVED, never stored (0408) — 200 ± 5 is 195 - 205. A
                    column for it would be a second source of truth for a
                    subtraction. */}
                <Input readOnly className="h-8" value={range} placeholder="—" />
              </Field>
              <Field label="Fabric Type" size="xs">
                <Select
                  value={st.item_sub_type}
                  onChange={(e) => patchStruct(r.key, st.key, { item_sub_type: e.target.value })}
                >
                  <option value=""></option>
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

  /**
   * ONE WIDTH FOR THE TWO "+ Add" BUTTONS (client 2026-08-17, again 2026-08-18:
   * "change the add size button size like add style button size").
   *
   * "+ Add size" and "+ Add style" sit a few pixels apart and read as a pair.
   * They were ALREADY the same control — both `variant="outline" size="sm"`, so
   * both `h-8 px-3 text-xs` — and the only thing that ever differed was the
   * LABEL: content-width buttons whose text differs by one character differ by
   * ~6px.
   *
   * THE FIRST FIX PUT THE FLOOR ON ONE OF THEM, and that is why this is now a
   * constant. `min-w-[6.75rem]` was set on "+ Add size" alone, described as
   * sitting "just above the longer label's natural width" — it was 108px
   * against "+ Add style"'s natural 88px, so the button that had been 6px small
   * became 20px big and the client reported the same mismatch the other way
   * round. A width floor tuned by eye to a control it is not applied to can
   * only ever be right by luck.
   *
   * Both read this now — the hand-rolled button below and `ChildGrid`'s own via
   * `addClassName` — so the value no longer has to be CORRECT, only generous:
   * whatever it is, the two render the identical box, and a font change moves
   * them together. That is the same reason `createdColumns` and `keyFills` are
   * single declarations rather than matching pairs.
   */
  const ADD_BUTTON_W = "min-w-[6.75rem]";

  /**
   * THIS LAYOUT IS `ChildGrid`'s `across` MODE NOW (2026-08-17).
   *
   * Everything below — the `FIELD_TRACK` body, a fixed span per size, the ✕ in the
   * row, "+ Add size" inside `data-grid-body`, no ordinal — was hand-rolled here
   * because no mode expressed it. The Style master then asked for the same layout
   * ("row design instead of column based", screenshot 2321), so rather than copy
   * these ~90 lines a second time the shape moved into the primitive. Read the
   * `across` prop in `child-grid.tsx`; it cites the reasoning written here.
   *
   * THIS COPY IS DELIBERATELY LEFT STANDING (operator's call). It is a NESTED grid
   * inside a card row, with its own `enterNestedGrid` hand-off and its own
   * `addSize` decline, on a screen the client has signed off — not worth the risk
   * for a change nobody asked for. Migrate it when this grid is next touched for
   * its own reasons, and delete this note with it.
   */
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
      {/**
        * ACROSS, NOT DOWN (client 2026-08-14).
        *
        * This was the whole density complaint measured. The list rendered one
        * size per line at 36px + a 32px Add button, so six sizes was ~248px —
        * inside a cell whose five siblings are 32px tall, on a screen the client
        * was comparing unfavourably with a legacy one that does the same row in
        * ~170px. Laid across, six sizes take ONE line of the ~1080px the cell
        * now spans.
        *
        * A FIXED WIDTH PER ITEM, not `flex-1`: they have to line up in columns
        * as they wrap, and an unsized item absorbs the row's slack — the same
        * failure `hugsContent` records about a grid column left without a
        * `width` (a single Colour dropdown rendered ~1080px wide).
        *
        * ↑/↓ NOW WALK THE LIST LEFT TO RIGHT, and that is a real change worth
        * stating. It stays coherent because this is a ONE-DIMENSIONAL list whose
        * DOM order and visual order agree — unlike the 2026-07-25 defect, where
        * ↓ crossed out of a row's own cells into a nested panel's and landed on
        * the wrong line entirely. Nothing here crosses a boundary.
        *
        * ALL FOUR MARKERS ARE UNCHANGED — see the block above `stylesGrid` for
        * what each one buys. In particular `+ Add size` stays INSIDE
        * `data-grid-body`: `enterNestedGrid` looks for it there, and moving it
        * out is what would break Tab's only way into an empty size list.
        */}
      {/* THE SAME TRACK AS THE FIELDS ABOVE, not a second opinion about layout:
          `FIELD_TRACK` is the exported constant `FieldGrid` itself lays down, so
          a size cell at `col-span-2` lands exactly under Style, Order Unit, PO
          Qty, Description and Process — six to a line, at identical widths and
          gutters.

          `FieldGrid` cannot be used instead, and the reason is the whole point
          of this change: it would need a `<Field>` per size, and `Field` always
          draws a label line — 14px of `&nbsp;` above every one — which is the
          height the size list was moved here to get rid of.

          `@lg/section:col-span-2` is the contract's own vocabulary rather than a
          hand-rolled grid, which is why `--check screen-grid` leaves it alone
          (it flags a bare `grid-cols-*`, and the 12 lives inside the constant). */}
      <div
        data-grid-body
        className={FIELD_TRACK}
        onKeyDown={(e) => gridKeyNav(e, () => addSize(r.key))}
      >
        {r.sizes.map((z) => (
          /* NO ORDINAL (client 2026-08-14). It numbered the sizes 1..n down the
             left of each cell, which was worth its 20px while the list ran
             vertically and the number was the only thing telling two identical
             dropdowns apart. Laid across, the sizes read in order by position
             and the number restated it -- and `sno` is stored from the array
             index at save, so nothing depended on it being drawn. */
          <div
            key={z.key}
            data-grid-row
            className="flex items-center gap-1.5 @lg/section:col-span-2"
          >
            <div className="min-w-0 flex-1">
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
              aria-label={`Remove size ${sizeLabel(z.size_id) || "(unset)"}`}
            >
              <Trash2 className="h-4 w-4 shrink-0" />
            </Button>
          </div>
        ))}
        {/* EMPTY-AND-EXPLAIN, never a silent blank. Only once a style has been
            picked: before that there is nothing to have fetched, and the line
            would be scolding the operator for not having answered yet. */}
        {r.style_id && r.sizes.length === 0 && (
          /* Its own line, not one cell of six — a sentence squeezed into a
             176px column would wrap to four lines and cost more height than the
             list it is explaining. */
          <p className="text-xs text-muted-foreground @lg/section:col-span-12">
            This style has no sizes recorded. Add them here, or fill them on the Style master.
          </p>
        )}
        {/* THE SAME BUTTON AS "+ Add style" (client 2026-08-14). That one is
            `ChildGrid`'s own — `variant="outline" size="sm"`, content-width, and
            it takes no className — so the only way to make the pair match is to
            match IT.

            It briefly filled its cell, on the reasoning that every control on
            the track should reach its column's edge. That is right for a FIELD
            and wrong for an action: the two Add buttons sit near each other and
            read as a pair, and one of them being twice the width of the other is
            the mismatch the operator actually sees. It keeps its column slot, so
            it still lines up with the sizes above it — it simply no longer
            stretches inside it. */}
        <Button
          type="button"
          variant="outline"
          size="sm"
          data-row-add
          /* `justify-self-start` is the part that actually does it, and dropping
             `w-full` alone did NOT: a grid item's default `justify-self` is
             STRETCH, so this button filled its column because it IS a grid cell,
             whatever its own display says. Content width has to be asked for.

             `ADD_BUTTON_W` is the width floor "+ Add style" BELOW IT reads too
             (see the constant above `sizeGrid`) — a size change here would make
             two controls that are meant to match differ for real, so this is a
             floor, applied to BOTH, never to one of them. */
          className={cn("justify-self-start @lg/section:col-span-2", ADD_BUTTON_W)}
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
          <span className="text-[11px] font-medium text-muted-foreground">
            {form.mult_ord ? "Multiple styles on this PO" : "One style per PO"}
          </span>
        }
        columns={styleColumns}
        rows={styles}
        forceCards
        listRows
        /**
         * FLUSH WITH THE HEADER ABOVE IT (client 2026-08-14).
         *
         * The style row's five fields did not line up with the header's six.
         * Same span (`xs`, 2 of 12) and the same track, but this grid drew its
         * own bordered card INSIDE the Order Info section — and that card's
         * `p-2` pushed the whole 12-column track 8px right and made it 16px
         * narrower. So Style sat 9px right of SCNo and every column after it
         * drifted by another ~1.3px: near enough to read as a mistake, far
         * enough to see.
         *
         * `frameless` is exactly this case — its own note says "drop the outer
         * bordered card so the grid can nest INSIDE a DetailSection without a
         * double border". The Order Info section already draws one card; this
         * was a second one inside it. The border and the padding go together,
         * which is why there is no prop for dropping only the padding: a border
         * with nothing between it and the fields would be worse than the
         * misalignment.
         *
         * The label band is untouched — "Styles Details" still heads the grid.
         */
        frameless
        pageSize={5}
/**
         * THE MULT. ORD CAP IS LIFTED (client 2026-08-17: "need add style
         * option in style details section"). This REVERSES the rule this grid
         * carried until then, and the reversal is deliberate rather than a
         * regression — a change that "fixes" it back is undoing what was asked
         * for, so the old reasoning is kept in full below.
         *
         * WAS: `hideAdd={!form.mult_ord && styles.length >= 1}`. A buyer's PO
         * names one style in ~98% of cases; occasionally one covers several (a
         * Men's and a Women's tee). Mult. Ord = Yes was the operator saying
         * "this PO is one of those", and until they said it the grid held
         * exactly one line. `hideAdd` was chosen over a check inside `addStyle`
         * because it did two things at once: removed the button AND made Enter
         * on the last field decline, so the keyboard could not get past it
         * either.
         *
         * WHAT WENT WRONG WITH IT is the second half of that sentence. The cap
         * removed the button entirely, so the ONLY route to a second style was
         * a toggle in the header — and the grid's own badge had to carry an
         * instruction ("tick Mult. Ord to add more") pointing at it. An
         * affordance that has to explain where its real control lives is the
         * control being in the wrong place.
         *
         * SO THE TOGGLE NOW FOLLOWS THE GRID rather than gating it: `addStyle`
         * sets `mult_ord` when it adds a second line, which keeps the stored
         * flag exactly as truthful as it was while removing the hunt. Nothing
         * outside this screen reads the column (only `types.ts` declares it),
         * so this changes a fact's AUTHOR, never its meaning.
         *
         * AND THE KEYBOARD COMES BACK WITH IT. Dropping `hideAdd` re-enables
         * Enter-on-the-last-row and the "+ Add lands the cursor in the new row"
         * landing, which is what every other grid in the app already does — the
         * exception was this one. It also has to be this way round: the landing
         * scopes to the button's own `[data-grid-body]` ancestry, so an add
         * control rendered anywhere but where ChildGrid puts it would leave the
         * cursor behind (`landOnAddedRow`, lib/focus.ts).
         *
         * STILL NON-DESTRUCTIVE. Un-ticking Mult. Ord on an order that lists
         * three styles never dropped the rows already entered, and still does
         * not — silently deleting two styles because a checkbox changed is data
         * loss dressed up as a rule.
         */
        onAdd={addStyle}
        onRemove={(r) => setStyles((xs) => xs.filter((x) => x.key !== r.key))}
        addLabel="+ Add style"
        /* Same floor as "+ Add size" above it — see `ADD_BUTTON_W`. */
        addClassName={ADD_BUTTON_W}
        renderMobileRow={(r, i) => {
          /* OPEN = the row the operator is on. `openStyleKey` unset resolves to
             the LAST row, so a fresh order and a loaded one both open on the one
             being worked at without any path having to seed it.

             A SINGLE STYLE NEVER COLLAPSES — there is no "next style" to move on
             to, and 98% of orders are one style, so the common case is untouched
             by this entirely. */
          const openKey = openStyleKey ?? styles[styles.length - 1]?.key ?? null;
          /* A ROW FOLDS ONCE IT NAMES A STYLE — nothing more.
             
             It used to require PO Qty as well, on the reasoning that a folded
             row's fields are UNMOUNTED, so a blank REQUIRED cell inside one
             would have no `data-required-empty` node for a blocked Save to land
             on. That reasoning was wrong, and checking it is what showed why:
             `canSave` gates on the HEADER and the Logistics fields only — never
             on a style row — so a blank PO Qty does not block Save, and the
             condition was protecting nothing while stopping the fold the client
             actually asked for (they enter styles first and quantities later,
             screenshot 2296: both rows open, both PO Qty blank).
             
             A style is still the one thing a row cannot fold without: with no
             style there is no identity to fold TO, and the summary would be a
             blank line the operator cannot tell from an empty row. */
          const isOpen = styles.length < 2 || r.key === openKey || !r.style_ref_no.trim();
          /* What a folded row says about itself: the unit, the quantity and the
             sizes it carries — the three an operator scans a PO for. Sizes are
             NAMED, not counted: a count is what the client has just had removed
             everywhere, and "M, L, XL" is the more useful answer anyway. */
          const summary = [
            unitTextOf(r),
            r.po_qty.trim(),
            r.sizes.map((z) => sizeLabel(z.size_id)).filter(Boolean).join(", "),
          ]
            .filter(Boolean)
            .join("  ·  ");
          /* WHAT THE FOLD WOULD OTHERWISE HIDE. Folding on style alone means a
             row can be put away with its PO Qty still blank, and the summary
             would simply not mention it — an absence the operator cannot see.
             So the row says so instead: the fold stays out of the way without
             quietly swallowing the one field it is still missing. */
          const missing = !r.po_qty.trim() ? "PO Qty missing" : null;
          return (
          <div
            className={cn(
              // `relative pr-10` carries the corner ✕ that replaced the `#N`
              // band: something has to hold it, and the padding is what keeps the
              // last field's label out from under it.
              "relative space-y-2 pr-10",
              // A folded row reads as one thing you can open, so it says so on
              // hover. The open row gets nothing — there is nothing to click.
              //
              // `pl-2`, NOT `px-2`: `px-*` and `pr-*` are the same twMerge group,
              // so a `px-2` declared after the `pr-10` above WINS on the right and
              // the corner ✕ lands back on top of the summary. Setting only the
              // side this needs is what keeps the two rules from fighting.
              !isOpen && "-mx-2 cursor-pointer rounded-md pl-2 hover:bg-surface-muted",
            )}
            title={isOpen ? undefined : "Open this style"}
            /* FOCUS OPENS THE ROW, which is what keeps this keyboard-operable:
               Tab out of one style lands on the next row's Style field and the
               row unfolds around the cursor. `onFocus` bubbles, so it catches
               both paths with one handler and no per-control wiring. */
            onFocus={() => {
              if (!isOpen) setOpenStyleKey(r.key);
            }}
            /* AND THE WHOLE FOLDED ROW OPENS ON CLICK. Focus alone left the
               mouse one target — the Style picker — which also opens its own
               list, so the only way back into a folded style was to open a
               dropdown one did not want. The summary is the larger part of the
               row and was inert.

               Buttons are excluded: the row's own ✕ sits inside this handler's
               reach, and expanding a row on the way to deleting it is a flicker
               with no purpose. */
            onClick={(e) => {
              if (isOpen) return;
              if ((e.target as HTMLElement).closest("button")) return;
              setOpenStyleKey(r.key);
            }}
          >
            {/* The ✕ alone, out of the flow — the `#N` beside it went with the
                rest of them (client 2026-08-17, screenshot 2332). A style line is
                named by its Style, which is the first field below. */}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              data-row-remove
              className="absolute right-0 top-0 text-muted-foreground hover:text-danger"
              onClick={() => setStyles((xs) => xs.filter((x) => x.key !== r.key))}
              aria-label="Remove style"
            >
              <Trash2 className="h-4 w-4 shrink-0" />
            </Button>
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
              * SIZES STAYS LAST, and since 2026-08-14 has a line of its own.
              * It is the one cell that grows with its data, so at the end it
              * extends the card downward; earlier in the row it would leave a
              * band of dead space beside five short fields, the trap
              * LAYOUT.md §3 names for a textarea sharing a row. Last is also
              * what the row's Tab order needs — `tabFieldsIn` walks a row in DOM
              * order, so the sizes come after the cells rather than between them.
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
              * FIVE FIELDS ON THE LINE, THEN SIZES ACROSS ITS OWN (client
              * 2026-08-14). All `xs` on `FieldGrid`'s standard 12-column track.
              *
              * THE SIZE LIST WAS THE COMPLAINT, and the note this replaces
              * predicted it: "if that becomes the complaint, the answer is to
              * move the list behind a button like Process — NOT to widen one
              * cell again." Half right. Widening one cell was indeed the wrong
              * answer, and had already been tried as a hand-rolled 14-column
              * track and reverted: with no sizes entered the cell holds one
              * "+ Add size" button, so the surplus read as a HOLE rather than as
              * room. A cell sized for its fullest state is empty space in its
              * commonest one.
              *
              * But the list did not have to hide behind a button either. Given
              * the WHOLE width it lays ACROSS instead of down, so six sizes take
              * one line rather than six — and stay visible, which is what the
              * legacy screen does and what the client meant by user-friendly.
              *
              * `full` (`col-span-12`) is what does it: the five `xs` cells
              * occupy 10 of 12, so Sizes cannot share their line and wraps to
              * its own. No custom track, no surplus — the span map already had
              * the answer.
              *
              * `xs` here is deliberate and is NOT the masters field width. That
              * rule governs a masters FORM; a child-grid row is a table line
              * rendered as fields, and its width is set by how many columns the
              * line carries. Do not "correct" these to `sm` — four per row is
              * the layout the client rejected twice.
              */}
            <FieldGrid>
              {/* A FOLDED ROW SHOWS ONLY ITS STYLE. Anchored on the header, not
                  on index 0 — these columns have been reordered more than once,
                  and `filter` fails loudly if Style is renamed where `slice(0,1)`
                  would quietly fold the wrong field. */}
              {(isOpen ? styleColumns : styleColumns.filter((c) => c.header === "Style")).map(
                (col) => (
                  <Field
                    key={col.header}
                    label={col.header}
                    required={col.required}
                    size="xs"
                  >
                    {col.cell(r, i)}
                  </Field>
                ),
              )}
              {/**
                * SIZES TAKES ITS OWN LINE, LAST (client 2026-08-14).
                *
                * It sat SECOND, right after Style, because that is where its
                * data comes from — and it was the tallest thing on the screen:
                * a 248px cell wedged between five 32px ones, which is what made
                * one style row ~425px against the legacy screen's ~170px.
                *
                * `full` is `col-span-12`. The five `xs` cells above occupy 10 of
                * the 12, so this cannot share their line and wraps to its own —
                * the effect comes out of the span map rather than a second
                * track. A hand-rolled 14-column track was built for exactly this
                * once and reverted, because a cell sized for its fullest state
                * is a hole in its commonest one; a full-width line has no such
                * surplus, since the sizes lay across it.
                *
                * LAST, NOT SECOND, and that is also what the row's Tab order
                * needs: `tabFieldsIn` walks a row in DOM ORDER, so the sizes
                * are reached after the cells rather than between them. The note
                * above `sizeGrid` said this was the arrangement all along — it
                * described the pre-08-12 layout and is true again.
                *
                * NO COUNT IN THE LABEL (client 2026-08-14). It read "Sizes (4)",
                * which earned its place while the list was a 180px cell that
                * could not show four sizes at once — the number said what the
                * cell could not. On a full-width line every size is visible, so
                * the count restates what is already on screen, one word to the
                * left of the answer.
                */}
              {isOpen ? (
                <Field key="__sizes" label="Sizes" size="full">
                  {sizeGrid(r)}
                </Field>
              ) : (
                /* `label=""` rather than no label: `Field` renders a `&nbsp;` in
                   that case precisely to reserve the label line, so the summary
                   sits level with the Style box beside it instead of 14px above
                   it. `xl` (8 of 12) beside Style's 2 fills the line.

                   `Truncated` because a long summary must stay READABLE, not
                   merely clipped — the standing rule that an ellipsis is a
                   promise the rest is reachable. */
                <Field key="__summary" label="" size="xl">
                  <div className="flex min-h-8 items-center">
                    <Truncated className="text-sm text-muted-foreground">
                      {summary || "Not filled in yet"}
                    </Truncated>
                    {missing && (
                      <span className="ml-3 shrink-0 text-xs text-warning">{missing}</span>
                    )}
                  </div>
                </Field>
              )}
            </FieldGrid>
          </div>
          );
        }}
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
          {/* TWO GRIDS A ROW, not stacked (client 2026-08-12, screenshots
              2269 · 2270): Yarn Dyeing beside Fabric Dyeing. It was four grids
              in a 2×2 until 2026-08-14 — Roll Form Prints and Structures made
              the second row, and both came off the tab (see the note where they
              stood). Stacked, the tab was a metre of scroll holding four short
              lists, and the pair that reads as a pair — the two dyeing grids,
              same two columns, same shape — was split across a scroll boundary
              where they could not be compared. That pair is what is left, so
              the rule now costs nothing to keep and still decides the layout if
              a third grid ever returns.

              `SectionGrid`, never a hand-written `grid-cols-2` (this skill's
              first rule, and the reason 29 grid literals exist in
              `components/masters`). Auto-placement gives exactly the order asked
              for, 1 2 / 3 4, and the container query means the same four grids
              fall back to one column inside anything narrower — a phone, or the
              nested picker this screen opens — with no prop to set. `items-start`
              is what stopped the short Prints grid stretching to the height of
              the grid beside it, and is why the two that remain sit level.

              BOTH CARRY `fill`, and that is the half that makes them read as a
              block rather than as two cards that happen to be near each other.
              Every column here declares a width, so each grid hugged its own
              content and the old 2×2 came out with four different right edges —
              Yarn Dyeing ~520px above Roll Form Prints ~350px (client
              2026-08-12, screenshot 2273). `fill` suppresses only the hug: the
              fields keep their declared widths and the slack falls to the right
              of them. */}
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
            {/* ROLL FORM PRINTS AND STRUCTURES WERE HERE, AND CAME OFF THE TAB
                ON THE CLIENT'S ASK (2026-08-14). Both were lists the operator
                had to fill in beside data the order already knew: Structures
                seeds itself from the style's own fabrics on every `pickStyle`
                (0415, "flow into this tab automatically to avoid duplicate data
                entry"), and its one hand-answered column — Fabric Type — is
                asked again, editably, on every combo structure. Prints were
                declared here only so the combo cell could offer them.

                THE STATE AND THE WRITE STAY, and that is not tidiness left
                undone. `applyRows` loads `prints` / `structures` off a saved
                order and `submit` writes them back; `writeChildren` DELETES and
                re-inserts, so state that stops round-tripping is state the next
                save erases. Dropping the grid hides two lists — dropping the
                state would silently delete them from every order already saved.

                What each removal cost, and where it was paid:
                  · Fabric Type per structure — a PREFILL only
                    (`pickComboStructure`, "SEEDS, NEVER OVERWRITES"). The combo
                    row still asks for it, so nothing became unanswerable.
                  · Fabric Print — was scoped to THIS grid with no fallback, so
                    removing the feeder would have left a permanently empty list
                    on a Printed component. `declaredPrintOptions` now falls back
                    to the full list when the order declares none. */}
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
          {/* ONE ROW PER STYLE, RATES BENEATH IT (client 2026-08-14), which is
              the legacy shape in screenshot 2295: a style's row carries a small
              `Combo · Price` table under it and the style is named once.

              The grid was `inlineCards` over the RAW rows, so a Size-wise order
              drew `STL/2627/0002` and `Size-wise` six times, once per size, each
              in its own bordered box ~90px tall (screenshot 2293). Nothing was
              wrong with the band it had chosen — three real inputs really is
              LAYOUT.md §6's `<=3 -> inlineCards` — because the band is about a
              ROW's width and the complaint was about the LIST's repetition. The
              answer is not a denser row, it is fewer rows: the style and the
              mode are properties of the group, and only the rate varies.

              `forceCards` + `renderMobileRow` for the same reason `stylesGrid`
              and the Combos ▸ Structure Details grid use them — a row that
              carries a nested list is past any width a table row has.

              THE STORED SHAPE IS UNCHANGED. `priceGroups` groups for display
              only; `price_details` still holds one row per (style, colour,
              size), which is what `styleRate` and the Logistic tab's Avg Rate
              read. `npm run check:order-value` is the proof of that. */}
          <ChildGrid<PriceGroup>
            label="Price Details"
            /* EMPTY ON PURPOSE: `renderMobileRow` owns the whole row, and a
               column declaring `required` that the row never reads would draw a
               header `*` with nothing behind it (`--check grid-required-mobile`).
               The `required` that matters is on the controls inside. */
            columns={[]}
            rows={priceGroups}
            forceCards
            rowSummary={(g) => {
              const v = priceGroupView(g);
              if (!g.refNo) return <span className="text-muted-foreground">New style price</span>;
              return v.isOpen ? g.refNo : `${g.refNo}  ·  ${v.summary}`;
            }}
            renderMobileRow={(g) => {
              const v = priceGroupView(g);
              return (
                <div
                  className="space-y-3"
                  /* FOCUS OPENS THE GROUP, which is what keeps the fold
                     keyboard-operable: Tab out of one style's rates lands on the
                     next group's Style field and the group unfolds around the
                     cursor. `onFocus` bubbles, so it catches mouse and keyboard
                     with one handler. */
                  onFocus={() => {
                    if (!v.isOpen) setOpenPriceKey(g.key);
                  }}
                >
                  <FieldGrid>
                    {/* A FOLDED GROUP KEEPS ITS STYLE FIELD. Tab lands on
                        fields, so a row rendering none would be reachable by
                        mouse only — the same requirement the Style(s) fold
                        records. */}
                    <Field label="Style" required size="md">
                      {priceStyleCell(g)}
                    </Field>
                    {v.isOpen && (
                      <Field label="Price Type" required size="md">
                        {priceModeCell(g, v.mode)}
                      </Field>
                    )}
                    {v.isOpen && (
                      <Field label="Unit" size="md">
                        {/* READ-ONLY FACT, not a field: it arrives with the
                            style line (its Order Unit) and there is nothing to
                            type. Rendered as text rather than a disabled input
                            so it neither invites a click nor sits in the Tab
                            path. */}
                        <div className="flex min-h-8 items-center text-sm text-muted-foreground">
                          {g.rows[0]?.unit || "—"}
                        </div>
                      </Field>
                    )}
                  </FieldGrid>
                  {v.isOpen && rateGrid(g, v.mode)}
                </div>
              );
            }}
            onAdd={addPriceDetail}
            /* REMOVING A GROUP TAKES ITS RATES WITH IT — the ✕ beside a style is
               the only control that names the style, so it can only mean "this
               style is not priced here". */
            onRemove={(g) => {
              const mine = new Set(g.rows.map((r) => r.key));
              setPriceDetails((xs) => xs.filter((x) => !mine.has(x.key)));
            }}
            addLabel="+ Add style price"
            /* The fourth of the four — see `PRICE_W` above `rateGrid`. */
            addClassName={PRICE_W}
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
            * CARDS. Eight columns, and until 2026-08-17 eleven — the widest
            * grid on the document, against 1180px of pane once the 228px rail is
            * taken and ~100rem of declared width. Cards are still right at
            * eight: the row lays them out on the `Field` track, which WRAPS.
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
            * screen whose whole job is to tell them apart. (The warehouse and the
            * port have since been withdrawn from this grid — see the columns.)
            *
            * `Assort` — the legacy [Click] that opens a size breakdown — is
            * still deliberately absent (client 2026-08-11); the table and its
            * Zod type carry no trace of it, so adding it later is additive.
            */}
          {/**
            * MULTI ORDER LIVES HERE, NOT IN THE HEADER (client 2026-08-17: "add
            * a separate Multi Order button. If enabled, it should open an extra
            * column in the quantity tab for multiple PO numbers").
            *
            * TWO REASONS, AND THE FIRST IS THE PRINCIPLE. A switch belongs with
            * what it gates: Multi Style captions the Style(s) grid and sits in
            * Order Info because that is where the style lines are; Pack opens
            * the Pack type(s) section and sits beside the fields it qualifies.
            * Multi Order opens ONE COLUMN OF THIS GRID, so the operator ticks
            * it and watches the column appear — rather than ticking something
            * two sections away and coming here to find out what it did.
            *
            * THE SECOND IS ARITHMETIC, and it is the reason the first one was
            * worth looking for. The header is TWELVE `xs` cells, 6 + 6, flush
            * against the twelve-column track — a count the file has already
            * been through twice (Pack and Mult. Ord were merged into one cell
            * to reach twelve, then split back when `Yr` was withdrawn and the
            * count changed). A thirteenth cell reads 6 · 6 · 1: one switch on a
            * line of its own against ten empty columns, which is a worse
            * version of the exact gap the client reported on 2026-08-17. There
            * is no span that fixes it either — 13 cells at one width can only
            * total 26 columns, and no arrangement of 26 divides by 12.
            *
            * `Toggle` is a real `<input type="checkbox">`, so Tab lands on it:
            * a `<button role="switch">` is not `isFieldLike()` and the
            * keyboard contract would step straight over it.
            */}
          <div className="mb-3 flex items-center gap-3">
            <Toggle
              id="qt-multiorder"
              checked={form.multi_order}
              onChange={(multi_order) => set({ multi_order })}
              label="Multi Order"
            />
            <span className="text-xs text-muted-foreground">
              {form.multi_order
                ? "Each line names the buyer PO it belongs to."
                : "One PO for the whole order — the header's PO No."}
            </span>
          </div>
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
            /* `listRows` drops ChildGrid's own `#N` band, which was a third line
               above two lines of fields. The row draws its own header below —
               summary and remove — exactly as the Styles grid does. */
            listRows
            renderMobileRow={(row, i) => {
              const openKey = openQtyKey ?? quantities[quantities.length - 1]?.key ?? null;
              /* Country is this row's identity, the way Style is a style row's:
                 with none there is nothing to fold TO and the summary would be a
                 blank line the operator cannot tell from an empty row. */
              const isOpen =
                quantities.length < 2 || row.key === openKey || !row.country_id;
              const byHeader = (h: string) => quantityColumns.find((c) => c.header === h);
              const primary = QTY_PRIMARY.map(byHeader).filter(Boolean) as ChildGridColumn<QuantityRow>[];
              const secondary = quantityColumns.filter(
                (c) => !QTY_PRIMARY.includes(c.header as (typeof QTY_PRIMARY)[number]),
              );
              const summary = [
                data.countries.find((c) => c.id === row.country_id)?.name,
                /* The PO number only when there is more than one to tell apart:
                   on a single-PO order it would repeat the header on every
                   folded line. */
                form.multi_order ? row.po_no.trim() || null : null,
                data.consignees.find((c) => c.id === row.consignee_id)?.name,
                row.po_qty.trim(),
                fmtDate(row.delivery_date) || null,
              ]
                .filter(Boolean)
                .join("  ·  ");
              return (
                <div
                  className={cn(
                    // See the Styles row above — the corner ✕ needs a `relative`
                    // to hang on and the padding to keep clear of the fields.
                    "relative space-y-2 pr-10",
                    // `pl-2` not `px-2` — see the Styles row: `px-*` would
                    // outrank the `pr-10` that keeps the ✕ off the summary.
                    !isOpen && "-mx-2 cursor-pointer rounded-md pl-2 hover:bg-surface-muted",
                  )}
                  title={isOpen ? undefined : "Open this quantity line"}
                  onFocus={() => {
                    if (!isOpen) setOpenQtyKey(row.key);
                  }}
                  onClick={(e) => {
                    if (isOpen) return;
                    if ((e.target as HTMLElement).closest("button")) return;
                    setOpenQtyKey(row.key);
                  }}
                >
                  {/* The ✕ alone, out of the flow — see the Styles grid above
                      and `ChildGrid`'s cards band. A quantity line is named by
                      its Country, which is the field it folds to. */}
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    data-row-remove
                    className="absolute right-0 top-0 text-muted-foreground hover:text-danger"
                    onClick={() => setQuantities((xs) => xs.filter((x) => x.key !== row.key))}
                    aria-label="Remove quantity line"
                  >
                    <Trash2 className="h-4 w-4 shrink-0" />
                  </Button>
                  <FieldGrid>
                    {(isOpen ? [...primary, ...secondary] : primary.slice(0, 1)).map((c) => (
                      /* One line for all eight — see QTY_NARROW for the split
                         and why it is stated there rather than here. A folded
                         row keeps Country at that same narrow width, so the
                         summary beside it reads on one line either way. */
                      <Field
                        key={c.header}
                        label={c.header}
                        required={c.required}
                        size="xs"
                        className={
                          QTY_NARROW.includes(c.header as string)
                            ? "@lg/section:col-span-1"
                            : undefined
                        }
                      >
                        {c.cell(row, i)}
                      </Field>
                    ))}
                    {!isOpen && (
                      <Field key="__summary" label="" size="xl">
                        <div className="flex min-h-8 items-center">
                          <Truncated className="text-sm text-muted-foreground">
                            {summary || "Not filled in yet"}
                          </Truncated>
                        </div>
                      </Field>
                    )}
                  </FieldGrid>
                </div>
              );
            }}
            onAdd={() => {
              const row = blankQuantity();
              setQuantities((xs) => [...xs, row]);
              setOpenQtyKey(row.key);
            }}
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

              THERE ARE NO WIDTHS BELOW. `approvalQtyColumns` declares none —
              `hugsContent` is a table/inline concern and the cards branch
              ignores `width` entirely, so there was nothing to keep. (A note
              here used to say they were "left in place deliberately"; they were
              not left, they were never written, and a comment describing
              columns that do not exist is the kind that survives long enough to
              be believed.)

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
            renderMobileRow={(row, i) => {
              /**
               * THE CALCULATION READS ALONG THE FIRST LINE (client 2026-08-14).
               *
               * Eight fields at the one width are 16 of 12 columns, so they wrap
               * 6 + 2 — and the two that fell to the second line were Projection
               * and Total Production: the allowance and the ANSWER, orphaned
               * below the figures they come from.
               *
               * Reordered so the line carries the chain an operator follows —
               * Qty, Approval Qty, Projection, Total Production — beside the
               * identity that names it. What moves down is CONTEXT: Style PO Qty
               * is the style's overall figure (the Quantities tab's number, not
               * this combo's), and Excess is derived from the header's own %.
               *
               * EIGHT INTO SIX DOES NOT GO, and that is the trade rather than an
               * oversight: something had to take the second line. Total
               * Production is what the floor plans raw material against, so it
               * was never a candidate — if Excess turns out to be read more than
               * Style PO Qty, swap those two and the line still works.
               */
              const order = [
                "Style",
                "Combo",
                "Qty",
                "Approval Qty",
                "Projection",
                "Total Production",
              ];
              const rank = (h: string) => {
                const at = order.indexOf(h);
                return at === -1 ? order.length : at;
              };
              /* KEYED BY THE COLUMN'S ORIGINAL INDEX, never by its header: the
                 Excess header is a template literal carrying the live percentage,
                 so a header key remounts that field on every keystroke in Excess
                 % and drops the cursor. Sorting must not change the keys. */
              const ordered = approvalQtyColumns
                .map((c, ci) => ({ c, ci }))
                .sort((a, b) => rank(a.c.header as string) - rank(b.c.header as string));
              return (
                <FieldGrid>
                  {ordered.map(({ c, ci }) => {
                    /**
                     * ALL EIGHT ON ONE LINE (client 2026-08-14), by giving the
                     * figures a narrower cell than the pickers:
                     *
                     *   Style 3 + Combo 3 + six figures × 1 = 12, exactly.
                     *
                     * The eight were 16 of 12 at the one width and had to wrap.
                     * Every field that is not a picker here holds a QUANTITY —
                     * four digits and right-aligned — so one column (~80px) is
                     * width it can use, where a Style picker at that size would
                     * show two characters of a name.
                     *
                     * NO PRIMITIVE CHANGE AND NO HAND-ROLLED GRID. `Field` merges
                     * `className` AFTER its span (field.tsx), so a col-span here
                     * wins; and `@lg/section:col-span-*` is the layout contract's
                     * own vocabulary, which `--check screen-grid` never flags —
                     * unlike a bare `grid-cols-*`, which is what a custom track
                     * would have needed.
                     *
                     * "Total Production" is shortened on the LABEL only. At 80px
                     * it is the one header that wraps to two lines, and one cell
                     * standing a line taller than its seven neighbours is the
                     * ragged edge this row was reordered to remove. The column
                     * keeps its full name everywhere else — the totals band, the
                     * table fallback and the export all read `c.header`.
                     */
                    const isPicker = c.header === "Style" || c.header === "Combo";
                    const label =
                      c.header === "Total Production" ? "Total Prod." : c.header;
                    return (
                      <Field
                        key={ci}
                        label={label}
                        required={c.required}
                        size={isPicker ? "sm" : "xs"}
                        className={isPicker ? undefined : "@lg/section:col-span-1"}
                      >
                        {c.cell(row, i)}
                      </Field>
                    );
                  })}
                </FieldGrid>
              );
            }}
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
              {/* `size="xs"` (2 of 12), SIX per row, so these fields line up
                  with the Order Info section rather than agreeing with it by
                  coincidence. They were `sm` (four per row) until 2026-08-14;
                  the whole screen moved together, because a density that
                  changes as you move down the rail is the thing the client was
                  reading as clutter.

                  TWO EXCEPTIONS, AND THEY EXIST TO KEEP THE ROWS FLUSH (client
                  2026-08-17). Ten fields at `xs` is twenty columns — six on the
                  first row and FOUR on the second, which ends a third of the
                  way short. Ten cells cannot tile a 12-column row at one size,
                  so two of them take `md` (4) and the section reads 6 + 4 with
                  no hole: `Pay Terms`, which holds the longest value here
                  ("TT 30 DAYS FROM BL DATE" clipped at 202px), and
                  `Gross Value`, the total the row ends on. Promote a field
                  because its DATA wants the width, never whichever one happens
                  to be last — the arithmetic only says how many.

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
              <Field label="Ship Type" required size="xs">
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
              <Field label="Ship Mode" required size="xs" htmlFor="lg-shipmode">
                <Select
                  id="lg-shipmode"
                  value={form.ship_mode}
                  onChange={(e) => set({ ship_mode: e.target.value })}
                >
                  <option value=""></option>
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
              <Field label="Country" required size="xs">
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
              <Field label="Currency" required size="xs">
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
              <Field label="Ex-Rate" size="xs" htmlFor="lg-exrate">
                <Input
                  id="lg-exrate"
                  type="number"
                  value={form.ex_rate}
                  onChange={(e) => set({ ex_rate: e.target.value })}
                />
              </Field>
              <Field label="Pay Mode" required size="xs" htmlFor="lg-paymode">
                <Select
                  id="lg-paymode"
                  value={form.pay_mode}
                  onChange={(e) => set({ pay_mode: e.target.value })}
                >
                  <option value=""></option>
                  {PAY_MODES.map((o) => (
                    <option key={o} value={o}>{o}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Pay Terms" required size="md">
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
              <Field label="Days" size="xs" htmlFor="lg-days">
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
              <Field label="Avg Rate" size="xs" htmlFor="lg-avgrate">
                <Input
                  id="lg-avgrate"
                  readOnly
                  className="text-right"
                  value={orderVal.avgRate == null ? "" : String(orderVal.avgRate)}
                />
              </Field>
              <Field label="Gross Value" size="md" htmlFor="lg-gross">
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
   * SIX FIELDS A ROW, EVERY FIELD THE SAME WIDTH (client 2026-08-14).
   *
   * `xs` is `col-span-2` on `FIELD_TRACK`'s twelve columns, so six sum to
   * exactly 12. It is the ONLY span that puts six on a line: `sm` (3 of 12)
   * gives four, `lg` (6 of 12) gives two. Thirteen fields therefore read
   * 6 · 6 · 1, and the spare columns fall at the END of the last row rather
   * than between the fields.
   *
   * The client reported the screen as hard to read and diagnosed it as fields
   * being too long — width spent on values that do not need it, so the form
   * sprawled. Five of these were already `xs` on their instruction (2026-08-12,
   * the row of order terms); this finishes the thought across all thirteen.
   *
   * STILL ONE WIDTH, JUST A NARROWER ONE. Nothing here is sized to its own
   * data, so a Yr box and an SCNo picker line up down the page — that half of
   * the rule is unchanged and is what "evenly aligned" meant when the client
   * was asked which way to resolve it.
   *
   * `xs` IS NOT THE MASTERS FIELD WIDTH, and must not be swept into
   * `components/masters/**`. The one-width-`sm` rule governs a masters FORM,
   * eight fields describing one reference record. This is a 53-field document
   * editor across nine rail sections, and the two are deliberately no longer
   * the same density — the Styles row and the Assortments size cells already
   * made that distinction in writing.
   *
   * DO NOT WIDEN THE LAST FIELD to fill the trailing gap. That was tried, as a
   * hand-rolled 14-column track so one cell could be double width, and the
   * surplus read as a HOLE rather than as room: a cell sized for its fullest
   * state is empty space in its commonest one.
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
      <SectionBody title="Order Info">
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
          <Field label="SCNo" size="xs" htmlFor="hd-scno">
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
          <Field label="Unit" required={!editId} size="xs">
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
          <Field label="Date" required size="xs" htmlFor="hd-date">
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
          <Field label="Customer" required size="xs">
            <RecordPicker
              label="Customer"
              compact
              items={data.customers}
              value={form.customer_id}
              onChange={(id) => set({ customer_id: id })}
            />
          </Field>
          <Field label="PO No" size="xs" htmlFor="hd-pono">
            <Input id="hd-pono" value={form.po_no} onChange={(e) => set({ po_no: e.target.value })} />
          </Field>
          <Field label="Merchand." size="xs">
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
          <Field label="Deli.Dt" size="xs" htmlFor="hd-deli">
            <Input id="hd-deli" type="date" value={form.delivery_date} onChange={(e) => set({ delivery_date: e.target.value })} />
          </Field>
          <Field label="Season" size="xs" htmlFor="hd-season">
            <Select id="hd-season" value={form.season} onChange={(e) => set({ season: e.target.value })}>
              <option value=""></option>
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
            * and Mult. Ord are `w-fit` switches, so at `sm` most of each cell
            * was trailing space. A narrower cell puts them next to the fields
            * they qualify.
            *
            * SINCE 2026-08-14 THE WHOLE HEADER IS `xs`, and since 2026-08-17
            * Pack and Mult. Ord are a cell each again, so this row is Deli.Dt ·
            * Season · Excess % · Pack · Mult. Ord · Rejection Rule — SIX cells
            * and twelve columns, flush. Eleven header cells left the row two
            * columns short; twelve fill it. See the note on the switches below
            * for why the merge was arithmetic rather than grouping.
            *
            * YR WAS THE SIXTH AND IS WITHDRAWN (client 2026-08-14): the year is
            * already defined on the linked Style Master (`style_year`), so
            * re-typing it on the order was a second place to state one fact.
            * Withdrawn the way this file withdraws every field — the
            * `amend_year` COLUMN and its stored values stay, and it left
            * `garmentAmendmentInput` too, which is the half that stops an
            * update writing NULL over what is already there.
            *
            * SEASON DID NOT GO WITH IT, and the asymmetry is deliberate: Season
            * is a live FACET, the second one narrowing the Style picker
            * (`styleOptionsFor`). Yr narrowed nothing and fed nothing.
            */}
          <Field label="Excess %" size="xs" htmlFor="hd-excess">
            <Input id="hd-excess" type="number" value={form.excess_pct} onChange={(e) => set({ excess_pct: e.target.value })} />
          </Field>
          {/**
            * PACK AND MULT. ORD ARE A CELL EACH — as switches, and adjacent
            * (client 2026-08-14 for the switches, 2026-08-17 for the split).
            *
            * THEY SHARED A CELL FOR ONE TURN, AND THE REASON WAS ARITHMETIC.
            * On 08-14 the client asked for switches and for Rejection Rule to
            * join this row, which was already full at six: two booleans in one
            * cell freed the sixth slot, bringing the header to twelve cells —
            * "twelve cells fill two rows flush", against the thirteen it held
            * before, where the last row carried one field against ten empty
            * columns.
            *
            * THEN `Yr` WAS WITHDRAWN THE SAME DAY AND NOTHING RECOUNTED.
            * Eleven cells is 6 + 5, so the second row ended two columns early
            * and the header carried the very orphan the merge removed — which
            * is what the client reported as a gap (2026-08-17). Splitting them
            * back is not undoing the 08-14 decision; it is finishing it, since
            * the merge was arithmetic and the arithmetic changed.
            *
            * THE MERGE ALSO COST TWO THINGS THE SPLIT GETS BACK. Two `w-fit`
            * switches never fitted 202px side by side, so `flex-wrap` stacked
            * them and that one cell stood two rows tall against ten single-row
            * fields (screenshot 2320). And the cell read "Pack / Mult. Ord"
            * with "Pack" and "Mult. Ord" printed again on the switches inside
            * it — `Toggle`'s own note says to "omit [the label] where a
            * `<Field>` label already names the answer", so the `<Field>` names
            * each one and `htmlFor` carries the accessible name onto the
            * checkbox.
            *
            * THEY STAY ADJACENT, which is what "they belong together" actually
            * needs: both are the order's shape rather than its content —
            * whether it is packed to a scheme, and whether it carries more than
            * one style — and each gates something below (Pack opens the Pack
            * type(s) section; Mult. Ord caps Style(s) to one row). Two
            * neighbouring cells say that as well as one shared cell did.
            *
            * `Toggle` is a real `<input type="checkbox">` underneath. A
            * `<button role="switch">` is not `isFieldLike()`, so Tab would step
            * straight over both of these — see the component's own note.
            */}
          <Field label="Pack" size="xs" htmlFor="hd-pack">
            <Toggle id="hd-pack" checked={form.pack} onChange={(pack) => set({ pack })} />
          </Field>
          {/**
            * "MULTI STYLE", NOT "Mult. Ord" (client 2026-08-17). The client
            * asked for a Multi Style option and a SEPARATE Multi Order button,
            * and this switch has always been the first of the two: it captions
            * the Style(s) grid ("Multiple styles on this PO") and `addStyle`
            * turns it on when a second style line appears. Only the WORD was
            * wrong, inherited from the legacy screen's `Mult.Ord` column.
            *
            * THE COLUMN KEEPS ITS NAME. `mult_ord` is what every stored row,
            * `toRows`, the diff and the Order Sheet already read; renaming it
            * would rewrite all of that for a label. 0427 says so in a column
            * comment, which is where the next reader of the schema will look.
            *
            * MULTI ORDER IS NOT BESIDE IT, and that is arithmetic as much as
            * meaning — see the note on the Quantities tab, which is where it
            * lives and what it opens.
            */}
          <Field label="Multi Style" size="xs" htmlFor="hd-multord">
            <Toggle
              id="hd-multord"
              checked={form.mult_ord}
              onChange={(mult_ord) => set({ mult_ord })}
            />
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
    /**
     * REASON IS AN AMENDMENT'S SECTION, NOT AN ORDER'S (client 2026-08-17:
     * "completely remove the Reason field/section as it is unnecessary for this
     * stage").
     *
     * ON THE RAISE DOOR ONLY. One component serves two: `/orders/garment-orders`
     * ENTERS an order and `/orders/amendments` AMENDS one, and "why is this
     * being amended?" has no answer while the order is being raised for the
     * first time — which is what made the tab read as noise. It is the whole
     * point of an amendment on the other door: `/orders/approve-amendments`
     * shows `reason_text` as a COLUMN on its queue
     * (approve-amendment-screen.tsx:163), so an approver picks the amendment up
     * and reads why before deciding. Removing the section outright would leave
     * that column permanently blank.
     *
     * THE THREE "Amendment In" BOOLEANS ARE READ BY NOTHING ELSE, and that was
     * checked rather than assumed — the plan for this change said the approval
     * screen routes on them, and it does not: `amend_in_*` appears only in this
     * screen, in the row type and in the Zod input (`grep -rn amend_in`). They
     * are stored, and `diff.ts` reports them, and that is all. So the case for
     * keeping this section on the amend door rests on `reason_text`; the
     * checkboxes ride along with it rather than justifying it.
     *
     * FILTERED HERE RATHER THAN BUILT CONDITIONALLY, so the section keeps
     * existing in one place and the two doors differ by one predicate. And
     * nothing about the DATA changes: `amend_in_*` and `reason_text` stay in the
     * form, in the payload and in the Zod input on both doors, so an order
     * raised through this door writes exactly what it wrote before (false,
     * false, false, null) instead of nulling a column it no longer shows.
     */
    ...tabs
      .filter((t) => t.key !== "reason" || amending)
      .map((t) => ({
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
        /* NO DERIVED BACK LINK ON THE EDITOR — the one case `backTarget` cannot
           see. `PageHeader` resolves a "← Back to <parent>" off the nav registry
           by ROUTE, and this route's editor is not a page the operator navigated
           TO: it is a mode of the same route, entered by clicking a row. The
           derived link would sit beside the "← Back to list" button below it,
           two arrows on one row aimed at different places, and the derived one
           would leave the screen with an unsaved order open.

           THE LIST BRANCH KEEPS THE DEFAULT, deliberately: there the parent IS a
           real destination, and because the registry answers per route, the one
           component gives "← Back to Order Setup" at /orders/garment-orders and
           "← Back to Amendments" at /orders/amendments with no `purpose` branch
           of its own. */
        back={false}
        /* NO DESCRIPTION IN THE EDITOR (client 2026-08-14). It said "Fill the
           header, then work down the tabs. The SC No is minted on save." — read
           once, then ~22px on every visit thereafter, on the screen being
           reported as cramped. The title and Back to list stay: those name the
           record and get the operator out, which a description does not.

           The LIST-mode header keeps its own, deliberately. A list is where
           someone arrives without context; an editor is not. */
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
        footer={<SubSheetFooter onDone={() => setDetailComboKey(null)} />}
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
        footer={<SubSheetFooter onDone={() => setAssortQtyKey(null)} />}
      >
        {assortQty && (
          <div className="space-y-4">
            {assortHeader(assortQty)}
            <FieldGrid>
              <Field label="Pack" size="xs">
                <Input
                  uppercase
                  value={assortQty.pack}
                  onChange={(e) => setQty(assortQty.key, { pack: e.target.value })}
                />
              </Field>
              <Field label="Ratio For" size="xs">
                {/* 0328's tuple, and the column carries the same CHECK — so a
                    free-text box here would fail on save rather than on entry. */}
                <Select
                  value={assortQty.ratio_for}
                  onChange={(e) => setQty(assortQty.key, { ratio_for: e.target.value })}
                >
                  <option value=""></option>
                  <option value="master">Master</option>
                  <option value="inner">Inner</option>
                </Select>
              </Field>
              <Field label="Master CTN Name" size="md">
                <Input
                  uppercase
                  value={assortQty.master_carton_name}
                  onChange={(e) =>
                    setQty(assortQty.key, { master_carton_name: e.target.value })
                  }
                />
              </Field>
              <Field label="Inner CTN Name" size="md">
                <Input
                  uppercase
                  value={assortQty.inner_carton_name}
                  onChange={(e) =>
                    setQty(assortQty.key, { inner_carton_name: e.target.value })
                  }
                />
              </Field>
              <Field label="Pack Description" size="full">
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
        * STYLE(S) ▸ PROCESS WITHDRAWN (client 2026-08-17): "remove Processed as
        * Trim and the Garment Process child entry section entirely, as these
        * details are covered elsewhere." Elsewhere is Order Setup ▸ Garment
        * Process Plan, which is a step of its own since 2026-08-14.
        *
        * WHAT WENT: the `Process` column on the Style(s) row, the sheet it
        * opened (`StyleProcessSheet`, 0411) and the `processFor` pointer.
        *
        * WHAT STAYED, and this is the half that keeps stored work alive:
        * `StyleRow.processes`, the `toRows` mapping that loads it and the
        * `style_processes` array in the save payload. `writeChildren` deletes
        * and re-inserts every child grid wholesale, so a list dropped from the
        * payload is not merely hidden — it is DELETED from every order already
        * carrying one, on the next save of that order, silently. The rows now
        * round-trip untouched: loaded, held, written back exactly as they came.
        *
        * The sheet component itself is left in `components/orders/` — it is a
        * shared primitive and not this lane's to remove, and nothing else has
        * to change for this screen to stop opening it.
        */}
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
