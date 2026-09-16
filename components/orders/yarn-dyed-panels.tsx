"use client";

/**
 * Fabric BOM ▸ [Detail] ▸ **Yarn Dyed Details** — the three panels (0512).
 *
 * Legacy screenshot 2615, client 2026-09-02: "repeats, mixing details,
 * combinations — this three section add it like same field order structure with
 * better UI; screen can use top bar … if we click the tab the actual screen of
 * that field will display in that single screen".
 *
 * So the field ORDER is legacy's, verbatim, and the arrangement is not: legacy
 * stacks all three grids down one popup, and these are three tabs of the
 * [Detail] sheet's own strip. That is what the client asked for and it is also
 * the app's standing shape — `components/ui/tabs.tsx` records the rule ("a
 * DOCUMENT's tabs are the document's own pages and belong on a top strip, which
 * is also the legacy RP-Software shape the operators already know").
 *
 * ## THEY LIVE HERE RATHER THAN IN `component-map-sheet.tsx`
 *
 * That file is 819 lines about ONE subject — which panel of the garment is cut
 * from this cloth. These three are a different subject on the same cloth (how
 * its yarn is dyed), and the only thing they share is the fabric group the sheet
 * is open on. Keeping them apart is what stops the sheet becoming the file every
 * later tab is added to.
 *
 * ## MIXING DETAILS IS A READ-ONLY PANEL, AND THAT IS THE DESIGN
 *
 * It derives from Repeats through `mixingDetailRows` (lib/orders/fabric-bom/
 * yarn-dyed.ts), which carries the arithmetic and the vectors. Nothing on it is
 * typed, so it uses TABLE MODE rather than `inlineCards`: a read-only grid of
 * plain text in `inlineCards` draws no borders at all and reads as floating
 * words — the mistake [[raagam-fabric-bom-color-print]] records making on the
 * Color/Print panels, in this same module, a day earlier.
 */

import { useMemo } from "react";
import { ChildGrid, type ChildGridColumn } from "@/components/masters/child-grid";
import { Field, FieldGrid } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Truncated } from "@/components/ui/truncated";
import { RecordPicker } from "@/components/masters/record-picker";
import { Sheet, type SheetOrigin } from "@/components/ui/sheet";
import { SubSheetFooter } from "@/components/orders/sub-sheet-footer";
import { fmtNumber } from "@/lib/format";
import { colourCountNote } from "@/lib/orders/fabric-bom/fabric-line-rules";
import {
  colorNetWeight,
  mixingDetailRows,
  type MixingDetailWithNet,
  type YdRepeatRow,
} from "@/lib/orders/fabric-bom/yarn-dyed";
import type { FabricComposition } from "@/lib/orders/fabric-bom/yarn-process";

/** The shape every picker in this module takes. `code` is `string | null` and
 *  NOT optional, because that is `PickerItem`'s own contract — `RecordPicker`
 *  reads all three deactivation spellings straight off the row, so a looser
 *  local alias only moves the mismatch to the call site. */
type PickerRow = { id: string; code: string | null; name: string; inactive?: boolean };

/**
 * One entry of a Combinations row's Color breakdown (0560) — one colour at
 * one POSITION (a dyed Mixing Details row of the fabric group; see
 * `CombinationPosition`). `key` is client-only, same as every other row in
 * this file; `yarn_color` is free text, matching `yd_combo_name` on the
 * parent — the colour as the knitting floor names it, not a picked master
 * value. Addressed by ARRAY INDEX against `positions`, never by its own
 * identity — see `colorAt` in the Combinations panel.
 */
export type YdCombinationColorRow = {
  key: string;
  yarn_color: string;
  /**
   * PER-SHADE DYEING LOSS (0568) — CARRIED, NOT YET TYPED ANYWHERE.
   *
   * There is no Loss cell on this panel yet. It is in this type so that a SAVE
   * RE-SENDS WHAT IS ALREADY STORED, because the Fabric BOM's write is
   * delete-then-reinsert and `fabricBomYdCombinationColorInput.dyeing_loss_pct`
   * defaults to 0 — so a column missing from this row type is not ignored on
   * save, it is overwritten with the default.
   *
   * THIS WAS ARMED, NOT HYPOTHETICAL. GREEN 5 / RED 4 / WHITE 3 were stored on
   * a live order to verify 0568's arithmetic, and the next Save from this
   * screen would have reset all three to 0 with nothing said. That is the third
   * time today one hand-maintained client row type has silently dropped a
   * column: `dia` and `consumption` on `LineRow` were the first two. The shape
   * is always the same — a subset type over a wholesale rewrite.
   */
  dyeing_loss_pct: number | null;
};

