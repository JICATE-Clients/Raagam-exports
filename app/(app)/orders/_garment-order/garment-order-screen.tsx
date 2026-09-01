"use client";

import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
import {
  Trash2,
  Shirt,
  Palette,
  Layers,
  Banknote,
  Package,
  Hash,
  CheckCheck,
  CalendarClock,
  Truck,
  FileText,
  ClipboardList,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  ChildGrid,
  GRID_HEADER_TEXT,
  gridKeyNav,
  type ChildGridColumn,
} from "@/components/masters/child-grid";
import { Input } from "@/components/ui/input";
// PO No is `format="doc_ref"` — the kind declares the regex, the message AND
// the uppercase keystroke transform, so the screen and the server cannot
// disagree about any of the three. See the field.
import { ValidatedInput } from "@/components/ui/validated-input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Combobox } from "@/components/ui/combobox";
import { Sheet } from "@/components/ui/sheet";
import { SubSheetFooter } from "@/components/orders/sub-sheet-footer";
import {
  styleProcessRowStarted,
  type ComponentOption,
  type StyleProcessRow,
} from "@/lib/orders/amendments/style-processes";
/**
 * STYLE(S) ▸ PROCESS RESTORED (client 2026-08-20).
 *
 * It was withdrawn on 2026-08-17 "as these details are covered elsewhere", and
 * elsewhere was Order Setup ▸ Garment Process Plan. **That justification expired
 * the same day**: 08-17b took Garment Process Plan out of the flow ("only 7 are
 * needed"), so panel-wise printing, embroidery and wash had no entry point
 * inside order entry at all. The client's own account of the architecture is
 * that capturing them HERE is what let the setup collapse from nine steps to
 * six — the popup is not a duplicate of the planning screen, it is the reason
 * that screen stopped being a step.
 *
 * NOTHING HAD TO BE REBUILT, and that is down to the withdrawal being written
 * properly: the sheet was left in `components/orders/`, and `StyleRow.processes`,
 * its `toRows` mapping and the `style_processes` payload were all kept
 * round-tripping rather than dropped. Only the column, the pointer and the mount
 * came back.
 */
import { StyleProcessSheet } from "@/components/orders/style-process-sheet";
import {
  excessQty,
  projectionQty,
  totalProductionQty,
} from "@/lib/orders/amendments/approval-qty";
import { inrValue, isPackWise, orderValue } from "@/lib/orders/amendments/order-value";
/**
 * T&A (0481). Pure and client-safe on purpose — the `bom-ceiling.ts` split this
 * repo already uses — because the SERVER ACTION calls the same function to
 * compute the `target_date` it stores. Two implementations of a ladder is a
 * stored date no control enforces.
 *
 * `isRefusal` comes from here rather than from `lib/orders/material-bom/
 * requirement.ts` even though that is where it is defined: `order-ladder.ts`
 * re-exports it beside the type it guards, exactly as `lib/ta/schedule.ts` does,
 * so a caller cannot end up importing the refusal from one module and its guard
 * from another and then be surprised when the two are asked to diverge.
 */
import { isRefusal, orderTaLadder } from "@/lib/orders/ta/order-ladder";
import { Textarea } from "@/components/ui/textarea";
import { Toggle } from "@/components/ui/toggle";
import { Segmented } from "@/components/ui/segmented";
import type { FieldWidth } from "@/lib/ui/sizes";
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
  type MasterFullScreenHandle,
} from "@/components/masters/master-full-screen";
import { sectionValidity, type Problem } from "@/lib/screens/validity";
// The two flags a field the APP fills in has to carry, derived from one boolean
// so a bypassed field can never also hold the cursor. See the note there.
import { autoFilledField } from "@/lib/focus";
import { Field, FieldGrid, FieldRow, FIELD_SPAN, RequiredScope } from "@/components/ui/field";
import { MultiSelect } from "@/components/ui/multi-select";
// `sortBySize` / `sizeFamily`: the Style master orders and bands its Sizes
// dropdown with these, and Order Info now draws the same control — a second
// ordering would put S/M/L in one order on one screen and another elsewhere.
import { sizeFamily, sortBySize } from "@/lib/masters/size-order";
import { capsName } from "@/lib/validation/formats";
import { Truncated } from "@/components/ui/truncated";
import { PriceMatrix } from "@/components/orders/price-matrix";
import { adoptedPrice, reshapeRates } from "@/lib/orders/amendments/price-modes";
import { ApprovalQtyLines } from "@/components/orders/approval-qty-lines";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { SectionGrid } from "@/components/masters/section-grid";
import { useToast } from "@/components/ui/toast";
import { FileAttachments, type AttachmentRow } from "@/components/ui/file-attachments";
import { SketchThumbnail } from "@/components/ui/sketch-thumbnail";
import { PageHeader } from "@/components/ui/page-header";
import { fmtDate, fmtMoney, fmtNumber } from "@/lib/format";
import { addDays } from "@/lib/calendar";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { useCreateIntent } from "@/lib/use-create-intent";
import { isInactive } from "@/lib/masters/inactive";
// The Style master's own rules, imported rather than re-derived: Order Info now
// writes the same two children that screen does (0457), and a second copy of
// either question is how `comp_type` came to have four wrong readings.
import {
  coordinatesFull,
  coordinatesLocked,
  componentRowStarted,
  componentsTakenUnder,
  styleLineProblems,
  styleLineStarted,
  duplicateRefCounts,
  type StyleLineField,
  componentTypeForCategory,
  filledCoordinates,
  impliedCoordinateId,
  isUnitKind,
  unitKindFromCoordinates,
  UNIT_KIND_OPTIONS,
} from "@/lib/orders/styles/rules";
import { componentsForCoordinate } from "@/lib/masters/component-coordinates";
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
  structureRequiredCells,
  componentProblems,
  // FABRIC_TYPE_OPTIONS is deliberately NOT imported any more — the only control
  // that offered it was the withdrawn "Type" field (see the structure card). The
  // constant stays in combo-rules.ts: `fabric_type` is still stored, still copied
  // by `order-seed.ts` and still reported by `diff.ts`, so the vocabulary is
  // still the definition of what those values mean.
  ITEM_SUB_TYPE_OPTIONS,
  asItemSubType,
  declaredColoursFor,
  /* `colourSourceFor` IS NO LONGER IMPORTED, and that is the point of 0478's UI
     half rather than a tidy-up. It answers "which declared colours may this
     fabric take", and Yarn Dyed's answer is now "none, and the cell is still
     required" — a state that function cannot express. Every consumer here asks
     `componentColourEntry` instead, which is the SAME single decision the star,
     the hold and `componentProblems` all read. Re-importing it to re-test
     `!== null` beside them is exactly the drift combo-rules.ts documents.
     `takesAllOverPrint` is not imported because it no longer exists — see
     `declaredPrintOptions`. */
  componentColourEntry,
  /* Yarn Dyed (0480): which colours the cloth is knitted FROM, offered from this
     order's own colourways and scoped to the combo's style. */
  yarnColourOptions,
  /* The ±5 prefill and the one question that tells a prefill from an answer.
     `toleranceStated`, never `.trim()`, in all three places named in its doc. */
  DEFAULT_GSM_TOLERANCE,
  toleranceStated,
  compositionForStructure,
  /* Multi-combo fabric anchoring (2026-08-29) — the first FILLED colourway is
     what every later one copies its Composition / GSM / Tolerance / Fabric Type
     from, matched per fabric category. */
  fabricAnchorDefaults,
  withFabricDefaults,
} from "@/lib/orders/amendments/combo-rules";
import {
  approvalKey,
  buildApprovalTree,
  flattenApprovalTree,
} from "@/lib/orders/amendments/approval-tree";
import { PaymentTermPicker } from "@/components/masters/payment-term-picker";
import {
  createAmendment,
  updateAmendment,
  deleteAmendment,
  loadOrderSeed,
} from "@/lib/orders/amendments/actions";
import type {
  FabricTypeCounts,
  SeededAmendmentChildren,
} from "@/lib/orders/amendments/order-seed";
// From `style-key.ts`, NOT from `order-seed.ts` — that module is `server-only`
// and this is a client component. Same function either way; 0407's note in
// `style-key.ts` says why it was split out rather than copied.
import { styleKey } from "@/lib/orders/amendments/style-key";
/* THE QUANTITY ARITHMETIC, SHARED WITH THE SERVER ACTION. The helpers below
   delegate to these rather than restating them — the double lock refuses in the
   browser and in `actions.ts`, and two implementations of one rule is how the
   amber cell line and the dead Save disagreed for an afternoon in August. */
import {
  ratioTotal,
  ratioScope,
  inners,
  packFactor,
  lineQty,
  pieceLines,
  assortTotal,
  assortBalance,
  assortBalanceMessage as balanceMessage,
  crossTabPoQtyMessage,
} from "@/lib/orders/amendments/qty-balance";
import * as AssortStyle from "@/lib/orders/amendments/assort-style";
import * as PackExplode from "@/lib/orders/amendments/pack-type-explosion";
import { PackCompositionSheet } from "@/components/orders/pack-composition-sheet";
import {
  piecesPerPack as packPieces,
  derivedPoQty as packDerivedQty,
  packRowStarted,
  type PackComponentRow,
} from "@/lib/orders/amendments/pack-composition";
import {
  /* `PRICE_TYPE_OPTIONS` WENT THE SAME WAY ON 2026-08-29, and for a reason
     worth keeping: it was the `else` of `priceModeOptions` — "no pack type, so
     offer everything" — and the client has replaced that with Style-wise alone
     (`NO_PACK_PRICE_MODES`). Both branches are now narrow, so the full tuple is
     no longer a MENU anywhere; it is the vocabulary `price_type` may hold. A
     file importing it again is a file about to re-open a list the client closed. */
  /* `PACK_WISE_PRICE` WENT WITH THE MODE-NAME TESTS (2026-08-28). The grid's
     shape is `priceAxes(mode).size` and its unit is `isPackWise(mode)`, so the
     one literal this file compared against has no reader left — which is the
     point: a third mode arriving needed no edit at either site. */
  PACK_WISE_SIZE_PRICE,
  PACK_BRANCH_PRICE_MODES,
  /* What the Prices tab offers with NO pack type — Style-wise alone since
     2026-08-29. The pack branch above is unchanged. */
  NO_PACK_PRICE_MODES,
  isPackBranchMode,
  SEASON_OPTIONS,
  dyeTypeOptions,
  SHIP_MODES,
  PAY_MODES,
  amendmentStatusTone,
  amendmentStatusText,
  collapseCaseDuplicates,
  merchandiserOptions,
  /* "EVERY STYLE CARRIES A DOCUMENT", AND THE SERVER READS THE SAME TWO
     FUNCTIONS (0479). `styleFileProblem` in actions.ts calls these on the
     NORMALIZED rows; the screen calls them on state. One predicate and one
     sentence, so a live Save button and the action behind it cannot disagree —
     which is the failure the shape exists to prevent, and it is nasty in both
     directions: a server stricter than the screen is a Save that looks enabled
     and fails, a server looser is no rule at all. */
  stylesMissingFiles,
  styleFileMessage,
  orderUnitLabel,
  type GarmentOrderAmendment,
} from "@/lib/orders/amendments/types";
// `StylePickerRow` left this import on 2026-08-25 with the Style picker itself —
// the type describes a master row, and nothing on this screen holds one now.
import type {
  AmendmentFormData,
  PickerRow,
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
  /** The RE No this order WOULD get, resolved on the server so the box is
   *  filled on first paint rather than a round trip later. See the loader. */
  initialOrderNo?: string | null;
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
/** Order Info ▸ Styles Details ▸ one COORDINATE of the style line (0461).
 *  A component is a part of one of these, which is what makes this list the
 *  scope for the Components grid's Coordinate cell. */
type StyleCoordRow = { key: string; coordinate_id: string | null };

/* The pack member row and its arithmetic live in
   `lib/orders/amendments/pack-composition.ts` — a pure module so the explosion
   can carry vectors, and so the sheet and this screen cannot drift on what a
   duplicate member is. */
/**
 * Order Info ▸ Styles Details ▸ one COMPONENT of the style line (0457).
 *
 * THE STYLE MASTER'S OTHER CHILD, MERGED INTO ORDER ENTRY (client 2026-08-23:
 * "we can style as separate child now but we need to merge it with order entry
 * … component and size also will come inside that order info"). Sizes were
 * already a cell of this row; this is the half that had nowhere to live.
 *
 * The three cells are the Style master's three visible cells and no more —
 * Coordinate, Component, Structure. `comp_type` and `item_id` are carried
 * without a cell, exactly as the master carries them: `writeChildren` rewrites
 * this grid wholesale, so a field the row cannot hold is a value the first save
 * NULLS rather than freezes.
 */
type StyleComponentRow = {
  key: string;
  coordinate_id: string | null;
  component_id: string | null;
  fabric_category_id: string | null;
  /** Derived from the Structure cell, never typed. Stored, not shown. */
  comp_type: string;
  /** "Fabric" — withdrawn as a cell on the master 2026-08-11. Stored, not shown. */
  item_id: string | null;
};
type StyleRow = {
  key: string;
  style_ref_no: string;
  style_id: string | null;
  /**
   * THE STYLE MASTER'S HEADER FIELDS, ON THE LINE (0461, client 2026-08-23).
   * `pickStyle` seeds them and the operator may then differ from the style —
   * a re-run against a new season, or a different approved sample — without
   * editing a master every other order also points at.
   */
  approved_sample_id: string | null;
  article_no: string;
  /** The category NAME. A display cache — `style_category_id` is the row, and
   *  both are written from the picker's one event so they cannot disagree. */
  style_category: string;
  style_category_id: string | null;
  style_description: string;
  order_unit_id: string | null;
  plan_unit_id: string | null;
  /** ORDER UNIT - 'piece' (shown PCS) or 'set' (SET), typed by the operator (0471). */
  unit_kind: string | null;
  /** PIECES, always — see `packs_ordered`. */
  po_qty: string;
  /**
   * PACKS the buyer ordered (0467), when the order is a retail SET pack.
   *
   * STRING, like every other numeric box on this screen, because a number
   * cannot represent a just-cleared field — and here that matters more than
   * usual: blank means "not a set pack" and 0 means "no packs ordered".
   */
  packs_ordered: string;
  description: string;
  /** The pack's members, when this style is sold as a set (0467). */
  pack_components: PackComponentRow[];
  /** The style's size set, listed under the row. Order IS the data. */
  sizes: SizeRow[];
  /** What its components are parts OF (0461), nested for the same reason. */
  coordinates: StyleCoordRow[];
  /**
   * The style's component list (0457), nested for the same reason `sizes` is:
   * a part cannot outlive the line it belongs to, and the payload key is the
   * flat `style_components` because `writeChildren` reinserts `..._styles`
   * wholesale and an id would dangle.
   */
  components: StyleComponentRow[];
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
/**
 * Color/Print ▸ one Fabric Print the ORDER declares.
 *
 * TWO FIELDS FOR ONE ANSWER, exactly as `DyeingRow` carries `color_id` beside
 * `color_name` (0477). `print_name` is THE VALUE — filled whether the operator
 * picked from the `roll_form_print` master or typed a name of their own;
 * `print_id` is set only in the first case, and is what keeps
 * `declaredPrintOptions` able to narrow the Combos tab's list to this order.
 */
type PrintRow = { key: string; print_id: string | null; print_name: string };
/**
 * Color/Print ▸ one fabric structure of the ORDER (0415).
 *
 * `structure_id` is a fabric CATEGORY — the same value
 * `garment_style_components.fabric_category_id` holds, which is what lets this
 * grid be SEEDED from the order's own style lines instead of retyped.
 * `item_sub_type` is Solid / Melange / Yarn Dyed, and it is what the combo
 * structure below inherits when the same fabric is picked there. `Printed` was
 * the fourth until 2026-08-31, when the client withdrew it — "an aesthetic
 * processing step, not a base fabric type". The vocabulary is
 * `ITEM_SUB_TYPE_OPTIONS` and nothing here restates it.
 */
type StructureRow = {
  key: string;
  structure_id: string | null;
  item_sub_type: string;
};
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
/**
 * WHAT A FOLDED FABRIC SAYS ITS PARTS LOOK LIKE — read-only, never written back.
 *
 * This was `commonAesthetic`, and it did two jobs: it fed a fabric-level control
 * AND it summarised. The control is gone (client 2026-08-20 — the aesthetic
 * belongs to the part), so only the summary survives, and losing the other job is
 * what makes the shape safe: nothing here can unify parts that differ, because
 * nothing here writes.
 *
 * THREE STATES, NOT TWO, and that is the whole point of the rewrite. The old
 * version collapsed "they disagree" and "there are no parts" into the same empty
 * string, which was right for a control that must start blank and wrong for a
 * line of text: a fabric whose sleeves are GREEN and body WHITE must not read as
 * a fabric with no colour answered. `mixed` is that third state.
 *
 * THE `mixed` FLAG IS PER AXIS SINCE 2026-08-31, and the single OR it replaces
 * was not merely coarse — it became wrong when the caller stopped choosing
 * between the two.
 *
 * It returned one `mixed: colour.mixed || print.mixed` because the folded line
 * showed one of the two: `takesAllOverPrint` picked the print, everything else
 * picked the colour, so whichever flag was asked about was the one that mattered
 * and the OR could never mislead. `takesAllOverPrint` is gone (client
 * 2026-08-31, and see `declaredPrintOptions`), so the folded line now shows BOTH
 * — and a combined flag would say "mixed" over a fabric whose every part is
 * WHITE merely because one of them carries a print. That is the same failure
 * this doc block already records one paragraph up, arriving on the other axis:
 * an answered value rendered as if nobody had answered.
 */
function aestheticSummary(
  cs: readonly { color_name?: string | null; print_id?: string | null }[],
): {
  colour: { value: string | null; mixed: boolean };
  print: { value: string | null; mixed: boolean };
} {
  const one = <T,>(xs: readonly T[]): { value: T | null; mixed: boolean } =>
    xs.length === 0
      ? { value: null, mixed: false }
      : { value: xs[0], mixed: !xs.every((x) => x === xs[0]) };

  const colour = one(cs.map((c) => (c.color_name ?? "").trim().toUpperCase()));
  const print = one(cs.map((c) => c.print_id ?? null));
  return {
    // `|| null` on the colour only: "" is what an unanswered text cell holds and
    // must read as nothing, while a print is a uuid or already null.
    colour: { value: colour.value || null, mixed: colour.mixed },
    print,
  };
}

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
   * "Composition" — A ROW OF THE COMPOSITION MASTER (0434).
   *
   * It has been three columns: the master (0408), the FABRIC MATERIAL that
   * declares the blend (0430), and the master again. The last move is not a
   * revert of the one before it — 0430 left the master because a composition
   * could only be TYPED, and `compositionForStructure` now FETCHES one, by
   * reducing the structure's sole fabric to yarn categories and finding the
   * master row stating that blend. Both asks hold at once.
   */
  composition_id: string | null;
  gsm: string;
  gsm_tolerance: string;
  item_sub_type: string;
  /**
   * "Yarn Color" — WHICH PRE-DYED YARNS THIS CLOTH IS KNITTED FROM (0480,
   * client 2026-08-31). The migration was WRITTEN as 0478 and renumbered when
   * two other files claimed that number the same day, so a comment elsewhere
   * naming 0478 for this column means this one; its header records the swap.
   *
   * A yarn-dyed fabric is knitted from yarns that were dyed BEFORE knitting, so
   * a stripe or a check is several colours in one piece of cloth. That is a
   * property of the CLOTH, which is why it sits on the structure and not on the
   * part — and it is what makes the part's own Colour cell manual-entry text
   * ("WHITE/BLUE STRIPE"): the finished panel has no single colour to pick.
   *
   * NAMES, NOT IDS. The column is `text[]` and the values are the order's own
   * combo names, which is what `yarnColourOptions` offers — the same call
   * `color_name` beside it makes, and for the same reason: a colourway is not a
   * master row here, it is a word the operator typed on the Combos grid.
   *
   * ALWAYS AN ARRAY, NEVER NULL, on this side. 0478's column is
   * `not null default '{}'` and `toRows` coalesces, so nothing on the screen has
   * to test for null before reading `.length` — the same treatment `components`
   * gets one field down.
   */
  yarn_colors: string[];
  /**
   * NO AESTHETIC OF ITS OWN — it belongs to the PART (client 2026-08-20).
   *
   * A structure briefly carried `color_name` / `print_id` as UI state, read up
   * from its parts on load and written back down to all of them on edit. The
   * argument was that a print and a dye are properties of the CLOTH, so asking
   * per part could only repeat itself. The client rejected it twice (screenshots
   * 2403 · 2407) — parts of one fabric genuinely differ, and a single field
   * cannot say so.
   *
   * THE COLUMNS NEVER MOVED THROUGHOUT. `combo_components.color_name` /
   * `print_id` have always been where the value lives, which is why both the
   * roll-up and this reversal were UI-only and no order had to migrate either
   * way. `aestheticSummary` still reads them UP, but only to write a line of
   * text on a folded row — never back into state.
   */
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
/**
 * Pack type(s) ▸ one line of what a method PACKS (0472, client 2026-08-27,
 * screenshot 2518).
 *
 * NESTED ON SCREEN, FLAT IN THE PAYLOAD — the rule `style_sizes` states one
 * grid across: nested so a line cannot outlive the method it describes, flat on
 * the way out because that is how the table stores it, with `pack_type` text
 * carrying the binding across.
 *
 * `qty` IS A STRING like every other numeric box on this screen: a number
 * cannot represent a just-cleared field.
 */
type PackTypeLineRow = {
  key: string;
  style_ref_no: string;
  combo: string;
  qty: string;
};

type PackTypeRow = { key: string; pack_type: string; lines: PackTypeLineRow[] };
/**
 * T&A ▸ one activity of the order's Time & Action ladder (0481).
 *
 * FOUR COLUMNS ON SCREEN AND TWO FIELDS IN THIS SHAPE, which is the whole point
 * of the tab: Target Date and Dept are DERIVED and are therefore not here.
 * Target Date comes out of `orderTaLadder()` on every keystroke and Dept is read
 * THROUGH `activity_id` off `ta_activities.department` — copying either onto the
 * row would be a second answer that goes stale the moment the master is edited
 * or a Days figure changes. `AmendmentTaActivity`'s own note makes the same call
 * one layer down.
 *
 * ## `row_uid` IS NOT `key`, AND THE TWO ARE NOT INTERCHANGEABLE
 *
 * `key` is React's identity — a `k7` from `newKey()`, minted per row per mount,
 * meaningless the moment the screen unmounts. `row_uid` is the DATA's identity:
 * a uuid minted once with `crypto.randomUUID()` and round-tripped through every
 * save, because `writeChildren` deletes every child row and reinserts, so `id`
 * is re-minted and cannot carry anything across.
 *
 * What it carries is the half of this table the operator never types here.
 * `actual_date`, `status` and `notes` are entered on the DASHBOARD, days or
 * weeks later — so an operator reopening the order to fix a typo in Pay Terms
 * and pressing Save would destroy every completion record on it, silently, with
 * no error. `normalizeTaActivities` in `actions.ts` merges them back across by
 * `row_uid`; this field is the only thing it has to match on. Same anchor
 * `material_bom_amendment_processes.row_uid` uses (0446 · 0459) and for exactly
 * the same reason. AGENTS.md and the `raagam-material-attribute-edit-orphans`
 * memory record what it costs when a grid has no anchor: "12/12 lines + 10
 * answers destroyed and unrecoverable".
 *
 * So: NEVER regenerate `row_uid` for a row read back from the database, and
 * never fall back to `key` when one is missing — a fresh uuid matches nothing,
 * which is the silent-loss case wearing a value.
 */
type TaRow = {
  key: string;
  row_uid: string;
  activity_id: string | null;
  /** A string: it is typed. `numOrNull` narrows it for the ladder and the payload. */
  days_required: string;
};
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
  /**
   * Which style this line packs (0433) — "" on a Single Style pack, where the
   * line inherits the destination's own Ref No. Held as TEXT and joined with
   * `styleKey`, like every other cross-tab style reference in this module.
   */
  style_ref_no: string;
  combo: string;
  no_of_cartons: string;
  /** Ratio bundles per carton (0432) — asked only on a Solid / Assort line. */
  inners_per_carton: string;
  /**
   * THIS LINE'S SIZE CELLS ARE BOXES (0473) — the one typed line of a packed
   * destination. Every colourway line beneath it is DERIVED from it and the
   * pack type's composition, and is read-only on screen.
   */
  is_pack_row: boolean;
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
  /** Which packing method this destination ships (0473). */
  pack_type: string;
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
  /**
   * The SIZE (0435). The tab is a Style ▸ Combo ▸ Size tree now, and this is the
   * leaf. NULL on a row seeded from a legacy order, which has no size axis.
   */
  size_id: string | null;
  /**
   * Pieces of this style + combo + size.
   *
   * DERIVED SINCE 0435 — it was typed from 0413 until the client pointed out
   * that the order had already stated it (screenshot 2372: "the table are
   * pulling data from previous section not manual entry"). It comes from the
   * Quantities assortment tree, the same flattening the Prices tab weights a
   * Colour-wise rate by. Still a string because the grid's cell is an `<Input>`
   * and every other quantity on this screen is one.
   */
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
  /* THE COORDINATES (0461), regrouped exactly as the sizes above are, and for
     the same reasons: `styleKey` rather than `===` (rows saved before the
     CAPITALS rule are not upper-cased), and a coordinate whose style is no
     longer on the document is DROPPED rather than shown loose. */
  const coordsByStyle = new Map<string, StyleCoordRow[]>();
  for (const x of src.styleCoordinates ?? []) {
    const k = styleKey(x.style_ref_no);
    const list = coordsByStyle.get(k);
    const row: StyleCoordRow = { key: newKey(), coordinate_id: x.coordinate_id };
    if (list) list.push(row);
    else coordsByStyle.set(k, [row]);
  }
  /* THE PACK MEMBERS (0467), regrouped exactly as the coordinates above are,
     and dropped the same way when their style has left the document. */
  const packCompsByStyle = new Map<string, PackComponentRow[]>();
  for (const x of src.packComponents ?? []) {
    const k = styleKey(x.style_ref_no);
    const list = packCompsByStyle.get(k);
    const row: PackComponentRow = {
      key: newKey(),
      coordinate_id: x.coordinate_id,
      combo: x.combo ?? "",
      qty_per_pack: x.qty_per_pack == null ? "" : String(x.qty_per_pack),
    };
    if (list) list.push(row);
    else packCompsByStyle.set(k, [row]);
  }
  /* THE COMPONENTS (0457), regrouped exactly as the sizes above are.

     Same key, same comparison and the same drop rule: `styleKey` rather than
     `===`, because rows saved before the CAPITALS rule are not upper-cased in
     the database and a case-sensitive match would silently lose every part of
     an older order. A component whose style is no longer on the document has
     nowhere to render; the normalizer cannot have written one. */
  const componentsByStyle = new Map<string, StyleComponentRow[]>();
  for (const x of src.styleComponents ?? []) {
    const k = styleKey(x.style_ref_no);
    const list = componentsByStyle.get(k);
    const row: StyleComponentRow = {
      key: newKey(),
      coordinate_id: x.coordinate_id,
      component_id: x.component_id,
      fabric_category_id: x.fabric_category_id,
      comp_type: txt(x.comp_type),
      item_id: x.item_id,
    };
    if (list) list.push(row);
    else componentsByStyle.set(k, [row]);
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
  const styleCols = (x: {
    style_ref_no: string | null;
    style: string | null;
    article_no: string | null;
  }) => ({
    style_ref_no: txt(x.style_ref_no),
    style: txt(x.style),
    article_no: txt(x.article_no),
  });

  return {
    styles: src.styles.map((x): StyleRow => ({
      key: newKey(),
      style_ref_no: txt(x.style_ref_no),
      style_id: x.style_id,
      approved_sample_id: x.approved_sample_id,
      article_no: txt(x.article_no),
      style_category: txt(x.style_category),
      style_category_id: x.style_category_id,
      style_description: txt(x.style_description),
      order_unit_id: x.order_unit_id,
      plan_unit_id: x.plan_unit_id,
      unit_kind: x.unit_kind ?? null,
      po_qty: num(x.po_qty),
      packs_ordered: x.packs_ordered == null ? "" : String(x.packs_ordered),
      description: txt(x.description),
      sizes: sizesByStyle.get(styleKey(x.style_ref_no)) ?? [],
      coordinates: coordsByStyle.get(styleKey(x.style_ref_no)) ?? [],
      pack_components: packCompsByStyle.get(styleKey(x.style_ref_no)) ?? [],
      components: componentsByStyle.get(styleKey(x.style_ref_no)) ?? [],
      processes: processesByStyle.get(styleKey(x.style_ref_no)) ?? [],
    })),
    dyeings: src.dyeings.map((x): DyeingRow => ({
      key: newKey(),
      section: x.section,
      dye_type: txt(x.dye_type),
      color_name: txt(x.color_name),
      color_id: x.color_id,
    })),
    prints: src.prints.map((x): PrintRow => ({
      key: newKey(),
      print_id: x.print_id,
      /* `txt`, like every other loaded text field: null and "" are the same
         state on screen and only one of them is typeable. */
      print_name: txt(x.print_name),
    })),
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
        /* NO ±5 DEFAULT ON LOAD, and this is the one of the four
           `gsm_tolerance` sites that deliberately does NOT change (2026-08-31).
           `blankStruct` prefills a NEW fabric; a stored value — INCLUDING a
           stored blank — is what the operator said about this fabric, and
           re-defaulting it here would rewrite history and mark an untouched
           amendment dirty the moment it opened. `DEFAULT_GSM_TOLERANCE` is a
           prefill, never a migration. */
        gsm_tolerance: num(st.gsm_tolerance),
        item_sub_type: txt(st.item_sub_type),
        /* `?? []` — 0480's column is `not null default '{}'`, but the interface
           types it `string[] | null` on purpose (see `AmendmentComboStructure`:
           a payload that stops carrying it must be visibly absent rather than
           silently empty), and a row written before the column existed reads
           back null through any older cache. The screen holds an array always. */
        yarn_colors: st.yarn_colors ?? [],
        // No aesthetic read up any more — each part carries its own, below.
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
      size_id: x.size_id ?? null,
      qty: num(x.qty),
      approval_qty: num(x.approval_qty),
    })),
    // `?? []` like `quantities` below: the seed from an order never carries
    // pack types (nothing on the order side records a packing method), so the
    // key is genuinely absent on that path rather than an empty array.
    packTypes: (src.packTypes ?? []).map((x): PackTypeRow => ({
      key: newKey(),
      pack_type: txt(x.pack_type),
      /* RE-NESTED BY THE TEXT KEY (0472). The service returns the lines as a
         flat sibling because PostgREST can only embed across a real FK, and
         this is the same re-nesting `styleSizes` does two mappings above.
         Case-INSENSITIVE, matching `normalizePackTypeLines` on the server: the
         method is stored with one spelling and a line typed under another must
         still find its parent, or the grid opens empty on a document that
         saved perfectly well. */
      lines: (src.packTypeLines ?? [])
        .filter(
          (l) =>
            (l.pack_type ?? "").trim().toUpperCase() ===
            (x.pack_type ?? "").trim().toUpperCase(),
        )
        .map((l): PackTypeLineRow => ({
          key: newKey(),
          style_ref_no: txt(l.style_ref_no),
          combo: txt(l.combo),
          qty: l.qty == null ? "" : String(l.qty),
        })),
    })),
    quantities: (src.quantities ?? []).map((x): QuantityRow => ({
      key: newKey(),
      country_id: x.country_id ?? null,
      style_ref_no: txt(x.style_ref_no),
      style_no: txt(x.style_no),
      consignee_id: x.consignee_id ?? null,
      assortment_type_id: x.assortment_type_id ?? null,
      pack_type: txt(x.pack_type),
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
      /* `?? defaultSingleStylePack`, NOT `?? false` (client 2026-08-20,
         screenshot 2422). A record saved before 0433 added the column reads
         NULL here, and `false` landed every one of them on Multiple Style —
         whose branch seeds no lines, so the overlay opened with size columns, a
         TOTAL of 0 and nothing to type into.
         Safe in both directions: with ONE declared style, Single is the only
         reading that can be right; with several, the old `false` is preserved,
         because there is genuinely no way to tell which the destination packs.
         A STORED true/false still wins — this answers only its absence. */
      is_single_style_pack:
        x.is_single_style_pack ?? AssortStyle.defaultSingleStylePack(src.styles),
      master_carton_name: txt(x.master_carton_name),
      inner_carton_name: txt(x.inner_carton_name),
      pack_description: txt(x.pack_description),
      assort_lines: (x.assort_lines ?? []).map((l): AssortLineRow => ({
        key: newKey(),
        style_ref_no: txt(l.style_ref_no),
        combo: txt(l.combo),
        no_of_cartons: num(l.no_of_cartons),
        inners_per_carton: num(l.inners_per_carton),
        /* `?? false` for the rows written before 0473: every one of them is a
           PIECES line, which is the reading that cannot rewrite a stored
           quantity. */
        is_pack_row: l.is_pack_row ?? false,
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
    /**
     * T&A (0481). Always empty from an ORDER — a `sales_order` records no
     * schedule of its own — and here for the reason `packTypes` and `styleSizes`
     * are: `applyRows` maps a SAVED document through this same shape, and
     * without an entry the tab would be the one grid whose stored rows had no
     * way back onto the screen.
     *
     * ## `row_uid` IS TAKEN VERBATIM AND NOTHING ELSE WILL DO
     *
     * Not re-minted, not defaulted to `key`, not coalesced to a fresh uuid. It
     * is the only column that survives `writeChildren`'s delete-and-reinsert, so
     * it is what `normalizeTaActivities` matches a saved `actual_date` /
     * `status` / `notes` back onto — values entered on the DASHBOARD days after
     * this order was saved, by somebody else. A new uuid here matches nothing,
     * and the merge then drops every completion recorded against the order with
     * no error and nothing on screen to say so. That is the failure AGENTS.md
     * and the `raagam-material-attribute-edit-orphans` memory both record
     * ("12/12 lines + 10 answers destroyed and unrecoverable"); `row_uid` is the
     * whole defence and this line is where it either survives or does not.
     *
     * `num()`, so a stored `days_required` of 0 reads as "" — which is the same
     * call every other numeric cell on this screen makes, and the right one
     * here: a 0-day step is refused by `backwardSchedule` anyway ("NULL IS NOT
     * ZERO"), so showing an empty box the operator must answer is honest, while
     * showing "0" would look like a lead time somebody chose.
     */
    taActivities: (src.taActivities ?? []).map((x): TaRow => ({
      key: newKey(),
      row_uid: x.row_uid,
      activity_id: x.activity_id,
      days_required: num(x.days_required),
    })),
  };
}

/**
 * SET PACK IS OFF THE SCREEN, AND THE QUESTION IT ASKS IS BEING REOPENED
 * (client 2026-08-27, three flips in one day: hide it, enable it again, then
 * "without the set pack toggle it needs to work without any issue — the Pack
 * is separate, I will [do] this logic next").
 *
 * SO THIS IS A PAUSE, NOT A RETIREMENT, and the reason is worth writing down
 * because it is not the one the first hide recorded. `pack_components` was
 * found to be `style_coordinates` PLUS `combo` and `qty_per_pack` — same
 * grain, same FK, same picker, and the sheet even SCOPES its coordinate list to
 * the style's own coordinates. On a Set style the two are the same list: the
 * operator names TOP and BOTTOM on the row, then names TOP x 1 and BOTTOM x 1
 * again in the sheet. Whether the pack keeps its own list (it must, to carry a
 * per-member colour) or folds into the coordinates grid is the client's call,
 * and it is theirs to make next.
 *
 * NOTHING IS DELETED WHILE THAT IS OPEN. `is_set_pack`, `packs_ordered` and
 * `garment_order_amendment_pack_components` stay in the schema (0467), the
 * explosion stays in `pack-composition.ts` with its vectors, and every consumer
 * on this screen asks `form.is_set_pack` before it renders — so with the
 * switch gone the flag stays false and the Packs column, the Pack Composition
 * button, the Pack-wise price mode and `packProblems` all stand down on their
 * own. Three flips have now cost one line each, which is the evidence that the
 * gate is worth more than the tidiness of removing it.
 *
 * `pack` IS UNAFFECTED AND ALWAYS WAS. It means CARTON SORTATION and gates the
 * Pack type(s) section; it is not a second name for this switch, and folding
 * one into the other would make PO Qty read-only on an ordinary loose-garment
 * order that merely declares how its cartons are sorted.
 *
 * TO BRING IT BACK: flip this to `true`.
 */
const SET_PACK_ON_SCREEN = false;

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
  /** Retail SET packaging (0467) — independent of `pack`, which is cartons. */
  is_set_pack: boolean;
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
  is_set_pack: false,
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

/**
 * TODAY, IN THE OPERATOR'S OWN CALENDAR — `YYYY-MM-DD`, the shape an
 * `<input type="date">` reads and writes.
 *
 * LOCAL, NOT UTC, AND THAT CHANGED ON 2026-08-29. It was
 * `new Date().toISOString().slice(0, 10)`, which is the UTC day — and this
 * business runs at UTC+5:30, so between midnight and 05:30 IST that string is
 * YESTERDAY. It only ever seeded a default before, so the cost was an operator
 * working late correcting one field.
 *
 * Capping the Date field at today (below) is what makes it load-bearing: a UTC
 * ceiling would REFUSE the operator's own today for the first five and a half
 * hours of every day, and the field they were refused would be showing the very
 * date the box would not accept. A guard that fires on correct input is worse
 * than no guard.
 *
 * Built from the local parts rather than by shifting the timestamp, because a
 * shift re-introduces the same question one layer down and gets it wrong across
 * a DST boundary. `lib/dashboard/range.ts` keeps its own `today()`: that one is
 * compared against `date` columns in queries and is deliberately not touched
 * here (AGENTS.md, "Dates").
 */
const today = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
const numOrNull = (v: string) => (v.trim() ? Number(v) : null);

/**
 * THE DAY BEFORE A DELIVERY DATE — the Earlier Shipment Dt default (client
 * 2026-08-31: "the Earlier Shipment Dt must automatically calculate and default
 * to exactly one day prior (D-1) to the fetched Delivery Date").
 *
 * It is a SAFETY MARGIN, not a derived value: the cargo has to be cleared and
 * ready the day before it is due. So this seeds the field and never owns it —
 * an operator who needs D-2 or D-3 types it and keeps it (see
 * `followsDelivery` at the two call sites).
 *
 * ## `addDays`, NOT `new Date(iso).setDate(d - 1)`
 *
 * `lib/calendar.ts` treats `Date.UTC` as a CALENDAR rather than an instant, and
 * that is the whole reason to borrow it here. The obvious hand-rolled version —
 * `new Date("2026-10-10")` then `getDate()` — parses as midnight UTC and reads
 * back through LOCAL accessors, so on a UTC+5:30 machine the 10th is still the
 * 10th but on any machine west of UTC it is already the 9th, and D-1 quietly
 * becomes D-2. Same trap `dayOfWeek` in that file records against `getDay`, and
 * the same one this screen's own `today()` above was built from local parts to
 * avoid. This screen does not get a third copy of that reasoning.
 *
 * ## IT GUARDS THE INPUT, because `addDays` does not
 *
 * `addDays("", -1)` reaches `new Date(NaN).toISOString()`, which THROWS a
 * RangeError rather than returning anything. A blank Delivery Dt is the normal
 * state of a new row, and a date input can also hold a partial value mid-typing,
 * so the guard is not defensive padding — it is the common case. A value that is
 * not a full YYYY-MM-DD produces "", which is what an unanswered field holds.
 */
const dayBefore = (iso: string): string =>
  /^\d{4}-\d{2}-\d{2}$/.test(iso) ? addDays(iso, -1) : "";

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

/**
 * A STYLE FIELD'S WIDTH, KEYED BY ITS HEADER.
 *
 * The row left the 14-column track on 2026-08-26 for the reason the Order Info
 * header did (see the note there): every cell was `xs`, `xs` means "2-4 chars",
 * and on a fractional track that resolved to one seventh of the line for a
 * three-letter Uom and for a style name alike.
 *
 * KEYED BY HEADER, NOT BY INDEX, and not added to `ChildGridColumn` — the
 * column array is deliberately re-orderable (its own note says every consumer
 * resolves by `header` precisely so it can be re-sequenced without a hunt), and
 * `ChildGridColumn` is shared with ~20 other screens that have no `FieldRow`.
 * A missing header falls back to `code`, which is the commonest of the seven.
 *
 * THE SEVEN IDENTITY FIELDS COME TO 1,008px including gaps — 176 + 144 + 144
 * + 144 + 72 + 112 + 144, plus six gaps. Description is the eighth and it is
 * NOT a fixed width; see its entry below.
 *
 * MEASURE THE PANE BEFORE ADDING A NINTH. The editor pane is **~1,229px** on
 * the operator's machine (1920px screen at 125% scaling = 1536 CSS px, less the
 * ~260px section rail and the page padding) — not the ~1,504 an unscaled
 * 1920 suggests, and that 275px difference is exactly what made an eight-field
 * line that "fitted" wrap in front of the client (2026-08-26, screenshot 2495).
 * A width that fits in the arithmetic and not on the screen is worse than one
 * that is visibly too wide, because nothing reports it.
 */
/**
 * WHY THIS STYLE CANNOT TAKE PROCESSES YET — or null, meaning it can.
 *
 * The two tests are the ones the Process button was disabled by until
 * 2026-08-29, moved here unchanged when the grid came inline. A REASON rather
 * than a boolean, for the same argument the button's `title` made: a control
 * that refuses without naming the field that would turn it on is a dead end.
 *
 * THE STYLE TEST IS LOAD-BEARING. `normalizeStyleProcesses` matches rows to
 * styles BY REF NO AS TEXT and drops every row that matches nothing, so
 * processes entered against an unnamed style are destroyed by the next save,
 * silently. This gate is what stops them being enterable in the first place.
 *
 * THE PO QTY TEST IS THE CLIENT'S JUDGEMENT, not a structural one — a line
 * with no quantity is not yet an order for anything. Nothing breaks if it is
 * lifted; it stays because it is their rule and a layout change is no reason
 * to quietly relax it.
 *
 * ORDER MATTERS: the style is named first in the flow, so a row with neither
 * answer is told about the style rather than about a quantity it cannot get
 * to yet.
 *
 * MODULE LEVEL, NOT A CLOSURE IN THE COMPONENT. It reads nothing but its
 * argument, and both callers are inside `styleColumns` and
 * `componentsAndSizes` — one of which is BUILT above where a `const` in the
 * body would be initialised. That is safe today only because a cell's arrow
 * body runs at render rather than at definition, which is a temporal-dead-zone
 * argument nobody should have to re-derive. Hoisting it removes the question.
 */
const processGateReason = (r: StyleRow): string | null => {
  if (!r.style_id && !r.style_ref_no.trim()) return "Name a style on this row first.";
  if (!((Number(r.po_qty) || 0) > 0)) return "Enter the PO Qty first.";
  return null;
};

const STYLE_FIELD_W: Record<string, FieldWidth> = {
  /* `term` (176) AND NOT `name` (288), SO DESCRIPTION FITS BESIDE IT (client
     2026-08-26: "decrease that style field size a little, then move that
     description to the same row" — the two halves are one instruction, because
     at `name` the eight came to 1,420px and Description was the field that
     wrapped away on anything under a full-width pane).

     176px holds ~22 characters of a manually-typed style name, and the value is
     `Truncated`-backed like every other on this row, so a longer one clips with
     the rest reachable rather than being lost. It is still the widest of the
     seven identity fields, which is the proportion that matters here. */
  Style: "term",
  "Approved Sample No": "code",
  "Style Category": "code",
  "Article No.": "code",
  "Order Unit": "num",
  "PO Qty": "range",
  /* `Process` AND `Sizes` ARE NOT ON THIS ROW. Both live on the composition
     line below it — Sizes beside Coordinate, and the Process [Click] button as
     that line's fourth section (client 2026-08-29: "just that process single
     click field, not like this full"). Entries removed rather than left behind:
     this map is read by HEADER, so a stale key is inert and therefore invisible,
     and the next reader would find a field width for a field they cannot find on
     screen. Their 144 and 288px are Description's, the cell that grows. */
  /* DESCRIPTION JOINS THE ROW (client 2026-08-26: "that description also move
     to the style details row"). It took the second line whole until then, on
     `w-full`, because ~155px of a 14-column track is what `FIELD_TRACK_14`'s
     own note calls "tight for free text".

     THIS ENTRY IS ITS FLOOR, NOT ITS WIDTH. The cell also carries
     `flex-[1_1_7rem]` at the call site — 7rem IS `range`, stated twice on
     purpose so the two cannot say different things — which makes Description
     take whatever the seven leave rather than a number somebody guessed:
     ~210px on the operator's 1,229px pane, ~484px on a 1,504px one, and its own
     line only once fewer than 112px are free.

     LOWERED FROM `term` (176) ON 2026-08-27, because at that floor the row sat
     ~30px from its own wrap point and picking a SIZE tipped it over: the chosen
     sizes render as chips, the row grows taller, the pane gains a scrollbar, and
     Description took the second line (screenshot 2519). The floor is what
     `flex-wrap` tests against — shrinking happens after the line is decided — so
     it is the number that sets the wrap threshold and nothing else. `grow: 1`
     means the field takes the whole remainder whenever it fits, so this costs no
     width on any real pane; it only moves the point at which the row gives up.

     A FIXED WIDTH WAS TRIED FIRST AND WRAPPED. `name` (288) put the line at
     1,308px against a pane of 1,229, so the field the instruction was ABOUT was
     the one that fell off it. Growing into the remainder is the only version of
     this that cannot be wrong at a width nobody measured — which, on a row that
     has now been re-widthed five times in two days, is the property that matters
     more than any particular number. */
  Description: "range",
};

export function GarmentOrderScreen({
  rows,
  bomStatus,
  data,
  perms,
  masterPerms,
  defaultLocationId,
  initialOrderNo = null,
  purpose = "entry",
}: Props) {
  /** Read this, never `purpose` directly, so every site asks the same question. */
  const amending = purpose === "amend";

  const router = useRouter();
  const { success, error: toastError } = useToast();
  /** The editor shell, so a blocked Save can steer to the section that owns the
   *  problem — see `revealFirstProblem`. */
  const shellRef = useRef<MasterFullScreenHandle>(null);

  /**
   * WHICH STYLES THE COMBOS GRID HAS ALREADY BEEN GIVEN A ROW FOR.
   *
   * This is what stops the listing from arguing back. `onEnterSection` fires on
   * every visit to Combos, so "add the styles that have no row yet" would put
   * back a row the operator deliberately deleted the moment they navigated in
   * again — the exact failure `seedComboFromStyle` refuses an effect over. A
   * style is listed AT MOST ONCE per document; delete its row and it stays
   * deleted.
   *
   * PRIMED FULL ON A SAVED ORDER, empty on a new one. A stored document already
   * says what its combos are, and adding to it on open would mark it dirty
   * before the operator had looked at anything.
   */
  const listedComboStyles = useRef<Set<string>>(new Set());
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
  /**
   * SHOW THE PIECES BEHIND EACH RATE, on the Prices matrix (client 2026-08-21).
   *
   * Off by default: the quantity is what WEIGHTS the averages at the edges of
   * the matrix, so it earns its place while the operator is reading them and is
   * noise while they are typing. A second line under every cell also costs the
   * grid ~10px a row, which is the height the matrix was reshaped to reclaim.
   *
   * UP HERE FOR THE SAME HARD REASON as `openPriceKey` above — a hook below the
   * `if (mode === "list")` return crashes this screen on every load.
   */
  const [showPriceQty, setShowPriceQty] = useState(false);
  /**
   * WHICH STRUCTURES THE OPERATOR HAS FINISHED WITH — the gate on the
   * `structureProblems` advisory (client 2026-08-18: "remove this message; if
   * they moved on without filling it then show at that time only, no need to
   * show it statically").
   *
   * The line used to render the moment a Circular Knit structure was picked, so
   * it accused the operator of missing a field they had not reached yet — the
   * cursor was still two boxes to the left. Marked on focus LEAVING the row, it
   * says the same thing at the only moment it is true.
   *
   * IT MATTERS MORE SINCE 2026-09-01, NOT LESS. The advisory then named one
   * field on one family of cloth; it now speaks for five cells on every fabric,
   * so an ungated version would greet a freshly-added blank card with five
   * complaints. The stars and holds are what say "these are needed" up front —
   * this line is only ever for a row they LEFT unfinished.
   *
   * A row key set, not a boolean per row: `ComboStructRow`s are re-created by
   * `mutStructs` on every edit, so a flag on the row would be rewritten by the
   * next keystroke. Keys survive that; a removed row's key simply stops being
   * asked about. Up here with the other fold state for the same hard reason —
   * a hook below the `if (mode === "list")` return crashes the screen on load.
   */
  const [structTouched, setStructTouched] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  /**
   * HAS THE OPERATOR BEEN TOLD YET? (client 2026-08-31)
   *
   * The per-row red line ("Style is required. · Tick at least one size.") used
   * to render the moment a style row existed — so an operator who had just
   * clicked "+ Add style" was handed a list of complaints about a row they had
   * not begun. The client's instruction is that the complaint belongs at the
   * moment they try to LEAVE: *"only show [it when] the user switch to the next
   * tab without filling this detail"*.
   *
   * ## A REVEAL FLAG, NOT A SECOND SET OF RULES
   *
   * Nothing about `validity` changes: the same problems are computed on every
   * render, Save is blocked from the first keystroke, and `stepGuard` still
   * seals the rail. This gates only whether the row PRINTS its complaint. Making
   * the rules themselves conditional would mean a Save that blocks for a reason
   * the screen is refusing to say — the "requiring a hidden field is a record
   * that cannot be saved with nothing on screen to say why" failure, arriving by
   * a different door.
   *
   * ## SET BY THE TWO DOORS THAT ALREADY REFUSE, AND STICKY AFTERWARDS
   *
   * `onStepBlocked` (Next / the sealed rail) and `revealFirstProblem` (a blocked
   * Save, Ctrl+S, Enter off the last field) are exactly the moments the operator
   * has asked to move on and been told no — so they are where the reasons become
   * owed. It never resets: once told, an operator watching the messages
   * disappear as they fill each field is being helped, and re-hiding them on the
   * next keystroke would read as the screen changing its mind. Each line clears
   * on its own when its row is fixed, because `lineProblems` empties.
   */
  const [problemsRevealed, setProblemsRevealed] = useState(false);
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
  /**
   * T&A — the order's Time & Action ladder (0481).
   *
   * NOT PART OF `applyRows`, and that is the same call `attachments` below it
   * makes for the same reason: `applyRows` is shared with the ORDER SEED, and an
   * order carries no T&A ladder. Folding this into it would make every amendment
   * seeded from an order clear a ladder the operator had already filled in.
   *
   * Seeded from the `ta_activities` MASTER rather than from a blank row — see
   * `seedTaLadder`.
   */
  const [taRows, setTaRows] = useState<TaRow[]>([]);

  /**
   * THE ATTACHED DOCUMENTS (0416) — the style JPG, the buyer's PDF order sheet,
   * shade cards. Metadata only; the bytes are already in the private
   * `garment-order-docs` bucket by the time a row exists here.
   */
  const [attachments, setAttachments] = useState<AttachmentRow[]>([]);

  /**
   * WHERE UPLOADS LAND BEFORE THE ORDER HAS AN ID.
   *
   * The client's requirement is explicit that files are attached BEFORE the
   * order is saved (2026-08-12), and `editId` is null until then — so the folder
   * cannot be the record id on the one path that matters most.
   *
   * It does not have to be. `storage_path` is what the row stores and what a
   * signed URL is minted from; the folder is organisation, not identity.
   * `PhotoUpload` makes the same call one step further, keying employee photos
   * by a random filename in a flat folder and never by the employee at all.
   *
   * LAZY STATE, NOT A REF. It must survive every re-render of a screen that
   * re-renders on each keystroke, and a ref does that — but this value is READ
   * DURING RENDER, to hand `FileAttachments` its folder, and reading a ref in
   * render is what `react-hooks` refuses ("Cannot access refs during render").
   * `useState`'s initialiser runs once and the value is render-safe, which is
   * the same guarantee without the violation.
   */
  const [uploadFolder, setUploadFolder] = useState(() => crypto.randomUUID());

  /**
   * THE SKETCH THE HEADER SHOWS — the FIRST one, where there are several.
   *
   * An order can carry more than one drawing (a front and a back, two
   * colourways), and the header has room for one thumbnail. Taking the first
   * means the operator controls which by ordering the rows, and the grid's order
   * is the order they uploaded in — visible, and re-orderable by removing and
   * re-adding. Picking "the newest" instead would move the reference under them
   * whenever a second sketch arrived.
   *
   * A row with no `storage_path` cannot be shown: the upload is what produces
   * that value, so its absence means the file never landed.
   */
  const sketchPath =
    attachments.find((f) => f.doc_kind === "sketch" && f.storage_path)?.storage_path ?? null;

  /**
   * THE ORDER'S OWN DOCUMENTS — the ones belonging to no style (0479).
   *
   * NOT A LEGACY BUCKET. It is a permanent state: every row saved before the
   * field moved onto the style row is one of these, and nothing can invent which
   * style a buyer's order sheet was for. The Order Info corner is where they are
   * seen and removed, and it is the ONLY place they appear — a style row shows
   * only its own — so dropping that column would strand them.
   */
  const orderLevelFiles = attachments.filter((f) => !f.style_ref_no);

  /**
   * Write back the ORDER-LEVEL files without disturbing any style's.
   *
   * The mirror of `setStyleFiles` below, and it exists for the identical reason:
   * `FileAttachments` is handed a SUBSET and hands that subset back, while
   * `setAttachments` replaces the whole array — so passing the callback straight
   * through would delete every style's documents the moment an order-level one
   * was removed. Silent, total, and only visible on the next save.
   *
   * Splices IN PLACE rather than rebuilding, same as `setStyleFiles`: array
   * order is what `sketchPath` reads to choose the header thumbnail, so a kept
   * row must stay where it was.
   *
   * ADDITIONS ARE STILL CARRIED even though nothing can currently make one —
   * there is no order-level Add control any more. Handling them costs one line
   * and refusing them would be a trap for whoever restores such a control.
   */
  const spliceOrderLevelFiles = (next: AttachmentRow[]) => {
    setAttachments((all) => {
      const byKey = new Map(next.map((f) => [f.key, f]));
      const kept = all.flatMap((f) => {
        if (f.style_ref_no) return [f];
        const hit = byKey.get(f.key);
        return hit ? [hit] : [];
      });
      const seen = new Set(all.map((f) => f.key));
      return [...kept, ...next.filter((f) => !seen.has(f.key))];
    });
  };

  /**
   * ONE STYLE LINE'S DOCUMENTS.
   *
   * `styleKey` and not `===`, for the reason every other per-style lookup on this
   * screen gives: rows saved before the CAPITALS rule are not capitalised, so
   * `"tsh-001 "` off an old order and `"TSH-001"` off a new one are one style.
   * The 0479 unique index compares `upper(coalesce(style_ref_no,''))` for the
   * same reason, so the screen and the constraint agree about what one style is.
   *
   * A ROW WITH NO REF OWNS NOTHING. It cannot: `""` is the key of every unnamed
   * row, so matching on it would show one blank line's files on all of them.
   */
  const filesForStyle = (r: StyleRow) => {
    const k = styleKey(r.style_ref_no);
    return k ? attachments.filter((f) => styleKey(f.style_ref_no) === k) : [];
  };

  /**
   * IS THIS STYLE ROW IN BREACH OF "every style carries a document"? — ONE
   * definition, and the three readers below all ask it rather than restate it.
   *
   * It began as two copies. `styleFileProblems` (the blocked Save, the rail badge
   * and the toast) declared the guard, and the Style(s) grid's inline red line
   * copied it verbatim with a comment saying the two must be kept in step. That
   * comment was right about the danger and wrong about the remedy: a row
   * reporting a problem Save does not have — or worse, Save dying while naming a
   * row that looks clean — is exactly what two copies drift into, and a warning
   * beside a copy has never yet stopped one drifting. The remedy is to remove the
   * second copy, which is the same call made an hour earlier against
   * `merchandiserOptions` and against this screen's own re-derivation of the
   * merchandiser narrowing.
   *
   * BOTH HALVES OF THE GUARD ARE LOAD-BEARING and neither is defensive:
   *
   *  - `styleLineStarted` — `addStyle` leaves a blank line for the operator to
   *    type into, so flagging every empty row would deaden Save the instant a
   *    style was added and before anything could be attached to it. That is the
   *    guard the quantity rules spell out at length and it applies identically.
   *  - a non-blank ref — `filesForStyle` refuses to key on `""` (every unnamed
   *    row shares that key, so matching on it would show one blank line's files
   *    on all of them). A started-but-unnamed row therefore cannot own a file and
   *    can never be made to, so demanding one is a rule that cannot be satisfied
   *    until a DIFFERENT field is filled. The row's own "Style is required"
   *    stands in front of it, which is the right order to meet them in.
   *
   * `filesForStyle` and not an `=== ref` test, for the reason that function
   * documents: `styleKey` normalises case and whitespace, so a pre-CAPITALS
   * `"tsh-001 "` and a new `"TSH-001"` are one style — and 0479's unique index
   * compares `upper(coalesce(style_ref_no,''))`, so the screen and the constraint
   * agree about what one style is.
   *
   * ## AND IT IS NOW THE SERVER'S PREDICATE, NOT A THIRD COPY OF ONE
   *
   * The note above removed the second copy on this SCREEN. `stylesMissingFiles`
   * (types.ts, client-safe) removes the copy across the WIRE: `styleFileProblem`
   * in actions.ts calls the same function on the normalized rows, so the live
   * Save button and the action behind it read one rule. The screen half was
   * hand-written to agree, and a hand-maintained agreement between a screen rule
   * and a server rule is the drift AGENTS.md's `missingRequiredMaterialFields`
   * note exists to name.
   *
   * IT WAS NOT MERELY A DUPLICATE — THE SHARED ONE IS STRICTER, IN ONE WAY THAT
   * MATTERS. It ignores a file row whose `storage_path` is blank, which is a
   * FAILED UPLOAD and not a document (the same test `normalizeFileRows` keys the
   * whole table on). `filesForStyle` counts one. Nothing this screen uploads can
   * produce that — `FileAttachments` appends a row only after the upload returns
   * a path — but the SEED can: it maps `storage_path: f.storage_path ?? ""`, so a
   * legacy row with a null path arrives as one. Under the old test such a style
   * satisfied the screen and failed the server: Save enabled, save refused, and
   * the operator with no way to see why. That is exactly the "server stricter
   * than the screen" half.
   *
   * `styleLineStarted` IS NOT LOST BY DROPPING IT. It is subsumed: its first
   * clause is `filled(r.style_ref_no)`, so every row with a ref is started, and
   * every row without one is skipped by both tests.
   *
   * MEASURED, NOT REASONED. The two predicates were run against each other over
   * every combination of {blank ref, whitespace ref, matching ref, differently
   * cased ref, other ref} x {no file, matching file, differently cased file,
   * order-level file, blank path, whitespace path, other style's file} x {row
   * started by its ref alone, by a PO Qty, by a Description}: **105 cases, 12
   * divergences, and all 12 are the blank/whitespace `storage_path` case above.**
   * Not one divergence involved `styleLineStarted`, which is what makes the
   * subsumption a result rather than an argument. The 13th difference is outside
   * that matrix and is the de-duplication: two style rows sharing one ref were
   * reported twice by the old per-row test and are named once by the shared one,
   * so the rail badge stops counting one missing document as two.
   *
   * A SET, COMPUTED ONCE PER RENDER, because the shared function answers for the
   * WHOLE list at once — asking it per row would be quadratic on a screen that
   * re-renders on every keystroke. `styleKey("")` is `""` and the function never
   * emits a blank ref, so an unnamed row is absent from the set and therefore not
   * in breach, exactly as before.
   */
  const stylesMissingTheirFiles = new Set(
    stylesMissingFiles(styles, attachments).map((ref) => styleKey(ref)),
  );
  const styleFileMissing = (r: StyleRow) =>
    stylesMissingTheirFiles.has(styleKey(r.style_ref_no));

  /**
   * Write back ONE style's file list without disturbing anything else's.
   *
   * `FileAttachments` is handed that style's rows and hands the whole list back —
   * so this has to splice rather than replace, and it does it IN PLACE: a kept
   * row stays where it was in `attachments`, a removed one drops out, and an
   * added one goes on the end. Rebuilding as `[...others, ...next]` would be
   * simpler and would silently re-order the array every time any style's files
   * were touched — and array order is what `sketchPath` reads to decide which
   * drawing the page header shows, so the header's thumbnail would change when
   * an unrelated style gained a file.
   *
   * NOTHING IS RE-STAMPED HERE. `FileAttachments` stamps `style_ref_no` at the
   * moment of upload (`styleRefNo`), because only it can tell an added row from a
   * kept one; a blanket re-stamp here would re-file rows this cell was merely
   * shown.
   */
  const setStyleFiles = (r: StyleRow, next: AttachmentRow[]) => {
    const k = styleKey(r.style_ref_no);
    if (!k) return;
    setAttachments((all) => {
      const byKey = new Map(next.map((f) => [f.key, f]));
      const kept = all.flatMap((f) => {
        if (styleKey(f.style_ref_no) !== k) return [f];
        const hit = byKey.get(f.key);
        return hit ? [hit] : [];
      });
      const seen = new Set(all.map((f) => f.key));
      return [...kept, ...next.filter((f) => !seen.has(f.key))];
    });
  };

  /* A RENAME IS CARRIED BY `settleStyleRef`, with the other four ref-keyed
     children — see the `setAttachments` clause there for why files need it while
     the row's nested children do not. */
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
    approved_sample_id: null,
    article_no: "",
    style_category: "",
    style_category_id: null,
    style_description: "",
    order_unit_id: null,
    plan_unit_id: null,
    unit_kind: null,
    po_qty: "",
    packs_ordered: "",
    description: "",
    pack_components: [],
    sizes: [],
    coordinates: [],
    components: [],
    processes: [],
  });
  const blankDyeing = (section: "yarn" | "fabric"): DyeingRow => ({
    key: newKey(),
    section,
    dye_type: "",
    color_name: "",
    color_id: null,
  });
  const blankPrint = (): PrintRow => ({ key: newKey(), print_id: null, print_name: "" });
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
    pack_type: "",
    po_no: "",
    po_qty: "",
    /**
     * THE DATES ARRIVE FILLED IN (client 2026-08-31: "the Delivery Dt on the
     * Quantity Tab must be automatically pre-filled by pulling the delivery
     * date already defined in the main Order Info tab … The user should not
     * have to manually re-enter this date").
     *
     * Read at CALL time, exactly as `is_single_style_pack` below is — this
     * factory runs from a click handler and from an effect, never from a
     * `useState` initialiser, so `form` is populated by the time it runs. That
     * is what lets a row created after the header date was typed be born
     * holding it, which is the case the client is describing.
     *
     * SEEDING IS ONLY HALF THE RULE. A row created BEFORE the header date was
     * entered, or created while it held an earlier answer, is caught by the
     * cascade in `setHeaderDeliveryDate` — the two together are "the row follows
     * Order Info until the operator says otherwise". Neither is sufficient
     * alone: seeding alone strands every row made first, and cascading alone
     * opens each new row blank beside filled siblings.
     */
    delivery_date: form.delivery_date,
    earlier_shipment_date: dayBefore(form.delivery_date),
    warehouse_id: null,
    discharge_port_id: null,
    pack: "",
    is_ratio_wise_pack: false,
    ratio_for: "",
    /* Derived, not `false` — see the load path above. Read at CALL time, so
       `styles` is initialised by then: this factory runs from a click handler
       and from an effect, never from a `useState` initialiser. */
    is_single_style_pack: AssortStyle.defaultSingleStylePack(styles),
    master_carton_name: "",
    inner_carton_name: "",
    pack_description: "",
    assort_lines: [],
  });
  const blankPackType = (): PackTypeRow => ({ key: newKey(), pack_type: "", lines: [] });
  /**
   * One T&A row the operator added by hand — a step this order needs that the
   * master's ladder does not carry.
   *
   * `crypto.randomUUID()`, NEVER `newKey()`. See `TaRow.row_uid`: `key` is
   * React's identity and dies with the mount, `row_uid` is what a completion
   * entered on the dashboard weeks later is matched back by. The two look
   * interchangeable at the call site and are not.
   */
  const blankTaRow = (): TaRow => ({
    key: newKey(),
    row_uid: crypto.randomUUID(),
    activity_id: null,
    days_required: "",
  });

  /**
   * THE LADDER, SEEDED FROM THE `ta_activities` MASTER — one row per activity,
   * in `sequence` order, which is EXECUTION order (Fabric Plan first, Shipment
   * last).
   *
   * ## WHY THIS GRID IS SEEDED FROM A MASTER AND THE OTHER EIGHT ARE NOT
   *
   * `openOneRow` opens every other grid on ONE BLANK ROW, because the operator
   * is the only one who knows what belongs in it. A T&A ladder is the opposite
   * shape: the steps a garment order goes through are the factory's, they are
   * already declared in a master somebody maintains, and they are the same on
   * every order. Opening this grid blank would make the operator retype ten rows
   * that the app already knows, and get them in the wrong order — the sequence
   * is what makes the arithmetic mean anything, since each step is scheduled
   * back from the one after it.
   *
   * ## ORDER IS NOT DECORATION HERE
   *
   * `sequence` is the axis `orderTaLadder` reverses on the way in and back on
   * the way out. A row out of place does not look wrong on screen — it produces
   * a complete, plausible ladder of dates that are simply wrong, which is the
   * dangerous kind of failure (the same shape the contract's "an empty report is
   * the dangerous one" note describes). Sorting here rather than trusting the
   * feeder's `.order("sequence")` costs one comparison and removes the
   * assumption; `?? 0` keeps a master row with no sequence at the front rather
   * than dropping it.
   *
   * ## A SWITCHED-OFF ACTIVITY IS NOT SEEDED, AND A SAVED ONE STILL RESOLVES
   *
   * `isInactive` is the standing rule ("Disabled rows"): a retired activity must
   * not be offered on a NEW ladder. It is filtered HERE, at the seed, and NOT
   * out of `taActivityItems` below — the picker keeps every row so an activity a
   * SAVED order already names still renders with its own name rather than
   * resolving to nothing and blanking the FK on the next save.
   *
   * ## DAYS IS PREFILLED ONLY WHEN THE MASTER ACTUALLY STATES ONE
   *
   * `ta_activities.default_offset_days` is the master's lead time and handing it
   * over is what the column is for. But the column is `not null default 0`, so
   * on a master nobody has filled in every activity reads 0 — and a prefilled 0
   * is a plan that says "this step takes no time", which schedules two steps onto
   * one date and still looks complete. That is the "NULL IS NOT ZERO" rule the
   * row type and `backwardSchedule` both state. So a positive default prefills
   * and anything else leaves the box BLANK, where the ladder refuses it by name
   * ("Knitting: enter how many days it needs") and the operator is told what to
   * do instead of being handed a lie.
   */
  const seedTaLadder = (): TaRow[] =>
    [...data.taActivities]
      .filter((a) => !isInactive(a))
      .sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0))
      .map((a) => ({
        key: newKey(),
        row_uid: crypto.randomUUID(),
        activity_id: a.id,
        days_required: a.default_offset_days > 0 ? String(a.default_offset_days) : "",
      }));

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
  /**
   * ONE COMBO ROW PER DECLARED STYLE (client 2026-08-28: "if we give multi
   * styles it should be listed automatically in combos — now it's only showing
   * one style by default").
   *
   * The grid opened on ONE blank row however many styles the order declared, so
   * a three-style PO showed a single unattributed line and the operator picked
   * the style by hand on every colourway. `addCombo` had half the answer
   * already — it carries the style on a NEW row — but only `styles.length === 1`,
   * because with several it cannot guess which one the operator meant. Listing
   * them all is the answer it could not reach: nothing is guessed, every
   * declared style simply gets its line.
   *
   * THE STYLES ARE PASSED IN, NOT READ FROM STATE. Both callers have just
   * called `setStyles`, and React batches — the `styles` closure here still
   * holds the PREVIOUS document's rows, so reading it would list the last
   * order's styles on this one. That is the same trap the rename fan-out below
   * avoids by taking its values as arguments.
   *
   * ONCE, AND ONLY INTO AN EMPTY GRID — `xs.length ? xs : …`, the rule this
   * function already applies to every other grid. It is deliberately NOT a
   * top-up: `seedComboFromStyle` records at length why "add the styles that
   * have no row yet" is wrong as a standing rule ("an effect watching the
   * declared set would re-add a structure the operator deliberately removed the
   * moment anything else re-rendered it — the grid would argue back"), and a
   * saved order arrives with its own rows, so this never fires on one.
   */
  const combosForStyles = (styleRows: readonly StyleRow[]): ComboRow[] => {
    const seen = new Set<string>();
    const out: ComboRow[] = [];
    for (const st of styleRows) {
      const ref = st.style_ref_no.trim();
      const k = styleKey(ref);
      if (!ref || seen.has(k)) continue;
      seen.add(k);
      out.push({
        ...blankCombo(),
        style_ref_no: ref,
        // THE REF IS THE NAME NOW (Style became manual entry 2026-08-25), the
        // same pair `addCombo` writes.
        style: ref,
        article_no: st.article_no ?? "",
      });
    }
    return out;
  };

  const openOneRow = (styleRows: readonly StyleRow[] = []) => {
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
    setCombos((xs) => {
      if (xs.length) return xs;
      const listed = combosForStyles(styleRows);
      // No usable style yet (a brand-new document) still opens on one blank row
      // — the keyboard needs something to land in. See this function's header.
      return listed.length ? listed : [blankCombo()];
    });
    setPriceDetails((xs) => (xs.length ? xs : [blankPriceDetail()]));
    setPackTypes((xs) => (xs.length ? xs : [blankPackType()]));
    setQuantities((xs) => (xs.length ? xs : [blankQuantity()]));
    /* THE ONE GRID THAT DOES NOT OPEN ON A BLANK ROW — see `seedTaLadder`. It
       tops up on the same "only if empty" test as its eight neighbours, which is
       what makes it safe on BOTH callers: a saved amendment that already carries
       a ladder keeps every `row_uid` it was read back with (and with them every
       completion the dashboard has recorded), and only an order that has none
       gets the master's.

       AN EMPTY MASTER SEEDS NOTHING AND THAT IS CORRECT. `seedTaLadder` returns
       `[]` when there are no active activities, so the grid stays empty and says
       why (see the tab) rather than opening a blank row whose Activity picker
       has nothing in it — a mandatory cell with an empty list is a record that
       cannot be saved with nothing on screen to fix it with. */
    setTaRows((xs) => (xs.length ? xs : seedTaLadder()));
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
    /* T&A (0481). Through the SAME mapping as its nine neighbours rather than a
       block of its own in `openEdit`, which is what this function's header asks
       for: "ONE mapping, two callers — they were the same twenty lines written
       twice, which is how a column gets mapped in one path and forgotten in the
       other." The path that would have been forgotten here is the ORDER SEED,
       and forgetting it means `row_uid`s from the previous document surviving
       into a new one.

       AN ORDER SEED HANDS OVER `[]`, and that is not a gap: `openOneRow` below
       fills an empty ladder from the `ta_activities` master, so a new amendment
       seeded off an order gets the factory's ladder and a saved one gets its
       own. */
    setTaRows(r.taActivities);
    // Covers BOTH callers — a saved document reopened, and a seed from an
    // order. Tops up only the grids that came back empty.
    //
    /* EVERY DECLARED STYLE COUNTS AS ALREADY LISTED on a document that arrives
       with rows — see `listedComboStyles`. `openOneRow` just below fills an
       EMPTY combos grid from the same styles, and marking them here keeps the
       section-entry top-up from adding a second row for each. */
    listedComboStyles.current = new Set(
      r.styles.map((x) => styleKey(x.style_ref_no)).filter(Boolean),
    );
    // `r.styles`, NOT the `styles` state: `setStyles` two dozen lines up has not
    // landed yet, so the closure still holds the previous document's rows.
    openOneRow(r.styles);
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
  /**
   * HAS THE OPERATOR ACTUALLY TOUCHED THIS ORDER? — the other half of `dirty`,
   * and the reason three of 2026-08-19's bug reports were about code that was
   * already correct and already deployed.
   *
   * `dirty` feeds `useUnsavedGuard`, which holds off the silent PWA auto-reload
   * so a deploy cannot destroy half-typed work. It was `tabsHaveRows` alone —
   * true whenever ANY of nine collections holds a filled row, i.e. true the
   * instant a real order LOADS. So on this screen the guard never lifted, the
   * new build never reached the tab, and the client kept testing yesterday's
   * bundle while reporting fixes as broken. The comment below already worried
   * about pinning the guard on permanently and picked the signal that does it.
   *
   * `touched` is set from a capture listener on the editor root, so it needs no
   * plumbing through the ~40 setters and cannot drift from them. It errs
   * DELIBERATELY toward protection: a click anywhere in the editor counts, not
   * just a keystroke, because a picker commits on click and a row is removed by
   * one. Over-protecting costs a stale tab until reload; under-protecting costs
   * the operator's typing, and those are not symmetrical.
   */
  const [touched, setTouched] = useState(false);
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
  ].some((rows) => (rows as Record<string, unknown>[]).some(rowFilled)) ||
    /**
     * T&A IS COUNTED BY ITS **DAYS**, NOT BY `rowFilled`, and it is the one grid
     * that cannot use the shared test.
     *
     * `rowFilled` asks "does any field hold a value", which is the right question
     * for eight grids that open on a BLANK row. This one opens on the master's
     * ladder, so every row already carries an `activity_id` and a `row_uid` the
     * moment the editor opens — `rowFilled` would be true on a document nobody
     * has touched, and all three readers of this flag would lie at once, exactly
     * as the note above records happening when it was `length > 0`: the discard
     * prompt would challenge a form nobody typed in, `status` would say "Unsaved
     * changes" on every new order, and the order seed would ask permission to
     * replace rows holding nothing the operator entered.
     *
     * `days_required` is the only cell on this tab the operator types, so it is
     * the only honest signal that they have. A prefilled default from
     * `ta_activities.default_offset_days` counts as touched and that is
     * accepted: it is a real figure that would be really lost, and the flag errs
     * toward protection for the same reason `touched` does.
     *
     * UNCHANGED BY THE TAB BECOMING OPTIONAL (2026-08-31), and worth saying so
     * because it was re-examined rather than assumed. This flag drives the
     * discard prompt and the reload guard — it asks "is there typed work here
     * worth protecting", which has nothing to do with whether the record can be
     * saved without it. Optional work is still work; a deploy landing mid-entry
     * would lose a half-built ladder exactly as before.
     */
    taRows.some((r) => r.days_required.trim() !== "");

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
  /* SEEDED FROM THE SERVER, not left blank for the effect below to fill
     (client 2026-08-31). The effect still runs and still re-answers when the
     Unit or the Date changes; what it no longer does is decide whether the
     operator sees a number AT ALL on the first paint. */
  const [previewNo, setPreviewNo] = useState<string | null>(initialOrderNo);
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
  const shipTypeOpts = useMemo(
    () => lookups.filter((l) => l.kind === "ship_type"),
    [lookups],
  );
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
   * still points at them, and the Category master, the Material master and
   * `lib/orders/styles/rules.ts` all read that column. What it no longer drives
   * is GSM — the "Circular Knit → compulsory" carve-out was withdrawn on
   * 2026-09-01 and `familyCodeOf` went with it, so this screen derives no knit
   * family at all any more. See `structureRequiredCells` in combo-rules.ts.
   */

  const printOpts = useMemo(
    () => lookups.filter((l) => l.kind === "roll_form_print"),
    [lookups],
  );
  /**
   * The colour master (0415) — see the Colour cell in `dyeColumns`.
   *
   * Starts EMPTY on a fresh database and that is correct, not a gap: the list is
   * the names this business actually uses, and it fills through the picker's own
   * "+ Add". Seeding it with NAVY / RED would be the defaulted word list the
   * near-miss rule exists to prevent.
   */
  const colorOpts = useMemo(
    () => lookups.filter((l) => l.kind === "fabric_color"),
    [lookups],
  );
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

  /* THE PRINT LIST, SCOPED THE SAME WAY (0477) — a switched-off lookup is gone
     from the list, EXCEPT the one this row already holds. Dropping that would
     show a filled field as empty and blank it on the next save, which is the
     "Disabled rows" rule's stated failure. Written beside `colourPickOptions`
     rather than generalised: two three-line filters that read identically are
     cheaper than one helper a reader has to go and check. */
  const printPickOptions = (held: string | null) =>
    printOpts
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

  /* THE ⊕ HALF OF THE FABRIC PRINT CELL (0477), the same shape as
     `createColour` above and calling the same action, so a print added from an
     order is parsed by the Lookup master's own Zod schema, guarded by its
     duplicate check, and immediately offered at every other `roll_form_print`
     field. Without it the master stops growing the day free text arrives —
     which is the failure 0415 records for the colour list. */
  const createPrint = async (name: string): Promise<string | null> => {
    const res = await createLookupValue("roll_form_print", name, null);
    if (!res.ok) {
      toastError(res.error);
      return null;
    }
    success(`Print "${name}" added`);
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
  /* SORTED, like the Style master's (`sortBySize`) — 2026-08-23. It was
     insertion order here, which was invisible while the sizes were a handful of
     seeded pickers and is the first thing an operator sees now that the same
     gridded dropdown draws them. One ordering, one declaration: two screens
     showing the same size master in two orders is the drift the shared helper
     exists to stop. */
  const sizeOpts = useMemo(
    () => sortBySize(lookups.filter((l) => l.kind === "size"), (l) => l.name),
    [lookups],
  );

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
  /**
   * The `fabric_structure` lookup rows — Circular Knit / Flat Knit / Woven.
   *
   * NOT A PICKER (0415 took the last one off this screen, and nothing here asks
   * the operator the knit family directly). It is the second hop of a
   * DERIVATION: a component names a fabric CATEGORY, the category names its
   * family, and `compTypeFor` turns that into the `comp_type` this screen now
   * stores alongside the Style master. This memo is that same fact shaped as
   * `{id, name}` because that is what the shared rule takes.
   *
   * `familyCodeOf` USED TO SIT BELOW and make the same two hops for the GSM
   * rule. It went on 2026-09-01 with the rule it served — GSM is required on
   * every fabric now — so `compTypeFor` is the only reader of the family left
   * on this screen.
   */
  const fabricStructureOpts = useMemo(
    () =>
      lookups
        .filter((l) => l.kind === "fabric_structure")
        .map((l) => ({ id: l.id, name: l.name })),
    [lookups],
  );
  /**
   * Style Category offers GARMENT categories (0394/0461) — the same list the
   * Style master's own cell does.
   *
   * Scoped HERE rather than in the service, exactly as `structureItems` below
   * scopes the FABRIC ones: this is the layer that knows which class the cell
   * means. `inactive` rides along rather than being filtered in SQL, so a
   * switched-off category the order already names still resolves.
   *
   * DECLARED WITH THE OTHER MEMOS AND NOT BESIDE ITS CELL, which is not tidiness
   * — this component returns early in list mode, so a `useMemo` written down
   * beside `styleColumns` is a hook called conditionally. eslint caught it;
   * every other option list on this screen is up here for the same reason.
   */
  const garmentClassId = useMemo(
    () =>
      lookups.find(
        (l) => l.kind === "item_class" && (l.code ?? "").toUpperCase() === "GAR",
      )?.id ?? null,
    [lookups],
  );
  const styleCategoryItems = useMemo(
    () =>
      data.categories
        .filter((c) => !garmentClassId || c.item_class_id === garmentClassId)
        .map((c) => ({
          id: c.id,
          code: c.short_name,
          name: c.name ?? c.short_name ?? "(unnamed category)",
          inactive: isInactive(c),
        })),
    [data.categories, garmentClassId],
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
   * THE COMPOSITION LIST IS NOT NARROWED, and that is the point of 0434.
   *
   * `fabricsFor` and `fabricPlaceholder` used to live here: the cell listed the
   * FABRICS under the picked Structure, so with no Structure it offered nothing
   * and said "Pick a Structure first" — which is how the field was reported as
   * unwired (client 2026-08-19, screenshot 2357). It was empty-and-explain done
   * correctly against the wrong list.
   *
   * A composition is a property of the FABRIC, not of the category, so there is
   * nothing to narrow BY: scoping the master list would need the very derivation
   * that already pre-selects an answer, and would then offer exactly that one
   * row — reproducing the dead end. So the cell takes `data.compositions` whole
   * and `compositionForStructure` fills it in where the answer is unambiguous.
   *
   * This is NOT the nominated-vendor "empty and explain" case, which governs a
   * list that genuinely CANNOT be answered until its parent is. This one can.
   */

  /** Every fabric category by id — the knit family lives on it (0409). */
  const categoryById = useMemo(
    () => new Map(data.categories.map((c) => [c.id, c])),
    [data.categories],
  );
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
   * Details finds it, through the line the operator typed. `styleKey` rather
   * than `===`, because rows saved before the CAPITALS rule are not upper-cased.
   *
   * IT RETURNS THE LINE, NOT A MASTER ROW (2026-08-25). It used to take one more
   * hop — line → `style_id` → `garment_styles` — and with Style now typed there
   * is no id to hop through. Nothing below it changed: `StyleRow.components`
   * carries the same `coordinate_id` / `component_id` / `fabric_category_id`
   * triple the master's list did (0457 copied that shape deliberately), so the
   * three scoping helpers and the structure tree read the same field off a
   * nearer source. They are also now scoped to what THIS ORDER declares rather
   * than to what the master happens to say today, which is the stronger answer:
   * a combo is a colourway of the garment on this PO.
   */
  const styleOfCombo = (r: ComboRow): StyleRow | null => {
    return (
      styles.find((x) => styleKey(x.style_ref_no) === styleKey(r.style_ref_no)) ??
      null
    );
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
  const scopedComponents = (
    r: ComboRow,
    coordinateId: string | null,
    held: string | null,
    /**
     * COMPONENTS THIS FABRIC'S OTHER PARTS HAVE ALREADY TAKEN under the same
     * coordinate (client 2026-08-31, screenshot 2560: three part rows all
     * reading INNER / BACK BODY).
     *
     * ## THIS SCOPING AND THE DEDUPE ARE TWO DIFFERENT QUESTIONS
     *
     * The `ids` set below answers "which components does the STYLE pair with
     * this coordinate" — a narrowing against the style master, so a collar is
     * not offered under a coordinate that has none. It says nothing about what
     * the rows in front of the operator have used, which is why the same part
     * could be picked three times: every one of those picks was inside the
     * style's declared set, so the existing filter had no objection to any of
     * them.
     *
     * ## AND IT IS THE SAME RULE THE OTHER GRID ALREADY STATES
     *
     * `componentsTakenUnder` (lib/orders/styles/rules.ts) is what the Style(s)
     * Components grid passes to `componentOptions`, and it is passed here rather
     * than re-derived — two copies of "which components are spoken for" is how
     * one grid ends up stricter than the other and nobody can say which is
     * right. It is scoped PER COORDINATE, deliberately: `components` carries an
     * `all_coordinates` flag and no coordinate column, so BACK BODY is one
     * master row shared by every coordinate. A style-wide unique rule would mean
     * a two-piece SET could not have a back body for both pieces.
     *
     * `held` still survives the filter — the cell must never hide the value it
     * is currently showing, which is the same reason the caller excludes its own
     * row from the sibling list.
     */
    taken?: ReadonlySet<string>,
  ) => {
    const st = styleOfCombo(r);
    const pairs = st?.components ?? [];
    const ids = new Set(
      pairs
        .filter((c) => !coordinateId || c.coordinate_id === coordinateId)
        .map((c) => c.component_id)
        .filter(Boolean) as string[],
    );
    /*
     * NO FALLBACK TO THE FULL LIST — and this was the ROOT CAUSE of the
     * duplicates, not merely an untidiness beside them (client 2026-08-31:
     * "based style tab ... only the coordinate, component details need to be
     * shown").
     *
     * This read `if (ids.size === 0) return data.componentRows`. So a coordinate
     * the STYLE declares no components for — INNER, in screenshot 2560, where
     * the style paired components with BOTTOM and OUTER only — silently offered
     * EVERY component in the master. That is how one fabric came to hold three
     * parts all reading INNER / BACK BODY: each pick was made from a list that
     * should have been empty, so no dedupe could have caught them either.
     *
     * It is the silent fallback AGENTS.md forbids by name under "Nominated
     * vendors": *"Empty-and-explain, never fall back to the full list: a silent
     * fallback makes the list advisory and the operator never learns it needs
     * filling in."* Exactly what happened — the operator was never told that
     * INNER has no components on the Style(s) tab, because the app answered the
     * question as though it did.
     *
     * The held value still survives, so a SAVED order whose style has since
     * stopped declaring a pair keeps showing what it holds rather than rendering
     * empty and blanking the FK on the next save ("Disabled rows", same file).
     */
    const inScope = data.componentRows.filter(
      (o) => ids.has(o.id) || o.id === held,
    );
    if (!taken || taken.size === 0) return inScope;
    return inScope.filter((o) => o.id === held || !taken.has(o.id));
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
  const declaredPrintOptions = (_st: ComboStructRow, held: string | null) => {
    /* UNGATED SINCE 2026-08-31, and the gate did not merely become unnecessary —
       it became a trap.

       IT USED TO READ `if (!takesAllOverPrint(st.item_sub_type)) return held ? … : []`
       (client 2026-08-12: Fab Print "is used when a component's fabric type is
       identified as Printed"), by the same function that decided the colour list,
       so the two cells could never both claim the row. That reasoning is left
       standing because it was right for the screen it was written on; it is
       SUPERSEDED BY A CLIENT DECISION, not found wrong. The first half went on
       2026-08-20, when Colour and Fabric Print were put side by side on every
       part and the gate stopped deciding which cell was asked.

       WHAT REMOVED THE SECOND HALF IS THAT `printed` LEFT THE VOCABULARY (client
       2026-08-31: "Printed is an aesthetic processing step, not a base fabric
       type"). Printing is therefore ORTHOGONAL to what the cloth is made of and
       any fabric may be printed — so an unconditional list is the client's own
       rationale carried through, not a relaxation of it.

       AND IT HAD TO GO RATHER THAN BEING LEFT: with `printed` unsayable,
       `takesAllOverPrint` could never again return true, so this cell would have
       offered an EMPTY LIST on every part of every order, for ever, with nothing
       erroring. A gate keyed on a value nothing can hold is not a strict gate, it
       is a permanently closed one — the shape AGENTS.md records twice, under
       `created_by` and the item-report filter bar, where the code reads as correct
       and the value simply never arrives. Do not reintroduce a Fabric Type test
       here; there is no longer a Fabric Type that means "printed".

       The three clauses below are UNCHANGED and are the whole rule now. `_st` is
       kept in the signature because the caller passes the structure row and a
       future scoping question (per-fabric declared prints) would want it —
       renaming it is what says nothing reads it today. */
    const ids = new Set(
      prints.map((p) => p.print_id).filter(Boolean) as string[],
    );
    // AND THE FULL LIST WHEN THE ORDER DECLARES NONE (2026-08-14). The grid that
    // fed this came off the Color/Print tab, so "declared" is now only ever what
    // a previously saved order carries — and the paragraph above turned an
    // inline create down precisely BECAUSE the declaration belonged on that tab.
    // With no tab to send the operator to, an empty list stops being a prompt
    // and becomes a dead end on a part that IS printed — which, since 2026-08-31,
    // is any part at all rather than one whose Fabric Type said so. Same three
    // clauses as `scopedStructures`: a held value always survives, nothing
    // declared falls back to the whole list, a declared set narrows to it.
    if (ids.size === 0) return printOpts;
    return printOpts.filter((o) => ids.has(o.id) || o.id === held);
  };

  /**
   * The Fabric Color list FOR A GIVEN STRUCTURE — FILTERED BY ITS FABRIC TYPE
   * (client 2026-08-20).
   *
   * Solid takes the `Dyed` colours and Melange the `Melange` ones from either
   * grid; a blank Fabric Type takes nothing. The rule and its whole reasoning
   * live in `declaredColoursFor` — here so the Combos cell and anything that
   * later needs the same question cannot answer it two ways.
   *
   * YARN DYED TAKES NOTHING EITHER, SINCE 2026-08-31, AND THAT IS NOT THE SAME
   * "nothing" AS A BLANK FABRIC TYPE. A blank has not been answered yet, so the
   * cell is optional; a yarn-dyed part is REQUIRED to state a colour and is
   * offered no list to state it from, because its colour is a blend the palette
   * cannot name ("WHITE/BLUE STRIPE"). The cell becomes a plain `Input` there —
   * see the Colour cell in `componentGrid` — so this map is never consulted for
   * it. `componentColourEntry` is what tells the two apart.
   *
   * NOT A `useMemo` OVER `dyeings` ANY MORE. The list is no longer one value for
   * the screen: it is a different answer per structure row, so a single memo
   * could only hold the unfiltered palette that was the defect. Memoised per
   * fabric type instead — there are three since `printed` was withdrawn — so a
   * combo with three structures does not refilter the palette three times on
   * every keystroke.
   *
   * Free text still works in every branch, so nothing is blocked; the cell is a
   * Combobox and always was.
   */
  const colourOptionsByType = useMemo(() => {
    const m = new Map<string, { value: string; label: string }[]>();
    for (const t of ITEM_SUB_TYPE_OPTIONS) {
      m.set(
        t.value,
        declaredColoursFor(dyeings, t.value).map((c) => ({ value: c, label: c })),
      );
    }
    return m;
  }, [dyeings]);

  const colourOptionsFor = (st: ComboStructRow) =>
    colourOptionsByType.get(st.item_sub_type) ?? [];

  /**
   * THE YARN COLOURS A YARN-DYED FABRIC MAY BE KNITTED FROM (client 2026-08-31:
   * "it must dynamically list ONLY the colors previously defined for the style's
   * master colorways").
   *
   * The rule is `yarnColourOptions` and it lives in `combo-rules.ts` for the
   * usual reason — the screen and anything that later asks the same question
   * must not answer it two ways. What is here is only the shape of the lookup.
   *
   * MEMOISED PER STYLE REF, WHICH IS THE SAME MOVE `colourOptionsByType` MAKES
   * ONE FIELD OVER, and for the same reason: the answer is a different one per
   * combo, so a single memo could only hold the unscoped list — which is exactly
   * the defect that rule exists to avoid (style 2's NAVY offered under style 1).
   * The key set is small and closed: the distinct style refs the Combos grid
   * holds, plus `""` for a combo that names no style.
   *
   * IT MEMOISES OVER `combos`, WHICH THE OPERATOR IS TYPING INTO, so this
   * recomputes whenever a combo name changes — which is correct rather than
   * wasteful: the combo names ARE the vocabulary, so a colourway renamed from
   * WHITE to OFF WHITE must reach the dropdown on the keystroke. What the memo
   * still buys is that a combo with three yarn-dyed structures resolves its list
   * once instead of three times, which is the whole of what the neighbouring
   * memo buys too.
   *
   * `styleKey`, NEVER `===` — the same normalisation `yarnColourOptions` applies
   * internally (trim + uppercase), and the one every other cross-tab style
   * reference in this module uses. A row saved before the CAPITALS rule would
   * otherwise key itself into a bucket nothing looks in.
   */
  const yarnColourOptionsByStyle = useMemo(() => {
    const opts = (ref: string | null) =>
      yarnColourOptions(combos, ref).map((c) => ({ id: c, label: c }));
    const m = new Map<string, { id: string; label: string }[]>();
    // The unscoped list first: it is both the answer for a combo naming no style
    // and `yarnColourOptions`' own fallback, so it is always wanted.
    m.set("", opts(null));
    for (const c of combos) {
      const k = styleKey(c.style_ref_no);
      if (k && !m.has(k)) m.set(k, opts(c.style_ref_no));
    }
    return m;
  }, [combos]);

  const yarnColourOptionsFor = (r: ComboRow) =>
    yarnColourOptionsByStyle.get(styleKey(r.style_ref_no)) ??
    yarnColourOptionsByStyle.get("") ??
    [];

  /**
   * THE STYLE PICKER IS GONE (client 2026-08-25) — and with it `styleFilterRows`,
   * `styleOptionsFor` and `styleById`, the three things that existed only to
   * serve it.
   *
   * WHAT WENT WITH THEM, RECORDED because it was a real rule and its premise
   * expired rather than being found wrong: the picker narrowed to the header's
   * CUSTOMER and SEASON ("Once a customer and season are selected, the Style
   * field should only list relevant styles"), which took migration 0404 to make
   * buildable at all — styles key on `customers`, this order keyed on `buyers`,
   * and the bridge between them was empty. A typed field has nothing to narrow.
   *
   * `data.styles` IS STILL LOADED AND THIS SCREEN NO LONGER READS IT — said
   * plainly because a fetch with no reader is the kind of thing that gets
   * "tidied" by someone who has not asked why it is there. It is kept for two
   * reasons: `AmendmentFormData` is shared with the loader both doors use, and
   * the customer/season narrowing above is one filled `buyers.customer_id`
   * bridge away from being switchable back on (service.ts says so beside the
   * column). Dropping the select is a separate, deliberate change.
   *
   * The previous value of the cell being edited, for `settleStyleRef` — see the
   * Style cell for why it is captured on focus rather than mirrored in state.
   */
  const styleRefOnFocus = useRef("");

  /**
   * WHICH STYLE(S) LINE HAS ITS PROCESS SHEET OPEN — keyed by the ROW, never by
   * the style.
   *
   * The same reason `detailComboKey` and `assortFor` are: two lines may name the
   * same style, and a pointer holding the style would open both their sheets at
   * once and write one list into two rows.
   *
   * REMOVED AND RESTORED THE SAME DAY (2026-08-29). It went when the grid moved
   * inline onto the row's panel, and came back with the button — "I think the
   * process button is lost, restore it with the function". The sheet and the
   * pane edit the SAME `StyleRow.processes`, so this pointer decides which row's
   * list a MODAL is showing and nothing else; it is not a second store.
   */
  const [processForKey, setProcessForKey] = useState<string | null>(null);
  const processStyle = styles.find((r) => r.key === processForKey) ?? null;
  /**
   * WHERE THE PROCESS SHEET GREW FROM — the rect of the Process cell's button,
   * captured at the click (client 2026-08-28). `Sheet`'s `origin` note carries
   * the reasoning; two things belong at THIS layer rather than in the sheet:
   *
   * - **A rect, not a ref.** The button is re-created as the row re-renders, and
   *   on a set-pack order the columns around it change shape. A ref read while
   *   the sheet is opening could resolve to `null`, and the fallback for that is
   *   a centre origin — a silent regression rather than a visible one.
   * - **Beside `processForKey`, not folded into it.** The key identifies the row
   *   the edits belong to and is what `processStyle` resolves; the rect is only
   *   how the surface animates.
   */
  const [processOrigin, setProcessOrigin] = useState<DOMRect | null>(null);
  /* The Pack Composition sheet's opener, keyed the same way (0467). */
  const [packForKey, setPackForKey] = useState<string | null>(null);
  const packStyle = styles.find((r) => r.key === packForKey) ?? null;

  /**
   * THIS STYLE'S OWN PARTS, for the Process sheet's Component cell (0421).
   *
   * Scoped HERE and not in the sheet, per the cascading-picker rule the sheet's
   * own prop doc states: this layer knows which style the line names, and the
   * line's own Components grid is the only thing that knows which parts that
   * style declares. A sheet handed the whole components master would offer a
   * collar on a style that has none.
   *
   * ## NARROWING AGAIN (client 2026-08-29), AND WHY THAT IS NOT A REVERT
   *
   * This returned `data.componentRows` unconditionally between 2026-08-25 and
   * today, and the note it carried was RIGHT ABOUT A DIFFERENT PICKER. What
   * 08-25 unwound was the narrowing of the style line's OWN Components grid:
   * that grid is where the parts are ENTERED, so scoping it by the parts already
   * entered is circular — it offers only what is there and so refuses the next
   * one.
   *
   * The Process sheet is the opposite end of that relationship. It CONSUMES the
   * list the Components grid produces and never adds to it, so there is no
   * circle to close: "which panel is this printing done on" can only sensibly
   * answer with a panel this style actually has. The helper survived 08-25 as a
   * function precisely so this could come back at the call site — its own note
   * said so — and this is it.
   *
   * The SOURCE moved with the Style unwiring and nothing else did.
   * `garment_style_components` used to be reached through `style_id`; with Style
   * typed (0457) there is no id to hop through, and `StyleRow.components` carries
   * the same `component_id` on a nearer source. That is the same read
   * `scopedComponents` already makes for the Combos overlay — the OTHER consumer
   * of this list, and the precedent for scoping consumers while leaving the
   * producer alone.
   *
   * ## NO FALLBACK TO THE FULL MASTER, AND THAT DIFFERS FROM `scopedComponents`
   *
   * A style that declares no parts gets an EMPTY list here, and the sheet says
   * "This style declares no components" — a placeholder it has carried since
   * 0421 and which has been unreachable for as long as this returned the master.
   *
   * The combo grid falls back to everything and states its reason: a component
   * there is `required`, so an empty list would be an unusable cell blocking an
   * order over a master nobody has filled in. **That reason does not hold here.**
   * The Process sheet's Component cell is deliberately NOT required (a Component
   * Process whose panel is still being decided is a legitimate half-answer), so
   * an empty list costs the operator nothing — the row still saves. What the
   * fallback WOULD cost is the thing this change exists to stop: a generic
   * master list offering panels this garment does not have.
   *
   * ## A HELD VALUE ALWAYS SURVIVES — the half that bites
   *
   * The ids already named by this style's process rows are unioned in. Same rule
   * as "Disabled rows": a component a saved row names must keep resolving even
   * if the style has since dropped it from its Components grid, or the cell
   * renders EMPTY over a filled value and `writeChildren` nulls it on the next
   * save. It has to happen HERE rather than in `componentsForKind`, whose
   * held-value branch can only search the list it was handed — harmless while
   * that list was the whole master, and the exact failure this scoping would
   * otherwise introduce.
   *
   * Unioned across ALL of the line's process rows rather than resolved per cell,
   * because the sheet takes one list for the whole grid. The extra ids are only
   * ever ones this style already committed to, so no row can reach a panel a
   * sibling row invented.
   */
  const styleComponentOptions = (r: StyleRow): ComponentOption[] => {
    const ids = new Set(
      [
        ...r.components.map((c) => c.component_id),
        ...r.processes.map((p) => p.component_id),
      ].filter(Boolean) as string[],
    );
    return data.componentRows.filter((o) => ids.has(o.id));
  };

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
        /* THE TYPED REF IS THE NAME (2026-08-25). It used to prefer the master's
           `name` and fall back to the ref; with Style typed there is one string
           and it answers both. "(unnamed line)" still stands in for a line the
           operator has not named yet, so a price row never points at a blank. */
        name: r.style_ref_no || "(unnamed line)",
      })),
    [styles],
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
   * The style line's Order Unit — PCS or SET (client 2026-08-11).
   *
   * IT COMES FROM THE LINE'S OWN COORDINATES SINCE 2026-08-25, and this is the
   * one thing the Style unwiring actually took away. The unit used to resolve
   * through `style_id` to the master's `unit_kind` — "a fact the STYLE owns …
   * nothing here to store and nothing to keep in step" — and a typed Style has no
   * id to resolve. Three ways out were open:
   *
   *   1. leave the column blank, which is honest and loses a value the client
   *      asked for by name and which Price Details STORES;
   *   2. add a `unit_kind` column to the line and ask the operator a second
   *      question — a migration, and a question the order already answers;
   *   3. read `COORDINATE_LIMITS` backwards, which is this.
   *
   * A Piece is one garment (one coordinate) and a Set is two or more; the ranges
   * are disjoint, so a filled coordinate count names exactly one kind. The rule
   * lives in `unitKindFromCoordinates` beside the limits it inverts, not here,
   * and `scripts/check-style-rules.mts` asserts the two directions agree AND that
   * the ranges stay disjoint — the derivation stops being legitimate the day they
   * overlap, and that assertion is what would say so.
   *
   * BLANK UNTIL THE FIRST COORDINATE IS ENTERED, never defaulted to PCS: this
   * word is written into `price_details.unit`, so a guess here is a guess that
   * gets stored. `filledCoordinates` ignores the blank row the grid seeds.
   *
   * The text half is unchanged: Price Details still stores this word in its own
   * `unit` column, which is what "pulled from the Order Unit established in the
   * initial Style Entry" means — it just no longer comes from a UoM master, and
   * now not from the Style master either.
   */
  /**
   * ASKED AGAIN SINCE 2026-08-27, and the derivation stays as the FALLBACK.
   *
   * The client's words: "that order unit need to show pcs and set". The
   * coordinate derivation above is sound — the ranges are disjoint and read
   * backwards exactly — and it was UNREACHABLE: measured on the live database,
   * `garment_order_amendment_style_coordinates` held 0 rows against 4 style
   * lines, so `filledCoordinates` returned 0 on every line ever entered and the
   * column was blank on 100% of orders. `price_details.unit` is seeded from
   * this, so all 14 stored price rows carry an empty unit too. A derivation
   * whose only input is never captured is not a fallback, it is a blank column
   * with an explanation attached.
   *
   * SO THE STORED ANSWER WINS AND THE DERIVATION CATCHES THE REST. A line saved
   * before 0471 has no `unit_kind`, and where it happens to carry coordinates
   * they still say what it is — dropping that would blank a value the screen
   * could already work out. Nothing is back-filled: NULL is "not answered", and
   * writing PCS onto four real PO quantities would put an invented unit on an
   * invoice, which is the exact thing the old rule was right to refuse.
   */
  const unitTextOf = (r: StyleRow) =>
    orderUnitLabel(
      r.unit_kind ?? unitKindFromCoordinates(filledCoordinates(r.coordinates)),
    );

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

  /**
   * THE TWO AUTO-DETERMINED HEADER FIELDS — Unit and Date (client 2026-08-31).
   *
   * Both are filled in for the operator (the Unit from `startingLocationId`
   * above, the Date from `today()` in `openAdd`), both are still mandatory for
   * the record, and the client asked for Tab to bypass them so the cursor lands
   * on Customer and nobody edits the logged entry date by reflex.
   *
   * READ OFF THE FORM, NOT OFF THE PROFILE, and that is the fallback the ask
   * needs. "Is there a default location on the profile?" answers the wrong
   * question: it is true on a new order and says nothing about a saved one whose
   * Unit is null, or about a field the operator has cleared by hand. The value ON
   * THE FIELD is the only thing that decides whether bypassing it is safe, and it
   * is self-correcting — the moment the auto-determination has failed or been
   * undone, the field is back on the Tab path wearing its star.
   *
   * WHAT HAPPENS WITH NO DEFAULT LOCATION AT ALL, spelled out because it is the
   * difference between this feature and a lockout: `startingLocationId` already
   * falls back to the first ACTIVE unit, so `form.location_id` is null only when
   * the profile has no default AND no unit is active (or a stored order holds
   * none). `autoFilledField(false)` then puts Unit back on the Tab path AND back
   * under the hold, so the operator meets it exactly where they always did and
   * can fill it in. An auto-filled-and-unreachable field with a dead Save and
   * nothing on screen to say why is the failure this pairing exists to make
   * unrepresentable — see `autoFilledField` in lib/focus.ts.
   */
  const unitAuto = autoFilledField(!!form.location_id);
  const dateAuto = autoFilledField(!!form.amend_date);

  /**
   * THE CUSTOMER LIST, WITH CASE-DUPLICATES FOLDED INTO ONE ENTRY (client
   * 2026-08-31: "any matching names that differ only by capitalisation (e.g.
   * 'ROJA' and 'roja') must be merged into a single entry").
   *
   * THE FOLD IS HERE AND NOT IN THE SERVICE, deliberately, and the reason is the
   * argument `collapseCaseDuplicates` states at length: these are distinct
   * `customers` rows with distinct uuids, so a fold picks a WINNER — and if the
   * order in front of the operator holds the loser, its Customer field renders
   * empty and the next save writes that blank over a good FK. That is the same
   * silent loss the "Disabled rows" rule exists to prevent. `getAmendmentFormData()`
   * takes no arguments and cannot know which uuid this order holds; the screen
   * can, so `form.customer_id` is passed and always survives.
   *
   * `heldId` IS A REQUIRED PARAMETER over there, which is what makes forgetting
   * it a compile error rather than a bug that only shows on legacy data.
   *
   * WHY THIS IS A LEGACY-DATA WORKAROUND AND SAYS SO. Values have been stored in
   * CAPITALS since 2026-08-18 — the transform is in the primitive, so a customer
   * typed since then cannot be a case-twin of one typed after it. Every pair this
   * folds is therefore a row saved before the flip, and the fold hides one real
   * master row from the operator. `folded` is why the screen says so out loud
   * (below the rows): a workaround nothing ever asks to be fixed becomes the fix.
   */
  const customerFold = useMemo(
    () => collapseCaseDuplicates(data.customers, form.customer_id),
    [data.customers, form.customer_id],
  );

  /**
   * MERCHANDISERS — narrowed to the ones who actually are one, never dropping the
   * employee this order already names, AND carrying the line to show when the
   * narrowing leaves nothing.
   *
   * `merchandiserOptions` OWNS ALL THREE, and this call site owns none of them.
   * That is the point: it returns the same `{ items, hint, shortHint }` shape as
   * `nominatedVendorOptions` because it is the same rule — empty-and-explain,
   * never a silent fallback to the full list. Widening to every employee when
   * none matches would let an order be attributed to somebody who is not a
   * merchandiser and would guarantee nobody ever learns the master is
   * unpopulated (AGENTS.md, "Nominated vendors").
   *
   * This screen had its own three-line version of the narrowing and its own
   * two-branch empty message for about half an hour. Both are gone. A rule
   * re-derived at a call site is the drift AGENTS.md names in half its sections;
   * the fact that my copy and T1's agreed is luck, not a property.
   *
   * `is_merchandiser` is Designation *or* Department = "Merchandiser", computed
   * in the service and arriving as a FLAG rather than a SQL filter — the options
   * bundle is fetched once for the list screen and the editor and cannot know
   * which employee an order holds. So the held row is re-appended by the helper,
   * which is what stops a merchandiser who has moved desks vanishing from every
   * order they ever booked and the next save blanking the FK. `inactive` (0299's
   * spelling, NOT `blocked`) is handled by the picker itself.
   */
  const merchandisers = useMemo(
    () => merchandiserOptions(data.merchandisers, form.merchandiser_id),
    [data.merchandisers, form.merchandiser_id],
  );

  /* The empty-and-explain half moved INTO `merchandiserOptions` (T1, above).
     This screen briefly carried its own two-branch message; a rule stated at a
     call site is the drift AGENTS.md names in half its sections, and the two
     copies agreeing was luck rather than a property. `shortHint` is what the
     picker's placeholder renders — see the field. */

  const set = (patch: Partial<HeaderForm>) => setForm((f) => ({ ...f, ...patch }));

  /**
   * ORDER INFO ▸ DELI.DT, AND EVERY QUANTITY ROW STILL FOLLOWING IT
   * (client 2026-08-31: "Create a reactive state binder between the Order Info
   * tab's delivery date state and the Quantity tab's delivery date field …
   * Keep both fields fully editable. If the user manually changes the master
   * date or needs to adjust the shipment buffer to D-2 or D-3, they can
   * override the default").
   *
   * THOSE TWO SENTENCES PULL AGAINST EACH OTHER and this is where the pull is
   * resolved. A literal reactive bind overwrites the override the same sentence
   * promises; a pure one-time seed leaves every existing row stale the moment
   * the header date is corrected, which is the commonest edit there is. So the
   * rule is FOLLOW WHILE UNTOUCHED: a row moves with the header for exactly as
   * long as it still holds what the header last gave it.
   *
   * ## NO `touched` FLAG, AND THAT IS THE POINT
   *
   * The obvious implementation is a per-row boolean. It would have to be kept
   * out of `toPayload` (which is a hand-written field list, so it would be —
   * this time), out of `toRows` on the way back in, and out of `diff.ts`; and a
   * loaded order would have no honest value for it, since nothing records
   * whether a date stored last month was typed or inherited.
   *
   * Comparing against the PREVIOUS header value answers the same question with
   * no state at all: a row holding `prev` is a row that never disagreed. Both
   * operands are in scope right here, in the one handler that can change the
   * header date — so there is no effect, no ref, and nothing that can fire
   * while the operator is mid-keystroke in some other field.
   *
   * A row whose date was typed by hand to the SAME value as the header follows
   * too. That is not a miss: they agreed with the master date, and the master
   * date moved.
   *
   * ## EARLIER SHIPMENT IS ASKED THE SAME QUESTION SEPARATELY
   *
   * It follows only while it still equals `dayBefore` of the date the row is
   * leaving — i.e. while it is the untouched D-1 default. A row carrying a D-3
   * buffer keeps the DATE the operator typed rather than the OFFSET.
   *
   * Preserving the offset was the other candidate and is arguably kinder, but
   * it is an inference: the client said D-1 is the default and that an operator
   * may override it, not that an override is a rolling relationship. Keeping
   * one rule for both fields is what makes the behaviour explainable in a
   * sentence — "it follows until you change it" — and the offset version needs
   * two.
   *
   * `blankQuantity` seeds a NEW row from the same pair of values; the note
   * there records why neither half works without the other.
   */
  const setHeaderDeliveryDate = (next: string) => {
    const prev = form.delivery_date;
    set({ delivery_date: next });
    if (next === prev) return;
    setQuantities((xs) =>
      xs.map((x) => {
        if (x.delivery_date !== prev) return x;
        const followsShip =
          !x.earlier_shipment_date || x.earlier_shipment_date === dayBefore(prev);
        return {
          ...x,
          delivery_date: next,
          earlier_shipment_date: followsShip
            ? dayBefore(next)
            : x.earlier_shipment_date,
        };
      }),
    );
  };

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
    /* CLEARED, NOT RE-SEEDED HERE. `openOneRow()` at the foot of this function
       is what fills it from the master — one seeder, so a new order and a saved
       one with no ladder are answered by the same code. Leaving this line out
       would carry the PREVIOUS document's `row_uid`s into a blank form, which is
       worse than the stale rows the missing `setQuantities` used to cause: those
       read as data the operator entered, these would silently claim another
       order's completion records. */
    setTaRows([]);
    setAttachments([]);
    /* A FRESH FOLDER PER RECORD. Without this, a new order started after
       another would upload into the previous one's folder — harmless for
       retrieval, since `storage_path` is stored per row, and misleading to
       anyone reading the bucket. */
    setUploadFolder(crypto.randomUUID());
    setPendingSeed(null);
    setSeeded(false);
    // A NEW DOCUMENT HAS LISTED NOTHING, so every style the operator types is
    // still owed its combo row. See `listedComboStyles`.
    listedComboStyles.current = new Set();
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
      is_set_pack: r.is_set_pack ?? false,
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
      styleCoordinates: r.style_coordinates,
      packComponents: r.pack_components,
      styleComponents: r.style_components,
      styleProcesses: r.style_processes,
      dyeings: r.dyeings,
      prints: r.prints,
      structures: r.structures,
      combos: r.combos,
      priceDetails: r.price_details,
      approvalQtys: r.approval_qtys,
      packTypes: r.pack_types,
      quantities: r.quantities,
      /* THE SAVED T&A LADDER (0481), through the SAME mapping as its nine
         neighbours — see `toRows`. What comes back matters more here than
         anywhere else on this screen: each row's `row_uid` is the anchor a
         completion entered on the DASHBOARD is matched by, so a ladder read
         back with fresh uuids would save cleanly and destroy every actual
         date on the order. `toRows` takes it verbatim.

         An amendment saved BEFORE this tab existed carries none, and
         `openOneRow` inside `applyRows` then seeds the master's ladder — so
         an old order opens on the ladder it would have had. */
      taActivities: r.ta_activities,
    });
    /* NOT PART OF `applyRows`, deliberately: that mapping is shared with the
       ORDER SEED, and an order carries no attachments. Folding files into it
       would make every seeded amendment clear the documents of the one it was
       seeded from. */
    setAttachments(
      (r.files ?? []).map((f) => ({
        key: newKey(),
        doc_kind: f.doc_kind ?? "",
        file_name: f.file_name ?? "",
        storage_path: f.storage_path ?? "",
        mime_type: f.mime_type ?? "",
        size_bytes: f.size_bytes ?? 0,
        /* WHICH STYLE THE FILE BELONGS TO (0479). `?? null` is not defensive
           padding: NULL is a REAL value here — an order-level document, which
           is every file stored before this column existed, and the state a file
           is demoted to when its style ref is retyped. Omitting the key would
           have been worse than wrong: the row would round-trip through the
           payload with the link undefined and the FIRST SAVE would null the
           column on every existing file, which is the same "seeding drops what
           it did not know about" failure the comment above this block records
           for attachments as a whole. */
        style_ref_no: f.style_ref_no ?? null,
      })),
    );
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
    /* FOUR NOW, NOT TWO. PO No and Merchandiser joined `amendmentInput` as
       non-nullable on 2026-08-31, so the compiler refuses the payload without
       them for the same reason it refused it without the first two. Ordered as
       the fields are on screen, so the first thing the operator is told about is
       the first thing they meet. */
    const po = form.po_no.trim();
    if (!form.location_id || !form.customer_id || !po || !form.merchandiser_id) {
      toastError(
        !form.location_id
          ? "Pick the Unit — the SC No is numbered under it."
          : !form.customer_id
            ? "Customer is required."
            : !po
              ? "PO No is required."
              : "Merchandiser is required.",
      );
      return;
    }
    const payload = {
      is_draft: asDraft,
      sales_order_id: form.sales_order_id,
      location_id: form.location_id,
      amend_date: form.amend_date,
      customer_id: form.customer_id,
      /* `po`, the trimmed local from the guard above — not `form.po_no || null`.
         The column is mandatory now, so there is no null to send; and sending
         the untrimmed value would hand Zod a string the guard has already judged
         by a different rule. `po_date` stays optional and unchanged: only the
         NUMBER became mandatory. */
      po_no: po,
      po_date: form.po_date || null,
      merchandiser_id: form.merchandiser_id,
      season: form.season || null,
      delivery_date: form.delivery_date || null,
      excess_pct: numOrNull(form.excess_pct) ?? 0,
      rejection_rule_id: form.rejection_rule_id,
      pack: form.pack,
      is_set_pack: form.is_set_pack,
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
        // The Style master's header fields, merged onto the line (0461).
        approved_sample_id: r.approved_sample_id,
        article_no: r.article_no || null,
        style_category: r.style_category || null,
        style_category_id: r.style_category_id,
        style_description: r.style_description || null,
        order_unit_id: r.order_unit_id,
        plan_unit_id: r.plan_unit_id,
        /* ORDER UNIT (0471). NARROWED through `isUnitKind`, not `|| null`:
           `StyleRow.unit_kind` is a plain string (it is what a `<Select>`
           hands back), the payload schema is the two-value enum, and the
           column carries the matching CHECK. One predicate turns the loose
           value into the strict one and answers the Select's empty option in
           the same step — "" is not a kind, so it is NULL, which is what "not
           answered" is stored as. */
        unit_kind: isUnitKind(r.unit_kind) ? r.unit_kind : null,
        /* PIECES, ALWAYS — and on a set pack that means the DERIVED figure,
           not the box the operator can no longer type in (0467).
           `packs x pieces-per-pack` is computed here rather than mirrored into
           state on every keystroke: state would need an effect keeping two
           numbers in step, and the one that got stale would be the one every
           BOM engine reads. `?? 0` because a set pack whose composition is not
           finished yet is refused by `packProblems` before Save runs — the
           zero can never be what gets stored. */
        /* THROUGH `stylePoQty` — see its note. This site used
           `numOrNull(r.po_qty) ?? 0` where the other used
           `Number(r.po_qty) || 0`, and the two are NOT the same function: `??`
           only catches null, so `numOrNull("abc")` is NaN and passed NaN
           straight into the payload, where JSON turns it into null and the
           column silently takes nothing. The shared helper answers 0, which is
           what the box shows and what every other reader of this figure
           already assumed. */
        po_qty: stylePoQty(r),
        /* PACKS, and `numOrNull` NOT `?? 0` (0467): a blank box means this is
           not a set pack, and a 0 would claim the buyer ordered none. */
        packs_ordered: form.is_set_pack ? numOrNull(r.packs_ordered) : null,
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
      /* THE COORDINATES (0461), flattened exactly as `style_sizes` above and
         just as deliberately unfiltered: `normalizeStyleCoordinates` drops the
         blank, the orphaned and the duplicated. */
      style_coordinates: styles.flatMap((r) =>
        r.coordinates.map((c) => ({
          sno: 0,
          style_ref_no: r.style_ref_no || null,
          coordinate_id: c.coordinate_id,
        })),
      ),
      /* THE PACK MEMBERS (0467), flattened exactly as the coordinates above
         and just as deliberately unfiltered: `normalizePackComponents` drops
         the blank, the orphaned and the duplicated, and it is the copy
         `lib/data-io` would also pass through. A second filter here would be a
         second answer to one question.

         SENT WHATEVER THE Set Pack SWITCH SAYS, the same call `pack_types` and
         the Multi Order columns both make: turning the switch off HIDES the
         composition, and hiding is not emptying. `writeChildren` deletes and
         reinserts, so a member the payload stops carrying is one the next
         ordinary save destroys. */
      pack_components: styles.flatMap((r) =>
        r.pack_components.map((c) => ({
          sno: 0,
          style_ref_no: r.style_ref_no || null,
          coordinate_id: c.coordinate_id,
          combo: c.combo || null,
          qty_per_pack: numOrNull(c.qty_per_pack) ?? 1,
        })),
      ),
      /* THE COMPONENTS (0457), flattened exactly as `style_sizes` above.

         UNFILTERED HERE ON PURPOSE, the same call the sizes and the processes
         both make: `normalizeStyleComponents` drops the blank, the orphaned and
         the duplicated, and it is the copy `lib/data-io` would also pass
         through. A second filter here would be a second answer to one question.

         `comp_type` and `item_id` are sent even though neither has a cell.
         Leave them out and the first save NULLS what the seed copied off the
         Style master — `writeChildren` rewrites this grid wholesale, so absent
         is not the same as frozen. */
      style_components: styles.flatMap((r) =>
        r.components.map((c) => ({
          sno: 0,
          style_ref_no: r.style_ref_no || null,
          coordinate_id: c.coordinate_id,
          component_id: c.component_id,
          fabric_category_id: c.fabric_category_id,
          comp_type: c.comp_type || null,
          item_id: c.item_id,
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
      /* BOTH FIELDS, and `sno: 0` because `normalizePrints` renumbers — the
         same shape every child grid on this payload uses. */
      prints: prints.map((r) => ({
        sno: 0,
        print_id: r.print_id,
        print_name: r.print_name || null,
      })),
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
          /* SENT WHATEVER THE FABRIC TYPE SAYS, the same call `fabric_type`,
             `combo_description` and `pack_types` all make on this payload:
             `writeComboTree` DELETES AND REINSERTS the whole tree, so a key the
             payload stops carrying is one the next ordinary save destroys. The
             control hides when the fabric is not Yarn Dyed — and hiding is not
             emptying. What DOES empty it is the operator moving the fabric off
             Yarn Dyed, which the `<Select>`'s own onChange does explicitly, in
             one place, where the decision is visible. Trimming, upper-casing and
             de-duplicating are `amendmentComboStructureInput`'s (AGENTS.md,
             "CAPITALS": the transform belongs in the Zod schema so a data-io
             import gets it too), so nothing is normalised twice here. */
          yarn_colors: st.yarn_colors,
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
      pack_types: packTypes.map((r) => ({
        sno: 0,
        pack_type: r.pack_type || null,
      })),
      /* FLATTENED OUT OF THE PACK TYPE ROWS (0472), the same shape the style
         sizes take: nested on screen so a line cannot outlive its method, flat
         here because that is how the table stores it. `pack_type` carries the
         binding, and `normalizePackTypeLines` drops any line whose method did
         not survive the save.

         `style` IS SENT AS THE REF. Legacy's two columns were the master's code
         and its name; with Style typed the ref answers both — `price_details`
         and `combos` already store it that way, and re-deriving it here from a
         master that is no longer consulted would blank the column. */
      pack_type_lines: packTypes.flatMap((r) =>
        r.lines.map((l) => ({
          sno: 0,
          pack_type: r.pack_type || null,
          style_ref_no: l.style_ref_no || null,
          style: l.style_ref_no || null,
          combo: l.combo || null,
          qty: numOrNull(l.qty) ?? 0,
        })),
      ),
      quantities: quantities.map((r) => ({
        sno: 0,
        country_id: r.country_id,
        style_ref_no: r.style_ref_no || null,
        style_no: r.style_no || null,
        consignee_id: r.consignee_id,
        assortment_type_id: r.assortment_type_id,
        /* THE RESOLVED METHOD, not the row's stored one (0473). The column is a
           RECORD of which composition this destination's pieces were exploded
           from, so it must agree with what was actually used — and the resolver
           is what was used. Writing back the stale value would leave a saved
           document naming a method its own numbers no longer match, which is
           worse than naming none. */
        pack_type: resolvedPackTypeFor(r) || null,
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
        /* DERIVED FROM THE ASSORTMENT TYPE, not from a checkbox (0432). The
           column's meaning — "the size cells are the ratio inside ONE carton" —
           is exactly what Solid / Assort Size says, so asking it twice could
           only produce a row whose flag contradicts its own type. The column
           stays because a reader of the row needs it to interpret the size
           cells without joining back to the lookup table. */
        is_ratio_wise_pack: assortModeOf(r) === "assort",
        ratio_for: r.ratio_for || null,
        is_single_style_pack: r.is_single_style_pack,
        master_carton_name: r.master_carton_name || null,
        inner_carton_name: r.inner_carton_name || null,
        pack_description: r.pack_description || null,
        assort_lines: r.assort_lines.map((l) => ({
          sno: 0,
          /* SENT WHATEVER THE SINGLE/MULTIPLE SWITCH SAYS — the same rule
             `po_no` states two fields up. Flipping back to Single Style HIDES
             the column; hiding is not emptying, and an operator who flips it by
             accident and saves would otherwise lose every line's style with
             nothing on screen to show what went. */
          style_ref_no: l.style_ref_no || null,
          combo: l.combo || null,
          no_of_cartons: numOrNull(l.no_of_cartons) ?? 0,
          // `?? 1`: a multiplier, so an unanswered box is "one inner per
          // carton", never zero. See the Zod input's note (0432).
          inners_per_carton: numOrNull(l.inners_per_carton) ?? 1,
          /* CARRIED VERBATIM (0473). It decides how every size cell beneath is
             READ, so a save that dropped it would turn a box count into a piece
             count on the next load — the order under-read by the pack size,
             silently, which is the failure the whole feature exists to stop. */
          is_pack_row: l.is_pack_row,
          sizes: l.sizes.map((z) => ({
            size_id: z.size_id,
            // `?? 0` and NOT `|| 0`: an explicit 0 is a real ratio entry
            // ("this carton has no XL") and must survive the round trip.
            qty: numOrNull(z.qty) ?? 0,
          })),
        })),
      })),
      /* THE WHOLE DERIVED TREE, not the state (0435).
         `approvalQtys` state holds only the lines someone typed into; the
         document has to record every line it was agreed against, so the tree is
         flattened here. Orphans ride along inside it — a typed number whose
         colour was renamed or whose size was removed is still the operator's
         work, and a save that dropped it would delete it silently.

         `approvalTree` is declared BELOW this function and read from inside it.
         That is safe and not accidental: `submit` runs from a click, long after
         the render that initialises the const, and it is unreachable on the list
         render where the early return skips the declaration entirely. Same
         closure the JSX below relies on. */
      approval_qtys: flattenApprovalTree(approvalTree).map((r) => ({
        sno: 0,
        style_ref_no: r.style_ref_no || null,
        style: r.style || null,
        article_no: r.article_no || null,
        combo: r.combo || null,
        combo_description: r.combo_description || null,
        size_id: r.size_id,
        qty: r.qty,
        approval_qty: r.approval_qty,
      })),
      /* THE ATTACHED DOCUMENTS (0416). `sno` is stamped server-side by
         `normalizeFiles`, like every other child here — the grid's own order is
         the array order and nothing on screen types a number.

         `style_ref_no` IS SENT UNFILTERED (0479), the same call `style_sizes`
         and the four other per-style children make one block up: the server
         normalizer owns the "does this ref name a live style" question, and a
         second copy of that rule here would be a second answer to it.

         WHERE IT DIVERGES FROM THEM — and this is the reason the divergence is
         worth stating on both sides — is what the normalizer does with a ref
         that matches nothing. A size whose style is gone is dropped; a FILE is
         demoted to order-level instead, because the object is still sitting in
         `garment-order-docs` and dropping the row is the one way to make it
         unreachable. */
      files: attachments.map((f) => ({
        sno: 0,
        doc_kind: f.doc_kind || null,
        file_name: f.file_name || null,
        storage_path: f.storage_path || null,
        mime_type: f.mime_type || null,
        size_bytes: f.size_bytes ?? null,
        style_ref_no: f.style_ref_no || null,
      })),
      /**
       * THE T&A LADDER (0481) — four keys, and the ones that are MISSING are
       * the point.
       *
       * `target_date` IS NOT SENT. `amendmentTaActivityInput` does not accept
       * it: the server computes it with the same `orderTaLadder()` this screen
       * renders from, so the client cannot state an opinion about a value the
       * server also decides. That is a stronger guarantee than agreeing —
       * "BOTH HALVES OR NEITHER", which is what makes storing a derived date
       * safe at all.
       *
       * `actual_date`, `status` and `notes` ARE NOT SENT EITHER. They belong to
       * the dashboard, are entered days or weeks after this save by somebody
       * else, and are carried across `writeChildren`'s delete-and-reinsert by
       * `row_uid` — from the DATABASE, never from this payload. A stale form
       * cannot then carry a completion value at all, so the merge has nothing
       * to prefer and no order in which to prefer it.
       *
       * `row_uid` IS THE ONLY THING THAT SURVIVES, so it is sent verbatim: the
       * uuid `seedTaLadder` / `blankTaRow` minted, or the one `openEdit` read
       * back. Never `key` (React's, dies with the mount) and never re-minted.
       *
       * `sno: 0` like every other grid here — the normalizer renumbers, and the
       * array order IS the execution order, since nothing on screen sorts the
       * ladder after `seedTaLadder` built it.
       *
       * UNFILTERED, deliberately, the same call `style_sizes` and `files` make:
       * `normalizeTaActivities` owns "is this row worth storing", and a second
       * filter here would be a second answer to one question — and it is the
       * copy `lib/data-io` would bypass if orders ever gained an import path.
       */
      ta_activities: taRows.map((r) => ({
        sno: 0,
        row_uid: r.row_uid,
        activity_id: r.activity_id,
        days_required: numOrNull(r.days_required),
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

  /* ---------------- T&A (0481) ----------------

     THE HOOKS ARE UP HERE AND THE COLUMNS ARE DOWN THERE, and the split is not
     a preference: `if (mode === "list")` below is an EARLY RETURN, so a
     `useMemo` declared after it runs on the editor render and is skipped on the
     list one, and React counts hooks by position. Every other memo on this
     screen sits above that line for the same reason.

     THIS SCREEN HAS ALREADY ANSWERED THAT THE OTHER WAY, three times, and both
     answers are right. `orderVal`, `quantityBreakup` and `orderStructureIds`
     are plain derived values BELOW the return, with a note saying why: "nothing
     to memoise: two passes over the order's own style lines". The ladder is the
     case where the memo earns its keep — the whole form is one `useState`, so
     every keystroke on Prices or Combos re-renders this component, and without
     the memo each one would re-walk ten working-day chains that cannot have
     changed. So: cheap and local, declare it below; recomputed-but-unrelated,
     hoist it here.

     `taProblems` and `taColumns` are plain expressions, so they stay beside the
     other column definitions where they read in context. */

  /**
   * The `ta_activities` master, by id — the Dept column and every refusal
   * sentence read through this rather than off the row.
   *
   * `department` is deliberately NOT copied onto `TaRow`. It belongs to the
   * activity, so a copy on the order goes stale the day somebody moves Knitting
   * from one department to another, and an order would then schedule work for a
   * department that no longer does it. Same call `AmendmentTaActivity` makes.
   */
  const taActivityById = useMemo(
    () => new Map(data.taActivities.map((a) => [a.id, a])),
    [data.taActivities],
  );

  /**
   * What to CALL an activity, in one place.
   *
   * `name` BEFORE `short_name`, and the precedence is not arbitrary: this string
   * is what a ladder refusal PRINTS, so it has to be the string the Activity
   * cell is showing. A refusal reading "KNIT: enter how many days it needs"
   * beside a cell reading "KNITTING" sends the operator hunting for a row that
   * is already in front of them.
   *
   * WHICH ONE THE CELL SHOWS WAS TRACED, NOT ASSUMED, because `DataPicker`'s
   * trigger reads `selected?.short ?? selected?.label` and a `short` would win.
   * The chain: `RecordPicker` builds its rows through `pickerIdentityParts`,
   * which returns `{label, sublabel}` and NO `short` — only
   * `LookupDialogPicker` ever sets that field. So `short` is undefined here, the
   * trigger falls through to `label`, and with the default `identity="name"`
   * that is the activity's NAME. The short name is not lost: it arrives as the
   * row's `code` (the feeder aliases it, since `ta_activities` has no `code`
   * column) and renders as the SUBLABEL, so the operator sees both.
   *
   * The consequence to keep in mind if that ever changes: give this picker
   * `identity="code"` and the cell starts showing the short name, at which point
   * this precedence must flip with it or the two disagree again.
   *
   * `useCallback` ONLY so the memo below can depend on it honestly. It is a
   * two-line lookup and memoising it buys nothing on its own — but the ladder is
   * recomputed on every keystroke and this is one of its inputs, so the
   * alternatives were both worse: listing `taActivityById` and silencing
   * `exhaustive-deps` states a dependency the code does not actually have, and
   * inlining the lookup would put the naming rule above inside the memo where
   * the picker's own identity choice can no longer be read beside it.
   */
  const taLabel = useCallback(
    (id: string | null) => {
      const a = id ? taActivityById.get(id) : undefined;
      /* TRIMMED, and `||` rather than `??`. Both matter for one reason: this
         string is what a refusal PRINTS, and `backwardSchedule` falls back to
         "A process" only on an EMPTY one — so a name that is whitespace, or a
         `short_name` that is "" rather than null, would produce a sentence
         reading `" : enter how many days it needs"` with nothing in front of the
         colon. `??` would let "" through; `||` and the trim together mean the
         fallback fires on anything that would print as blank. */
      return a?.name?.trim() || a?.short_name?.trim() || "";
    },
    [taActivityById],
  );

  /**
   * THE LADDER — every Target Date on this tab, plus the anchor, the start date
   * and the float.
   *
   * ## ONE FUNCTION, TWO CALLERS, AND THAT IS WHAT MAKES A STORED DATE SAFE
   *
   * `target_date` is STORED on the row (the one place this module breaks the
   * house "derive, never store" rule), because the daily dashboard asks Postgres
   * "what is due today across every open order" and a working-day ladder with a
   * holiday set is not a question SQL can answer. What makes that safe is that
   * the screen and the server action resolve it through the SAME
   * `orderTaLadder()` — "BOTH HALVES OR NEITHER", the rule `purchase_qty`
   * already follows. So this screen does not send `target_date` at all
   * (`amendmentTaActivityInput` does not accept it), and cannot state a second
   * opinion about a value the server also decides.
   *
   * ## THE ORDER IS NEVER REVERSED HERE
   *
   * `orderTaLadder` reverses on the way in and back on the way out, there and
   * nowhere else — its header says why, quoting `backwardSchedule`: "a list that
   * has to be reversed before use is a list that will be reversed twice by
   * someone." `taRows` is execution order in, execution order out. Do not sort,
   * reverse or re-key the result; a ladder rendered upside down produces a
   * complete, plausible set of dates that are simply wrong, which is the failure
   * nobody reports because it does not look like one.
   *
   * ## NO `now` IS PASSED, DELIBERATELY
   *
   * The float is "how many days from today", and today FOR THE OPERATOR is what
   * `lib/calendar.ts`'s `today()` answers — the local day, not
   * `toISOString().slice(0,10)`, which reads a day behind for the first five and
   * a half hours of every Tirupur day. This repo has shipped that bug twice
   * (`raagam-utc-vs-local-today`). `now` exists on the signature so the VECTORS
   * do not depend on the day they run; a screen passing one would be a screen
   * with its own idea of today.
   *
   * ## `holidays` IS NOT PASSED EITHER, AND THAT IS A KNOWN GAP
   *
   * `lib/ta/schedule.ts` takes an optional holiday set and `holidaySet()` will
   * expand the `holidays` master (0256) into one, but nothing on this screen
   * loads that master and `AmendmentFormData` does not carry it. So the ladder
   * counts Sundays off and nothing else, exactly as `backwardSchedule` does by
   * default — and its header is explicit that this is the honest state: "a
   * default that silently read an empty master would be worse than a hardcoded
   * Sunday — it would look configured and behave like calendar days." Wiring the
   * master later is a caller change here and a feeder change in `service.ts`;
   * it is not a signature change, and it must land on the SERVER side in the
   * same edit or the two halves stop agreeing.
   */
  const taLadder = useMemo(
    () =>
      orderTaLadder({
        rows: taRows.map((r) => ({
          row_uid: r.row_uid,
          activity_id: r.activity_id,
          label: taLabel(r.activity_id),
          days_required: numOrNull(r.days_required),
        })),
        /* EVERY quantity row, unfiltered — the rule is "the earliest non-blank
           `earlier_shipment_date` across the Quantities rows" and choosing which
           rows count is `orderTaLadder`'s job, not this call site's. A blank
           string is normalised to null here because that is what the grid holds
           for "not answered"; the module reads null and nothing else. */
        quantities: quantities.map((q) => ({
          earlier_shipment_date: q.earlier_shipment_date || null,
        })),
        deliveryDate: form.delivery_date || null,
      }),
    [taRows, quantities, form.delivery_date, taLabel],
  );

  /**
   * The ladder's dates, by `row_uid` — what the Target Date cell reads.
   *
   * KEYED BY THE ANCHOR, NOT BY INDEX, even though `orderTaLadder` returns the
   * rows in the order it was given them. Index would be one fewer moving part
   * and is the wrong trade: it makes the cell's date depend on the ARRAY
   * POSITION agreeing between two structures, so the day something re-orders
   * one of them every row shows a plausible date belonging to a different step.
   * `row_uid` is the identity of the row, so a mismatch renders nothing rather
   * than the wrong thing — and nothing is what the Target Date cell already
   * shows while the ladder refuses.
   *
   * It assumes uids are distinct, which every path on this screen guarantees:
   * `seedTaLadder` and `blankTaRow` mint a fresh `crypto.randomUUID()` per row
   * and `toRows` takes stored ones, which carry `unique (amendment_id, row_uid)`.
   * `orderTaLadder` deliberately does NOT make that assumption (its vectors
   * cover two rows sharing a uid getting their own dates), so if a duplicate
   * ever reaches this Map the ladder is still right and only the display of the
   * earlier row would be lost.
   */
  const taDates = useMemo(
    () =>
      isRefusal(taLadder)
        ? new Map<string, { target_date: string; float: number }>()
        : new Map(
            taLadder.rows.map((r) => [
              r.row_uid,
              { target_date: r.target_date, float: r.float },
            ]),
          ),
    [taLadder],
  );

  // ---------------- LIST MODE ----------------
  if (mode === "list") {
    const columns: Column<GarmentOrderAmendment>[] = [
      /* "Code" WITHDRAWN 2026-08-21 (client): the internal amendment code is not
         how anyone refers to an order — RE No is, and it sits in the next
         column. Display only: `code` is still generated, still stored, still
         selected, and still the fallback identity below; dropping a COLUMN from
         a list is not the withdrawal that drops a FIELD from a form, where the
         field must also leave the Zod input (0392). Nothing is lost from the
         row either — the code cell was one of two ways to open the record, and
         the other, RowActions' Edit, is untouched. */
      {
        // "RE No", the same name the editor's field carries (see the RE No Field
        // in Order Info). It read "Order #" here — one value under two names,
        // and this is the number the whole business tracks an order by, so the
        // list and the record have to call it the same thing.
        header: "RE No",
        cell: (r) => (
          <span className="font-mono text-xs">{r.sales_order?.order_number ?? "—"}</span>
        ),
      },
      {
        header: "Customer",
        cell: (r) => <span className="text-sm">{r.customer?.name ?? "—"}</span>,
      },
      /* "Type" WITHDRAWN 2026-08-11 (client): "the company exclusively produces
         garments", so a Garment / Fabric / Made-ups toggle answers a question
         that has one answer. The column went with the field — a list column the
         operator can no longer fill reads as data they forgot to enter, and it
         would show a value on legacy rows only. `amend_type` and its stored rows
         are untouched; see the note where the field was. */
      {
        header: "Date",
        cell: (r) => (
          <span className="tabular-nums text-sm">{fmtDate(r.amend_date)}</span>
        ),
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
        cell: (r) => (
          <StatusPill tone={amendmentStatusTone(r)}>
            {amendmentStatusText(r)}
          </StatusPill>
        ),
      },
      rowActionsColumn((r) => (
        <RowActions
          /* SC No, not `code`: the label is folded into every aria-label and
             into the delete confirmation, and naming a column the operator can
             no longer see asks them to confirm against nothing. */
          label={r.sales_order?.order_number ?? r.code}
          /*
           * THE REQUIREMENT SHEET, REACHED FROM THE ROW THAT ALREADY ANSWERS
           * WHETHER IT EXISTS (2026-08-25).
           *
           * The Material BOM column beside it says `Pending` / `Recorded`, and
           * whoever reads that is exactly the person who then wants the sheet.
           * Without this they leave for Orders ▸ All Orders and re-find the same
           * order there, because THIS list does not link to `/orders/<id>` at all
           * — its eye is `RowActions`' record-view overlay, not navigation.
           *
           * ## A DISABLED ITEM SAYS WHY IN ITS OWN LABEL
           *
           * `DropdownItem` has no `title` and no hint slot, so a greyed row
           * reading “Requirement sheet” teaches nothing — the operator clicks,
           * nothing happens, and the feature reads as broken. The label carries
           * the reason instead. Opening it anyway would land on a sheet that
           * correctly refuses, which is a wasted trip the row can prevent.
           *
           * The route keys on the SALES ORDER, like `/gos` beside it: the floor
           * asks for “the sheet for HO/RE/26-27/0009”, and the document resolves
           * the current BOM itself.
           */
          menu={(() => {
            const pending = (bomStatus[r.id]?.status ?? "pending") === "pending";
            const soId = r.sales_order_id;
            return [
              /* THE ORDER SHEET NEEDS NO GATE HERE. It prints an entered garment
                 order, and every row on this list IS one — so unlike the
                 requirement beneath it there is no state in which opening this
                 lands on a refusal. */
              {
                label: soId ? "Order sheet" : "Order sheet — no order number yet",
                icon: FileText,
                disabled: !soId,
                onClick: () => router.push(`/orders/${soId}/gos`),
              },
              {
                label: !soId
                  ? "Requirement sheet — no order number yet"
                  : pending
                    ? "Requirement sheet — no Material BOM yet"
                    : "Requirement sheet",
                icon: ClipboardList,
                disabled: !soId || pending,
                onClick: () => router.push(`/orders/${soId}/requirement`),
              },
            ];
          })()}
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
  /**
   * WHAT IS STOPPING A SAVE, AND WHICH SECTION HOLDS IT (client 2026-08-18:
   * "the changes I have done in combo details section, it's not live").
   *
   * They were not live because the order had never been SAVED, and the screen
   * never said so. This gate is eight fields; five of them live in Logistic,
   * one rail row away from the Combos tab the operator was working in. The
   * footer passed `canSave` and no `onBlockedSave`, and `master-full-screen.tsx`
   * says what that means in its own words — "omit it and the button behaves
   * exactly as it always has: disabled". So Save sat dead with no toast, no
   * marked field and no count, on a screen whose rail dots mean "has rows"
   * rather than "has a problem": Combos and Quantities showed filled dots while
   * every field actually blocking the save showed a hollow one.
   *
   * The database is what settled it. `garment_order_amendment_combo_structures`
   * held ZERO rows while the combo save path — payload, action, three-level
   * insert — is correct end to end, and the one order in the system is seeded
   * demo data whose `updated_at` still equals its `created_at`. No save has ever
   * succeeded from this screen.
   *
   * DERIVED, NOT HAND-ASSEMBLED. The `&&` chain this replaces is the shape
   * `sectionValidity` exists to end: a list a screen can forget to extend, whose
   * failure is a dead button two sections away from its cause
   * (`customer-master-screen.tsx:1649` is the case that named it). The same list
   * now feeds the rail's red counts, the blocked-Save reveal and the button
   * state, so the three cannot disagree.
   *
   * THE KEYS ARE THE RAIL'S KEYS. `revealFirstProblem` hands `p.section`
   * straight to `goToSection`, so a key here that does not name a rail row is a
   * blocked Save that reports the right message and then jumps nowhere.
   *
   * The CONDITIONS are unchanged, deliberately — this is a fix for a silence,
   * not a re-negotiation of what an order needs. Whether Save should require the
   * five Logistic fields at all is a separate question for the client; if the
   * answer is no, they move out of this list rather than losing their labels.
   */
  /* `validity`, `canSave` and `revealFirstProblem` USED TO SIT HERE and now live
     beneath the assortment arithmetic (search `const validity`). The quantity
     breakup is one of the things that blocks a save (0432), and the rule that
     decides it — `assortBalanceOf` — reads `assortModeOf`, which reads
     `assortmentTypes`. A `const` arrow is not hoisted, so calling one from up
     here throws on the temporal dead zone at render. Moved rather than split:
     `sectionValidity` takes ONE list, and a second call merged afterwards is the
     hand-assembled `canSave` that module exists to end. Nothing between the two
     points reads any of the three. */

  // ---- Phase 2 grid row updaters / adders / removers ----
  /**
   * THE SET-PACK EXPLOSION (0467) — packs in, pieces out.
   *
   *     pieces per pack = SUM over the composition of qty_per_pack
   *     PO Qty          = packs ordered x pieces per pack
   *
   * DERIVED, NEVER STORED TWICE. `pieces per pack` has no column for the same
   * reason `pcs_per_pack` has none on the assortment line: it is the sum of
   * rows that are already stored, and a field for a sum is a second source of
   * truth for an addition. `packs_ordered` earns its column because it is
   * typed and derivable from nothing — the same test 0432 applied to
   * `inners_per_carton`.
   *
   * AND IT EXPLODES HERE, IN THE BROWSER, so only PIECES ever leave the screen.
   * `targetsOf` in the Material BOM engine folds an approval row through an
   * exhaustive three-branch switch and not one branch carries a multiplier;
   * neither does `fullTarget`, `totalProductionQty` or `bom-ceiling.ts`. A
   * `po_qty` holding packs would under-buy every trim and every kilo of cloth
   * by the set size, and each figure would look right on its own screen. This
   * is the same shape the carton explosion already uses one tab across.
   */
  const piecesPerPack = (r: StyleRow) => packPieces(r.pack_components);

  /**
   * `null`, NOT 0, when the pack cannot be priced out yet — an empty
   * composition or no pack count is "not answered", and a 0 in the PO Qty box
   * would read as an order for nothing. The module's standing rule: a refusal
   * is a sentence or a blank, never a zero.
   */
  const derivedPoQty = (r: StyleRow): number | null =>
    packDerivedQty(r.pack_components, r.packs_ordered);

  /**
   * A STYLE LINE'S PO QTY IN PIECES, WHICHEVER WAY THE ORDER IS BOOKED.
   *
   * The expression — pieces on a set pack, the typed box otherwise — was
   * written out twice: once in `toPayload`, once feeding `orderValue`. Both
   * carried the same note explaining that `r.po_qty` is a STALE box on a set
   * pack (it is read-only there and holds whatever was last typed before the
   * switch went on), and both were right. Two right copies of one rule is still
   * the shape AGENTS.md's "one declaration" rule refuses, and 2026-08-31 gave
   * it a THIRD consumer — the cross-tab total below — which is the point at
   * which a duplicated expression reliably becomes a divergent one.
   *
   * `?? 0` IS PART OF THE RULE, not a convenience. `derivedPoQty` answers null
   * when the Pack Composition has not been filled in, and both original call
   * sites collapsed that to 0 deliberately: a style whose pieces are not yet
   * known contributes nothing to a total, and `packProblems` is what refuses
   * the save until it is known. Anything wanting to tell "unknown" from "zero"
   * must call `derivedPoQty` directly.
   */
  const stylePoQty = (r: StyleRow): number =>
    form.is_set_pack ? (derivedPoQty(r) ?? 0) : (Number(r.po_qty) || 0);

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
       while still entering the second style.

       BELT AND BRACES SINCE 2026-08-19. The grid gates its "+ Add style" on
       `mult_ord` again, so by the time this runs the flag is already true and
       the line below is a no-op. It stays because it is the CORRECT statement
       either way — adding a second line IS the fact the toggle records — and
       because it is what keeps the two honest if the gate is ever loosened
       again. See the third-generation note on the Styles Details grid. */
    if (styles.length >= 1 && !form.mult_ord) set({ mult_ord: true });
    setStyles((xs) => [...xs, row]);
    // The new row is the one being worked on, so it opens and the finished one
    // folds — which is the whole of what the client asked for.
    setOpenStyleKey(row.key);
  };
  /**
   * THE STYLE IS TYPED (client 2026-08-25: "Style - allow it manual entry now,
   * unwire that style mapping with that field in orderinfo").
   *
   * This replaces `pickStyle`, which took a `garment_styles` id and copied the
   * master's answers onto the line. The master is off the menu (see the
   * `retired` group in lib/nav/module-groups.ts) and every field it used to seed
   * now lives on the order itself (0457 / 0461 / 0407), so the picker was a link
   * to a screen the operator can no longer reach, filling cells they can already
   * type. `style_id` is written NULL from here on.
   *
   * WHAT THE PICK USED TO DO AND WHO DOES IT NOW:
   *
   * - the header fields (Article No, Category, Description), the sizes, the
   *   coordinates and the components — TYPED, on the line. That was the whole
   *   point of merging the Style entry into Order Info.
   * - the FABRIC STRUCTURES on the Color/Print tab — still seeded, but from the
   *   line's OWN components rather than the master's. The client's sentence for
   *   that seed (2026-08-12) was "if the fabric structures are already defined in
   *   the Style Entry, they should flow into this tab automatically to avoid
   *   duplicate data entry", and the Style Entry IS this line now. So the rule is
   *   more faithful after the unwiring than before it, not less.
   * - the PRICE group and the COMBO — still seeded, from the typed ref. This half
   *   is not optional: the Prices tab has no "+ Add style price" (client
   *   2026-08-20), so if nothing seeds a group there, a PO can never be priced.
   *   Removing the picker without this would have turned a removal into data loss.
   *
   * ON BLUR, NEVER ON EVERY KEYSTROKE. A price group per prefix of the word being
   * typed is the same defect the GSM carry-down had to fix — see the Combos
   * overlay, where onChange pushed a half-typed digit down the panel.
   *
   * IT ALSO RE-KEYS. `style_ref_no` is the TEXT key that Prices, Combos,
   * Quantities, the assortment lines and Approval Qty all resolve on
   * (`styleKey`), and the save path DROPS any child naming a style the order no
   * longer carries (`normalizeStyleSizes` and friends, in actions.ts). With a
   * picker the text changed only when a different style was picked; typed, an
   * operator correcting a typo would silently take that line's prices and combos
   * with it. So a settled rename carries them across. The line's OWN children
   * (sizes, coordinates, components, processes) need nothing — they are nested on
   * the row and stamped with its ref at save time.
   *
   * PO Qty is still not seeded, for the reason it never was: it comes off the
   * buyer's order sheet and nowhere else.
   */
  const settleStyleRef = (key: string, typed: string, previous: string) => {
    const row = styles.find((x) => x.key === key);
    if (!row) return;
    const ref = typed.trim();
    const was = previous.trim();

    /* THE RENAME, CARRIED. Compared through `styleKey` so re-capitalising or
       re-spacing a ref is not a rename — those normalise to the same key, and
       rewriting every child for them would mark a loaded order dirty for a
       change that changes nothing. */
    if (was && styleKey(was) !== styleKey(ref)) {
      const hit = (v: string) => styleKey(v) === styleKey(was);
      setPriceDetails((xs) =>
        xs.map((x) => (hit(x.style_ref_no) ? { ...x, style_ref_no: ref } : x)),
      );
      setCombos((xs) =>
        xs.map((x) => (hit(x.style_ref_no) ? { ...x, style_ref_no: ref } : x)),
      );
      setApprovalQtys((xs) =>
        xs.map((x) => (hit(x.style_ref_no) ? { ...x, style_ref_no: ref } : x)),
      );
      /* Quantities carries the ref twice — on the destination row and on each
         assortment line nested under it (0433, a line names its own style on a
         Multiple Style pack). Both move, or the overlay's lines are orphaned
         from a row that survived. */
      setQuantities((xs) =>
        xs.map((x) => {
          const linesMoved = x.assort_lines.map((l) =>
            hit(l.style_ref_no) ? { ...l, style_ref_no: ref } : l,
          );
          const rowRef = hit(x.style_ref_no) ? ref : x.style_ref_no;
          return rowRef === x.style_ref_no && linesMoved.every((l, i) => l === x.assort_lines[i])
            ? x
            : { ...x, style_ref_no: rowRef, assort_lines: linesMoved };
        }),
      );
      /* THE ATTACHED DOCUMENTS MOVE TOO (0479). Files are the one per-style
         child held FLAT beside the styles rather than nested on the row — the
         upload happens before the order has an id, so `attachments` is a single
         list keyed by ref — which means the note above ("the line's OWN children
         need nothing, they are nested and stamped at save time") does not cover
         them. Left out, a corrected typo would strand the row's tech pack: the
         server demotes an unmatched ref to an order-level document, and the
         style would report itself unsaveable a keystroke after plainly having a
         file.

         `|| null` on the empty ref, never `""`: a blank ref IS an order-level
         document, and the column's whole distinction is null vs a name. */
      setAttachments((xs) =>
        xs.map((x) =>
          x.style_ref_no && hit(x.style_ref_no)
            ? { ...x, style_ref_no: ref || null }
            : x,
        ),
      );
    }

    if (!ref) return;

    /*
     * THE FABRICS FLOW IN FROM THE LINE'S OWN COMPONENTS (0415, client
     * 2026-08-12) — see the contract above for why this is the same rule it
     * always was, read off a different source.
     *
     * ADDITIVE AND IT NEVER REMOVES, unchanged: a structure already on the tab
     * may have a Type answered against it, and one line's components say nothing
     * about the fabrics another line still needs. It fills the blank opening row
     * rather than leaving it above the seeded ones.
     */
    const declared = row.components
      .map((c) => c.fabric_category_id)
      .filter(Boolean) as string[];
    if (declared.length) {
      setStructures((xs) => {
        const have = new Set(xs.map((x) => x.structure_id).filter(Boolean));
        const missing = declared.filter((id) => !have.has(id));
        if (!missing.length) return xs;
        const seeded = missing.map((id) => ({
          ...blankStructure(),
          structure_id: id,
        }));
        const blankAt = xs.findIndex((x) => !x.structure_id && !x.item_sub_type);
        if (blankAt === -1) return [...xs, ...seeded];
        return [...xs.slice(0, blankAt), ...seeded, ...xs.slice(blankAt + 1)];
      });
    }

    /*
     * THE PRICES TAB TAKES ITS STYLE LIST FROM HERE (client 2026-08-20, "remove
     * the add colour and add style price both fields").
     *
     * `hideAdd` on that grid is only safe because of this block — the styles a PO
     * prices are the styles it CARRIES, so with no "+ Add style price" the group
     * has to arrive with the order or a Multi Style PO could price its first
     * style and never reach its second.
     *
     * ADDITIVE, never removing: a stored price belongs to a style even after the
     * line is re-typed, which is what the group's own ✕ is for. Keyed by
     * `styleKey`, the same text key Prices, Quantities and Approval Qty resolve
     * on — there is no `style_id` left to key on and the price rows never carried
     * one anyway.
     */
    setPriceDetails((xs) => {
      const want = styleKey(ref);
      if (xs.some((x) => styleKey(x.style_ref_no) === want)) return xs;
      const seeded: PriceDetailRow = {
        ...blankPriceDetail(),
        style_ref_no: ref,
        /* THE REF IS THE NAME NOW. Two columns held the master's code and its
           name; a typed line has one string, so it answers both rather than
           leaving `style` blank on every price row the order prints. */
        style: ref,
        article_no: row.article_no,
        /* The Order Unit the LINE implies — see `unitTextOf`. Read from the same
           place the cell renders rather than copied off a master row that is no
           longer consulted. */
        unit: unitTextOf(row),
      };
      const blankAt = xs.findIndex((x) => !x.style_ref_no.trim());
      if (blankAt === -1) return [...xs, seeded];
      return [...xs.slice(0, blankAt), seeded, ...xs.slice(blankAt + 1)];
    });

    /*
     * THE COMBOS TAB TAKES THE STYLE FROM HERE (client 2026-08-17: the Combos
     * section "need to fetch automatically that style from previous section").
     *
     * ONLY WHILE THE ORDER HAS ONE STYLE LINE — with two, which style a combo
     * belongs to is a real question with no derivable answer, and guessing it
     * from whichever line was typed last would put line 2's style onto combos
     * that describe line 1. The picker stays for that case.
     *
     * BLANK ROWS ONLY. A combo already naming a style is an answer, not a gap;
     * overwriting it is the "silent data loss dressed up as tidiness" the
     * disabled-rows rule names, and on a loaded order it would mark a record
     * dirty the operator has not touched.
     */
    if (styles.length === 1) {
      setCombos((xs) =>
        xs.map((x) =>
          x.style_ref_no.trim()
            ? x
            : { ...x, style_ref_no: ref, style: ref, article_no: row.article_no },
        ),
      );
    }
  };

  // ---- the Size sub-grid under a style line (0407) --------------------------

  const mutSizes = (styleKeyId: string, fn: (xs: SizeRow[]) => SizeRow[]) =>
    setStyles((xs) =>
      xs.map((x) => (x.key === styleKeyId ? { ...x, sizes: fn(x.sizes) } : x)),
    );

  /**
   * Add a blank size row — and DECLINE while the last one is still blank.
   *
   * `return false` is `ChildGrid`'s decline protocol (`gridKeyNav`'s `addRow`),
   * and returning it here does two things at once: it stops Enter stacking
   * blank size rows, and it lets that Enter ESCALATE to the outer Styles grid,
   * which is what makes "Enter, Enter" walk out of a finished size list and on
   * to the next style. The Material Attributes values grid (`addOption`) is
   * where this shape is established.
   *
   * UNUSED SINCE 2026-08-20 AND KEPT ON PURPOSE, the same way `addDyeing` and
   * `addPrint` are below — its "+ Add size" button came out of `sizeGrid` (the
   * note there says why), and this plus one `<Button>` is the whole of what a
   * restore needs. THIS SCREEN REVERSES: "+ Add style" was capped, uncapped on
   * 08-17 and re-capped on 08-19, so a handler deleted here is a handler
   * rewritten from scratch in a fortnight. `eslint` reports it as a warning;
   * that is the stated cost of keeping a withdrawn control restorable.
   */
  const addSize = (styleKeyId: string) => {
    const row = styles.find((x) => x.key === styleKeyId);
    if (row && row.sizes.length && !row.sizes[row.sizes.length - 1].size_id) return false;
    mutSizes(styleKeyId, (zs) => [...zs, { key: newKey(), size_id: null }]);
  };

  /**
   * ORDER UNIT, ANSWERED — AND IT NO LONGER SEEDS A COORDINATE.
   *
   * ## IT DID, FOR ONE AFTERNOON, AND THAT WAS A RULE ABOUT THE WRONG THING
   *
   * The spec read: "when the Order Unit is Pcs the system automatically sets the
   * coordinate to Pcs and the coordinate count to 1". So this handler looked up
   * the GAR master row whose code was PIECES and wrote it into the grid. The
   * client corrected it the same day: **"no need to choose PIECES also, which is
   * just one coordinate … whatever it is."**
   *
   * "Pcs" is a COUNT. `coordinateCap` has said since 0392 that a Piece garment
   * has one coordinate and a Set has several — it has never said WHICH, and a
   * customer's Pcs order can perfectly well be filed under TOP. Seeding by name
   * turned a rule about arity into a rule about vocabulary, and coupled the
   * screen to a master row nobody promised: rename PIECES to PIECE and the
   * seeding stops, with no error to read. The note where `pieceCoordinateId`
   * used to live carries the argument in full.
   *
   * ## SO THIS IS A PLAIN `updateStyle` AGAIN
   *
   * A Pcs line opens on the blank row `seedRow` gives every grid, and the
   * operator picks whichever coordinate it is — one dropdown, once per line.
   *
   * **The keystroke saving the client asked for is NOT lost**, and this is the
   * half worth being clear about: it moves to `setStyleCoordinate` below, which
   * back-fills every component the moment that one coordinate is known. That is
   * where it always belonged — the components can only be filled once there is
   * something to fill them WITH, and answering Order Unit is not that moment.
   * The pre-fill also survives on the components grid itself, through
   * `impliedCoordinateId`, which reads the line's own grid and never a name.
   *
   * ## WHAT THIS HANDLER STILL EARNS ITS NAME FOR
   *
   * Nothing, today — it is `updateStyle` with one field. It is kept as a named
   * handler rather than inlined back into the `onChange` because the Order Unit
   * cell has acquired and shed side effects twice now (0461, then this), and a
   * named seam is what made the second removal a one-function change.
   */
  const answerUnitKind = (styleKeyId: string, next: string | null) =>
    updateStyle(styleKeyId, { unit_kind: next });

  /**
   * ORDER INFO ▸ STYLES DETAILS ▸ COORDINATES (0461) — the same three mutators
   * the sizes and the components have, one level in.
   */
  const mutCoords = (
    styleKeyId: string,
    fn: (xs: StyleCoordRow[]) => StyleCoordRow[],
  ) =>
    setStyles((xs) =>
      xs.map((x) => (x.key === styleKeyId ? { ...x, coordinates: fn(x.coordinates) } : x)),
    );

  /**
   * PICK A COORDINATE — AND ON A PCS LINE, FILE EVERY COMPONENT UNDER IT.
   *
   * This is the keystroke saving the client asked for (2026-08-29: "the system
   * automatically fetches and pre-fills the single coordinate directly into each
   * component's coordinate field … the user is spared from manual cursor
   * clicks"), moved to the only moment it can honestly happen.
   *
   * ## WHY IT IS HERE AND NOT ON THE ORDER UNIT CELL
   *
   * It WAS there, and it had to look up a master row called PIECES to have
   * anything to write — which is the coupling the client removed ("no need to
   * choose PIECES also … whatever it is"). Answering Order Unit tells you the
   * line has ONE coordinate; it does not tell you which, so there is nothing to
   * back-fill with yet. Choosing that coordinate is the event that supplies it.
   *
   * The two are one `setStyles` update rather than two, so a render can never
   * land between them and show components filed under nothing.
   *
   * ## `impliedCoordinateId` DECIDES, NOT THIS FUNCTION
   *
   * Computed from the coordinates AFTER the change, so it is the same predicate
   * the Components grid pre-fills from and the same one `componentRowStarted`
   * discounts — one definition, three readers, which is what stops the grid
   * showing a value this never wrote. It answers null on a SET line, on a line
   * still holding more than one coordinate, and on an unanswered unit; in every
   * one of those the components are left exactly as they are.
   *
   * ## ONLY FROM EMPTY, EXACTLY AS BEFORE
   *
   * A component whose `coordinate_id` is already set keeps it — including a
   * wrong-looking one, which is `orphanComponents`' job to flag and the
   * operator's to fix. Overwriting an answer already given is the data loss this
   * screen refuses everywhere else.
   */
  const setStyleCoordinate = (
    styleKeyId: string,
    coordKey: string,
    id: string | null,
  ) =>
    setStyles((xs) =>
      xs.map((x) => {
        if (x.key !== styleKeyId) return x;
        const coordinates = x.coordinates.map((c) =>
          c.key === coordKey ? { ...c, coordinate_id: id } : c,
        );
        const implied = impliedCoordinateId(x.unit_kind, coordinates);
        return {
          ...x,
          coordinates,
          components: implied
            ? x.components.map((c) =>
                c.coordinate_id ? c : { ...c, coordinate_id: implied },
              )
            : x.components,
        };
      }),
    );

  /**
   * Add a blank coordinate row — and DECLINE while the last one is still blank.
   *
   * `return false` is `ChildGrid`'s decline protocol: it stops Enter stacking
   * blanks, and lets that Enter ESCALATE to the outer Styles grid so "Enter,
   * Enter" walks out of a finished list and on to the next style.
   *
   * IT ALSO DECLINES AT THE STYLE'S COORDINATE LIMIT. `coordinateLimit` is the
   * Style master's own rule — Piece is one coordinate, Set is several — read
   * through the picked style's `unit_kind`, which is the SAME value the Order
   * Unit cell prints. NULL means no rule to apply: every style created before
   * 2026-08-10 has no `unit_kind`, and the rule stays silent on those rather
   * than declaring historical records invalid.
   */
  const addStyleCoordinate = (styleKeyId: string) => {
    const row = styles.find((x) => x.key === styleKeyId);
    if (!row) return false;
    const last = row.coordinates[row.coordinates.length - 1];
    if (last && !last.coordinate_id) return false;
    /**
     * THE ORDER UNIT'S OWN RANGE, ONCE THE OPERATOR HAS TYPED ONE (client
     * 2026-08-27: "if Order Unit is PCS, just the single coordinate — hide the
     * add coordinate option; if they choose SET they can add multiple").
     *
     * THE CIRCULARITY THAT CLOSED THIS ON 2026-08-25 IS GONE, and that is the
     * whole reason this can be re-pointed rather than special-cased. The note
     * here read: "capping by the derived kind would be circular — one
     * coordinate derives 'piece', piece allows exactly one, and no line could
     * ever hold a second". Correct, and fatal, while the unit was INFERRED from
     * the coordinate count. 0471 made Order Unit a stored column the operator
     * answers, so the cap now reads a value that does not depend on the thing it
     * is capping.
     *
     * NULL STILL FALLS BACK TO THE CEILING, and it has to: an unanswered unit is
     * still derived from the coordinates (`unitTextOf`), so capping by it would
     * restore exactly the loop above. Six — the client's cap on a Set — is the
     * widest a line may grow until somebody says otherwise.
     *
     * A LINE ALREADY OVER ITS CAP IS LEFT ALONE. Switching a three-coordinate
     * style to PCS hides the button and refuses another; it does not delete the
     * two that are there. Silently dropping entered rows because a dropdown
     * changed is the data loss the "Disabled rows" rule refuses for the same
     * reason.
     */
    /* THE SAME PREDICATE THE BUTTON IS HIDDEN BY (`coordinatesFull`), so the
       keyboard can never get past a hidden "+ Add". It counts ROWS, not filled
       ones — the reasoning is on the function, and the short version is that the
       blank row a PCS line opens on already occupies its one allowance. */
    if (coordinatesFull(row.unit_kind, row.coordinates)) return false;
    mutCoords(styleKeyId, (cs) => [...cs, { key: newKey(), coordinate_id: null }]);
  };

  /**
   * ORDER INFO ▸ STYLES DETAILS ▸ COMPONENTS (0457) — the same three mutators
   * the sizes above have, one level in.
   */
  const mutComponents = (
    styleKeyId: string,
    fn: (xs: StyleComponentRow[]) => StyleComponentRow[],
  ) =>
    setStyles((xs) =>
      xs.map((x) =>
        x.key === styleKeyId ? { ...x, components: fn(x.components) } : x,
      ),
    );

  const patchComponent = (
    styleKeyId: string,
    compKey: string,
    patch: Partial<StyleComponentRow>,
  ) =>
    mutComponents(styleKeyId, (cs) =>
      cs.map((c) => (c.key === compKey ? { ...c, ...patch } : c)),
    );

  /**
   * Add a blank component row — and DECLINE while the last one is still blank.
   *
   * `return false` is `ChildGrid`'s decline protocol, and it does the same two
   * things here that `addSize`'s did: it stops Enter stacking blank rows, and it
   * lets that Enter ESCALATE to the outer Styles grid so "Enter, Enter" walks
   * out of a finished component list and on to the next style.
   *
   * A ROW IS "STARTED" IF IT NAMES ANY OF THE THREE, which is the same test
   * `normalizeStyleComponents` drops on. Testing only the Coordinate would let
   * an operator who filled Component first stack a second blank on top of it.
   */
  const addStyleComponent = (styleKeyId: string) => {
    const row = styles.find((x) => x.key === styleKeyId);
    const last = row?.components[row.components.length - 1];
    /**
     * THE PRE-FILLED COORDINATE (client 2026-08-29) — a PCS line's new component
     * row arrives already filed under the line's only coordinate, so the
     * operator never opens a dropdown holding one option.
     *
     * `impliedCoordinateId` answers null on every other shape — a SET line, a
     * line with no coordinate yet, a line carrying more than one — and the row
     * is then blank exactly as it was. It is NOT a second "is this PCS" test —
     * it reads whatever the line ended up HOLDING, which is why it needs no
     * seeded value to work from and why it survived the seeder's removal
     * (client 2026-08-29: "no need to choose PIECES also … whatever it is"). A
     * line whose single coordinate was picked by hand, this morning or two years
     * ago, pre-fills exactly the same.
     */
    const implied = row ? impliedCoordinateId(row.unit_kind, row.coordinates) : null;
    /* THE DECLINE TEST NOW READS `componentRowStarted`, WHICH IS WHAT MAKES THE
       PRE-FILL SAFE. It used to spell the three fields out here — and a row born
       holding `implied` satisfies that hand-written test, so "+ Add" would have
       stopped declining and Enter would have stacked blank rows without limit.
       Passing `implied` discounts exactly the value this function just put
       there; every other coordinate still counts as a start. The `required`
       cells and the save path read the same predicate with the same argument,
       so all three cannot disagree about what an empty row is. */
    if (last && !componentRowStarted(last, implied)) return false;
    mutComponents(styleKeyId, (cs) => [
      ...cs,
      {
        key: newKey(),
        coordinate_id: implied,
        component_id: null,
        fabric_category_id: null,
        comp_type: "",
        item_id: null,
      },
    ]);
  };

  /**
   * "Type" — the knit family the picked Structure implies, filled on the change.
   *
   * `componentTypeForCategory` is the Style master's own function, imported
   * rather than re-derived: this screen now writes the same column that screen
   * does, and two derivations of one value is how `comp_type` came to have FOUR
   * wrong readings (see the Style master's Components grid).
   *
   * NULL MEANS LEAVE THE CELL ALONE — a category whose master record names no
   * structure must not blank a Type that arrived with the seed. ON THE CHANGE,
   * never in an effect: an effect keyed on the category would also fire when a
   * saved order is OPENED and overwrite every stored Type on load.
   */
  const compTypeFor = (categoryId: string | null) =>
    componentTypeForCategory(categoryId, data.categories, fabricStructureOpts);

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
  /**
   * OPENING COMBOS LISTS EVERY STYLE THE ORDER DECLARES (client 2026-08-28,
   * screenshots 2526/2527: two styles entered, one style listed).
   *
   * `openOneRow` fills an EMPTY grid on load, and `addCombo` fills the row the
   * operator asks for — but neither covers the flow the screenshots show, which
   * is the ordinary one: a NEW order, styles typed on the tab before this, then
   * Combos opened. The grid was seeded blank before those styles existed, so it
   * had one unattributed line and the operator picked the style by hand.
   *
   * ON ENTERING THE SECTION, WHICH IS AN ACTION AND NOT AN EFFECT. That is the
   * distinction `seedComboFromStyle` draws and the reason its own seed hangs off
   * the [Detail] button: an effect watching the declared styles also fires when
   * a saved order loads. Navigating to Combos is the operator saying "show me
   * the colourways", exactly as [Detail] says "show me this combo's parts".
   *
   * IT CANNOT ARGUE BACK — `listedComboStyles` remembers, so a row that is
   * deleted stays deleted however many times the section is revisited, and a
   * saved order is primed full and never touched.
   *
   * BLANK ROWS ARE FILLED BEFORE ANY ARE ADDED. The grid opens holding one
   * untouched row (`openOneRow`, which the keyboard contract needs), so
   * appending would leave that blank line sitting above the styles it was
   * supposed to become.
   */
  const listStylesInCombos = () => {
    const declared = styles
      .map((st) => st.style_ref_no.trim())
      .filter(Boolean);
    if (!declared.length) return;

    setCombos((xs) => {
      const already = new Set(
        xs.map((x) => styleKey(x.style_ref_no)).filter(Boolean),
      );
      const owed = declared.filter((ref) => {
        const k = styleKey(ref);
        return !already.has(k) && !listedComboStyles.current.has(k);
      });
      if (!owed.length) return xs;

      const rowFor = (ref: string) => {
        const st = styles.find((x) => styleKey(x.style_ref_no) === styleKey(ref));
        return {
          style_ref_no: ref,
          // THE REF IS THE NAME NOW (2026-08-25), as `addCombo` writes it.
          style: ref,
          article_no: st?.article_no ?? "",
        };
      };

      /* An untouched opening row: no style, no colourway, no structures. A row
         holding ANY of those is the operator's and is never written over. */
      const isBlank = (r: ComboRow) =>
        !r.style_ref_no.trim() && !r.combo.trim() && !r.structures.length;

      const queue = [...owed];
      const filled = xs.map((r) =>
        isBlank(r) && queue.length ? { ...r, ...rowFor(queue.shift()!) } : r,
      );
      const out = [
        ...filled,
        ...queue.map((ref) => ({ ...blankCombo(), ...rowFor(ref) })),
      ];
      for (const ref of owed) listedComboStyles.current.add(styleKey(ref));
      return out;
    });
  };

  const addCombo = () =>
    setCombos((xs) => {
      const only = styles.length === 1 ? styles[0] : null;
      const ref = only?.style_ref_no.trim();
      if (only && ref) {
        const name = only.style_ref_no.trim();
        return [
          ...xs,
          {
            ...blankCombo(),
            style_ref_no: ref,
            style: name,
            article_no: only.article_no ?? "",
          },
        ];
      }
      /**
       * SEVERAL STYLES: THE NEXT ONE NOT YET LISTED (client 2026-08-28).
       *
       * A multi-style order fell straight through to a blank row, so the
       * operator re-picked a style the order had already stated — the exact
       * complaint the one-style branch above exists to answer, left unanswered
       * for every order with more than one style. `combosForStyles` lists them
       * all when the grid opens; this is the same rule for the grid an operator
       * has already worked in.
       *
       * ON THE CLICK, WHICH IS WHAT MAKES IT SAFE. `seedComboFromStyle`'s note
       * refuses a standing top-up because it "would re-add a row the operator
       * deliberately removed the moment anything else re-rendered it". Pressing
       * "+ Add" IS the operator asking for a row, so filling it in with the
       * style they have not covered yet argues with nobody — and when every
       * style is listed it falls back to a blank row rather than refusing.
       */
      const listed = new Set(
        xs.map((x) => styleKey(x.style_ref_no)).filter(Boolean),
      );
      const next = styles.find(
        (st) => st.style_ref_no.trim() && !listed.has(styleKey(st.style_ref_no)),
      );
      if (!next) return [...xs, blankCombo()];
      const nextRef = next.style_ref_no.trim();
      return [
        ...xs,
        {
          ...blankCombo(),
          style_ref_no: nextRef,
          style: nextRef,
          article_no: next.article_no ?? "",
        },
      ];
    });

  // ---- Combos ▸ Structure Details, the tree mutators (0408) ----------------
  //
  // Three levels, one setter. Every edit rebuilds the path from the combo down,
  // which is what makes removing a structure take its components with it
  // without a second list to keep in step — the same reason a style's sizes are
  // nested inside `StyleRow` rather than held beside it.
  const mutStructs = (
    comboKey: string,
    fn: (xs: ComboStructRow[]) => ComboStructRow[],
  ) =>
    setCombos((xs) =>
      xs.map((x) =>
        x.key === comboKey ? { ...x, structures: fn(x.structures) } : x,
      ),
    );
  const patchStruct = (
    comboKey: string,
    structKey: string,
    patch: Partial<ComboStructRow>,
  ) =>
    mutStructs(comboKey, (sts) =>
      sts.map((st) => (st.key === structKey ? { ...st, ...patch } : st)),
    );

  /**
   * THE FIRST FABRIC'S GSM AND TOLERANCE CARRY DOWN TO THE ONES BELOW IT
   * (client 2026-08-21: "if i fill the tolerance gsm apply for remaining below
   * structure section").
   *
   * A tee is three fabrics and usually one tolerance, so ±5 was being typed
   * once per card. The first fabric answers and the rest inherit.
   *
   * ON BLUR, NOT ON EVERY KEYSTROKE, AND THAT IS THE WHOLE TRAP. Typing `200`
   * fires `onChange` three times — `2`, `20`, `200`. Copying on change would
   * push `2` into the blank boxes below, and every later keystroke would then
   * find them non-blank and decline, so the fabrics below would be left holding
   * a digit nobody typed. Blur fires once, with the finished number.
   *
   * ON THE ACTION, NEVER IN AN EFFECT. An effect watching `structures` also
   * fires when a SAVED order is opened, which would refill fabrics whose boxes
   * the operator had deliberately cleared — the rule `pickStyle`,
   * `pickComboStructure` and `seedComboFromStyle` all already state.
   *
   * BLANKS ONLY. A fabric already carrying a number is an answer, not a gap:
   * a 240 rib under a 200 body must survive the body being re-typed. That is
   * also what makes the blur trigger safe to leave un-announced — it can add an
   * answer where there was none and can never argue with one.
   *
   * AND "BLANK" IS NOT "EMPTY" FOR THE TOLERANCE ANY MORE (2026-08-31). Every
   * fabric opens on ±5, so the test is `toleranceStated`, on BOTH sides — see
   * the two lines in the body. Read the doc on `toleranceStated`; this is one of
   * the three places that prefill would otherwise have broken in silence.
   *
   * FROM THE FIRST FABRIC ONLY. Every card would otherwise be a source, and
   * which one had last been left would decide what the rest held.
   */
  const carryDownGsm = (comboKey: string, structKey: string) =>
    mutStructs(comboKey, (sts) => {
      const first = sts[0];
      if (!first || first.key !== structKey) return sts;
      const gsm = first.gsm.trim();
      /* "BLANK" FOR A TOLERANCE MEANS `!toleranceStated`, NOT `!trim()`
         (2026-08-31). Every fabric now OPENS on ±5 (`blankStruct`), so an empty
         string is no longer the state this rule was written against: read
         literally, no tolerance below is ever blank, nothing is ever carried
         down, and the rule the client asked for on 2026-08-21 would decline
         every single time while looking exactly as it does here.
         The source side moves with it — carrying the prefill down would be
         copying a default onto a default, which is a no-op that reads as the
         feature working. Only a tolerance the operator STATED travels. */
      const tol = toleranceStated(first.gsm_tolerance)
        ? first.gsm_tolerance.trim()
        : "";
      if (!gsm && !tol) return sts;
      let changed = false;
      const next = sts.map((st, i) => {
        if (i === 0) return st;
        const patch: Partial<ComboStructRow> = {};
        if (gsm && !st.gsm.trim()) patch.gsm = gsm;
        if (tol && !toleranceStated(st.gsm_tolerance)) patch.gsm_tolerance = tol;
        if (!Object.keys(patch).length) return st;
        changed = true;
        return { ...st, ...patch };
      });
      // Same array back when nothing filled in. Blur fires on every departure
      // from these two boxes, and the common case is that every fabric below is
      // already answered — so the identity check keeps the ordinary Tab out of
      // a GSM box from re-creating every structure row beneath it.
      return changed ? next : sts;
    });

  /**
   * Pick a fabric here and its Fabric Type arrives with it (0415).
   *
   * The Color/Print tab declares Solid / Melange / Yarn Dyed once per structure
   * (`Printed` was the fourth until the client withdrew it on 2026-08-31); this
   * is where that answer is spent, since it decides how the row's components
   * state their colour — from the order's declared palette, or typed by hand on
   * a yarn-dyed cloth. Both grids now
   * store the same category id, which is the whole reason the lookup is possible
   * — before 0415 this tab held a fabric category and that one held a knit
   * family, so there was nothing to match on.
   *
   * SEEDS, NEVER OVERWRITES. The combo cell stays editable, so a structure that
   * is Solid on the order can still be Melange in one colourway; and a Type the
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
   * ONLY WHEN THE ANSWER IS UNAMBIGUOUS. `compositionForStructure` abstains at
   * every fork — a category holding no fabric or several, a blend with a share
   * missing, a composition nobody has entered yet — and `null` always means
   * "leave the cell alone", never "clear it". SINGLE JERSEY holds eight fabrics,
   * and choosing one of eight is a guess wearing the clothes of a fetch; there
   * the cell stays blank with the whole master still open beside it.
   *
   * THE RULE IS SHARED WITH THE SEEDER (`order-seed.ts`), which is why it lives
   * in `combo-rules.ts` rather than here: a seeded amendment and a hand-entered
   * one must reach the same composition.
   *
   * SEEDS, NEVER OVERWRITES, exactly as `item_sub_type` beside it has since
   * 0415. Re-picking the SAME structure changes nothing, and a hand-picked
   * composition survives a change of structure — only THIS APP'S OWN previous
   * answer is withdrawn, which is what `wasDerived` tests. That is stricter than
   * the 0430 version it replaces: that one cleared any fabric sitting under the
   * old category, including one the operator had chosen deliberately.
   *
   * ON THE CHANGE, NEVER IN AN EFFECT — the Style master's Type column records
   * why (0405): an effect keyed on the structure also fires when a SAVED order
   * is opened, and would overwrite every stored composition on load.
   */
  const pickComboStructure = (
    comboKey: string,
    structKey: string,
    id: string | null,
  ) => {
    const declared = id
      ? structures.find((s) => s.structure_id === id)?.item_sub_type
      : null;
    mutStructs(comboKey, (sts) =>
      sts.map((st) => {
        if (st.key !== structKey) return st;
        // Stale means "what THIS APP derived for the structure being replaced",
        // not "anything that came from it" — so a composition the operator chose
        // by hand survives a change of structure and only the app's own answer
        // is withdrawn.
        const wasDerived = compositionForStructure(
          st.structure_id,
          data.fabrics,
          data.compositions,
        );
        const held =
          st.composition_id &&
          st.composition_id === wasDerived &&
          st.structure_id !== id
            ? null
            : st.composition_id;
        return {
          ...st,
          structure_id: id,
          item_sub_type: st.item_sub_type || declared || "",
          composition_id:
            held ||
            compositionForStructure(id, data.fabrics, data.compositions),
        };
      }),
    );
  };
  /**
   * A NEW FABRIC STARTS ON ±5 (client 2026-08-31: "the Tolerance input field
   * must automatically default to 5 … a ±5% weight/GSM variance is the standard
   * baseline tolerance in garment manufacturing"). Editable, always — 3% for a
   * buyer with tighter parameters, 8% for a looser one.
   *
   * THREE OTHER PLACES MOVED WITH IT AND HAD TO, or this prefill breaks the
   * screen silently. `toleranceStated` in combo-rules.ts is the one question all
   * three now ask — "did the operator SAY this, or is it just what the box
   * opened on?" — and its doc block carries the full reasoning:
   *
   *   · `structSaysSomething` below — a blank fabric carrying a prefilled 5
   *     would "say something", and `seedComboFromStyle` stands down the moment
   *     any structure does, so the tree-from-style seed would never run again on
   *     any order. Nothing errors; the overlay just stops filling itself in.
   *   · `carryDownGsm` above — it copies fabric 1's numbers into BLANKS only,
   *     and with a prefill nothing below is ever blank, so the carry-down the
   *     client asked for on 2026-08-21 would decline every time.
   *   · `structureFilled` in actions.ts, the server twin of the first, which
   *     would otherwise store one empty structure row per combo for ever.
   *
   * `toRows` is the fourth site and deliberately does NOT default — see the note
   * there. A stored value is what the operator said; a prefill is not.
   *
   * `seedComboFromStyle` inherits this for free: it builds every seeded row from
   * `blankStruct()` and then fills GAPS from the anchor combo, so a seeded
   * fabric opens on 5 unless a sibling colourway has already stated otherwise.
   */
  const blankStruct = (): ComboStructRow => ({
    key: newKey(),
    structure_id: null,
    fabric_type: "",
    composition_id: null,
    gsm: "",
    gsm_tolerance: String(DEFAULT_GSM_TOLERANCE),
    item_sub_type: "",
    yarn_colors: [],
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
      st.composition_id ||
      st.gsm.trim() ||
      /* `toleranceStated`, NOT `.trim()` — a prefill is not an answer.
         `blankStruct` opens every new fabric on ±5 (client 2026-08-31), so a
         `.trim()` here would make EVERY blank structure say something, and
         `seedComboFromStyle` stands down the moment any structure does. The
         tree-from-style seed would have stopped running on every order, with
         nothing to show for it but an overlay that quietly opened blank.
         A deliberate 5 reads as the prefill and is accepted — combo-rules.ts
         says why: a row whose only content is a hand-typed default tolerance
         says nothing about the cloth, and every other field votes on its own. */
      toleranceStated(st.gsm_tolerance) ||
      st.item_sub_type ||
      /* A yarn-dyed fabric that has named its yarns has said something about the
         cloth — as much as its Composition or its GSM does. Nothing prefills
         this, so `.length` is the whole test. */
      st.yarn_colors.length ||
      st.components.some(
        (c) =>
          c.coordinate_id ||
          c.component_id ||
          c.color_name.trim() ||
          c.print_id ||
          // `processed_as_trim` WAS MISSING HERE and it is the whole point of the
          // paragraph above. `componentFilled` in actions.ts counts it, so a
          // component whose only content is a ticked Processed as Trim IS
          // stored — and then read back as "says nothing", which let
          // `seedComboFromStyle` overwrite the saved structures with
          // style-derived ones on the next [Detail] open. Silent loss of a row
          // the server had just written, which is exactly the drift the twins
          // were documented to prevent.
          c.processed_as_trim,
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
   * offer. It used to say so in a hint under the parts list; the client removed
   * that line on 2026-08-18, so the seeder is silent about it too.
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

        /**
         * THE FIRST FILLED COMBO'S FABRIC, PER CATEGORY (client 2026-08-29).
         *
         * "The system must query the very first colorway combo that was
         * completely filled out … and copies over all core fabric properties
         * from that first combo — Composition, GSM, Tolerance and Fabric Type —
         * into the newly created combo's fields."
         *
         * THIS IS THE SOURCE THE STYLE COULD NOT BE. The note above this
         * function says GSM, Tolerance and colour "are never seeded, and that is
         * the data's answer rather than a preference: `garment_style_components`
         * has no such columns". That is still true and is not being reversed —
         * what changed is that a SIBLING COMBO does have those columns, and a
         * White and a Green of one PO are the same cloth. The style seeds the
         * SHAPE (which fabrics, which parts); the anchor combo seeds what that
         * cloth IS.
         *
         * `xs` is the updater's own argument, so the anchor is read from the
         * combos as they are at this instant rather than from a `combos` closure
         * that a batched `setCombos` may already have superseded — the same trap
         * `combosForStyles` records for `styles`.
         *
         * ANCHORED ON THE FIRST, NOT THE PREVIOUS, and `fabricAnchorDefaults`
         * carries the client's reasoning for that in full: chaining off the
         * previous combo makes every combo a source, so one typo in the second
         * propagates through every one after it.
         */
        const anchored = fabricAnchorDefaults(xs, r.key);

        // REPLACES the blank rows rather than appending below them. Everything
        // standing here is blank by the guard above, so there is nothing to keep
        // — and `pickStyle`'s block makes the same move for the same reason: a
        // seeded list under an empty first row is a row the operator has to
        // delete before the form reads as filled in.
        return {
          ...r,
          structures: [...byCategory.keys()].map((id) =>
            /* FILLS GAPS ONLY — every field here is blank, since the row was
               just built from `blankStruct()`, so on THIS path the distinction
               costs nothing. It is stated anyway because `withFabricDefaults` is
               the shared rule and a caller that overwrote would make a Melange
               Black under a Solid White unenterable. */
            withFabricDefaults(
              {
                ...blankStruct(),
                structure_id: id,
                components: partsOf(id),
              },
              anchored,
            ),
          ),
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
      sts.map((st) =>
        st.key === structKey ? { ...st, components: fn(st.components) } : st,
      ),
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
   * Set the fabric's colour or print — ON THE STRUCTURE AND ON EVERY PART.
   *
   * The structure's own copy is what the control reads, so a fabric with no
   * parts yet can still hold an answer; the parts are what SAVE, so they are
   * written in the same breath. Two places, one statement, never an effect
   * keeping them in step afterwards — that is the drift `pickComboStructure`
   * warns about one screen up.
   */
  /* `setStructAesthetic` REMOVED (client 2026-08-20). It wrote one colour or
     print from the fabric down onto every part, which is precisely the "only one
     general color field" the client rejected twice. The parts are edited
     directly through `patchComp` now, which already existed and already writes
     the same two columns. */

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
    // COORDINATE AND COMPONENT ONLY — and this stays true now that the colour
    // is the PART's again, for the same reason it was true when the colour was
    // the fabric's: a new row INHERITS an aesthetic (below), so it is never
    // blank in those two cells, and a decline test that counted them would
    // never fire again — letting Enter stack empty parts without limit. What
    // identifies a part is which piece of the garment it is, exactly these two.
    if (last && !last.coordinate_id && !last.component_id) {
      return false;
    }
    mutComps(comboKey, structKey, (cs) => [
      ...cs,
      {
        key: newKey(),
        coordinate_id: null,
        component_id: null,
        // INHERITED FROM THE PREVIOUS PART, not from the fabric (client
        // 2026-08-20 — the fabric no longer holds one).
        //
        // A second sleeve is almost always the colour of the first, so copying
        // down is what keeps "one field per part" from costing two extra picks
        // on every row. It is a DEFAULT, not a rule: the operator overwrites it,
        // which is the entire point of the field being per part.
        //
        // Falls back to blank on the first part of a fabric, which is correct —
        // there is nothing to copy, and guessing a colour from the fabric is the
        // behaviour being removed.
        color_name: last?.color_name ?? "",
        print_id: last?.print_id ?? null,
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

  /**
   * NO CEILING SINCE 2026-08-27, because there is no longer a list to fill.
   *
   * The cap was `PACK_TYPE_OPTIONS.length`: one row per name on a fixed list,
   * so a further row could only ever be a duplicate or a blank. The cell is
   * typed now (client 2026-08-27, "packtype field manual entry, not a default
   * value"), and a ceiling counting a list nobody picks from is a "+ Add" that
   * stops working for no reason the operator can see.
   *
   * `ChildGrid`'s decline protocol (`return false`) is therefore unused here.
   * It is what `gridKeyNav` reads, so a guard put back later belongs in THIS
   * function and not on the button: Enter off the last cell adds a row too, and
   * a disabled button would leave the keyboard path uncapped.
   */
  /**
   * The lines under ONE pack type (0472).
   *
   * All three go through `setPackTypes` rather than a state of their own: the
   * lines are nested in the row, so a method removed takes its lines with it
   * without a second cleanup — which is the whole reason they are nested on
   * screen. The flattening happens once, on the way to the payload.
   */
  const mutPackTypeLines = (
    rowKey: string,
    f: (ls: PackTypeLineRow[]) => PackTypeLineRow[],
  ) =>
    setPackTypes((xs) =>
      xs.map((x) => (x.key === rowKey ? { ...x, lines: f(x.lines) } : x)),
    );

  const blankPackTypeLine = (): PackTypeLineRow => ({
    key: newKey(),
    /* THE SOLE STYLE, PREFILLED. With one style line on the order there is no
       question to ask, and the legacy screenshot's five lines all name the same
       ref — typing it five times is the keystroke this fills in. With two it is
       a real choice and stays blank, the same call `pickStyle` makes for the
       Combos tab. */
    style_ref_no: styles.length === 1 ? styles[0].style_ref_no.trim() : "",
    combo: "",
    qty: "",
  });

  const addPackTypeLine = (rowKey: string) => {
    mutPackTypeLines(rowKey, (ls) => [...ls, blankPackTypeLine()]);
  };

  const addPackType = () => {
    setPackTypes((xs) => [...xs, blankPackType()]);
  };

  /**
   * DOES AN EARLIER ROW ALREADY NAME THIS METHOD?
   *
   * The `<Select>` used to make a duplicate IMPOSSIBLE by hiding a method
   * another row had taken, which is why the unique index (0399) and
   * `normalizePackTypes` were backstops nobody read. Free text removes the
   * filter and leaves the backstop standing — and `normalizePackTypes` drops
   * the second row SILENTLY, so without this the operator types a row, saves,
   * and finds it gone with nothing said.
   *
   * ADVISORY, NEVER A HOLD. The save succeeds, so this is not an error that
   * blocks Save, and `data-dup-error` would cage the cursor on a row whose only
   * exit is Ctrl+Del (AGENTS.md, "Duplicates": the hold is for an error that
   * genuinely blocks Save).
   *
   * Case-insensitive and FIRST-WINS, matching `normalizePackTypes` exactly. A
   * rule stated twice that disagreed would flag the row the save intends to
   * keep and stay quiet about the one it drops.
   */
  const packTypeIsDuplicate = (row: PackTypeRow): boolean => {
    const v = row.pack_type.trim().toUpperCase();
    if (!v) return false;
    const i = packTypes.findIndex((x) => x.key === row.key);
    return packTypes
      .slice(0, i < 0 ? 0 : i)
      .some((x) => x.pack_type.trim().toUpperCase() === v);
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
    // `styles` IS KEYED HERE AGAIN (client 2026-08-27: "move that style section
    // from order info as separate tab"). It was removed on 2026-08-11 when the
    // grid merged into Order Info and that section took `has(styles)` into its
    // own `done`; the split puts the expression back where the rail reads it.
    styles: has(styles),
    // READS ONLY WHAT THE TAB SHOWS, and the tab shows three grids again since
    // 2026-08-29 — Fabric Print rejoined the two dyeing ones, so `prints` is
    // back in this expression with them.
    //
    // STRUCTURES STAY OUT. That grid came off on 2026-08-14 and has not
    // returned, and `pickStyle` SEEDS structures from the style's own fabrics —
    // so counting them here would light the dot on an order whose Color/Print
    // tab is visibly empty, which is the confident lie the note above is about.
    // The test is what the operator can SEE, never what the state holds.
    colors: has(dyeings) || has(prints),
    combos: has(combos),
    prices: has(priceDetails),
    // STILL `approvalQtys`, and the meaning IMPROVED when 0435 made the rows
    // derived. That state now holds only what the operator TYPED, so the dot
    // lights for an approval quantity somebody entered rather than for rows the
    // tab built for itself out of Style(s), Combos and Quantities. Reading the
    // derived tree here instead would light it on every order that has a colour
    // — a dot over a tab nobody has answered, which is the confident lie the
    // note above is about.
    approvalqty: has(approvalQtys),
    packtypes: has(packTypes),
    quantities: has(quantities),
    /* NOT `has(taRows)`, for the reason `tabsHaveRows` above spells out: this
       grid is seeded from the `ta_activities` master, so every row is "filled"
       before the operator arrives and the dot would light on a tab nobody has
       answered — the confident lie the note at the head of this map is about.
       The dot means "the ladder has been given its lead times", which is the one
       thing on this tab the operator states.

       `some`, AND IT WAS `every` UNTIL 2026-08-31. The stricter test had one
       justification and the justification expired: "a dot on a partly-filled
       ladder would claim a section is done while Save is still blocked on it."
       Save is no longer blocked on it (the client made the tab optional), so
       `every` now means a tab the operator HAS answered — nine rows of ten —
       renders with the same empty dot as one they have never opened. That is
       the confident lie pointing the other way, and it is the worse of the two
       now that nothing else on screen contradicts it.

       `some` is also what every other entry in this map means: `has(...)` is
       "any filled row", not "every field answered". `logistic` is the one
       exception and it earns it — those five ARE mandatory. **If the gate comes
       back, this goes back to `every` with it**; the two are one decision. */
    ta: taRows.some((r) => r.days_required.trim() !== ""),
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
    /* THE ORDER OF THIS ARRAY IS THE ORDER OF THE ROW, and it was re-sequenced
       for option B (client 2026-08-24). The first seven read as the master's own
       run — the style's identity, then the commercial number, then the drill-in
       — and Description comes LAST.

       ALL EIGHT ARE ON ONE LINE SINCE 2026-08-26. Description was last because
       it took the whole second line; it is last now because it is the least
       identifying thing about a style, and the position is unchanged either
       way. See `STYLE_FIELD_W`.

       Re-sequencing is safe and always has been: every consumer resolves by
       `header` (the folded-row filter, the Description span) rather than by
       index, precisely so this array can be reordered without a hunt. */
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
        /* TYPED, NOT PICKED (client 2026-08-25: "Style - allow it manual entry
           now, unwire that style mapping with that field in orderinfo").
           `settleStyleRef` carries the full contract — what the pick used to
           seed, who seeds it now, and why the rename has to be carried across
           the tabs keyed on this text.

           `required` IS DECLARED TWICE ON PURPOSE. The column says it (that
           draws the header ✳) and the control says it (that is what stamps
           `data-required-empty` and holds the cursor). AGENTS.md "Mandatory
           fields" records why the two cannot be folded into one, and this grid
           renders its own row on the stacked layout — where `ChildGridColumn.
           required` never reaches the control at all.

           NO `uppercase` FLAG: `Input` capitalises by default since 2026-08-18,
           which is exactly right here — `styleKey` upper-cases this string to
           compare it, so typing in caps makes what is stored match what is
           matched on.

           THE VALUE IT WRITES IS `style_ref_no`, the Orders module's join key,
           and `style_id` goes NULL in the same update — one event, so the two
           can never disagree about whether this line is linked. */
        return (
          <Input
            aria-label="Style"
            required
            value={r.style_ref_no}
            onChange={(e) =>
              updateStyle(r.key, { style_ref_no: e.target.value, style_id: null })
            }
            /* THE PREVIOUS VALUE IS CAPTURED ON FOCUS, not held in state. It is
               needed only to know whether a rename happened, it is a property of
               this editing session rather than of the record, and reading it off
               the DOM at focus time cannot go stale the way a mirrored state
               field would. */
            onFocus={(e) => {
              styleRefOnFocus.current = e.target.value;
            }}
            onBlur={(e) =>
              settleStyleRef(r.key, e.target.value, styleRefOnFocus.current)
            }
          />
        );
      },
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
    /*
     * THE STYLE MASTER'S OWN FIELDS, ON THE LINE (client 2026-08-23, screenshot
     * 2471). Five of the master's seven — Season and Year are NOT here, on two
     * standing client instructions; 0462 carries them in full.
     *
     * IN THE MASTER'S READING ORDER, deliberately: Approved Sample No and Style
     * Description sit either side of Style in Style Details, then Article No.
     * and Style Category come from General. An operator moving between the two
     * screens reads the same run of fields in the same sequence.
     *
     * ALL `xs`, like the cells around them, and the row simply WRAPS — this
     * body is a `FieldRow` (flex), so ten cells lay out on two lines with no
     * track arithmetic to get wrong. `xs` is deliberate and is NOT the masters
     * field width: a child-grid row is a table line rendered as fields.
     */
    {
      header: "Approved Sample No",
      cell: (r) => (
        /* NOT `required` — `samples` has ZERO approved rows in this database,
           and a required field with an empty picker is a record that cannot be
           saved with nothing on screen to fix it. That is the exact call the
           Style master made on 2026-08-13 for its copy of this field. */
        <RecordPicker
          label="Approved Sample No"
          compact
          items={samplesForCustomer(r.approved_sample_id)}
          value={r.approved_sample_id}
          onChange={(id) => updateStyle(r.key, { approved_sample_id: id })}
        />
      ),
    },
    {
      header: "Style Category",
      /* MANDATORY SINCE 2026-08-31 (client): "must be explicitly chosen from
         the dropdown menu (e.g. Mens T-Shirt, Kids Wear)". Declared TWICE and
         that is the house rule, not belt-and-braces — the column draws the
         header star, the control stamps `data-required-empty` and holds the
         cursor, and this grid renders its own row on the stacked layout where
         `ChildGridColumn.required` never reaches the control at all
         (AGENTS.md ▸ Mandatory fields). A star with no hold behind it is the
         one divergence the single declaration exists to rule out. */
      required: true,
      cell: (r) => (
        /* THE ID IS THE TRUTH, THE NAME IS A CACHE, and both are written HERE —
           one event, so they cannot disagree. `style_category` (text) has been
           stored since the tab was built and is what the order seed populates;
           it stays in the payload because `writeChildren` rewrites this grid
           wholesale, so dropping it would NULL it on the next save rather than
           freeze it.

           A `RecordPicker` and not the master's `CategoryPicker`: that control's
           inline "+ Add" opens the class-aware quick-create sheet, which is a
           masters affordance every other picker on this screen withholds. */
        <RecordPicker
          label="Style Category"
          compact
          required
          items={styleCategoryItems}
          value={r.style_category_id}
          onChange={(id) =>
            updateStyle(r.key, {
              style_category_id: id,
              style_category:
                styleCategoryItems.find((o) => o.id === id)?.name ?? "",
            })
          }
        />
      ),
    },
    /* "STYLE DESCRIPTION" WAS A CELL HERE FOR ONE DAY AND IS WITHDRAWN (client
       2026-08-24: "Description, style description remove one ... I can see two
       description").

       IT WAS THE SAME ANSWER TWICE ON ONE ROW, and the note it replaced argued
       the opposite — that the two are distinct because `pickStyle` seeds them
       from different columns. That is true of the COLUMNS and false of what the
       operator sees, which is what matters: the line's Description is seeded
       `s.description ?? s.style_description`, so on every style that carries no
       separate remark BOTH boxes show the style's description, side by side,
       and editing either leaves the other stale.

       THE LINE'S "Description" IS THE ONE THAT SURVIVES, and it is the older
       and the better answer. It has been on this row since the tab was built,
       its own seeding note records that it already stands for "the two fields
       legacy shows as Style Description", and on an ORDER a per-line remark is
       the useful field — the style's own description belongs to the style and is
       one click away on the master.

       THE COLUMN AND ITS VALUES STAY, and on a CHILD grid that is not the same
       edit as a header withdrawal: `writeChildren` deletes and reinserts this
       grid wholesale, so `style_description` must remain in `StyleRow`, in
       `toRows`, in `pickStyle`'s seeding and in the save payload or the next
       save NULLS it rather than freezing it. Same treatment `article_no` had
       until yesterday, and `plan_unit_id` still has. */
    {
      header: "Article No.",
      /* STORED SINCE THE TAB WAS BUILT AND NEVER SHOWN. `article_no` has been in
         the row shape, in `toRows` and in the payload throughout — seeded by
         `pickStyle`, frozen when the derived sub-line was withdrawn on
         2026-08-14. This is the first cell it has had, which is why the change
         needed no migration.

         CAPITALS come from the primitive: `Input` capitalises unless a call
         site opts out, and an article number is a stored VALUE, not prose. */
      cell: (r) => (
        <Input
          value={r.article_no}
          onChange={(e) => updateStyle(r.key, { article_no: e.target.value })}
        />
      ),
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
      /*
       * ASKED AGAIN, AND THE 08-11 DECISION IS FOLLOWED RATHER THAN UNDONE
       * (client 2026-08-27: "that order unit need to show pcs and set").
       *
       * "No longer asked" was right FOR ITS TIME: the Style master already
       * answered it, so putting the question to the operator twice invited two
       * answers that could disagree. The 08-25 unwiring made the Style manual
       * entry and took the master's answer away; the derivation that replaced
       * it reads coordinates, and no order has ever recorded one, so the column
       * has been blank on every order there is. Restoring the field is not
       * reversing 08-11 — it is what 08-11 implies once its premise is gone.
       *
       * NOT `required`, deliberately, and this is the same reasoning the
       * readOnly version carried: a blank mandatory cell HOLDS THE CURSOR
       * (AGENTS.md), and holding an operator on a two-option dropdown they have
       * no way to skip would cage every half-entered line. Blank stays a legal
       * saved state — NULL is "not answered" — and `orderUnitLabel` already
       * renders it as nothing rather than guessing.
       *
       * THE BLANK OPTION IS THE FIRST ONE for the same reason the Dyeing Type
       * cell keeps its: a line is identified by its Style ref, so a row with a
       * ref and no unit yet is a legitimate state to be passing through.
       *
       * `unitTextOf` still renders elsewhere (the price seed reads it), so the
       * stored value and the fallback stay in one function rather than this
       * cell learning the rule a second time.
       */
      /* PICKING "Piece" CAPS THE COORDINATES GRID AT ONE ROW AND WRITES NOTHING
         INTO IT (client 2026-08-29: "no need to choose PIECES also, which is
         just one coordinate … whatever it is"). It seeded a PIECES row for one
         afternoon; `answerUnitKind` carries why that was a rule about the wrong
         thing. The back-fill it used to do lives on `setStyleCoordinate`, which
         runs when the operator picks whichever coordinate it is. A plain
         two-option `Select`, and now with no side effect at all. */
      /* MANDATORY SINCE 2026-08-31 (client): "users must select either Pcs or
         Set ... this is critical because this selection triggers different
         coordinate and component mapping rules".

         THIS REVERSES THE 2026-08-27 DECISION FOUR PARAGRAPHS UP, and the
         reversal is narrower than it looks. That note refused `required`
         because "holding an operator on a two-option dropdown they have no way
         to skip would cage every half-entered line". The caution was right and
         the premise was wrong: `keyFills` in `lib/focus.ts` gives a native
         `<select>` its ↑/↓ back UNDER a hold, precisely because a hold refuses
         movement and never refuses CHOOSING (AGENTS.md). The operator answers
         it with one arrow key; Escape and Ctrl+Del still work. There is no
         cage to be caught in.

         THE BLANK OPTION STAYS. It is what an unanswered line shows, and
         removing it would default the value — "that word gets stored", which
         is the objection the 08-27 note raises against defaulting and which
         still stands. Blank is now REFUSED rather than defaulted, which is the
         difference between the two.

         ONLY ON A STARTED LINE, and that is `styleLineProblems`' half of the
         rule rather than this cell's: the star and the hold are unconditional
         here because a blank row has nothing in it to hold the cursor WITH —
         nobody has reached this cell — while the Save gate discounts the row
         entirely. See `styleLineStarted`. */
      required: true,
      cell: (r) => (
        <Select
          required
          value={r.unit_kind ?? ""}
          onChange={(e) => answerUnitKind(r.key, e.target.value || null)}
        >
          <option value=""></option>
          {UNIT_KIND_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {orderUnitLabel(o.value)}
            </option>
          ))}
        </Select>
      ),
    },
    {
      header: "PO Qty",
      align: "right",
      // The one number that comes off the buyer’s order sheet and nowhere else,
      // which is exactly why nothing can seed it and why it must be asked for.
      //
      // ON A SET PACK IT IS DERIVED AND THE REQUIREMENT MOVES WITH IT (0467).
      // The buyer orders boxes; pieces are `packs x pieces-per-pack`. A field
      // that is DISABLED and still `required` is a cursor cage with nothing on
      // screen to say why — AGENTS.md is explicit — so the requiredness
      // follows the answer to the Pack Composition, which `packProblems` gates.
      required: !form.is_set_pack,
      cell: (r) =>
        form.is_set_pack ? (
          <Input
            readOnly
            className="text-right"
            value={derivedPoQty(r) == null ? "" : String(derivedPoQty(r))}
            title={
              derivedPoQty(r) == null
                ? "Open Pack Composition and say what is in one pack"
                : `${r.packs_ordered || 0} packs x ${piecesPerPack(r)} pieces`
            }
          />
        ) : (
          <Input
            type="number"
            className="text-right"
            value={r.po_qty}
            onChange={(e) => updateStyle(r.key, { po_qty: e.target.value })}
          />
        ),
    },
    /**
     * PACKS — the commercial figure a SET order is actually booked in (0467).
     *
     * It appears only on a set pack, beside the piece count it explodes into,
     * and it is a COLUMN rather than a replacement for PO Qty because both
     * numbers are real and the operator reads both: one is what the buyer
     * ordered, the other is what the factory makes. Overwriting PO Qty with
     * packs is what would put packs into `targetsOf`, which has no multiplier.
     */
    ...(form.is_set_pack
      ? [
          {
            header: "Packs",
            align: "right" as const,
            required: true,
            cell: (r: StyleRow) => (
              <Input
                type="number"
                className="text-right"
                value={r.packs_ordered}
                onChange={(e) => updateStyle(r.key, { packs_ordered: e.target.value })}
              />
            ),
          },
        ]
      : []),
    /**
     * PACK COMPOSITION — the [Click] that says what one retail pack holds
     * (0467, client 2026-08-25).
     *
     * ONLY ON A SET PACK. It is not a column that greys out: with `is_set_pack`
     * off there is no pack, so the question does not exist rather than being
     * unanswerable — the same call the Assortments overlay makes for its carton
     * cells, which are hidden and not disabled on a solid pack because "a
     * disabled box still costs a row on a screen called cluttered".
     *
     * GATED ON THE STYLE BEING NAMED, and on nothing else. The Process button
     * beside it also requires a PO Qty; this one MUST NOT, because on a set
     * pack PO Qty is DERIVED FROM THIS SHEET — requiring it would gate the
     * control behind the number it produces, and the operator could never open
     * it. That inversion is the whole reason the gate is written out rather
     * than copied from the neighbour.
     *
     * THE COUNT IS WHAT MAKES THE PACK VISIBLE FROM OUTSIDE — "2 members · 3
     * pcs" on the row, so a style whose pack is filled in does not look like
     * one whose pack is empty, which is the argument the Process and Details
     * buttons both already record.
     */
    ...(form.is_set_pack
      ? [
          {
            header: "Pack Composition" as const,
            cell: (r: StyleRow) => {
              const named = !!(r.style_id || r.style_ref_no.trim());
              const members = r.pack_components.filter(packRowStarted).length;
              const per = piecesPerPack(r);
              return (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-full"
                  disabled={!named}
                  /* NAMES THE FIELD THAT TURNS IT ON rather than greying out in
                     silence — the rule the Assort gate states. */
                  title={named ? undefined : "Name a style on this row first"}
                  onClick={() => setPackForKey(r.key)}
                >
                  {members
                    ? `${members} member${members === 1 ? "" : "s"} · ${fmtNumber(per)} pcs`
                    : "Click"}
                </Button>
              );
            },
          },
        ]
      : []),
    {
      header: "Description",
      /* MANDATORY SINCE 2026-08-31 (client): "leaving it blank is blocked
         because reports pull directly from this text to identify style
         specifications". It has been an optional per-line remark since the tab
         was built — see the withdrawal of "Style Description" above, which is
         why THIS is the description that survives and therefore the one the
         reports read. */
      required: true,
      cell: (r) => (
        <Input
          required
          value={r.description}
          onChange={(e) => updateStyle(r.key, { description: e.target.value })}
        />
      ),
    },
    /* THE ROW IS EIGHT CELLS ON A FOURTEEN-COLUMN TRACK (2026-08-24, option B):
       the seven above share line one at `xs` (7 x 2 = 14) and Description takes
       line two whole. The composition line — Coordinates 3 · Components 8 ·
       Sizes 3 — is rendered by `componentsAndSizes` into the same grid.

       THIS NOTE USED TO SAY "FIVE FIELDS", and the arithmetic it recorded was
       about a 12-column track this row never actually had: the body was a flex
       `FieldRow`, so no `col-span` on it resolved at all. Both facts changed in
       the same edit — the track is real now, and the count is eight. */
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
      /* 7rem, DOWN FROM 10 (2026-08-29). The tab went from two grids to three
         when Fabric Print joined it, so each pane is ~390px rather than ~644.
         With the index and the ✕, 7 + 11 comes to ~23rem — which is the basis
         the tab declares on all three panes, so this width and that basis are
         one decision stated in two places and must move together.

         The value is unaffected: this cell holds "Melange", "Dyed" or "Y/D".

         `structureColumns` further down declares the same 10rem and is NOT
         touched — that grid came off this tab on 2026-08-14 and is not one of
         the three sharing the row. */
      width: "7rem",
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
            setDyeings((xs) =>
              xs.map((x) =>
                x.key === r.key ? { ...x, dye_type: e.target.value } : x,
              ),
            )
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
       * so dropping it here would stretch all three grids on this tab.
       *
       * 11rem, DOWN FROM 16 (2026-08-29) — see the note on `Type` above for the
       * arithmetic. 176px still holds a colour name; the buyer references this
       * cell also accepts ("0001") were never the long case.
       *
       * Trimmed, never dropped: those are different edits with very different
       * blast radii, and only one of them is safe.
       */
      width: "11rem",
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
              xs.map((x) =>
                x.key === r.key ? { ...x, color_id: id, color_name: name } : x,
              ),
            )
          }
          onCreate={masterPerms.canCreate ? createColour : undefined}
        />
      ),
    },
  ];

  /**
   * FABRIC PRINT — ONE COLUMN, AND IT IS TYPE-OR-PICK (client 2026-08-29:
   * "just a single field which is fabric print, allow manual entry").
   *
   * ## IT WAS A `LookupDialogPicker`, AND THE CHANGE IS THE MANUAL ENTRY
   *
   * The old cell offered the `roll_form_print` master and nothing else, so a
   * print the master had not been taught could not be entered at all. That was
   * the state this grid was in when it came off the tab on 2026-08-14; it is
   * back with the one thing the client asked for.
   *
   * ## `TypeOrPick`, WHICH IS THE COLOUR CELL'S OWN ANSWER TO THIS ASK
   *
   * Not a plain `<Input>`. The Colour cell in `dyeColumns` was asked the
   * identical question on 2026-08-17 — "allow users to manually type/input
   * color names or numbers … rather than forcing a selection strictly from the
   * master list" — and its note explains why BOTH halves stand rather than
   * flipping to free text: the master is what keeps naming consistent across
   * the company, and typing is what lets a buyer's own reference through.
   *
   * Reaching for an `<Input>` here would have cost two things that are not
   * obvious:
   *
   *  - **the ⊕**, so the print master would stop growing the day this shipped;
   *  - **`declaredPrintOptions`**, which narrows the Combos tab's Fabric Print
   *    list to the prints THIS order declared, and does it by `print_id`. A
   *    picked print still narrows it. A typed one cannot — that list is a
   *    picker over uuids — so it falls back to the full master, which is
   *    exactly what it does today with no prints declared at all. Nothing
   *    regresses; the narrowing simply keeps working for the rows that can
   *    support it.
   *
   * `print_name` IS THE VALUE either way, which is what makes the hybrid cheap:
   * nothing downstream has to learn that the id can be null.
   *
   * THE PENCIL DOES NOT SURVIVE — `LookupDialogPicker` could rename a print
   * app-wide from inside an order, and `TypeOrPick` cannot. That was always the
   * more destructive half of the convention and the Lookup master still owns it,
   * which is the same trade the Colour cell made and recorded.
   *
   * THE WIDTH IS NOT OPTIONAL: `hugsContent` is `columns.every((c) => c.width)`,
   * so dropping it here would stretch all three grids on this tab.
   */
  /**
   * RENAMED "Roll form prints" ON 2026-08-31 (client: "the label under the
   * Color/Composition tab must be standardized to Roll form prints").
   *
   * IT IS A RENAME AND NOTHING ELSE — the column, `print_id`/`print_name` and
   * `declaredPrintOptions` are untouched, and so is the `roll_form_print`
   * `config_lookups` kind the ⊕ writes into.
   *
   * THERE IS NO PRINT MASTER SCREEN TO KEEP IN STEP, and that was checked
   * rather than assumed. `roll_form_print` is a lookup KIND (0128: "no print
   * master…"); `LOOKUP_KIND_LABELS` maps it to "Roll Form Prints", but
   * `MATERIAL_CHILDREN` in `app/(app)/masters/config-sections.tsx` does not list
   * it, so that string is rendered to nobody. The only door into the vocabulary
   * is the ⊕ on this cell. So this rename touches every place an operator can
   * read the word — six strings, all in this file.
   *
   * IT STAYS OPTIONAL, which the client asked for and which was already true in
   * all four layers: no `required` here, none on the Combos cell, `uuidN` +
   * `capsTextNullable()` in the Zod input, and 0477 adds `print_name` under a
   * heading reading "NOT NULL IS NOT USED, DELIBERATELY". The reason is in the
   * garment: a roll-form (AOP) print is bought by the METRE and a garment
   * routinely mixes printed and solid panels, so a shirt with a printed front
   * and solid sleeves declares one print and three fabrics that have none.
   *
   * ## THE CLIENT'S CONTRAST DOES NOT HOLD, AND IT IS WORTH SAYING SO
   *
   * The instruction reads "unlike basic fabric properties (Composition, GSM,
   * Tolerance) which are mandatory, the Roll form prints input must remain
   * strictly optional". **None of those three was mandatory when that was
   * written**, so this note recorded that Fabric Print was not in fact the odd
   * one out, and called making them mandatory a separate decision.
   *
   * THE CLIENT TOOK THAT DECISION ON 2026-09-01 ("the composition, gsm,
   * Tolerance, Fabric type, color these field are required field"), so the
   * contrast the instruction drew now holds. `structureRequiredCells` in
   * combo-rules.ts is the declaration, and all five — Composition, GSM,
   * Tolerance, Fabric Type and Colour — carry the star, the hold and a blocked
   * Save. (GSM shipped conditional that morning and went unconditional the same
   * day: "gsm also need required for all fabric type".) **Roll form print is
   * unchanged and is now genuinely the exception it
   * was described as** — which is worth saying plainly, because the paragraph
   * this replaces argued the opposite and a reader finding it quoted elsewhere
   * is holding something superseded.
   *
   * NOT TO BE CONFUSED WITH A PLACEMENT PRINT — a chest logo screened onto a
   * panel AFTER cutting is a secondary PROCESS and lives on the style row's
   * Process sheet. Nothing here changes because of that distinction; it is
   * written down because the two are one word apart in conversation.
   */
  const printColumns: ChildGridColumn<PrintRow>[] = [
    {
      header: "Roll form prints",
      width: "16rem",
      cell: (r) => (
        <TypeOrPick
          label="Roll form print"
          createNoun="print"
          options={printPickOptions(r.print_id)}
          valueId={r.print_id}
          text={r.print_name}
          inputClassName="h-8"
          onChange={({ id, name }) =>
            setPrints((xs) =>
              xs.map((x) =>
                x.key === r.key ? { ...x, print_id: id, print_name: name } : x,
              ),
            )
          }
          onCreate={masterPerms.canCreate ? createPrint : undefined}
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
      for (const c of s.components) {
        if (c.fabric_category_id) ids.add(c.fabric_category_id);
      }
    }
    return ids;
  })();

  /** Do the order's styles declare their fabrics at all? Drives the hint. */
  const styleStructuresDeclared = orderStructureIds.size > 0;

  const scopedOrderStructures = (held: string | null) =>
    styleStructuresDeclared
      ? structureItems.filter(
          (o) => orderStructureIds.has(o.id) || o.id === held,
        )
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
            setStructures((xs) =>
              xs.map((x) => (x.key === r.key ? { ...x, structure_id: id } : x)),
            )
          }
        />
      ),
    },
    {
      header: "Type",
      width: "10rem",
      /**
       * Solid / Melange / Yarn Dyed (0415) — "users should be able to see the
       * Type for each fabric structure immediately to understand which processing
       * deadlines (T&A) will apply" (client 2026-08-12).
       *
       * ONE VOCABULARY, `ITEM_SUB_TYPE_OPTIONS`, shared with the combo structure
       * row it seeds — which is what made `Printed` leaving the list on
       * 2026-08-31 a one-line change in combo-rules.ts rather than an edit to
       * two dropdowns that could have disagreed. Not `required`: a blank is a real state that offers
       * NEITHER a colour nor a print list, and a hold here would cage the
       * operator on a row they are still reading off the buyer's sheet.
       */
      cell: (r) => (
        <Select
          value={r.item_sub_type}
          onChange={(e) =>
            setStructures((xs) =>
              xs.map((x) =>
                x.key === r.key ? { ...x, item_sub_type: e.target.value } : x,
              ),
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
      /* THE STAR STAYS UNCONDITIONAL — a combo with no style is not a colourway,
         whatever the order carries. What varies is the CONTROL's `required`,
         below, which stands down only on a row the app has already filled in. */
      required: true,
      width: STYLE_COL_W,
      cell: (r) => {
        /**
         * PRE-FETCHED AND STEPPED OVER (client 2026-08-31: "the Style Name on the
         * Composition tab must be automatically pre-fetched and populated in a
         * read-only field ... the active cursor must land directly on the Combo
         * Name text input box").
         *
         * ## THE DATA HALF WAS ALREADY BUILT, WHICH IS WHY THIS IS SMALL
         *
         * `listStylesInCombos` seeds a row per declared style on entering this
         * tab, and `addCombo` pre-fills the style on any order carrying exactly
         * one. So the value has been arriving by itself since 2026-08-28; what
         * the operator still had to do was tab THROUGH a picker to get past it.
         * This is that half.
         *
         * ## ONLY WHEN THERE IS ONE STYLE, AND THAT IS NOT A HEDGE
         *
         * "The user has already loaded and is editing a specific style" is true
         * of a single-style order and false of a Multi Style one, where three
         * combos may belong to three different styles. Freezing the cell there
         * would file every new colourway under whichever line happened to be
         * first — silently, on the tab that Prices, Quantities and Approval Qty
         * all key off. So a multi-style order keeps its picker.
         *
         * ## AND ONLY WHEN THE ROW REALLY HOLDS IT
         *
         * A read-only box showing a value the row does not store is a lie the
         * next save exposes. A legacy row whose `style_ref_no` is blank falls
         * back to the picker rather than being shown a value it has not got —
         * which is also the only way left to repair one.
         *
         * ## `autoFilledField`, NOT TWO HAND-WRITTEN FLAGS
         *
         * It derives "off the Tab path" and "required" from ONE boolean, so the
         * unsatisfiable combination — a field Tab can never reach that also holds
         * the cursor — is unrepresentable rather than merely avoided. The peer
         * change that introduced it for Order Entry's auto-filled Date and
         * Location carries the full argument; this is the third field to need it.
         *
         * `data-focus-optional` ON A WRAPPER, AND IT IS NEEDED — but not for the
         * reason this note used to give, which was checkable and false.
         *
         * It said `readOnly`'s `tabIndex={-1}` "stops Tab but NOT
         * `focusFirstField`". It stops both: `focusFirstField` walks
         * `focusablesIn`, which uses `FOCUSABLE_SELECTOR`, and EVERY branch of
         * that selector carries `:not([tabindex="-1"])` (lib/focus.ts:40 — the
         * note above it exists because that per-branch guard was once missing).
         * A `readOnly` `<Input>` never enters that list at all.
         *
         * WHAT ACTUALLY EARNS THE MARKER IS THE GRID. This cell is inside a
         * `ChildGrid`, where `tabAlongRow` owns Tab and walks `ROW_FIELDS`
         * (child-grid.tsx:61) — and `ROW_FIELDS` has NO `tabindex` guard:
         * `input:not([type="button"]):not([type="hidden"]):not([type="radio"]):not([disabled])`.
         * So inside a grid row a read-only input IS on the axis, and
         * `tabAlongRow` reads `isOffTabPath` on its destination. This marker is
         * what stops Tab landing on the collapsed Style.
         *
         * THE RULE, because it decides call sites and is stated nowhere else:
         * **a `readOnly` / auto-filled cell INSIDE a `ChildGrid` needs
         * `data-focus-optional`; the same cell OUTSIDE a grid does not.**
         * `tabIndex={-1}` takes a field off every key outside a grid, and off
         * native Tab only inside one.
         *
         * The correction matters more than the wording: the old reason was
         * falsifiable in a minute, so the next auditor would verify it, find it
         * wrong, delete the marker as dead code, and put a Tab stop back on a
         * read-only cell in every collapsed row. A comment that fails its own
         * check invites exactly that deletion. (Found 2026-08-31 while
         * enumerating marker sites; `FOCUSABLE_SELECTOR` and `ROW_FIELDS`
         * disagreeing about `tabindex="-1"` is a real gap in the one-definition
         * rule and is recorded on `ROW_FIELDS` — not changed here, since it
         * reaches 26 `ChildGrid` screens plus the hand-rolled ones.)
         */
        /* `AssortStyle.soleStyleRef`, NOT `styles.length === 1` WRITTEN AGAIN.
           The order already has one answer to "does this PO declare exactly one
           style", it is shared with the Assortments overlay, and it counts
           DISTINCT refs rather than rows — so two lines carrying one ref still
           resolve, which a length test would not. It returns "" for none. */
        const auto = autoFilledField(
          !!AssortStyle.soleStyleRef(styles) && !!r.style_ref_no.trim(),
        );
        return (
        <div className="space-y-1">
          {auto.offTabPath ? (
            <div data-focus-optional>
              <Input readOnly value={r.style_ref_no} />
            </div>
          ) : (
          <RecordPicker
            label="Style"
            compact
            required={auto.required}
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
                        style: line?.style_ref_no ?? "",
                        article_no: line?.article_no ?? "",
                      }
                    : x,
                ),
              );
            }}
          />
          )}
          {r.article_no && (
            <p className="text-xs text-muted-foreground">{r.article_no}</p>
          )}
        </div>
        );
      },
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
              xs.map((x) =>
                x.key === r.key ? { ...x, combo: e.target.value } : x,
              ),
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
          /* A CELL OF THE ROW, so Tab / Enter / the arrows all reach it — it is
             the only door to the Structure Details overlay and was mouse-only
             (client 2026-08-19, screenshot 2358). See `data-row-open` in
             child-grid.tsx. */
          data-row-open
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
      size:
        m === "size-wise" ||
        m === "color-wise size-wise" ||
        // The pack modes' size axis (2026-08-28) — kept in step with
        // `modeAxes` in `order-value.ts`, which the note above names.
        m === "pack-wise size-wise",
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
      .map((id) => ({
        id,
        name: sizeOpts.find((o) => o.id === id)?.name ?? "(size)",
      }));
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
    const known = !!styleKey(row.style_ref_no);
    const combosFor = known ? comboOptionsForStyle(row.style_ref_no) : [];
    const sizesFor = known ? sizeOptionsForStyle(row.style_ref_no).map((z) => z.id) : [];

    // Every (colour, size) pair the new mode wants a rate for. Style-wise wants
    // exactly one nameless row, which is the row already being edited.
    const wanted: { combo: string; size_id: string | null }[] =
      !axes.colour && !axes.size
        ? [{ combo: "", size_id: null }]
        : axes.colour && axes.size
          ? combosFor.flatMap((c) => sizesFor.map((z) => ({ combo: c, size_id: z })))
          : axes.colour
            ? combosFor.map((c) => ({ combo: c, size_id: null }))
            : sizesFor.map((z) => ({ combo: "", size_id: z }));

    setPriceDetails((xs) => {
      const key = styleKey(row.style_ref_no);
      /**
       * A STYLE WHOSE AXES ARE NOT KNOWN YET KEEPS ITS ONE ROW.
       *
       * With no style ref picked, `combosFor` and `sizesFor` are empty and a
       * colour/size mode therefore wants NOTHING. Reshaping to nothing would
       * delete the row the operator is standing in — so the mode is stamped and
       * the row is left alone until the style names its colours and sizes.
       */
      if (!wanted.length) {
        return xs.map((x) => (x.key === row.key ? { ...x, price_type: mode } : x));
      }

      /**
       * THE RATES ALREADY TYPED COME WITH THE MODE (client 2026-08-21,
       * screenshot 2446: "user just updated that type … automatically update
       * user last select type").
       *
       * They used to be left where they were: still saved, dropped out of the
       * grid, still blocking `orderValue`, and announced by an amber block
       * telling the operator to set Price Type BACK. An instruction to undo what
       * you just did is a refusal, not a warning.
       *
       * `reshapeRates` decides what carries: a blank axis is a wildcard, so
       * widening broadcasts (a Size-wise S = 4 becomes every colour's S), and
       * narrowing adopts only where the collapsing rates AGREE — because
       * choosing between 5.20 and 5.75 would discard one the operator typed and
       * averaging them would invent one nobody agreed. Vectors in
       * `scripts/check-price-modes.mts`.
       */
      const mine = xs.filter((x) => styleKey(x.style_ref_no) === key);
      const shaped = reshapeRates(
        wanted,
        mine.map((x) => ({ key: x.key, combo: x.combo, size_id: x.size_id, price: x.price })),
      );
      const byKey = new Map(mine.map((x) => [x.key, x]));
      const rebuilt: PriceDetailRow[] = shaped.map((w) => {
        const from = (w.key && byKey.get(w.key)) || row;
        return {
          ...from,
          // A reused row keeps its key so the box the operator is in is not
          // remounted underneath them; a new cell gets a fresh one.
          key: w.key ?? newKey(),
          style_ref_no: row.style_ref_no,
          style: row.style,
          article_no: row.article_no,
          unit: row.unit,
          price_type: mode,
          combo: w.combo,
          size_id: w.size_id,
          price: w.price,
        };
      });

      /* Spliced back where this style's rows were, so a two-style order keeps
         its rates together instead of having one style jump to the end. */
      const at = xs.findIndex((x) => styleKey(x.style_ref_no) === key);
      const others = xs.filter((x) => styleKey(x.style_ref_no) !== key);
      const before = others.filter((x) => xs.indexOf(x) < at);
      const after = others.filter((x) => xs.indexOf(x) > at);
      return [...before, ...rebuilt, ...after];
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
  /** One line of the pack-rate grid: what a box of this method, in this size,
   *  costs. Derived per render from the pack types and the styles they pack —
   *  it is not stored, and `setPackRate` is what turns it back into rows. */
  type PackPriceRow = {
    key: string;
    method: string;
    /** `null` on a Pack-wise row: one rate for the box, no size axis. */
    size_id: string | null;
    name: string;
  };
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
   * THE STYLE, NAMED ONCE FOR THE WHOLE GROUP AND NOT ASKED FOR (client
   * 2026-08-14: "already we choosed the style, why need show for all size";
   * 2026-08-31: the cursor must skip it and land on Price Type).
   *
   * ## IT WAS A `RecordPicker` UNTIL 2026-08-31
   *
   * The style is settled before this tab is ever opened — "+ Add style price"
   * has been hidden since 2026-08-20 and the groups are seeded from the Styles
   * Details lines by `pickStyle`, so the picker's own `onChange` could only ever
   * RE-POINT a group at a different line. On a tab reached one style at a time
   * that is a stop the operator has to Tab or Enter past on every group, to
   * confirm a value they did not choose here and cannot usefully change here.
   *
   * A READ-ONLY `Input` IS THE WHOLE FIX, AND IT IS DELIBERATELY NOT A HANDLER.
   * `Input` sets `tabIndex={-1}` on a readOnly box itself (the standing
   * auto-field rule), `FOCUSABLE_SELECTOR` in `lib/focus.ts` excludes
   * `[tabindex="-1"]`, and `MasterFullScreen` already calls `focusFirstField` on
   * every section switch — so the cursor lands on Price Type because Price Type
   * is now the first field, not because anything here pushed it there. Tab,
   * Shift+Tab, Enter-advance and the arrows all agree for free. A
   * `priceTypeRef.current.focus()` on section entry would have been the
   * per-screen patch AGENTS.md forbids: correct on this tab, silent on the next.
   *
   * THE VALUE IS STILL SHOWN, which was the picker's other job. A loaded
   * amendment can hold a group whose style line has since been renamed, and a
   * group that named nothing would hide which style a stored price belongs to.
   * The ✕ beside the group is the control that answers "this style is not
   * priced here" — re-pointing was never what it was for.
   *
   * NO `required` ON THE FIELD. `Input` never stamps `data-required-empty` on a
   * readOnly box — correctly, since a hold on a field with no exit is a cage —
   * so a star here would be a star with nothing behind it, the exact divergence
   * the one-declaration rule exists to prevent. The style's requiredness is
   * answered where it is typed, on Styles Details.
   *
   * WHAT WENT WITH THE PICKER: the four-field identity write (`style_ref_no` /
   * `style` / `article_no` / `unit` across every row of the group), the
   * `openPriceKey` hand-off that had to follow a group's key when its style
   * changed, and the `applyPriceMode` re-seed for "style picked second". All
   * three existed only to keep a RE-POINT consistent, and nothing re-points any
   * more — `pickStyle` still writes the same four fields when the line itself is
   * chosen, which is the path that survives.
   */
  const priceStyleCell = (g: PriceGroup) => (
    <Input
      readOnly
      value={g.refNo}
      /* An empty ref is a stored group whose style line is gone, not a blank
         waiting to be filled — say so rather than showing an empty box that
         invites a click that now does nothing. */
      placeholder={g.refNo ? undefined : "—"}
    />
  );

  /**
   * A SET PACK IS PRICED PER BOX AND ONLY PER BOX (0467, client 2026-08-25:
   * "the retail price is defined on the container pack level ... leaving the
   * high-level Price input active leads to conflicting price data on commercial
   * shipping invoices").
   *
   * So the per-garment modes come OFF THE LIST rather than the rate box being
   * greyed: a disabled rate under a mode that is still selectable says "you may
   * choose this, you just may not answer it". Narrowing the question is the
   * honest version of the same restriction, and it is what leaves the invoice
   * with one price for one thing.
   *
   * A ROW ALREADY ON A PER-GARMENT MODE KEEPS IT AND IS TAGGED. Same rule as
   * the retired pack types above and the standing "Disabled rows" rule: a
   * `<Select>` matches on VALUE, so dropping a held mode would render a priced
   * style's row blank while it went on saving that mode â€” and `styleRate`
   * would then be averaging rows the screen no longer admits exist.
   */
  const priceModeOptions = (mode: string): { value: string; label: string }[] => {
    /* THE PACK BRANCH'S OWN LIST, DECLARED ONCE (`PACK_BRANCH_PRICE_MODES`).
       It was `PRICE_TYPE_OPTIONS.filter(isPackWise)` here and again in the
       dropdown's JSX â€” two readings of one rule, which held only while "a mode
       the pack branch offers" and "a mode that prices a BOX" were the same
       sentence. They stopped being the same when plain Size-wise joined the
       list (client 2026-08-28), and `isPackWise` still has to mean the second
       one: it is the multiplicand fork in `order-value.ts`.

       The list before it was the single `PACK_WISE_PRICE`, so adding the
       size-wise sibling to the tuple would have left it unreachable on the one
       kind of order it exists for. Derived from the tuple rather than listed by
       hand, so a fourth mode needs no edit here. */
    /**
     * A PACK TYPE BEING ACTIVE IS WHAT SWITCHES THIS ON (client 2026-08-28:
     * "gate strictly on `pack`, not `is_set_pack`").
     *
     * `is_set_pack` is 0467's older "sold in packs" switch and is OFF on this
     * screen (`SET_PACK_ON_SCREEN = false`), so BOTH pack modes stood down on
     * every order â€” including the size-wise one built for exactly this. The
     * live flag is `pack`, carton sortation, which is what gates Pack type(s)
     * and the 0473 explosion.
     *
     * AND A DECLARED METHOD WITH CONTENTS, not the flag alone. An order may tick
     * carton sortation and not have written a composition yet; forcing pack
     * pricing there would take away every per-garment mode and offer a box rate
     * with no boxes to multiply â€” a refusal on a document nobody has finished.
     * "As soon as a pack-type is active" is the client's own wording and this is
     * it, stated in the terms the engine can check.
     *
     * `is_set_pack` is kept in the test rather than replaced, so a genuine
     * 0467 set pack still narrows if that switch is ever flipped back on.
     */
    /**
     * AND THE OTHER SIDE IS NARROW TOO, SINCE 2026-08-29 (client: "when Pack
     * Type is No the system completely disables the Pack Wise and Pack Size
     * grids and locks the grid to standard Style Price only").
     *
     * This fell through to the whole six-mode tuple, so an order with no pack
     * type could be priced Color-wise or Size-wise. It now offers Style-wise
     * alone. THE PACK BRANCH IS UNCHANGED â€” 08-28's three modes stand exactly as
     * they were; this is the `else`, and confusing the two would make Pack-wise
     * pricing unreachable on the only orders it exists for.
     */
    const live: readonly string[] = packPricingActive
      ? PACK_BRANCH_PRICE_MODES
      : NO_PACK_PRICE_MODES;
    const out = live.map((o) => ({ value: o, label: o }));
    /* A SAVED MODE THE LIVE LIST DOES NOT HOLD IS STILL OFFERED, TAGGED â€” and
       the tag now has to answer for both branches. It said "(not used on a pack
       order)", which was the only way to be off-list while the `else` was the
       full tuple; a Color-wise row on a NON-pack order is now off-list too, and
       that label would have told the operator the opposite of what happened.
       `packPricingActive` is the same flag the list was chosen by, so the two
       cannot disagree. */
    if (mode && !out.some((o) => o.value === mode)) {
      out.push({
        value: mode,
        label: packPricingActive
          ? `${mode} (not used on a pack order)`
          : `${mode} (not used without a pack type)`,
      });
    }
    return out;
  };

  const priceModeCell = (g: PriceGroup, mode: string) => (
    <Select
      required
      value={mode}
      onChange={(e) => applyPriceMode(g.rows[0], e.target.value)}
    >
      <option value=""></option>
      {priceModeOptions(mode).map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </Select>
  );

  /**
   * `PRICE_FETCHED_CELL`, `priceColourCell`, `priceSizeCell` AND `priceRateCell`
   * STOOD HERE AND WENT WITH THE FLAT LIST (client 2026-08-21, screenshot 2439).
   *
   * The matrix has no colour cell and no size cell: a colour is a ROW HEADING
   * written once and a size is a COLUMN heading, which is the whole reason the
   * tab shrank. The two read-only boxes those helpers drew have nowhere left to
   * be drawn, and the input-shaped chrome they shared went with them.
   *
   * WHAT THEY RECORDED IS KEPT, because it was earned and is still in force:
   *
   * - The 08-19 request behind the size cell — "tab and enter should move only
   *   to the VALUE fields, not the variable fields" — is now true BY
   *   CONSTRUCTION rather than by a read-only box: an axis label is a `<th>`,
   *   and a heading is not `isFieldLike()`, so no movement key can reach one.
   * - `priceRateCell`'s `required` moved onto the matrix cell verbatim
   *   (`components/orders/price-matrix.tsx`) and has to stay there: it is the
   *   sanctioned second declaration for a grid that renders its own row
   *   (AGENTS.md), and an unpriced rate is the one thing `styleRate` refuses on.
   * - `sizeLabel` is still the resolver for a size's NAME, now read once per
   *   COLUMN in `rateGrid` instead of once per row.
   *
   * `addRate` below is a different case and is still unused: it was kept on
   * 2026-08-20 for a restore, before this change, and nothing here revives it.
   */
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
  /* `PRICE_COLOUR_W` went with the leftover list (2026-08-21) — the last thing
     that laid a colour name out as a fixed-width CELL. The matrix writes it as
     a row HEADING, sized by `min-w`/`max-w` in the component. `PRICE_W` stays:
     the "+ Add style price" button below is still one of the four buttons the
     note at line ~6900 keeps to one width. */

  const rateGrid = (g: PriceGroup, mode: string) => {
    const axes = priceAxes(mode);
    // A row with no mode yet is one of THIS set — it is the blank the operator
    // is about to fill, not a leftover from a mode they have moved off.
    const rows = g.rows.filter((r) => !r.price_type || r.price_type === mode);
    /* THERE ARE NO LEFTOVERS ANY MORE. `applyPriceMode` reshapes this style's
       rows onto the new mode's cells and carries the typed rates across, so a
       row cannot keep a stale `price_type`, drop out of the grid and go on
       blocking `orderValue` (client 2026-08-21, screenshot 2446). The amber
       block that used to stand here told the operator to set Price Type BACK to
       the mode they had just left, which is a refusal wearing a warning's
       clothes. `groupMode` still tolerates a mixed list, because a document
       SAVED under the old behaviour can still be opened. */

    /**
     * THE AXES ARE THE ORDER'S OWN, not the rows'.
     *
     * `applyPriceMode` seeds one rate per (combo, size) this style declares, so
     * the rows and these two lists agree — but they are read from the SAME
     * functions the seeding reads (`comboOptionsForStyle` / `sizeOptionsForStyle`)
     * rather than derived back out of the rows, for two reasons. The declared
     * ORDER survives: a size run is 2 YEARS before 14 YEARS, which a pass over
     * the rows would lose. And a pair the order does NOT declare stays visible
     * as a hole in the matrix instead of silently closing up — which is the one
     * thing the flat list could never show, since a missing rate there was
     * indistinguishable from a row further down.
     */
    const colours = axes.colour ? comboOptionsForStyle(g.refNo) : [];
    const sizes = axes.size
      ? sizeOptionsForStyle(g.refNo).map((z) => ({
          id: z.id,
          // `sizeLabel`, not `z.name` — the same resolver the old Size cell used
          // (`priceSizeCell`), so a lookup label rendered one way here and
          // another way in the leftovers list is not possible.
          label: sizeLabel(z.id) || z.name,
        }))
      : [];

    /**
     * PIECES BEHIND A CELL — what weights the matrix's edge averages.
     *
     * Reads `quantityBreakup`, which is declared BELOW this function. Safe, and
     * only just: a `const` arrow is not hoisted, but `rateGrid` is called from
     * the JSX at the bottom of the component, so the breakup is initialised long
     * before this body runs. (The same note guards `orderVal` and the assortment
     * helpers — the trap there was calling from ABOVE the declaration.)
     *
     * A BLANK AXIS MATCHES EVERYTHING, which is what makes one function serve
     * all four modes: Color-wise cells carry no size, so their weight is the
     * colour's whole run; Style-wise carries neither and weighs the style.
     */
    const key = styleKey(g.refNo);
    const breakup = quantityBreakup.filter(
      (b) => styleKey(b.style_ref_no) === key,
    );
    const qtyOf = (combo: string, sizeId: string | null) => {
      const want = combo.trim().toUpperCase();
      let total = 0;
      for (const b of breakup) {
        if (want && (b.combo ?? "").trim().toUpperCase() !== want) continue;
        if (sizeId && b.size_id !== sizeId) continue;
        total += b.qty;
      }
      return total;
    };

    return (
      <div className="space-y-1.5">
        {/* SHOW QUANTITIES — a view toggle, and a `<button>` rather than a
            checkbox on purpose. Tab lands on FIELDS (AGENTS.md), and this
            changes what is displayed rather than what is stored, so it takes
            the same `tabIndex={-1}` treatment as the matrix's fill controls and
            a row's ✕: on the mouse, in screen-reader order, off the typing
            path. Offered only on the full matrix — with one axis collapsed the
            weight is the whole style's run, which the cell beside it already
            implies. */}
        {axes.colour && axes.size && (
          <div className="flex justify-end">
            <button
              type="button"
              tabIndex={-1}
              className="text-xs text-muted-foreground hover:text-foreground"
              onClick={() => setShowPriceQty((v) => !v)}
            >
              {showPriceQty ? "Hide quantities" : "Show quantities"}
            </button>
          </div>
        )}
        <PriceMatrix
          colours={colours}
          sizes={sizes}
          rates={rows}
          qtyOf={qtyOf}
          showQty={showPriceQty}
          onPrice={(rowKey, value) =>
            setPriceDetails((xs) =>
              xs.map((x) => (x.key === rowKey ? { ...x, price: value } : x)),
            )
          }
          /* ONE `setPriceDetails` FOR THE WHOLE FILL, never one per cell. Each
             updater reads the list it is handed, so seven sequential calls would
             each start from the pre-fill state and only the last would survive —
             the stale-closure fold `fillApprovalDown` records in as many words. */
          onFill={(keys, value) => {
            const hit = new Set(keys);
            setPriceDetails((xs) =>
              xs.map((x) => (hit.has(x.key) ? { ...x, price: value } : x)),
            );
          }}
        />
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
    /* THE LEFTOVER COUNT WENT WITH THE LEFTOVERS (2026-08-21). It survived the
       fold on purpose while it existed — the amber block naming those rows sat
       inside the row body, so folding would have hidden the one thing standing
       between this order and a value. `applyPriceMode` now carries the rates
       across a mode change, so there is no such state to summarise. */
    const summary = [
      mode,
      rates.length > 1 ? `${rates.length} rates` : null,
      lo == null ? null : lo === hi ? String(lo) : `${lo} – ${hi}`,
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
  /* `quantityBreakup` (once `pricingWeights`) and `orderVal` USED TO SIT HERE
     and now live beneath the
     assortment arithmetic (search `const pricingWeights`). They read
     `assortModeOf` / `sizePiecesOf`, and a `const` arrow is not hoisted — called
     from above its declaration it throws on the temporal dead zone, at render,
     for every order. Moved rather than duplicated: the alternative was a second
     copy of the multiplication, which is the disagreement the shared helper was
     introduced to end. Nothing reads either value before the JSX. */

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
    return (
      Number(styles.find((x) => x.style_ref_no.trim() === key)?.po_qty) || 0
    );
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
  /**
   * `qtyOf` · `excessQtyOf` · `approvalOf` · `projectionOf` · `totalQtyOf` AND
   * `derivedCell` STOOD HERE AND WENT WITH THE PER-SIZE GRID (2026-08-21).
   *
   * They adapted an `ApprovalQtyRow` into the six figures a grid cell drew.
   * `ApprovalQtyLines` is handed one `derive(qty, approvalQty)` instead — the
   * same three calls into `approval-qty.ts`, made once at the call site — so
   * there is no per-row adapter left to keep in step with the row type.
   *
   * `derivedCell`'s conclusion survives in the component and is worth restating
   * because it was learned twice: A DERIVED FIGURE IS BARE TEXT, NEVER A BOXED
   * INPUT (client 2026-08-20, the tab "is like a mess"). A box says "you can
   * type here", and five of the six cells in a row could not be typed in — the
   * single question on the tab was wearing the same clothes as its five answers.
   * The component draws exactly one box per colour, and everything else is text.
   *
   * `poQtyOf` above is older than any of this and was already unused before it.
   */

  // ---------------- Pack type(s) (0399) ----------------

  /**
   * ONE column, because the legacy grid has one: S No + Pack Type.
   *
   * FREE TEXT SINCE 2026-08-27 (client, "packtype field manual entry, not a
   * default value"). It was a `<Select>` over `PACK_TYPE_OPTIONS`, and that
   * tuple decided what could be entered on this tab. It no longer decides
   * anything: the column is text with no CHECK (0399 refuses one deliberately)
   * and `amendmentPackTypeInput` is `nullableText` rather than a
   * `z.enum(PACK_TYPE_OPTIONS)` — so nothing below this line ever needed the
   * list, and nothing already saved becomes invalid.
   *
   * THE TUPLE STAYS WHERE IT IS. It is the wording the explainer under the grid
   * offers as examples, and the same names 0400 seeded into the
   * `assortment_type` lookup the Quantities tab picks from. `RETIRED_PACK_TYPES`
   * stays too and now means only "not offered as an example" — there is no
   * dropdown left for a value to be off, and nothing stops an operator typing a
   * retired method, which is what manual entry means.
   *
   * WHAT THE LIST DID BESIDES CONSTRAIN: it hid a method another row had taken,
   * so a duplicate could not be entered. `packTypeIsDuplicate` says so instead
   * — see the note there for why it advises rather than holds.
   *
   * `required`, so a row that exists names a method — the tab's entire content
   * is this cell, and a blank one is a row that says nothing. The hold is
   * satisfiable by typing, and Ctrl+Del still removes a row the operator should
   * not have added (AGENTS.md, "Mandatory fields"). `Input` reads the
   * `RequiredScope` `ChildGrid` wraps each cell in, so the star and the hold
   * both still come from the one `required` above — the declaration is not
   * restated on the control because this grid renders its cells through
   * `columns.map()`, not `renderMobileRow`.
   *
   * CAPITALS ARE THE DEFAULT and are not opted out of: a pack type is a stored
   * value. Rows saved before today carry the tuple's Title Case, and
   * `normalizePackTypes` compares case-insensitively, so the two spellings can
   * never become two methods.
   */
  const packTypeColumns: ChildGridColumn<PackTypeRow>[] = [
    {
      header: "Pack Type",
      required: true,
      // Sized for the same reason the dyeing/print/structure columns are: this
      // grid is `inlineCards`, where an unsized column is `flex-1` and a lone
      // one therefore takes the entire section. `hugsContent` is
      // `columns.every((c) => c.width)`, so with one column this single key is
      // the whole condition — drop it and the field spans the row again.
      width: "16rem",
      cell: (r) => {
        const dup = packTypeIsDuplicate(r);
        return (
          <div>
            <Input
              value={r.pack_type}
              aria-invalid={dup || undefined}
              onChange={(e) =>
                setPackTypes((xs) =>
                  xs.map((x) =>
                    x.key === r.key ? { ...x, pack_type: e.target.value } : x,
                  ),
                )
              }
            />
            {dup ? (
              <p className="mt-1 text-xs text-amber-600 dark:text-amber-500">
                Already listed above; it will be saved once.
              </p>
            ) : null}
          </div>
        );
      },
    },
    {
      /* WHAT THE METHOD PACKS (0472) — legacy's expandable sub-grid, rendered
         in place rather than behind a [+]. The row has two facts now, so the
         old note here ("ONE real input ... a card per row would be a card
         around a single box") no longer holds; what still holds is the reason
         the Pack Type cell keeps its `width`, since `hugsContent` is
         `columns.every((c) => c.width)` and THIS column deliberately has none
         — it takes the rest of the line.

         THE HAND-ROLLED FRAME IS GONE (2026-08-27). It was added while
         `GRID_FRAME` did not exist — "a bare stacked grid sharing a card with a
         framed table reads as loose rows nobody chose" — and the grid card has
         since been restored, so `ChildGrid` draws that border itself. Left in
         place it would be the SECOND one, a few pixels off the real one, which
         is the doubling the note itself warned about. */
      header: "Packs",
      cell: (r) => packTypeLinesGrid(r),
    },
  ];

  /**
   * WHAT IS WRONG WITH THE T&A LADDER — SAID, AND CURRENTLY NOT ENFORCED.
   *
   * ## THE GATE IS OFF, TEMPORARILY, AND THIS LIST OUTLIVED IT
   *
   * This shipped as "an order cannot be saved without its T&A path being
   * defined" (client) and was made OPTIONAL hours later, the same day (client
   * 2026-08-31: "make it optional now will implement it later as required").
   * That is an adoption decision, not a withdrawal — **the gate is coming
   * back** — so nothing here was deleted or softened. The list is built exactly
   * as it was, carries `section: "ta"` and its labels exactly as it did, and is
   * simply no longer spread into `sectionValidity`'s `extra`. Restoring the gate
   * is putting that one line back; see the note where it was removed.
   *
   * Today it is rendered ON THE TAB as plain advisory text, so the operator
   * still reads every sentence in place. Only the enforcement went.
   *
   * Three things can be wrong — no ladder at all, a row with no activity, and a
   * ladder that will not schedule — and each keeps its own sentence. That
   * mattered under the gate because a blocked Save reads the FIRST one out loud
   * and steers the cursor at it; it still matters without one, because a single
   * "the T&A tab is incomplete" would be true of all three and useful for none.
   *
   * ## WHERE THEY WOULD GO: `extra`, NOT `fields`
   *
   * `fields` states "this box is blank"; every rule here is arithmetic ACROSS
   * rows — the earliest of N shipment dates, a chain of offsets that has to
   * reach a date — which `FieldCheck.empty` cannot express, since it is handed
   * `form` and the ladder does not live there. That is exactly what `extra` is
   * for, and it is the same call `quantityProblems` and `comboProblems` make.
   *
   * ## THE LADDER'S OWN REFUSALS ARE PASSED THROUGH UNCHANGED
   *
   * `backwardSchedule` already refuses a blank Days BY NAME ("Knitting: enter
   * how many days it needs"), a negative one ("Lead time cannot be negative")
   * and a missing anchor ("Enter the Earlier Shipment Date on the Quantities tab
   * before scheduling"). Restating any of them here would be a second answer to
   * a question that already has one, and the copy that drifted would be the one
   * the operator reads. So this wraps the sentence and does not write one.
   *
   * ## THE ONE RULE THE LADDER CANNOT SEE IS A ROW WITH NO ACTIVITY
   *
   * `orderTaLadder` schedules by `days_required` and carries `activity_id`
   * without reading it — so a row the operator added, gave "3" to and never
   * named SCHEDULES PERFECTLY and stores a step that is nothing. The ladder is
   * right not to check it (its job is dates), which is why the check is here.
   * It is stated in the grid too, by `required` on the Activity column, and the
   * two agree by construction: both fire on `!activity_id`.
   */
  /**
   * IS THE LADDER EMPTY BECAUSE THE MASTER IS, OR BECAUSE THE OPERATOR EMPTIED
   * IT? — one test, read by the blocked-Save message and by the empty state
   * under the grid, so the two can never tell the operator different stories
   * about the same screen.
   *
   * The distinction is worth a named const rather than being inlined twice
   * because the two answers send the operator to two different places: an empty
   * master is fixed on Orders ▸ TA Activity, an emptied grid is fixed here with
   * "+ Add activity". Telling somebody who has just deleted ten rows to go and
   * populate a master sends them somewhere they can do nothing useful.
   *
   * `every(isInactive)` rather than `length === 0`: a master holding ten rows
   * that are all switched off is empty AS FAR AS THIS SCREEN IS CONCERNED,
   * because `seedTaLadder` filters exactly the same way. Testing `length` would
   * make the screen claim the master has activities while the seed refuses to
   * use any of them — and `[].every()` is true, so the genuinely empty case is
   * still covered.
   */
  const taMasterEmpty = data.taActivities.every((a) => isInactive(a));

  const taProblems: Problem[] = (() => {
    if (taRows.length === 0) {
      /**
       * THE RULE DOES NOT STAND DOWN WHEN THE MASTER IS EMPTY, and that is the
       * single most important line in this block.
       *
       * "Require a ladder only if activities exist" is a guard phrased as
       * "restrict only in case X", which is exactly the shape that leaked
       * through every state that was not X in the nominated-vendor bug
       * (AGENTS.md: MBA tested `supplyType !== "Nominated"`, a new row starts
       * blank, and the first dropdown an operator opened listed every vendor).
       * The client's rule is that an order cannot be saved without its T&A path
       * being defined; an empty master does not make that false, it makes it
       * unsatisfiable — and the answer to unsatisfiable is to SAY SO, not to
       * quietly drop the requirement.
       *
       * So the rule stays and the SCREEN explains. That is the
       * `nominatedVendorOptions()` shape — "empty-and-explain, never fall back",
       * because a silent fallback makes the rule advisory and the operator never
       * learns what needs filling in.
       *
       * THIS SURVIVES THE TAB BEING MADE OPTIONAL, and is the reason to be
       * careful when the gate returns. The client has made the rule advisory
       * DELIBERATELY, for now, by taking the whole list out of `extra`. That is
       * not the same act as a condition inside the rule quietly excusing itself
       * when a master happens to be empty: one is a decision somebody made and
       * can reverse in one line, the other is a hole nobody chose. Restore the
       * gate by putting `...taProblems` back — never by making this branch
       * conditional on `data.taActivities.length`.
       *
       * TWO CAUSES, TWO SENTENCES, because they have two different fixes and
       * only the screen can tell them apart. An empty MASTER is somebody else's
       * screen; an emptied GRID is this one, and telling an operator who deleted
       * ten rows to go and populate a master would send them somewhere they can
       * do nothing useful. `data.taActivities` is the master and `taRows` is the
       * grid, so the test is exact rather than a guess.
       */
      return [
        {
          section: "ta",
          label: "T&A",
          /**
           * THE MENU PATH IS RESOLVED, NOT REMEMBERED. `Orders ▸ TA Activity`
           * reads off `lib/nav/module-groups.ts`: the leaf is labelled "TA
           * Activity", not "TA Masters", which is only the ROUTE
           * (`/orders/ta-masters`) — the URL and the label genuinely differ here,
           * which is the trap. A direction naming a row that does not exist is
           * worse than none: the operator goes looking, fails, and concludes the
           * screen is broken rather than the sentence. `npm run check:nav-paths`
           * resolves every ▸ segment for exactly this reason, and it reads a
           * string literal like this one as well as prose.
           *
           * THE SUB-MODULE IS DELIBERATELY SKIPPED. The full path is
           * Orders ▸ Time & Action (TA) ▸ TA Activity, and dropping the middle
           * segment is the shorthand AGENTS.md sanctions ("a shorthand that skips
           * the sub-module resolves, because the row is unambiguous") — there is
           * exactly one TA Activity row in the Orders registry.
           *
           * IT USED TO BE THE ONLY FORM THE CHECK COULD READ, and that was fixed
           * on 2026-08-31: `check-nav-paths.mts` built a segment out of
           * `[A-Z0-9][A-Za-z0-9&'()/-]*`, so a word starting with "(" ended it and
           * "Time & Action (TA)" clipped to "Time & Action", which resolved
           * against nothing — writing this sentence in FULL failed the very check
           * meant to keep it correct. The opener is now `[A-Z0-9(]`. Worth
           * keeping: a checker that rejects the correct sentence teaches the
           * wrong one, and the natural response — change the sentence — is what
           * hid it.
           *
           * THE SHORTHAND STILL SHIPS, and that is a choice rather than a
           * leftover. That `WORD` fix was uncommitted when this was written, so
           * the shorthand — which resolves under BOTH openers, where the full
           * path resolves under only the new one — was the form not coupled to an
           * unlanded change. Both are equally true; complete it if you like, once
           * the fix is committed.
           */
          message: taMasterEmpty
            ? "This order has no T&A path, and there are no active activities " +
              "to build one from. Add them on Orders ▸ TA Activity, then reopen " +
              "this order."
            : "This order has no T&A path. Add the activities it has to follow " +
              "on the T&A tab.",
          kind: "custom" as const,
        },
      ];
    }
    /* COUNTED, NOT NAMED, AND THAT IS THE EXCEPTION RATHER THAN THE HOUSE RULE.
       `comboProblems` names its destination because "Combos row 2, fabric 3" is
       a place the reveal cannot reach; here it CAN — `revealFirstProblem` opens
       this tab and the cursor lands on the first `data-required-empty`, which is
       the first unnamed row. So three separate lines would be three messages
       pointing at one cursor, and only the count adds anything the operator
       cannot already see. It is also the one thing a NAME could not supply: an
       unnamed row has no name. */
    const unnamed = taRows.filter((r) => !r.activity_id).length;
    const nameless: Problem[] = unnamed
      ? [
          {
            section: "ta",
            label: "Activity",
            message:
              unnamed === 1
                ? "A T&A row has no activity. Name it or remove it (Ctrl+Del on the row)."
                : `${unnamed} T&A rows have no activity. Name them or remove them (Ctrl+Del on a row).`,
            kind: "custom" as const,
          },
        ]
      : [];
    const refusal: Problem[] = isRefusal(taLadder)
      ? [
          {
            section: "ta",
            label: "T&A",
            message: taLadder.refused,
            kind: "custom" as const,
          },
        ]
      : [];
    return [...nameless, ...refusal];
  })();

  /**
   * The four columns. Days is the only one the operator types into: Target Date
   * comes out of the ladder, Dept comes off the activity, and Activity is
   * PICKED rather than typed.
   *
   * ## READ-ONLY CELLS ARE `<Input readOnly>`, NOT TEXT
   *
   * Same call `priceStyleCell` makes and for the same reasons: `Input` sets
   * `tabIndex={-1}` on a readOnly box itself (the standing auto-field rule), so
   * the cell leaves the Tab path with no per-screen opt-out and no handler; it
   * never stamps `data-required-empty`, so a derived value can never cage the
   * operator on a field with no exit; and the value stays selectable, so a date
   * can be copied. A `<span>` would give the first two and lose the third while
   * looking different from every other cell in the row.
   */
  const taColumns: ChildGridColumn<TaRow>[] = [
    {
      header: "Activity",
      /* NOT `required` — TEMPORARY, WITH THE TAB (client 2026-08-31: "make ta
         tab all the field as optional now ... will implement it later as
         required"). It read `required: true`, which drew the star and, through
         `RequiredScope` + `useRequiredHold`, HELD THE CURSOR on a blank cell.

         BOTH HALVES CAME OUT TOGETHER AND MUST GO BACK TOGETHER. A star with no
         hold, or a hold with no star, is the exact divergence
         `--check grid-required-mobile` exists to catch and that four screens in
         this repo each rediscovered independently.

         AND LEAVING THE HOLD WOULD HAVE BEEN WORSE THAN COSMETIC. Since the tab
         stopped blocking Save, a hold here would cage the operator in a cell on
         a tab that no longer gates anything — they could neither fill it nor
         Tab out, and Escape would be the only way on. AGENTS.md's rule is that
         a field HOLDS THE CURSOR because "the record cannot be saved without
         it"; that premise is false today, so the hold has to go with it rather
         than outlive its own justification. */
      cell: (r) => {
        /**
         * OFF THE TAB PATH WHILE IT HOLDS A VALUE — the same two-flags-from-one
         * -boolean rule Order Info's Unit and Date follow, applied to a cell the
         * app fills in.
         *
         * The client wants the cursor to land on the first editable **Days** box
         * on entering this tab. `MasterFullScreen` calls `focusFirstField` on
         * every section switch and that function skips `[data-focus-optional]`,
         * so a seeded ladder — every Activity filled — lands on Days with no new
         * code, no `useEffect` and no per-screen focus grab. A tab-local focus
         * hack is the shape AGENTS.md forbids by name.
         *
         * `autoFilledField` is what makes it SAFE rather than merely convenient.
         * A cell Tab can never reach that ALSO holds the cursor while blank is
         * an unsatisfiable cage — the operator can neither be brought to it nor
         * leave it. Both flags come from the one `filled` boolean, so "off the
         * Tab path AND holding" is unrepresentable: filled → Tab steps over it,
         * blank → it comes straight back onto the Tab path with the hold that
         * makes the operator answer it. ← → and the mouse always reach it, so
         * changing a seeded activity deliberately still works.
         */
        const auto = autoFilledField(!!r.activity_id);
        return (
          <div data-focus-optional={auto.offTabPath ? "" : undefined}>
            <RecordPicker
              label="Activity"
              compact
              /* EVERY activity, including switched-off ones — the other half of
                 the "Disabled rows" rule. `seedTaLadder` filters `isInactive`
                 so a retired activity is never seeded onto a NEW ladder; the
                 picker keeps them all so an activity a SAVED order already names
                 still resolves to its own name instead of rendering empty and
                 blanking the FK on the next save. `DataPicker` hides the
                 inactive rows from the list itself and tags a held one. */
              items={data.taActivities}
              value={r.activity_id}
              /* ONE STEP, ONCE. A ladder listing Knitting twice is not a plan —
                 each step is scheduled back from the one after it, so a repeat
                 double-counts its own lead time. `usedIds` is every OTHER row's
                 activity, so the row's own value is never hidden from itself. */
              usedIds={taRows.filter((x) => x.key !== r.key).map((x) => x.activity_id).filter(Boolean) as string[]}
              onChange={(id) =>
                setTaRows((xs) =>
                  xs.map((x) => (x.key === r.key ? { ...x, activity_id: id } : x)),
                )
              }
            />
          </div>
        );
      },
    },
    {
      header: "Days",
      align: "right",
      width: "7rem",
      /* STILL THE ONE THE OPERATOR ANSWERS — but NOT `required`, temporarily
         (client 2026-08-31, with the rest of the tab). This column declared it
         TWICE on purpose: once here for the star and the `RequiredScope` hold,
         and once on the `<Input>` below, because `useRequiredHold` ORs the two
         and a `renderMobileRow` layout would bypass the column declaration
         entirely. Two declarations means TWO REMOVALS, and both are done — a
         surviving `required` on the control would keep holding the cursor with
         no star to explain it, which is the same divergence upside down.

         RESTORING IT IS BOTH LINES, not one. That asymmetry is the whole reason
         it is spelled out here: the star is visible and the hold is not, so the
         forgotten half is always the one nobody notices until an operator is
         stuck in a cell. See the Activity column above for why the hold could
         not simply be left in place. */
      cell: (r) => (
        <Input
          type="number"
          className="text-right"
          value={r.days_required}
          onChange={(e) =>
            setTaRows((xs) =>
              xs.map((x) =>
                x.key === r.key ? { ...x, days_required: e.target.value } : x,
              ),
            )
          }
        />
      ),
    },
    {
      header: "Target Date",
      width: "9rem",
      cell: (r) => {
        const d = taDates.get(r.row_uid);
        return (
          <Input
            readOnly
            /* `fmtDate`, never `toLocaleDateString` — DD/MM/YYYY is owned by
               `lib/format.ts` and nothing formats a date at a call site. Blank
               while the ladder refuses: a date the plan cannot actually produce
               is worse than an empty box, because it would be read as a
               commitment. The refusal itself is on the line above the grid and
               in the blocked-Save message, so nothing is hidden. */
            value={d ? fmtDate(d.target_date) : ""}
          />
        );
      },
    },
    {
      header: "Dept",
      cell: (r) => (
        /* READ THROUGH THE ACTIVITY, never stored on the row — see
           `taActivityById`. Blank when the row has no activity yet, which is the
           honest answer and the state the Activity cell is already holding the
           cursor for. */
        <Input readOnly value={taActivityById.get(r.activity_id ?? "")?.department ?? ""} />
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
   * ## THE "NONE LINKED" FALLBACK IS GONE (client 2026-08-29)
   *
   * "It will retrieve and list ONLY the consignees registered under the selected
   * Buyer/Customer … ensures that users cannot accidentally assign an order to
   * an unrelated customer's consignee."
   *
   * That sentence is incompatible with what stood here. This used to answer a
   * customer with no linked consignees by offering EVERY consignee plus a line
   * saying why — reasoning that "empty would read as 'this customer ships
   * nowhere', which is a claim the data does not support". The reasoning was
   * honest and the behaviour was still the thing the client has now ruled out:
   * the fallback is precisely how an order reaches an unrelated customer's
   * consignee, and the explanatory line does not stop a click.
   *
   * It is now empty-and-explain — the nominated-vendor shape, in the words
   * AGENTS.md uses for it: "Empty-and-explain, never fall back to the full list:
   * a silent fallback makes the nomination list advisory and the operator never
   * learns it needs filling in." An empty list here is a prompt to go and link
   * the consignee to the customer, which is the thing that actually fixes it.
   *
   * **AND IT COSTS NOTHING, WHICH IS WHY IT IS SAFE.** The Consignee cell is not
   * `required` — measured, not assumed: the `RecordPicker` below passes no
   * `required`, so an empty list stops no save. Contrast the Combos overlay's
   * Coordinate cell, which IS required and therefore keeps its full-list
   * fallback: there an empty list would be an unsaveable line. Same question,
   * opposite answers, and the requiredness is what decides it.
   *
   * Live shape, measured 2026-08-29: 8 consignees, 5 linked to a customer and 3
   * not; 6 customers, of which 4 have at least one consignee and 2 (AARSAN
   * AMERICAS LLC, JOSTENS) have none. So this is not theoretical — an order for
   * either of those two now shows an empty Consignee list until somebody links
   * one on the Consignee master, and that is the intended outcome.
   *
   * ## "ON THE BACKEND" IS DELIBERATELY NOT WHERE THIS RUNS
   *
   * The ask says the filter should be a backend one. It stays here, and the
   * reason is a standing rule rather than convenience — AGENTS.md, "Disabled
   * rows": "Services must SELECT the flag column — an option list that filters
   * in SQL satisfies half the rule and breaks the other half, because the value
   * a record already holds then resolves to nothing." A SQL-side filter would
   * drop a consignee a SAVED line already names the moment its customer link
   * changed, showing a filled cell as empty and blanking the FK on the next
   * save. `data.consignees` is one small list this screen already loads, and
   * filtering it here is what lets the held value survive.
   *
   * THREE STATES NOW, each with its own reason:
   *
   *  - No customer picked yet -> everything. There is nothing to narrow BY, and
   *    a quantity line can legitimately be entered before the header is
   *    finished. This one is unchanged and is NOT the case the client ruled on.
   *  - Customer picked -> that customer's consignees, and only those. Empty is
   *    a legitimate answer, with a line saying what to do about it.
   *  - A row already NAMES a consignee -> it survives whatever the filter says.
   *    Dropping it would show a filled cell as empty and blank the FK on the
   *    next save ("Disabled rows"). Quantities' Ref No used to make the same
   *    move; it no longer needs to, being free text since 2026-08-17 — a typed
   *    value cannot be dropped by a list that is not there.
   */
  const consigneeOptions = (held: string | null) => {
    const cust = form.customer_id;
    if (!cust) return { items: data.consignees, hint: null };
    const mine = data.consignees.filter((c) => c.customer_id === cust);
    /* THE HELD ONE ALWAYS SURVIVES — including when it belongs to another
       customer, which is now the only way it can be off-list. That is the
       "Disabled rows" rule and it deliberately outranks the narrowing: showing a
       filled cell as empty is silent data loss, while showing one row the filter
       would not have offered is visible and correct. */
    const items = !held || mine.some((c) => c.id === held)
      ? mine
      : [...mine, ...data.consignees.filter((c) => c.id === held)];
    return {
      items,
      hint: items.length ? null : "— no consignee linked to this customer —",
    };
  };

  /** The style NAME behind a ref no, read off the Styles tab so the two cannot
   *  disagree. Empty when the ref names no style the amendment carries.
   *
   *  SINCE 2026-08-25 the ref IS the name — it used to hop through the line's
   *  `style_id` into the master, and a typed Style has no id. `styleKey` rather
   *  than `===` on the way, like every other join in this module: a ref saved
   *  before the CAPITALS rule must still find its line. */
  const styleNoForRef = (ref: string) =>
    styles.find((x) => styleKey(x.style_ref_no) === styleKey(ref))
      ?.style_ref_no ?? "";

  const setQty = (key: string, patch: Partial<QuantityRow>) =>
    setQuantities((xs) =>
      xs.map((x) => (x.key === key ? { ...x, ...patch } : x)),
    );

  /**
   * A ROW'S OWN DELIVERY DATE, AND THE D-1 THAT TRAILS IT (client 2026-08-31:
   * "Write a hook that triggers on value changes: Earlier Shipment Date =
   * Delivery Date - 1 Day").
   *
   * NOT A `useEffect`, deliberately. An effect watching `quantities` would fire
   * on every keystroke in every cell of the grid and would have to work out
   * which row and which field had moved before deciding whether to rewrite a
   * date — and it would rewrite it one render LATE, so an operator tabbing
   * straight off a delivery date would leave the field before the shipment date
   * caught up. The change handler has the old value, the new value and the row
   * all in scope, so the recomputation lands in the same render as the
   * keystroke. Same argument `useDuplicateName` makes in AGENTS.md for
   * answering synchronously rather than 300 ms later.
   *
   * THE OVERRIDE IS REMEMBERED BY THE VALUE, not by a flag — `followsShip` is
   * the same test `setHeaderDeliveryDate` applies one level up, and the long
   * note there is the reasoning for both. Blank counts as following: an
   * operator who has not answered has not overridden.
   */
  const setRowDeliveryDate = (r: QuantityRow, next: string) => {
    const followsShip =
      !r.earlier_shipment_date || r.earlier_shipment_date === dayBefore(r.delivery_date);
    setQty(r.key, {
      delivery_date: next,
      ...(followsShip ? { earlier_shipment_date: dayBefore(next) } : {}),
    });
  };

  const assortmentTypes = lookups.filter((l) => l.kind === "assortment_type");

  /**
   * SOLID / SOLID — the assortment a packed order starts on (client 2026-08-29:
   * "when Pack Type is Yes the system dynamically updates the assortment
   * configuration to Solid Pack and Solid Size").
   *
   * MATCHED ON `code`, NOT ON THE NAME. `isCircularKnit` in `combo-rules.ts`
   * records why at length: a lookup's name can be re-typed from the picker's own
   * pencil, and a name match "would compile, run, and quietly stop" doing its
   * job. `solid_solid` is 0400's seeded code. The name is a fallback for a row
   * somebody added by hand without one, which is a thing that list allows.
   *
   * NULL WHEN THE LOOKUP IS MISSING OR SWITCHED OFF, and the caller then leaves
   * every row alone — an empty-and-explain, never a guess. Defaulting to
   * "the first assortment type" would put Solid/Assort on a packed order,
   * confidently and wrongly.
   */
  const solidSolidAssortmentId = (): string | null => {
    const hit = assortmentTypes.find(
      (l) =>
        (l.code ?? "").trim().toLowerCase() === "solid_solid" ||
        (l.name ?? "").trim().toLowerCase() === "solid colour / solid size",
    );
    return hit && !isInactive(hit) ? hit.id : null;
  };

  /**
   * PACK, ANSWERED — and turning it ON answers the Quantities grid's Assortment
   * Type for the rows that have not said otherwise (client 2026-08-29).
   *
   * A packed order is sorted into cartons, and the ordinary carton is one colour
   * and one size. That is the answer on the overwhelming majority of lines, and
   * making the operator pick it per destination is the same keystroke the PCS
   * coordinate rule above removes.
   *
   * ## THE THREE GUARDS ARE THE SAME THREE, and that is deliberate
   *
   * - **On the change, never in an effect.** An effect keyed on `form.pack`
   *   fires when a SAVED order is opened and would stamp Solid/Solid over every
   *   assortment a finished order had already answered. The rule this screen
   *   states in five other places.
   * - **Blanks only.** A line already carrying Solid/Assort is an answer, and a
   *   packed order legitimately holds both kinds — that is the whole point of
   *   the column. Overwriting would make the mixed case unenterable.
   * - **Only ON.** Turning Pack OFF clears nothing. The assortment rows stay as
   *   they are, because deleting entered values when a switch changes is the
   *   data loss "Disabled rows" refuses, and because the operator may be
   *   toggling to look at the other branch.
   */
  const answerPack = (pack: boolean) => {
    const id = pack ? solidSolidAssortmentId() : null;
    set({ pack });
    if (!id) return;
    setQuantities((xs) => {
      let changed = false;
      const next = xs.map((r) => {
        if (r.assortment_type_id) return r;
        changed = true;
        return { ...r, assortment_type_id: id };
      });
      /* Same array back when every line already answered — an identity check
         for the same reason `carryDownGsm` keeps one: this runs on a switch the
         operator may flip twice while reading, and re-creating every quantity
         row for no change marks a saved order dirty. */
      return changed ? next : xs;
    });
  };


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
  /* THIN WRAPPERS OVER `lib/orders/amendments/assort-style.ts`. The rules moved
     out of this component on 2026-08-20 so a vector could reach them: the same
     defect — an assortment overlay with NO SIZE COLUMNS — was reported twice in
     two days (screenshots 2418 and 2419) and cleared `tsc`, the build and every
     audit both times, because a destination's free-text Ref No and a style's
     reference are both `string`. `scripts/check-assort-style.mts` covers them
     now; the casts are safe because `SizeRow` and `StyleRow` are structural
     supersets of the module's own shapes. */
  const sizesOfRef = (ref: string): SizeRow[] =>
    AssortStyle.sizesOfRef(styles, ref) as SizeRow[];

  /**
   * WHICH STYLE ONE LINE PACKS — the Single / Multiple switch, resolved (0433).
   *
   * The one place the switch is read, so the columns, the combo list, the size
   * locks and the validation cannot each reach a different answer. On a Single
   * Style pack the line's own `style_ref_no` is deliberately IGNORED rather than
   * cleared: flipping the switch back and forth must not destroy what was typed
   * under the other setting (the same reasoning `toPayload` gives for sending it
   * either way).
   */
  /**
   * THE ORDER'S ONLY STYLE, WHEN IT HAS ONLY ONE — the value a line inherits.
   *
   * From `styleRefOptions`, which is built from the STYLE(S) SECTION, i.e. the
   * real style reference numbers.
   */
  /* Derived from `styles` DIRECTLY rather than from `styleRefOptions`, which is
     declared ~900 lines further down: reading it here is a temporal-dead-zone
     error, not a style preference. Same dedupe, same normalisation — this is the
     source both read. */
  const declaredStyleRefs = AssortStyle.declaredStyleRefs(styles);
  const soleStyleRef = AssortStyle.soleStyleRef(styles);

  /**
   * THE REF NO, BUT ONLY WHEN IT REALLY NAMES A DECLARED STYLE.
   *
   * The Quantities "Ref No" is free text (client 2026-08-17) and usually holds a
   * destination reference — `12` in screenshot 2418. But it was a STYLE PICKER
   * until that date, so on real orders it very often still holds a style ref,
   * and `styleNoForRef` already resolves it when it does.
   *
   * Matching before using is the whole safety of this: `12` matches no declared
   * style and falls straight through, so the value the client objected to can
   * never reach a style field again. Only a ref that IS one of the order's
   * styles is treated as one.
   */
  const declaredStyleRef = (text: string): string =>
    AssortStyle.declaredStyleRef(styles, text);

  /**
   * WHAT A DESTINATION'S ASSORTMENT LINE INHERITS, in order of how specific the
   * claim is:
   *
   *   1. the destination's own Ref No, IF it names a declared style — the most
   *      specific thing the record says about this destination;
   *   2. otherwise the order's only style, when it declares exactly one — no
   *      other answer is possible, so asking would be noise;
   *   3. otherwise nothing, and the operator picks. With several styles declared
   *      and no clue which this destination packs, a guess would be a wrong
   *      default that saves as if it were an answer.
   */
  const inheritedStyleFor = (q: QuantityRow): string =>
    AssortStyle.inheritedStyleFor(styles, q);

  /**
   * WHICH STYLE A LINE PACKS — and it is NOT the destination's "Ref No".
   *
   * ## THE MIS-WIRING THIS FIXES (client 2026-08-20, screenshot 2418)
   *
   * This read `q.style_ref_no` and treated it as a style reference. The COLUMN
   * is still called that, but since **2026-08-17** it is the Quantities tab's
   * free-text **Ref No** — the client's own instruction: *"that Ref No field
   * only free text, no more fetching from any table, so remove that wired table
   * connection."* An operator types a destination reference into it. In
   * screenshot 2418 it holds `12`.
   *
   * So the overlay was showing `12` where a style belongs, and — worse —
   * `sizesForOverlay` resolved its size columns from `12`, found no style, and
   * produced a grid with no size columns at all. The empty matrix in that
   * screenshot is this bug, not a missing style.
   *
   * A NAME IS NOT A CONTRACT. `style_ref_no` on `quantities` and
   * `style_ref_no` on a style row are the same words for different facts, and
   * that is exactly why this compiled, type-checked and built clean for weeks.
   *
   * The style now comes from where styles are declared, and falls back to the
   * order's sole style rather than to the destination's reference.
   */
  const assortLineRef = (q: QuantityRow, l: AssortLineRow): string =>
    AssortStyle.assortLineRef(styles, q, l);

  /**
   * THE OVERLAY'S SIZE COLUMNS — one style's sizes, or the union of several.
   *
   * Single Style is unchanged: the destination's own style says which sizes
   * exist. Multiple Style has no single answer to take, so the columns are the
   * UNION over every style in play — the destination's, plus each line's.
   *
   * ORDER IS THE DATA (0407), so the union preserves it rather than sorting:
   * each style contributes its sizes in its own declared order, and a size a
   * later style introduces is appended where it first appears. Sorting by the
   * sizes master instead would be stable across styles and would silently
   * re-order a grid the operator has been reading left-to-right all morning.
   *
   * A size is identified by `size_id`, never by its label — two styles naming
   * "3" mean the same `config_lookups` row and must share one column.
   */
  /* THE FIX FOR SCREENSHOT 2419. Both branches used to resolve from the RAW
     `q.style_ref_no` — free text, `12` on that order — which names no style, so
     the column set came back empty and no break-up could be typed. They now go
     through `inheritedStyleFor` like every other consumer. See the module. */
  const sizesForOverlay = (q: QuantityRow): SizeRow[] =>
    AssortStyle.sizesForOverlay(styles, q) as SizeRow[];

  /** Does the style THIS line packs carry this size? — the cell-level lock. */
  const lineHasSize = (
    q: QuantityRow,
    l: AssortLineRow,
    sizeId: string,
  ): boolean =>
    /* THE BOXES ROW SPANS EVERY SIZE THE GRID DRAWS (2026-08-28). One box holds
       every style at once, so its cells are the union, not one style's. Read
       through `sizesOfRef` like any other line, a multi-style pack row resolves
       to no style, every cell came back `readOnly`, and the one row the
       operator is supposed to type into had nothing typeable on it. */
    l.is_pack_row
      ? sizesForOverlay(q).some((z) => z.size_id === sizeId)
      : sizesOfRef(assortLineRef(q, l)).some((z) => z.size_id === sizeId);

  const mutAssort = (
    qtyKey: string,
    fn: (xs: AssortLineRow[]) => AssortLineRow[],
  ) =>
    setQuantities((xs) =>
      xs.map((x) =>
        x.key === qtyKey ? { ...x, assort_lines: fn(x.assort_lines) } : x,
      ),
    );
  const patchAssort = (
    qtyKey: string,
    lineKey: string,
    patch: Partial<AssortLineRow>,
  ) =>
    mutAssort(qtyKey, (ls) =>
      ls.map((l) => (l.key === lineKey ? { ...l, ...patch } : l)),
    );

  /**
   * Set one size cell of one line.
   *
   * The cell is created on first keystroke rather than pre-seeded for every
   * size: a line that names no XL should store nothing about XL, and seeding a
   * row of zeroes would make `assortLineFilled` treat an untouched line as
   * answered. An explicit typed 0 is kept — that one IS a statement.
   */
  /**
   * EVERY PACK TYPE'S LINES, FLAT — the left-hand factor of the explosion
   * (0473). Nested in `packTypes` on screen, flat here because that is the
   * shape `pack-type-explosion.ts` reads and the shape the payload takes.
   */
  const allPackTypeLines = packTypes.flatMap((r) =>
    r.lines.map((l) => ({
      pack_type: r.pack_type,
      style_ref_no: l.style_ref_no,
      combo: l.combo,
      qty: l.qty,
    })),
  );

  /**
   * IS THIS ORDER PRICED BY THE BOX? — one answer, read by the Prices tab's
   * mode list AND by the grid it draws (client 2026-08-28).
   *
   * `pack` (carton sortation) AND a declared method that actually holds a
   * composition. The flag alone is not enough: an order may tick sortation
   * before anyone has written what a box contains, and switching the Prices tab
   * over then would take away every per-garment mode and offer a box rate with
   * no box to attach it to.
   *
   * `is_set_pack` stays in the test so 0467's older "sold in packs" switch still
   * narrows the tab if it is ever turned back on (`SET_PACK_ON_SCREEN`).
   */
  const declaredPackMethods = Array.from(
    new Set(packTypes.map((r) => r.pack_type.trim().toUpperCase()).filter(Boolean)),
  ).filter((m) => PackExplode.packContents(allPackTypeLines, m).length > 0);

  const packPricingActive = form.is_set_pack || (form.pack && declaredPackMethods.length > 0);

  /**
   * THE PRICES TAB, WHEN THE BUYER BUYS BOXES (client 2026-08-28).
   *
   * "The screen will strictly list the selected Pack Name broken down by Sizes.
   * The operator will enter a single, overall price for that pack-size
   * combination, regardless of how many individual styles or colours make up
   * the pack inside."
   *
   * ## THE GRID IS A PROJECTION; THE STORAGE DOES NOT CHANGE
   *
   * `price_details` stays one row per (style, colour, size) — the shape
   * `styleRate`, `orderValue`, the Logistic tab's Avg Rate and
   * `check:order-value` all read. What the operator types once against
   * (method, size) is written to EVERY style that method packs, at that size.
   *
   * That is not duplication for its own sake: a pack rate is a rate per BOX, and
   * `pack_group` is what stops the box being counted once per style. The rows
   * carry the same figure precisely so the group test can see they agree —
   * `orderValue` refuses a group whose members quote different rates, so writing
   * one style and leaving the rest blank would refuse the whole order.
   *
   * ## SIZES ARE THE UNION ACROSS THE PACK'S STYLES
   *
   * One box holds several styles and their size runs need not match (a body may
   * run S-XXL while a bib runs one size), so the rows are every size any member
   * declares — the same rule `sizesForOverlay` applies to the assortment grid.
   */
  const packPriceSizes = (method: string): { id: string; name: string }[] => {
    const seen = new Set<string>();
    const out: { id: string; name: string }[] = [];
    for (const ref of PackExplode.packStyles(allPackTypeLines, method)) {
      for (const z of sizeOptionsForStyle(ref)) {
        if (seen.has(z.id)) continue;
        seen.add(z.id);
        out.push(z);
      }
    }
    return out;
  };

  /** The member styles of a method, as comparison keys. */
  const packMemberKeys = (method: string) =>
    PackExplode.packStyles(allPackTypeLines, method).map((r) => styleKey(r));

  /**
   * WHICH MODE THIS METHOD IS PRICED ON — read off its own stored rows,
   * defaulting to Pack-wise Size-wise (client 2026-08-28: the Price Type field
   * "defaults strictly to Pack-Wise & Size-Wise").
   *
   * DERIVED, NEVER HELD IN STATE. A second store for "which mode" is a second
   * thing that can disagree with the rows it describes — the same call
   * `is_ratio_wise_pack` records on the Quantities tab, where a tickbox beside
   * the field that answered it could only ever contradict it.
   *
   * `isPackBranchMode`, NOT `isPackWise` (2026-08-28, second ruling). The
   * predicate here has to admit every mode the dropdown above offers, and plain
   * Size-wise is now one of them while remaining a PIECE basis. Left as
   * `isPackWise` this reads a Size-wise method's rows as belonging to no mode,
   * falls through to the default, and the operator's typed rates vanish from a
   * grid that then offers to take them again — the failure is silent in both
   * directions, since the rows are still there and still valued.
   */
  const packPriceMode = (method: string): string => {
    const keys = packMemberKeys(method);
    const hit = priceDetails.find(
      (r) => keys.includes(styleKey(r.style_ref_no)) && isPackBranchMode(r.price_type),
    );
    return hit?.price_type || PACK_WISE_SIZE_PRICE;
  };

  /**
   * WHAT ONE BOX COSTS — blank when nothing is stored, and blank when the member
   * rows DISAGREE.
   *
   * Showing the first of two different figures would put a number in the box
   * that is not what the order is valued at: `orderValue` refuses a pack group
   * whose members disagree, so the operator would see a rate and an unresolved
   * order with nothing connecting them. A blank cell is the honest state, and
   * re-typing it writes every member back into agreement.
   */
  const packRateFor = (
    method: string,
    mode: string,
    sizeId: string | null,
  ): string => {
    const keys = packMemberKeys(method);
    const rows = priceDetails.filter(
      (r) =>
        keys.includes(styleKey(r.style_ref_no)) &&
        r.price_type === mode &&
        r.size_id === sizeId,
    );
    if (!rows.length) return "";
    const distinct = new Set(rows.map((r) => (r.price ?? "").trim()));
    return distinct.size === 1 ? rows[0].price : "";
  };

  /** One rate, written to every style the method packs. See the header on
   *  `packPriceSizes` for why the fan-out is what makes `pack_group` work. */
  const setPackRate = (
    method: string,
    mode: string,
    sizeId: string | null,
    price: string,
  ) => {
    const refs = PackExplode.packStyles(allPackTypeLines, method);
    setPriceDetails((xs) => {
      const out = [...xs];
      for (const ref of refs) {
        const k = styleKey(ref);
        const i = out.findIndex(
          (r) =>
            styleKey(r.style_ref_no) === k &&
            r.price_type === mode &&
            r.size_id === sizeId,
        );
        if (i >= 0) {
          out[i] = { ...out[i], price };
          continue;
        }
        out.push({
          ...blankPriceDetail(),
          style_ref_no: ref,
          // THE REF IS THE NAME NOW (2026-08-25).
          style: ref,
          price_type: mode,
          /* NO COLOURWAY. A box holds several, and the client's own wording is
             "regardless of how many individual styles or colours make up the
             pack inside" — so the colour axis is not merely unused here, it is
             the wrong question. `modeAxes` answers `{colour:false}` for both
             pack modes, so a combo written here could never be matched. */
          combo: "",
          size_id: sizeId,
          price,
        });
      }
      return out;
    });
  };

  /**
   * SWITCHING THE PACK'S PRICE TYPE, CARRYING THE FIGURE WHERE IT MEANS THE SAME
   * THING.
   *
   * The two modes hold the same rate at two grains, so a switch is a RESHAPE and
   * not a fresh start:
   *
   *   per-size -> one rate    every size at one figure collapses to it; sizes
   *                            that disagree collapse to blank, because no
   *                            single one of them is the pack's price.
   *   one rate -> per-size     the one figure is seeded onto every size, which
   *                            is what the operator has already said the box
   *                            costs.
   *   per-size -> per-size     each size keeps ITS OWN rate, cell for cell.
   *
   * ## IT FORKS ON THE AXIS, NOT ON THE MODE NAME (2026-08-28, second ruling)
   *
   * The third transition is Pack-wise Size-wise <-> Size-wise, and it is the one
   * that broke the original shape: both grains are per-size, so there is no
   * single `carried` figure — six sizes carry six rates. Written as a scalar
   * with an `if (mode === PACK_WISE_PRICE)` the same-grain case would fall into
   * the `else`, read `packRateFor(..., null)` (a cell neither mode has), and
   * blank all six rates the operator had just typed.
   *
   * So the carry is a FUNCTION OF THE TARGET CELL and the fork is `priceAxes`,
   * which is the same question `modeAxes` asks in `order-value.ts`. A fourth
   * mode needs no branch here, only a correct entry there.
   *
   * WHAT THE FIGURE MEANS DOES CHANGE ACROSS THE NEW TRANSITION, and that is
   * deliberate rather than overlooked: 12 per box becomes 12 per garment. There
   * is no conversion available — the screen does not know the composition of
   * every size — and blanking instead would throw away typed money on a switch
   * the operator may be making to correct the unit. The rate column names its
   * unit, so what changed is on screen next to the number.
   *
   * THE OTHER MODE'S ROWS ARE REPLACED, and this is the one place on this tab
   * that does not follow "never delete typed money". The rule protects rows the
   * operator can still SEE and clear — the per-style grid renders a stale
   * Colour-wise row so they can. Here the rows are a projection: nothing renders
   * the inactive mode, `styleRate` refuses a style holding two modes at once,
   * and the operator would face an order that will not value with nothing on
   * screen to act on. Carrying the figure across is what keeps the deletion
   * honest — no number the operator typed is lost unless it genuinely has no
   * meaning at the new grain.
   */
  const setPackPriceMode = (method: string, mode: string) => {
    const current = packPriceMode(method);
    if (current === mode) return;
    const refs = PackExplode.packStyles(allPackTypeLines, method);
    const keys = packMemberKeys(method);
    const sizes = packPriceSizes(method);
    const isSized = priceAxes(mode).size;

    /**
     * THE CARRY IS `adoptedPrice`, THE SAME RULE THE PER-STYLE GRID USES.
     *
     * It was three hand-written branches here — collapse, seed, and (once
     * Size-wise arrived) carry-across — which is the table of mode-to-mode
     * transitions `price-modes.ts` was written to avoid ever needing. Its
     * `covers` predicate treats a blank axis as a WILDCARD, and that one idea is
     * all three branches at once:
     *
     *   per-size -> per-size   the wanted size matches its own row      → that rate
     *   one rate -> per-size   the source's `size_id: null` covers all  → seeded
     *   per-size -> one rate   the wanted `null` covers every source    → only if
     *                          they agree, else blank — which is the client's
     *                          ruling ("picking one discards a rate, averaging
     *                          invents one"), already vectored in
     *                          `check-price-modes.mts` §3.
     *
     * SOURCES ARE READ OFF ONE MEMBER STYLE, not all of them. `packRateFor`
     * already refuses to show a figure the members disagree on, so the rows are
     * either unanimous or the cell was blank on screen; taking every member's
     * copy would feed `adoptedPrice` N identical rows and change nothing but the
     * cost. The colour axis is blank throughout — a box holds several.
     */
    const firstKey = keys[0];
    const sources = priceDetails
      .filter((r) => styleKey(r.style_ref_no) === firstKey && isPackBranchMode(r.price_type))
      .map((r) => ({ combo: "", size_id: r.size_id ?? null, price: r.price ?? "" }));
    const carriedFor = (sizeId: string | null) =>
      adoptedPrice({ combo: "", size_id: sizeId }, sources);

    setPriceDetails((xs) => {
      /* `isPackBranchMode`, not `isPackWise` — this is what clears the mode
         being left, so a predicate narrower than the dropdown would strand a
         Size-wise method's rows beside the new mode's. `styleRate` refuses a
         style holding two modes at once, so the order would stop valuing with
         nothing on screen naming the rows to delete. */
      const kept = xs.filter(
        (r) => !(keys.includes(styleKey(r.style_ref_no)) && isPackBranchMode(r.price_type)),
      );
      const made: PriceDetailRow[] = [];
      for (const ref of refs) {
        const base = {
          ...blankPriceDetail(),
          style_ref_no: ref,
          style: ref,
          price_type: mode,
          combo: "",
        };
        if (!isSized) {
          made.push({ ...base, key: newKey(), size_id: null, price: carriedFor(null) });
          continue;
        }
        for (const z of sizes)
          made.push({ ...base, key: newKey(), size_id: z.id, price: carriedFor(z.id) });
      }
      return [...kept, ...made];
    });
  };

  /**
   * WHICH METHOD THIS DESTINATION SHIPS — RESOLVED, NEVER ASKED (0473, client
   * 2026-08-27: "no need to show it on the quantity tab UI, just inside
   * wiring").
   *
   * The order already states this twice over: a pack type's LINES name the
   * style they pack, and a destination names its style. So the method is the
   * one whose lines cover this destination's style, and a third statement of it
   * would be a third thing to keep in agreement.
   *
   * EXACTLY ONE, OR NONE. Two methods packing the same style is a real document
   * — an order may ship a 3-pack to one country and a gift box to another —
   * and nothing here can tell which goes where. Picking the first would explode
   * every destination against a method half of them do not use, and it would
   * look right: the totals would foot, against the wrong composition. So an
   * ambiguous order stays on ordinary typed piece counts, which is the state it
   * was in before this feature and the only honest answer.
   *
   * ORDER-WISE, NOT ROW-WISE, is therefore the shape: the resolution reads only
   * the pack types and the destination's style, so every destination packing
   * one style resolves the same way and no two can disagree.
   */
  /**
   * EVERY METHOD THAT COULD PACK THIS DESTINATION.
   *
   * Split out of `resolvedPackTypeFor` so the screen can ask the question the
   * resolution cannot answer — "is this ambiguous?" — without re-deriving the
   * candidate list beside it and drifting from it.
   */
  const packTypeCandidatesFor = (q: QuantityRow): string[] => {
    const ref = inheritedStyleFor(q);
    const declared = Array.from(
      new Set(
        packTypes
          .map((r) => r.pack_type.trim().toUpperCase())
          .filter(Boolean),
      ),
    ).filter((m) => PackExplode.packContents(allPackTypeLines, m).length > 0);
    /**
     * NARROWED BY STYLE ONLY WHEN THE DESTINATION NAMES ONE (2026-08-28).
     *
     * It used to return "" the moment `inheritedStyleFor` was blank, and on a
     * MULTI-STYLE ORDER that is always: `inheritedStyleFor` refuses to guess
     * when several styles are declared, quite correctly. So the explosion
     * switched itself off on exactly the orders the client built it for — a
     * baby gift set of three styles resolved to no method, the boxes row never
     * appeared, and the destination fell back to ordinary typed piece counts
     * with nothing on screen to say why.
     *
     * A box holds every style at once, so a destination shipping a multi-style
     * pack has no single style to be narrowed by, and asking for one is the
     * question that has no answer. When the destination DOES name a style the
     * narrowing still applies and single-style orders behave exactly as before.
     */
    return ref.trim()
      ? declared.filter((m) => PackExplode.packsStyle(allPackTypeLines, m, ref))
      : declared;
  };

  /**
   * WHICH METHOD THIS DESTINATION SHIPS — resolved when it can be, ASKED when it
   * cannot (client 2026-08-28).
   *
   * ONE CANDIDATE IS STILL NEVER ASKED. That was 0473's whole point ("no need to
   * show it on the quantity tab UI, just inside wiring"), and it holds for the
   * overwhelming majority of orders: the order states the method once and the
   * destination's style says which.
   *
   * TWO CANDIDATES USED TO RETURN NOTHING, and that is what changed. An order
   * may legitimately ship a 3-pack to one country and a gift box to another, and
   * the old rule read that as "cannot tell" and fell back to ordinary typed
   * piece counts — silently, on a destination the operator had every intention
   * of packing. Falling back defeats the intent; asking is the honest answer,
   * and `quantities.pack_type` has existed since 0473 for exactly this.
   *
   * THE STORED CHOICE ONLY COUNTS WHILE IT IS STILL A CANDIDATE. Editing the
   * Pack type(s) tab can retire the method a destination named, and honouring a
   * value the order no longer declares would explode against a composition that
   * is not there. Falling back to "" makes the picker reappear, which is the
   * state the operator can act on.
   */
  const resolvedPackTypeFor = (q: QuantityRow): string => {
    const candidates = packTypeCandidatesFor(q);
    if (candidates.length === 1) return candidates[0];
    if (candidates.length === 0) return "";
    const held = q.pack_type.trim().toUpperCase();
    return candidates.includes(held) ? held : "";
  };

  /**
   * IS THIS DESTINATION PACKED TO A DECLARED METHOD? (0473)
   *
   * Reads the RESOLVED method rather than the row's stored one, so a pack type
   * named or edited a moment ago takes effect without a save — the stored
   * column is a record of what was exploded, never the input to it.
   */
  const packModeOf = (q: QuantityRow): boolean =>
    !!resolvedPackTypeFor(q) && form.pack;

  /**
   * WHICH BOX THIS STYLE RIDES IN — `ValuedStyle.pack_group` (client 2026-08-28).
   *
   * A pack rate is a rate per BOX and one box holds every style in it, so
   * `orderValue` has to know which style lines share a carton or it values the
   * same box once per style. Measured on a three-style gift box: 14,400 against
   * a true 4,800, reported as a resolved answer.
   *
   * BLANK WHEN AMBIGUOUS, which is the safe direction: two methods packing one
   * style means this style's boxes cannot be attributed to one of them, and a
   * blank group values the line on its own — the behaviour before groups
   * existed. Never a guess at which box it came in.
   */
  const packGroupFor = (ref: string): string => {
    const methods = Array.from(
      new Set(
        packTypes.map((r) => r.pack_type.trim().toUpperCase()).filter(Boolean),
      ),
    ).filter((m) => PackExplode.packsStyle(allPackTypeLines, m, ref));
    return methods.length === 1 ? methods[0] : "";
  };

  /**
   * HOW MANY BOXES THE ORDER SHIPS OF THIS STYLE — the pack basis's
   * multiplicand, off the assortment's own `is_pack_row` lines (0473).
   *
   * `packs_ordered` is 0467's per-style figure and is unreachable while
   * `SET_PACK_ON_SCREEN` is false, so a Pack-wise style would have refused for
   * want of a box count on every order — the mode selectable and unusable.
   * The boxes are already typed, one row per destination, per size.
   *
   * SUMMED ACROSS DESTINATIONS, because a style may ship to several and each
   * carries its own boxes. Every style in one box reports the SAME total, which
   * is correct and is exactly why `pack_group` has to exist: the figure is a
   * property of the carton, not of the garment.
   */
  const boxesForStyle = (ref: string): number => {
    let total = 0;
    for (const q of quantities) {
      if (!packModeOf(q)) continue;
      const method = resolvedPackTypeFor(q);
      if (!method || !PackExplode.packsStyle(allPackTypeLines, method, ref)) continue;
      for (const l of q.assort_lines) {
        if (!l.is_pack_row) continue;
        total += l.sizes.reduce((a, z) => a + (Number(z.qty) || 0), 0);
      }
    }
    return total;
  };

  /**
   * REBUILD THE COLOURWAY LINES FROM THE BOXES (0473, client ruling
   * 2026-08-27).
   *
   *     pieces(colourway, size) = boxes(size) x pieces-of-colourway-per-box
   *
   * ONE TYPED ROW, THE REST DERIVED. The `is_pack_row` line holds the boxes and
   * is the only line the operator edits; every colourway line is discarded and
   * regenerated here, so the two can never drift and there is no state to keep
   * in step. The arithmetic itself is `pack-type-explosion.ts`, which the
   * vectors exercise — this function only decides WHICH rows exist.
   *
   * THE DERIVED LINES ARE STILL SAVED, and that is the ruling's whole point:
   * the exploded piece counts go into the quantities and sizes tables "so the
   * downstream Material and Fabric BOM engines never even have to know that
   * Packs existed". Same call 0467 made for a set pack's `po_qty`.
   *
   * KEYS ARE REGENERATED, which is safe ONLY because nothing focusable lives on
   * a derived row — its cells are read-only. A new key on a row holding a live
   * input would remount it mid-keystroke and drop the cursor.
   */
  const explodePackLines = (
    q: QuantityRow,
    lines: AssortLineRow[],
  ): AssortLineRow[] => {
    const method = resolvedPackTypeFor(q);
    const packRow = lines.find((l) => l.is_pack_row);
    if (!packRow || !method) return lines;
    const boxes = new Map<string, string>(
      packRow.sizes
        .filter((z) => z.size_id)
        .map((z) => [z.size_id!, z.qty] as const),
    );
    /* EVERY STYLE THE METHOD PACKS, never the destination's one (2026-08-28).
       A multi-style box is 1 full-sleeve + 1 half-sleeve + 1 sleeveless, and
       narrowing the composition to a single style produced one third of the
       order — or, when the destination resolved to no style at all, nothing. */
    const cells = PackExplode.explodePacks(allPackTypeLines, method, null, boxes);
    /* Grouped by MEMBER — a (style, colourway) — in composition order, so the
       rows read down the screen the way the pack type's own grid reads, and two
       styles that both declare a WHITE stay two rows. Through the module's own
       `memberKey`, so the grouping here and the collapsing there cannot key the
       same pack two different ways. */
    const byMember = new Map<string, { style: string; combo: string; sizes: AssortSizeRow[] }>();
    for (const c of PackExplode.packContents(allPackTypeLines, method)) {
      byMember.set(PackExplode.memberKey(c.style_ref_no, c.combo), {
        style: c.style_ref_no,
        combo: c.combo,
        sizes: [],
      });
    }
    for (const c of cells) {
      const held = byMember.get(PackExplode.memberKey(c.style_ref_no, c.combo));
      if (held) held.sizes.push({ key: newKey(), size_id: c.size_id, qty: String(c.qty) });
    }
    return [
      packRow,
      ...[...byMember.values()].map(({ style, combo, sizes }): AssortLineRow => ({
        key: newKey(),
        /* THE MEMBER'S OWN STYLE. It took `packRow.style_ref_no` — one style for
           every derived row — which is what made `sizesForOverlay` union to
           nothing and what would have attributed three styles' pieces to one on
           every downstream BOM. */
        style_ref_no: style,
        combo,
        no_of_cartons: "",
        inners_per_carton: "",
        is_pack_row: false,
        sizes,
      })),
    ];
  };

  /**
   * Put a destination into pack layout, or leave it exactly as it is.
   *
   * CALLED WHEN THE OVERLAY OPENS, and from nowhere else — which is what keeps
   * this out of an effect. An effect keyed on the pack types would fire when a
   * SAVED order is opened and rewrite every stored breakup before the operator
   * had looked at it; this file already records that failure for the Combos
   * tab's Type field. Opening the sheet is intent to work on the destination,
   * the same justification `openAssort`'s own seeding runs on.
   *
   * IT NEVER TAKES A DESTINATION OUT. Lines typed under no method hold real
   * piece counts, and dropping the method (by editing Pack type(s)) leaves them
   * standing as ordinary rows — "hiding is not emptying", which this document
   * states in four other places.
   */
  const enterPackLayout = (q: QuantityRow) => {
    if (!packModeOf(q)) return;
    /**
     * A MULTI-STYLE BOX IS NOT A SINGLE STYLE PACK (2026-08-28).
     *
     * `sizesForOverlay`'s Single branch takes the destination's ONE inherited
     * style and ignores the lines entirely — so a destination left on Single
     * (the stored default on any order declaring one style, and on every row
     * saved before 0433) drew the columns of one style while the rows beneath
     * it packed three. On a destination whose ref resolves to no style it drew
     * none at all.
     *
     * The composition is the authority here, not the toggle: a method that
     * packs more than one style has ANSWERED the question the toggle asks, and
     * leaving the two to disagree is how the grid comes to show a column set
     * that does not match its own rows. Only ever flipped TOWARDS Multiple —
     * nothing here turns a genuine multi-style destination back into a single.
     */
    if (PackExplode.packStyles(allPackTypeLines, resolvedPackTypeFor(q)).length > 1
        && q.is_single_style_pack) {
      setQty(q.key, { is_single_style_pack: false });
    }
    mutAssort(q.key, (ls) => {
      const packRow: AssortLineRow = ls.find((l) => l.is_pack_row) ?? {
        key: newKey(),
        style_ref_no: inheritedStyleFor(q),
        combo: "",
        no_of_cartons: "",
        inners_per_carton: "",
        is_pack_row: true,
        /* THE BOXES A PREVIOUS SESSION TYPED ARE NOT INVENTED HERE. A first
           entry starts empty and the colourway rows read 0 until a box count is
           typed — nothing is guessed from the piece counts that may be sitting
           on the lines this replaces. */
        sizes: [],
      };
      return explodePackLines(q, [packRow]);
    });
  };

  const setAssortSize = (
    qtyKey: string,
    lineKey: string,
    sizeId: string,
    qty: string,
  ) =>
    mutAssort(qtyKey, (ls) => {
      const written = ls.map((l) => {
        if (l.key !== lineKey) return l;
        const hit = l.sizes.find((z) => z.size_id === sizeId);
        return {
          ...l,
          sizes: hit
            ? l.sizes.map((z) => (z.size_id === sizeId ? { ...z, qty } : z))
            : [...l.sizes, { key: newKey(), size_id: sizeId, qty }],
        };
      });
      /* A BOX COUNT REPAINTS EVERY COLOURWAY BENEATH IT (0473), in the same
         render as the keystroke — the ruling asks for the derived piece count
         to be visible "so the operator can visually verify the total volume",
         and a figure that lagged a keystroke behind would be read as the answer
         to the previous number. Only the pack row triggers it; a typed line on
         an unpacked destination is untouched. */
      const q = quantities.find((x) => x.key === qtyKey);
      const target = written.find((l) => l.key === lineKey);
      return q && target?.is_pack_row ? explodePackLines(q, written) : written;
    });
  const assortSizeQty = (l: AssortLineRow, sizeId: string): string =>
    l.sizes.find((z) => z.size_id === sizeId)?.qty ?? "";

  /**
   * Point a line at a different style, AND DROP THE CELLS THAT STYLE HAS NOT GOT
   * (0433).
   *
   * The alternative is worse than it looks. A size cell that no longer has a
   * column is not merely untidy — `ratioTotalOf` still sums it, so Total Qty
   * would count pieces against a size the operator can no longer see, and the
   * balance rule would refuse a save for a reason nothing on screen explains.
   * A phantom that blocks Save is the one kind of leftover this grid cannot
   * afford.
   *
   * Dropping is loud rather than silent: Total Qty falls in the same render, the
   * balance line turns red and names the shortfall. That is the honest signal —
   * quietly keeping the numbers would hide a real change of meaning.
   */
  const setAssortLineStyle = (qtyKey: string, lineKey: string, ref: string) => {
    const keep = new Set(
      sizesOfRef(ref)
        .map((z) => z.size_id)
        .filter((id): id is string => !!id),
    );
    mutAssort(qtyKey, (ls) =>
      ls.map((l) =>
        l.key === lineKey
          ? {
              ...l,
              style_ref_no: ref,
              // A style that resolves to NO sizes keeps the cells: it is the
              // ordinary state of a ref typed but not yet matched to a Styles
              // Details row, and emptying the line on the way past would punish
              // a typo with data loss.
              sizes: keep.size
                ? l.sizes.filter((z) => z.size_id && keep.has(z.size_id))
                : l.sizes,
            }
          : l,
      ),
    );
  };

  /**
   * Point the whole DESTINATION at a style — the Single Style half of
   * `setAssortLineStyle` above, and it prunes for the same reason.
   *
   * On a Single Style pack every line reads its sizes from this one ref, so
   * changing it re-shapes every line at once. Cells for sizes the new style does
   * not carry would keep counting toward Total Qty with no column to show them
   * — which is exactly the state screenshot 2367 was in.
   *
   * IT WRITES THE SAME `style_ref_no` THE QUANTITIES GRID EDITS, deliberately:
   * one value, two doors, so this cannot drift from the Ref No column behind the
   * sheet or from the title above it. The asymmetry worth knowing is that the
   * grid's cell is free text and prunes nothing — it can still put an
   * unresolvable ref on the row, which is what happened here. This door offers
   * the declared styles and cleans up after itself.
   */
  /**
   * FLIP THE SINGLE/MULTIPLE SWITCH, AND CARRY THE STYLE WITH IT.
   *
   * Switching to Multiple Style used to leave every line's `style_ref_no` blank
   * — the StyleRefNo column appeared empty on rows that had been packing a style
   * all along (client screenshot 2370). The destination's ref WAS their style;
   * that is what Single Style means. Not seeding it makes the operator retype,
   * per line, a value the record already held, and until they do the lines fail
   * `quantityProblems` for naming no style.
   *
   * ONLY BLANKS ARE FILLED. A line that already names a style keeps it, so
   * toggling back and forth is not a way to overwrite per-line answers with the
   * destination's — the same restraint `toPayload` shows by sending both.
   *
   * Nothing is carried the other way. Going to Single Style, the destination's
   * own ref is already the one answer, and adopting some line's instead would
   * pick a winner out of several with nothing to say why.
   */
  const setAssortScope = (qtyKey: string, single: boolean) =>
    setQuantities((xs) =>
      xs.map((x) =>
        x.key === qtyKey
          ? {
              ...x,
              is_single_style_pack: single,
              assort_lines: single
                ? x.assort_lines
                : x.assort_lines.map((l) =>
                    l.style_ref_no.trim() ? l : { ...l, style_ref_no: x.style_ref_no },
                  ),
            }
          : x,
      ),
    );

  /* `setQuantityStyle` REMOVED (2026-08-20). It set a destination's style and
     pruned assortment size cells that no longer belonged to it — but its only
     caller was the Assortments overlay's per-line style picker, which read
     `q.style_ref_no` as a style. That column is the Quantities tab's FREE-TEXT
     Ref No (client 2026-08-17), so the pruning was keyed on a value that could
     never resolve to a style and never matched anything. Deleted rather than
     re-pointed: the rule it carried was answering a question nothing asks. The
     style now lives on the assortment LINE — see `assortLineRef`. */


  /**
   * OPEN THE ASSORTMENT WITH ITS LINES ALREADY THERE (client 2026-08-20,
   * screenshots 2432 and 2433).
   *
   * It opened as a header, a TOTAL of 0 and nothing else: the operator had to
   * press "+ Add assortment" before there was a single box to type a quantity
   * into, and then pick the style and colour by hand — facts the order had
   * already stated on the Style(s) and Combos tabs. 2433 is the screen they
   * wanted; 2432 is the one they got.
   *
   * ONE LINE PER DECLARED COLOUR, and that is the whole seed. On a Solid Colour
   * / Solid Size pack the break-up IS a row per colour, so the seeded grid is
   * not a guess about what the operator wants — it is the shape the order
   * already has, waiting for its numbers.
   *
   * SEEDED ONLY WHEN THERE IS NOTHING THERE. A destination with lines is a
   * record the operator has worked on; re-seeding it would resurrect colours
   * they had deliberately deleted.
   *
   * NO COLOURS DECLARED → ONE BLANK LINE, still carrying the style. Better than
   * nothing to type into, which is the defect being fixed.
   *
   * WHY IT USES THE SAME RESOLVERS AS "+ Add": `inheritedStyleFor` for the
   * style and `comboOptionsForStyle` for the colours. Seeding through a second
   * path is how the button and the open would start disagreeing about what a
   * new line carries.
   *
   * IT DOES MARK THE RECORD DIRTY, and that is accepted rather than hidden:
   * opening this overlay is intent to work on the destination, and every seeded
   * line is one the operator would otherwise have created by hand. A line left
   * with no quantities still saves — `assortLineFilled` counts a style or a
   * colour as content — which is exactly what pressing "+ Add" and stopping has
   * always done. Deliberately not changed here: that test is stated twice, once
   * on the keystroke and once on the save, and the two must move together.
   */
  const openAssort = (qtyKey: string) => {
    setAssortQtyKey(qtyKey);
    const q = quantities.find((x) => x.key === qtyKey);
    if (!q) return;
    /* PACK LAYOUT IS ENTERED HERE (0473), ahead of the ordinary seed and
       instead of it. A destination whose style resolves to exactly one packing
       method does not want a row per declared colour to type into — it wants
       the boxes row, with the colours derived. Both are "what shape does this
       destination open in", so they are one decision in one place rather than a
       seed that runs and a rebuild that undoes it. */
    if (packModeOf(q)) {
      enterPackLayout(q);
      return;
    }
    if (q.assort_lines.length) return;

    const inherited = inheritedStyleFor(q);
    mutAssort(qtyKey, () =>
      AssortStyle.seedAssortLines(inherited, comboOptionsForStyle(inherited)).map(
        (l) => ({
          ...l,
          key: newKey(),
          no_of_cartons: "",
          inners_per_carton: "",
          is_pack_row: false,
          sizes: [] as AssortLineRow["sizes"],
        }),
      ),
    );
  };

  const addAssortLine = (qtyKey: string) => {
    const q = quantities.find((x) => x.key === qtyKey);
    const last = q?.assort_lines[q.assort_lines.length - 1];
    // Decline while the last line is untouched — `ChildGrid`'s protocol, so
    // Enter escalates instead of stacking blanks.
    //
    // EVERY TYPEABLE CELL COUNTS AS TOUCHED, and the list has to grow with the
    // columns. It read combo + cartons + a size and missed the two added since:
    // a line where the operator had typed only an inner count (0432) or only a
    // style ref (0433) still looked blank, so "+ Add" refused to give them the
    // next line. `assortLineFilled` in `actions.ts` is the same test on the way
    // OUT — there it decided the line was blank and dropped it. One rule stated
    // twice on purpose (one is a keystroke, one is a save), so they are edited
    // together or they disagree about what an operator has entered.
    /**
     * A NEW LINE CARRIES THE ORDER'S STYLE (client 2026-08-20: "why that
     * assortment is not fetch that style from automatically, it's open as
     * blank").
     *
     * FROM THE STYLE(S) SECTION, NOT FROM THE DESTINATION'S REF NO — the
     * correction the client made on screenshot 2418. `q.style_ref_no` is the
     * Quantities tab's free-text Ref No (client 2026-08-17) and is not a style
     * at all; seeding from it put a destination reference in a style field.
     *
     * `soleStyleRef` is the order's one declared style, or blank when the order
     * declares several — in which case the operator genuinely has to choose and
     * the picker is the honest answer. Inherited, never locked: under Multiple
     * Style a later line may pack a different style (0433).
     */
    const inherited = q ? inheritedStyleFor(q) : "";

    /**
     * AN INHERITED VALUE IS NOT SOMETHING THE OPERATOR ENTERED, so the decline
     * test must not count it.
     *
     * This is the same trap `addComp` documents one grid over: once every new
     * row arrives already carrying a value, a blank-test that reads that field
     * NEVER FIRES AGAIN, and Enter stacks empty lines without limit. The test
     * therefore asks whether the ref DIFFERS from what was handed down — typing
     * a different style is entry, receiving the default is not.
     */
    const refIsOperators =
      !!last && !!last.style_ref_no.trim() &&
      last.style_ref_no.trim().toUpperCase() !== inherited;

    if (
      last &&
      !refIsOperators &&
      !last.combo.trim() &&
      !last.no_of_cartons.trim() &&
      !last.inners_per_carton.trim() &&
      !last.sizes.length
    ) {
      return false;
    }
    mutAssort(qtyKey, (ls) => [
      ...ls,
      {
        key: newKey(),
        style_ref_no: inherited,
        combo: "",
        no_of_cartons: "",
        inners_per_carton: "",
        is_pack_row: false,
        sizes: [],
      },
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
   * IS THIS ROW PACKED TO AN ASSORTMENT?
   *
   * ONE FIELD ANSWERS — `Assortment Type`, the column two cells to the LEFT of
   * the Details button it gates. Nothing else is consulted: not the Pack toggle,
   * not the Pack type(s) section, not the row's own free-text `pack` note (that
   * one is typed INSIDE the overlay, so gating on it was always circular).
   *
   * THE PACK CONNECTION IS CUT, DELIBERATELY (client 2026-08-18: "no more
   * connection with pack and quantity tab"). The gate used to fall back to the
   * ORDER's Pack type(s) whenever a row had named no type of its own, so a
   * Quantities row could be refused by a switch in Order Info — and the refusal
   * sent the operator to a different section to turn something on in order to
   * earn a button sitting beside a field they had already filled. Pack still
   * gates its OWN section in Order Info; what it no longer does is reach across
   * into this tab.
   *
   * `pack_type` (order level, free text since 2026-08-27) and
   * `assortment_type_id` (row level, an FK into the `assortment_type` lookup)
   * were deliberately seeded by 0400 with the SAME four names — "Solid Colour /
   * Solid Size" through "Assort Colour / Assort Size" — so the two tabs read
   * alike to an operator. Sharing a vocabulary is not sharing a rule, and
   * reading one to decide the other is precisely what is being removed here.
   *
   * EMPTY-AND-EXPLAIN, never a silent disable. A blank type names the field to
   * fill, which is now the ONLY thing this refuses on.
   *
   * IT NO LONGER REFUSES A SOLID PACK (client 2026-08-18). Until then a
   * Solid / Solid row was turned away — "one colour and one size per carton, so
   * there is no ratio to set" — which was true about the RATIO and wrong about
   * the overlay. A solid pack still has to say which colour and how many pieces
   * of each size; what it does not have is a carton count, because how many
   * pieces fit in a box depends on the size. So the overlay opens for both live
   * types and ASKS DIFFERENT THINGS — see `assortModeOf`.
   */
  /**
   * WHICH OF THE TWO PACKING METHODS THIS ROW USES (client 2026-08-18).
   *
   * KEYED ON THE LOOKUP'S `code`, NEVER ITS NAME. `assortment_type` is a
   * `config_lookups` kind the operator maintains through the picker's own
   * Add/Modify, so the display name is theirs to re-word — and the arithmetic
   * must not change because someone fixed a spelling. 0400 seeded the four rows
   * with stable codes (`solid_solid`, `solid_assort`, …) for exactly this.
   *
   * THE NAME IS THE FALLBACK, not the rule: a row the operator ADDED themselves
   * has no seeded code at all, and refusing to classify it would leave the
   * overlay unable to decide what to ask. "assort size" in the name is the same
   * test the old `assortsRatio` made, kept only for that case.
   *
   * Two live modes, and 0432 retired the other two seeded rows (`is_active =
   * false`), so they can no longer be picked. A row that already HOLDS one keeps
   * it — AGENTS.md "Disabled rows" — and reads as `assort`, which is the safer
   * of the two: it asks for more, rather than silently dropping a carton count
   * an operator already typed.
   */
  type AssortMode = "solid" | "assort";

  const assortModeOf = (r: QuantityRow): AssortMode | null => {
    const t = assortmentTypes.find((a) => a.id === r.assortment_type_id);
    if (!t) return null;
    if (t.code) return t.code === "solid_solid" ? "solid" : "assort";
    return /assort\s*size/i.test(t.name) ? "assort" : "solid";
  };

  const assortGateFor = (r: QuantityRow): { ok: boolean; why?: string } =>
    assortModeOf(r)
      ? { ok: true }
      : { ok: false, why: "Pick an Assortment Type on this row" };

  /**
   * THE ARITHMETIC, ONE RULE PER MODE (client 2026-08-18).
   *
   *   Solid Colour / Solid Size   Line Qty = Σ size cells
   *     The cells ARE the pieces. There is no carton count to multiply by —
   *     "the total number of cartons is unknown at the time of order entry
   *     because the capacity of a box varies by garment size".
   *
   *   Solid Colour / Assort Size  Line Qty = Cartons × Inners × Σ ratio cells
   *     The cells are a RATIO (1:2:2:1). Their sum is one INNER — a bundle —
   *     several inners go in a carton, and there are several cartons.
   *
   * `is_ratio_wise_pack` NO LONGER HAS A CHECKBOX. Its stored meaning (0414:
   * "when true the line's size cells are the ratio inside ONE carton") is now
   * ANSWERED BY THE TYPE, so a separate tickbox could only ever contradict the
   * field two cells to its left — and the two gave different totals from
   * identical cells. It is derived on the way to the payload instead, so the
   * column stays a faithful record of how to read the size cells.
   *
   * DERIVED, NEVER STORED, for Ratio Total and Line Qty — 0414 §3's rule, and
   * the reason `pcs_per_pack` has no column.
   */
  /* DELEGATES — the arithmetic lives in `lib/orders/amendments/qty-balance.ts`
     so the screen and the server action cannot answer differently. */
  const ratioTotalOf = (l: AssortLineRow) => ratioTotal(l);

  /**
   * WHICH BOX THE SIZE RATIO FILLS — the client's "Ratio for Inner or Master?"
   * (0414's `ratio_for`, CHECKed to this tuple).
   *
   *   master  the ratio IS the shipping carton; no sub-bundles exist inside it,
   *           so Inners counts nothing and takes no part in the arithmetic.
   *   inner   the ratio is one poly bag, and several fill a master carton.
   *
   *     master  pieces = Cartons × Σ ratio
   *     inner   pieces = Cartons × Inners × Σ ratio
   *
   * THE COLUMN HAS EXISTED SINCE 0414 AND NOTHING READ IT. The overlay has
   * offered this Select since the carton block was emptied on 2026-08-19, the
   * value saved, and both arithmetics multiplied by Inners unconditionally —
   * which is the `inner` branch. So an order declared `master` was computed as
   * an `inner` pack and the operator's declaration was decoration.
   *
   * It hid because `inners_per_carton` is 1 on every row in the database, the
   * same way this file's own header records the previous version of this bug
   * hiding. The first `master` pack with 10 inners typed would have bought ten
   * times the cloth, silently: the total is plausible and the breakup balances,
   * because the balance rule multiplies by the same wrong factor.
   *
   * BLANK READS AS `master`, the safe direction — it declines to multiply by a
   * number whose meaning nobody has confirmed, and it is what the screen already
   * computed for a blank before this existed, so no stored row changes value.
   */
  const ratioScopeOf = (q: QuantityRow): "master" | "inner" => ratioScope(q);

  /** `|| 1`, never `|| 0` — a blank multiplier means "one", not "none". */
  const innersOf = (l: AssortLineRow) => inners(l);

  /**
   * HOW MANY RATIOS THIS LINE SHIPS — the multiplication, in one place.
   *
   * `lineQtyOf` and `sizePiecesOf` are the same rule one level apart and have
   * already drifted once (the header above records `pricingWeights`
   * multiplying by cartons while the total consulted a flag). Both now read
   * this, so a change to the packing arithmetic is one edit and cannot be half
   * applied. It takes the DESTINATION because `ratio_for` lives there: a
   * signature that took only the line is what let every call site forget.
   */
  const packFactorOf = (q: QuantityRow, l: AssortLineRow) => packFactor(q, l);

  const lineQtyOf = (q: QuantityRow, l: AssortLineRow, mode: AssortMode) =>
    lineQty(q, l, mode);

  /**
   * THE PACK ROW'S FIGURE IS BOXES AND MUST NEVER JOIN A PIECE TOTAL (0473).
   *
   * `lineQtyOf` reads Solid as "sum the size cells", which on the boxes row is
   * the box count — right for the row's own Qty cell, and catastrophic in any
   * sum: added to the colourway lines beneath it, the destination would read as
   * pieces PLUS boxes, the balance rule would refuse an order that is exactly
   * right, and the operator's only way out would be to type a wrong number.
   *
   * So every place that AGGREGATES lines drops it, and every place that
   * DISPLAYS one keeps it. Two call sites, named here rather than filtered
   * inline at each, because the third one added later is the one that will
   * forget.
   */
  const pieceLinesOf = (q: QuantityRow) => pieceLines(q) as AssortLineRow[];

  const assortTotalOf = (q: QuantityRow) => assortTotal(q, assortModeOf(q) ?? "solid");

  /**
   * ORDER QTY MINUS WHAT THE BREAKUP ADDS UP TO. Positive is short, negative is
   * over, and zero is the only state that saves (client 2026-08-18: "the total
   * quantity in the break-up must exactly match the total order quantity. If
   * they do not match, the system must throw an error and prevent the user from
   * saving").
   *
   * NULL WHILE THE BREAKUP ADDS TO NOTHING, which is 0414's rule kept rather
   * than a loophole: "a line with no ratio rows is not disagreeing with
   * anything, it simply has not been filled in." Requiring one would make every
   * order unsaveable until every destination had been broken down — a far bigger
   * change than the one asked for, and one that would block the draft an
   * operator saves halfway through entry. A row the operator HAS started must
   * balance; a row they have not started is not yet a claim about anything.
   *
   * THE TEST IS THE TOTAL, NOT THE ROW COUNT, and the difference is not
   * cosmetic. `addAssortLine` creates a BLANK line for the operator to type
   * into, and `assortLineFilled` drops it again on save — so counting rows would
   * deaden Save over a line that is never going to reach the database, with the
   * row's own PO Qty cell showing no flag at all (it tests `computed > 0`, the
   * same question). Two rules that must agree, asked the same way.
   *
   * The comparison is on the DERIVED total, so it follows the mode: a solid
   * pack's pieces and an assorted pack's cartons × inners × ratio are both
   * measured against the same typed Order Qty.
   */
  const assortBalanceOf = (q: QuantityRow): number | null =>
    assortBalance(q, assortModeOf(q) ?? "solid");

  /**
   * WHAT IS WRONG WITH THIS DESTINATION'S BREAKUP, IN WORDS — or null when
   * nothing is.
   *
   * ONE SENTENCE, THREE CONSUMERS (client 2026-08-31: "Display a modal blocking
   * dialog … Disable the Done/Close button action and keep the pop-up open").
   * The rule itself is `assortBalanceOf` and predates this by a fortnight; what
   * 08-31 adds is a third place that has to SAY it — the Assortments overlay's
   * own Done button, beside `quantityProblems`' rail badge and the PO Qty cell's
   * red swap line.
   *
   * The wording was inlined in `quantityProblems` and is lifted here unchanged
   * rather than retyped at the new call site. AGENTS.md's "one declaration"
   * rule is the whole reason: the overlay refusing to close and the Save button
   * refusing to fire are the SAME refusal, and an operator who reads two
   * different numbers for one disagreement stops believing either. It also
   * means the two can never drift the way the amber cell line and the dead Save
   * did for an afternoon in August.
   *
   * IT NAMES THE DESTINATION even though the overlay's title already does. The
   * message is reused verbatim on the rail, where nothing else identifies which
   * of five destinations is short.
   */
  const assortBalanceMessage = (q: QuantityRow): string | null =>
    balanceMessage(q, assortModeOf(q) ?? "solid", q.style_ref_no);

  /**
   * HAS THE OPERATOR TOUCHED THIS LINE? — content, never existence.
   *
   * The same columns `assortLineFilled` counts on the way out and
   * `addAssortLine` counts before it declines, asked a third time here. All
   * three are one rule and must be edited together; the list has already been
   * short twice, once when 0432 added inners and once when 0433 added the
   * line's own style.
   */
  const assortLineStarted = (l: AssortLineRow): boolean =>
    l.no_of_cartons.trim() !== "" ||
    l.inners_per_carton.trim() !== "" ||
    l.sizes.some((z) => z.qty.trim() !== "");

  /** The client's test for a destination worth validating (2026-08-28): a pack
   *  type linked to it, or anything at all typed into its breakup. */
  const assortStarted = (q: QuantityRow): boolean =>
    packModeOf(q) || q.assort_lines.some(assortLineStarted);

  /**
   * THE WHOLE ORDER'S POSITION, IN ONE FIGURE (2026-08-21).
   *
   * `assortBalanceOf` above answers for ONE quantity row, and the strip under
   * each assortment matrix renders it there — deliberately, because the 08-20
   * fix was about PROXIMITY: the operator types in a matrix and the only
   * reaction used to be at the bottom of the sheet, so nothing near the caret
   * moved and the app read as accepting anything. None of that changes.
   *
   * What no figure on this screen answered is the ORDER-level question. An
   * operator shipping to four destinations can have every row locally balanced
   * and still not know where the order stands, because the only totals are
   * per-row and they are never added up. This adds them up and nothing else.
   *
   * ## IT REUSES THE ROW RULE RATHER THAN RE-DERIVING IT
   *
   * `assortTotalOf` is the same function the row strip and the Save block both
   * read, so the header cannot disagree with the cell the operator is looking
   * at. A second traversal computing "allocated" its own way is how two figures
   * for one order start drifting — the drift AGENTS.md records under Nominated
   * vendors and `created_by` alike.
   *
   * ## NULL IS NOT ZERO, AND IT IS THE WHOLE REASON THIS IS NOT A SUM OF
   * ## `assortBalanceOf`
   *
   * A row whose breakup adds to nothing answers `null` — "not started", not
   * "short by the full amount". Summing the balances would turn every untouched
   * destination into a shortfall and announce a deficit against work nobody has
   * begun. So the two sides are totalled independently and an order with no
   * breakup at all reports `target` with nothing allocated, exactly as the row
   * strip does one level down.
   */
  /* NOT a `useMemo`, deliberately: these helpers sit BELOW a conditional return
     in this component, so a hook here is called in a different order between
     renders — `react-hooks/rules-of-hooks` catches it, and the failure it
     prevents is React pairing this state with another hook's. The loop is over
     a handful of destination rows and runs beside `assortTotalOf`, which is
     already re-derived per render for the same reason. */
  const orderBalance = (() => {
    let target = 0;
    let allocated = 0;
    let started = 0;
    for (const q of quantities) {
      target += Number(q.po_qty) || 0;
      const computed = assortTotalOf(q);
      allocated += computed;
      if (computed > 0) started++;
    }
    return { target, allocated, started, rows: quantities.length };
  })();

  /**
   * THE BREAKUP MUST ADD UP, AND IT BLOCKS SAVE (client 2026-08-18).
   *
   * `kind: "custom"` is what makes it blocking — `isBlocking` in
   * `lib/screens/validity.ts` treats a screen's own cross-field rules as
   * completeness claims about the whole record, alongside `required` and
   * `duplicate`, and only `format` is advisory. So this one declaration deadens
   * Save, puts a red count on the Quantities rail row, and gives the blocked
   * Save something to name and somewhere to jump to — the three cannot disagree
   * because they read one list.
   *
   * NAMED BY DESTINATION, not counted. "Quantities row 2" would make an operator
   * count rows; the Ref No is what they typed and what the overlay's title
   * already says back to them.
   *
   * `section: "quantities"` IS THE RAIL'S OWN KEY. `revealFirstProblem` hands it
   * straight to `goToSection`, so a key that names no rail row is a blocked Save
   * that reports the right message and then jumps nowhere.
   */
  /**
   * A SET PACK MUST SAY WHAT IS IN THE PACK (0467, client: the Pack Composition
   * is "compulsory").
   *
   * Blocking, and it has to be: with `is_set_pack` on, PO Qty is DERIVED from
   * this composition and the Prices tab is quoting per box. An empty
   * composition makes `derivedPoQty` null, so the order would save with a piece
   * count of zero — and zero is the one number every downstream engine reads
   * as "nothing to make" rather than as "nobody said".
   *
   * TWO SEPARATE COMPLAINTS, not one, because they send the operator to
   * different places: an empty composition is the sheet, a missing pack count
   * is the cell on the row. A single message naming both would be right about
   * half of every case.
   *
   * `kind: "custom"` — `isBlocking` in `lib/screens/validity.ts` treats a
   * screen's own cross-field rule as a completeness claim about the record,
   * which is exactly what this is.
   */
  const packProblems: Problem[] = form.is_set_pack
    ? styles.flatMap((r) => {
        const who = r.style_ref_no.trim() || "this style";
        const out: Problem[] = [];
        if (piecesPerPack(r) <= 0) {
          out.push({
            /* THE STYLE(S) TAB, since 2026-08-27: this problem is about a STYLE
               ROW, and the section it names is where `goToSection` sends the
               operator. Left as "orderinfo" it would jump them to the header
               and leave them looking for a grid that is no longer there. */
            section: "styles",
            label: "Pack Composition",
            message: `${who}: this order is sold in packs, so open Pack Composition and say what one pack holds.`,
            kind: "custom",
          });
        }
        if (!(Number(r.packs_ordered) > 0)) {
          out.push({
            section: "styles",
            label: "Packs",
            message: `${who}: enter how many packs the buyer ordered — PO Qty is worked out from it.`,
            kind: "custom",
          });
        }
        return out;
      })
    : [];

  /**
   * EVERY STYLE CARRIES AT LEAST ONE DOCUMENT (client 2026-08-31, ask 5: the Add
   * File control moves onto each Style row and is mandatory before the style can
   * be saved).
   *
   * `packProblems`'s shape exactly, and that is not laziness — it is the same
   * kind of claim (a per-style completeness rule the `fields` list cannot state,
   * because `FieldCheck.empty` reads `form` and a style row is not on `form`),
   * so it gets the same section, the same `kind` and the same "name the style,
   * do not count it" wording.
   *
   * ## WHICH ROWS ARE IN BREACH IS `styleFileMissing`, NOT A TEST WRITTEN HERE
   *
   * The Style(s) grid draws an inline red line from the same predicate, and the
   * two must agree: a row reporting a problem Save does not have — or Save dying
   * while naming a row that looks clean — is what disagreement looks like from
   * the operator's side. Both halves of the guard, and why neither is defensive,
   * are documented on the predicate beside `filesForStyle`.
   *
   * ## AND IT IS A `custom`, SO IT BLOCKS
   *
   * `isBlocking` treats everything but `format` as blocking, and this is a
   * completeness claim about the record rather than a half-typed value: the
   * client's word is "mandatory". `section: "styles"` so `revealFirstProblem`
   * lands the operator on the Style(s) tab where the cell is — sent to
   * "orderinfo" it would drop them on a header that no longer holds the control.
   */
  const styleFileProblems: Problem[] = styles.flatMap((r) => {
    if (!styleFileMissing(r)) return [];
    return [
      {
        section: "styles",
        label: "Files",
        /* T3's wording, not mine: it names WHAT to attach. A blocked Save reads
           this out loud, and "attach the style's document" leaves the operator
           guessing which document.
           THROUGH `styleFileMessage` SINCE THE SERVER GUARD LANDED — the sentence
           is a function in types.ts precisely so this toast and `styleFileProblem`
           in actions.ts cannot word one rule two ways. Typed out here it agreed
           by hand, which is the state that drifts. */
        message: styleFileMessage(r.style_ref_no.trim()),
        kind: "custom" as const,
      },
    ];
  });

  /**
   * HAS THIS DESTINATION SAID ANYTHING AT ALL — apart from its country?
   *
   * The "started" test the Country rule below needs, and it is deliberately NOT
   * `rowFilled`: a `QuantityRow` carries `assort_lines`, which is an array and
   * therefore never null, so `rowFilled` is true for a row nobody has touched.
   *
   * The field list mirrors `normalizeQuantities`' own filter in `actions.ts` —
   * the server's answer to "is this a row or a blank the grid seeded" — MINUS
   * `country_id` itself, because a row whose only content is the country is a
   * row that has answered this rule rather than broken it. Two lists that must
   * agree is a cost, and it is the cheaper side of the trade: the alternative is
   * exporting a predicate from a `"use server"` file, which the screen cannot
   * import.
   */
  const destinationStarted = (q: QuantityRow): boolean =>
    !!(
      q.style_ref_no.trim() ||
      q.style_no.trim() ||
      q.consignee_id ||
      q.assortment_type_id ||
      q.po_no.trim() ||
      q.po_qty.trim() ||
      q.delivery_date ||
      q.earlier_shipment_date ||
      q.warehouse_id ||
      q.discharge_port_id ||
      q.pack_type.trim() ||
      assortStarted(q)
    );

  const quantityProblems: Problem[] = quantities.flatMap((q) => {
    const who = q.style_ref_no.trim() || "this destination";
    const out: Problem[] = [];

    /**
     * A DESTINATION MUST NAME ITS COUNTRY (client 2026-08-31).
     *
     * ## WHY IT IS HERE AND NOT A `required` PROP ON THE CELL
     *
     * The quantities grid seeds a blank row, so a bare `required` would stamp
     * `data-required-empty` on the first cell of a row the operator has not
     * begun — holding the cursor on the very first thing they see, before they
     * have decided whether they want the row at all. That is the same trap the
     * assortment rules beneath this one spell out at length: *"a row the
     * operator HAS started must balance; a row they have not started is not yet
     * a claim about anything."* Country is the same question one column left.
     *
     * So it blocks Save through this list, gated on `destinationStarted`, and
     * the cell's own `required` is gated on the identical predicate — one test,
     * both effects, so the star and the blocked Save cannot disagree about which
     * rows are real.
     *
     * ## AND THE COUNTRY IS NOT DECORATION ON THIS ROW
     *
     * `country_sizes` hangs off it, the assortment matrix is per destination,
     * and `normalizeQuantities` keeps a row whose only content is a country —
     * so a started row with none is a set of quantities attributed to nowhere,
     * which is the same failure the styleless-assortment rule above describes
     * one field over.
     */
    /**
     * THE DESTINATION'S OWN MANDATORY CELLS (client 2026-08-31) — Country, Ref
     * No, Consignee, Assortment Type, PO Qty, Delivery Dt, Earlier Shipment Dt.
     *
     * ## ONE TABLE, NOT SEVEN BLOCKS
     *
     * Seven near-identical `if`s is seven places for the `destinationStarted`
     * gate to be forgotten, and the one that forgot it would deaden Save on
     * every blank row the grid seeds. The gate is applied once, above the loop.
     *
     * ## THE LABELS ARE THE COLUMN HEADERS, EXACTLY
     *
     * A blocked Save reads these out loud and `revealFirstProblem` steers to the
     * cell, so "Deli.Dt" on the header and "Delivery Date" in the message would
     * send the operator looking for a column that is not there. "Earlier
     * Shipment Dt", not "Earlier Ship Date".
     *
     * ## PO QTY IS A STRING AND `0` IS NOT AN ANSWER HERE
     *
     * Unlike Tolerance one tab over, where zero is a real figure, a destination
     * ordering zero pieces is a destination that should not be on the order —
     * and `normalizeQuantities` keeps the row, so it would ship as a line
     * claiming nothing. `.trim()` alone therefore does the work: "0" is text and
     * passes, which is deliberate — the balance rules beneath judge the number,
     * this one only asks whether it was answered.
     */
    const requiredCells: [unknown, string][] = [
      [q.country_id, "Country"],
      [q.style_ref_no.trim(), "Ref No"],
      [q.consignee_id, "Consignee"],
      [q.assortment_type_id, "Assortment Type"],
      [q.po_qty.trim(), "PO Qty"],
      [q.delivery_date, "Delivery Dt"],
      [q.earlier_shipment_date, "Earlier Shipment Dt"],
    ];
    if (destinationStarted(q)) {
      for (const [value, label] of requiredCells) {
        if (value) continue;
        out.push({
          section: "quantities",
          label,
          message: `${who}: ${label} is required.`,
          kind: "custom",
        });
      }
    }

    /**
     * A MULTIPLE-STYLE LINE THAT NAMES NO STYLE (0433).
     *
     * Blocking, and of the same `kind` as the balance rule below, because it is
     * the same kind of claim: the line's pieces are counted into Total Qty and
     * attributed to nothing. It would also be counted into `pricingWeights`
     * under a blank `style_ref_no`, where it can match no price row — so the
     * order would be valued short by exactly those pieces, silently.
     *
     * GUARDED ON THE LINE HAVING SAID SOMETHING, never on the row count, for
     * the reason the balance rule spells out: `addAssortLine` leaves a blank
     * line for the operator to type into and `assortLineFilled` drops it on
     * save, so flagging every styleless line would deaden Save the moment the
     * overlay opened.
     */
    if (!q.is_single_style_pack) {
      const orphans = q.assort_lines.filter(
        (l) =>
          !l.style_ref_no.trim() &&
          lineQtyOf(q, l, assortModeOf(q) ?? "solid") > 0,
      ).length;
      if (orphans) {
        out.push({
          section: "quantities",
          label: "Assortment style",
          message: `${who}: ${orphans === 1 ? "one assortment line has" : `${orphans} assortment lines have`} quantities but name no style. Open Details and pick a Style Ref No, or switch back to Single Style.`,
          kind: "custom",
        });
      }
    }

    /**
     * AN ASSORTED PACK MUST DECLARE HOW IT IS PACKED (client 2026-08-28).
     *
     * The pieces are `Cartons x [Inners x] ratio`, so with either factor
     * unstated there is no piece count — only a ratio nobody has multiplied.
     * Both are blocking, `kind: "custom"` like the balance rule beneath them.
     *
     * ## "STARTED" IS THE WHOLE OF THE DESIGN, AND IT IS THE CLIENT'S TEST
     *
     * "Compulsory" read literally would deaden Save on every destination the
     * operator has not reached, and on every order already stored — every one
     * of which has a blank `ratio_for`, because nothing read the column until
     * 2026-08-28 and so nothing ever made anyone fill it in. This screen
     * already refuses that: `assortBalanceOf` answers NULL while the breakup
     * adds to nothing, because "a row the operator HAS started must balance; a
     * row they have not started is not yet a claim about anything."
     *
     * So the client's ruling names the two things that count as started — a
     * pack type linked to the destination, or ANY box count, carton figure or
     * size cell entered on it. A completely untouched destination is unanswered
     * and bypasses both rules.
     *
     * NOT "does it have lines". `addAssortLine` seeds a blank line and
     * `openAssort` seeds one per declared colour, so a row count is true the
     * moment the overlay is opened and would deaden Save on a destination
     * nobody has typed a digit into. The test is on CONTENT, which is the same
     * question `assortLineFilled` asks on the way out.
     */
    const mode = assortModeOf(q) ?? "solid";
    if (mode === "assort" && assortStarted(q)) {
      if (!q.ratio_for.trim()) {
        out.push({
          section: "quantities",
          label: "Ratio For",
          message: `${who}: say whether the size ratio fills an INNER bundle or the MASTER carton — the two give piece counts a factor of the inner count apart.`,
          kind: "custom",
        });
      }
      /* CARTONS ARE ASKED ONLY WHERE THEY ARE TYPED. Under a pack type the
         boxes row IS the carton count, per size, and every line beneath it is
         derived and has no carton cell at all — so requiring one there would
         name a field that is not on the screen. */
      if (!packModeOf(q)) {
        const short = pieceLinesOf(q).filter(
          (l) => assortLineStarted(l) && !(Number(l.no_of_cartons) > 0),
        ).length;
        if (short) {
          out.push({
            section: "quantities",
            label: "Cartons",
            message: `${who}: ${short === 1 ? "one assortment line has" : `${short} assortment lines have`} a ratio but no carton count, so ${short === 1 ? "it multiplies" : "they multiply"} out to nothing. Open Details and enter Ctns.`,
            kind: "custom",
          });
        }
      }
    }

    /* THROUGH `assortBalanceMessage`, which is where this sentence now lives —
       the Assortments overlay refuses its Done button with the SAME string, and
       two wordings for one disagreement is how an operator learns to distrust
       both. The message is unchanged; only its home moved. */
    const balMsg = assortBalanceMessage(q);
    if (balMsg) {
      out.push({
        section: "quantities",
        label: "Assortment total",
        message: balMsg,
        kind: "custom",
      });
    }
    return out;
  });

  /**
   * THE STYLE TAB AND THE QUANTITY TAB MUST BOOK THE SAME NUMBER OF PIECES
   * (client 2026-08-31: "The Purchase Order (PO) total quantity is the legal
   * basis of the contract. If the total quantity of styles defined in the style
   * profile doesn't match the logistics and shipping quantities allocated in
   * the Quantity tab, the entire contract is financially invalid").
   *
   * ## This is the THIRD level of one balance, and the other two already exist
   *
   * Down inside a destination, `assortBalanceOf` makes the size/colour breakup
   * equal that destination's PO Qty. Across destinations, nothing until now
   * made the destinations equal the ORDER. So an operator could balance every
   * overlay perfectly and still ship 950 against a 1,000-piece contract, with
   * every screen on the document reporting itself correct. The two rules are
   * deliberately the same SHAPE — a signed difference, positive is short — so
   * that the two messages read alike.
   *
   * ## SILENT WHILE THE QUANTITY TAB HAS NOT BEEN STARTED
   *
   * Exactly 0414's rule, quoted in `assortBalanceOf`: "a line with no ratio
   * rows is not disagreeing with anything, it simply has not been filled in."
   * A style total of 1,000 against destinations totalling 0 is an order someone
   * is halfway through entering, and the client's own worked example has the
   * operator type the styles first. Firing here would make every order
   * unsaveable from the moment its first style was entered — including the
   * draft an operator saves at the end of a shift — which is a far bigger
   * change than the one asked for.
   *
   * The test is the TOTAL, not the row count, for the reason `assortBalanceOf`
   * gives one level down: the grid opens on a blank row, so counting rows would
   * fire against a row that is never going to reach the database.
   *
   * ## THE REVERSE IS NOT SILENT
   *
   * Destinations totalling 500 against styles totalling 0 IS a disagreement —
   * pieces are being shipped that the contract does not account for — so it
   * reports, and the message names both figures rather than assuming which of
   * the two is the mistake. Which one is right is not something this rule can
   * know; the client's spec says to detail the discrepancy, not to resolve it.
   *
   * ## PIECES ON BOTH SIDES
   *
   * The style side goes through `stylePoQty`, so a SET PACK compares its
   * exploded pieces rather than its box count. Comparing boxes against pieces
   * would report a mismatch on every correctly-entered set order, by exactly
   * the set size — the same class of failure `derivedPoQty`'s note describes
   * against `targetsOf`.
   */
  const totalStylePoQty = styles.reduce((a, r) => a + stylePoQty(r), 0);
  const totalQuantityPoQty = quantities.reduce(
    (a, q) => a + (Number(q.po_qty) || 0),
    0,
  );
  const poQtyCrossTabMessage: string | null = crossTabPoQtyMessage(
    totalStylePoQty,
    totalQuantityPoQty,
  );

  /**
   * IT BLOCKS SAVE THROUGH THE SAME DOOR EVERY OTHER RULE USES, and is filed
   * under `quantities` rather than `styles` on the client's instruction to
   * "lock the user to the Quantity tab" — `revealFirstProblem` hands the
   * section straight to `goToSection`, so this is also the tab Save jumps to.
   *
   * FILING IT UNDER ONE TAB IS A CHOICE, NOT A FACT. The disagreement belongs
   * to both tabs equally and either could be the one that is wrong; the client
   * named the Quantity tab as where the operator should be put, and a Problem
   * carries exactly one section. The message names both figures so that the
   * operator standing on Quantities can tell whether the fix is here or back on
   * Style(s) — which the rail still lets them reach (see `stepGuard`).
   */
  const crossTabProblems: Problem[] = poQtyCrossTabMessage
    ? [
        {
          section: "quantities",
          label: "PO Qty",
          message: poQtyCrossTabMessage,
          kind: "custom",
        },
      ]
    : [];

  /**
   * A PART OF A FABRIC MUST NAME ITS COORDINATE, ITS COMPONENT AND ITS COLOUR
   * (client 2026-08-21) — and marking those cells `required` is only half of
   * that. AGENTS.md's test for the word is "must the record be unsaveable
   * without it?", so the same three answers that hold the cursor deaden Save.
   *
   * THE RULE IS `componentProblems`, NOT RESTATED HERE. The cell's `required`
   * prop, this block and the server action all call the one function, which is
   * what makes the conditional Colour clause survivable: the list the cell
   * offers and the requiredness of the cell are one decision.
   *
   * NAMED BY DESTINATION, not counted. "Combos row 2, fabric 3, part 1" makes an
   * operator count three levels of card; the combo and the fabric are what the
   * overlay's own title and card headings already say back to them. The parts
   * beneath one fabric ARE counted, because that is the one level the message
   * cannot name and the reveal cannot reach.
   *
   * IT TELLS THEM TO OPEN [Detail], because `revealFirstProblem` cannot. The
   * jump lands on the Combos tab — the parts live in a Sheet that the reveal has
   * no way to open — so the message has to carry the last step, exactly as the
   * assortment problems below say "Open Details and make them match".
   */
  const comboProblems: Problem[] = combos.flatMap((r) => {
    const who = r.combo.trim() || "this combo";
    return r.structures.flatMap((st) => {
      const fabric = st.structure_id
        ? (categoryById.get(st.structure_id)?.name ?? "a fabric")
        : "a fabric with no structure";
      /* ONE PROBLEM PER FABRIC, NOT PER PART. The message cannot point at an
         individual part anyway — the reveal gets no further than the Combos tab
         — so three incomplete parts under one fabric would be three identical
         lines, three on the rail badge, and one place to go. The count of PARTS
         is carried in the words instead, and the missing cells are the union
         across them. */
      /* THE FABRIC'S OWN CELLS, WHICH THIS NEVER USED TO ASK (client
         2026-09-01). `structureProblems` has stated since 2026-08-31 that
         Composition, Tolerance and Fabric Type are required, and nothing read
         it but an amber line inside the overlay — so a fabric missing all three
         saved silently. It is the same rule the stars and holds are derived
         from, so the three now agree by construction rather than by review.

         IT IS ONE PROBLEM FOR THE FABRIC AND ONE FOR ITS PARTS, not a merged
         line: they are missing different KINDS of thing (what the cloth is
         versus what is cut from it), the reveal lands in the same place either
         way, and merging them would produce "missing Composition · Colour" —
         a sentence that reads as one row owing both. */
      const own = structureProblems(st);
      const bad = st.components
        .map((c) => componentProblems(c, st.item_sub_type))
        .filter((m) => m.length);
      if (!own.length && !bad.length) return [];
      const cells = [...new Set(bad.flat())].map((m) =>
        m.replace(" is required", ""),
      );
      return [
        ...(own.length
          ? [
              {
                section: "combos" as const,
                label: "Structure Details",
                message: `${who} ▸ ${fabric}: ${own.join(" · ")}. Open Details and fill ${
                  own.length === 1 ? "it" : "them"
                } in.`,
                kind: "custom" as const,
              },
            ]
          : []),
        ...(bad.length
          ? [
              {
                section: "combos" as const,
                label: "Structure Details",
                message: `${who} ▸ ${fabric}: ${
                  bad.length === 1 ? "a part is" : `${bad.length} parts are`
                } missing ${cells.join(" · ")}. Open Details and fill ${
                  bad.length === 1 ? "it" : "them"
                } in.`,
                kind: "custom" as const,
              },
            ]
          : []),
      ];
    });
  });

  /**
   * WHAT EACH STYLE LINE STILL OWES (client 2026-08-31).
   *
   * "Several fields ... are promoted to strictly mandatory status ... to prevent
   * incomplete data entries that cause empty rows in downstream planning and
   * operational reports."
   *
   * ## THE RULE IS `styleLineProblems`, AND IT IS NOT RESTATED HERE
   *
   * `lib/orders/styles/rules.ts` owns which cells a started line owes, which
   * makes it the same module the Style master already validates through and lets
   * `scripts/check-style-rules.mts` prove it with no database and no bundler.
   * This function only does what that module cannot: name the ROW.
   *
   * ## `fields:` CANNOT STATE ANY OF THIS
   *
   * `FieldCheck.empty` reads the whole form and answers once. These are per-ROW,
   * and a grid may hold six of them — so they arrive through `extra`, which is
   * exactly what `extra` is for and what `quantityProblems` and `comboProblems`
   * beside them already do.
   *
   * ## `kind: "custom"`, WHICH MEANS BLOCKING
   *
   * `isBlocking` in `lib/screens/validity.ts` blocks everything but `"format"`,
   * and its note says why: a custom rule is a completeness claim about the whole
   * record, not a complaint about a half-typed value. That is precisely the
   * client's argument — a half-filled line reaches a report — so blocking is the
   * ask rather than a side effect of the tag.
   *
   * ## THE ROW IS NAMED BY ITS OWN TEXT, NEVER BY AN INDEX
   *
   * `revealFirstProblem` lands on a SECTION and then on the first marked field
   * in it. With six style rows that is the first row's first empty cell, which
   * may not be the row being complained about — so the message carries the row
   * itself, the same way `comboProblems` carries "open [Detail]" because the
   * reveal cannot open a Sheet.
   *
   * `who` IS `packProblems`' EXACT IDIOM, and the first cut of this function got
   * it wrong: it read `Style ${i + 1} (${ref})`. **There are no row numbers on
   * this grid** — the `#N` band was replaced by a corner ✕ — so "Style 3" named
   * something the operator cannot see, and it moves the moment a row above it is
   * removed. Every other per-row rule on this screen (`packProblems`,
   * `quantityProblems`, `comboProblems`) says `<the row's own text>.trim() ||
   * "this <noun>"`, and the reason is exactly that.
   *
   * ## NO SERVER HALF, STATED RATHER THAN FORGOTTEN
   *
   * AGENTS.md ▸ Duplicates is emphatic that a screen-only check protects nothing,
   * because `lib/data-io` imports reach the action directly. That door does not
   * exist here: `lib/data-io/entities.ts` describes MASTER entities only, so the
   * two writers of an amendment are this screen and `order-seed.ts`. Compiling
   * these into a `superRefine` on `amendmentInput` would also refuse every order
   * the seed builds programmatically, which is a separate change with its own
   * verification. If an orders importer is ever added, this is the guard it needs.
   */
  /**
   * THE RULE MODULE'S FIELD NAMES, IN THE WORDS ON THE SCREEN.
   *
   * `lib/orders/styles/rules.ts` is pure and must stay loadable by plain Node, so
   * it names cells in its own vocabulary (`order_unit`) rather than carrying this
   * screen's labels. Four of the seven are `styleColumns` headers and three
   * (Coordinate · Sizes · Components) are the `Field` labels `componentsAndSizes`
   * draws — so there is no one array to derive this from, and a `Record` keyed by
   * `StyleLineField` is what makes a NEW field a compile error here rather than a
   * blank label at runtime.
   *
   * SINGULAR "Coordinate", matching the pane's own heading, and plural "Sizes"
   * matching its own — the two disagree on screen and this follows the screen.
   */
  const STYLE_LINE_FIELD_LABEL: Record<StyleLineField, string> = {
    style: "Style",
    style_category: "Style Category",
    order_unit: "Order Unit",
    description: "Description",
    coordinates: "Coordinate",
    sizes: "Sizes",
    components: "Components",
  };
  /**
   * TWO STYLE LINES MAY NOT SHARE A REF (client 2026-08-31: "a UNIQUE style
   * identifier must be selected or entered before proceeding").
   *
   * ## NOT A `styleLineProblems` RULE, BECAUSE IT IS NOT A PROPERTY OF A LINE
   *
   * Every other mandatory rule reads ONE row and can answer from it. This one is
   * about the SET, so it lives beside `comboProblems` and `quantityProblems`
   * rather than in the per-row module — and the counting half is still
   * `duplicateRefCounts` there, so it stays covered by the vector script.
   *
   * ## THE NORMALISER IS `styleKey`, NEVER A SECOND TRIM-AND-UPPER
   *
   * That function is the Orders module's join key and its own header is explicit:
   * "two copies of a key rule stay identical exactly until one of them is
   * 'improved'". `rules.ts` cannot import it (it is deliberately import-free so
   * plain Node can load it), so the normalising happens HERE and the counting
   * happens there. A guard keyed differently from the join would pass a pair the
   * save then merges.
   *
   * ## WHY IT BLOCKS RATHER THAN WARNS
   *
   * A repeated ref is not an untidy list. Price Details, Combos, Quantities and
   * Approval Qty all resolve on this text, so each becomes ambiguous — and
   * `normalizeStyleComponents` de-dupes on `(styleKey, coordinate, component,
   * fabric_category)`, so the two lines' component grids are MERGED and pruned
   * against each other at save. The operator enters two styles and stores one,
   * with nothing on screen to say so. `settleStyleRef` makes it reachable in one
   * keystroke, too: it carries a line's children across on a RENAME, so typing an
   * existing ref into a second line is an ordinary slip.
   *
   * ## NO CURSOR HOLD, DELIBERATELY
   *
   * AGENTS.md wires a duplicate through `dupFieldProps` so it holds the cursor,
   * and that is right for a MASTER checking a finished name against stored rows.
   * Here the collision is with a sibling line and fires against a HALF-TYPED ref:
   * with "AB" on line 1, typing "A" into line 2 collides for exactly one
   * keystroke. Holding there cages an operator on a value they are in the middle
   * of getting right — the trap the GSTIN note in `consignee-master-screen.tsx`
   * records and the reason `isBlocking` treats `format` differently. It blocks
   * Save, reddens the rail, seals the tab and prints under the row; it does not
   * refuse the next keystroke.
   */
  const duplicateStyleRefs = duplicateRefCounts(
    styles.map((r) => styleKey(r.style_ref_no)),
  );

  const duplicateStyleRefProblems: Problem[] = duplicateStyleRefs.map((d) => ({
    section: "styles",
    label: "Style",
    message: `${d.ref}: ${d.count} style lines carry this ref. Give each line its own Style, or remove the repeat — Prices, Combos and Quantities all resolve on this text.`,
    kind: "custom" as const,
  }));
  const styleLineProblemList: Problem[] = styles.flatMap((r) => {
    const who = r.style_ref_no.trim() || "this style";
    return styleLineProblems(r).map((x) => ({
      section: "styles",
      /* THE WORDS ON THE FIELD, which is what `label` means everywhere else
         here — "Pack Composition", "Packs", "Ratio For". `x.field` is the rule
         module's own name for the cell, mapped once. */
      label: STYLE_LINE_FIELD_LABEL[x.field],
      message: `${who}: ${x.message}`,
      kind: "custom" as const,
    }));
  });

  /**
   * DATE CANNOT BE IN THE FUTURE — the enforcing half of the `max` on the Date
   * field (client 2026-08-29). Past dates are fully allowed and there is no
   * lower bound; the field's own note carries the reasoning.
   *
   * IT EXISTS BECAUSE `max` DOES NOT ACTUALLY REFUSE. A native date input's
   * `max` bounds validity and greys the picker, but the year segment still
   * accepts typed digits and the value still reaches state — the same lesson
   * `DATE_MAX` in `input.tsx` records for the six-digit year, one attribute
   * along. So the ceiling is stated twice, and the save reads THIS one.
   *
   * `kind: "custom"` — which blocks (`isBlocking`), lands the rail badge on
   * Order Info and lets Save's `revealFirstProblem` jump the cursor to
   * `hd-date`. An advisory would be the wrong shape: an order dated forward
   * buckets its RE No into next year's series, which is not a warning.
   *
   * COMPARED AS TEXT, deliberately. Both sides are `YYYY-MM-DD`, which sorts
   * lexicographically exactly as it sorts chronologically, so this needs no
   * Date parsing and cannot pick up a timezone on the way — the trap `today()`
   * above was just fixed for. A blank date says nothing here; it is already
   * `required`, and "a blank field is not also a malformed one".
   *
   * ## AND THERE IS DELIBERATELY NO ZOD TWIN
   *
   * Every other rule on this screen is stated again in the action, because
   * `lib/data-io` writes past the screen. This one is not, and the reason is
   * the timezone: the server has no idea what day it is FOR THE OPERATOR.
   * Postgres `current_date` on this database reads 2026-08-28 while an IST
   * operator's calendar says the 29th — measured, not assumed — so a server-side
   * `amend_date > current_date` would refuse an order dated with the operator's
   * own today for the first five and a half hours of every day. That is the
   * exact failure the local `today()` above exists to avoid, reintroduced one
   * layer down where the operator cannot see or fix it.
   *
   * A correct server guard needs the operator's zone sent with the payload, and
   * that is a bigger change than this rule justifies — orders have no data-io
   * import path (AGENTS.md, "CAPITALS": data-io "describes master entities and
   * nothing else"), so the screen is in fact the only door. Revisit if orders
   * ever gain one.
   */
  const futureDateProblems: Problem[] =
    form.amend_date && form.amend_date > today()
      ? [
          {
            section: "orderinfo",
            fieldId: "hd-date",
            label: "Date",
            message: "Date cannot be in the future.",
            kind: "custom",
          },
        ]
      : [];

  const validity = sectionValidity({
    sections: [
      { key: "orderinfo" },
      /* SPLIT OUT OF `orderinfo` ON 2026-08-27 with the grid. It must be
         declared here or `revealFirstProblem` hands `p.section` to
         `goToSection` and lands nowhere — the same trap the `combos` note
         below records. */
      { key: "styles" },
      { key: "logistic" },
      /* THE RAIL'S OWN KEY. `revealFirstProblem` hands `p.section` straight to
         `goToSection`, so a section declared here that names no rail row is a
         blocked Save that reports the right message and then jumps nowhere.
         "combos" is the key the tab registers with. */
      { key: "combos" },
      { key: "quantities" },
      /* T&A (0481). "an order cannot be saved without its T&A path being
         defined" (client) — so the section is declared here for the reason the
         two notes above give and not for a new one: `taProblems` arrives in
         `extra` carrying `section: "ta"`, and a key that names no rail row is a
         blocked Save that reports the right sentence and then jumps nowhere.
         "ta" is the key the tab registers with. */
      { key: "ta" },
    ],
    values: form,
    fields: [
      // Order Info. Labels are the words ON the fields, because a blocked Save
      // reads them out loud — "Unit", not "Location".
      //
      // "Deli.Dt" USED TO BE ABSENT HERE BECAUSE IT DID NOT BLOCK. It blocks
      // since 2026-08-31 (client), along with Season and Rejection Rule, so all
      // three are declared below. The old sentence is kept in this note rather
      // than deleted, because a reader who finds Deli.Dt in a required list and
      // a comment saying it is deliberately not there would trust the comment.
      //
      // UNIT AND DATE ARE ENFORCED **ONLY** HERE SINCE 2026-08-31, and that is
      // the half of the Tab-bypass change that is easy to lose. Both boxes went
      // off the Tab path and gave up their `*` and their cursor hold with it
      // (`autoFilledField`, see the fields themselves) — because a field Tab
      // cannot reach must not also refuse to be left. The record staying
      // unsaveable without them did NOT go anywhere: these two entries are
      // unconditional, they do not read `unitAuto` / `dateAuto`, and they are now
      // the only thing standing between a blank Unit and a saved order with no
      // RE No series to count in. Do not make them conditional to "match" the
      // boxes; the boxes are presentation and this is the guard.
      {
        section: "orderinfo",
        label: "Unit",
        required: true,
        empty: (f) => !f.location_id,
      },
      {
        section: "orderinfo",
        label: "Customer",
        required: true,
        empty: (f) => !f.customer_id,
      },
      {
        section: "orderinfo",
        id: "hd-date",
        label: "Date",
        required: true,
        empty: (f) => !f.amend_date,
      },
      /* THE THREE ADDED 2026-08-31 (client). `id` is the input's DOM id, and it
         is what `revealFirstProblem` steers the cursor to — without it a blocked
         Save names the field and then lands nowhere, which is the trap the
         `combos` note above records one level up (a section with no rail row).
         Labels are the words ON the fields: "Deli.Dt", not "Delivery Date". */
      {
        section: "orderinfo",
        id: "hd-deli",
        label: "Deli.Dt",
        required: true,
        empty: (f) => !f.delivery_date,
      },
      {
        section: "orderinfo",
        id: "hd-season",
        label: "Season",
        required: true,
        empty: (f) => !f.season,
      },
      {
        section: "orderinfo",
        label: "Rejection Rule",
        required: true,
        empty: (f) => !f.rejection_rule_id,
      },
      /**
       * PO NO — MANDATORY, AND A DOCUMENT REFERENCE (client 2026-08-31). The
       * `<Field required>` on the box draws the `*` and holds the cursor; this is
       * the half that deadens Save and reads the message out.
       *
       * `format` + `text` rather than a hand-written check: `validateFormat`
       * gives the sentence `lib/validation/formats.ts` declares, which is the
       * SAME one the server's `requiredKind("doc_ref", …)` produces — a second
       * regex here would compile, run and disagree by one character.
       *
       * THE KIND WAS `alphanum` FOR ABOUT AN HOUR. It was renamed WITH its regex
       * when the client's rule widened to admit `-` and `/`, and the rename is
       * the load-bearing half: a kind still called `alphanum` while accepting
       * hyphens lies to its next caller, who would reach for it expecting the
       * name to be the spec. Do not "restore" the old name.
       *
       * A format problem is NON-BLOCKING app-wide (`isBlocking`: only `format`
       * is, because it fires against a half-typed value and caging an operator
       * mid-value is the GSTIN precedent). So the required half stops Save and
       * the malformed half is a live message plus the server's refusal. That is
       * the standing trade, restated here rather than quietly diverged from.
       */
      {
        section: "orderinfo",
        id: "hd-pono",
        label: "PO No",
        required: true,
        empty: (f) => !f.po_no.trim(),
        format: "doc_ref",
        text: (f) => f.po_no,
      },
      /* MERCHANDISER — mandatory since 2026-08-31, and now an `employees` row.
         No `id`: the picker's trigger carries none, so the reveal falls back to
         the first marker in the section, which on a blank Merchandiser is this
         field's own `data-required-empty`. */
      {
        section: "orderinfo",
        label: "Merchand.",
        required: true,
        empty: (f) => !f.merchandiser_id,
      },
      // Logistic — the five that were invisible from where the operator stood.
      {
        section: "logistic",
        label: "Ship Type",
        required: true,
        empty: (f) => !f.ship_type_id,
      },
      {
        section: "logistic",
        id: "lg-shipmode",
        label: "Ship Mode",
        required: true,
        empty: (f) => !f.ship_mode,
      },
      {
        section: "logistic",
        id: "lg-paymode",
        label: "Pay Mode",
        required: true,
        empty: (f) => !f.pay_mode,
      },
      {
        section: "logistic",
        label: "Pay Terms",
        required: true,
        empty: (f) => !f.pay_terms_id,
      },
      {
        section: "logistic",
        label: "Currency",
        required: true,
        empty: (f) => !f.currency_code,
      },
    ],
    /* The live cross-field answers this module cannot compute for itself —
       exactly what `extra` is for, and they arrive already carrying their
       section. `fields` cannot state either of these: a quantity rule is
       arithmetic across a row, and a Structure Details part is three levels
       below `form`. */
    extra: [
      ...futureDateProblems,
      ...styleLineProblemList,
      ...duplicateStyleRefProblems,
      /* After `styleLineProblemList`, deliberately: an unnamed style row reports
         its missing Style Ref No first, and only a NAMED row can be told to
         attach a file (`filesForStyle` cannot key on a blank ref). Reversed, the
         first thing Save would say about a fresh row is "attach a document",
         pointing at a cell whose control the row cannot own yet. */
      ...styleFileProblems,
      ...quantityProblems,
      ...crossTabProblems,
      ...comboProblems,
      ...packProblems,
      /**
       * `...taProblems` IS DELIBERATELY ABSENT, AND THIS IS A TEMPORARY REVERSAL
       * (client 2026-08-31: "make it optional now will implement it later as
       * required").
       *
       * T&A shipped mandatory earlier the same day — an order could not be saved
       * without its ladder. The client has since asked for it to be optional
       * WHILE THE FEATURE IS BEING ADOPTED, not permanently. **The gate is coming
       * back.** So this is one deleted line and nothing else: `taProblems` is
       * still built, still states all four rules, and still carries `section:
       * "ta"` and its labels — restoring the gate is putting `...taProblems`
       * back on this line, with nothing to rewrite.
       *
       * DO NOT "TIDY UP" BY DELETING `taProblems`, and do not read its absence
       * here as evidence the rules were withdrawn. They are rendered on the tab
       * instead (see the notices block there), so the operator still reads
       * "KNITTING: enter how many days it needs" in place — it just no longer
       * stops the save.
       *
       * WHY IT CANNOT SIMPLY BE RE-TAGGED NON-BLOCKING: `isBlocking`
       * (lib/screens/validity.ts) blocks every kind except `"format"`, and these
       * are not format errors. Passing them as `"format"` to buy the
       * non-blocking branch would be a lie about what they are, and its own note
       * says that branch is an open question — so the tag would silently start
       * blocking again the day somebody settles it. Leaving `extra` is the only
       * honest way to not block.
       *
       * The ordering note that stood here is kept because it is what the restore
       * needs: T&A belongs LAST in this list. Its most common refusal is "Enter
       * the Earlier Shipment Date on the Quantities tab before scheduling" — a
       * sentence steering the operator at a tab whose own problems are already
       * above it, so reported first it would point at a symptom of something
       * named below. `extra` is declaration order (`sectionValidity` sorts by
       * kind, then by declaration) and `revealFirstProblem` reads
       * `validity.first`.
       */
    ],
  });

  /* STILL DERIVED, AND NOTHING BESIDE IT. The T&A rule is a section key plus
     entries in `extra` — never a second `sectionValidity` call merged in
     afterwards, which is the hand-assembled `canSave` this module exists to end
     (see the note where `validity` used to live). */
  const canSave = validity.canSave;

  /**
   * Save, when it cannot save. Names the first problem, goes to the section that
   * owns it and lands on the field — and because the button stays ENABLED,
   * Ctrl+S and Enter-off-the-last-field route here too. With it disabled,
   * `submitTargetOf` (lib/focus.ts) resolved the surface's primary action to the
   * last non-disabled footer button, so both keys quietly hit "Save as Draft" or
   * Cancel instead: the 2026-07-25 bug, live again on this screen until now.
   */
  const revealFirstProblem = () => {
    const p = validity.first;
    if (!p) return;
    /* THE OPERATOR HAS NOW ASKED TO LEAVE AND BEEN REFUSED, so the per-row
       reasons are owed. The toast names ONE problem; this is what puts the rest
       on the rows they belong to, instead of making the operator press Save
       repeatedly to discover them one at a time. */
    setProblemsRevealed(true);
    toastError(p.message);
    shellRef.current?.goToSection(
      p.section,
      p.fieldId ? { fieldId: p.fieldId } : "problem",
    );
  };

  /**
   * The pieces of ONE size on one line — the same multiplication `lineQtyOf`
   * does, one level down, and the weight a Color-wise or Size-wise rate is
   * averaged by (0416).
   *
   * IT EXISTS SO THE TWO CANNOT DISAGREE. `pricingWeights` used to multiply by
   * `no_of_cartons` unconditionally, while `lineQtyOf` consulted
   * `is_ratio_wise_pack` — so an unticked line valued at the carton multiple
   * while counting as bare pieces. Two readings of one tree is exactly what
   * AGENTS.md's "one declaration, four enforcers" refuses.
   */
  const sizePiecesOf = (
    q: QuantityRow,
    l: AssortLineRow,
    z: AssortSizeRow,
    mode: AssortMode,
  ) =>
    mode === "solid"
      ? Number(z.qty) || 0
      : packFactorOf(q, l) * (Number(z.qty) || 0);

  /**
   * THE ORDER'S QUANTITY BREAKUP — the Quantities tab flattened to
   * (style, combo, size, pieces).
   *
   * TWO CONSUMERS SINCE 0435, which is why it is no longer called
   * `pricingWeights`: it weights a Colour-wise or Size-wise rate on the Prices
   * tab (0416), and it IS the Approval Qty tab's quantities. One flattening, so
   * the production target and the order value can never be computed from two
   * different readings of the same assortment.
   *
   * The tree is quantity row ▸ assort line ▸ size, and the pieces of one size in
   * one line come from `sizePiecesOf` — the SAME rule `lineQtyOf` applies to the
   * line's total, one level down, which is why it is a shared function rather
   * than the multiplication written twice. Flattened HERE rather than in
   * `order-value.ts` because the tree shape is this screen's business; the
   * module only needs three keys and a number, which is what makes it testable
   * without building an assortment.
   *
   * IT USED TO MULTIPLY BY CARTONS UNCONDITIONALLY, while `lineQtyOf` consulted
   * `is_ratio_wise_pack` — so a line the operator had not ticked was VALUED at
   * the carton multiple and COUNTED as bare pieces, and the Avg Rate on Logistic
   * disagreed with the Total Qty on the row that fed it.
   */
  const quantityBreakup = quantities.flatMap((q) => {
    const mode = assortModeOf(q) ?? "solid";
    /* PIECES ONLY (0473). This feeds the Approval Qty tree, the order's value
       and the balance rule; a boxes row reaching any of them is the exact
       "silent, total costing failure" the pack explosion exists to prevent,
       arriving from the inside. */
    return pieceLinesOf(q).flatMap((l) =>
      l.sizes.map((z) => ({
        /* THE LINE'S STYLE, not the destination's (0433) — through the one
           resolver, so a Multiple Style pack is priced against the style each
           line actually packs. Reading `q.style_ref_no` here would value every
           line of a multi-style destination at the FIRST style's rate, and be
           invisible: the total would still look plausible. */
        style_ref_no: assortLineRef(q, l),
        combo: l.combo,
        size_id: z.size_id,
        qty: sizePiecesOf(q, l, z, mode),
      })),
    );
  });

  const orderVal = orderValue(
    styles.map((r) => ({
      style_ref_no: r.style_ref_no,
      /* THE DERIVED PIECES on a set pack, matching what Save stores — the box
         itself is read-only there and `r.po_qty` is whatever was last typed
         before the switch went on. Valuing the order off a stale box while
         storing a different figure is two documents disagreeing. */
      po_qty: stylePoQty(r),
      /* Only consulted when this style's rows say Pack-wise (0467). A rate per
         box multiplied by the garments inside it overstates the order by the
         set size, on the screen that prints the invoice figure.
         FALLING BACK TO THE ASSORTMENT'S BOXES (2026-08-28) — `packs_ordered`
         is 0467's field and is unreachable while the set-pack switch is off, so
         without this a Pack-wise style refuses on every order. */
      packs_ordered: Number(r.packs_ordered) || boxesForStyle(r.style_ref_no),
      /* THE BOX IS VALUED ONCE (2026-08-28). Without this a three-style gift
         box is worth three times what the buyer pays for it, and says so with
         no styles unresolved. See `pack_group` in `order-value.ts`. */
      pack_group: packGroupFor(r.style_ref_no) || null,
    })),
    priceDetails.map((r) => ({
      style_ref_no: r.style_ref_no,
      price_type: r.price_type,
      combo: r.combo,
      size_id: r.size_id,
      price: Number(r.price) || 0,
    })),
    quantityBreakup,
  );

  /**
   * THE ORDER'S VALUE IN THE BOOKS' CURRENCY (client spec 2026-08-21).
   *
   *     INR Value = Gross Value x Ex-Rate
   *
   * The Gross Value is in the BUYER's currency; this is the figure the Budget
   * phase measures its margin against, so it is the one the cost controls are
   * ultimately set from. Derived, never stored: `garment_order_amendments` has
   * `currency_code`, `ex_rate` and `gross_value`, and a fourth column holding
   * their product is a fourth thing that can disagree with the other three —
   * the same argument the Days field on this tab already records for
   * `payment_terms.credit_days`.
   *
   * `ex_rate` is a STRING here (every field on this screen is an `<Input>`) and
   * a number in the database, which is why the coercion is at this call site
   * and not inside the module — see the note on `orderVal` above.
   */
  const inrVal = inrValue(
    orderVal.grossValue,
    Number(form.ex_rate) || 0,
    form.currency_code,
  );

  /**
   * APPROVAL QTY, DERIVED (0435) — Style ▸ Combo ▸ Size.
   *
   * Placed HERE, below `quantityBreakup`, for the reason the note above the
   * breakup records: a `const` arrow is not hoisted, and this reads it.
   *
   * `approvalQtys` state is now the STORED numbers rather than the visible
   * rows — the rows come from `buildApprovalTree`, which joins Style(s),
   * Combos and the breakup and looks the typed figure up by
   * (style, combo, size). So adding a colour on Combos adds a line here, and
   * entering an assortment fills its quantities in, with nothing to re-type.
   */
  const approvalTree = buildApprovalTree({
    styles: styles.map((r) => ({
      style_ref_no: r.style_ref_no,
      style: r.style_ref_no,
      article_no: r.article_no,
      // The style's declared run, IN ORDER — 2 YEARS before 14 YEARS is a size
      // run, not an alphabetical accident.
      sizes: r.sizes.map((z) => z.size_id),
    })),
    combos: combos.map((c) => ({
      style_ref_no: c.style_ref_no,
      combo: c.combo,
      combo_description: c.combo_description,
    })),
    breakup: quantityBreakup,
    stored: approvalQtys.map((r) => ({
      style_ref_no: r.style_ref_no,
      combo: r.combo,
      size_id: r.size_id,
      approval_qty: r.approval_qty,
    })),
  });

  /**
   * WHAT IDENTIFIES A STORED APPROVAL — style, colour, size, and nothing else.
   *
   * `approvalQtys` is a LOOKUP, not the rows on screen (0435): the tree is
   * rebuilt from Style(s) · Combos · the breakup, and this list only supplies
   * the typed figure by (style, combo, size). `flattenApprovalTree` writes the
   * complete tree on save, so the descriptive fields on a stored row — style
   * name, article, combo description, qty — are never read back and are filled
   * with blanks here rather than threaded through the setters that no longer
   * have them to hand.
   */
  type ApprovalAt = { style_ref_no: string; combo: string; size_id: string | null };
  const blankApprovalRow = (at: ApprovalAt, value: string): ApprovalQtyRow => ({
    key: newKey(),
    style_ref_no: at.style_ref_no,
    style: "",
    article_no: "",
    combo: at.combo,
    combo_description: "",
    size_id: at.size_id,
    qty: "",
    approval_qty: value,
  });

  /**
   * Type an approval quantity — an UPSERT keyed by identity, because the line
   * on screen may not exist in state yet.
   *
   * Only a touched line is stored while editing; `flattenApprovalTree` writes
   * the whole tree on save, so the saved document is a complete record rather
   * than the sparse list of lines somebody happened to visit.
   */
  const setApprovalAt = (at: ApprovalAt, value: string) =>
    setApprovalQtys((xs) => {
      const k = approvalKey(at.style_ref_no, at.combo, at.size_id);
      const i = xs.findIndex(
        (x) => approvalKey(x.style_ref_no, x.combo, x.size_id) === k,
      );
      return i >= 0
        ? xs.map((x, n) => (n === i ? { ...x, approval_qty: value } : x))
        : [...xs, blankApprovalRow(at, value)];
    });

  /**
   * ONE ANSWER ACROSS A WHOLE COLOUR — what the per-colour box writes.
   *
   * This is the setter behind "one number per colour, not one per size"
   * (client 2026-08-21): the legacy screen made the operator type the same
   * figure once per size, and its data shows it — every colour reading
   * `2, 2, 2, 2, 2, 2` (screenshot 2443). The SIZES ARE STILL WHAT IS STORED;
   * this writes all of them.
   *
   * IT REPLACED `fillApprovalDown`, which took the first size's answer and
   * pushed it over the rest behind a button. That button existed because the
   * screen asked six questions and the operator only had one — with the box
   * asking once, there is nothing left for it to do.
   *
   * ONE `setApprovalQtys`, NOT ONE PER SIZE. Each updater reads the list it is
   * handed, so a loop of calls would each start from the pre-write state and
   * only the last would survive — the stale-closure fold the old fill already
   * had to guard against. The loop runs INSIDE the updater, threading `out`.
   *
   * The sizes come from the TREE rather than from `approvalQtys`, because a
   * size nobody has typed into yet has no stored row to find.
   */
  const setApprovalAcross = (styleRefNo: string, combo: string, value: string) => {
    const sizes =
      approvalTree.styles
        .find((st) => styleKey(st.style_ref_no) === styleKey(styleRefNo))
        ?.combos.find((c) => c.combo.trim().toUpperCase() === combo.trim().toUpperCase())
        ?.sizes.map((z) => z.size_id) ?? [];
    if (!sizes.length) return;
    setApprovalQtys((xs) => {
      let out = xs;
      for (const size_id of sizes) {
        const at = { style_ref_no: styleRefNo, combo, size_id };
        const k = approvalKey(at.style_ref_no, at.combo, at.size_id);
        const i = out.findIndex(
          (x) => approvalKey(x.style_ref_no, x.combo, x.size_id) === k,
        );
        out =
          i >= 0
            ? out.map((x, n) => (n === i ? { ...x, approval_qty: value } : x))
            : [...out, blankApprovalRow(at, value)];
      }
      return out;
    });
  };

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
   * The style refs THIS order has entered — the Assortments grid's StyleRefNo
   * list (0433). Same shape and same reasoning as `declaredComboOptions`
   * directly above: in-form values, offered rather than enforced.
   *
   * Deliberately NOT filtered to styles that already carry sizes. A style with
   * no sizes yet is a style the operator is part-way through entering, and
   * hiding it here would read as the style being missing rather than
   * incomplete — the grid already says "no sizes to fill" in its own words.
   */
  const styleRefOptions = Array.from(
    new Set(
      styles.map((s) => s.style_ref_no.trim().toUpperCase()).filter(Boolean),
    ),
  ).map((s) => ({ value: s, label: s }));

  /**
   * KEEP THE VALUE THE RECORD ALREADY HOLDS ON THE LIST.
   *
   * `Combobox` renders `selected?.label ?? ""` — so a stored value that is not
   * among its options shows an EMPTY BOX while the value is still in state and
   * still saves. Not a styling detail: it reads as "nobody filled this in", and
   * the operator's natural fix is to type something, which overwrites a value
   * they were never shown.
   *
   * This is the same rule the Disabled-rows section states for pickers — "the
   * one row that survives is the one the record already holds" — arriving here
   * because both of this grid's list cells are scoped:
   *
   * - a Combo is scoped to the line's style (0433), so a colourway declared
   *   under a DIFFERENT style vanished from the box the moment the scoping went
   *   in — a defect this screen introduced yesterday;
   * - a Style Ref No is scoped to the styles the order declares today, so a
   *   destination carrying free text ("12", client screenshot 2367) or a ref
   *   whose Styles Details line has since been removed shows blank.
   *
   * Appended, never prepended: the real options keep their order and the odd
   * one out sits at the end where it reads as the exception it is.
   */
  const withHeldOption = (options: { value: string; label: string }[], held: string) =>
    held.trim() && !options.some((o) => o.value === held)
      ? [...options, { value: held, label: held }]
      : options;

  /**
   * The NAME behind a style ref, for the read-only Style cell beside it.
   *
   * The style master's own name first — that is the word the legacy screen
   * prints ("AUGUSTIN") — falling back to the line's typed description for a
   * ref that names a Styles Details row which has not picked a master style
   * yet. `styleKey`, never `===`, like every other join in this module.
   */
  const styleNameForRef = (ref: string) => {
    if (!ref.trim()) return "";
    const line = styles.find((x) => styleKey(x.style_ref_no) === styleKey(ref));
    if (!line) return "";
    /* THE LINE ANSWERS FOR ITSELF (2026-08-25). This preferred the master's name
       and fell back to the line's own description; with Style typed the ref is
       the name, and the description stays as the fallback for a line whose ref
       is blank but which has been described. */
    return line.style_ref_no.trim() || line.style_description;
  };

  /**
   * PACK TYPE(S) ▸ WHAT THIS METHOD PACKS (0472, client 2026-08-27,
   * screenshot 2518: "for the pack type we missed 4 field table ... the style
   * and combo from the previous tab data").
   *
   * Legacy's tab is master-detail and the conversion took only the master, so a
   * pack type was a WORD with nothing under it. The four columns are legacy's:
   * StyleRefNo | Style No | Combo | Qty.
   *
   * ## BOTH LISTS COME FROM THE TABS BEFORE THIS ONE, WHICH IS THE ASK
   *
   * `styleRefOptions` is the Style(s) section and `comboOptionsForStyle` is the
   * Combos tab, SCOPED to the style the line names — the cascading-picker rule,
   * and the same pair the Assortments overlay already uses two sections down.
   * Nothing here re-derives either list.
   *
   * `withHeldOption` on BOTH, for the reason it exists: a scoped list drops a
   * value the row already holds (a combo declared under a style since removed),
   * and `Combobox` renders a missing value as an EMPTY BOX while still saving
   * it — which reads as "nobody filled this in" and invites the operator to
   * overwrite a value they were never shown.
   *
   * ## STYLE NO IS A FACT, NOT A FIELD
   *
   * Rendered as text rather than a disabled input, so it neither invites a
   * click nor sits in the Tab path — the call the Prices tab's Unit cell makes
   * for the same shape. On a typed line it equals the ref ("THE REF IS THE
   * NAME NOW"); the column is kept because legacy shows it and because a
   * document imported with both still round-trips.
   *
   * ## NOTHING IS `required`
   *
   * The grid opens on a seeded blank row, and a mandatory field HOLDS THE
   * CURSOR — so a `required` here would cage the operator in a row they have
   * not looked at yet. Same call, and the same wording, as the Coordinates grid
   * on the style line. `normalizePackTypeLines` drops a line naming no style,
   * so the blank costs nothing on save.
   */
  const packTypeLinesGrid = (r: PackTypeRow) => (
    <ChildGrid<PackTypeLineRow>
      /* NO `narrow`, AND THAT IS THE WHOLE OF THE FIRST LAYOUT BUG (client
         2026-08-27, screenshot 2521). It was copied from the Coordinates grid
         under a style line, where it is right: that grid is ONE picker and
         legacy draws the same list in a narrow panel. Here it caps the root at
         `max-w-lg` — 512px for a FOUR-column table — so the pane's remaining
         ~1100px went unused while Style Ref No rendered "GRIL…" and Combo
         "WHI…" in ~70px boxes, with the full value printed in the untruncated
         cell right beside it.

         The prop's own note says the cap and the table's breakpoint are
         coupled, so this is not a width to tune: a narrow grid is a DIFFERENT
         layout, and the choice is per grid rather than per pixel. */
      columns={[
        {
          header: "Style Ref No",
          cell: (l) => (
            <Combobox
              options={withHeldOption(styleRefOptions, l.style_ref_no)}
              value={l.style_ref_no}
              onChange={(v) =>
                mutPackTypeLines(r.key, (ls) =>
                  ls.map((x) =>
                    x.key === l.key
                      ? /* THE COMBO GOES WITH IT. Colourways are scoped to the
                           style, so a combo kept across a style change is a
                           value this row's own list no longer offers — held on
                           screen by `withHeldOption` and saved against a style
                           that never declared it. */
                        { ...x, style_ref_no: v.toUpperCase(), combo: "" }
                      : x,
                  ),
                )
              }
              /* placeholder-blank: exempt -- the ORDER's state, not a hint:
                 with no styles entered there is nothing this box can offer, and
                 saying so points at the section that fixes it. */
              placeholder={
                styleRefOptions.length ? undefined : "Enter a style on Style(s) first"
              }
              clearable
            />
          ),
        },
        {
          header: "Style No",
          cell: (l) => (
            <div className="flex min-h-8 items-center text-sm text-muted-foreground">
              <Truncated>{styleNameForRef(l.style_ref_no) || "—"}</Truncated>
            </div>
          ),
        },
        {
          header: "Combo",
          cell: (l) => {
            const scoped = comboOptionsForStyle(l.style_ref_no).map((c) => ({
              value: c,
              label: c,
            }));
            return (
              <Combobox
                options={withHeldOption(scoped, l.combo)}
                value={l.combo}
                onChange={(v) =>
                  mutPackTypeLines(r.key, (ls) =>
                    ls.map((x) =>
                      x.key === l.key ? { ...x, combo: v.toUpperCase() } : x,
                    ),
                  )
                }
                /* placeholder-blank: exempt -- names the tab that fills this,
                   the same way the Style Ref cell above names its section. A
                   line whose style is not chosen yet cannot have a colourway
                   list at all, and the two states read differently. */
                placeholder={
                  !l.style_ref_no.trim()
                    ? "Pick a Style Ref No first"
                    : scoped.length
                      ? undefined
                      : "No combos on this style yet"
                }
                clearable
              />
            );
          },
        },
        {
          header: "Qty",
          align: "right",
          width: "8rem",
          /* HOW MANY PIECES ONE PACK OF THIS METHOD HOLDS — the figure the grid
             exists to produce, and the one legacy never showed. It is what makes
             a method named "3 PCS PACK" whose lines sum to 13 visible as the
             contradiction it is; without it the operator adds lines and the
             total lives only in their head.

             DERIVED, NEVER STORED — the rule 0414 and 0467 both state: a column
             for a sum is a second source of truth for an addition. `total` also
             keeps the band off the keyboard axis, which a hand-rolled footer
             row would not. */
          total: { kind: "sum", of: (l) => Number(l.qty) || 0 },
          cell: (l) => (
            <Input
              type="number"
              className="text-right"
              value={l.qty}
              onChange={(e) =>
                mutPackTypeLines(r.key, (ls) =>
                  ls.map((x) => (x.key === l.key ? { ...x, qty: e.target.value } : x)),
                )
              }
            />
          ),
        },
      ]}
      rows={r.lines}
      seedRow
      onAdd={() => addPackTypeLine(r.key)}
      onRemove={(l) =>
        mutPackTypeLines(r.key, (ls) => ls.filter((x) => x.key !== l.key))
      }
      /* toolbar-size: exempt -- a ChildGrid "+ Add", not a header row. */
      addLabel="+ Add line"
    />
  );

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
   * `Field` track's business, and the row states it once (`QTY_SPAN` below).
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
    /**
     * THE TWO DATES, ADJACENT (client 2026-08-31: "the Delivery Date and
     * Earlier Shipment Date fields must be placed directly next to each other
     * (side-by-side) on the UI").
     *
     * THIS LIST IS WHERE THAT IS DECIDED. `renderMobileRow` draws
     * `[...primary, ...secondary]`, and a column this list does not name falls
     * into `secondary` — so before today Earlier Shipment Dt sat there beside
     * Assortment Type, in `quantityColumns`' declaration order, and the
     * operator read `PO Qty · Delivery Dt · Assortment Type · Earlier Shipment
     * Dt`. The two dates were declared adjacent and rendered apart.
     *
     * ## THE LIST IS NOW EXHAUSTIVE, AND THAT IS THE POINT
     *
     * Every column `quantityColumns` declares is named here, in the order it is
     * read, so `secondary` is empty and this run IS the row. A partial list is
     * what let the layout drift: it expressed "these come first" and left the
     * rest to fall out of an array whose order nothing else depended on, which
     * is precisely why moving cells in that array to fix this would have been a
     * no-op. The overflow branch stays — a column added later and forgotten here
     * still renders, at the end, rather than vanishing.
     *
     * ASSORTMENT TYPE STAYS LEFT OF DETAILS. The Details button is gated on it
     * (`assortGateFor`), and its own note describes it as "two cells to the
     * LEFT of this button" — a refusal whose cause sits to the right of it is a
     * refusal the operator reads before its reason.
     */
    "Delivery Dt",
    "Earlier Shipment Dt",
    "Assortment Type",
    /**
     * "Details", NOT "Assort" — the rename this list was warned about below and
     * did not survive (client 2026-08-17: "Assort" -> "Details").
     *
     * The comment under this array has said since that day that leaving the old
     * name here "would silently drop the button from the narrow set", and that
     * is exactly what it did: `byHeader` matched no column, `.filter(Boolean)`
     * removed it, and Details fell through to `secondary`. It still rendered, at
     * the end, which is why nothing looked broken for a fortnight — a
     * string-keyed list fails by QUIETLY REORDERING, not by throwing.
     *
     * It cost nothing while the list was advisory. It costs the client's
     * instruction now that the list is the layout, which is the argument for
     * making it exhaustive rather than for remembering harder.
     */
    "Details",
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
  /**
   * THE ROW'S COLUMN BUDGET, ON THE 32-COLUMN TRACK (client 2026-08-21, across
   * three reports: "little increase the length of the country field", then
   * "reduce at delivery date and earlier shipment date instead of making
   * consignee field as length", then "that earlier ship field now went below —
   * make it even size, make it a little large, reduce the consignee a little").
   *
   * ## Twelve columns could not hold this row, and that is arithmetic
   *
   * Eight cells, and the content wants Country 2 · Ref No 1 · Consignee 2 ·
   * PO Qty 1 · two dates at 2 · Assortment 2 · Details 1 = THIRTEEN twelfths.
   * Every arrangement inside 12 therefore breaks something, and each attempt
   * broke a different thing: Consignee at one column truncated a company name,
   * and the dates at one column CLIPPED THE YEAR off `dd-mm-yyyy`, which is a
   * control that has stopped working rather than one reading short.
   *
   * `cols={32}` is the sanctioned way out and has precedent in this module
   * (`mba-master-screen.tsx`). It is not a finer grid for its own sake: a date
   * needs ~114px and a twelfth gives 98 while two twelfths give 211, so the
   * granularity — not the space — was the constraint.
   *
   * ## It also fixes the misalignment structurally
   *
   * `FIELD_TRACK_32` carries `items-end`, which `FIELD_TRACK` does not. That is
   * why "Earlier Shipment Dt" dropped its input below the row: a two-line label
   * pushed its control down while every one-line neighbour stayed put. The
   * wider track bottom-aligns every cell box, so the controls line up whatever
   * the labels do — its own note calls this "fixing the wrap rather than
   * forbidding it", which is what keeps the label readable instead of
   * abbreviated.
   *
   * ## What each cell is worth
   *
   * On this track a span of n is roughly n x 29px + (n-1) x 12px of gap:
   * 3 -> ~112px, 4 -> ~153px, 5 -> ~194px, 6 -> ~236px.
   *
   *   Country 5   Ref No 3   Consignee 6   PO Qty 3
   *   Delivery 4   Earlier Shipment 4   Assortment 5   Details 2   = 32
   *
   * THE RUN ABOVE IS `QTY_PRIMARY`'S ORDER, NOT `quantityColumns`', and the two
   * differ — this is the list an operator actually reads left to right, because
   * the grid is `forceCards` and `renderMobileRow` lays the row out from
   * `QTY_PRIMARY` first and whatever it does not name second. Only Earlier
   * Shipment and Assortment swapped on 2026-08-31, to put the two dates side by
   * side; the SPANS are untouched and could not have moved anything on their
   * own, since this map is read by header string rather than by position.
   *
   * Country nearly doubles, both dates clear ~114px with the primitive's own
   * `px-3` restored, and Consignee comes down from 318px to 236px — reduced,
   * as asked, without being starved. Nine cells (Multi Order) balance the same
   * way, so the two layouts agree about how wide a country is.
   *
   * MEASURED, NOT ESTIMATED: the widths above come from pixel-scanning the
   * client's screenshots for the border colour, and the date threshold from
   * rendering `<input type="date">` across widths in Chrome. The EMPTY
   * placeholder is the case that matters — `dd-mm-yyyy` is wider than a filled
   * `21-08-2026`, because the letters are not tabular, and testing only a
   * filled date is what made an earlier attempt at one column look sound.
   */
  const QTY_SPAN: Readonly<Record<string, number>> = form.multi_order
    ? {
        Country: 4,
        "Ref No": 3,
        "PO No": 3,
        Consignee: 5,
        "PO Qty": 3,
        "Delivery Dt": 4,
        "Assortment Type": 4,
        "Earlier Shipment Dt": 4,
        Details: 2,
      }
    : {
        Country: 5,
        "Ref No": 3,
        Consignee: 6,
        "PO Qty": 3,
        "Delivery Dt": 4,
        "Assortment Type": 5,
        "Earlier Shipment Dt": 4,
        Details: 2,
      };
  /**
   * The span classes are WRITTEN OUT, never interpolated — an interpolated
   * class name produces no CSS at all, which `FIELD_TRACK`'s own note warns
   * about, and the failure is a cell that silently falls back to one column.
   *
   * A header this map does not name keeps `Field`'s own size, which is the
   * honest default: a column added later should look wrong in review rather
   * than quietly take a width nobody chose.
   */
  const QTY_SPAN_CLASS: Readonly<Record<number, string>> = {
    2: "@lg/section:col-span-2",
    3: "@lg/section:col-span-3",
    4: "@lg/section:col-span-4",
    5: "@lg/section:col-span-5",
    6: "@lg/section:col-span-6",
  };
  const qtySpanClass = (header: string) => QTY_SPAN_CLASS[QTY_SPAN[header] ?? 0];

  /**
   * NO CELL SETS ITS OWN HEIGHT (client 2026-08-21: "that country one is look
   * something not even with other fields, make even look").
   *
   * Five of these cells carried `className="h-8"` while the three PICKERS
   * beside them carry the primitive's `h-9 @2xl/editor:h-8`. That is a
   * CONTAINER query, and `data-picker.tsx` says in as many words why: "Height
   * and rhythm must match Input/Combobox exactly — these sit in a row with
   * them … a picker inside a ~440px nested panel or on a phone keeps the full
   * 36px touch target." A flat `h-8` opts the input OUT of that query, so
   * anywhere the editor pane is under 42rem the pickers stand 36px and the
   * inputs 32px, in one row, four pixels apart.
   *
   * This is the shape AGENTS.md's "header row" section already names: "a call
   * site patching one property of a control's size is the bug", recorded there
   * against `FilterBar`'s `size="sm" className="h-9"`. The height comes off the
   * call sites and stays where it is declared once.
   */
  const quantityColumns: ChildGridColumn<QuantityRow>[] = [
    {
      header: "Country",
      /* THE HEADER STAR IS UNCONDITIONAL (client 2026-08-31, screenshot 2562:
         "still which field are in option"). It means "this COLUMN is mandatory",
         which is true of every row — it is not a claim that this cell is
         refusing right now. Ctrl+Del is the exit from a row that should not
         have been added; see `lockExisting` in child-grid.tsx. */
      required: true,
      cell: (r) => (
        <CountryPicker
          countries={data.countries}
          value={r.country_id}
          onChange={(id) => setQty(r.key, { country_id: id })}
          canCreate={masterPerms.canCreate}
          canEdit={masterPerms.canEdit}
          /* REQUIRED ONCE THE DESTINATION HAS BEEN STARTED (client 2026-08-31).
             It read `required={false}`. The predicate is the SAME one
             `quantityProblems` gates its Country rule on, so the star, the
             cursor hold and the blocked Save all answer from one test — a cell
             that starred without blocking, or blocked without starring, is the
             divergence the "one declaration" rule exists to make impossible.
             Gated rather than flat because this grid seeds a blank row: an
             unconditional `required` would hold the cursor on the first cell of
             a row the operator has not decided to keep. */
          required
          compact
        />
      ),
    },
    {
      header: "Ref No",
      required: true,
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
          required
          value={r.style_ref_no}
          /* PLAIN `setQty`, deliberately. I briefly routed this through
             `setQuantityStyle` to carry its size-pruning, on the belief that
             this cell held a style reference. It does not — it is FREE TEXT
             since 2026-08-17 — so pruning a style's sizes by it could never
             match anything and only made the wiring look intentional. */
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
                      value={r.po_no}
                onChange={(e) => setQty(r.key, { po_no: e.target.value })}
              />
            ),
          } as ChildGridColumn<QuantityRow>,
        ]
      : []),
    {
      header: "Consignee",
      required: true,
      cell: (r) => (
        <RecordPicker
          label="Consignee"
          compact
          items={consigneeOptions(r.consignee_id).items}
          required
          value={r.consignee_id}
          onChange={(id) => setQty(r.key, { consignee_id: id })}
          /* placeholder-blank: exempt -- names a STATE of the data: this
             customer has no consignee linked, so the list is legitimately
             empty and the box has to say why rather than looking broken.
             Null as soon as there is one, so it never repeats the label.
             (It used to say the opposite — that the FULL list was on offer —
             which is the fallback the client removed on 2026-08-29.) */
          placeholder={consigneeOptions(r.consignee_id).hint ?? undefined}
        />
      ),
    },
    {
      header: "Assortment Type",
      required: true,
      cell: (r) => (
        <LookupDialogPicker
          kind="assortment_type"
          label="Assortment Type"
          options={assortmentTypes}
          required
          value={r.assortment_type_id}
          onChange={(id) => setQty(r.key, { assortment_type_id: id })}
          canCreate={masterPerms.canCreate}
          canEdit={masterPerms.canEdit}
          compact
        />
      ),
    },
    /**
     * PACK TYPE IS NOT A COLUMN HERE (client 2026-08-27: "no need to show it on
     * the quantity tab UI — just inside wiring").
     *
     * It was one for an hour. The link it carries is real and unchanged; what
     * the client rejected is ASKING for it, so the method now RESOLVES itself
     * — see `resolvedPackTypeFor`. The stored column stays and is written with
     * whatever was resolved, so a saved document still records which method its
     * pieces were exploded from; nothing about the explosion moved.
     *
     * A picker here would have been the third place one order states the same
     * fact: Pack type(s) already names the method AND names the style its lines
     * pack, and a destination already names its style. Asking again is asking
     * the operator to keep three answers in agreement.
     */
    {
      header: "PO Qty",
      required: true,
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
       *
       * IT NOW BLOCKS SAVE RATHER THAN ADVISING (client 2026-08-18: "the total
       * quantity in the break-up must exactly match the total order quantity. If
       * they do not match, the system must throw an error and prevent the user
       * from saving"). The DECISION is `assortBalanceOf`, read here and by
       * `quantityProblems`, so the amber line under the cell and the dead Save
       * button always mean the same thing — the two conditions were written out
       * separately for one afternoon and that is one afternoon too long.
       *
       * The swap survives the promotion and is now the FIX rather than a
       * suggestion: the operator is stuck until the two agree, and this is the
       * one-click way to agree when the assortment is the one that is right.
       * Still never automatic — writing the computed total over a typed one
       * discards the figure the buyer actually sent.
       */
      cell: (r) => {
        const computed = assortTotalOf(r);
        const mismatch = !!assortBalanceOf(r);
        return (
          <div className="space-y-1">
            <Input
              className="text-right"
              inputMode="decimal"
              required
              value={r.po_qty}
              onChange={(e) => setQty(r.key, { po_qty: e.target.value })}
            />
            {mismatch && (
              <button
                type="button"
                tabIndex={-1}
                onClick={() => setQty(r.key, { po_qty: String(computed) })}
                className="block w-full text-right text-[11px] leading-tight text-danger hover:underline"
                title="Use the assortment total"
              >
                Assort: {fmtNumber(computed)} — use
              </button>
            )}
          </div>
        );
      },
    },
    /**
     * THE TWO DATES ARE ADJACENT (client 2026-08-31: "the Delivery Date and
     * Earlier Shipment Date fields must be placed directly next to each other
     * (side-by-side) on the UI … Placing these dates together provides
     * immediate visual confirmation of the shipment window").
     *
     * ## THE FIX IS IN `QTY_PRIMARY`, NOT IN THIS ARRAY, and that is the whole
     * trap
     *
     * Reading this file top to bottom says the dates are already adjacent: they
     * are declared one after the other, right here. They were not, and the
     * reason is that THIS ARRAY'S ORDER IS NOT THE RENDERED ORDER. The grid is
     * `forceCards`, so `renderMobileRow` always runs, and it rebuilds the row as
     * `[...primary, ...secondary]` — `primary` being `QTY_PRIMARY` resolved
     * through `byHeader`, `secondary` being everything this array declares that
     * `QTY_PRIMARY` does not name. Assortment Type and Earlier Shipment Dt both
     * fell into `secondary`, in declaration order, so the operator saw
     * `… PO Qty · Delivery Dt · Assortment Type · Earlier Shipment Dt`.
     *
     * So a column's position here decides nothing while `QTY_PRIMARY` exists,
     * and moving cells around in this array to answer a layout complaint is a
     * change that reads as correct, compiles, and does nothing at all. The
     * ordering list is the one place to edit; see its own note.
     *
     * A WINDOW IS A PAIR AND THIS IS WHY IT MUST STAY ONE. `dd-mm-yyyy` beside
     * `dd-mm-yyyy` is a span the operator can check at a glance; the same two
     * boxes with a dropdown between them are two unrelated facts.
     */
    {
      header: "Delivery Dt",
      required: true,
      /**
       * TYPED HERE, SEEDED FROM ORDER INFO. The header's Deli.Dt fills this on
       * a new row and moves it while it is untouched — `setHeaderDeliveryDate`
       * carries the whole rule and why it is not a `touched` flag. Editing it
       * here is what "untouches" it from the header, because after this the row
       * no longer holds what the header last gave.
       *
       * DESTINATIONS GENUINELY DIFFER, which is why this is not read-only even
       * though the client's own worked example shows it auto-filled. One order
       * ships to three countries on three dates; a mirror of the header could
       * not express that, and the same client sentence asks for both fields to
       * stay "fully editable".
       */
      cell: (r) => (
        <Input
          type="date"
          required
          value={r.delivery_date}
          onChange={(e) => setRowDeliveryDate(r, e.target.value)}
        />
      ),
    },
    {
      header: "Earlier Shipment Dt",
      required: true,
      /**
       * D-1 OF THE CELL TO ITS LEFT, until the operator says otherwise. The
       * arithmetic is `dayBefore`; when it applies is `setRowDeliveryDate`.
       *
       * Typing here is the override the client asked for ("adjust the shipment
       * buffer to D-2 or D-3"), and it is remembered by the value itself: once
       * this stops equalling D-1 of the delivery date, moving the delivery date
       * leaves it alone.
       */
      cell: (r) => (
        <Input
          type="date"
          required
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
       * AND ON THIS ROW BEING ASSORTED (`assortGateFor`, client 2026-08-13) — a
       * Solid Colour / Solid Size line has one colour and one size in a carton,
       * so there is no ratio to set. Each refusal names the field that turns it
       * on rather than greying out in silence.
       *
       * THAT GATE IS PER ROW AND READS ONE FIELD — `Assortment Type`, two cells
       * to the LEFT of this button. Until 2026-08-18 it fell back to the ORDER's
       * Pack type(s), so a row could be refused by a toggle in Order Info; that
       * connection is cut. See `assortGateFor` for why two columns still carry
       * the same four words.
       *
       * The count is what makes the tree visible from outside — a destination
       * carrying three assortment lines otherwise looks exactly like one
       * carrying none.
       */
      /**
       * BLOCKED WITH `aria-disabled`, NEVER `disabled` (client 2026-08-17: "check
       * why the assort button is not working").
       *
       * It WAS working — it refuses when nothing here is assorted, which is the
       * `assortGateFor` rule above. What was broken is that it could
       * not SAY SO: a truly `disabled` button stops firing pointer events, so its
       * `title` never surfaces, and both reasons this button withholds itself
       * ("Pick a Ref No first", "Pick an Assortment Type on this row") were
       * written and unreadable. A greyed control with no reason is precisely the failure the
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
        // Per ROW, not per order — the row carries its own Assortment Type, and
        // that is the field sitting two cells to the left of this button.
        const gate = assortGateFor(r);
        const why = !r.style_ref_no.trim()
          ? "Pick a Ref No first"
          : !gate.ok
            ? (gate.why ?? "")
            : "";
        const blocked = !!why;
        return (
          <Tooltip label={why || "Open assortment details"} touch={blocked}>
            <Button
              type="button"
              variant="outline"
              size="sm"
              /* A CELL OF THE ROW (client 2026-08-19) — same as Combos ▸ Detail,
                 and it matters MORE here: this button is `aria-disabled` rather
                 than `disabled` precisely so it stays focusable and can say why
                 it is withholding itself. Off the keyboard axis, that reason was
                 reachable only by hovering a mouse. */
              data-row-open
              aria-disabled={blocked || undefined}
              aria-label={blocked ? `Details — ${why}` : "Details"}
              className={blocked ? "cursor-not-allowed opacity-50" : undefined}
              onClick={blocked ? undefined : () => openAssort(r.key)}
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
  /**
   * `approvalQtyColumns` AND `approvalRowsOf` STOOD HERE AND WENT WITH THE
   * PER-SIZE GRID (client 2026-08-21).
   *
   * Six columns — Size · Qty · Excess · Approval Qty · Rejection · Total
   * Production — rendered once per COLOUR, one row per size. The tab drew 126
   * figures for three colours over seven sizes and 21 of them were typed; worse,
   * those 21 were the same answer written six times per colour, which is what
   * the legacy data shows (`2, 2, 2, 2, 2, 2`, screenshot 2443).
   *
   * `ApprovalQtyLines` asks per colour instead and opens the sizes as a strip
   * when they have to differ. WHAT THOSE COLUMNS RECORDED IS KEPT and still
   * holds:
   *
   * - Every figure but Approval Qty is DERIVED and is rendered as bare text,
   *   never a boxed input — "what the row needed was for its ONE input to look
   *   unlike the five figures around it". The component draws exactly one box
   *   per colour for the same reason.
   * - Excess is computed PER SIZE and summed, never once on a colour's total:
   *   the client's spec says "for each size and color", and `excessQty`'s own
   *   note carries the worked example where the two answers differ. That is why
   *   the component takes a `derive(qty, approval)` function rather than
   *   pre-totalled figures.
   * - Rejection answers NULL, never 0, when no rule is chosen or the quantity
   *   falls between tiers — a dash the operator can act on, not a number.
   * - Approval Qty is NOT `required`: zero is an answer.
   */

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

  /* Resolved ONCE for the whole overlay, so the header band, the carton fields,
     the grid's columns, the arithmetic and the footer totals cannot each reach a
     different answer. `?? "solid"` never fires in practice — the Details button
     refuses a row with no type — but the sheet renders from state, and a default
     that asks for LESS is the safe one to be wrong with. */
  const assortMode: AssortMode =
    (assortQty && assortModeOf(assortQty)) ?? "solid";

  /**
   * THE IDENTITY BAND IS GONE — trimmed from six fields to two on 2026-08-18,
   * and to nothing on 2026-08-19 ("remove that country to no carton in that
   * header, remove, only hold single style and multiple style").
   *
   * The two survivors are still on screen without costing a field box each:
   * ASSORTMENT TYPE went into the sheet's TITLE, and ORDER QTY was already in
   * the footer totals beside the Total Qty it has to match.
   *
   * THE STYLE PAIR CAME BACK HERE FOR ONE DAY AND HAS MOVED INTO THE GRID
   * (client 2026-08-19, screenshots 2368-2370: "those style ref and style both
   * in header — move it to the like multiple style format ... inside table we
   * can move the fields").
   *
   * They were put in the header because on a Single Style pack the style is ONE
   * answer, and a column repeating it on every line looked like a column that
   * could never say anything. That reasoning was about the DATA and the client's
   * objection is about the FORM: two modes of one screen were asking the same
   * question in two different places, so the operator's eye had to move for a
   * field that had not changed meaning. Legacy settles it — screenshot 2356
   * prints StyleRefNo on every row of a single-style pack too.
   *
   * So the columns are now unconditional and it is the BINDING that switches:
   * Single Style writes the destination, Multiple Style writes the line. See
   * `assortColumns`.
   */
  const assortScope = (q: QuantityRow, mode: AssortMode) => (
    <FieldRow>
      {/* `label=""` RESERVES the label row so the switch sits on the same
          baseline as the field beside it. The spacer goes through the real
          `Label`, so it carries that component's own metrics — a hand-built one
          would be a second copy of them. */}
      <Field label="">
        <Segmented
          // Unique per destination — radios group by `name` across the DOCUMENT,
          // and one sheet is open at a time, but the key costs nothing and makes
          // the rule impossible to break by rendering two.
          name={`assort-scope-${q.key}`}
          value={q.is_single_style_pack ? "single" : "multi"}
          onChange={(v) => setAssortScope(q.key, v === "single")}
          options={[
            { value: "single", label: "Single Style" },
            { value: "multi", label: "Multiple Style" },
          ]}
        />
      </Field>
      {/* ONLY WHEN THE ORDER LEAVES A CHOICE (client 2026-08-28). One candidate
          resolves itself and the field never appears — 0473's "no need to show
          it on the quantity tab UI" holds for every ordinary order. Two or more
          and the destination has to say, because the alternative is the silent
          fallback to typed piece counts that this replaced.

          IT LIVES HERE RATHER THAN IN THE QUANTITIES ROW because this is where
          the packing questions are asked — beside Ratio For, on the surface the
          operator opens to work on the destination. The row itself is already
          ten columns wide.

          `enterPackLayout` ON CHANGE, not merely a `setQty`. Pack layout is
          entered when the overlay OPENS and from nowhere else, so a method
          chosen after opening would set the column and leave the grid in the
          shape it was drawn in — the boxes row absent on a destination that
          now has a method. */}
      {/* NOT `required`. The star holds the cursor, and AGENTS.md's test for the
          word is "must the record be unsaveable without it?" — nothing deadens
          Save on this, and a destination that names no method is a legitimate
          state: it ships on ordinary typed piece counts. The field APPEARING at
          all is the signal; a star would be one with nothing behind it. */}
      {packTypeCandidatesFor(q).length > 1 && (
        <Field label="Pack Type" w="term">
          <Select
            value={q.pack_type}
            onChange={(e) => {
              const v = e.target.value;
              setQty(q.key, { pack_type: v });
              const next = { ...q, pack_type: v };
              if (v) enterPackLayout(next);
            }}
          >
            <option value=""></option>
            {packTypeCandidatesFor(q).map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </Select>
        </Field>
      )}
      {/* The last survivor of the carton block below, which the client emptied
          on 2026-08-19. A `FieldRow` sizes by CONTENT rather than by a twelfth
          of the row, so a two-option Select can sit here at its own width —
          which is exactly why it could not stay where it was. */}
      {mode === "assort" && (
        <Field label="Ratio For" w="term">
          {/* 0328's tuple, and the column carries the same CHECK — so a
              free-text box here would fail on save rather than on entry. */}
          <Select
            value={q.ratio_for}
            onChange={(e) => setQty(q.key, { ratio_for: e.target.value })}
          >
            <option value=""></option>
            <option value="master">Master</option>
            <option value="inner">Inner</option>
          </Select>
        </Field>
      )}
    </FieldRow>
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
  /**
   * THE COLUMNS ARE THE MODE'S, and this is the second thing about this grid
   * that comes from data rather than from a literal (client 2026-08-18).
   *
   * A SOLID PACK IS FOUR COLUMNS SHORTER. It has no carton count — "the total
   * number of cartons is unknown at the time of order entry because the capacity
   * of a box varies by garment size" — so it has no inners either, and with the
   * size cells being the pieces themselves, PcsPerPack would print the same
   * figure as Qty in the column beside it. Rendering them disabled instead would
   * be four boxes the operator must learn to ignore on the screen the same
   * request calls cluttered.
   *
   * BUILT BY OMISSION, not by a second array: the shared columns are declared
   * once and the ratio-only ones spliced in, so a change to the Combo cell or a
   * size cell cannot reach one mode and miss the other.
   */
  /* `assortColumns` and `assortCellWidth` REMOVED 2026-08-20 with the carded
     grid they fed. The matrix in `assortGrid` below builds its own header band
     and its own cells, and everything those two carried that still matters --
     the StyleRefNo/Combo comboboxes and their scoping, the size-cell lock under
     Multiple Style, Pcs/Pack, the row Qty -- moved there with its reasoning.

     Deleted rather than left standing: a dead column table beside a live grid is
     the thing a later reader edits to change the grid, and nothing would happen. */

  /**
   * THE EMPTY-STATE PROSE IS GONE (client 2026-08-19, with the mode explainer
   * in the overlay below: "remove this sentence").
   *
   * It used to say "This style lists no sizes, so there are no size columns to
   * fill. Add them on Order Info ▸ Styles Details ▸ Sizes." That is the one
   * shape the de-clutter rule lists as a legitimate survivor — an empty state
   * naming a CAUSE elsewhere — so this is the client overriding a written rule,
   * not an application of it, and it is worth saying which.
   *
   * WHAT IS LOST, PLAINLY: with no sizes the grid now draws Combo and Qty and
   * nothing accounts for the missing columns. An operator who has not entered
   * the style's sizes sees a grid that looks broken rather than one that says
   * what to do. That was the argument for the sentence and it is unchanged; the
   * client has read it on screen and does not want it. Restoring it needs a new
   * instruction, not a tidy-up.
   */
  /**
   * A SIZE COLUMN IS AS WIDE AS THE SIZE IT NAMES — the size CHIP's own rule
   * (`multi-select.tsx`: CELL_CH_MIN 3, CELL_CH_MAX 6, CELL_CHROME 1.15rem),
   * reused rather than re-derived (client 2026-08-20, the LETTER chip row).
   *
   * A FLAT WIDTH IS THE MISTAKE, whichever value it takes: it has to be right
   * for the WIDEST label, so every short one wastes the difference. 72px suits
   * "12-18M" and spends 30px of nothing on "S"; 42px suits "S" and crushes
   * "12-18M". Sized per label, seventeen kidswear sizes come to ~800px instead
   * of ~1,220.
   */
  /**
   * A SIZE COLUMN IS SIZED FOR WHAT IS IN IT, NOT FOR ITS TITLE (client
   * 2026-08-20: "make those size as breathable dynamically, it's this stack
   * size in assortment").
   *
   * It measured the LABEL only — `XS` floored to 3 characters gave 42px — while
   * the cell holds a full `<Input>`, whose `px-3` padding and border take ~26px
   * of that before a digit is drawn. So a column titled with a short size and
   * filled with a two-digit quantity had about 16px for the number, and the
   * value crushed against the box.
   *
   * Both inputs now count: the header must fit its size name AND the cell must
   * fit its largest quantity. `digits` is measured from the DATA in that column
   * (including its total), so a run of 2s stays tight and a column holding 1200
   * opens up on its own — which is what "dynamically" asks for.
   *
   * 26px of chrome, not 18.4: that figure was calibrated when the cell was a
   * bare figure. An `<Input>` is a different container and needs its own.
   */
  const sizeColPx = (label: string, digits: number) =>
    Math.round(
      Math.max(
        Math.min(6, Math.max(2, label.length)),
        Math.min(7, Math.max(2, digits)),
      ) * 7.8 + 26,
    );

  /** Identity (ref + combo, with the style name under them) and the row total. */
  const ASSORT_ID_W = 340;
  const ASSORT_QTY_W = 88;

  /**
   * THE ASSORTMENTS MATRIX (client 2026-08-20: a size group is "minimum 17
   * size", "think screen length").
   *
   * ## WHAT THIS REPLACES, AND WHY IT HAD TO GO
   *
   * It was `ChildGrid` `forceCards` with a `renderMobileRow` that emitted a
   * `FieldRow` — so it was never a matrix at all. Every cell carried its OWN
   * label, which meant:
   *
   *   - each size label was drawn once per LINE, not once per grid — 17 sizes
   *     across 3 lines is 51 labels for 17 facts;
   *   - `FieldRow` wraps, so one line became three or four visual rows, and
   *     THAT is the screen length that was reported;
   *   - and nothing aligned between lines, because a wrapping flex row has no
   *     column positions. Same failure as the Combos spec row, three times the
   *     scale.
   *
   * ## WHY IT IS HAND-ROLLED
   *
   * `ChildGrid` has no sticky column, no spacer track and no per-column width
   * computed from the data — and this grid needs all three. The four DOM
   * markers are the whole contract with the keyboard (`componentGrid` and
   * `sizeGrid` are hand-rolled on the same terms): `data-grid-body` carries
   * `gridKeyNav` on the SAME element it reads `currentTarget` from,
   * `data-grid-row` bounds a row, `data-row-remove` is what Ctrl+Del drives,
   * and `data-row-add` is what Enter off the last cell steers to.
   *
   * A ROW IS `display: contents`. The cells have to be children of the ONE grid
   * that owns the column track, or two lines could size their columns
   * differently — which is the whole bug. `contents` keeps the row element in
   * the DOM for the marker and lets its cells participate in the parent grid.
   * The consequence is that a row cannot draw its own border, so the hairline
   * goes on the CELLS.
   *
   * ## THE TRACK
   *
   * Identity and Qty are fixed; the size columns are fixed at their chip width;
   * a SPACER between them takes the slack. Nothing is `1fr` except that spacer,
   * and that is deliberate — `minmax(w, 1fr)` on the size columns blew a
   * six-size group's cells up to ~200px each to fill the pane, and combined with
   * a `max-content` grid it also produced a scrollbar at six sizes with the
   * first column clipped under the sticky identity (client screenshot 2411).
   * One rule owns the axis.
   *
   * Inline `style`, not a class: the template is computed from the data, and
   * Tailwind cannot see a class it never found in the source.
   */
  const assortGrid = (q: QuantityRow, mode: AssortMode) => {
    const assort = mode === "assort";
    /* INNERS IS ONLY A QUESTION WHEN THE RATIO FILLS AN INNER (`ratioScopeOf`).
       On a Master-ratio pack the ratio IS the carton and there are no
       sub-bundles, so a box asking how many of them fit is a box whose only
       possible use is to make the answer wrong — the arithmetic ignores it, and
       a field that changes nothing while looking like it should is worse than
       one that is absent. Hidden rather than disabled: a disabled control still
       costs a column on a grid whose width is already the whole problem. */
    const innerScope = ratioScopeOf(q) === "inner";
    const sizes = sizesForOverlay(q).filter((z) => z.size_id);
    /* THIS DESTINATION IS PACKED TO A DECLARED METHOD (0473) — the size cells
       on the `is_pack_row` line are BOXES and every colourway row beneath it is
       derived from them. Computed once for the grid rather than per cell: it
       decides what the header says, which cells are editable and what the row
       label reads, and three answers to one question is how they drift. */
    const packMode = packModeOf(q);
    /* THE METHOD'S STYLES, resolved once beside `packMode` for the same reason:
       the row label reads it per row, and three answers to one question is how
       they drift. */
    const packMemberStyles = PackExplode.packStyles(
      allPackTypeLines,
      resolvedPackTypeFor(q),
    );

    /**
     * The widest number this column has to hold — every line's entry, and the
     * column total under them. Measured, not assumed, so the track breathes with
     * the data instead of with the size name.
     *
     * The total is included because it sits in the same column: a column of 9s
     * summing to 108 needs room for three digits somewhere, and the totals band
     * is where that happens.
     */
    const sizeDigits = (sizeId: string) => {
      const entries = q.assort_lines.map(
        (l) => String(assortSizeQty(l, sizeId) ?? "").trim().length,
      );
      const total = String(
        q.assort_lines.reduce(
          (a, l) => a + (Number(assortSizeQty(l, sizeId)) || 0),
          0,
        ),
      ).length;
      return Math.max(2, total, ...entries);
    };

    const track = [
      ASSORT_ID_W + "px",
      ...(assort ? ["4.5rem"] : []),
      ...(assort && innerScope ? ["4.5rem"] : []),
      ...sizes.map(
        (z) =>
          sizeColPx(sizeLabel(z.size_id) || "-", sizeDigits(z.size_id!)) + "px",
      ),
      ...(assort ? ["4.5rem"] : []),
      "minmax(12px,1fr)",
      ASSORT_QTY_W + "px",
    ].join(" ");

    /* One shared class per band, so a cell added to the header and forgotten in
       the body cannot drift: both read the same string. */
    const HEAD =
      "sticky top-0 z-20 flex min-h-8 items-center justify-center border-b " +
      "border-border-strong bg-surface-muted px-1 text-[10.5px] font-semibold " +
      "uppercase tracking-wide text-muted-foreground";
    const CELL =
      "flex min-h-9 items-center justify-center border-b border-border px-0.5";
    const FOOT =
      "sticky bottom-0 z-20 flex min-h-9 items-center justify-center border-t " +
      "border-border-strong bg-surface-muted px-1 text-xs font-bold tabular-nums";

    /* PIECES ONLY (0473) — the boxes row shares this column and its figure is
       a different unit. Summed in, a size ordering 100 boxes of a 4-piece pack
       would foot as 500 against 400 real garments, and the column that is meant
       to prove the arithmetic would be the one hiding it. */
    const sizeTotal = (sizeId: string) =>
      pieceLinesOf(q).reduce(
        (a, l) => a + (Number(assortSizeQty(l, sizeId)) || 0),
        0,
      );

    return (
      <div className="space-y-2">
        <div className="overflow-x-auto rounded-lg border border-border">
          <div
            data-grid-body
            className="grid w-full"
            style={{ gridTemplateColumns: track }}
            onKeyDown={(e) => gridKeyNav(e)}
          >
            {/* ---- header ---- */}
            <div className={HEAD + " sticky left-0 z-30 justify-start pl-3"}>
              Style / Combo
            </div>
            {assort && <div className={HEAD}>Ctns</div>}
            {assort && innerScope && <div className={HEAD}>Inners</div>}
            {sizes.map((z) => (
              /* THE SAME TOKEN THE SIZE PICKER DRAWS — mono, tabular, bordered.
                 The size the operator ticked over there is visibly the size they
                 are filling in here. */
              <div key={z.size_id} className={HEAD}>
                <span className="rounded border border-border bg-surface px-1.5 py-px font-mono text-[13px] font-medium normal-case tracking-normal tabular-nums text-foreground">
                  {sizeLabel(z.size_id) || "-"}
                </span>
              </div>
            ))}
            {assort && <div className={HEAD}>Pcs/Pack</div>}
            <div className={HEAD} />
            <div className={HEAD + " sticky right-0 z-30 justify-end pr-3"}>Qty</div>

            {/* ---- one row per assortment line ----
                UNDER A PACK TYPE ONLY THE BOXES ROW IS DRAWN (client
                2026-08-28: "this no need in ui remove it").

                The derived (style, colourway) rows are still COMPUTED and still
                SAVED — `explodePackLines` runs on every keystroke and
                `toPayload` writes what it produced. Only the drawing stops.
                That distinction is the whole of this change and must not be
                "tidied" into dropping the lines: 0473 exists because Material
                BOM, Fabric BOM, cutting and costing all read plain piece counts
                and none of them knows what a pack is, so a destination that
                stored no pieces buys cloth for nothing. Hiding is not emptying.

                NOTHING ON SCREEN LOSES ITS VALUE EITHER, because every figure is
                derived from the lines rather than from the rows drawn:
                `sizeTotal` and `assortTotalOf` both read `pieceLinesOf`, and
                `sizesForOverlay` takes its columns from the lines' styles. The
                per-size totals under the grid therefore still show exploded
                PIECES while the row above them takes BOXES — which is now the
                whole surface: boxes in, pieces out.

                This reverses the client's own first statement of the feature
                ("the UI should immediately render a read-only matrix below
                showing the calculated final piece counts"). The later
                instruction wins; recorded so it is not "fixed" back. */}
            {(packMode
              ? q.assort_lines.filter((l) => l.is_pack_row)
              : q.assort_lines
            ).map((l) => {
              /* THE STYLE, from the Style(s) section — never the destination's
                 free-text Ref No. See `assortLineRef`. */
              const ref = assortLineRef(q, l);
              const scoped = comboOptionsForStyle(assortLineRef(q, l));
              return (
                <div key={l.key} data-grid-row className="contents">
                  <div
                    className={
                      CELL +
                      " sticky left-0 z-10 flex-col items-stretch justify-center gap-1 border-r bg-surface px-3 py-1.5"
                    }
                  >
                    <div className="flex items-center gap-1.5">
                      {/**
                        * SINGLE STYLE ASKS NOTHING — IT SHOWS (client 2026-08-20:
                        * "it's listing those qty tab reference number also in
                        * style fields, but need to show only style ref number
                        * only").
                        *
                        * Under Single Style the style is a property of the
                        * QUANTITIES ROW, not of the line — `ref` above already
                        * reads `q.style_ref_no`, and the control wrote back
                        * through `setQuantityStyle`. So the dropdown was
                        * offering a choice that had already been made on the
                        * grid behind this sheet, and offering it once per line:
                        * three assortment lines drew three pickers for one fact,
                        * all of which had to agree.
                        *
                        * Under MULTIPLE STYLE it stays a real picker, because
                        * there the style genuinely is per line (0433) and
                        * packing two styles into one destination is the whole
                        * point of the mode.
                        *
                        * Read-only text, not a disabled input: a greyed box says
                        * "you may not answer this", and the truth is that it is
                        * not a question. Nothing focusable, so it also leaves the
                        * grid's arrow path — which is right, since there is
                        * nothing here to edit.
                        */}
                      {/* READ-ONLY ONLY WHEN THERE IS GENUINELY NOTHING TO
                          CHOOSE — the order declares exactly one style, so the
                          line packs that one and asking is noise.

                          The earlier version keyed this on `is_single_style_pack`
                          and showed `q.style_ref_no`, which is the destination's
                          free-text Ref No and not a style at all (screenshot
                          2418: it displayed "12"). Single Style says the
                          DESTINATION packs one style; it does not say the ORDER
                          has only one to offer, and those are different claims.
                          With two styles declared, Single Style still has a
                          choice to make and must keep its picker. */}
                      {soleStyleRef ? (
                        <div className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">
                            {soleStyleRef}
                          </span>
                        </div>
                      ) : (
                        <div className="min-w-0 flex-1">
                          <Combobox
                            options={withHeldOption(styleRefOptions, ref)}
                            value={ref}
                            onChange={(v) =>
                              setAssortLineStyle(q.key, l.key, v.toUpperCase())
                            }
                            /* placeholder-blank: exempt -- the ORDER's state, not
                               a hint: with no styles entered there is nothing this
                               box can offer, and saying so points at the grid that
                               fixes it. */
                            placeholder={
                              styleRefOptions.length
                                ? undefined
                                : "Enter a style on Order Info first"
                            }
                            clearable
                          />
                        </div>
                      )}
                      {/**
                        * UNDER A PACK TYPE THE COLOURWAY IS NOT A CHOICE (0473).
                        *
                        * The boxes row names the METHOD, and every row beneath
                        * it names a colourway the method's own composition
                        * declares — so both are stated, not picked. A live
                        * Combobox here would offer the operator a colourway the
                        * pack does not contain, and accepting it would produce
                        * a row the next box-count keystroke silently deletes.
                        *
                        * `x N/pack` IS THE MULTIPLIER MADE VISIBLE. Without it
                        * a BLACK row reading twice its neighbours looks like a
                        * typo rather than the 2-per-pack it is — the figure
                        * that explains the row has to be beside the row.
                        *
                        * The remove button goes with them: a derived row cannot
                        * be removed, only the method can be changed. The boxes
                        * row keeps its own, because dropping the method's line
                        * is how a destination leaves pack layout.
                        */}
                      {packMode ? (
                        <div className="min-w-0 flex-1">
                          {l.is_pack_row ? (
                            <span className="block truncate text-sm font-semibold">
                              PACKS
                              <span className="ml-1.5 font-normal text-muted-foreground">
                                {resolvedPackTypeFor(q)}
                              </span>
                            </span>
                          ) : (
                            <span className="block truncate text-sm">
                              {/* THE STYLE, ONLY WHEN THE PACK HAS SEVERAL
                                  (2026-08-28). Two styles in one box may both
                                  declare a WHITE, and two rows reading "WHITE
                                  x1/pack" with different figures beside them is
                                  a table the operator cannot check. Suppressed
                                  on a single-style pack, where it would repeat
                                  one answer down every row — the objection the
                                  client made to the header Style pair. */}
                              {packMemberStyles.length > 1 && ref ? (
                                <span className="mr-1.5 text-xs text-muted-foreground">
                                  {ref}
                                </span>
                              ) : null}
                              {l.combo}
                              <span className="ml-1.5 text-xs text-muted-foreground tabular-nums">
                                {"×"}
                                {fmtNumber(
                                  PackExplode.piecesOfComboPerPack(
                                    allPackTypeLines,
                                    resolvedPackTypeFor(q),
                                    ref,
                                    l.combo,
                                  ) ?? 0,
                                )}
                                /pack
                              </span>
                            </span>
                          )}
                        </div>
                      ) : (
                        <div className="min-w-0 flex-1">
                          <Combobox
                            options={withHeldOption(
                              scoped.length
                                ? scoped.map((c) => ({ value: c, label: c }))
                                : declaredComboOptions,
                              l.combo,
                            )}
                            value={l.combo}
                            onChange={(v) =>
                              patchAssort(q.key, l.key, { combo: v.toUpperCase() })
                            }
                            clearable
                          />
                        </div>
                      )}
                      {packMode && !l.is_pack_row ? null : (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          data-row-remove
                          className="shrink-0 text-muted-foreground hover:text-danger"
                          onClick={() =>
                            mutAssort(q.key, (ls) =>
                              ls.filter((x) => x.key !== l.key),
                            )
                          }
                          aria-label="Remove assortment line"
                        >
                          <Trash2 className="h-4 w-4 shrink-0" />
                        </Button>
                      )}
                    </div>
                    {/* THE STYLE NAME SURVIVES AS A LINE, NOT A 288px COLUMN.
                        The client asked for the ref/name PAIR on 2026-08-19 and
                        that is honoured — but a derived echo never earned a
                        column of its own, and the 288px it held is four size
                        columns. Blank when the ref names no style on this order,
                        which is the one signal that says so. */}
                    <Truncated className="text-[10px] leading-tight text-border-strong">
                      {styleNameForRef(ref)}
                    </Truncated>
                  </div>

                  {assort && (
                    <div className={CELL}>
                      <Input
                        type="number"
                        className="h-8 text-right"
                        value={l.no_of_cartons}
                        onChange={(e) =>
                          patchAssort(q.key, l.key, { no_of_cartons: e.target.value })
                        }
                      />
                    </div>
                  )}
                  {assort && innerScope && (
                    <div className={CELL}>
                      <Input
                        type="number"
                        className="h-8 text-right"
                        value={l.inners_per_carton}
                        onChange={(e) =>
                          patchAssort(q.key, l.key, {
                            inners_per_carton: e.target.value,
                          })
                        }
                      />
                    </div>
                  )}

                  {sizes.map((z) => {
                    /* A COLUMN THE WHOLE GRID HAS IS NOT A CELL EVERY LINE HAS
                       (0433). Under Multiple Style the columns are the union
                       across the styles in play, so a line packing a style whose
                       sizes stop at 3 YEARS still gets a 4 YEARS column —
                       belonging to the line beneath it. LOCKED, not hidden: a
                       cell has to occupy its column or the row stops lining up
                       with the header. Blank, never a dash. */
                    const usable = lineHasSize(q, l, z.size_id!);
                    /* A COLOURWAY ROW UNDER A PACK TYPE IS DERIVED (0473) — its
                       pieces are the boxes above times the composition, so the
                       cell is READ-ONLY. Typing here would be a second answer
                       to a question the boxes row has already answered, and the
                       next keystroke on the boxes row would silently discard
                       it. The boxes row itself stays fully editable. */
                    const derived = packMode && !l.is_pack_row;
                    return (
                      <div key={z.size_id} className={CELL}>
                        <Input
                          type="number"
                          readOnly={!usable || derived}
                          inputMode="decimal"
                          className={
                            "h-8 px-1.5 text-right font-mono text-[13px] tabular-nums" +
                            (derived ? " border-transparent bg-transparent" : "")
                          }
                          value={usable ? assortSizeQty(l, z.size_id!) : ""}
                          onChange={(e) =>
                            setAssortSize(q.key, l.key, z.size_id!, e.target.value)
                          }
                        />
                      </div>
                    );
                  })}

                  {assort && (
                    <div className={CELL}>
                      {/* Ratio Total under its legacy name — the pieces in one
                          INNER. Read-only and column-less in the database for
                          the same reason Gsm Range is. */}
                      <span className="block w-full text-right text-sm tabular-nums text-muted-foreground">
                        {fmtNumber(ratioTotalOf(l))}
                      </span>
                    </div>
                  )}
                  <div className={CELL} />
                  {/* A LINE IS MARKED ONLY WHEN IT ALONE EXCEEDS THE ORDER QTY.
                      That is the one thing about a single line that can be said
                      truthfully: two lines of 8 on a 12-piece order are over
                      TOGETHER and neither is wrong by itself, so neither is
                      flagged and the total below does the talking. A rule that
                      marked every line whenever the sum was over would point at
                      rows that are individually fine. */}
                  <div
                    className={
                      CELL +
                      " sticky right-0 z-10 justify-end border-l bg-surface pr-3 text-sm font-semibold tabular-nums" +
                      (lineQtyOf(q, l, mode) > (Number(q.po_qty) || 0)
                        ? " text-danger"
                        : "")
                    }
                  >
                    {fmtNumber(lineQtyOf(q, l, mode))}
                  </div>
                </div>
              );
            })}

            {/* ---- per-size totals ----
                THE FIGURE THE BUYER'S SHEET STATES. The grid summed a LINE and
                never a SIZE, so the one number an operator checks their entry
                against had to be added up by eye down a column. */}
            <div
              className={
                FOOT +
                " sticky left-0 z-30 justify-start pl-3 text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground"
              }
            >
              Total
            </div>
            {assort && <div className={FOOT} />}
            {assort && innerScope && <div className={FOOT} />}
            {sizes.map((z) => (
              <div key={z.size_id} className={FOOT}>
                {fmtNumber(sizeTotal(z.size_id!))}
              </div>
            ))}
            {assort && <div className={FOOT} />}
            <div className={FOOT} />
            {/* THE SUM IS WHAT IS WRONG, SO THE SUM IS WHAT REDDENS (client
                2026-08-20: "the qty field need to match with [the] quantity
                section's qty field … now it's allowing much data").

                This figure IS the number being complained about, so colouring it
                makes the complaint point at itself. Nothing else in the matrix
                changes: "over" is a property of the TOTAL, and reddening the cell
                the operator happened to type in would blame an arbitrary square —
                and send them to fix that box when the right answer may be to
                reduce a different line entirely. */}
            <div
              className={
                FOOT +
                " sticky right-0 z-30 justify-end pr-3 " +
                (assortBalanceOf(q) === null || assortBalanceOf(q) === 0
                  ? "text-primary"
                  : "text-danger")
              }
            >
              {fmtNumber(assortTotalOf(q))}
            </div>
          </div>
        </div>

        {/**
         * THE BUDGET, WHERE THE MONEY IS BEING SPENT (client 2026-08-20: "the
         * quantity field need[s] to match with [the] quantity section's qty
         * field … now it's allowing much data also").
         *
         * THE RULE WAS NEVER MISSING. `assortBalanceOf` already computes it,
         * the sheet footer already reddens on it, and `quantityProblems`
         * already blocks Save with it — the client's own 2026-08-18
         * instruction, honoured. What was missing is PROXIMITY: the operator
         * types in a matrix at the top of the sheet and the only reaction is at
         * the bottom, outside the bordered grid they are looking at. Nothing
         * near the caret moved, so the app read as accepting anything.
         *
         * ALWAYS ON, NOT ONLY WHEN WRONG. "Remaining" is the number an operator
         * needs while typing, and a figure that appears only after a mistake
         * cannot prevent one. This is the difference between a warning and a
         * budget.
         *
         * NO CAP ON THE CELL, deliberately, and it is the repo's standing line —
         * `keyFills`, the colour cell that takes free text: guided, never caged.
         * Correcting an existing 120 down to 12 has to pass through 1 and 12; a
         * box that refuses those keystrokes fights the edit and reads as broken,
         * and clamping on blur silently rewrites a number the operator typed.
         * Save still refuses, so nothing wrong can be stored.
         *
         * NULL BALANCE IS NOT ZERO. `assortBalanceOf` answers null while the
         * breakup adds to nothing — 0414's rule that "a line with no ratio rows
         * is not disagreeing with anything, it simply has not been filled in".
         * So an untouched breakup shows the target and says nothing is allocated
         * yet, rather than announcing a shortfall against work not started.
         */}
        {(() => {
          const allocated = assortTotalOf(q);
          const target = Number(q.po_qty) || 0;
          const remaining = target - allocated;
          const over = allocated > target;
          return (
            <p
              className={
                "mt-2 rounded-md border px-3 py-1.5 text-xs tabular-nums " +
                (over
                  ? "border-danger/40 bg-danger/10 font-semibold text-danger"
                  : "border-border bg-surface-muted text-muted-foreground")
              }
            >
              {fmtNumber(allocated)} of {fmtNumber(target)} allocated
              <span aria-hidden className="px-1.5 opacity-40">
                ·
              </span>
              {over
                ? `${fmtNumber(allocated - target)} over`
                : `${fmtNumber(remaining)} remaining`}
            </p>
          );
        })()}

        {/* NOTHING TO ADD UNDER A PACK TYPE (0473): the colourway rows ARE the
            method's composition, so a hand-added line would be a colourway the
            pack does not contain and the next box-count keystroke would delete
            it. The way to change what a destination ships is the method — or
            the method's own lines, one section back.

            The button is REMOVED rather than disabled, and that is the rule
            this document already follows for the carton cells on a solid pack:
            "a disabled box still costs a row on a screen called cluttered". It
            also keeps `data-row-add` off a control Enter would steer to and
            then find inert. */}
        {packModeOf(q) ? (
          <p className="mt-3 text-xs text-muted-foreground">
            The colourway rows come from <strong>{resolvedPackTypeFor(q)}</strong> on Pack
            type(s). Type box counts on the PACKS row; change what a box holds by
            editing that method.
          </p>
        ) : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            data-row-add
            className="mt-3"
            onClick={() => addAssortLine(q.key)}
          >
            + Add assortment
          </Button>
        )}
      </div>
    );
  };

  /** The read-only identity band across the top — carried in, never typed. */
  /** The Styles-tab line a child row names, by the module's join key. `styleKey`
   *  and never `===`, for the reason `sizesOfQuantity` gives: rows saved before
   *  the CAPITALS rule are not upper-cased. */
  const styleLineOf = (refNo: string) =>
    styles.find((x) => styleKey(x.style_ref_no) === styleKey(refNo)) ?? null;

  /**
   * THE IDENTITY IS A LINE OF TEXT, NOT FIVE BOXES (client 2026-08-20:
   * "make more clean").
   *
   * Style Ref No, Style No, Article No, Style Description and Combo were five
   * read-only `Input`s across the top of the overlay. Every one is CARRIED IN —
   * none can be typed into — and on the reported screen four of the five were
   * empty, so the first thing the operator met was a row of boxes that looked
   * like work and was not.
   *
   * As text they still say everything they said, in a tenth of the height. The
   * Combo is not repeated here: the Sheet's own title already names it.
   *
   * `Style Description` IS STILL DERIVED FROM THE STYLE LINE and never stored
   * on the combo — the reasoning that stood on the old field holds unchanged.
   * Blank when the line has since been removed from the Styles tab, which is
   * honest: nothing on this order says what that style was.
   */
  const detailHeader = (r: ComboRow) => {
    const bits = [
      r.style_ref_no.trim(),
      r.style.trim(),
      r.article_no.trim(),
      styleLineOf(r.style_ref_no)?.style_description?.trim(),
    ].filter(Boolean);
    // Nothing carried in at all — a combo naming no style. An empty line would
    // reserve height to say nothing, so it draws no row.
    if (!bits.length) return null;
    return (
      <p className="text-xs text-muted-foreground">
        {bits.map((b, i) => (
          <Fragment key={i}>
            {i > 0 && <span className="px-1.5 text-border-strong">/</span>}
            <span className="text-foreground">{b}</span>
          </Fragment>
        ))}
      </p>
    );
  };

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
  /**
   * ONE WIDTH FOR "+ Add component" AND "+ Add structure" (client 2026-08-18:
   * "update the add component button size same as add structure size").
   *
   * They were already the same CONTROL — both `variant="outline" size="sm"`, so
   * both `h-8 px-3 text-xs`. Two things made them read as different sizes and
   * only one of them was width: the component button sat inside the structure's
   * card, so its 10px of padding indented it from the structure button below,
   * and content-width buttons whose labels differ (component vs structure, same
   * 15 characters, different letters) differ by a few px on top. Removing the
   * card fixed the indent; this fixes the rest.
   *
   * A FIXED WIDTH, NOT A FLOOR — the lesson `PRICE_W` records against
   * `ADD_BUTTON_W` on this same file. A `min-w` lets whichever label is longest
   * push its own button past the floor and the pair goes ragged again silently,
   * which is exactly how the first attempt at the Style(s) pair failed. At
   * `text-xs` the longer of these two is ~105px, so 128px clears both with room
   * and neither can reach it.
   *
   * ITS OWN CONSTANT, not `ADD_BUTTON_W`. That one is the Style(s) pair's, at a
   * value the client has already signed off; widening it to serve this pair too
   * would move two buttons nobody asked about. One constant per SET that has to
   * line up is the pattern this file already follows for `PRICE_W` and
   * `PRICE_COLOUR_W`.
   */
  const STRUCTURE_ADD_W = "w-32";

  const componentGrid = (r: ComboRow, st: ComboStructRow) => {
    // `r`, not just its key: the Coordinate / Component / Fabric Color options
    // are all properties of the combo's STYLE and its Fabric Type.

    /* A PROPERTY OF THE FABRIC, SO IT IS COMPUTED ONCE PER FABRIC — every part
       under one structure reads the same Fabric Type, and hoisting it out of the
       row map is what keeps the star, the hold and the CONTROL identical down
       the column. See the note on the Colour cell below for why it varies.

       ONE FUNCTION, THREE BEHAVIOURS (client 2026-08-31). This used to be
       `colourSourceFor(st.item_sub_type) !== null`, and the comment on the cell
       below said in capitals that the list the cell OFFERS and the requiredness
       of the cell are ONE decision — which was right, and which Yarn Dyed
       breaks: a yarn-dyed part is REQUIRED to state its colour and is offered NO
       list at all, because the finished panel is a blend ("WHITE/BLUE STRIPE")
       that no declared colour can name. `colourSourceFor` cannot express that
       state, so the question moved to `componentColourEntry`, which answers all
       three — "list", "manual", or nothing to answer from yet. Read its doc in
       combo-rules.ts before changing any of the three consumers below; testing
       `=== "yarn_dyed"` beside it is the drift that function exists to prevent,
       and `componentProblems` asks the identical question on the Save side. */
    const colourEntry = componentColourEntry(st.item_sub_type);
    const colourRequired = colourEntry !== null;
    return (
    /*
     * NO BOX, NO HEADING, NO NOTES — the parts of a structure are its rows and
     * the button that adds one (client 2026-08-18, screenshots 2341 and 2342:
     * "that coordinate in another one inside frame ... too much frames", then
     * "remove this sentence ... I think 'Coordinates & components' this title
     * also can remove").
     *
     * It was three borders deep — the STRUCTURE DETAILS section, the structure's
     * own row card, and a panel inside that — with a section title and up to
     * three grey sentences before the first field. All of it described content
     * that was already unambiguously inside the structure card, so what it
     * mostly announced was itself.
     *
     * ## What used to justify each piece, and why none of it survives
     *
     * THE BOX was added on 2026-08-12, when "+ Add component" and "+ Add
     * structure" read as a pair — two buttons of different scope at what looked
     * like one indent. That was right FOR THE GRID AS IT STOOD: `listRows` meant
     * the row drew no card of its own, so this panel was the only thing saying
     * "these belong to the structure above". `forceCards` replaced `listRows`
     * the same day and boxes every row identically, so the row card makes that
     * statement now — "+ Add component" is inside it, "+ Add structure" outside
     * and below. The border that mattered is still there; this was the spare.
     *
     * THE TWO NOTES explained why the Coordinate and Component lists are not
     * narrowed, and why Fabric Print is empty. Real facts, and the client has
     * now decided they are not worth a line each on every structure — the
     * pickers still open, still show what they have, and an operator who wants
     * a narrower list is told so by the Style master, not by this panel. If
     * they are ever wanted back, they belong ON the control (a placeholder), not
     * as prose above it: that is the shape the de-clutter rule leaves open.
     *
     * THE TITLE named a group that is the only group here. The one thing left
     * inside this structure card besides its six fields is the parts list, and
     * "+ Add component" says what the list holds.
     */
    <div
        data-grid-body
        /* NOT `divide-y`: the "+ Add part" button is a sibling of the rows in
           here, so a divider on the PARENT would draw a line above it too. The
           hairline between parts is on the row (`border-t`, cancelled on the
           first).

           THE RULE ON TOP IS A DIFFERENT LINE AND A DIFFERENT JOB (client
           2026-08-20, screenshot 2397: "section partition indicator?"). It
           separates the two halves of a fabric card — above it, WHAT THE CLOTH
           IS; below it, WHERE IT GOES. Without it the structure's fields and
           its parts' fields read as one undifferentiated block of controls,
           which is the flatness this redesign exists to remove: the hierarchy
           was still only implied by vertical order.

           It is the ONLY border added back. The card around the fabric is
           `ChildGrid`'s, and the client removed the per-structure frame on
           2026-08-18 — this is a rule inside one card, not a fourth box. */
        /* `--border-strong` on the VERTICAL rule, `--border` on the
           horizontal one. A vertical divider between two field grids has to be
           read ACROSS a row of controls that are themselves outlined at
           `border`, so at that weight it rendered and could not be seen
           (client screenshot 2398). The horizontal rule never had the problem:
           nothing else on the card runs parallel to it. */
        className="mt-4 min-w-0 space-y-2 border-t border-border pt-3 min-[1250px]:mt-0 min-[1250px]:border-t-0 min-[1250px]:border-l min-[1250px]:border-border-strong min-[1250px]:pl-6 min-[1250px]:pt-0"
        onKeyDown={(e) => gridKeyNav(e)}
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
            /* A GRID, matching the spec above it: FOUR fluid columns and the ✕
               as a REAL CELL rather than an absolutely-placed sibling. It used
               to hang at `-right-9`, in the 40px gutter the structure row
               reserves — which works while the parts span the whole card and
               puts the ✕ outside the panel the moment they do not.

               FOUR, NOT TWO (client 2026-08-20, screenshot 2408: "one field is
               render in next [line], use that left side gap and make in same
               row"). Colour and Print moved onto this row and the track was
               still declared for two names, so the fourth field wrapped to a
               line of its own under the first. A grid does not widen to fit an
               extra child; it wraps it — and the wrap is silent, which is why
               this survived a clean build and a clean type-check.

               The floor drops 120px → 104px because four columns share the room
               two used to. It is a FLOOR, not a width: at 1250px+ each track
               resolves near `term` (176px), and below that the whole card stacks
               and the halves get the full width anyway.

               A FLOOR IS A FLOOR ON A PHONE TOO, which is what the sentence
               above missed. "The whole card stacks" is the OUTER track at
               `min-[1250px]` (line ~8278) letting each half take the full
               width — it says nothing about this row, whose four 104px floors
               are unconditional. 4 x 104 + 3 gaps = 452px, plus the ✕, against
               ~350px of content on a 414px phone: the row could not shrink, so
               it overflowed its own card.

               So the four-column track now starts at `sm` (640px → ~576px of
               content, comfortably over the 480px this needs) and the phone
               gets two columns, ~163px each — still wide enough for a `compact`
               picker, and half the height a full stack would cost on a card
               that repeats per part. The ✕ takes the row under them
               (`col-span-2 justify-self-end` on the Button) rather than being
               auto-placed into a field's column. Desktop is byte-for-byte what
               it was. */
            className="grid grid-cols-2 items-end gap-x-3 gap-y-2 border-t border-border/60 pt-2 first:border-t-0 first:pt-0 sm:grid-cols-[minmax(104px,1fr)_minmax(104px,1fr)_minmax(104px,1fr)_minmax(104px,1fr)_auto]"
          >
            {/* NO `#N`, AND THEREFORE NO BAND (client 2026-08-17, screenshot
                2332: "remove that #1, #2, all this kind of numbering, making huge
                UI gap"). The number was the only thing this line carried — a
                part is identified by ITS COORDINATE AND COMPONENT, which are the
                first two fields under it, never by being third. The ✕ keeps
                `data-row-remove`, so Ctrl+Del and the mouse are unchanged; it
                just no longer costs a row of height. Same change, same day, in
                `ChildGrid`'s own cards band. */}
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
              {/* ONE WIDTH FOR EVERY FIELD ON THIS OVERLAY — 176px (`term`),
                  matching Structure, Composition and Fabric Type in the structure
                  row above (client 2026-08-19: "field size also can update 176, it
                  will look uniform size").

                  THIRD AND FINAL SHAPE, and the first two are why this left the
                  span scale for good:

                    1. `xs xs md md` (2+2+4+4) — Fabric Color and Fabric Print drew
                       at DOUBLE the width of the two beside them. Reported.
                    2. `sm` x4 (12/12) — even, and filled the row. The client saw it
                       and asked for `xs` x4 (8/12), accepting the empty third.
                    3. This. `xs(2)` works out to ~294px here, and the structure row
                       had moved to 176px fixed widths — so no SPAN could ever match
                       it. 176/141 is 1.25 columns; the fraction scale cannot express
                       it at all.

                  So the row is a `FieldRow`, not a `FieldGrid`, for the reason the
                  Quantities row records a few hundred lines up: a twelfth of the
                  section is a different number of pixels in a 1180px sheet than in
                  a picker dialog, while 176px is 176px everywhere. Sizing by CONTENT
                  is what makes two different rows agree.

                  The ✕ is a SIBLING of this row, not a cell in it, so nothing here
                  reserves space for it. */}
              {/*
                * REQUIRED, ALL THREE OF THE NEXT CELLS (client 2026-08-21:
                * "coordinate, component, color set as required field").
                *
                * DECLARED TWICE ON PURPOSE — on the `Field` and on the control.
                * This overlay's `ChildGrid` is `forceCards` + `renderMobileRow`,
                * so `ChildGridColumn.required` never reaches a cell (AGENTS.md:
                * "A GRID THAT RENDERS ITS OWN ROW MUST DECLARE `required`
                * TWICE"), and `comboStructureColumns` is an empty array for
                * exactly that reason. The Structure picker above already does
                * it this way; these follow it.
                *
                * THE RED `*` LANDS ON ROW 0 ONLY, because the LABEL does — this
                * row prints its column titles once (`j === 0`, client
                * 2026-08-17). That is correct rather than a gap: the label is
                * acting as a column header, and one header carries one star.
                * The HOLD is unaffected on every row, because it comes from
                * `RequiredScope` inside `Field`, never from the label text.
                */}
              <Field label={j === 0 ? "Coordinate" : undefined} required w="term" className="w-full">
                {/* The style's own coordinates (client 2026-08-12). */}
                <RecordPicker
                  label="Coordinate"
                  compact
                  required
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
                      !scopedComponents(r, id, null).some(
                        (o) => o.id === c.component_id,
                      )
                        ? { component_id: null }
                        : {}),
                    })
                  }
                />
              </Field>
              <Field label={j === 0 ? "Component" : undefined} required w="term" className="w-full">
                {/* Narrowed by the coordinate beside it: the style declares the
                    PAIR (FRONT BODY *of* PIECES), so an unscoped list would
                    offer a collar under a coordinate that has none. */}
                <RecordPicker
                  label="Component"
                  compact
                  required
                  /* THE SIBLING PARTS OF THIS FABRIC, never this row — the same
                     `componentsTakenUnder` the Style(s) Components grid passes
                     to `componentOptions`, so the two grids cannot end up with
                     different ideas of what is already spoken for. Excluding the
                     row's own key is what stops the cell hiding the value it is
                     currently showing. */
                  items={scopedComponents(
                    r,
                    c.coordinate_id,
                    c.component_id,
                    componentsTakenUnder(
                      st.components.filter((x) => x.key !== c.key),
                      c.coordinate_id,
                    ),
                  )}
                  value={c.component_id}
                  onChange={(id) => patchComp(r.key, st.key, c.key, { component_id: id })}
                />
              </Field>
              {/* COLOUR AND PRINT, PER PART (client 2026-08-20, screenshots
                  2403 · 2407). Both stand on every row, always — the client was
                  offered "whichever the Fabric Type implies" and chose both.

                  That is a partial reversal of the 2026-08-12 pairing rule in
                  `combo-rules.ts`, whose stated reason was that the operator must
                  not be "asked for a colour AND a print on one fabric". Only the
                  show-one-hide-the-other gate is dropped; `colourSourceFor` and
                  `declaredPrintOptions` still narrow what each cell OFFERS, so a
                  Melange fabric is still offered melange colours. Do not restore
                  the gate as a bug fix.

                  `w="term"` ON BOTH, like the two beside them. The row is a
                  `FieldRow` sized by CONTENT at 176px, and the note at the top of
                  this row records why: shape 1 was `xs xs md md`, where "Fabric
                  Color and Fabric Print drew at DOUBLE the width of the two
                  beside them. Reported." The span scale cannot express 176px. */}
              {/*
                * COLOUR IS REQUIRED ONLY WHERE A COLOUR APPLIES, and the test is
                * `componentColourEntry` — the SAME function that decides whether
                * the cell offers a list, takes typed text, or asks nothing at
                * all. Never a second reading of the Fabric Type literals.
                *
                * IT USED TO BE `colourSourceFor` AND THAT IS NO LONGER THE SAME
                * QUESTION (client 2026-08-31). Requiredness and the offered list
                * were one decision because a fabric with no colour SOURCE was a
                * fabric with no colour to state. Yarn Dyed separates them: it
                * has no source — its panels are described by hand — and is still
                * required to be described. Reverting this test to
                * `colourSourceFor(...) !== null` compiles, runs, and silently
                * makes Colour optional on every yarn-dyed part.
                *
                * On a fabric whose Fabric Type is still blank, `declaredColoursFor`
                * returns NOTHING and nothing has said what kind of cloth it is.
                * An unconditional hold there would refuse to release a cell the
                * app has nothing to fill from — the operator's only ways out
                * being free text, Escape, Ctrl+Del or the mouse. That is
                * AGENTS.md's "requiring a hidden field is a record that cannot be
                * saved with nothing on screen to say why", one door along: not
                * hidden, unanswerable. (`printed` used to be the other half of
                * this sentence and is no longer a Fabric Type at all.)
                *
                * `componentProblems` asks the identical question on the Save
                * side, so the star, the hold and the blocked Save cannot drift.
                */}
              <Field
                label={j === 0 ? "Colour" : undefined}
                required={colourRequired}
                w="term"
                className="w-full"
              >
                {/* WRAPPED SO THE HOLD KNOWS ITS NAME — and this is true of BOTH
                    branches below, which is why the scope is outside the choice
                    rather than inside one arm of it. `DataPicker` hands its own
                    `label` to `useRequiredHold`, which is why the two pickers
                    beside this say "Coordinate is required." on every row for
                    free; `Combobox` passes none and `Input` passes none, and
                    `Field` supplies null whenever it draws no label — this row
                    prints its column titles on part 0 only, so on parts 2..n the
                    message would be the anonymous "This field is required." A
                    local scope fixes it without touching `combobox.tsx` or
                    `input.tsx`, which are shared primitives and app-wide by
                    nature. */}
                <RequiredScope required={colourRequired} label="Colour">
                  {colourEntry === "manual" ? (
                    /* YARN DYED: A TEXT BOX, NOT AN EMPTY DROPDOWN (client
                       2026-08-31: "the system must exclude and hide the base
                       fabric colors and the colors selected in the Yarn Color
                       field from appearing in the Component color list … the
                       field must be locked to manual-entry text input only …
                       user manually types 'White/Blue Stripe'").

                       THE EXCLUSION IS TOTAL, WHICH IS WHY THE CONTROL CHANGES
                       RATHER THAN ITS OPTIONS. "Exclude the base fabric colours
                       AND the yarn colours" removes both halves of everything
                       this cell could have offered — the declared palette IS
                       those colours — so a Combobox here would be a dropdown
                       that opens on nothing, on every part of every yarn-dyed
                       fabric. `declaredColoursFor` returns `[]` for the same
                       reason. Rendering a chevron over an empty list is the
                       "permanently closed gate" shape one field over in
                       `declaredPrintOptions`; the ABSENCE of the chevron is the
                       affordance, and it is the only one this cell gets — the
                       de-clutter rule (2026-08-17/19) blanks field placeholders
                       app-wide, so there is no hint line either.

                       WHY NOT JUST FILTER THE LIST: a list is a recommendation.
                       Offering WHITE and BLUE under a WHITE/BLUE stripe would
                       let an operator record a striped panel as plain WHITE, and
                       the client's word for what that does to the order's
                       colourways is "corrupt". The yarns themselves are named
                       once, on the fabric's own Yarn Color field.

                       `.toUpperCase()` MATCHES `capsTextNullable()` ON THE
                       SCHEMA, exactly as the Combobox branch does. `Input`
                       already capitalises keystrokes by default (AGENTS.md,
                       "CAPITALS", since 2026-08-18), so this is belt and braces
                       for a value arriving any other way — a paste, an
                       autofill-style set — and it costs nothing to keep the two
                       branches writing the same thing.

                       NO `Field required` DUPLICATE NEEDED: the scope above
                       supplies both the flag and the name, and `Input` reads
                       `useRequiredHold` from it — so the star, the hold and its
                       spoken reason all come from the one declaration. */
                    <Input
                      value={c.color_name}
                      onChange={(e) =>
                        patchComp(r.key, st.key, c.key, {
                          color_name: e.target.value.toUpperCase(),
                        })
                      }
                    />
                  ) : (
                    /* A Combobox, not a picker: `color_name` is TEXT and free
                       text must always work. Guided, never blocked — the same
                       line the fabric-level control drew before it moved here.
                       This is the `"list"` branch AND the `null` one: an
                       unanswered Fabric Type offers nothing and requires
                       nothing, and a dropdown that opens on nothing is honest
                       there in a way it is not under Yarn Dyed, because the
                       operator can still fill the Fabric Type and have it fill. */
                    <Combobox
                      options={colourOptionsFor(st)}
                      value={c.color_name}
                      onChange={(v) =>
                        patchComp(r.key, st.key, c.key, { color_name: v.toUpperCase() })
                      }
                      required={colourRequired}
                      clearable
                    />
                  )}
                </RequiredScope>
              </Field>
              {/* "ROLL FORM PRINT" SINCE 2026-08-31, AND THE 08-21 NOTE BELOW IS
                  WHY IT IS NOT JUST "PRINT".

                  The client's 2026-08-21 instruction was **"Fabric Print", NOT
                  "Print"** — the legacy screen's wording, and the one
                  `ComboCompRow.print_id` still carries in its own comment. That
                  decision rejected the SHORTER name, and this rename does not
                  undo it: "Roll form print" is more specific, not less.

                  THE 08-31 INSTRUCTION NAMED THE COLOR/PRINT TAB ONLY, and this
                  cell followed it anyway because `declaredPrintOptions` narrows
                  THIS list out of the prints THAT tab declares. They are one
                  vocabulary, so two names for them is the thing "standardized"
                  argues against. Reverting this pair alone is a one-line change
                  if the client wants the tab renamed and the cell left.

                  STILL RENAMED ON THE `Field` AND ON THE PICKER, for the reason
                  the 08-21 note gives: the picker's `label` is its accessible
                  name AND its "— Select … —" placeholder, so changing one leaves
                  the screen disagreeing with itself.

                  STILL OPTIONAL, deliberately, and MORE so since 2026-08-31. All
                  31 stored parts have a null `print_id` (catalog 2026-08-21), so
                  requiring it would make every existing order unsaveable. The
                  second half of this note used to read "and only a `printed`
                  fabric has one at all" — that Fabric Type is gone, and the
                  client's reason for removing it (printing is an aesthetic step,
                  orthogonal to what the cloth is made of) says most parts of most
                  fabrics have no print, whatever the cloth is. The cell is now
                  ungated and unrequired: see `declaredPrintOptions`. */}
              {/* "Roll form print", renamed with the Color/Print tab that feeds
                  it (2026-08-31). `declaredPrintOptions` narrows THIS list to the
                  prints that tab declared, so the two are one vocabulary — and two
                  names for one vocabulary, on one screen, is the thing the client
                  used the word "standardized" about. */}
              <Field label={j === 0 ? "Roll form print" : undefined} w="term" className="w-full">
                {/* `print_id` is a uuid, so this stays a picker. The asymmetry
                    with Colour beside it is the columns', not a choice. */}
                <RecordPicker
                  label="Roll form print"
                  compact
                  items={declaredPrintOptions(st, c.print_id)}
                  value={c.print_id}
                  onChange={(id) => patchComp(r.key, st.key, c.key, { print_id: id })}
                />
              </Field>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              data-row-remove
              /* THE ROW'S LAST CELL, and the row is `items-end` — which is
                 what keeps this level with the controls rather than with the
                 label row above them. Only the FIRST part carries the column
                 titles, so a top-aligned ✕ would sit right on every row except
                 that one, where the titles push the controls ~20px down. The
                 statement is unchanged from when this was absolutely placed;
                 the grid just makes it without an offset to maintain.

                 ON A PHONE THE ROW IS TWO COLUMNS, so the five children fill
                 two rows and leave this one auto-placed at the START of a
                 third — a ✕ under Coordinate, reading as that field's control.
                 `col-span-2 justify-self-end` gives it the row and pushes it to
                 the trailing edge, which is where it sits on the wide track. It
                 is a cells-and-alignment statement only: `data-row-remove`, the
                 handler and Ctrl+Del are untouched. */
              className="col-span-2 justify-self-end text-muted-foreground hover:text-danger sm:col-span-1 sm:justify-self-auto"
              onClick={() =>
                mutComps(r.key, st.key, (cs) =>
                  cs.filter((x) => x.key !== c.key),
                )
              }
              aria-label="Remove component"
            >
              <Trash2 className="h-4 w-4 shrink-0" />
            </Button>
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
        <Button
          type="button"
          variant="outline"
          size="sm"
          data-row-add
          /* Same box as "+ Add structure" below it — see `STRUCTURE_ADD_W`. */
          className={STRUCTURE_ADD_W}
          onClick={() => addComp(r.key, st.key)}
        >
          + Add part
        </Button>
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
      /* grid-caption: exempt -- the [Detail] overlay names no grid; this caption is the only thing that does. */
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
      /* NO CARD PER STRUCTURE (client 2026-08-18, screenshot 2344: "remove that
         structure details frame also, one frame is enough"). STRUCTURE DETAILS
         is the one frame; a card around every structure inside it was the third
         border on a screen whose overlay is already titled "Structure Details".
         Same call, same day, same prop as the Prices grid — see `flatRows`.

         The band survives it, and here that matters more than on Prices: this
         grid FOLDS (`foldRows` below), so the summary line is the whole of a
         closed structure, and its ✕ is the only way to remove one. */
      flatRows
      /* NO SUMMARY LINE (client 2026-08-18, screenshot 2347: "in top the fabric
         it's showing Circular Knit type, no need to show there").

         The band drew the KNIT FAMILY, and the family is derived from the
         Structure picked in the field directly beneath it — so an open row said
         "Circular Knit" above a box already reading "1X1 LYCRA RIB". With that
         removed the band has nothing left of its own to say: naming the row by
         its Structure would only move the duplicate up a line.

         DROPPED WHOLESALE RATHER THAN PER ROW. Returning null for a filled row
         and "New structure" for a blank one flips `cornerRemove` between rows,
         and with it the row's `pr-10` — so a blank structure and a filled one
         would lay their twelve columns over different widths and stop lining up
         with each other. One rule for every row is the only one that holds the
         grid straight.

         The ✕ is unaffected: with no band, `ChildGrid` floats it into the row's
         top-right corner, still carrying `data-row-remove` for Ctrl+Del. */
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
        /* READ UP FROM THE PARTS, because the fabric no longer holds an answer
           of its own (client 2026-08-20). A folded fabric is read rather than
           edited, so this is the one place a roll-up is still the right shape —
           and `aestheticSummary` cannot write, which is what makes it safe.

           "mixed" IS A REAL ANSWER AND MUST BE SAID. Parts of one fabric now
           legitimately differ, and showing blank there would be indistinguishable
           from "nobody has answered yet" — a closed row that hides the very thing
           the client asked to make visible. */
        const aes = aestheticSummary(st.components ?? []);
        /* BOTH AESTHETICS, NOT ONE OF THEM (2026-08-31).

           This line used to read `takesAllOverPrint(...) ? <print> : <colour>`,
           and the choice was correct while at most one of the two cells could be
           answered — the gate hid whichever the Fabric Type did not call for. The
           client put Colour and Fabric Print side by side on EVERY part on
           2026-08-20, so since that day a fabric could carry both and the folded
           row showed one of them; removing `takesAllOverPrint` is what made the
           omission impossible to keep. A fold that drops a stored value is worse
           than a fold that is long: the whole job of this line is to be the whole
           of a closed structure.

           SO EACH AXIS SPEAKS FOR ITSELF, including its own "mixed" — see
           `aestheticSummary`, where the combined flag was split for exactly this
           reason. A fabric whose parts are all WHITE but carry different prints
           now reads "WHITE · mixed prints", not "mixed".

           THE YARN COLOURS JOIN IT, and that is not decoration on a Yarn Dyed
           row: with `printed` withdrawn, the Fabric Type label says "Yarn Dyed"
           and the part colours are free text like "WHITE/BLUE STRIPE" — so
           without this the one field that states which yarns the cloth is made of
           would be invisible in the only state a finished fabric is normally
           seen in. Joined by "/" rather than the line's own "·" so the set reads
           as one answer.

           EVERY ENTRY IS STILL `null` WHEN UNANSWERED, because the `.filter`
           below is what keeps a half-filled fabric from printing a row of
           separators with nothing between them. */
        const colourBit = aes.colour.mixed ? "mixed colours" : aes.colour.value;
        const printBit = aes.print.mixed
          ? "mixed prints"
          : (printOpts.find((o) => o.id === aes.print.value)?.name ?? null);
        const summary = [
          data.compositions.find((c) => c.id === st.composition_id)?.name,
          gsmRange(st.gsm, st.gsm_tolerance) || null,
          ITEM_SUB_TYPE_OPTIONS.find((o) => o.value === st.item_sub_type)?.label,
          st.yarn_colors.length ? st.yarn_colors.join(" / ") : null,
          colourBit,
          printBit,
          parts > 0 ? `${parts} ${parts === 1 ? "part" : "parts"}` : null,
        ]
          .filter(Boolean)
          .join("  ·  ");
        const foldedProblems = structureProblems(st);
        return (
          /* THE OPEN CARD'S RAIL, TRANSPARENT — see the long note in
             `renderMobileRow`. Same width, same padding, no colour: the two
             states must differ in NOTHING but the ink, or the rail reads as the
             open row having shifted right rather than as it being the active
             one.

             `cursor-pointer` because the whole folded card already opens on
             click (`ChildGrid` puts the handler on the row) and nothing said so.
             A closed record that responds to a click it never advertised is the
             other half of "now it's confusing". */
          <div className="cursor-pointer space-y-2 border-l-2 border-transparent pl-4">
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
          {/* THE ADVISORY LIVES HERE TOO, and this is the half that makes
              deferring it honest. A folded structure is one the operator has
              moved on from — the definition of the moment they asked to be told
              — and it is also the only state a finished-but-incomplete
              structure is ever seen in, since focusing it opens it again. Gated
              on nothing further: `folded` IS the gate. */}
          {foldedProblems.length > 0 && (
            <p className="text-xs text-warning">{foldedProblems.join(" · ")}</p>
          )}
          </div>
        );
      }}
      onAdd={() => addStruct(r.key)}
      onRemove={(st) => mutStructs(r.key, (sts) => sts.filter((x) => x.key !== st.key))}
      addLabel="+ Add fabric"
      /* Same box as "+ Add component" inside it — see `STRUCTURE_ADD_W`. */
      addClassName={STRUCTURE_ADD_W}
      renderMobileRow={(st) => {
        const problems = structureProblems(st);
        /* THE STARS AND THE HOLDS COME FROM THE RULE, NEVER FROM A LITERAL
           (client 2026-09-01). `structureRequiredCells` is the same declaration
           `problems` above is derived from and the same one `comboProblems`
           gates Save on, so a cell cannot show a `*` the Save button disagrees
           with — the star/hold divergence AGENTS.md's "one declaration, four
           enforcers" exists to prevent.

           IT TAKES NO ARGUMENT, and that is the 2026-09-01 change: all five
           cells are unconditional, so every fabric on every combo answers the
           same. It stays a CALL rather than a module constant because the
           question "what does a fabric owe" belongs to the rule module, and an
           inlined object here would be the second statement this indirection
           exists to prevent. */
        const need = structureRequiredCells();
        const range = gsmRange(st.gsm, st.gsm_tolerance);
        return (
          /**
           * THE RAIL SAYS WHICH FABRIC YOU ARE WORKING ON (client 2026-08-20:
           * "the table divide[r] need much clear[er] indicated for user they are
           * working [on a] new one, now its confusing").
           *
           * The divider between fabrics already says "a new record starts here"
           * and was strengthened twice for this same complaint (to
           * `border-strong`, then to 2px). It was never the missing signal: a
           * boundary says where a record BEGINS, and the operator was asking
           * which one is OPEN. A closed fabric still renders a real Structure
           * picker — deliberately, so Tab can reach it — so a folded card reads
           * as a short open one, and no amount of line weight between them fixes
           * that.
           *
           * WHY A RAIL AND NOT THE OBVIOUS THINGS. Every other candidate here is
           * already a rejected one: a row FILL was removed app-wide on
           * 2026-08-18, a BOX per row is what `flatRows` exists to prevent
           * (client: "one frame"), NUMBERING went on 2026-08-17 ("remove that
           * #1, #2 … making huge UI gap"), and the DIVIDER is the thing that has
           * failed twice. The rail is the one signal none of those used, and it
           * marks a STATE rather than adding a container.
           *
           * ITS TWIN IS IN `renderFoldedRow`, transparent and at the same
           * padding. That matters more than it looks: without the matching
           * inset, an open card would sit 18px right of a closed one and the
           * rail would read as the row having MOVED rather than as the row being
           * active. Presence or absence of colour is the whole message; nothing
           * else may change between the two states.
           */
          <div className="border-l-2 border-primary pl-4">
          <div
            /*
             * THE PARTS SIT BESIDE THE SPEC (client 2026-08-20: "why can't do
             * those two fields also in same row").
             *
             * Once Colour and Print moved up to the cloth the parts list is two
             * columns, and it fits in the width the spec row was already leaving
             * empty — so a two-part fabric is ONE line instead of four. Both
             * halves are `minmax(0, Nfr)`: sizing the spec to its content is
             * what let it demand 1030px and push the row past the frame.
             *
             * IT STACKS BELOW 1250px, and that is the design rather than a
             * fallback for it — the same card, arranged for the room it has. The
             * divider turns with it: a left border when the halves are side by
             * side, the top border `componentGrid` carries when they are not.
             */
            /* 1.25fr / 1fr, WAS 1.85 / 1 (client 2026-08-20, screenshot 2408:
               "use that left side gab and make in ssamse row").

               1.85 was right when the left half carried SIX fields and the right
               carried two names. It now carries five and four, so the old ratio
               starved the half that grew to feed the half that shrank — the two
               changes are one change, and fixing only the part row's track would
               have squeezed four fields into a third of the card.

               At ~1830px this puts each part column near 176px, which is `term`
               — the width the part row's own `w` props already ask for, so the
               track and the fields finally agree instead of one overriding the
               other. */
            className="grid items-start gap-x-6 gap-y-3 min-[1250px]:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]"
            /* FOCUS LEAVING THE ROW IS "they moved on" — `onBlur` bubbles in
               React, so one handler covers every field in the row and the
               nested part rows with it. `relatedTarget` inside this row is a
               move BETWEEN its fields and is not leaving; null (a click on
               dead space, a window blur) is treated as leaving, which is the
               conservative half — the worst it does is show a true warning a
               moment early. */
            onBlur={(e) => {
              if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
              setStructTouched((prev) =>
                prev.has(st.key) ? prev : new Set(prev).add(st.key),
              );
            }}
          >
            {/*
              * THE TWO ROWS SHARE THEIR COLUMNS (client 2026-08-18, screenshot
              * 2344: "in this one frame we align the fields properly").
              *
              * Both rows already tiled to 12 — six `xs` here, 2+2+4+4 in a part
              * row below — so the spans were never the problem. The WIDTHS were:
              * a part row carried `pr-10` of its own to keep its ✕ off the last
              * control, so its twelve columns were laid over 40px less width
              * than these. Every boundary drifted a little further left than the
              * last, and Fabric Color / Fabric Print straddled the gaps between
              * Gsm, Tolerance and Gsm Range instead of sitting under them.
              *
              * NEITHER GRID DECLARES THE INSET NOW — the ROW does, once, for
              * both. Dropping `rowSummary` above put `cornerRemove` in charge of
              * the ✕, and that comes with `relative pr-10` on the row itself, so
              * a part row asking for its own would be the same 40px twice and
              * the drift back. One gutter, declared in one place, holding every
              * ✕ on this grid: the structure's in the corner, each part's beside
              * its fields.
              */}
            {/*
              * A GRID, NOT A `FieldRow` — six named columns (client 2026-08-20,
              * screenshot 2398: "still look uneven aligned layout").
              *
              * `FieldRow` is `flex-wrap`, which is right for a row that owns the
              * full width and wrong the moment it shares. Sat beside the parts
              * list, Fabric Type wrapped to a line of its own and left ~370px of
              * dead space mid-row. Nothing was misaligned in the CSS sense: a
              * wrapping row simply has no column POSITIONS, so where a field
              * lands depends on how many fitted before it — which changes per
              * fabric. Flex aligns by outcome; a grid aligns by position, and
              * only the second can promise that two cards agree.
              *
              * FLUID, AND FIXED ONLY WHERE WIDTH MEANS SOMETHING. Pinning every
              * column gave the row ONE size (~1525px) which then had to scroll.
              * A GSM box is 4.5rem because a GSM is four digits — that is about
              * the value, so it stays fixed. A structure NAME has no such bound,
              * so it takes `minmax(floor, share)` and the row fills an 1880px
              * overlay while still fitting a 1200px one.
              *
              * Each `Field` keeps its `w` for the narrow case and overrides it
              * with `w-full` here, so it FILLS its track instead of setting it —
              * `FIELD_WIDTH` emits `w-*`, so tailwind-merge resolves that to the
              * later class rather than stacking both.
              */}
            <div className="min-w-0 space-y-2">
            {/* FIVE COLUMNS, DOWN FROM SIX (client 2026-08-20, screenshot 2408:
                "use that left side gap"). The sixth held the fabric's Colour /
                Print slot, and when that moved onto the part row the track
                stayed — so the fabric row reserved a whole column for a control
                that no longer exists, which is the empty space to the right of
                Fabric Type in the screenshot.

                A trailing empty track is invisible in code review and obvious on
                screen: nothing errors, the row just stops short of its own
                frame. Count the children whenever a field leaves a hand-written
                `grid-cols-[…]`.

                THE TRACK IS GATED AT `lg`, because its floors add up to more
                room than most windows give it: 150 + 170 + 72 + 72 + 130 plus
                four gaps is 642px that cannot shrink. Against ~350px of content
                on a 414px phone it overflowed the card by nearly 300px — the
                worst mobile break in this module — and a floored track has no
                way to answer that except to stop applying.

                Below `lg` the fields stack one per line and each takes the full
                width, which is the same answer the outer track at
                `min-[1250px]` already gives the two halves. `lg` (1024px)
                rather than the ~934px where the arithmetic first fits: the rail
                is 228px, the content pane 32px of `px-4` and the card its own
                padding on top, so the tighter bound leaves nothing for the part
                of the chrome that is not fixed.

                STILL SQUEEZED ABOVE 1250px, AND DELIBERATELY LEFT ALONE. Once
                the outer track splits, this row lives in the 1.25 half — about
                527px at a 1250px window, under the 642px it needs — so it wants
                a real answer somewhere between "stack" and "one line", not a
                second breakpoint guessed from arithmetic. That is a desktop
                layout decision with client history behind it (screenshots 2354,
                2408) and it is not this change. */}
            <div className="grid items-end gap-x-3 gap-y-2 lg:grid-cols-[minmax(150px,1.3fr)_minmax(170px,1.7fr)_4.5rem_4.5rem_minmax(130px,1fr)]">
              {/* `term` (176px), NOT `name` (288px) — client 2026-08-19, asking for
                  Structure and Composition "as xs(2) size" like the part row below.

                  TRANSLATED, because `size` HAS NO EFFECT ON THIS ROW. `FieldRow` is
                  `flex flex-wrap`, laid out by WIDTHS rather than twelfths, and
                  `Field` reads `w ? FIELD_WIDTH[w] : SPAN[size]` — so a `size="xs"`
                  here would emit a `col-span-2` into a flex container and change
                  nothing at all. The width scale's step below `name` is `term`.

                  Composition truncates sooner as a result, and that is accepted: it
                  is a picker, so it carries the `text-ellipsis` + reveal every picker
                  gets (LAYOUT.md §14) and the whole value stays reachable. */}
              {/* `need.structure` RATHER THAN A BARE `required`, and it reads
                  `true` unconditionally. This cell was already correct on
                  2026-09-01 — it is rewired only so that every cell on the card
                  asks the SAME function what it owes. A hard-coded `required`
                  sitting beside four derived ones is the literal that survives
                  the next rule change and quietly disagrees with it. */}
              <Field
                label="Structure"
                required={need.structure}
                w="term"
                className="w-full"
              >
                {/* A fabric CATEGORY (0409). The knit family beside it is
                    DERIVED from this one answer — never asked again, so the
                    two cannot disagree. */}
                <RecordPicker
                  label="Structure"
                  compact
                  required={need.structure}
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
                  drives `colourSourceFor` / `takesAllOverPrint` / the structure
                  problems — so removing the control removes exactly the control.

                  IT IS ALSO WHAT PUT THIS ROW ON ONE LINE. Seven fields at `xs`
                  is 7 x 2 = 14 on a 12-column track, so Fabric Type wrapped alone
                  underneath; the six that remained tiled 12 exactly.

                  THAT ARITHMETIC IS NOW HISTORY, and deliberately so (client
                  screenshot 2354, 2026-08-18). This row is a `FieldRow`, not a
                  `FieldGrid`: the fields take WIDTHS rather than twelfths. The
                  reason is that `xs` is the FLOOR of the span scale and this
                  overlay is ~1767px wide, so 2/12 rendered at ~282px — the
                  smallest size the system can express came out the same width as
                  LAYOUT.md §3's standard full-size field, and a three-digit Gsm
                  sat in twenty digits of room. No span could fix that, because a
                  span is a share and the value is not.

                  So: Structure and Composition keep the ~280px (`name`), Gsm and
                  Tolerance take 72px (`num`), the derived Gsm Range 112px
                  (`range`) and Fabric Type 176px (`term`) — ~1068px of content
                  against 1767px before. The row still holds one line and now
                  fits inside an 1180px sheet as well.

                  Do NOT "settle" this row back to 12. The sums-to-12 rule is
                  about a fractional track; a content-width row has no twelfths
                  to leave over. `lib/ui/sizes.ts` has the vocabulary. */}
              <Field
                label="Composition"
                required={need.composition}
                w="term"
                className="w-full"
              >
                {/* THE COMPOSITION MASTER, WHOLE (0434), and fetched on top:
                    picking a Structure whose category holds one fabric
                    pre-selects the composition stating that fabric's blend
                    (`pickComboStructure`), and the list is never narrowed, so
                    the cell is answerable before a Structure exists.

                    THE HOLD IS NOW TAKEN (client 2026-09-01) — the decision this
                    comment used to say "nobody has taken". `required` comes from
                    `structureRequiredCells`, never from a literal here.

                    IT IS SATISFIABLE FROM A COLD START, which is the test
                    AGENTS.md sets for any hold: the list is the whole master and
                    is never narrowed by anything above it, so a held Composition
                    can always be answered where the operator stands. That is not
                    true of Colour one column over, which is why that one is
                    conditional and this one is not.

                    `items` is passed straight from the service: the rows carry
                    their own `inactive`, and `DataPicker` hides a switched-off
                    composition while keeping the one this row already holds,
                    tagged `(inactive)`. Nothing to map, so nothing to forget. */}
                    <RecordPicker
                      label="Composition"
                      compact
                      required={need.composition}
                  items={data.compositions}
                  value={st.composition_id}
                  onChange={(id) =>
                    patchStruct(r.key, st.key, { composition_id: id })
                  }
                    />
              </Field>
              {/*
                * GSM IS ONE ANSWER, SO IT IS ONE CONTROL — "200 ± 5", with the
                * range it works out to underneath.
                *
                * It was three boxes: Gsm, Tolerance, and Gsm Range. The third
                * was never typed in — `gsmRange` computes it and it has no
                * column (0408) — so it occupied an input box to display a
                * subtraction, and the operator had to read across three labels
                * to learn one fact about the cloth.
                *
                * THE READONLY BOX IS WHAT WENT, NOT THE VALUE. It still shows,
                * as the text it always was. Losing the box also loses nothing
                * from the keyboard: `Input readOnly` sets `tabIndex={-1}`
                * itself, so Tab never stopped there anyway.
                */}
              {/*
                * THREE LABELLED SLOTS, ALL ONE CONTROL TALL (client 2026-08-20,
                * screenshot 2397: "gsm near field name is missing").
                *
                * The first cut put both numbers inside ONE `Field` labelled GSM,
                * with the derived range as a `<p>` beneath them. Two things
                * broke, and the second is the one worth remembering:
                *
                * 1. THE TOLERANCE BOX LOST ITS NAME. A bare `±` between two
                *    identical number boxes says there is a tolerance, not which
                *    box holds it — and on a fabric reading "45 ± 45" that is a
                *    genuine question. A control the operator types into gets a
                *    label; grouping is not a substitute for naming.
                *
                * 2. `FIELD_ROW` IS `items-end`. The paragraph underneath made
                *    this field taller, so its BOTTOM aligned with everyone
                *    else's and its label rode ~26px above every other label in
                *    the row. Any `Field` on a `FieldRow` that is taller than one
                *    control will do this — it is not specific to a paragraph,
                *    and it is invisible until a row has a tall member.
                *
                * So the range keeps its own slot instead of hanging off GSM's.
                * It is still not an input: a `min-h-8` flex box holds text at
                * exactly an input's height, which is what makes it line up while
                * staying off the Tab path — the same shape the folded structure
                * summary uses a few hundred lines down.
                */}
              {/* `onBlur` ON BOTH BOXES — see `carryDownGsm`. It declines
                  unless this IS the first fabric, so the handler is harmless
                  here and the rule stays stated in one place rather than being
                  half-expressed as a condition on the JSX. */}
              {/* GSM IS REQUIRED ON EVERY FABRIC (client 2026-09-01: "gsm also
                  need required for all fabric type").

                  IT SHIPPED CONDITIONAL EARLIER THE SAME DAY and this comment
                  said so — "Circular Knit → GSM compulsory; Woven or Flat Knit →
                  optional" (client 2026-08-10) was read as the narrower and
                  older statement and left standing. The client was shown that
                  reading and overruled it in one line, so the 08-10 carve-out is
                  WITHDRAWN, not overlooked: a later instruction wins, and
                  restoring it needs a new decision rather than someone noticing
                  `isCircularKnit` still exists (it does, uncalled, and its own
                  doc explains why).

                  SO THE STAR NO LONGER FLICKERS. It used to appear when you
                  picked a knit Structure and vanish on a woven one — the one
                  case-driven star on this card. Nothing here is conditional now,
                  which is why `need.gsm` reads as a constant: it is still routed
                  through the rule so the star, the hold and the Save gate cannot
                  drift apart. */}
              <Field label="GSM" required={need.gsm} w="num">
                <Input
                  type="number"
                  className="text-right"
                  value={st.gsm}
                  onChange={(e) => patchStruct(r.key, st.key, { gsm: e.target.value })}
                  onBlur={() => carryDownGsm(r.key, st.key)}
                />
              </Field>
              {/* TOLERANCE IS REQUIRED AND ALSO PREFILLED TO 5, which is not a
                  contradiction: `addStruct` seeds ±5 so the hold is satisfied on
                  arrival and the operator only meets it if they CLEAR the box.
                  A field they emptied on purpose is exactly the one worth
                  refusing to leave blank, and zero still reads as an answer
                  (`structureProblems`). */}
              <Field label="Tolerance" required={need.gsm_tolerance} w="num">
                <Input
                  type="number"
                  className="text-right"
                  value={st.gsm_tolerance}
                  onChange={(e) =>
                    patchStruct(r.key, st.key, {
                      gsm_tolerance: e.target.value,
                    })
                  }
                  onBlur={() => carryDownGsm(r.key, st.key)}
                />
              </Field>
              {/*
                * THE RANGE SITS UNDER THE TWO BOXES IT IS THE SUM OF, and in a
                * grid that costs nothing.
                *
                * It had a labelled column of its own — ~123px to show a
                * subtraction. Putting it inside GSM's `Field` instead made that
                * field taller than its neighbours, and on a `flex items-end` row
                * that matched its BOTTOM to theirs and shoved its label 26px up
                * (client screenshot 2397). `row-start-2` has no such failure
                * mode: row 1's alignment is computed without this cell, so the
                * label above it cannot move.
                *
                * No label. It is right-aligned beneath two numbers and reads as
                * their result — naming it would be the caption the client has
                * now removed four times.
                */}
              <div className="col-span-2 col-start-3 row-start-2 -mt-1 text-right text-[11px] tabular-nums text-muted-foreground">
                {range}
              </div>
              {/* THREE OPTIONS, DOWN FROM FOUR — "Printed" left the vocabulary
                  on 2026-08-31 (client: "Fabric Type is meant to define the
                  structural weave or dye category of the fabric. 'Printed' is an
                  aesthetic processing step, not a base fabric type. Leaving it in
                  the construction list causes planning confusion and corrupts
                  downstream material requirements").

                  NOTHING HERE CHANGED FOR IT, AND THAT IS THE POINT: this
                  `<Select>` maps `ITEM_SUB_TYPE_OPTIONS`, and so does the Color/
                  Print tab's own Type column, so removing the entry from
                  combo-rules.ts removed it from both dropdowns at once. The one
                  vocabulary is what made a four-to-three change a one-line change
                  — the cost was entirely in `takesAllOverPrint`, the gate that
                  read the withdrawn value. */}
              {/* REQUIRED SINCE 2026-09-01, AND IT IS THE KEYSTONE OF THE FIVE.
                  Colour one column over is required only once this cell is
                  answered (`componentColourEntry`), because a blank Fabric Type
                  leaves Colour with no list to fill from — an unsatisfiable
                  hold. Holding HERE is what closes that gap: the operator cannot
                  tab past a blank Fabric Type, so by the time they reach Colour
                  it always has either a list or the yarn-dyed text box. The two
                  rules interlock; do not make Colour unconditional instead. */}
              <Field
                label="Fabric Type"
                required={need.item_sub_type}
                w="term"
                className="w-full"
              >
                <Select
                  required={need.item_sub_type}
                  value={st.item_sub_type}
                  onChange={(e) => {
                    const next = e.target.value;
                    patchStruct(r.key, st.key, {
                      item_sub_type: next,
                      /* A TYPE THAT CONTRADICTS YARN-DYED CLEARS THE YARN
                         COLOURS. A BLANK ONE DOES NOT.

                         WHY CLEAR AT ALL: the cascading-filter rule's second
                         clause (AGENTS.md, "Cascading filters"). Yarn Color is
                         rendered only under Yarn Dyed, so on a Solid or a Melange
                         its stored names are a value the operator cannot see,
                         cannot edit and cannot remove — and the save payload
                         sends `yarn_colors` unconditionally, so they would go on
                         being written for ever. That is the inverse of AGENTS.md's
                         "requiring a hidden field" trap: a hidden field that keeps
                         writing.

                         AND THIS IS THE ONLY PLACE IT IS CAUGHT ON THE WAY IN.
                         0480 deliberately carries NO cross-column CHECK tying
                         `yarn_colors` to `item_sub_type`, because `item_sub_type`
                         is nullable and a constraint would make the ORDER the
                         operator fills two cells in decide whether the save
                         succeeds. `writeComboTree` normalises the same rule on
                         the server, so it is stated on both sides — and NEITHER
                         of them is the database. This line is load-bearing, not
                         belt-and-braces.

                         WHY A BLANK IS EXEMPT: **NULL IS A REAL STATE, NOT A
                         MISSING DEFAULT — "not answered" is not "answered
                         solid"**, which is the sentence this column already
                         carries in `types.ts`. Blanking Fabric Type to re-pick it
                         is an ordinary correction, and the `<Select>` has an empty
                         `<option>` the keyboard contract reaches. Clearing there
                         would destroy every yarn colour on the fabric at the same
                         instant the field vanished, so the operator would not see
                         it happen — they re-pick Yarn Dyed a second later and find
                         the list empty, with no undo and nothing on screen to
                         explain it. Silent loss on a routine keystroke.

                         THE COST, STATED: a structure whose Fabric Type is blank
                         may hold yarn colours the card does not display. They come
                         back into view the moment Yarn Dyed is re-picked, which is
                         the entire reason not to throw them away.

                         ONE SENTENCE, THREE WRITERS. `order-seed.ts` and
                         `writeComboTree` (actions.ts) both read
                         `subType && subType !== "yarn_dyed" ? [] : keep`; this is
                         that, so seed, screen and action cannot disagree. A screen
                         STRICTER than the guard behind it is the worst of the
                         three arrangements — the server is permissive precisely so
                         nothing is destroyed, and a strict screen destroys it
                         before the server is ever asked.

                         ON THE CHANGE, NEVER IN AN EFFECT — the rule `pickStyle`,
                         `pickComboStructure`, `carryDownGsm` and
                         `seedComboFromStyle` all already state on this screen. An
                         effect watching `item_sub_type` also fires when a SAVED
                         order is opened, so it would wipe the stored yarn colours
                         of every fabric on load, before the operator had touched
                         anything — and mark the amendment dirty for it.

                         RE-PICKING YARN DYED KEEPS THEM: the condition asks what
                         the NEXT type is, not whether the type changed, so a
                         no-op empties nothing. */
                      ...(next && next !== "yarn_dyed" ? { yarn_colors: [] } : {}),
                      /* AND THE PARTS' `color_name` IS NOT TOUCHED — DECIDED,
                         NOT OVERLOOKED (2026-08-31).
                         `patchStruct` writes only the keys named above, so this
                         is the default behaviour and costs no code. It is written
                         down because it is a deliberate choice between two
                         AGENTS.md rules that point OPPOSITE WAYS on this one
                         keystroke, and the next reader will otherwise "fix" it.

                         Switching a fabric TO Yarn Dyed turns every part's Colour
                         cell from a Combobox over the declared palette into a
                         plain text box, so a part holding WHITE now holds a value
                         its own control would no longer have offered.

                         "DISABLED ROWS" WINS: "the one row that survives is the
                         one the record already holds … Dropping it would show a
                         filled field as empty and blank the FK on the next save —
                         silent data loss dressed up as tidiness." The part keeps
                         WHITE, visible and editable, and the operator retypes it
                         as WHITE/BLUE STRIPE when they reach that part.

                         "CASCADING FILTERS" CLAUSE 2 LOSES, and saying which rule
                         lost is the point of this comment. That clause governs a
                         value the app can RE-DERIVE; a hand-entered colour cannot
                         be. Clearing every part on a mis-click would be
                         unrecoverable, and worse than unrecoverable here because
                         Colour is REQUIRED under Yarn Dyed — it would also block
                         Save with nothing to restore.

                         THE ACCEPTED COST, STATED: a stale solid colour CAN
                         therefore be saved on a yarn-dyed part. That is the
                         trade-off, not an oversight.

                         NOT AN INCONSISTENCY WITH THE LINE ABOVE, which clears
                         `yarn_colors` on the way out. Different answers because
                         the two values are in different positions: yarn colours
                         become invisible and uneditable, so they must not keep
                         writing; a part's colour stays on screen and is
                         hand-entered work, so it must not be destroyed. */
                    });
                  }}
                >
                  <option value=""></option>
                  {ITEM_SUB_TYPE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              </Field>
              {/*
                * ONE SLOT, ON THE FABRIC, ASKING WHAT THE TYPE CALLS FOR
                * (client 2026-08-20).
                *
                * Fabric Color and Fabric Print used to stand side by side on
                * every PART row, and `takesDyedColour` / `takesAllOverPrint`
                * meant at most one of them could ever be answered — so each
                * part carried a dead control, repeated down the list.
                *
                * Both are properties of the CLOTH. An all-over print is rotary:
                * the fabric arrives patterned, so every part cut from that roll
                * has it, exactly as every part of a piece-dyed fabric is the
                * colour it was dyed. Asking per part could only ever produce
                * the same answer N times.
                *
                * The pair of gates now decides which QUESTION this one slot
                * asks, which is what they were always really doing:
                * `takesAllOverPrint` → Print, `colourSourceFor` → Colour, and a
                * blank Fabric Type gets no slot at all — still the branch that
                * matters, still for the nominated-vendor reason.
                */}
              {/* THE AESTHETIC IS BACK ON THE PART, AND THE FABRIC ASKS NOTHING
                  (client 2026-08-20, screenshots 2403 · 2407: "we will color for
                  each and every component but now it's only show for those
                  single color fields which [is] wrong … same that fab print also
                  applicable for each component").

                  The comment above this describes the one-slot-per-fabric design
                  it replaces, and it is left standing on purpose — it is the
                  argument the client heard and overruled, twice, and a reader who
                  finds only the outcome will make it again.

                  What did NOT change: the Fabric Type still decides which LIST
                  each cell offers, and a blank one still narrows nothing. It
                  moved from choosing which question is asked to choosing what the
                  answer may be — which is the job the 2026-08-12 note says it was
                  always doing. (The two functions that did it were
                  `takesAllOverPrint` and `colourSourceFor`; on 2026-08-31 the
                  first was deleted with the `printed` option and the second was
                  superseded by `componentColourEntry`, which answers a third
                  state the first two could not express. Same statement, one
                  function.) */}
            </div>
            {/*
              * "YARN COLOR" — WHICH PRE-DYED YARNS THIS CLOTH IS KNITTED FROM
              * (client 2026-08-31, 0480).
              *
              * ONLY UNDER YARN DYED, because only there does the question mean
              * anything: a solid is piece-dyed after knitting and a melange takes
              * its colour from one purchased yarn, so neither has a SET of yarn
              * colours to name. The field appearing on those would be a box that
              * can be filled and can never be read — and the `<Select>` above
              * clears the value on the way out, so nothing is left behind it.
              *
              * ## WHY IT IS ON ITS OWN LINE AND NOT IN THE TRACK ABOVE
              *
              * Two independent reasons, and either one is enough:
              *
              * 1. THE ROW IS `items-end` AND THIS CONTROL IS NOT ONE CONTROL
              *    TALL. `MultiSelect` draws its chips BELOW its trigger, so its
              *    height grows with the number of colours picked. On an
              *    `items-end` row a taller field matches its BOTTOM to everyone
              *    else's and its label rides above every other label in the row —
              *    exactly the failure the GSM note a few lines up records
              *    (client screenshot 2397), which is why the derived Gsm Range
              *    was moved out of GSM's `Field` and given `row-start-2`.
              *
              * 2. THE TRACK IS A HAND-WRITTEN `grid-cols-[…]` OF FIVE, AND THIS
              *    FIELD IS CONDITIONAL. A sixth child would auto-place into row
              *    2 next to the Gsm Range; a sixth TRACK would sit empty on every
              *    fabric that is not yarn-dyed, which is the "trailing empty
              *    track is invisible in code review and obvious on screen"
              *    warning the track's own note leaves two fields up — it happened
              *    once already, when the withdrawn Colour slot left its column
              *    behind. The floors would also stop fitting: 150+170+72+72+130
              *    plus four gaps is already 642px against ~764px of content at
              *    the `lg` where the track switches on.
              *
              * A LINE OF ITS OWN COSTS NOTHING HERE because it only exists on a
              * yarn-dyed fabric, and it reads as what it is: a follow-up to the
              * Fabric Type that raised it.
              *
              * ## WIDTH: `name` (288px), THE WIDEST STEP THE SCALE HAS
              *
              * The trigger only ever says "N selected" and would fit anywhere;
              * what needs the room is the CHIP LIST underneath, which is the
              * control's only readable display of the answer. At `term` (176px)
              * — the width Structure, Composition and Fabric Type take — two
              * colour names already wrap to two lines and "GREY MELANGE" nearly
              * fills one on its own, so every colour past the first costs ~24px
              * of card height. 288px holds the ordinary two-colour stripe on one
              * line. It cannot cause the overflow reason 2 warns about: 288px is
              * less than half the track above it, so the card's width is still
              * set by that row.
              *
              * NOT `required` (AGENTS.md: "Marking a field `required` is no
              * longer cosmetic" — the `*` engages the cursor hold). The client
              * asked for the field, not for a fabric to become unsaveable
              * without it, and no such decision has been taken. Making it
              * required is a one-word change and a client question, in that
              * order.
              *
              * NOT `gridded`, and NOT `groupBy` — the Sizes field on the Style(s)
              * tab passes both and says why: sizes are 2-5 characters, which is
              * the whole case for a wrapping tick grid, and fifty-plus of them
              * need bands. Colour names are long and there are as many as this
              * order has colourways, so a grid would give one-word cells and a
              * banded list would band a list that fits on a screen.
              *
              * ## THE LITERAL IS RIGHT HERE, AND IT IS NOT THE DRIFT
              * `componentColourEntry` PREVENTS
              *
              * That function exists because the part's Colour cell asks THREE
              * questions at once — required, offered a list, offered nothing —
              * and three separate reads of the Fabric Type would drift apart.
              * This is a different question with one consumer: "does this fabric
              * have yarn colours to name at all". Routing it through
              * `componentColourEntry(...) === "manual"` would make the presence
              * of a control on the FABRIC depend on a rule about the PART, so a
              * later change to how a part states its colour would move this field
              * for no reason anyone could find. The one thing to keep true is
              * that the render gate and the `<Select>`'s clear-on-change name the
              * same value, which is why the clear lives on that control rather
              * than in an effect somewhere else.
              */}
            {st.item_sub_type === "yarn_dyed" && (
              <Field label="Yarn Color" w="name">
                {/* "Yarn Color" — the client's own word, singular, American
                    spelling, matching "Fabric Color" on the part rows beneath.
                    The repo spells it "Colour" in code identifiers
                    (`yarnColourOptions`, `colourEntry`) and "Color" in
                    operator-facing labels; both halves of that split are
                    deliberate and both are in this one field. */}
                <MultiSelect
                  compact
                  label="Yarn Color"
                  /* THIS ORDER'S OWN COLOURWAYS, SCOPED TO THE COMBO'S STYLE
                     (client: "it must dynamically list ONLY the colors
                     previously defined for the style's master colorways"). The
                     rule, including why a combo naming no style is offered
                     everything rather than nothing, is `yarnColourOptions` in
                     combo-rules.ts; `yarnColourOptionsFor` is only the memo. */
                  options={yarnColourOptionsFor(r)}
                  values={st.yarn_colors}
                  /* STORED AS TYPED — the option ids ARE the colour names (0480
                     stores `text[]`, because a colourway is free text at both
                     ends and there is no master row to point an FK at), so there
                     is nothing to resolve and nothing to reorder. The array
                     order is the order the operator ticked in, which is what the
                     Zod schema's own note says it preserves. */
                  onChange={(next) =>
                    patchStruct(r.key, st.key, { yarn_colors: next })
                  }
                />
              </Field>
            )}
            {/* ADVISORY, NOT A HOLD. "Circular Knit -> GSM compulsory" is a
                property of the CASE, so it cannot be a `required` prop — and it
                must not stamp `data-required-empty`, which would cage the
                operator on a row whose structure they are still choosing.

                AND NOT UNTIL THEY HAVE LEFT — see `structTouched`. An open row
                is one being filled in, so the complaint is premature by
                construction; the folded render below carries the same line for
                a row they have moved on from. */}
            {problems.length > 0 && structTouched.has(st.key) && (
              <p className="text-xs text-warning">{problems.join(" · ")}</p>
            )}
            </div>
            {componentGrid(r, st)}
          </div>
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
   * THE PAIR IS DOWN TO ONE (client 2026-08-20): "+ Add size" was withdrawn,
   * so only `ChildGrid`'s "+ Add style" reads this. Kept as a constant anyway —
   * the whole lesson below is that a floor tuned to one button and applied to
   * the other is wrong by luck, and that lesson is needed again the moment the
   * size button comes back (see `sizeGrid`, and this screen's habit of
   * reversing).
   *
   * Both read this when it was written — the hand-rolled button and
   * `ChildGrid`'s own via
   * `addClassName` — so the value no longer has to be CORRECT, only generous:
   * whatever it is, the two render the identical box, and a font change moves
   * them together. That is the same reason `createdColumns` and `keyFills` are
   * single declarations rather than matching pairs.
   */
  const ADD_BUTTON_W = "min-w-[6.75rem]";

  /**
   * `sizeGrid` WAS HERE AND IS GONE (client 2026-08-23, screenshot 2472: "same
   * ui like this … replace with it").
   *
   * It was a hand-rolled list of Size pickers laid ACROSS the line — its own
   * `data-grid-body`, a fixed span per size, a ✕ per size and, after 2026-08-20,
   * no "+ Add" at all. The sizes are now the Style master's `<MultiSelect>`
   * (see `componentsAndSizes`), which is the same control, on the same data,
   * drawn by the primitive.
   *
   * WHAT IS WORTH KEEPING FROM IT is one lesson and one warning:
   *
   *   - The 08-14 density complaint it answered is REAL and this replacement
   *     answers it better: one line per size was ~248px inside a cell whose
   *     siblings are 32px. A wrapping tick grid behind one box is that fixed
   *     without the line growing at all.
   *   - `ADD_BUTTON_W` above still exists and is now read by ONE caller. Its
   *     whole note is about a width floor tuned by eye to one of two buttons
   *     being wrong by luck; that lesson is needed again the moment a second Add
   *     button appears beside the styles grid's.
   *
   * `across` MODE IN `child-grid.tsx` CAME OUT OF THIS CODE and is still live —
   * the Style master's own history note points at the reasoning that used to be
   * written here. Deleting the copy does not delete the mode.
   */

  /**
   * The components offerable beside a Coordinate cell, on Order Info's own
   * Components grid (0457).
   *
   * `componentsForCoordinate` IS THE RULE and is not re-derived here — it is the
   * same function the Style master's identical cell calls, and it owns three
   * decisions this call site must not second-guess: a BLANK coordinate offers
   * EVERYTHING (deliberately the opposite of the nominated-vendor rule — read
   * the reasoning there before "fixing" it); the row's own value always survives
   * the filter; and it matches by NAME, because a coordinate is an `items` row
   * while the Components master stores plain text.
   *
   * IT NARROWS NOTHING TODAY — every component in the live master has
   * `all_coordinates = true` — and that is the design, not a gap. What made it
   * possible to call at all is the DATA half: `getComponentPickerRows` now
   * selects `all_coordinates` and the declared coordinate names, which it did
   * not before this grid existed. Calling the helper against rows that carry
   * neither is the shape AGENTS.md records twice (the item-report filter bar,
   * the `created_by` sweep): the rule looks wired, and the narrowing silently
   * never happens.
   *
   * DISTINCT FROM `scopedComponents` ABOVE, which narrows the COMBOS overlay to
   * the parts the picked style declares. There the style is the authority and
   * the overlay describes it; here this grid is what declares them.
   */
  /**
   * The approved samples this ORDER's customer has (0461).
   *
   * NARROWED ON THE SCREEN, NOT IN SQL — `getApprovedSampleRows` carries
   * `customer_id` and filters nothing, because the Customer is a header field
   * the operator is still choosing and a service filter would fix the list to
   * whichever customer was selected when the page was fetched. Same rule the
   * Style master's identical cell follows.
   *
   * A sample with NO customer stays offered (legacy rows predate 0422), and the
   * one the row already holds always survives — the standing "Disabled rows"
   * argument: a value dropped from the list renders a filled cell as empty and
   * blanks the FK on the next save.
   *
   * THE LIST IS EMPTY IN THIS DATABASE, which is why the cell is not `required`.
   */
  const samplesForCustomer = (held: string | null) => {
    const want = form.customer_id;
    if (!want) return data.samples;
    return data.samples.filter(
      (x) => x.customer_id === want || x.customer_id === null || x.id === held,
    );
  };

  /**
   * ...MINUS THE COMPONENTS THIS LINE HAS ALREADY SPOKEN FOR (client
   * 2026-08-31: "that selected component must be dynamically filtered out of
   * the selection dropdown list for row 2, row 3, and so on").
   *
   * `taken` IS OPTIONAL AND THE TWO CALL SITES DIFFER ON PURPOSE:
   *
   *  - the **Component cell** passes it, so a part already filed under this
   *    coordinate stops being offerable and the duplicate cannot be made;
   *  - the **Coordinate cell** does NOT, and that is not an oversight. It calls
   *    this to ask "is the component this row already holds still legal under
   *    the coordinate I am moving it to?" — a scope test, not an offer. Passing
   *    `taken` there would silently BLANK a filled component the moment its new
   *    coordinate already had one, which is the data loss AGENTS.md refuses
   *    under "Disabled rows". The duplicate that move creates is caught by
   *    `styleLineProblems` and said out loud on the row instead.
   *
   * THE HELD VALUE ALWAYS SURVIVES, twice over: `componentsForCoordinate` keeps
   * it and the filter below re-admits it. A row must never filter itself out of
   * its own list — the cell would render filled and then empty, and blank the FK
   * on the next save.
   *
   * THE RULE ITSELF IS `componentsTakenUnder` IN `lib/orders/styles/rules.ts`,
   * not written here: the same pair (coordinate, component) is what
   * `duplicateComponents` refuses at Save, and a dropdown that hid a different
   * set from the one the guard judges by would offer a click that lands on an
   * error — the exact shape the "Near misses" rule records for its chips.
   */
  const componentOptions = (
    coordinateId: string | null,
    held: string | null,
    taken?: ReadonlySet<string>,
  ) => {
    const offered = componentsForCoordinate(data.componentRows, {
      coordinateId,
      coordinates: data.coordinates,
      currentValue: held,
    });
    if (!taken || taken.size === 0) return offered;
    return offered.filter((o) => o.id === held || !taken.has(o.id));
  };

  /**
   * ORDER INFO ▸ STYLES DETAILS ▸ COMPONENTS — THE STYLE MASTER'S OWN GRID
   * (client 2026-08-23, screenshots 2471 · 2472: "i need this all with that
   * section same ui like this now its different replace with it").
   *
   * SECOND GENERATION, AND THE FIRST ONE IS WHY THIS IS A `ChildGrid`. The merge
   * landed the same DATA under a hand-rolled row: a `FieldRow` of three
   * `w="term"` cells with the column titles printed as `Field` labels on row 0,
   * a ghost ✕ and an outline "+ Add". Every part of that was defensible on its
   * own — it is what the Combos ▸ Structure Details row does, and it was copied
   * from there — and the result was a grid that did not look like the grid the
   * operator had just been using on the Style master: no bordered card, no `#`
   * column, no header band. Same fields, different furniture, one workflow.
   *
   * SO IT IS THE PRIMITIVE, IN ITS DEFAULT TABLE LAYOUT, with exactly the props
   * `style-master-screen.tsx` passes its Components grid — `columns`, `rows`,
   * `seedRow`, `onAdd`, `onRemove`, `addLabel`. Not a copy of that grid's LOOK:
   * the same component, so the `#` band, the frame, the ✕ and the "+ Add" inside
   * the card all come from one place and cannot drift apart again.
   *
   * IT IS ALSO ~90 LINES SHORTER, and that is the real argument. The hand-rolled
   * version had to stamp `data-grid-body`, `data-grid-row`, `data-row-remove`
   * and `data-row-add` itself and wire `gridKeyNav` by hand; `ChildGrid` does
   * all four. Every marker the keyboard contract depends on is now the
   * primitive's problem, which is the whole reason ~22 hand-rolled grids are
   * recorded in AGENTS.md as a standing hazard rather than a style choice.
   *
   * NO CAPTION — the section names it, and a caption would cost the grid a band
   * that the Sizes panel beside it does not have, so the two halves would start
   * at different heights. Same call the master makes.
   */
  /**
   * The coordinates offerable on a Components row (0461).
   *
   * THE ORDER'S OWN LIST, falling back to the whole GAR master while that list
   * is empty. The fallback is the same call `componentsForCoordinate` makes for
   * a blank coordinate and is deliberately the OPPOSITE of the nominated-vendor
   * rule: there the approval list IS the constraint and a full list is a
   * compliance hole; here the grid above simply has not been filled in yet, and
   * an empty dropdown would read as a broken screen.
   *
   * THE ROW'S OWN VALUE ALWAYS SURVIVES — the standing "Disabled rows"
   * argument: a coordinate dropped from the list renders a filled cell as empty
   * and blanks the FK on the next save.
   */
  const coordinateOptions = (r: StyleRow, held: string | null) => {
    const ids = new Set(r.coordinates.map((c) => c.coordinate_id).filter(Boolean) as string[]);
    if (ids.size === 0) return data.coordinates;
    return data.coordinates.filter((o) => ids.has(o.id) || o.id === held);
  };

  const componentColumns = (
    r: StyleRow,
  ): ChildGridColumn<StyleComponentRow>[] => {
    /* THE LINE'S ONE COORDINATE, on a PCS line (client 2026-08-29). Resolved
       ONCE for the whole column set rather than per cell: every row of this grid
       belongs to the same style line, so the answer cannot differ between them,
       and the three readers below must be looking at the same value. */
    const implied = impliedCoordinateId(r.unit_kind, r.coordinates);
    return [
    /*
     * NO `required` ON ANY COLUMN, AND THAT IS DELIBERATE RATHER THAN A MISS.
     * `ChildGridColumn.required` draws a star in the HEADER, which is a claim
     * about the column — every row must answer this. Requiredness here is a
     * property of the ROW (`componentRowStarted`): a blank row the operator has
     * just added is allowed to be blank, and a started one is not. A header star
     * would say the first case is an error, and the hold would disagree with it.
     * The Style master resolves it the same way, and its screenshot shows the
     * three headers unstarred while `2471`'s Coordinate column IS starred —
     * because there the column really is unconditional.
     */
    {
      header: "Coordinate",
      cell: (c) => (
        <RecordPicker
          label="Coordinate"
          compact
          required={componentRowStarted(c, implied)}
          /*
           * PRE-FILLED, NEVER LOCKED (client 2026-08-29: "it should [be]
           * clickable … user can update it … can't able to update, it is
           * automatic").
           *
           * ## THIS CELL WAS `disabled` FOR ONE AFTERNOON, AND THAT WAS A
           * ## MISREADING OF THE SPEC IT CAME FROM
           *
           * The Pcs rule arrived as: "the system automatically fetches and
           * pre-fills the single coordinate (Pcs) directly into each component's
           * coordinate field … because there is only one coordinate option, no
           * dropdown selection is required, and the user is spared from manual
           * cursor clicks."
           *
           * Every clause there is about SAVING KEYSTROKES. "No selection is
           * required" was read as "no selection is allowed", and it does not say
           * that — a default the operator cannot overrule is not a default, it
           * is a constraint, and nothing in the spec asked for one. The client
           * corrected it the same day, in those words.
           *
           * ## WHY THE DISTINCTION IS WORTH THIRTY LINES
           *
           * `disabled` and "pre-filled" look identical on a screen where the
           * value is already right — which is every screen anyone demonstrates.
           * They diverge only when the operator disagrees with the default, and
           * that is exactly the case a lock makes unrecoverable: a Pcs order
           * that turns out to need a second coordinate could be fixed by
           * re-answering Order Unit, but a component already filed under the
           * greyed PIECES could not be re-filed without it. The failure is
           * invisible during the demo and total afterwards.
           *
           * The keystrokes the client asked to save are still saved:
           * `setStyleCoordinate` back-fills every blank component row the moment
           * the line's one coordinate is picked, and `addStyleComponent` fills
           * each new row as it is added. What is gone is the greying.
           *
           * `implied` is still read one line above: a row holding ONLY the
           * auto-filled coordinate is not "started", so a freshly seeded row
           * does not hold the cursor as an unfinished one. That half was never
           * about locking and is unchanged.
           *
           * ## THE LIST STILL SCOPES TO THE ORDER'S OWN COORDINATES
           *
           * So on a Pcs line, whose Coordinates grid the client separately asked
           * to lock to one row, this picker opens on a list of exactly one. That
           * is a consequence of the grid rule, not of this one, and it is stated
           * rather than quietly fixed here: unlocking the grid is a change to a
           * different instruction and needs the client, not an inference drawn
           * from this sentence.
           */
          /* THE ORDER'S OWN COORDINATES, once it has any (0461) — the grid
             above this one. A component is a PART OF a coordinate, so offering
             the whole GAR master here would let a PO file a sleeve under a
             coordinate the garment does not have.

             THIS REPLACES THE UNSCOPED LIST, and only because the scope now
             exists on the order. Until 0461 there was nothing on the line to
             narrow by, and the cell deliberately offered everything rather than
             narrowing against the STYLE MASTER's list — which is what the Combos
             overlay does, and would have meant the order could only ever restate
             what the style already said.

             `coordinateOptions` falls back to the full master while the
             coordinate grid is empty, which is the "a blank parent offers
             everything" half of `componentsForCoordinate`'s rule and not an
             exception to it: an empty dropdown on a row the operator has just
             added reads as a broken screen.

             A `RecordPicker` and not the master's `ItemPicker`: that control
             withholds "+ Add" on purpose, because creating a GARMENT does not
             give the style that coordinate. */
          items={coordinateOptions(r, c.coordinate_id)}
          value={c.coordinate_id}
          onChange={(id) =>
            patchComponent(r.key, c.key, {
              coordinate_id: id,
              /* CLEAR A COMPONENT THAT FALLS OUT OF SCOPE, AND ONLY THEN — the
                 cascading-filter rule's second clause. Narrowing the coordinate
                 around a component that is still offered under it keeps it. */
              ...(c.component_id &&
              !componentOptions(id, null).some((o) => o.id === c.component_id)
                ? { component_id: null }
                : {}),
            })
          }
        />
      ),
    },
    {
      header: "Component",
      cell: (c) => (
        <RecordPicker
          label="Component"
          compact
          /* SAME PREDICATE, SAME ARGUMENT as the Coordinate cell beside it and
             as `addStyleComponent`'s decline. A row born holding only the PCS
             pre-fill is not started, so this cell does not demand an answer on a
             row the operator has just added and the save is going to drop. */
          required={componentRowStarted(c, implied)}
          /* THE SIBLINGS, NEVER THIS ROW — `.filter((x) => x.key !== c.key)` is
             what stops the cell hiding the value it is currently showing. See
             `componentOptions`. */
          items={componentOptions(
            c.coordinate_id,
            c.component_id,
            componentsTakenUnder(
              r.components.filter((x) => x.key !== c.key),
              c.coordinate_id,
            ),
          )}
          value={c.component_id}
          onChange={(id) => patchComponent(r.key, c.key, { component_id: id })}
        />
      ),
    },
    {
      header: "Structure",
      cell: (c) => (
        /* A FABRIC CATEGORY — SINGLE JERSEY, 1X1 LYCRA RIB (0405), not the knit
           family one level up. `structureItems` is the same list the Combos
           overlay's Structure cell offers, so the two cannot disagree about what
           a structure is.

           NOT REQUIRED, matching the master: a component can be named before the
           fabric it is cut from is decided, and holding the cursor here would
           refuse an order for an answer the buyer has not given yet.

           PICKING IT FILLS THE HIDDEN "Type" beside it — a FETCH, not a
           correlation: `categories.fabric_structure_id` is declared on the
           Category master. `?? c.comp_type` is what makes a category with no
           structure LEAVE the value alone rather than blank one that arrived
           with the seed, and it runs ON THE CHANGE, never in an effect — an
           effect keyed on the category would fire when a saved order is OPENED
           and overwrite every stored Type on load. */
        <RecordPicker
          label="Structure"
          compact
          items={structureItems}
          value={c.fabric_category_id}
          onChange={(id) =>
            patchComponent(r.key, c.key, {
              fabric_category_id: id,
              comp_type: compTypeFor(id) ?? c.comp_type,
            })
          }
        />
      ),
    },
    ];
  };

  /**
   * ORDER INFO ▸ STYLES DETAILS ▸ COORDINATES (client 2026-08-23, screenshot
   * 2471).
   *
   * WHAT A COMPONENT IS A PART OF. The Style master lists these first and its
   * Components grid narrows on them; the order had no such list, so its
   * Coordinate cell offered the whole GAR master and a PO could file a sleeve
   * under a coordinate the garment does not have. This is that list, and wiring
   * it is what turned `coordinateOptions` from a pass-through into a scope.
   *
   * THE MASTER'S OWN PROPS, for the reason the Components grid beside it takes
   * them: `narrow` (one short column — this is the one grid where column COUNT
   * really is the right test), `frameless` (it sits inside the style row's card
   * and a second border would be the "too much frames" the client cut back on
   * 2026-08-18), `seedRow` so Tab has a field to land on.
   *
   * `hideAdd` AT THE STYLE'S LIMIT, not a silent decline. `coordinateLimit` is
   * the Style master's rule — Piece is one coordinate, Set is several — read
   * through the picked style's `unit_kind`, the same value the Order Unit cell
   * prints. `addStyleCoordinate` refuses too, which is what stops the KEYBOARD
   * getting past a hidden button; the two agree because both read the one
   * function.
   */
  const coordinatesGrid = (r: StyleRow) => {
    /**
     * SETTLED — a PCS line holding its one coordinate.
     *
     * ## IT GOVERNS THE ✕ AND NOTHING ELSE NOW (client 2026-08-29, screenshot
     * ## 2544: "just release")
     *
     * It arrived reading the instruction "the coordinates grid displays exactly
     * one row and disables any manual adding, editing, or deletion of
     * coordinates" as three locks, and greyed the picker as well. The client
     * corrected the EDITING half the same day, twice — here and on the Style
     * Components cell — so what survives is the third clause only.
     *
     * The three clauses do not stand or fall together, and it is worth saying
     * why this one is not the same kind of rule as the one that went:
     *
     *   - **adding** is `hideAdd` above, and it is the STYLE MASTER's cap
     *     (`coordinateCap`: a Piece garment has one coordinate, a Set has
     *     several), not this instruction. Untouched either way.
     *   - **editing** was a cage. PIECES is a default; overruling a default is
     *     the operator's business, and greying it made a Pcs line unrepairable
     *     from the screen. Gone.
     *   - **deletion** is not a preference — removing the one coordinate drops
     *     the line to zero, which `styleProblems` already refuses ("A Piece
     *     style needs exactly 1 coordinate") and which orphans every component
     *     the back-fill just filed under it. Hiding the ✕ stops a click whose
     *     only outcome is an error the operator then has to undo. Kept.
     *
     * NARROWER THAN THE INSTRUCTION READS, deliberately, and this half is
     * unchanged — `coordinatesLocked` is false while the line is over its cap or
     * has no coordinate at all, so a line switched to PCS with TOP and BOTTOM
     * already on it keeps its ✕ and the operator can delete one. Hiding it THERE
     * would leave a line `styleProblems` refuses to save with no way on screen
     * to fix it. The function's own note carries the full argument.
     */
    const locked = coordinatesLocked(r.unit_kind, r.coordinates);
    return (
      <ChildGrid<StyleCoordRow>
        narrow
        /* `frameless` — this grid sits inside the style row's card and inside
           its own `<Field>`, so the grid card would be a second border on the
           same panel. Restored with the frame itself on 2026-08-27.

           THE COMPOSITION LAYOUT (`inlineCards` + `flushRows`) WAS TRIED HERE
           and is withdrawn with it. It was the answer while no grid drew a
           frame — a shared header and light rules were the only structure
           available. With the card, the row box and the field all back, this
           grid reads like every other one again, which is what "same for all"
           asks for. */
        frameless
        columns={[
          {
            header: "Coordinate",
            cell: (c) => (
              /* NOT `required`. On the master it is required once a component
                 row is started, because there a coordinate is what a component
                 hangs off. Here the grid is a list in its own right and its
                 seeded blank row is the state an operator opens on — a hold
                 there would fire on a field nobody has looked at. What the
                 blank row costs is nothing: `normalizeStyleCoordinates` drops
                 it. */
              <RecordPicker
                label="Coordinate"
                compact
                /* NEVER GREYED — SEEDED, AND STILL YOURS TO CHANGE (client
                   2026-08-29, screenshot 2544: "if choose the PCS it
                   automatically choosing coordinate field PIECES automatically,
                   just RELEASE, no need to choose there").

                   Both halves of that sentence are kept and they are not in
                   tension: "no need to choose" is the SEEDING, which stands —
                   answering Order Unit still writes PIECES here and the operator
                   never has to pick it. "Just release" is the GREYING, which
                   goes. A default nobody can overrule is not a default.

                   THIS IS THE SECOND CELL TO LOSE THE SAME LOCK ON THE SAME DAY,
                   which is what makes it a rule rather than a fix: the Style
                   Components grid's Coordinate cell was `disabled` for one
                   afternoon on the identical misreading of the identical
                   sentence ("no dropdown selection is required" read as "no
                   selection is allowed"), and its own note carries the argument
                   in full. Wherever this spec says a value arrives without being
                   asked for, it is describing a PREFILL. Do not re-grey either
                   cell without a new instruction that uses the word. */
                /* The whole GAR master, minus the ones this style already
                   lists: picking the same coordinate twice says nothing the
                   first row did not, and `uq_goa_style_coords_coordinate`
                   refuses it at save time. Offering it and then failing the
                   save is the shape a `usedIds` list exists to prevent. */
                items={data.coordinates.filter(
                  (o) =>
                    o.id === c.coordinate_id ||
                    !r.coordinates.some(
                      (x) => x.key !== c.key && x.coordinate_id === o.id,
                    ),
                )}
                value={c.coordinate_id}
                /* NOT A BARE `mutCoords` — see `setStyleCoordinate`. Picking the
                   one coordinate of a PCS line is what supplies the value every
                   blank component row is waiting for, and the two writes are one
                   update so no render can land between them. */
                onChange={(id) => setStyleCoordinate(r.key, c.key, id)}
              />
            ),
          },
        ]}
        rows={r.coordinates}
        /* HIDDEN THE MOMENT THE LINE HOLDS ITS ALLOWANCE OF ROWS — so a PCS
           line, whose allowance is one and whose one row the grid seeds, never
           shows it at all (client 2026-08-29, screenshot 2545: "if I choose
           order unit as PCS, no need to '+ Add coordinate' option — hide it,
           because it is only one for the order unit PCS").

           `coordinatesFull` and nothing spelled out here, because
           `addStyleCoordinate` reads the SAME function: a hidden button that the
           keyboard can still reach is the disagreement this file has had to fix
           twice, and one predicate is what makes it impossible. Its own note
           carries why the count is of ROWS rather than of filled ones. */
        hideAdd={coordinatesFull(r.unit_kind, r.coordinates)}
        /* NO ✕ ON A SETTLED PCS LINE. Removing the one coordinate drops the
           line to zero, which `styleProblems` refuses ("A Piece style needs
           exactly 1 coordinate") and which orphans every component the
           back-fill just filed under it. The grid's own Ctrl+Del reads the same
           flag, so the keyboard cannot get past a hidden button — the same
           agreement `hideAdd` and `addStyleCoordinate` already have. */
        hideRemove={locked}
        seedRow
        onAdd={() => addStyleCoordinate(r.key)}
        onRemove={(c) =>
          mutCoords(r.key, (cs) => cs.filter((x) => x.key !== c.key))
        }
        addLabel="+ Add coordinate"
      />
    );
  };

  /**
   * COMPONENTS AND SIZES, SIDE BY SIDE — the Style master's section, verbatim
   * (client 2026-08-23, screenshot 2472).
   *
   * A 6/6 `FieldGrid`: the parts on the left, what they are cut in on the right.
   * The master's own note calls that reading "left is what the garment is made
   * of, right is what it is made in", and it is why this is one line of the
   * style row rather than two — the previous cut stacked Sizes above Components
   * as two `full` lines, which is the same content and a different shape.
   *
   * A NESTED `FieldGrid`, because the row's body is a `FieldRow` — a flex line,
   * where `size` resolves to a `col-span-*` that has no track to land on. The
   * spans only mean anything inside `@container/section` + `FIELD_TRACK`, which
   * is exactly what `FieldGrid` establishes. `w-full` on the wrapper is what
   * makes the pair take the whole line in the flex row above it; that is stated
   * rather than inherited, because the old `size="full"` was relying on a
   * col-span in a container that has no columns.
   */
  /**
   * COORDINATES · COMPONENTS · SIZES — three cells of the style row's OWN
   * fourteen-column track (client 2026-08-24, option B of the alignment
   * proposal).
   *
   * A FRAGMENT, NOT A GRID OF ITS OWN. These sat inside a nested `FieldGrid` in
   * a wrapper cell until now, which meant two tracks and two places to disagree
   * about one row. Returned loose, they are cells of the SAME grid as the seven
   * fields above them — so the left edge of Coordinates lands under the left
   * edge of Style and stays there at every width. That is the whole point of the
   * change: the row had no track at all before, and a nested one would only have
   * aligned these three with each other.
   *
   * 3 + 8 + 3 = 14, and the shares are not equal because the three are not
   * alike. Components is the only real TABLE — three pickers and a remove
   * button per line — while Coordinates is one short dropdown and Sizes is a
   * single box whose control caps itself at 280px however much width it is
   * given. Equal shares is what the previous cut did (`lg` x 3 = 18 of 12), and
   * it left Sizes wrapping onto a line of its own with six columns empty.
   */

  const componentsAndSizes = (r: StyleRow) => (
    <>
      {/*
        * SPLIT IN TWO (client 2026-08-27, screenshot 124618: "add split screen -
        * coordinate and size in one, and that three-field centre section in
        * another one side").
        *
        * WAS THREE CELLS, NOW TWO PANES. Coordinate | Components | Sizes put the
        * table in the MIDDLE, so the two short controls that describe the style
        * sat on opposite sides of it with the widest thing on the screen between
        * them. They belong together: the Coordinate list is what scopes the
        * Coordinate column inside Components, and Sizes is the other axis of the
        * same style.
        *
        * 6 + 8 = 14, and COMPONENTS DOES NOT MOVE. It keeps `xl` and the exact
        * width it had; only the left pane grows from 3 to 6 by absorbing Sizes
        * from the right. That is what makes this a re-grouping rather than a
        * re-proportioning - nothing about the table changes.
        *
        * STILL CELLS OF THE STYLE ROW'S OWN TRACK, which is the 2026-08-24
        * decision this must not undo: the panes are two spans of the same
        * fourteen columns the seven fields above use, so the left edge of
        * Coordinate still lands under the left edge of Style. A nested
        * `FieldGrid` here would be a second track and a second place to
        * disagree - the note that removed one already says so.
        *
        * SIDE BY SIDE INSIDE THE PANE, NOT STACKED (client 2026-08-27,
        * screenshot 2516: "coordinate and size on the same row, not the next
        * row"). The first cut used `space-y-3`, which put Sizes on the line
        * BELOW Coordinate and left the pane twice as tall as the table beside
        * it — grouping them had turned into stacking them.
        *
        * `grid-cols-2` splits the pane's six columns into three and three,
        * which is the width each of these two had when they were separate cells
        * of the outer track. So they end up their original size, next to each
        * other, with the table on the other side of the split — which is what
        * the request actually asks for.
        *
        * `items-start` because they are different heights: Coordinate carries a
        * grid and an "+ Add" button, Sizes is one box. Without it the shorter
        * one stretches and its control floats in the middle of a tall cell.
        *
        * Their own `size` no longer positions them: a `col-span` is inert
        * outside the track it names, so they are `full` to say "take your half
        * of the pane" rather than carrying a number that reads as a column
        * count and is not one.
        */}
      {/**
        * TWO PANES ON THE ROW'S OWN 14-COLUMN TRACK — 6 + 8.
        *
        * This is the 2026-08-27 arrangement, restored the same night it was
        * replaced. For one evening the line held FOUR panes (Coordinate | Sizes
        * | Components | Process) laid out with `flex-wrap` and per-pane bases,
        * because the client asked for the Process grid inline as a fourth
        * section; they then asked for the [Click] button back and for the pane
        * to go, which leaves this.
        *
        * ## WHAT THAT EVENING ESTABLISHED, AND IS WORTH KEEPING
        *
        * **The pane is ~1300px, and the way to measure it is to make it wrap.**
        * A screenshot cannot answer this — display scaling and browser zoom both
        * scale the image, so one picture is consistent with a 1240px pane and a
        * 1550px one, and the rendered widths fit either model because the line
        * fills its container in both. Successive flex bases bracketed it:
        * 1432 wrapped, 1336 wrapped, 1224 fitted.
        *
        * **`ChildGrid` stops being a table below a 512px container** and becomes
        * stacked cards, which carry no column headers. Two tables therefore cost
        * 1024px of a line before either holds anything, which is why four panes
        * never fitted comfortably here and why the pickers were down to ~112px
        * when they did.
        *
        * **Bases decide wrapping; grow decides sharing.** Only the first can
        * create room, only the second can move it between panes. Lowering a
        * basis on a line that already fits frees nothing.
        *
        * A future ask to put a third grid on this line should start from those
        * three facts rather than re-deriving them.
        */}
      {/**
        * THREE COLUMNS: COORDINATE · COMPONENTS · PROCESS.
        *
        * Sizes used to sit here beside Coordinate and now sits in the field row
        * above — its own column note carries why they were never really a pair.
        * What it paid for is this line's fourth section.
        *
        * ## THE ARITHMETIC, WHICH IS THE WHOLE DESIGN
        *
        * The pane is ~1300px, MEASURED — successive flex bases bracketed it
        * (1432 wrapped, 1336 wrapped, 1224 fitted) after two wrong answers read
        * off screenshots. A screenshot cannot settle this: display scaling and
        * browser zoom both scale the image, so one picture is consistent with a
        * 1240px pane and a 1550px one.
        *
        * **`ChildGrid` stops being a table below a 512px container** and becomes
        * stacked cards, which carry no column headers. Two tables therefore cost
        * 1024px before either holds anything, and what is left over is what the
        * third column can be:
        *
        *      Coordinate   flex-[1_1_220px]   220px
        *      Components   flex-[4_1_32rem]   512px
        *      Process      flex-[4_1_32rem]   512px
        *                                     -----
        *                    plus two 12px gaps = 1268px, inside ~1300
        *
        * **32rem IS THE CLIFF ITSELF, NOT A NUMBER NEAR IT.** Setting the basis
        * to exactly the threshold makes the wrap fire at the last width where
        * both are still TABLES — a pixel narrower and Process drops to a line of
        * its own, where it gets the width back. The constraint and the
        * declaration are the same number, so there is no arithmetic to get wrong.
        *
        * BASES DECIDE WRAPPING; GROW DECIDES SHARING. Only the first can create
        * room; only the second moves it between panes. Lowering a basis on a
        * line that already fits frees nothing — it just hands the slack to a
        * neighbour, which is how Process once rendered at 281px and lost its
        * headers.
        *
        * ## WHAT THIS COSTS, STATED
        *
        * Components goes from 738px to ~520. Its three pickers drop from ~200px
        * to ~144px each and lean on the `Truncated` reveal for values like
        * SINGLE JERSEY. That is the price of the fourth section and it is the
        * smallest version of that price available at this pane width — the
        * alternative that keeps Components roomy is moving Coordinate up too,
        * and a list with its own "+ Add coordinate" button does not belong in a
        * row of single-line fields.
        */}
      <div className="flex flex-wrap items-start gap-3 @lg/section:col-span-14">
      <div className="min-w-0 flex-[1_1_220px]">
      <Field label={<span className={GRID_HEADER_TEXT}>Coordinate</span>} size="full">
        {/* THE HAND-ROLLED FRAME IS GONE (2026-08-27). It was added on "add the
            border for the coordinate section" (screenshot 2519) while
            `GRID_FRAME` did not exist, and its own note said the classes "must
            keep matching" the primitive's. The grid card has since been restored
            app-wide, so `ChildGrid` draws that border itself and this would be
            the second one — which is the doubling the note was written to
            prevent. One frame, drawn in one place. */}
        {coordinatesGrid(r)}
      </Field>
      </div>
      {/* SIZES, BACK BESIDE COORDINATE. It spent one edit up in the field row,
          on the reasoning that a single trigger is a field rather than a grid.
          True, and beside the point: the client's four sections are the ones on
          THIS line, and the fourth is a button — which costs ~150px, not the
          512px a second grid would have. Nothing had to move to make room. */}
      <div className="min-w-0 flex-[1_1_220px]">
        <Field label={<span className={GRID_HEADER_TEXT}>Sizes</span>} size="full">
        <MultiSelect
          compact
          label="Sizes"
          /* REQUIRED SINCE 2026-08-31 (client). Per STYLE ROW, which is the
             semantics the client chose for this whole family: a style that
             exists must name at least one size; a style row that does not exist
             demands nothing. `MultiSelect` owns its own `required` (it draws its
             own label), and `useRequiredHold` ORs it with any surrounding
             `<Field required>` — so it is declared HERE and not on the `<Field>`
             above, which wraps a heading rather than the control.
             "Blank" for a multi-select is an EMPTY SELECTION, so the hold
             releases as soon as one size is ticked rather than demanding a
             complete range. */
          required
          /* FRAMED, to match the Components table across the row — the same
             `GRID_FRAME` that grid draws, so the two cannot drift. A bordered
             table on the left and a bare label-and-input on the right reads as
             something that failed to render, not as a deliberate difference
             (client 2026-08-18, on the master). */
          framed
          /* Sizes are 2-5 characters, which is the whole case for the wrapping
             tick grid: ~40 visible at once instead of 8, and ↑/↓ move a row
             while ←/→ move a cell. */
          gridded
          /* BANDS, DERIVED FROM THE NAMES. At fifty-plus sizes one label stops
             meaning one thing — `M` is Medium AND `3M` is three months — and a
             flat list has nothing to tell them apart however well it is sorted.
             Derived rather than read from Size Groups because there is ONE size
             group in this database; see `size-order.ts`. */
          groupBy={(o) => sizeFamily(o.label)}
          options={sizeOpts.map((o) => ({
            id: o.id,
            label: o.name,
            inactive: isInactive(o),
          }))}
          values={r.sizes.map((z) => z.size_id).filter(Boolean) as string[]}
          /* Rows are REUSED where the id survives, never rebuilt wholesale: a
             fresh `key` on every tick would remount the row and throw away
             anything it is carrying. Order IS the data here — `sno` is stamped
             from this array at save — so the order sizes were ticked in is the
             order they store in. */
          onChange={(next) =>
            mutSizes(r.key, (zs) => {
              const held = new Map(
                zs.filter((z) => z.size_id).map((z) => [z.size_id as string, z]),
              );
              return next.map((sid) => held.get(sid) ?? { key: newKey(), size_id: sid });
            })
          }
          /* grid-caption: exempt -- placeholder-blank: exempt -- this names a
             CAUSE ELSEWHERE, the stated survivor of both rules: an operator
             facing an empty list otherwise cannot tell a broken dropdown from a
             Sizes master nobody has filled in yet, and the fix is on a different
             screen. */
          emptyLabel="No sizes in the Sizes master yet"
          /* A SIZE TYPED HERE IS STORED IN THE SIZES MASTER, not kept as loose
             text on this order — the standing icon-field rule. `createLookupValue`
             is the shared door: it checks `masters:create` server-side (the gate
             below only hides the affordance) and parses through the Lookup
             master's own Zod schema, so `capsName()` applies and "xxl" is stored
             as "XXL". Hence the label comes back from the transform, not from
             what was typed. */
          onCreate={
            masterPerms.canCreate
              ? async (name) => {
                  const res = await createLookupValue("size", name, null);
                  return res.ok
                    ? { id: res.id, label: capsName().parse(name) }
                    : { error: res.error };
                }
              : undefined
          }
        />
        </Field>
      </div>
      <div className="min-w-0 flex-[6_1_32rem]">
      {/* `size="full"`, and it is INERT — a `col-span` does not resolve outside
          the track it names, and the parent here is a flex row. It stays as the
          honest "take this cell whole", the same thing Coordinate and Process
          say beside it. It was `xl` (8 of 14) while this was a grid item; a
          reader who finds that number elsewhere is holding the pre-flex layout.
          `label=""` is NOT an oversight: it reserves the label row so this
          table's header band starts level with the two labelled cells. */}
      <Field label="" size="full">
        <ChildGrid<StyleComponentRow>
          columns={componentColumns(r)}
          rows={r.components}
          /* OPENS ON A ROW rather than on a bare button. `ChildGrid`'s own note
             is the reason and it is the keyboard contract, not a preference: Tab
             lands on FIELDS, so a grid whose only affordance is "+ Add" has
             nothing to tab into and nothing to stand on and press Enter. The
             master passes it for the same reason. */
          seedRow
          onAdd={() => addStyleComponent(r.key)}
          onRemove={(c) =>
            mutComponents(r.key, (cs) => cs.filter((x) => x.key !== c.key))
          }
          addLabel="+ Add component"
        />
      </Field>
      </div>
      {/**
        * PROCESS — THE [Click] BUTTON AS THE FOURTH SECTION (client 2026-08-29:
        * "just that process single click field, not like this full").
        *
        * ## THE WHOLE THREAD TURNED ON THIS ONE WORD
        *
        * "Move Process to this row as a fourth section" was read as moving the
        * GRID here, and that is what made it hard: a second `ChildGrid` needs
        * 512px before it stops being a table, two tables cost 1024px of a
        * ~1300px line, and everything else was squeezed to ~112px to pay for it.
        * Coordinate and Sizes were stacked, then split, then shrunk; `wide` was
        * added and withdrawn; the pane's real width had to be measured by
        * watching flex wrap.
        *
        * **THE BUTTON COSTS 150px AND NONE OF THAT APPLIES.** It shows a value
        * (`3 processes`) or an invitation (`Click`), and the grid it opens gets
        * a 1112px modal where it has always fitted. Four sections on the line,
        * nothing squeezed, no cliff anywhere near it.
        *
        * The lesson is not about CSS: the expensive part was solving for the
        * wrong artefact. "The Process field" meant the control, not the table
        * behind it, and one screenshot of the button would have said so.
        *
        * ## IT IS OFF THE FIELD ROW ABOVE, WHICH IS WHERE IT SAT ALL DAY
        *
        * There it was the seventh of eight cells — a `<Button>` reading "Click"
        * in a line of `<Input>`s, which is the placement the client objected to
        * on 2026-08-29 ("the functioning is right but the UI placing needs an
        * update"). Here it sits with the other three things that describe how
        * the garment is BUILT, and its 144px go back to Description.
        *
        * GATED THROUGH `processGateReason`, the same function the sheet's own
        * empty state would use — one rule, so the tooltip and any other reader
        * cannot word it differently.
        */}
      <div className="min-w-0 flex-[0_1_9.5rem]">
        <Field label={<span className={GRID_HEADER_TEXT}>Process</span>} size="full">
          {(() => {
            const blocked = processGateReason(r);
            const started = r.processes.filter(styleProcessRowStarted).length;
            return (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-full"
              disabled={!!blocked}
              /* NAMES THE FIELD THAT TURNS IT ON rather than greying out in
                 silence — the rule the Assort gate states. A disabled control with
                 no reason is a dead end the operator has to guess their way out
                 of. */
              title={blocked ?? undefined}
              /* Captures the button's own rect so the sheet scales out of THIS
                 row rather than out of the middle of the screen — see
                 `processOrigin`. `currentTarget` and not `target`: the click can
                 land on the text node inside the button. */
              onClick={(e) => {
                setProcessOrigin(e.currentTarget.getBoundingClientRect());
                setProcessForKey(r.key);
              }}
            >
              {started ? `${started} process${started === 1 ? "" : "es"}` : "Click"}
            </Button>
            );
          })()}
        </Field>
      </div>
      {/**
        * FILES — THE FIFTH SECTION, AND THE STYLE'S OWN (client 2026-08-31):
        * "the Add File control is relocated from the general order header
        * directly into the Style section. This reflects the logic that technical
        * packs, design sketches, or specification images belong to the specific
        * garment style … mandatory before the style profile can be saved".
        *
        * PER STYLE ROW, not per style section — the user's explicit choice.
        *
        * ## WHY IT IS ON THIS LINE AND NOT ON THE FIELD ROW ABOVE
        *
        * That is where it would naturally go, as a ninth `styleColumns` cell, and
        * the arithmetic refuses it. The eight fields there measure ~1,008px
        * including gaps against a MEASURED ~1,229px pane, and Description is a
        * `flex-[1_1_7rem]` — 112px is the floor `flex-wrap` tests against, so the
        * row has ~100px of slack and no more. A ninth cell at the narrowest
        * declared width (`num`, 72px) plus its gap leaves ~25px, and the 08-27
        * note above records 30px being exactly what tipped this row: picking a
        * SIZE added chips, the pane gained a scrollbar, and Description wrapped
        * in front of the client. So a ninth field there is not tight, it is the
        * bug that was just fixed.
        *
        * THIS LINE HAS THE ROOM, and 08-29's arithmetic is why: Coordinate 220 +
        * Components 512 + Process 152 plus gaps is ~920px in a ~1,300px pane. One
        * more `9.5rem` pane costs 164px with its gap and lands at ~1,084 —
        * comfortably short of the 1,224 that was measured to fit, and short of the
        * 1,336 that was measured to wrap.
        *
        * It also belongs here by meaning: this line holds the four things that
        * say how the garment is BUILT, and a tech pack is the document that says
        * exactly that.
        *
        * ## THE MANDATORY HALF IS DECLARED IN TWO PLACES, ON PURPOSE
        *
        * `<Field required>` draws the star and puts requiredness in context;
        * `required` on the control is what `useRequiredHold` ORs with it to emit
        * `data-required-empty`. Both, or the screen ships a star with nothing
        * behind it — the star/hold divergence AGENTS.md's "one declaration, four
        * enforcers" exists to make impossible, and the trap this whole grid is
        * already subject to because `renderMobileRow` skips ChildGrid's own
        * `RequiredScope`.
        *
        * THE HOLD IS NOT THE WHOLE RULE, and cannot be. A folded style row
        * UNMOUNTS this cell, so there is no `data-required-empty` node to hold
        * anything — and Save has to refuse a folded row just as firmly as an open
        * one. That is `styleFileProblems` in the `validity` block, which is what
        * deadens Save, counts on the rail badge and gives a blocked Save
        * somewhere to jump to. The hold is the courtesy; the validity entry is
        * the guard, exactly as `useDuplicateName` is to `checkDuplicateName`.
        *
        * ## GATED ON THE STYLE HAVING A NAME
        *
        * `style_ref_no` is the join key (0479), so a file attached to an unnamed
        * row would be saved with a null ref and demoted to an order-level
        * document — silently detached from the line it was uploaded against.
        * `filesForStyle` already refuses to key on `""`; disabling the control
        * says so instead of letting the operator do work that will not stick, and
        * the `title` names the field that turns it on, which is the rule the
        * Process gate beside it states.
        *
        * DISABLED ALSO TAKES IT OFF THE ROW AXIS — `ROW_FIELDS` (child-grid.tsx)
        * excludes `[data-field-trigger][disabled]` — so an unnamed row's Tab path
        * is exactly what it was before this cell existed, rather than gaining a
        * stop the operator cannot use.
        *
        * ## IT IS NOW THE ROW'S LAST FIELD, AND TWO RULES MEET ON IT
        *
        * Process is a bare `<Button>` and is not on the field axis, so this
        * trigger is the last field-like node in a style row. That makes it the
        * one `gridKeyNav` reads for "is this row still blank?" through
        * `data-field-empty` — the guard that stops Enter spawning a run of blank
        * child rows off an unanswered picker.
        *
        * The two answers AGREE, and it is worth saying so because they were
        * written years apart for different reasons: while no file is attached the
        * cell is holding the cursor anyway (`data-required-empty`), so Enter never
        * gets as far as the guard; once one is, `data-field-empty` reads "false"
        * and Enter reaches "+ Add style" exactly as it did before. Neither rule
        * has to know about the other, and there is no state where one refuses
        * while the other allows.
        */}
      <div className="min-w-0 flex-[0_1_9.5rem]">
        <Field
          label={<span className={GRID_HEADER_TEXT}>Files</span>}
          required
          size="full"
        >
          <FileAttachments
            variant="cell"
            /* The label the HOLD announces, and the trigger's `aria-label`. The
               `<Field>` label is a ReactNode (it carries `GRID_HEADER_TEXT`), and
               `useRequiredHold` falls back to "This field" for one of those — so
               the word is stated here or the operator is told "This field is
               required." on a line with five of them. */
            label="Files"
            required
            rows={filesForStyle(r)}
            onChange={(next) => setStyleFiles(r, next)}
            styleRefNo={r.style_ref_no.trim() || null}
            bucket="garment-order-docs"
            folder={editId ?? uploadFolder}
            disabled={!perms.canEdit || !r.style_ref_no.trim()}
            disabledReason={
              !r.style_ref_no.trim() ? "Name a style on this row first." : undefined
            }
          />
        </Field>
      </div>
      </div>
    </>
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
        /* keepOne — an order with no style line is not an order; it cannot be
           costed, planned or manufactured, and every downstream tab keys off
           these lines (the Prices groups are seeded FROM them). See the prop in
           `child-grid.tsx`: it withholds the ✕ from the sole survivor, and
           Ctrl+Del declines with it because both read `locked`. */
        keepOne
        /* grid-caption: exempt -- Order Info and Style(s) are ONE merged section, and its title names the header
           fields, not this grid. */
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
        /* rameless — the section already draws a card and this grid's own
           would be a second border around the same rows. Restored with the
           grid frame itself on 2026-08-27. */
        frameless
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
        pageSize={5}
/**
         * THE CAP IS BACK, GATED ON THE VISIBLE TOGGLE (client 2026-08-19,
         * screenshot 2381: "default it's a single style; only if the user
         * enables Multi Style, enable the add style option — but now it's
         * defaulty showing the add style").
         *
         * THIRD GENERATION, and the two before it are kept in full below
         * because each was right about the screen it was written for:
         *
         *   gen 1  `hideAdd={!form.mult_ord && styles.length >= 1}` — the cap.
         *   gen 2  no cap at all; `addStyle` SET `mult_ord` when it added a
         *          second line (2026-08-17), because the only route to a second
         *          style was hunting for a toggle in the header, and the grid's
         *          badge had to carry an instruction pointing at it.
         *   gen 3  the cap again, `hideAdd={!form.mult_ord}` — because gen 2's
         *          complaint has EXPIRED. "Multi Style" is now a labelled toggle
         *          in the header row directly above this grid (screenshot 2381),
         *          one field away from the button it governs. Gen 2's own
         *          sentence is the test: "an affordance that has to explain
         *          where its real control lives is the control being in the
         *          wrong place" — the control is now beside it, so the badge no
         *          longer explains anything and the gate costs nothing to find.
         *
         * SO DO NOT READ GEN 2'S NOTE AS STANDING INTENT. It says the reversal
         * is deliberate and that fixing it back undoes what was asked for; that
         * was true until 08-19 and is what this supersedes. A fourth change
         * needs a fourth client decision, not a tidy-up — read all three first.
         *
         * `!form.mult_ord` ALONE, not gen 1's `&& styles.length >= 1`: the grid
         * always opens holding one row (`openOneRow`), so the length half never
         * decided anything and only made the rule harder to read.
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
        hideAdd={!form.mult_ord}
        onAdd={addStyle}
        onRemove={(r) => setStyles((xs) => xs.filter((x) => x.key !== r.key))}
        addLabel="+ Add style"
        /* `ADD_BUTTON_W`'s only reader since "+ Add size" came out on 08-20 —
           the floor is harmless and stays, so a restored pair matches again
           without anyone having to rediscover the constant. */
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
             quietly swallowing the fields it is still missing.

             FILES JOINED IT ON 2026-08-31, and for a sharper reason than PO Qty
             has. A folded row UNMOUNTS the Files cell, so the required hold has
             nothing to stand on — this line is the only thing on screen saying
             the row is unsaveable until the operator opens it again. PO Qty does
             not block Save at all; this does.

             BOTH, JOINED, never the first of the two: a row missing each would
             otherwise report one, get it fixed, and only then admit to the
             other. */
          /* WHAT THIS LINE STILL OWES, WORD FOR WORD (client 2026-08-31: "the UI
             must highlight the invalid fields and block progress").

             THE SAME CALL `styleLineProblemList` MAKES, not a second reading of
             the same question — so the red count on the rail, the message Save
             reveals and the line printed under this row can never disagree about
             what is wrong with it. That divergence is the whole reason
             `lib/orders/styles/rules.ts` is a module rather than a few `&&`s.

             RENDERED WHETHER THE ROW IS OPEN OR FOLDED, and the folded case is
             the one that needs it: folding UNMOUNTS the cells, so every
             `data-required-empty` marker goes with them and the cursor hold has
             nothing to stand on — exactly the argument the "No file attached"
             note below makes for itself. */
          /**
           * THE MISSING FILE IS A *BLOCKING* PROBLEM, SO IT IS RED AND NOT AMBER.
           *
           * It rode in the amber `missing` string beside "PO Qty missing" for one
           * edit, and that was wrong for the reason the note on the red line
           * below states in its own words: PO Qty does NOT block Save and a
           * missing file DOES (`styleFileProblems`, in `validity`). Putting the
           * two in one amber string is "two blocking states in two colours", one
           * string along — the operator learns the amber line is advisory from
           * the half that is, and reads past the half that stops the save.
           *
           * SO IT JOINS `lineProblems`, which is the row's blocking list, rather
           * than getting a third line of its own. It cannot come from
           * `styleLineProblems` itself: that is a pure function over one style
           * row, and a file lives in `attachments` beside the styles, not on the
           * row. Appended here is the nearest thing to one list.
           *
           * THE GUARD IS `styleFileMissing`, NOT A COPY OF ONE. This line and the
           * blocked Save must agree about which rows are in breach — a row
           * reporting a problem Save does not have, or Save dying while naming a
           * row that looks clean, is what disagreement looks like. It was briefly
           * a deliberate verbatim copy with a comment saying to keep the two in
           * step; the comment was right about the danger and wrong about the
           * remedy, since a warning beside a copy has never yet stopped one
           * drifting. Both halves of the guard, and why neither is defensive, are
           * documented on the predicate.
           *
           * Short, like its siblings ("Style is required.", "Tick at least one
           * size."). The LONG sentence naming what to attach is the toast a
           * blocked Save reads out; this is the label beside the row.
           */
          const lineProblems = [
            ...styleLineProblems(r).map((x) => x.message),
            ...(styleFileMissing(r) ? ["Attach at least one file."] : []),
            /* THE ONE SET-LEVEL RULE, joined here because a duplicate ref is
               only meaningful ON the rows that share it. The rail badge and the
               blocked Save name the REF and the count; this names the lines.
               Worded from the row's side rather than restating the count. */
            ...(duplicateStyleRefs.some((d) => d.ref === styleKey(r.style_ref_no))
              ? ["Another style line carries this same Style ref."]
              : []),
          ];
          /* AMBER, AND NOW HONESTLY SO: what is left here is PO Qty alone, which
             is genuinely advisory — `canSave` never consulted it (see the fold
             note above). The blocking half moved to the red line. */
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
                named by its Style, which is the first field below.

                THE LAST LINE CANNOT BE DELETED, and that is not tidiness — it is
                what stops the 08-19 cap above from creating a dead end. With
                "+ Add style" hidden while Multi Style is off, deleting the only
                row leaves the order with NO style and no control to make one:
                `openOneRow` tops the grid up on LOAD, never after a removal, and
                `seedRow` (which would) is a no-op under `hideAdd` by contract.
                So the operator would be stuck on a screen whose Save is blocked
                by a `required` Style they cannot get back.

                Gated here rather than with ChildGrid's `hideRemove`, because
                `listRows` means this row draws its own chrome — the grid never
                renders this button, so the prop cannot reach it. `data-row-remove`
                going with it takes Ctrl+Del too, so the keyboard and the mouse
                agree without a second rule.

                An order must name a style (the column is `required` and Save
                blocks without it), so deleting the only line was never the way
                to change it — clearing its fields is. */}
            {styles.length > 1 && (
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
            )}
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
              * SEVEN FIELDS ON ONE LINE, AT CONTENT WIDTHS (client 2026-08-24
              * for the seven; 2026-08-26 for the widths).
              *
              * ## THIS IS A `FieldRow` AGAIN, AND IT IS NOT THE 08-24 BUG
              *
              * Read that carefully before "fixing" it back. This row WAS a
              * `FieldRow` until 2026-08-24, and it was broken — but the defect
              * was never the flex container. It was that every cell carried
              * `size="xs"`, i.e. `col-span-2`, and a `col-span-*` inside a
              * `flex-wrap` div lands on NOTHING: the fields fell back to their
              * intrinsic width and wrapped wherever they ran out, so no two
              * style cards agreed on anything. The fix on 08-24 was to give the
              * spans a track (`cols={14}`). The fix now is the other one: give
              * the cells REAL WIDTHS and keep the flex row.
              *
              * So the invariant is not "this must be a grid". It is **a cell
              * must be sized by the container it is in** — `size` inside a
              * `FieldGrid`, `w` inside a `FieldRow`, never the other way round.
              * `--check field-track` is the guard, and it fires on exactly the
              * mistake 08-24 was cleaning up.
              *
              * ## WHY THE WIDTHS, AND WHY NOT FOURTEEN COLUMNS
              *
              * 14 columns gave every one of the seven ~155px — a share of the
              * line, identical for a style NAME and for a three-letter Order
              * Unit. That is the same complaint the client made about the
              * header on 2026-08-26 ("unit only going to have two to four
              * character only ... no need an excess padding"), and it has the
              * same answer: `STYLE_FIELD_W` above, out of `FIELD_WIDTH`'s five
              * declared sizes.
              *
              * IT ALSO COSTS LESS WIDTH, WHICH IS THE POINT. The seven
              * measure 1,008px including gaps, against a 14-column track that
              * always consumed the whole line for them. Description takes the
              * remainder (see `STYLE_FIELD_W`), so the line holds a field MORE
              * than the client asked for at every pane width down to ~1,190px
              * — and `FieldRow` WRAPS rather than scrolling (the operator's rule
              * of 2026-08-10), so narrower than that it folds instead of
              * breaking.
              *
              * A 14-COL TRACK WAS ALSO TRIED HERE ONCE BEFORE 08-24 AND
              * REVERTED, hand-rolled to widen the SIZES cell — "a cell sized
              * for its fullest state is a hole in its commonest one". That is
              * the same argument as this change, one generation earlier.
              *
              * ## THE TWO LINES NO LONGER SHARE A RULER, DELIBERATELY
              *
              * Line 1 is EIGHT declared widths — Description joined the row on
              * 2026-08-26, which is what Style narrowing to `term` paid for, and
              * it no longer takes a line of its own. Line 2 keeps a
              * 14-column track because a picker, a table and a tick grid are
              * not values with known maxima. Each line is internally straight
              * and both start on the same left edge. See the note above it.
              *
              * `items-end` comes free with `FieldRow`, so "Approved Sample No"
              * wrapping its label no longer drops its control below the row —
              * the fault `FIELD_TRACK_32` got `items-end` for on 2026-08-19.
              */}
            <div className="space-y-2 @2xl/editor:space-y-1.5">
            <FieldRow>
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
                    w={STYLE_FIELD_W[col.header] ?? "code"}
                    /* DESCRIPTION IS THE ONLY CELL THAT GROWS — the seven
                       beside it are fixed widths and it takes what they leave
                       (`flex-[1_1_7rem]`: basis 7rem = `range`, grow 1).

                       BASIS, NOT `flex-1`, and that half is unchanged. `flex-1`
                       is basis 0, so the cell would never be too big to fit and
                       would collapse to whatever was left — 4px on a narrow
                       pane. The basis is the floor that stops that.

                       THE BASIS WAS 11rem AND WRAPPED IN FRONT OF THE CLIENT
                       (2026-08-27, screenshot 2519: "if I choose a size, that
                       description automatically comes to the second row").

                       Why picking a SIZE moves a field on the line above it: the
                       chosen sizes render as chips under the Sizes trigger, the
                       style row gets taller, the editor pane gains a vertical
                       scrollbar, and the line loses ~15px. `flex-wrap` breaks a
                       line on the item's BASIS — shrinking happens afterwards,
                       within a line that has already been decided — so at 11rem
                       the row was sitting ~30px from its own wrap point and any
                       perturbation tipped it.

                       LOWERING THE BASIS COSTS NOTHING, and this is the property
                       that makes it the right fix rather than a smaller guess:
                       `grow: 1` means Description takes the WHOLE remainder
                       whenever it fits, so the basis never decides how wide it
                       is — only when it gives up and takes its own line. At
                       ~1,229px it is still ~210px either way. All that changes
                       is that the row now has ~100px of slack instead of ~30.

                       7rem still answers the "unusable" test the 11rem note was
                       written for: ~14 characters typed, scrolling horizontally
                       after that, on a field that is free text rather than a
                       value anything matches on. It is a FLOOR reached only on a
                       pane narrower than any machine this runs on.

                       Anchored on the HEADER, never on an index: this column
                       array is deliberately re-orderable, and a header match
                       fails loudly where an index would quietly grow the wrong
                       cell. */
                    className={
                      col.header === "Description" ? "flex-[1_1_7rem]" : undefined
                    }
                  >
                    {col.cell(r, i)}
                  </Field>
                ))}
              {/**
                * COMPONENTS AND SIZES, ON ONE LINE OF THEIR OWN, LAST (client
                * 2026-08-23, screenshots 2471 · 2472 — "same ui like this").
                *
                * THREE GENERATIONS, and each one is here because the next reader
                * will otherwise read this as arbitrary:
                *
                *   1. Sizes SECOND, right after Style, because that is where its
                *      data comes from — and it was the tallest thing on screen:
                *      a 248px cell wedged between five 32px ones, which made one
                *      style row ~425px against the legacy screen's ~170px.
                *   2. Sizes LAST and laid ACROSS its own line (2026-08-14), then
                *      Components stacked under it as a second full line when the
                *      Style master was merged in (2026-08-23).
                *   3. This: ONE line holding both, 6/6, the Style master's own
                *      section. Gen 2 was the same content in a different shape
                *      from the screen the operator had just come from.
                *
                *   4. This: THREE cells of the row's own 14-column track —
                *      Coordinates 3, Components 8, Sizes 3 — so they line up
                *      under the fields above them rather than inside a grid of
                *      their own. Gen 3 nested a second `FieldGrid` here and gave
                *      each half `lg` (6): three of those is 18, so Sizes wrapped
                *      alone and left six columns empty.
                *
                * NO WRAPPER CELL AT ALL NOW. `componentsAndSizes` returns the
                * three `<Field>`s as a fragment straight into this grid, which
                * is what makes them share the track. A wrapper would have needed
                * its own span and its own inner track — two places to disagree
                * about one row.
                *
                * LAST IS ALSO THE ROW'S TAB ORDER, not a visual preference:
                * `tabFieldsIn` walks a row in DOM ORDER, so both grids are
                * reached once the five cells are done rather than between a cell
                * and its neighbour. They stay INSIDE the row, which is what makes
                * them part of it for Tab while the arrows keep to the row's own
                * cells (`ownDescendants`) — the one place the two keys read
                * different axes on purpose.
                */}
              {!isOpen && (
                /* `label=""` rather than no label: `Field` renders a `&nbsp;` in
                   that case precisely to reserve the label line, so the summary
                   sits level with the Style box beside it instead of 14px above
                   it. `flex-1` NOW, WHERE IT WAS `size="full"` — a span means
                   nothing in a `FieldRow`, and "take whatever Style leaves" is
                   what the summary actually wants; `min-w-0` is what lets it
                   shrink so the truncation below can happen at all.

                   `Truncated` because a long summary must stay READABLE, not
                   merely clipped — the standing rule that an ellipsis is a
                   promise the rest is reachable. */
                <Field key="__summary" label="" className="min-w-0 flex-1">
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
            </FieldRow>
            {/* LINE 3 KEEPS A FRACTIONAL TRACK OF ITS OWN, and that is the one
                thing the 08-26 change costs. Its three cells are a picker, a
                TABLE and a wrapping tick grid — none of them a value with a
                known maximum, which is the only thing `FIELD_WIDTH` can express
                — so they are still shares of a line: Coordinates 3, Components
                8, Sizes 3. Gen 4's "they line up under the fields above them"
                no longer holds, because the fields above no longer stand on
                columns; what replaces it is that each line is internally
                straight and both start on the same left edge.

                LAST IS ALSO THE ROW'S TAB ORDER, not a visual preference:
                `tabFieldsIn` walks a row in DOM ORDER, and this block is still
                the last thing in it. */}
            {isOpen && <FieldGrid cols={14}>{componentsAndSizes(r)}</FieldGrid>}
            {/* `text-danger`, NOT the `text-warning` the Structure Details rows
                use: those are advisories and these BLOCK Save, and the app has
                one ink for each (`status-pill.tsx`). Two blocking states in two
                colours is how an operator learns to read past one of them. */}
            {/* NOT UNTIL THEY HAVE TRIED TO MOVE ON (client 2026-08-31). The
                same argument the Structure Details rows already make one section
                up ("an open row is one being filled in, so the complaint is
                premature by construction") — here the trigger is the operator
                asking to LEAVE rather than leaving a row, because that is the
                moment the client named. `problemsRevealed` is set by Next, by a
                sealed rail row and by a blocked Save.

                THE RULES ARE UNCHANGED AND STILL BLOCKING while this is hidden:
                Save is dead and `stepGuard` still seals the rail from the first
                keystroke. Only the printing waits. */}
            {problemsRevealed && lineProblems.length > 0 && (
              <p className="text-xs text-danger">{lineProblems.join("  ·  ")}</p>
            )}
            </div>
          </div>
          );
        }}
      />
    </>
  );

  /** One blank Style Prices row. Was written out three times — the caption's
   *  onAdd, the grid's keyboard add, and nothing else agreed with either. */
  /**
   * `TabItem` plus the shell's `skipTab`, which the sections below forward.
   *
   * Widened HERE rather than on `TabItem` itself: skipping a section on the
   * typing path is a `MasterFullScreen` concern and means nothing to the plain
   * tabs component. Widened here rather than computed in the `.map()` for the
   * reason the prop's own note gives — the flag has to sit on the same object as
   * the fieldless content, or the two eventually disagree.
   */
  type OrderTab = TabItem & { skipTab?: boolean; wide?: boolean };
  const tabs: OrderTab[] = [
    /**
     * ---------------- Style(s) ----------------
     *
     * ITS OWN TAB AGAIN (client 2026-08-27: "move that style section from order
     * info as separate tab"). This reverses the 2026-08-11 merge, which folded
     * the grid into Order Info so the two halves of one subject read as one
     * section. The later instruction wins; the earlier one is why the grid drew
     * its own "Styles Details" band, and that band now names the tab's content
     * from inside it exactly as every other tab's grids do.
     *
     * FIRST IN THE LIST, so the rail reads Order Info → Style(s) → Color/Print
     * → … That is the order the work is done in and the order the 08-11 merge
     * had it in when the two shared a section — the split changes where the
     * boundary falls, not the sequence.
     *
     * NOTHING ABOUT THE GRID CHANGES. `stylesGrid` moves as one expression, so
     * the columns, the nested Coordinates and Components panels, the keyboard
     * behaviour and every `updateStyle` call site are untouched — this is a
     * change to which pane the JSX hangs in, and it is worth keeping it that way
     * so a layout change and a behaviour change cannot be confused in review.
     *
     * NO WRAPPER. A tab's `content` is mounted straight into the pane and the
     * other ten pass bare JSX; `SectionBody` belongs to `orderInfoSection`,
     * which is a hand-written section rather than one of these.
     *
     * THE SECTION EDGE IS NOW THIS TAB'S LAST FIELD, which is what makes Tab
     * hand over to Color/Print Details (`registerContentEdge`). Order Info's
     * note used to warn that the grid had to render LAST for that reason; with
     * one grid alone in the pane there is no ordering left to get wrong.
     */
    {
      key: "styles",
      label: "Style(s)",
      /**
       * ^ WITHDRAWN THE SAME NIGHT. The four-pane row it was bought for is gone
       * (see `componentsAndSizes`), so the section is a row of fields over ONE
       * grid again, which is not what the flag is for. The note below is kept
       * because the reasoning still applies the day a second wide grid lands
       * here — including the part that says it buys nothing on a laptop.
       *
       * THE ONE SECTION THAT LIFTS THE PANE CAP (client 2026-08-29, asked for
       * by name after the fourth pane kept wrapping).
       *
       * `MasterFullScreen` caps its content at 1440px and at 1720px for a
       * section declaring this. The flag was written on 2026-08-17 for "a
       * section whose whole content is one wide `ChildGrid`, a line grid with
       * ten or more columns", and this section did not qualify then — it was a
       * row of fields over one grid.
       *
       * IT QUALIFIES NOW BECAUSE THE ROW CHANGED. Since the Process grid came
       * inline (2026-08-29) the style row carries TWO wide tables side by side,
       * Components and Process, each needing 512px before `ChildGrid` drops it
       * to stacked cards and takes its column headers with it. Four panes need
       * 1336px of pane; the 1440 cap leaves 1408 after `px-4`, which is 72px of
       * headroom — and on a display where the cap binds at all, 1720 leaves 1688
       * and the row has room to breathe rather than to merely fit.
       *
       * ## IT DOES NOT REPEAL THE CAP'S REASONING, AND THE FIELDS ARE WHY
       *
       * 1180/1440 exists so FIELDS do not stretch to absurd widths — a Year box
       * 900px across. That argument is about a `FieldGrid`, whose columns divide
       * the pane between them. The seven fields on the row above are NOT on that
       * track: they are a `FieldRow`, laid out by fixed widths from
       * `STYLE_FIELD_W` (`term`, `code`, `num`, `range`), so extra pane width
       * reaches only Description, the one cell deliberately given `flex-1` to
       * absorb the remainder. Nothing here stretches that was not already
       * designed to.
       *
       * ## AND IT BUYS NOTHING ON A LAPTOP, WHICH IS NOT A REASON TO SKIP IT
       *
       * The cap only binds when the viewport exceeds it. On a 1366 screen the
       * pane is viewport-bound at ~1110px and 1720 is no less of a cap than 1440
       * was, so this changes nothing there — the panes wrap, Process takes a full
       * line, and that is the correct answer at that width. `mba-master-screen`
       * records the same asymmetry for the same flag.
       */
      // wide: true,   <- re-enable if this section ever carries two wide grids
      content: <div className="space-y-4">{stylesGrid}</div>,
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
          {/* THREE PEERS ON ONE LINE, WRAPPING — `wrap` plus a basis per section,
              never a column count. The basis is ~23rem because that is what one
              of these grids MEASURES: index + Type (7rem) + Colour (11rem) + ✕
              and their gaps. A count would have to guess a container width to
              switch at, and both guesses were wrong — `@7xl` never fired on this
              pane and `@6xl` would have switched at a width narrower than the
              content. See `SectionGrid.wrap`. */}
          <SectionGrid wrap>
            {/* Yarn dyeing */}
            <div className="min-w-0 flex-[1_1_23rem]">
              <ChildGrid<DyeingRow>
                /* grid-caption: exempt -- TWO grids share the Color/Print Details section; without captions the operator
                   cannot tell which is which. */
                label="Yarn Dyeing"
                columns={dyeColumns}
                rows={dyeings.filter((d) => d.section === "yarn")}
                inlineCards
                fill
                onAdd={() => addDyeing("yarn")}
                onRemove={(r) => setDyeings((xs) => xs.filter((x) => x.key !== r.key))}
                addLabel="+ Add yarn dyeing"
              />
            </div>
            {/* Fabric dyeing */}
            <div className="min-w-0 flex-[1_1_23rem]">
              <ChildGrid<DyeingRow>
                /* grid-caption: exempt -- the other half of the pair above. */
                label="Fabric Dyeing"
                columns={dyeColumns}
                rows={dyeings.filter((d) => d.section === "fabric")}
                inlineCards
                fill
                onAdd={() => addDyeing("fabric")}
                onRemove={(r) => setDyeings((xs) => xs.filter((x) => x.key !== r.key))}
                addLabel="+ Add fabric dyeing"
              />
            </div>
            {/* Roll form prints */}
            <div className="min-w-0 flex-[1_1_23rem]">
              <ChildGrid<PrintRow>
                /* grid-caption: exempt -- the third of three grids in one section; without captions
                   the operator cannot tell which is which. */
                label="Roll form prints"
                columns={printColumns}
                rows={prints}
                inlineCards
                fill
                onAdd={addPrint}
                onRemove={(r) => setPrints((xs) => xs.filter((x) => x.key !== r.key))}
                addLabel="+ Add roll form print"
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
                    on a printed component. `declaredPrintOptions` now falls back
                    to the full list when the order declares none — and since
                    2026-08-31 it is ungated as well, so "a printed component" is
                    any component rather than one whose Fabric Type said so. */}
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
            columns={comboColumns}
            rows={combos}
            /* keepOne — a colourway is what a Combo names, and the Prices
               grid's Color-wise axis, the Structure Details tree and the assortment
               all enumerate off it; an empty Combos tab leaves those with no axis. See the prop in `child-grid.tsx`: it
               withholds the ✕ from the sole survivor, and Ctrl+Del declines
               with it because both read `locked`. */
            keepOne
            inlineCards
            onAdd={addCombo}
            onRemove={(r) => setCombos((xs) => xs.filter((x) => x.key !== r.key))}
            addLabel="+ Add combo"
          />
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
              {/* TWO COLUMNS SINCE 0472 — the method and what it packs — so
                  §6's "<=3 -> inlineCards" band still applies, but the old
                  reading of it does not: this was "the extreme of it, a card
                  around a single box" while a pack type was a word alone.
                  Cards are now what gives the nested grid a full line to wrap
                  into rather than a table cell to squeeze inside.

                  The badge used to read "3 of 4 methods" because the cell was a
                  dropdown over a fixed list and the ceiling had to be visible
                  BEFORE "+ Add" declined on it. The cell is typed now and there
                  is no ceiling, so it counts what has been named and claims
                  nothing about what is left. */}
              <ChildGrid<PackTypeRow>
                badge={
                  <span className="text-xs text-muted-foreground">
                    {packTypes.filter((r) => r.pack_type.trim()).length} named
                  </span>
                }
                columns={packTypeColumns}
                rows={packTypes}
                inlineCards
                onAdd={addPackType}
                onRemove={(r) => setPackTypes((xs) => xs.filter((x) => x.key !== r.key))}
                addLabel="+ Add pack type"
              />
            </>
          ),
        }
      : {
          key: "packtypes",
          label: "Pack type(s)",
          /* NOTHING TO TYPE IN THIS BRANCH, so Tab and Enter pass over it and go
             straight to Quantities (client 2026-08-19, screenshot 2365). The flag
             lives on the SAME object as the fieldless panel below — the ternary is
             what makes the two impossible to disagree. The rail still lists the
             section and "Turn Pack on" still works when reached by mouse or by the
             rail's arrow keys. */
          skipTab: true,
          /**
           * AND THE RAIL ROW IS DISABLED TOO (client 2026-08-31: "if pack no
           * means it should disable the focus, no need to go the section … if
           * yes only that time only need to allow the focus to move to the
           * section").
           *
           * `skipTab` alone answered only half of that: it took the section off
           * the TYPING path, and the note beside it says so explicitly — the
           * rail's arrows and the mouse still reached it. The operator could
           * still arrow into a section that asks them nothing.
           *
           * SAFE HERE BECAUSE THE SWITCH IS SOMEWHERE ELSE. `Pack` is a field on
           * Order Info, so the section is re-enabled where it was disabled, and
           * making this one unreachable strands nothing. The "Turn Pack on"
           * button inside the panel was a convenience, not the only route — see
           * the `disabled` prop's own note on why a section holding its ONLY
           * re-enabling control must never carry this flag.
           *
           * DECLARED ON THE SAME OBJECT AS `skipTab` AND THE FIELDLESS PANEL,
           * for the reason `skipTab`'s note gives: a flag computed apart from
           * the content it describes is a flag that will one day describe the
           * wrong thing. The ternary is what keeps all three impossible to
           * disagree.
           */
          disabled: true,
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
                /* `answerPack`, not `set({ pack: true })` — this button IS the
                   header's Pack switch (see the note above), so it has to seed
                   the assortment the same way. Two writers of one field is
                   exactly where a rule gets applied on one path only. */
                onClick={() => answerPack(true)}
              >
                Turn Pack on
              </Button>
            </div>
          ),
        },
    // ---------------- Prices ----------------
    {
      key: "prices",
      label: "Prices",
      /**
       * A PACK ORDER IS PRICED IN ONE PLACE (client 2026-08-28).
       *
       * ## THE HEADLINE USED TO READ "AND ONLY THE BOX", AND IT NO LONGER DOES
       *
       * The first ruling was that a pack order quotes a rate per carton and
       * nothing else; the operator has since asked for plain **Size-wise**
       * beside the two pack modes, because some buyers contract a set at a
       * per-GARMENT rate per size. So the dropdown now offers three modes and
       * two multiplicands (`PACK_BRANCH_PRICE_MODES` in types.ts carries the
       * reasoning and the risk).
       *
       * WHAT SURVIVES OF THE FIRST RULING IS THE PART THAT MATTERED. The quote
       * below is about there being ONE place a rate is typed, not about which
       * unit it is in — "conflicting price data on commercial shipping invoices"
       * comes from a style grid and a pack grid both accepting a figure, and
       * that is still impossible: the per-style and per-colour grids are not
       * rendered here, and `packPriceMode` reads exactly one mode per method, so
       * no method can quote a box and a garment at once.
       *
       * WHAT CHANGED IS THAT THE UNIT IS NOW A CHOICE, so the grid's rate column
       * names it ("Rate / pack" vs "Rate / piece"). That header is the whole
       * guard, and it is enough because neither figure is wrong — they are
       * answers to different questions.
       *
       * "If the pack option is enabled the system must completely hide the
       * individual style-level or colour-level rate inputs. The screen will
       * strictly list the selected Pack Name broken down by Sizes."
       *
       * So the per-style grid is not disabled here, it is not rendered at all —
       * the client's own reasoning being that leaving a second place to type a
       * rate "leads to conflicting price data on commercial shipping invoices".
       * A style's rate and a box's rate are two answers to one question, and the
       * invoice can only carry one.
       *
       * THE MODE DEFAULTS TO PACK-WISE SIZE-WISE and is then the operator's:
       * that is the "defaults strictly to Pack-Wise & Size-Wise" half of the
       * same instruction, and `packPriceMode` states it as a fallback rather
       * than as a constant. (An earlier note here claimed the branch needed no
       * dropdown at all, on the grounds that one available mode cannot be
       * chosen between. Three now can.) `priceModeOptions` still tags a stored
       * mode the pack branch does not offer, so an order that turns Pack off
       * mid-entry finds it named rather than blanked.
       *
       * NOTHING IS DELETED WHEN THE BRANCH SWITCHES. Rates typed under a
       * per-garment mode stay in `price_details`, unrendered — the standing rule
       * on this tab ("never delete typed money"), and `styleRate` refuses a
       * style holding two modes at once, which is the prompt to tidy them.
       *
       * PACK TYPE(S) NOW COMES BEFORE THIS TAB, which is what makes the grid
       * possible without a fetch button: by the time the operator arrives the
       * methods and their members are already in state.
       */
      content: packPricingActive ? (
        <div className="space-y-6">
          {declaredPackMethods.map((method) => {
            const mode = packPriceMode(method);
            const sizes = packPriceSizes(method);
            /* THE SHAPE IS THE MODE'S SIZE AXIS, NOT ITS NAME. Two of the three
               modes on offer here draw a row per size (Pack-wise Size-wise, and
               plain Size-wise since 2026-08-28) and only Pack-wise draws one row
               for the box, so `=== PACK_WISE_PRICE` was about to become "every
               mode except this one" — a test that is right until the fourth
               mode. `priceAxes` is the same question `modeAxes` answers in
               `order-value.ts`, and the two are already kept in step.

               `size_id: null` is not a missing size — it is the mode saying the
               rate does not vary by one, and it is the value `styleRate` matches
               on. */
            const sized = priceAxes(mode).size;
            /* AND WHAT THE RATE IS A RATE *PER* — `isPackWise`, the multiplicand
               fork, deliberately NOT the dropdown's list. Pack-wise and
               Pack-wise Size-wise quote a box; Size-wise quotes a garment, and
               the same figure typed under each values a 3-style gift box three
               times apart. Both are correct arithmetic for what they mean, so
               there is nothing to guard against — only a unit to name, in the
               one place the operator is looking when they type it. */
            const perBox = isPackWise(mode);
            const rows: PackPriceRow[] =
              !sized
                ? [{ key: `${method}::all`, method, size_id: null, name: "" }]
                : sizes.map((z) => ({
                    key: `${method}::${z.id}`,
                    method,
                    size_id: z.id,
                    name: z.name,
                  }));
            return (
              <div key={method} className="space-y-2">
                {/* THE PACK NAME IS A HEADING ON ITS OWN LINE, and the Price
                    Type field starts beneath it (client 2026-08-28, screenshot
                    2534).

                    The two sat on one `flex` row, so the field's left edge was
                    wherever the NAME happened to end — and a two-method order
                    (REFE, then FDFADSF) drew its two Price Type selects at two
                    different indents, with the heading hanging off the bottom of
                    each. A pack name is DATA: its width is the operator's, so
                    anything laid out after it on the same line inherits that
                    raggedness and no amount of gap tuning fixes it. Stacking is
                    what makes every group's field land on the same track as the
                    grid below it.

                    It is still a heading and not a field: the method is the Pack
                    type(s) tab's answer and is not re-picked here ("already we
                    choosed the style, why need show for all size").

                    THE DROPDOWN STAYS (client 2026-08-28: "that dropdown i
                    need"). The first cut dropped the control entirely, reasoning
                    that a single available mode needs no dropdown — but there
                    are TWO pack modes, and which one a buyer contracts on is the
                    operator's to state, not the screen's to assume. It is the
                    same field the per-style branch shows; only its options are
                    narrowed. */}
                <p className="text-sm font-semibold text-foreground">{method}</p>
                <Field label="Price Type" w="term" required>
                  <Select
                    value={mode}
                    onChange={(e) => setPackPriceMode(method, e.target.value)}
                  >
                    {/* ONE DECLARATION, TWO READERS — `PACK_BRANCH_PRICE_MODES`,
                        which `priceModeOptions` also reads. It was
                        `PRICE_TYPE_OPTIONS.filter(isPackWise)` in both places:
                        the same rule written twice, correct only while "offered
                        on a pack order" and "priced per box" were one sentence.
                        Adding Size-wise to one of the two copies is exactly the
                        edit that would have left the other behind. */}
                    {PACK_BRANCH_PRICE_MODES.map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </Select>
                </Field>
                {rows.length && (!sized || sizes.length) ? (
                  <ChildGrid<PackPriceRow>
                    columns={[
                      /* NO SIZE COLUMN ON A MODE WITH NO SIZE AXIS — there is
                         one rate and nothing for the column to say. Spreading a
                         blank cell across the row instead would leave a header
                         naming an axis this mode does not have. */
                      ...(sized
                        ? [
                            {
                              header: "Size",
                              cell: (r: PackPriceRow) => (
                                <div className="flex min-h-8 items-center">
                                  <span className="rounded border border-border bg-surface px-1.5 py-px font-mono text-[13px] font-medium tabular-nums text-foreground">
                                    {r.name}
                                  </span>
                                </div>
                              ),
                            },
                          ]
                        : []),
                      {
                        /* THE HEADER NAMES THE UNIT, and it is the only thing on
                           screen that does. Three modes share this one column
                           and two of them price a BOX while the third prices a
                           GARMENT — 12 typed here is 4,800 or 14,400 on the same
                           3-style gift box depending on which is selected. The
                           dropdown says which mode; this says what the number
                           beside it means. Leaving "Rate / pack" standing over a
                           per-garment rate would be a label that is simply
                           false. */
                        header: perBox ? "Rate / pack" : "Rate / piece",
                        required: true,
                        /* DECLARED TWICE ON PURPOSE — `ChildGridColumn.required`
                           draws the header star, and a grid that renders its own
                           row must repeat it on the control or the star has
                           nothing behind it (AGENTS.md, `--check
                           grid-required-mobile`). */
                        cell: (r) => (
                          <Field required>
                            <Input
                              type="number"
                              inputMode="decimal"
                              className="h-8 text-right font-mono tabular-nums"
                              value={packRateFor(r.method, mode, r.size_id)}
                              onChange={(e) =>
                                setPackRate(r.method, mode, r.size_id, e.target.value)
                              }
                            />
                          </Field>
                        ),
                      },
                    ]}
                    rows={rows}
                    /* CAPPED, NOT STRETCHED — the one-column case this prop was
                       written for (client 2026-08-10). Pack-wise draws a single
                       Rate / pack column, so a `<table>` handed the whole pane
                       gave one figure a ~1400px box (screenshot 2534); Size-wise
                       adds a two-character size beside it and is no wider a
                       question. `narrow` caps the grid at 32rem, which is still
                       4rem clear of the container query that would flip it to
                       stacked cards — see the prop's note before tightening it. */
                    narrow
                    /* THE ROWS ARE THE DATA. A size comes from the styles this
                       method packs, so there is nothing to add or remove here —
                       the lever is the Style(s) tab's size list. `hideAdd` and a
                       declining `onAdd` together, so Enter off the last rate
                       escalates to Save rather than trying to grow a fixed
                       grid. */
                    hideAdd
                    onAdd={() => false}
                    /* AND NO ✕ EITHER — the same statement as `hideAdd`, made at
                       the other end of the row. `onRemove` was a no-op handler
                       BEHIND a rendered button, so every rate line carried a
                       control that did nothing when clicked (screenshot 2534).
                       `hideRemove` is the prop written for a derived grid, and
                       it takes Ctrl+Del with it (it drives the same button), so
                       the keyboard and the mouse decline together rather than
                       one of them appearing to work. */
                    hideRemove
                    onRemove={() => {}}
                  />
                ) : (
                  /* An empty state that NAMES A CAUSE ELSEWHERE — the survivor
                     the de-clutter rule keeps. Without it a method whose styles
                     carry no sizes draws a bare heading and reads as broken. */
                  <p className="text-xs text-muted-foreground">
                    The styles in this pack list no sizes yet — add them on
                    Style(s).
                  </p>
                )}
              </div>
            );
          })}
        </div>
      ) : (
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
            /* keepOne — the operator's decision on 2026-08-31, taken with the
               cost named: the ✕ here is documented (2026-08-20) as the ONLY way
               to clear the rates of a style that has since been dropped from
               the order, and on a SINGLE-style PO that route is now closed. The
               remaining way out is the same one the mode-change note describes
               — reshape the rates through Price Type — or add the second style
               back on Styles Details, unprice it, and remove it again.
               Reverse this before the other three if it bites. */
            keepOne
            /* EMPTY ON PURPOSE: `renderMobileRow` owns the whole row, and a
               column declaring `required` that the row never reads would draw a
               header `*` with nothing behind it (`--check grid-required-mobile`).
               The `required` that matters is on the controls inside. */
            columns={[]}
            rows={priceGroups}
            forceCards
            /* NO CARD PER STYLE PRICE (client 2026-08-18, screenshot 2342:
               "remove that New style price frame, just that top frame is
               enough"). PRICE DETAILS already draws a box; a second one around
               every group inside it was a frame whose only content was another
               frame's worth of fields.

               `flatRows`, not `listRows`: the band above each group is doing
               real work here — it names the style ("STL/2627/0002 · Size-wise")
               once for a fold that hides everything else, and it carries the ✕
               that unprices that style. `listRows` would have taken both. */
            flatRows
            rowSummary={(g) => {
              const v = priceGroupView(g);
              if (!g.refNo)
                return (
                  <span className="text-muted-foreground">New style price</span>
                );
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
                    {/* NO `required` — see `priceStyleCell`: the box is readOnly,
                        `Input` never stamps the hold marker on one, and a star
                        with no hold behind it is the divergence the
                        one-declaration rule bans. */}
                    <Field label="Style" size="md">
                      {priceStyleCell(g)}
                    </Field>
                    {/* A FOLDED GROUP KEEPS A FIELD, AND IT IS NOW THIS ONE.
                        Tab lands on fields, so a folded row rendering none would
                        be reachable by mouse only — the requirement the Style(s)
                        fold also records. Style used to be that field; since
                        2026-08-31 it is `tabIndex={-1}`, so Price Type has to
                        render folded or the whole group drops off the keyboard.

                        That is the right field to have promoted: it is where the
                        cursor is meant to land on this tab anyway, and the
                        wrapper's `onFocus` unfolds the group around it. Unit and
                        the rate matrix stay behind the fold — they are the bulk,
                        and Unit is not a field at all. */}
                    <Field label="Price Type" required size="md">
                      {priceModeCell(g, v.mode)}
                    </Field>
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
            /* "+ Add style price" IS HIDDEN (client 2026-08-20, with the inner
               "+ Add colour price" — "remove both").

               `hideAdd` rather than dropping `onAdd`, and that is deliberate:
               the styles a PO prices are the styles it CARRIES, so the group
               list is seeded from the Styles Details lines (the price block in
               `pickStyle`) — and a seed needs the handler the button used to
               call.
               Hiding the control while keeping the path is what lets the list
               follow the order instead of being re-keyed by hand.

               A group still names its style in `priceStyleCell`, because a
               loaded amendment can hold a group whose style line has since been
               edited, and blanking that picker would hide which style a stored
               price belongs to. */
            hideAdd
            /* REMOVING A GROUP TAKES ITS RATES WITH IT — the ✕ beside a style is
               the only control that names the style, so it can only mean "this
               style is not priced here". KEPT: a style dropped from the order
               leaves its prices behind, and this is the only way to clear them. */
            onRemove={(g) => {
              const mine = new Set(g.rows.map((r) => r.key));
              setPriceDetails((xs) => xs.filter((x) => !mine.has(x.key)));
            }}
            addLabel="+ Add style price"
            /* The fourth of the four — see `PRICE_W` above `rateGrid`. */
            addClassName={PRICE_W}
          />
        </>
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
            columns={quantityColumns}
            rows={quantities}
            /* keepOne — a PO with no quantity line has nothing to make, and the
               Prices tab's weighted Average Rate reads its weights from here — an
               empty grid makes `styleRate` refuse every style at once. See the prop in `child-grid.tsx`: it
               withholds the ✕ from the sole survivor, and Ctrl+Del declines
               with it because both read `locked`. */
            keepOne
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
              const byHeader = (h: string) =>
                quantityColumns.find((c) => c.header === h);
              const primary = QTY_PRIMARY.map(byHeader).filter(
                Boolean,
              ) as ChildGridColumn<QuantityRow>[];
              const secondary = quantityColumns.filter(
                (c) =>
                  !QTY_PRIMARY.includes(
                    c.header as (typeof QTY_PRIMARY)[number],
                  ),
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
                  <FieldGrid cols={32}>
                    {(isOpen ? [...primary, ...secondary] : primary.slice(0, 1)).map((c) => (
                      /* One line for all eight — see QTY_SPAN for the split
                         and why it is stated there rather than here. A folded
                         row keeps Country at that same narrow width, so the
                         summary beside it reads on one line either way. */
                      <Field
                        key={c.header}
                        label={c.header}
                        required={c.required}
                        size="xs"
                        className={qtySpanClass(c.header as string)}
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
        </>
      ),
    },
    // ---------------- Approval Qty ----------------
    {
      key: "approvalqty",
      label: "Approval Qty",
      content: (
        /**
         * STYLE ▸ COLOUR ▸ SIZE, AND NOTHING HERE IS ADDED BY HAND (0435).
         *
         * Rows are `buildApprovalTree`'s, not the operator's: a style heading
         * and a line per colour. Ours was once a flat grid where the operator
         * hit "+ Add", PICKED a style, PICKED a colour and TYPED the quantity —
         * three answers the order had already given on Style(s), Combos and
         * Quantities (client 2026-08-19: "the table are pulling data from
         * previous section not manual entry").
         *
         * ONE NUMBER PER COLOUR, NOT ONE PER SIZE (client 2026-08-21). The
         * legacy screen asks the same question six times — its data reads
         * `2, 2, 2, 2, 2, 2` down every colour (screenshot 2443) — so
         * `ApprovalQtyLines` asks per colour and writes the six. The sizes are
         * still stored, still six, and still what `flattenApprovalTree` saves;
         * they open as a strip when one of them has to differ. The component's
         * own note carries the rest of the reasoning, including which legacy
         * columns were dropped and why.
         *
         * THE COLOUR LINE IS A SUM, never a second place to type (client
         * 2026-08-19). It is computed from its sizes on every render — the
         * legacy screen stored its roll-up and it went stale, which is visible
         * in 2443: GREY MELANGE reads 1,800 ordered beside a total of 630.
         */
        <div className="space-y-4">
          {approvalTree.styles.length === 0 ? (
            /* EMPTY AND EXPLAIN, and it names the tab to go to. The rows are
               derived, so an operator who has not entered a style sees an empty
               tab — and an empty tab with no reason reads as a broken screen,
               which is exactly how the Composition field was reported. */
            <p className="text-sm text-muted-foreground">
              Enter a style on the Style(s) tab first — the lines here are built
              from it.
            </p>
          ) : (
            approvalTree.styles.map((st) => (
              <div key={st.style_ref_no} className="space-y-2">
                {/* THE STYLE IS A HEADING, not a one-row table. Legacy spent a
                    bordered three-column table with a single row in it on Style
                    Ref No / Style / Article No; these are three words. */}
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <span className="text-sm font-medium text-foreground">
                    {st.style_ref_no}
                  </span>
                  {st.style && (
                    <span className="text-sm text-muted-foreground">{st.style}</span>
                  )}
                  {st.article_no && (
                    <span className="text-xs text-muted-foreground">{st.article_no}</span>
                  )}
                </div>
                {st.combos.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No colours declared for this style on the Combos tab.
                  </p>
                ) : (
                  <ApprovalQtyLines
                    excessPct={excessPct}
                    colours={st.combos.map((c) => ({
                      combo: c.combo,
                      sizes: c.sizes.map((z) => ({
                        sizeId: z.size_id ?? "",
                        label: sizeLabel(z.size_id) || "—",
                        qty: z.qty,
                        approval: z.approvalQty,
                      })),
                    }))}
                    /* THE ARITHMETIC STAYS IN `approval-qty.ts`. Passed as a
                       function rather than as computed figures so the component
                       cannot grow a second copy of a formula the server also
                       runs, and so excess keeps rounding UP PER SIZE — rounding
                       a colour's total once gives a different answer, which is
                       the client's own worked example in `excessQty`. */
                    derive={(qty, approvalQty) => ({
                      excess: excessQty(qty, excessPct),
                      rejection: projectionQty(qty, rejectionTiers),
                      total: totalProductionQty(
                        { qty, approvalQty },
                        excessPct,
                        rejectionTiers,
                      ),
                    })}
                    onSet={(combo, sizeId, value) =>
                      setApprovalAt(
                        {
                          style_ref_no: st.style_ref_no,
                          combo,
                          size_id: sizeId || null,
                        },
                        value,
                      )
                    }
                    onSetAll={(combo, value) =>
                      setApprovalAcross(st.style_ref_no, combo, value)
                    }
                  />
                )}
              </div>
            ))
          )}
          {approvalTree.orphans.length > 0 && (
            /* NOTHING TYPED IS EVER DROPPED. A stored approval quantity whose
               colour was renamed or whose size was removed no longer has a row
               to sit in — it is still saved, and saying so is the difference
               between a number the operator can go and fix and one that has
               silently stopped applying. */
            <p className="text-sm text-warning">
              {approvalTree.orphans.length} approval{" "}
              {approvalTree.orphans.length === 1 ? "quantity is" : "quantities are"}{" "}
              no longer matched by a colour and size on this order. They are still
              saved; re-enter them against the current lines if they still apply.
            </p>
          )}
        </div>
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

                  ONE EXCEPTION, AND IT EXISTS TO KEEP THE ROWS FLUSH (client
                  2026-08-17; re-solved 2026-08-21 when INR Value arrived).
                  Eleven fields at `xs` is twenty-two columns — six on the first
                  row and FIVE on the second, two short. Solve
                  `2a + 3b + 4c + 6d = 24` over eleven cells and there are two
                  answers: ten `xs` plus ONE `md`, or nine `xs` plus two `sm`.
                  The second is rejected on DATA — `sm` is 3 (~200px) and
                  "TT 30 DAYS FROM BL DATE" was clipped at 202px, which is the
                  measurement that bought `Pay Terms` its width in the first
                  place. So `Pay Terms` keeps `md` (4) and everything else is
                  `xs`, and the section reads 6 + 5 with no hole.

                  `Gross Value` GAVE UP the `md` it held while there were ten
                  fields, and gave it up on the rule this note already stated:
                  promote a field because its DATA wants the width, never
                  whichever one happens to be last. A currency string is ~14
                  characters and fits `xs`; a payment term is 23 and does not.
                  The arithmetic only ever said how many.

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
              {/* `lg` (6), NOT `md` (4) — IT ABSORBED THE WIDTH "Days" LEFT.
                  This row is Pay Terms + Avg Rate + Gross Value + INR Value,
                  and the three figures beside it are `xs` (2) each; without the
                  extra two columns the row would sum to 10 and sit short of its
                  track, which is the one thing the 08-17/19 de-clutter pass
                  settled by hand across the whole screen. Pay Terms is also the
                  right cell to give them to: it is the only picker on the line
                  and its values are the longest text on it. */}
              <Field label="Pay Terms" required size="lg">
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
              {/* "DAYS" STOOD HERE AND IS GONE (client 2026-08-29: "removes the
                  Days column from the Logistics tab entirely").
                  
                  It was READ-ONLY AND DERIVED — `payment_terms.credit_days`
                  (0242) resolved through `pay_terms_id` (0375), never stored on
                  the order, deliberately so that "a copy on the order cannot
                  disagree with the term it names". That is why the deletion is
                  this cheap and why NOTHING WAS UNWIRED: there was no `onChange`,
                  no column, and no payload field. The credit period is still on
                  the Pay Terms master and still one hop from `pay_terms_id`.

                  `data.paymentTermDays` is deliberately LEFT ON THE SERVICE. It
                  is one map over a master this screen already loads, the Order
                  Sheet reads the same credit period, and removing a feed because
                  its only current reader was deleted is how a value becomes
                  expensive to bring back. */}
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
              <Field label="Gross Value" size="xs" htmlFor="lg-gross">
                <Input
                  id="lg-gross"
                  readOnly
                  className="text-right"
                  value={
                    orderVal.grossValue == null
                      ? ""
                        : fmtMoney(
                            orderVal.grossValue,
                            form.currency_code || "INR",
                          )
                  }
                />
              </Field>
              {/* THE FINAL SALES VALUE, in the books' own currency (client spec
                  2026-08-21): Gross Value x Ex-Rate. It is what the Budget phase
                  measures its target margin against, which is why it is stated
                  on the order rather than left for whoever opens the budget to
                  multiply for themselves.

                  DERIVED, NOT STORED, and not a fourth column: the row already
                  carries `currency_code`, `ex_rate` and `gross_value`, and a
                  stored product is a fourth number that can disagree with the
                  three it came from — the same reason Days above is fetched
                  from the payment term rather than copied onto the order.

                  BLANK IS AN ANSWER, twice over. Blank when the Gross Value
                  refuses (a style priced per colour with nothing to weight it
                  by), and blank when no rate is entered — `ex_rate` is
                  `NOT NULL DEFAULT 0`, so an untouched column would multiply a
                  real value to 0.00, which reads as "this order is worth
                  nothing" rather than "nobody has typed the rate". 0417 removed
                  exactly that lie from the Gross Value; `inrValue` is what stops
                  it returning through the conversion. An order already IN rupees
                  needs no rate — it converts at 1.

                  `npm run check:order-value` carries the vectors, including all
                  five refusals, each verified by breaking the function first. */}
              <Field label="INR Value" size="xs" htmlFor="lg-inr">
                <Input
                  id="lg-inr"
                  readOnly
                  className="text-right"
                  value={inrVal == null ? "" : fmtMoney(inrVal, "INR")}
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
    // ---------------- T&A (0481) ----------------
    /**
     * THE ORDER'S TIME & ACTION LADDER — every step the factory has to finish,
     * and the date each one is due, scheduled BACKWARDS from the shipment.
     *
     * ## AFTER LOGISTIC (client 2026-08-31), AND IT USED TO BE AFTER QUANTITIES
     *
     * The rail now reads … Quantities → Approval Qty → Logistic → T&A → Reason.
     *
     * The original placement was argued from the anchor: the ladder hangs off
     * the earliest Earlier Shipment Date on the Quantities grid (falling back to
     * the header's Delivery Date), so sitting immediately after that tab meant a
     * refusal pointed exactly ONE tab backwards — the shortest correction there
     * is. That argument is now spent, and it is worth saying why rather than
     * deleting it: a refusal no longer stops anything (see below), so "how far
     * back does the correction point" stopped being a cost worth optimising. It
     * would come straight back if the gate did.
     *
     * What survives of it is the half that is still true: the anchor does not
     * exist until Quantities has been answered, so T&A must come AFTER that tab
     * whatever else moves. Anywhere earlier and the operator's first sight of
     * this tab is a refusal about a field they have not reached.
     *
     * ## WHAT THE OPERATOR TYPES HERE IS ONE COLUMN
     *
     * Days. Activity is picked (and pre-picked, from the `ta_activities`
     * master), Target Date is the ladder's arithmetic and Dept is read off the
     * activity. That is why the cursor lands on the first Days box on entering
     * the tab — see the Activity cell for how, and for why it needs no code.
     */
    {
      key: "ta",
      label: "T&A",
      content: (
        <div className="space-y-4">
          {/* THE TWO FIELDS THE CURSOR MUST BYPASS (client).
              Both are `<Input readOnly>`, which is the entire mechanism: `Input`
              sets `tabIndex={-1}` on a readOnly box itself (the standing
              auto-field rule, 2026-07-29), `FOCUSABLE_SELECTOR` in
              `lib/focus.ts` excludes `[tabindex="-1"]`, and `MasterFullScreen`
              calls `focusFirstField` on every section switch. So the cursor
              skips them and lands in the grid because they are not fields, not
              because anything here pushed it past them.

              They are here rather than left to the Order Info tab because a T&A
              ladder is read AGAINST them: a plan is checked by asking "as of
              when, and for which order". Repeating two read-only values is
              cheaper than making the operator navigate three rail stops back to
              see what they are scheduling. */}
          <FieldRow>
            <Field label="Date" w="code" htmlFor="ta-date">
              {/* THE LOG DATE — the order's own entry date, the same
                  `form.amend_date` Order Info shows. Not a second copy of the
                  field: it is readOnly here, so there is no control that could
                  write a different value, and the one place it is answered
                  stays Order Info. */}
              <Input id="ta-date" readOnly value={fmtDate(form.amend_date) || ""} />
            </Field>
            <Field label="Ref No" w="code" htmlFor="ta-refno">
              {/* THE SAME EXPRESSION `hd-scno` USES — a saved order shows its
                  stamped RE No, a new one the prediction. Written out rather
                  than lifted into a variable because both sites are two tokens
                  long and a shared `refNo` would read as a third source of a
                  number that has exactly two. */}
              <Input id="ta-refno" readOnly value={savedOrderNo ?? previewNo ?? ""} />
            </Field>
          </FieldRow>

          {/**
            * WHAT THE LADDER HANGS OFF, AND WHETHER IT REACHES.
            *
            * ## THE ANCHOR IS STATED BECAUSE EVERY OTHER DATE IS DERIVED
            *
            * The grid is ten dates the operator did not type. The only figure
            * they can check against the buyer's paperwork is the one the chain
            * hangs off — and WHICH FIELD it came from, since the earliest of N
            * consignment dates and the header's delivery date are different
            * numbers with the same shape. A ladder shown without saying what it
            * hangs off is a ladder the operator cannot check.
            *
            * ## A NEGATIVE FLOAT IS SHOWN, NEVER HIDDEN
            *
            * `backwardSchedule` reports it rather than clamping, and this is the
            * surface that reaches: a start date pulled forward to today is a
            * plan CLAIMING to be achievable when the order cannot be made on
            * time. It is the single most valuable thing this tab can say — the
            * cost being avoided is air freight on a missed shipment — so it is
            * said in the danger tone and in words ("14 days late"), not as a
            * minus sign somebody has to notice.
            *
            * ## A LATE PLAN NEVER BLOCKED, AND NOW NOTHING HERE DOES
            *
            * The distinction this section used to draw — the ladder REFUSING
            * blocks Save, the ladder arriving LATE only shouts — is gone as of
            * 2026-08-31, because the client made the whole tab optional. It is
            * kept because it is the right distinction and it comes back with the
            * gate: a late plan is a real order in real trouble whose shortfall is
            * the buyer's date rather than a typo, so refusing to save it would
            * leave the operator holding a document they cannot record and nothing
            * they can do about it. Whatever else is restored, this line must not
            * be — a negative float is shouted, never blocked.
            *
            * ## THE REFUSAL MOVED OUT OF THIS TERNARY
            *
            * It used to render here, in the false branch. It is now one of the
            * sentences in the notices block below, so that EVERY thing wrong with
            * this tab is said in exactly one place instead of the refusal being
            * said here and the other three rules somewhere else. When the ladder
            * refuses there is no anchor, no start date and no float — so this
            * status line has nothing to say and correctly renders nothing.
            */}
          {!isRefusal(taLadder) && (
            <p className="rounded-md border border-border bg-surface-muted/40 px-3 py-2 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">
                Scheduled back from {fmtDate(taLadder.anchor.date)}
              </span>{" "}
              —{" "}
              {taLadder.anchor.source === "earlier_shipment"
                ? "the earliest Earlier Shipment Dt on Quantities"
                : "the order's Delivery Date, as no Quantities row carries an Earlier Shipment Dt"}
              . Work starts{" "}
              <span className="font-medium text-foreground">
                {fmtDate(taLadder.startDate)}
              </span>
              {taLadder.float < 0 ? (
                <span className="font-medium text-danger">
                  {" "}
                  — {Math.abs(taLadder.float)} days late already
                </span>
              ) : taLadder.float === 0 ? (
                <span className="font-medium text-warning"> — starting today</span>
              ) : (
                <> — {taLadder.float} days from today</>
              )}
              .
            </p>
          )}

          {/**
            * EVERYTHING WRONG WITH THIS TAB, SAID IN ONE PLACE — and said only,
            * never enforced (client 2026-08-31: "make it optional now will
            * implement it later as required").
            *
            * These are `taProblems`, the same list that fed `sectionValidity`'s
            * `extra` until the tab was made optional. Rendering the SAME objects
            * here rather than writing a second set of sentences is the whole
            * point: when the gate comes back it is one line in `extra`, and the
            * operator's messages cannot drift from the record's rules in the
            * meantime, because there is only one set of them.
            *
            * AMBER, NOT RED, AND NOT WIRED TO ANYTHING. Nothing here holds the
            * cursor, deadens Save or counts on the rail — it is the plain
            * advisory shape AGENTS.md describes for a rule that does not block
            * ("an advisory stays plain amber text and is not wired through
            * `dupFieldProps`"). A red box beside a Save button that works would
            * teach the operator to ignore red.
            *
            * IT COVERS THE LADDER'S REFUSAL TOO, which is why the status line
            * above renders nothing when the ladder refuses. "KNITTING: enter how
            * many days it needs" is `backwardSchedule`'s own sentence, passed
            * through unchanged and never restated.
            */}
          {taProblems.length > 0 && (
            <ul className="space-y-1 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-foreground">
              {taProblems.map((pb, i) => (
                <li key={i}>{pb.message}</li>
              ))}
            </ul>
          )}

          <ChildGrid<TaRow>
            columns={taColumns}
            rows={taRows}
            /* NO `seedRow`. Every other grid on this screen opens on a blank row
               because the operator is the only one who knows what belongs in it;
               this one is seeded from the `ta_activities` master (see
               `seedTaLadder`), and a blank row put back after the last one was
               deleted would be a row whose Activity picker holds the cursor and
               whose Days blocks Save — a grid arguing with an operator who has
               just emptied it on purpose. */
            onAdd={() => setTaRows((xs) => [...xs, blankTaRow()])}
            onRemove={(r) => setTaRows((xs) => xs.filter((x) => x.key !== r.key))}
            addLabel="+ Add activity"
          />
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
    /* A red COUNT replaces the done dot while something here blocks the save —
       `blockingBySection`, so the badge and the dead button always mean the same
       thing. Without it the rail could only ever say "this section has rows",
       which is why every field blocking the save showed a hollow dot while the
       two sections the operator had filled showed green ones. */
    problems: validity.bySection.orderinfo,
    /*
     * The SC No is minted, so it cannot be what marks this section done — Unit
     * and Customer are what the operator actually supplies.
     *
     * `has(styles)` LEFT IT AGAIN ON 2026-08-27, with the grid. It joined on
     * 08-11 because the dot means "this section is answered" and the section
     * then held the styles too; now that they are their own tab, the styles dot
     * is `sectionDone.styles` and reading `has(styles)` here as well would make
     * ONE fact light TWO rail rows — Order Info would go hollow because a style
     * line is missing, pointing the operator at a section where there is
     * nothing to do about it. Each row reports what it owns.
     */
    done: !!form.location_id && !!form.customer_id,
    content: (
      <SectionBody title="Order Info">
        {/* THE TWO ROWS SHARE ONE WRAPPER so the gap between them is the
            track's own `gap-y-2`, not `SectionBody`'s `space-y-4`. That is the
            drift the note here used to warn about when this was a single
            `FieldGrid`: two stacked field containers agree on the left edge and
            not on the row gap. The `ChildGrid` below is still not one of them
            — it is a card block owning its whole row (LAYOUT.md §3's `full`
            band, the shape Customer ▸ Address already uses). */}
        {/* TWO CONTENT-WIDTH ROWS, NOT ONE TWELVE-COLUMN GRID
            (client 2026-08-26: "unit only going to have two to four character
            only ... same for season, date — no need an excess padding").

            THE TWELVE FIELDS WERE ALL `size="xs"`, AND `xs` MEANS "2-4 chars"
            — that is `FIELD_SPAN`'s own comment. On a 12-column track it
            resolves to a SIXTH OF THE ROW, so every field was 241px: a
            two-letter Unit, a two-digit Excess % and a customer's full trading
            name all declared the same size. The sizes were never wrong about
            the content; they were being read as "a sixth of the row".

            SO THE ROW LEAVES THE FRACTIONAL TRACK. `FieldRow` sizes each field
            by `FIELD_WIDTH` — 72 · 112 · 144 · 176 · 288 — and its own note is
            why a WIDER track could never have answered this: "shrinking the
            control inside a cell leaves the CELL at its old width and the value
            floating in dead space ... nothing short of leaving the fractional
            track can make a row genuinely compact."

            WHAT THIS REVERSES, IN THE CLIENT'S OWN WORDS. "Six fields a row,
            every field the same width" (2026-08-14) is superseded by the note
            above. It is not being tidied away: the earlier rule is why the row
            was uniform, and the later instruction is why it no longer is.

            FIVE OF THE TWELVE ARE NOT FLOORED BY THEIR VALUE, which is worth
            knowing before anyone tries to shrink them further:
              · Excess % holds two digits — 16px of them — and stops at 72
                because the WORDS "Excess %" need 55. The label is the floor.
              · Pack and Multi Style are 34px switches held open by their own
                names (and no longer by a `<Field>` label as well — see below).
              · Date and Deli.Dt are floored by the BROWSER: a native
                `<input type="date">` draws its own dd/mm/yyyy and its own
                calendar button, neither restylable from the page, and clips
                below ~130px. 144 is the first declared width clear of that,
                which is the whole reason they do not go as low as Unit. The one
                way past it is a masked text date field, which AGENTS.md already
                records as unbuilt ("Pickers follow the machine until someone
                builds a masked date component").

            THE RIGHT EDGE IS RAGGED ON PURPOSE. Line 1 measures 1,028px and
            line 2 862px against a ~1,504px pane. `FieldRow`'s note states the
            rule and that it is not the sums-to-12 rule being broken: "a
            content-width row has no twelfths to leave over: it simply ends."
            It never scrolls sideways either — `flex-wrap`, which is the
            operator's rule of 2026-08-10.

            `items-end` COMES FREE with `FieldRow`, so a label that wraps at 72px
            no longer pushes its control below the row — the fault
            `FIELD_TRACK_32` was given `items-end` for on 2026-08-19, on the two
            tracks that never got it. */}
        {/* THE SKETCH SITS IN THE CORNER THE ROWS LEAVE EMPTY (client
            2026-08-26, screenshot 2497: "why we hat remaining space … for
            diplayin gthat image").

            ## 144px IS MEASURED, NOT CHOSEN

            The operator's editor pane is ~1,229px — a 1920px screen at 125%
            scaling is 1536 CSS px, less the 228px rail and the padding, and NOT
            the ~1,504 an unscaled 1920 suggests. Line 1 measures 1,028px and
            line 2, since the Attachments cell left it on 2026-08-31 (see below),
            **862px** — so the column can be at most 1,229 − 1,028 − 12 =
            **189px**, and it is now LINE 1 that sets the ceiling rather than
            line 2. Of the widths this app declares, `w-36` (144) is the one with
            real margin: it leaves the rows 1,073px against the 1,028 they need.

            ## THE OLD ARITHMETIC, AND WHY IT IS KEPT RATHER THAN CORRECTED AWAY

            Until 2026-08-31 line 2 carried the 176px Attachments field and
            measured **1,050px**, which put the ceiling at 167px: `w-40` (160)
            left 7px — inside the error bar on two `w-fit` `Toggle`s — and `w-44`
            (176) "does not fit at all: it wraps the Attachments field onto a
            third line". That sentence is now about a field this row no longer
            has, so it cannot be left standing as a live constraint; but it is
            the whole reason the number is 144, and a reader who finds only the
            conclusion cannot tell a measured width from a guessed one.

            THE WIDTH IS NOT WIDENED TO SUIT THE NEW HEADROOM. 189px would admit
            `w-44` (176), and the tile would then be wider than the two rows are
            tall (114px), which is the constraint the next section states and the
            one that has not moved. 144 was chosen against BOTH; only one of them
            loosened.

            ## AND IT COSTS NO HEIGHT

            The two rows are 114px tall (53 + 8 + 53). A 144-wide tile at 4:3 is
            108px. The picture fits inside the height the header already had,
            which is the whole reason this reads as filling a gap rather than as
            a new block.

            ## `flex-1` ON THE LEFT, NEVER AN AUTO BASIS

            `FieldRow`'s outer div is `@container/section`, and
            `container-type: inline-size` applies SIZE CONTAINMENT — the element
            contributes nothing to intrinsic sizing, so a shrink-to-fit flex item
            wrapping it measures 0 and COLLAPSES. A zero basis plus grow never
            asks for an intrinsic size, so the containment cannot bite. This is
            written down because it is invisible until it happens: the rows do
            not misbehave, they vanish.

            `items-start`, not `FieldRow`'s own `items-end`: the tile is 108px
            against a 53px field, and bottom-aligning would sink the fields to
            the foot of a tall line and open a gap under nothing.

            THE COLUMN IS CONDITIONAL, so an order with no sketch is byte-for-byte
            the layout that was there before and the rows get the whole pane back
            — the standing rule that an unfilled field shows nothing, applied to
            a column. */}
        <div className="flex items-start gap-x-3">
        <div className="min-w-0 flex-1 space-y-2 @2xl/editor:space-y-1.5">
          <FieldRow>
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
                shape a composed name uses (AGENTS.md, "Mandatory fields").

                AND ON 2026-08-31 IT MOVED ONE STEP FURTHER ALONG. Unit and Date
                are auto-determined and off the Tab path now, so they gave up
                their `*` and their hold for exactly the reason this field never
                had one — a field the operator is not meant to be standing on
                must not refuse to be left. The requiredness is now stated ONLY
                in `validity` (see the note on the Unit entry there), which is
                where the record — rather than any box — is judged. The chain is
                the same shape it always was, one link longer. */}
            <Field label="RE No" w="code" htmlFor="hd-scno">
              <Input
                id="hd-scno"
                readOnly
                value={savedOrderNo ?? previewNo ?? ""}
              />
            </Field>
            {/* AUTO-DETERMINED AND OFF THE TAB PATH (client 2026-08-31: "the
                keyboard tab navigation must completely bypass the Entry Date and
                Location/Unit fields … automatically determined by the
                workstation's active branch location").

                The Unit comes from the signed-in operator's own
                `profiles.default_location_id` — `startingLocationId` above, which
                already existed to preview the RE No and needed nothing added.

                `unitAuto.offTabPath` / `.required` BOTH come from
                `autoFilledField(!!form.location_id)`, and the pairing is the whole
                safety of this change: a field Tab can never reach that ALSO holds
                the cursor while blank is an unsatisfiable cage — the operator can
                neither be brought to it nor leave it. So the two flags flip
                together on one condition. Filled (the ordinary case, and always
                the case on a new order the moment `openAdd` runs): no `*`, no
                hold, Tab steps over it. **Empty** — a profile with no default
                location and no active unit to fall back on, or a saved order
                holding none — and it comes straight back onto the Tab path with
                its star and its hold, which is exactly the state in which the
                operator has to fill it in by hand.

                THE RECORD IS STILL UNSAVEABLE WITHOUT IT. The `*` and the hold are
                what the client asked to remove from the operator's path; the guard
                is the unconditional `required: true` Unit entry in `validity`
                below, which does not read this at all. One is presentation, one is
                enforcement, and only the first is conditional.

                REQUIRED because the SC No cannot be built without it — 0395 counts
                per (location, fiscal year) and the trigger refuses a blank one
                rather than invent a shared bucket. READ-ONLY once saved: the
                number is stamped on insert only, so changing the Unit afterwards
                would leave an HO/… number on a different unit's order. That
                `disabled` is unchanged and deliberately independent of the marker:
                it is about a value that must not move, not about where Tab goes. */}
            <Field
              label="Unit"
              required={unitAuto.required && !editId}
              offTabPath={unitAuto.offTabPath}
              w="num"
            >
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
            {/**
              * NO FUTURE DATES, PAST DATES FULLY ALLOWED (client 2026-08-29:
              * "restricts the Garment Order entry Date field to prevent the
              * entry of future dates while fully permitting past date entries").
              *
              * An order is entered when it arrives or afterwards — a PO booked
              * on paper last week is typed in today with last week's date, which
              * is why there is no lower bound at all. What cannot happen is an
              * order dated forward: this date buckets the RE No by fiscal year
              * (`assign_order_number`, 0395) and is stamped on the document, so
              * a mistyped 2027 puts the order in next year's series.
              *
              * ## `max` IS HALF THE RULE, AND ONLY HALF
              *
              * It greys out later days in the picker and makes the field report
              * itself invalid, and `Input` is built so a call site's `max` beats
              * its own `DATE_MAX` typo-guard — that note documents the override
              * explicitly. But `max` on a native date input bounds VALIDITY, not
              * TYPING: the operator can still type 2027 into the year segment
              * and the value reaches state. So the ceiling has to be declared
              * again where the record is judged, and it is — see the "Date
              * cannot be in the future" problem in `validity`. Same shape as
              * every other rule on this screen: one statement, two enforcers,
              * neither trusted on its own.
              *
              * COMPUTED PER RENDER rather than held in state, so an order left
              * open across midnight does not keep yesterday's ceiling.
              *
              * ## AND SINCE 2026-08-31 IT IS OFF THE TAB PATH
              *
              * Client: "the keyboard tab navigation must completely bypass the
              * Entry Date and Location/Unit fields … automatically determined by
              * … the current calendar date. Bypassing them prevents unnecessary
              * cursor clicks and stops users from accidentally editing the logged
              * entry date."
              *
              * `today()` has seeded this field in `openAdd` since the field
              * existed, so the value was already automatic; what changes is that
              * the operator no longer TABS ONTO IT on the way to the Customer.
              *
              * NOT `readOnly`, and this is the one decision in the change worth
              * arguing. `readOnly` would satisfy "stops users from accidentally
              * editing" outright — it is what the RE No above does, and it brings
              * `tabIndex={-1}` with it for free. It would also REVOKE the 08-29
              * instruction two paragraphs up, which is two days old and explicit:
              * an order booked on paper last week is typed in today WITH LAST
              * WEEK'S DATE. A field nobody can edit cannot do that.
              *
              * `data-focus-optional` is the mechanism that separates the two.
              * Tab and Enter step over the cell; ↑ ↓ ← → and the mouse still land
              * in it and typing still works. So the ACCIDENT is removed — nothing
              * arrives here by the operator's typing rhythm — and the deliberate
              * back-dating the client asked for two days ago is untouched. That is
              * precisely the marker's stated purpose: "the escape-hatch … an
              * operator should reach for deliberately rather than trip over".
              *
              * The `*` and the cursor hold come off with it, through the same
              * `autoFilledField` pairing the Unit above explains — and for the same
              * reason: a mandatory hold on a field Tab cannot deliver is a cage.
              * The record is still unsaveable without a Date: that lives in the
              * unconditional `required: true` "Date" entry in `validity`, and so
              * does the no-future-dates ceiling, neither of which reads this.
              */}
            <Field
              label="Date"
              required={dateAuto.required}
              offTabPath={dateAuto.offTabPath}
              w="code"
              htmlFor="hd-date"
            >
              <Input
                id="hd-date"
                type="date"
                max={today()}
                value={form.amend_date}
                onChange={(e) => set({ amend_date: e.target.value })}
              />
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
            {/* `customerFold.rows`, NOT `data.customers` — case-duplicates fold
                into one entry (client 2026-08-31) and the row this order already
                holds always survives the fold. The whole argument, and why the
                fold cannot live in the service, is on `customerFold` above. */}
            <Field label="Customer" required w="name">
              <RecordPicker
                label="Customer"
                compact
                items={customerFold.rows}
                value={form.customer_id}
                onChange={(id) => set({ customer_id: id })}
              />
            </Field>
            {/**
              * PO NO — MANDATORY, AND A DOCUMENT REFERENCE (client 2026-08-31:
              * "PO Number: strictly mandatory field that accepts alphanumeric
              * values").
              *
              * `required` ON THE `<Field>`, once. That one prop draws the `*`,
              * emits `data-required-empty` through `RequiredScope` → `Input`'s
              * `useRequiredHold`, and is restated in `validity` below so Save
              * refuses and the server's Zod refuses too — the four enforcers,
              * from one declaration (AGENTS.md, "Mandatory fields").
              *
              * `ValidatedInput format="doc_ref"` RATHER THAN A REGEX HERE. The
              * kind is declared once in `lib/validation/formats.ts` and the
              * screen and the server read the same spec, so the sentence the
              * operator sees under the box is byte-for-byte the one
              * `amendmentInput`'s `requiredKind("doc_ref", …)` produces on
              * reject. A second regex at this call site would compile, run, and
              * disagree with the server about one character.
              *
              * ## THE KIND WAS `alphanum` AND BOTH HALVES CHANGED THE SAME DAY
              *
              * The client's words are "accepts alphanumeric values", and a strict
              * `^[A-Z0-9]+$` refused `PO-1000` and `4471-B` — the shapes this
              * repo's OWN vectors reach for, and what a real buyer PO is built
              * from. Since PO No is mandatory from the same instruction, an order
              * holding one could not be saved until it was retyped without its
              * separator. The user widened it to `DOC_REF_RE`
              * (`^[A-Z0-9][A-Z0-9/-]*$`) once shown that evidence.
              *
              * **The rename went with the regex, and that is the load-bearing
              * half.** A kind still called `alphanum` while accepting hyphens
              * lies to its next caller, who would reach for it expecting the name
              * to be the spec. Do not restore the old name, and do not narrow the
              * regex back without a new client decision.
              *
              * THIS CALL SITE WAS THE LAST THING HOLDING THE OLD NAME, briefly,
              * and it is worth knowing which direction that breaks in: the server
              * had already widened, so the screen was refusing values the
              * database would happily have stored — a red error on a good value,
              * with the widening the user asked for invisible. Two one-word edits
              * closed it. Three declarations, one spec.
              *
              * It brings the keystroke transform with it: `doc_ref`'s `transform`
              * is `"upper"`, so this field capitalises as it is typed AND carries
              * the CSS transform for a value loaded from a row saved before the
              * rule — which is the same two halves the CAPITALS rule requires of a
              * plain `<Input>`, arriving through the format spec instead of
              * through the primitive's default.
              *
              * THE FORMAT ERROR DOES NOT BLOCK SAVE, deliberately, and that is
              * the app-wide rule rather than a decision taken here:
              * `isBlocking()` treats `"format"` as non-blocking because a format
              * check fires against a HALF-TYPED value, and caging an operator on
              * a value they are in the middle of getting right is the failure the
              * GSTIN precedent records. The REQUIRED half blocks, the message
              * shows live under the field, `aria-invalid` already stops Enter
              * COMMITTING (see `ValidatedInput`), and the Zod refinement is the
              * guard.
              *
              * `required` IS NOT PASSED TO `ValidatedInput`. It would render its
              * own "Required." line under a field that already carries the star
              * and the hold — two statements of one fact, and the second one
              * appears only after a blur. `<Field required>` is the declaration.
              */}
            <Field label="PO No" required w="code" htmlFor="hd-pono">
              <ValidatedInput
                id="hd-pono"
                format="doc_ref"
                value={form.po_no}
                onChange={(e) => set({ po_no: e.target.value })}
              />
            </Field>
            {/**
              * MERCHANDISER — MANDATORY, AND IT IS AN HR EMPLOYEE NOW (client
              * 2026-08-31: "the Merchandiser field is a strictly required input
              * wired directly to the HR Staff Master").
              *
              * `data.merchandisers` is a `public.employees` row since this drop —
              * the only one of the three candidate tables carrying BOTH
              * `designation_id` and `department_id`, which is what makes the
              * client's "Designation or Department = Merchandiser" expressible at
              * all. The rows carry the disable flag as **`inactive`**, not
              * `blocked` — 0299 renamed `employees.blocked`, and selecting the
              * old name makes PostgREST reject the whole query and hand back an
              * empty dropdown, which reads as "no merchandisers are set up yet".
              * It rides in through `PickerRow & Deactivatable`, so `isInactive()`
              * finds it whatever it is spelled. It is NOT filtered
              * in SQL, so `RecordPicker` hides a switched-off employee from the
              * list while an order that already NAMES one still resolves and
              * still shows them — the "Disabled rows" rule. Filtering in the
              * query would satisfy half of it and blank the FK on the next save.
              *
              * The same survival argument covers a designation CHANGE, which is
              * the one this field is unusually exposed to: a merchandiser who
              * moves to another desk drops out of the option list, and the orders
              * they booked must keep naming them. `merchandiserOptions` re-appends
              * the held row for exactly that reason — the service hands over
              * `is_merchandiser` as a flag because it cannot know which employee
              * an order names, and the helper (not this call site) puts the held
              * one back. Same division of labour as the Customer fold beside it.
              *
              * ## AND THE LIST IS EMPTY IN PRODUCTION TODAY
              *
              * Measured on the live catalog 2026-08-31: `employees` holds ONE row
              * ('Test Employee', designation 'Test Designation') and no
              * `config_lookups` row anywhere contains the word "merchandiser". So
              * the narrowing matches nothing — and because this field became
              * MANDATORY in the same change, Order Entry is unsaveable, in the
              * least diagnosable shape there is: an empty dropdown reads as
              * "nothing has been set up yet", which is a real and unremarkable
              * answer, so the operator retries, gives up, and files "I cannot save
              * orders" rather than "the merchandiser list is empty".
              *
              * `shortHint` is what turns the second sentence into the one they
              * file. It is `null` whenever there ARE options — including when the
              * only option is the held row — so it can never overwrite the
              * ordinary empty box on a working field.
              */}
            <Field label="Merchand." required w="term">
              <RecordPicker
                label="Merchand."
                compact
                items={merchandisers.items}
                /* placeholder-blank: exempt -- empty-and-explain (AGENTS.md,
                   "Nominated vendors"). Blank here is not an unanswered field, it
                   is a master that cannot answer, and saying so is the whole
                   point — see `merchandiserOptions`.

                   AS A PLACEHOLDER, NOT A `hint`, which is the same call the
                   vendor rule makes for a grid cell and for the same reason one
                   field along: a `hint` renders UNDER the control, and `FieldRow`
                   is `items-end`, so a field carrying one bottom-aligns on the
                   hint and its control rides high — out of line with every box on
                   the row (`Field`'s own note). The explanation lands inside the
                   empty box the operator is already looking at. `DataPicker` gives
                   it `text-ellipsis` plus the hover bubble, so a 176px cell clips
                   it visibly and readably rather than silently. */
                placeholder={merchandisers.shortHint ?? undefined}
                /* AND IN THE PANEL — the closed field is not where an operator
                   discovers the list is empty; they open it first. */
                emptyHint={merchandisers.hint}
                value={form.merchandiser_id}
                onChange={(id) => set({ merchandiser_id: id })}
              />
            </Field>
          </FieldRow>

          {/* LINE 2 — THE ORDER'S TERMS. The break is where it has always been:
              line 1 is who the order is and who it is for, line 2 is what it is
              worth. Two declared rows rather than one wrapping one, because the
              wrap point of a single row moves with the pane and these two groups
              do not. */}
          {/* THE ATTACHMENTS CONTROL RODE THIS ROW FOR FIVE DAYS AND HAS MOVED
              ONTO THE STYLE ROWS (client 2026-08-26 put it here: "move that
              attachment field near the rejection field"; client 2026-08-31 moved
              it on, because a document belongs to a STYLE and is mandatory
              before that style can be saved). It is the Files cell on the
              Style(s) tab now.

              SO THIS ROW IS SIX CELLS AGAIN, AND THE ARITHMETIC MOVED WITH IT:
              144 + 112 + 72 + 74 + 112 + 288 = 802px plus five gaps = **862px**,
              against a ~1,229px pane. It was 978px plus six gaps = 1,050px while
              the 176px Attachments cell was the seventh, which is the figure the
              sketch column's own note was measured against — that note has been
              corrected and says what changed.

              ORDER-LEVEL FILES DID NOT MOVE AND COULD NOT. A file stored before
              the column existed names no style and nothing can invent one, so
              the corner column beside these rows is where they are seen and
              removed (`orderLevelFiles`), and it is the only place they appear.
              Dropping it with the field would have stranded them.

              THE PANEL SAT BESIDE THE ROW FOR ONE TURN AND THAT SHAPE IS GONE.
              It needed a flex wrapper, `flex-1` on the row and a basis on the
              panel, and it carried a live trap worth remembering if anything
              like it comes back: `FieldRow`'s outer div is `@container/section`,
              and `container-type: inline-size` applies SIZE CONTAINMENT, so a
              shrink-to-fit flex item wrapping it measures 0 and collapses. A
              field in the row needs none of that. */}
          <FieldRow>
            {/* DELI.DT SITS HERE, NOT BELOW Yr (client 2026-08-11). The dictated
                entry run is SCNo → Date → Customer → PO No → Merchandiser →
                Deli.Dt, and Season/Yr standing between Merchand. and Deli.Dt broke
                it in the middle. They stay in the header — the client was explicit
                that they belong here and not on the style rows, where they have
                never been. */}
            {/* REQUIRED SINCE 2026-08-31 (client). Deli.Dt used to be the
                header's one deliberately-unblocking date — the `sectionValidity`
                comment said so by name ("Deli.Dt is not here at all because it
                does not block"). That is now false, and the entry beside `Date`
                in that list is what makes it true again.
                `required` on the FIELD draws the star and, through
                `useRequiredHold`, holds the cursor on a blank box; the validity
                entry blocks Save; the Zod rule guards the writer. One
                declaration is not enough on a header field — all three, or the
                star is decoration. */}
            <Field label="Deli.Dt" w="code" htmlFor="hd-deli" required>
              <Input id="hd-deli" type="date" required value={form.delivery_date} onChange={(e) => setHeaderDeliveryDate(e.target.value)} />
            </Field>
            <Field label="Season" w="range" htmlFor="hd-season" required>
              <Select id="hd-season" required value={form.season} onChange={(e) => set({ season: e.target.value })}>
                <option value=""></option>
                {SEASON_OPTIONS.map((o) => (
                  <option key={o} value={o}>{o}</option>
                ))}
              </Select>
            </Field>
            {/**
              * ## SUPERSEDED 2026-08-26 — THE SPANS BELOW ARE HISTORY
              *
              * Every arithmetic argument in this note is about `col-span` on a
              * 12-column track, and this row is a `FieldRow` now: the fields
              * carry declared WIDTHS and there are no twelfths to divide. The
              * note is kept whole rather than deleted because it records WHY
              * the tail of the header reads as a set and why Pack and Multi
              * Style are two cells rather than one — both of which still hold.
              * Read "so they sum to twelve" as "so the row was flush", which is
              * the requirement 08-26 traded away on purpose (see the note at
              * the top of the section).
              *
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
            <Field label="Excess %" w="num" htmlFor="hd-excess">
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
            {/* NO `<Field>` LABEL ANY MORE — THE SWITCH CARRIES ITS OWN
                (client 2026-08-26). A `<Field label>` puts the word on one line
                and a 34px switch on the next, so inside a 241px grid cell a 34px
                control was spending two lines and a sixth of the row. `Toggle`
                renders `label` as the words beside the switch and its own note
                already says to omit it "where a `<Field>` label already names the
                answer" — so this drops the FIELD label rather than the switch's,
                and the word still appears exactly once. That is what the
                2026-08-17 fix was about (the cell used to read "Pack / Mult. Ord"
                with both words printed again inside it), and it is preserved.

                A TICK BOX WOULD BE 8px NARROWER AND WAS DECLINED: the switch was
                chosen on 2026-08-14 because it "carries its state in its shape and
                its colour", where a tick makes the eye find the box and then read
                the word. Eight pixels do not buy that back.

                Keys are untouched — it is the same real `<input type="checkbox">`
                underneath, so Tab, Enter and Space behave as they did. */}
            <Toggle
              id="hd-pack"
              label="Pack"
              checked={form.pack}
              /* Turning this ON also answers the Quantities grid's Assortment
                 Type where a line has not — see `answerPack`. Turning it off
                 clears nothing. */
              onChange={answerPack}
            />
            {/**
              * "SET PACK" — RETAIL SETS, AND IT IS NOT THE SWITCH BESIDE IT
              * (client 2026-08-25, 0467).
              *
              * A pyjama set, a 3-pack of bodysuits: the buyer orders BOXES, the
              * factory makes GARMENTS, and the price on the invoice is per box.
              *
              * IT IS A SECOND FLAG BECAUSE `pack` ALREADY MEANS CARTONS, on the
              * client's own instruction (2026-08-10), and the two questions are
              * independent — a 3-pack is still shipped in cartons, and those
              * cartons are still either solid-size or assorted. Folding both
              * into one switch leaves three of the four states unanswerable and
              * silently gets "retail set, shipped solid" wrong, which is the
              * ordinary case.
              *
              * Turning it on DISABLES PO Qty and the price rate, because both
              * are then derived from the composition rather than typed. See
              * `piecesPerPack`.
              *
              * GATED BY `SET_PACK_ON_SCREEN`, which is TRUE again since
              * 2026-08-27 — it was hidden and restored the same day. The
              * `|| form.is_set_pack` half is what makes hiding it safe and so
              * outlives any particular value of the flag: the switch also
              * renders for an order that ALREADY holds it, so switching it off
              * can never strand a saved set pack with a derived PO Qty and no
              * way to turn the derivation off. That is the same call AGENTS.md
              * records for a disabled master row: the one that survives the
              * filter is the one the record already holds.
              */}
            {(SET_PACK_ON_SCREEN || form.is_set_pack) && (
              <Toggle
                id="hd-setpack"
                label="Set Pack"
                checked={form.is_set_pack}
                onChange={(is_set_pack) => set({ is_set_pack })}
              />
            )}
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
            <Toggle
              id="hd-multord"
              label="Multi Style"
              checked={form.mult_ord}
              onChange={(mult_ord) => set({ mult_ord })}
            />
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
            {/* REQUIRED SINCE 2026-08-31 (client) — AND IT REVERSES WHAT BLANK
                MEANT HERE. The `placeholder-blank` exemption below still reads
                "blank here is a STATE OF THE ORDER (no rejection projection),
                not an unanswered field", and the placeholder says "No
                rejection". That was the whole justification for the exemption,
                and requiring the field retires it: there is now no way to
                express "this order has no rejection allowance", because the
                cursor holds until a rule is picked.
                FLAGGED TO THE CLIENT rather than resolved here — if "no
                rejection" is a real state some orders need, this needs a
                NO-REJECTION rule row in the master to select, not a blank. The
                placeholder is left as-is deliberately: changing it to something
                like "Select a rule" would quietly erase the evidence that blank
                used to mean something. */}
            <Field label="Rejection Rule" w="name" required>
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
                /* The picker's OWN `required` — the hold is driven by the
                   control, not by the `<Field>` label, so both carry it. */
                required
                items={data.rejectionRules}
                value={form.rejection_rule_id}
                onChange={(id) => set({ rejection_rule_id: id })}
                /* placeholder-blank: exempt -- LAYOUT.md §3 names this one by hand:
                   blank here is a STATE OF THE ORDER (no rejection projection), not
                   an unanswered field. */
                placeholder="No rejection"
              />
            </Field>
            {/* THE "Attachments" CELL STOOD HERE AND IS GONE (client
                2026-08-31): the Add File control belongs to a STYLE, so it is
                the Files cell on each Style(s) row, mandatory before that style
                can be saved. This row is six cells again — the note above it
                carries the new arithmetic.

                THERE IS DELIBERATELY NO ORDER-LEVEL ADD CONTROL LEFT. An
                order-level file is now only ever a LEGACY row (one stored before
                the column existed), so a button that creates more of them would
                be a way to keep making the state the move exists to end. The
                corner column beside these rows still SHOWS and REMOVES them —
                see `orderLevelFiles` there. Removing without adding is the
                asymmetry that matters: nothing is stranded, and nothing new
                lands in a bucket no style owns.

                The 2026-08-26 note that stood here explained why the control was
                a bare `<Field>` rather than a heading, a sentence and a dashed
                empty box — one button's worth of chrome, cut by the 08-17
                de-clutter rules. That reasoning did not die with the cell: it is
                what the per-style Files cell is built as, so it lives on the
                `variant="cell"` control in `file-attachments.tsx`. */}
          </FieldRow>
          {/**
            * THE FOLD SAYS WHAT IT HID (client 2026-08-31, the other half of the
            * Customer dedup ask).
            *
            * `collapseCaseDuplicates` removes a REAL master row from the field —
            * one an operator could previously pick and can no longer reach by
            * typing its name. Hiding it silently would leave that customer
            * permanently unreachable with nothing anywhere to explain it, and
            * the merge that would actually fix the data would never get asked
            * for. Every pair this folds is a row saved before capitals became
            * the default (2026-08-18), so it is finite and it is fixable.
            *
            * UNDER THE ROWS, NOT AS A FIELD `hint`. `FieldRow` aligns on
            * `items-end`, and `Field`'s own note records the consequence: a cell
            * carrying a hint bottom-aligns on the HINT and its control rides
            * high, out of line with the ten boxes beside it. A line beneath the
            * two rows costs the row nothing.
            *
            * IT RENDERS NOTHING WHEN THERE IS NOTHING TO SAY, which is the
            * standing de-clutter rule and also the ordinary case: on data typed
            * since the capitals flip, `folded` is empty.
            */}
          {customerFold.folded.length > 0 && (
            <p className="text-xs text-warning">
              {customerFold.folded.length === 1
                ? `${customerFold.folded[0]} has more than one customer master row`
                : `${customerFold.folded.length} customers have more than one master row (${customerFold.folded.slice(0, 3).join(", ")}${customerFold.folded.length > 3 ? "…" : ""})`}
              {" — listed once here. Merge them on the Customer master."}
            </p>
          )}
        </div>
        {orderLevelFiles.length > 0 && (
          <div className="w-36 shrink-0">
            {/* THE ORDER'S OWN DOCUMENTS — the ones that name no style
                (`orderLevelFiles`), and since 2026-08-31 that is what this
                column holds rather than every attachment.

                IT NARROWED WITH THE MOVE, AND HAD TO. Every file now belongs to
                a style and is shown in that style's own Files cell; leaving this
                column on `attachments` would print the whole order's documents a
                second time, in a 144px corner, with no way to tell which style
                any of them was for. What is left is the one bucket with nowhere
                else to appear: a row stored before the column existed, or one
                demoted when its style ref was retyped. Nothing can invent which
                style those were for, so this is where they are seen and removed
                — and it is why the column could not simply be deleted along with
                the Add control above. The GATE is `orderLevelFiles.length` for
                the same reason: on `attachments.length` an order carrying only
                per-style files would draw an empty 144px column.

                IT IS NOW THE ONLY WAY TO REMOVE ONE, which is deliberate: there
                is no order-level Add any more (see the note where the field
                stood), so the bucket can only ever shrink.

                `onChange` IS NOT `setAttachments`. This control is handed a
                SUBSET and hands the subset back, while `setAttachments` replaces
                the whole array — so passing it through directly would delete
                every style's documents the moment one order-level file was
                removed. Silent, total, and only visible on the next save.
                `spliceOrderLevelFiles` keeps the rest, splicing IN PLACE rather
                than rebuilding, because array order is what `sketchPath` reads
                to choose the header thumbnail — the same reason `setStyleFiles`
                splices from the other side.

                THE ORIGINAL 2026-08-26 NOTE, still true of what is left:

                SO IT CANNOT BE KEYED ON `sketchPath`. That is the first row whose
                `doc_kind` is `sketch`; a buyer's PDF order sheet is
                `order_sheet`, and keying on the sketch would have left it with no
                representation anywhere on the screen — nothing to open, and
                nothing to remove it by. `tiles` draws a picture where there is
                one and a named chip where there is not.

                A tile is `object-contain` on a 4:3 box — LETTERBOXED, never
                cropped. The 32px chip in `PageHeader` crops because at that size
                a drawing is an identifier; here it is the thing being looked at
                while the order is typed, and a tidy crop hides the half the
                operator wanted.

                THE 32px CHIP STAYS TOO, and is not redundant: its documented job
                is being reachable from Combos and Sizes, three and four rail
                stops from here. It still reads across ALL attachments — a sketch
                filed under a style is still this order's sketch — which is why
                the chip is unchanged while this column narrowed. */}
            <FileAttachments
              variant="tiles"
              rows={orderLevelFiles}
              onChange={spliceOrderLevelFiles}
              bucket="garment-order-docs"
              folder={editId ?? uploadFolder}
              disabled={!perms.canEdit}
            />
          </div>
        )}
        </div>

        {/* THE STYLE(S) GRID LEFT THIS SECTION ON 2026-08-27 (client: "move
            that style section from order info as separate tab"). It is the
            `styles` tab below; see the note there for what the split had to
            carry with it.

            The note that stood here said the grid MUST RENDER LAST, because
            `cycleTab` treats the pane's last field-like node as the SECTION
            EDGE — the point where Tab hands to the next section through
            `registerContentEdge`. That is still true and is now automatic: the
            header fields are the whole section, so the last of them IS the
            edge. Nothing to order, and nothing to get wrong. */}
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
        // Only `logistic` can carry one today; the lookup is keyed rather than
        // hard-coded so a field declared against another tab tomorrow shows up
        // on the rail without this line being remembered.
        problems: validity.bySection[t.key],
        // Forwarded, never re-derived — see `OrderTab`.
        skipTab: t.skipTab,
        /* Style(s) is the only section that sets it today. Forwarded by key
           rather than hard-coded here for the reason `problems` above is: a
           second section that needs the wider pane declares it on itself and
           appears correctly without this line being remembered. */
        wide: t.wide,
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
    <div
      className="flex h-full flex-col gap-4"
      /* ONE LISTENER RATHER THAN ~40 SETTERS — see `touched`. Capture phase so a
         control that stops propagation (the pickers do) still counts, and
         `onInput` as well as `onClick` so typing registers without a click. */
      onInputCapture={() => setTouched(true)}
      onClickCapture={() => setTouched(true)}
    >
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
           component gives "← Back to Order Management" at /orders/garment-orders and
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
          <div className="flex items-center gap-3">
            {/* THE ORDER-LEVEL LEDGER. Here rather than in a pinned card of its
                own: the operator's standing rule is that a record's header
                fields are a SECTION, not a band floating above the rail, and a
                new full-width band is that shape. `PageHeader` is already the
                one strip that names this record, and `MasterFullScreen` is
                mounted `page` here precisely so this header stays visible.

                SHOWN ONLY ONCE THERE IS A BREAKUP TO REPORT ON. Before that it
                would say "0 of 0", which is a claim about an order nobody has
                started — the same call `assortBalanceOf` makes by answering null
                rather than a shortfall. */}
            {orderBalance.rows > 0 && orderBalance.target > 0 && (
              <span className="hidden items-baseline gap-1.5 text-xs sm:flex">
                <span className="text-muted-foreground">Order breakup</span>
                <span className="font-medium tabular-nums text-foreground">
                  {fmtNumber(orderBalance.allocated)}
                </span>
                <span className="text-muted-foreground">of</span>
                <span className="font-medium tabular-nums text-foreground">
                  {fmtNumber(orderBalance.target)}
                </span>
                {orderBalance.started === 0 ? (
                  <span className="text-muted-foreground">· not started</span>
                ) : orderBalance.allocated === orderBalance.target ? (
                  <span className="text-success">· balanced</span>
                ) : orderBalance.allocated < orderBalance.target ? (
                  <span className="text-warning">
                    · {fmtNumber(orderBalance.target - orderBalance.allocated)} left
                  </span>
                ) : (
                  <span className="text-danger">
                    · {fmtNumber(orderBalance.allocated - orderBalance.target)} over
                  </span>
                )}
              </span>
            )}
            {/* THE SKETCH, REACHABLE FROM EVERY SECTION. It is uploaded on Order
                Info and read while filling Combos and Sizes, which are three and
                four rail stops away — so without this the operator navigates
                back, looks, and navigates forward again for every glance.

                Here rather than in a pinned card of its own, for the reason the
                balance figure beside it is here: a record's header fields are a
                SECTION, not a band floating above the rail, and `PageHeader` is
                already the one strip that names this record. */}
            <SketchThumbnail bucket="garment-order-docs" path={sketchPath} />
            <Button variant="outline" size="md" onClick={() => setMode("list")}>
              ← Back to list
            </Button>
          </div>
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
        ref={shellRef}
        mount="page"
        open
        // No `header`: the route's own PageHeader above already names the
        // record, and a second identity band would announce it twice.
        onClose={() => setMode("list")}
        modeLabel={null}
        /* ROWS *AND* A TOUCH. `tabsHaveRows` alone is true the moment a real
           order loads, which pinned the guard on for the whole session and kept
           deploys out of the tab (see `touched`). The discard prompt still asks
           on rows alone — losing typed work and losing a loaded order are
           different questions, and only the reload one needs to know whether the
           operator has actually been editing. */
        dirty={tabsHaveRows && touched}
        sections={sections}
        /* The one action that means "show me the colourways" — see
           `listStylesInCombos`. Keyed by section rather than by a Combos-only
           callback so a second screen needing the same shape has it. */
        onEnterSection={(key) => {
          if (key === "combos") listStylesInCombos();
        }}
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
          /* THE LINE THAT WAS MISSING. Without it the primitive disables Save,
             which is a dead button and — via `submitTargetOf` — Ctrl+S and Enter
             landing on Cancel. See `revealFirstProblem`. */
          onBlockedSave: revealFirstProblem,
          /* "3 to fix", between the status and Cancel, so the operator can see
             there is something to fix WITHOUT pressing a button first. Clicking
             it re-fires the reveal. Chrome, so Tab steps over it. */
          extra:
            validity.blocking.length > 0 ? (
              <button
                type="button"
                onClick={revealFirstProblem}
                className="text-xs font-medium text-danger hover:underline"
              >
                {validity.blocking.length} to fix
              </button>
            ) : undefined,
          onSaveDraft: perms.canCreate ? () => submit(true) : undefined,
          isPending,
          /* NEXT UNTIL THE LAST SECTION, THEN SAVE (client 2026-08-27, on the
             first tab of a new order: "instead just show the Next button until
             the last tab — once we reach the last tab show this option").

             This document is eleven sections long, and every one of them was
             offering "Save garment order" beside a red "6 to fix" before the
             operator had answered anything. The count was true and the button
             was honest; both were just being put on the first screen of an
             eleven-screen form.

             The rule lives in `MasterFullScreen` — see `footer.stepper` — since
             "am I on the last section?" is a question only the shell can answer.
             Opt-in, so the masters' two-section editors are untouched. */
          stepper: true,
          /**
           * NEXT REFUSES TO LEAVE QUANTITIES WHILE THE TWO PO TOTALS DISAGREE
           * (client 2026-08-31: "If a user tries to click 'Next Tab' … Halt
           * navigation completely and lock the user to the Quantity tab until
           * they correct the mismatch").
           *
           * ## ONE RULE AND ONE SECTION, not a general gate on Next
           *
           * `MasterFullScreen` states in as many words why Next is otherwise
           * ungated: "a section is routinely left half-filled on the way past —
           * an operator who cannot get to Logistic until Order Info is perfect
           * has a wizard that traps them on step one." That reasoning is not
           * withdrawn. This guard names ONE section and reads ONE arithmetic, so
           * every other step is exactly as free as it was yesterday, and an
           * order with six other things outstanding still walks through the rail
           * unimpeded.
           *
           * ## THE RAIL STAYS LIVE, AND THAT IS THE DIFFERENCE THAT MATTERS
           *
           * The guard sits on the footer's Next button and NOT inside
           * `goToSection`, so clicking a rail row still moves. That is not a
           * softening of the client's instruction — it is what makes the
           * instruction satisfiable. The mismatch is between this tab and
           * Style(s), and the operator's fix is at least as likely to be on
           * Style(s) as here; a lock that also sealed the rail would leave
           * retyping every destination as the only route to a number that is
           * wrong one tab back. Save is dead either way (`crossTabProblems`), so
           * nothing unbalanced is stored while they go and look.
           *
           * ## THE BUTTON STAYS ENABLED
           *
           * Same rule as Save beside it and as the Assort button two sections
           * up: a `disabled` control fires no pointer events, so it can never
           * say why it refused. It clicks, it reports, it does not move.
           */
          stepGuard: (from) => {
            /**
             * STYLE(S) SEALS THE RAIL; QUANTITIES DOES NOT (client 2026-08-31:
             * "if any are missing, the UI must highlight the invalid fields and
             * block progress to subsequent tabs").
             *
             * ## THE TWO GUARDS DIFFER BECAUSE THE REPAIRS DO
             *
             * The Quantities guard below refuses a breakup that contradicts a PO
             * Qty typed on ANOTHER tab, and its own note is emphatic that the
             * rail must stay open — "the only cell that can satisfy the rule
             * would be behind the rule". That argument does not transfer, and it
             * was checked rather than assumed: EVERY problem filed under
             * `section: "styles"` is repaired on the Style(s) tab — the six
             * mandatory cells (`styleLineProblemList`), Pack Composition and
             * Packs (`packProblems`), and the attachment (`styleFileProblems`).
             * There is no repair trip to protect, so there is no locked room to
             * build. If a rule filed against this section is ever fixable
             * elsewhere, that is the day `sealRail` has to come back off.
             *
             * ## FORWARD ONLY, AND NEVER AGAINST `revealFirstProblem`
             *
             * The shell consults this for a LATER section only, so Order Info
             * stays one click away, and `goToSection` — the imperative path a
             * blocked Save uses — is not guarded at all. Being held on Style(s)
             * can never mean being unable to reach the thing that would fix it.
             *
             * ## IT NAMES THE FIRST PROBLEM, NOT THE COUNT
             *
             * `validity.blocking` is already ordered by kind and then by section,
             * so its first Style(s) entry is the same one a blocked Save would
             * read out — one sentence, said the same way by both doors. The count
             * is only the fallback, for a section that is somehow blocked with
             * nothing to quote.
             */
            if (from === "styles") {
              const n = validity.bySection.styles ?? 0;
              if (!n) return null;
              const first = validity.blocking.find((x) => x.section === "styles");
              return {
                reason:
                  first?.message ??
                  `Finish the style lines first — ${n} thing${n === 1 ? "" : "s"} still missing.`,
                sealRail: true,
              };
            }
            return from === "quantities" ? poQtyCrossTabMessage : null;
          },
          /* The screen owns the message, exactly as it owns `onBlockedSave`'s.
             No `goToSection` call: the operator is already on Quantities, which
             is where the client asked them to be held, and a jump to the section
             they are standing in would steal the caret for nothing. */
          /* THE MOMENT THE CLIENT NAMED. The operator pressed Next (or a sealed
             rail row) and was held — so the rows now print their own reasons,
             not just the one sentence this toast carries. See
             `problemsRevealed`. */
          onStepBlocked: (why) => {
            setProblemsRevealed(true);
            toastError(why);
          },
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
        /* THE WHOLE PANE, not the 1180px reading width (client 2026-08-18:
           "make this screen full width instead of those left right gap"). What
           is in here is a six-column grid with a components grid nested under
           each row — a reading width squeezes it and leaves ~220px of white
           down each side. See `fullBleed` in sheet.tsx for why this is opt-in
           rather than the new default. */
        fullBleed
        footer={<SubSheetFooter onDone={() => setDetailComboKey(null)} />}
      >
        {detailCombo && (
          <div className="space-y-4">
            {detailHeader(detailCombo)}
            {structureGrid(detailCombo)}
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
        /* THE TITLE CARRIES THE ASSORTMENT TYPE (2026-08-19), which used to be
           a read-only box in a header band the client asked to be removed. It
           is the switch that decides what the grid asks for and how it adds up,
           so it belongs where the sheet says what it is. Joined with · rather
           than a second line: the sheet has one title slot and this is one
           thing — this destination, packed this way. */
        title={
          assortQty
            ? [
                `Assortments — ${assortQty.style_ref_no || "(no style)"}`,
                assortmentTypes.find(
                  (a) => a.id === assortQty.assortment_type_id,
                )?.name,
              ]
                .filter(Boolean)
                .join(" · ")
            : "Assortments"
        }
        zIndexBase={120}
        /**
         * THE 1180px READING WIDTH IS WRONG FOR A MATRIX (client 2026-08-19,
         * screenshot 2366 — Qty wrapping onto a line of its own).
         *
         * This is the same exception Combos ▸ Structure Details earned on
         * 08-18, and this grid is the stronger case: its column count is a
         * property of the DATA. A style with ten sizes is ten more boxes, and no
         * arrangement of a 1180px row holds them beside a ref, a combo, the
         * carton pair and a total. Capping it does not make a matrix readable —
         * it just wraps the last cell away from the cells it belongs to and
         * leaves ~220px of white down each side of the thing being filled in.
         *
         * The two changes work together: dropping the derived Style column
         * bought ~300px, this buys the rest of the screen. Neither alone gets an
         * assort-mode row (ref · combo · cartons · inners · N sizes · pcs · qty)
         * onto one line.
         */
        fullBleed
        /**
         * DONE REFUSES WHILE THE BREAKUP DOES NOT ADD UP (client 2026-08-31:
         * "check if the sum of all breakdown quantities equals the parent
         * quantity field … Disable the 'Done/Close' button action and keep the
         * pop-up open. Do not allow the user to save or exit the sub-screen
         * until the values match perfectly").
         *
         * ## THE RULE IS NOT NEW — THE REFUSAL IS
         *
         * `assortBalanceOf` has decided this since 2026-08-18 and has deadened
         * the order's Save since 08-20, so nothing unbalanced has ever been
         * storable. What was missing is that the operator could walk out of the
         * overlay and discover it two tabs later. That is the same PROXIMITY
         * defect the 08-20 pass diagnosed inside this grid ("the rule was never
         * missing, it was too far from the caret") arriving one layer out, and
         * it gets the same answer: the objection moves next to the thing being
         * objected to. `SubSheetFooter` prints the reason beside the button.
         *
         * ## ESCAPE AND ✕ STAY LIVE, DELIBERATELY
         *
         * They run through `onClose` above, which this does not touch. Blocking
         * them too would read as the stricter reading of the instruction and is
         * in fact the unsafe one: a style that lists no sizes has NO size cells
         * to type into (the empty state below says so), so its breakup can never
         * be made to equal anything — an operator who opened that overlay would
         * be sealed in with no key. AGENTS.md's hold rule is the precedent, in
         * its own words: a refusal that also refuses the way out "does not make
         * the rule stricter, it makes it unsatisfiable". A mandatory field holds
         * Tab and lets Escape through for exactly this reason.
         *
         * Ctrl+S activates the last footer button, so it now reports the reason
         * instead of closing — which is the honest thing for that key to mean
         * here, since there is no save on this layer either way.
         */
        footer={
          <SubSheetFooter
            onDone={() => setAssortQtyKey(null)}
            /* THE SAME SENTENCE THE RAIL AND THE DEAD SAVE USE. Retyping it
               here would be two wordings for one disagreement — see
               `assortBalanceMessage`. */
            blockedReason={assortQty ? assortBalanceMessage(assortQty) : null}
            onBlocked={(why) => toastError(why)}
          />
        }
      >
        {assortQty && (
          <div className="space-y-4">
            {/* THE ONLY THING ABOVE THE GRID (client 2026-08-19). The identity
                band is gone and the style pair moved into the row, so what is
                left here is the switch alone — and it belongs above, because it
                decides where every StyleRefNo cell beneath it writes to. */}
            {assortScope(assortQty, assortMode)}
            {/* THE MODE EXPLAINER IS GONE (client 2026-08-19: "remove this
                sentence"). It read "Size cells are the RATIO in one inner — Qty
                is cartons × inners × ratio" / "Size cells are the pieces
                themselves…", and it was the sentence added the day before to
                make the two arithmetics visible from where the numbers are
                typed.

                WHAT REPLACES IT IS NOT NOTHING. The Assortment Type now stands
                in the sheet's own TITLE, so the reading in force is still named
                where the operator can see it — "Solid Colour / Assort Size" is
                the sentence, in the words the client's own lookup uses. The
                columns say the rest: an assort pack shows Cartons, Inners and
                Pcs/Pack, a solid pack shows none of them. That is the same
                argument the carton fields already make by being hidden rather
                than disabled. */}
            {/**
              * THE SIZE COLUMNS ARE THE ONLY PLACE A QUANTITY IS TYPED, so when
              * a style declares no sizes this grid has NOWHERE to type one —
              * and it says so again (client 2026-08-27, screenshot 2522: "in
              * assortment there is no option for giving the input quantity").
              *
              * THIS RESTORES A SENTENCE THE CLIENT REMOVED ON 2026-08-19, and
              * that is deliberate rather than a tidy-up. The note above
              * `assortGrid` recorded exactly what the removal cost — "an
              * operator who has not entered the style's sizes sees a grid that
              * looks broken rather than one that says what to do" — and said
              * restoring it would need a NEW INSTRUCTION. The report above is
              * that instruction: it is the predicted symptom, reported as a
              * missing feature rather than as a missing size list.
              *
              * IT IS NOT THE OLD SENTENCE BACK. The 08-19 removal took a line
              * that showed on a grid which was ALREADY drawing its columns; this
              * one appears ONLY when there are no size columns at all, which is
              * the one state the grid cannot explain about itself. A screen with
              * sizes is unchanged, so nothing the client cleared has returned.
              *
              * IT NAMES THE SECTION, not a checkbox on another tab — the rule
              * the Pack type(s) empty state states, and the reason that one
              * carries a button rather than a direction. No button here: sizes
              * are a per-style list, so there is nothing one click could set.
              */}
            {!sizesForOverlay(assortQty).some((z) => z.size_id) ? (
              <p className="rounded-md border border-dashed border-border bg-surface-muted/40 px-4 py-3 text-xs text-muted-foreground">
                This style lists no sizes, so there are no size cells to fill and
                Qty stays 0 — the quantity is the SUM of the size cells, never
                typed on its own. Add the sizes on <strong>Style(s)</strong>,
                then reopen this.
              </p>
            ) : null}
            {assortGrid(assortQty, assortMode)}
            {/* THE CARTON BLOCK IS GONE (client 2026-08-19). Master CTN Name,
                Inner CTN Name and then Pack Description were all withdrawn from
                this screen in the same breath as the header band above them —
                the operator packs by size here, and naming the cartons is not
                what this surface is for.

                COLUMNS AND STORED VALUES ARE UNTOUCHED, which is the half that
                matters: `garment_order_amendment_quantities` is a CHILD table
                and `writeChildren` deletes and reinserts it wholesale, so a
                field dropped from `QuantityRow` or `toPayload` would be NULLED
                on the next save. All three still travel, exactly as `pack` has
                since it was hidden earlier today. They are preserved and
                unreachable — say so rather than let it be discovered later.

                RATIO FOR SURVIVES and moved UP beside the Single/Multiple
                switch. It was the only thing left in this block, and one
                two-option Select cannot tile a 12-column row on its own
                (LAYOUT.md §3) — it would have had to take `full` and draw a
                dropdown the width of the screen. It belongs with the switch
                anyway: both are pack-level settings that govern the grid. */}
            {/* DERIVED, never stored. Ratio Total is the pieces in one carton
                of the LAST line only where legacy shows one figure; the honest
                whole-document number is the sum, which is what Total Qty is.

                RATIO TOTAL IS AN ASSORT-ONLY FIGURE. On a solid pack the size
                cells are the pieces, so its sum IS Total Qty — printing both
                would be the same number twice under two labels, one of which
                names an arithmetic the row does not use. */}
            {/* THE BAND ITSELF IS GATED NOW, not just its contents. Once Order
                Qty / Total Qty / over-short left, Ratio Total was the only thing
                in here — and it is assort-only, so on a SOLID pack this rendered
                a `border-t-2` rule with nothing under it: a horizontal line
                announcing a section that is not there. Removing a row's last
                child means asking whether the row still has a job. */}
            {assortMode === "assort" && (
            <div className="flex flex-wrap items-baseline justify-end gap-x-6 border-t-2 border-border pt-2">
              <span className="flex items-baseline gap-1.5">
                <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  Ratio Total
                </span>
                <span className="text-sm font-semibold tabular-nums">
                  {fmtNumber(
                      assortQty.assort_lines.reduce(
                        (a, l) => a + ratioTotalOf(l),
                        0,
                      ),
                  )}
                  </span>
                </span>
              {/* ORDER QTY, TOTAL QTY AND THE OVER/SHORT LINE ALL LEFT THIS
                  FOOTER (client 2026-08-20: "see why showing this much time that
                  qty — one time show is right place, remove remaining places").

                  They said the same thing THREE TIMES on one sheet: the
                  allocation line under the matrix, these two stats, and a
                  sentence beside them. That is my own doing — the allocation
                  line was added for PROXIMITY and I left the far copy standing,
                  reasoning it was a summary for a scrolled sheet. It is not a
                  summary; it is the same sentence twice, and a number repeated
                  three times reads as three different numbers until you check.

                  The surviving copy is the one BESIDE THE MATRIX, because
                  proximity to the caret was the whole point of adding it. The
                  totals band's own TOTAL cell reddens with it, and Save still
                  refuses via `quantityProblems` — so the fact is stated once,
                  shown once, and enforced once.

                  RATIO TOTAL STAYS: it is a different fact (pieces per inner),
                  assort-only, and stated nowhere else. */}
            </div>
            )}
          </div>
        )}
      </Sheet>

      {/**
        * STYLE(S) ▸ PROCESS — WITHDRAWN 2026-08-17, RESTORED 2026-08-20.
        *
        * The withdrawal read: "remove Processed as Trim and the Garment Process
        * child entry section entirely, as these details are covered elsewhere."
        * Elsewhere was Order Setup ▸ Garment Process Plan, a step since 08-14.
        *
        * **THAT ELSEWHERE STOPPED BEING A STEP LATER THE SAME DAY** — 08-17b,
        * "only 7 are needed" (`lib/nav/module-groups.ts`). The screen survives at
        * `/orders/garment-processes` with a row under Order Execution, but
        * nothing inside ORDER ENTRY asked for panel-wise printing, embroidery or
        * wash any more. A withdrawal justified by a destination outlived its
        * destination, which is why this is a restoration rather than a reversal.
        *
        * THE TWO ARE NOT DUPLICATES. This defines what the order needs, at the
        * moment the style is entered; `/orders/garment-processes` selects an
        * accepted order and plans the out-processing of it. Entry and execution.
        *
        * RESTORING COST ALMOST NOTHING BECAUSE THE WITHDRAWAL WAS WRITTEN
        * PROPERLY — and that is the lesson worth keeping. It left the sheet in
        * `components/orders/`, and it kept `StyleRow.processes`, the `toRows`
        * mapping and the `style_processes` payload round-tripping rather than
        * dropping them: `writeChildren` deletes and re-inserts every child grid
        * wholesale, so a list dropped from the payload is not hidden, it is
        * DELETED from every order already carrying one on that order's next
        * save, silently. Because none of that was thrown away, every process
        * entered before 08-17 is still in the database and reappears here.
        */}
      {/**
        * PACK COMPOSITION (0467) — mounted HERE, at the editor root, and not
        * inside the grid cell whose button opens it.
        *
        * `ChildGrid` wraps every cell in a `RequiredScope` and that scope
        * follows the RENDER tree, so a sheet rendered from inside a cell would
        * have every optional field within it inherit "required", stamp
        * `data-required-empty` and hold the cursor — the New Yarn bug AGENTS.md
        * records. `Sheet` resets the scope at its portal boundary, and mounting
        * it out here is what puts it on the far side of that boundary.
        *
        * Same placement, and the same reason, as the Process, Structure Details
        * and Assortments sheets above and below it.
        */}
      {packStyle && (
        <PackCompositionSheet
          open
          onClose={() => setPackForKey(null)}
          styleLabel={packStyle.style_ref_no.trim() || "this style"}
          rows={packStyle.pack_components}
          onChange={(next) => updateStyle(packStyle.key, { pack_components: next })}
          /* SCOPED BY THE PARENT, per the cascading-picker rule: this screen is
             what knows which coordinates the style line declares. `coordinates`
             falls back to the whole GAR class only when the line declares none,
             which is the same "empty means unscoped, not empty" call
             `styleCoordinateOptions` already makes for the row's own grid. */
          coordinates={
            packStyle.coordinates.some((c) => c.coordinate_id)
              ? data.coordinates.filter((o) =>
                  packStyle.coordinates.some((c) => c.coordinate_id === o.id),
                )
              : data.coordinates
          }
          combos={comboOptionsForStyle(packStyle.style_ref_no)}
          packsOrdered={packStyle.packs_ordered}
          newKey={newKey}
          readOnly={!perms.canEdit}
        />
      )}
      {/* MOUNTED AT THE EDITOR ROOT, not inside the grid cell whose button opens
          it. `ChildGrid` wraps every cell in a `RequiredScope` and that scope
          follows the RENDER tree, so a sheet rendered from inside a cell would
          have every optional field within it inherit "required", stamp
          `data-required-empty` and hold the cursor — the New Yarn bug AGENTS.md
          records. `Sheet` resets the scope at its portal boundary, and mounting
          it out here is what puts it on the far side of that boundary. Same
          placement, and the same reason, as Pack Composition above.

          THE PANEL COPY OF THIS GRID NEEDS NONE OF THAT, and the contrast is
          worth keeping: a section pane is not a grid cell, so there is no scope
          to escape and it renders bare. */}
      {processStyle && (
        <StyleProcessSheet
          open
          onClose={() => setProcessForKey(null)}
          styleLabel={processStyle.style_ref_no.trim() || "this style"}
          /* The Process cell that opened this — the sheet grows out of that
             button. See `processOrigin`. */
          origin={processOrigin}
          rows={processStyle.processes}
          onChange={(next) => updateStyle(processStyle.key, { processes: next })}
          processes={data.processes}
          components={styleComponentOptions(processStyle)}
          newKey={newKey}
          /* No `readOnly`: this editor is only reached through an action already
             gated on `perms.canEdit`, and the sibling sub-sheets pass none for
             the same reason. */
        />
      )}
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
  // `styles` IS A SECTION OF ITS OWN AGAIN (client 2026-08-27). Order Info
  // still declares its icon inline, as it always has.
  styles: Shirt,
  colors: Palette,
  combos: Layers,
  prices: Banknote,
  packtypes: Package,
  quantities: Hash,
  /* T&A (0481). A calendar, because every row on that tab is a DATE the plan
     commits to — the one thing the section is for. */
  ta: CalendarClock,
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
  if (counts.yarn_dyed)
    notes.push(
      "yarn-dyed is coloured before knitting, so it skips fabric dyeing",
    );

  return (
    <p className="rounded-md border border-border bg-surface-muted/40 px-3 py-2 text-xs text-muted-foreground">
      <span className="font-medium text-foreground">
        This order: {named.join(", ")}.
      </span>
      {notes.length > 0 && (
        <>
          {" "}
          {notes.join("; ")} — no dyeing row needed for{" "}
          {counts.melange && counts.yarn_dyed ? "those" : "that"}.
        </>
      )}
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
