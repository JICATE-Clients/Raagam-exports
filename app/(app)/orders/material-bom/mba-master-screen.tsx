"use client";

import { useCallback, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Calculator,
  ClipboardList,
  TriangleAlert,
  Copy,
  Workflow,
  ChevronRight,
  ChevronDown,
  Layers,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Field, FieldGrid, type FieldSize } from "@/components/ui/field";
import { Toggle } from "@/components/ui/toggle";
import { Truncated } from "@/components/ui/truncated";
import { excessQty, projectionQty } from "@/lib/orders/amendments/approval-qty";
import {
  ChildGrid,
  gridKeyNav,
  type ChildGridColumn,
} from "@/components/masters/child-grid";
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
import { today as todayAtFactory } from "@/lib/calendar";
import { fmtDate, fmtNumber } from "@/lib/format";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { sectionValidity } from "@/lib/screens/validity";
import { RecordPicker } from "@/components/masters/record-picker";
/* `NominatedVendorPicker` AND `nominatedVendorOptions` WERE BOTH IMPORTED HERE,
   and both went on 2026-08-28 with the Vendor cell and then the Supply Type
   control (client: "no need to hold the vendor field just hide it", then
   "Supply Type — remove this field").
   NEITHER THE FIELDS NOR THE RULE ARE GONE — only this screen's controls.
   `supply_type` and `vendor_id` are still carried and round-tripped (see
   `ItemRow`), `copyMaterialBomFrom` still blanks a copied vendor the new
   customer has not nominated, and the purchase order still renders the picker
   under the full rule. A BOM line can no longer EXPRESS a nomination, which is
   the accepted consequence: enforcement lives wholly at the PO. */
import { LookupDialogPicker } from "@/components/masters/lookup-dialog-picker";
import { CategoryPicker } from "@/components/masters/lookup-picker";
import {
  BomCombinationSheet,
  type CombinationRow,
} from "@/components/orders/bom-combination-sheet";
import { producibleGrains, slicesForAxes } from "@/lib/orders/bom-explosion/compose";
import {
  CLIENT_GRAIN_MATRIX,
  COMBINATION_LOCKED_HINT,
  COMBINATION_UNLOCKED_HINT,
  menuRows,
  EXTRA_SERVED,
  clientLabelFor,
  namesCombination,
} from "@/lib/orders/bom-explosion/client-matrix";
import {
  axesOfBasis,
  basisForAxes,
  canonicalAxes,
  labelFor,
  serializeAxes,
  type Axis,
} from "@/lib/orders/bom-explosion/exploder";
import { BomCopySheet, BomCopyConfirm } from "@/components/orders/bom-copy-sheet";
import {
  BomSliceGrid,
  type BomSliceCell,
  type BomSliceRow,
} from "@/components/orders/bom-slice-grid";
import {
  copyMaterialBomFrom,
  createMaterialBomAmendment,
  deleteMaterialBomAmendment,
  loadOrderProduction,
  updateMaterialBomAmendment,
} from "@/lib/orders/material-bom-amendment/actions";
import {
  missingItemFields,
  DEFAULT_MATERIAL_TYPE,
  DEFAULT_SUPPLY_TYPE,
  TBA_MATERIAL_TYPE,
  REQUIREMENT_BASIS_LABELS,
  type BomCopySource,
  type MaterialBomAmendment,
  type MbaItemSlice,
} from "@/lib/orders/material-bom-amendment/types";
import {
  BOM_STATUSES,
  BOM_STATUS_RANK,
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
  baseRequirementFor,
  isRefusal,
  lineQuantity,
  lineQuantityByColour,
  productionSlices,
  SLICE_SEP,
  requirementFor,
  toPurchaseSlices,
  type ColourQuantities,
  type OrderProductionInput,
  type ProductionSlice,
  type RequirementBasis,
} from "@/lib/orders/material-bom/requirement";
import {
  combinationNames,
  consumptionFor,
  crossCombinations,
  overrideFor,
  sliceKey,
} from "@/lib/orders/material-bom/slice-consumption";
import {
  conversionFactor,
  describeConversion,
  fmtQty,
  isUsableConversion,
  toPurchaseQty,
  uomPrecision,
} from "@/lib/uom/convert";
import { resolveLinePack } from "@/lib/orders/material-bom/pack-resolve";
import { uomPatchForMaterial } from "@/lib/orders/material-bom/uom-prefill";
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
  /**
   * How settled this line's material is — To be advised / To be developed /
   * Available Item (`MATERIAL_TYPE_OPTIONS`).
   *
   * NO LONGER PURELY DESCRIPTIVE. It never reached the requirement engine and
   * still does not, but since 2026-08-28 the two unsettled values BLOCK a
   * purchase order being raised against the line — `isUnsettledMaterialType`,
   * declared beside the list it partitions.
   *
   * TWO VALUES ON SCREEN, THREE IN THE REFUSAL SET, and the mismatch is
   * deliberate. "To be developed" was retired from `MATERIAL_TYPE_OPTIONS` on
   * 2026-08-28 and KEPT in `UNSETTLED_MATERIAL_TYPES`, because a row already
   * stored as that is still unsettled and must still be refused. So this field
   * can hold a value the picker no longer offers, and it loads and saves
   * unchanged when it does.
   *
   * THE CONTROL WAS A TICK FOR PART OF THAT DAY — a switch that revealed a
   * two-option select, so the third value stayed reachable. Retiring the value
   * removed the reason for the reveal and it is a plain `<Select>` again. See
   * the "TBA" column for the full sequence; it is not a thing to restore.
   */
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
  /**
   * THE EXPLOSION GRAIN (0455) — the source of truth since 2026-08-23, and what
   * the Attribute cell's toggle strip writes.
   *
   * NULL is "not chosen yet" and blocks Save; `[]` is the WHOLE ORDER and is a
   * real answer. Held as `Axis[] | null` rather than a serialized string so the
   * strip can toggle members without parsing.
   */
  requirement_grain: Axis[] | null;
  style_ref_no: string;
  /** The garment panel this material goes on (0423) — descriptive, see MbaItem. */
  component_id: string | null;
  /**
   * CARRIED, NOT SHOWN since 2026-08-28 (client) — with `vendor_id` below.
   *
   * "Over 90% of BOM lines are Local, and the vendor is decided at the PO stage
   * anyway." Two cells at the widest end of the row were spending their width
   * restating a default, and the answer they held was being made again — with
   * better information — a step later.
   *
   * THE WITHDRAWAL PATTERN, NOT A DELETION, and on this screen that is not a
   * style point: `writeChildren` DELETES AND REINSERTS every child row, so a
   * field the form stops holding is a field the next save NULLS. Both stay in
   * `ItemRow`, in `blankItem`, in both load paths and in the save payload, so a
   * stored supply type and a stored vendor survive an ordinary edit-and-save of
   * a line whose cells are gone — the same treatment `attribute_id`,
   * `component_id`, `alternate_uom_id` and `required_by` already carry.
   *
   * ## BOTH CONTROLS ARE GONE, AND SUPPLY TYPE GOT THERE IN TWO STEPS
   *
   * Vendor went first: it is chosen on the purchase order, which is where
   * `NominatedVendorPicker` still runs and where the customer's nomination list
   * is enforced.
   *
   * SUPPLY TYPE WAS RELOCATED AND THEN REMOVED, both on 2026-08-28, and the
   * reversal is worth recording because the intermediate position was
   * defensible. It was first moved to a strip beneath the row rather than
   * deleted, on the reading that a supply type is a CONSTRAINT rather than a
   * label and the ~10% of lines that are Nominated or Import should be able to
   * say so at BOM stage. The client then asked for it removed outright — the
   * same answer they had given for Vendor — and the later instruction wins.
   *
   * ## SO A BOM LINE CAN NO LONGER EXPRESS A NOMINATION
   *
   * Stated plainly because it is the real consequence and it is accepted with
   * eyes open: the nomination constraint AGENTS.md describes is now enforced
   * WHOLLY AT THE PURCHASE ORDER, which is where the vendor is actually chosen
   * and where the better information is. `copyMaterialBomFrom` still applies it
   * server-side when a BOM is copied onto a different customer.
   *
   * `DEFAULT_SUPPLY_TYPE` IS NOW THE ONLY WRITER, which makes it load-bearing
   * rather than a convenience — see `blankItem`.
   */
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
  /**
   * SHOWN AS "Process" — this material goes out for one (0466).
   *
   * The COLUMN was renamed on 2026-08-26 and the FIELD was not: `send_out` is
   * the database column (0466), it is what `writeChildren` reads and what the
   * Processes tab's union tests, so renaming the field would be a migration and
   * a rewrite to change a word on a header. The label lives at the column
   * definition; this is the value behind it.
   *
   * A BOOLEAN, not a string, unlike every numeric on this row: those are held as
   * text because a number cannot represent a just-cleared box, and a checkbox
   * has no cleared state to represent.
   */
  send_out: boolean;
  /**
   * FREE OF COST RECEIPT — the customer supplies this trim and we are not
   * buying it (client 2026-08-28). 0474.
   *
   * `is_foc`, NOT `foc`, and deliberately unlike `send_out` two lines up. The
   * same fact is already spelled `is_foc` on `po_line_items` (0359), on the
   * planning budgets (0369) and on pricing confirmation (0330), and a PO line
   * raised from a BOM line copies it straight across. Local table style loses to
   * cross-table concept naming here — one concept spelled two ways is exactly
   * the drift `send_out`'s own header warns about.
   *
   * A BOOLEAN for the same reason `send_out` is: a tick has no cleared state to
   * represent, so it needs none of the string-holding every numeric here does.
   */
  is_foc: boolean;
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
   * THE TYPED COMBINATION NAMES (0463) — the Combination popup's rows.
   *
   * A VIEW OVER `slices`, NOT A SECOND STORE. It is derived on load from the
   * distinct `combination` values the slices carry, and folded back into
   * `slices` at the payload boundary. That direction matters: the five data
   * fields a combination row carries (Item Color, Specification, No of Items,
   * No of Pcs, Allowance) are typed out in the LISTING, against the slice — so
   * if the names lived anywhere else, editing the popup would either lose those
   * figures or need a reconciliation nobody would keep correct.
   *
   * Held as its own array only because the popup edits names while the listing
   * edits figures, and a half-typed name must not churn a slice row on every
   * keystroke.
   */
  combinations: CombinationRow[];
  /**
   * PER-SLICE CONSUMPTION OVERRIDES (0442) — what the operator typed against one
   * of the rows the Attribute explodes this line into. Empty is the ordinary
   * state: the line's own figures apply to every slice.
   */
  slices: MbaItemSlice[];
};

type ProcRow = {
  key: string;
  /**
   * The row's immutable anchor (0446) — what a raised Delivery Challan points at.
   *
   * NOT `key`. `key` is a render key minted fresh on every load, so a challan
   * matched on it would come unstuck the moment the screen reopened. This is
   * stored, round-tripped and never shown.
   */
  row_uid: string;
  item_id: string | null;
  process_id: string | null;
  vendor_id: string | null;
  qty_out: string;
  qty_in: string;
  status: string;
  /* LEGACY'S FIVE (0465), beside the lifecycle rather than instead of it.
     `loss` is a STRING like every other numeric box on this screen: a number in
     form state cannot represent "the operator has just cleared the box", so it
     fights the caret. The parse happens once, at the payload boundary. */
  stage: string;
  forScope: string;
  description: string;
  loss: string;
  notes: string;
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
  /* DEFAULTED, NOT BLANK (client 2026-08-21) — see `DEFAULT_MATERIAL_TYPE`.
     Only a NEW line: the two load paths below carry whatever was stored, so a
     row saved blank stays blank rather than being quietly re-typed on read. */
  type: DEFAULT_MATERIAL_TYPE,
  item_id: null,
  attribute_id: null,
  item_color_id: null,
  specification: "",
  size: "",
  requirement_basis: "",
  // NULL, never `[]`: an untouched line has not been answered, and `[]` would
  // silently mean "one bulk row for the whole order".
  requirement_grain: null,
  style_ref_no: "",
  component_id: null,
  /* OPENS ON "Local" (client 2026-08-21) — see `DEFAULT_SUPPLY_TYPE`.
     THIS DEFAULT IS NOW THE ONLY WRITER OF `supply_type` ON THIS SCREEN, and
     that changed what it is for. It began as a convenience: a blank supply type
     offers zero vendors, so a fresh line used to carry a Vendor picker that
     opened onto nothing. With both controls removed on 2026-08-28 it is the only
     thing standing between a new line and a permanently blank supply type —
     which is the state AGENTS.md's nominated-vendor rule refuses ("blank supply
     type -> NOTHING, with a line saying to pick the type first"), and one no
     control on this screen could ever repair. **Do not drop this to `""`.**
     New lines only: both load paths carry whatever was stored, blank included,
     because filling one in on read would change what the next save writes. */
  supply_type: DEFAULT_SUPPLY_TYPE,
  vendor_id: null,
  purchase_uom_id: null,
  consumption_uom_id: null,
  alternate_uom_id: null,
  uom_conversion_id: null,
  combination: "",
  // 0466. Off by default: most trims are bought and sewn on, and defaulting it
  // on would put every material back on the Processes tab, which is the screen
  // this column exists to shorten.
  send_out: false,
  // 0474. Off by default and for the plainer reason `send_out` gives: a BOM is a
  // list of what we buy, and free-issue is the exception the customer declares.
  is_foc: false,
  moq: "",
  round_to: "",
  no_of_items: "",
  per_pieces: "",
  excess_pct: "",
  required_by: "",
  combinations: [],
  slices: [],
});