/** One typed row of the Combinations panel. */
export type YdCombinationRow = {
  key: string;
  combo: string;
  yd_combo_name: string;
  colors: YdCombinationColorRow[];
};

/**
 * A cell that is a number and nothing else. `fmtNumber` rather than
 * `toLocaleString`: [[raagam-fmtnumber-3dp]] records that a bare
 * `toLocaleString` silently caps every figure at three decimals and rounds to
 * nearest, which on a percentage is a wrong number that looks right.
 */
function NumCell({ value, suffix = "" }: { value: number | null; suffix?: string }) {
  return (
    <span className="tabular-nums text-sm">
      {value == null ? "—" : `${fmtNumber(value)}${suffix}`}
    </span>
  );
}

/**
 * The Yarn Colour options a Color cell may offer — the order's OWN declared
 * palette (Color/Print Details ▸ Yarn Colour, `lib/orders/fabric-bom/
 * palette.ts`), never free text (client transcript, 2026-09-15: "color names
 * are populated strictly from master lists/selections", check.md §3 "Individual
 * 'Yarn Colors' must be sourced from the Yarn Master").
 *
 * A HELD VALUE ALWAYS SURVIVES, tagged — same "Disabled rows" idiom every other
 * scoped list in this file follows (`yarnItemsFor` above): a colour typed here
 * before the palette existed, or since removed from Color/Print Details, must
 * stay resolvable on the row that holds it rather than blank the cell.
 */
function colourOptionsFor(held: string, options: readonly string[]): string[] {
  const v = held.trim();
  if (!v || options.includes(v)) return [...options];
  return [...options, v];
}

/**
 * "Color 1" / "Color 2" … / "Grey" — what `RepeatsPanel`'s OWN Color column
 * shows, READ-ONLY (2026-09-15 correction, doc/order/check.md §3 + client
 * transcript: real colour names moved OFF this panel and onto Combinations'
 * per-combo pickers). A repeat is a physical stripe POSITION, not a real
 * colour — the same position holds a DIFFERENT actual colour per combo
 * (PARISIAN NIGHT's stripe 1 is GREEN, CRANBERRY's stripe 1 is WHITE), which
 * is exactly why Combinations carries its own picker (`colourOptionsFor`
 * above). A real name typed or picked HERE would answer a question that is
 * Combinations' to answer, and disagree with it the moment a second combo
 * named a different colour for the same stripe.
 *
 * `mixingDetailRows` (yarn-dyed.ts) computes the identical label for the same
 * reason, over the DYED subset it already filters to — this is the twin over
 * the FULL row list `RepeatsPanel` renders, so it has to skip `grey` rows
 * explicitly rather than getting that for free from a pre-filtered array.
 */
export function repeatPositionLabel(rows: readonly YdRepeatRow[], index: number): string {
  const row = rows[index];
  if (!row || row.dye_type === "grey") return "Grey";
  let n = 0;
  for (let i = 0; i <= index; i++) {
    if (rows[i]?.dye_type === "dyed") n++;
  }
  return `Color ${n}`;
}

/**
 * HOW MANY DYED REPEATS THIS FABRIC HAS — what the declared `No Of Colors`
 * (0513) is compared against.
 *
 * A PLAIN COUNT, not a distinct-name count. The Color cell is a read-only
 * position label now (`repeatPositionLabel`, above), unique by construction,
 * so de-duplicating by name can no longer catch anything a plain length
 * would not — the trap that logic existed for (two repeats of a real colour
 * typed twice) cannot occur once the cell is no longer typed at all.
 *
 * `grey` IS EXCLUDED, like everywhere else in this feature: it is the undyed
 * remainder, not a colour.
 */
function dyedColourCount(rows: readonly YdRepeatRow[]): number {
  return rows.filter((r) => r.dye_type === "dyed").length;
}

// ===========================================================================
// 1. REPEATS — the typed panel
// ===========================================================================

/**
 * `S No | Yarn | Type | Color | Uom | Value` — legacy's order. `Twisted Yarn`
 * was on this row too; removed from the grid on client instruction
 * (2026-09-12) — `twisted_yarn` stays on `order_fabric_bom_yd_repeats`,
 * unrendered, same as `order_fabric_bom_lines.specification`.
 *
 * THE YARN LIST IS THE CLOTH'S OWN COMPOSITION, not the whole item master. Same
 * restriction the Structure picker on Fabric Lines carries and for the client's
 * same stated reason there ("the user cannot add new structures here; they are
 * strictly restricted to what is in the order"): a repeat naming a yarn the
 * fabric is not made of dyes something this cloth does not contain, and
 * `yarnShareOf` would answer 0 for it — a Mixing % of zero with no explanation.
 *
 * A HELD YARN ALWAYS SURVIVES THE FILTER, tagged. The composition is edited on
 * the Material master, so a yarn can leave it long after this BOM was planned;
 * dropping the option would blank the cell and the next Save would make that
 * permanent. Same rule as "Disabled rows" in AGENTS.md, applied to a list that
 * is scoped rather than flagged.
 */
