"use client";

/**
 * Orders ▸ Fabric BOM — step 3 of the client's order flow (0426).
 *
 * TWO SURFACES, one route. `mode === "list"` is the merchandiser's work queue —
 * one row per confirmed garment ORDER, not one per document, so an order with no
 * BOM is visible as "Pending" rather than absent. `mode === "edit"` is the
 * editor, a full-screen takeover for the reason the Material BOM records: a page
 * mount left the module sidebar beside the section rail, putting two navigation
 * lists on screen and leaving ~1090px for a wide grid.
 *
 * ## THE LINE GRID IS ONE ROW PER FABRIC (client, 2026-08-17)
 *
 * It shipped as `forceCards`, on the reading that 14 columns cannot fit and that
 * the responsive table would answer with a horizontal scrollbar — the operator
 * fills the first cell, then drags a bar to reach the last one with the first
 * scrolled out of sight (the operator's five, rule 4).
 *
 * BOTH HALVES OF THAT WERE TRUE AND THE CONCLUSION WAS STILL WRONG. Cards cost
 * FOUR bands of screen per line, so three fabrics filled the viewport and the
 * operator could not see one line against the next — while the pane itself sat
 * inside two inches of empty margin on either side, because `max-w-[1180px]`
 * caps every rail editor.
 *
 * The scrollbar was never caused by the number of columns; it is caused by their
 * declared widths summing past the pane. So the fix is the two things that
 * changes: the section sets `wide` (lifting the cap to 1720px) and every column
 * is declared narrow enough that the sum fits inside it. Rule 4 is honoured
 * rather than worked around — there is still no sideways scroll, and below the
 * breakpoint `ChildGrid` falls back to stacked cards by itself.
 *
 * WHAT MUST NOT BE ADDED BACK IS A WIDE COLUMN. `Fabric` is the single flexible
 * one on purpose; give a second column its slack and the sum grows past 1720 and
 * the scrollbar returns, on a screen nobody re-measures.
 */

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import {
  Layers,
  ListChecks,
  Shapes,
  Palette,
  Waypoints,
  Ruler,
  Spool,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
/* A Combobox, so the Manual sheet's Table width cell PICKS rather than accepts:
   typed text in one is a SEARCH and is never committed (`commit` in
   combobox.tsx). That is what makes the declared dia list mean something. */
import { Combobox } from "@/components/ui/combobox";
import { Textarea } from "@/components/ui/textarea";
import { Field, FieldGrid, FieldRow, RequiredScope } from "@/components/ui/field";
import type { FieldSize } from "@/lib/ui/sizes";
import {
  ChildGrid,
  gridKeyNav,
  type ChildGridColumn,
} from "@/components/masters/child-grid";
import { StyleIdentityBand } from "@/components/orders/style-identity-band";
import {
  MasterFullScreen,
  SectionBody,
  type FullScreenSection,
  type MasterFullScreenHandle,
} from "@/components/masters/master-full-screen";
import { PageHeader } from "@/components/ui/page-header";
import { RecordPicker } from "@/components/masters/record-picker";
import { Sheet } from "@/components/ui/sheet";
import { SubSheetFooter } from "@/components/orders/sub-sheet-footer";
import { Truncated } from "@/components/ui/truncated";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { today as calendarToday } from "@/lib/calendar";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { sectionValidity } from "@/lib/screens/validity";
import { fmtDate, fmtNumber } from "@/lib/format";
/* THE QUEUE, WHOLE — the filter bar, the counted Status facet, the summary
   sentence and the six-across cards, shared with Material BOM rather than
   drawn a second time here. See the header comment on that file. */
import { BomQueue } from "@/components/orders/bom-queue";
import type { CardStat } from "@/components/masters/mobile-card-list";
/* THE BASIS VOCABULARY IS NO LONGER IMPORTED (0494). `FABRIC_BASES`,
   `FABRIC_BASIS_LABELS`, `fabricBasisOf` and `FabricBasis` all served the line's
   Split cell and the line explosion behind it; `requirementRows` now hardcodes
   `colour_size`, because grams are stated per size and fabric is dyed per
   colourway. They are still exported and still used by the ENGINE — only this
   screen stopped needing them. */
import {
  fabricRequirementRows,
  fabricSlices,
  isRefusal,
} from "@/lib/orders/fabric-bom/requirement";
import type { OrderProductionInput } from "@/lib/orders/material-bom/requirement";
import {
  KNIT_TYPE_OPTIONS,
  type FabricBom,
  type OrderFabricSeedRow,
  type OrderPalette,
} from "@/lib/orders/fabric-bom/types";
/* THE ORDER'S OWN TWO DESCRIPTIONS, borrowed rather than restated (screenshot
   2581). `gsmRange` already prints legacy's exact "175 - 185" form, and
   `ITEM_SUB_TYPE_OPTIONS` is the Solid / Melange / Yarn Dyed vocabulary the
   order stores — re-deriving either here is how the two screens come to
   disagree about the same structure. */
import { gsmRange, ITEM_SUB_TYPE_OPTIONS } from "@/lib/orders/amendments/combo-rules";
/* THE MANUAL TAB'S ARITHMETIC, all of it (0494). Not one line of it is written
   here: `check-fabric-bom.mts` vectors these, and the server action reads the
   same `consumptionMap` and `gramsFor` when it stores the requirement — so the
   weight the planner works from and the figure a purchase order is checked
   against cannot be derived twice. */
import {
  CALC_MODE_OPTIONS,
  calcModeOf,
  calculatedGrams,
  consumptionMap,
  effectiveLength,
  consQtyOf,
  gramsFor,
  manualProblem,
  takenComponentIds,
  type ManualSizeInput,
} from "@/lib/orders/fabric-bom/manual";
/* The footer for an overlay with NO SAVE OF ITS OWN — the same one Combos ▸
   Structure Details and Quantities ▸ Assortments use, and for the same reason:
   the rows it edits are written by THIS screen's Save. It exists because three
   overlays that correctly had no footer were all reported as "missing save
   button" (client 2026-08-14). */
/* Fabric Process (0492). The grid decides COLUMNS and nothing about where it
   sits — this screen supplies the box, one card per fabric. See its header for
   why that shape rather than the Style ▸ Process [Click] button. */
import { FabricProcessGrid } from "@/components/orders/fabric-process-grid";
import {
  blankFabricProcess,
  routeStepCount,
  type FabricProcessRow,
} from "@/lib/orders/fabric-bom/processes";
/* Yarn Process (0493). NO grid component beside `FabricProcessGrid`: this tab
   flattened to four columns on the client's spec, so its cells live here with
   the dia and palette columns rather than in a file of their own. */
import { YarnProcessGrid } from "@/components/orders/yarn-process-grid";
/* LEGACY'S `[+]` ROW, for BOTH route tabs (client 2026-09-03, screenshots 2652 +
   2653). One component rather than two accordions, and it is not a `ChildGrid`
   for a structural reason its own header states: a `<tr>` cannot carry a panel
   beneath its cells, and a panel outside `data-grid-row` is invisible to Tab. */
import {
  ProcessFoldList,
  type FoldListColumn,
} from "@/components/orders/process-fold-list";
import {
  comboKey,
  deriveYarnRows,
  yarnPurchase,
  yarnRowAnswered,
  type FabricComposition,
  type FabricGross,
  type YarnAnswer,
  type YarnRow,
  type YarnStageRow,
} from "@/lib/orders/fabric-bom/yarn-process";
import type {
  BomTaskRow,
  FabricBomFormData,
} from "@/lib/orders/fabric-bom/service";
import {
  createFabricBom,
  deleteFabricBom,
  loadBomYarnComposition,
  loadOrderFabricSeed,
  loadOrderPalette,
  loadOrderProduction,
  loadOrderStyleComponents,
  updateFabricBom,
} from "@/lib/orders/fabric-bom/actions";
/* `ClothText` — the read-only cell the Components tree already draws, borrowed
   for the Fabric Process row rather than redefined (2026-09-03). */
import { ClothText, ComponentMapBody } from "@/components/orders/component-map-sheet";
import { YarnDyedSheet, type YdCombinationRow } from "@/components/orders/yarn-dyed-panels";
import type { YdRepeatRow } from "@/lib/orders/fabric-bom/yarn-dyed";
import {
  isYarnDyed,
  missingFabricLineFields,
  sameFabricType,
} from "@/lib/orders/fabric-bom/fabric-line-rules";
import type { FabricOption } from "@/lib/orders/fabric-bom/fabric-options";
import { FabricQuickCreateSheet } from "@/components/masters/fabric-quick-create-sheet";
import {
  fabricFormLabel,
  fabricGroupKey,
  rollUp,
  type StyleComponentDecl,
} from "@/lib/orders/fabric-bom/component-map";

/**
 * REACT KEYS FOR NEW ROWS — a module counter, NOT a `useRef` (2026-09-02).
 *
 * ## WHY IT MOVED OUT OF THE COMPONENT
 *
 * It was `const keySeq = useRef(0)` with `newKey = () => \`k${keySeq.current++}\``,
 * and that produced three ERROR-level React Compiler lints the moment the panel
 * and yarn-dyed handlers became FACTORIES — `panelHandlers(anchor)` and
 * `ydFor(anchor)` are CALLED DURING RENDER (once for the [Detail] popup, once
 * per style in the Components section), and the closures they hand back call
 * `newKey()`. The compiler cannot prove a closure returned by a render-phase
 * call is never invoked during render, so it reports "Cannot access refs during
 * render" — and then skips compiling the whole component, which surfaces as a
 * third error against an untouched `descriptorFor` ("existing memoization could
 * not be preserved").
 *
 * Verified as a regression rather than a pre-existing warning: linting
 * `git show HEAD:` of this file reports 0 of the three.
 *
 * ## A COUNTER IS ENOUGH, AND A REF WAS ALWAYS MORE THAN WAS NEEDED
 *
 * These keys exist so `ChildGrid` can tell one unsaved row from another. React
 * compares keys only among SIBLINGS in one list, so they need to be unique, not
 * to start at zero or to be per-mount — and a monotonic module counter is
 * strictly MORE unique than a per-mount one. Nothing reads the number.
 *
 * Never a database id: a row that has not been saved has none, which is the
 * whole reason this exists.
 */
let keySeq = 0;
const nextKey = () => `k${keySeq++}`;

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean };

/** One editable line. `key` is React's, never the database id — `ChildGrid`
 *  requires it and a new row has no id to offer. */
type LineRow = {
  key: string;
  id: string | null;
  style_ref_no: string;
  combo: string;
  structure_id: string | null;
  /* THE PANEL AND ITS COORDINATE, added by 0495 for the Components mapping.
     A PAIR: the Style declares FRONT BODY *of* PIECES, so the component alone
     does not identify a panel. `coordinate_id` is filled FROM the chosen panel
     (`availablePanels` offers every declared coordinate's panels), never picked
     separately — the declaration already pairs them. */
  coordinate_id: string | null;
  component_id: string | null;
  /**
   * WHICH PANEL ROW OF THE [Detail] SHEET THIS LINE BELONGS TO — client-side
   * only, never stored and never sent (0495).
   *
   * A panel is N lines, one per colourway, normally gathered by their shared
   * `component_id`. That works for every line that HAS one and fails for the
   * moment between "+ Add part" and the operator choosing a panel: those N
   * lines all carry `component_id: null`, so grouping by it would draw them as N
   * separate blank rows — one click of Add, four rows. Grouping every null
   * together is the opposite failure: two Adds merge into one row and the second
   * looks like it did nothing.
   *
   * So a blank panel gets one uid shared by its lines, and a mapped one is
   * gathered by its component as before. DERIVED ON LOAD rather than stored: the
   * database already answers this for a saved line, and a column would be a
   * second, staler copy of the component id.
   */
  panel_uid: string;
  item_id: string | null;
  fabric_type: string;
  /* Legacy Components ▸ "Required Color". `combo` is the ASSORT colour; this is
     the colour the panel is required in within it. Edited on the [Detail]
     sheet as well as in the line's own Colour cell — one field, two doors. */
  color_name: string;
  /** 'open' | 'tubular' — legacy's "Type" (0495). Mandatory once a fabric is named. */
  fabric_form: string;
  required_print: string;
  specification: string;
  /* THE UNIT SURVIVED ITS THREE NEIGHBOURS (client, 2026-09-01). 0494 moved the
     requirement onto the manual ENTRIES, so `consumption`, `wastage_pct` and
     `requirement_basis` stopped being read — `requirementRows` iterates entries
     and hardcodes the 'colour_size' basis. This one is still live: `entryFabric`
     resolves `uom_id` off the lines sharing a structure and stamps it on every
     requirement row, refusals included. All four columns remain on
     `order_fabric_bom_lines`; only the cells are gone. */
  /** Yarn-dyed only (0513 · 0514) — the UOM the stripe repeat ratio is in, from
   *  the UOM MASTER. `consumption_uom_id` below is the unit the consumption
   *  FIGURE is in and is auto-filled off the fabric master: two UOM references
   *  on one row, answering two different questions. */
  mixing_uom_id: string | null;
  no_of_colors: number | null;
  consumption_uom_id: string | null;
  notes: string;
};

/**
 * One size row of a Manual ENTRY (0494).
 *
 * EVERY MEASUREMENT IS A STRING HERE AND A NUMBER IN THE DATABASE, exactly as
 * `DiaRow` records for `dia` and for the same reason: a controlled `<Input>`
 * cannot hold "1." or "" as a number, so the form keeps text and `numOrNull`
 * converts once, in `submit`.
 *
 * `size_id` IS NOT TYPED AND IS NOT PICKED. These rows are DERIVED — one per
 * size the ORDER states — so the grid has no "+ Add" and no ✕, and the planner
 * fills measurements into a list they cannot lengthen. Same shape Color/Print
 * Details' read-only panels take, one degree along: there the whole panel is the
 * order's, here the order supplies the ROWS and the planner supplies the CELLS.
 */
type ManualSizeRow = {
  key: string;
  size_id: string | null;
  /** The knitting / finishing diameter — prepopulated from the dias declared on
   *  Color/Print Details, and editable (client spec, point 5). */
  dia: string;
  /** The commercial width the cloth is purchased at. A SECOND width, not a
   *  restatement of the dia. */
  purchase_width: string;
  /** GRAMS per garment. Typed in direct mode, derived in calculated. */
  grams: string;
  /**
   * The PANEL width on the cutting table — the calculated mode's own input, and
   * what the weight multiplies. NOT `dia`, which is the roll's diameter and a
   * constraint; 0495 renamed this from `width` because one word for both is how
   * a later reader multiplies by the wrong one and gets a plausible number.
   */
  table_width: string;
  length: string;
  /** The cutting allowance ADDED TO THE LENGTH (0524) — `effectiveLength`
   *  records the same-day 0523→0524 reversal on this field. */
  length_tolerance: string;
  /** "Cons Qty" — units of cloth per garment. BLANK MEANS 1 (`consQtyOf`). */
  cons_qty: string;
  /**
   * THE "Widths" [Click] POPUP'S OWN FIELD (0526) — legacy's "Width Details"
   * sub-form shows eight columns (screenshot 2681: Width | Width Tolerance |
   * Width | Calculated Width | Final Width | Width For Calc | Finished Width
   * | Purchase Width), but the operator's own correction is that only TWO are
   * real: this and `purchase_width` above. 0525 shipped `roll_width` /
   * `roll_width_tolerance` for the first pair instead — wrong, reverted the
   * same day. The other six columns are not stored anywhere.
   */
  finished_width: string;
};

/**
 * One Manual ENTRY (0494) — a fabric structure, a SET of components, and a gram
 * weight per size. **The tab's counting unit.**
 *
 * `component_ids` IS A SET, and that is the whole reason this is not a fabric
 * line. The client's Scenario A groups Front Body, Back Body and Sleeve at one
 * combined 180 g; a per-component row could not hold that without inventing a
 * split between them, and the invented number would drive a purchase.
 *
 * `id` is the DATABASE id and `key` is React's — a new entry has none of the
 * first and always has the second, exactly as `LineRow` records.
 */
type ManualEntryRow = {
  key: string;
  id: string | null;
  /** Which style this weight is for; "" = every style (0495). BY VALUE, like
   *  every style reference in orders. */
  style_ref_no: string;
  /** 'open_width' | 'tubular' | "" — the physical state of the cloth. */
  width_form: string;
  /**
   * THE CLOTH THIS WEIGHT IS FOR — `items.id`, and the entry's key since 0522
   * (client 2026-09-03, legacy screenshots 2666 · 2667: the Manual row leads
   * with a Fabric column and has no Structure column).
   */
  item_id: string | null;
  /** DERIVED FROM `item_id`, never typed — the fabric's `items.category_id`.
   *  Held on the row because the GSM lookup and the size explosion both key by
   *  it; the server re-derives it on save, so a stale value cannot survive. */
  structure_id: string | null;
  /** 'direct' | 'calculated'. */
  calc_mode: string;
  /** Legacy's "Component Proc. Loss %". */
  wastage_pct: string;
  /** Legacy's "EndBit Loss %" — a second allowance on the same row (0522). */
  endbit_loss_pct: string;
  /** Legacy's "Assort Color wise" checkbox (0522). */
  assort_color_wise: boolean;
  /** Legacy's "Size Wise" toggle (0523). TRUE — the default — gives every size
   *  its own row; FALSE asks once and writes the answer to every size. */
  size_wise: boolean;
  component_ids: string[];
  sizes: ManualSizeRow[];
};

/**
 * A size row as the sheet's grid renders it — the stored row PLUS what the order
 * calls that size and whether the order still states it.
 *
 * SPREAD, NOT NESTED. `ChildGrid<T>` constrains `T extends { key: string }`, so a
 * `{ row, label }` wrapper would have to carry a second key meaning the same
 * thing as the one inside it — two identities for one row, which is how a grid
 * comes to re-mount every row on a render nobody expected. The derived fields
 * ride alongside, and every write goes through `setSizeCell`, which addresses
 * the state by key.
 */
type ManualDisplayRow = ManualSizeRow & { label: string; declared: boolean };

/**
 * GONE FROM THE LINE, AND THE COLUMNS ARE WHY (client screenshot 2581,
 * 2026-09-01): legacy's FabricAllocation tab carries no Dia, no required-by date
 * and no rate, and the instruction was "only from legacy screen field, no more
 * extra field".
 *
 * `dia`, `required_by` and `rate` are STILL COLUMNS ON `order_fabric_bom_lines`.
 * Dropping them would be destructive for a UI-only change, and 0490 argues for
 * `dia` at length. They were catalog-verified NULL on every one of the 0 stored
 * lines before the cells went, which is the convention 0408 / 0430 / 0434 use —
 * with a stored value they would have had to stay in this type, loaded and
 * re-sent, or the next Save would blank them.
 *
 * REMOVING THE LINE'S Dia REVERSES `579b56c`, from earlier the same day. The
 * declared list it picked from is NOT removed: Color/Print Details ▸ Dia / Size
 * Width Details is one of legacy's own four panels (screenshot 2577).
 */

/**
 * One Color/Print Details ▸ Dia / Size Width Details row (0490).
 *
 * `dia` IS A STRING HERE AND A NUMBER IN THE DATABASE, like every numeric cell
 * on this screen. A controlled `<Input>` cannot hold "1." or "" as a number, so
 * the form keeps text and `numOrNull` converts once, in `submit` — the same
 * shape `consumption`, `wastage_pct`, `rate` and the line's own `dia` all use.
 */
type DiaRow = {
  key: string;
  knit_type: string;
  dia: string;
};

/**
 * One row of a READ-ONLY palette panel — a colour, a yarn colour or a print.
 *
 * ONE VALUE, NOT `{ type, value }` (client 2026-09-01: "the fields or screens
 * for Yarn Dyeing and Dyeing Print are not required on this tab and should be
 * left out", alongside "all the color, yarn color and roll-form print details
 * … must automatically auto-fill"). The two panels were Yarn Dyeing and Fabric
 * Dyeing, each carrying the DYEING TYPE — Y/D, Melange, Dyed — beside its
 * colour. That type is how a colour is ACHIEVED, and a fabric BOM answers
 * "which fabric, in which colour, how much": how it gets that colour is step
 * 4's question, planned on Fabric Plan. So the type column goes and the panels
 * become plain lists of what the order declared.
 *
 * The value survives because it is the half the BOM consumes. Nothing is lost
 * from the ORDER, which still declares the type on its own Color/Print tab.
 */
type PaletteRow = { key: string; value: string };

/**
 * DEDUPED, WHICH THE TYPE COLUMN USED TO MAKE UNNECESSARY. WHITE dyed and WHITE
 * melange are two legitimate rows on the order's tab and one colour here — with
 * the type gone, listing both would print WHITE twice with nothing to tell them
 * apart. Folded case-insensitively because these values are stored in capitals
 * (AGENTS.md, "CAPITALS") and a row that predates that rule must not read as a
 * second colour.
 *
 * A ROW WITH NO COLOUR CONTRIBUTES NOTHING. The service already drops rows that
 * say nothing at all, but one naming only a dye TYPE said something there and
 * says nothing here — it would arrive as a blank line under a heading.
 *
 * DEDUPING IS DONE HERE, NOT IN THE SERVICE, deliberately: the service reports
 * what the order declared, faithfully, and the panel decides how to present it.
 * `getOrderPalette` still carries `dye_type` for the same reason — a later
 * reader may want it, and narrowing a service to today's screen is how the next
 * consumer ends up writing a second query.
 */
/**
 * The same list as `paletteRows`, for the EDITABLE panels (2026-09-02).
 *
 * TWO DIFFERENCES FROM ITS READ-ONLY TWIN, both deliberate:
 *
 * - **A blank row instead of the dash row** (client 2026-09-02: Yarn Colour and
 *   Roll form prints "came without one row also so add one row as default").
 *   `DASH_ROW` exists because an empty READ-ONLY `ChildGrid` renders nothing at
 *   all and read as unbuilt (screenshot 2580); an editable grid needs the
 *   opposite thing — a row to type in. This is the same call `setLines` and
 *   `setDias` already make on this screen, and their stated reason is the
 *   keyboard rather than the look: "an empty grid has no field for Tab to land
 *   on, so its only affordance would be a button Tab never visits" (AGENTS.md,
 *   `enterNestedGrid`). A blank row costs nothing at save — `paletteDiff` drops
 *   it — so the seed cannot store an empty colour.
 * - **A key that does not encode the value.** `paletteRows` keys on the colour
 *   itself (`c${NAME}`), which is stable and correct for a derived list — and
 *   fatal for a typed one: the key would change on every keystroke, React would
 *   discard the input, and the field would lose focus after one character. The
 *   key is minted once, from the position, and never read again.
 *
 * Still deduped, for the reason its twin gives — WHITE dyed and WHITE melange
 * are two stored rows and one colour on this tab, and `paletteDiff` treats the
 * panel as a set of names for exactly that reason.
 */
const editableRows = (rows: OrderPalette["yarn"] | undefined): PaletteRow[] => {
  const seen = new Set<string>();
  const out: PaletteRow[] = [];
  for (const r of rows ?? []) {
    const v = (r.color_name ?? "").trim();
    if (!v) continue;
    const k = v.toUpperCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ key: `p${out.length}`, value: v });
  }
  return out.length ? out : [{ key: "p0", value: "" }];
};

/**
 * ONE EMPTY ROW, WHICH IS WHAT A COLOUR PANEL LOOKS LIKE BEFORE ANYONE TYPES
 * (client 2026-09-03: the three tables must start with a row, not with none).
 *
 * `editableRows` below already ends `out.length ? out : [{ key: "p0", ... }]`,
 * so a panel seeded FROM AN ORDER has always had its blank row. The gap was
 * earlier than that: `paletteDraft` is null until an order is picked and
 * `loadOrderPalette` answers, so on a fresh BOM the three tables rendered
 * `paletteEdit?.fabric ?? []` ' + EM + ' zero rows, a header and a button.
 *
 * A FUNCTION, NOT A SHARED CONSTANT. Each panel needs its own array and its own
 * row object; one frozen literal handed to all three would give them one
 * identity, and the first edit would appear to change all three at once.
 */
const blankPalette = (): PaletteRow[] => [{ key: "p0", value: "" }];

/** The prints panel's half of `editableRows` — a print names itself. */
const editablePrintRows = (rows: OrderPalette["prints"] | undefined): PaletteRow[] => {
  const seen = new Set<string>();
  const out: PaletteRow[] = [];
  for (const r of rows ?? []) {
    const v = (r.print_name ?? "").trim();
    if (!v) continue;
    const k = v.toUpperCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ key: `p${out.length}`, value: v });
  }
  return out.length ? out : [{ key: "p0", value: "" }];
};

/**
 * REMARK LEFT THE SCREEN ON 2026-09-01 (client: "no more need remarks screen").
 *
 * THE COLUMN AND ITS STORED ROWS ARE NOT TOUCHED, which is this repo's standing
 * treatment for a withdrawn field (see the "Initiated" and "Type" withdrawals on
 * the Garment Order screen). What changes is that the form no longer HOLDS a
 * remark, and `submit` sends `null` rather than a value it never collected.
 *
 * THE ZOD KEY AND `headerOnly`'s LINE ARE STILL THERE, deliberately and
 * temporarily: both live in `lib/orders/fabric-bom/{types,actions}.ts`, which
 * another session is mid-edit in, and reaching into an unfinished file to delete
 * two lines risks their work for no gain here. Sending `null` reaches the same
 * end — `order_fabric_boms` holds no remarks today (0 rows), so nothing stored
 * is being nulled. Finish the removal in those two files once they land.
 */
type Form = { garment_order_id: string | null; bom_date: string };

/**
 * THE FACTORY'S CALENDAR DATE — `lib/calendar`, not a hand-rolled one.
 *
 * This was `new Date().toISOString().slice(0, 10)`, which is the UTC day. On a
 * UTC+5:30 business that is WRONG BEFORE 05:30 EVERY MORNING: at 02:00 IST the
 * UTC date is still yesterday, so a fabric BOM opened in the early shift
 * defaulted to yesterday's date and the no-future-date ceiling below would have
 * refused today's. That is the trap [[raagam-utc-vs-local-today]] records and
 * `lib/calendar.ts` exists to end — it formats in `Asia/Kolkata`, so it answers
 * the same day the operator's own calendar does.
 *
 * DELIBERATELY THE SHARED ONE, not a copy of Order Entry's machine-local
 * helper. That screen builds the date from the browser's own local parts; this
 * takes the factory's. They agree for every operator sitting at the factory,
 * and where they could differ — an operator abroad — the factory's date is the
 * one a business document should carry.
 */
const today = () => calendarToday();
const BLANK = (): Form => ({ garment_order_id: null, bom_date: today() });

const blankDia = (key: string): DiaRow => ({ key, knit_type: "", dia: "" });

/**
 * ONE COLOUR/PRINT PANEL, AS A HAND-ROLLED TABLE (client 2026-09-03, asked
 * three times: the four panels side by side in a single row).
 *
 * ## WHY THIS IS NOT A `ChildGrid`, WHICH IS THE FIRST THING TO CHECK
 *
 * `ChildGrid` draws a TABLE only above a container-query threshold and stacked
 * CARDS below it: `@lg` (512px) by default, `@md` (448px) with `narrow`, then
 * 1024 / 1152 / 1280 through `tableFrom`. There is nothing lower, and no
 * force-table escape hatch.
 *
 * Four panels across an ~1180px pane give each one ~286px, and at the widths
 * this brief asks for (210 / 210 / 210 / 280) they are narrower still. Every
 * grid falls under 448, so all four render as cards: no frame, no header, no
 * ordinal or remove column, and the Dia panel's two columns stacked instead of
 * side by side. That is not a hypothesis — it shipped on 2026-09-03 and was
 * reported back the same day. Four real `ChildGrid` tables would need
 * 4 × 448 + gaps = 1828px, past even the `wide` cap of 1720.
 *
 * So the layout and the primitive genuinely cannot both be had, and the layout
 * is what was asked for three times.
 *
 * ## WHAT IT COSTS, STATED PLAINLY
 *
 * This is a 23rd hand-rolled grid in a codebase whose AGENTS.md names the other
 * ~22 as the reason a keyboard fix had to be made twice. That cost is paid down
 * rather than ignored: the contract is MARKER-driven, not component-driven, so
 * every marker is emitted here and the keyboard behaves as it does in any
 * `ChildGrid`:
 *
 *   `data-grid-body` + `gridKeyNav`  —  arrows, Enter, the "+ Add" hand-off
 *   `data-grid-row`                  —  the row axis those keys walk
 *   `data-row-remove` + aria-label   —  Ctrl+Del drives this by `.click()`
 *   `data-row-add`                   —  what Enter off the last field lands on
 *
 * What is genuinely lost is `ChildGrid`'s stacked-card fallback below the
 * breakpoint. These panels hold ONE input each, so a 210px column is legible on
 * a phone where a fourteen-column grid would not be — which is the reason the
 * fallback exists at all.
 *
 * ## THE CELLS ARE STILL THE COLUMNS'
 *
 * `columns[].cell` is untouched and rendered as-is, so the pickers, the Input
 * wiring and the per-row filters keep ONE definition shared with every other
 * reader of those column arrays. Only the chrome is written here.
 */
function PaletteTable<T extends { key: string }>({
  label,
  columns,
  rows,
  onAdd,
  onRemove,
  addLabel,
  width,
}: {
  label: string;
  columns: ChildGridColumn<T>[];
  rows: readonly T[];
  onAdd: () => void;
  onRemove: (row: T) => void;
  addLabel: string;
  /** The panel's cap — a STATIC literal per call site, never interpolated:
   *  Tailwind scans source text, so a computed class compiles to no CSS. */
  width: string;
}) {
  return (
    <div className={cn("min-w-0 flex-1", width)}>
      <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="overflow-hidden rounded-lg border border-border">
        <table className="w-full table-fixed border-collapse text-sm">
          <colgroup>
            {/* 36px, as asked. The data columns share what is left EQUALLY
                rather than taking their declared `width`: those were sized for
                a half-pane cell and total more than a 210px panel holds, so
                honouring them here would overflow the frame. */}
            <col className="w-9" />
            {columns.map((c) => (
              <col key={c.header} />
            ))}
            <col className="w-8" />
          </colgroup>
          <thead>
            <tr className="border-b border-border">
              <th className="px-1.5 py-1.5 text-center text-[12.5px] font-semibold text-foreground">
                #
              </th>
              {columns.map((c) => (
                <th
                  key={c.header}
                  className="truncate border-l border-border px-1.5 py-1.5 text-left text-[12.5px] font-semibold text-foreground"
                >
                  {c.header}
                </th>
              ))}
              <th className="border-l border-border" />
            </tr>
          </thead>
          {/* THE TWO MARKERS THAT MAKE THIS A GRID TO THE KEYBOARD. `gridKeyNav`
              reads `data-grid-body` for the row axis and drives a row's own
              `data-row-remove` on Ctrl+Del; without them this would be a table
              the arrows walk as plain fields. */}
          <tbody data-grid-body onKeyDown={(e) => gridKeyNav(e)}>
            {rows.map((row, i) => (
              <tr key={row.key} data-grid-row className="border-b border-border last:border-0">
                <td className="px-1.5 py-1 text-center text-xs tabular-nums text-muted-foreground">
                  {i + 1}
                </td>
                {columns.map((c, ci) => (
                  <td key={c.header} className="border-l border-border/50 px-1.5 py-1">
                    {c.cell(row, ci)}
                  </td>
                ))}
                <td className="border-l border-border/50 px-0.5 py-1 text-center">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    data-row-remove
                    aria-label={`Remove ${label.toLowerCase()} row ${i + 1}`}
                    className="px-1 text-danger hover:text-danger"
                    onClick={() => onRemove(row)}
                  >
                    {"✕"}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* `data-row-add` IS WHAT ENTER STEERS BY (AGENTS.md, "Add a grid row"):
          Enter or Tab off the last field lands here and a second Enter adds. */}
      <Button
        type="button"
        variant="outline"
        size="sm"
        data-row-add
        className="mt-2"
        onClick={onAdd}
      >
        {addLabel}
      </Button>
    </div>
  );
}


/**
 * What the ORDER says about a line's cloth — legacy FabricAllocation's two
 * description columns (screenshot 2581), plus the nominal GSM the Manual tab's
 * weight formula needs. See `descriptorFor`.
 *
 * `gsmNum` IS NOT `gsm`. The first is a number to multiply; the second is
 * legacy's printed RANGE, "175 - 185", which has none. They ride on one record
 * because they come off one seed row and share one abstain rule — a parallel
 * index would be free to drift to a looser key, and the pairs it would then
 * guess at are real (four of them, catalog-verified 2026-09-01).
 *
 * AT MODULE SCOPE so `descriptorFor`'s closure over `NO_DESCRIPTOR` is stable —
 * a literal rebuilt each render is a dependency `react-hooks/exhaustive-deps` is
 * right to object to.
 */
type Descriptor = { gsm: string; sub: string; gsmNum: number | null };
const NO_DESCRIPTOR: Descriptor = { gsm: "", sub: "", gsmNum: null };

/** A size the order states and this entry has no measurements for yet. */
const blankManualSize = (key: string, size_id: string | null, dia = ""): ManualSizeRow => ({
  key,
  size_id,
  /* PREPOPULATED WHERE THE BOM DECLARES EXACTLY ONE (client spec, point 5:
     "when Dia sizes are defined in the Color Print Details tab, they should
     automatically prepopulate the Dia field here but remain editable"). The
     caller resolves it; with two or more declared there is no single answer and
     guessing one would put a diameter the planner never chose in front of the
     knitting programme. */
  dia,
  purchase_width: "",
  grams: "",
  table_width: "",
  length: "",
  length_tolerance: "",
  cons_qty: "",
  finished_width: "",
});

const blankManualEntry = (key: string, style_ref_no = ""): ManualEntryRow => ({
  key,
  id: null,
  /* SEEDED FROM THE STYLE WHOSE SHEET OPENED IT (0495), never left blank there.
     An entry added from inside a style's overlay is for that style; making the
     planner re-state it would be asking them to repeat what the surface they
     are standing on already says — and a blank would silently mean "every
     style", which is the one answer they did not give. */
  style_ref_no,
  width_form: "",
  item_id: null,
  /* NOT SEEDED. It is derived from the fabric the planner is about to pick, and
     a blank row has picked none — `setEntryCell` writes both together. */
  structure_id: null,
  /* DIRECT, the client's stated primary method — "the planner directly inputs
     the weight of the components in grams". The one default here, and it is a
     default about HOW a figure is reached, never about the figure itself: an
     unfilled entry still refuses by name. */
  calc_mode: "direct",
  wastage_pct: "",
  endbit_loss_pct: "",
  assort_color_wise: false,
  /* TRUE, which is what the tab has always done. Off is the convenience, never
     the default: a planner who has per-size figures from CAD must not have to
     switch something on to enter them. */
  size_wise: true,
  component_ids: [],
  sizes: [],
});

/** AT MODULE SCOPE so `styleDecls` keeps one identity while no order is picked
 *  — a fresh `[]` per render would re-run every `useMemo` that reads it. Same
 *  reason `NO_DESCRIPTOR` above is hoisted. */
/**
 * A Yarn Dyed Details row AS THE FORM HOLDS IT (0512) — the panel's own fields
 * plus the three that say which cloth it is about.
 *
 * THE ADDRESS IS ON THE ROW, not implied by which overlay is open. A Save writes
 * every row of the document at once, so a row that could not say where it
 * belongs would have to be re-associated from UI state at the moment of saving —
 * exactly the shape that loses rows once the overlay is closed.
 */
type YdRepeat = YdRepeatRow & {
  style_ref_no: string;
  structure_id: string | null;
  item_id: string | null;
};

type YdCombination = YdCombinationRow & {
  style_ref_no: string;
  structure_id: string | null;
  item_id: string | null;
};

/** The group address, in the same shape `fabricGroupKey` reads — ONE statement
 *  of "which cloth is this about", shared with `detailLines`. */
const ydAddress = (r: {
  style_ref_no: string;
  structure_id: string | null;
  item_id: string | null;
}) => fabricGroupKey(r);

const EMPTY_DECLS: StyleComponentDecl[] = [];

const blankLine = (key: string): LineRow => ({
  key,
  id: null,
  style_ref_no: "",
  combo: "",
  structure_id: null,
  coordinate_id: null,
  component_id: null,
  /* ITS OWN KEY, so an untouched blank line is a panel of one. `addPanel`
     overwrites this with one uid shared across the colourways it creates. */
  panel_uid: key,
  item_id: null,
  fabric_type: "",
  color_name: "",
  fabric_form: "",
  required_print: "",
  specification: "",
  mixing_uom_id: null,
  no_of_colors: null,
  consumption_uom_id: null,
  // DEFAULTED TO COLOUR, and this is the one default in the file. Fabric is dyed
  // per colourway, so colour-wise is not a guess about what the operator meant —
  // it is the only basis that is right for the ordinary case, and the engine
  // still refuses a line that has been cleared back to blank.
  notes: "",
});

/**
 * THE ROW NO LONGER HAS ONE WIDTH, AND THE INSTRUCTION THAT SAID SO IS KEPT HERE.
 *
 * `const CELL = "5rem"` sized every cell identically from 2026-08-18, on the
 * client's own instruction, because fourteen columns had to fit a ~1260px pane
 * and a per-column width invited the next person to nudge one cell and push the
 * row out of the table layout entirely.
 *
 * SIX COLUMNS CAME OFF ON 2026-09-01 — Dia, Req. by, Rate and Style Ref No to
 * the legacy FabricAllocation field list, then Cons., Wast.% and Split once 0494
 * moved the requirement onto the manual entries. At eight columns the constraint
 * that produced the rule is gone, and the rule outlived it: the client's own
 * screenshot 2595 shows the cost, a row reading `'HITE` / `1X…` / `BA…` / `CO…`
 * with the pane half empty beside it. Every cell being equally unreadable was
 * never what "the same width" was for.
 *
 * Each column now states a width sized to its real content, and the total is a
 * budget with a hard ceiling — see the `Fabric` column, which carries the
 * arithmetic and the reason `table-fixed` rules out the flexible alternative.
 */

const numOrNull = (v: string): number | null => {
  const t = v.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

/**
 * The separator that joins a fabric's address keys.
 *
 * A CONTROL CHARACTER, so a combo or component name containing the separator
 * cannot forge another row's key — the same reasoning, and the same character,
 * as `SEP` in lib/orders/material-bom/requirement.ts.
 *
 * WRITTEN AS AN ESCAPE, NEVER AS A RAW BYTE. A literal NUL in a source file
 * makes git treat that file as BINARY: no diff, no three-way merge, and a
 * conflict it simply refuses to resolve. That is exactly what happened to both
 * of these screens on 2026-08-18 and it is invisible until the day two branches
 * touch the same file.
 */
const SEP = "\u0000";

/** The Yarn Process tab's answer for "no fabric named yet" — derived, never
 *  stored (see `comp`). */
const EMPTY_COMPOSITION = {
  forFabrics: "",
  compositions: [] as FabricComposition[],
  yarns: [] as { id: string; name: string; inactive: boolean }[],
};

export function FabricBomScreen({
  tasks,
  boms,
  data,
  perms,
}: {
  tasks: BomTaskRow[];
  boms: FabricBom[];
  data: FabricBomFormData;
  perms: Perms;
}) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, start] = useTransition();

  const [mode, setMode] = useState<"list" | "edit">("list");
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<Form>(BLANK);
  const [lines, setLines] = useState<LineRow[]>([]);
  const [dias, setDias] = useState<DiaRow[]>([]);
  /**
   * YARN DYED DETAILS (0512) — the [Detail] overlay's two TYPED panels.
   *
   * TOP-LEVEL ARRAYS, ADDRESSED BY THE FABRIC GROUP, exactly as the table is
   * (0512's header states why at length). Not a field on `LineRow`: the overlay
   * is opened for a GROUP of N colourway lines and the yarn composition is the
   * same in all of them, so hanging it off a line would ask the same question
   * once per colour. The address travels ON the row so a Save can write it
   * without knowing which group was open.
   */
  const [ydRepeats, setYdRepeats] = useState<YdRepeat[]>([]);
  const [ydCombinations, setYdCombinations] = useState<YdCombination[]>([]);
  /* THE MANUAL ENTRIES (0494) — a TOP-LEVEL child of the document, not a field
     on a line. An entry groups several components at one combined weight, so it
     belongs to the BOM and to no single fabric line. */
  const [entries, setEntries] = useState<ManualEntryRow[]>([]);
  /**
   * Every fabric's route, in ONE FLAT ARRAY keyed by `item_id` (0492).
   *
   * KEYED TO THE FABRIC, NOT TO A LINE. A rib used for a collar and the same
   * rib used for a cuff are two BOM lines and one route — they are knitted,
   * dyed and compacted identically — so grouping by line would ask the operator
   * to enter one route several times with nothing to say the copies were meant
   * to agree (client spec 2026-09-01: "separate sections for each unique fabric
   * structure").
   *
   * Not a `Record<itemId, rows[]>`, and the difference matters when the last
   * line naming a fabric is removed: a map would keep an entry under a key
   * nothing renders any more, invisible until the next save resolved it to
   * nothing. A flat list makes the orphan a row the filter simply does not
   * match — and `normalizeProcesses` drops exactly those.
   */
  const [procs, setProcs] = useState<FabricProcessRow[]>([]);
  /**
   * Yarn Process — THE ANSWERS ONLY, keyed by yarn id (0493).
   *
   * NOT THE ROWS. The rows are derived on every render from the fabrics' own
   * compositions (`yarnRows` below), because the client's rule is that "the
   * planner cannot manually add new yarns here" — so there is no list for this
   * screen to own. What the planner types is a process and a loss per yarn, and
   * that is what this holds.
   *
   * KEYED BY YARN ID AND NOT BY POSITION, which is what makes the derivation
   * safe: adding a fabric line re-derives the list in a different order and with
   * new members, and every answer stays on the yarn it was typed against. A
   * positional array would silently move a dyeing instruction from one yarn to
   * another — invisible, and expensive.
   *
   * A `Record` rather than a `Map`: it is React state, and mutating a Map in
   * place would not re-render.
   */
  const [yarnAnswers, setYarnAnswers] = useState<Record<string, YarnAnswer>>({});
  /**
   * FABRICS CREATED FROM THE FABRIC CELL'S "+ Add", UNTIL THE SERVER LIST CATCHES
   * UP (client 2026-09-02, "with the crud action").
   *
   * `createMaterial` returns an id and `router.refresh()` re-fetches the page's
   * props, but not in the same tick — and in between, the id just committed to
   * the line resolves against nothing. That is not a cosmetic flicker here: the
   * Fabric cell would render EMPTY on a row that names a fabric, the `Type`
   * column would print a dash, and [Detail] would go back to disabled, all
   * looking exactly like a create that silently failed. The optimistic row is
   * what makes the picked fabric visible the instant it exists.
   *
   * MERGED IN ONE PLACE, and every reader goes through `fabrics` below rather
   * than `data.fabrics` — a second, unmerged reader is how `fabricTypeOf` and
   * the picker would come to disagree about whether a cloth exists.
   */
  const [newFabrics, setNewFabrics] = useState<FabricOption[]>([]);
  /**
   * THE `Type` A PLANNER STATES BEFORE THEY PICK A CLOTH (client 2026-09-03,
   * "the type and uom and no of color field allow manual entry too").
   *
   * NOT STORED, AND THAT IS THE WHOLE DESIGN. `Type` is a property of the CLOTH
   * — `items.fabric_type_id`, set on all 14 — so a column here would let the
   * line and the master disagree about one fact with nothing to arbitrate, and
   * [Detail], the mandatory Mixing Uom, the Components tree and the Yarn
   * Process rows all read that fact. What the operator actually needs is the
   * cell to accept entry, and the useful thing for it to DO is NARROW the row's
   * Fabric picker; the instant a fabric is named the cloth answers and this is
   * ignored. So the cell is editable exactly while there is nothing to derive
   * from. It is the ONE conditional control left on this row — the two mixing
   * cells and [Detail] were all unconditioned on 2026-09-03 — and it survives
   * because it withdraws into an ANSWER rather than into a blank: the operator
   * loses the dropdown and gains the word the cloth put there.
   *
   * KEYED BY `allocationKeyOf`, like `setAlloc`, never by index: adding a line
   * re-derives `allocationRows` in a different order and a positional key would
   * move one row's narrowing onto another. The key contains `item_id`, so
   * naming a fabric orphans the entry by construction — which is correct, since
   * that is exactly when the cell stops reading it.
   *
   * NOTHING DOWNSTREAM MAY READ IT except the picker's scope and the two mixing
   * cells' visibility. The Save gate, both server actions, `factsForLine` and
   * the requirement engine go on reading the FABRIC, so an unsaved narrowing
   * can never reach a stored row or a computed quantity.
   */
  const [typeFilter, setTypeFilter] = useState<Record<string, string>>({});
  /** Which STRUCTURE the open "New Fabric" sheet is creating under — the id
   *  doubles as "the sheet is open", because a sheet with no structure has
   *  nothing to file the cloth under and is never opened. */
  const [fabricAddFor, setFabricAddFor] = useState<string | null>(null);
  /**
   * WHICH MANUAL ENTRY'S COMPONENTS ARE BEING CHOSEN — legacy's [Click] on the
   * Components cell (client 2026-09-03, screenshot 2667).
   *
   * BY ENTRY KEY, never by index: `mutEntries` rebuilds the array on every edit,
   * so an index would point at a different fabric the moment a row above it was
   * removed. The same reason every other write on this tab addresses by key.
   */
  const [componentsFor, setComponentsFor] = useState<string | null>(null);
  /** THE COMPONENTS BUTTON'S OWN RECT, so its sheet grows out of THAT button
   *  rather than the middle of the screen — the same mechanism
   *  `garment-order-screen.tsx`'s Style ▸ Process sheet uses (`processOrigin`),
   *  applied here for the same reason: "a surface's size is a function of
   *  what is ON it, not of how it is opened" (operator instruction,
   *  2026-09-03: apply this to every [Click]-opened sheet on this tab). */
  const [componentsOrigin, setComponentsOrigin] = useState<DOMRect | null>(null);
  /** WHICH MANUAL ENTRY'S "Widths" POPUP IS OPEN — legacy's [Click] on the
   *  Widths cell (screenshot 2681, "Width Details"). By entry key, same
   *  reason as `componentsFor` above. */
  const [widthsFor, setWidthsFor] = useState<string | null>(null);
  /** The Widths button's own rect — same mechanism as `componentsOrigin`. */
  const [widthsOrigin, setWidthsOrigin] = useState<DOMRect | null>(null);
  /** The picker hands us its `commit` so a save selects the new fabric and
   *  closes the list in one step. A ref because the sheet outlives the callback
   *  (the same shape `bank-picker.tsx` uses). */
  const fabricAddCommit = useRef<((id: string) => void) | null>(null);
  /**
   * THE FABRIC MASTER AS THIS SCREEN SEES IT — the server's list plus anything
   * created here that has not come back yet.
   *
   * SELF-CLEANING, with no effect to clear it: once `router.refresh()` lands,
   * the real row is in `data.fabrics` and the pending copy filters itself out by
   * id. An effect that emptied `newFabrics` instead would have to fire on data
   * it does not own, and would race the very refresh it is watching for.
   */
  const fabrics = useMemo(() => {
    if (!newFabrics.length) return data.fabrics;
    const have = new Set(data.fabrics.map((f) => f.id));
    const pending = newFabrics.filter((f) => !have.has(f.id));
    return pending.length ? [...data.fabrics, ...pending] : data.fabrics;
  }, [data.fabrics, newFabrics]);
  const [dirty, setDirty] = useState(false);
  /* NO `search` STATE HERE ANY MORE — the queue owns its own search and its own
     Status filter (`BomQueue`). A screen holding the box's value while the list
     that reads it lives elsewhere is how the two come to disagree. */

  /**
   * THE SCREEN REGISTERS ITS OWN UNSAVED GUARD.
   *
   * `MasterFullScreen` calls `useModalGuard(open)` on an overlay mount, and
   * `confirmDiscard()` deliberately does not read that one — an open overlay is
   * not the same thing as edited data. Keyed on `dirty`, never on
   * `mode === "edit"`: that would pin the silent PWA auto-update off for as long
   * as the operator sits on the screen.
   */
  useUnsavedGuard(dirty || isPending);

  const shellRef = useRef<MasterFullScreenHandle>(null);
  const newKey = nextKey;

  const set = (patch: Partial<Form>) => {
    setForm((f) => ({ ...f, ...patch }));
    setDirty(true);
  };
  const mut = (fn: (xs: LineRow[]) => LineRow[]) => {
    setLines(fn);
    setDirty(true);
  };
  /* THE MUTATORS, PAIRING `setDirty` for `mutDias`' stated reason: the unsaved
     guard is keyed on `dirty`, so a mutator that forgets it lets a silent PWA
     auto-update reload the tab over a half-typed repeat. */
  const mutYdRepeats = (fn: (xs: YdRepeat[]) => YdRepeat[]) => {
    setYdRepeats(fn);
    setDirty(true);
  };
  const mutYdCombinations = (fn: (xs: YdCombination[]) => YdCombination[]) => {
    setYdCombinations(fn);
    setDirty(true);
  };

  const setCell = (key: string, patch: Partial<LineRow>) =>
    mut((xs) => xs.map((x) => (x.key === key ? { ...x, ...patch } : x)));
  /* THE SAME `setDirty` PAIRING AS `mut` ABOVE, and it is not optional: the
     unsaved guard is keyed on `dirty`, so a mutator that forgets it lets a
     silent PWA auto-update reload the tab over a half-typed dia (AGENTS.md,
     "Auto-reload guard"). */
  const mutDias = (fn: (xs: DiaRow[]) => DiaRow[]) => {
    setDias(fn);
    setDirty(true);
  };
  const setDiaCell = (key: string, patch: Partial<DiaRow>) =>
    mutDias((xs) => xs.map((x) => (x.key === key ? { ...x, ...patch } : x)));

  /* ONE MUTATOR (0493), pairing `setDirty` for the reason stated above
     `mutDias`. One and not two because there is only one thing to change: a
     yarn's answer. The rows themselves are derived and nothing on this screen
     may add or remove one. */
  const setYarnStages = (yarnId: string, stages: YarnStageRow[]) => {
    setYarnAnswers((prev) => ({ ...prev, [yarnId]: { stages } }));
    setDirty(true);
  };

  /**
   * One cell of one size of one fabric line (0491).
   *
   * THROUGH `mut`, so `dirty` is set — the pairing the two mutators above both
   * carry a warning about, and it matters more here than anywhere else on this
   * screen: the Manual sheet is inside an OVERLAY, so the operator cannot see
   * the "● Unsaved" badge while they are typing into it.
   *
   * KEYED BY LINE AND THEN BY SIZE ROW. `lineKey` is React's row key, not a
   * database id — a brand-new line has no id, and the whole sheet has to work
   * before the document has ever been saved.
   */
  /* THE SAME `setDirty` PAIRING AS `mut`, and it is not optional: the unsaved
     guard is keyed on `dirty`, so a mutator that forgets it lets a silent PWA
     auto-update reload the tab over a half-typed gram weight (AGENTS.md,
     "Auto-reload guard"). It matters more here than anywhere else on this
     screen, because the size sheet is inside an OVERLAY — the planner cannot see
     the "● Unsaved" badge while they are typing into it. */
  const mutEntries = (fn: (xs: ManualEntryRow[]) => ManualEntryRow[]) => {
    setEntries(fn);
    setDirty(true);
  };
  const setEntryCell = (key: string, patch: Partial<ManualEntryRow>) =>
    mutEntries((xs) => xs.map((e) => (e.key === key ? { ...e, ...patch } : e)));
  /**
   * Write one cell of one size row — AND CREATE THAT ROW IF IT IS NOT THERE YET.
   *
   * The grid's rows are DERIVED (`manualSizeRows`): a size the order declares
   * and the entry has never been given a value for is drawn as a row that does
   * not exist in `entries`. So the first keystroke in it is what brings it into
   * being, carrying the key it was drawn with — see the note there for why the
   * key must not be re-minted here.
   *
   * IT TAKES THE ROW, NOT THE KEY, because creating one needs the `size_id` and
   * the `dia` the derived row was standing there showing, and only the row
   * carries them.
   */
  const setSizeCell = (
    entryKey: string,
    row: ManualDisplayRow,
    patch: Partial<ManualSizeRow>,
  ) =>
    mutEntries((xs) =>
      xs.map((e) => {
        if (e.key !== entryKey) return e;
        if (e.sizes.some((z) => z.key === row.key))
          return { ...e, sizes: e.sizes.map((z) => (z.key === row.key ? { ...z, ...patch } : z)) };
        return {
          ...e,
          sizes: [...e.sizes, { ...blankManualSize(row.key, row.size_id, row.dia), ...patch }],
        };
      }),
    );
  /* THE SAME `setDirty` PAIRING AGAIN, and it is not optional here either — a
     mutator that forgets it lets a silent PWA auto-update reload the tab over a
     half-typed route (AGENTS.md, "Auto-reload guard"). */
  const mutProcs = (fn: (xs: FabricProcessRow[]) => FabricProcessRow[]) => {
    setProcs(fn);
    setDirty(true);
  };
  /**
   * ONE FABRIC'S ROUTE REPLACED, THE REST LEFT ALONE.
   *
   * `FabricProcessGrid` is handed only its own fabric's rows and hands back only
   * its own fabric's rows, so the splice happens here: everything belonging to
   * another fabric is kept in place and `next` takes over for this one. Written
   * as a filter-plus-concat rather than an index splice because the grid may
   * have added, removed or reordered — there is no position to preserve.
   *
   * ORDER WITHIN A FABRIC IS THE ROUTE'S ORDER (knitting before dyeing) and is
   * carried by `next`; order BETWEEN fabrics never matters, since
   * `normalizeProcesses` renumbers per fabric.
   */
  const setFabricProcs = (itemId: string, next: FabricProcessRow[]) =>
    mutProcs((xs) => [...xs.filter((x) => x.item_id !== itemId), ...next]);

  // ---- the picked order ----------------------------------------------------

  /**
   * THE ANSWER IS STORED WITH THE QUESTION IT ANSWERS.
   *
   * One state cell holding `{ forOrder, order, error }`, not three cells the
   * effect has to keep in step. Two things fall out of that, and the second is
   * why it is written this way rather than the obvious way:
   *
   *  - **No stale flash.** `order` is only read when `forOrder` matches the
   *    order currently picked, so switching orders shows "Reading the order…"
   *    rather than the previous order's quantities until the reply lands. With
   *    three cells that gap is a real render, and the requirement preview would
   *    spend it multiplying this order's lines by that order's target. (The
   *    Calculated Quantities SECTION that used to show it went on 2026-09-01;
   *    `preview` survives it and still feeds Yarn Process through
   *    `fabricGross`, so the hazard is unchanged.)
   *  - **The effect sets state only in its CALLBACK.** Clearing three cells
   *    synchronously in the effect body is what `react-hooks/set-state-in-effect`
   *    is about, and the rule is right here — the clear was a second render that
   *    existed only to undo the first.
   */
  const [loaded, setLoaded] = useState<{
    forOrder: string;
    order: OrderProductionInput | null;
    error: string | null;
  } | null>(null);

  const current = loaded && loaded.forOrder === form.garment_order_id ? loaded : null;
  const order = current?.order ?? null;
  const orderErr = current?.error ?? null;
  const orderLoading = !!form.garment_order_id && !current;

  /**
   * One round trip per ORDER, not per keystroke.
   *
   * The requirement recalculates as the operator types, but only the LINE moves
   * — the order's approval quantities do not — so this fires on the order id
   * and nothing else. `cancelled` guards the operator picking a second order
   * before the first answers, which would otherwise leave the slower reply
   * overwriting the faster one.
   */
  useEffect(() => {
    const id = form.garment_order_id;
    if (!id) return;
    let cancelled = false;
    loadOrderProduction(id).then((res) => {
      if (cancelled) return;
      setLoaded(
        res.ok
          ? { forOrder: id, order: res.order, error: null }
          : { forOrder: id, order: null, error: res.error },
      );
    });
    return () => {
      cancelled = true;
    };
  }, [form.garment_order_id]);

  /**
   * THE ORDER'S PALETTE — Color/Print Details' three read-only panels (0490).
   *
   * KEYED THE SAME WAY `loaded` IS, and for the same reason: one cell holding
   * `{ forOrder, palette }` cannot show the previous order's colours while the
   * new order's reply is in flight. Two cells would spend that gap telling the
   * operator this BOM must cover a palette belonging to a different order —
   * worse here than on the production strip, because a colour list carries no
   * figure to look wrong.
   *
   * A SECOND ROUND TRIP, DELIBERATELY. `loadOrderProduction` beside it feeds the
   * requirement arithmetic; this feeds three lists nothing computes from. Folded
   * together, a dyeing table that failed to read would block a BOM that never
   * needed it — see `loadOrderPalette`.
   */
  /**
   * THE PALETTE, EDITABLE (client 2026-09-02: the three read-only panels
   * "make it user also update").
   *
   * ## THE ORDER STILL OWNS THE LIST. THIS IS A DRAFT OF IT.
   *
   * 0490's one-list design is unchanged and is the reason this state exists at
   * all rather than three panels writing straight through: what the operator
   * types has to survive until Save, and Save writes
   * `garment_order_amendment_dyeings` / `_prints` — the ORDER's tables. See
   * `lib/orders/fabric-bom/palette.ts`. The alternative the client was shown and
   * did not take was a BOM-local copy, which would let these panels show a
   * colour the Fabric Lines grid beneath them could not offer.
   *
   * ## KEYED BY ORDER, LIKE `paletteState` ABOVE IT
   *
   * Same cell-per-order shape and the same reason: a draft belonging to the
   * previous order must never be shown against the new one, and here it would be
   * worse than a stale read — the next Save would write those colours onto the
   * order now selected.
   *
   * ## SEEDED FROM THE LOAD, NOT DERIVED ON EVERY RENDER
   *
   * A derived list cannot be typed into. The seeding happens in the same effect
   * that loads the palette, so it runs exactly when the order changes and never
   * clobbers an edit in progress.
   */
  const [paletteDraft, setPaletteDraft] = useState<{
    /** `string | null`, the same as `Form.garment_order_id` — see
     *  `mutPalette`, which starts a draft before an order is named. */
    forOrder: string | null;
    fabric: PaletteRow[];
    yarn: PaletteRow[];
    prints: PaletteRow[];
  } | null>(null);

  const paletteEdit =
    paletteDraft && paletteDraft.forOrder === form.garment_order_id ? paletteDraft : null;

  /* ONE MUTATOR PER PANEL, pairing `setDirty` for the reason `mutDias` states.
     A palette edit is unsaved work like any other, and without this the silent
     auto-updater would reload the tab over it (AGENTS.md, "Auto-reload guard"). */
  const mutPalette = (
    panel: "fabric" | "yarn" | "prints",
    fn: (xs: PaletteRow[]) => PaletteRow[],
  ) => {
    /**
     * IT CREATES THE DRAFT WHEN THERE IS NONE, and that is the other half of
     * the default row (2026-09-03).
     *
     * This used to read `d ? {...} : d` — a no-op while `paletteDraft` was
     * null. So even once the three tables drew their blank row, typing in it
     * went nowhere: the row was there, the keystrokes were not kept, and the
     * field cleared itself on the next render. A row the operator cannot type
     * into is worse than no row, because it looks like the feature works.
     *
     * `forOrder` IS ALLOWED TO BE NULL, matching `Form.garment_order_id`. The
     * guard on `paletteEdit` below is an identity test, not a truthiness one,
     * so a draft started with no order (null) is read back only while no order
     * is picked — and the loader replaces it wholesale the moment one is,
     * which is the existing rule and is right: the order's palette is the
     * source, and anything typed before an order was named was typed against
     * no order at all.
     */
    setPaletteDraft((d) => {
      const base =
        d && d.forOrder === form.garment_order_id
          ? d
          : {
              forOrder: form.garment_order_id,
              fabric: blankPalette(),
              yarn: blankPalette(),
              prints: blankPalette(),
            };
      return { ...base, [panel]: fn(base[panel]) };
    });
    setDirty(true);
  };
  const setPaletteCell = (panel: "fabric" | "yarn" | "prints", key: string, value: string) =>
    mutPalette(panel, (xs) => xs.map((x) => (x.key === key ? { ...x, value } : x)));

  const [paletteState, setPaletteState] = useState<{
    forOrder: string;
    palette: OrderPalette;
  } | null>(null);

  useEffect(() => {
    const id = form.garment_order_id;
    if (!id) return;
    let cancelled = false;
    loadOrderPalette(id).then((res) => {
      if (cancelled || !res.ok) return;
      setPaletteState({ forOrder: id, palette: res.palette });
      /* THE EDITABLE DRAFT IS SEEDED HERE AND NOWHERE ELSE (2026-09-02), so it
         is re-seeded exactly when the order changes. `editableRows` drops the
         dash placeholder the read-only panels used: a dash is how an empty
         table says "nothing declared", and an editable grid says it with an
         empty grid and its own "+ Add" button. */
      setPaletteDraft({
        forOrder: id,
        fabric: editableRows(res.palette.fabric),
        yarn: editableRows(res.palette.yarn),
        prints: editablePrintRows(res.palette.prints),
      });
    });
    return () => {
      cancelled = true;
    };
  }, [form.garment_order_id]);

  const palette =
    paletteState && paletteState.forOrder === form.garment_order_id
      ? paletteState.palette
      : null;


  /**
   * THE ORDER'S PANEL-TO-FABRIC DECLARATION — the Components mapping rules
   * (0495).
   *
   * KEYED ON `forOrder` like `loaded` and `paletteState`, and for their reason:
   * one cell holding `{ forOrder, decls }` cannot offer the PREVIOUS order's
   * panels while the new order's reply is in flight. That matters more here than
   * on the palette, because this list is not merely displayed — it is what the
   * Component picker offers, so a stale one would let an operator map a panel
   * belonging to another order and the mapping would save.
   *
   * A THIRD ROUND TRIP, deliberately, for the reason `loadOrderPalette` beside
   * it already records: folded together, a declaration table that failed to read
   * would block a palette that never needed it.
   */
  const [declState, setDeclState] = useState<{
    forOrder: string;
    decls: StyleComponentDecl[];
  } | null>(null);

  useEffect(() => {
    const id = form.garment_order_id;
    if (!id) return;
    let cancelled = false;
    loadOrderStyleComponents(id).then((res) => {
      if (cancelled || !res.ok) return;
      setDeclState({ forOrder: id, decls: res.decls });
    });
    return () => {
      cancelled = true;
    };
  }, [form.garment_order_id]);

  const styleDecls =
    declState && declState.forOrder === form.garment_order_id ? declState.decls : EMPTY_DECLS;

  /** Which fabric line's [Detail] popup is open — Yarn Dyed Details (0512).
   *  It opened the components tree until 2026-09-02; that tree is the
   *  Components rail section now, and this popup is legacy's own [Detail]. */
  const [detailKey, setDetailKey] = useState<string | null>(null);
  const detailLine = lines.find((l) => l.key === detailKey) ?? null;
  /** The [Detail] button's own rect, so its sheet grows out of that button —
   *  same mechanism as `componentsOrigin` / `widthsOrigin` below (AGENTS.md,
   *  "A sub-detail Sheet's size"). */
  const [detailOrigin, setDetailOrigin] = useState<DOMRect | null>(null);

  /**
   * WHICH YARN, AND WHICH FABRIC, HAS ITS ROUTE UNFOLDED — legacy's `[+]`
   * (client 2026-09-03, screenshots 2652 + 2653: "list the yarn — if the yarn is
   * clicked show the S No / Stage / Process / For / Descriptions / Loss %", and
   * the same for the fabric).
   *
   * BOTH TABS USED TO DRAW EVERY PANEL AT ONCE, which is what the request is
   * about: eight yarns and six fabrics each carrying a five- or seven-column
   * grid is a wall the operator scrolls to find the one line they came for, and
   * legacy has never drawn it that way.
   *
   * TWO STATES, NOT ONE. The tabs are two sections of one rail and an operator
   * moves between them; a shared key would shut the yarn they were working on
   * because they glanced at a fabric.
   *
   * `null` IS EVERYTHING SHUT, and that is the mount state — the client's
   * standing rule from Combos ▸ Structure Details (2026-08-19): "instead of open
   * one section the sections should be in closed state, because it's making
   * confusion for the user". Keyed on the SUBJECT's id (`item_id`), which is
   * stable across every edit these screens allow — an accordion keyed on
   * something that mutates when a cell is filled is orphaned by an ordinary
   * edit, which is how the Colourways accordion lost its split on 2026-09-03.
   */
  const [openYarnId, setOpenYarnId] = useState<string | null>(null);
  const [openFabricId, setOpenFabricId] = useState<string | null>(null);


  /**
   * Every line of one style — THE COMPONENTS TREE'S SCOPE, and the one statement
   * of it. Read by `componentStyles` and so by every tree the rail draws.
   *
   * ## THE SCOPE IS THE STYLE, NOT THE FABRIC, AND THE SCREENSHOT IS WHY
   *
   * This reasoning was written on `detailLines`, which the [Detail] popup used
   * until 2026-09-02; that binding is gone but the RULE is not — it is what this
   * grouping implements, and the next reader finding a per-style grouping in a
   * file that keys everything else on the fabric needs it here.
   *
   * The tree was once scoped `fabricGroupKey(l) === fabricGroupKey(anchor)` —
   * (style, structure, fabric) — so a style knitted from two cloths needed the
   * tree opened twice, once per fabric line. Legacy's Components tab is ONE tree
   * per STYLE: its four panel rows are FRONT BODY / BACK / LEFT SLEEVE on SINGLE
   * JERSEY and NECK on 1X1 LYCRA RIB, in one list (legacy screenshot 2613). A
   * tree whose top two levels each held exactly one row would not be that tree.
   *
   * ## THE PANEL GROUPING STILL HOLDS AT THIS WIDTH
   *
   * The tree groups its lines by `component_id ?? panel_uid`, and a component is
   * taken at most once per style — that is `availablePanels`' rule 3, whose scope
   * 0495 records as "the STYLE, across fabrics" for exactly this reason. So
   * widening the input cannot merge two different panels into one row, and it is
   * what finally makes rule 3 VISIBLE: the panels it excludes are now on screen,
   * under the fabric that took them.
   *
   * ## COMPARED CASE-FOLDED, NOT BY `fabricGroupKey`'s KEY
   *
   * `style_ref_no` is free text on a line and stored in capitals (AGENTS.md), but
   * a line typed before that rule may not be — and a style that matched on one
   * screen and not here would draw a tree missing half its panels, which reads as
   * data loss rather than as a filter.
   *
   * ## THREE SCOPES, THREE FUNCTIONS — CITE EACH OTHER, DO NOT FOLD
   *
   * `fabricGroupKey` is NOT deleted and must not be reused here: Fabric Lines
   * groups by it, and so do the Yarn Dyed Details rows (0512), because how a
   * cloth's yarn is dyed is a fact about the CLOTH. Fabric Process keys on the
   * fabric alone (`item_id`). Same note `componentsTakenUnder` carries.
   */
  const linesOfStyle = (ref: string) => {
    const k = ref.trim().toUpperCase();
    return lines.filter((l) => l.style_ref_no.trim().toUpperCase() === k);
  };

  /**
   * THE PANEL HANDLERS, AS A FACTORY OVER THE LINE THEY ARE ANCHORED TO
   * (2026-09-02).
   *
   * They closed over `detailLine` / `detailLines` — the row the [Detail] popup
   * was opened from — which was the only caller while the popup was the only
   * mount. The Components rail row added today renders one tree PER STYLE with
   * no clicked row at all, so the scope has to be passed in rather than read
   * from a single piece of screen state.
   *
   * A FACTORY AND NOT THREE MORE FUNCTIONS. Add, remove and patch all need the
   * same two things — which lines are in scope, and which line a new one is
   * seeded from — so splitting them would be three places to keep that pairing
   * right. The popup calls it with the clicked row; the section calls it with
   * the style's first line.
   */
  const panelHandlers = (anchor: LineRow | null) => {
    const scope = anchor ? linesOfStyle(anchor.style_ref_no) : [];
    const inScope = (x: LineRow, panelKey: string) =>
      scope.some((d) => d.key === x.key) && (x.component_id ?? x.panel_uid) === panelKey;

    return {
      /** Patch every colourway of one panel — Component, Coordinate, Open/Tubular. */
      patchPanel: (panelKey: string, patch: Partial<LineRow>) =>
        mut((xs) => xs.map((x) => (inScope(x, panelKey) ? { ...x, ...patch } : x))),

      addPanel: (seed: { component_id: string | null; coordinate_id: string | null }) => {
        if (!anchor) return;
        const combos = [...new Set(scope.map((l) => l.combo))];
        const forCombos = combos.length ? combos : [anchor.combo];
        /* ONE UID FOR THE WHOLE PANEL — see `LineRow.panel_uid`. Taken before
           the map so all N colourways share it; `newKey()` inside the map would
           give each its own and one Add would draw as N blank rows. */
        const panelUid = newKey();
        mut((xs) => [
          ...xs,
          ...forCombos.map((combo) => ({
            ...blankLine(newKey()),
            panel_uid: panelUid,
            style_ref_no: anchor.style_ref_no,
            combo,
            /* THE ANCHOR'S CLOTH. On the popup that is the row the operator
               clicked; on the rail row it is the style's first line, which is
               the only defensible default when the tree spans several fabrics
               and nothing was clicked. Either way a new panel lands on a stated
               fabric rather than on none. */
            structure_id: anchor.structure_id,
            item_id: anchor.item_id,
            fabric_type: anchor.fabric_type,
            consumption_uom_id: anchor.consumption_uom_id,
            component_id: seed.component_id,
            coordinate_id: seed.coordinate_id,
          })),
        ]);
      },


  /** Remove a panel — and every colourway's line for it. */
      removePanel: (panelKey: string) =>
        mut((xs) => xs.filter((x) => !inScope(x, panelKey))),
    };
  };


  /**
   * Patch ONE colourway's line — Required Colour / Print, the Fabric and its
   * Type, and the Assort colour that may carry a style with it.
   *
   * `specification` is still IN the patch type and is no longer sent by any
   * cell: the client replaced that column with `Conv. Item` on 2026-09-03
   * (component-map-sheet.tsx). The field keeps its round trip through `LineRow`
   * so a value typed before then survives the next Save.
   *
   * SCOPE-FREE, unlike the panel handlers above: it is keyed on the line, so it
   * needs no anchor and both mounts of the Components tree pass the same
   * function. It was written inline at the popup's call site; naming it is what
   * let the rail row reuse it instead of growing a second copy of the
   * style-follows-colourway rule.
   *
   * THE STYLE RIDES WITH THE COLOURWAY, written on the CHANGE and never in an
   * effect — an effect also fires when a SAVED BOM is opened and would rewrite
   * every stored line's style on load. `styleForCombo` abstains where two styles
   * share a colourway name, and a blank style legitimately means "every style"
   * to `fabricSlices`.
   */
  const patchLine = (key: string, patch: Partial<LineRow>) =>
    setCell(
      key,
      patch.combo === undefined
        ? patch
        : { ...patch, style_ref_no: styleForCombo(patch.combo ?? "") },
    );

  /**
   * WHAT A LINE'S CLOTH IS CALLED — one derivation, both mounts.
   *
   * It was written inline at the popup's call site. The Components rail row
   * needs the same answers, and a second copy of this is precisely how two
   * surfaces come to print different Fabric Types for one line — the failure
   * `bomStatusTone` records app-wide and `fabricGroupKey` records in this
   * module. `structureName`, `descriptorFor` and the fabric master's own name
   * already answer each half for the Fabric Lines grid; this only gathers them.
   */
  /**
   * SOLID · MELANGE · YARN DYED, off the fabric the planner picked — THE one
   * derivation of it (0513).
   *
   * The cell has had three sources (`fabric_type` on the line, `item_sub_type` on
   * the order's combo structure, and this) and the file records why each of the
   * first two was wrong. What is new is that the answer is no longer only a
   * label: it decides whether Mixing Uom and No Of Colors exist on the row, and
   * whether the [Detail] popup has anything to show. So it is read here, by the
   * grid's `Type` cell, by `factsForLine` for the Components tree, by the Save
   * gate and by `problems` — five readers, one function.
   */
  const fabricTypeOf = (itemId: string | null): string =>
    (itemId ? (fabrics.find((f) => f.id === itemId)?.fabric_type ?? null) : null) ?? "";

  /**
   * THE STYLE THIS LINE IS FOR — the line's own, else the ORDER's (client
   * 2026-09-02: "from order entry fetch Style Ref No, Style No — now its fetching
   * wrong details").
   *
   * IT WAS FETCHING NOTHING, AND THAT WAS A REGRESSION I INTRODUCED. `style_ref_no`
   * used to be written by the `Combo` cell through `styleForCombo`. When the
   * client's field spec repointed that cell to `color_name` (the Colour tab's
   * Required Colour), the write went with it — so nothing set the style at all
   * and three columns printed a dash. It also silently broke the GSM cell, whose
   * index is keyed on the style; one deleted write, two visibly wrong columns.
   *
   * `orderIdentity` IS THE FALLBACK AND IT ABSTAINS ON A MULTI-STYLE ORDER, which
   * is the honest behaviour rather than a limitation: with two styles declared
   * there is no way to know which one a line is for, and naming the first would
   * be a confident lie in a column the operator cannot correct. A single-style
   * order — which is what the order header shows and what these three columns are
   * for — resolves completely.
   */
  const styleRefFor = (r: { style_ref_no: string }): string =>
    r.style_ref_no.trim() || orderIdentity?.ref || "";

  const factsForLine = (l: { key: string }) => {
    const line = lines.find((x) => x.key === l.key);
    const d = line ? descriptorFor(line) : null;
    return {
      structure: line ? structureName(line) : "",
      /* LEGACY'S `Structure Type` — the structure master's own knit family,
         carried on the picker row by `getStructureRows` (2026-09-02). It is a
         property of the STRUCTURE, not of the order or of the line, so it is
         looked up by `structure_id` and not derived from anything on the BOM. */
      structureType: line?.structure_id
        ? (data.structures.find((x) => x.id === line.structure_id)?.knit ?? "")
        : "",
      /**
       * THE FABRIC MASTER'S `fabric_type`, WHICH IS NOW ALSO WHAT THE GRID SHOWS.
       *
       * IT READ THE ORDER'S `item_sub_type` UNTIL 2026-09-02, and the grid's own
       * `Type` cell read the fabric master — the same word on two surfaces from
       * two sources, which is the exact shape of the 2581 defect the old comment
       * here was written to prevent. `fabricTypeOf` is the single derivation now,
       * so the Components tree and the Fabric Lines row cannot disagree.
       *
       * THE FABRIC IS THE RIGHT KEY, and the client's own rule decides it:
       * "structure stays, fabric changes" — a solid body and a melange sleeve are
       * two lines of the SAME structure, so any answer keyed on the structure
       * gives both the same word and the column stops distinguishing the thing it
       * exists to distinguish. It also has to be the fabric because this value
       * now GATES two mandatory cells (0513): a gate keyed on the structure would
       * demand a mixing ratio for a solid sleeve.
       */
      fabricType: fabricTypeOf(line?.item_id ?? null),
      fabric: line ? fabricName(line) : "",
      gsm: d?.gsm ?? "",
    };
  };

  /**
   * `bomFabricOptions` STOOD HERE AND IS DELETED (client 2026-09-02, third
   * telling: "Structure — that structure based on fabrics will list fabric
   * field").
   *
   * It was `fabrics.filter((f) => lines.some((l) => l.item_id === f.id))` — the
   * cloths this BOM already plans — on the client's own earlier instruction,
   * "Fabric from previous tab fabric line". The Components tree's Fabric picker
   * read it, and the reasoning was that a panel may only point at cloth the
   * document is actually buying.
   *
   * ## THE REASON IT MADE SENSE HAS SINCE EVAPORATED
   *
   * It was written when Components mapped panels onto lines the planner had
   * already created on Fabric Lines. Since the order now SEEDS the lines,
   * Components rows ARE fabric lines and there is no earlier tab that has named
   * a cloth first — so the list was empty on every seeded BOM, and the picker
   * showed nothing at all (screenshot 2643). Worse, it was self-referential:
   * the only way into `bomFabricOptions` is setting `item_id`, and the only
   * control that sets it here was the picker fed by `bomFabricOptions`.
   *
   * So the Components picker reads the MASTER, narrowed by the row's own
   * structure — the same list, from the same source, as the Fabric Lines cell
   * (`fabricItemsFor`). One field, two tabs, one behaviour. Nothing is lost:
   * picking a cloth here IS naming it on that line, which is the fabric line,
   * so a panel still cannot point at cloth with no line behind it.
   *
   * Deleted rather than left unused — an option list nothing renders is a second
   * answer waiting for a caller.
   */

  /**
   * THE STYLES THE COMPONENTS SECTION DRAWS A TREE FOR — legacy's outer band.
   *
   * DERIVED FROM THE LINES, not from the order's styles, and the difference is
   * the point: this section maps the panels of cloth this BOM actually plans, so
   * a style the order declares but the BOM has no line for has nothing to map
   * and no tree. The reverse — a line whose style could not be resolved — still
   * gets one, under "(no style)", because its panels are real work.
   *
   * INSERTION ORDER, which is the order Fabric Lines lists them in. Sorting
   * would put the tree in a different order from the grid the operator just came
   * from, for no gain.
   */
  const componentStyles = useMemo(() => {
    const out: { ref: string; anchor: LineRow; lines: LineRow[] }[] = [];
    const byRef = new Map<string, (typeof out)[number]>();
    for (const l of lines) {
      const k = l.style_ref_no.trim().toUpperCase();
      let g = byRef.get(k);
      if (!g) {
        // THE FIRST LINE IS THE ANCHOR — what "+ Add part" seeds a new panel's
        // cloth from when no row was clicked. See `panelHandlers`.
        g = { ref: l.style_ref_no.trim(), anchor: l, lines: [] };
        byRef.set(k, g);
        out.push(g);
      }
      g.lines.push(l);
    }
    return out;
  }, [lines]);

  /**
   * ADD ONE PANEL — which is N LINES, one per colourway (0495).
   *
   * The fan-out the grain decision bought, made explicit rather than hidden. The
   * colourways come from the lines already in this fabric's group, so a fabric
   * carrying WHITE and BLACK gains a WHITE and a BLACK row for the new panel and
   * they stay in step with every other panel of that cloth.
   *
   * A GROUP WITH NO COLOURWAY STILL GAINS ONE ROW. `combos` may be empty on an
   * order whose colourways are not entered yet, and a button that silently added
   * nothing would read as broken — the "declining grid" case AGENTS.md names, but
   * without the refusal being visible anywhere.
   */

  /**
   * The order's declared colours and prints — what the two auto-filled cells
   * offer. Both lists are the ORDER's, never a master: "empty and explain, never
   * a silent fallback" (AGENTS.md, Nominated vendors).
   *
   * READ FROM THE DRAFT, NOT FROM THE LOADED PALETTE (2026-09-02), and this is
   * the half that is easy to miss when the panels become editable. They used to
   * read `palette` — what the server last sent — so a colour typed into the
   * Colour panel would not be offered by a fabric line's Colour cell until the
   * BOM had been saved and reopened. The operator would have added NAVY on one
   * tab and found the tab below it refusing to accept NAVY, with nothing on
   * screen explaining why.
   *
   * `paletteEdit` falls back to the loaded lists while the draft is still null
   * (the window between picking an order and its palette arriving), so the cells
   * never offer less than they did before.
   */
  const declaredColours = useMemo(
    () =>
      [
        ...new Set(
          (paletteEdit
            ? [...paletteEdit.yarn, ...paletteEdit.fabric].map((r) => r.value)
            : [...(palette?.yarn ?? []), ...(palette?.fabric ?? [])].map((d) => d.color_name ?? "")
          )
            .map((v) => v.trim())
            .filter(Boolean),
        ),
      ].sort(),
    [paletteEdit, palette],
  );
  const declaredPrints = useMemo(
    () =>
      [
        ...new Set(
          (paletteEdit
            ? paletteEdit.prints.map((r) => r.value)
            : (palette?.prints ?? []).map((p) => p.print_name ?? "")
          )
            .map((v) => v.trim())
            .filter(Boolean),
        ),
      ].sort(),
    [paletteEdit, palette],
  );

  /**
   * THE ORDER'S FABRIC TREE, HELD RATHER THAN FETCHED ON A CLICK.
   *
   * The Seed button has always read these rows; what is new is that two COLUMNS
   * read them too — `GSM Range` and `Type`, legacy FabricAllocation's own
   * (client screenshot 2581, 2026-09-01). A descriptor that only arrived when
   * the button was pressed would leave both cells blank on every SAVED BOM the
   * operator merely opens, which is most of them.
   *
   * KEYED ON `forOrder` like `loaded` and `paletteState`, for their reason: two
   * separate cells would spend the in-flight gap printing the PREVIOUS order's
   * GSM beside this order's fabrics, and a GSM that belongs to another order
   * reads exactly like one that belongs to this one.
   *
   * THIS IS NOW THE ONLY READER OF THE ORDER'S TREE. `seedFromOrder` used it
   * too and was removed from the UI on 2026-09-01, so nothing creates rows from
   * these any more — they are read for the GSM Range and Type cells
   * (`descriptorFor`) and to scope the Structure picker (`orderStructures`).
   * The load stays on the order pick for that reason: both are needed when a
   * SAVED BOM is merely opened, not only after a button is pressed.
   */
  const [seedState, setSeedState] = useState<{
    forOrder: string;
    rows: OrderFabricSeedRow[];
  } | null>(null);

  useEffect(() => {
    const id = form.garment_order_id;
    if (!id) return;
    let cancelled = false;
    loadOrderFabricSeed(id).then((res) => {
      if (cancelled || !res.ok) return;
      setSeedState({ forOrder: id, rows: res.rows });
    });
    return () => {
      cancelled = true;
    };
  }, [form.garment_order_id]);

  const seedRows =
    seedState && seedState.forOrder === form.garment_order_id ? seedState.rows : null;

  const pickedOrder = useMemo(
    () => data.orders.find((o) => o.id === form.garment_order_id) ?? null,
    [data.orders, form.garment_order_id],
  );

  // ---- opening and closing -------------------------------------------------

  function openNew(garmentOrderId: string | null) {
    setEditId(null);
    setForm({ ...BLANK(), garment_order_id: garmentOrderId });
    // ONE BLANK LINE, never the empty state. Entering the first line must cost
    // no click — and an empty grid has no field for Tab to land on, so its only
    // affordance would be a button Tab never visits (AGENTS.md, enterNestedGrid).
    setLines([blankLine(newKey())]);
    // ONE BLANK DIA ROW, for `blankLine`'s reason exactly — an empty grid has no
    // field for Tab to land on.
    setDias([blankDia(newKey())]);
    /* NO SEED ROW. A repeat cannot be addressed until a fabric group exists to
       address it to, and the overlay opens its own blank row through `seedRow`
       once one does. */
    setYdRepeats([]);
    setYdCombinations([]);
    /* NO BLANK ROUTE ROW, and this is the deliberate exception to the two above.
       A route is per FABRIC, and a new BOM's one fabric line names nothing yet —
       seeding a step against it would put a row under a card headed "(no fabric
       named)". `FabricProcessGrid` passes `seedRow`, so each fabric's card opens
       on a blank step the moment it is rendered, which is where that rule
       belongs. */
    setProcs([]);
    /* NO BLANK YARN, and not for `setProcs`' reason above but for a stronger
       one (0493): there is no such thing as a blank yarn row. The rows are
       derived from the fabrics' compositions, so a new BOM with no fabric named
       has none — and gets a sentence saying so rather than an empty box. */
    setYarnAnswers({});
    /* ONE BLANK MANUAL ENTRY (0494), which is `blankLine`'s rule rather than
       `setProcs`' exception: an entry names a structure directly, so a blank one
       is a row the planner can type into and not a card headed "(no fabric
       named)". Its SIZES stay empty — they are seeded when the sheet is opened,
       once the entry's structure is known. */
    setEntries([blankManualEntry(newKey())]);
    setDirty(false);
    setMode("edit");
  }

  function openExisting(bomId: string) {
    const b = boms.find((x) => x.id === bomId);
    if (!b) return;
    setEditId(b.id);
    setForm({
      garment_order_id: b.garment_order_id,
      bom_date: b.bom_date,
    });
    const loadedLines: LineRow[] = (b.lines ?? []).map((l) => ({
        key: newKey(),
        id: l.id,
        style_ref_no: l.style_ref_no ?? "",
        combo: l.combo ?? "",
        structure_id: l.structure_id,
        coordinate_id: l.coordinate_id,
        component_id: l.component_id,
        panel_uid: l.component_id ?? `p${l.id}`,
        item_id: l.item_id,
        fabric_type: l.fabric_type ?? "",
        color_name: l.color_name ?? "",
        fabric_form: l.fabric_form ?? "",
        required_print: l.required_print ?? "",
        specification: l.specification ?? "",
        mixing_uom_id: l.mixing_uom_id ?? null,
        no_of_colors: l.no_of_colors ?? null,
        consumption_uom_id: l.consumption_uom_id,
        notes: l.notes ?? "",
    }));
    setLines(loadedLines);
    /* THE MANUAL ENTRIES (0494), numbers stringified once — see `ManualSizeRow`.
       A stored 0 becomes "0" and not "", because it is a value the planner typed
       and blanking it on reopen would silently un-answer a cell.

       THE SIZES ARE NOT RE-DERIVED HERE. What the database holds is what the
       planner entered; the seeding effect below adds a row for any size the
       order has GAINED since, and `manualSizeRows` keeps one the order has since
       dropped, tagged. Re-deriving on load would do both silently and lose the
       second. */
    setEntries(
      (b.manualEntries ?? []).map((e) => ({
        key: newKey(),
        id: e.id,
        style_ref_no: e.style_ref_no ?? "",
        width_form: e.width_form ?? "",
        item_id: e.item_id,
        structure_id: e.structure_id,
        calc_mode: e.calc_mode ?? "direct",
        wastage_pct: e.wastage_pct == null ? "" : String(e.wastage_pct),
        endbit_loss_pct: e.endbit_loss_pct == null ? "" : String(e.endbit_loss_pct),
        assort_color_wise: e.assort_color_wise ?? false,
        size_wise: e.size_wise ?? true,
        component_ids: (e.components ?? []).map((c) => c.component_id),
        sizes: (e.sizes ?? []).map((z) => ({
          key: newKey(),
          size_id: z.size_id,
          dia: z.dia == null ? "" : String(z.dia),
          purchase_width: z.purchase_width == null ? "" : String(z.purchase_width),
          grams: z.grams == null ? "" : String(z.grams),
          table_width: z.table_width == null ? "" : String(z.table_width),
          length: z.length == null ? "" : String(z.length),
          length_tolerance: z.length_tolerance == null ? "" : String(z.length_tolerance),
          cons_qty: z.cons_qty == null ? "" : String(z.cons_qty),
          finished_width: z.finished_width == null ? "" : String(z.finished_width),
        })),
      })),
    );
    if ((b.manualEntries ?? []).length === 0) setEntries([blankManualEntry(newKey())]);
    if ((b.lines ?? []).length === 0) setLines([blankLine(newKey())]);

    /* THE ROUTES (0492). NOTHING TO RE-ATTACH — they name their fabric by
       `item_id`, a stable master id, so they load straight across. The first
       cut keyed them to a BOM line and had to rebuild a `line_id` -> React key
       map here; re-keying to the fabric deleted that step rather than tidying
       it. */
    setProcs(
      (b.processes ?? []).map((p) => ({
        key: newKey(),
        item_id: p.item_id,
        stage_id: p.stage_id,
        process_id: p.process_id,
        loss_for_id: p.loss_for_id,
        description: p.description ?? "",
        /* Text, like every numeric cell on this screen: a controlled `<Input>`
           cannot hold "1." or "" as a number, so the form keeps text and the
           boundary converts once. */
        loss_pct: p.loss_pct == null ? "" : String(p.loss_pct),
        type_id: p.type_id,
      })),
    );

    /* THE YARN DYED PANELS (0512). Straight across, because unlike the yarn
       ANSWERS below these rows are not re-derived from anything — they are what
       the planner typed, and the fabric group they name is what puts them back
       in front of the right [Detail] overlay. */
    setYdRepeats(
      (b.ydRepeats ?? []).map((r) => ({
        key: newKey(),
        style_ref_no: r.style_ref_no ?? "",
        structure_id: r.structure_id,
        item_id: r.item_id,
        sno: r.sno ?? 0,
        yarn_item_id: r.yarn_item_id,
        dye_type: r.dye_type === "grey" ? ("grey" as const) : ("dyed" as const),
        color_name: r.color_name ?? "",
        uom_id: r.uom_id,
        value: r.value,
        twisted_yarn: r.twisted_yarn ?? "",
      })),
    );
    setYdCombinations(
      (b.ydCombinations ?? []).map((r) => ({
        key: newKey(),
        style_ref_no: r.style_ref_no ?? "",
        structure_id: r.structure_id,
        item_id: r.item_id,
        combo: r.combo ?? "",
        yd_combo_name: r.yd_combo_name ?? "",
      })),
    );

    const saved = b.dias ?? [];
    setDias(
      saved.length
        ? saved.map((d) => ({
            key: newKey(),
            knit_type: d.knit_type ?? "",
            dia: d.dia == null ? "" : String(d.dia),
          }))
        : [blankDia(newKey())],
    );

    /* THE ANSWERS, KEYED BY YARN (0493) — not rows. The rows come back by
       re-deriving from the fabrics this document names, so a saved BOM whose
       fabric has since lost a yarn from its composition simply stops showing
       that yarn, and one whose fabric GAINED a yarn shows it immediately with
       nothing filled in. Storing the list instead would freeze the composition
       as it stood on the day the BOM was saved. */
    setYarnAnswers(
      Object.fromEntries(
        (b.yarns ?? []).map((y) => [
          y.item_id,
          {
            stages: (y.stages ?? []).map((st) => ({
              key: newKey(),
              stage_id: st.stage_id,
              process_id: st.process_id,
              /* THE `For` COLUMN, A LOOKUP ID SINCE 0520 — it held a colourway
                 until 2026-09-03. Null passes straight through: the picker's
                 empty value IS null, unlike the `<select>` this replaced, whose
                 empty value was `""` and needed the coalesce. */
              loss_for_id: st.loss_for_id ?? null,
              description: st.description ?? "",
              /* Text, like every numeric cell on this screen: a controlled
                 `<Input>` cannot hold "1." or "" as a number, so the form keeps
                 text and the boundary converts once. */
              loss_pct: st.loss_pct == null ? "" : String(st.loss_pct),
            })),
          },
        ]),
      ),
    );

    setDirty(false);
    setMode("edit");
  }

  function openTask(t: BomTaskRow) {
    if (t.bom_id) openExisting(t.bom_id);
    else openNew(t.id);
  }

  // ---- seeding from the order's own combo tree -----------------------------

  /**
   * `seedFromOrder` IS GONE (client 2026-09-03) — the button that called it
   * was removed from Fabric Lines, and a fetch-and-toast wrapper with no
   * caller is dead code that still reads as a feature.
   *
   * WHAT IT WAS: `loadOrderFabricSeed(orderId)`, then `setSeedState` with the
   * fresh rows (so the derived GSM Range and Type cells followed an amended
   * order), then `applySeed`, then a toast naming the count — or
   * "Every panel on this order is already on the BOM" when it added nothing,
   * because an action that does nothing and says nothing reads as broken.
   * Every one of those four calls survives here for other callers, so
   * restoring it is re-assembling them, not rebuilding anything.
   *
   * THE AUTOMATIC FIRST FILL IS UNTOUCHED. `applySeed` below still runs from
   * the `seededFor` effect, so a new BOM opened against an order arrives
   * with that order's panels; only the manual re-run has gone.
   */

  /**
   * The seeding itself, WITHOUT the fetch or the toasts.
   *
   * IT HAD TWO CALLERS AND NOW HAS ONE: the automatic first fill (the
   * `seededFor` effect). The split is kept anyway — it is what let the
   * removed button and the automatic path share ONE definition of what a
   * seeded line is, and it is why putting the button back is a wrapper
   * rather than a second copy of these rules. The returned count is what a
   * caller needs to say how many lines it added; the automatic path ignores
   * it and stays silent.
   *
   * ## ADDITIVE. IT NEVER REMOVES OR OVERWRITES A LINE
   *
   * "Already have" is the four keys that ADDRESS a fabric — style, colourway,
   * structure, panel — the same tuple `order_fabric_bom_lines` uses to point
   * at the order's tree (0426). Two lines differing only in fabric are two
   * deliberate lines and both stay.
   *
   * ## WHAT IT DELIBERATELY DOES NOT SEED
   *
   * The FABRIC. The order names a structure and never a cloth, and the client
   * chose to keep that cell typed rather than have it guess from a sibling
   * line (2026-09-02) — so a seeded row arrives with its panel, its colourway
   * and its print, and the planner names the cloth. `Fabric Type` is not
   * seeded either, for the reason it is not a stored cell at all: it reads off
   * the fabric that is picked, so seeding it would be the second source that
   * `fabricTypeOf` exists to prevent.
   *
   * NOT A HOOK OF ANY KIND. It is called from an effect below and from the
   * button, and this component returns early further down; AGENTS.md's standing
   * rule is that every hook lives above that line, and a plain function cannot
   * break it.
   */
  function applySeed(rows: OrderFabricSeedRow[]): number {
    const addressOf = (l: {
      style_ref_no: string | null;
      combo: string | null;
      structure_id: string | null;
      component_id: string | null;
    }) =>
      [l.style_ref_no ?? "", l.combo ?? "", l.structure_id ?? "", l.component_id ?? ""]
        .map((v) => v.trim().toUpperCase())
        .join(SEP);

    const held = new Set(lines.map(addressOf));
    const fresh = rows.filter((r) => !held.has(addressOf(r)));
    if (fresh.length === 0) return 0;

    /* ONE UID PER PANEL, SHARED BY ITS COLOURWAYS — `LineRow.panel_uid`'s rule.
       A panel that has a component groups by that component and never reads
       this; a structure the order declares with NO parts seeds one line per
       colourway carrying `component_id: null`, and those must not draw as N
       separate blank panel rows in the Components tree. Keyed on
       (style, structure, panel) so two structures never share one. */
    const uidOf = new Map<string, string>();
    const panelUid = (r: OrderFabricSeedRow) => {
      const k = [r.style_ref_no ?? "", r.structure_id ?? "", r.component_id ?? ""]
        .map((v) => v.trim().toUpperCase())
        .join(SEP);
      let u = uidOf.get(k);
      if (!u) {
        u = newKey();
        uidOf.set(k, u);
      }
      return u;
    };

    mut((xs) => [
      // Drop the untouched scaffolding row the grid seeds, so a fresh BOM does
      // not begin with a blank line above the seeded ones.
      ...xs.filter((l) => l.item_id || l.consumption_uom_id || l.structure_id),
      ...fresh.map((r) => ({
        ...blankLine(newKey()),
        panel_uid: panelUid(r),
        style_ref_no: r.style_ref_no ?? "",
        combo: r.combo ?? "",
        structure_id: r.structure_id,
        /* THE PAIR, NEVER HALF OF IT — the Style declares FRONT BODY *of*
           PIECES, so a seeded line carrying the panel and not its coordinate
           shows "—" in the Components tree's first cell. That is the state
           screenshot 2636 was taken in. */
        coordinate_id: r.coordinate_id,
        component_id: r.component_id,
        color_name: r.color_name ?? "",
        /* THE ORDER'S "Roll form print" LANDS ON Required Print — the mapping
           the client chose over a column of its own (2026-09-02), because
           Components already has that cell and two cells carrying one fact is
           how they come to disagree. */
        required_print: r.print_name ?? "",
      })),
    ]);
    return fresh.length;
  }

  /**
   * THE FIRST FILL, ONCE, ON A NEW BOM (client 2026-09-02: seed on picking the
   * order AND keep the button).
   *
   * AN EFFECT IS THE ONLY PLACE IT CAN LIVE, and that is exactly the shape this
   * file warns about everywhere else ("WRITTEN ON THE CHANGE, NEVER IN AN
   * EFFECT — an effect also fires when a saved BOM is opened and would rewrite
   * stored lines on load"). The warning is honoured by three guards rather than
   * waived, because the order pick cannot do this itself: `seedRows` arrives
   * from a server action a round trip AFTER the pick, so at the moment of the
   * change there is nothing to seed from.
   *
   *   1. `editId === null` — a SAVED BOM is never touched, which is the failure
   *      the rule names by name.
   *   2. The grid is still the untouched scaffolding row `openNew` puts there.
   *      Anything typed, picked or added by hand means the planner has started,
   *      and their work is not something a background fill may reorganise.
   *   3. `seededFor` — once per order id, so a re-render or a refetch does not
   *      fill twice. `applySeed` is additive and would not duplicate, but "it
   *      would be harmless" is not a reason to run it.
   *
   * The button stays for everything this deliberately will not do: a half-typed
   * BOM, a saved one, and an order amended after the BOM was started.
   */
  const seededFor = useRef<string | null>(null);
  useEffect(() => {
    const id = form.garment_order_id;
    if (!id || editId !== null || !seedRows || seededFor.current === id) return;
    const untouched =
      lines.length === 1 &&
      !lines[0].item_id &&
      !lines[0].structure_id &&
      !lines[0].component_id &&
      !lines[0].style_ref_no.trim();
    if (!untouched) return;
    seededFor.current = id;
    /**
     * THIS DISABLE APPEARED WITH NO CODE CHANGE, and that is worth a sentence.
     * `applySeed` sets state, and until 2026-09-03 it had a second caller — the
     * "Seed from order" button — so the rule could not prove the setState was
     * effect-only. With the button gone this call is the only one, and the rule
     * now fires on an effect that has not moved.
     *
     * IT IS THE NARROW CASE THE RULE ALLOWS FOR, not a shrug at it. The cascade
     * the rule guards against is an effect that re-runs and re-sets; this one is
     * fenced three ways — `seededFor` makes it once per order id, `editId`
     * excludes a saved BOM, and `untouched` excludes a grid anyone has typed in.
     * It is a one-shot fill of a new document from data that arrives
     * asynchronously, which cannot be done during render.
     */
    // eslint-disable-next-line react-hooks/set-state-in-effect
    applySeed(seedRows);
    // `applySeed` is re-created every render and reads `lines`, so depending on
    // it would re-run this on every keystroke. The three guards above are what
    // make the narrow list correct rather than merely quiet.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.garment_order_id, editId, seedRows]);

  // ---- the line grid -------------------------------------------------------

  /**
   * FABRIC LINES DRAWS ONE ROW PER **ALLOCATION**, NOT PER PANEL (client
   * 2026-09-02, screenshot 2645: "why this much fabric lines adding
   * automatically — fix the error").
   *
   * ## WHAT THE OPERATOR SAW, AND WHY IT WAS NOT A SEEDING BUG
   *
   * The order declares 13 panels — 3 colourways × (3 jersey panels + 1 rib) plus
   * one contrast back body — and the seed created exactly 13 lines. Verified
   * against the catalog: 13 panels, **6 allocations**. Nothing duplicated.
   *
   * What was wrong is that this tab drew all 13. It has no Component column —
   * legacy's FabricAllocation row has none either — so rows 1, 2 and 3 were
   * identical in every visible cell: same Structure, same GSM Range, same Style
   * Ref, same Style No, same Style Color. Three rows the screen gave the
   * operator no way to tell apart, each demanding its own Fabric. That reads as
   * a bug because on this tab it *is* one.
   *
   * ## THE GRAIN IS LEGACY'S OWN, AND IT IS THE CLIENT'S "STRUCTURE STAYS,
   * ## FABRIC CHANGES" RULE READ FORWARDS
   *
   * An allocation is (style, colourway, structure, **fabric**). A structure gets
   * a SECOND row exactly when its panels are cut from a second cloth — which is
   * that rule, and the only thing that legitimately splits a structure in two.
   * So a freshly seeded BOM shows 6 rows, because every panel starts with no
   * fabric and they collapse; mapping the sleeve to a melange on Components
   * splits that structure into two rows here, visibly, with the fabric being the
   * thing that differs. The panel-level detail stays where it belongs.
   *
   * This REVERSES the "show every panel row" answer of an hour earlier, and does
   * so on the client seeing it: that answer was given against a 4-row preview.
   *
   * ## NOTHING BELOW THIS TAB CHANGES
   *
   * `lines` is still one row per panel and is what Save writes, what the
   * Components tree reads, and what the requirement explodes. This is a VIEW —
   * the same call `PanelGroup` already makes one tab over, where N colourway
   * lines draw as one panel row. Two groupings of one array, each for the
   * question its own tab asks.
   */
  const allocationKeyOf = (l: LineRow) =>
    [l.style_ref_no, l.combo, l.structure_id ?? "", l.item_id ?? ""]
      .map((v) => v.trim().toUpperCase())
      .join(SEP);

  /**
   * One representative line per allocation, in first-seen order.
   *
   * THE REPRESENTATIVE IS A REAL MEMBER, not a synthesised row: every cell on
   * this grid reads a field that is group-wide by construction (structure,
   * fabric, style, colourway, the mixing cells), so the first member's value IS
   * the group's. The per-PANEL fields that genuinely vary — component,
   * coordinate, required print, open/tubular — have no column here, which is
   * what makes one representative honest rather than a rollUp that would have to
   * say "(mixed)". `specification` was in that list until 2026-09-03 and is now
   * stored-only, with no cell on ANY tab — see `MapLine.specification`.
   */
  const allocationRows = useMemo(() => {
    const seen = new Set<string>();
    const out: LineRow[] = [];
    for (const l of lines) {
      const k = allocationKeyOf(l);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(l);
    }
    return out;
  }, [lines]);

  /**
   * Write a cell to EVERY panel of the allocation, never to the one row drawn.
   *
   * This is what makes the grouping safe rather than merely tidier. Patching the
   * representative alone would set the fabric on one of three panels and leave
   * the other two blank — invisible on this tab, and the Save gate would then
   * refuse the document naming a line the operator cannot see. Every cell here
   * goes through it; `setCell` stays for the Components tree, which edits ONE
   * colourway's line on purpose.
   */
  const setAlloc = (row: LineRow, patch: Partial<LineRow>) => {
    const k = allocationKeyOf(row);
    mut((xs) => xs.map((x) => (allocationKeyOf(x) === k ? { ...x, ...patch } : x)));
  };

  /** Remove an allocation — and every panel under it, for `setAlloc`'s reason.
   *  A row the operator deletes must not leave lines behind that only the
   *  Components tab can see. */
  const removeAlloc = (row: LineRow) => {
    const k = allocationKeyOf(row);
    mut((xs) => xs.filter((x) => allocationKeyOf(x) !== k));
  };

  const comboOptions = pickedOrder?.combos ?? [];

  // ---- the order's own descriptors for a line (client screenshot 2581) ------

  /**
   * `GSM Range` AND `Type`, READ OFF THE ORDER — legacy FabricAllocation's own
   * two description columns (client screenshot 2581, 2026-09-01).
   *
   * DERIVED, NEVER STORED. `garment_order_amendment_combo_structures` already
   * holds `gsm`, `gsm_tolerance` and `item_sub_type` per structure, so copying
   * them onto the BOM line would be a second place for them to disagree with the
   * order — the argument `getOrderFabricSeed`'s own header makes, and the same
   * one 0490 makes for not copying the palette.
   *
   * `Type` HERE IS `item_sub_type`, NOT `fabric_type`, and getting that backwards
   * is what this change fixes. 0408 puts both words on one table: `fabric_type`
   * is Main Fabric vs Trims Fabric, `item_sub_type` is Solid / Melange / Yarn
   * Dyed. Legacy's `Type` cell reads "Solid", so it is the second one — the
   * screen rendered the first for as long as the column existed.
   *
   * MATCHED ON (style, colourway, structure), because that is the row those
   * three values live on. The component is deliberately NOT part of the key:
   * every panel cut from one structure shares its GSM, so keying on it would
   * make a line with no component answer nothing.
   *
   * IT ABSTAINS RATHER THAN GUESSES, and the catalog says that is not
   * theoretical. A line naming no colourway matches every colourway that uses
   * the structure, and on 2026-09-01 FOUR live (style, structure) pairs had
   * colourways declaring DIFFERENT gsm or sub-type — BOYS T SHIRT and
   * STL/26-27/0007 among them. Answering with the first match would print one
   * colourway's GSM against another's fabric, and a guessed GSM reads exactly
   * like a declared one. So: one distinct answer or a dash.
   */
  /* AN IIFE, NOT A `useMemo` (2026-09-02). It memoised a FUNCTION, and the
     React Compiler cannot preserve that: it reported "existing memoization could
     not be preserved" and SKIPPED OPTIMIZING THE WHOLE COMPONENT — one
     error-level lint that silently cost this heavy screen its compilation. 0 of
     these at HEAD; the component grew past what the compiler could prove today.

     AGENTS.md's remedy for the same shape one rule over: "drop the memo and make
     it a plain const". The IIFE keeps what the memo was actually buying — the
     two indexes are built ONCE PER RENDER rather than once per call, and
     `factsForLine` calls this per line — while costing a rebuild on renders
     where `seedRows` did not change. That pass is over the order's own combo
     tree (tens of rows), which is the "cheap pass" the rule describes. */
  const descriptorFor = (() => {
    const key = (style: string | null, combo: string | null, structure: string | null) =>
      [style ?? "", combo ?? "", structure ?? ""].map((v) => v.trim().toUpperCase()).join(SEP);

    /* TWO INDEXES OVER ONE LIST. The exact one answers a line that names its
       colourway; the loose one collects every colourway using the structure, so
       the blank-combo case can test whether they agree instead of picking one. */
    const exact = new Map<string, Descriptor>();
    const loose = new Map<string, { gsm: Set<string>; sub: Set<string>; num: Set<number> }>();
    /* THIRD INDEX: THE STRUCTURE ALONE (client 2026-09-02, "if i choose Structure
       field it show the gsm from that order combo tab gsm here").

       The two above are both keyed on `style_ref_no`, so a line that does not yet
       name a style matched NEITHER and the cell printed a dash however complete
       the order's own composition was. Choosing a structure is exactly when the
       operator expects the weight to appear, and the order states it per
       (style, combo, structure) — so with no style named, "every style that uses
       this structure" is the honest scope.

       IT IS A FALLBACK, NOT A REPLACEMENT, and the order matters: a line that
       DOES name a style must keep getting that style's answer, because the four
       live (style, structure) pairs that disagree are the whole reason the
       abstain rule exists. This only answers where the sharper keys could not. */
    const byStructure = new Map<
      string,
      { gsm: Set<string>; sub: Set<string>; num: Set<number> }
    >();

    const blank = () => ({
      gsm: new Set<string>(),
      sub: new Set<string>(),
      num: new Set<number>(),
    });

    for (const r of seedRows ?? []) {
      const gsm = gsmRange(r.gsm, r.gsm_tolerance);
      const sub = ITEM_SUB_TYPE_OPTIONS.find((o) => o.value === r.item_sub_type)?.label ?? "";
      exact.set(key(r.style_ref_no, r.combo, r.structure_id), { gsm, sub, gsmNum: r.gsm ?? null });
      const lk = key(r.style_ref_no, null, r.structure_id);
      const seen = loose.get(lk) ?? blank();
      seen.gsm.add(gsm);
      seen.sub.add(sub);
      if (r.gsm != null) seen.num.add(r.gsm);
      loose.set(lk, seen);

      const sk = key(null, null, r.structure_id);
      const anyStyle = byStructure.get(sk) ?? blank();
      anyStyle.gsm.add(gsm);
      anyStyle.sub.add(sub);
      if (r.gsm != null) anyStyle.num.add(r.gsm);
      byStructure.set(sk, anyStyle);
    }

    const one = (s: Set<string>) => (s.size === 1 ? [...s][0] : "");
    /* THE SAME ABSTAIN RULE ON THE NUMBER, and it must stay the same one. A
       `gsmNum` that answered where `gsm` prints a dash would put a GUESSED
       weight in front of the operator on exactly the four (style, structure)
       pairs the comment above says disagree — and a weight carries no visible
       sign of which colourway it came from. */
    const oneNum = (s: Set<number>) => (s.size === 1 ? [...s][0] : null);

    return (l: LineRow): Descriptor => {
      if (!l.structure_id) return NO_DESCRIPTOR;
      if (l.combo.trim()) {
        return exact.get(key(l.style_ref_no, l.combo, l.structure_id)) ?? NO_DESCRIPTOR;
      }
      const seen =
        loose.get(key(l.style_ref_no, null, l.structure_id)) ??
        /* THE STRUCTURE-ONLY FALLBACK. Reached when the line names no style, or
           names one the order's composition does not mention — both of which
           print a dash otherwise, on a row whose structure the order describes
           perfectly well. The abstain rule below is unchanged, so a structure
           whose colourways disagree still answers with a dash rather than
           picking one. */
        byStructure.get(key(null, null, l.structure_id));
      return seen
        ? { gsm: one(seen.gsm), sub: one(seen.sub), gsmNum: oneNum(seen.num) }
        : NO_DESCRIPTOR;
    };
  })();

  /**
   * The three names a Fabric Process card is headed with (0492).
   *
   * RESOLVED THROUGH THE SCREEN'S OWN OPTION LISTS, which is safe HERE and is
   * not safe on the seed — `getOrderFabricSeed` resolves names server-side
   * precisely because a structure the order names but the master has since
   * deactivated would resolve to nothing in these lists. That risk does not
   * apply to a heading: these lists carry inactive rows (the "Disabled rows"
   * rule keeps them, so a saved line's own value stays resolvable), and a
   * heading that falls back to a dash costs a label, not a silently unlabelled
   * seeded row.
   */
  const fabricById = useMemo(
    () => new Map(fabrics.map((f) => [f.id, f.name] as const)),
    [fabrics],
  );
  const structureById = useMemo(
    () => new Map(data.structures.map((r) => [r.id, r.name] as const)),
    [data.structures],
  );
  const componentById = useMemo(
    () => new Map(data.components.map((r) => [r.id, r.name] as const)),
    [data.components],
  );
  const fabricName = (l: LineRow) => (l.item_id ? fabricById.get(l.item_id) ?? "" : "");
  const structureName = (l: LineRow) =>
    l.structure_id ? structureById.get(l.structure_id) ?? "" : "";
  const componentName = (l: LineRow) =>
    l.component_id ? componentById.get(l.component_id) ?? "" : "";

  /**
   * WHICH STYLE A COLOURWAY BELONGS TO — and it ABSTAINS rather than guesses.
   *
   * The Style column is gone from Fabric Lines (client spec, 2026-09-01:
   * exclude Style Ref Number), so the colourway is the only thing the operator
   * picks and `style_ref_no` has to follow it. The order's own tree
   * (`seedRows`) is what knows the pairing; nothing is stored twice.
   *
   * A COLOURWAY NAME IS NOT UNIQUE ACROSS STYLES. Two styles on one order can
   * both have a NAVY, and picking a style for such a combo would silently
   * narrow the line to one of them. So the second, disagreeing style poisons the
   * entry to `null` and the lookup answers `""` — which `fabricSlices` already
   * reads as "every style", the honest answer. `""` is also what an unknown
   * combo gets, so the two cases need no branch at the call site.
   */
  const styleByCombo = useMemo(() => {
    const m = new Map<string, string | null>();
    for (const r of seedRows ?? []) {
      const combo = (r.combo ?? "").trim();
      const style = (r.style_ref_no ?? "").trim();
      if (!combo || !style) continue;
      if (!m.has(combo)) m.set(combo, style);
      else if (m.get(combo) !== style) m.set(combo, null);
    }
    return m;
  }, [seedRows]);
  const styleForCombo = (combo: string) => styleByCombo.get(combo.trim()) ?? "";

  /**
   * STYLE REF NO / STYLE NO / ARTICLE NO, READ-ONLY, FROM THE RE NUMBER
   * (client spec, 2026-09-01: "auto-populate based on the selected RE (Arry)
   * Number… No manual entry is permitted").
   *
   * IN THE HEADER, NOT IN THE GRID. The same spec excludes Style Ref No from
   * the line columns, and these three describe the DOCUMENT rather than a
   * fabric — repeating them down every row is the "redundant legacy columns…
   * if already in the header" the client struck off the Combos overlay for
   * exactly this reason.
   *
   * IT ABSTAINS ON A MULTI-STYLE ORDER, like `styleByCombo` above and every
   * other derivation on this screen. All 7 live orders declare exactly one
   * style (catalog 2026-09-01), but "+ Add style" exists on Order Info, so
   * naming the first of several in a header the operator cannot correct would
   * be a confident lie about which style this BOM is for. With more than one it
   * simply does not claim.
   */
  /* AN IIFE, NOT A `useMemo` — the same conversion `descriptorFor` above already
     carries, and for the same reason. The React Compiler reported "Compilation
     Skipped: Existing memoization could not be preserved" against this hook once
     `styleRefFor` began reading it from inside the column cells, and a skipped
     component loses the compiler's memoisation for EVERYTHING in the file, not
     just this value. Recomputing is a walk over `seedRows` — a handful of rows —
     against the cost of the whole screen falling out of compilation. */
  const orderIdentity = (() => {
    const seen = new Map<string, { ref: string; style: string; article: string }>();
    for (const r of seedRows ?? []) {
      const ref = (r.style_ref_no ?? "").trim();
      if (!ref) continue;
      seen.set(ref, {
        ref,
        style: (r.style ?? "").trim(),
        article: (r.article_no ?? "").trim(),
      });
    }
    return seen.size === 1 ? [...seen.values()][0] : null;
  })();

  /**
   * STYLE NO AND ARTICLE NO FOR ONE STYLE REF — the Components tree's top level
   * (client 2026-09-02, legacy screenshot 2613: `StyleRefNo | StyleNo |
   * ArticleNo`).
   *
   * SEPARATE FROM `orderIdentity` ABOVE, AND DELIBERATELY SO. That one ABSTAINS
   * when the order declares more than one style, because it feeds a header the
   * operator cannot correct and naming the first of several would be a confident
   * lie about which style this BOM is for. This one is asked ABOUT a style the
   * caller already holds, so there is nothing to guess — and abstaining here
   * would blank the very row legacy puts at the top of the tree, on exactly the
   * multi-style orders where it is most needed.
   */
  const styleIdentityFor = (ref: string) => {
    const k = ref.trim().toUpperCase();
    if (!k) return null;
    for (const r of seedRows ?? []) {
      if ((r.style_ref_no ?? "").trim().toUpperCase() !== k) continue;
      return {
        ref: (r.style_ref_no ?? "").trim(),
        style: (r.style ?? "").trim(),
        article: (r.article_no ?? "").trim(),
      };
    }
    return null;
  };

  /**
   * ONE CARD PER UNIQUE FABRIC — the axis Fabric Process is grouped by (0492).
   *
   * A rib used for a collar and the same rib used for a cuff are two BOM lines
   * and ONE route: they are knitted, dyed and compacted identically. So the
   * section is derived from the lines by `item_id` rather than rendered per
   * line, and each card carries the lines behind it so it can say what the
   * fabric is used FOR — the colourways, panels and structures that share it.
   *
   * AN ORPHANED ROUTE STILL GETS A CARD, with no lines under it. `procs` is a
   * flat array keyed by `item_id`, so removing the last line naming a fabric
   * leaves its route addressing nothing — and `normalizeProcesses` drops exactly
   * those on the next save. A card that simply vanished would take the warning
   * with it; the heading says the route is about to be dropped instead, which is
   * the operator's one chance to put the line back. That is the whole reason
   * `procs` is flat rather than a `Record<itemId, rows[]>` — see its own note.
   *
   * LINES FIRST, ORPHANS LAST, because the first group follows the order the
   * Fabric Lines grid is in and a doomed route is not what should head the pane.
   */
  const fabricGroups = useMemo(() => {
    const byId = new Map<string, { item_id: string; name: string; lines: LineRow[] }>();
    const group = (id: string) => {
      let g = byId.get(id);
      if (!g) {
        g = { item_id: id, name: fabricById.get(id) ?? "", lines: [] };
        byId.set(id, g);
      }
      return g;
    };
    for (const l of lines) if (l.item_id) group(l.item_id).lines.push(l);
    for (const p of procs) if (p.item_id) group(p.item_id);
    return [...byId.values()];
  }, [lines, procs, fabricById]);


  // ---- shared with Fabric Lines: the declared dias, and the order's structures

  /**
   * THE DIAS THIS BOM DECLARES, AS OPTIONS.
   *
   * 0490 built `order_fabric_bom_dias` as the vocabulary a WIDTH is stated in.
   * Its consumer is the Manual sheet's **Dia** cell, which screenshot 2586 draws
   * as a picker and which the client's spec says must "automatically prepopulate
   * … but remain editable".
   *
   * DEDUPED BY THE NUMBER, NOT BY THE ROW. Circular 60 and Woven 60 are two
   * legitimate declarations and one diameter — the cell stores a number, so
   * offering it twice would be two options writing the same value and the
   * planner would have to guess which. The knit types that declared it become
   * the sublabel, so nothing is lost from the reading.
   *
   * NORMALISED THROUGH `numOrNull`, so a declared "60.00" and a declared "60"
   * are one option rather than two identical-looking rows — which is also what
   * makes the held-value test below reliable.
   *
   * A ROW WITH NO NUMBER IS NOT AN OPTION. `normalizeDias` deliberately stores a
   * knit type with no dia, and an option whose value is "" would be an entry
   * that clears the cell while looking like a choice.
   */
  const declaredDiaOptions = useMemo(() => {
    const kinds = new Map<string, string[]>();
    for (const d of dias) {
      const n = numOrNull(d.dia);
      if (n == null) continue;
      const key = String(n);
      const label = KNIT_TYPE_OPTIONS.find((o) => o.value === d.knit_type)?.label;
      const seen = kinds.get(key) ?? [];
      if (label && !seen.includes(label)) seen.push(label);
      kinds.set(key, seen);
    }
    return [...kinds].map(([value, ks]) => ({
      value,
      label: value,
      sublabel: ks.length ? ks.join(" · ") : undefined,
    }));
  }, [dias]);

  /**
   * THE VALUE A CELL ALREADY HOLDS ALWAYS SURVIVES — AGENTS.md, "Disabled rows":
   * "the one row that survives is the one the record already holds… Dropping it
   * would show a filled field as empty and blank the FK on the next save."
   *
   * SHARPER HERE THAN ON A MASTER, because the list is edited on THIS screen in
   * a section the planner can open at any moment. Deleting a declared dia would
   * otherwise silently empty every size row citing it, and the save writes what
   * the form holds — so the next Save would make the loss permanent.
   */
  const diaOptionsFor = (held: string) => {
    const v = held.trim();
    if (!v || declaredDiaOptions.some((o) => o.value === v)) return declaredDiaOptions;
    return [...declaredDiaOptions, { value: v, label: v, sublabel: "not declared" }];
  };

  /**
   * THE STRUCTURES THIS ORDER USES — the client's rule that a BOM's structures
   * are "strictly restricted to what is in the order".
   *
   * NARROWED FROM THE MASTER BY THE ORDER'S OWN TREE (`seedRows`), never
   * filtered in SQL: the "Disabled rows" rule's second half applies exactly here
   * — an option list that narrows must still be able to show the value a record
   * already holds, or a structure dropped from the order would blank the entry
   * citing it on the next save. So a held value survives, tagged.
   */
  const orderStructures = useMemo(() => {
    const ids = new Set((seedRows ?? []).map((r) => r.structure_id).filter(Boolean));
    return data.structures.filter((x) => ids.has(x.id));
  }, [data.structures, seedRows]);

  const structureItemsFor = (held: string | null) => {
    if (!held || orderStructures.some((x) => x.id === held)) return orderStructures;
    const row = data.structures.find((x) => x.id === held);
    return row
      ? [...orderStructures, { ...row, name: `${row.name} (not on this order)` }]
      : orderStructures;
  };

  /**
   * THE FABRICS OF ONE STRUCTURE (client 2026-09-02: "the first structure field
   * based fabric only need to list in that fabric field with the crud action").
   *
   * The row names a Structure and then a Fabric, and the two are the same fact
   * at two grains — a Structure here IS a fabric CATEGORY (0405 · 0415), and
   * every fabric carries the category its own name is built from. So the list is
   * `items.category_id === line.structure_id`, and offering the other thirteen
   * cloths was offering twelve lines that cannot be right.
   *
   * ## THE HELD FABRIC ALWAYS SURVIVES
   *
   * Same rule as `structureItemsFor` above and as AGENTS.md's *Disabled rows*:
   * change the Structure on a row that already names a fabric and the narrowing
   * would resolve that fabric to nothing — the cell renders empty and the next
   * Save writes that emptiness over a real FK. It stays, tagged, and picking
   * anything else replaces it.
   *
   * ## WITH NO STRUCTURE, EVERY FABRIC — AND THAT IS NOT THE USUAL FALLBACK
   *
   * The nominated-vendor rule says a guard phrased as "restrict only in case X"
   * leaks through every state that is not X, and that a blank parent must offer
   * NOTHING. It says so because a vendor list narrowed to nothing is still
   * satisfiable by filling in the supply type. Here it would not be: `Fabric` is
   * MANDATORY and `Structure` is not, so a row with no structure and no offer is
   * a row that can never be saved and has nothing on screen to say why — the
   * "unsatisfiable, and the only way on is the mouse" failure the required-hold
   * rule records. A line seeded from the order always has its structure; only a
   * hand-added row can be here, and it is one pick away from being scoped.
   */
  /**
   * THE FABRIC TYPE VOCABULARY AS NAMES — Solid · Yarn Dyed · Printed · Melange
   * (0515), read from `config_lookups` kind `fabric_type`.
   *
   * NAMES, because `fabricTypeOf` returns a name and the Components cell
   * compares against it. Sorted by the service, so the order is the master's.
   * Blank names are dropped rather than rendered as an unpickable empty option.
   */
  const fabricTypeNames = useMemo(
    () =>
      data.fabricCreate.fabricTypes
        .map((t) => (t.name ?? "").trim())
        .filter(Boolean),
    [data.fabricCreate.fabricTypes],
  );

  /**
   * A FABRIC'S STRUCTURE — `items.category_id`, resolved for ONE cloth.
   *
   * The Components tree narrows its picker per row and so needs the answer a
   * fabric at a time; `fabricItemsFor` below scopes a whole LIST in one pass and
   * reads the column directly. Two operations over one column, stated here so
   * the next reader does not add a third derivation of "which structure is this
   * cloth" — same call `fabricTypeOf` records for the type.
   */
  const fabricStructureOf = (itemId: string | null) =>
    itemId ? (fabrics.find((f) => f.id === itemId)?.category_id ?? null) : null;

  /**
   * WHAT THIS ROW SAYS ITS CLOTH IS — the fabric's own type, else the one the
   * planner stated in the `Type` cell while no fabric is named.
   *
   * THE ORDER IS NOT NEGOTIABLE. The cloth wins whenever there is a cloth: a
   * stated type is a question ("show me yarn-dyed jerseys"), a fabric's type is
   * an answer, and letting the question outrank the answer is the two-sources
   * problem `typeFilter`'s own note refuses to create.
   *
   * READ BY THE PICKER'S SCOPE AND BY THE MIXING CELLS' VISIBILITY, and by
   * nothing else — see `typeFilter`. In particular NOT by `mandatory` on Mixing
   * Uom, which stays keyed on the fabric: a planner who has said "Yarn Dyed" and
   * not yet chosen the cloth must not be held on a field whose premise nothing
   * has established (`missingFabricLineFields` refuses to make that demand too).
   */
  const rowType = (line: LineRow): string =>
    line.item_id ? fabricTypeOf(line.item_id) : (typeFilter[allocationKeyOf(line)] ?? "");

  const fabricItemsFor = (line: LineRow) => {
    const held = line.item_id;
    /* NARROWED BY THE STATED TYPE ONLY WHILE NOTHING IS HELD — `rowType` returns
       the FABRIC's type once one is picked, and a filter equal to the held row's
       own type cannot exclude it. So the held-value survival below needs no
       second exemption: this filter is structurally incapable of hiding a value
       the line already carries (AGENTS.md, Disabled rows / Cascading filters). */
    const want = held ? "" : rowType(line);
    const byType = (xs: FabricOption[]) =>
      want ? xs.filter((f) => sameFabricType(f.fabric_type, want)) : xs;
    if (!line.structure_id) return byType(fabrics);
    const scoped = byType(fabrics.filter((f) => f.category_id === line.structure_id));
    if (!held || scoped.some((f) => f.id === held)) return scoped;
    const row = fabrics.find((f) => f.id === held);
    return row ? [...scoped, { ...row, name: `${row.name} (other structure)` }] : scoped;
  };

  // ---- Manual (0494) — the client's size-wise gram entries ------------------

  /**
   * THE SIZES THE ORDER STATES, taken from the ORDER and never typed.
   *
   * `fabricSlices('colour_size', …)` is the same explosion the requirement runs,
   * so the grid asks for a weight on exactly the rows the requirement will
   * demand one for — and the two cannot drift, because there is one function. A
   * list built from the sizes MASTER instead would offer sizes this order does
   * not sell and stay silent about one it does.
   *
   * UNSCOPED, because an ENTRY is unscoped: it names a structure and the panels
   * it covers, never a style or a colourway, so it applies to every slice of the
   * order. That is also why this is one list for the document rather than one
   * per row — 0491 computed it per line, which was a property of the grain it
   * got wrong.
   *
   * DEDUPED BY `size_id`, and the qty SUMMED across colourways: the explosion is
   * one row per (colourway, size), and Formula 1 multiplies the ORDER quantity
   * for a size. A size is a size — its gram weight does not depend on what
   * colour the cloth is dyed.
   *
   * A REFUSAL BECOMES AN EMPTY LIST, deliberately, and it is not swallowed: the
   * same refusal is already printed against every entry in Calculated
   * Quantities, and the pane says "this style states no sizes" in its own words.
   */
  const orderSizesByStyle = useMemo(() => {
    const out = new Map<string, { size_id: string; label: string; qty: number }[]>();
    if (!order) return out;
    /* EVERY STYLE THE ORDER NAMES, PLUS "" FOR THE UNSCOPED CASE, computed
       EAGERLY. A lazy cache filled on first call is what the React Compiler's
       `react-hooks/immutability` rule refuses, and it is right to: a Map created
       during render and written to afterwards is state the compiler cannot
       reason about. There are a handful of styles on an order, so building all
       of them costs one explosion each and removes the question. */
    const refs = ["", ...(pickedOrder?.styleRows ?? []).map((r) => r.style_ref_no)];
    for (const ref of refs) {
      const key = ref.trim().toUpperCase();
      if (out.has(key)) continue;
      /* SCOPED TO THE STYLE (0495), with blank meaning every style — the reading
         `fabricSlices` has given `style_ref_no` since 0426. Two styles on one
         order legitimately carry different size runs, so an order-wide list
         would ask a tee for a size only the polo sells. */
      const slices = fabricSlices("colour_size", { style_ref_no: key || null, combo: null }, order);
      if (isRefusal(slices)) {
        out.set(key, []);
        continue;
      }
      const seen = new Map<string, { size_id: string; label: string; qty: number }>();
      for (const sl of slices) {
        if (!sl.size_id) continue;
        const s0 = seen.get(sl.size_id);
        /* THE QTY IS SUMMED ACROSS COLOURWAYS. The explosion is one row per
           (colourway, size) and Formula 1 multiplies the ORDER quantity for a
           size — a size is a size, and its gram weight does not depend on what
           colour the cloth is dyed. */
        if (s0) s0.qty += sl.qty;
        else
          seen.set(sl.size_id, {
            size_id: sl.size_id,
            label: order.sizeNames?.[sl.size_id] ?? "—",
            qty: sl.qty,
          });
      }
      out.set(key, [...seen.values()]);
    }
    return out;
  }, [order, pickedOrder]);

  /** One style's sizes. An unknown ref answers `[]` rather than throwing: an
   *  entry may name a style the order has since dropped, and `manualProblem`
   *  turns an empty list into a sentence rather than a crash. */
  const orderSizesFor = (styleRef: string) =>
    orderSizesByStyle.get(styleRef.trim().toUpperCase()) ?? [];

  /**
   * The order's nominal GSM for one structure — what the CALCULATED mode
   * multiplies.
   *
   * ONE DISTINCT ANSWER OR NOTHING. It has to be the same abstain rule
   * `descriptorFor` applies to the printed GSM range, and the same one
   * `gsmByStructureOf` applies on the server: three readers of one fact, and a
   * screen that answered where the server abstains would show the planner a
   * weight the save then refuses. Four live (style, structure) pairs disagreed
   * on GSM on 2026-09-01, so this is not theoretical.
   */
  const gsmForStructure = (structureId: string | null): number | null => {
    if (!structureId) return null;
    const seen = new Set<number>();
    for (const r of seedRows ?? []) {
      if (r.structure_id === structureId && r.gsm != null) seen.add(r.gsm);
    }
    return seen.size === 1 ? [...seen][0] : null;
  };

  /**
   * THE ONE DIA A NEW SIZE ROW OPENS WITH (client spec, point 5).
   *
   * "When Dia sizes are defined in the Color Print Details tab, they should
   * automatically prepopulate the Dia field here but remain editable."
   *
   * ONLY WHERE THERE IS EXACTLY ONE, and the abstain is the whole care here.
   * With two or more declared there is no single answer, and a guessed diameter
   * is one the planner never chose standing in a cell that decides the knitting
   * programme. The cell still PICKS from all of them, so nothing is harder to
   * reach — it just starts empty rather than starting wrong.
   */
  const defaultDia = declaredDiaOptions.length === 1 ? declaredDiaOptions[0].value : "";

  /** One entry's rows, as `manual.ts` wants them. Text to numbers, once. */
  const sizeInputsOf = (e: ManualEntryRow): ManualSizeInput[] =>
    e.sizes.map((z) => ({
      size_id: z.size_id,
      dia: numOrNull(z.dia),
      purchase_width: numOrNull(z.purchase_width),
      grams: numOrNull(z.grams),
      table_width: numOrNull(z.table_width),
      length: numOrNull(z.length),
      length_tolerance: numOrNull(z.length_tolerance),
      cons_qty: numOrNull(z.cons_qty),
    }));

  /**
   * THE STYLE LEVEL — legacy's first, and the client's "Header Section (Style
   * Details)" (0495).
   *
   * READ ENTIRELY FROM THE ORDER, stored nowhere. `garment_order_amendment_styles`
   * already carries the ref, the Style master's code, the article number and the
   * unit kind, and 0426's rule holds: a copy on the BOM is a second place to
   * disagree with the order, and the order is the one that is right.
   *
   * ONE EXTRA ROW FOR "EVERY STYLE", and only when there is NOWHERE ELSE TO PUT
   * THE ENTRY. An entry whose `style_ref_no` is blank applies to every style —
   * the reading 0426 gave the column, the state every entry stored before 0495
   * is in, and the state the seeded blank entry starts in, because `startNew`
   * mints it before an order has been picked. Without a home those entries would
   * be reachable from no style at all: invisible, still planning, and destroyed
   * by the next Save. It is the "a held value always survives" rule, applied to
   * a whole level.
   *
   * ON A SINGLE-STYLE ORDER THE HOME IS THAT STYLE, AND THE EXTRA ROW IS A LIE
   * (client 2026-09-03, screenshots 2657-2659: "what is every style, remove
   * this, need to show that order style only"). "Every style" and "the only
   * style" are the same set, so the row offered the planner a choice between two
   * names for one thing — and it was there on EVERY new BOM, because the seeded
   * blank entry is unscoped by construction. `soleStyleRef` is what makes the
   * blank entry resolve to the declared style instead of growing a row beside
   * it; `entriesForStyle` reads the same value, so the row and its contents
   * cannot disagree about where an entry lives.
   *
   * IT IS DERIVED, NOT STAMPED. Re-pointing the entry's `style_ref_no` in an
   * effect would be `react-hooks/set-state-in-effect` (the rule that made the
   * size rows derived in the first place), and it would write a scope onto a
   * row the planner never scoped. Nothing about what is SAVED changes: a blank
   * ref still stores NULL, which on a one-style order means that style.
   *
   * WITH TWO OR MORE STYLES THE ROW STAYS, unchanged. There the choice is real —
   * an unscoped entry belongs to all of them and to none of them in particular —
   * and dropping it would orphan exactly the legacy rows it was written for.
   */
  const soleStyleRef =
    (pickedOrder?.styleRows ?? []).length === 1
      ? ((pickedOrder?.styleRows?.[0]?.style_ref_no ?? "").trim().toUpperCase() || null)
      : null;

  const manualStyleRows = useMemo(() => {
    const declared = (pickedOrder?.styleRows ?? []).map((r) => ({
      key: r.style_ref_no,
      style_ref_no: r.style_ref_no,
      style_no: r.style_no,
      article_no: r.article_no,
      unit_kind: r.unit_kind,
      unscoped: false,
    }));
    /* `soleStyleRef` ADOPTS THEM, so there is nothing left to strand — see the
       note above. `declared.length === 1` rather than the derived constant only
       because this hook must not close over a value computed outside it. */
    const adopts = declared.length === 1 && !!declared[0].style_ref_no.trim();
    const hasUnscoped = !adopts && entries.some((e) => !e.style_ref_no.trim());
    return hasUnscoped
      ? [
          ...declared,
          {
            key: "",
            style_ref_no: "",
            style_no: null,
            article_no: null,
            unit_kind: null,
            unscoped: true,
          },
        ]
      : declared;
  }, [pickedOrder, entries]);

  type ManualStyleRow = (typeof manualStyleRows)[number];

  /**
   * The entries one style row owns.
   *
   * Blank ref = the "every style" row — EXCEPT on a single-style order, where
   * the declared style adopts the unscoped entries and no such row is drawn.
   * See `soleStyleRef`: this is the reading half of that one decision, and it
   * has to be here rather than at the call sites because `manualStylePane`,
   * `styleRefusal` and the rail's dot all ask this same question.
   */
  const entriesForStyle = (ref: string) => {
    const k = ref.trim().toUpperCase();
    return entries.filter((e) => {
      const own = e.style_ref_no.trim().toUpperCase();
      return own === k || (!own && k !== "" && k === soleStyleRef);
    });
  };

  /*
   * `combosForStyle` AND `unitKindLabel` WERE HERE AND ARE GONE (2026-09-03).
   *
   * Both existed for ONE consumer — the meta line at the top of the Manual
   * style pane, "Style No … · Article … · Pcs · Colours: BLUE" — which the
   * client removed as unnecessary wording. Neither had a second reader, so they
   * went with it rather than standing as two derivations nothing derives.
   *
   * NEITHER FACT IS LOST, and neither was ever stored here. The colourways are
   * the slices the requirement already explodes into, off `seedRows`; the unit
   * is `garment_order_amendment_styles.unit_kind` (0471) on the order. These
   * were read-only restatements, never a second source. Anything needing them
   * again should read them the same way rather than restoring a formatter for a
   * sentence that no longer exists.
   *
   * `diaTypeOf` BELOW IS NOT ONE OF THEM — it feeds a grid cell, not the line
   * that went, and stays.
   */

  /**
   * Circular / Flat / Woven — the spec's "Component Type / Dia Type".
   *
   * DERIVED FROM THE DIAS THIS BOM DECLARES (0490), not stored and not typed.
   * A dia row states its knit type, and a size row picks a dia; so the type is
   * already answered the moment a dia is chosen, and asking for it again would
   * be a second answer free to contradict the first.
   *
   * IT ABSTAINS WHERE THE ENTRY'S SIZES DISAGREE, and prints the declaration
   * where they agree. An entry knitted at 60 circular on one size and 28 flat on
   * another is a real (if unusual) state, and naming one of them would be a
   * guess about the other.
   */
  const diaTypeOf = (e: ManualEntryRow): string => {
    const kinds = new Set<string>();
    for (const z of e.sizes) {
      const n = numOrNull(z.dia);
      if (n == null) continue;
      for (const d of dias) {
        if (numOrNull(d.dia) === n && d.knit_type) kinds.add(d.knit_type);
      }
    }
    if (kinds.size !== 1) return "";
    return KNIT_TYPE_OPTIONS.find((o) => o.value === [...kinds][0])?.label ?? "";
  };

  /**
   * Open Width / Tubular — the spec's "Assort Widths".
   *
   * A LOOKUP-FREE PAIR, like `calc_mode` beside it: two fixed answers the
   * business does not add to are a constraint, not a master.
   */
  const WIDTH_FORM_OPTIONS = [
    { value: "open_width", label: "Open Width" },
    { value: "tubular", label: "Tubular" },
  ];

  /**
   * The rows one entry's size grid shows, in the ORDER's size order.
   *
   * A STORED SIZE THE ORDER NO LONGER STATES IS KEPT, tagged. Same rule as "the
   * one row that survives is the one the record already holds" (AGENTS.md,
   * Disabled rows), and sharper here because the two lists are maintained on
   * different screens: an order amended to drop XXL would otherwise hide a
   * weight the planner had typed, and the next Save — which sends what the form
   * holds — would make that loss permanent.
   */
  const manualSizeRows = (e: ManualEntryRow): ManualDisplayRow[] => {
    const bySizeId = new Map(e.sizes.map((z) => [z.size_id, z]));
    const out: ManualDisplayRow[] = [];
    const used = new Set<string>();
    for (const z of orderSizesFor(e.style_ref_no)) {
      const row = bySizeId.get(z.size_id);
      /* A DECLARED SIZE WITH NOTHING STORED IS SHOWN ANYWAY, as a row that does
         not exist yet — `setSizeCell` materialises it on the first keystroke.

         THIS USED TO BE WRITTEN INTO STATE. `openManual` appended a blank
         `ManualSizeRow` per missing size on the way into the sheet, and when the
         sheet went (client 2026-09-03, the split) that hook went with it — there
         is no "opening" left to hang it on, and the effect that replaced it is
         banned outright: `react-hooks/set-state-in-effect` (React Compiler)
         refuses a `setState` in an effect body, and it is right to. The rows
         were never data. `normalizeManualSizes` deleted every one of them again
         on save, which is what a rendering concern living in state looks like.

         THE KEY IS DERIVED FROM THE SIZE, not minted. `newKey()` would hand the
         grid a different key on every render and re-mount the row under the
         cursor; it is also the key the materialised row KEEPS, so the first
         keystroke does not swap one identity for another and take the focus
         with it. */
      if (!row) {
        out.push({
          ...blankManualSize(`size:${z.size_id}`, z.size_id, defaultDia),
          label: z.label,
          declared: true,
        });
        continue;
      }
      used.add(row.key);
      out.push({ ...row, label: z.label, declared: true });
    }
    for (const z of e.sizes) {
      if (used.has(z.key)) continue;
      out.push({
        ...z,
        label: (z.size_id && order?.sizeNames?.[z.size_id]) || "—",
        declared: false,
      });
    }
    return out;
  };

  /** How many of the order's sizes this entry has a weight for — what the
   *  style list's n/m counts and what lights the section's quiet dot. */
  const manualAnswered = (e: ManualEntryRow) =>
    Object.keys(consumptionMap(e.calc_mode, sizeInputsOf(e), gsmForStructure(e.structure_id)))
      .length;


  /** One entry, as `manual.ts`'s rules want it. */
  const entryLike = (e: ManualEntryRow) => ({
    style_ref_no: e.style_ref_no.trim() || null,
    item_id: e.item_id,
    structure_id: e.structure_id,
    calc_mode: e.calc_mode,
    component_ids: e.component_ids,
    sizes: sizeInputsOf(e),
  });

  /**
   * THE COMPONENT OPTIONS ONE ENTRY MAY STILL CHOOSE FROM (client spec, point 5:
   * "once a component is saved under a fabric entry, it must automatically
   * disappear from the available dropdown selection of any subsequent fabric
   * entries").
   *
   * IT IS NOT TIDINESS — it is what makes the arithmetic add up. Entries are the
   * counting unit, so the garment's fabric weight is their sum, and that sum is
   * only right while the entries partition the panels: a component in two
   * entries is its cloth bought twice.
   *
   * THIS ENTRY'S OWN CHOICES ALWAYS SURVIVE (`takenComponentIds`' `exceptKey`),
   * or opening a saved entry would show it as having selected nothing and the
   * first edit would clear it — the "a held value always survives" rule, in the
   * one place where forgetting it silently deletes an answer.
   */
  const componentOptionsFor = (e: ManualEntryRow) => {
    const taken = takenComponentIds(
      entries.map((x) => ({
        key: x.key,
        style_ref_no: x.style_ref_no.trim() || null,
        component_ids: x.component_ids,
      })),
      { key: e.key, style_ref_no: e.style_ref_no.trim() || null },
    );
    return data.components
      .filter((c) => !taken.has(c.id))
      /* `{ id, label }`, which is `MultiSelectOption` — not the `{ value, label }`
         a `Combobox` takes. Two option shapes in one file, and the type checker
         is the only thing that tells them apart. */
      /* `{ id, label }`, which is `MultiSelectOption` — not the `{ value, label }`
         a `Combobox` takes. Two option shapes in one file, and the type checker
         is the only thing that tells them apart.

         `inactive` IS ALREADY RESOLVED. `getComponentRows` reads all three
         spellings of the flag through `isInactive()` on the server, so the
         screen passes the boolean through rather than re-deriving it — the
         "read it through one function" half of the Disabled rows rule. */
      .map((c) => ({ id: c.id, label: c.name, inactive: c.inactive }));
  };

  /**
   * LEGACY'S "Coordinate" COLUMN (client 2026-09-03, screenshot 2680: the
   * [Click] ▸ Components popup, `PIECES | FRONT BODY1 | ✓`) — READ-ONLY, the
   * same call the Components TAB's own `coordinateName` already makes for the
   * identical cell: a component's coordinate is a property of the STYLE's
   * declared pairing (`garment_order_amendment_style_components`), not of the
   * component in isolation, so an editable box here would be a second place
   * for it to disagree with the order.
   *
   * REUSES DATA THIS SCREEN ALREADY HOLDS — `styleDecls` and `data.coordinates`
   * are fetched once for the whole order and already passed to the Components
   * tab as `decls=` / `coordinates=` (below); this is the same lookup, not a
   * second fetch. `null` style_ref_no in a declaration means "every style", so
   * it matches after a style-scoped row fails to.
   */
  const coordinateForComponent = (componentId: string, styleRefNo: string): string | null => {
    const ref = styleRefNo.trim() || null;
    const decl =
      styleDecls.find((d) => d.component_id === componentId && d.style_ref_no === ref) ??
      styleDecls.find((d) => d.component_id === componentId && d.style_ref_no === null);
    if (!decl?.coordinate_id) return null;
    return data.coordinates?.find((c) => c.id === decl.coordinate_id)?.name ?? null;
  };

  /**
   * The entry's own grid — one row per size, and THE COLUMNS DEPEND ON THE MODE.
   *
   * Direct asks for the weight; calculated asks for the measurements and shows
   * the weight it derives. Building two lists rather than disabling half of one
   * is the honest shape: a greyed box says "you may edit this once something
   * else is true", and in direct mode Width and Length are not fields that are
   * temporarily unavailable — they are not part of the question being asked.
   *
   * `entryKey` IS CLOSED OVER RATHER THAN READ OFF THE ROW, because a
   * `ManualSizeRow` does not know which entry it belongs to. The columns are
   * therefore built per entry; that is cheap (one entry's sizes) and it is
   * what keeps `ManualSizeRow` a pure measurement record instead of carrying a
   * parent pointer the state already expresses.
   */
  const sizeColumns = (e: ManualEntryRow): ChildGridColumn<ManualDisplayRow>[] => {
    const mode = calcModeOf(e.calc_mode);
    const gsm = gsmForStructure(e.structure_id);
    /**
     * A KEYSTROKE, WRITTEN TO ONE SIZE OR TO ALL OF THEM (0523).
     *
     * With "Size Wise" off the grid shows a single row and the planner is
     * answering for the whole size run, so the figure is written to EVERY size —
     * which is what keeps the toggle a property of the QUESTION and not of the
     * stored data. Every size still ends up with its own row carrying its own
     * figure, identical to what five keystrokes would have produced, so nothing
     * downstream has to know the toggle exists.
     *
     * `setSizeCell` IS FUNCTIONAL, so the fan-out composes: each call maps over
     * the entries and materialises the row it addresses, and React applies them
     * in order. Writing one merged patch instead would need this to know how
     * `setSizeCell` materialises a row that has never been typed into. */
    const set = (r: ManualDisplayRow, patch: Partial<ManualSizeRow>) => {
      if (e.size_wise) return setSizeCell(e.key, r, patch);
      for (const row of manualSizeRows(e)) setSizeCell(e.key, row, patch);
    };

    /** This row as the arithmetic wants it, built once per cell rather than
     *  four times. */
    const inputOf = (r: ManualDisplayRow): ManualSizeInput => ({
      size_id: r.size_id,
      dia: numOrNull(r.dia),
      purchase_width: numOrNull(r.purchase_width),
      grams: numOrNull(r.grams),
      table_width: numOrNull(r.table_width),
      length: numOrNull(r.length),
      length_tolerance: numOrNull(r.length_tolerance),
      cons_qty: numOrNull(r.cons_qty),
    });

    /**
     * ALWAYS VISIBLE, IN BOTH MODES — reversed 2026-09-03 (0524), on the
     * operator's explicit instruction after being shown the running Direct-mode
     * screen and confirming they want legacy's full 11-column band on screen
     * regardless of mode. This overrides the client's own written words quoted
     * here until now: *"when the user toggles the system to Calculated mode,
     * the Piece Weight field is locked to read-only, and the following input
     * fields are revealed"* — Direct was gating these five columns out
     * entirely, not merely leaving them unlocked, on that quote's authority.
     * `mode` still decides whether Cons Wt is a typed field or a computed span
     * (below) — only these columns' VISIBILITY stopped depending on it.
     *
     * ORDER, LABELS AND THE TOLERANCE'S TARGET ALL REVERTED 2026-09-03 (0524),
     * hours after 0523 moved the allowance to the width. `effectiveLength` in
     * ./manual.ts carries the arithmetic's history; this array's SEQUENCE AND
     * WORDING are legacy's own `Width | Length | Length Tolerance | Length |
     * Calculated Wt` band, field for field and label for label (operator
     * instruction, 2026-09-03 19:58 screenshot: same labels, same order,
     * verbatim) — "Length Tolerance" sits beside Length here, not beside
     * Width, because that is what it now modifies, and the derived cell after
     * it is headed "Length" again rather than "Calc. length", matching
     * legacy's own repeat. `Calc. width (in)` is dropped: it existed only
     * because 0523 needed an inches reading on the WIDTH, and legacy's band
     * has no inches column at all.
     */
    const measured: ChildGridColumn<ManualDisplayRow>[] = [
      {
        /* THE PANEL WIDTH — the spec's "Width (cm): the physical width of the
           pattern block", stored as `table_width`. Distinct from the `Dia`
           column, which is the ROLL's diameter and a constraint: the panels must
           fit across it. One word for both is how a reader multiplies by 60
           where 55 was meant. PLAIN, with no tolerance and no derived cell of
           its own — the allowance is on the length now, not here. */
        header: "Width",
        width: "4.5rem",
        align: "right",
        cell: (r) => (
          <Input
            className="h-8 text-right"
            inputMode="decimal"
            aria-label="Width (cm)"
            value={r.table_width}
            onChange={(ev) => set(r, { table_width: ev.target.value })}
          />
        ),
      },
      {
        /* The pattern length, in centimetres. */
        header: "Length",
        width: "4.5rem",
        align: "right",
        cell: (r) => (
          <Input
            className="h-8 text-right"
            inputMode="decimal"
            aria-label="Length (cm)"
            value={r.length}
            onChange={(ev) => set(r, { length: ev.target.value })}
          />
        ),
      },
      {
        /* THE ALLOWANCE, ON THE LENGTH (0524, reverting 0523's few hours on the
           width) — see `effectiveLength` for the full history. LABEL IS
           LEGACY'S OWN "Length Tolerance", verbatim (operator instruction,
           2026-09-03) — it was abbreviated to "Tol." before; the field is
           unchanged, only the printed word. */
        header: "Length Tolerance",
        width: "5rem",
        align: "right",
        cell: (r) => (
          <Input
            className="h-8 text-right"
            inputMode="decimal"
            aria-label="Length tolerance (cm)"
            value={r.length_tolerance}
            onChange={(ev) => set(r, { length_tolerance: ev.target.value })}
          />
        ),
      },
      {
        /* Length + Tolerance, derived — the figure the weight actually
           multiplies. Text rather than a readOnly box: a derived value was not
           typed, so it is not a field. LEGACY REPEATS "Length" FOR THIS SAME
           CELL, and the header below is now that same literal word (operator
           instruction, 2026-09-03) — this was "Calc. length" before, renamed
           distinctly so the two headers would not match; the operator's
           instruction is to keep them matching, as legacy does. */
        header: "Length",
        width: "4.5rem",
        align: "right",
        cell: (r) => {
          const l = effectiveLength(numOrNull(r.length), numOrNull(r.length_tolerance));
          return <span className="tabular-nums text-sm">{l == null ? "—" : fmtNumber(l)}</span>;
        },
      },
      {
        /* THE FORMULA'S OUTPUT, shown beside the inputs that produced it —
           legacy's own "Calculated Wt" column. `Cons Wt` two along holds the
           same figure in this mode; that is legacy's shape and not a
           duplication to tidy away, because the two mean different things: this
           is what the formula says, and that is what the document uses. */
        header: "Calculated Wt",
        width: "5rem",
        align: "right",
        cell: (r) => {
          const g = calculatedGrams(inputOf(r), gsm);
          /* A DASH, NEVER 0.000, when the GSM or a measurement is missing. The
             order supplies the GSM and `gsmForStructure` abstains where its
             colourways disagree, so a zero here would read as "this size needs
             no cloth" in the column everything downstream multiplies. */
          return <span className="tabular-nums text-sm">{g == null ? "—" : fmtNumber(g)}</span>;
        },
      },
    ];

    return [
      {
        header: "Size",
        width: "4.5rem",
        cell: (r) => (
          <Truncated>
            {/* "ALL SIZES" WHILE THE TOGGLE IS OFF. The row shown is a real size
                row — the first one — but it is standing for every size, and
                printing "S" over a figure that covers the whole run is the one
                thing that would make the toggle read as a filter. */}
            {!e.size_wise ? (
              "All sizes"
            ) : (
              <>
                {/* TAGGED WHEN THE ORDER NO LONGER STATES IT — the same wording
                    shape as the dia's "not declared". A value the record already
                    holds always survives, and reads as the exception it is
                    rather than being silently dropped. */}
                {r.label}
                {r.declared ? "" : "  (not on the order)"}
              </>
            )}
          </Truncated>
        ),
      },
      {
        /* PICKS FROM THE DIAS THIS BOM DECLARES (0490), and prepopulated from
           them where exactly one is declared — the client's own instruction,
           "they should automatically prepopulate the Dia field here but remain
           editable". A Combobox, so typed text is a SEARCH and never a stored
           value; `diaOptionsFor` keeps a held value visible and tagged.
           HEADER TEXT IS LEGACY'S OWN "TableWidth" (2026-09-03 19:58 screenshot,
           operator instruction: same label, same position, verbatim) — the
           field is still `dia`, unrenamed; only the printed word changed. */
        header: "TableWidth",
        width: "5.5rem",
        cell: (r) => (
          <Combobox
            compact
            inputClassName="h-8"
            options={diaOptionsFor(r.dia)}
            value={r.dia}
            onChange={(v) => set(r, { dia: v })}
            clearable
          />
        ),
      },
      ...measured,
      {
        /**
         * "Cons Qty" — UNITS OF CLOTH PER GARMENT, AND A FIELD SINCE 0523.
         *
         * The client's spec: *"the physical length or unit quantity of fabric
         * consumed per single garment piece (e.g. 1.25 metres per t-shirt) …
         * the field is fully editable and acts as a manual override"*, and
         * `Net Weight = Order Quantity x Cons Qty x Cons Wt`.
         *
         * IT USED TO BE THIS COLUMN'S HEADING OVER SOMETHING ELSE ENTIRELY —
         * `netKg(orderQty, grams)`, a weight in kilograms — so the multiplier
         * the formula names had nowhere to be typed and the column that
         * appeared to hold it held an output.
         *
         * NOT `required`, because BLANK MEANS 1 (`consQtyOf`) and one panel set
         * per garment is the ordinary case. A star here would hold the cursor on
         * a cell whose empty state is already the right answer.
         */
        header: "Cons Qty",
        width: "4.5rem",
        align: "right",
        cell: (r) => (
          <Input
            className="h-8 text-right"
            inputMode="decimal"
            aria-label="Cons Qty"
            value={r.cons_qty}
            onChange={(ev) => set(r, { cons_qty: ev.target.value })}
          />
        ),
      },
      {
        /**
         * "Cons Wt" — THE PIECE WEIGHT IN GRAMS, typed in Direct and locked in
         * Calculated (client 2026-09-03: *"the field remains fully unlocked for
         * direct keyboard input, allowing the user to type the physical piece
         * weight directly from the offline CAD report"*, and *"if the user
         * toggles the mode to Calculated, the system locks the Cons Wt field and
         * dynamically computes the piece weight"*).
         *
         * IT WAS DERIVED IN BOTH MODES until 0523 — it printed
         * `grossKg(netKg(...))`, the order's whole gross weight — so the one
         * figure the CAD room actually supplies had no cell, and the column
         * named after it showed a total instead. The typed value is not a
         * fallback for when the formula cannot run: Direct is the mode used
         * 99.9% of the time, and the formula is the estimate offered when nobody
         * has a CAD figure.
         *
         * REQUIRED IN DIRECT MODE ONLY, because that is the only mode in which
         * it is a field. In calculated mode the measurements are what the star
         * belongs on — and a star over a derived cell would hold the cursor on a
         * box nothing can be typed into (AGENTS.md: a readOnly field never
         * holds, "which is why a composed name requires its SOURCES instead").
         */
        header: "Cons Wt",
        width: "5rem",
        align: "right",
        required: mode === "direct",
        cell: (r) =>
          mode === "direct" ? (
            <Input
              className="h-8 text-right"
              required
              inputMode="decimal"
              aria-label="Cons Wt (grams)"
              value={r.grams}
              onChange={(ev) => set(r, { grams: ev.target.value })}
            />
          ) : (
            (() => {
              const g = calculatedGrams(inputOf(r), gsm);
              return (
                <span className="tabular-nums text-sm">{g == null ? "—" : fmtNumber(g)}</span>
              );
            })()
          ),
      },
      {
        /* LEGACY'S [Click] AT THE END OF THIS SAME ROW (2026-09-03 19:58
           screenshot), and the same unanswered destination the Components tab's
           own "Conv. Item" already carries — "a [Click] into a screen no
           transcript describes" (0495). SAME TREATMENT AS "Assort Color" /
           "Widths" three columns up on the fabric row above: disabled, with the
           reason on a wrapping span rather than the button, because a disabled
           control eats pointer events and a `title` on it directly is
           unreachable. Never invent the sheet behind it — that is the failure
           this tab already recorded once ("a screenshot cannot show a grain",
           0491).

           THIS IS THE LAST COLUMN OF THE GRID, and legacy's own (operator
           instruction, 2026-09-03: same 11 columns, same order, same labels,
           verbatim, nothing else on screen). `Purch. width` / `Order qty` /
           `Net Wt` / `Req. Wt` briefly trailed after it as this screen's own
           additions and were removed the same day, on the same instruction —
           see the comment below this array for where their figures still
           live. */
        header: "Conv. Item",
        width: "4.5rem",
        align: "center",
        cell: () => (
          <span
            className="block"
            title="Legacy opens a sub-detail here. It is not built yet — send that screen and it will be."
          >
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 w-full"
              disabled
              aria-label="Conv. Item — not built yet"
            >
              Click
            </Button>
          </span>
        ),
      },
    ];
    /* PURCH. WIDTH / ORDER QTY / NET WT / REQ. WT WERE HERE, TRAILING AFTER
       Conv. Item — this screen's own additions beyond legacy's 11-column band.
       Removed from the grid 2026-09-03 on the operator's explicit instruction.
       The underlying figures are not lost: `purchase_width` is still stored
       (still a field on `ManualSizeInput`/`FabricBomManualSize`, just not
       shown here), and Net/Required weight are computed independently for the
       actual purchase requirement by `fabricRequirementRows` in
       `requirement.ts`, which this screen never fed — see this file's own
       header comment, "THIS MODULE DOES NOT MULTIPLY THE ORDER". */
  };

  /**
   * The first thing one style's entries cannot answer, in the words the rail's
   * dot and the dead Save already use.
   *
   * IT REPLACES THE SHEET'S `SubSheetFooter`, which refused Done while any of
   * this style's entries was unanswered and said why. Losing the overlay must
   * not lose the PROXIMITY that footer bought — "the objection belongs beside
   * the thing being objected to, not two tabs away at Save". It is advisory
   * here rather than a refusal, because there is no longer a door to hold shut:
   * Save is still the gate, through `manualBlockers`, which calls this same
   * `manualProblem`.
   */
  const styleRefusal = (ref: string): string | null =>
    entriesForStyle(ref)
      .map((e) =>
        manualProblem(
          entryLike(e),
          orderSizesFor(e.style_ref_no),
          gsmForStructure(e.structure_id),
        ),
      )
      .find((x) => x !== null)?.refused ?? null;

  /**
   * ONE STYLE'S DETAIL PANE — legacy's second and third levels (screenshot
   * 2650), and what used to be a Sheet.
   *
   * THE REQUIRED SCOPE IS THE ONE THING THIS MOVE HAD TO GET RIGHT. `ChildGrid`
   * wraps every CELL in a `RequiredScope`, and that scope follows the RENDER
   * tree — which is exactly why this content used to live behind a `Sheet`,
   * whose portal resets it (the New Yarn / Purity defect, 2026-08-06). Two
   * independent things make it safe here: `renderMobileRow` is called INSTEAD
   * of the `columns.map()` that wraps cells, so no cell scope stands above it
   * at all; and the style grid declares `columns={[]}`, so there is no
   * `required` column one could have carried.
   */
  /**
   * THE FABRICS THE MANUAL TAB OFFERS — THIS BOM'S OWN FABRIC LINES.
   *
   * ## THE CLIENT ASKED FOR BOTH READINGS AND HAS NOW SETTLED IT
   *
   * On 2026-09-03 they said *"that fabric field needs to be one search with
   * global understanding — whatever the user searches it should understand,
   * needs to fetch the right fabric"* and, an hour later, *"it will list the
   * previous tab give fabrics"*. Those pull opposite ways and this cell was
   * built on the first, reasoning that the master CONTAINS everything the
   * second names. Shown the result — a picker offering nine cloths on a BOM
   * with no fabric lines — they were explicit (screenshot 2670): *"this manual
   * tab fabric field fetch from the fabric master but it should get from fabric
   * lines tab"*. The later instruction wins.
   *
   * IT IS ALSO THE RULE THE DOCUMENT NEEDS. A Manual entry states the weight of
   * a cloth THIS BOM CUTS: `entryFabric` (actions.ts) attributes that weight to
   * a fabric line, and the yarn split divides it across that fabric's
   * composition. A cloth with no line behind it is a weight with nothing to
   * attribute it to — the requirement engine would refuse it on save, which is
   * a worse way to learn than not being offered it.
   *
   * SEARCH IS NOT WHAT NARROWS — the picker still matches on every word the
   * operator types, over whatever it is given. Scoping the CANDIDATES and
   * understanding the QUERY are independent, so the first instruction survives
   * this change intact.
   *
   * ## WHY `bomFabricOptions`' TWO OBJECTIONS DO NOT APPLY HERE
   *
   * That list was deleted on 2026-09-02 (see the note where it stood) for two
   * reasons, and only one of them was ever about this tab:
   *
   *  - **Self-reference.** On COMPONENTS it was fatal: the only way a cloth
   *    entered the list was being picked, and the only control that picked it
   *    read from the list. Here there is no such loop — this picker sets
   *    `entry.item_id`, never a LINE's, and the lines are named on Fabric Lines
   *    and Components. Nothing this cell does can add to its own options.
   *  - **Empty on a seeded BOM.** That one is REAL and is live right now: the
   *    order in screenshot 2670 has 0 fabric lines, so this list is empty on it.
   *    It is answered rather than dodged — the picker carries an `emptyHint`
   *    naming the tab that fills it. Empty-and-explain, never a silent fallback
   *    to the master: a fallback would make the scoping advisory and the
   *    operator would never learn which tab actually owns the answer.
   *
   * NOT NARROWED BY STRUCTURE, which is unchanged and is the difference between
   * this cell and the Fabric Lines one. There a row states its Structure first
   * and the cloth is chosen under it; here the cloth is the FIRST thing chosen
   * and the structure is derived from it (0522). A structure narrowing would
   * need a parent this row does not have.
   */
  const manualFabricOptions = (held: string | null) => {
    /* THE MASTER ROWS, FILTERED BY THE LINES — not rows rebuilt from the lines.
       `setEntryFabric` reads `category_id` off the row it is handed and
       `entryUnitName` reads `base_uom_id`, so the option has to be the whole
       master row; a `{id, name}` shaped from a line would set the structure to
       null and blank the MeasurementUnit cell. */
    const named = new Set(lines.map((l) => l.item_id).filter(Boolean));
    const scoped = fabrics.filter((f) => named.has(f.id));
    if (!held || scoped.some((f) => f.id === held)) return scoped;
    /* THE HELD CLOTH ALWAYS SURVIVES — AGENTS.md, "Disabled rows", and it
       matters MORE now than under the master: a planner who names a cloth here
       and then removes its line on Fabric Lines would otherwise watch this cell
       empty itself, and the next Save would write that emptiness over a real FK.
       Re-admitted AFTER the filter, so one row keeping its value never widens
       the list for any other. */
    const row = fabrics.find((f) => f.id === held);
    return row ? [...scoped, row] : scoped;
  };

  /** The entry's cloth, resolved once. Null while none is named. */
  const entryFabricRow = (e: ManualEntryRow) =>
    e.item_id ? (fabrics.find((f) => f.id === e.item_id) ?? null) : null;

  /**
   * PICKING THE CLOTH WRITES THE STRUCTURE WITH IT (0522).
   *
   * `items.category_id` IS the structure (0405 · 0415 · 0426), so the two are
   * one fact and are set in one call — the server re-derives it on save, and
   * this keeps the screen's own GSM and size lookups right in the meantime.
   * Clearing the cloth clears the structure, or the entry would keep planning
   * against a structure nothing on the row names.
   */
  const setEntryFabric = (e: ManualEntryRow, id: string | null) =>
    setEntryCell(e.key, {
      item_id: id,
      structure_id: id ? (fabrics.find((f) => f.id === id)?.category_id ?? null) : null,
    });

  /** Legacy's first "Type" column — the knit family, off the order's declared
   *  dias. Prefers what the entry's own sizes say (`diaTypeOf`) and falls back
   *  to the order's declaration; abstains where either disagrees, because
   *  naming one of two knit types is a guess about the other. */
  const entryKnitType = (e: ManualEntryRow): string => {
    const fromSizes = diaTypeOf(e);
    if (fromSizes) return fromSizes;
    const kinds = new Set((dias ?? []).map((d) => d.knit_type).filter(Boolean));
    return kinds.size === 1
      ? (KNIT_TYPE_OPTIONS.find((o) => o.value === [...kinds][0])?.label ?? "")
      : "";
  };

  /** Legacy's "MeasurementUnit" — the cloth's own base unit, which is what the
   *  requirement is measured in. The server's `entryFabric` reads the same
   *  column, so the cell and the stored row cannot disagree. */
  const entryUnitName = (e: ManualEntryRow): string => {
    const id = entryFabricRow(e)?.base_uom_id ?? null;
    return (id ? data.uoms.find((u) => u.id === id)?.name : "") ?? "";
  };

  /**
   * LEGACY'S MANUAL FABRIC ROW, COLUMN FOR COLUMN (client 2026-09-03,
   * screenshots 2666 · 2667, on being shown the card version: "did you get my
   * point? no, it's totally wrong, update it"):
   *
   *     S No | Fabric | Type | Gsm | Type | Calculated | MeasurementUnit
   *          | Assort Color wise | EndBit Loss % | Component Proc. Loss %
   *          | Components | Assort Color | Widths
   *
   * WHAT THIS REPLACED was a card of seven fields led by *Fabric structure*, and
   * only one of the two things wrong with it was layout. Legacy's row has no
   * Structure column at all: it names the CLOTH, and the knit type, the GSM and
   * the measurement unit beside it are all read off that cloth. That is the
   * grain 0522 moved the entry onto, and this array is what it was moved for.
   *
   * TWO COLUMNS ARE BOTH HEADED "Type", WHICH IS LEGACY'S DOING AND IS KEPT.
   * The first is the knit family (Circular), the second the roll form
   * (OpenWidth); legacy separates them with Gsm and so does this. Renaming one
   * would be `check:nav-paths`' complaint one layer down — the operator reads
   * the word they have read for years, and a "clearer" word is one more thing
   * that does not match the screen they are migrating from. `cardLabel` is what
   * disambiguates them in the stacked layout, where two identical labels would
   * be meaningless.
   *
   * A THIRD "Type" TRAILS AFTER `Widths`, outside this verified band — Solid /
   * Melange / Yarn Dyed, added 2026-09-03 on operator instruction. It is not
   * legacy's own (the screenshots above name only the two), so it is kept out
   * of the sequence those screenshots verified rather than inserted between
   * them; see the comment on that column for the full reasoning.
   *
   * THE WIDTH BUDGET IS WHY THE TABLE RENDERS AT ALL: 65.5rem of columns plus
   * ~72px of chrome is about 1120px, under the 1152 this grid switches at. A
   * single-style order's pane is ~1293 CSS px — and that is every live order,
   * all seven of which declare one style. The trailing Type column adds to
   * that budget; `check:grid-budget` is what proves it still fits.
   */
  /** Legacy's row needs a CENTRED column (the checkbox and the three [Click]
   *  cells) and `FoldListColumn` offers only left/right — that list's cells are
   *  read-only text, where centring never comes up. A local shape rather than
   *  widening a type two other screens read. */
  type ManualEntryColumn = {
    header: string;
    /** What the stacked layout calls this cell where `header` is not enough —
     *  legacy heads two columns "Type". */
    cardLabel?: string;
    width?: string;
    align?: "left" | "right" | "center";
    cell: (row: ManualEntryRow, index: number) => ReactNode;
  };

  const manualEntryColumns: ManualEntryColumn[] = [
    {
      header: "Fabric",
      width: "9rem",
      cell: (e) => (
        <RecordPicker
          label="Fabric"
          compact
          required
          /* THIS BOM'S OWN FABRIC LINES — see `manualFabricOptions`. Still not
             scoped by a structure the row no longer names. */
          items={manualFabricOptions(e.item_id)}
          value={e.item_id}
          onChange={(id) => setEntryFabric(e, id)}
          /* EMPTY-AND-EXPLAIN, and this list is legitimately empty on a BOM
             whose lines name no cloth yet — which is every freshly seeded one
             (screenshot 2670 shows exactly that state). A bare "— Select —"
             over nothing reads as a broken dropdown and teaches the planner
             nothing; naming the tab that fills it is the whole difference.
             Same call the Yarn Process picker makes for an unflagged process
             master (AGENTS.md, nominated vendors). */
          emptyHint="No fabric on this BOM yet — name one on Fabric Lines first, and it appears here"
        />
      ),
    },
    {
      header: "Type",
      cardLabel: "Knit type",
      width: "4.5rem",
      /* DERIVED AND READ-ONLY. Plain text rather than a `readOnly` box: a
         derived value was not typed, so it is not a field — the same call the
         Eff. len and Cons Wt cells make one level down. */
      cell: (e) => <ClothText value={entryKnitType(e)} />,
    },
    {
      header: "Gsm",
      width: "4rem",
      align: "right",
      /* THE ORDER'S, abstaining where its colourways disagree. `gsmForStructure`
         is the same function the Save gate and the server's own lookup read, and
         it answers for the structure this row's CLOTH belongs to. */
      cell: (e) => {
        const g = gsmForStructure(e.structure_id);
        return <ClothText value={g == null ? "" : String(g)} />;
      },
    },
    {
      header: "Type",
      cardLabel: "Roll form",
      width: "6rem",
      cell: (e) => (
        <Select
          compact
          aria-label="Roll form"
          value={e.width_form}
          onChange={(ev) => setEntryCell(e.key, { width_form: ev.target.value })}
        >
          {/* BLANK IS A REAL STATE here, unlike the mode beside it: the column is
              nullable because an entry may not have been told yet whether the
              cloth is slit. */}
          <option value="" />
          {WIDTH_FORM_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      ),
    },
    {
      header: "Calculated",
      width: "6rem",
      cell: (e) => (
        <Select
          compact
          aria-label="Weight mode"
          value={calcModeOf(e.calc_mode)}
          onChange={(ev) => setEntryCell(e.key, { calc_mode: ev.target.value })}
        >
          {/* NO BLANK. The column is NOT NULL with a default and the planner is
              always doing one or the other; an empty entry would offer a state
              the database cannot hold. */}
          {CALC_MODE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      ),
    },
    {
      header: "MeasurementUnit",
      width: "4rem",
      /* THE CLOTH'S OWN BASE UNIT, which is the unit the requirement is stored
         in — `entryFabric` on the server reads the same column. Blank until a
         fabric is named, which is what legacy's own screenshot shows. */
      cell: (e) => <ClothText value={entryUnitName(e)} />,
    },
    {
      header: "Assort Color wise",
      width: "4.5rem",
      align: "center",
      cell: (e) => (
        <input
          type="checkbox"
          className="h-4 w-4 accent-primary"
          aria-label="Assort Color wise"
          checked={e.assort_color_wise}
          onChange={(ev) =>
            setEntryCell(e.key, { assort_color_wise: ev.target.checked })
          }
        />
      ),
    },
    {
      /**
       * LEGACY'S "SIZE WISE" TOGGLE (client 2026-09-03: *"if the Size Wise
       * toggle is unchecked, the system applies a single, flat consumption
       * quantity across all sizes; if checked, the grid expands to display
       * size-specific rows"*).
       *
       * ON BY DEFAULT, which is what this tab has always done. Off is the
       * convenience — one figure typed once — and never the default: a planner
       * holding per-size CAD figures must not have to switch something on to
       * enter them.
       *
       * IT CHANGES WHAT IS ASKED, NEVER WHAT IS STORED. Unchecked, the grid
       * shows one row and every keystroke is written to EVERY size (see `set` in
       * `sizeColumns`), so the stored rows are identical to what the planner
       * would have typed five times. That is why this is a boolean on the entry
       * rather than a nullable `size_id` on the size table: a second storage
       * shape would need every downstream reader to learn about it.
       */
      header: "Size Wise",
      width: "4rem",
      align: "center",
      cell: (e) => (
        <input
          type="checkbox"
          className="h-4 w-4 accent-primary"
          aria-label="Size Wise"
          checked={e.size_wise}
          onChange={(ev) => setEntryCell(e.key, { size_wise: ev.target.checked })}
        />
      ),
    },
    {
      header: "EndBit Loss %",
      width: "5rem",
      align: "right",
      cell: (e) => (
        <Input
          className="text-right"
          inputMode="decimal"
          aria-label="EndBit Loss %"
          value={e.endbit_loss_pct}
          onChange={(ev) => setEntryCell(e.key, { endbit_loss_pct: ev.target.value })}
        />
      ),
    },
    {
      header: "Component Proc. Loss %",
      width: "4.5rem",
      align: "right",
      /* `wastage_pct` UNDER LEGACY'S NAME. 0494 called it "Wastage / Damage %"
         from the client's written spec; legacy's own header for the same cell —
         the one that multiplies Net into Gross — is this. The column keeps its
         name in the schema, where every reader already knows it. */
      cell: (e) => (
        <Input
          className="text-right"
          inputMode="decimal"
          aria-label="Component Proc. Loss %"
          value={e.wastage_pct}
          onChange={(ev) => setEntryCell(e.key, { wastage_pct: ev.target.value })}
        />
      ),
    },
    {
      header: "Components",
      width: "4.5rem",
      align: "center",
      /* LEGACY'S [Click], opening the panel list this weight covers. The COUNT
         rides on it because a cell reading only "Click" says nothing about
         whether it has been answered — the one fact the old `[Fabrics 2/3]`
         button carried, kept where it still earns its place. */
      cell: (e) => (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 w-full"
          /* Captures the button's own rect so the sheet scales out of THIS
             button — `currentTarget`, not `target`: the click can land on the
             text node inside it. Same call `garment-order-screen.tsx` makes
             for Style ▸ Process. */
          onClick={(ev) => {
            setComponentsOrigin(ev.currentTarget.getBoundingClientRect());
            setComponentsFor(e.key);
          }}
        >
          {e.component_ids.length ? String(e.component_ids.length) : "Click"}
        </Button>
      ),
    },
    {
      header: "Assort Color",
      width: "4.5rem",
      align: "center",
      /* DECLARED AND NOT YET BUILT, and it says so where the operator is
         standing rather than doing nothing when clicked. Legacy opens a
         sub-detail here that has not been shown to me, and inventing its
         contents is the failure this tab has already recorded once — "a
         screenshot cannot show a grain" (0491).

         THE REASON HANGS ON A WRAPPING SPAN, never on the button. A browser
         dispatches no pointer events to a disabled control, so a `title` there
         is unreachable in precisely the state it was written for — the defect
         the [Detail] button on Fabric Lines already paid for (2026-09-02). */
      cell: () => (
        <span
          className="block"
          title="Legacy opens a sub-detail here. It is not built yet — send that screen and it will be."
        >
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 w-full"
            disabled
            aria-label="Assort Color — not built yet"
          >
            Click
          </Button>
        </span>
      ),
    },
    {
      /* LEGACY'S [Click] ▸ "Width Details" (screenshot 2681) — LIVE now
         (0525), the same shape Components' button already has: a Sheet with
         its own per-size grid, opened by entry key. */
      header: "Widths",
      width: "4.5rem",
      align: "center",
      cell: (e) => (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 w-full"
          onClick={(ev) => {
            setWidthsOrigin(ev.currentTarget.getBoundingClientRect());
            setWidthsFor(e.key);
          }}
        >
          Click
        </Button>
      ),
    },
    {
      /* A THIRD "Type" — SOLID · MELANGE · YARN DYED, off the fabric itself
         (`fabricTypeOf`, the ONE derivation this file already reads five other
         places: the Fabric Lines grid, the Save gate, `problems`, the yarn-dyed
         mandatory check). NOT legacy's own row (screenshots 2666 · 2667 name
         only the two "Type" columns above — knit family and roll form), so it
         TRAILS after Widths rather than sitting between them, the same
         treatment the trailing Purch. width / Order qty / Net Wt / Req. Wt
         columns got on the size grid below: this screen's own addition, added
         2026-09-03 on operator instruction, kept out of legacy's verified
         sequence.

         `cardLabel` DISAMBIGUATES IT FROM THE OTHER TWO in the stacked mobile
         layout, the same way "Knit type" and "Roll form" already do — three
         columns headed bare "Type" would be three identical labels stacked on
         top of each other there. */
      header: "Type",
      cardLabel: "Fabric type",
      /* NARROWER THAN THE OTHER TWO "Type" COLUMNS ON PURPOSE — this trails
         outside legacy's verified band and the width budget has no slack left
         for a fourth full-width column (`check:grid-budget`). `Truncated`
         handles it: "Solid"/"Melange" fit as typed, "Yarn Dyed" clips to an
         ellipsis with the full word on hover/hold — the reveal is the point of
         that primitive, not a workaround. */
      width: "2rem",
      cell: (e) => <ClothText value={fabricTypeOf(e.item_id)} />,
    },
  ];

  /** The entry whose Components sheet is open, resolved from the key. Null when
   *  the key names a row a later edit removed — the sheet then closes itself
   *  rather than rendering against nothing. */
  const componentsForEntry = componentsFor
    ? (entries.find((e) => e.key === componentsFor) ?? null)
    : null;

  /** The entry whose Widths sheet is open — same resolution as
   *  `componentsForEntry` above, same reason. */
  const widthsForEntry = widthsFor ? (entries.find((e) => e.key === widthsFor) ?? null) : null;

  /**
   * MANUAL ENTRY FIELD SIZES, THE SAME SHAPE `FIELD_SIZES` GIVES THE
   * COMPONENTS TAB'S RAIL (client 2026-09-03, approved from an artifact:
   * "same like material bom tab layout, size, color everything ...
   * customized it first plan with artifact then can implement it").
   *
   * FABRIC ALONE TAKES `md`: it is the row's one `RecordPicker`, and a
   * fabric's own name is the longest value on the row. The other thirteen
   * are a Select, two checkboxes, three derived `ClothText` cells and three
   * `[Click]` buttons — none of them needs more than `xs` (2/32) to read.
   * 4 + 13x2 = 30 of the 32 columns `FieldGrid` divides the compact row
   * into, the same one-row shape the artifact confirmed ("row 1, row 2 as
   * single row compacted").
   */
  const MANUAL_FIELD_SIZES: Record<string, FieldSize> = { Fabric: "md" };

  const manualStylePane = (styleRow: ManualStyleRow) => {
    const refusal = styleRefusal(styleRow.style_ref_no);
    const manualEntries = entriesForStyle(styleRow.style_ref_no);
    return (
      <div className="space-y-4">
        {/* LEVEL 1 — THE STYLE (client 2026-09-03: "first row like same
            components tab, style reference no, style no, article no").

            THE SAME COMPONENT THE COMPONENTS TAB DRAWS, not a copy of its
            markup — `StyleIdentityBand`. "Like the Components tab" is a
            statement two screens have to keep true, and a second copy of it is
            a thing a reader would have to verify by eye every time either one
            changed.

            THIS REINSTATES WHAT 09-03 REMOVED, deliberately and narrowly. The
            meta line that stood here was PROSE restating the order ("Style No …
            · Article … · Pcs · Colours: BLUE") and the client had it cut from
            every tab top. This is legacy's labelled band, asked for by name a
            few hours later. A sentence describing the screen and a record
            header naming three stored values are not the same thing. */}
        <StyleIdentityBand
          styleRefNo={styleRow.style_ref_no}
          identity={styleIdentityFor(styleRow.style_ref_no)}
        />

        {/* LEVEL 2 + LEVEL 3 — A MASTER-DETAIL PANE, THE COMPONENTS TAB'S OWN
            SHAPE (client 2026-09-03: "now we need to apply this rail ui
            layout for the manual tab customized it first plan with artifact
            then can implement it" — planned in an artifact, corrected twice
            ("the first two row show same single you updated its as two
            rows" -> a labelled divider; "row 1, row 2 as single row
            compacted" -> one row) and confirmed).

            ## WHY THE HAND-WRITTEN `<table>` COULD GO

            It used to say `ChildGrid` "has no row-detail slot in table
            mode", and that was true only of TABLE mode. `masterDetail`
            switches the grid to CARDS, where the open row's body is
            `renderMobileRow` — so the sizes hang under their fabric by being
            PART of that body, the same way Components' Colourways grid
            hangs under its panel. That is what lets the whole hand-rolled
            keyboard contract (`data-grid-body` + `gridKeyNav`,
            `data-grid-row`, `data-row-remove`, `data-row-add`, `Fragment`,
            the `onFocus`/`onClick` fold) go with it: `ChildGrid`'s own
            `mdListKeyNav` and its roving-tabindex rail already carry all of
            that, for free, the same as it does for every other
            `masterDetail` grid in this file.

            ## THE RAIL SHOWS ONLY AT TWO ENTRIES, NOT ONE

            EVERY OTHER `masterDetail` GRID HIDES ITS RAIL AT ONE ROW
            (`mdActive`, `child-grid.tsx`: "a list of one is not a list",
            client 2026-08-20) — Components and Material BOM both open on a
            single plain card, no rail, exactly one blank line. Manual asked
            for the opposite the same day this rail shipped (client
            2026-09-04, "not yet updated ui" on a single-fabric BOM — they
            wanted the rail's SHAPE visible from the first fabric, not only
            once a second one exists): `railAlways` is the opt-out, and it
            is this call site's alone — nothing else in the app passes it,
            so Components and Material BOM are exactly as they were. */}
        <ChildGrid<ManualEntryRow>
          /* grid-caption: exempt -- the style band above names this grid,
             and it is the only grid at this level. */
          columns={manualEntryColumns}
          rows={manualEntries}
          forceCards
          flatRows
          /* NEITHER `railWidthPx` NOR `railCompact` IS SET — Material BOM's
             OWN rail, not Components' (client 2026-09-04, on this exact
             screen: "button size and that rail bg etc are not samelike
             material bom i need it like so"). Components deliberately
             narrowed to 220px and tightened its padding for its own reasons
             (client 2026-09-03: "220px — a little narrower", "use compact
             that rail menu") — reasons that belong to Components' rail, not
             to every masterDetail grid. Leaving both unset falls through to
             `child-grid.tsx`'s own defaults (268px, `px-3 py-2`), which are
             Material BOM's figures — the one masterDetail grid never
             customises either prop. */
          /* LOAD-BEARING, THE SAME WAY IT IS ON COMPONENTS. Every column in
             `manualEntryColumns` declares a `width` — it was written for the
             `<table>` this replaces — so without `fill` the card would hug
             that declared width and the detail pane would collapse to it. */
          fill
          foldRows
          masterDetail
          railAlways
          /* THREE STATES, THE SAME READING `manualProblem` already gives the
             Save gate and `styleRefusal`: idle before a fabric is named,
             warn once one is named and `manualProblem` still finds something
             to ask for, ok once it returns null. One rule, read here instead
             of re-derived for the dot. */
          renderListItem={(e) => {
            const gsm = gsmForStructure(e.structure_id);
            const problem = e.item_id
              ? manualProblem(entryLike(e), orderSizesFor(e.style_ref_no), gsm)
              : null;
            const state = !e.item_id ? "idle" : problem === null ? "ok" : "warn";
            const subtitle = [entryKnitType(e), gsm != null ? `${fmtNumber(gsm)} GSM` : ""]
              .filter(Boolean)
              .join(" · ");
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
                  <Truncated className="block text-[12.5px] font-medium leading-tight text-foreground">
                    {entryFabricRow(e)?.name || "New fabric"}
                  </Truncated>
                  {subtitle && (
                    <Truncated className="block text-[10px] leading-tight text-muted-foreground">
                      {subtitle}
                    </Truncated>
                  )}
                </span>
              </div>
            );
          }}
          /* SAME CONTENT, THE FOLDED SHAPE — what a single-fabric style
             shows, required by `foldRows`. */
          renderFoldedRow={(e) => (
            <span className="text-sm font-medium">{entryFabricRow(e)?.name || "New fabric"}</span>
          )}
          /* THE DETAIL PANE, AND `renderMobileRow` IS THE ROW BODY BELOW
             `masterDetail`'s breakpoint TOO — one definition. */
          renderMobileRow={(e) => (
            <div className="space-y-3">
              {/* NO HEADING — the rail already names the fabric; a second
                 naming here is the same redundancy Components dropped its
                 own pane heading for. The spacer keeps the ✕ its `pr-9`
                 room. */}
              <div className="h-1 pr-9" />
              {/* ONE COMPACT ROW, cols={32} — the artifact's confirmed shape
                 ("row 1, row 2 as single row compacted"), sized by
                 `MANUAL_FIELD_SIZES` rather than a flat guess. */}
              <FieldGrid cols={32}>
                {manualEntryColumns.map((c, ci) => (
                  <Field
                    key={c.header + ci}
                    label={c.cardLabel ?? c.header}
                    size={MANUAL_FIELD_SIZES[c.header] ?? "xs"}
                  >
                    {c.cell(e, ci)}
                  </Field>
                ))}
              </FieldGrid>
              {/* LEVEL 3 — THE SIZES, still this fabric's own nested grid,
                 unchanged in content: only its container moved, from a
                 `<td colSpan>` spanning the whole pane to this card. */}
              <ChildGrid<ManualDisplayRow>
                /* grid-caption: exempt -- the fabric card above is the
                   caption; a second heading here would name the same thing
                   twice. */
                columns={sizeColumns(e)}
                /* ONE ROW WHEN "SIZE WISE" IS OFF — the planner answers once
                   for the whole run and `set` fans the figure out to every
                   size. The FIRST row is the one shown rather than a
                   synthetic "all sizes" row, so the cells it renders are
                   real stored cells and `setSizeCell` needs no second
                   addressing mode. */
                rows={e.size_wise ? manualSizeRows(e) : manualSizeRows(e).slice(0, 1)}
                /* The rows are the ORDER's sizes — no "+ Add", no ✕, and
                   `hideRemove` rather than `lockExisting` because they are
                   re-derived on every render. */
                hideAdd
                hideRemove
                onAdd={() => false}
                onRemove={() => {}}
                tableFrom="5xl"
                centerHeaders
                /* ONE COMPACT ROW HERE TOO, cols={32} — the same treatment
                   the fabric row above got (client 2026-09-04: "size to
                   conv item make it single [row], compact the field size").
                   Legacy's 10-field band (Size .. Conv. Item) is all short
                   numeric inputs, a Combobox and one disabled button, so
                   every field takes `xs` uniformly — nothing here is a name
                   long enough to need `MANUAL_FIELD_SIZES`'s wider span. */
                renderMobileRow={(row) => (
                  <FieldGrid cols={32}>
                    {sizeColumns(e).map((c, ci) => (
                      <Field key={ci} label={c.header} required={c.required} size="xs">
                        {c.cell(row, ci)}
                      </Field>
                    ))}
                  </FieldGrid>
                )}
              />
              {manualSizeRows(e).length === 0 && (
                <p className="mt-2 text-xs text-muted-foreground">
                  This style states no sizes yet — size quantities are entered on
                  Orders ▸ Order Management ▸ Order Entry, under Approval Qty.
                </p>
              )}
            </div>
          )}
          onAdd={() =>
            mutEntries((xs) => [...xs, blankManualEntry(newKey(), styleRow.style_ref_no)])
          }
          onRemove={(e) => mutEntries((xs) => xs.filter((x) => x.key !== e.key))}
          addLabel="+ Add fabric"
        />
        {/* SAID WHERE IT CAN BE ACTED ON — see `styleRefusal`. Amber, not red:
            the BOM is still saveable as a draft, and the sentence is a
            direction rather than a rejection. */}
        {refusal && <p className="text-xs text-warning">{refusal}</p>}
      </div>
    );
  };


  const lineColumns: ChildGridColumn<LineRow>[] = [

  /* THE ROW IS LEGACY'S FabricAllocation ROW, COLUMN FOR COLUMN (client
     2026-09-02, screenshots 2610 vs 2612 and the follow-up "Combo Component
     Colour Unit remove this field follow the legacy again also / add the mixing
     UOM").

     Legacy reads, verbatim:

         S No | Structure | GSM Range | Fabric | Type | Mixing Uom |
         No Of Colors | Style Ref No | Style No / Article No | Detail

     ALL OF THEM ARE NOW BUILT (client 2026-09-02, in three instructions across
     one afternoon: reorder, then "remove Combo/Component/Colour/Unit, follow the
     legacy again", then "add the mixing UOM", then "you missed the remaining
     field no of colors, style ref no, style no, style color, article no, the
     details button"). So this array is legacy's row, column for column:

         #  Structure  GSM Range  Fabric*  Type  Mixing Uom*  No Of Colors
         Style Ref No  Style No  Style Color  Article No  Detail

     THAT REVERSES THE 09-01 WRITTEN SPEC IN FULL, deliberately. That spec said
     "EXCLUDE (do not develop): Mixing · UOM · Number of Colors · Style Ref
     Number", and this file acted on it. All four are back on the client's own
     later instruction; a reader who finds the exclusion quoted in a comment or a
     memory is holding something this supersedes.

     FOUR OF THE FIVE RESTORED CELLS ARE DERIVED AND READ-ONLY — `No Of Colors`
     counts the fabric group's colourways, `Style No` / `Article No` come off the
     order through `styleIdentityFor`, and `Style Ref No` is written by the
     colourway rather than typed. Only `Style Color` accepts input, and it is the
     `Combo` cell restored under legacy's own header.

     THE FOUR THAT LEFT WERE MOVED, NOT DELETED — and that distinction is the
     whole change. `Combo`, `Component` and `Colour` are not FabricAllocation's
     fields at all; they are the sibling **Components** tab's (screenshot 2585),
     and our [Detail] button IS that tab. All three are edited there, so the
     client's "only legacy screen field" now holds in both directions: every
     field is on a legacy screen, and it is on the legacy screen it belongs to.
     `Unit` did not leave — it is `Mixing Uom`, same stored column.

     NOTHING WAS DROPPED FROM THE TABLE. `LineRow` still carries `combo`,
     `component_id`, `color_name` and every other column, and `mut` writes them
     through unread — a Save from this grid replaces the BOM's lines wholesale,
     so a value the grid stops carrying is a value the next Save destroys
     (AGENTS.md's Material Attribute orphans, and this file's own note on
     `sizes`).

     Reordering or trimming this array is a REAL change on both surfaces: the
     `renderMobileRow` below maps over `lineColumns` itself, so the table and the
     stacked cards read one list.

     THE WIDTH BUDGET IS NOW THE BINDING CONSTRAINT, and it is what re-tuned five
     cells that were not otherwise part of this change. Eleven columns must still
     sum to less than `tableFrom`'s 1152 including 72px of `#`/`✕` chrome, or the
     table appears at 1152 and immediately scrolls sideways — which
     `doc/ui/LAYOUT.md` rules out. They sum to 63rem = 1008px + 72 = 1080, with
     72px of headroom.

     `Fabric` PAID FOR IT: 18rem → 13rem. That partly walks back the 09-01
     widening, which was made because the master composes the yarn count and
     blend into the name and 5rem clipped it to ten characters. 13rem is 208px —
     wider than the ~215px legacy itself gives the column at this density, and
     `RecordPicker` carries `text-ellipsis` plus the hover/press reveal, so the
     full string stays reachable. Eleven columns of real content do not fit
     1080px any other way; the alternative was a row that scrolls. */

    {
      header: "Structure",
      /* 10rem — 160px (client 2026-09-03), up from 6.5rem/104px.
         "SINGLE JERSEY" is thirteen characters and did not fit 104px, so
         the cell the brief calls expanding was in fact the one clipping
         its own value. The 56px is paid for below — see THE WIDTH
         BUDGET on `tableFrom`. */
      width: "10rem",
            cell: (r) => (
        <RecordPicker
          label="Structure"
          compact
          /* ONLY WHAT THE ORDER DECLARES (client spec, 2026-09-01). Empty until
             an order is picked, which is the honest state: with no RE number
             there is no list to restrict to. Never falls back to the whole
             master — that silent fallback is what makes a restriction advisory,
             the failure the nominated-vendor rule records. */
          items={structureItemsFor(r.structure_id)}
          value={r.structure_id}
          onChange={(id) => setAlloc(r, { structure_id: id })}
        />
      ),
    },
    {
      /* LEGACY'S OWN COLUMN, BESIDE ITS OWN NEIGHBOUR (screenshot 2581:
         `Structure | GSM Range | Fabric | Type`). It describes the structure, so
         it sits against it.

         PLAIN TEXT, NOT A DISABLED `<Input>` — the same choice `paletteColumns`
         below already makes and for a sharper reason here: text is not focusable
         at all, so `isFieldLike` never sees it and Tab keeps landing only on
         cells a value can be typed into (AGENTS.md, "Tab lands on fields"). A
         readOnly Input would be skipped too (`tabIndex={-1}` since 2026-07-29)
         but draws a box that says otherwise.

         `<Truncated>` because the cell is 5rem and "175 - 185" is close to it:
         an ellipsis has to be a promise the rest is reachable. */
      header: "GSM Range",
      align: "right",
      width: "4.5rem",
      cell: (r) => <ClothText value={descriptorFor(r).gsm} />,
    },
    {
      header: "Fabric",
      required: true,
      /* THE ONE WIDE COLUMN AGAIN, and this reverses the 2026-08-18 equal-width
         instruction for this cell alone (client, 2026-09-01).

         THE REASON IS WHAT THE CELL NOW HAS TO SHOW. The spec asks the fabric
         dropdown to carry "the detailed technical names… including yarn counts
         and compositions", and the Material master ALREADY composes exactly
         that: `SOLID 1X1 LYCRA RIB (30'S COTTON COMBED 95%, 20'S ELASTANE 5%)
         100%`. Nothing had to be built for it — at 5rem it was simply clipped to
         about ten characters, so the yarn count and the blend, which are the
         whole point of this tab, were reachable only through the tooltip.

         THE WIDE ONE, AND IT STAYS DECLARED. The tempting fix for screenshot
         2595 was to declare NO width here: `hugsContent` is
         `columns.every((c) => c.width)`, so leaving one column out flips the
         table to `w-full` and this cell would absorb the pane at any size.

         THAT ALSO TURNS OFF `table-fixed`, WHICH IS THE WHOLE MECHANISM.
         `child-grid.tsx` says it in its own comment: under the default
         `table-layout: auto` a declared width is a SUGGESTION, and ten columns
         of pickers in a narrow container "were all squeezed together and every
         picker read `— S…`" (client 2026-08-11). Every cell on this row is an
         input or a picker, each with an intrinsic width of its own, so auto
         layout would be resolving the row from the controls rather than from
         these numbers. Filling the pane is not worth re-opening a bug that is
         already written down.

         SO THE ROW IS TUNED, AND THE BUDGET IS THE REASON FOR EACH FIGURE.
         66.5rem + 72px of `#`/`✕` chrome = 1136px, which must stay under
         `tableFrom`'s 1152 — over it, the table renders and immediately
         scrolls sideways, and a grid that scrolls sideways is what
         `doc/ui/LAYOUT.md` rules out. The operator's pane is ~1260 CSS px, so
         ~124px goes unused at the right; that is the price of the guarantee
         above and it is a better trade than a squeezed row.

         19rem HERE because this holds by far the longest value — the master
         composes `SOLID FLEECE (30'S COMBED COTTON 55%, 16'S COMPACT COTTON
         35%, 50 DINER POLYESTER 10%) 100%`, ~85 characters, and the yarn count
         and blend inside it are the whole point of this tab. It was 5rem when
         the row was fourteen columns wide, which is what made every fabric read
         as ten clipped characters. The other seven are sized to their real
         content (a colourway name, a structure name, `175 - 185`, `Yarn Dyed`,
         `KGS`) rather than to a uniform figure — the 2026-08-18 equal-width
         instruction was written for a row where nothing fitted, and every cell
         being equally unreadable was never the point of it. */
      /* 11rem — 176px, down from 13rem/208px, and it is STILL the widest
         column in the row (Structure is now 160). That is what keeps the
         09-01 instruction above true in substance: this cell already
         truncates and already reveals on hover (`<Truncated>`), so 32px
         costs a few characters before the ellipsis rather than a value
         nobody can read. See THE WIDTH BUDGET on `tableFrom`. */
      width: "11rem",
      cell: (r) => (
        <RecordPicker
          label="Fabric"
          compact
          required
          /* ONLY THIS ROW'S STRUCTURE (client 2026-09-02) — see `fabricItemsFor`
             for the narrowing, the held-value survival and why a row with no
             structure still sees everything. */
          items={fabricItemsFor(r)}
          /* AND WHERE THE STRUCTURE HAS NO CLOTH YET, SAY SO IN THE PANEL. A
             mandatory field narrowed to an empty list is otherwise a dead end
             that reads as a broken dropdown; the sentence names both the cause
             and the way out, which is the "+ Add" directly beneath it. */
          /* AND THE HINT MUST NAME EVERY NARROWING THAT EMPTIED THE LIST. With
             a Type stated, "no fabric under this structure" is a false
             explanation — there may be nine, none of them yarn dyed — and a
             wrong reason for an empty list is worse than none: it sends the
             operator to create a cloth that already exists. Same failure as the
             mis-scoped report AGENTS.md describes under Cascading filters,
             where an empty result reads as a real answer. */
          emptyHint={
            !r.structure_id
              ? null
              : rowType(r)
                ? `No ${rowType(r)} fabric is filed under this structure yet — clear the Type, or use + Add to create one.`
                : "No fabric is filed under this structure yet — use + Add to create one."
          }
          /* "+ Add" — THE CRUD HALF OF THE SAME INSTRUCTION. It opens the real
             mini-form (`FabricQuickCreateSheet`), never a name box: an `items`
             row with only a name is refused outright by `createMaterial`, which
             demands the type, the category, a base unit and then a yarn
             composition. That is exactly the case `onAddOverride` exists for —
             see the prop's own note on why RecordPicker otherwise offers no Add.

             OFFERED ONLY WHERE IT CAN SUCCEED: a structure to file the cloth
             under, the FABRIC class row to create it in, and the permission to
             create. Missing any of them, there is no Add affordance at all
             rather than one whose Save the server will refuse. */
          onAddOverride={
            perms.canCreate && r.structure_id && data.fabricCreate.fabricClassId
              ? (commit) => {
                  fabricAddCommit.current = commit;
                  setFabricAddFor(r.structure_id);
                }
              : undefined
          }
          value={r.item_id}
          /* PICKING THE CLOTH ANSWERS TWO OTHER CELLS (0513).

             `consumption_uom_id` — the unit the consumption figure is in — lost
             its own cell when Mixing Uom became the client's percent/cm ratio
             unit. It comes off the fabric master's `base_uom_id`, which is set on
             all 14 live fabrics (2026-09-02); the Save gate still refuses a line
             whose fabric has none, so a master gap is reported rather than
             guessed. Only filled when EMPTY: a unit the planner has already
             corrected by hand is not overwritten by changing the cloth.

             AND THE YARN CELLS ARE NO LONGER CLEARED — the whole reason to
             clear them is gone. That rule existed because the two cells used to
             WITHDRAW for a non-yarn-dyed cloth, which stranded a typed value
             where nobody could see or correct it. They are always live now
             (client 2026-09-03), so a mixing ratio that survives a change of
             cloth is on screen, next to the new fabric, and wrong in a way the
             planner can act on. Deleting a value the operator typed, in a cell
             they can still see, is the worse of the two.

             WRITTEN ON THE CHANGE, NEVER IN AN EFFECT — an effect also fires when
             a saved BOM is opened and would rewrite stored lines on load, which
             is the rule `styleForCombo` and `pickStyle` both state. */
          onChange={(id) => {
            const f = id ? fabrics.find((x) => x.id === id) : null;
            setAlloc(r, {
              item_id: id,
              ...(r.consumption_uom_id || !f?.base_uom_id
                ? {}
                : { consumption_uom_id: f.base_uom_id }),
            });
          }}
        />
      ),
    },
    {
      /**
       * SOLID / MELANGE, READ OFF THE FABRIC THE PLANNER PICKED — and this is
       * the THIRD source this one cell has had.
       *
       * 1. `fabric_type` on the LINE (Main vs Trims). Wrong question entirely;
       *    0408 warns the two words live on one table and mean different things.
       * 2. `item_sub_type` on the ORDER's combo structure. Right about the cloth
       *    and wrong about the LINE, which is what screenshot 2595 shows: a row
       *    naming `MELANGE SINGLE JERSEY` printed `—`.
       * 3. `items.fabric_type_id` — this one.
       *
       * THE CLIENT'S RULE IS WHAT DECIDES IT. "Structure stays, fabric changes":
       * a solid body and a melange sleeve are two lines of the SAME structure,
       * so any answer keyed on the structure gives both the same word and the
       * column stops distinguishing the thing it exists to distinguish. Keyed on
       * the fabric, the two lines differ because their fabrics do.
       *
       * READ-ONLY WHILE A FABRIC IS NAMED, AND A FILTER BEFORE THAT (client
       * 2026-09-03, "the type and uom and no of color field allow manual entry
       * too … why is only in read only mode").
       *
       * The read-only half is unchanged and keeps its reason: the fabric NAME
       * already says it (`MELANGE SINGLE JERSEY`), so an editable cell over a
       * named cloth could contradict the row's own Fabric cell with nothing to
       * arbitrate — and four other things read this word. Plain text, not a
       * disabled input, exactly as `GSM Range` above.
       *
       * WHAT WAS ACTUALLY WRONG IS THAT IT WAS DEAD WITH NOTHING TO DERIVE FROM.
       * A line starts with no fabric, so the first thing an operator meets is a
       * dash they cannot type into — the same "unknown drawn as a refusal" the
       * two mixing cells were reported for on the same screenshot. With no cloth
       * named there is no answer to contradict, so the cell takes the planner's
       * word and spends it on the one thing it can honestly do: NARROWING the
       * row's Fabric picker (`fabricItemsFor`). Naming a fabric ends the
       * question and the cloth answers.
       *
       * IT STORES NOTHING — see `typeFilter`. A per-line override column was the
       * alternative and was declined: it would let the line and the master
       * disagree, and the Yarn Dyed Details panels and the Yarn Process rows are
       * both built from the FABRIC's own `material_mixings`, so a typed word
       * over a melange cloth plans a repeat that does not exist.
       */
      header: "Type",
      /* 6rem, NOT THE 4.5 A READ-ONLY WORD NEEDED. "Yarn Dyed" plus a chevron
         does not fit 72px. The row is now 66.5rem = 1064 + 72px chrome = 1136,
         still under `tableFrom`'s 1152 — the same margin the 11-column layout
         was signed off at. Keep that inequality true when resizing anything on
         this row; past it the table silently becomes stacked cards. */
      width: "6rem",
      /* THROUGH `fabricTypeOf`, NOT A SECOND LOOKUP. It was an inline `find` here
         while the Components tree read the ORDER's `item_sub_type` — one word,
         two surfaces, two sources. It also now GATES the two cells after it
         (0513), so a second derivation would be a second answer to "does this row
         owe a mixing ratio". */
      cell: (r) =>
        r.item_id ? (
          <ClothText value={fabricTypeOf(r.item_id)} />
        ) : (
          <Select
            compact
            className="h-8"
            aria-label="Type"
            value={typeFilter[allocationKeyOf(r)] ?? ""}
            /* IT NARROWS AND DOES NOTHING ELSE. It used to clear the two mixing
               cells when a whole-roll type was stated, because stating one used
               to hide them; they no longer hide, so clearing would now delete a
               typed answer out of a cell the operator is still looking at. */
            onChange={(e) =>
              setTypeFilter((prev) => ({ ...prev, [allocationKeyOf(r)]: e.target.value }))
            }
          >
            <option value="" />
            {fabricTypeNames.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </Select>
        ),
    },
    {
      /**
       * LEGACY'S `Mixing Uom` — A UOM MASTER PICKER (client 2026-09-02: "the uom
       * master need to connect in that mixing uom").
       *
       * ## FOUR READINGS IN ONE DAY, AND TWO OF THEM LOOK IDENTICAL
       *
       *   1. `consumption_uom_id` — a UOM master pick, but the CONSUMPTION unit
       *   2. removed entirely, while "remove Unit" was in force
       *   3. `mixing_uom` text, percent | cm hardcoded (0513)
       *   4. `mixing_uom_id` — a UOM master pick that is its OWN column (0514)
       *
       * 1 and 4 render the same control and are different columns answering
       * different questions: what unit the CONSUMPTION FIGURE is in, versus what
       * unit the stripe REPEAT RATIO is in. Both live on this row now —
       * `consumption_uom_id` auto-filled off the fabric master and cell-less,
       * this one picked here. Do not fold them: a fabric consumed in KGS can have
       * its repeat stated in %.
       *
       * ## THE MASTER HAD TO GAIN `%` AND `CM`
       *
       * It held CONE · DZN · GROSS · KGS · LTR · MTR · NOS · PCS and nothing that
       * can say "60% blue / 40% white" (checked 2026-09-02). 0514 seeds the two,
       * which is what makes "connect the UOM master" and the client's earlier
       * "Percentage vs Centimeters" the same instruction rather than opposite
       * ones. THE FULL MASTER IS OFFERED, not a filtered pair: the rows carry
       * `is_fabric`/`is_yarn` but no picker in this app honours those flags yet,
       * so filtering here would be a rule invented in one call site — the thing
       * the cascading-picker note warns against.
       *
       * ## YARN-DYED ONLY, AND THE CELL IS EMPTY OTHERWISE
       *
       * Not a dash (client: "that — look not good at in view, just make it as
       * free cell"). A deliberate exception to the table-dash rule: that rule
       * guards "blank versus failed to load", and here the Type cell two columns
       * left already says the question does not apply.
       *
       * MANDATORY WHEN LIVE. The star, the cursor hold and the Save gate all come
       * from `missingFabricLineFields`; `useRequiredHold` ORs the control's own
       * `required` with the field context, so the per-row hold and the per-column
       * star stay in agreement.
       */
      header: "Mixing Uom",
      /* 4.5rem — 72px. A UOM code is "KG", "MTR", "PCS". */
      width: "4.5rem",
      required: lines.some((l) => l.item_id && isYarnDyed(fabricTypeOf(l.item_id))),
      /* ALWAYS LIVE (client 2026-09-03, screenshot 2651). The cell shipped
         unconditional, was gated on `isYarnDyed` for an hour — which killed it on
         the blank row the grid opens with — then made three-state, which killed
         it the instant a Solid or Melange cloth was named. Three reports in one
         day, and the third is the one that settles it: the operator picked a
         fabric and watched the row go dead. **The type decides MANDATORY and
         nothing else now**; see `fabric-line-rules.ts`' header for the withdrawal
         and why an empty optional cell is the honest way to say "meaningless
         here".

         AND THE HOLD IS PER ROW WHILE THE STAR IS PER COLUMN. `required` above
         is `ChildGridColumn.required` — one flag for the whole column, true iff
         SOME line is yarn dyed — and `ChildGrid` wraps every cell of the column
         in that scope. `useRequiredHold` ORs the scope with the control's own
         flag, so a column-level `true` can only ever ADD: on a BOM whose first
         line is yarn dyed, the SECOND line's empty Mixing Uom would be held
         before its fabric is even chosen. Re-declaring the scope inside the cell
         replaces it for this row (`RequiredScope` provides, it does not merge),
         which is what lets the header star and the per-row hold disagree in the
         one direction they must. */
      cell: (r) => {
        /* THE FABRIC'S OWN TYPE, NOT `rowType` — a stated Type is a question
           ("show me yarn-dyed jerseys"), and a question must never make a field
           mandatory: the operator would be held on a cell whose premise nothing
           has established. `missingFabricLineFields` refuses to make that demand
           for the same reason, and these two must agree or the hold and the Save
           gate part company. */
        const mandatory = isYarnDyed(fabricTypeOf(r.item_id));
        return (
          <RequiredScope required={mandatory} label="Mixing Uom">
            <RecordPicker
              label="Mixing Uom"
              compact
              required={mandatory}
              items={data.uoms}
              value={r.mixing_uom_id}
              onChange={(id) => setAlloc(r, { mixing_uom_id: id })}
            />
          </RequiredScope>
        );
      },
    },
    {
      /**
       * LEGACY'S `No Of Colors` — TYPED, NOT COUNTED (client field spec,
       * 2026-09-02): "the user inputs the exact number of distinct yarn colours
       * used to knit the pattern (e.g. 2 for a blue/white stripe, or 3 for a
       * tri-colour plaid)".
       *
       * IT WAS DERIVED FOR ABOUT AN HOUR — a count of the fabric group's distinct
       * colourways — on the reading that "our grain is one row per colour, so the
       * count is the row count". The spec makes it a DECLARATION instead, and the
       * difference is not cosmetic: a declared 3 against 2 mapped repeats is the
       * planner telling us something is still missing, which a self-counting cell
       * can never say because it always agrees with itself.
       *
       * THE COUNT IS STILL COMPARED — `colourCountNote` puts the mismatch on the
       * Repeats and Mixing Details panels. Advisory, never a hold: the two
       * legitimately disagree while the mapping is half done.
       *
       * NOT MANDATORY, though the spec calls it "active". Only Mixing UOM is
       * "mandatory only if Fabric Type is Yarn Dyed"; this one is offered, so a
       * planner who knows the ratio unit before they have counted can still save.
       */
      header: "No Of Colors",
      align: "right",
      /* 4.5rem, NOT THE 3.5 IT WAS DERIVED AT. A derived count only had to render
         a numeral; a typed one is a real `<input type="number">` with a caret and
         spinners, and 56px made it look unusable. The row now sums to 65rem =
         1040px + 72px of chrome = 1112, still under `tableFrom`'s 1152 — keep
         that inequality true when resizing anything here. */
      width: "4.5rem",
      /* ALWAYS LIVE, for Mixing Uom's reason above and on the same instruction.
         Nothing to reconcile with a hold here — this one is offered and never
         demanded, on any type of cloth, so it carries no `RequiredScope` of its
         own. A colour count typed against a Solid is unused by the requirement
         engine and visible enough to correct; a cell that vanishes as the fabric
         lands is not. */
      cell: (r) => (
        <Input
            className="h-8 text-right"
            type="number"
            min={1}
            max={99}
            value={r.no_of_colors ?? ""}
            onChange={(e) =>
              setAlloc(r, {
                no_of_colors: e.target.value === "" ? null : Number(e.target.value),
              })
            }
        />
      ),
    },
    {
      /**
       * LEGACY'S `Style Ref No` (client 2026-09-02), READ-ONLY — the third of
       * the 09-01 spec's four exclusions to come back, and the one that is not
       * typed anywhere on this row.
       *
       * IT IS WRITTEN BY THE COLOURWAY, not by this cell. `Style Color` below
       * carries `styleForCombo` onto the line, which is the rule the Combo cell
       * has stated since 09-01: on the CHANGE, never in an effect, because an
       * effect also fires when a saved BOM is opened and would rewrite every
       * stored line's style on load. Making this cell editable as well would
       * give one column two writers that can disagree.
       *
       * BLANK IS A REAL ANSWER and prints as `—`: `fabricSlices` reads an empty
       * `style_ref_no` as "every style", which is the state every line stored
       * before 0426 is in.
       */
      header: "Style Ref No",
      /* 5.5rem — 88px. "16-27/0010" is ten characters. */
      width: "5.5rem",
      cell: (r) => <ClothText value={styleRefFor(r)} />,
    },
    {
      /**
       * LEGACY'S `Style No` — DERIVED off the order, stored nowhere (client
       * 2026-09-02). `styleIdentityFor` is the one statement of it, added the
       * same day for the Components tree's top level, and 0426's rule is why it
       * is not copied onto the line: a copy on the BOM is a second place to
       * disagree with the order, and the order is the one that is right.
       *
       * IT ANSWERS PER ROW, WHERE `orderIdentity` ABSTAINS. That one refuses on
       * a multi-style order because it feeds a header the operator cannot
       * correct; this one is asked ABOUT the style the row already names, so
       * there is nothing to guess.
       */
      header: "Style No",
      /* 4rem — 64px. A style number is six digits. */
      width: "4rem",
      cell: (r) => <ClothText value={styleIdentityFor(styleRefFor(r))?.style ?? ""} />,
    },
    {
      /**
       * LEGACY'S `Style Color` — THE ORDER'S REQUIRED COLOUR, off the Colour tab
       * (client field spec, 2026-09-02).
       *
       * "Retrieved from the master colorways defined in the Color Tab under Order
       * Entry… represents the garment's final target shade (e.g. White, Navy, or
       * Green). This is critical for downstream planning because it determines
       * how many kilograms of each colour must be dyed."
       *
       * SO IT IS `color_name`, NOT `combo`, AND THAT IS A CORRECTION. This cell
       * was the assort colourway for about an hour, restored under legacy's
       * header when the client asked for Style Color back. The spec names its
       * source as the Colour tab and calls it "(Required Color)", which is
       * exactly `declaredColours` — `garment_order_amendment_dyeings` with
       * `section = 'fabric'`, the list the Color/Print Details tab reads.
       *
       * `combo` DID NOT LOSE ITS EDITOR. It is the Assort colour column of the
       * Components tree, where the colourways of a panel are shown together. What
       * it lost is a SECOND door on this grid, which leaves one editor for each of
       * the two fields rather than two for one.
       *
       * A COMBOBOX OVER THE ORDER'S OWN LIST, so the cell PICKS what an earlier
       * screen declared rather than accepting a fifth spelling of WHITE — typed
       * text in a Combobox is a search and is never committed (`commit` in
       * combobox.tsx). Empty and explain rather than falling back to free text:
       * an order that has declared no colours yet gives an empty list, and the
       * Colour/Print Details tab is where that is fixed.
       */
      header: "Style Color",
      /* 9.375rem — 150px (client 2026-09-03), up from 5.5rem/88px. It
         holds a colourway name ("MELANGE GREY", "OPTICAL WHITE"), which
         88px cut to two syllables. See THE WIDTH BUDGET on `tableFrom`. */
      width: "7.5rem",
      cell: (r) => (
        <Combobox
          compact
          inputClassName="h-8"
          clearable
          options={declaredColours.map((c) => ({ value: c, label: c }))}
          value={r.color_name}
          onChange={(v) => setAlloc(r, { color_name: v ?? "" })}
        />
      ),
    },
    {
      /** LEGACY'S `Article No` — derived with `Style No` above and from the same
       *  call, so the two can never name different styles. */
      header: "Article No",
      /* 4rem — 64px. "AR-4471". */
      width: "4rem",
      cell: (r) => <ClothText value={styleIdentityFor(styleRefFor(r))?.article ?? ""} />,
    },
    {
      /**
       * LEGACY'S [Detail] BUTTON (screenshot 2581's FabricAllocation column,
       * screenshot 2585's Components tab behind it) — it opens the panel
       * mapping for THIS fabric (0495).
       *
       * A CELL OF THE ROW, so Tab, Enter and the arrows all reach it.
       * `data-row-open` is what puts it on the Tab path; the Combos ▸ Structure
       * Details button was mouse-only until the same marker was added to it
       * (client 2026-08-19, screenshot 2358).
       *
       * GATED ON A FABRIC BEING NAMED, for the reason that button is gated on a
       * combo having a name: the sheet's whole subject is "which panels are cut
       * from this cloth", so opening it on a row that names no cloth asks the
       * operator to describe something that does not exist yet. The `title` says
       * so rather than leaving a dead control.
       *
       * NARROWER THAN `CELL`, and it stays that way though the row is now six
       * columns rather than thirteen. The figure was tuned when a full-width
       * cell here was what pushed the row past the frame and turned the table
       * into stacked cards; 4.5rem fits "Detail" at `text-xs` with room, and
       * widening it now would only spend slack the row does not need.
       */
      header: "",
      width: "4.5rem",
      cell: (r) => {
        /* YARN-DYED ONLY (client field spec, 2026-09-02). The popup behind this
           is Yarn Dyed Details — repeats, their mixing and their combinations.
           The 09-02 spec hid it for Solid and Melange, dyed as a whole roll and
           with no repeat to split; that half is withdrawn (see below).

           DISABLED AND EXPLAINED, NOT HIDDEN. A control that vanishes teaches
           the operator nothing about why, so the one refusal that remains says
           what it wants. Same call `Tabs`' `disabled` makes ("the tab is still
           SHOWN").

           ONE CONDITION LEFT, AND IT IS THE ONE THE BUTTON ALREADY NAMED. The
           yarn-dyed arm is gone (client 2026-09-03, screenshot 2651): the button
           said *"Choose the fabric first"*, the operator chose one, and it
           stayed grey — a refusal that contradicts its own instruction, which is
           indistinguishable from a broken control. A fabric is all it ever
           genuinely needed; the overlay's content is read off that cloth
           (`mixingDetailRows` reads its composition), which is why THIS gate
           survives where the two cells' did not. On a whole-roll cloth the
           panels are simply empty, and an empty panel the operator opened is an
           answer — a grey button is not. */
        const reason = r.item_id ? null : "Choose the fabric first";
        return (
          /**
           * THE REASON HANGS ON THE WRAPPER, NOT ON THE BUTTON — and that is the
           * whole fix (client 2026-09-02, "why the details tab is not enabling").
           *
           * It WAS on the button, as `title`, and it never appeared once. A
           * browser dispatches no pointer events to a disabled form control, so
           * its `title` tooltip never fires: the sentence explaining the refusal
           * was unreachable in exactly the state it was written for, and the
           * operator got a dead grey button with no explanation at all. The
           * comment above claimed "disabled and EXPLAINED" and only half of that
           * was true — the same stated-versus-enforced gap AGENTS.md records
           * where an ellipsis promises the rest is reachable and nothing
           * reaches it.
           *
           * A plain `<span>` is not disabled, so it takes the hover. Wrapping is
           * also why the reason keeps working on TOUCH, where a hover tooltip
           * would not: the sentence is also the button's `aria-describedby`
           * text, read out where the button itself announces only "dimmed".
           */
          <span title={reason ?? undefined} className="inline-block">
            <Button
              type="button"
              variant="outline"
              size="sm"
              data-row-open
              disabled={!!reason}
              aria-label={reason ? `Detail — ${reason}` : "Detail"}
              /* Captures the button's own rect so the sheet scales out of
                 THIS button — `currentTarget`, not `target`: the click can
                 land on the text node inside it. See `detailOrigin`. */
              onClick={(ev) => {
                setDetailOrigin(ev.currentTarget.getBoundingClientRect());
                setDetailKey(r.key);
              }}
            >
              Detail
            </Button>
          </span>
        );
      },
    },
  ];

  // ---- the requirement, recomputed as the operator types -------------------

  type PreviewRow = {
    key: string;
    fabric: string;
    slice: string;
    qty: number | null;
    refusal: string | null;
    unit: string;
    /* WHAT THE ROW RESOLVED TO, not just what it prints (0493). `fabric` and
       `unit` are display strings; the Yarn Process tab has to divide this
       requirement between the yarns of a specific ITEM, so it needs the id the
       loop already worked out. Carried here rather than re-derived there,
       because a second resolution of "which fabric does this entry cover" is a
       second answer to a question `entryFabric` owns on the server.

       `combo` JOINS THEM for the same reason (0495). Yarn is dyed per colourway,
       so `FabricGross` buckets by it — and `slice` is a LABEL ("WHITE · S"),
       which a consumer would have to split on a separator to recover. Parsing a
       display string back into data is how a colourway containing the separator
       silently lands in the wrong bucket. */
    item_id: string | null;
    uom_id: string | null;
    /** The colourway this row is for; NULL on a refusal, which names no slice. */
    combo: string | null;
    /**
     * WHICH MANUAL ENTRY PRODUCED THIS ROW — carried, never recovered from `key`.
     *
     * `fabricGross` groups by the entry (see it), and it used to do so by
     * cutting `key` at its LAST dash. That reads as safe while a slice key is
     * "combo" and is not: a sized slice is keyed `${SEP}${size_id}` and a
     * `size_id` is a UUID, so the cut landed INSIDE the uuid and every size of
     * one entry became its own bucket. The sums survive it — `yarnNetByCombo`
     * re-adds by colourway either way, which is why nothing showed — but the
     * poisoning rule does not: "a refused entry poisons its fabric" is a
     * statement about the entry, and the server (`fabricGrossOf`) groups by the
     * real `entry_id`. Two spellings of one grouping is what this module keeps
     * being bitten by.
     */
    entry_key: string;
  };

  /**
   * WHAT THE SERVER WILL STORE, computed from the SAME functions the action
   * calls.
   *
   * ## IT EXPLODES THE MANUAL ENTRIES, NOT THE LINES (0494)
   *
   * Until the client's spec arrived this walked `lines`. It walks `entries`
   * because the entry is the counting unit: one entry states a combined weight
   * for a SET of components, so exploding the lines it covers would multiply a
   * grouped 180 g once per panel. `requirementRows` in actions.ts is the same
   * walk, and this is deliberately its mirror rather than an approximation of
   * it — `requirement.ts` is client-safe precisely so the figure the planner
   * approves and the figure a purchase order is checked against cannot be
   * derived twice.
   *
   * THE FABRIC IS RESOLVED THE SAME WAY THE SERVER RESOLVES IT — off the lines
   * sharing the entry's structure, abstaining where they name two. What the
   * screen cannot do is resolve it from `data.fabrics` by hand: that would be a
   * second rule, and the two would disagree on exactly the multi-style orders
   * where it matters.
   */
  const preview: PreviewRow[] = useMemo(() => {
    if (!order) return [];
    const out: PreviewRow[] = [];
    for (const e of entries) {
      /* AN ENTRY WITH NOTHING ON IT IS SCAFFOLDING, not a refusal. A new BOM
         opens on one blank entry (the `seedRow` rule), and greeting the planner
         with "choose the fabric structure" before they have touched anything is
         the premature complaint `structTouched` exists to prevent one screen
         over. */
      if (!e.structure_id && e.component_ids.length === 0) continue;

      const structureName =
        data.structures.find((x) => x.id === e.structure_id)?.name ?? "(no structure)";
      const covered = lines.filter((l) => l.structure_id === e.structure_id && l.item_id);
      const itemIds = [...new Set(covered.map((l) => l.item_id))];
      const uom = data.uoms.find((u) => u.id === covered[0]?.consumption_uom_id);
      const unit = uom?.code ?? uom?.name ?? "";
      const fabric =
        itemIds.length === 1
          ? (fabrics.find((f) => f.id === itemIds[0])?.name ?? structureName)
          : structureName;

      const refuse = (reason: string) =>
        out.push({
          key: `${e.key}-r`,
          entry_key: e.key,
          fabric,
          slice: "—",
          qty: null,
          refusal: reason,
          /* A REFUSAL NAMES NO SLICE, so it names no colourway. `FabricGross`
             buckets on this, and a refusal carried into one colourway's bucket
             would leave the others reading as answered. */
          combo: null,
          unit,
          /* NULL WHEN THE FABRIC IS AMBIGUOUS OR ABSENT, which is most of the
             reasons this refuses. A refusal that named a fabric it could not
             identify would let the yarn split attribute it to the wrong one. */
          item_id: itemIds.length === 1 ? (itemIds[0] as string) : null,
          uom_id: covered[0]?.consumption_uom_id ?? null,
        });

      if (itemIds.length === 0) {
        refuse("No fabric on the Fabric Lines tab uses this structure — name the fabric there first");
        continue;
      }
      if (itemIds.length > 1) {
        refuse(
          "This structure names more than one fabric on the Fabric Lines tab, so this weight cannot say which — scope the entry's components, or use one fabric per structure",
        );
        continue;
      }

      const rows = fabricRequirementRows(
        "colour_size",
        // UNSCOPED — an entry names a structure, never a style or a colourway.
        { style_ref_no: null, combo: null },
        {
          consumption: null,
          wastage_pct: numOrNull(e.wastage_pct),
          decimals: uom?.decimal_places_allowed ?? null,
          /* PRESENT, ALWAYS. `bySize` being a map at all is what tells the
             engine to plan per size; an entry has no scalar to fall back to, so
             an empty map is refused slice by slice with the size named. */
          bySize: consumptionMap(e.calc_mode, sizeInputsOf(e), gsmForStructure(e.structure_id)),
        },
        order,
      );
      if (isRefusal(rows)) {
        refuse(rows.refused);
        continue;
      }
      for (const r of rows) {
        out.push({
          key: `${e.key}-${r.key}`,
          entry_key: e.key,
          fabric,
          slice: r.label,
          qty: r.required,
          refusal: null,
          combo: r.combo,
          unit,
          item_id: itemIds[0] as string,
          uom_id: covered[0]?.consumption_uom_id ?? null,
        });
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order, entries, lines, fabrics, data.structures, data.uoms, seedRows]);

  // ---- Yarn Process: the rows the fabrics imply (0493) ---------------------
  //
  // BELOW `preview`, NOT BESIDE THE OTHER GRIDS, and the position is load-bearing
  // rather than tidy: `fabricGross` reads `preview`, and a `const` referenced
  // before its declaration is a TDZ throw at render — the whole editor blank,
  // for a block that looks like it belongs 600 lines further up.

  /**
   * THE FABRIC IDS THIS TAB DERIVES FROM, as a stable string.
   *
   * A STRING AND NOT AN ARRAY, because it is an effect dependency: a fresh array
   * with the same contents is a new reference on every render, and the effect
   * below would re-fetch on every keystroke anywhere on the screen. Sorted and
   * joined, so re-ordering the fabric lines — which changes nothing about which
   * yarns are involved — does not refetch either.
   */
  const fabricIdKey = useMemo(
    () =>
      [...new Set(lines.map((l) => l.item_id).filter((id): id is string => !!id))]
        .sort()
        .join(","),
    [lines],
  );

  /**
   * The compositions behind those fabrics — the "bracket rule", read from
   * `material_mixings` rather than parsed out of a name (0493's header).
   *
   * KEYED WITH THE QUESTION IT ANSWERS, the shape `loaded` and `paletteState`
   * both take one section up and for the same reason: a reply that lands after
   * the operator has changed the fabrics must not be shown against them. Here it
   * would be worse than a stale palette — the rows would be one document's yarns
   * with another document's answers attached.
   */
  const [compState, setCompState] = useState<{
    forFabrics: string;
    compositions: FabricComposition[];
    yarns: { id: string; name: string; inactive: boolean }[];
  } | null>(null);

  useEffect(() => {
    // NO ROUND TRIP FOR NO FABRICS. The empty case is answered below without
    // state — see `comp`.
    if (!fabricIdKey) return;
    let cancelled = false;
    loadBomYarnComposition(fabricIdKey.split(",")).then((res) => {
      if (cancelled || !res.ok) return;
      setCompState({ forFabrics: fabricIdKey, ...res.data });
    });
    return () => {
      cancelled = true;
    };
  }, [fabricIdKey]);

  /**
   * THE EFFECT SETS STATE ONLY IN ITS CALLBACK, which is the rule `loaded`
   * states one section up: "clearing cells synchronously in the effect body is
   * what `react-hooks/set-state-in-effect` is about, and the rule is right here
   * — the clear was a second render that existed only to undo the first."
   *
   * So "no fabrics" is answered by DERIVING it rather than by storing it. The
   * first cut wrote `{ forFabrics: "", … }` from the effect body and the linter
   * was right to refuse: an empty composition is a fact about the current
   * fabrics, not a thing to remember. `EMPTY_COMPOSITION` is a module constant
   * so its identity is stable and the memos reading it do not re-run each
   * render.
   */
  const comp = !fabricIdKey
    ? EMPTY_COMPOSITION
    : compState && compState.forFabrics === fabricIdKey
      ? compState
      : null;

  /** THE ROWS. Derived, never stored — see `deriveYarnRows`. */
  const yarnRows: YarnRow[] = useMemo(() => {
    if (!comp) return [];
    return deriveYarnRows(
      comp.compositions,
      new Map(comp.yarns.map((y) => [y.id, { name: y.name, inactive: y.inactive }])),
      new Map(Object.entries(yarnAnswers)),
    );
  }, [comp, yarnAnswers]);

  /**
   * The gross requirement behind each MANUAL ENTRY, for the yarn split.
   *
   * ## IT WAS KEYED ON THE LINE AND 0494 MOVED THE GROUND (2026-09-01)
   *
   * The first cut grouped `preview` by fabric LINE, because that is where the
   * requirement came from. 0494 made the Manual ENTRY the counting unit — a
   * structure plus a SET of components sharing one gram weight — and
   * `requirementRows` now emits `entry_id` with `line_id` null. Grouping by line
   * matched nothing after that, and the failure mode was the dangerous one: not
   * an error, but every yarn refusing "no calculated requirement yet" while the
   * Fabric Lines tab plainly showed one.
   *
   * SO IT GROUPS BY ENTRY AND READS THE ROW'S OWN `item_id`, which is what the
   * preview resolved rather than something re-derived here. One entry may cover
   * several lines of one fabric; several entries may cover one fabric; both
   * sum, and `yarnPurchaseWeight` does the summing.
   *
   * A REFUSED ENTRY POISONS ITS FABRIC rather than being skipped — `gross: null`
   * — for the same reason the line version did: a yarn covering a good entry and
   * a refused one has no total worth printing, and two thirds of an answer looks
   * like a whole one.
   *
   * `preview` CARRIES THE ENTRY, and since 2026-09-03 it carries it as a field.
   * The grouping used to cut `key` at its last dash, which put every SIZE of an
   * entry in its own bucket the moment a slice key ended in a `size_id` uuid —
   * see `PreviewRow.entry_key` for why that was invisible and why it still had
   * to go.
   */
  const fabricGross: FabricGross[] = useMemo(() => {
    /* BUCKETED BY (entry, COLOURWAY) SINCE 0504 — the same key `fabricGrossOf`
       uses server-side, and for the same reason: a treatment may apply to PURPLE
       and not GREEN, so the yarn has to be weighed per colourway BEFORE any loss
       lands. Summing an entry's slices into one figure first would make the
       combo split unrepresentable. */
    const byBucket = new Map<string, FabricGross>();
    for (const p of preview) {
      /* A ROW THAT COULD NOT NAME ITS FABRIC IS SKIPPED. It is a refusal about
         the Fabric Lines tab ("no fabric uses this structure"), so there is no
         yarn it could be attributed to — and attributing it to a guess is worse
         than leaving the yarn's own figure standing. */
      if (!p.item_id) continue;
      const bucket = `${p.entry_key}::${comboKey(p.combo)}`;
      const held = byBucket.get(bucket);
      /* A REFUSAL POISONS ITS BUCKET and cannot be un-poisoned by a later
         slice: once null, it stays null. */
      if (held && held.gross === null) continue;
      byBucket.set(bucket, {
        fabric_id: p.item_id,
        combo: p.combo,
        gross: p.qty == null ? null : (held?.gross ?? 0) + p.qty,
        uom_id: p.uom_id,
        /* THE REASON TRAVELS WITH THE NULL (2026-09-03). `preview` already holds
           the sentence that names the fix — "Enter the consumption for WHITE ·
           S" — and dropping it here is what left the Yarn Process tab printing
           one generic line ending "see Calculated Quantities", a section removed
           from this screen on 2026-09-01 (client screenshot 2660). Carried on
           the row rather than looked up again, so the words the planner reads on
           Manual and the words they read on Yarn Process cannot drift. */
        refusal: p.refusal,
      });
    }
    return [...byBucket.values()];
  }, [preview]);

  const compositionById = useMemo(
    () => new Map((comp?.compositions ?? []).map((c) => [c.fabric_id, c])),
    [comp],
  );

  /**
   * EVERYTHING ONE FABRIC GROUP'S YARN DYED TABS NEED (0512), from an ANCHOR
   * LINE — the rows, the option lists, the composition and the handlers.
   *
   * A FACTORY TAKING AN ANCHOR, THOUGH IT HAS ONE CALLER TODAY. It was written
   * for two — the [Detail] popup and the Components rail section — until the
   * client scoped these tabs to the popup alone (2026-09-02, screenshots 2619 +
   * 2620: "from fabric line details tab only"). The rail section no longer asks,
   * so `detailYd` is the only call.
   *
   * IT STAYS A FACTORY RATHER THAN COLLAPSING TO A `useMemo` OFF `detailLine`,
   * because the thing that made it one is still true: this scope is a property of
   * an ANCHOR LINE, not of which overlay happens to be open, and a hook keyed on
   * `detailLine` would silently answer for the popup's cloth if a second caller
   * ever appears. It mirrors `panelHandlers(anchor)` beside it for that reason.
   *
   * The panels show ONE fabric's rows while the form holds every fabric's, which
   * is what lets the payload send them all without any overlay being open.
   */
  const ydFor = (anchor: LineRow | null) => {
    const key = anchor ? fabricGroupKey(anchor) : null;
    const address = {
      style_ref_no: anchor?.style_ref_no ?? "",
      structure_id: anchor?.structure_id ?? null,
      item_id: anchor?.item_id ?? null,
    };
    return {
      repeats: key ? ydRepeats.filter((r) => ydAddress(r) === key) : [],
      combinations: key ? ydCombinations.filter((r) => ydAddress(r) === key) : [],
      /* THE ADDRESS IS STAMPED ON ADD, off the anchor — the one moment it is
         known without ambiguity. */
      addRepeat: () =>
        mutYdRepeats((xs) => [
          ...xs,
          {
            key: newKey(),
            ...address,
            sno: 0,
            yarn_item_id: null,
            dye_type: "dyed" as const,
            color_name: "",
            uom_id: null,
            value: null,
            twisted_yarn: "",
          },
        ]),
      addCombination: () =>
        mutYdCombinations((xs) => [
          ...xs,
          { key: newKey(), ...address, combo: "", yd_combo_name: "" },
        ]),
      /* THE CLOTH'S OWN COMPOSITION, or null where the master states none —
         `mixingDetailRows` then refuses every Mixing % by name rather than
         assuming the yarn is the whole cloth. */
      composition: anchor?.item_id ? (compositionById.get(anchor.item_id) ?? null) : null,
    };
  };

  const patchYdRepeat = (key: string, patch: Partial<YdRepeat>) =>
    mutYdRepeats((xs) => xs.map((x) => (x.key === key ? { ...x, ...patch } : x)));
  const removeYdRepeat = (row: { key: string }) =>
    mutYdRepeats((xs) => xs.filter((x) => x.key !== row.key));
  const patchYdCombination = (key: string, patch: Partial<YdCombination>) =>
    mutYdCombinations((xs) => xs.map((x) => (x.key === key ? { ...x, ...patch } : x)));
  const removeYdCombination = (row: { key: string }) =>
    mutYdCombinations((xs) => xs.filter((x) => x.key !== row.key));

  /* THE YARN OPTIONS ARE EVERY YARN THE BOM'S FABRICS NAME, shaped for a
     picker. `RepeatsPanel` narrows them to the open cloth's own composition; the
     wider list is passed so a HELD yarn that has since left that composition can
     still be named and tagged rather than vanishing. */
  const ydYarnOptions = useMemo(
    () =>
      (comp?.yarns ?? []).map((y) => ({
        id: y.id,
        code: null,
        name: y.name,
        inactive: y.inactive,
      })),
    [comp],
  );

  const ydYarnName = (id: string | null) =>
    (id ? (comp?.yarns ?? []).find((y) => y.id === id)?.name : "") ?? "";
  const ydUomName = (id: string | null) =>
    (id ? data.uoms.find((u) => u.id === id)?.name : "") ?? "";

  /** The [Detail] popup's own scope — the line it was opened from. */
  const detailYd = ydFor(detailLine);

  /**
   * The purchase weight for one yarn, its per-colourway breakdown, or the
   * refusal that stands in place of both.
   *
   * THE SAME FUNCTION THE ACTION STORES FROM — never a second formula, so the
   * figure the planner approves is the figure a yarn purchase is raised against.
   * It re-runs as the stages are typed, which is the whole point of the Loss %
   * cell: without it the planner types 3% and watches nothing happen.
   */
  const weightFor = (r: YarnRow) => {
    const uom = data.uoms.find((u) => u.id === fabricGross.find((f) => f.uom_id)?.uom_id);
    return yarnPurchase(
      r.item_id,
      fabricGross,
      compositionById,
      /* ONLY THE LOSS. `For` stopped scoping the arithmetic on 2026-09-03
         (0520) — every step now treats every colourway — so the engine is not
         handed a value it would only ignore. */
      r.stages.map((st) => ({ loss_pct: numOrNull(st.loss_pct) })),
      uom?.decimal_places_allowed ?? null,
    );
  };

  // ---- validity ------------------------------------------------------------

  const filledLines = lines.filter((l) => l.item_id);
  /** The same fact at the grain the Fabric Lines tab draws — see the header. */
  const filledAllocations = allocationRows.filter((l) => l.item_id).length;

  /**
   * `canSave` is DERIVED. The hand-assembled form is a list a screen can forget
   * to extend, and two shipped screens gate Save on an error two sections away
   * with nothing on screen to say so.
   *
   * The line problems are `extra` rather than `fields` because they are per-ROW:
   * `fields` addresses one control by id, and there is no single id for "the
   * consumption cell of whichever line is blank". The GRID's own `required`
   * holds the cursor there; this is what makes Save explain itself.
   */
  /**
   * WHAT AN UNANSWERED MANUAL ENTRY OWES, one message per offending entry (0494).
   *
   * ONE ENTRY PER ROW AND NOT ONE FOR THE SET, unlike every other `extra` here.
   * Those say "some line is missing a fabric" because the grid's own `required`
   * star is on screen pointing at which one. A size sheet is behind a BUTTON —
   * the planner cannot see which entry is short of which size — so the message
   * has to name the structure or Save refuses without saying what to open.
   *
   * `manualProblem` IS THE RULE, and it is the same function the overlay's Done
   * button reads and the same sentences `fabricRequirementFor` refuses with.
   * Restating "every size needs a weight" here in this screen's own words is
   * exactly the two-spellings failure this file keeps recording.
   *
   * A BLANK ENTRY IS NOT A PROBLEM. A new BOM opens on one (the `seedRow` rule),
   * and an entry naming nothing is scaffolding the save drops — the same test
   * `normalizeManualEntries` applies, kept in step deliberately.
   */
  const manualBlockers = entries.flatMap((e) => {
    if (!e.structure_id && e.component_ids.length === 0) return [];
    const problem = manualProblem(
      entryLike(e),
      orderSizesFor(e.style_ref_no),
      gsmForStructure(e.structure_id),
    );
    if (!problem) return [];
    const name = data.structures.find((x) => x.id === e.structure_id)?.name;
    return [
      {
        section: "manual",
        label: "Manual entry",
        message: name ? `${name}: ${problem.refused}` : problem.refused,
        kind: "custom" as const,
      },
    ];
  });

  const validity = sectionValidity({
    /* `colors` IS LISTED THOUGH IT DECLARES NO PROBLEMS. The array is the rail's
       ORDER, which is what `revealFirstProblem` steps through — a section
       missing from it is a section the reveal cannot land on if it ever grows a
       rule. Nothing here blocks Save: the palette is the order's and a BOM with
       no dia stated is an ordinary document. */
    sections: [
      { key: "bom" },
      { key: "colors" },
      { key: "lines" },
      /* `components` IS LISTED FOR `colors`' REASON — the array is the rail's
         order, which `revealFirstProblem` steps through, so a section left out
         of it is one the reveal cannot land on if it ever grows a rule. It
         declares none today: a panel nobody has mapped is an ordinary
         half-answered document, and `fabricBomLineInput` already refuses a line
         that names a fabric with no Open/Tubular. */
      { key: "components" },
      /* `manual` DOES declare problems — see `manualBlockers` in `extra`. Its
         position here is the RAIL's order and must stay in step with the
         `sections` array below, because `revealFirstProblem` walks this list:
         a Save blocked on a missing size has to land on the sheet that fills it.
         It sits between the lines and the route for the reason legacy puts the
         Manual tab between FabricAllocation and YarnProcess — the consumption is
         settled before the cloth is routed. */
      { key: "manual" },
      /* `process` IS LISTED FOR `colors`' REASON EXACTLY — the array is the
         rail's order, which `revealFirstProblem` steps through, so a section
         left out of it is one the reveal cannot land on if it ever grows a rule.
         It declares none today: a fabric bought finished runs no route, and a
         route with unmeasured losses is an ordinary half-answered document. */
      /* `yarns` IS LISTED FOR THE SAME REASON as `colors` and `process`, and
         declares no problems for `process`' reason one material earlier: a yarn
         bought ready-dyed runs no route, and a route with unmeasured losses is
         an ordinary half-answered document. Its POSITION is the rail's, and the
         rail's is legacy's — YarnProcess before FabricProcess, because yarn is
         dyed and wound before it is knitted. This array must stay in step with
         the `sections` array below or `revealFirstProblem` walks a different
         order from the one the operator sees. */
      { key: "yarns" },
      { key: "process" },
    ],
    values: form,
    fields: [
      {
        section: "bom",
        id: "fb-order",
        label: "Garment order",
        required: true,
        empty: (f) => !f.garment_order_id,
      },
      { section: "bom", id: "fb-date", label: "Date", required: true, empty: (f) => !f.bom_date },
    ],
    extra: [
      /**
       * NO FUTURE DATE (client 2026-09-01: "the system strictly
       * blocks/disallows selecting future/next dates").
       *
       * THE SECOND HALF OF THE RULE, and the half that actually refuses. `max`
       * on the input stops the PICKER offering a later day; it does not stop a
       * typed or pasted one, and AGENTS.md's date-year note records this very
       * input type accepting a six-digit year and reporting itself VALID. So the
       * ceiling is stated twice on purpose — the attribute guides, this refuses.
       *
       * COMPARED AS TEXT, deliberately, exactly as Order Entry's twin does: both
       * sides are `YYYY-MM-DD`, which sorts lexicographically as it sorts
       * chronologically, so this needs no Date parsing and cannot pick up a
       * timezone on the way. A blank date says nothing here — it is already
       * `required` above, and a blank field is not also a malformed one.
       *
       * AND NO ZOD TWIN, for Order Entry's reason: the server has no idea what
       * day it is for the operator, so a server-side ceiling would refuse a
       * legitimately-today document for the first hours of every morning. The
       * screen is the only door — fabric BOMs have no data-io import path.
       */
      ...(form.bom_date && form.bom_date > today()
        ? [
            {
              section: "bom",
              fieldId: "fb-date",
              label: "Date",
              message: "Date cannot be in the future.",
              kind: "custom" as const,
            },
          ]
        : []),
      ...(filledLines.length === 0
        ? [
            {
              section: "lines",
              label: "Fabric lines",
              message: "Add at least one fabric line.",
              kind: "custom" as const,
            },
          ]
        : []),
      ...(filledLines.some((l) => !l.item_id)
        ? [
            {
              section: "lines",
              label: "Fabric",
              message: "Every line needs a fabric.",
              kind: "custom" as const,
            },
          ]
        : []),
      /* NO CONSUMPTION GATE, AND NO SPLIT GATE (0494). Both blocked Save on
         values nothing computes from once the entries became the counting unit —
         the inverse of the stated-but-not-enforced trap, and the more expensive
         direction: a rule that is enforced without being real cages the operator
         on a cell they cannot learn the purpose of. `manualBlockers` is what
         refuses an unanswered document now, and it names the entry.

         `Unit` KEEPS ITS GATE, just below. `entryFabric` resolves the
         requirement's `consumption_uom_id` off the lines sharing the entry's
         structure, so it is written into every stored requirement row — it is
         the one of the four line cells 0494 did not void. */
      ...manualBlockers,
      /* THE YARN-DYED CELLS (0513) — from `missingFabricLineFields`, the same
         function that draws the `*` on the control and holds the cursor in it.
         One declaration, four enforcers (AGENTS.md); a gate written separately
         here is how a star and a refusal come to disagree.

         DEDUPED TO ONE ENTRY PER FIELD. Every line of a yarn-dyed fabric owes the
         same answer, so a ten-line BOM would otherwise print the same sentence
         ten times and bury everything else in the list. */
      ...[
        ...new Map(
          filledLines
            .flatMap((l) => missingFabricLineFields(l, fabricTypeOf(l.item_id)))
            .map((pr) => [pr.field, pr]),
        ).values(),
      ].map((pr) => ({
        section: "lines",
        label: pr.label,
        message: pr.message,
        kind: "custom" as const,
      })),
      ...(filledLines.some((l) => l.item_id && !l.consumption_uom_id)
        ? [
            {
              section: "lines",
              /* THIS REFUSAL NAMES NO CELL, BECAUSE THERE ISN'T ONE (0513).
                 `consumption_uom_id` is auto-filled from the fabric's
                 `base_uom_id`, so the only way to reach this state is a fabric
                 whose MASTER has no base unit — and the fix is on the master, not
                 on this screen. It says so rather than pointing at a Mixing Uom
                 cell that now means something else entirely. */
              label: "Fabric",
              message:
                "This fabric has no base unit on the material master, so its consumption has no unit",
              kind: "custom" as const,
            },
          ]
        : []),

    ],
  });

  const revealFirstProblem = () => {
    const p = validity.first;
    if (!p) return;
    toastError(p.message);
    shellRef.current?.goToSection(p.section, p.fieldId ? { fieldId: p.fieldId } : "problem");
  };

  // ---- Copy from another fabric BOM ----------------------------------------

  /**
   * THE OTHER FABRIC BOMs THIS ONE CAN COPY FROM (client 2026-09-01: "a Copy
   * option must be integrated into this screen so that users can easily
   * replicate or modify existing selections").
   *
   * NO SERVER CALL, BECAUSE THE LIST IS ALREADY HERE. `listFabricBoms` loads
   * every BOM with its lines and its dias for the work queue, and the editor is
   * rendered by the same component — so a "load that BOM" action would be a
   * second read of rows the browser is already holding. It also means Copy
   * works with no round trip, which is what makes it feel like a paste rather
   * than a fetch.
   *
   * ITSELF EXCLUDED, and a BOM with nothing to give excluded too: a source whose
   * dias and lines are both empty is a menu entry that can only disappoint.
   */
  const copySources = useMemo(
    () =>
      boms
        .filter((b) => b.id !== editId)
        .filter((b) => (b.dias ?? []).length > 0 || (b.lines ?? []).length > 0)
        .map((b) => ({
          id: b.id,
          label: [
            b.code ?? "(no code)",
            b.garment_order?.customer?.name ?? null,
            b.garment_order?.po_no ?? b.garment_order?.code ?? null,
          ]
            .filter(Boolean)
            .join(" · "),
        })),
    [boms, editId],
  );

  /**
   * COPY ANOTHER BOM'S SIZE DETAILS AND FABRIC LINES INTO THIS ONE.
   *
   * ## ADDITIVE, NEVER DESTRUCTIVE
   *
   * Copy names a document the operator did not write, so a version that replaced
   * would let one mis-click destroy an afternoon with no undo. Dias are matched
   * on (type, size) and lines on (structure, component, fabric), so copying the
   * same source twice adds nothing the second time.
   *
   * ## THE STYLE AND COMBO ARE DELIBERATELY NOT COPIED
   *
   * `style_ref_no` and `combo` are TEXT held BY VALUE (0407 · 0397) — they are
   * THIS order's addresses, and the source BOM belongs to a different order. A
   * copied "WHITE" this order has never heard of would explode into requirement
   * rows matching no approval quantity and refuse, which reads as an arithmetic
   * failure rather than as a line pointing at the wrong order.
   *
   * They arrive NULL instead, and null already means something exact and useful
   * here: "every style" and "every combo on the order" (see `FabricBomLine`). So
   * a copied line is a fabric, a component, a consumption and a wastage — the
   * engineering, which is what actually repeats between orders — addressed to
   * the whole order until the operator narrows it. What is copied is what
   * transfers.
   */
  function copyFromBom(sourceId: string) {
    const src = boms.find((b) => b.id === sourceId);
    if (!src) return;

    const diaKey = (k: string | null, d: number | null) =>
      `${(k ?? "").trim()}${SEP}${d == null ? "" : String(Number(d))}`;
    const heldDias = new Set(
      dias.map((d) => diaKey(d.knit_type || null, numOrNull(d.dia))),
    );
    const freshDias = (src.dias ?? []).filter(
      (d) => !heldDias.has(diaKey(d.knit_type, d.dia)),
    );

    const lineKey = (l: {
      structure_id: string | null;
      component_id: string | null;
      item_id: string | null;
    }) => [l.structure_id ?? "", l.component_id ?? "", l.item_id ?? ""].join(SEP);
    const heldLines = new Set(lines.map(lineKey));
    const freshLines = (src.lines ?? []).filter((l) => !heldLines.has(lineKey(l)));

    if (!freshDias.length && !freshLines.length) {
      // EMPTY-AND-EXPLAIN. A control that does nothing and says nothing reads
      // as broken.
      success("Everything on that BOM is already here");
      return;
    }

    if (freshDias.length) {
      mutDias((xs) => [
        // DROP A BLANK OPENING ROW rather than leaving it above the copied ones:
        // a grid opens on one empty row, and copying into it would leave a gap
        // at the top of a list the operator did not type.
        ...xs.filter((d) => d.knit_type || d.dia.trim()),
        ...freshDias.map((d) => ({
          key: newKey(),
          knit_type: d.knit_type ?? "",
          dia: d.dia == null ? "" : String(d.dia),
        })),
      ]);
    }

    if (freshLines.length) {
      mut((xs) => [
        ...xs.filter((l) => l.item_id),
        ...freshLines.map((l) => ({
          ...blankLine(newKey()),
          // See the doc above: the ADDRESS is not copied, the engineering is.
          style_ref_no: "",
          combo: "",
          structure_id: l.structure_id,
          coordinate_id: l.coordinate_id,
          component_id: l.component_id,
          item_id: l.item_id,
          fabric_type: l.fabric_type ?? "",
          color_name: l.color_name ?? "",
          fabric_form: l.fabric_form ?? "",
          required_print: l.required_print ?? "",
          specification: l.specification ?? "",
          consumption_uom_id: l.consumption_uom_id,
          notes: l.notes ?? "",
        })),
      ]);
    }

    const said = [
      freshDias.length
        ? `${freshDias.length} size row${freshDias.length > 1 ? "s" : ""}`
        : null,
      freshLines.length
        ? `${freshLines.length} fabric line${freshLines.length > 1 ? "s" : ""}`
        : null,
    ].filter(Boolean);
    success(`Copied ${said.join(" and ")} — style and combo left blank`);
  }

  // ---- Color/Print Details columns (0490) ----------------------------------

  /**
   * THE THREE READ-ONLY PANELS SHARE ONE ROW SHAPE, so they share one column
   * pair — the same economy `dyeColumns` makes on the Garment Order tab, where
   * Yarn Dyeing and Fabric Dyeing are one definition branching on the row.
   *
   * PLAIN TEXT, NEVER A DISABLED `<Input>`. A greyed-out box says "you may edit
   * this once something else is true"; these are not editable here at all, and
   * a box the operator can click into and not change is the affordance that
   * makes them try. It also keeps them off the Tab path with no `tabIndex` to
   * set — a read-only value is not a field (AGENTS.md, "Tab lands on fields").
   */

  /**
   * THE EDITABLE COUNTERPART (client 2026-09-02).
   *
   * A REAL `<Input>`, WHICH REVERSES THE NOTE ABOVE. `colourColumns` renders
   * plain text and argues for it: "a box the operator can click into and not
   * change is the affordance that makes them try". That was right while the
   * panel was read-only and is exactly backwards now — the operator MAY change
   * it, so the box is the affordance that says so, and the value rejoins the Tab
   * path as a field (AGENTS.md, "Tab lands on fields") without a `tabIndex`.
   *
   * NO `required`. A blank row is a row the operator has not finished, not a
   * record that cannot be saved: `paletteDiff` drops blanks, so an unfilled
   * "+ Add colour" costs nothing and stores nothing. Marking it required would
   * hold the cursor in a cell whose only correct exit is to leave it empty.
   *
   * CAPS COME FROM THE PRIMITIVE. `Input` capitalises unless a call site opts
   * out (AGENTS.md, "CAPITALS"), and the payload's own schema upper-cases again
   * — the write-side half of that rule, which is what protects the value when it
   * arrives from anywhere other than this box.
   *
   * The width stays 18rem so all four panels still declare the same total and
   * their boxes still line up in the 2x2 (screenshot 2582).
   */
  const editableColourColumns = (
    header: string,
    panel: "fabric" | "yarn" | "prints",
  ): ChildGridColumn<PaletteRow>[] => [
    {
      header,
      /* 15rem — 240px. All three colour panels share it, and the Dia
         panel's two columns total the same (130 + 110), so the four cards hug
         to one width: 32px of ordinal + 240 + 32px of ✕ = 304px.
         CHANGE ONE OF THE THREE AND CHANGE ALL THREE. */
      width: "15rem",
      cell: (r) => (
        <Input
          /* 200px in a 240px cell, left-aligned. A `<td>` is left-aligned by
             default and this column declares no `align`, so the box needs
             nothing else to sit where it should. */
          className="max-w-[200px]"
          value={r.value}
          onChange={(e) => setPaletteCell(panel, r.key, e.target.value)}
          aria-label={header}
        />
      ),
    },
  ];

  /**
   * `mobileRowFor` IS GONE WITH THE GRIDS THAT USED IT (2026-09-03).
   *
   * It supplied `renderMobileRow` to the four Colour/Print panels — the
   * labelled stacked fallback `ChildGrid` renders below its table threshold,
   * whose own default is a bare div with no visible label. Those panels are
   * `PaletteTable`s now (see the note there for why they had to leave
   * `ChildGrid` at this width), and a hand-rolled table has no card mode to
   * fall back to, so there was nothing left for it to feed.
   *
   * THE LESSON IT CARRIED IS STILL TRUE, and belongs to whoever adds the next
   * `ChildGrid` here: dropping `renderMobileRow` as redundant is a mistake this
   * file has made once already — see the note on the Fabric Lines grid, which
   * still passes one.
   */

  const diaColumns: ChildGridColumn<DiaRow>[] = [
    {
      header: "Type",
      /* 8.125rem — 130px, enough for "Circular Knit", the longest option,
         which the original 7rem/112px clipped. 130 + 110 = 240, matching the
         single colour column beside it. */
      width: "8.125rem",
      cell: (r) => (
        <Select
          compact
          aria-label="Knit type"
          value={r.knit_type}
          onChange={(e) => setDiaCell(r.key, { knit_type: e.target.value })}
        >
          <option value="" />
          {KNIT_TYPE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      ),
    },
    {
      /* THE LEGACY HEADER, WORD FOR WORD. One column for three words because it
         is one answer: a circular knit states a diameter, a flat knit or a woven
         states a width, and which of the three it is has just been said in the
         cell to its left. Naming them separately would be three columns, two of
         them empty on every row. */
      header: "Dia / Size / Width",
      /* NO `align: "right"` ANY MORE (client 2026-09-03: "align inputs to the
         left within their table cells"). It was what pushed the box to the far
         side of the cell, which only became visible once the box stopped
         filling the cell — while it was 100% wide, left and right looked the
         same. The DIGITS stay right-aligned inside the box (`text-right` on
         the control): that is the numeric convention and it is about the value,
         not about where the control sits. */
      /* 11rem, THE SAME AS THE COLOUR COLUMN BESIDE IT — this panel sits under
         Fabric Dyeing in the 2×2, so a matching width is what puts their two
         column edges on one line. Undeclared, this cell was the worst offender
         in screenshot 2582: a number box the width of the whole pane. */
      /* 6.875rem — 110px. A diameter or a width is a two- or three-digit
         number; the long part is the header above it, and a `<th>` may wrap. */
      width: "6.875rem",
      cell: (r) => (
        <Input
          className="text-right"
          inputMode="decimal"
          aria-label="Dia / size / width"
          value={r.dia}
          onChange={(e) => setDiaCell(r.key, { dia: e.target.value })}
        />
      ),
    },
  ];

  // ---- the Yarn Process grid (0493) ----------------------------------------

  /**
   * TWO COLUMNS AND A FOLD — legacy's "Yarn Detail" grid (screenshot 2652).
   *
   * ## THE TREATMENTS MOVED OUT OF THE ROW AND UNDER IT (client 2026-09-03)
   *
   * "List the yarn — if the yarn is clicked show the S No / Stage / Process /
   * For / Descriptions / Loss %". This was three `ChildGrid` columns whose third
   * held the nested grid, so EVERY yarn drew its five-column route at once:
   * eight yarns is eight grids stacked, and the tab opened on a wall rather than
   * on the list of yarns legacy shows. `ProcessFoldList` draws the list and
   * unfolds one route at a time; see its header for why the panel could not be a
   * `ChildGrid` prop.
   *
   * THE WEIGHT STAYS, AND IT STAYS IN FRONT OF THE FOLD. Legacy has no such
   * column, but the client's 09-01 spec asks for it by name ("the final adjusted
   * purchase weights must automatically transfer … to the Budget"), and it is
   * the ANSWER the stages exist to move — a planner types a loss to watch this
   * figure change, so it has to be readable while the panel beneath is open.
   *
   * SEEDING IS NOW PAID FOR ON OPEN, which is a second gain rather than a side
   * effect. `YarnProcessGrid` passes `seedRow`, so with every panel mounted the
   * screen wrote a blank treatment into all eight yarns the moment the tab was
   * reached — marking a freshly-opened BOM unsaved before anything was typed.
   */
  const yarnColumns: FoldListColumn<YarnRow>[] = [
    {
      header: "Yarn",
      /* SIZED, WHICH IS WHAT MAKES THE WHOLE ROW HUG — see `hugsColumns` in
         `process-fold-list.tsx`. Unsized it took every spare pixel, and the two
         facts on this row sat at opposite edges of a 1,600px band (client
         2026-09-03, screenshot 142030). 22rem holds the muted line beneath the
         name, which is the longer of the two: a fabric's name carries its whole
         composition bracket, "SOLID SINGLE JERSEY (40'S COTTON COMBED) 100%".
         Past that `Truncated` reveals the rest, as everywhere else. */
      width: "22rem",
      /* PLAIN TEXT, NEVER A DISABLED PICKER — the palette panels' rule, stated
         there: "a greyed-out box says you may edit this once something else is
         true"; this is not editable at all, and a box the planner can click into
         and not change is the affordance that makes them try. It also keeps the
         cell off the Tab path with no `tabIndex` to set. */
      cell: (r) => (
        <div className="min-w-0">
          <div className="text-sm text-foreground">
            <Truncated>{r.name}</Truncated>
            {r.inactive && (
              /* THE "Disabled rows" TAG. A deactivated yarn is still what the
                 cloth is made of, so it is shown and bought; the tag says why it
                 cannot be found in the master any more. */
              <span className="ml-1 text-xs text-muted-foreground">(inactive)</span>
            )}
          </div>
          {/* WHICH FABRICS DECLARE IT. One yarn is legitimately in several, and
              a list of bare counts is unreadable without it. */}
          <div className="text-xs text-muted-foreground">
            <Truncated>{r.fabrics.join(" · ") || "—"}</Truncated>
          </div>
        </div>
      ),
    },
  ];

  /*
   * `Yarn Purchase Wt` AND `Treatments` WERE THE OTHER TWO COLUMNS, AND THE
   * CLIENT REMOVED BOTH (2026-09-03: "Yarn Purchase Wt, Treatments — no more
   * need this, the field just list by click, no need icon for listing, so
   * remove it"). With them went `yarnFoldSummary` and this list's `foldHeader`.
   *
   * THE FIGURE IS NOT LOST, ONLY UNSHOWN. `writeYarns` still computes it in the
   * same pass as the requirement it divides and stores it on
   * `order_fabric_bom_yarns.purchase_qty`, which is where the Budget reads it —
   * the tab was previewing a server figure, never producing one. What the
   * planner gives up is watching it move as they type a Loss %.
   *
   * THE REFUSAL SURVIVES, ONE LAYER IN. It was the red text in that column, and
   * deleting the column would have deleted the only sentence saying why a yarn
   * has no weight — "empty and explain, never a silent fallback" is not a
   * column, so it moved into the panel rather than going with it. See
   * `yarnPanel`.
   */

  const yarnPanel = (r: YarnRow) => {
    const w = weightFor(r);
    return (
      <>
        {/* WHY THIS YARN HAS NO WEIGHT, and the only place left that says so
            since the Yarn Purchase Wt column went. It is the requirement
            engine's own sentence — "Enter the consumption for BLUE · M" — so it
            names the size to go and fill rather than announcing that something,
            somewhere, is missing.

            ONLY WHEN REFUSED. A yarn that computes says nothing here: a banner
            that is always present is chrome, and the planner stops reading it
            before the one day it matters. */}
        {isRefusal(w) && (
          <p className="mb-1.5 text-xs text-danger">{w.refused}</p>
        )}
        <YarnProcessGrid
          rows={r.stages}
          onChange={(next) => setYarnStages(r.item_id, next)}
          processes={data.yarnProcesses}
          stages={data.yarnStages}
          /* THE FABRIC ROUTE'S OWN `Loss for` LIST (0519 · 0520) — PROCESS WISE
             / COLOR WISE, already loaded for `FabricProcessGrid` below. One list
             behind both `For` columns; see the prop. */
          lossFor={data.processLookups.lossFor}
          /* THE SCREEN'S OWN GENERATOR, so a process added to a reopened BOM
             cannot collide with the keys `openExisting` has already issued. */
          newKey={newKey}
          /* The HOST screen's permissions standing in for "may I maintain this
             shared code list" — the model every `LookupDialogPicker` call site
             in this app uses. */
          canCreate={perms.canCreate}
          canEdit={perms.canEdit}
          readOnly={!perms.canEdit && !perms.canCreate}
        />
      </>
    );
  };

  // ---- the Fabric Process list (0492) --------------------------------------

  /**
   * LEGACY'S "Fabric Detail" ROW, COLUMN FOR COLUMN (client 2026-09-03,
   * screenshot 2653): `S No · Fabric Description · Type · Type · Assort Color ·
   * Components`, each fabric unfolding onto its own route.
   *
   * ## IT WAS A SENTENCE AND IS NOW A ROW, WHICH IS THE WHOLE REQUEST
   *
   * The same four facts were already on screen — as a muted subtitle reading
   * "SINGLE JERSEY · YELLOW, WHITE · FRONT BODY, SLEEVE" under the fabric's
   * name. Everything was there and nothing lined up: the operator could not read
   * DOWN a column to compare two fabrics' forms, because there was no column.
   * That is the difference between "the field is shown" and "the field is
   * mapped", and it is the second time this module has been told so.
   *
   * ## THE TWO COLUMNS BOTH HEADED "Type" ARE TWO DIFFERENT FACTS
   *
   * Legacy prints "Circular" then "Tubular" and heads both "Type", and they are
   * not variants of one answer:
   *
   *  - the first is the STRUCTURE's knit family (`categories.fabric_structure_id`
   *    → a `config_lookups` name, carried on the picker row as `knit`). It says
   *    how the cloth is MADE.
   *  - the second is the LINE's `fabric_form` (0495, open | tubular). It says how
   *    the roll reaches cutting. `component-map.ts` already records why both
   *    exist: "a circular knit is the one that can be either, which is exactly
   *    why both columns exist."
   *
   * The headers stay legacy's own words — the same call `Dia / Size / Width`
   * makes one section up — and `cardLabel` is what tells them apart in the
   * stacked layout, where two cells labelled "Type" would be a coin toss.
   *
   * ## ASSORT COLOR AND COMPONENTS ARE LISTED, NOT `[Click]`ed
   *
   * Legacy draws both as a button into a sub-list. Ours are DERIVED from the
   * fabric's own lines and are short — a fabric serves three colourways and two
   * panels — so the values themselves fit in the cell, and a click that reveals
   * text the cell could already have shown is a worse answer than showing it.
   * `Truncated` is what makes that safe on the fabric that serves eight: the
   * ellipsis is a promise the rest is reachable (AGENTS.md), and hovering keeps
   * it.
   *
   * ## EVERY CELL IS READ, AND THE ROUTE UNDERNEATH IS NOT
   *
   * Nothing here is typed: the description, both types, the colourways and the
   * panels are all stated on Fabric Lines or on the order, and a second editable
   * copy is the argument 0490 made for the palette panels and 0491 for the
   * Manual tab's first two levels. What the operator answers is the route in the
   * panel below.
   *
   * ## THE WIDTHS ARE A BUDGET, AND FABRIC DESCRIPTION IS WHAT THEY BUY
   *
   * Client 2026-09-03: "check the field size — I need compacted size and [the]
   * right mapping." Five fixed tracks summing to 29.5rem plus the S No and fold
   * tracks is ~672px of chrome, and everything left over goes to the ONE
   * flexible column — the fabric name, which carries its whole composition
   * bracket and is the only cell here that can genuinely run long. Widening any
   * of the five takes it out of that name, which is where the ellipsis appears.
   * The four short ones were cut on this pass (8/7/11/11 → 6/5.5/9/9): a knit
   * family is "Circular Knit" and a roll form is "Open" or "Tubular", so the
   * declared widths were sized for text that does not exist.
   */
  const fabricRouteRows = fabricGroups.map((g) => ({
    key: g.item_id,
    item_id: g.item_id,
    name: g.name,
    lines: g.lines,
    /* PLAIN `map` + `rollUp`, NOT `useMemo` — a pass over one order's own lines,
       which AGENTS.md names as the shape a memo should be dropped from. */
    structureType: rollUp(
      g.lines.map((l) =>
        l.structure_id
          ? (data.structures.find((x) => x.id === l.structure_id)?.knit ?? "")
          : "",
      ),
    ),
    form: rollUp(g.lines.map((l) => fabricFormLabel(l.fabric_form))),
    /* WHAT THIS FABRIC IS USED FOR, gathered from its lines rather than named
       again. A fabric on several lines is several colourways and several panels
       — which is exactly the fact that makes ONE route right for all of them, so
       the row says so instead of leaving the operator to wonder whether the
       route they are typing covers the collar as well as the body. */
    combos: [...new Set(g.lines.map((l) => l.combo.trim()).filter(Boolean))],
    panels: [...new Set(g.lines.map((l) => componentName(l)).filter(Boolean))],
  }));

  type FabricRouteRow = (typeof fabricRouteRows)[number];

  const fabricRouteColumns: FoldListColumn<FabricRouteRow>[] = [
    {
      /* `Truncated` because a fabric name carries its whole composition bracket
         and an ellipsis with nothing behind it is a dead end (AGENTS.md). */
      header: "Fabric Description",
      /* SIZED FOR THE SAME REASON THE YARN COLUMN IS, and in the same change:
         one unsized column is all it takes to turn a fold row into a band with
         its ends pushed apart. This list already sized its other four, so it was
         one declaration away from hugging. */
      width: "22rem",
      cell: (r) => (
        <div className="min-w-0">
          <div className="text-sm text-foreground">
            <Truncated>{r.name || "(fabric not in the master)"}</Truncated>
          </div>
          {/* NO LINE NAMES IT ANY MORE — see `fabricGroups`. Said in words,
              because a row that has simply lost its colourways looks like a row
              whose lines said nothing. The next save drops these route rows, and
              this is the operator's chance to see that coming. */}
          {r.lines.length === 0 && (
            <div className="text-xs text-warning">
              no fabric line uses this any more — this route will be dropped on Save
            </div>
          )}
        </div>
      ),
    },
    {
      header: "Type",
      cardLabel: "Knit type",
      width: "6rem",
      cell: (r) => <ClothText value={r.structureType} />,
    },
    {
      header: "Type",
      cardLabel: "Roll form",
      width: "5.5rem",
      cell: (r) => <ClothText value={r.form} />,
    },
    {
      header: "Assort Color",
      width: "9rem",
      cell: (r) => <ClothText value={r.combos.join(", ")} />,
    },
    {
      header: "Components",
      width: "9rem",
      cell: (r) => <ClothText value={r.panels.join(", ")} />,
    },
  ];

  // ---- sections ------------------------------------------------------------

  const sections: FullScreenSection[] = [
    {
      key: "bom",
      label: "Fabric BOM",
      icon: Layers,
      // NO `problems`. Pass `done` — the operator asked for the quiet dot rather
      // than a red count, and `footer.onBlockedSave` is what replaces it.
      done: !!form.garment_order_id,
      content: (
        <SectionBody title="Fabric BOM">
          {/**
           * WIDTHS, NOT TWELFTHS (client 2026-09-03: Customer and Delivery
           * "stretched excessively wide compared to their text content").
           *
           * THE PREVIOUS ANSWER WAS THE RIGHT MOVE INSIDE THE WRONG TRACK, and
           * its own comment said so. 2026-09-01 compacted this row by
           * re-dividing the twelfths — 4 + 2 + 4 + 2 in place of four `sm` —
           * because a ten-character date had been given the same width as an RE
           * number truncated to fit (screenshot 2591: "!6-27/0010 · 121212 ·
           * AARSAN AMERICAS LLC" with its own start scrolled off). That
           * un-truncated the order and it could not stop the stretching, because
           * a span is a SHARE of the section rather than a width: `xs` is still
           * ~195px for a ten-character date in an 1180px sheet and `md` ~390px
           * for a customer name, and it grows again in a 1440px pane. The old
           * comment named the reason it could go no further — "`w` cannot do
           * this: inside a FieldGrid the CELL still takes its column" — which is
           * exactly why the row now leaves the fractional track rather than
           * trying `w` inside it.
           *
           * So this is `FieldRow`, the primitive written for this case: each
           * field takes the width its data needs and the row ends where its
           * content ends. Its own rule applies here — "the sums-to-12 rule does
           * not apply and is not being broken", because a content-width row has
           * no twelfths to leave over.
           *
           * BOTH DATES TAKE THE SAME WIDTH, and that is a deliberate departure
           * from the brief, which asked for ~180px and ~160px. They hold the
           * same DD/MM/YYYY value; 20px between two boxes showing one kind of
           * value reads as a mistake rather than as proportion, and requirement
           * 2 of that same brief is that the row be consistent. `term` (176px)
           * is the vocabulary's width for it and is what the brief asked for on
           * the Date box exactly.
           *
           * THE FOUR WIDTHS ARE THE CLIENT'S OWN NUMBERS (2026-09-03: 340 · 145
           * · 150 · 130), AND THEY ARE NOT FROM `FieldWidth`.
           *
           * SAY SO RATHER THAN HIDE IT. `lib/ui/sizes.ts` holds FIVE widths for
           * the whole application and its stated failure mode is "a screen
           * measured against its own longest value" — which is exactly what
           * four hand-typed pixel values are. This row was asked for twice: once
           * as "proportional" (09-03, answered with `name`/`term` from the
           * vocabulary) and then again with the measurements written out, after
           * seeing that answer. The later instruction wins.
           *
           * WHAT THAT COSTS, so the next reader can weigh it: these four no
           * longer move when the sizes are re-tuned, and a fifth screen copying
           * them starts a sixth constant. If a third request lands here, the fix
           * is a NEW NAMED WIDTH in `lib/ui/sizes.ts` used by all of them — not
           * a fifth set of literals.
           *
           * `max-w` ON THE FIRST, `w` ON THE OTHER THREE, which is what was
           * asked and is also the right shape: the Garment order value is the RE
           * number, the style and the customer joined, so it takes what it can
           * up to 340px and the three fixed boxes never stretch.
           */}
          {/* UNIFORM 36px, AND IT HAS TO BE STATED HERE.
              `Input` is `h-9 @2xl/editor:h-8` — 36px, dropping to 32px inside an
              editor pane, which is the app's density rule (doc/ui/LAYOUT.md) and
              is what this row would otherwise take. The client asked for 36.
              `[&_input]:h-9` is a DESCENDANT selector, so it out-specifies the
              control's own class without `!important` and reaches the picker's
              trigger too — `RecordPicker` takes no `className`, and editing it
              would change every picker in the app.
              NOTE THE INCONSISTENCY THIS BUYS: every other control in this
              editor — the Markers grid, Panel Weights, the Components tree —
              stays 32px, so this row now stands 4px proud of them. That is the
              trade the measurements ask for; it is not an oversight. */}
          <FieldRow className="[&_input]:h-9">
            <Field
              label="Garment order"
              required
              className="w-full max-w-[340px]"
              htmlFor="fb-order"
            >
              <RecordPicker
                id="fb-order"
                label="Garment order"
                compact
                items={data.orders}
                value={form.garment_order_id}
                /**
                 * LOCKED THE MOMENT AN ORDER IS NAMED — not merely once saved
                 * (client 2026-09-01: "once an entry is made, the RE (Arry)
                 * Number must be completely locked and must not be allowed to be
                 * changed under any circumstances").
                 *
                 * It was `!!editId`, which left a saved-but-unsaved window: on a
                 * new BOM the operator could pick an order, enter half the
                 * fabric lines against it, then re-point the document at a
                 * different order — and every line they had typed would stay,
                 * silently describing quantities from an order that no longer
                 * owns them. `disabled` also takes the ✕ with it, which is the
                 * "remove option" the client asked to lose.
                 *
                 * THE PICKER IS STILL REACHABLE, because `openNew(null)` exists:
                 * the "+ Add" button opens the editor with no order, and that is
                 * the one state where this field must be answerable. Locking on
                 * `form.garment_order_id` rather than on the entry point is what
                 * keeps that path working while still closing the window above —
                 * and a mis-pick is undone with Cancel, which is the escape the
                 * strict-lock rule leaves open.
                 */
                disabled={!!form.garment_order_id}
                onChange={(id) => set({ garment_order_id: id })}
              />
            </Field>
            <Field label="Date" required className="w-[145px]" htmlFor="fb-date">
              {/* ORDER ENTRY'S DATE RULE, APPLIED HERE (client 2026-09-01: "use
                  our order entry order info tab date field logic here also").
                  Two halves, and it needs both:

                  · `max` STOPS THE PICKER offering a future day — "the system
                    strictly blocks/disallows selecting future/next dates". It is
                    the same attribute `hd-date` carries on Order Entry.
                  · The SAVE GATE (`futureDateProblems` below) is what actually
                    refuses one, because `max` is advisory: a native date input
                    still accepts a typed or pasted value past its ceiling, and
                    AGENTS.md's date-year note records this input type reporting
                    itself VALID on a six-digit year.

                  LOCKED ONCE SAVED — "once an order entry is saved, the user
                  must not be allowed to change or alter the date". Past dates
                  stay selectable while entering, which is the client's other
                  half ("the system allows selection of previous/past dates"). */}
              <Input
                id="fb-date"
                type="date"
                max={today()}
                disabled={!!editId}
                value={form.bom_date}
                onChange={(e) => set({ bom_date: e.target.value })}
              />
            </Field>
            <Field label="Customer" className="w-[150px]" htmlFor="fb-cust">
              {/* READ-ONLY, from the order. A readOnly field never holds the
                  cursor (AGENTS.md, Mandatory fields), which is right: its
                  source is the order picker above. */}
              <Input id="fb-cust" readOnly value={pickedOrder?.customer_name ?? ""} />
            </Field>
            <Field label="Delivery" className="w-[130px]" htmlFor="fb-del">
              <Input
                id="fb-del"
                readOnly
                value={pickedOrder?.delivery_date ? fmtDate(pickedOrder.delivery_date) : ""}
              />
            </Field>
          </FieldRow>

          <ProductionStrip
            picked={!!form.garment_order_id}
            loading={orderLoading}
            error={orderErr}
            order={order}
          />
        </SectionBody>
      ),
    },
    /**
     * ---------------- Color / Print Details (0490) ----------------
     *
     * THE LEGACY TAB HAS FOUR PANELS AND THIS HAS FOUR PANELS (client
     * screenshot 2577): Yarn Dyeing, Fabric Dyeing, Roll form prints, Dia /
     * Size Width Details. What it does NOT have is the legacy Style Detail tree
     * beside them — the client's own instruction ("in this screen in our
     * application no need the style details section", screenshot 2578), and the
     * right call independently: that tree is the ORDER's styles, combos and
     * size quantities, which this screen already names in its header and
     * repeats down the Fabric Lines grid's Style Ref No and Combo columns.
     *
     * ## THREE ARE READ AND ONE IS TYPED, WHICH IS THE WHOLE DESIGN
     *
     * The order already declares its palette on Garment Order ▸ Color/Print
     * Details, and a fabric BOM names exactly one order. Copying those lists
     * here would be a second copy free to drift, and would ask the operator to
     * retype what they have already told the order — see `getOrderPalette` and
     * 0490's header for the argument in full. Dia is the one panel the order
     * cannot answer, so it is the one panel with a table behind it.
     *
     * SO THE READ-ONLY PANELS ARE NOT THE THING THAT WAS JUST REMOVED. Style
     * Detail was redundant reference — data this screen shows twice already.
     * The dyeing type (Y/D, Melange, Dyed) appears NOWHERE else on this screen:
     * the line grid carries a colour NAME but never how that colour is
     * achieved, and that is exactly what decides whether step 4 plans a yarn
     * dyeing or a fabric dyeing.
     *
     * ## `done` IS THE DIA, BECAUSE THE DIA IS THE ONLY THING THIS SECTION OWNS
     *
     * A quiet dot means "this section has been answered". Lighting it on a
     * palette read from elsewhere would report the OPERATOR as having done
     * something the order did.
     *
     * UNCHANGED BY THE PANELS BECOMING EDITABLE (2026-09-02), and the argument
     * above is exactly why. The palette still ARRIVES from the order, so a BOM
     * opened against an order that declares six colours would light this dot
     * before the operator had looked at the tab — the same false claim, now
     * with an editable box under it. The dia is still the only thing on this
     * tab that starts empty and can only be filled here.
     */
    {
      key: "colors",
      label: "Color/Print Details",
      icon: Palette,
      done: dias.some((d) => d.knit_type || d.dia.trim()),
      content: (
        <SectionBody title="Color/Print Details">
          {/* CONDITIONAL, WHICH IS THE ONLY SHAPE A LINE UNDER A HEADING MAY
              TAKE HERE. `SectionBody`'s `hint` prop was REMOVED with all 51 of
              its call sites on 2026-08-17 ("a heading gets no explanatory
              sentence"), and the single exception that survived is the one this
              copies: Style ▸ Components says "Add coordinates first" only WHILE
              the Coordinate picker has nothing to offer.

              So this appears only when the order has declared no palette at all.
              With rows on screen the three panels explain themselves — they
              carry no "+ Add" and no ✕, which is what read-only looks like here
              — and a standing sentence saying so would restate what the operator
              can already see, which is the whole of the rule. With NOTHING on
              screen the same three panels are indistinguishable from a screen
              that failed to load, and the operator has no way to learn that the
              place to fix it is another screen: that is the "empty and explain,
              never a silent fallback" half of the nominated-vendor rule.

              GATED ON THE ORDER BEING READ (`palette !== null`), or it would
              flash during the round trip and read as an answer. */}
          {!form.garment_order_id ? (
            /* THE STATE SCREENSHOT 2580 WAS ACTUALLY IN, and the first cut had no
               words for it. A new fabric BOM names no order yet, so there is no
               palette to mirror — and three dash rows with no explanation say
               "this order declared nothing", which is a different and wrong
               claim. The order picker is one section up, so the sentence points
               at it rather than describing the emptiness. */
            <p className="mb-3 text-xs text-muted-foreground">
              Pick a garment order under Fabric BOM — the dyeing colours and
              prints it declares are shown here.
            </p>
          ) : null}
          {/* AND NO "this order declares no dyeing colours or prints yet"
              (client 2026-09-03). It was already on its second wording — it used
              to send the operator to Order Entry, and was reworded when these
              panels became editable on 2026-09-02 — and both versions sat above
              grids the operator can type into, each with its own "+ Add" button.
              An empty grid with an Add button is not a state that needs
              explaining.

              THE SENTENCE ABOVE IT STAYS, and the difference is the whole rule:
              with no ORDER picked there is nothing to add TO, so that one stands
              in place of content and points at the section that fixes it.

              KEPT ACROSS THE MERGE WITH `origin/master` (2026-09-03), which
              still carried the reworded sentence. Two branches touched this
              block the same day: that one rewrote the words, this one was told
              to delete them. A deletion and a rewording are not two opinions
              about the wording — the later instruction removes the thing the
              earlier one was improving, so the removal wins and the rewrite has
              nothing left to apply to. */}
          {/* A 2×2 (client 2026-09-01: "need to align the ui section make it
              organized"), AND FOUR ACROSS IS NOT AVAILABLE — see below.

              ## WHY NOT ONE ROW OF FOUR (tried and reverted, 2026-09-03)

              A `ChildGrid` in `responsive` mode renders its TABLE only above a
              container-query threshold and its stacked CARDS below it: `@lg`
              (512px) by default, `@md` (448px) with `narrow`, and 1024 / 1152 /
              1280 through `tableFrom`. There is nothing lower. The query
              resolves against the grid's own `@container` root, which is sized
              by whatever slot the screen puts it in.

              So four panels across a ~1180px pane give each one ~286px, every
              grid falls under 448 and all four render as CARDS: no table frame,
              no `#` / header / ✕ columns, and the Dia panel's two columns
              stacked vertically instead of side by side. That was the reported
              breakage, and it is arithmetic rather than a bug to fix here —
              four tables need 4 × 448 + gaps = 1828px, which is past even the
              `wide` cap of 1720.

              A 2×2 gives each panel half the pane, ~585px, comfortably over
              the 512px default. THAT is why this section is two by two.

              ## `wrap` WAS ALSO REJECTED, AND ITS FAILURE IS THE ONE A READER
              ## WOULD REPEAT:

              `wrap` fits as many peers per line as the room allows and lets the
              rest wrap. The Garment Order's Color/Print tab has THREE panels and
              that is exactly what it wants. Four is the case it handles badly:
              at this pane's ~1276px, three 21rem panels fit and the FOURTH
              wrapped alone onto a line of its own — where `flex-grow: 1` then
              stretched it edge to edge. That is screenshot 2582: three panels in
              thirds and Dia / Size Width Details running the full width beneath
              them, its value box about 1400px wide for a three-digit number.

              The default two-column grid has no such failure: four children
              auto-place as 2 + 2 with no basis to guess and no line that can end
              up holding one item.

              ## THE ORDER OF THE FOUR IS THE POINT OF THE ARRANGEMENT

              Auto-placement fills left to right, so this reads:

                  Colour           | Yarn Colour
                  Roll form prints | Dia / Size Width Details

              Colour and Yarn Colour are a PAIR — one column each, same kind of
              value, split only by which section of the order declared them —
              and putting them side by side is the arrangement the client chose
              for this same pair on the order's own tab (2026-08-12, screenshots
              2269 · 2270). After them, the last panel the order declares and
              the one panel this BOM owns.

              THE ORDER OF THE FOUR IS THE CLIENT'S OWN LIST, in their words:
              "all the color, yarn color, and roll-form print details … must
              automatically auto-fill", then the Size Details section to add. So
              Colour · Yarn Colour · Roll form prints · Dia.

              ## ONE ROW OF FOUR (client 2026-09-03)

              ## THE ROW BUDGET — 896px

              A card is 32px of ordinal + its columns + 32px of ✕, and the four
              slots are `flex-1` with `gap-3` (12px):

                  COLOUR             32 + 136 + 32 = 200
                  YARN COLOUR        32 + 136 + 32 = 200
                  ROLL FORM PRINTS   32 + 136 + 32 = 200
                  DIA / SIZE WIDTH   32 + (120 + 76) + 32 = 260
                                                    + 3 gaps = 896px

              896 clears the editor pane with room over, so nothing scrolls
              sideways at any width this editor is used at.

              ## `fill` STAYS OFF, AND THAT IS NOT OPTIONAL HERE

              `fill` suppresses `ChildGrid`'s hug so a panel takes the width its
              container gives it, which is the obvious pairing with `flex-1` —
              and it would break this row outright. A grid that does not hug
              renders `w-full min-w-[420px]` (child-grid.tsx), so four of them
              would demand 1680px + gaps and put the whole section into the
              sideways scroll the operator's rule 4 bans. Hugged tables inside
              `flex-1` slots is the combination that fits.

              WHAT `fill` WAS ORIGINALLY FOR, so nobody restores it by reflex:
              without it the 2×2 came out with four different right edges —
              "Yarn Dyeing at ~520px above Roll Form Prints at ~350px" (client
              2026-08-12, screenshot 2273). That complaint is about two ROWS
              failing to line up. There is one row now, so it cannot recur; the
              slots are equal because `flex-1` makes them equal.

              ## `flex-nowrap`, AND WHAT IT COSTS

              The four are asked to hold one line, so they do. The trade is that
              below ~900px of pane they overflow rather than stacking — the
              `min-w-[200px]` floors stop them shrinking further. That is inside
              this editor's normal width and outside a phone's; the mobile
              fallback is `ChildGrid`'s own stacked cards, which each panel keeps
              through `renderMobileRow`. */}
          {/* COPY FROM ANOTHER BOM (client 2026-09-01, point 4). It sits on THIS
              tab because that is where the client put it — "a Copy option must
              be integrated into this screen" — and because Size Details is the
              only thing on the tab an operator types, so it is the only thing a
              copy can save them.

              A `<Select>` USED AS A COMMAND, not as a value: choosing a source
              copies immediately and the box returns to blank. That is unusual
              enough to say out loud, and it is the honest shape — "copied from"
              is not a property of this BOM, so a control left showing a name
              would be claiming a link that nothing stores. The toast is what
              reports the result, and it names the counts because an additive
              copy that found nothing new is otherwise indistinguishable from a
              broken one.

              HIDDEN WITH NOTHING TO OFFER. On the first BOM in the system every
              source is excluded, and a permanently empty dropdown is the
              "permanently closed gate" this module has already been told off
              for once. */}
          {copySources.length > 0 && (
            <div className="mb-3 flex items-center justify-end gap-2">
              <label htmlFor="fb-copy" className="text-xs text-muted-foreground">
                Copy from
              </label>
              <Select
                id="fb-copy"
                compact
                className="h-8 w-64"
                value=""
                onChange={(e) => {
                  const id = e.target.value;
                  if (id) copyFromBom(id);
                }}
              >
                <option value="" />
                {copySources.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </div>
          )}
          {/* DENSE CELLS, AND NO HEIGHT OVERRIDE AT ALL (client 2026-09-03:
              "uniform compact height 32px (h-8)", "py-1.5 px-2").

              THE HEIGHT OVERRIDE CAME OFF, AND THAT IS THE FIX RATHER THAN A
              RETREAT. `Input` and `Select` are `h-9 @2xl/editor:h-8` — 32px
              inside an editor pane — so 32px is what the app already gives
              here, and the `[&_input]:h-9` that stood on this line was forcing
              36 to answer an earlier brief. Letting the primitive speak puts
              these four panels back in step with every other grid in this
              editor, which is what "uniform" has to mean.

              `py-1.5 px-2` ON THE DATA CELLS. `ChildGrid` renders those at
              `px-1.5 py-1` while its own ordinal and ✕ cells are already
              `py-1.5`, so one row carried two vertical paddings. A descendant
              selector out-specifies the cell's own class without `!important`
              and settles the row at one figure. It is the only way to reach a
              primitive's `<td>` from a call site; if a third screen needs it,
              it belongs in `ChildGrid` instead of being copied. */}
          {/* THE COMPACT PASS, as three descendant rules — each reaches
              something a call site cannot otherwise touch:

                text-xs on every control — `Input`/`Select` are `text-sm`
                py-1 px-1.5 on every cell — ChildGrid's data cells already
                  are; this settles its ordinal and ✕ cells at the same figure
                w-8 on the first column — the ordinal `<th>` is `w-10`

              The ✕ column is already `w-8` in the primitive, so it needs
              nothing. If a third screen needs this set, it belongs in
              `ChildGrid` rather than being copied a third time. */}
          {/* ONE ROW OF FOUR (client 2026-09-03). `SectionGrid` is gone with
              the grids it laid out — see `PaletteTable` for why these four
              cannot be `ChildGrid`s at this width, and what that costs.

              A FLEX ROW, NOT `grid-cols-4`, so the screen still declares no
              `grid-cols-*` or `col-span-*` of its own (AGENTS.md). The two
              descendant rules are the compact pass: `text-xs` on every control
              (`Input`/`Select` are `text-sm`), and nothing else — the cells
              carry their own `px-1.5 py-1` and the controls their own 32px
              from the app's editor density.

              `flex-nowrap` HOLDS THE LINE, and the trade is that below ~900px
              of pane the four overflow rather than stacking. 210 + 210 + 210 +
              280 + 3 gaps = 946px, so that is outside this editor's normal
              width. */}
          <div className="flex w-full flex-row flex-nowrap items-start gap-3 [&_input]:text-xs [&_select]:text-xs">
            <PaletteTable<PaletteRow>
              label="Colour"
              columns={editableColourColumns("Colour", "fabric")}
              rows={paletteEdit?.fabric ?? blankPalette()}
              width="max-w-[210px]"
              onAdd={() => mutPalette("fabric", (xs) => [...xs, { key: newKey(), value: "" }])}
              /* THE LAST ROW COMES BACK BLANK, which is what `ChildGrid`'s
                 `seedRow` did for these panels before. A panel with no row at
                 all is a header and a button, and the client asked for one
                 default row (2026-09-02). */
              onRemove={(r) =>
                mutPalette("fabric", (xs) => {
                  const left = xs.filter((x) => x.key !== r.key);
                  return left.length ? left : [{ key: newKey(), value: "" }];
                })
              }
              addLabel="+ Add colour"
            />
            <PaletteTable<PaletteRow>
              label="Yarn Colour"
              columns={editableColourColumns("Yarn colour", "yarn")}
              rows={paletteEdit?.yarn ?? blankPalette()}
              width="max-w-[210px]"
              onAdd={() => mutPalette("yarn", (xs) => [...xs, { key: newKey(), value: "" }])}
              onRemove={(r) =>
                mutPalette("yarn", (xs) => {
                  const left = xs.filter((x) => x.key !== r.key);
                  return left.length ? left : [{ key: newKey(), value: "" }];
                })
              }
              addLabel="+ Add yarn colour"
            />
            <PaletteTable<PaletteRow>
              label="Roll form prints"
              /* `editablePrintRows` seeded these, not `editableRows`: a print
                 names ITSELF (`print_name`) where a dyeing carries a
                 `color_name`, so the two builders differ by the field they read
                 and by nothing else. */
              columns={editableColourColumns("Roll form print", "prints")}
              rows={paletteEdit?.prints ?? blankPalette()}
              width="max-w-[210px]"
              onAdd={() => mutPalette("prints", (xs) => [...xs, { key: newKey(), value: "" }])}
              onRemove={(r) =>
                mutPalette("prints", (xs) => {
                  const left = xs.filter((x) => x.key !== r.key);
                  return left.length ? left : [{ key: newKey(), value: "" }];
                })
              }
              addLabel="+ Add print"
            />
            {/* THE ONE PANEL THE ORDER CANNOT ANSWER, which is why this tab
                reads three-read-one-typed: the order declares its colours and
                prints, and the knitting diameter or woven width is a BOM-time
                fact about how the cloth is MADE.

                TWO COLUMNS IN ONE ROW — Type beside Dia / Size / Width, which
                is what the extra 70px of width is for. */}
            <PaletteTable<DiaRow>
              label="Dia / Size Width Details"
              columns={diaColumns}
              rows={dias}
              width="max-w-[280px]"
              onAdd={() => mutDias((xs) => [...xs, blankDia(newKey())])}
              onRemove={(r) =>
                mutDias((xs) => {
                  const left = xs.filter((x) => x.key !== r.key);
                  return left.length ? left : [blankDia(newKey())];
                })
              }
              addLabel="+ Add dia"
            />
          </div>
        </SectionBody>
      ),
    },
    {
      key: "lines",
      label: "Fabric Lines",
      icon: ListChecks,
      done: filledLines.length > 0,
      /**
       * NO LONGER `wide` (client 2026-09-03: "ensure the table starts
       * directly aligned with the rest of the form").
       *
       * THAT MISALIGNMENT WAS `wide` AND NOTHING ELSE — not a margin, not a
       * padding, which is why the fix is a removed prop rather than a `pl-*`.
       * `MasterFullScreen` caps a wide section's pane at `max-w-[1720px]`
       * and every other section at `max-w-[1440px]`, both `mx-auto`
       * (master-full-screen.tsx). So on any screen past 1720 this one pane
       * started 140px outside the Fabric BOM form above it, and the table
       * inside it began at that outdented edge. Adding left padding here
       * would have pushed the table back towards the form while leaving the
       * PANE outdented — the frame and its contents disagreeing, which is
       * worse than either.
       *
       * IT FITS THE ORDINARY CAP NOW, which is the half that makes this
       * safe. `wide` was here because the row was 14 columns; it is 11, and
       * the declared widths total ~1150px against a 1440px pane. The table
       * still appears at the same breakpoint (see `tableFrom` below), so no
       * screen that showed a table before now falls back to cards.
       */
      content: (
        <SectionBody title="Fabric Lines">
          {/* NO "SEED FROM ORDER" BUTTON, AND THE BAND GOES WITH IT
              (client 2026-09-03).

              THE CLIENT HAS NOW MOVED THIS TWICE, so the history matters more
              than the deletion: the button was taken off on 2026-09-01, put
              back on 2026-09-02 (screenshots 2636 — 2637) because the
              Components tab was opening empty against an order that had
              already declared its panels, and is off again now. The `mb-3`
              wrapper leaves with it both times — it held nothing else, and
              an empty band was the larger half of the excess padding reported
              in screenshot 2595.

              SEEDING ITSELF IS NOT GONE, which is the part to check before
              reading this as a regression. A NEW BOM STILL FILLS ITSELF from
              the order's tree — see the `seededFor` effect, which calls
              `applySeed` once per order id while the grid is still untouched.
              What has gone is the MANUAL re-run, and with it the only way to
              seed a half-typed or saved BOM after the order is amended.
              That is the cost of this change, stated so the next report of
              "the amended order did not reach the BOM" is not a mystery.

              PUTTING IT BACK IS SMALL: this comment, a `<Button>` in a
              `mb-3` band, and the fetch-and-toast wrapper around `applySeed`
              that used to be `seedFromOrder` (removed with it rather than
              left dead — see the note above `applySeed`). */}
          {/* `py-1.5 px-2` ON THE DATA CELLS (client 2026-09-03).
              `ChildGrid` renders them at `px-1.5 py-1` while its own ordinal
              and remove cells are already `py-1.5`, so one row carried two
              vertical paddings. A descendant selector out-specifies the
              cell's own class without `!important`; it is the only way to
              reach a primitive's `<td>` from a call site. The same pair is
              on the Colour/Print section — if a third screen needs it, it
              belongs in `ChildGrid` rather than being copied again. */}
          <div className="[&_td]:px-2 [&_td]:py-1.5">
          <ChildGrid<LineRow>
            columns={lineColumns}
            /* ONE ROW PER ALLOCATION, not per panel — see `allocationRows`.
               `lines` is still what Save writes and what Components reads; this
               tab asks a different question of the same array. */
            rows={allocationRows}
            seedRow
            /* ## THE WIDTH BUDGET — 1150px AGAINST A 1152px BREAKPOINT

               The declared widths sum to ~1150px including the row chrome,
               and the table may appear from 1152 (@6xl). Keep that
               inequality true when a column is added or resized: over 1152
               the table renders and immediately scrolls sideways. Without it
               the switch is @lg, which is 512px in a container query, and a
               laptop would get a table it has to scroll.

               THERE IS 2px OF HEADROOM LEFT, AND THAT IS A WARNING RATHER
               THAN A MEASUREMENT TO TRUST. 2026-09-03 widened Structure to
               160 and Style Color to 150 (+118px) because both were clipping
               their values, and paid for it by trimming five columns whose
               contents have a known short maximum — Fabric 208—176, Mixing
               Uom 88—72, Style Ref No 104—88, Style No 80—64, Article No
               80—64 — for 96px back. THE NEXT WIDENING CANNOT BE PAID FOR
               THE SAME WAY: what is left is Type, GSM Range and No Of
               Colors, and all three are already at the width their value
               needs (No Of Colors carries its own note saying it was put
               BACK up to 4.5rem). Move `tableFrom` to `7xl` and a 1536-CSS-px
               monitor drops to cards — the bug recorded two paragraphs
               below. So the next column that needs room needs a column
               REMOVED, not borrowed from.

               THESE ARE CSS PIXELS, NOT THE ONES IN A SCREENSHOT. This was first
               written for @7xl (1280) against a pane measured off an image, and
               it stayed stacked on the operator's own monitor: Windows display
               scaling makes a 1920 screen about 1536 CSS px wide, so the pane
               was ~1260 and the threshold missed by 20. The CSS rule was
               present and correct throughout — the only symptom was cards.
               Measure the CONTAINER, never the picture of it. */
            tableFrom="5xl"
            centerHeaders
            /* NO `forceCards`. Responsive mode: ONE TABLE ROW PER FABRIC at the
               widths declared above, falling back to stacked cards below the
               breakpoint — so a narrow screen stacks rather than growing the
               sideways scrollbar the operator's rule 4 bans.

               `renderMobileRow` STAYS, and dropping it as redundant is a mistake
               this file made once: the default stacked cell is a bare <div>
               around a RequiredScope with NO VISIBLE LABEL, so the fallback
               became fourteen unlabelled full-width boxes — worse than the
               four-per-row block the whole change set out to fix. The callback
               is what supplies the label and the `required` star below the
               breakpoint. */
            renderMobileRow={(row) => (
              <FieldGrid>
                {lineColumns.map((c, ci) => (
                  <Field key={ci} label={c.header} required={c.required} size="sm">
                    {c.cell(row, ci)}
                  </Field>
                ))}
              </FieldGrid>
            )}
            /* A NEW LINE IS BORN KNOWING ITS STYLE (client 2026-09-02, "from
               order entry fetch Style Ref No, Style No"). `styleRefFor` reads the
               same fallback the cells display, so what is SHOWN and what is
               STORED cannot diverge — the display alone would have left the saved
               document with a blank style while the screen claimed one.

               ON A MULTI-STYLE ORDER THIS SEEDS NOTHING, because `orderIdentity`
               abstains there, and a blank `style_ref_no` legitimately means
               "every style" to `fabricSlices`. So the seed makes the common case
               explicit without inventing an answer for the ambiguous one. */
            onAdd={() =>
              mut((xs) => [
                ...xs,
                { ...blankLine(newKey()), style_ref_no: orderIdentity?.ref ?? "" },
              ])
            }
            /* REMOVES THE WHOLE ALLOCATION. Deleting the drawn row alone would
               leave its sibling panels behind — invisible here, and enough to
               keep refusing a Save the operator believes they have cleared. */
            onRemove={removeAlloc}
            addLabel="+ Add fabric"
          />
          </div>
        </SectionBody>
      ),
    },
    /**
     * ---------------- Manual · size-wise gram weights (0494) ----------------
     *
     * The legacy screen's **Manual** tab (client screenshot 2586), built to the
     * client's own written spec rather than to the screenshot — which is what
     * re-grained it: 0491 read the picture and keyed the size rows to a fabric
     * LINE, and the spec's entry is keyed to a structure plus a SET of
     * components.
     *
     * The client's framing sets the standard of care: fabric and yarn are 70-80%
     * of a garment order's value, so this tab is "the heart of the material
     * calculation system — any minor error in this screen will collapse the
     * downstream purchasing, knitting, dyeing, and budgeting calculations".
     *
     * ## THE ENTRY IS THE COUNTING UNIT
     *
     *     Single Jersey   Front Body + Back Body   180 g
     *     Single Jersey   Sleeve                    20 g
     *     Rib             Neck                      50 g
     *
     * Requirement rows come from these and no longer from the Fabric Lines. A
     * grouped 180 g covers three panels and must multiply ONCE — and what keeps
     * the total right is the client's own "no duplicate component allocation"
     * rule (`componentOptionsFor`), which makes the entries partition the
     * garment.
     *
     * ## THE SPLIT IS THE ORDER-ENTRY ONE, AND IT IS NOW A SPLIT
     *
     * Legacy's three levels are three levels here too (screenshot 2650): a
     * STYLE owns fabric ENTRIES, and an entry owns SIZE rows. What changed on
     * 2026-09-03 is how the first level opens.
     *
     * IT WAS A `[Fabrics 0/2]` BUTTON opening a full-bleed Sheet — the shape
     * Combos ▸ [Detail] and Quantities ▸ [Assort] take, down to `zIndexBase`,
     * `fullBleed` and `SubSheetFooter`. The client asked for the split instead
     * ("design it like the split I did in order entry, instead that fabric
     * button"), and the button's own case had quietly expired: it existed to
     * keep three entries × six sizes off one scrollable section, which is
     * exactly what `masterDetail` does — one style open, the rest standing in a
     * 268px list beside it — without putting a door in front of the only thing
     * the tab is for.
     *
     * Two of the button's three reasons survive the move and are now the SECOND
     * level's, where the fold still lives: the size table is nine columns wide
     * in calculated mode and is read one entry at a time, and the entry row is
     * where the grouping decision is made, so it wants to read as a list. The
     * third — "it is already on the keyboard", `data-row-open` putting the
     * button in `ROW_FIELDS` — went with the button; the split needs no marker,
     * because `ChildGrid` owns the panes and the open row keeps every key it
     * had.
     *
     * ## `done` IS AN ANSWERED SIZE, NEVER A MODE
     *
     * Lighting the quiet dot on the mode dropdown would report the planner as
     * having answered the section by opening a Select. What this section owns is
     * the weights, so that is what it counts — the same call Color/Print Details
     * makes when it lights on the dia and not on the palette it reads.
     */
    /**
     * ---------------- Components (0495, given a rail row 2026-09-02) ----------
     *
     * Legacy's third tab, and it sits exactly where legacy puts it — after
     * FabricAllocation (our Fabric Lines) and before Manual (client 2026-09-02:
     * "the component tab is missing from ui add it after the fabric lines tab").
     *
     * ## THIS IS NOW THE ONLY PLACE THE TREE IS DRAWN
     *
     * It had a second mount — the [Detail] popup — until 2026-09-02, when the
     * client scoped that popup to Yarn Dyed Details alone (screenshot 2623). So
     * `ComponentMapBody` has one caller, and that matches legacy: legacy's
     * [Detail] opens "Yarn Dyed Details" (2615) and Components is its own entry
     * in the tab strip, which is this row.
     *
     * The 09-01 instruction that put the mapping in a popup ("an optimized,
     * responsive popup modal window rather than a full-screen redirect") is not
     * contradicted by that — the popup still exists and is still a popup; what
     * changed is WHICH subject it carries.
     *
     * ## ONE TREE PER STYLE, WHICH IS WHAT MAKES LEVEL 1 A LEVEL
     *
     * This row has no clicked line, so it renders every style the BOM's lines
     * name — which is legacy's own outer band, and the reason its `S No |
     * StyleRefNo | StyleNo | ArticleNo` header exists at all. Why the scope is
     * the STYLE rather than the fabric is on `linesOfStyle`, which is the one
     * statement of it.
     *
     * ## `done` IS A MAPPED PANEL
     *
     * Not a line, and not a fabric: this section owns the panel mapping, so a
     * BOM with three fabric lines and no component named has not been answered
     * here. Same rule Color/Print Details follows when it lights on the dia
     * rather than on the palette it reads.
     */
    {
      key: "components",
      label: "Components",
      icon: Shapes,
      done: lines.some((l) => !!l.component_id),
      /* WIDE, for Fabric Lines' reason. A panel row is Coordinate · Component ·
         Structure · Fabric Type · Fabric · GSM · Open/Tubular, and the colour
         rows beneath it carry four more cells — at the ordinary 1180px cap the
         fabric name (legacy's longest cell) wraps under its own label. */
      wide: true,
      content: (
        <SectionBody title="Components">
          {componentStyles.length === 0 ? (
            /* CONDITIONAL PROSE, the only shape a line under a heading may take
               here (`SectionBody.hint` was removed with all 51 call sites on
               2026-08-17). It names the tab that fills this one rather than
               describing the emptiness — a panel is mapped against a fabric, so
               with no fabric lines there is nothing to map. */
            <p className="text-xs text-muted-foreground">
              No fabric lines yet — add one on Fabric Lines and its panels are
              mapped here.
            </p>
          ) : (
            <div className="space-y-6">
              {componentStyles.map((st) => {
                const h = panelHandlers(st.anchor);
                return (
                  <ComponentMapBody
                    key={st.ref || "(no style)"}
                    lines={st.lines}
                    allLines={lines}
                    decls={styleDecls}
                    components={data.components}
                    coordinates={data.coordinates ?? []}
                    colourOptions={declaredColours}
                    printOptions={declaredPrints}
                    comboOptions={comboOptions}
                    structureId={st.anchor.structure_id}
                    styleRefNo={st.ref}
                    styleIdentity={styleIdentityFor(st.ref)}
                    factsFor={factsForLine}
                    /* THE MASTER, narrowed per row by `fabricStructureOfId`
                       below — see the note where `bomFabricOptions` used to be
                       for why this is no longer the BOM's own lines. */
                    fabricOptions={fabrics}
                    /* "+ Add" ON A COMPONENTS ROW OPENS THE SAME SHEET the
                       Fabric Lines cell opens, under that row's structure. The
                       same field on two tabs must behave the same way, and a
                       structure whose master holds no cloth is otherwise a dead
                       end here exactly as it would be there. */
                    onAddFabric={
                      perms.canCreate && data.fabricCreate.fabricClassId
                        ? (structureId, commit) => {
                            fabricAddCommit.current = commit;
                            setFabricAddFor(structureId);
                          }
                        : undefined
                    }
                    /* THE SAME `fabricTypeOf` the grid's Type cell, the Save gate
                       and `factsForLine` read — five readers, one function. */
                    fabricTypeOfId={fabricTypeOf}
                    /* AND THE SAME NARROWING THE FABRIC LINES CELL APPLIES
                       (client 2026-09-02) — a panel offers only cloth of its own
                       structure. One derivation for both tabs; see
                       `fabricStructureOf`. */
                    fabricStructureOfId={fabricStructureOf}
                    /* THE MASTER'S OWN FOUR (client 2026-09-02) — Solid, Yarn
                       Dyed, Printed, Melange. The same list the Fabric cell's
                       "+ Add" sheet picks from, so the vocabulary a planner can
                       narrow BY and the one they can create WITH are one list. */
                    fabricTypeOptions={fabricTypeNames}
                    onPatchPanel={h.patchPanel}
                    onPatchLine={patchLine}
                    onAddPanel={h.addPanel}
                    onRemovePanel={h.removePanel}
                  />
                );
              })}
            </div>
          )}
        </SectionBody>
      ),
    },
    {
      key: "manual",
      label: "Manual",
      icon: Ruler,
      done: entries.some((e) => manualAnswered(e) > 0),
      content: (
        <SectionBody title="Manual Consumptions">
          {/* CONDITIONAL PROSE, the only shape a line under a heading may take
              here — `SectionBody.hint` was removed with all 51 of its call sites
              on 2026-08-17, and the one surviving exception renders only while
              the state it describes is true.

              TWO STATES, TWO SENTENCES, because they send the planner to
              different places: no order, and no fabric to resolve a structure
              against. A single "nothing to show" would name neither. */}
          {!form.garment_order_id ? (
            <p className="text-sm text-muted-foreground">
              Pick a garment order under Fabric BOM first.
            </p>
          ) : (
            <>
              {/* NO "Name a fabric under Fabric Lines first" HINT (client
                  2026-09-03). It sat ABOVE a grid that renders regardless, so
                  it was a caption on working content rather than an empty
                  state — the distinction that decides which sentences on this
                  screen survived the pass. The Fabric cell inside each entry is
                  `required` and holds the cursor, and Save names the entry that
                  is short, so the fact is still enforced where it bites. */}
              {manualStyleRows.length === 0 ? (
                /* EMPTY-AND-EXPLAIN. An order with no styles is a real state and
                   an empty grid with no words is indistinguishable from one that
                   failed to load. */
                <p className="text-sm text-muted-foreground">
                  This order names no styles yet — they are entered on Orders ▸
                  Order Management ▸ Order Entry.
                </p>
              ) : (
                <ChildGrid<ManualStyleRow>
                  /* AN EMPTY `columns` ARRAY, DELIBERATELY — the shape Combos ▸
                     Structure Details and the fabric-weights grid below both
                     take, for the stated reason: this grid renders its own row
                     (`renderMobileRow`), so a declared `ChildGridColumn` could
                     never reach a cell and any `required` on one would draw a
                     star with nothing behind it (AGENTS.md). The four facts a
                     style states are read-only and are said in the pane's own
                     sentence. */
                  columns={[]}
                  rows={manualStyleRows}
                  /* READ-ONLY AS TO ROWS: a style exists because the ORDER names
                     it. `hideRemove` rather than `lockExisting`, because these
                     rows are derived and re-created on every render — the guard
                     that protects only the rows present at mount would give
                     every later one a ✕ that calls a no-op. */
                  hideAdd
                  hideRemove
                  onAdd={() => false}
                  onRemove={() => {}}
                  /* CARDS AT EVERY WIDTH. A style owns a grid of fabrics, each
                     owning a grid of sizes; there is no table row that could
                     collapse into. */
                  forceCards
                  /* ONE FRAME. The section already draws a card and the pane
                     draws its own grids — a third border per style would be the
                     client's own complaint on the sibling overlay, "one frame is
                     enough". */
                  flatRows
                  /**
                   * THE SPLIT (client 2026-09-03, screenshot 2650 — legacy's
                   * three nested levels): "design it like the split I did in
                   * order entry, instead of that fabric button".
                   *
                   * WHAT WENT: a `[Fabrics 0/2]` cell that opened a full-bleed
                   * Sheet over the whole editor. It was one door too many — the
                   * planner is already inside the Manual tab, and what was
                   * behind the door is the only thing this tab is for.
                   *
                   * `foldRows` decides that ONE style is open at a time;
                   * `masterDetail` decides where the others go — a 268px list
                   * beside the open one rather than stacked above and below it.
                   * That is the same pair, in the same order, that the client
                   * chose for Material BOM's lines on 2026-08-20.
                   *
                   * BOTH ARE `ChildGrid`'s, and that is the whole reason this is
                   * two props rather than a hand-rolled two-pane div: the open
                   * row keeps its `data-grid-row` inside the same
                   * `data-grid-body`, so `gridKeyNav`, `tabAlongRow`, the
                   * required-holds and Ctrl+Del all still find it. A screen that
                   * built its own split would lose every one of those — the
                   * exact failure AGENTS.md records for the ~22 hand-rolled
                   * grids.
                   *
                   * A SINGLE-STYLE ORDER SEES NO LIST AND NO FOLD. `mdActive`
                   * carries `rows.length > 1` and so does `folded`, so the
                   * ordinary order — one style, the Order Info default — opens
                   * straight into its fabrics with nothing to click first.
                   */
                  foldRows
                  masterDetail
                  renderListItem={(row) => {
                    /* INERT BY CONTRACT — see `renderListItem` on the grid.
                       Text, a dot and a count; nothing focusable, because the
                       fields live in the pane next door. */
                    const mine = entriesForStyle(row.style_ref_no);
                    const answered = mine.filter((e) => manualAnswered(e) > 0).length;
                    /* THREE STATES AND THE DOT SAYS WHICH. Amber is the one
                       that matters: this style has fabrics and not all of them
                       carry a weight yet — which is invisible from out here,
                       because every style looks identical. */
                    const state =
                      mine.length === 0 ? "idle" : answered === mine.length ? "ok" : "warn";
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
                          <Truncated className="block text-[12.5px] font-medium leading-tight text-foreground">
                            {row.unscoped ? "Every style" : row.style_ref_no || "—"}
                          </Truncated>
                          <Truncated className="block text-[10px] leading-tight text-muted-foreground">
                            {[row.style_no, row.article_no].filter(Boolean).join(" · ") || "—"}
                          </Truncated>
                        </span>
                        {/* HOW MANY OF THIS STYLE'S FABRICS ARE ANSWERED — the
                            one fact the old [Fabrics 2/3] button carried, kept
                            where it still earns its place. */}
                        <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
                          {mine.length ? `${answered}/${mine.length}` : "0"}
                        </span>
                      </div>
                    );
                  }}
                  /* REQUIRED BY `foldRows` AND NEVER RENDERED WHILE THE SPLIT IS
                     ON. `child-grid.tsx` computes `folded` from this prop being
                     present and then returns null for a folded row, because the
                     list pane above IS the folded rows. It is written honestly
                     rather than as `() => null`: turn `masterDetail` off and
                     this is what a closed style has to say. A style row carries
                     no field of its own to keep here — every one of its four
                     facts is the order's — which is a second reason the split
                     is the right treatment for this level and stacking is not. */
                  renderFoldedRow={(row) => (
                    <div className="cursor-pointer text-sm font-medium">
                      {row.unscoped ? "Every style" : row.style_ref_no || "—"}
                    </div>
                  )}
                  renderMobileRow={manualStylePane}
                />
              )}
            </>
          )}
        </SectionBody>
      ),
    },
    /**
     * YARN PROCESS (0493) — "does this yarn need treating before it is knitted,
     * and how much of it must be bought?"
     *
     * ## WHY IT SITS BEFORE FABRIC PROCESS
     *
     * Legacy's own tab order, and the material's: YarnProcess then FabricProcess
     * (client screenshot 2587, where the two sit side by side in that order).
     * Yarn is spun, dyed and wound BEFORE it is knitted, so a rail putting the
     * cloth's route first would read backwards to anyone who works the floor.
     * Both sections come after Fabric Lines, because both derive their rows from
     * the fabrics named there — except that this one also READS Calculated
     * Quantities, which is the one thing about its position that is not obvious.
     * The rail's order is the operator's reading order, not a dependency graph.
     *
     * ## THE ROWS ARE NOT EDITABLE AS A LIST, AND THAT IS THE POINT
     *
     * `ProcessFoldList` offers no "+ Add" and no row ✕ at all — it is a list of
     * SUBJECTS, and every one of them is derived. That enforces a client rule
     * rather than a display choice: "the developer must ensure the planner
     * cannot manually add new yarns here; the rows are strictly populated based
     * on the mapped technical fabrics." It replaced `ChildGrid`'s `hideAdd` +
     * `lockExisting` pair, which said the same thing by withholding two
     * affordances the list never had a reason to grow.
     *
     * What is live is what is INSIDE a yarn — its treatments, one open at a
     * time. What is locked is the membership of the list.
     *
     * ## `done` IS "SOMETHING HAS BEEN ANSWERED", NOT "EVERY ROW IS FILLED"
     *
     * A solid order's correct answer is a blank process on every line, so
     * requiring a full grid would light the dot only for yarn-dyed work. Nothing
     * here blocks Save either — see the `sections` array above.
     */
    {
      key: "yarns",
      label: "Yarn Process",
      icon: Spool,
      done: yarnRows.some(yarnRowAnswered),
      content: (
        <SectionBody title="Yarn Process">
          {/* CONDITIONAL, THE ONLY SHAPE A LINE UNDER A HEADING MAY TAKE HERE
              (`SectionBody.hint` was removed with all 51 of its call sites on
              2026-08-17). Three different empty states reach this tab and they
              are fixed on three different screens, so a single "no yarns"
              sentence would send two thirds of the planners to the wrong one. */}
          {!lines.some((l) => l.item_id) ? (
            <p className="text-sm text-muted-foreground">
              Name a fabric on Fabric Lines first — the yarns come from what each
              fabric is made of.
            </p>
          ) : !comp ? (
            <p className="text-sm text-muted-foreground">Reading the compositions…</p>
          ) : yarnRows.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              None of these fabrics declares a composition, so there are no yarns
              to plan. Add the Mixing rows on Master Data ▸ Materials.
            </p>
          ) : (
            <ProcessFoldList<YarnRow>
              columns={yarnColumns}
              rows={yarnRows}
              openKey={openYarnId}
              onToggle={setOpenYarnId}
              /* NO `foldHeader` / `foldSummary` — the client took the Treatments
                 column and its chevron off this list on 2026-09-03 ("the field
                 just list by click, no need icon for listing"). The whole line
                 opens the panel instead, and `ProcessFoldList` moves
                 `data-row-open` onto it so Tab and Enter still reach the grid;
                 a fold that only a mouse can open is the defect AGENTS.md
                 records for Material Attributes.

                 THE FABRIC ROUTE BELOW KEEPS ITS COLUMN, deliberately. Only this
                 list was named, its summary said "No treatment" in a tab whose
                 vocabulary is now "process", and its rows are two facts where
                 the fabric's are five. */
              renderPanel={yarnPanel}
            />
          )}

          {/* NO TRAILING SENTENCE. There was one — it said each weight is the
              fabric requirement for that yarn's share of the cloth plus its
              process loss, and that recording the BOM sends them to Budgeting as
              the Yarn Purchase lines — and the client removed it on 2026-09-03,
              in the same pass that took the Yarn Purchase Wt column off the
              list.

              THE TWO REMOVALS AGREE, which is why this is not a loss of an
              explanation the tab still needed: with no weight on screen, a
              paragraph describing how that weight is computed explains a figure
              the planner cannot see. It is also the de-clutter rule — a heading
              gets no sentence — which this section was the last holdout of.

              The fact itself is not lost: `writeYarns` still computes and stores
              the purchase weight, and the Budget's Yarn Purchase section is
              where it now speaks for itself. Do not restore this without the
              column. */}
        </SectionBody>
      ),
    },
    /**
     * ---------------- Fabric Process (0492) ----------------
     *
     * The legacy screen's **FabricProcess** tab (client screenshot 2588): each
     * fabric on this BOM and, beneath it, the steps it runs — GREY ▸ KNITTING,
     * DYED ▸ DYEING [WITH BIOWASH] — with a Loss % against each.
     *
     * ## THE FABRIC ROWS ARE READ, WHICH IS THE SAME CALL 0490 ALREADY MADE
     *
     * Legacy's outer "Fabric Detail" grid re-states the fabric's description,
     * both its types, its colourways and its panels — every one of which is
     * already on the Fabric Lines section above or on the order, and this screen
     * only mirrors. A second EDITABLE copy would be a second place for one BOM
     * to disagree with itself, which is the argument `getOrderPalette` makes for
     * the three read-only palette panels and 0491 repeats for the Manual tab's
     * first two levels. So a fabric is a row of VALUES here, never of inputs.
     *
     * ## IT IS NOW LEGACY'S ROW RATHER THAN A CARD (client 2026-09-03)
     *
     * This tab drew a per-fabric card — a bold name, a muted subtitle listing
     * the same four facts, and the route grid always open beneath it. Both
     * halves were reported: the facts were not COLUMNS, so two fabrics could not
     * be read against each other, and six routes drawn at once is a wall rather
     * than a list. `ProcessFoldList` is the answer to both, and it is one
     * component with the Yarn Process tab rather than two accordions — see
     * `fabricRouteColumns` for the field mapping and the component's own header
     * for why the panel could not be a `ChildGrid` prop.
     *
     * The earlier note here reasoned that a read-only outer row ruled out both
     * `[Click]`→Sheet and `ChildGrid`'s `foldRows`. That reasoning still holds
     * and is what the new component works around rather than waives: the fold
     * lives on a `data-row-open` chevron, which IS a field by `ROW_FIELDS`, so
     * the row has exactly the one Tab stop `foldRows` demanded and could not get
     * from a row of plain text.
     *
     * ## `done` IS "A ROUTE EXISTS", NOT "EVERY FABRIC HAS ONE"
     *
     * A fabric bought finished and cut runs no route at all, so requiring one
     * per line would light the dot only on documents that happen not to contain
     * such a fabric. Nothing here blocks Save for the same reason — see the
     * `sections` array above.
     */
    {
      key: "process",
      label: "Fabric Process",
      icon: Waypoints,
      done: procs.some((p) => !!p.process_id),
      content: (
        <SectionBody title="Fabric Process">
          {/* CONDITIONAL, THE ONLY SHAPE A LINE UNDER A HEADING MAY TAKE HERE —
              `SectionBody.hint` was removed with all 51 of its call sites on
              2026-08-17, and the surviving exception renders only while the
              state it describes is true. This section is DERIVED from the
              fabric lines, so with none named there is nothing to head a card
              with, and an empty pane would read as unbuilt (the failure
              screenshot 2580 recorded for the palette panels). The door is
              named rather than the emptiness described. */}
          {fabricRouteRows.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Name a fabric on Fabric Lines first — each one gets its own route
              here.
            </p>
          ) : (
            <ProcessFoldList<FabricRouteRow>
              columns={fabricRouteColumns}
              rows={fabricRouteRows}
              openKey={openFabricId}
              onToggle={setOpenFabricId}
              foldHeader="Process"
              /* WHAT A SHUT FOLD SAYS — `routeStepCount` rather than the row
                 count, because a half-typed step is not a step. "No route yet"
                 is a complete answer: a fabric bought finished and cut runs
                 none, which is why nothing here blocks Save. */
              foldSummary={(r) => {
                const steps = routeStepCount(
                  procs.filter((p) => p.item_id === r.item_id),
                );
                return steps ? `${steps} step${steps === 1 ? "" : "s"}` : "No route yet";
              }}
              renderPanel={(r) => (
                <FabricProcessGrid
                  itemId={r.item_id}
                  rows={procs.filter((p) => p.item_id === r.item_id)}
                  onChange={(next) => setFabricProcs(r.item_id, next)}
                  processes={data.processes}
                  lookups={data.processLookups}
                  /* THE SCREEN'S OWN GENERATOR, so a route added to a
                     reopened BOM cannot collide with the keys `openExisting`
                     has already issued. */
                  newKey={newKey}
                  /* The HOST screen's permissions standing in for "may I
                     maintain this shared code list" — the model every
                     `LookupDialogPicker` call site in this app uses. */
                  canCreate={perms.canCreate}
                  canEdit={perms.canEdit}
                  readOnly={!perms.canEdit && !perms.canCreate}
                />
              )}
            />
          )}

          {/* NO TRAILING SENTENCE, matching Yarn Process above it (client
              2026-09-03, the same pass). It said where the loss goes — that
              step 4 plans these on Fabric Plan and that they do not move the
              quantities this BOM computes, because 0426 reserves process loss
              for step 4 and "applying it here as well charges the same loss
              twice".

              THAT RULE IS STILL TRUE AND IS STILL WRITTEN DOWN, in 0426 and in
              `requirement.ts`. What went is a paragraph on the operator's
              screen, not the reasoning. Both process tabs now end at their grid,
              which is what "remove this unnecessary wording from each tab top"
              asked for; restore neither without the other. */}
        </SectionBody>
      ),
    },
  ];

  // ---- saving --------------------------------------------------------------

  function submit(asDraft: boolean) {
    if (!form.garment_order_id) return;
    const payload = {
      garment_order_id: form.garment_order_id,
      bom_date: form.bom_date,
      is_draft: asDraft,
      // See the `Form` type: the field is gone from the screen, the column is
      // kept, and the payload stops carrying a value nothing collects.
      remark: null,
      lines: lines.map((l, i) => ({
        sno: i + 1,
        style_ref_no: l.style_ref_no || null,
        combo: l.combo || null,
        structure_id: l.structure_id,
        coordinate_id: l.coordinate_id,
        component_id: l.component_id,
        item_id: l.item_id,
        fabric_type: l.fabric_type || null,
        color_name: l.color_name || null,
        fabric_form: (l.fabric_form || null) as "open" | "tubular" | null,
        required_print: l.required_print || null,
        specification: l.specification || null,
        mixing_uom_id: l.mixing_uom_id,
        no_of_colors: l.no_of_colors,
        consumption_uom_id: l.consumption_uom_id,
        notes: l.notes || null,
      })),
      /* THE ORDER'S PALETTE, WHICH IS THE ONE KEY HERE THAT DOES NOT WRITE THIS
         DOCUMENT (client 2026-09-02). It writes
         `garment_order_amendment_dyeings` / `_prints` — see `writePalette` in
         the action and `lib/orders/fabric-bom/palette.ts`.

         `undefined` UNTIL THE PALETTE HAS LOADED, and that is load-bearing
         rather than defensive. The schema treats an absent key as "not my
         business" and an EMPTY ARRAY as "the operator emptied this panel", so
         sending `[]` while the fetch was still in flight would ask the server to
         delete the order's entire palette — on every save made in the first
         moments after an order is picked. `paletteEdit` is null in exactly that
         window, and null is what makes the key absent.

         SENT WHOLE, blanks included, like `dias` below: `paletteDiff` drops
         them. Two places deciding what counts as an empty row is how the form
         and the database come to disagree. */
      palette: paletteEdit
        ? {
            fabric: paletteEdit.fabric.map((r) => r.value),
            yarn: paletteEdit.yarn.map((r) => r.value),
            prints: paletteEdit.prints.map((r) => r.value),
          }
        : undefined,
      /* SENT WHOLE AND FILTERED ON THE SERVER (`normalizeDias`), never trimmed
         here. Two places deciding what counts as an empty row is how the form
         and the database come to disagree about how many rows were saved — the
         division `normalizeLines` already draws, and the reason the blank row a
         grid opens with is harmless. */
      /* THE YARN DYED PANELS (0512) — every row, not just the open group's:
         this payload replaces the document, and sending one group's rows would
         delete every other fabric's. `ydRepeatFilled` in actions.ts drops the
         blank rows the grid opened. */
      yd_repeats: ydRepeats.map((r, i) => ({
        style_ref_no: r.style_ref_no || null,
        structure_id: r.structure_id,
        item_id: r.item_id,
        sno: i + 1,
        yarn_item_id: r.yarn_item_id,
        dye_type: r.dye_type,
        color_name: r.color_name || null,
        uom_id: r.uom_id,
        value: r.value,
        twisted_yarn: r.twisted_yarn || null,
      })),
      yd_combinations: ydCombinations.map((r) => ({
        style_ref_no: r.style_ref_no || null,
        structure_id: r.structure_id,
        item_id: r.item_id,
        combo: r.combo || null,
        yd_combo_name: r.yd_combo_name || null,
      })),
      dias: dias.map((d, i) => ({
        sno: i + 1,
        knit_type: (d.knit_type || null) as "circular" | "flat_knit" | "woven" | null,
        dia: numOrNull(d.dia),
      })),
      /* THE COUNTING UNIT (0494). Sent WHOLE — blank sizes included — and
         filtered by `normalizeManualEntries` on the server, the same division
         `dias` above records. Most size rows are legitimately empty on an entry
         the planner has not worked through, and trimming here would put a second
         opinion about "empty" in front of the server's.

         `calc_mode` IS NARROWED THROUGH THE OWNING MODULE'S OWN FUNCTION, not
         cast: `ManualEntryRow` holds a `string`, and a cast would let a third
         word through the form to fail in Zod. */
      manualEntries: entries.map((e, i) => ({
        sno: i + 1,
        style_ref_no: e.style_ref_no.trim() || null,
        width_form: (e.width_form || null) as "open_width" | "tubular" | null,
        item_id: e.item_id,
        /* SENT, THOUGH THE SERVER OVERWRITES IT from the fabric (0522). It is
           still the honest value to send: on an entry whose cloth the master
           cannot resolve, this is the structure the row was last known by. */
        structure_id: e.structure_id,
        calc_mode: calcModeOf(e.calc_mode),
        wastage_pct: numOrNull(e.wastage_pct) ?? 0,
        endbit_loss_pct: numOrNull(e.endbit_loss_pct) ?? 0,
        assort_color_wise: e.assort_color_wise,
        size_wise: e.size_wise,
        component_ids: e.component_ids,
        sizes: e.sizes.map((z, zi) => ({
          sno: zi + 1,
          size_id: z.size_id,
          dia: numOrNull(z.dia),
          purchase_width: numOrNull(z.purchase_width),
          /* THE STORED WEIGHT, whichever mode produced it. `gramsFor` is what
             makes a calculated entry indistinguishable to every downstream
             reader — see 0494's header. */
          grams: gramsFor(
            e.calc_mode,
            {
              size_id: z.size_id,
              dia: numOrNull(z.dia),
              purchase_width: numOrNull(z.purchase_width),
              grams: numOrNull(z.grams),
              table_width: numOrNull(z.table_width),
              length: numOrNull(z.length),
              length_tolerance: numOrNull(z.length_tolerance),
      cons_qty: numOrNull(z.cons_qty),
            },
            gsmForStructure(e.structure_id),
          ),
          table_width: numOrNull(z.table_width),
          length: numOrNull(z.length),
          length_tolerance: numOrNull(z.length_tolerance),
      cons_qty: numOrNull(z.cons_qty),
          finished_width: numOrNull(z.finished_width),
        })),
      })),
      /* THE ROUTES (0492), a plain sibling of `dias` — they name their fabric by
         `item_id`, so nothing has to resolve them against the lines. Sent WHOLE
         and renumbered on the server: `normalizeProcesses` decides which steps
         are worth storing and which fabrics still exist, on the same "never trim
         in the form" division the note above states. `sno` here is only the
         order within the array; the server renumbers per fabric, which is what
         `uq_ofbp_item_sno` needs. */
      processes: procs.map((p, i) => ({
        item_id: p.item_id,
        sno: i + 1,
        stage_id: p.stage_id,
        process_id: p.process_id,
        loss_for_id: p.loss_for_id,
        description: p.description || null,
        loss_pct: numOrNull(p.loss_pct),
        /* NO `rate` — the client removed the column on 2026-09-03 and it went
           from the row, the schema and the table with it (0521). */
        type_id: p.type_id,
      })),
      /* THE YARN ROWS AND THEIR TREATMENTS, DERIVED AND THEN SENT (0493 · 0504).
         `yarnRows` is not form state — it is the fabrics' compositions with the
         planner's treatments attached — so this sends what is ON SCREEN rather
         than a second derivation. Every yarn goes: there is nothing to filter at
         that level, because a row exists only because a fabric declares it. The
         STAGES are filtered server-side, on the same `yarnStageStarted` the grid
         uses to decide whether a row's cells hold the cursor.

         NEITHER WEIGHT IS IN THE PAYLOAD. The action recomputes the yarn's
         purchase and each treatment's processed quantity server-side, from the
         requirement it is storing in the same write (`writeYarns`) — so a figure
         the Budget prices is never one a client sent. */
      yarns: yarnRows.map((r, i) => ({
        sno: i + 1,
        item_id: r.item_id,
        stages: r.stages.map((st, j) => ({
          sno: j + 1,
          stage_id: st.stage_id,
          process_id: st.process_id,
          /* THE `For` LOOKUP (0520). Already null when unset — no coalesce to
             get wrong, which is the small gain of an id over the free text this
             replaced. */
          loss_for_id: st.loss_for_id,
          description: st.description || null,
          loss_pct: numOrNull(st.loss_pct),
        })),
      })),
    };
    start(async () => {
      const res = editId
        ? await updateFabricBom(editId, payload)
        : await createFabricBom(payload);
      if (res.ok) {
        success(editId ? "Fabric BOM updated" : "Fabric BOM created");
        setDirty(false);
        setMode("list");
        router.refresh();
      } else {
        toastError(res.error);
      }
    });
  }

  function remove(bomId: string) {
    start(async () => {
      const res = await deleteFabricBom(bomId);
      if (res.ok) {
        success("Fabric BOM deleted");
        router.refresh();
      } else {
        toastError(res.error);
      }
    });
  }

  // ---- the queue -----------------------------------------------------------

  /**
   * THE MIDDLE FIGURE ON THIS QUEUE'S CARDS — everything else about the queue is
   * `BomQueue`'s (`components/orders/bom-queue.tsx`), shared with Material BOM.
   *
   * LINES, WHERE MATERIAL BOM COUNTS STYLES, and it is the one figure that is
   * genuinely about WHICH BOM this is. A fabric BOM is a list of fabric lines;
   * "3 lines" on a Draft card is what tells an operator returning to a half-done
   * plan how far they got, and it is the column this list carried as a table.
   * The style count is on the row too and is the order's fact, not the plan's.
   */
  const lineStat = (t: BomTaskRow): CardStat => ({
    label: "Lines",
    value: t.bom_line_count,
  });

  return (
    <>
      <div className="space-y-4">
        {/* THE PRIMARY ACTION SITS BESIDE THE TITLE, NOT IN A BAND OF ITS OWN.
            It was a right-aligned div sharing a row with the search box, which
            is the shape `--check toolbar-size` recognises as a header row — so
            the h-9 rule was enforced there and the button still stood alone,
            80px from anything it related to, while the search box ended at 25%
            of the width. `actions` puts it where Material BOM's is. */}
        <PageHeader
          title="Fabric BOM"
          description="Step 3 — fabric per component and colour, with the net requirement each order implies."
          actions={
            perms.canCreate ? (
              <Button size="md" onClick={() => openNew(null)}>
                + New Fabric BOM
              </Button>
            ) : undefined
          }
        />

        {/* THE QUEUE IS MATERIAL BOM'S QUEUE (client screenshot 2590,
            2026-09-01: "this screen also like the material bom listing … not
            like this list").

            NOT A COPY OF IT — the component. This screen and Material BOM ask
            one question about two documents and already share the row, the
            status vocabulary and the sort; the drawing was the only half that
            was hand-rolled twice, and so it was the only half that drifted. The
            search box, the counted Status facet, the summary sentence, the
            six-across cards and the Created pair all live in `BomQueue` now, so
            the next instruction about a BOM queue reaches both screens without
            either being edited. */}
        <BomQueue
          tasks={tasks}
          noun="fabric"
          stat={lineStat}
          onOpen={openTask}
          canDelete={perms.canDelete}
          /* `bom_id` is non-null here by `canDeleteRow` — a Pending row has no
             document, and the card hides the ✕ on exactly those. */
          onDelete={(t) => remove(t.bom_id as string)}
          isPending={isPending}
        />
      </div>

      <MasterFullScreen
        ref={shellRef}
        mount="overlay"
        open={mode === "edit"}
        onClose={() => setMode("list")}
        modeLabel={
          <>
            {editId ? "Editing" : "New"}{" "}
            <span className="font-semibold text-foreground">fabric BOM</span>
          </>
        }
        header={{
          initials: "FB",
          title: pickedOrder?.code ?? (editId ? "Fabric BOM" : "New fabric BOM"),
          badges: dirty ? (
            <span className="text-[11px] font-medium text-warning">● Unsaved</span>
          ) : null,
          meta: (
            <>
              {pickedOrder?.customer_name && <span>{pickedOrder.customer_name}</span>}
              {/* THE ORDER'S STYLE IDENTITY, read-only and never typed. Each
                  piece renders only when the order states it — the de-clutter
                  rule's "an unfilled field shows NOTHING", which in a meta line
                  means no orphan separator either. */}
              {orderIdentity?.ref && <span>· {orderIdentity.ref}</span>}
              {orderIdentity?.style && <span>· {orderIdentity.style}</span>}
              {orderIdentity?.article && <span>· {orderIdentity.article}</span>}
              {/* THE ORDER UNIT — Pcs, or Sets on a set-pack order (client spec
                  point 8, moved here from a line column on the client's call,
                  2026-09-01).

                  A DOCUMENT FACT BELONGS IN THE DOCUMENT HEADER. One BOM covers
                  one order (`uq_order_fabric_bom_order`), so as a column it
                  printed the same word on every row and told the planner
                  nothing they could not read once — the "redundant legacy
                  columns… if already in the header" rule, arriving from the
                  other direction. Lifting it also handed its 3.5rem back to
                  `Fabric`, which is the cell that actually needed the width.

                  NOT TO BE CONFUSED WITH the line's `Unit` cell: that is
                  `consumption_uom_id`, KGS or MTR, the unit the fabric
                  REQUIREMENT is expressed in. This one counts GARMENTS. */}
              {pickedOrder?.unit_kind && (
                <span>· {pickedOrder.unit_kind === "sets" ? "Sets" : "Pcs"}</span>
              )}
              {form.bom_date && <span>· {fmtDate(form.bom_date)}</span>}
              {/* COUNTS WHAT THE TAB DRAWS — allocations, not panels.
                  `filledLines` counts PANELS carrying a fabric and stays the
                  right input to the Save gate, which cares about every line it
                  writes. Printing it here made the header say "7 fabric lines"
                  above a grid showing 6 rows: one fact counted two ways, and the
                  one on the chrome is the one the operator checks their work
                  against. */}
              <span>
                · {filledAllocations} fabric {filledAllocations === 1 ? "line" : "lines"}
              </span>
            </>
          ),
        }}
        sections={sections}
        footer={{
          status: dirty ? "Unsaved changes" : editId ? "All changes saved" : "New fabric BOM",
          onCancel: () => setMode("list"),
          onSave: () => submit(false),
          saveLabel: "Save fabric BOM",
          canSave: validity.canSave,
          onBlockedSave: revealFirstProblem,
          onSaveDraft: perms.canCreate ? () => submit(true) : undefined,
          isPending,
        }}
      />


      {/**
       * THE COMPONENTS [Detail] SHEET (0495) — legacy's third tab, minus the two
       * outer levels our line already carries.
       *
       * MOUNTED HERE, AT THE EDITOR ROOT, and NOT inside the grid cell that
       * opens it. `ChildGrid` wraps every cell in a `RequiredScope` and that
       * scope follows the RENDER tree, so a Sheet rendered from inside a cell
       * would have every optional field within it inherit "required", stamp
       * `data-required-empty` and hold the cursor — the New Yarn / Purity defect
       * (2026-08-06). `Sheet` resets the scope at its portal boundary, which
       * only helps if the Sheet is what is being portaled. The Manual sheet
       * above is mounted here for the same reason.
       *
       * NO SAVE OF ITS OWN. The mapping is part of the BOM's own lines and is
       * written by this screen's Save; a second Save here would imply the
       * panels commit on their own, which they do not — and on a new BOM there
       * is no id to commit against. Closing is Escape or ✕, one layer per press.
       */}
      <YarnDyedSheet
        open={!!detailLine}
        onClose={() => setDetailKey(null)}
        /* The [Detail] button that opened this — see `detailOrigin`. */
        origin={detailOrigin}
        /* THE CLOTH IS THE SUBJECT — and it changed back on 2026-09-02.
           It named the fabric, then the STYLE while this popup carried the
           components tree (which is per style), and now the fabric again,
           because that tree has moved to the Components rail section and
           everything left in here is about one cloth's yarn: `mixingDetailRows`
           reads THAT fabric's composition and the Repeats are scoped to it. On
           an order whose style uses several cloths a style-named title would
           name the wrong one. */
        title={`Yarn Dyed Details${
          detailLine
            ? ` — ${
                fabrics.find((f) => f.id === detailLine.item_id)?.name ??
                "(no fabric)"
              }`
            : ""
        }`}
        /* THE COUNT THE PLANNER DECLARED ON THE LINE (0513), so the panels can
           say when it disagrees with what has actually been mapped. Advisory —
           see `colourCountNote`. */
        declaredColourCount={detailLine?.no_of_colors ?? null}
        ydRepeats={detailYd.repeats}
        ydCombinations={detailYd.combinations}
        yarnOptions={ydYarnOptions}
        uomOptions={data.uoms}
        comboOptions={comboOptions}
        composition={detailYd.composition}
        yarnName={ydYarnName}
        uomName={ydUomName}
        onPatchYdRepeat={patchYdRepeat}
        onAddYdRepeat={detailYd.addRepeat}
        onRemoveYdRepeat={removeYdRepeat}
        onPatchYdCombination={patchYdCombination}
        onAddYdCombination={detailYd.addCombination}
        onRemoveYdCombination={removeYdCombination}
      />

      {/**
       * "+ ADD" ON THE FABRIC CELL (client 2026-09-02, "with the crud action").
       *
       * MOUNTED AT THE EDITOR ROOT, not inside the grid cell that opens it —
       * `ChildGrid` wraps every cell in a `RequiredScope` and that scope follows
       * the RENDER tree, so a Sheet rendered from a cell would have every
       * OPTIONAL field inside it inherit "required", stamp `data-required-empty`
       * and hold the cursor. That is the New Yarn / Purity defect (2026-08-06),
       * and this sheet is opened from a cell of a MANDATORY column, which is
       * exactly the shape that triggered it. The Manual and [Detail] sheets are
       * mounted here for the same reason.
       */}
      {/* LEGACY'S [Click] ▸ Components (client 2026-09-03, screenshot 2667).
          The multi-select that used to sit ON the fabric row, behind the door
          legacy puts it behind — which is also what let the row hold legacy's
          other twelve columns.

          A SHEET, NOT A NESTED PANEL, and the required scope is why. `ChildGrid`
          wraps cells in a `RequiredScope` that follows the RENDER tree, and this
          control is rendered from inside a mandatory cell; `Sheet` resets the
          scope at its portal boundary, which is the fix AGENTS.md records for
          the New Yarn / Purity defect (2026-08-06). */}
      {componentsForEntry &&
        (() => {
          const fabricName =
            fabrics.find((f) => f.id === componentsForEntry.item_id)?.name ??
            "(no fabric named)";
          /* SAME LOOKUP THE TOP-OF-SCREEN BAND USES for the identical three
             fields (`styleIdentityFor`) — Style Ref No / Style No / Article No,
             read-only, legacy's own header above the "Colors Details" grid
             (screenshot 2680). */
          const identity = styleIdentityFor(componentsForEntry.style_ref_no);
          const options = componentOptionsFor(componentsForEntry);
          const selected = new Set(componentsForEntry.component_ids);
          const toggle = (id: string) =>
            setEntryCell(componentsForEntry.key, {
              component_ids: selected.has(id)
                ? componentsForEntry.component_ids.filter((x) => x !== id)
                : [...componentsForEntry.component_ids, id],
            });
          return (
            <Sheet
              open
              onClose={() => setComponentsFor(null)}
              title={`Components — ${fabricName}`}
              /* `sm`, NOT `md` — same correction as the Widths sheet below,
                 same reason (operator, screenshot 2690: "no need this much
                 field size"). `md`'s `max-w-6xl` left the unbounded
                 `Component` column free to stretch across ~700px of blank
                 row for text no longer than "BOTTOM RIB". This is a
                 hand-rolled `<table>`, not a `ChildGrid`, so it carries none
                 of the responsive-breakpoint risk that keeps Style ▸ Process
                 on `md` — see the note on the Widths sheet's `size` for the
                 full reasoning. */
              size="sm"
              /* CENTRED OVER THE CONTENT PANE, NOT THE VIEWPORT, and GROWS OUT
                 OF THE BUTTON THAT OPENED IT — the same two props Style ▸
                 Process sets for the same reason (its own comments record
                 both client asks in full); applied here on the operator's
                 instruction to use "that mechanism for all this kind of
                 inside button screen". */
              alignToPane
              origin={componentsOrigin}
              /* NO SAVE OF ITS OWN — `component_ids` is written straight onto
                 `entries` and the whole BOM saves together, the same shape
                 Style ▸ Process is in. A sheet with fields and no footer at
                 all is the exact thing the client already reported once as
                 "missing save button" (`SubSheetFooter`'s own history); this
                 says what actually happens instead of leaving it to be
                 guessed. */
              footer={<SubSheetFooter onDone={() => setComponentsFor(null)} parent="fabric BOM" />}
            >
              <div className="space-y-4">
                <div className="grid grid-cols-3 gap-3 text-sm">
                  <div>
                    <div className="text-xs text-muted-foreground">Style Ref No</div>
                    <div>{identity?.ref || componentsForEntry.style_ref_no || "—"}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">Style No</div>
                    <div>{identity?.style || "—"}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">Article No</div>
                    <div>{identity?.article || "—"}</div>
                  </div>
                </div>
                {/* LEGACY'S "Colors Details" GRID — Coordinate | Component | a
                    checkbox, one row per component the style still has to give
                    (screenshot 2680: PIECES | FRONT BODY1 | ✓). A fixed list
                    with a check per row, not `ChildGrid`: nothing here is added
                    or removed as a ROW — the row set is `componentOptionsFor`,
                    and a click only flips membership in `component_ids`. */}
                <div className="overflow-x-auto rounded-md border">
                  <table className="w-full table-fixed border-collapse text-sm">
                    <thead>
                      <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                        {/* `w-20`, TRIMMED FROM `w-28` — now that the sheet
                            itself is `sm` (448px, not `md`'s 1152px), every
                            pixel Coordinate keeps is a pixel Component does
                            not get, and Coordinate holds nothing longer than
                            a short code ("PIECES") where a style has one. */}
                        <th className="w-20 px-3 py-2 font-medium">Coordinate</th>
                        <th className="px-3 py-2 font-medium">Component</th>
                        <th className="w-10 px-3 py-2 text-center font-medium">✓</th>
                      </tr>
                    </thead>
                    <tbody>
                      {options.length === 0 ? (
                        <tr>
                          <td colSpan={3} className="px-3 py-4 text-center text-muted-foreground">
                            {/* A STATE OF THE RECORD, which is the one thing a
                                placeholder may still say. With every panel
                                taken by another entry ON THIS STYLE there is
                                genuinely nothing to choose, and an empty grid
                                with no words reads as broken rather than as
                                the rule working. */}
                            Every component is already used on this style
                          </td>
                        </tr>
                      ) : (
                        options.map((o) => (
                          <tr key={o.id} className="border-b last:border-b-0">
                            <td className="px-3 py-2 text-muted-foreground">
                              <Truncated>
                                {coordinateForComponent(o.id, componentsForEntry.style_ref_no) ||
                                  "—"}
                              </Truncated>
                            </td>
                            <td className={cn("px-3 py-2", o.inactive && "text-muted-foreground")}>
                              <Truncated>
                                {o.label}
                                {o.inactive ? " (inactive)" : ""}
                              </Truncated>
                            </td>
                            <td className="px-3 py-2 text-center">
                              <input
                                type="checkbox"
                                className="h-4 w-4 accent-primary"
                                aria-label={o.label}
                                checked={selected.has(o.id)}
                                onChange={() => toggle(o.id)}
                              />
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
                {/* WHY A PANEL CAN ONLY BE HERE ONCE, said where the grid
                    refuses. It is arithmetic and not tidiness: entries are the
                    counting unit, so the garment's fabric weight is their sum,
                    and that sum is only right while the entries partition the
                    panels. */}
                <p className="text-xs text-muted-foreground">
                  A component belongs to one fabric entry per style — the weights are
                  summed, so a panel counted twice is its cloth bought twice.
                </p>
              </div>
            </Sheet>
          );
        })()}

      {/* LEGACY'S [Click] ▸ "Width Details" (screenshot 2681) — Style No /
          Article No / Fabric, then a size-wise "Consumption Size Details"
          grid. Legacy prints all eight columns, but the operator's own
          correction (2026-09-03, minutes after 0525 shipped the first two as
          the real pair) is that only TWO are real: Finished Width and
          Purchase Width. 0525's `roll_width` / `roll_width_tolerance` were
          the wrong reading and were reverted the same day (0526) — dropped
          from the database, not left unused. The other five legacy columns
          (Width, Width Tolerance, the second Width, Calculated Width, Width
          For Calc) are not drawn at all: every value in the reference
          screenshot is 0.00, with no worked example, and this tab does not
          invent a formula from a screenshot of zeros ("a screenshot cannot
          show a grain", manual.ts's own header). */}
      {widthsForEntry &&
        (() => {
          const fabricName =
            fabrics.find((f) => f.id === widthsForEntry.item_id)?.name ?? "(no fabric named)";
          const rows = manualSizeRows(widthsForEntry);
          const set = (r: ManualDisplayRow, patch: Partial<ManualSizeRow>) => {
            if (widthsForEntry.size_wise) return setSizeCell(widthsForEntry.key, r, patch);
            for (const row of manualSizeRows(widthsForEntry)) setSizeCell(widthsForEntry.key, row, patch);
          };
          return (
            <Sheet
              open
              onClose={() => setWidthsFor(null)}
              title={`Widths — ${fabricName}`}
              /* `sm`, NOT `md` — the operator's own "just field fit screen"
                 (2026-09-03, screenshot 2687: `md`'s `max-w-6xl` still left a
                 huge blank pane beside a ~370px table). Style ▸ Process next
                 door stays on `md` for a REASON THAT DOES NOT APPLY HERE:
                 its grid is a `ChildGrid`, whose responsive table only
                 switches in from a ~512px container, so `sm`'s `max-w-md`
                 (448px, ~408px of content) dropped it to stacked cards with
                 no column headers (client 2026-08-12, screenshot 2266) — the
                 exact fault that note warns not to re-introduce. This table
                 is a plain hand-rolled `<table>` with no such breakpoint: it
                 renders identically at any container width, so `sm` costs
                 nothing here that `md` was buying. */
              size="sm"
              /* SAME TWO PROPS AS THE COMPONENTS SHEET ABOVE, same reason. */
              alignToPane
              origin={widthsOrigin}
              /* NO SAVE OF ITS OWN — same shape as Components above. */
              footer={<SubSheetFooter onDone={() => setWidthsFor(null)} parent="fabric BOM" />}
            >
              {/* NO Style Ref No / Style No / Article No BAND HERE (operator
                  instruction, 2026-09-03: remove all three from this sheet).
                  The Sheet's own `title` above already names the fabric; the
                  Components sheet keeps its band — this removal is scoped to
                  Widths only. */}
              <div className="space-y-4">
                {/* BACK TO `w-full`, NOW THAT THE SHEET ITSELF IS `sm`
                    (448px) rather than `md` (1152px). `w-fit` was the right
                    fix for a 370px table sitting inside an oversized 1152px
                    box; inside a 448px box the same `w-fit` table left a
                    smaller but still visible gap on the trailing side
                    (operator screenshot 2688: "still needs some area fit").
                    A `sm` dialog is sized FOR content this size, so the two
                    data columns filling it — Finished Width and Purchase
                    Width each getting a normal ~9rem input rather than
                    huddling at `w-28` — is the fit, not a regression back to
                    the original "huge fields" complaint (that one was a
                    ~570px input inside a 1152px sheet; this is a ~9rem input
                    inside a 448px one). */}
                <div className="overflow-x-auto rounded-md border">
                  <table className="w-full table-fixed border-collapse text-sm">
                    <thead>
                      {/* THE HEADER WAS THE OTHER HALF OF THE "HUGE" COMPLAINT
                          (operator, having found it: "that header style is the
                          reason"). `w-24` (6rem) is narrower than "Finished
                          Width" / "Purchase Width" at `text-xs`, so each header
                          wrapped to two lines — and a two-line head row is
                          nearly DOUBLE the height a one-line row needs, which
                          reads as bulky on a table with only two data columns.
                          Widened to `w-28` and pinned to one line with
                          `whitespace-nowrap`; `py-1.5` trims the row's own
                          padding to match. */}
                      <tr className="border-b bg-muted/40 text-right text-xs text-muted-foreground">
                        <th className="w-16 whitespace-nowrap px-2 py-1.5 text-left font-medium">
                          Size
                        </th>
                        <th className="w-28 whitespace-nowrap px-2 py-1.5 font-medium">
                          Finished Width
                        </th>
                        <th className="w-28 whitespace-nowrap px-2 py-1.5 font-medium">
                          Purchase Width
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => (
                        <tr key={r.key} className="border-b last:border-b-0">
                          <td className="px-2 py-1 text-left">
                            <Truncated>{r.label}</Truncated>
                          </td>
                          <td className="px-2 py-1">
                            <Input
                              className="h-8 text-right"
                              inputMode="decimal"
                              aria-label="Finished Width"
                              value={r.finished_width}
                              onChange={(ev) => set(r, { finished_width: ev.target.value })}
                            />
                          </td>
                          <td className="px-2 py-1">
                            <Input
                              className="h-8 text-right"
                              inputMode="decimal"
                              aria-label="Purchase Width"
                              value={r.purchase_width}
                              onChange={(ev) => set(r, { purchase_width: ev.target.value })}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </Sheet>
          );
        })()}

      {fabricAddFor && data.fabricCreate.fabricClassId && (
        <FabricQuickCreateSheet
          /* KEYED ON THE STRUCTURE, so opening Add from a different row is a
             new mount with a blank form. That is also how the sheet resets at
             all — it holds no reset effect, deliberately; see its own note. */
          key={fabricAddFor}
          open
          onClose={() => setFabricAddFor(null)}
          fabricClassId={data.fabricCreate.fabricClassId}
          structureId={fabricAddFor}
          structureName={structureById.get(fabricAddFor) ?? ""}
          fabricTypes={data.fabricCreate.fabricTypes}
          uoms={data.uoms}
          yarnItems={data.fabricCreate.yarns}
          perms={perms}
          onCreated={(row) => {
            /* OPTIMISTIC, THEN REFRESHED — the same two steps `ItemPicker` takes
               for the Yarn sheet. The stub carries every column a reader on this
               screen looks at (`category_id` scopes the list it must appear in,
               `fabric_type` decides the Type cell and whether [Detail] opens,
               `base_uom_id` fills the line's consumption unit), because a stub
               missing one of them is a fabric that is picked and then behaves
               like a fabric with no type. */
            setNewFabrics((xs) => [
              ...xs,
              {
                id: row.id,
                code: row.code,
                name: row.name,
                class_code: "FABRIC",
                category_id: row.categoryId,
                fabric_type: row.fabricType,
                base_uom_id: row.baseUomId,
                inactive: false,
              },
            ]);
            (fabricAddCommit.current ?? (() => {}))(row.id);
            setFabricAddFor(null);
            router.refresh();
          }}
        />
      )}
    </>
  );
}

/**
 * The order's production quantity, and where it came from.
 *
 * A REFUSAL IS SHOWN, NOT SWALLOWED. "This order has no Approval Qty rows" and
 * "the requirement is zero" produce the same empty table, and only the first is
 * something an operator can act on — the failure AGENTS.md names under Cascading
 * filters, where an empty report reads as a real result.
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
        {order.combos.length} {order.combos.length === 1 ? "colourway" : "colourways"} · PO{" "}
        <span className="font-medium tabular-nums text-foreground">{fmtNumber(total)}</span> pcs ·
        excess {order.excessPct}%
        {order.rejectionRuleChosen ? " · rejection rule applied" : " · no rejection rule"}
      </span>
    );
  }

  return (
    /* NO FILL — the client's 2026-09-03 "just same white color", the same rule
       `component-map-sheet.tsx`'s header row states in full. The border already
       makes this read as a note rather than as body text. */
    <div className="mt-3 rounded-md border border-border px-3 py-2 text-xs">
      <span className="mr-2 font-medium text-foreground">Planning against:</span>
      {body}
    </div>
  );
}
