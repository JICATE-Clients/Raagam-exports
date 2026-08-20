"use client";

import { useCallback, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Calculator,
  ClipboardList,
  TriangleAlert,
  Copy,
  Workflow,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Field, FieldGrid, type FieldSize } from "@/components/ui/field";
import { Truncated } from "@/components/ui/truncated";
import { excessQty, projectionQty } from "@/lib/orders/amendments/approval-qty";
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
import { MobileCardList, type CardStat } from "@/components/masters/mobile-card-list";
import { StatusPill } from "@/components/ui/status-pill";
import { useToast } from "@/components/ui/toast";
import { fmtDate, fmtNumber } from "@/lib/format";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { sectionValidity } from "@/lib/screens/validity";
import { RecordPicker } from "@/components/masters/record-picker";
import { NominatedVendorPicker } from "@/components/masters/nominated-vendor-picker";
import { nominatedVendorOptions } from "@/lib/masters/vendor-nominations";
import { LookupDialogPicker } from "@/components/masters/lookup-dialog-picker";
import { CategoryPicker } from "@/components/masters/lookup-picker";
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
  type MbaItemComponent,
} from "@/lib/orders/material-bom-amendment/types";
import {
  BOM_STATUSES,
  bomStatusHint,
  bomStatusText,
  bomStatusTone,
  type BomStatus,
} from "@/lib/orders/bom-status";
import { cn } from "@/lib/utils";
import type { BomTaskRow, MbaFormData, UomRow } from "@/lib/orders/material-bom-amendment/service";
import {
  isAccessoryClass,
  materialsForCategory,
} from "@/lib/orders/material-bom-amendment/material-options";
import {
  isRefusal,
  lineQuantity,
  productionSlices,
  baseRequirementFor,
  requirementFor,
  REQUIREMENT_BASES,
  type OrderProductionInput,
  type RequirementBasis,
} from "@/lib/orders/material-bom/requirement";
import { processVerdict } from "@/lib/orders/material-bom/process-return";
import {
  describeConversion,
  isUsableConversion,
  toPurchaseQty,
  uomPrecision,
} from "@/lib/uom/convert";
import { createdMeta, hasCreatedInfo } from "@/components/ui/created-columns";

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

/**
 * ONE FIELD HERE IS CARRIED AND NOT SHOWN: `attribute_id` (0418). It is a
 * withdrawal rather than a deletion — it keeps its DB column, its stored values
 * and its place in this row; see its note below for why the round trip is not
 * optional.
 *
 * THREE OTHERS WERE, AND ARE SHOWN AGAIN. `type` came back the same day it went
 * (2026-08-17), and `alternate_uom_id` / `combination` came back on 2026-08-19,
 * when the client asked for the item row in legacy's order column-for-column.
 * Each restoration was a grid column and nothing else, precisely BECAUSE the
 * withdrawal kept the round trip — which is the argument for never letting one
 * turn into a deletion.
 */