export function RepeatsPanel({
  rows,
  yarns,
  composition,
  declaredColourCount,
  onPatch,
  onAdd,
  onRemove,
}: {
  rows: readonly YdRepeatRow[];
  /** `No Of Colors` from the fabric line (0513), or null when not declared. */
  declaredColourCount: number | null;
  yarns: readonly PickerRow[];
  composition: FabricComposition | null;
  onPatch: (key: string, patch: Partial<YdRepeatRow>) => void;
  onAdd: () => void;
  onRemove: (row: YdRepeatRow) => void;
}) {
  const inComposition = useMemo(
    () => new Set((composition?.components ?? []).map((c) => c.yarn_id)),
    [composition],
  );

  const yarnItemsFor = (held: string | null): PickerRow[] => {
    const scoped = yarns.filter((y) => inComposition.has(y.id));
    if (!held || scoped.some((y) => y.id === held)) return scoped;
    const row = yarns.find((y) => y.id === held);
    return row ? [...scoped, { ...row, name: `${row.name} (not in this fabric)` }] : scoped;
  };

  const columns: ChildGridColumn<YdRepeatRow>[] = [
    {
      header: "Yarn",
      width: "13rem",
      cell: (r) => (
        <RecordPicker
          label="Yarn"
          compact
          items={yarnItemsFor(r.yarn_item_id)}
          value={r.yarn_item_id}
          onChange={(id) => onPatch(r.key, { yarn_item_id: id })}
        />
      ),
    },
    {
      /* LEGACY'S Type DROPDOWN, and the two words are the stored values
         verbatim. `grey` is the UNDYED remainder — it draws no Mixing Details
         row and is excluded from that panel's denominator (see yarn-dyed.ts),
         so it is a real answer rather than a blank. */
      header: "Type",
      width: "6rem",
      cell: (r) => (
        <Select
          compact
          className="h-8"
          value={r.dye_type}
          onChange={(e) =>
            onPatch(r.key, { dye_type: e.target.value === "grey" ? "grey" : "dyed" })
          }
        >
          <option value="dyed">Dyed</option>
          <option value="grey">Grey</option>
        </Select>
      ),
    },
    {
      /* READ-ONLY, NEVER A PICKER (2026-09-15 correction, reversing the
         SAME DAY's earlier "make it a Select" pass) — see
         `repeatPositionLabel`'s own note for why a real colour does not
         belong on this panel at all: the picker moved to Combinations,
         where a stripe position can actually carry a different colour per
         combo. `index` is the ROW's own position — `renderMobileRow` below
         passes it through rather than a column index, which is what this
         cell needs and none of its siblings previously cared about. */
      header: "Color",
      width: "8rem",
      cell: (r, index) => (
        <Input
          readOnly
          className="h-8 bg-surface-muted text-muted-foreground"
          value={repeatPositionLabel(rows, index)}
        />
      ),
    },
    /* THE "Uom" COLUMN IS REMOVED (operator, 2026-09-15: "we already give it
       in front table so hide it from here both area") — the fabric LINE's
       own Mixing UOM column (`mixing_uom_id`, 0514) already declares one
       unit for the whole fabric group, so a second, per-repeat Uom here was
       asking the same question twice. `uom_id` stays on `YdRepeatRow`/the
       DB column, unused, rather than being ripped out — see
       `mixingDetailRows`'s own note on why the calculation no longer needs
       it either. */
    {
      header: "Value",
      align: "right",
      width: "6rem",
      cell: (r) => (
        <Input
          className="h-8 text-right"
          type="number"
          value={r.value ?? ""}
          onChange={(e) =>
            onPatch(r.key, { value: e.target.value === "" ? null : Number(e.target.value) })
          }
        />
      ),
    },
  ];

  return (
    <div className="space-y-3">
      {/* CONDITIONAL, NEVER STANDING (AGENTS.md: a heading gets no sentence).
          It renders only while the state it describes is true, and it is the
          "empty and explain" half: a fabric whose master states no composition
          gives an empty Yarn list, and without this the operator meets a
          dropdown with nothing in it and no idea where the answer lives. */}
      {(composition?.components.length ?? 0) === 0 && (
        <p className="text-xs text-warning">
          This fabric states no yarn composition on the material master, so no
          yarn can be named here. Add its mixing rows on Master Data ▸ Materials.
        </p>
      )}
      {/* THE DECLARED COUNT AGAINST THE MAPPED ONE (0513).
          ADVISORY, NEVER A HOLD — the two legitimately disagree while the planner
          is part-way through mapping, and holding the cursor on "not finished
          yet" cages them on a correct intermediate state. It is muted rather than
          warning-coloured for the same reason: this is a reminder, not a refusal.
          `colourCountNote` abstains when nothing was declared. */}
      {colourCountNote(declaredColourCount, dyedColourCount(rows)) && (
        <p className="text-xs text-muted-foreground">
          {colourCountNote(declaredColourCount, dyedColourCount(rows))}
        </p>
      )}
      <ChildGrid<YdRepeatRow>
        columns={columns}
        rows={rows as YdRepeatRow[]}
        seedRow
        /* 46.5rem + 72px of chrome = 816px, under `5xl`'s 1024, so this renders
           as a table and falls back to stacked cards below the breakpoint
           rather than growing a sideways scrollbar.

           THE NUMBER SAID 1152 UNTIL 2026-09-11, which is `6xl` and not what
           this line declares. Harmless while nothing read it, and misleading the
           moment something did: `TAB_WIDTH` sizes the card from this threshold,
           so a card derived against 1152 would have been 128px wider than the
           grid needs for no reason anyone could have checked. */
        tableFrom="5xl"
        centerHeaders
        /* `rowIndex`, NOT the column index `ci` — the Color cell needs the
           ROW's own position (`repeatPositionLabel`) and every other cell
           here has always ignored the second argument, so this was free to
           fix rather than a behaviour change for them. */
        renderMobileRow={(row, rowIndex) => (
          <FieldGrid>
            {columns.map((c, ci) => (
              <Field key={ci} label={c.header} required={c.required} size="sm">
                {c.cell(row, rowIndex)}
              </Field>
            ))}
          </FieldGrid>
        )}
        onAdd={onAdd}
        onRemove={onRemove}
        addLabel="+ Add repeat"
      />
    </div>
  );
}

