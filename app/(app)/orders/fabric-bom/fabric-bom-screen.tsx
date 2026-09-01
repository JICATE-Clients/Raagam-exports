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

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Layers,
  ListChecks,
  Palette,
  Waypoints,
  Ruler,
  Spool,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
/* The Components cell is a SET, which is the one thing that makes a Manual
   entry not a fabric line — see 0494. */
import { MultiSelect } from "@/components/ui/multi-select";
/* A Combobox, so the Manual sheet's Table width cell PICKS rather than accepts:
   typed text in one is a SEARCH and is never committed (`commit` in
   combobox.tsx). That is what makes the declared dia list mean something. */
import { Combobox } from "@/components/ui/combobox";
import { Textarea } from "@/components/ui/textarea";
import { Field, FieldGrid } from "@/components/ui/field";
import { ChildGrid, type ChildGridColumn } from "@/components/masters/child-grid";
import { SectionGrid } from "@/components/masters/section-grid";
import {
  MasterFullScreen,
  SectionBody,
  type FullScreenSection,
  type MasterFullScreenHandle,
} from "@/components/masters/master-full-screen";
import { PageHeader } from "@/components/ui/page-header";
import { RecordPicker } from "@/components/masters/record-picker";
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
  gramsFor,
  grossKg,
  manualProblem,
  netKg,
  takenComponentIds,
  type ManualSizeInput,
} from "@/lib/orders/fabric-bom/manual";
import { Sheet } from "@/components/ui/sheet";
/* The footer for an overlay with NO SAVE OF ITS OWN — the same one Combos ▸
   Structure Details and Quantities ▸ Assortments use, and for the same reason:
   the rows it edits are written by THIS screen's Save. It exists because three
   overlays that correctly had no footer were all reported as "missing save
   button" (client 2026-08-14). */
import { SubSheetFooter } from "@/components/orders/sub-sheet-footer";
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
import { ComponentMapSheet } from "@/components/orders/component-map-sheet";
import {
  fabricGroupKey,
  type StyleComponentDecl,
} from "@/lib/orders/fabric-bom/component-map";

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
  length_tolerance: string;
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
  structure_id: string | null;
  /** 'direct' | 'calculated'. */
  calc_mode: string;
  wastage_pct: string;
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
 * AN EMPTY PANEL RENDERS ONE DASH ROW, AND THE FIRST CUT WAS WRONG ABOUT THIS.
 *
 * It returned `[]` and argued that a fabricated row "would read as a dyeing the
 * order had entered badly". What actually happens is worse and was visible the
 * moment it shipped (client screenshot 2580, 2026-09-01: "this screen is
 * nothing"): `ChildGrid`'s prose empty state was REMOVED app-wide in the
 * 2026-08-17 de-clutter pass, and in `inlineCards` mode a grid with no rows
 * renders no header row either — so three read-only panels with nothing in them
 * came out as three bare words, YARN DYEING · FABRIC DYEING · ROLL FORM PRINTS,
 * with no columns, no box and no rows under them. The section read as unbuilt.
 *
 * THE DASH IS THE RULE THIS APP ALREADY WROTE DOWN, one surface along. From the
 * de-clutter pass itself: "in a table a dash is right and stays right
 * (`created-columns.tsx`), because a column of blanks is ambiguous with a column
 * that failed to load" — and the same pass blanks a FORM FIELD's placeholder,
 * because a field already has a box and a chevron saying a value goes there.
 * These panels are the table case, not the field case: they are read-only and
 * have no box of their own, so nothing but content can say they exist.
 *
 * IT COSTS NOTHING TO READ CORRECTLY because every cell in these two columns
 * already prints `|| "—"`, so the empty row needs no special case and cannot
 * drift from the filled ones. What the operator sees is a list with a dash in
 * it — "declared: nothing" — instead of a heading with a void beneath it.
 *
 * `undefined` (no order picked yet) and `[]` (the order declared none) still
 * render the same, deliberately. Which of the two it is belongs in the
 * conditional line above the panels, where there is room to say it in words.
 */
const DASH_ROW: PaletteRow = { key: "none", value: "" };

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
const paletteRows = (rows: OrderPalette["yarn"] | undefined): PaletteRow[] => {
  const seen = new Set<string>();
  const out: PaletteRow[] = [];
  for (const r of rows ?? []) {
    const v = (r.color_name ?? "").trim();
    if (!v) continue;
    const k = v.toUpperCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ key: `c${k}`, value: v });
  }
  return out.length ? out : [DASH_ROW];
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
  structure_id: null,
  /* DIRECT, the client's stated primary method — "the planner directly inputs
     the weight of the components in grams". The one default here, and it is a
     default about HOW a figure is reached, never about the figure itself: an
     unfilled entry still refuses by name. */
  calc_mode: "direct",
  wastage_pct: "",
  component_ids: [],
  sizes: [],
});