type ItemRow = {
  key: string;
  category_id: string | null;
  /** How settled this line's material is — To be advised / To be developed /
   *  Available Item (`MATERIAL_TYPE_OPTIONS`). Descriptive: it has never
   *  reached the requirement engine and still does not. */
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
  /** SHOWN AGAIN since 2026-08-19 — legacy carries it on the item row and the
   *  client asked for that row column-for-column. Still read by nothing:
   *  `requirement.ts` converts consumption → purchase and never consults a third
   *  unit. Withdrawn 2026-08-17, restored two days later, and cheap both times
   *  because the round trip was never broken. */
  alternate_uom_id: string | null;
  /** The pack size this line buys (0348) — see MbaItem.uom_conversion_id. */
  uom_conversion_id: string | null;
  /** SHOWN AGAIN since 2026-08-19, with legacy's row. THE NAME COLLISION THAT
   *  SENT IT AWAY IS STILL REAL: `requirement_basis` has a `combination` value
   *  meaning colour x size (0420), so this unrelated free-text cell sits four
   *  boxes from an Attribute option reading "Combination (Color + Size)". That
   *  qualifier is the only thing telling them apart — do not shorten it. Nothing
   *  has ever consulted this string. */
  combination: string;
  moq: string;
  /* `alternate_uom_id` above is now CARRIED AND NEVER SHOWN (client
     2026-08-19). Its cell came off the grid a second time — withdrawn as "UI
     streamlining" on 08-17, restored on 08-19 with the rest of the legacy row,
     and removed again in the same breath as the narrowing above, which is what
     made it redundant rather than merely unused.

     THE NARROWING IS WHY. Purchase Uom and Consumption Uom now offer the two
     units a material actually declares, and those two ARE the alternate
     arrangement — BUTTON is NOS consumed and GROSS bought. A third free picker
     over the whole master could only ever name a unit the material has no
     conversion for, which `requirement.ts` has no way to convert through: it
     converts consumption -> purchase and has never consulted a third unit, so
     the cell stored a value nothing could read. A dead control is worse than an
     absent one.

     CARRIED, NOT DROPPED. `writeChildren` deletes and reinserts every child
     row, so a field the form stops holding is one the next save NULLS — the
     0418 `attribute_id` pattern. It stays in `ItemRow`, in `mbaItemInput` and in
     `normalizeItems`. */
  /** Round the post-MOQ figure UP to the next multiple of this (0437). Blank =
   *  the operator has not asked for rounding, which is every row before 0437 —
   *  NOT zero, which would have to mean the same thing on a column whose whole
   *  job is to be a step. */
  round_to: string;
  /** The NUMERATOR. */
  no_of_items: string;
  /** The DIVISOR. Never defaulted to 1 — see 0418. */
  per_pieces: string;
  excess_pct: string;
  /** WITHDRAWN from the grid 2026-08-17 (client), CARRIED not dropped — same
   *  treatment as Type / Alternate Uom / Combination above. `writeChildren`
   *  deletes and reinserts every child row, so a field the form stops holding is
   *  one the next save NULLS. The legacy screen has no such column either. */
  required_by: string;
  /**
   * PER-PANEL CONSTRUCTION (0436) — the Combination sheet's rows.
   *
   * CARRIED BEFORE IT IS EDITABLE, deliberately. The sheet that fills this is
   * not built yet, but `writeChildren` DELETES AND REINSERTS every child row, so
   * the moment the table holds data a form that does not carry it is a form that
   * NULLS it on the next ordinary save. That is the withdrawal pattern this file
   * already records for `attribute_id`, applied one step earlier: hold the round
   * trip first, add the editor second.
   */
  components: MbaItemComponent[];
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
  round_to: "",
  no_of_items: "",
  per_pieces: "",
  excess_pct: "",
  required_by: "",
  components: [],
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

/** A cell in one of the two bands below — which column, and how wide it sits. */

/**
 * WHAT A FIELD IS FOR, expressed as how loudly it asks to be filled.
 *
 * THIS IS THE HALF THAT MAKES 22 FIELDS READABLE WITHOUT MOVING ONE. The client
 * fixed the order (2026-08-19, legacy column-for-column) and then reported the
 * result as too hard to use (2026-08-20). Reordering is the obvious tool and it
 * is the one thing forbidden â€” but a field's WEIGHT is independent of where it
 * sits, so hierarchy comes from weight instead. Four of the 22 end up loud and
 * the rest recede; nothing changes position, and Tab still runs 1 to 22.
 *
 * Applied through `Field`'s `className` with descendant variants rather than by
 * editing the controls: a BOM line's cells are `RecordPicker`, `Input`,
 * `LookupDialogPicker` and a `Select`, and giving four different components a
 * "quiet" prop each would be four places for the scale to drift apart.
 *
 *  - `key`   must be filled. Darker edge, bolder label; the `*` and the cursor
 *            hold already come from `ChildGridColumn.required`, so this only
 *            makes them visible at a glance rather than on inspection.
 *  - `quiet` usually left blank. Dashed and unfilled so the eye skips it â€”
 *            SOLID the moment it is hovered or holds a value, because "optional"
 *            must never read as "disabled". It is a real field with a real
 *            cursor; only its resting state is quieter.
 *  - `auto`  the material declares it. No border at all: five of the seven
 *            accessory materials in the live database name ONE unit, so there is
 *            nothing to choose and a box would promise a choice that is not
 *            there (see `uomOptionsFor`).
 *  - `calc`  / `final` the system fills it. Tinted, never bordered, so nobody
 *            tries to type into it. `final` is the figure a purchase order is
 *            written from and is the loudest thing on the row.
 */
export type Weight = "key" | "quiet" | "auto" | "calc" | "final" | "plain";

const WEIGHT_CLASS: Record<Weight, string | undefined> = {
  plain: undefined,
  key: "[&>label]:text-foreground [&>label]:font-semibold [&_input]:border-border-strong",
  /* EVERY CONTROL IS THE SAME COLOUR (client 2026-08-20, screenshot 2410: "some
     fields look white and some look grey, make it even as white").
     `quiet` used to draw a dashed, transparent box and `auto` a filled grey one.
     Read one at a time they each said something true; read as a ROW they made
     five of the twenty-two look switched off next to fields that were not, and
     the operator has no way to know that the difference is editorial rather
     than functional. A genuinely disabled control is grey on this screen too
     (Component before a style is picked), so a cosmetic grey was competing with
     a real one.
     THE SIGNAL SURVIVES IN THE LABEL. `quiet` keeps its 70% label, which costs
     no colour and cannot be confused with a state. That is the whole of the
     weight scale that touches a background now: the two COMPUTED cells, and
     only while they hold a number. */
  quiet: "[&>label]:opacity-70",
  auto: "[&_input]:font-medium",
  calc: "[&_input]:border-transparent",
  final: "[&_input]:border-transparent",
};

type GroupCell = { header: string; size: FieldSize; weight: Weight };

/**
 * GRID DENSITY, and it is the difference between the mockup and the screen.
 *
 * `Field` and the controls inside it default to a FULL-WIDTH FORM: a 36px input
 * and a 13px label, which is right for a record with eight fields down a page
 * and wrong for twenty-two beside a list of lines. The mockup the client chose
 * ran at 26px, and the gap between it and what shipped was almost entirely this
 * (client 2026-08-20: "in the artifact too good, doing directly you are
 * missing").
 *
 * `h-8` IS THE HOUSE COMPACT SIZE — AGENTS.md's own words, "`h-8` is already the
 * compact size, which is why grid rows never showed this". Several cells in
 * `itemColumns` already hard-code it; this puts every control on it, including
 * the pickers, which reach for the form default instead.
 *
 * Applied as descendant variants rather than by editing four control components:
 * a BOM cell is a `RecordPicker`, an `Input`, a `LookupDialogPicker` or a
 * `Select`, and a "dense" prop on each would be four places for one decision.
 */
const DENSE =
  "[&>label]:text-[10.5px] [&_input]:h-8 [&_select]:h-8 [&_input]:text-[12.5px] [&_select]:text-[12.5px]";

/** One figure in the quantity ribbon. */
function Figure({ label, value, unit }: { label: string; value: number; unit: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-[9px] uppercase tracking-wider text-muted-foreground">{label}</span>
      <span className="text-sm font-medium tabular-nums leading-tight text-foreground">
        {fmtNumber(value)}
        <span className="ml-1 text-[10px] font-normal text-muted-foreground">{unit}</span>
      </span>
    </div>
  );
}

/** One operator between two figures. `faded` says it ran and changed nothing. */
function Step({ label, faded = false }: { label: string; faded?: boolean }) {
  return (
    <div
      className={cn(
        "flex flex-col items-center px-3 leading-tight",
        faded ? "text-muted-foreground opacity-50" : "text-primary",
      )}
    >
      <span className="text-sm">&rarr;</span>
      <span className={cn("whitespace-nowrap text-[9px]", !faded && "font-semibold")}>{label}</span>
    </div>
  );
}

/**
 * THE 22 FIELDS, IN THE CLIENT'S ORDER, CUT INTO THREE RUNS.
 *
 * NOT A REORDERING — a reading of the order that was already there. Every run is
 * CONTIGUOUS in the sequence the client fixed, so no field moves and Tab still
 * walks 1 to 22:
 *
 *    1-6    what the trim is, and who supplies it
 *    7-14   what it is measured in, and which garments it is for
 *   15-22   the numbers: the ratio, and the whole quantity chain
 *
 * ONE WIDTH, AND TWO EXCEPTIONS. Twenty of the twenty-two are `md` — 140px — and
 * only Material and Vendor are wider, because a slashed spec
 * ("BUTTON / PLASTIC / 2L / 2 HOLES") and a company name are the only values
 * here that are genuinely long. Everything else lines up.
 *
 * THAT EVENNESS IS THE POINT (client 2026-08-20: "the field size also looks not
 * even with other fields"). The previous cut ran from 70px to 280px, and the
 * variation was reading as meaning that was not there — an operator cannot tell
 * a field that is narrow because its VALUE is short from one that is narrow
 * because the row ran out of columns.
 *
 * SIX / EIGHT / EIGHT IS WHAT MAKES ONE WIDTH POSSIBLE. A run fills its track, so
 * the field width is 32 ÷ (fields on the row) — five fields forced 224px each and
 * nine forced 105. Eight fields is exactly `md`, so two of the three runs are a
 * plain row of eights and the third is six with the two long values doubled.
 *
 * THE COMPUTED CELLS ARE NUMBERS TOO. Excess Calculated Qty and Final Quantity
 * were 210 and 280 on the reasoning that a colour-wise explosion can run to six
 * figures; the client corrected that — these hold five digits at most, like the
 * boxes beside them, so they take the same 140.
 *
 * THE THIRD RUN IS THE CLIENT'S OWN GROUPING, named as one section when they
 * asked for these widths: No. of Items through Purchase Pack.
 *
 * THE TRACK IS 32, NOT THE HOUSE 12, and it needed no new constant:
 * `FIELD_TRACK_32` already existed and was unused, and `FieldGrid` already
 * accepts it. Twelve columns cap a row at SIX fields (`xs` is 2), so eight could
 * not fit. 32 also brings `items-end`, which keeps controls on one baseline when
 * "Excess Calculated Qty" wraps its label at 140px.
 *
 * EVERY RUN SUMS TO 32 — 4+4+8+4+4+8 · eight 4s · eight 4s. Change one size and
 * its run must still make 32, or the last field on it drops to a second line.
 */
const FIELD_GROUPS: readonly (readonly GroupCell[])[] = [
  [
    { header: "Category", size: "md", weight: "key" },
    { header: "Type", size: "md", weight: "quiet" },
    { header: "Material", size: "xl", weight: "key" },
    { header: "Attribute", size: "md", weight: "key" },
    { header: "Supply Type", size: "md", weight: "plain" },
    { header: "Vendor", size: "xl", weight: "plain" },
  ],
  [
    { header: "Purchase Uom", size: "md", weight: "auto" },
    { header: "Consumption Uom", size: "md", weight: "auto" },
    { header: "Combination", size: "md", weight: "quiet" },
    { header: "Item Color", size: "md", weight: "quiet" },
    { header: "Size", size: "md", weight: "quiet" },
    { header: "Style", size: "md", weight: "plain" },
    { header: "Specification", size: "md", weight: "quiet" },
  ],
  [
    { header: "No. of Items", size: "md", weight: "key" },
    { header: "Per Pieces", size: "md", weight: "key" },
    { header: "Excess %", size: "md", weight: "plain" },
    { header: "Calculated Qty", size: "md", weight: "calc" },
    { header: "Excess Calculated Qty", size: "md", weight: "calc" },
    { header: "MOQ", size: "md", weight: "plain" },
    { header: "Round To", size: "md", weight: "plain" },
    { header: "Final Quantity", size: "md", weight: "final" },
    { header: "Purchase Pack", size: "md", weight: "plain" },
  ],
];

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

  /**
   * IS ONE MATERIAL BEING WORKED ON? — and so, should the section rail fold?
   *
   * Set when the operator PICKS a line out of the items list, cleared by the
   * “Sections” button the shell draws in its place. It is deliberately not
   * derived from “is any row open”: `ChildGrid` always has one open (an unset
   * `openRowKey` resolves to the last row), so that reading would fold the rail
   * the instant the screen loaded and the operator would never see the sections
   * they had just navigated to.
   */
  const [railCollapsed, setRailCollapsed] = useState(false);

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

  /**
   * THE CATEGORY OPTIONS, PREFIXED BY THEIR ITEM CLASS ONLY WHERE THE NAME IS
   * AMBIGUOUS (client 2026-08-17: "no longer show the Item Class Name in front
   * of the category in the item section").
   *
   * TWO RULES MEET HERE AND ONLY ONE OF THEM IS NEGOTIABLE. Both accessory
   * classes are offered in one cell, because a BOM line has no class of its own
   * — one grid holds a button and a poly bag — and AGENTS.md's cascading-filter
   * rule covers exactly that: "with no class chosen, prefix each option by its
   * class", because category names repeat across classes and two identical
   * options the operator has to guess between is the other half of the bug the
   * prefix was added for. Live data has STRING as a category under BOTH SEW and
   * PACK, so a blanket removal would put two identical rows in this list.
   *
   * So the prefix is kept exactly where it is load-bearing and dropped
   * everywhere else: a name declared by ONE class carries none, a name declared
   * by TWO carries both. That is the client's ask everywhere they will actually
   * see it — the duplicates are the minority — without reintroducing a choice
   * that cannot be made. Deriving it from the data rather than from a list means
   * a new collision in the Category master starts disambiguating itself, and the
   * last collision to be renamed stops.
   *
   * The prefix is applied to the NAME rather than shown as a sublabel because
   * `CategoryPicker` already spends the sublabel on `short_spec`, and the
   * selected value has to read unambiguously in the closed trigger too.
   */
  const accessoryCategories = useMemo(() => {
    const classCode = new Map(
      data.lookups.filter((l) => l.kind === "item_class").map((l) => [l.id, l.code]),
    );
    // Matched case- and space-insensitively: "Poly Bag" and "POLY BAG" are the
    // collision this is for, not two names that merely sort together. CAPS is
    // the app-wide rule but the master predates it on some rows.
    const classesByName = new Map<string, Set<string>>();
    for (const c of data.categories) {
      const key = (c.name ?? "").trim().toUpperCase();
      if (!key) continue;
      const seen = classesByName.get(key) ?? new Set<string>();
      seen.add(c.item_class_id ?? "");
      classesByName.set(key, seen);
    }
    return data.categories.map((c) => {
      const key = (c.name ?? "").trim().toUpperCase();
      if (!key || (classesByName.get(key)?.size ?? 0) < 2) return c;
      const code = c.item_class_id ? classCode.get(c.item_class_id) : null;
      return code ? { ...c, name: `${code} · ${c.name}` } : c;
    });
  }, [data.categories, data.lookups]);

  /** The two accessory item classes, for the quick-create sheet: it asks WHICH
   *  class, because this cell does not know. `itemClassId` below is only the
   *  sheet's starting value — the operator's answer wins from then on. */
  const accessoryClasses = useMemo(
    () => data.lookups.filter((l) => l.kind === "item_class" && isAccessoryClass(l.code)),
    [data.lookups],
  );
  const fabricStructures = useMemo(
    () => data.lookups.filter((l) => l.kind === "fabric_structure"),
    [data.lookups],
  );

  /**
   * A line's Category cell narrows the Material picker beside it — the
   * cascading-filter rule, which this grid was breaking in its most literal
   * form: two facets side by side, one of them answering the other's question
   * and neither of them wired.
   *
   * IT IS AN ID COMPARISON SINCE 0426. Both sides are `public.categories` rows
   * now, so this passes the id straight down; the old code had to map a
   * `config_lookups` GROUP onto an item class first, which is all the narrowing
   * it could express.
   *
   * `data.items` already arrives narrowed to accessories (the server refuses to
   * ship anything else); this is the second, per-line half, and it has to live
   * here because it depends on a cell the operator is still typing into.
   */
  const materialsFor = (categoryId: string | null, currentValue: string | null) =>
    materialsForCategory(data.items, { categoryId, currentValue });

  /**
   * Changing the Category drops a Material the new one no longer offers —
   * AGENTS.md's "clear a held value that falls out of scope, but ONLY when it
   * really is out of scope", so re-picking a category the material already
   * belongs to keeps it.
   *
   * Asked of the SAME function that builds the picker's options, and with
   * `currentValue: null` on purpose: that argument exists to re-admit the value
   * a line already holds, so passing it here would make the test "is it in the
   * list, including the carve-out for itself?" — which is always yes, and the
   * clear would never fire. The question is whether the material stands on its
   * own merits under the new category.
   */
  const pickCategory = (r: ItemRow, category_id: string | null) => {
    const stillOffered =
      !r.item_id ||
      materialsFor(category_id, null).some((m) => m.id === r.item_id);
    updItem(r.key, stillOffered ? { category_id } : { category_id, item_id: null });
  };

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
        round_to: c.round_to != null ? String(c.round_to) : "",
        no_of_items: c.no_of_items != null ? String(c.no_of_items) : "",
        per_pieces: c.per_pieces != null ? String(c.per_pieces) : "",
        excess_pct: c.excess_pct != null ? String(c.excess_pct) : "",
        required_by: c.required_by ?? "",
        // `?? []` because the service does not select them yet — see the note on
        // `ItemRow.components`. A missing select must read as "no panels", never
        // crash the editor open.
        components: c.components ?? [],
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
          round_to: c.round_to != null ? String(c.round_to) : "",
          no_of_items: c.no_of_items != null ? String(c.no_of_items) : "",
          per_pieces: c.per_pieces != null ? String(c.per_pieces) : "",
          excess_pct: c.excess_pct != null ? String(c.excess_pct) : "",
          required_by: "",
          // Dropped by the copy action itself (0436) — a panel belongs to a
          // style, and the source order's styles are not this one's.
          components: [],
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
        round_to: numOrNull(c.round_to),
        no_of_items: numOrNull(c.no_of_items),
        per_pieces: numOrNull(c.per_pieces),
        excess_pct: numOrNull(c.excess_pct) ?? 0,
        required_by: c.required_by || null,
        components: c.components,
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

  /**
   * ONE CARD PER GARMENT ORDER (operator request, 2026-08-17). This list is a
   * work QUEUE — "which confirmed orders still need their accessories planned?"
   * — and it was a `DataTable` of one row per order. The cards carry the same
   * seven facts and the same click: `openTask` opens that order's Material BOM.
   *
   * `MobileCardList` with `columns={3}` rather than a card hand-rolled here. It
   * already owns the tap-to-edit body, the pill slot and the footer that keeps
   * delete a SIBLING of the tap target rather than a button inside a button —
   * and AGENTS.md's repeated lesson is that the fan-out is always on the
   * hand-rolled half. Its `md:hidden` has always been the caller's, so using it
   * at every width needed one optional prop and changed no other screen.
   *
   * THE SC NO IS NO LONGER A BUTTON. It was one as a table cell, because that is
   * where the click lived. The card body IS the button, so keeping it would nest
   * one inside the other — the exact invalid markup that shaped this component.
   */
  /** False when the service does not select `created_at` — then the card shows
   *  no Created line at all, rather than a dangling date. `hasCreatedInfo` is the
   *  same guard `withCreatedColumns` applies to a table. */
  const showCreated = hasCreatedInfo(tasks);

  /**
   * THE CARD'S THREE FIGURES, AS DATA — `MobileCardList` draws the strip.
   *
   * It was a hand-rolled `<dl>` of three flex rows here, which is the shape the
   * layout skill's governing rule exists to stop: a screen composes primitives
   * and does not draw, and `audit_layout.py --check` enforces exactly that on
   * this file. Three lines also cost a sixth-width card three lines; the strip
   * spends two.
   *
   * A REFUSAL STILL PRINTS ITS SENTENCE, never a dash and never 0 — "no
   * production quantity yet" and "nothing entered" look identical as a dash and
   * only one of them is actionable. `CardStat.value` is a node for this reason;
   * the strip truncates it and reveals it on hover, so an unanswerable card
   * cannot set the height of its whole row.
   */
  const cardStats = (t: BomTaskRow): CardStat[] => [
    { label: "Styles", value: t.style_count },
    {
      label: "Production",
      value:
        t.production_qty != null
          ? fmtNumber(t.production_qty)
          : (t.production_refusal ?? "—"),
    },
    { label: "Delivery", value: t.delivery_date ? fmtDate(t.delivery_date) : "—" },
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

  /**
   * THE UNITS ONE BOM LINE MAY NAME — the material's own, never the master list.
   *
   * Client, 2026-08-19: "purchase uom, consumption need to show the base unit
   * from actually chosen unit only ... if that item have alternate uom can show
   * in two as two value but restrict as full listing."
   *
   * These three cells offered all 8 rows of the `uoms` master for a material
   * that declares ONE. Five of the seven accessory materials in the live
   * database are NOS in every slot, so seven of eight options were not merely
   * unhelpful — `toPurchaseQty` needs a conversion row to convert THROUGH, and
   * a material with no alternate UOM has none, so a GROSS picked there is a
   * value no arithmetic downstream can use.
   *
   * `has_alternate_uom` is the master's own flag and it makes this ONE rule
   * rather than two: false points every slot at `base_uom_id` and forces
   * `conversions` empty (`uomSlots`, `material-actions.ts`), so "base only" is
   * not a narrow reading of that material, it IS that material.
   *
   * ## THE HELD VALUE ALWAYS SURVIVES, and this is not a nicety
   *
   * Same rule as "Disabled rows" and the same failure: a saved line whose unit
   * falls out of the narrowed list renders as an EMPTY cell, and the next save
   * writes that emptiness over a real FK. So `current` is always in the list,
   * even when the material has since been re-declared around it.
   *
   * ## EMPTY, AND IT SAYS WHY — never a fall back to the full list
   *
   * No material chosen yet, or a material whose master carries no base unit
   * (11 items are in that state today, none of them accessories): the cell
   * offers nothing and its placeholder names the reason. Falling back to all 8
   * would restore the bug for exactly the materials whose master is unfinished
   * — the "empty-and-explain, never fall back" rule AGENTS.md states for the
   * nominated-vendor list, which is the same shape one screen along.
   */
  const uomOptionsFor = (itemId: string | null, current: string | null): UomRow[] => {
    const m = itemId ? data.items.find((x) => x.id === itemId) : null;
    const allowed = new Set<string>();
    if (m?.base_uom_id) allowed.add(m.base_uom_id);
    if (m?.has_alternate_uom && m.purchase_uom_id) allowed.add(m.purchase_uom_id);
    if (current) allowed.add(current);
    return data.uoms.filter((u) => allowed.has(u.id));
  };

  /** Why a Uom cell is empty, in the cell itself. Order matters: "pick a
   *  material" is actionable here, "its master has no base unit" is a trip to
   *  another screen, and saying the second while the first is true sends the
   *  operator to fix something that is not wrong. */
  const uomEmptyWhy = (itemId: string | null): string | undefined => {
    if (!itemId) return "Pick a material first";
    const m = data.items.find((x) => x.id === itemId);
    if (!m?.base_uom_id) return "This material declares no base unit";
    return undefined;
  };

  /**
   * BOTH DERIVED CELLS OF THE QUANTITY CHAIN, drawn once.
   *
   * SYSTEM-GENERATED AND IT LOOKS IT: a tinted read-only span rather than an
   * input the operator will try to type into.
   *
   * THE REFUSAL IS THE RIBBON'S LINE, AND ONLY THE RIBBON'S (client 2026-08-20,
   * screenshot 2402). Both cells used to print the sentence themselves, which
   * was right while they were the only thing that could say it — and became
   * "Choose how this material splits" THREE TIMES on one row the moment the
   * ribbon arrived underneath, twice inside boxes too narrow to hold it.
   *
   * So the cells go quiet and the ribbon carries the words. A DASH IS STILL NOT
   * A ZERO: it is muted, it is never `0`, and its `title` names the reason, so
   * the distinction the old sentence protected survives — 0 would read as "none
   * needed", the one answer a material requirement never intends. What changed
   * is only WHERE the sentence is said, and it is said once, in full, in the
   * one place with room for it.
   */
  const derivedQtyCell = (
    t: LineTotal | undefined,
    pick: (t: LineTotal) => number | null,
    emphasis: boolean,
  ) => {
    if (!orderProd) {
      return (
        <span className="block rounded-sm bg-surface-muted px-2 py-1 text-right text-xs text-muted-foreground">
          Pick an order
        </span>
      );
    }
    const value = t ? pick(t) : null;
    if (!t || value == null) {
      return (
        /* WHITE WHILE IT HAS NOTHING TO SAY. A grey box here was a third
           cosmetic grey on a row the client asked to even out, and it was the
           one that read most like a disabled field. Tint is earned by a NUMBER
           (the two branches below); with none, this is an ordinary empty cell
           whose `title` names the reason and whose sentence is in the ribbon. */
        <span
          className="block rounded-sm border border-border px-2 py-1 text-right text-xs text-muted-foreground"
          title={t?.refusal ?? undefined}
        >
          &mdash;
        </span>
      );
    }
    return (
      <span
        className={cn(
          "block rounded-sm bg-info-soft px-2 py-1 text-right tabular-nums text-info",
          emphasis ? "text-sm font-bold" : "text-sm font-semibold",
        )}
      >
        {fmtNumber(value)}
        <span className="ml-1 text-[10px] font-normal opacity-80">{t.uom}</span>
      </span>
    );
  };

  /**
   * THE QUANTITY CHAIN, WRITTEN OUT UNDER THE ROW THAT PRODUCED IT.
   *
   * The four cells above it — Excess Calculated Qty, MOQ, Round To, Final
   * Quantity — are the client's own sequence (0437) and they say WHAT each step
   * holds. They cannot say what each step DID: a figure that went from 1,134 to
   * 1,152 has two candidate reasons sitting beside it and no way to tell which
   * one moved it, or whether both did.
   *
   * So the arithmetic gets a line of its own, reading left to right, naming each
   * operator and dimming the ones that did not bite. An MOQ below the
   * requirement is the ordinary case and it is shown as such — struck back to
   * `opacity-50` rather than hidden, because a step that vanishes when it does
   * nothing teaches the operator that it is sometimes absent.
   *
   * A REFUSAL REPLACES THE WHOLE RIBBON, never one cell of it. If the slices
   * could not answer there is no chain to draw, and printing a sentence in one
   * box beside three dashes reads as three zeroes the engine computed.
   */
  const qtyRibbon = (r: ItemRow, t: LineTotal | undefined) => {
    if (!orderProd || !t) return null;
    if (t.refusal) {
      return (
        <div className="mt-2 flex items-start gap-2 rounded-md bg-warning-soft px-3 py-2 text-xs text-warning">
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{t.refusal}</span>
        </div>
      );
    }
    if (t.excessCalc == null || t.final == null) return null;

    const moq = numOrNull(r.moq);
    const step = numOrNull(r.round_to);
    const moqBit = moq != null && moq > 0;
    const stepBit = step != null && step > 0 && t.final !== t.excessCalc;

    return (
      <div className="mt-2 flex flex-wrap items-center gap-x-1 gap-y-2 rounded-md bg-surface-muted px-3 py-2">
        <Figure label="Order needs" value={t.excessCalc} unit={t.uom} />
        {moqBit && (
          <Step
            /* DIMMED, NOT DROPPED, when the order already needs more than the
               supplier's minimum — see the header. */
            faded={t.excessCalc >= (moq as number)}
            label={`MOQ ${fmtNumber(moq as number)}${t.excessCalc >= (moq as number) ? " · not binding" : ""}`}
          />
        )}
        {stepBit && <Step label={`round up to ${fmtNumber(step as number)}`} />}
        <div className="ml-auto flex flex-col items-end rounded-md bg-accent-soft px-3 py-1">
          <span className="text-[9px] uppercase tracking-wider text-accent/85">Final quantity</span>
          <span className="text-lg font-semibold tabular-nums leading-tight text-accent">
            {fmtNumber(t.final)}
            <span className="ml-1 text-[10px] font-normal opacity-80">{t.uom}</span>
          </span>
        </div>
      </div>
    );
  };

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

  /**
   * THE LINE'S QUANTITY CHAIN, all four steps, so the grid can show each one.
   *
   *     Excess Calculated Qty  ->  MOQ  ->  Round To  ->  Final Quantity
   *
   * `excessCalc` is one line's requirement summed across every slice it explodes
   * into, with the line's own Excess % already inside it (`requirementFor`). It
   * is also the figure MOQ is compared against — a minimum is per ORDER, never
   * per colour row.
   *
   * TWO NUMBERS ARE RENDERED AND BOTH CAN REFUSE TOGETHER. A refusal belongs to
   * the whole chain rather than to one cell: if the slices could not answer,
   * neither Excess Calculated Qty nor Final Quantity has anything to say, and
   * printing a sentence in one and a dash in the other would read as though the
   * dash were a zero.
   */
  type LineTotal = {
    calc: number | null;
    excessCalc: number | null;
    final: number | null;
    refusal: string | null;
    uom: string;
  };

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
          calc: null,
          excessCalc: null,
          final: null,
          refusal: "Choose how this material splits",
          uom: uomLabel,
        });
        continue;
      }

      const slices = productionSlices(r.requirement_basis as RequirementBasis, orderProd);
      if (isRefusal(slices)) {
        push({ refusal: slices.refused });
        totals.set(r.key, {
          calc: null,
          excessCalc: null,
          final: null,
          refusal: slices.refused,
          uom: uomLabel,
        });
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
      // THE SAME SLICES BEFORE THE LINE'S EXCESS % (client 2026-08-20: "two
      // fields not one"). Accumulated in the same loop rather than a second
      // pass, so the two columns can never be summed over different slice sets
      // — which is how one column would come to disagree with the other about
      // which colours the order has.
      let baseTotal: number | null = 0;

      for (const slice of slices) {
        const lineInput = {
          no_of_items: numOrNull(r.no_of_items),
          per_pieces: numOrNull(r.per_pieces),
          excess_pct: numOrNull(r.excess_pct) ?? 0,
          decimals: uomDecimals(r.consumption_uom_id),
        };
        const baseValue = baseRequirementFor(lineInput, slice);
        if (isRefusal(baseValue)) baseTotal = null;
        else if (baseTotal != null) baseTotal += baseValue;
        const value = requirementFor(lineInput, slice);
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

      // MOQ AND ROUND TO ARE APPLIED TO THE LINE, never to a slice. A colour
      // explosion makes six rows for one material; an MOQ of 500 per row orders
      // 3,000 of something the order needs 100 of, and six rows each rounded up
      // to the next 500 buys the rounding error six times. `lineQuantity` owns
      // the order the two run in — MOQ first, and 0437's header records the
      // worked example where the two orders differ by nearly double.
      const unitKnown = !!r.purchase_uom_id || !!r.consumption_uom_id;
      if (lineTotal == null) {
        totals.set(r.key, {
          calc: null,
          excessCalc: null,
          final: null,
          refusal: lineRefusal,
          uom: uomLabel,
        });
        continue;
      }
      const chain = lineQuantity(
        [lineTotal],
        numOrNull(r.moq),
        numOrNull(r.round_to),
        unitKnown,
        [baseTotal],
      );
      totals.set(
        r.key,
        isRefusal(chain)
          ? { calc: null, excessCalc: null, final: null, refusal: chain.refused, uom: uomLabel }
          : {
              calc: chain.calcQty,
              excessCalc: chain.excessCalcQty,
              final: chain.finalQty,
              refusal: null,
              uom: uomLabel,
            },
      );
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
    // Three sections since the header and the Items grid merged (2026-08-17).
    // The `bom` key still owns both required fields, so nothing here moved.
    sections: [{ key: "bom" }, { key: "processes" }, { key: "requirement" }],
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
      /**
       * THE REAL CATEGORY MASTER (0426) — BUTTON, LABEL, SEWING THREAD, POLY
       * BAG. It used to be `config_lookups` kind `material_category`, which
       * holds two rows: "Sewing Accessory" and "Packing Accessory", the names of
       * the two GROUPS rather than the categories inside them (client
       * 2026-08-17, screenshot 2314).
       *
       * `CategoryPicker`, NOT `LookupDialogPicker` — and the difference is not
       * cosmetic. Both draw an inline "+ Add"; `LookupDialogPicker`'s writes to
       * `config_lookups`, which is now the wrong table, and the FK would reject
       * it. That is why Customer ▸ Supplied Items had to switch its Add OFF when
       * 0356 made the same repoint there, and why this one does not have to:
       * `CategoryPicker` creates through `createCategory()`.
       */
      cell: (r) => (
        <CategoryPicker
          label=""
          title="Category"
          categories={accessoryCategories}
          value={r.category_id ?? ""}
          onChange={(id) => pickCategory(r, id || null)}
          canCreate={masterPerms.canCreate}
          canEdit={masterPerms.canEdit}
          // The sheet ASKS which class, so this is only where it opens. A BOM
          // line spans both accessory classes and cannot answer for the row.
          itemClassId={accessoryClasses[0]?.id}
          selectedClassCode={accessoryClasses[0]?.code ?? null}
          itemClasses={accessoryClasses}
          levies={data.levies}
          fabricStructures={fabricStructures}
          compact
        />
      ),
    },
    {
      header: "Type",
      className: "min-w-[110px]",
      /**
       * HOW SETTLED THIS MATERIAL IS — "To be advised", "To be developed",
       * "Available Item" (client 2026-08-17: "in the item section, add Type
       * options for …").
       *
       * RESTORED THE SAME DAY IT WAS WITHDRAWN, and that is deliberate rather
       * than churn. c756d82 took the cell out that morning to get the row from
       * 22 columns to 19, judging the list it then held — Production / Sample /
       * Trial — provisional; it was right about the list and the client's own
       * drop names its replacement. The withdrawal is what made this cheap: the
       * DB column, the stored values and `mbaItemInput.type` were all kept, so
       * this is a grid column and nothing else, and no migration
       * (`material_bom_amendment_items.type` is plain `text`, no CHECK, 0265,
       * unaltered since).
       *
       * NOT `required` — a BOM line saves without it, which is the point of "to
       * be advised". And not uppercased: a fixed option list is outside the
       * CAPITALS rule, which governs typed free text.
       *
       * SECOND ON THE LINE, between Category and Material — where legacy puts it
       * (screenshot 2362). It sat between Component and Supply Type from its
       * restoration until 2026-08-19, when the whole row was re-ordered onto
       * legacy's.
       */
      cell: (r) => (
        <Select
          value={r.type}
          onChange={(e) => updItem(r.key, { type: e.target.value })}
          className="h-8"
        >
          <option value=""></option>
          {MATERIAL_TYPE_OPTIONS.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </Select>
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
          <option value=""></option>
          {REQUIREMENT_BASES.map((b) => (
            <option key={b} value={b}>
              {REQUIREMENT_BASIS_LABELS[b]}
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
          <option value=""></option>
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
      header: "Purchase Uom",
      className: "min-w-[130px]",
      // NARROWED TO THE MATERIAL'S OWN UNITS (client 2026-08-19) — see
      // `uomOptionsFor` for why the master list was wrong here and what the
      // empty case says instead of falling back to it.
      cell: (r) => (
        <RecordPicker
          label="Purchase Uom"
          items={uomOptionsFor(r.item_id, r.purchase_uom_id)}
          value={r.purchase_uom_id}
          onChange={(id) => updItem(r.key, { purchase_uom_id: id })}
          placeholder={uomEmptyWhy(r.item_id)}
          compact
        />
      ),
    },
    {
      header: "Consumption Uom",
      className: "min-w-[130px]",
      cell: (r) => (
        <RecordPicker
          label="Consumption Uom"
          items={uomOptionsFor(r.item_id, r.consumption_uom_id)}
          value={r.consumption_uom_id}
          onChange={(id) => updItem(r.key, { consumption_uom_id: id })}
          placeholder={uomEmptyWhy(r.item_id)}
          compact
        />
      ),
    },
    {
      header: "Combination",
      className: "min-w-[150px]",
      /**
       * LEGACY'S OWN COLUMN (screenshot 2362), free text. Withdrawn 2026-08-17,
       * back 2026-08-19 with the rest of the row — the same restoration as
       * Alternate Uom above, and nothing has ever read this one either.
       *
       * IT COLLIDES BY NAME WITH THE ATTRIBUTE CELL FOUR BOXES ALONG, and that
       * collision is exactly why it went: `requirement_basis` carries a
       * `combination` value meaning colour x size (0420), so a second
       * "Combination" on the same line reads as its input. It is not, and never
       * was. The Attribute option keeps its `(Color + Size)` qualifier, which is
       * the only thing telling the two apart — do not shorten that label.
       */
      cell: (r) => (
        <Input
          uppercase
          value={r.combination}
          onChange={(e) => updItem(r.key, { combination: e.target.value })}
          className="h-8"
        />
      ),
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
        />
      ),
    },
    {
      header: "Style",
      className: "min-w-[130px]",
      // Blank means every style on the order — the common case, which is why it
      // is not required.
      //
      // THE UNIT RIDES WITH IT (0423). "1 per piece" on a two-garment Set means
      // something different from "1 per piece" on a single top, and `per_pieces`
      // is typed by the operator — so the fact is SHOWN and never computed with.
      // Turning it into arithmetic would silently double or halve a requirement
      // the operator thought they had entered.
      //
      // IT SITS ABOVE THE CONTROL, NOT UNDER IT, AND THAT IS A LAYOUT RULE RATHER
      // THAN A PREFERENCE. The runs render on `FIELD_TRACK_32`, which carries
      // `items-end` so that a wrapped LABEL cannot drop its control below the
      // row. Bottom-aligning the cell means the LAST element in it is what lands
      // on the shared baseline — so a note under the control put the note on the
      // baseline and lifted the `<Select>` ~20px above every other field on the
      // row. Picking a style visibly knocked the layout crooked (client
      // 2026-08-20, screenshot 2414).
      //
      // Above the control it costs nothing: extra content grows the cell UPWARD
      // from a fixed bottom edge, so the `<Select>` does not move when a style is
      // chosen and the note appears in the gap under the label, qualifying it.
      // **Anything added to a cell in this grid goes above the control.**
      cell: (r) => {
        const st = styleOf(r.style_ref_no);
        return (
          <div className="space-y-0.5">
            {st?.unit_kind && (
              /* "Set", not "Set (multi-garment)": the cell is 140px and the long
                 form wrapped to two lines, which grew the cell upward far enough
                 to shove the Style LABEL out of line with its neighbours — the
                 same misalignment one element along. The full phrase is the
                 title. */
              <span
                /* truncate-reveal: exempt -- a two-word fixed vocabulary, "Set"
                   or "Piece", which cannot reach 140px; the `truncate` is belt
                   and braces against a future third value, not a hidden value. */
                className="block truncate text-[10.5px] leading-tight text-muted-foreground"
                title={
                  st.unit_kind.toUpperCase() === "SET"
                    ? "A set — more than one garment"
                    : "A single garment"
                }
              >
                {st.unit_kind.toUpperCase() === "SET" ? "Set" : "Piece"}
              </span>
            )}
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
          </div>
        );
      },
    },
    /* THE COMPONENT CELL WAS HERE AND CAME OUT (client 2026-08-20, "remove
       from only material bom is enough" — the Style Components tab keeps its
       own, which is where a panel list belongs).

       It was DESCRIPTIVE from the day it landed (0423): it never split the
       requirement, because one collar interlining is needed per garment
       whichever panel it is cut for. `requirement_basis` never read it and the
       requirement table has no component column — 0423 asserts that — so
       removing the cell changes no number anywhere in this module. That is the
       whole reason this is a one-line removal rather than a migration.

       CARRIED, NOT DROPPED: `component_id` stays in `ItemRow`, `mbaItemInput`
       and `normalizeItems`, and `0423`'s column stays on the table. This screen
       DELETES AND REINSERTS every child row on save, so a field the form stops
       holding is a field the next save NULLS — the same trap `alternate_uom_id`
       and `required_by` are written up for above. Stored panels survive, and a
       restore is this block again. */
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
      header: "Calculated Qty",
      align: "right",
      className: "min-w-[8rem]",
      /**
       * WHAT THE ORDER CONSUMES, BEFORE THE BUFFER (client 2026-08-20: "two
       * fields not one — excess will user give, and calculated is based on no of
       * pcs and no of item, with or without excess value ... it need to show the
       * count automatically").
       *
       * So the pair reads left to right as the operator's own sentence: No. of
       * Items and Per Pieces make THIS number; Excess % turns it into the one
       * beside it. Neither is typed.
       *
       * NOT THE OTHER COLUMN DIVIDED BY (1 + excess). Every figure here is
       * ceilinged to the unit's precision, so dividing back out un-rounds a
       * number that was deliberately rounded and lands just under the honest
       * one — `baseRequirementFor` computes it from its own multiplication for
       * that reason, and `check-bom-requirement.mts` has the vector where the
       * two disagree.
       *
       * EQUAL TO THE NEXT CELL WHEN EXCESS % IS BLANK, which is most rows, and
       * that is not a reason to hide it: the operator is being shown what the
       * order needs and what the buffer added, and "nothing" is a real answer
       * for the second.
       */
      cell: (r) => derivedQtyCell(lineTotals.get(r.key), (t) => t.calc, false),
    },
    {
      header: "Excess Calculated Qty",
      align: "right",
      className: "min-w-[8rem]",
      // THE FIRST OF TWO DERIVED CELLS, and it is what "Calculated Qty" used to
      // be MINUS the MOQ (client 2026-08-19). The line's whole requirement —
      // every slice summed, with the line's own Excess % inside it — BEFORE the
      // supplier's minimum and the operator's rounding step get their hands on
      // it. Splitting the old cell in two is the point: the operator can see
      // what the order actually needs standing beside what will be bought.
      cell: (r) => derivedQtyCell(lineTotals.get(r.key), (t) => t.excessCalc, false),
    },
    {
      header: "Round To",
      align: "right",
      className: "min-w-[6rem]",
      /**
       * THE OPERATOR'S ROUNDING STEP (0437), not the answer itself.
       *
       * Client: "sometimes that excess field will show 567 kind of number value,
       * that time user will use round to field for round the value." So the box
       * takes 50, or 144 for a gross, or 12 for a dozen — and Final Quantity
       * becomes the next multiple UP. A step rather than an override, because an
       * override is a hand-typed number entering the figure a purchase order is
       * written from with nothing checking it still covers the requirement.
       *
       * BLANK IS THE ORDINARY STATE and passes the figure through untouched. Not
       * `required`, and never defaulted to 1 — the same call `per_pieces` makes
       * one column along.
       */
      cell: (r) => (
        <Input
          type="number"
          min="0"
          step="0.001"
          value={r.round_to}
          onChange={(e) => updItem(r.key, { round_to: e.target.value })}
          className="h-8 text-right"
        />
      ),
    },
    {
      header: "Final Quantity",
      align: "right",
      className: "min-w-[8rem]",
      // THE END OF THE CHAIN, and the figure a purchase order is written from.
      // Emphasised over Excess Calculated Qty beside it — same tint, heavier
      // weight — because when the two differ this is the one that gets ordered.
      cell: (r) => derivedQtyCell(lineTotals.get(r.key), (t) => t.final, true),
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
  ];

  /**
   * WHAT EACH MATERIAL'S REQUIREMENT COMES TO, keyed by the material rather than
   * by the item LINE — the same `byItem` roll-up `bomCeilingForOrder` builds
   * server-side to cap a purchase order, and it has to be summed the same way.
   *
   * TWO LINES CAN NAME ONE MATERIAL (a thread used on the body and the collar
   * is two rows with two ratios), so a process row asking "is my dyed thread
   * enough?" has to be answered against BOTH. Reading one line's figure would
   * report a job covered while the order is short by the other line's share.
   *
   * The WITH-WASTAGE figure, because that is what `required_qty` stores and what
   * the PO ceiling checks against. The buffer is the money already spent to
   * absorb exactly the processing loss this column is measuring.
   *
   * A line that REFUSED contributes nothing and leaves its material unanswerable
   * — `processVerdict` then refuses too rather than comparing against a partial
   * sum, which is the partial-explosion failure `requirement.ts` is written to
   * prevent.
   */
  const requiredByItem = new Map<string, number>();
  for (const it of items) {
    if (!it.item_id) continue;
    const t = lineTotals.get(it.key);
    if (!t || t.excessCalc == null) continue;
    requiredByItem.set(it.item_id, (requiredByItem.get(it.item_id) ?? 0) + t.excessCalc);
  }

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
      className: "min-w-[8rem]",
      /**
       * DERIVED, never stored: two columns and their difference kept in three
       * places is two chances for them to disagree.
       *
       * THE VERDICT ABOVE IT ANSWERS A DIFFERENT QUESTION, and the difference is
       * the whole point (`lib/orders/material-bom/process-return.ts`). The
       * balance says how much is still AT THE VENDOR. The line above says
       * whether what came BACK still covers the order — measured against the
       * requirement, never against what was sent.
       *
       * Send 1,000 to cover 940 and get 960 back and you are whole; send 1,000
       * to cover 990 and get 960 back and you are short by 30. Identical
       * balances, opposite verdicts. A `qty_in < qty_out` test calls both of
       * them short, which raises an alarm on every ordinary dye job — dye loss
       * is normal and expected — and an alarm that fires on healthy rows is one
       * the operator learns to ignore.
       *
       * ABOVE THE CONTROL, per this file's own layout rule: the runs carry
       * `items-end`, so anything added BELOW would land on the shared baseline
       * and lift the cell out of line with its neighbours.
       *
       * IT NEVER BLOCKS. Nothing here withholds the material that did arrive —
       * the shortfall is stated and left on screen, because the wastage buffer
       * was bought to absorb exactly this.
       */
      cell: (r) => {
        const out = numOrNull(r.qty_out);
        const verdict = r.item_id
          ? processVerdict(
              { qty_out: out, qty_in: numOrNull(r.qty_in), sent_on: null },
              requiredByItem.get(r.item_id) ?? null,
            )
          : null;
        const note =
          verdict == null || (!isRefusal(verdict) && verdict.state === "planned")
            ? null
            : isRefusal(verdict)
              ? { text: verdict.refused, tone: "text-muted-foreground" }
              : verdict.state === "short"
                ? { text: `Short ${fmtNumber(verdict.shortfall)}`, tone: "text-danger" }
                : { text: "Covered", tone: "text-muted-foreground" };
        return (
          <div className="space-y-0.5">
            {note && (
              <Truncated className={`block text-[10.5px] leading-tight ${note.tone}`}>
                {note.text}
              </Truncated>
            )}
            {out == null ? (
              <span className="text-xs text-muted-foreground">—</span>
            ) : (
              <span className="tabular-nums text-sm">{fmtNumber(out - (numOrNull(r.qty_in) ?? 0))}</span>
            )}
          </div>
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
      /*
       * THE HEADER AND THE ITEMS ARE ONE SECTION (client 2026-08-17, "merge the
       * Material and Item sections into a single area" / "the item listing
       * should be a single, clear screen rather than fragmented").
       *
       * The dot means "this section is answered", and the section now holds the
       * materials too — so `items.some(...)` JOINED IT WITH THE MERGE. It is
       * the same expression the Items section used to carry, not a second
       * reading of the same state. A BOM with a date, an order and no material
       * is not a BOM, and a dot there would be a confident lie.
       *
       * Same move, same reasoning, one door along: Order Info + Style(s) became
       * one section on the sibling screen on 2026-08-11.
       */
      done: !!form.amend_date && !!form.garment_order_id && items.some((r) => r.item_id),
      content: (
        <SectionBody title="Material BOM">
          {/* ONE FLUSH ROW — four `xs` (2 of 12) and Remarks at `md` (4) = 12.

              THE COUNT IS WHAT PICKS THE SIZE, not a preference for small. It
              was six cells at `xs` this morning, which tiled exactly; Entry No
              then left (below) and five `xs` end a third of a row short. The
              spare four columns go to Remarks because it is the one free-text
              cell here — the alternative, five cells at mixed widths, ends the
              row flush too but at a ragged left edge for the next reader.

              They were `sm` (3 of 12) before 2026-08-17, which tiled four at a
              time and read four-then-two. It also puts this screen at the
              density Order Entry already uses — a step-2 header four-across
              beside a step-3 header six-across is the same complaint the
              sibling screen records for its own rail. */}
          {/* TWO FIELDS. Customer, A. No and Remarks were removed on
              2026-08-19 (client), and the first two were saying a second time
              what the record header above already says — it reads
              "HO/RE/26-27/0001 · A. No auto · OXBOW · 19/08/2026". A read-only
              box repeating the strip 60px above it is a field that can only ever
              agree or be wrong.

              NOTHING BACK-END CHANGED, which is the pattern this screen already
              follows for Entry No (hidden 2026-08-17) and for `attribute_id`:

                - `customerId` / `customerName` are still derived from the picked
                  order and still narrow every nominated-vendor picker on the
                  grid. Only the BOX went; the value it displayed does more work
                  now than it ever did on screen.
                - `amendmentNo` still loads and still prints in the header strip.
                - `remarks` is still in `HeaderForm`, still read by `openEdit` and
                  still sent by `submit`. The parent row is UPDATEd rather than
                  deleted and reinserted, so a stored remark survives — but it is
                  carried anyway, because "leave the column alone" and "drop it
                  from the payload" are the same thing only on a table that is
                  UPDATEd, and that is a property of today's action rather than of
                  the field.

              THE ROW DELIBERATELY DOES NOT SUM TO 12. The de-clutter rule
              (LAYOUT.md §3) exists so a row of many fields does not end a third
              short; two fields are a different shape, and forcing them to `lg`
              each would draw a 740px date box to satisfy an arithmetic rule
              nobody can see. Garment Order takes `md` because its trigger shows
              an SC No and a customer name; Date keeps `xs`, which is all a
              DD-MM-YYYY control needs. */}
          <FieldGrid>
            <Field label="Date" required size="xs" htmlFor="mba-date">
              <Input
                id="mba-date"
                type="date"
                value={form.amend_date}
                onChange={(e) => set({ amend_date: e.target.value })}
              />
            </Field>
            <Field size="md">
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

          {copyBar}

          {/* THE ITEMS GRID, AND IT MUST RENDER LAST.
              `cycleTab` (lib/focus.ts) walks the pane's field-like nodes in DOM
              order and treats the last one as the SECTION EDGE — the point
              where Tab hands over to Processes through `registerContentEdge`.
              Put the grid above the header fields and Tab re-enters the header
              after the materials instead of leaving the section. That is the
              one thing this merge could have broken, and it is the same note
              the Style(s) grid carries one door along.

              Nothing wraps it: `SectionBody` already spaces its children, and
              the grid draws its own band, which is what keeps the word Items on
              screen now that the rail no longer says it.

              THE ROW SHAPE IS UNCHANGED BY THE MERGE. `forceCards` (operator
              2026-08-10) and `foldRows` (client 2026-08-14) are both live
              decisions with dates on them; "one clear screen rather than
              fragmented" is answered by the section count going from two to
              one, not by undoing either of those. */}

          {/* NO SIDEWAYS SCROLLBAR — THE ROW WRAPS INSTEAD (operator,
              2026-08-10). 21 columns cannot fit 1180px minus the rail, so the
              responsive table would put the row behind a horizontal scrollbar.
              `forceCards` drops the table for one card per line and
              `renderMobileRow` fills it with the SAME `FieldGrid` the header
              uses, so a line reads as a small form rather than a train carriage.

              `columns` stays the single declaration: labels and cells are read
              off it, so a new column cannot leave the card and header
              disagreeing. */}
          <ChildGrid<ItemRow>
            /* THE WORD "ITEMS" HAD TO GO SOMEWHERE. It was the rail row and the
               `SectionBody` title until the merge above; without this band the
               materials would sit straight under Remarks with nothing naming
               them, which is the opposite of what "one clear screen" asked for. */
            /* grid-caption: exempt -- the note above is the reason: the merge took
               away the rail row and the SectionBody title, so this band is now the
               ONLY thing naming these rows. */
            label="Items"
            columns={itemColumns}
            rows={items}
            forceCards
            flatRows
            /* ONE LINE OPEN AT A TIME (client 2026-08-14). 21 columns is TWO
               lines per material since 2026-08-19 — eleven across the item
               line and ten across Details, both on the 32-column track —
               so three materials filled the screen
               before "+ Add" came into view — on the document where ten lines is
               ordinary. The fold itself is `ChildGrid`'s, so this says only what
               a closed line looks like; the grid draws the #N and the ✕ above it. */
            foldRows
            /* THE OTHER NINETEEN LINES STAND BESIDE THE OPEN ONE (client
               2026-08-20, chosen from three treatments). `foldRows` above
               already opened one at a time; this decides where the rest go. A
               BOM runs to twenty lines, and stacked they pushed the open one an
               unpredictable distance down the page — and moved it again every
               time a different line was opened. */
            masterDetail
            /* PICKING A LINE FOLDS THE RAIL (client 2026-08-20, screenshot
               2402). This section is itself a list plus an editor, so the rail
               and the item list were two levels of navigation stacked in front
               of 22 fields. */
            onOpenRow={() => setRailCollapsed(true)}
            renderListItem={(row) => {
              /* INERT BY CONTRACT — see `renderListItem` on the grid. Text, a
                 dot and a figure; nothing focusable, because the fields live in
                 the pane next door. */
              const t = lineTotals.get(row.key);
              const name = row.item_id ? itemName(row.item_id) : null;
              const basis = row.requirement_basis
                ? REQUIREMENT_BASIS_LABELS[row.requirement_basis as RequirementBasis]
                : null;
              const ratio =
                row.no_of_items.trim() && row.per_pieces.trim()
                  ? `${row.no_of_items.trim()} per ${row.per_pieces.trim()}`
                  : null;
              /* THREE STATES AND THE DOT SAYS WHICH. Amber is the one that
                 matters: the line is started and cannot answer, which is
                 invisible on a folded line that shows no figure. */
              const state = !name ? "idle" : t?.refusal ? "warn" : "ok";
              return (
                <div className="flex items-center gap-2.5">
                  <span
                    className={cn(
                      "h-1.5 w-1.5 shrink-0 rounded-full",
                      state === "ok" && "bg-success",
                      state === "warn" && "bg-warning",
                      state === "idle" && "bg-border-strong opacity-50",
                    )}
                  />
                  <span className="min-w-0 flex-1">
                    <Truncated
                      className={cn(
                        "block text-[12.5px] leading-tight",
                        name ? "font-medium text-foreground" : "text-muted-foreground",
                      )}
                    >
                      {name ?? "Not filled in"}
                    </Truncated>
                    {(basis || ratio) && (
                      <Truncated className="block text-[10px] leading-tight text-muted-foreground">
                        {[basis, ratio].filter(Boolean).join(" · ")}
                      </Truncated>
                    )}
                  </span>
                  {/* THE FIGURE THE LINE PRODUCES, so twenty lines can be checked
                      without opening one. A refusal says so in words rather than
                      showing a dash, which would read as a zero. */}
                  {/* THE FIGURE ON ITS OWN LINE UNDER THE UNIT, not squeezed
                      beside a name it then collides with (client 2026-08-20,
                      screenshot 2406: "5,607.52 —" ran straight into a truncated
                      material). A right column of its own, and the unit sits
                      BELOW rather than beside, so a six-figure quantity cannot
                      push it out of the row. The dash the uom prints when no
                      consumption unit is chosen is dropped here rather than
                      shown: on a list row it reads as part of the number. */}
                  <span className="shrink-0 text-right leading-tight">
                    {t?.refusal ? (
                      <span className="text-[10px] font-medium text-warning">Needs attention</span>
                    ) : t?.final != null ? (
                      <>
                        <span className="block text-[12px] font-semibold tabular-nums text-accent">
                          {fmtNumber(t.final)}
                        </span>
                        {t.uom && t.uom !== "—" && (
                          <span className="block text-[9px] tracking-wide text-muted-foreground">
                            {t.uom}
                          </span>
                        )}
                      </>
                    ) : null}
                  </span>
                </div>
              );
            }}
            /* EVERY LINE BUT THE ONE BEING WORKED ON FOLDS, BLANK OR NOT
               (client 2026-08-19: "much boxed area, can't recognise the working
               section").

               `canFold={(row) => !!row.item_id}` stood here, on the grid's own
               reasoning that "a folded blank reads as an empty record". True in
               general, and exactly backwards on a NEW document: every row is
               blank then, so the one rule meant to leave one section open left
               ALL of them open — four field rows and a boxed Details band each,
               with a 1px hairline between materials. The fold switched itself
               off in the state it was built for.

               A blank line is not left mute: `renderFoldedRow` below says "New
               material — not filled in" in muted text, which answers the
               grid's objection without turning the fold off. And a blank row
               that stays blank costs nothing — `normalizeItems` in actions.ts
               drops a row with no field set at all, so a forgotten one saves as
               nothing rather than as an empty material. */
            /* WHAT A FOLDED LINE SHOWS: the band above already says who it is
               (`rowSummary` below), so all this owes is ONE REAL FIELD.

               That is not a nicety. Tab lands on fields, so a folded row
               rendering none would be reachable by mouse alone, and focusing it
               is what opens it again. The Material picker is the one worth
               keeping: it is the line's identity and the one value worth
               changing without opening the row.

               `label=""` RATHER THAN NO LABEL, deliberately. `Label` is a block,
               so with no children it has no line box at all and the control
               rises ~16px above anything beside it (see `Field`); the empty
               string reserves the row through the real component. Here it also
               stops the word "Material" repeating the band directly above it.

               THE SUMMARY TEXT THAT USED TO SIT BESIDE IT HAS MOVED to
               `rowSummary`, which draws it for open and folded rows alike. Two
               copies of one sentence is one copy too many. */
            /* WHAT A FOLDED LINE SHOWS. There is no band (see `rowSummary`
               below), so this is the only place a closed material says who it is
               — and it has to, or ten folded lines are ten identical pickers.

               ONE REAL FIELD IS MANDATORY, not a nicety: Tab lands on fields, so
               a folded row rendering none would be reachable by mouse alone, and
               focusing it is what opens it again. The Material picker is the
               right one — the line's identity, and the one value worth changing
               without opening the row. */
            renderFoldedRow={(row, i) => {
              const material = itemColumns.find((c) => c.header === "Material")!;
              const summary = [
                // The colour leads: on a trim it is what two lines of the same
                // material differ by.
                colourName(row.item_color_id),
                row.specification.trim(),
                row.size.trim(),
                // The arithmetic is what a BOM line IS — showing it closed is
                // what makes the fold safe to scan past.
                row.no_of_items.trim() && row.per_pieces.trim()
                  ? `${row.no_of_items.trim()} / ${row.per_pieces.trim()} pcs`
                  : null,
                row.excess_pct.trim() ? `+${row.excess_pct.trim()}%` : null,
              ]
                .filter(Boolean)
                .join("  ·  ");
              return (
                <FieldGrid>
                  <Field label="" required={material.required} size="md">
                    {material.cell(row, i)}
                  </Field>
                  <Field label="" size="xl">
                    <div className="flex min-h-8 items-center">
                      {/* TWO BLANK STATES, NOT ONE. A named material with nothing
                          else typed is a line in progress; a line with no
                          material at all has not started, and since 2026-08-19
                          those fold too. "Nothing else" over an empty picker
                          would read as "finished and empty". */}
                      <Truncated className="text-sm text-muted-foreground">
                        {summary ||
                          (row.item_id
                            ? "Nothing else filled in yet"
                            : "New material — not filled in")}
                      </Truncated>
                    </div>
                  </Field>
                </FieldGrid>
              );
            }}
            renderMobileRow={(row, i) => {
              /* SIX GROUPS, EACH SUMMING TO 12 — the client's own field order,
                 laid out so it can be read (client 2026-08-20, "make it much ux
                 friendly ... maintain the order of the fields").
                 THE ORDER IS UNTOUCHED AND THAT IS THE WHOLE CONSTRAINT. What
                 changed is that the 22 fields stop being one flat run of
                 identical boxes. They already fall into six CONTIGUOUS runs that
                 mean something — the trim, who supplies it, units, which
                 garments, the ratio, what we buy — so those runs become the
                 rows, and no field moves. Tab still walks 1 to 22 and still
                 leaves at 22.
                 THE GROUPS ARE UNLABELLED, deliberately (client 2026-08-19:
                 "remove all the section title ... just main field label is
                 enough, we need clean interface"). A hairline between runs is
                 not a title; it is the only thing left marking the seam.
                 EACH RUN SUMS TO 12 ON THE HOUSE TRACK, which is what let
                 `FIELD_TRACK_32` and `FIELD_TRACK_40` go. Those existed to fit
                 eleven and thirteen fields on ONE line, and paid for it in
                 width: ~68px for a numeric cell, ~145px for a picker whose
                 content is a slashed spec. At 12 columns in this pane a field
                 is ~157-235px, which is LAYOUT.md's own figure rather than a
                 third of it. The client reported the cramping (screenshot 2396);
                 widening the track was treating the symptom.
                 Looked up BY HEADER, never by index — `itemColumns` is
                 re-ordered often, and a header named in NO group still renders,
                 in its own run at the end, so a column added later cannot
                 vanish off a screen nobody thought to re-read. */
              const groups = FIELD_GROUPS.map((g) =>
                g.flatMap((b) => {
                  const col = itemColumns.find((c) => c.header === b.header);
                  return col ? [{ col, size: b.size, weight: b.weight }] : [];
                }),
              );
              const named = new Set(FIELD_GROUPS.flat().map((b) => b.header));
              const orphans = itemColumns
                .filter((c) => !named.has(c.header))
                .map((col) => ({ col, size: "sm" as FieldSize, weight: "plain" as Weight }));
              const runs = orphans.length ? [...groups, orphans] : groups;
              const t = lineTotals.get(row.key);

              return (
                /* CAPPED, AND LEFT-ALIGNED AGAINST THE LIST. A run fills 12
                   columns of whatever it is given, so the TRACK is what sets
                   every field's width here — there is no per-field size to turn
                   down, and no cap either.
                   THE CAP IS GONE (client 2026-08-20, screenshot 2410: "use that
                   extra right side"). It was 1120, then 840, and both were the
                   wrong instrument: narrowing the region to shrink the fields
                   also left the pane visibly unused on the right. Widening the
                   TRACK shrinks the fields AND fills the pane — 32 columns over
                   the full width is 35px each, so a field is 70 to 280px and the
                   row ends where the pane ends. */
                <div>
                  {/* WHICH LINE AM I FILLING IN? — the pane had no answer
                      (client 2026-08-20, screenshot 2406). The fields simply
                      began, and with the list beside them showing two materials
                      there was nothing tying the open one to its own name. The
                      mockup led every pane with exactly this and it is the
                      single largest thing that was missing.
                      `pr-9` keeps the line clear of the ✕ `ChildGrid` floats
                      into the card's top-right corner. */}
                  <div className="mb-2 flex items-baseline gap-3 border-b border-border pb-1.5 pr-9">
                    <Truncated className="min-w-0 text-[13px] font-semibold text-foreground">
                      {row.item_id ? itemName(row.item_id) : "New material"}
                    </Truncated>
                    <span className="shrink-0 text-[10.5px] text-muted-foreground">
                      Line {i + 1} of {items.length}
                    </span>
                    {/* The figure this line produces, where the eye already is.
                        The ribbon below shows HOW it got there; this says WHAT
                        it is, without scrolling to the end of the row. */}
                    {t?.final != null && (
                      <span className="ml-auto shrink-0 text-right">
                        <span className="text-base font-semibold tabular-nums text-accent">
                          {fmtNumber(t.final)}
                        </span>{" "}
                        <span className="text-[10px] tracking-wide text-muted-foreground">
                          {t.uom}
                        </span>
                      </span>
                    )}
                  </div>
                  {runs.map((g, gi) => (
                    <div
                      key={gi}
                      /* THE SEAM IS THE GAP FIRST AND THE LINE SECOND, and
                         getting that round the wrong way is a mistake this very
                         screen has already made once. On 2026-08-17 the item
                         line and its detail band were split with a 1px
                         `border-t` and the client reported no change at all
                         (screenshot 2325, "why is there no update"): at this
                         density a hairline reads exactly like the gap between
                         two ordinary rows.
                         `py-2` repeated it. A field row's own fields sit 8px
                         apart (`FieldGrid`'s `gap-y-2`), so 8px of padding put
                         24px BETWEEN runs against 16px WITHIN one — a ratio of
                         1.5, which the eye does not read as a boundary, and 22
                         fields went back to looking like one wall (client
                         2026-08-20, screenshot 2404). `py-3` makes it 32 against
                         16, and proximity does the grouping before any line is
                         drawn. The hairline stays as confirmation, not as the
                         whole signal.
                         `border-border`, not `border-border-strong`: the strong
                         token separates one MATERIAL from the next (`ChildGrid`
                         draws it at 2px), and a run inside a record must read as
                         quieter than that or the record stops being one thing. */
                      className={cn("py-3", gi > 0 && "border-t border-border")}
                    >
                      <FieldGrid cols={32}>
                        {g.map(({ col, size, weight }, ci) => (
                          <Field
                            key={ci}
                            label={col.header}
                            /* `required` MUST be forwarded as well as declared on
                               the column: cards mode calls this function instead
                               of the `columns.map()` that wraps each cell in
                               `RequiredScope`, so without it the header draws a
                               `*` with no cursor hold behind it. Checked by
                               `audit_layout.py --check grid-required-mobile`. */
                            required={col.required}
                            size={size}
                            className={cn(DENSE, WEIGHT_CLASS[weight])}
                          >
                            {col.cell(row, i)}
                          </Field>
                        ))}
                      </FieldGrid>
                    </div>
                  ))}
                  {qtyRibbon(row, t)}
                </div>
              );
            }}
            /**
             * WHO THIS LINE IS — the header band, and the reason the row got 40px
             * of its width back (client 2026-08-19).
             *
             * With no `rowSummary` this grid had no band, so `ChildGrid` floated
             * the remove control at `right-1 top-1` and reserved `pr-10` across
             * EVERY row to keep the last field's label from running under it.
             * That padding is what stopped MOQ 62px short of the panel edge
             * against a 10px inset on the left. A band puts the control in the
             * flow, which turns `cornerRemove` off and takes the padding with it.
             *
             * IT CARRIES THE FOLDED SUMMARY TOO, which is why `renderFoldedRow`
             * above is now a single field: the band says it once, open or folded.
             *
             * AN ELEMENT FOR A BLANK LINE AND A STRING OTHERWISE — the shape the
             * prop documents ("a new, untouched row has no identity yet and
             * should say so in muted text"). Every line but the open one folds,
             * blank ones included, so this is the only thing an unstarted line
             * gets to say for itself.
             */
            /* NO `rowSummary`, SO NO BAND — and this is the second half of a
               trade the client has now seen both sides of.

               A row's remove control needs ~40px SOMEWHERE, and `ChildGrid`
               offers exactly two places. In a band it costs 40px of HEIGHT on
               every row (a 32px button line plus the row's gap) and no width; in
               the corner it costs 40px of WIDTH (`pr-10`, reserved so the last
               field cannot run under it) and no height.

               The band went in on 2026-08-19 to reclaim the width beside MOQ,
               and came out the same day: "how much excess between item header
               title and table data". Both complaints are correct, and the
               arithmetic is what settles it — 40px is 2.6% of a 1504px row and
               36% of a ~110px one, and the vertical version repeats down the
               document. Nine folded lines on a ten-material BOM were spending
               360px on nine copies of an otherwise empty strip.

               So the ✕ is back in the corner and MOQ gives up 40px again. Put
               `rowSummary` back only if that width is worth more than the height,
               and know that it buys the band whether or not it has anything to
               say — `bandLine` is `!!summary`, not "is the summary worth a line". */
            seedRow
            onAdd={() => {
              /* ADDING A LINE IS CHOOSING TO WORK ON IT — the cursor lands in the
                 new row (`landOnAddedRow`), so the rail folds for the same
                 reason it folds on picking one out of the list. Without this the
                 sections stayed up through the whole of a new BOM, which is
                 exactly when the fields need the width most (client 2026-08-20). */
              setRailCollapsed(true);
              mutItems((xs) => [...xs, blankItem(newKey())]);
            }}
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
        <SectionBody title="Processes">
          <ChildGrid<ProcRow>
            columns={procColumns}
            rows={procs}
            forceCards
            flatRows
            /* Same fold as the Items grid above — see it for the reasoning. */
            foldRows
            canFold={(row) => !!row.item_id}
            renderFoldedRow={(row, i) => {
              const material = procColumns.find((c) => c.header === "Material")!;
              const summary = [
                data.processes.find((p) => p.id === row.process_id)?.name,
                row.qty_out.trim() ? `out ${row.qty_out.trim()}` : null,
                row.qty_in.trim() ? `in ${row.qty_in.trim()}` : null,
              ]
                .filter(Boolean)
                .join("  ·  ");
              return (
                <FieldGrid>
                  <Field label={material.header} required={material.required} size="md">
                    {material.cell(row, i)}
                  </Field>
                  <Field label="" size="xl">
                    <div className="flex min-h-8 items-center">
                      <Truncated className="text-sm text-muted-foreground">
                        {summary || "No process named yet"}
                      </Truncated>
                    </div>
                  </Field>
                </FieldGrid>
              );
            }}
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
        <SectionBody title="Requirement">
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

        <MobileCardList<BomTaskRow>
          /* SIX ACROSS (client 2026-08-19). The count also turns the card dense
             — see `columns` on the component; there is no roomy six-up. */
          columns={6}
          rows={filtered}
          getKey={(t) => t.id}
          /* THE SC NO GETS ITS OWN FULL-WIDTH LINE, which is the point of the
             dense layout: it is the identity the operator scans by, ~125px of
             mono, and it used to share a row with a pill that could be 88px of
             "Recalculate". Plain text, not a button — the card body IS the
             button, so nesting one inside it is invalid markup. */
          title={(t) => (
            <span className="font-mono">{t.sc_no ?? t.order_code ?? "—"}</span>
          )}
          /* CUSTOMER AND PO ON ONE SECONDARY LINE, with the status pill to their
             right (the component places it). Mono on the PO only — a customer
             name in mono reads as a code. Truncated because this is the line
             that gives up width to the pill, and a card is not a `DataTable`
             cell: nothing here scrolls sideways to reveal the rest. */
          subtitle={(t) => (
            <Truncated>
              {t.customer_name ?? "—"}
              {t.po_no ? <span className="font-mono"> · {t.po_no}</span> : null}
            </Truncated>
          )}
          pill={(t) => (
            <span title={bomStatusHint(t.status, t.production_qty)}>
              <StatusPill tone={bomStatusTone(t.status)}>
                {bomStatusText(t.status)}
              </StatusPill>
            </span>
          )}
          stats={cardStats}
          /* THE CREATED PAIR SHARES THE FOOTER WITH THE ✕ instead of adding a
             second bordered row — AGENTS.md wants it APPENDED to the screen's
             own meta, not substituted for it, and the customer and the figures
             above are that meta, untouched. Still gated on `hasCreatedInfo`, so
             a service that stops selecting `created_at` shows nothing rather
             than a dangling date. */
          footerNote={showCreated ? (t) => createdMeta(t) : undefined}
          onEdit={openTask}
          canDelete={perms.canDelete}
          // Only an order that HAS a BOM has anything to delete. The table gated
          // this per row too; without it the button renders on every card and
          // does nothing when pressed.
          canDeleteRow={(t) => !!t.bom_id}
          onDelete={del}
          isPending={isPending}
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
        railCollapsed={railCollapsed}
        onExpandRail={() => setRailCollapsed(false)}
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
    /**
     * THE SUM, NOT ITS INGREDIENTS.
     *
     * This strip used to read "PO 5,000 pcs · excess 5%", and every requirement
     * on the screen below multiplied 5,552. An operator does that arithmetic in
     * their head, gets 5,250, and the missing 302 has nowhere to come from
     * (client 2026-08-20, screenshot 2417: "I didn't apply any excess and the
     * quantity is also wrong — where is this wired?").
     *
     * The figure was never wrong. What was wrong is that the strip named two of
     * the FOUR terms and then let a number built from all four appear 22 fields
     * away. On that order it is 5,000 + 252 + 300: the excess is 5% ROUNDED UP
     * PER LINE across fifteen lines, so it is 252 rather than a flat 250, and
     * the 300 is approval and sample pieces, which the strip never mentioned at
     * all.
     *
     * So every term that moved the number is named, and the total is stated. A
     * term that contributed nothing is left out rather than printed as "+ 0" —
     * on the ordinary order that is the rejection allowance, and a row of zeroes
     * would bury the two terms that did something.
     *
     * COMPUTED WITH THE ENGINE, never re-derived here. `excessQty` and
     * `projectionQty` are the same functions `productionTarget` calls for the
     * rows, so a strip that agreed with the arithmetic today but drifted from it
     * later is not expressible — which is the whole reason 0413 put them in one
     * module.
     */
    const po = order.approvals.reduce((a, r) => a + (Number(r.qty) || 0), 0);
    const exc = order.approvals.reduce(
      (a, r) => a + excessQty(Number(r.qty) || 0, Number(order.excessPct) || 0),
      0,
    );
    const appr = order.approvals.reduce((a, r) => a + (Number(r.approval_qty) || 0), 0);
    const rej = order.approvals.reduce(
      (a, r) => a + (projectionQty(Number(r.qty) || 0, order.tiers) ?? 0),
      0,
    );
    const target = po + exc + appr + rej;

    const term = (label: string, n: number) => (
      <>
        {" + "}
        <span className="font-medium tabular-nums text-foreground">{fmtNumber(n)}</span>{" "}
        {label}
      </>
    );

    body = (
      <span className="text-muted-foreground">
        {order.approvals.length} approval {order.approvals.length === 1 ? "line" : "lines"} ·{" "}
        {order.combos.length} {order.combos.length === 1 ? "combo" : "combos"} ·{" "}
        <span className="font-medium tabular-nums text-foreground">{fmtNumber(po)}</span> PO
        {exc > 0 && term(`excess (${order.excessPct}%)`, exc)}
        {appr > 0 && term("approval pcs", appr)}
        {rej > 0 && term("rejection", rej)}
        {" = "}
        <span className="font-semibold tabular-nums text-foreground">{fmtNumber(target)}</span> pcs
        {" to make"}
        {/* Said only when it is NOT applied. With a rule chosen its contribution
            is a term above, which says so better than a label can. */}
        {!order.rejectionRuleChosen && " · no rejection rule"}
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