const blankProc = (key: string): ProcRow => ({
  key,
  // Minted here rather than left to the DB default, so the row carries the same
  // anchor from the moment it appears — a challan can then be raised against it
  // and survive the save that follows.
  row_uid: crypto.randomUUID(),
  item_id: null,
  process_id: null,
  vendor_id: null,
  qty_out: "",
  qty_in: "",
  stage: "",
  forScope: "",
  description: "",
  loss: "",
  notes: "",
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

type GroupCell = { header: string; size: FieldSize; weight: Weight; align?: "end" };

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
function Figure({
  label,
  value,
  unit,
  decimals,
}: {
  label: string;
  value: number;
  unit: string;
  decimals?: number | null;
}) {
  return (
    <div className="flex flex-col">
      <span className="text-[9px] uppercase tracking-wider text-muted-foreground">{label}</span>
      <span className="text-sm font-medium tabular-nums leading-tight text-foreground">
        {fmtQty(value, decimals)}
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
 * "· 12d" beside a delivery date, and "· 12d late" when it has passed.
 *
 * THE DATE SAYS WHEN AND THE SUFFIX SAYS HOW SOON, which are different
 * questions: a merchandiser scanning a queue is deciding what to plan THIS
 * WEEK, and arithmetic against thirty dates is what they were doing by eye.
 *
 * SILENT BEYOND 60 DAYS. A "· 109d" on an order shipping in December is noise
 * on every card, and noise on every card is what stops the two that say "· 4d"
 * from being seen. Late is never silent and is the only one that takes a
 * colour.
 *
 * NO HYDRATION GUARD IS NEEDED, and that is `todayAtFactory`'s doing rather
 * than luck. It formats in Asia/Kolkata, so the server (UTC) and the operator's
 * browser (IST) agree on what day it is — including during the 5.5 hours every
 * morning when `new Date()` does not. The local `today()` at the top of this
 * file is the UTC one `lib/calendar.ts` warns about; do not reach for it here.
 */
function DaysOut({ iso }: { iso: string }) {
  const at = Date.parse(`${iso.slice(0, 10)}T00:00:00`);
  const now = Date.parse(`${todayAtFactory()}T00:00:00`);
  if (Number.isNaN(at) || Number.isNaN(now)) return null;
  const days = Math.round((at - now) / 86_400_000);

  if (days < 0) {
    return <span className="font-normal text-danger"> · {-days}d late</span>;
  }
  if (days === 0) return <span className="font-normal text-danger"> · today</span>;
  if (days > 60) return null;
  return <span className="font-normal text-muted-foreground"> · {days}d</span>;
}

/**
 * THE ELEVEN COLUMN NAMES, DECLARED ONCE.
 *
 * `renderMobileRow` pairs a `FIELD_GROUPS` entry to its column BY HEADER
 * (`itemColumns.find((c) => c.header === b.header)`), which is deliberate — the
 * columns are re-ordered often and matching by index would silently shuffle the
 * row. The cost is that the two lists hold the same eleven STRINGS, and a rename
 * in one of them does not fail: the column simply stops matching, falls into the
 * `orphans` bucket, and renders in a run of its OWN. So a one-word edit quietly
 * turns the single row the user asked for back into two.
 *
 * That is not hypothetical maintenance worry — it is exactly the edit that was
 * being made when this constant was added (client 2026-08-28, shortening the two
 * Uom headers so their labels stop wrapping at 110% zoom). Both sites now read
 * from here, so the rename happens in one place and the pairing cannot drift.
 *
 * ABBREVIATED, AND THE ABBREVIATION IS THE CLIENT'S. "Purchase Uom" and
 * "Consumption Uom" are ~68px and ~88px at `DENSE`'s 10.5px, against an `sm`
 * cell that is ~78px once a 1366 laptop at 110% zoom takes the pane below the
 * content cap. "Pur. Uom" and "Cons. Uom" are ~44px and ~50px and fit with room.
 * The header text is the client's to choose and it was put to them; do not
 * lengthen these back to make a comment read better.
 */
const H = {
  category: "Category",
  tba: "TBA",
  material: "Material",
  attribute: "Attribute",
  purchaseUom: "Pur. Uom",
  consumptionUom: "Cons. Uom",
  combination: "Combination",
  moq: "MOQ",
  roundTo: "Round To",
  process: "Process",
  foc: "FOC",
} as const;

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
 * asked for these widths: No. of Items through Final Quantity. It ended at
 * Purchase Pack until 2026-08-21, when the client had that field removed.
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
/*
 * RUN 1 IS THE WHOLE LINE IDENTITY — nine fields (client 2026-08-20: "move the
 * purchase consumption combination to the first row", then "that supplier and
 * vendor also into the same first row").
 *
 * THIS OVERRIDES "THE 22 FIELDS KEEP THEIR LEGACY ORDER", stated above and
 * restated on 08-19. A later instruction wins, and it is worth naming the rule
 * that was set aside rather than leaving two notes to contradict each other.
 *
 * NINE FIELDS DO NOT FIT AT `md`. Eight `md` is exactly 32, so a ninth has to
 * come out of the others — and it comes out by what each field HOLDS, never by
 * shaving whatever is last: a Uom is a three-letter code, Combination is a
 * short word, and Material and Vendor are names that need the room. 300px for
 * Material and 100px for Combination is the size scale used for its purpose.
 *
 * AND THE SUMS WERE ALREADY WRONG BEFORE THIS. The note above says "EVERY RUN
 * SUMS TO 32", and the table under it did not: run 2 held SEVEN 4s (28, four
 * short) and run 3 held NINE (36, four over). 36 on a 32-track is the exact
 * failure that note warns about — Purchase Pack was dropping onto a line of its
 * own. The comment was right and the data had drifted from it.
 *
 * RUN 2 IS THE DYNAMIC GROUP, and that is why its four fields are wide.
 * Style / Item Color / Size / Specification are not four static answers — they
 * are what the Attribute explodes the line into (client 2026-08-20: "style is
 * not a static field"). They keep the width because they are about to hold a
 * LIST, not a value.
 *
 * `full` HERE IS 12 OF 32, NOT THE WHOLE ROW. On the house 12-track `full` means
 * "stands alone — a grid or a textarea", and that reading does NOT carry over:
 * this track has 32 columns, so the same token is 12/32 and shares its line with
 * three other fields. Worth saying, because the name says otherwise.
 *
 *   run 1  4+3+6+4+3+3+2+3+4   = 32
 *   run 2  8+8+8+8            = 32
 *   run 3  4+4+2+4+6+4+2+6     = 32
 */
const FIELD_GROUPS: readonly (readonly GroupCell[])[] = [
  /*
   * ONE RUN NOW, AND IT IS THE WHOLE LINE (client 2026-08-21, screenshots 2461 /
   * 2462 / 2463).
   *
   * Everything that was per-material-per-attribute moved into the sub-grid over
   * three rounds — Item Color, Size and Specification first, then No. of Items,
   * Per Pieces and Excess %, then the three derived figures. What is left is what
   * genuinely belongs to the LINE: what the material is, who supplies it, what it
   * is measured in, and the two purchase controls.
   *
   * MOQ AND ROUND TO ARE COMMON, AND THAT IS THE CLIENT'S OWN CORRECTION. They
   * were briefly made per-attribute and moved back the same minute — 0451/0452
   * carry the schema round trip. The reasoning 0437 recorded is why it is the
   * right place: a minimum is a fact about what may be BOUGHT of a material, so
   * six colour rows each floored at 500 buys 3,000 where one purchase of 500
   * covers the lot. They apply ONCE, to the line's rolled-up total.
   *
   * TWELVE FIELDS, STILL SUMMING TO 32 — 3+2+6+3+2+2+2+2+4+2+2+2. Every run must
   * make the track exactly or its last field drops to a line of its own, and the
   * width went to the two names that need it: Material holds a slashed spec and
   * Vendor holds a company name.
   *
   * ^ SUPERSEDED 2026-08-26, and kept because being RIGHT was not the problem.
   * That arrangement summed to 32 exactly as required and still could not be
   * read: 2/32 is ~98px, a clear ✕ inside the control takes ~30 of it, and Type
   * rendered as `A…` with Supply Type as `L…`. The two-line `Purchase Uom` /
   * `Consumption Uom` labels beside them made the header band two heights, which
   * is the crookedness the client actually pointed at. The run now BREAKS into
   * 32 + 16 — see the note on the array below. The sums here are still the
   * arithmetic the next person needs; what they are no longer is sufficient.
   *
   * "SEND OUT" TOOK ITS TWO COLUMNS FROM Type AND Supply Type (0466), which is
   * the only place they could come from. The spans are coarse — 2/3/4/6/8/12 —
   * so a new `xs` cell needs exactly 2 freed, and the run was already exactly
   * full at eleven. Material and Vendor were left alone deliberately: the
   * paragraph above says the width went to them because they hold long values,
   * and halving either to pay for a checkbox would undo a decision the client
   * signed off on 2026-08-21.
   *
   * BOTH DONORS SURVIVE THE CUT because they are dropdowns over short
   * vocabularies — Type is "To be advised" / "To be developed", Supply Type is
   * Nominated / Local / Import — and a picker that clips gets the reveal bubble
   * every truncated value in this app gets. Their `min-w-[110px]` /
   * `min-w-[120px]` on `itemColumns` do NOT fight this: `renderMobileRow` passes
   * only `DENSE` and `WEIGHT_CLASS` to the `Field`, never `col.className`, so
   * those minimums bind `ChildGrid`'s TABLE layout and this grid is
   * `forceCards`. Checked before the spans were changed, not assumed.
   *
   * IT SITS LAST rather than beside Material, so the identity run
   * (Category · Type · Material · Attribute) reads unbroken and the row ends on
   * the question the Processes tab asks. If the client wants it caught earlier
   * while entering, it is a one-line move — the renderer matches by HEADER, so
   * order here is presentation and nothing else depends on it.
   */
  /*
   * TWO RUNS, NOT ONE — 32 + 16 (client 2026-08-26, screenshot 231823:
   * "align the field size, this section looks unaligned").
   *
   * TWELVE FIELDS NEVER FITTED. The note above records the squeeze honestly and
   * then accepted it: "SEND OUT TOOK ITS TWO COLUMNS FROM Type AND Supply Type
   * … BOTH DONORS SURVIVE THE CUT because they are dropdowns over short
   * vocabularies, and a picker that clips gets the reveal bubble". On screen at
   * 2/32 those two are ~98px with a clear ✕ inside them, so the value itself is
   * about 60px: Type rendered as `A…` and Supply Type as `L…`. A reveal bubble
   * is a rescue for an occasional long value, not a substitute for a field that
   * can never show any value at all.
   *
   * IT ALSO EXPLAINS THE RAGGED TOP EDGE, which is what the client actually
   * pointed at. `Purchase Uom` and `Consumption Uom` do not fit on one line at
   * 98px, so those two labels wrapped to two lines while the other ten stayed on
   * one. Every control still sat on the same baseline — the inputs were never
   * misaligned — but the LABEL BAND above them was two heights, and a row whose
   * headers start at two different y positions reads as crooked even when every
   * box beneath it is level.
   *
   * SO THE ROW BREAKS INSTEAD OF THE FIELDS. Run 1 is what the material IS plus
   * how it is measured; run 2 is the purchase controls. Every field is `md`
   * (~196px) except Material (`lg`, the long slashed spec) and Combination
   * (`xs`, an icon button with no value to show) — so the widths repeat down the
   * section instead of stepping twelve different ways, which is the "aligned"
   * the client asked for.
   *
   * THE COST IS A SECOND LINE PER MATERIAL, and it is the trade being made
   * deliberately: this grid was dense on purpose and a long BOM now scrolls
   * further. Reverting is this array and nothing else — but eleven of the twelve
   * fields have to lose width again for it, so it is a choice between scrolling
   * and clipping, not a bug either way.
   *
   *   run 1  4+4+6+4+4+4+2+4 = 32
   *   run 2  4+4+4+4         = 16   (the tail of the form, left-aligned)
   */
  /*
   * ^ SUPERSEDED 2026-08-28. Still two runs, still summing to 32, and every span
   * on the row is different — because the fields the row carries changed and
   * because the widths above did not survive a browser at 110%.
   *
   * ## THE ROW LOST THREE FIELDS AND GAINED TWO
   *
   * `Type` became the `TBA` cell, and `Supply Type` and `Vendor` came off
   * altogether (client 2026-08-28); `FOC` arrived beside `Process`. Eleven
   * fields where there were twelve. The arithmetic below is re-derived rather
   * than patched, because the run sums are the whole contract of this array —
   * "change one size and its run must still make 32, or the last field on it
   * drops to a second line" — and a table that is edited entry by entry is how
   * the sums drifted to 28 and 36 once already (see the 08-20 note above).
   *
   * ## THE ZOOM FAULT, WHICH IS ARITHMETIC AND NOT A RENDERING BUG
   *
   * Reported as "columns slide and the grid stops lining up between 100% and
   * 110%". It is neither sliding nor a browser quirk, and it is worth writing
   * down because the obvious suspects are both innocent:
   *
   *  - **The `min-w-[…]` on `itemColumns` is NOT the mechanism.** Those bind
   *    `ChildGrid`'s TABLE layout, and this grid is `forceCards`. Verified in
   *    `child-grid.tsx`: all four consumers of `c.className` are the `<th>`, the
   *    `<td>`, the totals `<td>` and the `inlineCards` row; `renderMobileRow`
   *    (line ~2560) passes the column nothing. The 08-26 note above already said
   *    this and it is still true — the minimums are inert here.
   *  - **The `@lg/section` cliff is NOT it either, at any ordinary size.**
   *    `FIELD_TRACK_32` and every `FIELD_SPAN` are gated on the same 32rem
   *    container query, so they switch together: below it the run stacks to one
   *    column, which is a clean fallback, not a misalignment. The detail pane
   *    here runs ~940px at 100% on a 1366 screen and would need roughly 180%
   *    zoom to reach 512px.
   *
   * **IT IS THE GUTTER, WHICH DOES NOT SCALE.** `FIELD_TRACK_32` is
   * `grid-cols-32 gap-x-3`: 31 gaps of a FIXED 12px, so 372px of every row is
   * gutter whatever the pane is worth. A track is therefore `(W - 372) / 32`,
   * and the 372 is subtracted BEFORE the division — so a container that narrows
   * by 9% narrows every field by about 13%, and the effect accelerates. At 100%
   * (W ~= 940) a track is 17.8px; at 110% (W ~= 826) it is 14.2px.
   *
   * Run that against the spans the table above used and the reported symptom is
   * exactly what falls out:
   *
   *      span   100%     110%     125%
   *      2      47px     40px     35px      <- Combination
   *      4      107px    93px     83px      <- eight of the twelve fields
   *      6      166px    145px    130px
   *
   * A 40px cell cannot hold a control, and a 93px cell cannot hold the label
   * "Consumption Uom" (~88px at `DENSE`'s 10.5px) — so at 110% those labels wrap
   * to a second line while their neighbours do not, the label band goes to two
   * heights, and the row reads as crooked. **That is the identical fault the
   * 08-26 note diagnosed at 98px and answered by splitting the row**; zoom
   * simply reaches it from the other direction, and the split was sized for one
   * zoom level rather than for the mechanism.
   *
   * ## SO THE FIX IS A FLOOR, NOT A REARRANGEMENT
   *
   * Nothing below 3 spans, and no VALUE field below 6:
   *
   *      span   100%     110%     125%
   *      3      66px     59px     53px      <- the two ticks: a switch, no value
   *      4      107px    93px     83px      <- MOQ, Round To: 3-4 digits
   *      6      166px    145px    130px     <- every field that shows a value
   *      8      226px    197px    177px     <- run 1
   *
   * The `xs` (2-span) cell is gone entirely, which was the worst offender, and
   * the narrowest label-bearing cell is now 130px at 125% zoom — comfortably
   * past the ~88px where "Consumption Uom" wraps. Nothing on this row wraps its
   * label at any zoom a shop-floor machine is set to.
   *
   * ONE WIDTH PER RUN, which is the evenness the client asked for on 08-20 and
   * again on 08-26. Run 1 is four fields at `xl`; run 2 is three `lg`, two `md`
   * and two `sm`, stepping DOWN by what the cell holds — a value, then a short
   * number, then a switch — rather than by where it happens to sit.
   *
   * ^ SUPERSEDED THE SAME DAY, BY THE USER: "why did you make two rows, make it
   * a single row — the core point of removing the field is making a single row
   * without conflicts."
   *
   * They are right and it is the whole point of the change. Taking three columns
   * off the row to free width and then spending that width on a SECOND RUN
   * delivers the cost of the removal without its benefit. The two-run split
   * above was internally sound — every sum correct, every floor met — and was
   * solving the wrong problem.
   *
   * ## THE WIDTH CAME FROM A FLAG THIS SCREEN HAD NEVER SET
   *
   * `MasterFullScreen` caps its content pane at 1440px, and at **1720px** when
   * the active section declares `wide` — a prop written on 2026-08-17 for "a
   * section whose whole content is one wide `ChildGrid`, a line grid with ten or
   * more columns", which is this section exactly. It was never declared here.
   * So eleven cells were being fitted into 1440px while 1720px sat unclaimed,
   * and the second run is what that missing 280px bought. The flag is now on the
   * section; see the note there for why it does not repeal the cap's reasoning.
   *
   * ## MEASURED, NOT ASSUMED — AND RE-MEASURED AFTER THE GUTTER CHANGED
   *
   * At the 1720 cap the pane loses `px-4` (32px) and then the 268px master list
   * plus its 20px gutter, so the `FieldGrid` gets ~1390px. `FIELD_TRACK_32` is
   * `gap-x-2` since 2026-08-28, so 31 gaps spend 248px and a track is
   * `(W - 248) / 32`; a span of n is `n*track + (n-1)*8`:
   *
   *                  1720 cap (W~1390)   1366 @110% (W~912)
   *      xs(2)             79px                50px
   *      sm(3)            123px                78px
   *      md(4)            167px               107px
   *
   * THE LABELS ARE WHAT BREAK FIRST, not the values, and they are why the
   * numbers above are checked against a second column. At `DENSE`'s 10.5px a
   * character is ~5.9px (the file's own figure: "Consumption Uom", 15 chars,
   * ~88px). Against that, every label on this row fits its cell at the cap, and
   * at 1366@110% all of them fit except one — see the trade below.
   *
   * TWO CHANGES LANDED TOGETHER AND ONLY BOTH ARE SUFFICIENT. `gap-x-2` returned
   * 124px per row and was never enough on its own: it moves `sm` from 75px to
   * 78px, against a "Consumption Uom" needing ~88px. What closed those two cells
   * was SHORTENING THEM — `Pur. Uom` (~47px) and `Cons. Uom` (~53px), the
   * client's own abbreviations (2026-08-28). A reader tempted to revert either
   * change should note that reverting one re-breaks the row.
   *
   * ## THE TRADE, STATED RATHER THAN HIDDEN
   *
   * The 1720 cap only binds on a wide monitor. On a 1366 laptop the pane is
   * viewport-bound at any zoom — 1440 was not a cap there either, and 1720 is
   * less of one — so `wide` buys room on a large screen and nothing at all on a
   * zoomed laptop, where this arithmetic still governs. At 110% there, ONE label
   * still does not fit: **"Combination" is ~65px in a 50px cell and wraps**, and
   * "Round To" clears by ~3px. Eleven cells in 912px is ~83px each however the
   * spans are arranged, and the row is saturated at 32 — there is no slack cell
   * to move a span from, because every `md` here holds a picked NAME.
   *
   * THAT IS COSMETIC, AND `items-end` IS WHY. `FIELD_TRACK_32` bottom-aligns
   * every cell box and the control is each box's last child, so a wrapped label
   * lifts its own header text and leaves every CONTROL on one baseline
   * (`field.tsx`: "it fixes the wrap rather than forbidding it, which is why no
   * label here has to be abbreviated to keep the row straight"). One raised
   * header out of eleven is not the 08-26 defect, which was eight of twelve.
   * Shortening "Combination" would close it and is the same client-wording call
   * the Uom headers were — ask, do not take it. The other two levers are the
   * 268px master list (a client decision from 08-20) and splitting the row,
   * which is the thing the user explicitly rejected: do not split it back to two
   * runs to fix a zoom complaint without asking them again.
   *
   * ## WHAT THE SIZES MEAN HERE
   *
   * Four `md` for the cells that show a picked or chosen VALUE — Category,
   * Material, Attribute and TBA, the last of which reads "Available Item" on
   * almost every line and so needs the room its two-word value asks for. Two
   * `sm` for the unit
   * pickers, whose values are three-letter codes and whose LABELS are the
   * constraint. Five `xs` for the cells with nothing long to show: an icon
   * button, two 3-4 digit numerics and two switches.
   *
   * `xl` IS GONE, and deliberately — `FIELD_SPAN` documents it as "NOT a field
   * width … do not reach for this to make a FIELD wider", and although the
   * prohibition is written for the house 12-track (where 8 spans blows past
   * LAYOUT.md §3's ~280px cap) and was satisfied on this 32-track, borrowing a
   * constant across two tracks against its own doc-comment is a thing the next
   * reader has to re-derive. The single row needs none of it.
   *
   * ## THE ORDER, WHICH IS THE CLIENT'S AND HAS BEEN RE-CUT THREE TIMES TODAY
   *
   *   Category · Material · Attribute · Pur. Uom · Cons. Uom · MOQ ·
   *   Round To · TBA · Combination · Process · FOC
   *
   * THE MIDDLE OF THE ROW IS DICTATED (client 2026-08-28), and it was dictated
   * TWICE within the hour. First as a chain — "cons.uom - moq - round to -
   * combination - tba this order" — and then amended: **"TBA next to the Round
   * To, remaining all the same."** So TBA and Combination are the reverse of
   * that first sentence and everything else is it. A rearrangement of these
   * five cells is a change to a client instruction, not a tidy-up, and the
   * amendment is the half most likely to be "corrected" back to the chain,
   * because the chain is the sentence a reader finds quoted first.
   *
   * The first four are the identity of the line and have never moved. The last
   * two were NOT named in either sentence: `Process` and `FOC` are the row's
   * two bare toggles, they were already trailing, and taking the instruction
   * literally puts them after it. That reading was given to the client rather
   * than assumed silently — but it IS a reading, so if the two ticks are ever
   * reported as being in the wrong place, this paragraph is the thing to
   * re-ask, not the five cells above it.
   *
   * ## TBA HAS HELD FOUR POSITIONS IN ONE DAY, AND ALL FOUR WERE ASKED FOR
   *
   * Recorded in sequence because each reversed the one before it, and any of
   * them could look like the "correct" one to a reader holding only that half:
   *
   *  1. **Second**, inherited from the `Type` dropdown it replaced, which is
   *     where legacy puts it (screenshot 2362). An early version of this note
   *     said "TBA sits exactly where Type sat"; a reader who finds that quoted
   *     elsewhere is holding something three decisions out of date.
   *  2. **Last** (user 2026-08-28: "that TBA button — move it to the last field
   *     in that same row").
   *  3. **Ninth, after Combination** — the end of the chain quoted above, the
   *     same day.
   *  4. **Eighth, immediately after Round To** ("TBA next to the Round To,
   *     remaining all the same"), the same day again, which moved it one cell
   *     left and left every other cell where the chain had put it.
   *  5. **Ninth, after Combination again** — this (client 2026-08-28: "move the
   *     TBA after the combination field"), which is position 3 restored.
   *
   * **STEP 5 IS NOT THE "CORRECTION" THIS NOTE WARNED ABOUT.** The paragraph
   * above predicted a reader putting TBA back to the chain because the chain is
   * the sentence quoted first — and this is the same destination reached the
   * only legitimate way, by a fresh instruction, not by re-reading an old one.
   * The warning stands for the NEXT reader: position 4 is now the one that
   * looks like the amendment, and restoring it needs a new instruction too.
   *
   * `FOC` has been reversed the same way and for the same reason: it arrived
   * with 0474 beside `Process`, the two of them the last cells on the row; the
   * TBA move at step 2 pushed them up one; steps 3 and 4 both put them back at
   * the end, and step 4 left them alone. **Do not "restore" either field to an
   * earlier position as a correction** — every one of these positions was
   * correct on the instruction it came from, and the latest instruction is the
   * one that ships.
   *
   * TAB ORDER IS THIS ORDER. An operator now fills the line's identity, then
   * its units, then its purchase numbers, opens the Combination grid, answers
   * "is this material settled?", and leaves on the two ticks — so the row ends
   * on THREE switches in a run, which is the cheapest possible tail: none of
   * them holds a value, none opens a reveal, and nothing after one is displaced
   * by touching it.
   *
   * TBA IS A `Toggle` SINCE 2026-08-28 and no longer a `<Select>`, which is why
   * it now sits happily beside Process and FOC rather than breaking their run.
   * The earlier note here reasoned that a mid-row `<Select>` "costs nothing it
   * did not cost at position 2"; that argument is spent — the control it was
   * about no longer exists.
   *
   * THIS ARRAY IS THE AUTHORITY FOR BOTH. `renderMobileRow` walks `FIELD_GROUPS`
   * and looks each column up by header, so what is rendered — and therefore the
   * DOM order Tab reads — is this sequence, not `itemColumns`'. The two are kept
   * in the same order anyway so the file reads honestly; if they ever disagree,
   * this one is what ships.
   *
   * THE ROW ENDS ON AN ICON BUTTON AND THEN ITS TWO TICKS — Combination, then
   * Process and FOC, all three `xs` (~50px). TBA is a `<Select>` at `md`
   * (~107px) and now sits clear of them, which resolves a worry the previous
   * arrangement had to carry: for one afternoon TBA was a THIRD TICK, and when
   * it later stood between the two switches the `md` was the only thing telling
   * an operator the middle control of the three was not another switch. The
   * amendment separates them, so the width no longer has that job. It is still
   * earned — the select displays a value where the other three display none —
   * which is why it did not shrink when the reason for it narrowed.
   *
   * NOTHING WAS RESIZED TO MAKE THE 08-28 REORDER FIT, deliberately. Every cell
   * kept the span it had and only the positions changed, so the measurements
   * above and the one wrapped label below are exactly as they were — a reorder
   * that also re-sized would have made the two changes impossible to tell apart
   * the next time this row is reported as crooked.
   *
   *   one run  4+6+4+3+3+2+2+2+2+2+2 = 32
   *
   * 2026-08-28: TBA became a Toggle and moved AFTER Combination at the
   * client's request. It gave its two columns to Material, which every note
   * on this row says clips soonest — the run still totals 32, which is the
   * whole contract of this array.
   */
  [
    { header: H.category, size: "md", weight: "key" },
    /* IT TAKES THE TWO COLUMNS TBA GAVE UP (2026-08-28). The run must total 32
       or the last field drops to a line of its own, so a cell that shrinks has
       to hand its span somewhere — and this is the field every note on this row
       says clips soonest: it holds the long slashed spec, and the 08-27 pass
       recorded it dropping to ~132px as "the trade the client chose". A switch
       needs none of that width and this does. */
    { header: H.material, size: "lg", weight: "key" },
    /* A GRAIN READS "Style Ref No / Order Color / Order Size" — the longest
       value on the row after Material, and a native `<Select>` with no reveal
       bubble to rescue it, so it does not go below `md`. */
    { header: H.attribute, size: "md", weight: "key" },
    /* THE LABELS ARE THE CONSTRAINT HERE, not the values: "NOS" and "PCS" would
       fit an `xs`. These are `sm` (~78px at 1366@110%) because the HEADERS have
       to sit on one line — and they only do because the client shortened them on
       2026-08-28: "Purchase Uom" and "Consumption Uom" were ~68px and ~88px, and
       the second wrapped at every width this row reaches on a laptop.
       `H.purchaseUom` / `H.consumptionUom` are "Pur. Uom" (~47px) and "Cons.
       Uom" (~53px) now. **Lengthening either header back reopens the wrap**,
       which is why the old figures are kept here as the reason rather than
       deleted as history. */
    { header: H.purchaseUom, size: "sm", weight: "auto" },
    { header: H.consumptionUom, size: "sm", weight: "auto" },
    /* THE TWO NUMERIC BOXES, and they now follow the units directly (client
       2026-08-28: "cons.uom - moq - round to - combination - tba this order").
       Both 08-28 instructions agree on this pair and on where it sits — the
       amendment that followed ("TBA next to the Round To, remaining all the
       same") moved only the cell AFTER them. 3-4 digits in an `xs` cell,
       right-aligned; the labels ("MOQ" ~18px, "Round To" ~47px) are the
       smallest on the row and clear their 50px at 1366@110% with room. Nothing
       about them changed except where they sit. */
    { header: H.moq, size: "xs", weight: "plain" },
    { header: H.roundTo, size: "xs", weight: "plain" },
    /* AN ICON BUTTON, NOT A VALUE — the only field on the row with nothing to
       clip, which is what lets it take the smallest span without losing
       anything. The 08-24 instruction that matched it to the Consumption Uom
       cell was about the two sitting at a common `xs` track; both are now sized
       by what they hold, which is the same argument one step further on. That
       reasoning outlived the adjacency: MOQ, Round To and TBA came up BETWEEN
       the two on 2026-08-28, so the cells are no longer neighbours and the
       shared `xs` is still right, because it was never a matching exercise. */
    { header: H.combination, size: "xs", weight: "quiet" },
    /* A SWITCH SINCE 2026-08-28, so it takes the smallest span like every other
       control on this row that shows no value — the `md` it held was bought
       specifically to fit the words "Available Item", and there are no words
       any more.

       THE TWO COLUMNS GO TO MATERIAL, above. The run's whole contract is that
       it still totals 32; a cell that shrinks without saying where its span
       went is how the sums drifted to 28 and 36 once already.

       IT IS HERE BECAUSE THE CLIENT PUT IT HERE, "next to the Round To"
       (2026-08-28), amending their own chain of minutes earlier which had it
       one place further along. That placement is unaffected by the resize. */
    { header: H.tba, size: "xs", weight: "quiet" },
    /* THE TWO SWITCHES, AND THEY CLOSE THE LINE. A `Toggle` draws a ~36px
       switch and shows no value, so 76px is the control with room to spare and
       the widest label ("Process", ~42px) sits on one line. Do not reach for
       `xs` for anything that holds a typed or picked value. */
    { header: H.process, size: "xs", weight: "plain" },
    { header: H.foc, size: "xs", weight: "plain" },
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

  /*
   * WHICH LINES HAVE THEIR CONSUMPTION GRID CLOSED — ABSENCE MEANS OPEN.
   *
   * ## OPEN IS THE DEFAULT, AND IT GOT THERE BY BEING REVERSED
   *
   * Collapsed-by-default is the obvious answer and it is the one the client
   * ASKED for — "collapsing these grids by default and allowing operators to
   * expand them on-demand" — so it was built. Then it was seen (screenshots
   * 2456 / 2457, same day): picking an Attribute landed on "Color-wise — 3
   * rows" with the values behind a click, and the client wants the values
   * themselves. **The later instruction wins.**
   *
   * This is written at length because the argument FOR collapsing survives its
   * own reversal and will be made again. A 28-row Combination grid really does
   * push the screen around, and a reader who finds only that half of the story
   * will flip this default back believing it a fix. It is not: the values ARE
   * the point of the grid, and a merchandiser reading down fifteen lines is
   * reading the figures, not the row counts. The toggle stays for the 28-row
   * case, so the fold is still one click away — what the client changed is
   * which state the operator ARRIVES in, not whether folding exists.
   *
   * Reversing it again needs a NEW client decision against a screenshot, not a
   * tidy-up and not a restated version of the original ask.
   *
   * ## The safety argument, which is about `blank` and is unchanged either way
   *
   * Items and Pcs are typed in this grid, and a blank one holds the caption
   * open (`blank` below) because AGENTS.md refuses to require a HIDDEN field.
   * That guard is what makes either default safe; it is not an argument for one
   * of them.
   */
  const [closedSlices, setClosedSlices] = useState<Set<string>>(new Set());
  /*
   * WHICH COMBINATION BAND IS OPEN ON EACH LINE — an ACCORDION (client
   * 2026-08-27: "add that automatic collapse option, now its totally open ...
   * open the first section, close the second one").
   *
   * Keyed by line, holding ONE group name. Opening TOP shuts BOTTOM because
   * there is nowhere to write "both" — the invariant is the shape of the state,
   * not a rule each future writer has to remember.
   *
   * SCOPED PER LINE, unchanged and still load-bearing: combination names repeat
   * across materials, so one open group across the whole screen would fold and
   * unfold "TOP" on every line at once. The fold is a per-line reading decision.
   *
   * THREE STATES, the shape `ChildGrid`'s `openRowKey` already uses:
   *   absent — no decision yet, so the FIRST band of that line is open. That is
   *            the "open the first section" half, and it is DERIVED rather than
   *            seeded because the bands are built from the rows and do not
   *            exist yet when this state is created.
   *   a name — that band is open and every other one is shut.
   *   null   — the operator shut the open one. Nothing is open, and the grid is
   *            a clean index of bands and their unanswered counts.
   *
   * THE OLD SHUT SET IS GONE, and its reasoning with it. It was chosen so "a
   * combination added later arrives open rather than hidden behind a set nobody
   * updated" — right for a multi-open fold, and wrong under an accordion, where
   * a combination arriving open is a SECOND open band. One now arrives shut,
   * showing its name and its own unanswered count, which is what makes being
   * shut safe. `approval-qty-lines.tsx` keeps the set shape and is untouched:
   * different component, different screen, and multi-open is right there.
   */
  const [openGroups, setOpenGroups] = useState<Map<string, string | null>>(new Map());
  /**
   * Clicking the OPEN band shuts it; clicking a shut one opens it and shuts the
   * rest. A shut accordion is a legitimate resting state, so this is a real
   * toggle rather than an "always leave one open" cycle: the operator who wants
   * the whole component list as an index can have it.
   *
   * `firstName` is passed in because the CALLER is what knows this line's
   * groups. They are derived from its rows, so "the first one" cannot be read
   * out of this state.
   */
  const toggleGroup = (lineKey: string, name: string, firstName: string | null) =>
    setOpenGroups((prev) => {
      const next = new Map(prev);
      const current = prev.has(lineKey) ? prev.get(lineKey)! : firstName;
      next.set(lineKey, current === name ? null : name);
      return next;
    });

  /* The challans already raised from this BOM, keyed by the process row's own
     anchor (0446). Reloaded with the record, so it is the DATABASE's view of
     what has gone out — never the form's. */

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

  /**
   * WHICH LINE'S COMBINATION SHEET IS OPEN, by row key rather than by index.
   *
   * A key, because the grid's rows are added and removed under it: an index
   * would follow whatever line slid into that position when a row above was
   * deleted, and the operator would find themselves editing another material's
   * construction with nothing on screen saying so.
   */
  const [comboLineKey, setComboLineKey] = useState<string | null>(null);

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
   * The line whose Combination sheet is open, resolved from the key each render.
   *
   * NOT HELD IN STATE ALONGSIDE THE KEY. A copy of the row would go stale the
   * moment the operator typed in the sheet — the rows it edits live in `items`,
   * and a snapshot taken when the sheet opened would render yesterday's panels
   * over today's. Resolving here is what makes the sheet a view of the line
   * rather than a second copy of it.
   *
   * `undefined` when the key names a line that has since been removed, which
   * closes the sheet on the next render rather than leaving it editing an
   * orphan.
   */
  const comboLine = comboLineKey ? items.find((x) => x.key === comboLineKey) : undefined;

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
   *
   * ## IT IS A SUFFIX NOW — `STRING (SEW)`, NOT `SEW · STRING` (client 2026-08-28)
   *
   * The same drop that removed the `class_code ·` prefix from the Material list
   * one cell to the right. THE COLLISION GATE ABOVE IS UNCHANGED and must stay:
   * the client's words are "no longer show the Item Class Name IN FRONT OF the
   * category" (2026-08-17) and "eliminates complex dot-notation formatting in
   * dropdowns" (2026-08-28), and neither says the qualifier itself may go. It
   * may not — STRING really is a category under both SEW and PACK today, so
   * stripping it outright puts two identical rows in this list and the operator
   * picks by coin toss. Behind the name is not in front of it; only the position
   * moved.
   *
   * ## AND THE POSITION IS NOT COSMETIC, BECAUSE IT DECIDES THE SORT
   *
   * `RecordPicker` sorts by the DISPLAYED label (`a.label.localeCompare(b.label)`)
   * and `pickerIdentityParts` puts `name` into `label`. A LEADING code therefore
   * sorted the whole list by CLASS and alphabetised only within each block — so
   * an operator hunting a name alphabetically had to know its class first, which
   * is precisely what a cell offering both classes cannot assume. Moving the
   * qualifier behind the name puts the sort back on the name. If another option
   * label in this file is ever reshaped, check whether it feeds a sort first.
   *
   * ONE SHAPE ACROSS THE ROW: `NAME (CODE)` here, `BUTTON (SEW)` on Material, and
   * the `(uncategorised)` suffix `materialsForCategory` already wrote. The
   * operator learns one rule — the name is the row, anything bracketed after it
   * is the list explaining why the row is there.
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
      return code ? { ...c, name: `${c.name} (${code})` } : c;
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
   * THE MATERIALS THIS BOM ACTUALLY CARRIES — the Processes tab's own list.
   *
   * A process row names a material that is being SENT OUT to be dyed or washed,
   * so it can only ever be one of the materials this BOM buys. Legacy makes that
   * structural: its Processes tab LISTS the item and nests the process rows under
   * it, with nothing to pick (screenshot 2484). Ours offered
   * `materialsFor(null, …)` — the whole accessory master, and the comment on that
   * cell said so — so an operator could raise a dyeing row against a button this
   * order has never heard of, and nothing downstream would object: the row saves,
   * a Delivery Challan can be generated from it, and the material it names has no
   * requirement, no quantity and no vendor on this document.
   *
   * This is the cascading-picker rule, and the narrowing belongs at the CALLER
   * because this layer is the only one that knows which lines the BOM has (client
   * 2026-08-24: "now planning screen only need to listed select").
   *
   * THE HELD VALUE ALWAYS SURVIVES, the rule under "Disabled rows": a process row
   * saved before its material was removed from the Items grid would otherwise
   * show an empty field and blank the FK on the next save — silent data loss
   * dressed up as tidiness. It stays pickable-back rather than vanishing.
   */
  const procMaterialOptions = (held: string | null) => {
    const onBom = new Set(items.map((x) => x.item_id).filter((v): v is string => !!v));
    return materialsFor(null, held).filter((o) => onBom.has(o.id) || o.id === held);
  };

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

  /**
   * ITEM COLOR OFFERS THE COLOURS THIS ORDER DECLARES — wired the way the Prices
   * tab wires its Combo cell (client 2026-08-20: "item color is from same how we
   * listing color in price tab wire here also").
   *
   * The cell already MEANT this. Its own note says "same list as the garment's
   * colours, so matching is expressible" — and it then offered the entire
   * `fabric_color` master, ~every colour the business has ever bought. Matching
   * was expressible and unhelped: the operator had to know which of them this
   * order was actually made in.
   *
   * NARROWED BY THE LINE'S STYLE TOO, because a combo belongs to a style on the
   * Combos tab. That is the cascading-picker rule with the narrowing at the layer
   * that knows the parent, and it is the same shape the Prices tab's
   * `comboOptionsForStyle` uses one screen over.
   *
   * MATCHED ON THE NAME, and that is the join this can have. A combo is a NAME on
   * the Combos tab ("GREY MELANGE") while this column is a `fabric_color` uuid,
   * so the two meet through the label. Upper-cased on both sides for the reason
   * `styleKey` exists: rows saved before the CAPITALS rule are not upper-cased.
   *
   * EMPTY FALLS BACK TO THE WHOLE MASTER, deliberately — the same call the Prices
   * tab makes and for the same reason: an order whose Combos tab is not filled in
   * yet would otherwise have an unusable cell, and this list is a CONVENIENCE,
   * not an approval. It is not the nominated-vendor case, where offering
   * everything was the data-integrity hole itself.
   */
  /**
   * THE SIZES THIS ORDER CARRIES, in the order the order states them.
   *
   * `orderProd.sizeNames` is the id -> label map the requirement already builds,
   * and `assortSizes` is where a size actually appears on this order — so a size
   * the master knows and this order does not never reaches the cell. Deduped by
   * id, because a size appears once per (style, combo) in the assort tree.
   */
  const orderSizeOptions = useMemo(() => {
    const seen = new Set<string>();
    const out: { id: string; name: string }[] = [];
    for (const r of orderProd?.assortSizes ?? []) {
      const id = r.size_id;
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push({ id, name: orderProd?.sizeNames?.[id] ?? id });
    }
    return out;
  }, [orderProd]);

  const orderColourOptions = (styleRef: string, held: string | null) => {
    const wanted = new Set(
      (orderProd?.combos ?? [])
        .filter(
          (c) =>
            !styleRef.trim() ||
            (c.style_ref_no ?? "").trim().toUpperCase() ===
              styleRef.trim().toUpperCase(),
        )
        .map((c) => (c.combo ?? "").trim().toUpperCase())
        .filter(Boolean),
    );
    if (wanted.size === 0) return itemColours;
    const narrowed = itemColours.filter((l) =>
      wanted.has((l.name ?? "").trim().toUpperCase()),
    );
    // A HELD VALUE ALWAYS SURVIVES — the standing rule. A colour a saved line
    // already names must keep resolving even if the order no longer declares it,
    // or a filled cell renders empty and blanks its FK on the next save.
    if (held && !narrowed.some((l) => l.id === held)) {
      const row = itemColours.find((l) => l.id === held);
      if (row) return [...narrowed, row];
    }
    return narrowed.length ? narrowed : itemColours;
  };

  const selectedOrder = useMemo(
    () => data.orders.find((o) => o.id === form.garment_order_id) ?? null,
    [data.orders, form.garment_order_id],
  );

  /** The customer is the ORDER's, never typed here. A BOM belongs to whoever the
   *  order belongs to, and a second copy of that fact is a second thing to keep
   *  true — it also feeds the nominated-vendor rule below. */
  const customerId = selectedOrder?.customer_id ?? null;
  const customerName = selectedOrder?.customer_name ?? null;

  /* `vendorRule` STOOD HERE — the `{customerId, customerName, vendors,
     nominations}` bundle `NominatedVendorPicker` and the Supply Type Select were
     handed. Both controls came off on 2026-08-28 and it has no reader left.
     `data.vendors` / `data.nominations` still arrive on the props because the
     service is not this screen's to change. See the import note at the top. */

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

  /**
   * TYPE A CONSUMPTION AGAINST ONE SLICE (0442).
   *
   * An UPSERT keyed on the slice, and a DELETE when the cell is emptied — because
   * an absent row and a row of nulls mean the same thing ("use the line's"), and
   * keeping the empty one would fill the table with rows that say nothing.
   *
   * `sno` is assigned at save from the array index (`actions.ts`), so nothing
   * here has to maintain it.
   */
  /**
   * TYPE A CONSUMPTION, OR TICK A FLAG, AGAINST ONE SLICE (0442; widened 0449).
   *
   * An UPSERT keyed on the slice, and a DELETE when the row has nothing left to
   * say — because an absent row and a row of defaults mean the same thing.
   *
   * ## "NOTHING LEFT TO SAY" IS NO LONGER "BOTH FIGURES NULL"
   *
   * 0442 built this as a sparse store of typed FIGURES. Since 0449 a row also
   * carries legacy's Choose and Size-wise ticks and three descriptive fields, so
   * the emptiness test is every field at its default — and `chosen` defaults
   * TRUE, so an unticked row is emphatically not empty.
   *
   * `sno` is assigned at save from the array index (`actions.ts`), so nothing
   * here has to maintain it.
   */
  const setSlice = (
    itemKey: string,
    /* `& { combination }` rather than widening `ProductionSlice` itself: a
       production slice is what the ATTRIBUTE explodes a line into, and a typed
       garment part is not one of those. The two meet only here, on the stored
       row, so the intersection belongs at this call rather than in the explosion
       engine's vocabulary. */
    slice: ProductionSlice & { combination?: string | null },
    patch: Partial<
      Pick<
        MbaItemSlice,
        | "no_of_items"
        | "per_pieces"
        | "excess_pct"
        | "moq"
        | "round_to"
        | "chosen"
        | "size_wise"
        | "item_color_id"
        | "specification"
        | "size_spec"
      >
    >,
  ) =>
    mutItems((xs) =>
      xs.map((x) => {
        if (x.key !== itemKey) return x;
        const want = sliceKey(slice);
        const found = x.slices.find((o) => sliceKey(o) === want);
        const next: MbaItemSlice = {
          id: found?.id ?? "",
          item_line_id: found?.item_line_id ?? "",
          sno: found?.sno ?? 0,
          // THE KEY, copied off the slice rather than the found row: a row that
          // does not exist yet has no key of its own to preserve.
          combo: slice.combo,
          size_id: slice.size_id,
          country_id: slice.country_id ?? null,
          // PART OF THE KEY SINCE 0463, so it is copied off the slice with the
          // other three. Defaulting it to null here instead would blank the name
          // of every combination row this upsert touches — and since the name is
          // what the row IS, the row would merge into the line's plain slice on
          // the next `sliceKey` comparison.
          combination: slice.combination ?? null,
          // PART OF THE KEY SINCE 0464, copied off the slice with the other
          // four. This is the field that makes a style-basis row identify itself
          // at all — defaulting it to null here would merge every style's typed
          // figure back onto one row, which is the defect 0464 fixed.
          style_ref_no: slice.style_ref_no ?? null,
          chosen: found?.chosen ?? true,
          size_wise: found?.size_wise ?? false,
          item_color_id: found?.item_color_id ?? null,
          specification: found?.specification ?? null,
          size_spec: found?.size_spec ?? null,
          excess_pct: found?.excess_pct ?? null,
          moq: found?.moq ?? null,
          round_to: found?.round_to ?? null,
          no_of_items: found?.no_of_items ?? null,
          per_pieces: found?.per_pieces ?? null,
          ...patch,
        };
        const rest = x.slices.filter((o) => sliceKey(o) !== want);
        const empty =
          next.no_of_items == null &&
          next.per_pieces == null &&
          next.excess_pct == null &&
          next.moq == null &&
          next.round_to == null &&
          next.chosen === true &&
          next.size_wise === false &&
          next.item_color_id == null &&
          !next.specification &&
          !next.size_spec;
        return { ...x, slices: empty ? rest : [...rest, next] };
      }),
    );

  /**
   * THE ATTRIBUTE'S OWN GRID — legacy's nested sub-row, under the line's fields
   * (client 2026-08-21, screenshots 2458 / 2459).
   *
   * WHAT IT IS NOT: a list of separate materials. An earlier attempt generated
   * one BOM line per slice and filled the material list with a dozen "Not filled
   * in" entries — the client: "not as separate material… inside the screen".
   *
   * THE ROWS ARE NOT STORED. They are `productionSlices()` — the same call the
   * Requirement section makes — so the grid always mirrors the order's CURRENT
   * colours, sizes and destinations (the client's rule: "follow the order
   * exactly"). Only the typed cells and the two ticks are stored, and a row whose
   * slice has gone is simply not drawn.
   *
   * A REFUSAL DRAWS NOTHING. `productionSlices` refuses when the order's tabs
   * disagree, and `qtyRibbon` prints that sentence in full below — a second copy
   * here would be a second place for the wording to drift.
   */
  /**
   * THE PER-ROW TICKS, READ THE SAME WAY THE SERVER READS THEM (0449).
   *
   * `sliceFlags` in `actions.ts` is the same function over the same keys. Two
   * readings of one store is exactly how the screen and the server came to
   * disagree about per-slice consumption before — the defect fixed earlier today
   * — so this is deliberately the same shape, and if one moves both must.
   *
   * `chosen` DEFAULTS TRUE: a slice with no stored row has never been unticked.
   */
  const sliceFlagsOf = (r: ItemRow) => {
    const by = new Map(r.slices.map((sl) => [sliceKey(sl), sl]));
    return {
      row: (sl: ProductionSlice) => by.get(sliceKey(sl)) ?? null,
      chosen: (sl: ProductionSlice) => by.get(sliceKey(sl))?.chosen ?? true,
      sizeWise: (sl: ProductionSlice) => by.get(sliceKey(sl))?.size_wise ?? false,
      /* The row's own trim colour (0449). Mirrors `sliceFlags` in actions.ts —
         the two read the same store the same way, which is what stops the grid
         colouring a row differently from the row that gets stored. */
      colour: (sl: ProductionSlice) => by.get(sliceKey(sl))?.item_color_id ?? null,
    };
  };

  /**
   * A line's COMBINATION SPLITS as the engine wants them.
   *
   * READS `slices`, NOT THE POPUP'S NAMES, and that is the whole shape of 0463:
   * the popup types WHAT the parts are called and the listing types what each
   * one consumes, so the figures live on the slice. A row with no `combination`
   * is an ordinary attribute slice and is skipped rather than folded in under a
   * blank name.
   *
   * The figures are already numbers here — a slice holds `number | null`, unlike
   * the line's own boxes, which are strings because a number cannot represent a
   * box the operator has just cleared. NULL stays NULL: `colourSplits` refuses
   * on it with a sentence, never 0, which would make an unfinished split
   * compute.
   */
  /**
   * THE POPUP'S NAMES FOLDED BACK INTO `slices` — the payload boundary, and the
   * only place the two directions meet.
   *
   * Three groups, and each is a decision:
   *
   *   - a slice with NO combination is an ordinary attribute row and passes
   *     through untouched. The popup knows nothing about it and must not be able
   *     to delete it;
   *   - a slice whose name SURVIVES is kept whole, figures and all. This is the
   *     reason the names are a view rather than a store: Item Color,
   *     Specification and the three figures were typed out in the listing, and
   *     re-deriving the row from the name alone would silently discard them;
   *   - a name with no slice yet becomes a BLANK row, so the listing has
   *     something to show and something to type into. Blank means NULL
   *     everywhere, never 0 — `colourSplits` refuses on a null with a sentence,
   *     and a 0 would quietly compute an unfinished split into a purchase.
   *
   * A name REMOVED from the popup takes its slices with it, which is the
   * operator saying that part is gone. That is destructive on purpose and it is
   * why the popup's remove is a per-row ✕ rather than anything bulk.
   */
  const slicesWithCombinations = (r: ItemRow): MbaItemSlice[] => {
    const names = Array.from(
      new Set(r.combinations.map((c) => c.combination.trim()).filter((n) => n !== "")),
    );
    const wanted = new Set(names);
    const nameOf = (sl: MbaItemSlice) => (sl.combination ?? "").trim();

    const plain = r.slices.filter((sl) => nameOf(sl) === "");
    const kept = r.slices.filter((sl) => nameOf(sl) !== "" && wanted.has(nameOf(sl)));
    const have = new Set(kept.map(nameOf));

    const fresh: MbaItemSlice[] = names
      .filter((n) => !have.has(n))
      .map((n) => ({
        id: "",
        item_line_id: "",
        // Re-numbered by the server from array order, the same way every other
        // child on this payload is — a serial minted here would collide with
        // the plain rows it is concatenated beside.
        sno: 0,
        combo: null,
        size_id: null,
        country_id: null,
        combination: n,
        /* NULL, not the line's style: a fresh combination row is not yet
           attached to one. The grid's own rows carry the style they belong to
           (`crossCombinations` spreads it off the production slice), and THAT is
           what `setSlice` keys by the first time a figure is typed. Guessing a
           style here would create a row keyed to it that no grid row matches. */
        style_ref_no: null,
        chosen: true,
        size_wise: false,
        item_color_id: null,
        specification: null,
        size_spec: null,
        excess_pct: null,
        moq: null,
        round_to: null,
        no_of_items: null,
        per_pieces: null,
      }));

    return [...plain, ...kept, ...fresh];
  };

  /*
   * `combinationSplitsOf` WAS HERE, AND IT WAS FEEDING A PANEL ENGINE WITH
   * SOMETHING THAT IS NOT PANELS (removed 2026-08-25, measured).
   *
   * It mapped every `r.slices` row carrying a combination NAME into a
   * `BomLineComponent` and handed the list to `colourSplits`, whose contract is
   * the panels of ONE GARMENT — front body 25m, sleeves 12m, collar 8m — summed
   * into a rate per garment. But since 0463 the grid crosses each name with
   * every production slice, so those rows are (name x colourway) pairs: TOP
   * appeared once per colourway and its rate was summed that many times.
   *
   * The line's rate was then multiplied by the slice quantities again in the
   * totals loop, which is legitimate — so the error was a clean factor of "how
   * many slices this line explodes into". Measured against the real functions,
   * a 2/1 line with WHITE 300 / NAVY 200 and TOP 3/1 + BOTTOM 1/1:
   *
   *     panel path 4,000  |  honest 2,000  |  what the server stores 1,000
   *
   * TWO SEPARATE FAULTS, AND ONLY ONE OF THEM IS THIS FILE'S. The 0436
   * component store is retired — `components: []` goes up on every save (see
   * the payload) and both tables are empty — so the server never had a panel
   * split to apply and the screen was the only place this ran. Removing it puts
   * the screen back on the line's own ratio, which is the figure a purchase
   * order is actually checked against: same store, same reading, same answer,
   * the invariant this loop states twice above.
   *
   * WHAT WAS STILL WRONG HERE IS NOW FIXED, AND THE WARNING ABOVE IT EARNED ITS
   * KEEP. This block used to end: "neither side crosses its slices by combination
   * ... crossing them HERE alone would make the screen print 2,000 beside a stored
   * 1,000, which is worse than both being 1,000: the screen would be showing a
   * number nothing is checked against. It needs the screen and the server changed
   * together."
   *
   * The server was taught first (`requirementRows`, actions.ts) and this loop was
   * not — so the predicted divergence happened in the mirror image: the SAVE held
   * 2,000 and this ribbon showed 1,000. Both cross now, through the one
   * `crossCombinations` in `slice-consumption.ts` that `sliceGrid` also calls, so
   * there is no longer a side to change alone.
   *
   * The lesson the old paragraph was right about stands: crossing is not a screen
   * decision or a server decision, it is the definition of what a slice IS once
   * `sliceKey` carries `combination` (0463). Any future caller that builds slices
   * and skips the crossing re-opens this by itself.
   */

  /**
   * WHAT A SLICE CONSUMES — THREE LEVELS, RESOLVED PER FIELD: the size box, then
   * the row it sits under, then the line.
   *
   * `consumptionFor` returns the same shape it takes, so composing it twice IS
   * the chain — there is no second resolution rule to keep in step with the
   * first. A size child's key is (combo, size, country) and its parent row's is
   * (combo, null, country), so without the middle step a figure typed on a row
   * is invisible to its own sizes (screenshot 2465).
   *
   * ## IT IS A FUNCTION BECAUSE THE THIRD COPY OF IT WAS WRONG
   *
   * `requirementRows` in actions.ts carries this chain and its comment asserts
   * *"The screen resolves identically; two rules would be two answers"*. That
   * was true of `figuresOf`, which draws the per-row strip, and NOT of the line
   * totals loop, which resolved ONE level and skipped the parent row entirely.
   * So a figure typed against a colourway appeared in the row strip, was stored
   * by the server, and was missing from the Excess Calculated Qty and Final
   * Quantity above it — the two figures `bom-ceiling.ts` writes a purchase order
   * against. Three copies of one rule, and the divergence hid in the copy that
   * feeds the money.
   */
  const consumptionChain = (r: ItemRow, slice: ProductionSlice) => {
    const lineDefaults = {
      no_of_items: numOrNull(r.no_of_items),
      per_pieces: numOrNull(r.per_pieces),
      excess_pct: numOrNull(r.excess_pct),
    };
    const parent = slice.size_id
      ? consumptionFor(lineDefaults, r.slices, {
          combo: slice.combo,
          size_id: null,
          country_id: slice.country_id ?? null,
        })
      : lineDefaults;
    return consumptionFor(parent, r.slices, slice);
  };

  /**
   * WHY THIS LINE'S COMBINATION SHEET CANNOT BE OPENED, or null when it can.
   *
   * ONE DERIVATION, read by the button's `disabled` and by the sentence that
   * explains it. Stating the gate twice is how a control comes to sit greyed out
   * beside a tooltip promising it is available — the "one fact, two places"
   * defect this file already records for `consumptionFor`.
   *
   * ## THE SPEC'S GATE NAMES A GRAIN THIS SCREEN CANNOT OFFER
   *
   * The spec says the cell is "disabled by default" and enables only on a
   * combination grain, naming two: *Style for Combination* and *Style for Colour
   * for Combination*. Read against the STORED vocabulary those are
   * `{style_ref, trim_colour}` and `{style_ref, colour, trim_colour}` —
   * `AXIS_LABELS.trim_colour` is literally the word "Combination", and
   * `exploder.ts` says so in prose: *"`trim_colour` IS THE CLIENT'S
   * 'Combination'"*.
   *
   * **`requirement_basis = 'combination'` is the decoy, not the switch.** It
   * means colour x size (0420); `labelFor` renders it "Style Ref No / Order
   * Color / Order Size" and `REQUIREMENT_BASIS_LABELS` renders it "Combination
   * (Color + Size)", a qualifier types.ts says exists *precisely* to tell it
   * apart from this cell. Gating on it would grey the button out on eight of the
   * nine grains — "Whole order" among them — where `crossCombinations` visibly
   * still crosses every typed name into every slice and `colourSplits` still
   * takes the line's ratio from them. That is disabling correct work.
   *
   * **But no offered grain declares `trim_colour` either**, and that is
   * deliberate rather than an oversight: `ORDER_AXES` excludes it because the
   * panels are a property of the BOM LINE and `colourSplits` (0436) applies them
   * to every slice DOWNSTREAM, so passing the axis to the composer would be a
   * second place the trim colour divides rows. `producibleGrains()` is derived
   * from those plans, so the menu cannot offer one. Enforcing the axis today
   * disables the button on EVERY line and takes 0436 off the screen entirely —
   * the feature deleted by the gate meant to tidy it.
   *
   * So the enforced half is the half that is reachable and unarguable: **an
   * unanswered Attribute**. It satisfies "disabled by default" exactly — a new
   * line has no grain — and it disables nothing that works, because such a line
   * has no requirement rows at all (the Requirement section already refuses it
   * with the same sentence) and the sheet would open with a blank Attribute in
   * its own header.
   *
   * ## AND THAT IS WHERE THE CLIENT LEFT IT (2026-08-25)
   *
   * Tightening it further was put to the client as a choice between the only two
   * readings the stored vocabulary supports, and BOTH WERE DECLINED:
   *
   *   - *literal* — enable only on a grain declaring `trim_colour`, which is what
   *     the spec literally says. Refused because it cannot be SATISFIED today:
   *     `ORDER_AXES` offers no such grain, so the gate disables every line in the
   *     system and takes 0436 off the screen. It becomes reachable only if
   *     `trim_colour` ever joins the composer's axes — and that is a change to
   *     `ORDER_AXES` / `producibleGrains()` with 0436's downstream application to
   *     re-argue first, not a change to make here.
   *   - *implicit* — read the spec's two names as `{style_ref}` and
   *     `{style_ref, colour}`, on the reasoning that panels are a property of a
   *     style's construction rather than of a size or a destination. Coherent,
   *     and refused anyway: it disables combinations on "Whole order" and on the
   *     matrix grains, where they work TODAY and where live rows may already
   *     exist — stranding rows behind a gate is the exact failure the block below
   *     exists to prevent.
   *
   * So a reader who finds the spec's wording beside this weaker gate is NOT
   * looking at an unfinished job. Restoring either reading needs a NEW client
   * decision taken against the consequence named above, not a tidy-up.
   *
   * ## A LINE THAT ALREADY HOLDS COMBINATIONS STAYS OPENABLE
   *
   * Clearing the Attribute back to blank must not strand the rows behind it.
   * They are still in `combinations`, still crossed into `slices` by
   * `slicesWithCombinations`, and still SAVED — `writeChildren` reinserts
   * whatever the form carries — so a disabled button would leave the operator
   * looking at a count they can neither open nor empty. That is the call
   * AGENTS.md makes under "Disabled rows" for the FK a record already holds: the
   * one row that survives is the one already chosen, because dropping it is
   * silent data loss dressed up as tidiness. It also means the count badge is
   * never drawn on a disabled button — a blocked line has none by construction.
   */
  /**
   * THE ONE NAME A GRAIN IS SHOWN BY, everywhere on this screen.
   *
   * The menu, the read-only Attribute cell and the Combination sheet header all
   * read this, so they cannot drift into naming one grain three ways. It resolves
   * the CLIENT's wording and falls back to the engine's `labelFor` for a grain
   * their list does not name — the ninth grain, and any older stored value.
   *
   * `labelFor` stays the engine's own name and is still what refusal sentences
   * are built from; this is the operator's. Two audiences, one lookup each.
   */
  const grainLabel = (axes: readonly Axis[]) => clientLabelFor(axes, labelFor);

  const combinationsBlocked = (r: ItemRow): string | null => {
    if (r.combinations.length > 0) return null;
    /* NULL IS THE UNANSWERED STATE AND `[]` IS "WHOLE ORDER" — the distinction
       0455 spends a paragraph on, and the reason this reads the array's
       PRESENCE rather than its length. An empty set is a chosen grain, so a
       whole-order line opens; only a line nobody has answered is blocked. */
    if (!r.requirement_grain) {
      return "Choose an Attribute first — a combination splits what it divides";
    }
    /*
     * ## AND THE ATTRIBUTE MUST NAME A COMBINATION (client, 2026-08-26)
     *
     * THIS IS THE TIGHTER GATE THAT WAS REFUSED ON 08-25, AND WHAT CHANGED IS
     * THE MENU, NOT THE CLIENT'S MIND. It was declined then for a reason that
     * was true then: `producibleGrains()` offered no grain declaring
     * `trim_colour`, so enforcing the axis would have disabled this button on
     * EVERY line in the system and taken 0436 off the screen. The client's own
     * 22 rows now include five that name it — "Style / Combination" and its
     * variants — so the gate has something to be satisfied BY, and the same
     * decision comes out the other way. The refusal comment above records the
     * older reasoning; both are correct at their own dates.
     *
     * THIS IS ALSO WHAT TELLS THE FIVE PAIRS APART. "Style / Combination" plans
     * exactly the rows "Style" plans — `orderAxesOf` strips the token and
     * `colourSplits` applies the panels per line — so nothing in the GRID
     * distinguishes them. The button is the differentiator the client named:
     * picking a Combination attribute is the key that unlocks panel mapping for
     * that trim, and the rows not multiplying is expected, because the panels
     * have not been configured yet.
     *
     * The `combinations.length > 0` escape above still comes FIRST, and it has
     * to: changing the Attribute away from a Combination one must never strand
     * rows the operator has already typed behind a disabled button. Same call
     * AGENTS.md makes under "Disabled rows" for a held FK.
     */
    /* `namesCombination` and the sentence both come from `client-matrix`, so the
       Attribute cell's tooltip and this refusal cannot answer the question
       differently — a hint that says "pick a Combination attribute" while the
       button is refusing for another reason sends the operator to change a
       field that was already right. */
    if (!namesCombination(r.requirement_grain)) {
      return COMBINATION_LOCKED_HINT;
    }
    return null;
  };

  /**
   * THE ATTRIBUTE'S OWN GRID — legacy's nested sub-row (client 2026-08-21,
   * screenshots 2458 / 2459: "our screen we right but field listing is wrong").
   *
   * WHAT IT IS NOT: a list of separate materials. An earlier attempt generated
   * one BOM line per slice and filled the material list with a dozen "Not filled
   * in" entries — the client: "not as separate material… inside the screen".
   *
   * THE ROWS ARE NOT STORED. They are `productionSlices()` — the same call the
   * Requirement section and the server both make — so the grid always mirrors the
   * order's CURRENT colours, sizes and destinations. Only the typed cells and the
   * ticks are stored, and a row whose slice has gone is simply not drawn.
   *
   * TWO CALLS, DELIBERATELY. The PRIMARY rows are the grid's rows, so they are
   * fetched without the tick; the expanded set is fetched with it and its
   * children are grouped under their parent by key prefix — `expandBySize` mints
   * a child as `${parent.key}${SEP}${sizeId}` precisely so that grouping is a
   * string test rather than a second explosion.
   *
   * A REFUSAL DRAWS NOTHING. `productionSlices` refuses when the order's tabs
   * disagree, and `qtyRibbon` prints that sentence in full below.
   */
  const sliceGrid = (r: ItemRow) => {
    if (!orderProd) return null;

    /*
     * ## IT RESOLVES FROM THE GRAIN, AND GATING ON THE LEGACY BASIS WAS A DEAD END
     *
     * This read `if (!r.requirement_basis) return null`, and `requirement_basis` is
     * NOT the Attribute — it is the six-name legacy alias, written by the Attribute
     * `<Select>` as `basisForAxes(picked) ?? ""`. `basisForAxes` resolves only the
     * six sets in `BASIS_AXES`, so EVERY OTHER GRAIN STORED `""`, the gate read it
     * as falsy, and this function returned null: no grid, no caption, no sentence.
     *
     * That is the surface where No. of Items and Per Pieces are typed — they left
     * the Items row on 2026-08-21 and exist nowhere else. So picking one of those
     * Attributes produced a screen that DEMANDS a figure and offers nowhere to put
     * it: the yellow "Enter how many are used per piece" from `sliceRequirement`,
     * permanently, with no box on the page (client 2026-08-26, screenshots 2499 /
     * 2501).
     *
     * SIXTEEN OF THE TWENTY-TWO ATTRIBUTES WERE DEAD THIS WAY — every grain naming
     * `trim_colour` (the five "Combination" rows), `Style / Order Size`,
     * `Country / Country Size`, and the retained ninth grain. Only #1, #2, #6, #7,
     * #9 and #14 have a legacy name and therefore ever drew. It predates "enable
     * all" and that change made it visible by adding five nameless rows.
     *
     * THE ANSWER WAS ALREADY WRITTEN TWICE and neither copy was read from here:
     * `lineTotals` below does exactly this, and so does `requirementRows` on the
     * server. Both resolve the grain, try for a legacy name, and fall back to
     * `slicesForAxes` when there is none.
     */
    const grain: Axis[] | null =
      r.requirement_grain ??
      (r.requirement_basis ? axesOfBasis(r.requirement_basis as RequirementBasis) : null);
    /* THE ONE SILENT RETURN LEFT, and it is silent because the line has answered
       NOTHING: the Requirement section already refuses it by name ("Choose how this
       material splits") and the Attribute cell carries a red `*`. A second sentence
       here would say the same thing twice about a field one cell away. */
    if (!grain) return null;

    const asBasis = basisForAxes(grain);
    /* ONE TEST, THREE READERS — the row label, the column head and nothing else may
       ask "which axis is this grain keyed on". Written once so the head cannot come
       to name a column the label does not fill. */
    const grainNames = (a: Axis) => grain.includes(a);
    const flags = sliceFlagsOf(r);

    const primaryRaw = asBasis
      ? productionSlices(asBasis, orderProd)
      : slicesForAxes(grain, orderProd);
    /* A REFUSAL DRAWS NOTHING, and that is checked rather than assumed: `qtyRibbon`
       renders `t.refusal` in full immediately after this grid, so the operator gets
       the sentence and not a gap.

       THE LENGTH TEST IS UNREACHABLE TODAY. Every branch of the engine either
       yields at least one row or refuses — verified across `primarySlices`,
       `expandBySize` and `refineByCountry`. It stays as a guard, and is written
       down as dead so a later reader does not treat "no rows, no refusal" as a
       live state worth designing for. */
    if (isRefusal(primaryRaw) || primaryRaw.length === 0) return null;

    /* THE TICK GOES ONLY TO A NAMED BASIS, which is the server's rule verbatim: the
       0449 size tick is per ROW and can be MIXED across a grain, and an axis set is
       all-or-nothing by construction, so routing a composed grain through the
       predicate would silently drop a shipped feature. A nameless grain has never
       had per-row ticks, so there is nothing to expand and `primaryRaw` stands. */
    const expandedRaw = asBasis
      ? productionSlices(asBasis, orderProd, undefined, flags.sizeWise)
      : primaryRaw;

    /*
     * THE COMBINATION IS A SECOND AXIS, CROSSED WITH THE ATTRIBUTE'S (0463).
     *
     * The Attribute explodes the line into rows; the Combination popup splits
     * each of those into one row per garment part. Two parts on a two-style
     * order is four rows, and that is the point — TOP on style A consumes
     * something different from TOP on style B.
     *
     * ## THE NAME PREFIXES THE UI KEY, AND SUFFIXING IT WOULD BREAK THE SIZES
     *
     * A size child is minted as `${parent.key}${SLICE_SEP}${sizeId}` and found
     * again by `startsWith` (below), so the parent's key must stay a PREFIX of
     * its children's. Appending the name would make the parent `k∙TEST` while
     * its children stayed `k∙size`, and every ticked row would silently lose its
     * size boxes. Prefixing keeps the relation: `TEST∙k` is still a prefix of
     * `TEST∙k∙size`, as long as BOTH sets are crossed the same way — which is
     * why this runs over `expandedRaw` too and not just the primary rows.
     *
     * The UI key is not the STORED key. `sliceKey` is built from the row's
     * fields (`combination` among them since 0463), so what identifies a stored
     * override is unaffected by this string.
     *
     * `combination: null` on a line with no names, NOT an empty string: null is
     * "this line has no combinations" and reaches `sliceKey`'s coalesce as the
     * same value a pre-0463 row has, so nothing that was already stored moves.
     */
    /* THE NAMES, from the same helper the server derives them with. */
    const comboNames = combinationNames(r.combinations);
    /* THE CROSSING COMES FROM `slice-consumption` — the same function
       `requirementRows` calls on the server. It was a local closure here and
       nothing at all there, which is exactly how the screen came to display
       2,000 while the save stored 1,000. */
    const crossHere = <T extends ProductionSlice>(rows: readonly T[]) =>
      crossCombinations(rows, comboNames).map((sl) =>
        /* THE UI KEY IS PREFIXED HERE AND NOWHERE ELSE. A size child is minted
           as `${parent.key}${SLICE_SEP}${sizeId}` and found again by
           `startsWith`, so the parent's key must stay a PREFIX of its children's
           — which is why the name goes in FRONT, and why both sets are crossed
           the same way. What identifies a STORED row is `sliceKey`, built from
           the row's fields, and it is unaffected by this string. */
        sl.combination === null ? sl : { ...sl, key: `${sl.combination}${SLICE_SEP}${sl.key}` },
      );

    const primary = crossHere(primaryRaw);
    const expanded = isRefusal(expandedRaw) ? expandedRaw : crossHere(expandedRaw);

    /**
     * FIGURES THE CURRENT ATTRIBUTE DOES NOT REACH — one derivation, read by
     * the count and by the sentence beside it, so the two cannot disagree.
     *
     * ## WHAT WAS REPORTED, AND WHAT IS ACTUALLY THERE (measured 2026-08-25)
     *
     * The report was: a planner types overrides at the Colour grain, switches
     * the Attribute to Whole Order, and *"the old numbers remain visible with no
     * indicator"*, so they believe those figures are still inflating the totals.
     * The client asked for the stale CELL to be greyed with a strike-through.
     *
     * Half of that is real and the visible half is not. Run against the real
     * engine on a two-colour order carrying two colour-grain overrides:
     *
     *     grain "colour" -> 2 rows, using 9/1 and 4/1   (the typed figures)
     *     grain "order"  -> 1 row,  using 2/1           (the LINE's ratio)
     *
     * So the bypass is real: the figures stop counting, exactly as reported.
     * But there is no stale cell to mark. The rows are `productionSlices()`, not
     * storage — the header above says so — so collapsing the axes DRAWS ONE ROW
     * and the colour rows are simply absent. Greying a cell that does not render
     * is an indicator for a state that never reaches the screen.
     *
     * **AND THE REAL HAZARD IS THE OPPOSITE OF THE ONE REPORTED.** Measured on
     * the same fixture, `liveOverrides` — the filter the SAVE path runs — keeps
     * 0 of those 2 rows against a whole-order live set. The figures are not
     * lingering and inflating anything; they are invisible, inert, and the next
     * ordinary save DELETES them. That is why this says something rather than
     * marking something, and why it warns about saving.
     *
     * ## WHY IT ASKS WHAT THE GRID DRAWS, NOT WHAT THE SAVE WILL KEEP
     *
     * Mirroring the save path exactly is the tempting version and it is wrong
     * twice over. `requirementRows` builds its live set as
     * `productionSlices(basis, order)` with NO size-wise tick, so it also drops
     * every SIZE-level override of a ticked row — measured, 0 of 1 kept — which
     * is a defect in that file, not a state to warn about here. A label that
     * mirrored it would fire on figures the operator typed correctly under the
     * grain they are looking at: a warning on correct work, which is the failure
     * the combination gate above refused. So the question asked here is the one
     * the screen can answer with certainty — *is there a row for this?* — and
     * the sentence says a save "can" discard them rather than predicting it.
     *
     * A REFUSED EXPANSION SHOWS NOTHING. The live set is then UNKNOWN, not
     * empty, and `liveOverrides`' own header gives that argument for the same
     * reason: unknown must not vote to condemn.
     *
     * A NAME STRUCK FROM THE COMBINATION POPUP IS EXCLUDED. Its slices are
     * dropped deliberately at the payload boundary (`slicesWithCombinations`:
     * *"a name REMOVED from the popup takes its slices with it"*), so counting
     * them here would warn about a deletion the operator just asked for.
     */
    const drawn = isRefusal(expanded)
      ? null
      : new Set([...primary, ...expanded].map(sliceKey));
    const liveNames = new Set(comboNames);
    const bypassed = drawn
      ? r.slices.filter((sl) => {
          if (drawn.has(sliceKey(sl))) return false;
          const name = (sl.combination ?? "").trim();
          if (name !== "" && !liveNames.has(name)) return false;
          /* "TYPED" AS THE SERVER DEFINES IT — the same clause list
             `requirementRows` filters on, because a row it would not have stored
             is not a figure anyone can lose. `chosen === false` and
             `size_wise === true` are on it for the reason 0449 gives: an
             unticked row is emphatically not empty. */
          return (
            sl.no_of_items != null ||
            sl.per_pieces != null ||
            sl.excess_pct != null ||
            sl.moq != null ||
            sl.round_to != null ||
            sl.chosen === false ||
            sl.size_wise === true ||
            sl.item_color_id != null ||
            !!sl.specification ||
            !!sl.size_spec
          );
        })
      : [];

    /**
     * ADVISORY, AND DELIBERATELY NOT ANY OF THE THREE THINGS IT COULD BE.
     *
     * Not a HOLD: it carries no `data-dup-error` and nothing focusable, so it
     * cannot refuse a key or move where Tab lands. AGENTS.md is explicit that an
     * advisory stays plain amber text — and these figures may be exactly what
     * the planner wants back when they switch the Attribute again, which is the
     * opposite of an error.
     *
     * Not a DISABLED control: there is nothing to disable, and a stale value the
     * operator can neither correct nor clear is the stranding failure the
     * combination gate above refuses in its own comment.
     *
     * Not a TOOLTIP: the client asked for one, and a tooltip needs something to
     * hover. There is no bypassed cell on screen — that is the finding — so the
     * sentence is simply printed. It also keeps this away from
     * `lib/reload-guard.ts`: a bubble that registers there permanently blocks
     * the silent auto-update on the route.
     *
     * The tokens are `qtyRibbon`'s, one screen down, because this is the same
     * kind of statement in the same place; `bg-warning-soft` / `text-warning` are
     * the real ones (`bg-muted` and friends compile to nothing here).
     */
    const bypassNotice = bypassed.length ? (
      <div className="mt-2 flex items-start gap-2 rounded-md bg-warning-soft px-3 py-2 text-xs text-warning">
        <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          {/* "Bypassed" IS THE CLIENT'S OWN WORD, kept so they can recognise
              their request. The rest is in this screen's vocabulary: the
              operator has never seen the words "axis grain" — the column is
              called Attribute.

              IT NAMES THE STATE AND NOT THE CURE, deliberately. "Switch the
              Attribute back to reach them" was written first and is only true
              of the reported cause; the SAME state arises when a colourway
              leaves the order, and there no Attribute puts those rows back. A
              sentence that is right in the common case and wrong in the other
              is how this module's bugs have arrived, so it says the two things
              that hold in both: not counted, and a save can discard them. */}
          Bypassed &mdash; {bypassed.length} typed{" "}
          {bypassed.length === 1 ? "figure sits" : "figures sit"} outside this
          Attribute and {bypassed.length === 1 ? "is" : "are"} not counted here.
          Saving can discard {bypassed.length === 1 ? "it" : "them"}.
        </span>
      </div>
    ) : null;

    /*
     * A GRID WITH A BLANK REQUIRED FIGURE CANNOT BE CLOSED.
     *
     * Items and Pcs left the line on 2026-08-21 and are typed HERE now, so the
     * requiredness came with them — and AGENTS.md is explicit that requiring a
     * HIDDEN field is a record that cannot be saved with nothing on screen to say
     * why. This screen already learned it once: the detail band carried the same
     * rule for the same two fields before they moved.
     *
     * So the caption's chevron stays put and says WHICH row is unanswered,
     * rather than vanishing — the same shape `canFold` uses one level up.
     */
    const blank = primary.find((sl) => {
      const o = flags.row(sl);
      if (!(o?.chosen ?? true)) return false; // an unticked row buys nothing
      /* THE SAME CHAIN AS EVERYWHERE ELSE. These are PRIMARY rows, which carry
         no size, so the chain reduces to the single call this used to make —
         routed through it anyway, because "the copy that happens to agree" is
         how the totals loop came to be the copy that did not. */
      const use = consumptionChain(r, sl);
      return use.no_of_items == null || use.per_pieces == null;
    });

    const open = !closedSlices.has(r.key) || !!blank;
    const toggle = () =>
      setClosedSlices((prev) => {
        const next = new Set(prev);
        if (next.has(r.key)) next.delete(r.key);
        else next.add(r.key);
        return next;
      });

    /* Can this row split at all? A tick with no size break-up behind it would
       refuse the whole line the moment it was ticked, so the box says so and
       stays disabled instead. */
    /*
     * WHY A ROW CANNOT SPLIT ITSELF BY SIZE — one derivation, three consequences:
     * the box's disabled state, its tooltip, and what the save will actually keep.
     *
     * THE ORDER'S BREAK-UP COMES FIRST, being the older and stronger refusal: with
     * no assort rows a tick refuses the whole line the moment it is set.
     *
     * THE ATTRIBUTE IS THE NEW ONE, and it was live-and-useless until now.
     * `slicesForAxes` takes NO tick predicate — deliberately, see the two-path
     * comment above — so `requirementRows` cannot store a per-row tick against a
     * composed grain. The box was enabled anyway, so ticking it wrote a
     * `size_wise` the next save discarded: a control that looks live, changes
     * nothing, and leaves the screen and the store describing one row differently.
     *
     * BOTH SENTENCES OFF ONE TEST, so they can never both show or both be wrong: a
     * composed grain either already names Order Size — `{style_ref, size}` and
     * `{size, country}` come out of the composer pre-expanded, so their rows ARE
     * size rows — or it does not, and the operator needs a different Attribute.
     */
    const sizeWiseWhyNot =
      orderProd.assortSizes.length === 0
        ? "This order has no size break-up on Quantities ▸ Assort to split by"
        : asBasis
          ? null
          : grainNames("size")
            ? "This Attribute already splits every row by Order Size"
            : "Pick an Attribute that names Order Size to split these rows by size";

    const unitKnown = !!r.purchase_uom_id || !!r.consumption_uom_id;
    /* THE SAME PACK THE LINE TOTAL AND THE PER-SLICE COLUMN READ. A row's Final
       is the line's MOQ and step run over ONE row, so it has to be in the unit
       those two are typed in — cones where the line names a cone. */
    const rowPack = packOf(r);

    /**
     * THE THREE FIGURES A ROW SHOWS (client 2026-08-21: "calculated to final qty
     * also not a common value, which is also attribute based").
     *
     * `calc` is the ratio applied to this slice, `needs` adds the row's own
     * Excess %, and `final` runs the LINE's MOQ and Round To over that one row.
     *
     * ## MOQ AND ROUND TO STAY ON THE LINE, AND THAT IS NOT AN OVERSIGHT
     *
     * 0437 settled it with the client on 2026-08-19 with a worked example: a
     * minimum is a fact about what may be BOUGHT of a material, so six colour
     * rows each floored at 500 buys 3,000 where one purchase of 500 covers the
     * lot. Same argument 0418 makes for keeping MOQ off the requirement table.
     * So a row shows what the line's minimum does to IT, and the line owns the
     * number.
     *
     * The rows therefore need not sum to the line's Final Quantity, and visibly
     * do not once an MOQ bites — which is honest: the line buys one quantity, and
     * this says how it lands on each attribute value.
     */
    const figuresOf = (sl: ProductionSlice) => {
      const o = stored(sl);
      // THE SAME CHAIN THE LINE TOTALS AND THE SERVER READ — see
      // `consumptionChain`, and why it is a function rather than a third copy.
      const use = consumptionChain(r, sl);
      const lineInput = {
        no_of_items: use.no_of_items,
        per_pieces: use.per_pieces,
        excess_pct: use.excess_pct ?? 0,
        decimals: uomDecimals(r.consumption_uom_id),
      };
      const withExcess = requirementFor(lineInput, sl);
      const base = baseRequirementFor(lineInput, sl);
      /*
       * A REFUSAL IS NOT ZERO, AND THIS COERCED IT TO ZERO TWICE.
       *
       * `requirementFor` refuses an unanswered slice by name — "Enter how many
       * are used per piece" — and both figures turned that sentence into the
       * digit 0, which `fmtQty` then printed. So every row of a fresh grid
       * claimed `0`, `0`, and the `+ Exc` one is the loudest cell on the row
       * (`font-medium text-info` on `bg-info-soft/40`): the most eye-catching
       * value in the grid was a number nobody computed.
       *
       * The engine says so one line above its own refusal — "0 is not 'no
       * material needed' … a half-filled one carries 0" — and
       * `check-bom-slices.mts` asserts "zero is not a figure — a rate of 0 buys
       * nothing". This was the one place that did not honour it.
       *
       * NULL, AND THE RENDER NEEDS NO CHANGE: `fmtQty(null)` already prints an
       * em dash, which is what `Final` has always shown for this state. A DASH
       * AND NOT A BLANK, deliberately — LAYOUT.md draws that line at the table
       * edge: "in a table a dash is right and stays right, because a column of
       * blanks is ambiguous with a column that failed to load". The blank rule
       * is for form fields, which have a box saying "a value goes here".
       */
      const needs = isRefusal(withExcess) ? null : withExcess;
      const q = isRefusal(withExcess)
        ? null
        : lineQuantity(
            [needs],
            o?.moq ?? numOrNull(r.moq),
            o?.round_to ?? numOrNull(r.round_to),
            unitKnown,
            undefined,
            /* THE MINIMUM AND THE STEP ARE PURCHASE FACTS (0451), so they run
               over the purchase figure. Undefined where no pack is named, and
               `lineQuantity` then behaves exactly as it did. */
            rowPack.usable
              ? toPurchaseSlices([needs], rowPack.pack, rowPack.decimals)
              : undefined,
          );
      return {
        calc: isRefusal(base) ? null : base,
        needs,
        final: q && !isRefusal(q) ? q.finalQty : null,
        /* THE SENTENCE, CARRIED so a cell can say why it is empty rather than
           leaving three dashes to be read as "nothing needed". */
        refusal: isRefusal(withExcess) ? withExcess.refused : null,
      };
    };

    const cellOf = (sl: ProductionSlice, sizeLabel: string | null): BomSliceCell => {
      const o = stored(sl);
      const f = figuresOf(sl);
      const use = consumptionChain(r, sl);
      return {
        key: sl.key,
        sizeLabel,
        calc: f.calc,
        needs: f.needs,
        final: f.final,
        refusal: f.refusal,
        /* THE SAME `consumptionChain` CALL `blank` MAKES, so the red star, the
           cursor hold and the section's refusal to close are one derivation with
           three consumers. Conditional, never always: a blank box the LINE
           already answers is not unfilled, and holding the cursor there would
           cage the operator on a finished row. */
        itemsRequired: use.no_of_items == null,
        piecesRequired: use.per_pieces == null,
        items: o?.no_of_items != null ? String(o.no_of_items) : "",
        pieces: o?.per_pieces != null ? String(o.per_pieces) : "",
        excess: o?.excess_pct != null ? String(o.excess_pct) : "",
      };
    };

    /* THE FULL STORED ROW, not `overrideFor`'s narrow view: that returns a
       `SliceOverride`, which is the two figures the resolution needs and none of
       the flags 0449 added. */
    const stored = flags.row;
    const sizeName = (id: string | null) => orderProd.sizeNames?.[id ?? ""] ?? id ?? "—";

    /*
     * ## THE BANDS — a combination named ONCE above its run
     *
     * IDENTITY MODE FIRST, and it is the reported case: with ONE axis value the
     * axis is constant, so the combination becomes the row's own name and a band
     * would only repeat the row beneath it. `groupHead` stays null throughout and
     * nothing folds — there is nothing to fold TO.
     *
     * OTHERWISE ONE BAND PER RUN. `crossCombinations` is name-major, so the runs
     * are already consecutive: this is a scan, never a regroup, and
     * `check-bom-slices` asserts that rather than trusting it. A head is simply
     * the first row whose name differs from the one before.
     */
    /** The same trim the crossing and `combinationNames` apply, so a name here
     *  and a name in a stored key cannot differ by a space. */
    const norm = (v: string | null | undefined) => (v ?? "").trim();
    const axisValues = new Set(primary.map((sl) => sl.label)).size;
    const bandMode = axisValues > 1 && comboNames.length > 0;
    const rows: BomSliceRow[] = primary.map((sl, i) => {
      const o = stored(sl);
      const ticked = flags.sizeWise(sl);
      const kids = isRefusal(expanded)
        ? []
        : expanded.filter((x) => x.key !== sl.key && x.key.startsWith(`${sl.key}${SLICE_SEP}`));
      const name = (sl.combination ?? "").trim();
      const opensGroup =
        bandMode && name !== "" && (i === 0 || norm(primary[i - 1]?.combination) !== name);
      /* THE RUN THIS BAND HEADS — counted here because the band reports on rows
         the component never sees as a set. An UNTICKED row is not unanswered:
         it buys none of this material, which is an answer. */
      const run = opensGroup ? primary.filter((x) => norm(x.combination) === name) : [];
      const runUnanswered = run.filter((x) => {
        const u = consumptionChain(r, x);
        return flags.chosen(x) && (u.no_of_items == null || u.per_pieces == null);
      }).length;
      return {
        key: sl.key,
        /* Its own column, never folded into `label` — the label is the AXIS
           value and this is a second axis crossed with it. */
        combination: sl.combination,
        groupKey: bandMode && name !== "" ? name : null,
        groupHead: opensGroup
          ? {
              key: name,
              name,
              rows: run.length,
              unanswered: runUnanswered,
              /* NULL WHILE ANY CHOSEN ROW IS UNANSWERED. A partial sum of a
                 half-typed group is a figure somebody would act on. */
              needs:
                runUnanswered > 0
                  ? null
                  : run.reduce((t, x) => {
                      const f = figuresOf(x);
                      return t + (flags.chosen(x) && f.needs != null ? f.needs : 0);
                    }, 0),
              /* `whyNotClose` WAS HERE AND IS GONE (2026-08-27). It disabled the
                 chevron while the run held an unanswered required cell, citing
                 AGENTS.md: hiding a required blank is a record that cannot be
                 saved with nothing on screen to say why.

                 On a NEW BOM every run is unanswered, so every chevron was dead
                 and the accordion could not exist. The band answers the rule it
                 cited: a shut group still prints "N of M unanswered" in warning
                 colour, so the blank is reported, not hidden. See the band in
                 `bom-slice-grid.tsx`. */
            }
          : null,
        /*
         * THE ENGINE'S OWN LABEL, DERIVED FROM NOTHING HERE.
         *
         * This switched on the basis, and both branches had to go rather than be
         * ported onto the grain:
         *
         *  - the STYLE branch was a no-op. `primarySlices` emits
         *    `style_ref_no: style || null` beside `label: style || "(no style
         *    ref)"`, so `sl.style_ref_no ?? sl.label` re-derived its own input.
         *  - the COLOUR branch was LOSSY. A colour row is labelled
         *    `multiStyle ? "TSH-001 · WHITE" : "WHITE"` — deliberately, because
         *    `axesOfBasis("colour")` is `{style_ref, colour}` precisely so that
         *    one style's white cannot absorb another's. Printing `sl.combo`
         *    alone throws the style away, so a two-style order drew TWO ROWS
         *    BOTH READING "WHITE" — and the caption's "… needs Items and Pcs"
         *    hint then named a row the operator could not pick out.
         *
         * A composed grain has no basis to switch on at all, so the choice was
         * between inventing a third naming rule and using the one the refusal
         * sentences, the Requirement tab and the server already print.
         */
        label: sl.label,
        chosen: o?.chosen ?? true,
        sizeWise: ticked,
        specification: o?.specification ?? "",
        sizeSpec: o?.size_spec ?? "",
        /* THE ROW KEEPS ITS OWN FIGURES EVEN WHEN TICKED (screenshot 2465).
           They are what a blank size box inherits, and taking them away removed
           both the box the operator wanted to type in and the thing the sizes
           were meant to fall back to. */
        cell: cellOf(sl, null),
        sizes: ticked ? kids.map((k) => cellOf(k, sizeName(k.size_id))) : [],
        sizeWiseWhyNot,
      };
    });

    /* SAME ORDER AS `label` ABOVE, and it has to be: the head names the column the
       label fills, so testing the axes in a different order would title a column of
       style refs "Colour". "Scope" stays the fallback — it is what the whole-order
       row ("Whole order") and a country-less composed grain both need. */
    const axisHead = grainNames("style_ref")
      ? "Style"
      : grainNames("colour")
        ? "Colour"
        : grainNames("country")
          ? "Country"
          : "Scope";

    const caption = (
      <button
        type="button"
        data-row-open
        onClick={toggle}
        aria-expanded={open}
        disabled={!!blank}
        title={blank ? "Fill in Items and Pcs before closing this" : undefined}
        className="flex w-full items-center gap-2 border-b border-border bg-surface-muted px-3 py-1.5 text-left text-[11px] text-muted-foreground hover:text-foreground disabled:cursor-default disabled:hover:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        {open ? (
          <ChevronDown className={cn("h-3.5 w-3.5 shrink-0", blank && "opacity-40")} />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 shrink-0" />
        )}
        <span>
          {/* THE ATTRIBUTE'S OWN NAME, through the same `grainLabel` the Attribute
              cell and the Combination sheet header read. It was
              `REQUIREMENT_BASIS_LABELS[basis]`, which is undefined for a composed
              grain — so a caption that survived the old gate would have printed
              nothing where its name belongs. One vocabulary, one lookup. */}
          {grainLabel(grain)} &mdash; {rows.length} row
          {rows.length === 1 ? "" : "s"}
        </span>
        {/* NAMES THE ROW rather than just refusing. A control that will not close
            and does not say why reads as broken. */}
        {blank && (
          <span className="ml-auto text-[11px] text-warning">
            {rows.find((x) => x.key === blank.key)?.label ?? blank.label} needs Items and Pcs
          </span>
        )}
      </button>
    );

    /* CLOSED RENDERS THE CAPTION AND NOTHING ELSE — never `hidden`. A hidden
       field is still in the DOM, so Tab and the required-holds would both visit a
       box the operator cannot see. */
    /* THE NOTICE SHOWS IN BOTH STATES. A collapsed section is exactly where a
       bypassed figure is easiest to forget — the caption names the Attribute and
       its row count, both of which look entirely correct. */
    if (!open) {
      return (
        <>
          <div className="mt-4 rounded-lg border border-border">{caption}</div>
          {bypassNotice}
        </>
      );
    }

    const byKey = new Map(
      (isRefusal(expanded) ? primary : [...primary, ...expanded]).map((x) => [x.key, x]),
    );

    return (
      <>
        <BomSliceGrid
          caption={caption}
          axisHead={axisHead}
          rows={rows}
          /* THE PRECISION THE THREE DERIVED COLUMNS WERE CEILINGED TO. Without it
             the grid printed them through `fmtNumber`, whose bare `toLocaleString`
             caps at three fraction digits and rounds to NEAREST — so a six-decimal
             unit showed LESS than the stored requirement. See `fmtQty`. */
          decimals={uomDecimals(r.consumption_uom_id)}
          /* THE FINAL COLUMN IS THE PURCHASE ONE. Calc and + Exc are metres;
             Final is cones. Three figures side by side in two units need the
             second unit NAMED, or the row reads as one number that jumped. */
          finalDecimals={rowPack.usable ? rowPack.decimals : undefined}
          finalUnit={rowPack.uom}
          /* WHAT A BLANK BOX WILL USE. The line still CARRIES all three even
             though it no longer shows them, so an older BOM's figures remain the
             default until a row types its own. */
          linePlaceholder={{
            items: r.no_of_items || "",
            pieces: r.per_pieces || "",
            excess: r.excess_pct || "",
          }}
          renderColour={(rowKey) => {
            const sl = byKey.get(rowKey);
            if (!sl) return null;
            const o = stored(sl);
            return (
              <LookupDialogPicker
                kind="fabric_color"
                label="Item Color"
                options={orderColourOptions(sl.style_ref_no ?? r.style_ref_no, o?.item_color_id ?? null)}
                value={o?.item_color_id ?? null}
                onChange={(id) => setSlice(r.key, sl, { item_color_id: id })}
                canCreate={masterPerms.canCreate}
                canEdit={masterPerms.canEdit}
                compact
              />
            );
          }}
          /* THE ONE OPEN BAND ON THIS LINE, scoped per line for the reason the
             state note gives: combination names repeat across materials.

             `firstGroup` is read off the ROWS rather than stored, because the
             bands are derived from them — with no decision recorded yet, the
             first band of this line is the open one. `?? null` covers a line in
             identity mode, which builds no bands at all and folds nothing. */
          openGroup={
            openGroups.has(r.key)
              ? openGroups.get(r.key)!
              : (rows.find((x) => x.groupHead)?.groupHead?.key ?? null)
          }
          onToggleGroup={(name) =>
            toggleGroup(r.key, name, rows.find((x) => x.groupHead)?.groupHead?.key ?? null)
          }
          onFlag={(rowKey, patch) => {
            const sl = byKey.get(rowKey);
            if (!sl) return;
            setSlice(r.key, sl, patch);
          }}
          onSet={(cellKey: string, patch: { items?: string; pieces?: string; excess?: string }) => {
            const sl = byKey.get(cellKey);
            if (!sl) return;
            setSlice(r.key, sl, {
              ...(patch.items !== undefined ? { no_of_items: numOrNull(patch.items) } : {}),
              ...(patch.pieces !== undefined ? { per_pieces: numOrNull(patch.pieces) } : {}),
              ...(patch.excess !== undefined ? { excess_pct: numOrNull(patch.excess) } : {}),
            });
          }}
        />
        {bypassNotice}
      </>
    );
  };

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
    // A new document has sent nothing anywhere.
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
        /* THE GRAIN WHERE THE ROW HAS ONE, else derived from the legacy basis.
           0455 backfilled every stored row, so the fallback is for a payload
           older than the column rather than for live data — and deriving beats
           defaulting to `[]`, which would rewrite the line as whole-order. */
        requirement_grain:
          (c.requirement_grain as Axis[] | null) ??
          (c.requirement_basis
            ? axesOfBasis(c.requirement_basis as RequirementBasis)
            : null),
        style_ref_no: c.style_ref_no ?? "",
        component_id: c.component_id,
        supply_type: c.supply_type ?? "",
        vendor_id: c.vendor_id,
        purchase_uom_id: c.purchase_uom_id,
        consumption_uom_id: c.consumption_uom_id,
        alternate_uom_id: c.alternate_uom_id,
        uom_conversion_id: c.uom_conversion_id,
        combination: c.combination ?? "",
        send_out: c.send_out ?? false,
        /* `?? false` for the same reason as `send_out`: a service that has not yet
           selected the column must read as "not free of cost", never crash the
           editor open. 0474. */
        is_foc: c.is_foc ?? false,
        moq: c.moq != null ? String(c.moq) : "",
        round_to: c.round_to != null ? String(c.round_to) : "",
        no_of_items: c.no_of_items != null ? String(c.no_of_items) : "",
        per_pieces: c.per_pieces != null ? String(c.per_pieces) : "",
        excess_pct: c.excess_pct != null ? String(c.excess_pct) : "",
        required_by: c.required_by ?? "",
        /* THE NAMES ARE READ BACK OFF THE SLICES, never stored twice (0463).
           DISTINCT and in slice order, because two slices of one combination is
           the ordinary state — TOP in RED and TOP in WHITE are two rows of one
           name — and the popup lists parts, not rows. Feeding it the raw column
           would show TOP twice and let the operator "remove" one of them. */
        combinations: Array.from(
          new Set(
            (c.slices ?? [])
              .map((sl) => (sl.combination ?? "").trim())
              .filter((n) => n !== ""),
          ),
        ).map((name) => ({ key: newKey(), combination: name })),
        // `?? []` for the same reason as `components` above — a service that
        // does not select them must read as "no overrides", never crash the
        // editor open.
        slices: c.slices ?? [],
      })),
    );
    setProcs(
      r.processes.map((p) => ({
        key: newKey(),
        // CARRIED, never re-minted: this is what a challan already raised
        // against the row is matched by.
        row_uid: p.row_uid,
        item_id: p.item_id,
        process_id: p.process_id,
        vendor_id: p.vendor_id,
        qty_out: p.qty_out != null ? String(p.qty_out) : "",
        stage: p.stage ?? "",
        forScope: p.for_scope ?? "",
        description: p.description ?? "",
        // `String(0)` is "0" and stays visible, which is why this tests for null
        // rather than falsiness — a process that genuinely loses nothing must
        // read as 0, not as unanswered.
        loss: p.loss_pct != null ? String(p.loss_pct) : "",
        notes: p.notes ?? "",
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
    /* THE SENTENCE NAMES THE PURCHASE ORDER, NOT A CELL (2026-08-28). It used to
       read "vendors were left blank", which was accurate and, once the Vendor
       cell came off the item row, pointed at nothing the operator could see —
       sending them hunting for a field that is not there is worse than saying
       nothing. The FACT is unchanged and still worth saying: the copy action
       drops a vendor the new customer has not nominated, so the choice really
       does have to be made again, at the step that now makes it. */
    success(
      next.vendorsDropped
        ? "Material list copied — vendors were not carried over; they are nominated per customer and are chosen on the purchase order"
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
          /* TRAVELS WITH THE RECIPE, exactly as `requirement_basis` beside it
             does: how a trim SPLITS is a property of the material, not of the
             order it was copied from. The style ref and the panels do not
             travel because they name THIS order's rows; a grain names axes. */
          requirement_grain:
            (c.requirement_grain as Axis[] | null) ??
            (c.requirement_basis ? axesOfBasis(c.requirement_basis) : null),
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
          send_out: c.send_out ?? false,
          /* TRAVELS WITH THE RECIPE, unlike the vendor beside it: whether a trim is
             free-issue is a term of THIS order's arrangement with its customer,
             and the copy source's customer may be a different one — but the copy
             action already re-scopes vendors and not this, and an operator
             copying a BOM is copying the shape of the buy. Untick it where it
             does not apply; a wrongly-blank FOC is the safer half only if the
             source is untrusted, and a chosen copy source is not. */
          is_foc: c.is_foc ?? false,
          moq: c.moq != null ? String(c.moq) : "",
          round_to: c.round_to != null ? String(c.round_to) : "",
          no_of_items: c.no_of_items != null ? String(c.no_of_items) : "",
          per_pieces: c.per_pieces != null ? String(c.per_pieces) : "",
          excess_pct: c.excess_pct != null ? String(c.excess_pct) : "",
          required_by: "",
          // Dropped by the copy action itself — a combination names a garment
          // part of THIS order's styles, and the source order's are not this
          // one's. The slices it would split are dropped with it.
          combinations: [],
          // A slice names this order's colours and sizes, and a source order's
          // are not this one's — the same argument `components` makes above.
          slices: [],
        })),
        procs: res.payload.processes.map((p) => ({
          key: newKey(),
          // The action already minted a fresh anchor per copied row — a copy has
          // sent nothing anywhere, so it must not inherit the source's challan.
          row_uid: p.row_uid ?? crypto.randomUUID(),
          item_id: p.item_id ?? null,
          process_id: p.process_id ?? null,
          vendor_id: p.vendor_id ?? null,
          qty_out: "",
          stage: "",
          forScope: "",
          description: "",
          loss: "",
          notes: "",
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
        requirement_grain: c.requirement_grain,
        style_ref_no: c.style_ref_no || null,
        component_id: c.component_id,
        supply_type: c.supply_type || null,
        vendor_id: c.vendor_id,
        purchase_uom_id: c.purchase_uom_id,
        consumption_uom_id: c.consumption_uom_id,
        alternate_uom_id: c.alternate_uom_id,
        uom_conversion_id: c.uom_conversion_id,
        combination: c.combination || null,
        send_out: c.send_out,
        is_foc: c.is_foc,
        moq: numOrNull(c.moq),
        round_to: numOrNull(c.round_to),
        no_of_items: numOrNull(c.no_of_items),
        per_pieces: numOrNull(c.per_pieces),
        excess_pct: numOrNull(c.excess_pct) ?? 0,
        required_by: c.required_by || null,
        /* PANELS THAT NAME A PANEL. `mbaItemComponentInput.component_id` is a
           `uuid()`, so a blank row — the one a grid opens with — would fail the
           parse with a raw Zod message rather than a sentence. Dropping it here
           is the same call `normalizeItems` makes for an untouched line, and the
           row is untouched by definition: the required hold on the cells means
           anything half-typed has already been refused at the caret. */
        slices: slicesWithCombinations(c),
        /* THE 0436 COMPONENT STORE IS RETIRED (0463) and this is what empties
           it. `writeChildren` deletes and reinserts every child, so sending an
           empty array is an instruction to keep none — which is right: the
           per-panel editor that filled this table was replaced by the
           Combination popup, and the table holds no rows. It is sent rather
           than omitted because the payload schema still declares it; the column
           and the table are dropped in a later migration, one release after
           their last writer, so there is a release in which to notice a
           mistake. */
        components: [],
      })),
      processes: procs.map((p) => ({
        sno: 0,
        row_uid: p.row_uid,
        item_id: p.item_id,
        process_id: p.process_id,
        vendor_id: p.vendor_id,
        qty_out: numOrNull(p.qty_out),
        stage: p.stage.trim() || null,
        for_scope: p.forScope.trim() || null,
        description: p.description.trim() || null,
        loss_pct: numOrNull(p.loss),
        notes: p.notes.trim() || null,
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
   * HOW MANY ORDERS SIT IN EACH STATE, IN THE ORDER THE WORK SHOULD BE DONE —
   * not in `BOM_STATUSES` declaration order and never sorted by count.
   *
   * `BOM_STATUS_RANK` has said "order of work for the dashboard: what needs
   * doing, first" since the statuses were extracted, and until now nothing on
   * screen read it: the list was sorted by it invisibly, and the filter offered
   * the five states in declaration order. Sorting by count would bury
   * Recalculate — the one state that means a plan is silently wrong — beneath
   * Updated on any healthy queue.
   */
  const statusCounts = useMemo(
    () =>
      [...BOM_STATUSES]
        .sort((a, b) => BOM_STATUS_RANK[a] - BOM_STATUS_RANK[b])
        .map((status) => ({
          status,
          count: tasks.filter((t) => t.status === status).length,
        })),
    [tasks],
  );

  /**
   * WHAT THE QUEUE AMOUNTS TO — the one figure a merchandiser wants before
   * reading any card, and the one the cards cannot show.
   *
   * FOUR BRANCHES, BECAUSE THREE OF THEM ARE TRUE AT DIFFERENT TIMES and only
   * the first is the happy one. An order whose production quantity is refused
   * (`production_qty` null — no Approval Qty rows) cannot be added to a total,
   * so it is counted SEPARATELY rather than silently dropped: a sentence that
   * says "7,150 pieces across 3 orders" while a fourth order sits unplanned and
   * untotalled is exactly the kind of number that gets believed.
   */
  const queueSummary = useMemo(() => {
    const open = tasks.filter((t) => t.status !== "updated");
    const totalled = open.filter((t) => t.production_qty != null);
    const untotalled = open.length - totalled.length;
    const pieces = totalled.reduce((n, t) => n + (t.production_qty ?? 0), 0);

    if (totalled.length > 0) {
      return `${fmtNumber(pieces)} pieces across ${totalled.length} order${totalled.length === 1 ? "" : "s"} waiting on a material plan${
        untotalled > 0 ? ` · ${untotalled} more cannot be totalled yet` : ""
      }`;
    }
    if (untotalled > 0) {
      return `${untotalled} order${untotalled === 1 ? "" : "s"} waiting on a material plan · none can be totalled yet`;
    }
    return tasks.length > 0 ? "Every confirmed order has a current material plan." : null;
  }, [tasks]);

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
  /**
   * PRODUCTION LEADS, and the order of the three is the point.
   *
   * It was Styles · Production · Delivery at one weight, so nothing was
   * emphasised and nothing was scannable (client 2026-08-21, screenshot 2440).
   * The BOM multiplies the production quantity — it is the number this document
   * is FOR — and a merchandiser going down the queue is going down the
   * quantities. Delivery is the urgency and holds the right edge, where dates
   * line up down the grid; the style count is the least of the three and no
   * longer leads.
   *
   * A refusal still prints its sentence where the number would go, and a missing
   * delivery date is still a dash: "the system tried and cannot answer" and
   * "nobody has entered one" are different facts, and only the first is a
   * sentence.
   */
  const cardStats = (t: BomTaskRow): CardStat[] => [
    {
      label: "Production",
      /* `lead` REMOVED, and this is a shared-tree artefact rather than a design
         change. The prop belongs to a 230-line in-progress rewrite of
         `MobileCardList` in the parallel session; `CardStat` at HEAD is still
         `{ label, value }`. It reached this commit because git stages whole
         files and that session's edits to THIS file are interleaved with mine.
         Put it back when their `mobile-card-list.tsx` lands. */
      value:
        t.production_qty != null
          ? fmtNumber(t.production_qty)
          : (t.production_refusal ?? "—"),
    },
    { label: "Styles", value: t.style_count },
    {
      label: "Delivery",
      value: t.delivery_date ? (
        <>
          {fmtDate(t.delivery_date)}
          <DaysOut iso={t.delivery_date} />
        </>
      ) : (
        "—"
      ),
    },
  ];

  /**
   * THE SENTENCE THAT SAYS WHAT TO DO, on the two states where doing something
   * is the point.
   *
   * `bomStatusHint()` has always answered for all five, and the screen spent it
   * on a `title=` tooltip — invisible on touch, invisible while scanning. It is
   * not printed on Pending or Draft because there it only re-words the pill:
   * three "No material plan yet." lines beside three Pending pills teach the
   * operator to stop reading the line, and then the one card that says something
   * else is not read either.
   */
  const cardHint = (t: BomTaskRow) =>
    t.status === "recalculate" || t.status === "unresolved" ? (
      <span className="text-danger">{bomStatusHint(t.status, t.production_qty)}</span>
    ) : null;

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
   *
   * ## IT ALSO SAYS WHAT EACH UNIT IS WORTH — `GROSS = 144 NOS`
   *
   * Added 2026-08-28; the reasoning is on `packSuffixFor` directly above. It is
   * done HERE rather than in the two cells because this function is their only
   * feed, so the rule cannot reach one picker and miss the other. The rows it
   * returns are COPIES with a decorated `name`; ids are untouched, so the
   * membership test the Consumption prefill runs against this list is unaffected.
   */
  /**
   * WHAT ONE OF THIS UNIT IS WORTH, FOR THIS MATERIAL — the `= 144 NOS` half of
   * `GROSS = 144 NOS`, or null when there is nothing trustworthy to say.
   *
   * Client 2026-08-28: "we did set GROSS as 144 button = one gross, and the
   * width of cone is 2500 metre and 500 metre — this also needs to show there
   * while choosing the uom, MTR = 2500, like this." A bare `GROSS` on the
   * dropdown does not tell an operator whether they are about to plan in
   * hundreds or in dozens, and the number that answers it is already on the
   * screen: `data.conversions` is every `material_uom_conversions` row, fetched
   * flat and filtered client-side, which is the same list the pack chooser in
   * the Purchase Uom cell reads.
   *
   * ## SCOPED BY `item_id`, AND THAT IS THE WHOLE RULE
   *
   * A GROSS is 144 of one thing and could be 144 of something else entirely; the
   * figure belongs to the MATERIAL, never to the unit. A conversion borrowed
   * from another material is worse than no conversion at all — it is a wrong
   * number that looks like a checked one, on the field that decides what gets
   * bought. So `item_id` is matched first and there is no fallback of any kind.
   *
   * ## ONLY A PACK UNIT CARRIES A FIGURE
   *
   * Matched on `alt_uom_id`, never `base_uom_id`. The alternative unit IS the
   * pack — a gross, a cone, a box — and the base unit is what the pack is
   * measured in. Decorating NOS with "1/144 GROSS" would state the same fact
   * backwards, in the row where it is least useful, on the unit that appears on
   * nearly every line. The client's two examples are both pack units.
   *
   * ## `alt_qty` IS NOT ASSUMED TO BE 1
   *
   * `conversionFactor` divides by the stored `alt_qty`, so `12 CONE = 30,000
   * MTR` and `1 CONE = 2,500 MTR` both read `CONE = 2,500 MTR`. That is the
   * point of showing the factor rather than the raw pair: those two rows are the
   * SAME PHYSICAL PACK entered two ways (`lib/uom/convert.ts` says so in terms),
   * and printing them as two different labels would invent a difference the
   * data does not have. It is also the number every downstream figure is
   * computed with — `toPurchaseQty` converts through exactly this factor — so
   * the label cannot drift from the arithmetic it describes.
   *
   * ## MORE THAN ONE MATCH SHOWS NOTHING, DELIBERATELY
   *
   * The client's own example is the ambiguous case: a cone is 2,500 metres AND
   * 500 metres. `pack-resolve.ts` documents the live data for it — SEWING THREAD
   * / POLYESTER carries `1 CONE = 2500 MTR` and `1 CONE = 5000 MTR`, both
   * entered on purpose — and REFUSES to pick one, handing the tie to the chooser
   * that appears inside the Purchase Uom cell. This must refuse on exactly the
   * same test or the screen contradicts itself: a label reading `CONE = 2,500
   * MTR` above a chooser offering 2,500 and 5,000 answers a question the cell
   * beneath it is still asking, and the label is the one with no control behind
   * it. Which pack applies is not knowable here anyway — it depends on the
   * consumption unit, which the line may not have chosen yet.
   *
   * So: exactly one usable row, or the unit renders plain. Two rows saying the
   * same thing are not treated as agreement either — that is `resolveLinePack`'s
   * `choices.length === 1` test, borrowed rather than re-derived, because the
   * two must not drift.
   *
   * ## NULL-SAFE BY CONSTRUCTION
   *
   * `isUsableConversion` rejects a half-typed row (either quantity or either
   * unit missing, zero or negative), which is the normal state of a row somebody
   * is entering — never an error, and never a reason to render `144 undefined`.
   * The base unit is resolved out of `data.uoms` as well, so a conversion
   * pointing at a unit this screen did not load renders plain rather than
   * `144 —`.
   */
  const packSuffixFor = (itemId: string | null, uomId: string): string | null => {
    if (!itemId) return null;
    const rows = data.conversions.filter(
      (c) => c.item_id === itemId && c.alt_uom_id === uomId && isUsableConversion(c),
    );
    if (rows.length !== 1) return null;
    const factor = conversionFactor(rows[0]);
    const base = data.uoms.find((u) => u.id === rows[0].base_uom_id);
    if (factor == null || !base) return null;
    /* `fmtQty`, not `fmtNumber`, because this figure is DERIVED. `fmtNumber` is
       a bare `toLocaleString` and caps at three fraction digits (see its note in
       lib/uom/convert.ts), which is fine for the stored 144 and 2,500 that
       `describeConversion` prints and wrong for a quotient — `12 CONE = 28,000
       MTR` is 2,333.33 recurring. The base unit's own `decimal_places_allowed`
       is the right precision because the figure is a quantity OF that unit. */
    return `${fmtQty(factor, base.decimal_places_allowed)} ${base.name}`;
  };

  const uomOptionsFor = (itemId: string | null, current: string | null): UomRow[] => {
    const m = itemId ? data.items.find((x) => x.id === itemId) : null;
    const allowed = new Set<string>();
    if (m?.base_uom_id) allowed.add(m.base_uom_id);
    if (m?.has_alternate_uom && m.purchase_uom_id) allowed.add(m.purchase_uom_id);
    if (current) allowed.add(current);
    /*
     * THE PACK FIGURE IS APPENDED HERE so that every Uom cell carries it without
     * being asked — this function is the one feed for both pickers and for the
     * membership test the Consumption prefill runs, so a cell cannot be built
     * that narrows correctly and explains nothing.
     *
     * APPENDED, NEVER PREFIXED, and that is not a style choice. `RecordPicker`
     * sorts by the DISPLAYED label, so a leading figure sorts the list by number
     * instead of by unit — the same trap that had the Material list sorting by
     * class code until it was fixed earlier today (`SEW · BUTTON` →
     * `BUTTON (SEW)`). The unit name stays first and the ordering is unchanged.
     *
     * `=` rather than a middot, for two reasons: it is the client's own phrasing
     * ("144 button = one gross"), and it is how `describeConversion` writes the
     * same fact in the pack chooser lower down the SAME CELL, so the two read as
     * one idiom instead of two.
     *
     * A COPY, never a mutation — `data.uoms` is the raw master list and
     * `uomName()` above resolves display names out of it for the ribbon, the
     * derived-quantity cells and `describeConversion`. Writing the suffix into
     * those rows would put `GROSS = 144 NOS` inside the pack chooser's own
     * label, which already spells the conversion out in full.
     */
    return data.uoms
      .filter((u) => allowed.has(u.id))
      .map((u) => {
        const pack = packSuffixFor(itemId, u.id);
        return pack ? { ...u, name: `${u.name} = ${pack}` } : u;
      });
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
        {fmtQty(value, t.decimals)}
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
  /*
   * `lineSettings` STOOD HERE, AND IT LASTED ONE AFTERNOON.

   * Supply Type came off the grid run on 2026-08-28 and was rendered in a strip
   * of its own beneath the row, on the reading that "hidden from the grid" is
   * not "removed from the screen" — a supply type is a CONSTRAINT rather than a
   * label, so the ~10% of lines that are Nominated or Import should still be
   * able to say so while the BOM is written.
   *
   * THE CLIENT DISAGREED, THE SAME DAY: "Supply Type — remove this field." The
   * later instruction wins, and it is the same answer they had already given for
   * Vendor. Both are now decided where the vendor is actually chosen.
   *
   * This is written down rather than tidied away because the argument above is a
   * good one and will be made again by the next reader who notices that a BOM
   * line can no longer express a nomination. It can not, deliberately, and the
   * consequence is accepted: THE NOMINATION CONSTRAINT IS ENFORCED WHOLLY AT THE
   * PURCHASE ORDER now. Restoring a control here needs a new client decision.
   *
   * `nominatedVendorOptions` and `vendorRule` went with it — the strip's Select
   * was their last reader on this screen. What did NOT go is
   * `DEFAULT_SUPPLY_TYPE` in `blankItem`; see the note there, because with no
   * control left it is the only writer and is now load-bearing.
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
    /* ASKED OF THE FIGURE THE STEP ACTUALLY MOVED. It used to compare `final`
       against `excessCalc`, which are now in DIFFERENT UNITS once a pack is
       named — 12 CONE against 20,000 MTR is unequal for the wrong reason, and
       the badge would have claimed the step bit on every converted line. */
    const stepBit = step != null && step > 0;
    /* THE UNIT CHANGES HERE, AND IT IS SAID OUT LOUD. Everything left of this
       is what the order consumes; everything right of it is what is bought.
       0451: the minimum and the step are properties of the PURCHASE. Silent
       would be worse than absent — the reader would take the MOQ as having been
       compared against the metres, which is precisely the bug being fixed. */
    const converted =
      t.needsPurchase != null && t.finalUom !== t.uom ? t.needsPurchase : null;
    /* BOTH IN THE PURCHASE UNIT, or both in the consumption one. Never one of
       each. */
    const needsForMoq = converted ?? t.excessCalc;

    return (
      <div className="mt-2 flex flex-wrap items-center gap-x-1 gap-y-2 rounded-md bg-surface-muted px-3 py-2">
        <Figure label="Order needs" value={t.excessCalc} unit={t.uom} decimals={t.decimals} />
        {converted != null && (
          <Step label={`= ${fmtQty(converted, t.finalDecimals)} ${t.finalUom}`} />
        )}
        {moqBit && (
          <Step
            /* DIMMED, NOT DROPPED, when the order already needs more than the
               supplier's minimum — see the header. Compared against the figure
               in the MOQ'S OWN UNIT: a minimum is typed in the unit the material
               is bought in, so on a line naming a pack that is the converted
               figure and never the metres beside it. */
            faded={needsForMoq >= (moq as number)}
            label={`MOQ ${fmtNumber(moq as number)} ${t.finalUom}${needsForMoq >= (moq as number) ? " · not binding" : ""}`}
          />
        )}
        {stepBit && <Step label={`round up to ${fmtNumber(step as number)}`} />}
        <div className="ml-auto flex flex-col items-end rounded-md bg-accent-soft px-3 py-1">
          <span className="text-[9px] uppercase tracking-wider text-accent/85">Final quantity</span>
          <span className="text-lg font-semibold tabular-nums leading-tight text-accent">
            {fmtQty(t.final, t.finalDecimals)}
            <span className="ml-1 text-[10px] font-normal opacity-80">{t.finalUom}</span>
          </span>
        </div>
      </div>
    );
  };

  /* `packById` LIVED HERE and was `packOf`'s only reader; `resolveLinePack`
     does the id lookup itself now, because resolving by id and resolving by
     units are two halves of one question and splitting them across two files is
     how the two readers of that question drift. */
  /** `decimal_places_allowed` (0309), not `decimal_places` (0224) — the latter is
   *  0 on every row in the live DB and would round 16.67 Gross to 17, the
   *  round-up the client rejected. `uomPrecision` clamps it either way. */
  const uomDecimals = (id: string | null) =>
    data.uoms.find((u) => u.id === id)?.decimal_places_allowed ?? null;

  /**
   * THE LINE'S PACK, AND WHETHER IT MAY BE USED — resolved ONCE.
   *
   * Three places need this and they must not drift: the per-slice purchase
   * column, the line's Final Quantity, and the row strip's own Final. The
   * predicate was written out by hand in the first of those and the other two
   * did without it, which is how the MOQ came to run in metres on a grid whose
   * ceiling ran it in cones.
   *
   * The pack must convert INTO the unit this line is consumed in. A cone of
   * metres against a line counted in pieces yields a number and a category
   * error — so the purchase figure declines while the requirement stands.
   */
  const packOf = (r: ItemRow) => {
    /* RESOLVED FROM THE LINE'S OWN UNITS WHERE IT NAMES NO PACK — see
       `resolveLinePack`, which the server action calls too.

       This was `packById(r.uom_conversion_id)` and nothing else, which was
       correct until the client had the Purchase Pack cell removed on
       2026-08-21: after that no line could ever name one, so `usable` was false
       on every line an operator could make, and the Final Quantity fell back to
       the consumption figure on all of them (client 2026-08-27). The material,
       the Purchase Uom and the Consumption Uom already say which pack it is. */
    const { pack, usable, choices } = resolveLinePack(
      {
        item_id: r.item_id,
        purchase_uom_id: r.purchase_uom_id,
        consumption_uom_id: r.consumption_uom_id,
        uom_conversion_id: r.uom_conversion_id,
      },
      data.conversions,
    );
    return {
      pack,
      usable,
      /* THE TIE, WHERE THE UNITS NAME TWO PACKS. Empty on every ordinary line;
         the Purchase Uom cell turns it into a chooser when it is not. */
      choices,
      /* `decimal_places_allowed` of the ALTERNATIVE unit — a purchase quantity
         is rounded and printed by the pack's precision, never the consumption
         unit's. `toPurchaseQty` takes the two separately for this reason. */
      decimals: usable && pack ? uomDecimals(pack.alt_uom_id) : null,
      uom: usable && pack ? uomName(pack.alt_uom_id) : null,
    };
  };

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
    /* The precision each figure beside it was calculated to - see `fmtQty`. The
       two differ: a requirement is in the CONSUMPTION unit, a purchase quantity
       in the pack's ALTERNATIVE one, and `toPurchaseQty` already takes the
       second separately for exactly that reason. */
    decimals: number | null;
    purchase: number | null;
    purchaseUom: string;
    purchaseDecimals: number | null;
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
    /* `decimal_places_allowed` of the unit these figures are IN, carried beside
       the label so the ribbon prints them at the precision `ceilToPrecision`
       rounded them to — see `fmtQty`. */
    decimals: number | null;
    /* THE UNIT `final` IS IN, WHICH IS NOT `uom` ONCE A PACK IS NAMED. `calc`
       and `excessCalc` are what the order CONSUMES (metres); `final` is what is
       BOUGHT (cones), because the MOQ and the rounding step are properties of
       the purchase — 0437's own title, and what `bomCeilingForOrder` has always
       compared a PO against. Equal to `uom` / `decimals` on a line with no pack,
       which is why nothing already on screen moves. */
    finalUom: string;
    finalDecimals: number | null;
    /* `excessCalc` IN THE PURCHASE UNIT, before the minimum — what the ribbon
       prints as the conversion hop, and the figure the "is this MOQ binding?"
       badge compares against. Comparing a minimum in cones against a
       requirement in metres is the defect this file was corrected for; the
       badge is where it would quietly return. */
    needsPurchase: number | null;
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
      /* NAMED FROM THE GRAIN, so a composed one reads "Style Ref No / Order
         Color / Order Size / Country" rather than the dash it would get from a
         `requirement_basis` it does not have. */
      const basisLabel = r.requirement_grain
        ? grainLabel(r.requirement_grain)
        : r.requirement_basis
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
          decimals: uomDecimals(r.consumption_uom_id),
          purchase: null,
          purchaseUom: "—",
          purchaseDecimals: null,
          ...over,
        });

      const uomLabel = uomName(r.consumption_uom_id);
      const uomDp = uomDecimals(r.consumption_uom_id);

      /*
       * THE GRAIN, RESOLVED EXACTLY AS THE SERVER RESOLVES IT (0455).
       *
       * `requirementRows` in actions.ts runs these same three lines. That is not
       * duplication for its own sake — it is the one thing this module keeps
       * getting wrong: a screen that computed slices from `requirement_basis`
       * while the server computed them from the grain would draw one set of rows
       * and store another, and the stored one is what a purchase order is
       * checked against. Same store, same reading, same answer.
       */
      const rowGrain: Axis[] | null =
        r.requirement_grain ??
        (r.requirement_basis ? axesOfBasis(r.requirement_basis as RequirementBasis) : null);
      if (!rowGrain) {
        push({ refusal: "Choose how this material splits" });
        totals.set(r.key, {
          calc: null,
          excessCalc: null,
          final: null,
          refusal: "Choose how this material splits",
          uom: uomLabel,
          decimals: uomDp,
          finalUom: uomLabel,
          finalDecimals: uomDp,
          needsPurchase: null,
        });
        continue;
      }

      const rowFlags = sliceFlagsOf(r);
      /* TWO PATHS, THE SAME TWO THE SERVER TAKES. A grain with a legacy name
         keeps the per-row Size-wise tick, which can be MIXED and which an axis
         set cannot express; a composed grain never had one and is composed. */
      const rowBasis = basisForAxes(rowGrain);
      const allSlices = rowBasis
        ? productionSlices(rowBasis, orderProd, undefined, rowFlags.sizeWise)
        : slicesForAxes(rowGrain, orderProd);
      /*
       * CROSSED BY THE LINE'S COMBINATION NAMES, exactly as the server crosses and
       * as `sliceGrid` crosses — one derivation, three readers.
       *
       * This loop did NOT cross, and once `requirementRows` learned to, the two
       * disagreed in the direction that hides: a line with two combination names
       * SAVED two requirement rows while this ribbon totalled one. That is the same
       * screen-says-one-thing-storage-says-another shape the crossing was added to
       * close, arriving from the other side because only one of the two callers was
       * taught. Both are taught now, and `crossCombinations` is the single function
       * all three go through.
       *
       * BEFORE THE `chosen` FILTER, because a crossed row inherits its parent's tick
       * — the combination is a second axis ON the slice, not a slice of its own.
       */
      const crossed = isRefusal(allSlices)
        ? allSlices
        : crossCombinations(allSlices, combinationNames(r.combinations));
      /* UNTICKED ROWS ARE DROPPED HERE TOO, and that is not a nicety: the server
         omits them from the stored requirement, so a screen that still counted
         them would show a Final Quantity the purchase order is never checked
         against. Same store, same reading, same answer. */
      const slices = isRefusal(crossed) ? crossed : crossed.filter(rowFlags.chosen);
      if (isRefusal(slices)) {
        push({ refusal: slices.refused });
        totals.set(r.key, {
          calc: null,
          excessCalc: null,
          final: null,
          refusal: slices.refused,
          uom: uomLabel,
          decimals: uomDp,
          finalUom: uomLabel,
          finalDecimals: uomDp,
          needsPurchase: null,
        });
        continue;
      }

      // ONE definition, three readers — see `packOf`.
      const { pack, usable: packUsable } = packOf(r);

      /* ONE PASS PER SLICE. There was a second, nested pass per TRIM COLOUR
         here, over `colourSplits(r.item_color_id, combinationSplitsOf(r))` — see
         the block where that helper used to live for what it was summing and
         what it cost. The 0436 panel store it read is retired, so the pass had
         nothing legitimate left to add and was multiplying the line's rate by
         the number of colourways. */

      /* PER TRIM COLOUR, because the supplier's minimum is a minimum per CONE
         (client 2026-08-22) — navy and red each clear it on their own. Keyed by
         the colour id, "" for the line's own, so a single-colour line has one
         bucket and `lineQuantityByColour` reduces to what `lineQuantity`
         returned. */
      /* `qtys` IS THE SLICE LIST, NOT A THIRD RUNNING TOTAL, and that is what
         makes the grid agree with the ceiling to the digit. The purchase figure
         is one `toPurchaseQty` PER SLICE, each rounded to the pack unit's own
         precision, then summed — because `bomCeilingForOrder` sums the STORED
         `purchase_qty` rows, which are exactly that. Converting the sum instead
         is more accurate and disagrees, and a control that disagrees with the
         screen that fed it is a control the operator learns to dismiss. */
      const colourTotals = new Map<
        string,
        { qty: number; base: number; qtys: number[] }
      >();
      const addTo = (colour: string | null, qty: number, base: number) => {
        const k = colour ?? "";
        const at = colourTotals.get(k);
        if (at) {
          at.qty += qty;
          at.base += base;
          at.qtys.push(qty);
        } else {
          colourTotals.set(k, { qty, base, qtys: [qty] });
        }
      };

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
        /* THE CONSUMPTION IS THE SLICE'S, FALLING BACK TO THE ROW IT SITS UNDER
           AND THEN THE LINE (0442). This was the line's own figures reused for
           every slice, which is why a Size-wise line spent the same thread on an
           XS and a XXL. `slices` on the row holds only what the operator TYPED;
           everything else still reads upward, per FIELD.
           It resolved ONE level here until 2026-08-25, while the row strip and
           the server both resolved three — see `consumptionChain`.
           Excess % and the decimals stay the line's: neither is a property of a
           size, and an excess that varied per slice would not sum to the
           order's. */
        const use = consumptionChain(r, slice);
        /* THE SLICE'S OWN RATIO, and nothing composed on top of it. A panel
           rate used to be folded in here by `panelConsumption`, inside a second
           loop over the trim colours; with the 0436 store retired there are no
           panels to fold, and the thing being folded was the line's own rate
           counted once per colourway. */
        const lineInput = {
          no_of_items: use.no_of_items,
          per_pieces: use.per_pieces,
          excess_pct: use.excess_pct ?? 0,
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
        /* GATED ON THE QUANTITY ALONE, never on the base beside it.
           `lineTotal` counts a slice whose `requirementFor` answered; if this
           bucket skipped that slice because `baseRequirementFor` refused, the
           per-colour sums would come to LESS than the line total and the
           minimum would be cleared against an understated figure — the
           partial-sum failure `order-value.ts` records, arriving through the
           one column that is not the answer.
           The two functions are documented to refuse in exactly the same
           cases, which is precisely why this must not be written as if they
           do: `baseTotal` has already gone null for the whole line, so the
           base column is unanswerable and 0 here is never read. */
        if (!refused) {
          addTo(
            /* THE SLICE'S TRIM COLOUR, which is where it was always typed. The
               branch above it read a PANEL's colour and won the tie, on the
               reasoning that "a panel says the sleeve is stitched in red". That
               precedence is not lost so much as unreachable: the panel store is
               retired, and the trim colour a Combination row carries is stored
               on the slice row itself, which is what `rowFlags.colour` reads. */
            rowFlags.colour(slice) ?? r.item_color_id,
            qty as number,
            isRefusal(baseValue) ? 0 : baseValue,
          );
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
          purchaseDecimals: packUsable && pack ? uomDecimals(pack.alt_uom_id) : null,
        });
      }

      // MOQ AND ROUND TO ARE APPLIED PER TRIM COLOUR, never to a slice. A
      // COLOURWAY explosion makes six rows for one material; an MOQ of 500 per
      // row orders 3,000 of something the order needs 100 of, and six rows each
      // rounded up to the next 500 buys the rounding error six times. A TRIM
      // colour is the other case — navy thread and red thread are two things to
      // buy, so each clears the minimum on its own (client 2026-08-22).
      // `lineQuantityByColour` owns the grouping; `lineQuantity` beneath it owns
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
          decimals: uomDp,
          finalUom: uomLabel,
          finalDecimals: uomDp,
          needsPurchase: null,
        });
        continue;
      }
      /* ONE GROUP WHERE THERE ARE NO PANELS — the whole line, which is exactly
         what was passed before. `colourTotals` is empty only when the line
         produced no answered slice at all, and the fallback keeps that on the
         path `lineQuantityByColour` already refuses rather than reading as 0. */
      const groups: ColourQuantities[] = colourTotals.size
        ? [...colourTotals].map(([id, v]) => ({
            item_color_id: id || null,
            quantities: [v.qty],
            /* THE MINIMUM AND THE STEP RUN OVER THESE. Absent where the line
               names no usable pack, and `lineQuantity` then falls back to the
               consumption figures — the same fallback `bomCeilingForOrder`
               takes with `purchase_qty ?? required_qty`, so the two agree in
               that case too. */
            purchaseQuantities: packUsable
              ? toPurchaseSlices(v.qtys, pack, uomDecimals(pack?.alt_uom_id ?? null))
              : undefined,
            /* NULL WHERE THE BASE REFUSED ANYWHERE ON THE LINE. The two columns
               must be summed over the same slice set — the reason they are
               accumulated in one pass — so a base that could not be answered
               makes the whole "Calculated Qty" unanswerable rather than a
               partial sum that reads as correct. */
            baseQuantities: [baseTotal == null ? null : v.base],
          }))
        : [{ item_color_id: null, quantities: [lineTotal], baseQuantities: [baseTotal] }];
      const chain = lineQuantityByColour(
        groups,
        numOrNull(r.moq),
        numOrNull(r.round_to),
        unitKnown,
      );
      totals.set(
        r.key,
        isRefusal(chain)
          ? {
              calc: null,
              excessCalc: null,
              final: null,
              refusal: chain.refused,
              uom: uomLabel,
              decimals: uomDp,
              finalUom: uomLabel,
              finalDecimals: uomDp,
              needsPurchase: null,
            }
          : {
              calc: chain.calcQty,
              excessCalc: chain.excessCalcQty,
              final: chain.finalQty,
              refusal: null,
              uom: uomLabel,
              decimals: uomDp,
              /* THE PACK'S UNIT WHERE THERE IS ONE. `packUsable` is the same
                 guard the per-slice purchase column uses, so the label and the
                 figure can never come from different units. */
              finalUom: packUsable && pack ? uomName(pack.alt_uom_id) : uomLabel,
              finalDecimals:
                packUsable && pack ? uomDecimals(pack.alt_uom_id) : uomDp,
              needsPurchase: chain.purchaseQty,
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
      header: H.category,
      className: "min-w-[150px]",
      /* REQUIRED (client 2026-08-24). Declared on the COLUMN for the header `*`
         and the cell's `RequiredScope`, and again on the control below — the
         stacked-cards layout renders a row WITHOUT that wrap, so a column
         declaring it beside a control that does not ships a star with nothing
         behind it. AGENTS.md's "Mandatory fields" records four screens that each
         rediscovered this independently. */
      required: true,
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
          /* The second half of the declaration above, bare and ungated exactly
             as Material's is one column over.

             A GATE HERE WOULD BE INERT, and it was written as `!!r.item_id`
             first. `useRequiredHold` reads `ctx.required || !!own.required`
             (field.tsx) -- ORed on purpose, so that wrapping a picker in a
             `<Field required>` can never silently un-require it -- and this
             grid's `renderMobileRow` wraps every cell in
             `<Field required={col.required}>`. So the context is already true
             for this column and nothing passed here can narrow it. Writing a
             condition anyway ships a prop that reads as a live constraint and
             is not one.

             A blank line therefore holds on Category. That is not a new trap:
             Material has been `required: true` + bare `required` since this
             grid was built, so an untouched row was already held one cell
             along. */
          required
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
      header: H.material,
      className: "min-w-[160px]",
      required: true,
      cell: (r) => (
        <RecordPicker
          label="Material"
          items={materialsFor(r.category_id, r.item_id)}
          value={r.item_id}
          /**
           * A MATERIAL THAT DECLARES ONE UNIT FILLS BOTH CELLS (client
           * 2026-08-28: "if it only has a single standard unit of measure
           * defined in the master, the system must automatically populate both
           * — the user should not have to select the same unit twice").
           *
           * THE OTHER HALF OF THE 60-80% RULE. The Purchase cell already fills
           * Consumption when the operator picks a unit; this fills the pair
           * when there is only ever going to be one answer, so on the ordinary
           * material the operator picks nothing at all. The two prompts survive
           * only for the case that earns them — a thread bought in CONES and
           * consumed in MTR — which is exactly the client's "only ask when they
           * differ".
           *
           * ## THE SAME THREE GUARDS THE PURCHASE PREFILL STATES
           *
           *  1. **ONLY WHILE THE CELL IS BLANK.** A prefill that overwrites is
           *     the screen disagreeing with the operator. Each cell is tested
           *     on its own, so a line that already names a Purchase unit still
           *     gets its Consumption filled.
           *  2. **ONLY A UNIT THIS MATERIAL DECLARES**, asked with `null` as the
           *     current value — which makes the question "what would the cell
           *     OFFER?" rather than "what is on the list?", the same distinction
           *     that keeps a stale stored unit from being copied across.
           *  3. **CLEARING THE MATERIAL FILLS NOTHING.** `id` is null on a
           *     clear, so the branch does not run and the units already there
           *     stay the operator's to remove.
           *
           * EXACTLY ONE, NEVER "THE FIRST OF SEVERAL". A material with an
           * alternate unit declares two, and which of them a line buys in is
           * the decision this screen exists to record — defaulting it would put
           * a value on the field that decides what gets purchased without
           * anybody having answered.
           *
           * ## SWAPPING THE MATERIAL DROPS WHAT THE NEW ONE CANNOT OFFER
           *
           * (client 2026-08-28, on being shown the gap.) Both rules — the drop
           * and the fill — live in `uomPatchForMaterial`
           * (`lib/orders/material-bom/uom-prefill.ts`), which states each branch
           * and why it is there. They are ONE function because the drop is what
           * re-arms the fill: blanking a stale cell lets a single-unit material
           * refill it in the same keystroke, so the line is never briefly wrong
           * on screen.
           *
           * IT IS A MODULE SO IT CAN BE VECTORED. A rule inside this file cannot
           * be imported by a `.mts` check, which is the cost `assort-style.ts`
           * records — and three of these branches only fire on an edit path
           * nobody exercises by hand.
           */
          onChange={(id) => {
            updItem(r.key, {
              item_id: id,
              ...uomPatchForMaterial(
                r,
                id,
                /* WHAT THE NEW MATERIAL OFFERS, asked with `null` as the current
                   value — the question is "what would the cell offer?", never
                   "what is on the list?", because `uomOptionsFor` always keeps a
                   stored value on its list and would answer the second one with
                   the stale unit this rule exists to drop. */
                uomOptionsFor(id, null).map((u) => u.id),
                data.conversions,
              ),
            });
          }}
          /* THE NAME AND NOTHING ELSE (client 2026-08-28, screenshot 2531).
             The list showed each material's auto-generated code beside it
             (BUTTONPLAS, SEWINGTHRE2) — a string no operator types, sitting
             where the eye is scanning for the spec. Same instruction that took
             the `(SEW)` / `(PACK)` class bracket off, one field along. */
          identity="name-only"
          required
          compact
        />
      ),
    },
    {
      header: H.attribute,
      /* Wider than the 130px it was: a grain reads "Style Ref No / Order Color /
         Order Size", which is the client's own wording for #19 and is the point
         of the column. */
      className: "min-w-[200px]",
      /*
       * THE EXPLOSION GRAIN (0455) — what decides whether this material is bought
       * once for the order, once per colour, once per size, or per some
       * combination of those. A CHECKed value, never the free
       * `material_attribute` lookup that used to sit here and whose one live row
       * is the word "STYLE" (0418).
       *
       * ## WHY A SELECT AND NOT THE SPEC'S TOGGLE STRIP
       *
       * The 2026-08-23 spec asked for a row of axis toggles — `[Style Ref ✓]
       * [Colour _] [Size ✓] [Country _]` — reasoning that a dropdown of 28
       * strings is unreadable. It is; but the dedup makes this NINE options
       * carrying the client's own labels, not 28. And a toggle strip fails on two
       * counts that are not style preferences:
       *
       *  1. **IT CANNOT SAY "WHOLE ORDER".** That grain is the ABSENCE of every
       *     axis, so it renders as four unchecked boxes — byte-identical to a
       *     line nobody has answered yet. NULL and `[]` are different states
       *     (0455 spends a paragraph on it), and the most common answer is the
       *     one the strip cannot distinguish from silence.
       *  2. **IT TAKES A REQUIRED FIELD OFF THE KEYBOARD.** Tab lands on fields
       *     and nothing else, so buttons in a grid row carry `tabIndex={-1}` —
       *     which would make the one mandatory cell on the line mouse-only.
       *     Checkboxes would keep it reachable at the cost of four tab stops per
       *     line, and still fail (1).
       *
       * A `<Select>` is one field, one tab stop, native keyboard, and the
       * selected option IS the resolved label the spec wanted displayed. The
       * strip's real benefit — seeing the axes — is what the label already says.
       *
       * ## THE OPTIONS ARE DERIVED, NEVER LISTED
       *
       * `producibleGrains()` comes from the composer's own plan table, so a grain
       * the engine cannot produce can never be offered. A hand-kept menu beside
       * the thing it describes is how `lib/reports/catalog.ts` records its worst
       * bug, and how the nav list and the landing grid fell out of sync.
       */
      required: true,
      cell: (r) => {
        /* THE OPTION VALUE IS PREFIXED, because `serializeAxes([])` is the empty
           string and so is "nothing chosen". Without the prefix the whole-order
           grain and an unanswered line would be the same DOM value, which is
           exactly the NULL-vs-[] conflation this column exists to avoid. */
        const asValue = (axes: Axis[]) => `g:${serializeAxes(axes)}`;
        const current = r.requirement_grain;
        const offered = producibleGrains();
        /* A STORED GRAIN THE MENU NO LONGER OFFERS STILL RENDERS ITS OWN NAME,
           the same courtesy the basis menu extended to `size` and `combination`
           after they left it: an older document must not show a blank
           Attribute. */
        const extra =
          current && !offered.some((g) => serializeAxes(g) === serializeAxes(current))
            ? [current]
            : [];

        /*
         * THE MENU IS THE CLIENT'S OWN 22-ROW LIST, NUMBERED (2026-08-26).
         *
         * It used to be `producibleGrains()` alone — nine rows, in our wording.
         * The operator holds a printed legacy list of 22 numbered Attributes,
         * and the two could not be matched up: a row we serve under another
         * name ("Order No" IS "Whole order") read as missing, and a row nothing
         * can build ("Pack Ref No") read as forgotten. The client reported
         * exactly that — "i can't find that 22 attribute in material bom".
         *
         * So every one of the 22 is listed, in their words and under their
         * S.No. Every row is SELECTABLE ("enable all", 2026-08-26) and the ones
         * the engine cannot build refuse at explosion time with the reason
         * printed in the Requirement section — an operator hunting #19 finds it
         * and learns why, instead of concluding it was missed.
         *
         * FIVE STILL REFUSE, and only five: the pack rows (#18-#22), for want of
         * a column. It was nine until 2026-08-27, when the client's #26 decision
         * put #3, #4, #15 and #17 onto `COARSENED` in `compose.ts`. The count
         * lives in `client-matrix.ts` and is asserted there, so this sentence is
         * the only place it can go stale — it has done so twice.
         *
         * OUR NAME RIDES ALONG WHERE IT DIFFERS — "1. Order No (Whole order)".
         * The read-only Attribute cell and the Combination sheet header both
         * render `labelFor`, so showing only the client's wording here would
         * put two names for one grain on one screen. That is the drift this
         * module already refuses for labels and bases.
         *
         * THE NINTH GRAIN IS APPENDED, NOT DROPPED. `EXTRA_SERVED` is the grain
         * the client's list omits by mistake and keeps by decision; listing it
         * after the 22 is what stops "make the menu match the list" quietly
         * deleting it. `check-bom-explosion` asserts the pairing.
         */
        /* EVERY OPTION IN THE MENU MUST RESOLVE BACK TO ITS AXES, including the
           fourteen the engine will refuse — the row is selectable now, so a map
           built only from `offered` would accept the click, find nothing, and
           store NULL. The line would silently return to "no Attribute chosen"
           instead of showing the refusal the operator needs to read. */
        const pickable = new Map<string, Axis[]>();
        for (const g of [
          ...CLIENT_GRAIN_MATRIX.map((row) => row.axes),
          ...EXTRA_SERVED.map((e) => e.axes),
          ...offered,
          ...extra,
        ]) {
          pickable.set(asValue(g), g);
        }

        /*
         * THE TOOLTIP THAT SAYS WHAT THE ATTRIBUTE UNLOCKS (client 2026-08-26).
         *
         * Five of the client's rows differ from five others ONLY in whether the
         * Combination button goes live — "Style / Combination" plans exactly what
         * "Style" plans. So the one consequence of this choice is invisible from
         * this cell: it happens to a button three columns away. This says so.
         *
         * BOTH SENTENCES AND THE TEST COME FROM `client-matrix`, the same ones
         * `combinationsBlocked` reads, so the cell and the button cannot answer
         * the question differently.
         *
         * `title`, deliberately, and not the `Truncated` bubble: that one is for
         * a value clipped by its box and must never register with
         * `lib/reload-guard.ts` — an ungated flag there permanently blocks the
         * silent auto-update on this route. A native tooltip carries no such
         * risk, adds no DOM, and cannot take focus. It is advisory only: nothing
         * here holds the cursor or refuses a key, because every one of these
         * Attributes is a legitimate choice.
         */
        const grainHint = namesCombination(current)
          ? COMBINATION_UNLOCKED_HINT
          : COMBINATION_LOCKED_HINT;

        return (
          <Select
            title={grainHint}
            value={current ? asValue(current) : ""}
            onChange={(e) => {
              const picked = pickable.get(e.target.value);
              updItem(r.key, {
                requirement_grain: picked ? canonicalAxes(picked) : null,
                /* THE LEGACY NAME IS KEPT IN STEP. `requirement_basis` still has
                   its column, its CHECK and its readers, and eight of the nine
                   grains have a name; a composed one clears it rather than
                   leaving the previous answer behind to contradict the grain. */
                requirement_basis: picked ? (basisForAxes(picked) ?? "") : "",
              });
            }}
            className="h-8"
            required
          >
            <option value=""></option>
            {/* ALL 22 ARE SELECTABLE AND NONE IS NUMBERED (client 2026-08-26:
                "enable all and remove that serial numbers from ui").

                The S.No was there so an operator could match the menu against
                their printed legacy list, and the fourteen unbuildable rows were
                DISABLED so the menu could not promise what the engine cannot
                do. Both were overruled, and the second one only became safe the
                same day: until `compose.ts` was fixed, a grain naming
                `trim_colour` lost that token inside `orderAxesOf` and quietly
                matched the plan for what was left, so picking "Combination"
                returned the WHOLE-ORDER rows — one line, a total that looked
                right, and nothing saying half the question had been dropped.

                Now every one of the 22 either produces its rows or REFUSES with
                a sentence the Requirement section prints. That is the engine's
                standing contract — empty-and-explain, never a silent fallback —
                and it is the only reason enabling these is not a way to ship a
                wrong number. Do not re-enable anything here without checking
                that the grain still refuses rather than collapsing. */}
            {/*
              ONE LIST, DE-DUPLICATED BY VALUE — and it has to be built rather
              than concatenated from three maps.

              A `<Select>` here renders through `Combobox`, which keys its rows
              by OPTION VALUE. Three sources fed this menu — the client's 22, the
              ninth grain, and a stored grain the menu no longer offers — and any
              two of them can name the SAME grain. #18 "Pack" and #19 "Pack Ref
              No" are both {pack}, so React reported *"two children with the same
              key, `g:pack`"* and warned that children may be duplicated or
              omitted: a menu that can silently drop or swap a row, which is how
              a click lands on an Attribute nobody chose (client 2026-08-26).

              The `extra` tail could collide the same way and was one stored
              `{pack}` away from doing it — it tested `offered`, which is
              `producibleGrains()` and does NOT contain the client's refusing
              rows. Building one keyed list makes the whole class impossible
              instead of fixing the one instance that was reported.

              LABELS ARE THE CLIENT'S ALONE. The engine's name used to ride along
              in brackets — "Order No (Whole order)" — and the client had it
              removed; the read-only cell and the sheet header now resolve the
              same name through `grainLabel`, so there is nothing left to
              disagree with.
            */}
            {(() => {
              const seen = new Set<string>();
              const opts: { value: string; label: string }[] = [];
              const push = (axes: readonly Axis[], label: string) => {
                const value = asValue(axes as Axis[]);
                if (seen.has(value)) return;
                seen.add(value);
                opts.push({ value, label });
              };
              for (const row of menuRows()) push(row.axes, row.label);
              for (const e of EXTRA_SERVED) push(e.axes, grainLabel(e.axes));
              for (const g of extra) push(g, grainLabel(g));
              return opts.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ));
            })()}
          </Select>
        );
      },
    },
    /*
     * SUPPLY TYPE AND VENDOR ARE OFF THE ITEM ROW (client 2026-08-28: over 90%
     * of lines are Local, and the vendor is decided at the purchase order).
     *
     * THE TWO WIDEST CELLS ON THE ROW went to the two answers that were already
     * being made again, better, one step later. `supply_type` opened on "Local"
     * (client 2026-08-21) and stayed there; `vendor_id` was blank on almost
     * every line, because a BOM is written before a supplier is chosen.
     *
     * BOTH ARE GONE FROM THE SCREEN, and Supply Type took two steps to get
     * there — relocated to a strip below the row, then removed outright at the
     * client's instruction, both on 2026-08-28. The full story and the accepted
     * consequence (a BOM line can no longer express a nomination; enforcement
     * moves to the PO) are on `supply_type` in `ItemRow`.
     *
     * BOTH FIELDS ARE CARRIED REGARDLESS. `writeChildren` deletes and reinserts
     * every child row, so a value the form stops CARRYING is a value the next
     * save destroys — both are in `ItemRow`, `blankItem`, both load paths and the
     * save payload. Restoring the Vendor cell is this block again plus one entry
     * in `FIELD_GROUPS`; the round trip is what keeps it that cheap, which is the
     * same reason `type`, `alternate_uom_id` and `combination` each survived
     * being taken off and put back.
     */
    {
      header: H.purchaseUom,
      className: "min-w-[130px]",
      // NARROWED TO THE MATERIAL'S OWN UNITS (client 2026-08-19) — see
      // `uomOptionsFor` for why the master list was wrong here and what the
      // empty case says instead of falling back to it.
      cell: (r) => {
        /* THE PACK CHOOSER IS AN EXCEPTION CELL, NOT THE RETURN OF THE REMOVED
           FIELD. `resolveLinePack` derives the pack from this Uom and the
           Consumption Uom beside it, so on an ordinary line `choices` is empty
           and nothing renders. It fills only where the material really is bought
           in two pack sizes OF THIS UNIT — the live data has a sewing thread at
           1 CONE = 2500 MTR and 1 CONE = 5000 MTR — and there the line's units
           genuinely do not say which. Guessing there is a purchase quantity
           wrong by a factor of two, on the figure a PO is capped against.

           IT LIVES INSIDE THIS CELL rather than as a column of its own: the
           header runs on a 32-column track whose every run must sum to 32
           exactly (see FIELD_GROUPS), so a 22nd column is a layout change, and
           this one has nothing to show on almost every line. */
        const { choices } = packOf(r);
        return (
          <>
            <RecordPicker
              /* THE FULL WORDS SURVIVE HERE, and the divergence from the `H.purchaseUom`
                 header above it is deliberate. This prop is the picker's ACCESSIBLE NAME
                 and its dialog title — it is never drawn in the grid, so abbreviating it
                 would cost a screen-reader user the word and buy no width at all. The
                 header is abbreviated because it is the thing that has to fit. */
              label="Purchase Uom"
              items={uomOptionsFor(r.item_id, r.purchase_uom_id)}
              value={r.purchase_uom_id}
              /**
               * CHOOSING A PURCHASE UNIT FILLS THE CONSUMPTION UNIT, ONCE
               * (client 2026-08-28: 60-80% of items buy and consume in the same
               * unit).
               *
               * THREE GUARDS, AND EACH ONE IS THE DIFFERENCE BETWEEN A SHORTCUT
               * AND A BUG:
               *
               *  1. **ONLY WHILE CONSUMPTION IS BLANK.** A prefill that
               *     overwrites is not a prefill, it is the screen disagreeing
               *     with the operator — and it would do so on the ordinary edit
               *     path, where someone opens a saved line to correct the
               *     PURCHASE unit and silently loses the consumption one. This
               *     is the same call `alternate_uom_id`'s removal note makes
               *     about deriving versus destroying.
               *  2. **ONLY A UNIT THIS MATERIAL DECLARES.** `uomOptionsFor`
               *     always keeps the CURRENT value in its list even when the
               *     master no longer allows it, so a line whose stored purchase
               *     unit has since fallen out of scope would otherwise copy that
               *     stale unit across into a second cell. Asked with `null` as
               *     the current value, which is what makes the question "would
               *     the Consumption cell offer this?" rather than "is it on the
               *     Purchase list?".
               *  3. **CLEARING PURCHASE CLEARS NOTHING.** `id` is null on a
               *     clear, so the branch simply does not run; the consumption
               *     unit the operator chose is theirs to remove.
               *
               * NOT A DEFAULT ON `blankItem`: there is nothing to copy until a
               * material and a purchase unit are both named, and a value written
               * before the operator has answered is the "constraint wearing a
               * default's clothes" this file already warns about.
               */
              onChange={(id) => {
                const patch: Partial<ItemRow> = { purchase_uom_id: id };
                if (
                  id &&
                  !r.consumption_uom_id &&
                  uomOptionsFor(r.item_id, null).some((u) => u.id === id)
                ) {
                  patch.consumption_uom_id = id;
                }
                updItem(r.key, patch);
              }}
              placeholder={uomEmptyWhy(r.item_id)}
              compact
            />
            {choices.length > 0 && (
              <>
                <Select
                  className="mt-1 h-8"
                  aria-label="Which pack this line buys"
                  value={r.uom_conversion_id ?? ""}
                  onChange={(e) =>
                    updItem(r.key, { uom_conversion_id: e.target.value || null })
                  }
                >
                  <option value=""></option>
                  {choices.map((c) => (
                    <option key={c.id} value={c.id}>
                      {describeConversion(c, uomName)}
                    </option>
                  ))}
                </Select>
                {/* SAID, NOT LEFT TO BE INFERRED. An unexplained second box under
                    a Uom reads as a field somebody forgot to label; the line is
                    what tells the operator the purchase figure is waiting on it.
                    Amber and advisory — the requirement itself still computes,
                    and the consumption figure it shows is not wrong, only not
                    the purchase one. */}
                <p className="mt-0.5 text-[10px] leading-tight text-amber-600 dark:text-amber-500">
                  Two pack sizes — pick one for the purchase quantity.
                </p>
              </>
            )}
          </>
        );
      },
    },
    {
      header: H.consumptionUom,
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
      header: H.moq,
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
      header: H.roundTo,
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
      /**
       * HOW SETTLED THIS MATERIAL IS — the `type` column, and its THIRD shape in
       * one day. The sequence is written out because it settled deliberately
       * rather than drifted, and each step reversed the one before it:
       *
       *  1. A three-value `<Select>` — To be advised / To be developed /
       *     Available Item (client 2026-08-17), defaulted to "Available Item" on
       *     2026-08-21 "because that is what almost every trim is".
       *  2. **A tick that REVEALED a two-option select** (client 2026-08-28).
       *     The case against the dropdown was that a control showing the same
       *     answer on 99 lines in 100 spends a field's width saying nothing, on
       *     the row this refinement exists to unclutter; the reveal existed only
       *     so the third value stayed reachable behind the tick.
       *  3. **A plain two-option `<Select>` — this** (client 2026-08-28, the same
       *     day). "To be developed" was REMOVED AS A VALUE, and with two values
       *     left the tick and the select said the same thing. The user was shown
       *     all three readings and chose the select.
       *
       * So this is step 1's shape with a shorter list, not something new — and
       * the tick is not a thing to restore, because the reason it existed (a
       * third value needing somewhere to live) no longer holds.
       *
       * ## RENDER `MATERIAL_TYPE_OPTIONS`. NEVER `UNSETTLED_MATERIAL_TYPES`.
       *
       * They are two lists with two jobs and they DELIBERATELY DISAGREE:
       * `MATERIAL_TYPE_OPTIONS` is the pick list and holds two values;
       * `UNSETTLED_MATERIAL_TYPES` is the PO gate's REFUSAL SET and still holds
       * "To be developed", because a row already stored as that is still
       * unsettled and must still be refused — dropping it would make
       * `refuseUnsettledMaterials` fail open on exactly the legacy rows it was
       * written for.
       *
       * **Nothing in the build catches the confusion.** Both are
       * `readonly string[]`, so mapping the refusal set here compiles, runs, and
       * quietly puts a retired option back on screen — which is what the
       * previous revision of this cell did, one line from here. Ask
       * `isUnsettledMaterialType()` whether a line is blocked from purchase;
       * render this list to choose a value.
       *
       * ## THE BLANK OPTION STAYS
       *
       * A default the operator cannot clear is a constraint wearing a default's
       * clothes, and this column has never been one. `type` is not `required` —
       * a BOM line saves without it, which is the point of "to be advised" — and
       * `DEFAULT_MATERIAL_TYPE` ("Available Item") means a NEW line still opens
       * filled in. Nothing rewrites a STORED value: a line saved blank, or saved
       * as "To be developed" before that value was retired, loads exactly as
       * stored, because filling one in on read would change what the next save
       * writes.
       *
       * ## EIGHTH ON THE LINE, IMMEDIATELY AFTER Round To — AND THAT IS ITS
       * ## FOURTH POSITION IN ONE DAY
       *
       * Client 2026-08-28: **"TBA next to the Round To, remaining all the
       * same."** That amended a chain given minutes earlier the same day
       * ("cons.uom - moq - round to - combination - tba this order"), which had
       * put this cell one place further along, AFTER Combination. Before that
       * it was LAST, for a few hours ("that TBA button — move it to the last
       * field in that same row"); before that it was SECOND, having inherited
       * the position of the `Type` dropdown it replaced, which is where legacy
       * puts it (screenshot 2362).
       *
       * Four positions, four instructions, one afternoon. **Do not move it back
       * to any of them as a correction** — not to legacy's order, not to the end
       * of the row on the strength of the quote above, and NOT to the end of
       * that chain: all three are real quotes from today and all three were
       * superseded by the one at the top of this note. The chain is the
       * dangerous one, because it is a complete-looking sentence naming five
       * cells and it reads as authoritative on its own. `FIELD_GROUPS` carries
       * the same sequence and the same warning.
       *
       * It keeps `md` while sitting between two `xs` numerics and an `xs` icon
       * button: it shows a VALUE ("Available Item") where none of them shows
       * one, so it needs the width — and holding it at 4 is also what keeps the
       * run at exactly 32. NEITHER 08-28 REORDER RESIZED ANYTHING, and this is
       * the cell an "even up the narrow run" instinct reaches for first, now
       * that it is the one wide cell in a stretch of five narrow ones.
       *
       * NOT UPPERCASED: a fixed option list is outside the CAPITALS rule, which
       * governs typed free text. `type` stays `nullableText` in the input.
       */
      header: H.tba,
      className: "min-w-[130px]",
      /**
       * A SWITCH, NOT A DROPDOWN (client 2026-08-28: "TBA as toggle — if toggle
       * is enabled To Be Advised, otherwise the state is always Available
       * Item").
       *
       * The list had two entries and one of them was on almost every line, so
       * the control spent a value-width box saying "Available Item" over and
       * over. A `Toggle` carries its state in its SHAPE — the same argument the
       * Process and FOC cells already make — so a BOM with two unsettled lines
       * in twenty shows them by scanning a column rather than by reading a word.
       *
       * THE STORED VALUE IS UNCHANGED: `type` still holds "To be advised" or
       * "Available Item", through the two named constants, so
       * `refuseUnsettledMaterials` and every row saved under the `<Select>` keep
       * working exactly as they did.
       *
       * OFF IS "Available Item", NOT BLANK. The empty option is gone with the
       * dropdown — a switch has no third position — so a line the operator never
       * touches now states the ordinary case rather than saying nothing. That
       * matches the 08-21 default (`DEFAULT_MATERIAL_TYPE`), which `blankItem`
       * has been stamping on new lines since it existed. A row STORED blank
       * before today reads as off, which says the same thing the blank did and
       * is what the switch would write anyway.
       */
      cell: (r) => (
        <Toggle
          ariaLabel="To be advised — the final spec is not settled, so no purchase order may be raised for this material"
          checked={r.type === TBA_MATERIAL_TYPE}
          onChange={(on) =>
            updItem(r.key, { type: on ? TBA_MATERIAL_TYPE : DEFAULT_MATERIAL_TYPE })
          }
        />
      ),
    },
    {
      header: H.combination,
      /* THE SAME WIDTH AS CONSUMPTION UOM (client 2026-08-24: "combination field
         ... size also same as consumption field size"), which is the width both
         Uom cells carry.

         It had been narrowed to 90px when the free-text box came out, on the
         reasoning that the cell now holds one button and needs less. That is
         true of the CONTENT and wrong about the ROW: `FIELD_GROUPS` already
         gives all three of these cells the same `xs` track, so a third cell
         asking for 40px less than its two neighbours under-fills its share and
         the run stops settling evenly — the defect the de-clutter rule says is
         the one that actually ships. Matching the neighbour is also what makes
         the button land under the same left edge as the boxes above and below
         it.

         THE 08-24 INSTRUCTION NAMED A CELL, NOT A NEIGHBOUR, and that is what
         lets it survive the client's 2026-08-28 reorder — given as a chain
         ("cons.uom - moq - round to - combination - tba this order") and
         amended within the hour ("TBA next to the Round To, remaining all the
         same"), which between them put MOQ, Round To and TBA BETWEEN this cell
         and Consumption Uom. The two are three cells apart now and the width
         still matches, because "same size as the consumption field" is a
         statement about how big the box is, not about what it sits next to.
         Nothing here was resized by either instruction. */
      className: "min-w-[130px]",
      /**
       * ONE CONTROL, AND THE FREE-TEXT BOX IS THE ONE THAT WENT
       * (client 2026-08-24, screenshot 2473: "in combination i can see two
       * fields, remove that one unused field").
       *
       * The cell carried BOTH the legacy free-text `combination` input and the
       * opener for the Combination sheet, side by side under one header. The box
       * is the unused half and always was: it is legacy's own column (screenshot
       * 2362), withdrawn 2026-08-17, restored 2026-08-19 with the rest of the
       * row, and **nothing has ever read it** — every remaining reference to
       * `combination` carries it (normalize, both load paths, the save payload,
       * the copy) and none computes from it.
       *
       * It also resolves a collision this file has complained about twice.
       * "Combination" meant three things on one row: this box, the Attribute's
       * `requirement_basis = 'combination'` (colour x size, 0420), and the panel
       * sheet. It now means one, and the header names the thing the button opens.
       * The Attribute option keeps its `(Color + Size)` qualifier regardless —
       * that is what tells IT apart, and shortening it was never safe.
       *
       * ## THE COLUMN WENT, THE FIELD STAYED
       *
       * `combination` is still in `ItemRow`, `blankItem`, both load paths, the
       * copy payload and `mbaItemInput`, and 0418's column is untouched. This is
       * not tidiness deferred: `writeChildren` DELETES AND REINSERTS every child
       * row, so a value the form stops CARRYING is a value the next ordinary save
       * DESTROYS. The same removal was done this way for the Component cell
       * (2026-08-20) and for Purchase Pack (2026-08-21), and both say so.
       *
       * Restoring the box is this block again — put an `<Input>` back beside the
       * button. Nothing downstream has to change, because nothing downstream was
       * ever reading it.
       *
       * The count on the button is the affordance. A gear that looks identical
       * whether a line has three panels or none tells the operator nothing, and
       * the panels are what change the line's ratio — so a line carrying them
       * says so from the grid, without being opened.
       */
      cell: (r) => {
        // ONE READING, TWO CONSUMERS — see `combinationsBlocked` for the gate
        // itself and for why the spec's grain half is not the enforced half.
        const blocked = combinationsBlocked(r);
        return (
          /* THE REASON HANGS ON THE CELL, NOT ON THE BUTTON, and that is the
             whole point of the wrapper carrying it: `Button` sets
             `disabled:pointer-events-none`, so a `title` written on a disabled
             one is a sentence nobody can ever hover — the browser suppresses the
             hover before the tooltip exists. Put on the parent it answers in both
             states — the button has no title of its own, so an enabled one falls
             through to this same string. A disabled control that says nothing is
             worse than the bug it was added to fix. */
          <div
            className="flex items-center"
            title={blocked ?? "Combination (garment parts this line splits into)"}
          >
            <Button
              type="button"
              variant="outline"
              /* `sm` because this is a GRID row, not the header band — dense on
                 purpose and internally consistent with the "+ Add line" beside
                 it. The header row's `md` rule (AGENTS.md) is about the band
                 above a list. */
              size="sm"
              className="h-8 shrink-0 px-2"
              /* OFF THE TAB PATH. Tab lands on FIELDS and nothing else, and this
                 is a button in a grid row — the same treatment the row's own
                 Remove ✕ carries, for the same reason. The mouse still reaches
                 it and so does a screen reader; it is reordered out of the
                 typing path, never removed from the document. */
              tabIndex={-1}
              disabled={!!blocked}
              /* THE REASON IS IN THE NAME TOO. A `title` is mouse-only, and the
                 button stays in the accessibility tree when disabled — so the
                 screen reader gets the same sentence rather than "Combinations,
                 dimmed" with no way to learn why. */
              aria-label={
                blocked
                  ? `Combinations — ${itemName(r.item_id)} (${blocked})`
                  : `Combinations — ${itemName(r.item_id)}`
              }
              onClick={() => setComboLineKey(r.key)}
            >
              {r.combinations.length ? (
                <span className="tabular-nums text-xs">{r.combinations.length}</span>
              ) : (
                <Layers className="h-4 w-4" />
              )}
            </Button>
          </div>
        );
      },
    },
    {
      /**
       * "SEND OUT" — THIS MATERIAL GOES OUT FOR A PROCESS (client 2026-08-25:
       * "while adding material they give any tick box that selected item will
       * only list in process tab"). 0466.
       *
       * DECLARED HERE, WHILE THE MATERIAL IS BEING ENTERED, which is the whole
       * point of the field and the reason it is not on the Processes tab: the
       * operator knows a button is going to be dyed at the moment they add the
       * button, and the tab is then a work list rather than a directory of every
       * trim on the BOM.
       *
       * THE TAB READS A UNION — ticked OR already carrying a process row — and
       * that is what makes this safe rather than merely short. See `procGroups`
       * for the argument in full; the short version is that un-ticking can never
       * hide a row, so it can never take one out of the save payload, so it can
       * never trip `writeChildren`'s refusal to drop a row already dispatched
       * under a delivery challan.
       *
       * IT IS A `<Toggle>`, NOT A RAW TICK (client 2026-08-25: make it read as a
       * yes/no question). This comment used to say "a raw `<input
       * type="checkbox">` because this repo has no Checkbox primitive" — that
       * was true when it was written and stopped being true when
       * `components/ui/toggle.tsx` landed for the Garment Order header, where
       * Pack and Multi Style are the same shape of answer. A switch "carries its
       * state in its shape and its colour", where a tick makes the eye find the
       * box and then read the word; on a row of twenty cells that is the whole
       * difference between scanning and reading.
       *
       * NOTHING ABOUT THE KEYS CHANGED, and that is why the swap is cheap:
       * `Toggle` is a real `<input type="checkbox">` underneath (`sr-only`, with
       * the switch drawn by its siblings) precisely so `isFieldLike` still
       * matches it. A `<button role="switch">` would have been skipped by Tab,
       * by Enter-advance and by the grid arrows.
       *
       * THE HEADER STAYS THE ONE WORD. The client's phrasing in the recording
       * was "Use Process" / "Use Piece Process"; the 08-26 instruction that
       * renamed it asked only that it "read as a yes-or-no about a process", and
       * with a switch in the cell it now does. A three-word header on an `xs`
       * cell wraps, and the fuller question is on the control's `ariaLabel`.
       *
       * IT STAYS ON THE KEYBOARD AXIS. `ROW_FIELDS` counts a checkbox on purpose
       * (`child-grid.tsx`, client 2026-07-28 — excluding one made every arrow key
       * dead on a tick-box cell), so no `data-focus-optional` here: the operator
       * reaches it with ←/→ like any other cell and Space ticks it.
       *
       * `aria-label` because the header text does not reach the control in the
       * card layout — the same gap `document-no-format-master-screen.tsx` closes
       * on its own tick columns.
       */
      /*
       * "PROCESS", NOT "SEND OUT" (client 2026-08-26: rename it so it reads as a
       * yes-or-no about a process).
       *
       * The tick has always meant "does this material go out for a process?" —
       * dyeing, washing, printing — and "Send out" named the LOGISTICS of that
       * answer rather than the question. The operator ticking it is deciding
       * whether the item belongs on the Processes tab, so the column is now
       * named after the thing being decided.
       *
       * THE WORD IS USED TWICE ON THIS SCREEN AND THAT IS TOLERABLE HERE. The
       * Processes tab has its own "Process" column — a picker naming WHICH
       * process — so one word covers "does it need one" and "which one". They
       * are on different tabs and never appear in one grid, and the `aria-label`
       * below carries the fuller question for anyone who cannot see the tab they
       * are on. Worth knowing rather than worth renaming: this module has been
       * bitten before by one word meaning three things ("Combination"), and the
       * check that matters is that a reader can always tell which is meant from
       * the surface they are looking at.
       */
      header: H.process,
      align: "center",
      className: "min-w-[5rem]",
      cell: (r) => (
        <Toggle
          ariaLabel="Needs a process — send this material out for dyeing, washing or printing"
          checked={r.send_out}
          onChange={(send_out) => updItem(r.key, { send_out })}
        />
      ),
    },
    {
      /**
       * FREE OF COST RECEIPT — the customer supplies this trim (client
       * 2026-08-28). 0474.
       *
       * THE SAME IDIOM AS "Process" ABOVE, on purpose and not by copy-paste
       * habit: both are a yes/no about the line that changes what happens to it
       * downstream, both are the exception rather than the rule, and both are
       * read by scanning a column rather than by reading a word. A `Toggle`
       * carries its state in its shape, so a BOM with one free-issue line in
       * twenty shows that line at a glance.
       *
       * WHAT IT CHANGES IS DOWNSTREAM, NOT HERE. The requirement arithmetic on
       * this screen is untouched — the quantity needed is the same whoever pays
       * for it — and it is `lib/purchase` that reads the flag, to let a goods
       * receipt be raised against the line with NO purchase order behind it.
       * That half is T1's; this cell is the declaration.
       *
       * IT SITS BESIDE Process, because the two ticks are the same kind of
       * question and read better together than a switch buried between two
       * numeric boxes. THE PAIR HAS SURVIVED THREE MOVES IN A DAY WITHOUT EVER
       * COMING APART, which is the property worth protecting here: they were
       * the last two cells on the row when FOC landed (0474); TBA moving to the
       * end on 2026-08-28 pushed them up one; the client's reorder later the
       * same day ("cons.uom - moq - round to - combination - tba this order")
       * put them back at the end; and the amendment minutes after that ("TBA
       * next to the Round To, remaining all the same") left them exactly where
       * that chain had. Neither 08-28 instruction NAMED these two cells at all —
       * both describe the run of fields before them — so the ticks close the
       * line by following it.
       *
       * FOC IS LAST AGAIN, and that is a return rather than a restoration: a
       * reader who finds an intervening note saying "FOC is no longer last" is
       * holding the middle of the story. The renderer matches by HEADER, so the
       * position here is presentation and nothing else depends on it.
       *
       * `aria-label` for the reason `Toggle.ariaLabel` documents: the column
       * header does not reach the control in the cards layout, so omitting it
       * would ship an unnamed checkbox.
       */
      header: H.foc,
      align: "center",
      className: "min-w-[5rem]",
      cell: (r) => (
        <Toggle
          ariaLabel="Free of cost receipt — the customer supplies this material, so it is received without a purchase order"
          checked={r.is_foc}
          onChange={(is_foc) => updItem(r.key, { is_foc })}
        />
      ),
    },
    /*
     * PURCHASE PACK IS OFF THE ITEM ROW (client 2026-08-21: "remove the purchase
     * pack field from material bom child").
     *
     * THE COLUMN WENT, THE FIELD STAYED — the withdrawal pattern this file
     * already records for `type`, `alternate_uom_id` and `combination`. It is not
     * tidiness: `writeChildren` DELETES AND REINSERTS every child row, so a value
     * the form stops CARRYING is a value the next save destroys. `ItemRow`,
     * `blankItem`, both load paths and the save payload all still carry
     * `uom_conversion_id`, so the packs already chosen on live BOMs survive an
     * ordinary edit-and-save of the line.
     *
     * AND IT IS STILL READ. `packOf` feeds `packUsable` in the line totals, so
     * a stored pack keeps converting the requirement into a purchase figure —
     * this removed the way to CHANGE one, not the effect of having one.
     * `packsFor` went with the cell; it had no other reader.
     *
     * WHAT THAT SENTENCE MISSED, AND WHAT 2026-08-27 PUT BACK. "A stored pack
     * keeps converting" was true and was the whole of it: no line created after
     * the cell went could STORE one, so `packUsable` was false on every new
     * line and the Final Quantity was the consumption figure on all of them —
     * which is what the client reported ("need to show the purchase qty as
     * final ... its showing the consumption qty only"). Removing the field
     * removed the answer, and nothing was derived in its place.
     *
     * `resolveLinePack` derives it now, from the material and the two Uoms the
     * line already names, and `describeConversion` came back with the tie
     * chooser that lives inside the Purchase Uom cell. The column is still gone
     * and is not coming back: what stands there is a control that appears only
     * where the units name two packs and the app must not guess.
     */
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

  /**
   * THE PROCESSES TAB, GROUPED BY MATERIAL — legacy's shape (screenshot 2484).
   *
   * Legacy lists the ITEM as a parent row and hangs the process rows under it.
   * That is not decoration: it is what makes "a process is raised against one of
   * this BOM's materials" structural rather than a rule someone has to check. Our
   * flat grid asked for the material with a picker, and until today that picker
   * offered the whole accessory master.
   *
   * THE LAST GROUP IS FOR ORPHANS, and it is the half that is easy to leave out.
   * A process row whose material has since been deleted from the Items grid
   * belongs to no group — and `writeChildren` deletes and reinserts every child,
   * so a row the form stops SHOWING is still a row the form still SAVES. Leaving
   * it ungrouped would make it invisible and un-editable while quietly persisting
   * for ever. It gets a named bucket instead, so the operator can see it and fix
   * or remove it.
   */
  const procGroups = (() => {
    /* ONLY THE MATERIALS THAT ACTUALLY HAVE A PROCESS (client 2026-08-25:
       "sometimes that chosen item need to do give any process").

       The first cut listed EVERY material on the BOM with an empty grid under
       each. That was legacy's nesting without legacy's premise: its outer grid
       is a CHOSEN SUBSET — the blank row at the bottom of screenshot 2484 is how
       an item is added to it — because most trims are bought and sewn on, and
       only a few are sent out to be dyed or washed. An eleven-material BOM
       therefore opened on eleven empty boxes, and the two that mattered were
       indistinguishable from the nine that did not.

       A GROUP EXISTS BECAUSE A ROW EXISTS. There is no second "which materials
       are listed" state to keep in step with `procs` — adding a material adds
       its first process row, and removing the last row removes the group. Two
       sources of that truth is exactly the drift this file keeps recording;
       deriving it costs nothing and cannot desync.

       ORDERED BY THE BOM, not by when a process was added, so the Processes tab
       reads down in the same order as the Items grid above it. */
    const withProcess = new Set(
      procs.map((pr) => pr.item_id).filter((v): v is string => !!v),
    );
    const seen = new Set<string>();
    const groups = items
      /* TICKED **OR** CARRYING A ROW — a UNION, and the "or" is the whole safety
         argument (0466, client 2026-08-25: "while adding material they give any
         tick box that selected item will only list in process tab").

         THE NOTE ABOVE ARGUES AGAINST A SECOND SOURCE OF TRUTH, and it is right
         about the failure it names — two states free to disagree about what is
         displayed. A union cannot disagree: a row ALWAYS shows, whatever the
         flag says. What the flag adds is the one state deriving cannot express,
         *decided but not yet filled in* — the to-do that makes this tab a work
         list instead of a record of finished work. Both halves earn their place;
         deleting either loses something.

         AND IT IS WHY UN-TICKING NEEDS NO GUARD. `writeChildren` deletes and
         reinserts every process row and REFUSES a save that drops one already
         dispatched under a challan — testing the raw payload, not the screen.
         Under a union, un-ticking cannot remove a row from this list, so it
         cannot remove one from the payload, so it cannot trip that refusal or
         quietly delete an un-dispatched row. There is nothing to confirm and
         nothing to lose. */
      .filter(
        (x) =>
          !!x.item_id &&
          (withProcess.has(x.item_id) || x.send_out) &&
          !seen.has(x.item_id) &&
          seen.add(x.item_id) !== null,
      )
      .map((x) => ({
        id: x.item_id as string,
        label: itemName(x.item_id),
        rows: procs.filter((pr) => pr.item_id === x.item_id),
      }));
    const onBom = new Set(groups.map((g) => g.id));
    const orphans = procs.filter((pr) => !pr.item_id || !onBom.has(pr.item_id));
    return orphans.length
      ? [...groups, { id: null as string | null, label: "Not on this BOM", rows: orphans }]
      : groups;
  })();

  /** BOM materials with no process yet — what the "+ Add" picker offers. A
   *  material already listed is not offered again: its own "+ Add process" is
   *  how a second stage is added to it. */
  const procAddable = (() => {
    /* "TAKEN" NOW MEANS LISTED, WHICH IS THE UNION (0466) — carrying a row OR
       ticked. Testing rows alone would offer a material that is already on the
       tab waiting for its first process, and adding it a second time would put
       a second empty group under the same heading. */
    const taken = new Set(procs.map((pr) => pr.item_id).filter((v): v is string => !!v));
    const seen = new Set<string>();
    return items
      .filter(
        (x) =>
          !!x.item_id &&
          !taken.has(x.item_id) &&
          !x.send_out &&
          !seen.has(x.item_id) &&
          seen.add(x.item_id) !== null,
      )
      .map((x) => ({ id: x.item_id as string, code: null, name: itemName(x.item_id) }));
  })();

  /**
   * LEGACY'S FIVE ON ONE LINE (client 2026-08-24: "make the 5 field in single
   * row in process") — NOW THREE, see the Descriptions/Notes removal below.
   *
   * THE ROW MUST SUM TO THE TRACK, which is `FieldGrid`'s house 12 — under-fill
   * it and the last field drops to a line of its own, which is the de-clutter
   * rule's "defect that ships". `FIELD_SPAN` maps xs=2, sm=3, md=4, lg=6, so:
   *
   *     Stage 3 + Process 6 + Loss % 3  = 12
   *
   * The width goes to the one that holds a phrase — a process name ("TRIMS
   * DYEING"). **Loss % is `sm` and not the `xs` a bare percentage would want**
   * because its cell carries the loss CONFIGURATION opener beside the number;
   * at `xs` the button and the figure share ~70px and the box stops being
   * typeable. Narrowing it back is only safe if that opener goes too.
   *
   * THE ORPHAN BUCKET CARRIES FOUR, so it cannot use these numbers: it also
   * shows Material, the only way to put a stranded row back on a material that
   * still exists. Four fields at sm is 12 exactly, so that case is uniform
   * instead — one rule per shape rather than one shape squeezed to fit the
   * other's. **Both numbers moved when the two columns went**; changing the
   * column list without re-deriving both is how the last cell wraps.
   */
  const PROC_ROW_SPAN: Record<string, FieldSize> = {
    Stage: "sm",
    Process: "lg",
    "Loss %": "sm",
  };
  const procFieldSize = (header: string, withMaterial: boolean): FieldSize =>
    withMaterial ? "sm" : (PROC_ROW_SPAN[header] ?? "sm");

  const procColumns: ChildGridColumn<ProcRow>[] = [
    /* THE SIX LIFECYCLE CELLS CAME OUT (client 2026-08-24: "just maintain the
       legacy only remove the lifecycle fields"), leaving legacy's five and
       nothing else on the row.

       THIS REVERSES THE SAME DAY'S "keep the lifecycle and add legacy's five
       fields nested". Both instructions are recorded rather than one being
       tidied away, because the argument for keeping them is real and will be
       made again: Vendor / Qty Out / Challan / Qty In / Balance / Status are
       0459's grey-to-processed chain, they are what `chain.ts` walks, and they
       came from doc/file.md §6. Restoring them needs a new client decision.

       WHAT THIS COSTS, STATED SO IT IS NOT REDISCOVERED AS A BUG: `dcEligible`
       requires `vendor_id` and `qty_out > 0`, and both were typed HERE. With no
       cell to type them in, no row can become eligible and **Generate Delivery
       Challan can never fire from this screen again**. The bar is left in place
       and now reads "Nothing ready to send out" permanently. That is deliberate
       for the moment — removing the bar as well is a second deletion, and one
       the client has not asked for.

       THE COLUMNS WENT, THE FIELDS STAYED. `vendor_id`, `qty_out`, `qty_in` and
       `status` are still in `ProcRow`, `blankProc`, both load paths, the copy
       and `mbaProcessInput`, and no DB column was dropped. `writeChildren`
       DELETES AND REINSERTS every process row, so a value the form stops
       CARRYING is one the next ordinary save DESTROYS — and these carry the link
       to Rule 55 documents that have already left the building. Restoring the
       cells is this block again; nothing downstream has to change. */
    {
      header: "Material",
      className: "min-w-[160px]",
      cell: (r) => (
        <RecordPicker
          label="Material"
          /* THIS BOM's MATERIALS ONLY — see `procMaterialOptions`. It used to be
             the whole accessory master, which let a process row name a material
             the order does not buy. */
          items={procMaterialOptions(r.item_id)}
          value={r.item_id}
          onChange={(id) => updProc(r.key, { item_id: id })}
          /* EMPTY-AND-EXPLAIN, never a bare "— Select —". An empty list here has
             exactly one cause and it is fixable, so it says which tab to go to;
             reporting it as "no materials" would read as a broken master. */
          placeholder={
            items.some((x) => !!x.item_id)
              ? "— Select Material —"
              : "Add a material on the Material BOM tab first"
          }
          compact
        />
      ),
    },
    {
      /* STAGE COMES BEFORE PROCESS, which is legacy's order and reads correctly:
         the stage is WHAT the material becomes ("DYED") and the process is HOW
         ("TRIMS DYEING"). */
      header: "Stage",
      className: "min-w-[130px]",
      /* FREE TEXT, THOUGH LEGACY RENDERS A DROPDOWN. The only value ever
         observed is "DYED" (screenshot 2484), and one sighting is not a
         vocabulary — this repo has already paid for inventing one, when a seeded
         word list "corrected" a Packing Accessories name to COTTON and the
         client had the feature removed two days later (AGENTS.md, Near misses).
         It becomes a picker the moment the client supplies the list; the column
         is text either way, so nothing has to be re-stored. */
      cell: (r) => (
        <Input
          value={r.stage}
          onChange={(e) => updProc(r.key, { stage: e.target.value })}
          className="h-8"
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
    /* THE "For" CELL WAS HERE AND CAME OUT (client 2026-08-24: "legacy only have
       5 fields ... S No Stage / Process / Descriptions / Loss % / Notes").

       It IS visible in screenshot 2484, between Process and Descriptions, with
       "Process wise" selected — which is why it was built. The client has since
       said the tab carries five fields and not listed it, so it is not one the
       operators use. The later instruction wins.

       THE COLUMN WENT, THE FIELD STAYED. `for_scope` is still in `ProcRow`,
       `blankProc`, both load paths, the copy and `mbaProcessInput`, and 0465's
       column is untouched. That is not tidiness deferred: `writeChildren`
       DELETES AND REINSERTS every process row, so a value the form stops
       CARRYING is a value the next ordinary save DESTROYS. The same removal was
       done this way for the Combination box (2026-08-24), the Component cell
       (2026-08-20) and Purchase Pack (2026-08-21), and each says so.

       Restoring it is this block again — nothing downstream has to change. */
    /* DESCRIPTIONS AND NOTES CAME OFF THE GRID (client 2026-08-25, the recording
       after the one that added them): "remove both fields completely — operators
       entering trims at high speeds never use free-text notes, and they only add
       horizontal clutter to an already dense grid."

       THIS REVERSES 0465, APPLIED THE DAY BEFORE on the same client's "keep the
       lifecycle and add legacy's five fields nested". The later instruction
       wins, and both are recorded rather than one being tidied away — the
       argument for legacy parity is real and will be made again.

       DESCRIPTION IS NOT GONE, IT MOVED. The same instruction says a descriptive
       field belongs inside the LOSS configuration, naming the contract class
       (contract dyeing, logo engraving) — so it is reached from the Loss % cell
       below rather than standing as a column of its own.

       THE COLUMNS WENT, THE FIELDS STAYED — the fourth time on this screen
       (`for_scope`, the six lifecycle cells, Combination, and now these). Both
       are still in `ProcRow`, `blankProc`, both load paths, the copy and
       `mbaProcessInput`, and 0465's columns are untouched. That is not tidiness
       deferred: `writeChildren` DELETES AND REINSERTS every process row, so a
       value the form stops CARRYING is a value the next ordinary save DESTROYS.
       Restoring either cell is one block; nothing downstream has to change. */
    {
      header: "Loss %",
      align: "right",
      className: "min-w-[6rem]",
      /* STORED AND SHOWN, AND IT COMPUTES NOTHING (0465). Said here as well as
         in the column comment because a percentage beside a quantity reads as
         live: a merchandiser will assume the Requirement tab already accounts
         for it. Wiring it into `requirementFor` changes every purchase on a BOM
         carrying a process, and the loss COMPOUNDS along a chain
         (`prev_row_uid`), so two stages at 5% is not 10%. That needs its own
         decision and its own vectors. */
      cell: (r) => (
        <Input
          type="number"
          min="0"
          max="100"
          step="0.01"
          value={r.loss}
          onChange={(e) => updProc(r.key, { loss: e.target.value })}
          className="h-8 text-right"
        />
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
          <span className="font-medium tabular-nums">{fmtQty(r.required, r.decimals)}</span>
        ) : (
          <span className="text-xs text-muted-foreground">{r.refusal ?? "—"}</span>
        ),
    },
    { header: "Uom", cell: (r) => <span className="text-xs">{r.uom}</span> },
    {
      header: "Purchase Qty",
      align: "right",
      cell: (r) => (
        <span className="tabular-nums">
          {r.purchase != null ? fmtQty(r.purchase, r.purchaseDecimals) : "—"}
        </span>
      ),
    },
    { header: "Purchase Uom", cell: (r) => <span className="text-xs">{r.purchaseUom}</span> },
  ];

  /*
   * THE DELIVERY CHALLAN ENTRY POINT CAME OUT (client 2026-08-24: "remove the
   * bar too"), and it is a deletion with a reason rather than a cleanup.
   *
   * It followed directly from removing the lifecycle cells the same day. The
   * challan is raised from `dcEligible`, which required a VENDOR and a positive
   * QTY OUT — both typed in cells that no longer exist — so the bar could never
   * become enabled again and read "Nothing ready to send out" for ever. A
   * control that can never activate is worse than an absent one: it reads as
   * broken software rather than as a decision.
   *
   * ## WHAT IS GONE AND WHAT IS EMPHATICALLY NOT
   *
   * Gone: the bar, `dcEligible`, `dcCandidates`, `dcByRow`, and the
   * `DcGenerateSheet` it opened — all UI, all on THIS screen.
   *
   * Untouched: `material_bom_amendment_processes` and every column on it,
   * `mbaProcessInput`, the `dc_lines` the service still loads, `row_uid` (the
   * anchor a raised challan is matched by, 0446), `lib/orders/process-chain`,
   * `lib/orders/material-bom/process-return`, and the delivery-challan module
   * itself. Challans already issued still resolve, and `check:process-chain`
   * still covers the logic.
   *
   * So this removes a WAY IN, not a capability. Restoring it needs the lifecycle
   * cells back (see the note in `procColumns`) and this block, and nothing in
   * between has to be rebuilt — which is the whole reason the fields kept their
   * round trip when the columns went.
   */

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
       * THE 1440px CAP COMES OFF THIS SECTION (client 2026-08-28, via the single
       * -row instruction below).
       *
       * `wide` was written on 2026-08-17 for exactly this shape — "a section
       * whose whole content is one wide `ChildGrid`, a line grid with ten or
       * more columns" — and this screen never declared it. So the item row has
       * been dividing 1440px when 1720px was there for the asking, and the
       * two-run split shipped earlier today was, in part, that missing 280px.
       *
       * IT MOVES BOTH CAPS, and that is checked rather than assumed:
       * `master-full-screen.tsx` reads `active?.wide` at the content pane AND at
       * the footer, because a section that widens its pane and leaves the footer
       * at 1440 puts Save a couple of inches left of the last column it saves.
       *
       * IT DOES NOT REPEAL THE CAP'S REASONING. 1440 stops a FIELD stretching to
       * an absurd width on a wide monitor; this section's fields are shares of a
       * 32-column track that stays crowded at any width the cap allows, so there
       * is no field here the extra 280px could stretch — it buys columns instead.
       * The other two sections keep the ordinary cap, which is the point of the
       * flag being per-section rather than per-editor.
       */
      wide: true,
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
                label="Garment Order (RE No)"
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
              /* THE GRAIN, THROUGH THE SAME `grainLabel` THE CELL AND THE CAPTION
                 READ. This was `REQUIREMENT_BASIS_LABELS[row.requirement_basis]`,
                 which is the legacy six-name alias — blank on the eight grains
                 that have no legacy name — so a folded line on any Combination
                 Attribute showed NO ATTRIBUTE AT ALL in the rail. That is the
                 summary the operator scans twenty lines of, and it is the same
                 root cause as the grid that would not draw beneath it. */
              const basis = row.requirement_grain ? grainLabel(row.requirement_grain) : null;
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
                        {/* `fmtQty`, NOT `fmtNumber`: the latter is a bare
                            `toLocaleString` and caps at three fraction digits
                            while rounding to NEAREST, so a six-decimal pack unit
                            printed LESS than the stored figure — see `fmtQty`'s
                            own header. Same reason the ribbon uses it. */}
                        <span className="block text-[12px] font-semibold tabular-nums text-accent">
                          {fmtQty(t.final, t.finalDecimals)}
                        </span>
                        {t.finalUom && t.finalUom !== "—" && (
                          <span className="block text-[9px] tracking-wide text-muted-foreground">
                            {t.finalUom}
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
              /* `H.material`, NOT the literal. This `find` carries a `!`, so a header
                 renamed in one place and not the other stops being a silently
                 orphaned column and becomes a crash on opening the section. That is
                 the whole reason the names are declared once. */
              const material = itemColumns.find((c) => c.header === H.material)!;
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
              /*
               * STYLE HIDES ITSELF ON A SINGLE-STYLE ORDER (client 2026-08-21:
               * "in approximately 98% of orders there is only one style mapped
               * to the PO ... carrying a prominent 280px Style picker on every
               * accessory row is completely redundant").
               *
               * TWO WAYS TO EARN ITS PLACE, and the second is not optional: a
               * Style-wise line is SPLIT by style, so the field has to be
               * reachable even where the order carries one — otherwise the basis
               * names an axis the operator cannot see.
               *
               * A HIDDEN FIELD IS NOT RENDERED, never `hidden`. Tab and the
               * required-holds both walk the DOM, so a CSS-hidden control is a
               * box the operator can be sent to and cannot see. Same rule the
               * detail band followed when it closed.
               *
               * `style_ref_no` is still carried, saved and round-tripped — this
               * is a field coming off the SCREEN, not off the record, which is
               * the withdrawal pattern this file records for Type, Alternate Uom
               * and Combination.
               */
              const groups = FIELD_GROUPS.map((g) => {
                const cells = g.flatMap((b) => {
                  const col = itemColumns.find((c) => c.header === b.header);
                  return col
                    ? [{ col, size: b.size, weight: b.weight, align: b.align }]
                    : [];
                });
                /* A RUN CAN NOW BE EMPTY. Run 2 is Style alone since Item Color,
                   Size and Specification became sub-grid columns, and Style hides
                   itself on a single-style order — so on an ordinary order that
                   run has nothing in it. An empty run would still draw its `py-3`
                   and its hairline, which is a seam marking a boundary between
                   nothing and nothing. Dropped below rather than rendered blank. */
                /* EVERY RUN MUST STILL SUM TO 32 or its last field drops to a
                   line of its own — the rule the width table above states. Run 2
                   is four `xl` (8 each); dropping one leaves 24, so the three
                   survivors are re-spread rather than left short. Size takes the
                   widest slot for the reason the table gives: a size list is the
                   longest of the three. */
                return cells;
              });
              const named = new Set(FIELD_GROUPS.flat().map((b) => b.header));
              const orphans = itemColumns
                .filter((c) => !named.has(c.header))
                // `align` carried explicitly so an orphan and a declared cell
                // share ONE shape — `runs` is the union of both, and the
                // renderer destructures `align` off every member.
                .map((col) => ({
                  col,
                  size: "sm" as FieldSize,
                  weight: "plain" as Weight,
                  align: undefined as "end" | undefined,
                }));
              const withCells = groups.filter((g) => g.length > 0);
              const runs = orphans.length ? [...withCells, orphans] : withCells;
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
                          {fmtQty(t.final, t.finalDecimals)}
                        </span>{" "}
                        <span className="text-[10px] tracking-wide text-muted-foreground">
                          {t.finalUom}
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
                        {g.map(({ col, size, weight, align }, ci) => (
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
                            /* `text-right` and not a flex rule: `Field` is a
                               plain block whose control is inline-level (Toggle
                               is `inline-flex w-fit`), so text alignment is what
                               moves it — and the label rides along, which is
                               what makes the cell read as deliberately
                               right-hand rather than as a stray control. */
                            className={cn(
                              DENSE,
                              WEIGHT_CLASS[weight],
                              align === "end" && "text-right",
                            )}
                          >
                            {col.cell(row, i)}
                          </Field>
                        ))}
                      </FieldGrid>
                    </div>
                  ))}
                  {sliceGrid(row)}
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
              /*
               * A LINE IS FINISHED BEFORE THE NEXT ONE STARTS (client 2026-08-24:
               * "don't allow user to add another material before filling required
               * fields").
               *
               * `ChildGrid` treats a `false` return as a DECLINE, and the decline
               * is what makes this readable: the grid lands the cursor in whatever
               * row it adds (`landOnAddedRow`), so a refusal that adds no row
               * moves nothing and the half-filled line stays where the operator is
               * looking. AGENTS.md records the same shape for `addSize`.
               *
               * IT SAYS WHY. A button that silently does nothing reads as broken —
               * the same complaint that produced `SubSheetFooter`. The toast names
               * the first missing field, and the fields it names are
               * `missingItemFields`', so this cannot drift from the red `*`, the
               * cursor hold or the server action.
               *
               * THE TEST IS ON THE LAST ROW, not on every row. A BOM being edited
               * may hold an older line somebody else left short, and refusing to
               * let this operator add anything until they fix it would be a
               * different, larger rule than the one asked for.
               */
              const last = items[items.length - 1];
              if (last) {
                const missing = missingItemFields({
                  category_id: last.category_id,
                  item_id: last.item_id,
                  requirement_grain: last.requirement_grain,
                  requirement_basis: last.requirement_basis || null,
                  no_of_items: numOrNull(last.no_of_items),
                  per_pieces: numOrNull(last.per_pieces),
                  /* THE FIGURES ARE USUALLY HERE, NOT ON THE LINE. Items and Pcs
                     are typed in the attribute's sub-grid (2026-08-21), so a gate
                     reading only the line's two boxes refused a line the operator
                     had finished — see `missingItemFields`. */
                  slices: last.slices,
                });
                if (missing.length) {
                  toastError(
                    `Finish ${itemName(last.item_id)} first — ${missing
                      .map((m) => m.label)
                      .join(", ")} still needed`,
                  );
                  return false;
                }
              }
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
      /**
       * EVERY LISTED MATERIAL HAS A PROCESS — not "any row exists anywhere"
       * (0466).
       *
       * It was `procs.some(r => r.item_id || r.process_id)`, which lit the dot
       * as soon as ONE row existed on the whole document — orphans included —
       * so a BOM with four materials sent out and one process named read as
       * finished. That was defensible while the tab listed every material and
       * "done" could only ever mean "somebody started"; with the tab now listing
       * a DECLARED set, there is a real question to answer and this is it.
       *
       * ADVISORY, NEVER A BLOCK, and that comes free rather than being enforced:
       * the `processes` section declares no fields to `sectionValidity`, so it
       * cannot produce a problem or kill Save. Deliberate — an operator may tick
       * materials while entering them and name the processes later, and
       * `is_draft` exists for parking exactly that.
       *
       * AN EMPTY LIST IS DONE. `every` on nothing is true, which is the right
       * answer: a BOM whose trims are all bought ready-to-use has no processes
       * to name and is not unfinished for it.
       */
      done: procGroups.every((g) =>
        g.rows.some((r) => r.process_id || (r.stage ?? "").trim()),
      ),
      content: (
        <SectionBody title="Processes">
          {/*
            * ONE GRID PER MATERIAL, not one flat list (client 2026-08-24: "keep
            * the lifecycle and add legacy's five fields nested").
            *
            * The material is the GROUP HEADING and so is not a field on the row —
            * legacy has no material picker on its process line because the
            * nesting already says which item the line belongs to. `procColumns`
            * keeps its Material column regardless: it is what the orphan bucket
            * needs in order to be fixable, and dropping it from the definition
            * would take it off the payload too.
            */}
          {/* THE EMPTY STATE IS THE ORDINARY ONE, and it says so. A BOM whose
              trims are all bought ready-to-use needs no processes at all, so
              this must read as "nothing to do here", not as "something is
              missing". The two causes are distinguished because they have
              different fixes: no materials at all is fixed on another tab; no
              processes is fixed by the picker below, or by leaving it alone. */}
          {procGroups.length === 0 && (
            <p className="text-xs text-muted-foreground">
              {items.some((x) => !!x.item_id)
                ? "No material is sent out for processing. Add one below if a trim has to be dyed, washed or printed before it is used."
                : "Add a material on the Material BOM tab first — a process is sent out against one of this BOM's materials."}
            </p>
          )}
          {procGroups.length > 0 && (
            procGroups.map((g, gi) => (
              <div key={g.id ?? "__orphans"} className="mt-3 rounded-lg border border-border first:mt-0">
                {/* The parent row. Numbered like legacy's S No, and the count is
                    the affordance a bare heading lacks — a material with no
                    processes reads as deliberate rather than unfinished. */}
                <div className="flex items-center gap-2 border-b border-border bg-surface-muted px-3 py-1.5 text-[11px] text-muted-foreground">
                  <span className="tabular-nums">{gi + 1}</span>
                  <Truncated className="text-[13px] text-foreground">{g.label}</Truncated>
                  <span className="ml-auto">
                    {g.rows.length} {g.rows.length === 1 ? "process" : "processes"}
                  </span>
                </div>
                <ChildGrid<ProcRow>
                  columns={procColumns}
                  rows={g.rows}
                  forceCards
                  flatRows
                  foldRows
                  canFold={(row) => !!row.process_id}
                  renderFoldedRow={(row) => {
                    /* The material is the heading, so the folded line spends its
                       width on what distinguishes one process from another. */
                    const summary = [
                      row.stage.trim() || null,
                      data.processes.find((pp) => pp.id === row.process_id)?.name,
                      row.loss.trim() ? `loss ${row.loss.trim()}%` : null,
                      /* Quantities are no longer on the row, so the folded line
                         summarises what IS: the stage, the process and the loss. */
                    ]
                      .filter(Boolean)
                      .join("  ·  ");
                    return (
                      <FieldGrid>
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
                      {procColumns
                        /* MATERIAL IS THE HEADING — except in the orphan bucket,
                           where it is the only way to put the row back on a
                           material that still exists. */
                        .filter((c) => c.header !== "Material" || g.id === null)
                        .map((c, ci) => (
                          <Field
                            key={ci}
                            label={c.header}
                            required={c.required}
                            size={procFieldSize(c.header, g.id === null)}
                          >
                            {c.cell(row, i)}
                          </Field>
                        ))}
                    </FieldGrid>
                  )}
                  /* NO `seedRow`. One blank row per material would put a card
                     under every line the moment the tab opened — eleven
                     materials, eleven empty forms. `normalizeProcesses` drops
                     them, so nothing would be stored; it is the screen that
                     would be unreadable. */
                  onAdd={() =>
                    g.id === null
                      ? false
                      : mutProcs((xs) => [...xs, { ...blankProc(newKey()), item_id: g.id }])
                  }
                  onRemove={(r) => mutProcs((xs) => xs.filter((x) => x.key !== r.key))}
                  addLabel="+ Add process"
                />
              </div>
            ))
          )}

          {/* ADD A MATERIAL TO THE LIST — legacy's blank outer row (screenshot
              2484), as a picker rather than a row because there is nothing to
              type: the choice is always one of the BOM's own materials.

              CHOOSING ONE CREATES ITS FIRST PROCESS ROW, which is what makes the
              group appear — the group is derived from `procs`, so there is no
              separate list to add to. It also means the operator lands on
              something they can fill in rather than on an empty container.

              `value={null}` ALWAYS: this picker performs an action, it does not
              hold a value. Nothing is stored against it, so it resets itself.

              It hides when there is nothing left to offer, rather than
              disabling: an empty picker on a BOM whose every material already
              has a process is a control with no purpose, and each material's own
              "+ Add process" is how a second stage gets added. */}
          {procAddable.length > 0 && (
            <div className="mt-3 w-[280px]">
              <RecordPicker
                label=""
                items={procAddable}
                value={null}
                /* IT TICKS THE MATERIAL TOO (0466). Adding a process here IS the
                   decision the Items tab's "Process" tick records, so leaving
                   that box un-ticked would make the two halves of the union
                   describe the same material differently — the tab listing it
                   because it has a row, the line saying it needs no process.

                   THIS IS WHAT KEEPS THEM CONSISTENT BY CONSTRUCTION, and it is
                   why the tick is not a gate: an operator who never visits the
                   Items grid can still send a material out, and the flag follows
                   them rather than having to be remembered. After this the two
                   can only differ by an explicit un-tick — which the union
                   already makes harmless.

                   Both updates in one handler; `setItems`/`mutProcs` are
                   functional updates, so they compose without either reading the
                   other's stale state. */
                onChange={(id) => {
                  if (!id) return;
                  mutProcs((xs) => [...xs, { ...blankProc(newKey()), item_id: id }]);
                  setItems((xs) =>
                    xs.map((x) => (x.item_id === id ? { ...x, send_out: true } : x)),
                  );
                }}
                placeholder="+ Send a material out for processing"
                compact
              />
            </div>
          )}
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
        {/* THE PRIMARY ACTION SITS BESIDE "← Back", NOT IN A BAND OF ITS OWN.
            It was a right-aligned div under the toolbar, so the two buttons this
            screen has stood 80px apart on two rows with a hole between them,
            while the toolbar's own contents ended at 40% of the width. `actions`
            is also the shape `--check toolbar-size` recognises as a header row,
            so the h-9 rule is enforced here rather than trusted. */}
        <PageHeader
          title="Material BOM"
          description="Every sewing and packing accessory a confirmed order needs, and how much of each."
          actions={
            perms.canCreate ? (
              <Button size="md" onClick={() => openAdd(null)}>
                + New Material BOM
              </Button>
            ) : undefined
          }
        />

        {/* THE STATUS FACET IS THE ONE EVERY OTHER LIST SCREEN HAS — a <Label>
            and a <Select> in one cell of the Filters panel (`master-list-shell.tsx`
            is the reference) — WITH THE COUNTS IN ITS OPTIONS.

            Two shapes were tried and both were wrong, and the reason is the same
            in each: they were new controls rather than the app's control.
            First a rail of chips in a band above the list, then the same chips
            in the panel, then a dropdown of my own on the toolbar row. The
            client's answer was "i meant inside that filter add this ... check
            the previous filter from our other child" (2026-08-21). The ask was
            never a new control; it was the COUNTS, in the facet that was already
            there.

            What the counts buy is the whole point: a state list that says nothing
            about whether any rows are in it cannot answer "is anything stale?" —
            the question a work queue exists to answer — except by choosing
            Recalculate and looking at an empty list.

            A state with no rows is SHOWN AND NOT CHOOSABLE, never hidden: zero
            Recalculate is information, and a list that drops its empty states
            reshuffles itself every time work moves, so the option an operator
            reaches for is never in the same place twice. The one exception is
            the option currently SELECTED — disabling that would leave the
            control showing a value it refuses to offer.

            Order is `BOM_STATUS_RANK`, "what needs doing, first" — the same
            order the list itself is sorted in, and never by count. */}
        <FilterBar
          search={query}
          onSearch={setQuery}
          searchPlaceholder="Search RE No, PO or customer…"
          activeCount={statusFilter ? 1 : 0}
          onReset={statusFilter ? () => setStatusFilter("") : undefined}
          right={
            queueSummary ? (
              <>
                {queueSummary} · {filtered.length} of {tasks.length}
              </>
            ) : (
              `${filtered.length} of ${tasks.length}`
            )
          }
        >
          <div>
            <Label htmlFor="bom-status">Status</Label>
            <Select
              id="bom-status"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as "" | BomStatus)}
            >
              <option value="">All ({tasks.length})</option>
              {statusCounts.map((c) => (
                <option
                  key={c.status}
                  value={c.status}
                  disabled={c.count === 0 && c.status !== statusFilter}
                >
                  {bomStatusText(c.status)} ({c.count})
                </option>
              ))}
            </Select>
          </div>
        </FilterBar>

        <MobileCardList<BomTaskRow>
          /* SIX ACROSS (client 2026-08-19) — now as a card WIDTH rather than a
             count: `6` means 15rem tracks, and 6 × 15rem + 5 gaps = 1500px still
             fits the operator's 1560px pane, so a full queue lays out exactly as
             it did. What changes is a SHORT queue: three confirmed orders used
             to leave three of six tracks empty, and now take the width instead.
             The card sizes its own density from there — see `columns`. */
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
          /* THE SAME TONE AS THE PILL, AS A STRIPE DOWN THE CARD'S EDGE. The
             pill is read one card at a time; the stripe is read down the whole
             grid at once, and this list is already SORTED by `BOM_STATUS_RANK`
             — a sort nothing on screen could show. Redundant by design: colour
             locates the work, the word names it. */
          /* `tone` AND `hint` REMOVED — shared-tree artefacts, not a design
             change. Both belong to a 230-line in-progress rewrite of
             `MobileCardList` in the parallel session; HEAD's component accepts
             neither, so the deploy build failed type-check on them. They reached
             this commit because git stages whole files and that session's edits
             to THIS file are interleaved with mine. Put them back when their
             `mobile-card-list.tsx` lands. */
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

      {/*
        * THE COMBINATION POPUP (0463), rendered from the line it belongs to.
        *
        * Mounted only while a line is chosen, so a line deleted while the popup
        * was somehow open cannot leave a surface editing rows that no longer
        * have a parent.
        */}
      {comboLine && (
        <BomCombinationSheet
          open
          onClose={() => setComboLineKey(null)}
          /* LEGACY'S OWN HEADER, read-only — Category, Type, Item, Attribute and
             the line's figure. Blank rather than a dash wherever the line has
             not answered yet: a form field is not a table cell, and the
             de-clutter rule (2026-08-17) had the dash tried and rejected. */
          categoryLabel={
            accessoryCategories.find((c) => c.id === comboLine.category_id)?.name ?? ""
          }
          /* `MATERIAL_TYPE_OPTIONS` is a list of STRINGS, not `{value,label}`
             pairs — the stored value is the label. */
          typeLabel={comboLine.type ?? ""}
          itemLabel={itemName(comboLine.item_id)}
          /* The SAME derivation the Attribute cell renders, not a second one —
             `labelFor` reads the stored axis set, so a grain shown here can
             never disagree with the grain shown in the grid. */
          attributeLabel={
            comboLine.requirement_grain ? grainLabel(comboLine.requirement_grain) : ""
          }
          /* The line's own ratio, so the operator can see what the split
             refines. Blank halves stay blank — an unfinished line showing
             "0 / 0" would read as a rate it does not have. */
          lineRatio={
            comboLine.no_of_items || comboLine.per_pieces
              ? `${comboLine.no_of_items || "—"} / ${comboLine.per_pieces || "—"}`
              : ""
          }
          rows={comboLine.combinations}
          onChange={(next) => updItem(comboLine.key, { combinations: next })}
          newKey={newKey}
        />
      )}
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