/** AT MODULE SCOPE so `styleDecls` keeps one identity while no order is picked
 *  — a fresh `[]` per render would re-run every `useMemo` that reads it. Same
 *  reason `NO_DESCRIPTOR` above is hoisted. */
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
  const keySeq = useRef(0);
  const newKey = () => `k${keySeq.current++}`;

  const set = (patch: Partial<Form>) => {
    setForm((f) => ({ ...f, ...patch }));
    setDirty(true);
  };
  const mut = (fn: (xs: LineRow[]) => LineRow[]) => {
    setLines(fn);
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
  const setSizeCell = (entryKey: string, sizeKey: string, patch: Partial<ManualSizeRow>) =>
    mutEntries((xs) =>
      xs.map((e) =>
        e.key === entryKey
          ? { ...e, sizes: e.sizes.map((z) => (z.key === sizeKey ? { ...z, ...patch } : z)) }
          : e,
      ),
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

  /** Which fabric line's [Detail] sheet is open (0495). */
  const [detailKey, setDetailKey] = useState<string | null>(null);
  const detailLine = lines.find((l) => l.key === detailKey) ?? null;

  /**
   * THE LINES THE OPEN SHEET COVERS — every colourway of one fabric.
   *
   * Grouped on (style, structure, fabric) and NOT on the colourway, because
   * mapping a panel to a cloth is a fact about the garment rather than about the
   * colour it is dyed. `fabricGroupKey` is the one statement of that scope; the
   * sheet's own doc says why.
   */
  const detailLines = useMemo(
    () => (detailLine ? lines.filter((l) => fabricGroupKey(l) === fabricGroupKey(detailLine)) : []),
    [lines, detailLine],
  );

  /** Patch every colourway of one panel — Component, Coordinate, Open/Tubular. */
  const patchPanel = (panelKey: string, patch: Partial<LineRow>) =>
    mut((xs) =>
      xs.map((x) =>
        detailLines.some((d) => d.key === x.key) &&
        (x.component_id ?? x.panel_uid) === panelKey
          ? { ...x, ...patch }
          : x,
      ),
    );

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
  const addPanel = (seed: { component_id: string | null; coordinate_id: string | null }) => {
    if (!detailLine) return;
    const combos = [...new Set(detailLines.map((l) => l.combo))];
    const forCombos = combos.length ? combos : [detailLine.combo];
    /* ONE UID FOR THE WHOLE PANEL — see `LineRow.panel_uid`. Taken before the
       map so all N colourways share it; `newKey()` inside the map would give
       each its own and one Add would draw as N blank rows. */
    const panelUid = newKey();
    mut((xs) => [
      ...xs,
      ...forCombos.map((combo) => ({
        ...blankLine(newKey()),
        panel_uid: panelUid,
        style_ref_no: detailLine.style_ref_no,
        combo,
        structure_id: detailLine.structure_id,
        item_id: detailLine.item_id,
        fabric_type: detailLine.fabric_type,
        consumption_uom_id: detailLine.consumption_uom_id,
        component_id: seed.component_id,
        coordinate_id: seed.coordinate_id,
      })),
    ]);
  };

  /** Remove a panel — and every colourway's line for it. */
  const removePanel = (panelKey: string) =>
    mut((xs) =>
      xs.filter(
        (x) =>
          !(
            detailLines.some((d) => d.key === x.key) &&
            (x.component_id ?? x.panel_uid) === panelKey
          ),
      ),
    );

  /** The order's declared colours and prints — what the two auto-filled cells
   *  offer. Both lists are the ORDER's, never a master: "empty and explain,
   *  never a silent fallback" (AGENTS.md, Nominated vendors). */
  const declaredColours = useMemo(
    () =>
      [
        ...new Set(
          [...(palette?.yarn ?? []), ...(palette?.fabric ?? [])]
            .map((d) => (d.color_name ?? "").trim())
            .filter(Boolean),
        ),
      ].sort(),
    [palette],
  );
  const declaredPrints = useMemo(
    () =>
      [
        ...new Set(
          (palette?.prints ?? []).map((p) => (p.print_name ?? "").trim()).filter(Boolean),
        ),
      ].sort(),
    [palette],
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
        consumption_uom_id: l.consumption_uom_id,
        notes: l.notes ?? "",
    }));
    setLines(loadedLines);
    /* THE MANUAL ENTRIES (0494), numbers stringified once — see `ManualSizeRow`.
       A stored 0 becomes "0" and not "", because it is a value the planner typed
       and blanking it on reopen would silently un-answer a cell.

       THE SIZES ARE NOT RE-DERIVED HERE. What the database holds is what the
       planner entered; `openManual` adds a row for any size the order has GAINED
       since, and `manualSizeRows` keeps one the order has since dropped, tagged.
       Re-deriving on load would do both silently and lose the second. */
    setEntries(
      (b.manualEntries ?? []).map((e) => ({
        key: newKey(),
        id: e.id,
        style_ref_no: e.style_ref_no ?? "",
        width_form: e.width_form ?? "",
        structure_id: e.structure_id,
        calc_mode: e.calc_mode ?? "direct",
        wastage_pct: e.wastage_pct == null ? "" : String(e.wastage_pct),
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
        rate: p.rate == null ? "" : String(p.rate),
        type_id: p.type_id,
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
              /* `""` FOR "EVERY COLOURWAY", because the cell is a `<select>`
                 whose empty value is `""`. The database stores NULL; the two
                 mean the same thing and `comboKey` is what keeps them so. */
              combo: st.combo ?? "",
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

  // ---- the line grid -------------------------------------------------------

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
  const descriptorFor = useMemo(() => {
    const key = (style: string | null, combo: string | null, structure: string | null) =>
      [style ?? "", combo ?? "", structure ?? ""].map((v) => v.trim().toUpperCase()).join(SEP);

    /* TWO INDEXES OVER ONE LIST. The exact one answers a line that names its
       colourway; the loose one collects every colourway using the structure, so
       the blank-combo case can test whether they agree instead of picking one. */
    const exact = new Map<string, Descriptor>();
    const loose = new Map<string, { gsm: Set<string>; sub: Set<string>; num: Set<number> }>();

    for (const r of seedRows ?? []) {
      const gsm = gsmRange(r.gsm, r.gsm_tolerance);
      const sub = ITEM_SUB_TYPE_OPTIONS.find((o) => o.value === r.item_sub_type)?.label ?? "";
      exact.set(key(r.style_ref_no, r.combo, r.structure_id), { gsm, sub, gsmNum: r.gsm ?? null });
      const lk = key(r.style_ref_no, null, r.structure_id);
      const seen = loose.get(lk) ?? {
        gsm: new Set<string>(),
        sub: new Set<string>(),
        num: new Set<number>(),
      };
      seen.gsm.add(gsm);
      seen.sub.add(sub);
      if (r.gsm != null) seen.num.add(r.gsm);
      loose.set(lk, seen);
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
      const seen = loose.get(key(l.style_ref_no, null, l.structure_id));
      return seen
        ? { gsm: one(seen.gsm), sub: one(seen.sub), gsmNum: oneNum(seen.num) }
        : NO_DESCRIPTOR;
    };
  }, [seedRows]);

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
    () => new Map(data.fabrics.map((f) => [f.id, f.name] as const)),
    [data.fabrics],
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
  const orderIdentity = useMemo(() => {
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
  }, [seedRows]);

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

  // ---- Manual (0494) — the client's size-wise gram entries ------------------

  /**
   * THE SIZES THE ORDER STATES, taken from the ORDER and never typed.
   *
   * `fabricSlices('colour_size', …)` is the same explosion the requirement runs,
   * so the sheet asks for a weight on exactly the rows the requirement will
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
   * Quantities, and the sheet says "this order states no sizes" in its own words.
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
   * ONE EXTRA ROW FOR "EVERY STYLE", and only when something needs it. An entry
   * whose `style_ref_no` is blank applies to every style — the reading 0426 gave
   * the column and the state every entry stored before 0495 is in. Without this
   * row those entries would be reachable from no style at all: invisible, still
   * planning, and destroyed by the next Save. It is the "a held value always
   * survives" rule, applied to a whole level.
   */
  const manualStyleRows = useMemo(() => {
    const declared = (pickedOrder?.styleRows ?? []).map((r) => ({
      key: r.style_ref_no,
      style_ref_no: r.style_ref_no,
      style_no: r.style_no,
      article_no: r.article_no,
      unit_kind: r.unit_kind,
      unscoped: false,
    }));
    const hasUnscoped = entries.some((e) => !e.style_ref_no.trim());
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

  /** The entries one style row owns. Blank ref = the "every style" row. */
  const entriesForStyle = (ref: string) =>
    entries.filter((e) => e.style_ref_no.trim().toUpperCase() === ref.trim().toUpperCase());

  /**
   * THE ORDER'S COLOURWAYS FOR ONE STYLE — the spec's "Assort-wise Color:
   * automatically maps the combo colors".
   *
   * DERIVED AND READ-ONLY. The order declares the colourways on its Combos tab
   * and the requirement already explodes across every one of them, so a copy
   * here would be a list the planner could edit into disagreeing with what is
   * actually being planned.
   */
  const combosForStyle = (ref: string): string[] => {
    const want = ref.trim().toUpperCase();
    const out = new Set<string>();
    for (const r of seedRows ?? []) {
      if (want && (r.style_ref_no ?? "").trim().toUpperCase() !== want) continue;
      if (r.combo) out.add(r.combo);
    }
    return [...out];
  };

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
   * Pcs / Sets — the spec's "Component Unit: defaults to Pcs or Sets based on
   * the order setup".
   *
   * `garment_order_amendment_styles.unit_kind` (0471), read through the style
   * row. Read-only for the reason every derived cell here is: the order decides
   * whether it is selling pieces or sets, and a BOM that could disagree with it
   * would be planning a different document.
   */
  const unitKindLabel = (v: string | null) => {
    const k = (v ?? "").trim().toLowerCase();
    if (k === "sets" || k === "set") return "Sets";
    if (k === "pcs" || k === "piece" || k === "pieces") return "Pcs";
    return "";
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
   * The entry whose size sheet is open, by React key. NULL = closed.
   *
   * BY KEY AND NOT BY ROW. Holding the row itself would freeze a copy taken at
   * open time, and every keystroke inside the sheet writes to `entries` — so the
   * overlay would render the values as they were when it opened.
   */
  const [manualStyleKey, setManualStyle] = useState<string | null>(null);
  const manualStyle =
    manualStyleKey === null
      ? null
      : (manualStyleRows.find((r) => r.key === manualStyleKey) ?? null);

  /**
   * Open the sheet, having first given it a row per size.
   *
   * SEEDED BEFORE OPENING, which is the shape Combos ▸ Detail records: opening
   * first would render the empty state for a frame and then swap it, "which
   * reads as a glitch rather than as a form that arrived filled in".
   *
   * IT DOES NOT SET `dirty`, deliberately rather than by oversight of the `mut`
   * pairing every other mutator here carries. These rows are blank scaffolding —
   * `normalizeManualSizes` drops every one of them on save, so nothing about the
   * document has changed. Lighting "● Unsaved" for the act of OPENING a sheet
   * teaches the planner that the badge means nothing, which costs more than it
   * buys on a screen whose auto-reload guard is keyed to it.
   *
   * ADDITIVE, NEVER A REPLACEMENT. A size already carrying measurements keeps
   * them; only the missing ones are added, and a stored size the order no longer
   * states is kept too — see `manualSizeRows`.
   */
  function openManual(styleRef: string) {
    setEntries((xs) =>
      xs.map((e) => {
        if (e.style_ref_no.trim().toUpperCase() !== styleRef.trim().toUpperCase()) return e;
        const held = new Set(e.sizes.map((z) => z.size_id));
        const missing = orderSizesFor(e.style_ref_no).filter((z) => !held.has(z.size_id));
        return missing.length
          ? {
              ...e,
              sizes: [
                ...e.sizes,
                ...missing.map((z) => blankManualSize(newKey(), z.size_id, defaultDia)),
              ],
            }
          : e;
      }),
    );
    setManualStyle(styleRef);
  }

  /**
   * The rows the sheet shows, in the ORDER's size order.
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
      if (!row) continue;
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
   *  [Sizes] button counts and what lights the section's quiet dot. */
  const manualAnswered = (e: ManualEntryRow) =>
    Object.keys(consumptionMap(e.calc_mode, sizeInputsOf(e), gsmForStructure(e.structure_id)))
      .length;

  /**
   * Formula 1 and Formula 2, for ONE entry, across every size.
   *
   *     Net Kg   = Σ (order qty for the size x grams / 1000)
   *     Gross Kg = Net x (1 + wastage% / 100)
   *
   * FOR DISPLAY ONLY. The stored figure goes through `fabricRequirementRows`,
   * which the server calls with the same `consumptionMap` — so this is the same
   * arithmetic without the per-slice ceiling, and never a second formula. The
   * client's own worked example lands here: 10,510 pcs x 50 g = 525.5 Kg.
   *
   * NULL WHEN NOTHING IS ANSWERED, never 0. A zero gross reads as "this fabric
   * needs no cloth", which is the one answer that must never be produced by
   * silence (`requirement.ts`, "NULL is an answer. 0 is not.").
   */
  const entryTotals = (e: ManualEntryRow): { net: number | null; gross: number | null } => {
    const map = consumptionMap(e.calc_mode, sizeInputsOf(e), gsmForStructure(e.structure_id));
    let net = 0;
    let any = false;
    for (const z of orderSizesFor(e.style_ref_no)) {
      const kgPerPiece = map[z.size_id];
      if (kgPerPiece === undefined) continue;
      any = true;
      net += z.qty * kgPerPiece;
    }
    if (!any) return { net: null, gross: null };
    return { net, gross: grossKg(net, numOrNull(e.wastage_pct)) };
  };

  /** One entry, as `manual.ts`'s rules want it. */
  const entryLike = (e: ManualEntryRow) => ({
    style_ref_no: e.style_ref_no.trim() || null,
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
   * The Manual section's grid — ONE ROW PER ENTRY (0494).
   *
   * SEVEN CELLS, and only four of them typable: structure, panels, mode,
   * wastage. Net and Gross are derived, and [Sizes] is a door. Everything a
   * FABRIC is — its item, its colour, its GSM — was answered on Fabric Lines and
   * is not re-offered here, which is the same rule 0494 applies to the whole
   * tab: the entry says how much cloth, the line says which cloth.
   */
  /**
   * The Manual section's grid — ONE ROW PER STYLE (0495), legacy's first level
   * and the client's "Header Section (Style Details)".
   *
   * EVERY CELL IS READ-ONLY AND PLAIN TEXT. The order answers all four, and a
   * greyed `<Input>` would say "you may edit this once something else is true"
   * when the answer is "never, here". Plain text also keeps them off the Tab
   * path with no `tabIndex` to set — a read-only value is not a field
   * (AGENTS.md) — which leaves exactly one stop per row: the [Fabrics] button.
   *
   * `S No` IS `ChildGrid`'s OWN INDEX COLUMN and is not declared here.
   */
  const manualColumns: ChildGridColumn<ManualStyleRow>[] = [
    {
      header: "Style Ref No",
      width: "12rem",
      cell: (r) => (
        <Truncated>
          {/* THE UNSCOPED ROW SAYS SO IN WORDS. A blank cell would read as a
              style whose ref failed to load; "Every style" is what NULL has
              meant on this column since 0426, said out loud. */}
          {r.unscoped ? "Every style" : r.style_ref_no || "—"}
        </Truncated>
      ),
    },
    { header: "Style No", width: "10rem", cell: (r) => <Truncated>{r.style_no || "—"}</Truncated> },
    { header: "Article No", width: "10rem", cell: (r) => <Truncated>{r.article_no || "—"}</Truncated> },
    {
      /* "Component Unit: defaults to Pcs or Sets based on the order setup" —
         `unit_kind` (0471), read through the style row. */
      header: "Unit",
      width: "6rem",
      cell: (r) => <Truncated>{unitKindLabel(r.unit_kind) || "—"}</Truncated>,
    },
    {
      header: "Fabrics",
      width: "9rem",
      cell: (r) => {
        const mine = entriesForStyle(r.style_ref_no);
        const answered = mine.filter((e) => manualAnswered(e) > 0).length;
        return (
          <Button
            type="button"
            variant="outline"
            size="sm"
            /* A CELL OF THE ROW, so Tab, Enter and the arrows all reach it. It
               is the only door to this style's weights, and Combos ▸ Detail was
               mouse-only for exactly as long as it lacked this marker. */
            data-row-open
            onClick={() => openManual(r.style_ref_no)}
          >
            {/* HOW MANY OF THIS STYLE'S FABRICS ARE ANSWERED, which is the one
                fact the section cannot otherwise show — every style looks
                identical from out here. */}
            Fabrics {mine.length ? `${answered}/${mine.length}` : "0"}
          </Button>
        );
      },
    },
  ];

  /**
   * The sheet's own grid — one row per size, and THE COLUMNS DEPEND ON THE MODE.
   *
   * Direct asks for the weight; calculated asks for the measurements and shows
   * the weight it derives. Building two lists rather than disabling half of one
   * is the honest shape: a greyed box says "you may edit this once something
   * else is true", and in direct mode Width and Length are not fields that are
   * temporarily unavailable — they are not part of the question being asked.
   *
   * `entryKey` IS CLOSED OVER RATHER THAN READ OFF THE ROW, because a
   * `ManualSizeRow` does not know which entry it belongs to. The columns are
   * therefore built per open sheet; that is cheap (one entry's sizes) and it is
   * what keeps `ManualSizeRow` a pure measurement record instead of carrying a
   * parent pointer the state already expresses.
   */
  const sizeColumns = (e: ManualEntryRow): ChildGridColumn<ManualDisplayRow>[] => {
    const mode = calcModeOf(e.calc_mode);
    const gsm = gsmForStructure(e.structure_id);
    const wastage = numOrNull(e.wastage_pct);
    const set = (r: ManualDisplayRow, patch: Partial<ManualSizeRow>) =>
      setSizeCell(e.key, r.key, patch);
    const qtyOf = (r: ManualDisplayRow) =>
      orderSizesFor(e.style_ref_no).find((z) => z.size_id === r.size_id)?.qty ?? null;

    const measured: ChildGridColumn<ManualDisplayRow>[] = [
      {
        /* THE PANEL WIDTH ON THE CUTTING TABLE — the client's `TableWidth`, and
           the figure the weight multiplies. Distinct from the `Dia` column
           above it, which is the ROLL's diameter and a constraint: the panels
           must fit across it. One word for both is how a reader multiplies by
           60 where 55 was meant. */
        header: "Table width",
        width: "7rem",
        align: "right",
        cell: (r) => (
          <Input
            className="h-8 text-right"
            inputMode="decimal"
            value={r.table_width}
            onChange={(ev) => set(r, { table_width: ev.target.value })}
          />
        ),
      },
      {
        header: "Length",
        width: "6rem",
        align: "right",
        cell: (r) => (
          <Input
            className="h-8 text-right"
            inputMode="decimal"
            value={r.length}
            onChange={(ev) => set(r, { length: ev.target.value })}
          />
        ),
      },
      {
        header: "Tol.",
        width: "5rem",
        align: "right",
        cell: (r) => (
          <Input
            className="h-8 text-right"
            inputMode="decimal"
            value={r.length_tolerance}
            onChange={(ev) => set(r, { length_tolerance: ev.target.value })}
          />
        ),
      },
      {
        /* Legacy prints Length twice — the typed one and the one after the
           tolerance. This is the second, derived, and therefore text rather than
           a readOnly box. */
        header: "Eff. len",
        width: "6rem",
        align: "right",
        cell: (r) => {
          const eff = effectiveLength(numOrNull(r.length), numOrNull(r.length_tolerance));
          return <span className="tabular-nums text-sm">{eff == null ? "—" : fmtNumber(eff)}</span>;
        },
      },
    ];

    return [
      {
        header: "Size",
        width: "6rem",
        cell: (r) => (
          <Truncated>
            {/* TAGGED WHEN THE ORDER NO LONGER STATES IT — the same wording shape
                as the dia's "not declared". A value the record already holds
                always survives, and reads as the exception it is rather than
                being silently dropped. */}
            {r.label}
            {r.declared ? "" : "  (not on the order)"}
          </Truncated>
        ),
      },
      {
        /* PICKS FROM THE DIAS THIS BOM DECLARES (0490), and prepopulated from
           them where exactly one is declared — the client's own instruction,
           "they should automatically prepopulate the Dia field here but remain
           editable". A Combobox, so typed text is a SEARCH and never a stored
           value; `diaOptionsFor` keeps a held value visible and tagged. */
        header: "Dia",
        width: "8rem",
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
      {
        /* A SECOND WIDTH AND NOT A RESTATEMENT OF THE DIA: cloth is knitted at
           one and invoiced at another, and purchasing needs the one it buys
           against. Free text rather than a pick — it is a commercial figure the
           supplier quotes, not one this BOM declares anywhere. */
        header: "Purch. width",
        width: "8rem",
        align: "right",
        cell: (r) => (
          <Input
            className="h-8 text-right"
            inputMode="decimal"
            value={r.purchase_width}
            onChange={(ev) => set(r, { purchase_width: ev.target.value })}
          />
        ),
      },
      ...(mode === "calculated" ? measured : []),
      {
        header: "Grams",
        width: "7rem",
        align: "right",
        /* REQUIRED IN DIRECT MODE ONLY, because that is the only mode in which
           it is a field. In calculated mode the measurements are what the star
           belongs on — and a star over a derived cell would hold the cursor on a
           box nothing can be typed into (AGENTS.md: a readOnly field never
           holds, "which is why a composed name requires its SOURCES instead"). */
        required: mode === "direct",
        cell: (r) =>
          mode === "direct" ? (
            <Input
              className="h-8 text-right"
              required
              inputMode="decimal"
              value={r.grams}
              onChange={(ev) => set(r, { grams: ev.target.value })}
            />
          ) : (
            (() => {
              const g = calculatedGrams(
                {
                  table_width: numOrNull(r.table_width),
                  length: numOrNull(r.length),
                  length_tolerance: numOrNull(r.length_tolerance),
                },
                gsm,
              );
              /* A DASH, NEVER 0.000, when the GSM or a measurement is missing.
                 The order supplies the GSM and `gsmForStructure` abstains where
                 its colourways disagree, so a zero here would read as "this size
                 needs no cloth" in the column everything downstream multiplies. */
              return (
                <span className="tabular-nums text-sm">{g == null ? "—" : fmtNumber(g)}</span>
              );
            })()
          ),
      },
      {
        /* THE ORDER QUANTITY FOR THIS SIZE, summed across colourways — the first
           factor of Formula 1, shown because a Net kg with no visible quantity
           behind it is a number the planner has to take on trust. */
        header: "Order qty",
        width: "7rem",
        align: "right",
        cell: (r) => {
          const q = qtyOf(r);
          return (
            <span className="tabular-nums text-sm text-muted-foreground">
              {q == null ? "—" : fmtNumber(q)}
            </span>
          );
        },
      },
      {
        /* THE CLIENT'S OWN WORD. It was "Net kg" until they sent the field list:
           `Cons Qty` is what the planner and the spec both call this, and a
           screen using a different noun for one number is how a report and a
           conversation come to disagree about which figure is meant. */
        header: "Cons Qty",
        width: "7rem",
        align: "right",
        cell: (r) => {
          const g = gramsFor(e.calc_mode, {
            size_id: r.size_id,
            dia: numOrNull(r.dia),
            purchase_width: numOrNull(r.purchase_width),
            grams: numOrNull(r.grams),
            table_width: numOrNull(r.table_width),
            length: numOrNull(r.length),
            length_tolerance: numOrNull(r.length_tolerance),
          }, gsm);
          const n = netKg(qtyOf(r), g);
          return <span className="tabular-nums text-sm">{n == null ? "—" : fmtNumber(n)}</span>;
        },
      },
      {
        /* `Cons Wt` — the client's word again, and "the actual value dispatched
           to the yarn purchase module". Emphasised for that reason and no
           other: it is the figure that leaves this tab. */
        header: "Cons Wt",
        width: "7rem",
        align: "right",
        cell: (r) => {
          const g = gramsFor(e.calc_mode, {
            size_id: r.size_id,
            dia: numOrNull(r.dia),
            purchase_width: numOrNull(r.purchase_width),
            grams: numOrNull(r.grams),
            table_width: numOrNull(r.table_width),
            length: numOrNull(r.length),
            length_tolerance: numOrNull(r.length_tolerance),
          }, gsm);
          const gr = grossKg(netKg(qtyOf(r), g), wastage);
          return (
            <span className="tabular-nums text-sm font-medium">
              {gr == null ? "—" : fmtNumber(gr)}
            </span>
          );
        },
      },
    ];
  };

  const lineColumns: ChildGridColumn<LineRow>[] = [

    {
      header: "Combo",
      width: "6.5rem",
            cell: (r) => (
        <Select
          compact
          className="h-8"
          value={r.combo}
          /* THE COLOURWAY SETS THE STYLE, because the Style column is gone
             (client spec, 2026-09-01: exclude Style Ref Number). Written on the
             CHANGE, never in an effect — an effect also fires when a SAVED BOM
             is opened and would rewrite every stored line's style on load, which
             is the rule `pickStyle` and `seedComboFromStyle` both state one
             module along. `styleForCombo` abstains where two styles share a
             colourway name, and a blank style legitimately means "every style"
             to `fabricSlices`. */
          onChange={(e) =>
            setCell(r.key, {
              combo: e.target.value,
              style_ref_no: styleForCombo(e.target.value),
            })
          }
        >
          <option value="" />
          {comboOptions.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </Select>
      ),
    },
    {
      header: "Structure",
      width: "8rem",
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
          onChange={(id) => setCell(r.key, { structure_id: id })}
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
      width: "6rem",
      cell: (r) => <Truncated>{descriptorFor(r).gsm || "—"}</Truncated>,
    },
    {
      header: "Component",
      width: "7rem",
            cell: (r) => (
        <RecordPicker
          label="Component"
          compact
          items={data.components}
          value={r.component_id}
          onChange={(id) => setCell(r.key, { component_id: id })}
        />
      ),
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
      width: "18rem",
      cell: (r) => (
        <RecordPicker
          label="Fabric"
          compact
          required
          items={data.fabrics}
          value={r.item_id}
          onChange={(id) => setCell(r.key, { item_id: id })}
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
       * STILL READ-ONLY, and now for a stronger reason than before: the fabric
       * NAME already says it (`MELANGE SINGLE JERSEY`), so an editable cell
       * could contradict the row's own Fabric cell with nothing to arbitrate.
       * Plain text, not a disabled input — see the `GSM Range` cell above.
       */
      header: "Type",
      width: "5.5rem",
      cell: (r) => (
        <Truncated>
          {(r.item_id ? (data.fabrics.find((f) => f.id === r.item_id)?.fabric_type ?? null) : null) ||
            "—"}
        </Truncated>
      ),
    },
    {
      header: "Colour",
      width: "6.5rem",
      cell: (r) => (
        <Input
          className="h-8"
          uppercase
          value={r.color_name}
          onChange={(e) => setCell(r.key, { color_name: e.target.value })}
        />
      ),
    },
    {
      header: "Unit",
      width: "5rem",
            required: true,
      cell: (r) => (
        <RecordPicker
          label="Unit"
          compact
          required
          items={data.uoms}
          value={r.consumption_uom_id}
          onChange={(id) => setCell(r.key, { consumption_uom_id: id })}
        />
      ),
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
       * NARROWER THAN `CELL`. The row is twelve columns at 5rem plus chrome
       * against a ~1260px pane (client screenshot 2581), so a thirteenth at the
       * full width is what would push it past the frame and turn the table into
       * stacked cards with nothing on screen to say why. 4.5rem fits "Detail" at
       * `text-xs` with room.
       */
      header: "",
      width: "4.5rem",
      cell: (r) => (
        <Button
          type="button"
          variant="outline"
          size="sm"
          data-row-open
          disabled={!r.item_id}
          title={r.item_id ? undefined : "Choose the fabric first"}
          onClick={() => setDetailKey(r.key)}
        >
          Detail
        </Button>
      ),
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
          ? (data.fabrics.find((f) => f.id === itemIds[0])?.name ?? structureName)
          : structureName;

      const refuse = (reason: string) =>
        out.push({
          key: `${e.key}-r`,
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
  }, [order, entries, lines, data.fabrics, data.structures, data.uoms, seedRows]);

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
   * `preview` carries no entry id, so the grouping is by its `key` prefix, which
   * the loop mints as `${e.key}-...`. That is the one place this screen reads a
   * key as data; the alternative is a second pass over `fabricRequirementRows`,
   * which would be a second implementation of the figure.
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
      const entryKey = p.key.slice(0, p.key.lastIndexOf("-"));
      const bucket = `${entryKey}::${comboKey(p.combo)}`;
      const held = byBucket.get(bucket);
      /* A REFUSAL POISONS ITS BUCKET and cannot be un-poisoned by a later
         slice: once null, it stays null. */
      if (held && held.gross === null) continue;
      byBucket.set(bucket, {
        fabric_id: p.item_id,
        combo: p.combo,
        gross: p.qty == null ? null : (held?.gross ?? 0) + p.qty,
        uom_id: p.uom_id,
      });
    }
    return [...byBucket.values()];
  }, [preview]);

  const compositionById = useMemo(
    () => new Map((comp?.compositions ?? []).map((c) => [c.fabric_id, c])),
    [comp],
  );

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
      /* `combo || null` — the cell holds `""` for "every colourway" and the
         engine reads NULL for it. `comboKey` treats the two the same, but
         passing the empty string would rely on that rather than stating it. */
      r.stages.map((st) => ({ combo: st.combo || null, loss_pct: numOrNull(st.loss_pct) })),
      uom?.decimal_places_allowed ?? null,
    );
  };

  // ---- validity ------------------------------------------------------------

  const filledLines = lines.filter((l) => l.item_id);

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
      ...(filledLines.some((l) => l.item_id && !l.consumption_uom_id)
        ? [
            {
              section: "lines",
              label: "Unit",
              message: "Choose the unit this consumption is in",
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
   * ONE COLUMN, NAMED BY THE PANEL — "Colour" or "Yarn colour".
   *
   * A FACTORY BECAUSE THE HEADER IS THE ONLY DIFFERENCE. The two panels list the
   * same kind of value from the same table (`garment_order_amendment_dyeings`,
   * split on `section`), so a second column array would be a copy whose only
   * distinguishing line is a string — and copies of a column definition are what
   * let two panels drift into rendering the same value two ways.
   *
   * 18rem MATCHES THE DIA PANEL'S 7 + 11, so all four panels still declare the
   * same total and their boxes still line up in the 2×2. That was the whole
   * point of declaring widths at all (client 2026-09-01, screenshot 2582), and
   * dropping a column must not quietly undo it.
   */
  const colourColumns = (header: string): ChildGridColumn<PaletteRow>[] => [
    {
      header,
      width: "18rem",
      cell: (r) => <Truncated>{r.value || "—"}</Truncated>,
    },
  ];

  const printPaletteColumns: ChildGridColumn<PaletteRow>[] = [
    {
      header: "Roll form print",
      /* 18rem, NOT the 11rem the Colour column takes. This panel has one column
         where the others have two, so it has both their widths to spend — and a
         print name is a long one ("ALL OVER FLORAL AOP"). It still lines up: its
         single column starts on the same left edge as every other panel's
         first. */
      width: "18rem",
      cell: (r) => <Truncated>{r.value || "—"}</Truncated>,
    },
  ];

  /**
   * THE STACKED FALLBACK NEEDS ITS LABELS, and dropping it as redundant is a
   * mistake this file records having made once already (see `renderMobileRow` on
   * the Fabric Lines grid): `ChildGrid`'s default stacked cell is a bare div with
   * NO VISIBLE LABEL, so below the table breakpoint these panels would degrade to
   * unlabelled scraps of text — worse here than on a grid of inputs, because a
   * bare "—" under no heading says nothing at all.
   *
   * A FACTORY OVER THE PANEL'S OWN COLUMNS, not one shared renderer. The first
   * cut passed a single `paletteMobileRow` to all three read-only panels, and it
   * closed over `paletteColumns` — so the Roll form prints panel, which has ONE
   * column where the others have two, would have labelled its print name
   * "Colour" and shown it under a "Type" heading with a dash in it. Both arrays
   * are `ChildGridColumn<PaletteRow>[]`, so the type checker had nothing to say.
   * Reading each panel's own `columns` is what makes the stacked labels and the
   * table headers one declaration per panel rather than one for the set.
   */
  /* NAMED, because an anonymous component definition trips `react/display-name`
     — the one lint ERROR in this file, pre-existing at HEAD and owned by nobody.
     Naming the inner function is the whole fix; nothing about the behaviour or
     the reasoning above changes. */
  const mobileRowFor =
    (cols: ChildGridColumn<PaletteRow>[]) =>
    function PaletteMobileRow(row: PaletteRow) {
      return (
      <FieldGrid>
        {cols.map((c, ci) => (
          <Field key={ci} label={c.header} size="sm">
            {c.cell(row, ci)}
          </Field>
        ))}
      </FieldGrid>
      );
    };

  const diaColumns: ChildGridColumn<DiaRow>[] = [
    {
      header: "Type",
      width: "7rem",
      cell: (r) => (
        <Select
          compact
          className="h-8"
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
      align: "right",
      /* 11rem, THE SAME AS THE COLOUR COLUMN BESIDE IT — this panel sits under
         Fabric Dyeing in the 2×2, so a matching width is what puts their two
         column edges on one line. Undeclared, this cell was the worst offender
         in screenshot 2582: a number box the width of the whole pane. */
      width: "11rem",
      cell: (r) => (
        <Input
          className="h-8 text-right"
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
   * THREE COLUMNS, AND THE THIRD IS A GRID.
   *
   * The yarn, the figure it produces, and the treatments that produce it —
   * legacy's `[+]` unfolded in place, which is the call 0472 already made for
   * Order Entry ▸ Pack type(s). `ChildGrid` is what makes the nesting free: the
   * keyboard contract covers it by name ("A ROW'S NESTED GRID IS PART OF THE
   * ROW"), so Tab walks the yarn's cells and then its treatments, and Ctrl+Del
   * reaches the inner ✕.
   *
   * THE WEIGHT SITS BEFORE THE GRID, not after it, which is the one layout
   * choice here worth defending. It is the ANSWER, and the planner types the
   * stages to move it — putting it below would mean typing a loss and looking
   * past a block of rows to see what it did.
   */
  const yarnColumns: ChildGridColumn<YarnRow>[] = [
    {
      header: "Yarn",
      width: "16rem",
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
    {
      /**
       * THE ANSWER — each colourway's net, grossed by the treatments that apply
       * to it, summed.
       *
       * A REFUSAL IS PRINTED, NEVER A ZERO. `preview` makes the same call in the
       * same words: "'nothing needed' and 'the operator has not answered yet'
       * produce the same empty cell otherwise,
       * and only one of those is something anybody can act on." It matters more
       * here, because this figure is a PURCHASE — a zero reads as "buy nothing"
       * for a yarn the cloth cannot be knitted without.
       *
       * THE PER-COLOURWAY BREAKDOWN IS SHOWN UNDER IT once a treatment splits
       * them, because the total alone cannot say why 918 is not 900, and the
       * planner's next question after typing a For is always "on what weight?".
       * Suppressed while every colourway carries the same story, which is the
       * ordinary case and where the lines would be noise.
       */
      header: "Yarn Purchase Wt",
      align: "right",
      width: "13rem",
      cell: (r) => {
        const w = weightFor(r);
        if (isRefusal(w)) return <span className="text-xs text-danger">{w.refused}</span>;
        const uom = data.uoms.find((u) => u.id === w.uom_id);
        const unit = uom?.code ?? uom?.name ?? "";
        const split = w.byCombo.length > 1 && w.byCombo.some((c) => c.gross !== c.net);
        return (
          <div>
            <span className="tabular-nums">
              {fmtNumber(w.qty)} {unit}
            </span>
            {split && (
              <div className="mt-0.5 space-y-0.5">
                {w.byCombo.map((c) => (
                  <div key={c.combo} className="text-xs text-muted-foreground tabular-nums">
                    {c.combo || "—"} {fmtNumber(c.gross)}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      },
    },
    {
      /* NO `width` — the treatments take the rest of the line. `hugsContent` is
         `columns.every(c => c.width)`, so this one column's omission is what
         lets the nested grid fill the row rather than hug a narrow track. */
      header: "Treatments",
      cell: (r) => {
        const w = weightFor(r);
        return (
          <YarnProcessGrid
            rows={r.stages}
            onChange={(next) => setYarnStages(r.item_id, next)}
            processes={data.yarnProcesses}
            stages={data.yarnStages}
            /* THE COLOURWAYS THIS YARN IS ACTUALLY IN, off the same breakdown
               the weight came out of — not the order's whole combo list. A For
               naming a colourway this yarn does not appear in treats nothing,
               and offering it would be a facet whose answers cannot be right
               (AGENTS.md, Cascading filters). */
            combos={isRefusal(w) ? [] : w.byCombo.map((c) => c.combo).filter(Boolean)}
            /* THE SCREEN'S OWN GENERATOR, so a treatment added to a reopened BOM
               cannot collide with the keys `openExisting` has already issued. */
            newKey={newKey}
            /* The HOST screen's permissions standing in for "may I maintain this
               shared code list" — the model every `LookupDialogPicker` call site
               in this app uses. */
            canCreate={perms.canCreate}
            canEdit={perms.canEdit}
            readOnly={!perms.canEdit && !perms.canCreate}
          />
        );
      },
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
          <FieldGrid>
            {/* THE SPANS SUM TO 12 — 4 + 2 + 4 + 2 (client 2026-09-01: "adjust
                the screen field size compact it"). All four were `sm` (3 each),
                which gave a ten-character date the same width as an RE number
                that had to be truncated to fit: screenshot 2591 shows the order
                reading "!6-27/0010 · 121212 · AARSAN AMERICAS LLC" with its own
                start scrolled off. So the two dates go to `xs` and the two long
                values take the width they release — compacting the row and
                un-truncating it in the same change. `w` cannot do this: inside a
                FieldGrid the CELL still takes its column, so a narrower control
                would leave a hole beside it (see `Field.w`). */}
            <Field label="Garment order" required size="md" htmlFor="fb-order">
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
            <Field label="Date" required size="xs" htmlFor="fb-date">
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
            <Field label="Customer" size="md" htmlFor="fb-cust">
              {/* READ-ONLY, from the order. A readOnly field never holds the
                  cursor (AGENTS.md, Mandatory fields), which is right: its
                  source is the order picker above. */}
              <Input id="fb-cust" readOnly value={pickedOrder?.customer_name ?? ""} />
            </Field>
            <Field label="Delivery" size="xs" htmlFor="fb-del">
              <Input
                id="fb-del"
                readOnly
                value={pickedOrder?.delivery_date ? fmtDate(pickedOrder.delivery_date) : ""}
              />
            </Field>
          </FieldGrid>

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
          ) : (
            palette &&
            !palette.yarn.length &&
            !palette.fabric.length &&
            !palette.prints.length && (
              <p className="mb-3 text-xs text-muted-foreground">
                This order declares no dyeing colours or prints yet — they are
                entered on Orders ▸ Order Management ▸ Order Entry, under
                Color/Print Details.
              </p>
            )
          )}
          {/* A 2×2, WHICH IS `SectionGrid`'S DEFAULT AND NOT ITS `wrap` MODE
              (client 2026-09-01: "need to align the ui section make it
              organized").

              ## WHY `wrap` WAS WRONG HERE THOUGH IT IS RIGHT ONE SCREEN OVER

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
              up holding one item. `section-grid.tsx` argues at length against a
              `cols={n}` prop because a count needs a width to switch at — that
              argument is about choosing between 2 and 3, and it does not apply
              to taking the default, which already switches at `@4xl` and falls
              to a single column below it.

              ## THE ORDER OF THE FOUR IS THE POINT OF THE ARRANGEMENT

              Auto-placement fills left to right, so this reads:

                  Yarn Dyeing      | Fabric Dyeing
                  Roll form prints | Dia / Size Width Details

              Colour and Yarn Colour are a PAIR — one column each, same kind of
              value, split only by which section of the order declared them —
              and putting them side by side is the arrangement the client chose
              for this same pair on the order's own tab (2026-08-12, screenshots
              2269 · 2270). Below them, the last panel the order declares and the
              one panel this BOM owns.

              THE ORDER OF THE FOUR IS THE CLIENT'S OWN LIST, in their words:
              "all the color, yarn color, and roll-form print details … must
              automatically auto-fill", then the Size Details section to add. So
              Colour · Yarn Colour · Roll form prints · Dia. Every panel declares
              18rem of columns, so all four boxes still line up. */}
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
          <SectionGrid>
            <div className="min-w-0">
              <ChildGrid<PaletteRow>
                /* grid-caption: exempt -- four grids share this section; without captions
                   the operator cannot tell which is which. */
                label="Colour"
                columns={colourColumns("Colour")}
                rows={paletteRows(palette?.fabric)}
                fill
                hideAdd
                /* `hideRemove`, NOT `lockExisting` — and its own doc says why.
                   `lockExisting` withholds the ✕ only from the rows present at
                   MOUNT, and "a derived grid re-creates its rows on every render,
                   so that guard would protect the first set and nothing after
                   it". These rows are re-keyed the moment a different order is
                   picked, so every one of them would have arrived "new" and worn
                   a ✕ that calls a no-op. `hideRemove` takes Ctrl+Del with it,
                   so the keyboard and the mouse agree without a second rule. */
                hideRemove
                onAdd={() => false}
                onRemove={() => {}}
                renderMobileRow={mobileRowFor(colourColumns("Colour"))}
              />
            </div>
            <div className="min-w-0">
              <ChildGrid<PaletteRow>
                /* grid-caption: exempt -- the other half of the colour pair. */
                label="Yarn Colour"
                columns={colourColumns("Yarn colour")}
                rows={paletteRows(palette?.yarn)}
                fill
                hideAdd
                /* `hideRemove`, NOT `lockExisting` — and its own doc says why.
                   `lockExisting` withholds the ✕ only from the rows present at
                   MOUNT, and "a derived grid re-creates its rows on every render,
                   so that guard would protect the first set and nothing after
                   it". These rows are re-keyed the moment a different order is
                   picked, so every one of them would have arrived "new" and worn
                   a ✕ that calls a no-op. `hideRemove` takes Ctrl+Del with it,
                   so the keyboard and the mouse agree without a second rule. */
                hideRemove
                onAdd={() => false}
                onRemove={() => {}}
                renderMobileRow={mobileRowFor(colourColumns("Yarn colour"))}
              />
            </div>
            <div className="min-w-0">
              <ChildGrid<PaletteRow>
                /* grid-caption: exempt -- the third of four grids in one section. */
                label="Roll form prints"
                columns={printPaletteColumns}
                /* THE SAME DASH ROW as the two colour panels — see
                   `paletteRows`. Mapped inline rather than through it because
                   that helper reads `color_name`, and a print names itself. */
                rows={
                  palette?.prints.length
                    ? palette.prints.map((p) => ({
                        key: `p${p.sno}`,
                        value: p.print_name ?? "",
                      }))
                    : [DASH_ROW]
                }
                fill
                hideAdd
                /* `hideRemove`, NOT `lockExisting` — and its own doc says why.
                   `lockExisting` withholds the ✕ only from the rows present at
                   MOUNT, and "a derived grid re-creates its rows on every render,
                   so that guard would protect the first set and nothing after
                   it". These rows are re-keyed the moment a different order is
                   picked, so every one of them would have arrived "new" and worn
                   a ✕ that calls a no-op. `hideRemove` takes Ctrl+Del with it,
                   so the keyboard and the mouse agree without a second rule. */
                hideRemove
                onAdd={() => false}
                onRemove={() => {}}
                renderMobileRow={mobileRowFor(printPaletteColumns)}
              />
            </div>
            {/* THE ONE EDITABLE PANEL — the only one of the four carrying a
                real `onAdd` / `onRemove` rather than `hideAdd hideRemove` and the
                no-op pair. `ChildGrid` has no `readOnly` prop, so those two flags
                together are what remove the "+ Add" button and every row's ✕.

                IT IS ALSO THE ONLY PANEL THE ORDER CANNOT ANSWER, which is why
                the tab reads three-read-one-typed: the order declares its
                colours and prints, and the knitting diameter or woven width is
                a BOM-time fact about how the cloth is MADE. */}
            <div className="min-w-0">
              <ChildGrid<DiaRow>
                /* grid-caption: exempt -- the fourth of four grids in one section. */
                label="Dia / Size Width Details"
                columns={diaColumns}
                rows={dias}
                fill
                onAdd={() => mutDias((xs) => [...xs, blankDia(newKey())])}
                onRemove={(r) => mutDias((xs) => xs.filter((x) => x.key !== r.key))}
                addLabel="+ Add dia"
              />
            </div>
          </SectionGrid>
        </SectionBody>
      ),
    },
    {
      key: "lines",
      label: "Fabric Lines",
      icon: ListChecks,
      done: filledLines.length > 0,
      // THE ONE WIDE SECTION. The row is 1128px and the ordinary editor cap is
      // 1180px, so this is no longer a large margin — but the grid is still the
      // only thing in the section, and narrowing it would put the row back into
      // the sideways scroll the width budget exists to avoid. Was 14 columns
      // when this was written; it is 8 — see `FullScreenSection.wide`.
      wide: true,
      content: (
        <SectionBody title="Fabric Lines">
          {/* NO TOOLBAR BAND. "Seed from order" was removed from the UI at the
              client's instruction (2026-09-01), and with it the `mb-3` row it
              sat in — which was 48px of empty band between the section title and
              the grid, and the larger half of the "excess padding" reported in
              screenshot 2595. The button was the band's only occupant, so the
              wrapper goes with it rather than being left to reserve space for
              nothing.

              THE SEED DATA PATH IS UNTOUCHED. `seedState` still loads the
              order's tree on every order pick — `descriptorFor` reads it for the
              GSM Range and Type cells, and `orderStructures` reads it to scope
              the Structure picker. Only the button that CREATED ROWS from it is
              gone; lines are added with "+ Add fabric". */}
          <ChildGrid<LineRow>
            columns={lineColumns}
            rows={lines}
            seedRow
            /* The declared widths sum to 1128px including the row chrome, so
               the table may appear from 1152 (@6xl) — see `tableFrom`. Keep
               that inequality true when a column is added or resized: over
               1152 the table renders and immediately scrolls sideways. Without
               it the switch is @lg, which is 512px in a container query, and a
               laptop would get a table it has to scroll.

               THESE ARE CSS PIXELS, NOT THE ONES IN A SCREENSHOT. This was first
               written for @7xl (1280) against a pane measured off an image, and
               it stayed stacked on the operator's own monitor: Windows display
               scaling makes a 1920 screen about 1536 CSS px wide, so the pane
               was ~1260 and the threshold missed by 20. The CSS rule was
               present and correct throughout — the only symptom was cards.
               Measure the CONTAINER, never the picture of it. */
            tableFrom="6xl"
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
            onAdd={() => mut((xs) => [...xs, blankLine(newKey())])}
            onRemove={(r) => mut((xs) => xs.filter((x) => x.key !== r.key))}
            addLabel="+ Add fabric"
          />
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
     * ## THE SPLIT IS THE ORDER-ENTRY ONE
     *
     * A row per entry, and a `[Sizes]` button opening a Sheet — the same shape
     * Combos ▸ [Detail] and Quantities ▸ [Assort] take, down to `zIndexBase`,
     * `fullBleed` and `SubSheetFooter`. Three reasons it is right here rather
     * than merely familiar:
     *
     *  - **The size table is nine columns wide in calculated mode** and is read
     *    one entry at a time; three entries × six sizes inline is eighteen rows
     *    of eight cells on a section nobody can scan.
     *  - **The entry row is where the grouping decision is made** — structure,
     *    panels, mode, wastage — and it wants to be readable as a list, which is
     *    how the planner checks the partition covers every panel once.
     *  - **It is already on the keyboard.** `data-row-open` puts the button in
     *    `ROW_FIELDS`, so Tab, Enter and the arrows all reach it — the marker
     *    exists because Combos ▸ Detail was mouse-only until 2026-08-19.
     *
     * ## `done` IS AN ANSWERED SIZE, NEVER A MODE
     *
     * Lighting the quiet dot on the mode dropdown would report the planner as
     * having answered the section by opening a Select. What this section owns is
     * the weights, so that is what it counts — the same call Color/Print Details
     * makes when it lights on the dia and not on the palette it reads.
     */
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
              {filledLines.length === 0 && (
                <p className="mb-3 text-xs text-muted-foreground">
                  Name a fabric under Fabric Lines first — an entry says which
                  structure a weight is for, and the fabric itself comes from
                  there.
                </p>
              )}
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
                  columns={manualColumns}
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
                  tableFrom="6xl"
                  centerHeaders
                  renderMobileRow={(row) => (
                    <FieldGrid>
                      {manualColumns.map((c, ci) => (
                        <Field key={ci} label={c.header} size="sm">
                          {c.cell(row, ci)}
                        </Field>
                      ))}
                    </FieldGrid>
                  )}
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
     * `hideAdd` + `lockExisting` — this screen's own read-only idiom, from the
     * palette panels above (`ChildGrid` has no `readOnly` prop, and those two
     * flags together remove the "+ Add" button and every row's ✕). Here it
     * enforces a client rule rather than a display choice: "the developer must
     * ensure the planner cannot manually add new yarns here; the rows are
     * strictly populated based on the mapped technical fabrics."
     *
     * The CELLS inside are still live — a process and a loss per row. What is
     * locked is the membership of the list.
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
            <ChildGrid<YarnRow>
              columns={yarnColumns}
              rows={yarnRows}
              /* `6xl`, THE ONE THRESHOLD EVERY GRID ON THIS SCREEN TAKES —
                 Fabric Lines, Manual and both route grids. Its declared widths
                 sum to ~832px plus ~80 of `#`/remove chrome, so it would fit from 1024 (@5xl), and it USED to say so
                 while claiming in the same breath to match "the two route
                 grids" — which are 6xl. The claim was the intent and the number
                 was the drift: between 1024 and 1152px of pane this tab alone
                 drew a table while every other tab stacked into cards, so the
                 content changed shape as the operator moved along the rail.
                 Fitting sooner is not worth being the only tab that does.
                 Below it the grid stacks; it never scrolls sideways (rule 4). */
              tableFrom="6xl"
              centerHeaders
              /* `renderMobileRow` STAYS. The DEFAULT stacked cell is a bare
                 <div> around a RequiredScope with NO VISIBLE LABEL, so dropping
                 this as redundant turns the sub-@6xl fallback into four
                 unlabelled boxes — the mistake this screen records having made
                 once already. */
              renderMobileRow={(row, i) => (
                <FieldGrid>
                  {yarnColumns.map((c, ci) => (
                    <Field key={ci} label={c.header} size="sm">
                      {c.cell(row, i)}
                    </Field>
                  ))}
                </FieldGrid>
              )}
              hideAdd
              lockExisting
              onAdd={() => false}
              onRemove={() => {}}
            />
          )}

          {/* WHERE THIS FIGURE GOES, said once and only when there is one.
              The client's own chain — "the calculated yarn list, along with
              these final adjusted purchase weights, must automatically transfer
              and populate the Yarn Purchase section of the Budget" — is
              invisible from this grid, and a planner who does not know it will
              look for somewhere else to enter the same numbers. This is also the
              one place on the screen that says the loss DOES compound into a
              purchase, which is the opposite of the Fabric Process tab's rule
              one section down. */}
          {yarnRows.length > 0 && (
            <p className="mt-4 text-xs text-muted-foreground">
              Each weight is the fabric requirement for that yarn&rsquo;s share of
              its cloth, plus its process loss. Recording this BOM sends them to
              Budgeting as the Yarn Purchase lines.
            </p>
          )}
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
     * its knit type and its width — every one of which is already on the Fabric
     * Lines section above, and two of which (the description, the dia) the
     * ORDER owns and this screen only mirrors. A second editable copy would be
     * a second place for one BOM to disagree with itself, which is the argument
     * `getOrderPalette` makes for the three read-only palette panels and 0491
     * repeats for the Manual tab's first two levels. So a fabric is a HEADING
     * here, never a row of inputs.
     *
     * ## WHY A CARD PER FABRIC AND NOT A [Click] BUTTON
     *
     * The Garment Order's Style ▸ Process is a button opening a sheet, and it
     * was the wrong model for a structural reason rather than a taste: THERE
     * the outer row is editable, so the button is one cell among fields. Here
     * the outer row is read, which also rules out `ChildGrid`'s `foldRows` —
     * that prop's own note requires a folded row to keep at least one real
     * field, or Tab cannot reach it and the row is mouse-only.
     *
     * What is left is exactly the shape Fabric Plan ▸ Routes uses one step
     * later on these same fabrics, and that is the strongest argument of the
     * three: the two screens ask the same question and should not look like
     * different features.
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
          {fabricGroups.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Name a fabric on Fabric Lines first — each one gets its own route
              here.
            </p>
          ) : (
            /* NO WRAPPER SPACING — each group carries its own `py-3`, so the
               rule between two of them sits in the middle of 24px rather than
               against one of their edges. */
            <div>
              {fabricGroups.map((g, gi) => {
                const rows = procs.filter((p) => p.item_id === g.item_id);
                const steps = routeStepCount(rows);
                /* WHAT THIS FABRIC IS USED FOR, gathered from its lines rather
                   than named again. A fabric on several lines is several
                   colourways and several panels — which is exactly the fact that
                   makes ONE route right for all of them, so the card says so
                   instead of leaving the operator to wonder whether the route
                   they are typing covers the collar as well as the body. */
                const combos = [
                  ...new Set(g.lines.map((l) => l.combo.trim()).filter(Boolean)),
                ];
                const panels = [
                  ...new Set(g.lines.map((l) => componentName(l)).filter(Boolean)),
                ];
                const structures = [
                  ...new Set(g.lines.map((l) => structureName(l)).filter(Boolean)),
                ];
                return (
                  /* NO BOX PER FABRIC (operator rule 4, client 2026-08-19:
                     "all the lines look same kind, so can't tell the next
                     section" and, before it, the report that a section of six
                     lines read as a stack of boxes rather than a table).

                     THIS TAB WAS THE ONE SURVIVOR OF THAT RULE. Every other
                     section here hands `SectionBody` a `ChildGrid` — one frame,
                     flush to the section's edge — and this one wrapped each
                     fabric in `rounded-md border p-3`, so its grids started 13px
                     further in than every other tab's AND drew a frame inside a
                     frame. Switching tabs moved the whole content column, which
                     is what "the tab area is unaligned" looks like from the
                     outside.

                     `ChildGrid` owns this idiom for `flatRows` / `listRows` and
                     no screen sets it — but the grouping here is the SCREEN's
                     (one card per fabric, `fabricGroups`), so this is the one
                     place that has to draw the same boundary itself. Same two
                     halves, for the same reasons `child-grid.tsx` records:
                     `border-t-2` because a 1px line reads as chrome next to
                     field edges that are also 1px, and `py-3` because proximity
                     groups more reliably than ink — 24px between fabrics against
                     8px inside one. */
                  <div
                    key={g.item_id}
                    className={cn("py-3", gi > 0 && "border-t-2 border-border-strong")}
                  >
                    {/* THE LEGACY "Fabric Detail" ROW, AS A HEADING — its two
                        outer rows are fabric descriptions, and this is one of
                        them. `Truncated` because a fabric name carries its whole
                        composition bracket and an ellipsis with nothing behind
                        it is a dead end (AGENTS.md, Truncated values). */}
                    <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                      <span className="text-sm font-semibold text-foreground">
                        <Truncated>{g.name || "(fabric not in the master)"}</Truncated>
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {[structures.join(", "), combos.join(", "), panels.join(", ")]
                          .filter(Boolean)
                          .join(" · ") ||
                          /* NO LINE NAMES IT ANY MORE — see `fabricGroups`. Said
                             in words, because a card that has simply lost its
                             subtitle looks like a card whose lines said nothing.
                             The next save drops these rows, and this is the
                             operator's chance to see that coming. */
                          (g.lines.length === 0
                            ? "no fabric line uses this any more — this route will be dropped on Save"
                            : "whole order")}
                      </span>
                      <span className="ml-auto text-xs text-muted-foreground">
                        {steps
                          ? `${steps} step${steps === 1 ? "" : "s"}`
                          : "no route yet"}
                      </span>
                    </div>

                    <FabricProcessGrid
                      itemId={g.item_id}
                      rows={rows}
                      onChange={(next) => setFabricProcs(g.item_id, next)}
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
                  </div>
                );
              })}
            </div>
          )}

          {/* WHERE THE LOSS GOES, said once and only while a route exists.
              Without it `loss_pct` reads as a figure this screen ought to be
              multiplying by — and the reason it is not (0426 reserves process
              loss for step 4, "applying it here as well charges the same loss
              twice") is invisible from the grid. An operator who expects the
              stored requirement to move when they type 5% and finds it does not
              has no way to tell a rule from a bug.

              IT NO LONGER NAMES A SECTION. Calculated Quantities was removed on
              2026-09-01 and a sentence pointing at a row that is not there is
              worse than none — the operator goes looking, fails, and concludes
              the screen is broken rather than the sentence (AGENTS.md says this
              of menu paths; it is truer of a line the operator can read). */}
          {procs.some((p) => !!p.process_id) && (
            <p className="mt-4 text-xs text-muted-foreground">
              These losses are planned with on Fabric Plan, which solves each
              step backwards from the requirement. They do not change the
              quantities this BOM computes — those carry the cutting wastage only.
            </p>
          )}
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
        consumption_uom_id: l.consumption_uom_id,
        notes: l.notes || null,
      })),
      /* SENT WHOLE AND FILTERED ON THE SERVER (`normalizeDias`), never trimmed
         here. Two places deciding what counts as an empty row is how the form
         and the database come to disagree about how many rows were saved — the
         division `normalizeLines` already draws, and the reason the blank row a
         grid opens with is harmless. */
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
        structure_id: e.structure_id,
        calc_mode: calcModeOf(e.calc_mode),
        wastage_pct: numOrNull(e.wastage_pct) ?? 0,
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
            },
            gsmForStructure(e.structure_id),
          ),
          table_width: numOrNull(z.table_width),
          length: numOrNull(z.length),
          length_tolerance: numOrNull(z.length_tolerance),
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
        rate: numOrNull(p.rate),
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
          /* `|| null` — the cell holds `""` for "every colourway" and the column
             stores NULL. Sending "" would store an empty string that
             `comboKey` reads the same way but nothing else does. */
          combo: st.combo || null,
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
              <span>· {filledLines.length} fabric {filledLines.length === 1 ? "line" : "lines"}</span>
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

      {/*
       * THE MANUAL SIZE SHEET (0494) — legacy's third level.
       *
       * MOUNTED OUTSIDE `MasterFullScreen`, at the editor root, and NOT inside
       * the grid cell that opens it. Two separate reasons, both load-bearing:
       *
       *  - It layers above the whole editor the way legacy's does, and
       *    `zIndexBase` clears the full-screen surface beneath it. Same mount
       *    Combos ▸ Structure Details and Quantities ▸ Assortments take.
       *  - `ChildGrid` wraps every cell in a `RequiredScope`, and that scope
       *    follows the RENDER tree — so a Sheet rendered from inside a cell of a
       *    grid with mandatory columns would have every optional field within it
       *    inherit "required", stamp `data-required-empty` and hold the cursor.
       *    That is the New Yarn / Purity defect (2026-08-06); `Sheet` resets the
       *    scope at its portal boundary, which only helps if the Sheet is what
       *    is being portaled.
       *
       * NO SAVE OF ITS OWN. The size rows live in `entries` and are written by
       * this screen's Save — a second Save here would imply they commit on their
       * own, and on a NEW BOM there is no id for them to commit against. Closing
       * is Escape or ✕, one layer at a time, per the keyboard contract.
       */}
      <Sheet
        open={!!manualStyle}
        onClose={() => setManualStyle(null)}
        title={
          manualStyle
            ? `Manual Consumption — ${
                manualStyle.unscoped ? "Every style" : manualStyle.style_ref_no
              }${manualStyle.article_no ? ` · ${manualStyle.article_no}` : ""}`
            : "Manual Consumption"
        }
        zIndexBase={120}
        /* THE WHOLE PANE. An entry card carries eight fields and a size grid of
           up to ten columns; the 1180px reading width wraps the last cells away
           from the ones they belong to and leaves ~220px of white down each
           side. Same exception Combos ▸ Structure Details and the assortment
           matrix both earned. */
        fullBleed
        footer={
          <SubSheetFooter
            parent="fabric BOM"
            onDone={() => setManualStyle(null)}
            /* DONE REFUSES WHILE ANY OF THIS STYLE'S ENTRIES IS UNANSWERED, in
               the SAME sentence the rail and the dead Save use — `manualBlockers`
               calls the same `manualProblem`. Proximity: the objection belongs
               beside the thing being objected to, not two tabs away at Save.

               ESCAPE AND ✕ STAY LIVE. They run through `onClose`, which this
               does not touch. A style whose order states no sizes has no cells
               to type into, so a rule enforced on every exit would be
               unsatisfiable and would seal the planner in. */
            blockedReason={
              manualStyle
                ? (entriesForStyle(manualStyle.style_ref_no)
                    .map((e) =>
                      manualProblem(
                        entryLike(e),
                        orderSizesFor(e.style_ref_no),
                        gsmForStructure(e.structure_id),
                      ),
                    )
                    .find((x) => x !== null)?.refused ?? null)
                : null
            }
            onBlocked={(why) => toastError(why)}
          />
        }
      >
        {manualStyle && (
          <div className="space-y-4">
            {/* WHAT THE ORDER SAYS ABOUT THIS STYLE, and nothing the planner can
                change here. Style No, Article No and Unit are the spec's header
                fields; the colourways are its "Assort-wise Color". A sentence
                rather than a band of read-only boxes: a box invites a click that
                does nothing. */}
            <p className="text-xs text-muted-foreground">
              {[
                manualStyle.style_no ? `Style No ${manualStyle.style_no}` : null,
                manualStyle.article_no ? `Article ${manualStyle.article_no}` : null,
                unitKindLabel(manualStyle.unit_kind) || null,
                combosForStyle(manualStyle.style_ref_no).length
                  ? `Colours: ${combosForStyle(manualStyle.style_ref_no).join(", ")}`
                  : null,
              ]
                .filter(Boolean)
                .join("  ·  ") || "This style declares no colourways on the order yet."}
            </p>

            <ChildGrid<ManualEntryRow>
              /* grid-caption: exempt -- the overlay names no grid; this caption
                 is the only thing that says what the cards are. */
              label="Fabric weights"
              /* AN EMPTY `columns` ARRAY, DELIBERATELY — the shape Combos ▸
                 Structure Details takes and for its stated reason: this grid
                 renders its own row, so `ChildGridColumn.required` would never
                 reach a cell and every star would be drawn with nothing behind
                 it (AGENTS.md, "a star with nothing behind it"). Each field
                 declares `required` itself, on the control, below. */
              columns={[]}
              rows={entriesForStyle(manualStyle.style_ref_no)}
              forceCards
              /* ONE FRAME, not a card inside a card — the client's own call on
                 the sibling overlay ("remove that structure details frame also,
                 one frame is enough"). */
              flatRows
              /* ONE FABRIC OPEN AT A TIME. Eight fields plus a size grid is most
                 of the viewport, and a style with three fabrics would push
                 "+ Add fabric" out of sight. */
              foldRows
              canFold={(e) => !!e.structure_id}
              renderFoldedRow={(e) => {
                const totals = entryTotals(e);
                const parts = e.component_ids
                  .map((id) => data.components.find((c) => c.id === id)?.name)
                  .filter(Boolean)
                  .join(" + ");
                /* THE WHOLE OF A CLOSED FABRIC, because that is a fold's job.
                   The Gross is here and not only inside: it is the figure that
                   leaves this tab, and a closed row that hid it would make the
                   planner open every card to compare them. */
                return (
                  <div className="cursor-pointer space-y-1 border-l-2 border-transparent pl-4">
                    <div className="text-sm font-medium">
                      {data.structures.find((x) => x.id === e.structure_id)?.name ??
                        "(no structure)"}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {[
                        parts || null,
                        diaTypeOf(e) || null,
                        WIDTH_FORM_OPTIONS.find((o) => o.value === e.width_form)?.label ?? null,
                        calcModeOf(e.calc_mode) === "calculated" ? "Calculated" : null,
                        totals.gross == null
                          ? null
                          : `Cons Wt ${fmtNumber(totals.gross)} kg`,
                      ]
                        .filter(Boolean)
                        .join("  ·  ") || "Not answered yet"}
                    </div>
                  </div>
                );
              }}
              renderMobileRow={(e) => (
                <div className="space-y-3">
                  <FieldGrid>
                    <Field label="Fabric structure" required size="sm">
                      <RecordPicker
                        label="Fabric structure"
                        compact
                        required
                        items={structureItemsFor(e.structure_id)}
                        value={e.structure_id}
                        onChange={(id) => setEntryCell(e.key, { structure_id: id })}
                      />
                    </Field>
                    <Field label="Components" required size="lg">
                      <MultiSelect
                        label="Components"
                        compact
                        required
                        options={componentOptionsFor(e)}
                        values={e.component_ids}
                        onChange={(next) => setEntryCell(e.key, { component_ids: next })}
                        /* A STATE OF THE RECORD, which is the one thing a
                           placeholder may still say. With every panel taken by
                           another entry ON THIS STYLE there is genuinely nothing
                           to choose, and an empty popup with no words reads as
                           broken rather than as the rule working. */
                        emptyLabel="Every component is already used on this style"
                      />
                    </Field>
                    <Field label="Dia type" size="sm">
                      {/* READ-ONLY, from the dias the sizes pick. Plain text: a
                          derived value was not typed, so it is not a field. */}
                      <Input readOnly value={diaTypeOf(e)} />
                    </Field>
                    <Field label="Assort widths" size="sm">
                      <Select
                        compact
                        aria-label="Assort widths"
                        value={e.width_form}
                        onChange={(ev) => setEntryCell(e.key, { width_form: ev.target.value })}
                      >
                        {/* BLANK IS A REAL STATE here, unlike the mode beside
                            it: the column is nullable because an entry may not
                            have been told yet whether the cloth is slit. */}
                        <option value="" />
                        {WIDTH_FORM_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="Weight from" size="sm">
                      <Select
                        compact
                        aria-label="Weight mode"
                        value={calcModeOf(e.calc_mode)}
                        onChange={(ev) => setEntryCell(e.key, { calc_mode: ev.target.value })}
                      >
                        {/* NO BLANK. The column is NOT NULL with a default and
                            the planner is always doing one or the other; an
                            empty entry would offer a state the database cannot
                            hold. */}
                        {CALC_MODE_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="Loss %" size="sm">
                      <Input
                        className="text-right"
                        inputMode="decimal"
                        value={e.wastage_pct}
                        onChange={(ev) => setEntryCell(e.key, { wastage_pct: ev.target.value })}
                      />
                    </Field>
                    <Field label="GSM" size="sm">
                      {/* THE ORDER'S, abstaining where its colourways disagree —
                          see `gsmForStructure`. It is what the calculated mode
                          multiplies, so it is shown where that choice is made. */}
                      <Input
                        readOnly
                        value={
                          gsmForStructure(e.structure_id) == null
                            ? ""
                            : String(gsmForStructure(e.structure_id))
                        }
                      />
                    </Field>
                  </FieldGrid>

                  {/* THE SIZE GRID, NESTED INSIDE THE FABRIC IT BELONGS TO —
                      legacy's third level, and what puts Cons Wt beside the
                      Loss % that produced it. AGENTS.md: "A ROW'S NESTED GRID IS
                      PART OF THE ROW", so Tab walks the card's fields and then
                      the panel beneath. */}
                  <ChildGrid<ManualDisplayRow>
                    /* grid-caption: exempt -- the card is the caption; a second
                       heading inside it would name the same thing twice. */
                    columns={sizeColumns(e)}
                    rows={manualSizeRows(e)}
                    /* The rows are the ORDER's sizes — no "+ Add", no ✕, and
                       `hideRemove` rather than `lockExisting` because they are
                       re-derived on every render. */
                    hideAdd
                    hideRemove
                    onAdd={() => false}
                    onRemove={() => {}}
                    tableFrom="6xl"
                    centerHeaders
                    renderMobileRow={(row) => (
                      <FieldGrid>
                        {sizeColumns(e).map((c, ci) => (
                          <Field key={ci} label={c.header} required={c.required} size="sm">
                            {c.cell(row, ci)}
                          </Field>
                        ))}
                      </FieldGrid>
                    )}
                  />
                  {manualSizeRows(e).length === 0 && (
                    <p className="text-xs text-muted-foreground">
                      This style states no sizes yet — size quantities are entered
                      on Orders ▸ Order Management ▸ Order Entry, under Approval
                      Qty.
                    </p>
                  )}
                </div>
              )}
              onAdd={() =>
                mutEntries((xs) => [
                  ...xs,
                  blankManualEntry(newKey(), manualStyle.style_ref_no),
                ])
              }
              onRemove={(r) => mutEntries((xs) => xs.filter((x) => x.key !== r.key))}
              addLabel="+ Add fabric"
            />
          </div>
        )}
      </Sheet>

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
      <ComponentMapSheet
        open={!!detailLine}
        onClose={() => setDetailKey(null)}
        title={
          detailLine
            ? /* THE FABRIC IS THE SUBJECT, and the style is what tells two
                 sheets over one cloth apart — a BOM covers many styles, and the
                 mapping is per style because the panels are. */
              [
                data.fabrics.find((f) => f.id === detailLine.item_id)?.name ?? "Fabric",
                detailLine.style_ref_no || null,
              ]
                .filter(Boolean)
                .join(" — ")
            : "Components"
        }
        lines={detailLines}
        allLines={lines}
        decls={styleDecls}
        components={data.components}
        coordinates={data.coordinates ?? []}
        colourOptions={declaredColours}
        printOptions={declaredPrints}
        structureId={detailLine?.structure_id ?? null}
        styleRefNo={detailLine?.style_ref_no ?? ""}
        onPatchPanel={patchPanel}
        onPatchLine={(key, patch) => setCell(key, patch)}
        onAddPanel={addPanel}
        onRemovePanel={removePanel}
      />
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
    <div className="mt-3 rounded-md border border-border bg-surface-muted px-3 py-2 text-xs">
      <span className="mr-2 font-medium text-foreground">Planning against:</span>
      {body}
    </div>
  );
}
