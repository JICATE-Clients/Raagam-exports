"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
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
import { ChildGrid, type ChildGridColumn } from "@/components/masters/child-grid";
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
import { fmtDate, fmtNumber } from "@/lib/format";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { useCreateIntent } from "@/lib/use-create-intent";
import { isInactive } from "@/lib/masters/inactive";
import { previewOrderNumber } from "@/lib/orders/actions";
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
import type { FabricTypeCounts, SeededAmendmentChildren } from "@/lib/orders/amendments/order-seed";
import {
  INITIATED_OPTIONS,
  AMEND_TYPE_OPTIONS,
  PACK_TYPE_OPTIONS,
  PRICE_TYPE_OPTIONS,
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
  /** The operator's home Unit (`profiles.default_location_id`), or null. */
  defaultLocationId: string | null;
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
/**
 * Pack type(s) tab (0399) — the legacy grid is S No + Pack Type and nothing
 * else, so the row is its one value.
 */
type PackTypeRow = { key: string; pack_type: string };
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
    })),
  };
}

type HeaderForm = {
  // order header
  sales_order_id: string | null;
  /** The Unit the SC No is numbered under. Lives on `sales_orders`, not here. */
  location_id: string | null;
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
  location_id: null,
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

export function AmendmentScreen({ rows, data, perms, masterPerms, defaultLocationId }: Props) {
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
  });
  const blankDyeing = (section: "yarn" | "fabric"): DyeingRow => ({
    key: newKey(),
    section,
    dye_type: "",
    color_id: null,
  });
  const blankPrint = (): PrintRow => ({ key: newKey(), print_id: null });
  const blankStructure = (): StructureRow => ({ key: newKey(), structure_id: null });
  const blankCombo = (): ComboRow => ({
    key: newKey(),
    style_ref_no: "",
    style: "",
    article_no: "",
  });
  const blankPriceDetail = (): PriceDetailRow => ({
    key: newKey(),
    style_ref_no: "",
    style: "",
    article_no: "",
    price_type: "",
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
  });
  const blankApprovalQty = (): ApprovalQtyRow => ({
    key: newKey(),
    style_ref_no: "",
    style: "",
    article_no: "",
    approval_qty: "",
  });
  const blankPackType = (): PackTypeRow => ({ key: newKey(), pack_type: "" });
  const blankStylePrice = (): StylePriceRow => ({
    key: newKey(),
    style_ref_no: "",
    style: "",
    price: "",
    csp_type: "",
    csp_price: "",
    fob_buyer_price: "",
    fob_selling_price: "",
  });

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
    setStylePrices((xs) => (xs.length ? xs : [blankStylePrice()]));
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
  /**
   * `fabric_structure`, NOT `structure`.
   *
   * The `structure` kind holds 0 rows and always has; the real list is
   * `fabric_structure` (Circular Knit / Flat Knit / Woven). 0396 diagnosed this
   * across the Style screen and called it "a PATTERN rather than a one-off",
   * then repointed only the Style side — leaving this picker as one of the
   * "dropdowns over nothing" that migration was written to eliminate.
   *
   * No FK moves: `fabric_structure` rows ARE `config_lookups` rows, so only the
   * kind the screen filters on changes. 0396 records that too, "because the next
   * reader will otherwise look for the missing third statement".
   */
  const structureOpts = useMemo(
    () => lookups.filter((l) => l.kind === "fabric_structure"),
    [lookups],
  );
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

  /** The style line's Order Unit, as the text this tab stores. */
  const unitTextOf = (r: StyleRow) =>
    (r.order_unit_id ? data.uoms.find((u) => u.id === r.order_unit_id) : null)?.name ?? "";

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
    setSavedOrderNo(null);
    setPreviewNo(null);
    setForm({ ...BLANK, amend_date: today(), location_id: startingLocationId });
    setStylePrices([]);
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
    if (!form.location_id || !form.buyer_id) {
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
        {/* NAMED FOR WHAT THIS SCREEN IS (client 2026-08-11). It is the garment
            order screen — the legacy header and the ten-section rail — and its
            sidebar row is now Order Entry ▸ Garment Order. A row reading
            "Garment Order" over a page headed "Garment Order Amendment" would
            leave half the reported confusion in place. The route, the table and
            the Amendments card are all unchanged. */}
        <PageHeader
          title="Garment Orders"
          description="Garment orders — styles, colours, prices, packing, quantities & logistics."
          actions={
            perms.canCreate ? <Button onClick={openAdd}>New Garment Order</Button> : undefined
          }
        />
        <DataTable
          columns={withCreatedColumns(columns, rows)}
          rows={rows}
          getKey={(r) => r.id}
          empty="No garment orders yet. Use 'New Garment Order' to create the first."
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
    !!form.buyer_id &&
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
   * ORDER UNIT AND PLAN UNIT BOTH COME FROM THE STYLE'S ONE UNIT. `garment_styles`
   * carries a single `unit_id` (-> `uoms`, the same master these two pickers read),
   * defined on the Style Entry's General tab; an order line splits it into the
   * unit the goods are ORDERED in and the unit they are PLANNED in, which are the
   * same until someone says otherwise. Seeding both is a PREFILL, not a lock —
   * either can be changed on the line, which is the distinction Fabric's Base UoM
   * had to relearn three times.
   *
   * PO Qty is deliberately NOT seeded: it is the one number that comes off the
   * buyer's order sheet and nowhere else.
   *
   * Clearing the Style clears what it filled. Leaving a previous style's article
   * number and units behind on a line that now names a different style is worse
   * than a blank row, because it reads as data.
   */
  const pickStyle = (key: string, id: string | null) => {
    const s = id ? styleById.get(id) : null;
    updateStyle(key, {
      style_id: id,
      article_no: s?.article_no ?? "",
      style_category: s?.style_category ?? "",
      style_description: s?.style_description ?? "",
      // `?? null` rather than `?? ""`: these are FK columns, and "" is not a uuid.
      order_unit_id: s?.unit_id ?? null,
      plan_unit_id: s?.unit_id ?? null,
      // The line's Description is the style's remarks, falling back to its
      // description — the two fields legacy shows as "Style Description".
      description: s ? (s.description ?? s.style_description ?? "") : "",
    });
  };

  const addDyeing = (section: "yarn" | "fabric") =>
    setDyeings((xs) => [...xs, blankDyeing(section)]);
  const addPrint = () => setPrints((xs) => [...xs, blankPrint()]);
  const addStructure = () => setStructures((xs) => [...xs, blankStructure()]);
  const addCombo = () => setCombos((xs) => [...xs, blankCombo()]);
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
    styles: has(styles),
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
    {
      header: "Style Ref No",
      cell: (r) => (
        <Input
          value={r.style_ref_no}
          onChange={(e) => updateStyle(r.key, { style_ref_no: e.target.value })}
        />
      ),
    },
    {
      header: "Style",
      // A line with no style is not a line. Red ⓘ on the legacy grid.
      required: true,
      cell: (r) => (
        <div className="space-y-1">
          <RecordPicker
            label="Style"
            compact
            items={styleItems}
            value={r.style_id}
            onChange={(id) => pickStyle(r.key, id)}
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
      ),
    },
    {
      header: "Order Unit",
      // The PO Qty is meaningless without the unit it is counted in. Costs the
      // operator nothing — `pickStyle` fills it from the Style Entry.
      required: true,
      cell: (r) => (
        <RecordPicker
          label="Order Unit"
          compact
          items={data.uoms}
          value={r.order_unit_id}
          onChange={(id) => updateStyle(r.key, { order_unit_id: id })}
        />
      ),
    },
    {
      header: "Plan Unit",
      required: true,
      cell: (r) => (
        <RecordPicker
          label="Plan Unit"
          compact
          items={data.uoms}
          value={r.plan_unit_id}
          onChange={(id) => updateStyle(r.key, { plan_unit_id: id })}
        />
      ),
    },
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
      header: "Process",
      cell: () => (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled
          title="Nested Process screen — awaiting spec"
        >
          Process
        </Button>
      ),
    },
  ];

  /**
   * Yarn / Fabric dyeing, prints and structures — one or two inputs a row, which
   * LAYOUT.md §6 puts in the "<=3 -> inlineCards" band: a flex row per record
   * under one shared header, never a stacked card. Carding a two-input row would
   * be worse than the table it replaces.
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
      cell: (r) => (
        <RecordPicker
          label="Colour"
          compact
          items={dyeColorItems}
          value={r.color_id}
          onChange={(id) =>
            setDyeings((xs) => xs.map((x) => (x.key === r.key ? { ...x, color_id: id } : x)))
          }
        />
      ),
    },
  ];

  const printColumns: ChildGridColumn<PrintRow>[] = [
    {
      header: "Print",
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

  const structureColumns: ChildGridColumn<StructureRow>[] = [
    {
      header: "Structure",
      cell: (r) => (
        <LookupDialogPicker
          kind="fabric_structure"
          label="Structure"
          compact
          options={structureOpts}
          value={r.structure_id}
          onChange={(id) =>
            setStructures((xs) => xs.map((x) => (x.key === r.key ? { ...x, structure_id: id } : x)))
          }
          canCreate={masterPerms.canCreate}
          canEdit={masterPerms.canEdit}
        />
      ),
    },
  ];

  /** Combos — three text inputs, LAYOUT.md §6's "<=3 -> inlineCards" band. */
  const comboColumns: ChildGridColumn<ComboRow>[] = (
    [
      ["Style Ref No", "style_ref_no"],
      ["Style", "style"],
      ["Article No", "article_no"],
    ] as [string, keyof ComboRow][]
  ).map(([header, field]) => ({
    header,
    cell: (r: ComboRow) => (
      <Input
        value={String(r[field] ?? "")}
        onChange={(e) =>
          setCombos((xs) => xs.map((x) => (x.key === r.key ? { ...x, [field]: e.target.value } : x)))
        }
      />
    ),
  }));

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
  const priceDetailColumns: ChildGridColumn<PriceDetailRow>[] = [
    {
      header: "Style",
      required: true,
      width: "16rem",
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
      cell: (r) => (
        <Select
          value={r.price_type}
          onChange={(e) =>
            setPriceDetails((xs) =>
              xs.map((x) => (x.key === r.key ? { ...x, price_type: e.target.value } : x)),
            )
          }
        >
          <option value="">—</option>
          {PRICE_TYPE_OPTIONS.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </Select>
      ),
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
  /** The PO Qty of the Style(s) line this row names. 0 when it names none. */
  const poQtyOf = (r: ApprovalQtyRow) => {
    const key = r.style_ref_no.trim();
    if (!key) return 0;
    return Number(styles.find((x) => x.style_ref_no.trim() === key)?.po_qty) || 0;
  };
  const excessQtyOf = (r: ApprovalQtyRow) => Math.ceil((poQtyOf(r) * excessPct) / 100);
  const approvalOf = (r: ApprovalQtyRow) => Number(r.approval_qty) || 0;
  const totalQtyOf = (r: ApprovalQtyRow) => poQtyOf(r) + excessQtyOf(r) + approvalOf(r);

  /** A derived figure, shown as text — never an input, so it cannot be edited
   *  into disagreeing with the sum it comes from. */
  const derivedCell = (n: number) => (
    <span className="block text-right text-sm tabular-nums text-muted-foreground">
      {fmtNumber(n)}
    </span>
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

  const quantityColumns: ChildGridColumn<QuantityRow>[] = [
    {
      header: "Country",
      width: "9rem",
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
      width: "8rem",
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
      width: "12rem",
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
      width: "12rem",
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
      width: "7rem",
      total: { kind: "sum", of: (r) => Number(r.po_qty) || 0 },
      cell: (r) => (
        <Input
          className="h-8 text-right"
          inputMode="decimal"
          value={r.po_qty}
          onChange={(e) => setQty(r.key, { po_qty: e.target.value })}
        />
      ),
    },
    {
      header: "Delivery Dt",
      width: "10rem",
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
      width: "10rem",
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
      width: "12rem",
      // Filled by Ref No. `readOnly` takes it out of the Tab path on its own and
      // can never hold the cursor, which is what a derived field must do.
      cell: (r) => <Input readOnly className="h-8" value={r.style_no} placeholder="—" />,
    },
    {
      header: "WareHouse",
      width: "10rem",
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
      width: "10rem",
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
  ];

  const approvalQtyColumns: ChildGridColumn<ApprovalQtyRow>[] = [
    {
      header: "Style",
      required: true,
      width: "16rem",
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
      header: "PO Qty",
      align: "right",
      width: "7rem",
      cell: (r) => derivedCell(poQtyOf(r)),
      total: { kind: "derived", value: (rows) => fmtNumber(rows.reduce((a, r) => a + poQtyOf(r), 0)) },
    },
    {
      header: `Excess (${excessPct || 0}%)`,
      align: "right",
      width: "7rem",
      cell: (r) => derivedCell(excessQtyOf(r)),
      total: { kind: "derived", value: (rows) => fmtNumber(rows.reduce((a, r) => a + excessQtyOf(r), 0)) },
    },
    {
      header: "Approval Qty",
      align: "right",
      width: "8rem",
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
      header: "Total Production",
      align: "right",
      width: "9rem",
      cell: (r) => (
        <span className="block text-right text-sm font-medium tabular-nums text-foreground">
          {fmtNumber(totalQtyOf(r))}
        </span>
      ),
      total: { kind: "derived", value: (rows) => fmtNumber(rows.reduce((a, r) => a + totalQtyOf(r), 0)) },
    },
  ];

  /**
   * Style Prices — SEVEN real inputs, the widest row on the screen and squarely
   * in §6's "6-8 -> stacked card per row" band. It was an 820px table.
   */
  const stylePriceColumns: ChildGridColumn<StylePriceRow>[] = (
    [
      ["Style Ref No", "style_ref_no", "text"],
      ["Style", "style", "text"],
      ["Price", "price", "number"],
      ["CSP Type", "csp_type", "text"],
      ["CSP Price", "csp_price", "number"],
      ["FOB Buyer", "fob_buyer_price", "number"],
      ["FOB Selling", "fob_selling_price", "number"],
    ] as [string, keyof StylePriceRow, string][]
  ).map(([header, field, kind]) => ({
    header,
    align: kind === "number" ? ("right" as const) : ("left" as const),
    cell: (r: StylePriceRow) => (
      <Input
        type={kind === "number" ? "number" : undefined}
        className={kind === "number" ? "text-right" : undefined}
        value={String(r[field] ?? "")}
        onChange={(e) =>
          setStylePrices((xs) =>
            xs.map((x) => (x.key === r.key ? { ...x, [field]: e.target.value } : x)),
          )
        }
      />
    ),
  }));

  /** One blank Style Prices row. Was written out three times — the caption's
   *  onAdd, the grid's keyboard add, and nothing else agreed with either. */
  const tabs: TabItem[] = [
    // ---------------- Style(s) ----------------
    {
      key: "styles",
      label: "Style(s)",
      content: (
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
                <FieldGrid>
                  {styleColumns.map((col) => (
                    <Field
                      key={col.header}
                      label={col.header}
                      required={col.required}
                      size="sm"
                    >
                      {col.cell(r, i)}
                    </Field>
                  ))}
                </FieldGrid>
              </div>
            )}
          />
          <EmptyNote rows={styles.length} label="styles" seeded={seeded} />
        </>
      ),
    },
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
          {/* THE COLOUR LIST HAS NO CREATE ROUTE FROM HERE, so an empty one has to
              say where it is filled. Colour is buyer-scoped: it lives on the
              buyer's Colour Cards, which is how palettes are actually issued
              (there is no global colour master — `public.colors` was dropped by
              0382 as "not applicable to the business process"). Print and
              Structure need no equivalent: both are LookupDialogPickers and can
              be added inline. */}
          {dyeColorItems.length === 0 && (
            <p className="rounded-md border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
              No colours to pick yet.{" "}
              {form.buyer_id
                ? "This customer has no Colour Card entries — add them under Orders ▸ Colour Cards, then reopen this tab."
                : "Pick a Customer first, or add entries under Orders ▸ Colour Cards."}
            </p>
          )}
          {/* Yarn dyeing */}
          <div>
            <ChildGrid<DyeingRow>
              label="Yarn Dyeing"
              columns={dyeColumns}
              rows={dyeings.filter((d) => d.section === "yarn")}
              inlineCards
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
              onAdd={addStructure}
              onRemove={(r) => setStructures((xs) => xs.filter((x) => x.key !== r.key))}
              addLabel="+ Add structure"
            />
            <EmptyNote rows={structures.length} label="structures" seeded={seeded} />
          </div>
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
          {/* Ten columns at ~100rem, so it SCROLLS horizontally inside
              ChildGrid's own `overflow-x-auto` rather than squeezing — which is
              what the legacy grid does too. The widths are honoured because
              every column declares one, which puts the table into `table-fixed`;
              under the default auto layout they are only suggestions and all ten
              collapse to "— S…". `Assort` — the legacy
              [Click] that opens a size breakdown — is deliberately not here yet
              (client 2026-08-11); the table and its Zod type carry no trace of
              it, so adding it later is additive. */}
          <ChildGrid<QuantityRow>
            label="Quantities Details"
            columns={quantityColumns}
            rows={quantities}
            totalsLabel="Total PO Qty"
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
          {/* Two real inputs (style, approval qty) — §6's inlineCards band. The
              totals band is `ChildGridColumn.total`, which sums over EVERY row
              rather than the visible page, so the production target is right on a
              paginated grid. */}
          <ChildGrid<ApprovalQtyRow>
            label="Approval Quantity"
            columns={approvalQtyColumns}
            rows={approvalQtys}
            inlineCards
            totalsLabel="Production target"
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
              <Field label="Contact" size="sm">
                <RecordPicker
                  label="Contact"
                  compact
                  items={data.contacts}
                  value={form.contact_id}
                  onChange={(id) => set({ contact_id: id })}
                />
              </Field>
              <Field label="PO Date" size="sm" htmlFor="lg-podate">
                <Input
                  id="lg-podate"
                  type="date"
                  value={form.logi_po_date}
                  onChange={(e) => set({ logi_po_date: e.target.value })}
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
              <Field label="Received" size="sm" htmlFor="lg-recdate">
                <Input
                  id="lg-recdate"
                  type="date"
                  value={form.received_date}
                  onChange={(e) => set({ received_date: e.target.value })}
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
              <Field label="Avg Rate" size="sm" htmlFor="lg-avgrate">
                <Input
                  id="lg-avgrate"
                  type="number"
                  value={form.avg_rate}
                  onChange={(e) => set({ avg_rate: e.target.value })}
                />
              </Field>
              <Field label="Gross Value" size="sm" htmlFor="lg-gross">
                <Input
                  id="lg-gross"
                  type="number"
                  value={form.gross_value}
                  onChange={(e) => set({ gross_value: e.target.value })}
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
          {/* Style-wise price grid */}
          <>
            <ChildGrid<StylePriceRow>
              label="Style Prices"
              columns={stylePriceColumns}
              rows={stylePrices}
              forceCards
              listRows
              pageSize={5}
              onAdd={() => setStylePrices((xs) => [...xs, blankStylePrice()])}
              onRemove={(r) => setStylePrices((xs) => xs.filter((x) => x.key !== r.key))}
              addLabel="+ Add style price"
              renderMobileRow={(r, i) => (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="shrink-0 text-xs font-medium text-muted-foreground">#{i + 1}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      data-row-remove
                      className="ml-auto shrink-0 text-muted-foreground hover:text-danger"
                      onClick={() => setStylePrices((xs) => xs.filter((x) => x.key !== r.key))}
                      aria-label="Remove style price"
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
                <FieldGrid>
                    {stylePriceColumns.map((col) => (
                      <Field
                        key={col.header}
                        label={col.header}
                        required={col.required}
                        size="sm"
                      >
                        {col.cell(r, i)}
                      </Field>
                    ))}
                  </FieldGrid>
                </div>
              )}
            />
            <EmptyNote rows={stylePrices.length} label="style prices" seeded={seeded} />
          </>
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
    // The SC No is minted, so it cannot be what marks this section done —
    // Unit and Customer are what the operator actually supplies.
    done: !!form.location_id && !!form.buyer_id,
    content: (
      <SectionBody
        title="Order Info"
        hint="Which order is being amended, and this amendment's own details."
      >
        {/* ONE FieldGrid for the whole section — SectionBody has no grid of its
            own, and two stacked grids agree on the left edge but not the row gap. */}
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
          {/* REQUIRED (client 2026-08-10). Costs the operator nothing in the normal
              flow: `onSelectOrder` fills it from the picked order, so choosing an
              SCNo satisfies this field too. It still has to be declared, because
              the Customer can be cleared by hand after the order is picked. */}
          <Field label="Customer" required size="sm">
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
        title={editId ? "Edit Garment Order" : "New Garment Order"}
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