// ===========================================================================
// 2. MIXING DETAILS — derived, read-only
// ===========================================================================

/**
 * `Yarn | Type | Color | Uom | Value | Calculated % | Mixing %` (`Twisted
 * Yarn` removed alongside the Repeats cell, 2026-09-12 — see that panel).
 *
 * EVERY CELL IS COPIED OR COMPUTED — nothing here is stored, and the reason is
 * in yarn-dyed.ts's header: a figure the system can compute must not sit beside
 * its own inputs free to disagree with them.
 *
 * `hideAdd hideRemove` RATHER THAN `lockExisting`. That prop withholds the ✕
 * only from rows present at MOUNT, and a derived grid re-keys its rows on every
 * render — so every later row arrives "new" and wears a ✕ calling a no-op.
 * `hideRemove` takes Ctrl+Del with it, which `lockExisting` does not.
 */
export function MixingDetailsPanel({
  repeats,
  composition,
  declaredColourCount,
  yarnName,
  fabricTotalGross,
  fabricUomName,
}: {
  repeats: readonly YdRepeatRow[];
  declaredColourCount: number | null;
  composition: FabricComposition | null;
  yarnName: (id: string | null) => string;
  /**
   * THIS FABRIC'S OWN CALCULATED REQUIREMENT — Backend calc spec, Formula 3
   * ("Net Color Yarn Weight_i = Total Fabric Consumption Weight x P_i/100").
   * Summed across whatever colourways (order combos) this cloth serves, off
   * the SAME `FabricGross[]` `./yarn-process.ts`'s `yarnNetByCombo` reads —
   * never a second requirement figure for one fabric. `null` when this
   * fabric has no calculated requirement yet, which `colorNetWeight` reads
   * as "unanswerable", not zero.
   */
  fabricTotalGross: number | null;
  /** The requirement's own unit — printed beside Net Wt so a kg figure is
   *  never read as a metre one. */
  fabricUomName: string;
}) {
  const rows = useMemo(
    () => colorNetWeight(mixingDetailRows(repeats, composition, yarnName), fabricTotalGross),
    [repeats, composition, yarnName, fabricTotalGross],
  );

  const columns: ChildGridColumn<MixingDetailWithNet>[] = [
    { header: "Yarn", width: "13rem", cell: (r) => <Truncated>{r.yarn_name || "—"}</Truncated> },
    {
      header: "Type",
      width: "5rem",
      cell: (r) => <span className="text-sm">{r.dye_type === "grey" ? "Grey" : "Dyed"}</span>,
    },
    { header: "Color", width: "7rem", cell: (r) => <Truncated>{r.color_name || "—"}</Truncated> },
    /* THE "Uom" COLUMN IS REMOVED, same instruction and reason as
       `RepeatsPanel`'s own — see that panel's note. */
    { header: "Value", align: "right", width: "5.5rem", cell: (r) => <NumCell value={r.value} /> },
    {
      header: "Calculated %",
      align: "right",
      width: "6.5rem",
      cell: (r) => <NumCell value={r.calculated_pct} />,
    },
    {
      /* THE ONE CELL THAT CAN REFUSE, and it says so in place rather than
         printing a dash that reads as "nothing to declare". `yarnShareOf`
         abstains where a fabric names several yarns and none carries a blend
         percentage — the ordinary state for exactly the fabrics this panel
         serves — and a Mixing % guessed at 100 would price a dye-house purchase
         off a number nobody stated. */
      header: "Mixing %",
      align: "right",
      width: "6.5rem",
      cell: (r) =>
        r.refusal ? (
          <Truncated className="text-xs text-warning">{r.refusal}</Truncated>
        ) : (
          <NumCell value={r.mixing_pct} />
        ),
    },
    {
      /* Formula 3's own figure — `fabricGross x mixing_pct/100`, computed in
         `colorNetWeight`. Never printed over a refusal: a Mixing % the
         operator cannot see the reason for should not be followed by a
         number that looks trustworthy. */
      header: "Net Wt",
      align: "right",
      width: "6.5rem",
      cell: (r) =>
        r.refusal ? (
          <span className="text-sm text-muted-foreground">—</span>
        ) : (
          <NumCell value={r.net_weight} suffix={r.net_weight != null ? ` ${fabricUomName}` : ""} />
        ),
    },
  ];

  return (
    <div className="space-y-3">
      {colourCountNote(declaredColourCount, dyedColourCount(repeats)) && (
        <p className="text-xs text-muted-foreground">
          {colourCountNote(declaredColourCount, dyedColourCount(repeats))}
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        Worked out from the Repeats tab — Calculated % is each colour&rsquo;s
        share of its own yarn, Mixing % is its share of the whole cloth. Nothing
        here is typed.
      </p>
      <ChildGrid<MixingDetailWithNet>
        columns={columns}
        rows={rows}
        /* TABLE MODE, NOT `inlineCards` — every cell here is plain text, and
           `inlineCards` draws no borders of its own because it leans on each
           cell holding a bordered control. On a read-only panel that comes out
           as floating words; the client reported exactly that on the Color/Print
           tab of this same module ("the table borders is missing"). */
        tableFrom="5xl"
        centerHeaders
        hideAdd
        hideRemove
        renderMobileRow={(row) => (
          <FieldGrid>
            {columns.map((c, ci) => (
              <Field key={ci} label={c.header} size="sm">
                {c.cell(row, ci)}
              </Field>
            ))}
          </FieldGrid>
        )}
        onAdd={() => false}
        onRemove={() => {}}
      />
    </div>
  );
}

// ===========================================================================
// 3. COMBINATIONS — the typed panel
// ===========================================================================

/**
 * One column of the Combinations grid's Color breakdown (0560, redesigned
 * 2026-09-15) — a POSITION, derived from a dyed Mixing Details row, never a
 * free "+ Add color" list. `YarnDyedSheet` computes one of these per dyed
 * row `mixingDetailRows` returns for the open fabric group, in that same
 * order, and hands the array to `CombinationsPanel` — so the number of
 * colour cells a combo can fill in always matches the number of stripes the
 * Repeats tab actually declares. See that component's own note for why: the
 * client's own mockup showed "Position 1 (66.7%) / Position 2 (33.3%)" as
 * columns, not an operator-sized list, because a combo cannot have more
 * dyed colours than the fabric has stripes.
 */
export type CombinationPosition = {
  /** The source Mixing Details row's own `key` — stable for one render of
   *  one fabric group, used only as a React key here (never persisted; see
   *  `sno`-by-array-index in the save payload for the persisted address). */
  key: string;
  label: string;
};

/**
 * `Combo | YD Combo Name | Position 1 (%) | Position 2 (%) …` — legacy's two
 * columns plus one column per dyed Repeats stripe, confirmed with the client
 * (2026-09-15) as a fixed breakdown rather than an open list: "Position N"
 * IS the Nth dyed row of Mixing Details for this fabric group, so a combo
 * cannot declare a colour for a stripe the fabric does not have, and never
 * needs an Add/Remove of its own — the column count already is the count.
 *
 * `Combo` PICKS FROM THE ORDER'S COLOURWAYS and never accepts free text: the
 * order declares them, and a second spelling here would name a combination
 * nothing else on the document can match. Blank is a real answer.
 *
 * `YD Combo Name` IS FREE TEXT, deliberately — it is what the yarn-dyed
 * combination is called on the knitting floor, which is not always the assort
 * colour's name and is not declared anywhere else to pick from.
 *
 * PLAIN `ChildGrid` TABLE MODE AGAIN, not `forceCards`/`listRows` — those
 * existed only for the first cut's nested per-row panel (client-reported "no
 * option for asking combo colors", 2026-09-15), which this redesign removes
 * outright: a position is a COLUMN now, so there is no panel to carry and no
 * reason to give up the table `ChildGrid`'s default mode already draws.
 *
 * A COMBO'S `colors` ARRAY IS READ BY INDEX, AND MAY BE SHORTER THAN
 * `positions`. `colorAt` below is what makes that safe: an untouched
 * position reads as `""` rather than `undefined`, and typing into it grows
 * the array lazily (`onPatchColorAt`, fabric-bom-screen.tsx) rather than
 * needing every combo pre-padded to the current position count the moment
 * a stripe is added on the Repeats tab.
 */
function colorAt(row: YdCombinationRow, index: number): string {
  return row.colors[index]?.yarn_color ?? "";
}

export function CombinationsPanel({
  rows,
  comboOptions,
  positions,
  yarnColourOptions,
  onPatch,
  onAdd,
  onRemove,
  onPatchColorAt,
}: {
  rows: readonly YdCombinationRow[];
  comboOptions: readonly string[];
  /** One per dyed Mixing Details row of the open fabric group, in that
   *  order — see `CombinationPosition`'s own note. */
  positions: readonly CombinationPosition[];
  /** The order's declared Yarn Colour names — see `colourOptionsFor`. */
  yarnColourOptions: readonly string[];
  onPatch: (key: string, patch: Partial<YdCombinationRow>) => void;
  onAdd: () => void;
  onRemove: (row: YdCombinationRow) => void;
  onPatchColorAt: (comboKey: string, index: number, yarn_color: string) => void;
}) {
  const columns: ChildGridColumn<YdCombinationRow>[] = [
    {
      header: "Combo",
      width: "10rem",
      cell: (r) => (
        <Select
          compact
          className="h-8"
          value={r.combo}
          onChange={(e) => onPatch(r.key, { combo: e.target.value })}
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
      header: "YD Combo Name",
      width: "14rem",
      cell: (r) => (
        <Input
          className="h-8"
          value={r.yd_combo_name}
          onChange={(e) => onPatch(r.key, { yd_combo_name: e.target.value })}
        />
      ),
    },
    ...positions.map(
      (p, i): ChildGridColumn<YdCombinationRow> => ({
        header: p.label,
        width: "9rem",
        /* A SELECT, NEVER A TEXTBOX — same reversal as `RepeatsPanel`'s Color
           column; see `colourOptionsFor` and 0560's own updated comment. */
        cell: (r) => (
          <Select
            compact
            className="h-8"
            value={colorAt(r, i)}
            onChange={(e) => onPatchColorAt(r.key, i, e.target.value)}
          >
            <option value="" />
            {colourOptionsFor(colorAt(r, i), yarnColourOptions).map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        ),
      }),
    ),
  ];

  return (
    <ChildGrid<YdCombinationRow>
      columns={columns}
      rows={rows as YdCombinationRow[]}
      seedRow
      centerHeaders
      renderMobileRow={(row) => (
        <FieldGrid>
          {columns.map((c, ci) => (
            <Field key={ci} label={c.header} size="sm">
              {c.cell(row, ci)}
            </Field>
          ))}
        </FieldGrid>
      )}
      onAdd={onAdd}
      onRemove={onRemove}
      addLabel="+ Add combination"
    />
  );
}


// ===========================================================================
// THE POPUP — legacy's [Detail], which is "Yarn Dyed Details" and nothing else
// ===========================================================================

/**
 * The overlay a Fabric Lines row's [Detail] button opens (0512).
 *
 * ## ONE SCREEN, THREE SECTIONS (reverted from tabs, 2026-09-15) — AND
 *    COMPONENTS IS STILL NOT ONE OF THEM
 *
 * Client 2026-09-02, screenshot 2623: "I said this components tab from fab lines
 * details — how still its appearing?" The instruction before it ("from fabric
 * line details tab only, hold remaining three tab") means THIS popup holds only
 * the remaining three; it was first read as "the three are held from the popup",
 * which removed them from the Components rail section instead and left the
 * Components tab here. Right half, wrong surface. That correction is unaffected
 * by tabs becoming sections — Components still lives in the rail, not here.
 *
 * ## THE STACKED SHAPE IS ALSO WHAT LEGACY DOES
 *
 * Legacy's [Detail] on a FabricAllocation row opens a window titled **"Yarn Dyed
 * Details"** (screenshot 2615) carrying Repeats, Mixing Details and Combinations,
 * stacked one under another on one screen — this app's OWN 2026-09-02 tab strip
 * was the addition, since reverted (see `YarnDyedSheet`'s own note). Components
 * is not in legacy's version either — it is a separate entry in legacy's own tab
 * strip (`Color/Print Details · FabricAllocation · Components · Manual ·
 * YarnProcess · FabricProcess`), which in this app is the Components rail
 * section. So the two surfaces are legacy's two, and the Components tab that
 * was here once was a third copy of something that already had a home.
 *
 * ## THE TITLE NAMES THE CLOTH
 *
 * Not the style. This popup's whole subject is how ONE fabric's yarn is dyed —
 * `mixingDetailRows` reads that fabric's composition, and the Repeats are scoped
 * to it — so naming the style would name the wrong thing on an order whose style
 * uses several cloths. The style is the Components tree's subject, not this one's.
 */

export function YarnDyedSheet({
  open,
  onClose,
  title,
  ydRepeats,
  ydCombinations,
  yarnOptions,
  comboOptions,
  yarnColourOptions,
  composition,
  declaredColourCount,
  yarnName,
  fabricTotalGross,
  fabricUomName,
  onPatchYdRepeat,
  onAddYdRepeat,
  onRemoveYdRepeat,
  onPatchYdCombination,
  onAddYdCombination,
  onRemoveYdCombination,
  onPatchYdCombinationColorAt,
  origin,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  /** The [Detail] button's own rect, so the sheet grows out of it — see
   *  AGENTS.md's "A sub-detail Sheet's size". */
  origin?: SheetOrigin | null;
  ydRepeats: readonly YdRepeatRow[];
  ydCombinations: readonly YdCombinationRow[];
  /** Every yarn the BOM's fabrics name. `RepeatsPanel` narrows it to this
   *  cloth's own composition; the wider list is passed so a HELD yarn that has
   *  since left that composition can still be named and tagged. */
  yarnOptions: readonly PickerRow[];
  /** The order's assort colourways, for Combinations. */
  comboOptions: readonly string[];
  /** The order's declared Yarn Colour names (Color/Print Details), for
   *  Combinations' position cells — see `colourOptionsFor`. */
  yarnColourOptions: readonly string[];
  /** This fabric's mixing rows, or null when the master states none. */
  composition: FabricComposition | null;
  /** `No Of Colors` as declared on the fabric line (0513). */
  declaredColourCount: number | null;
  yarnName: (id: string | null) => string;
  /** See `MixingDetailsPanel`'s own note — Formula 3's net-weight column. */
  fabricTotalGross: number | null;
  fabricUomName: string;
  onPatchYdRepeat: (key: string, patch: Partial<YdRepeatRow>) => void;
  onAddYdRepeat: () => void;
  onRemoveYdRepeat: (row: YdRepeatRow) => void;
  onPatchYdCombination: (key: string, patch: Partial<YdCombinationRow>) => void;
  onAddYdCombination: () => void;
  onRemoveYdCombination: (row: YdCombinationRow) => void;
  /** The Color breakdown (0560) — writes one position's colour, growing the
   *  combo's `colors` array lazily if it is shorter than `index`. See
   *  `CombinationsPanel`'s own note on why a position is a column, not a
   *  free list. */
  onPatchYdCombinationColorAt: (comboKey: string, index: number, yarn_color: string) => void;
}) {
  /**
   * ONE SCREEN, NOT THREE TABS (reverted 2026-09-15, operator instruction).
   * The 2026-09-02 client quote that put these on a tab strip is kept below
   * for history, but the later, more specific instruction wins — the same
   * rule AGENTS.md states for a renamed menu label: "the later instruction
   * wins, so a reader who finds the old rule quoted elsewhere is holding
   * something this supersedes". Legacy's OWN shape was always one popup with
   * all three panels stacked; the tabs were this app's addition, and this
   * undoes exactly that addition, nothing upstream of it (the panels, their
   * data and their order are unchanged).
   *
   * ORIGINAL CLIENT QUOTE, 2026-09-02, screenshot 114300 — "repeats, mixing
   * details, combinations — this three section add it like same field order
   * structure with better UI; screen can use top bar … if we click the tab
   * the actual screen of that field will display in that single screen."
   *
   * REPEATS BEFORE MIXING DETAILS BEFORE COMBINATIONS is kept — it is the
   * dependency order (Mixing Details reads Repeats; Combinations' own
   * `positions` below are derived from Mixing Details) as much as it is
   * legacy's, so the stacked order says which is upstream of which.
   */
  const dyedMixingRows = useMemo(
    () => mixingDetailRows(ydRepeats, composition, yarnName),
    [ydRepeats, composition, yarnName],
  );

  /**
   * ONE COLUMN PER DYED MIXING DETAILS ROW (0560, redesigned 2026-09-15) —
   * see `CombinationPosition`'s own note in `CombinationsPanel`. The label
   * prefers `Mixing %` (the cloth-wide share `yarnPurchase` actually buys
   * against) and falls back to `Calculated %` where the blend share is
   * unanswerable, same fallback order the Mixing Details panel itself
   * renders; a row whose own colour name is blank falls back to a bare
   * ordinal so the column always has SOME header.
   *
   * THE YARN NAME IS PREFIXED ONLY WHEN MORE THAN ONE YARN IS DYED. A
   * single-yarn fabric's positions are unambiguous by colour alone — legacy's
   * own "Color 01 / Color 02" — and prefixing every label with a yarn name
   * nobody needs to disambiguate is noise. Two yarns each dyed in NAVY would
   * otherwise print two identical "NAVY (…)" headers with nothing to tell a
   * combo's operator which cell is which.
   */
  const positions = useMemo(() => {
    const multiYarn = new Set(dyedMixingRows.map((r) => r.yarn_item_id ?? "")).size > 1;
    return dyedMixingRows.map((r, i) => {
      const pct = r.mixing_pct ?? r.calculated_pct;
      const name = r.color_name.trim() || `Position ${i + 1}`;
      const labelled = multiYarn ? `${r.yarn_name} — ${name}` : name;
      return { key: r.key, label: pct == null ? labelled : `${labelled} (${fmtNumber(pct)}%)` };
    });
  }, [dyedMixingRows]);

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={title}
      /* CLEARS THE FULL-SCREEN EDITOR BENEATH IT, the same base the Structure
         Details overlay uses one module along. */
      zIndexBase={120}
      /* `md`, NOT `lg` (2026-09-04, AGENTS.md "A sub-detail Sheet's size").
         ONE FIXED WIDTH NOW, not per-tab (`TAB_WIDTH` is gone with the tabs) —
         the operator is looking at all three grids on one scroll, so the
         card has to clear the widest of them regardless of scroll position.
         Mixing Details was already the widest at 1028px; Combinations can
         now grow past it with enough dyed stripes, but a fixed width this
         sheet holds to is still the right call — `ChildGrid`'s table drops to
         stacked cards below its own threshold rather than forcing the sheet
         wider still, which is the built-in "wrap, never scroll sideways"
         answer (AGENTS.md rule 4) for however many positions a fabric has. */
      size="md"
      maxWidthClass="max-w-[1120px]"
      alignToPane
      origin={origin}
      footer={<SubSheetFooter onDone={onClose} parent="fabric BOM" />}
    >
      <div className="space-y-6">
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-foreground">
            Stripe Pattern &amp; Mixing Ratios
          </h3>
          <RepeatsPanel
            rows={ydRepeats}
            yarns={yarnOptions}
            composition={composition}
            declaredColourCount={declaredColourCount}
            onPatch={onPatchYdRepeat}
            onAdd={onAddYdRepeat}
            onRemove={onRemoveYdRepeat}
          />
          <MixingDetailsPanel
            repeats={ydRepeats}
            composition={composition}
            declaredColourCount={declaredColourCount}
            yarnName={yarnName}
            fabricTotalGross={fabricTotalGross}
            fabricUomName={fabricUomName}
          />
        </div>
        <div className="space-y-3 border-t border-border pt-4">
          <h3 className="text-sm font-semibold text-foreground">
            Combinations &amp; Yarn Color Mapping
          </h3>
          <CombinationsPanel
            rows={ydCombinations}
            comboOptions={comboOptions}
            positions={positions}
            yarnColourOptions={yarnColourOptions}
            onPatch={onPatchYdCombination}
            onAdd={onAddYdCombination}
            onRemove={onRemoveYdCombination}
            onPatchColorAt={onPatchYdCombinationColorAt}
          />
        </div>
      </div>
    </Sheet>
  );
}
