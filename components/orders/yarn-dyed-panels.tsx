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
import { Sheet } from "@/components/ui/sheet";
import { Tabs } from "@/components/ui/tabs";
import { fmtNumber } from "@/lib/format";
import { colourCountNote } from "@/lib/orders/fabric-bom/fabric-line-rules";
import {
  mixingDetailRows,
  type MixingDetailRow,
  type YdRepeatRow,
} from "@/lib/orders/fabric-bom/yarn-dyed";
import type { FabricComposition } from "@/lib/orders/fabric-bom/yarn-process";

/** The shape every picker in this module takes. `code` is `string | null` and
 *  NOT optional, because that is `PickerItem`'s own contract — `RecordPicker`
 *  reads all three deactivation spellings straight off the row, so a looser
 *  local alias only moves the mismatch to the call site. */
type PickerRow = { id: string; code: string | null; name: string; inactive?: boolean };

/** One typed row of the Combinations panel. */
export type YdCombinationRow = {
  key: string;
  combo: string;
  yd_combo_name: string;
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
 * DISTINCT DYED COLOURS ACTUALLY MAPPED — what the declared `No Of Colors` is
 * compared against.
 *
 * `grey` IS EXCLUDED, like everywhere else in this feature: it is the undyed
 * remainder, not a colour. Counted by NAME rather than by row, because two
 * repeats of the same colour on two yarns are one colour in the pattern — which
 * is what the planner counted when they typed the number.
 */
function dyedColourCount(rows: readonly YdRepeatRow[]): number {
  return new Set(
    rows
      .filter((r) => r.dye_type === "dyed")
      .map((r) => r.color_name.trim().toUpperCase())
      .filter(Boolean),
  ).size;
}

// ===========================================================================
// 1. REPEATS — the typed panel
// ===========================================================================

/**
 * `S No | Yarn | Type | Color | Uom | Value | Twisted Yarn` — legacy's order,
 * unchanged.
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
  uoms,
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
  uoms: readonly PickerRow[];
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
      header: "Color",
      width: "8rem",
      cell: (r) => (
        <Input
          className="h-8"
          value={r.color_name}
          onChange={(e) => onPatch(r.key, { color_name: e.target.value })}
        />
      ),
    },
    {
      header: "Uom",
      width: "5.5rem",
      cell: (r) => (
        <RecordPicker
          label="Uom"
          compact
          items={[...uoms]}
          value={r.uom_id}
          onChange={(id) => onPatch(r.key, { uom_id: id })}
        />
      ),
    },
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
    {
      header: "Twisted Yarn",
      width: "8rem",
      cell: (r) => (
        <Input
          className="h-8"
          value={r.twisted_yarn}
          onChange={(e) => onPatch(r.key, { twisted_yarn: e.target.value })}
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
        /* 46.5rem + 72px of chrome = 816px, under `tableFrom`'s 1152, so this
           renders as a table and falls back to stacked cards below the
           breakpoint rather than growing a sideways scrollbar. */
        tableFrom="5xl"
        centerHeaders
        renderMobileRow={(row) => (
          <FieldGrid>
            {columns.map((c, ci) => (
              <Field key={ci} label={c.header} required={c.required} size="sm">
                {c.cell(row, ci)}
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
 * `Yarn | Type | Color | Uom | Value | Calculated % | Mixing % | Twisted Yarn`.
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
  uomName,
}: {
  repeats: readonly YdRepeatRow[];
  declaredColourCount: number | null;
  composition: FabricComposition | null;
  yarnName: (id: string | null) => string;
  uomName: (id: string | null) => string;
}) {
  const rows = useMemo(
    () => mixingDetailRows(repeats, composition, yarnName),
    [repeats, composition, yarnName],
  );

  const columns: ChildGridColumn<MixingDetailRow>[] = [
    { header: "Yarn", width: "13rem", cell: (r) => <Truncated>{r.yarn_name || "—"}</Truncated> },
    {
      header: "Type",
      width: "5rem",
      cell: (r) => <span className="text-sm">{r.dye_type === "grey" ? "Grey" : "Dyed"}</span>,
    },
    { header: "Color", width: "7rem", cell: (r) => <Truncated>{r.color_name || "—"}</Truncated> },
    { header: "Uom", width: "5rem", cell: (r) => <Truncated>{uomName(r.uom_id) || "—"}</Truncated> },
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
      header: "Twisted Yarn",
      width: "7rem",
      cell: (r) => <Truncated>{r.twisted_yarn || "—"}</Truncated>,
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
      <ChildGrid<MixingDetailRow>
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
 * `Combo | YD Combo Name` — legacy's two columns.
 *
 * `Combo` PICKS FROM THE ORDER'S COLOURWAYS and never accepts free text: the
 * order declares them, and a second spelling here would name a combination
 * nothing else on the document can match. Blank is a real answer.
 *
 * `YD Combo Name` IS FREE TEXT, deliberately — it is what the yarn-dyed
 * combination is called on the knitting floor, which is not always the assort
 * colour's name and is not declared anywhere else to pick from.
 */
export function CombinationsPanel({
  rows,
  comboOptions,
  onPatch,
  onAdd,
  onRemove,
}: {
  rows: readonly YdCombinationRow[];
  comboOptions: readonly string[];
  onPatch: (key: string, patch: Partial<YdCombinationRow>) => void;
  onAdd: () => void;
  onRemove: (row: YdCombinationRow) => void;
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
  ];

  return (
    <ChildGrid<YdCombinationRow>
      columns={columns}
      rows={rows as YdCombinationRow[]}
      seedRow
      tableFrom="5xl"
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
 * ## IT HOLDS THREE TABS, NOT FOUR, AND THAT TOOK TWO CORRECTIONS
 *
 * Client 2026-09-02, screenshot 2623: "I said this components tab from fab lines
 * details — how still its appearing?" The instruction before it ("from fabric
 * line details tab only, hold remaining three tab") means THIS popup holds only
 * the remaining three; it was first read as "the three are held from the popup",
 * which removed them from the Components rail section instead and left the
 * Components tab here. Right half, wrong surface.
 *
 * ## THE CORRECTION IS ALSO WHAT LEGACY DOES
 *
 * Legacy's [Detail] on a FabricAllocation row opens a window titled **"Yarn Dyed
 * Details"** (screenshot 2615) carrying Repeats, Mixing Details and Combinations.
 * Components is not in it — it is a separate entry in legacy's own tab strip
 * (`Color/Print Details · FabricAllocation · Components · Manual · YarnProcess ·
 * FabricProcess`), which in this app is the Components rail section. So the two
 * surfaces are legacy's two, and the Components tab that was here was a third
 * copy of something that already had a home.
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
  uomOptions,
  comboOptions,
  composition,
  declaredColourCount,
  yarnName,
  uomName,
  onPatchYdRepeat,
  onAddYdRepeat,
  onRemoveYdRepeat,
  onPatchYdCombination,
  onAddYdCombination,
  onRemoveYdCombination,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  ydRepeats: readonly YdRepeatRow[];
  ydCombinations: readonly YdCombinationRow[];
  /** Every yarn the BOM's fabrics name. `RepeatsPanel` narrows it to this
   *  cloth's own composition; the wider list is passed so a HELD yarn that has
   *  since left that composition can still be named and tagged. */
  yarnOptions: readonly PickerRow[];
  uomOptions: readonly PickerRow[];
  /** The order's assort colourways, for Combinations. */
  comboOptions: readonly string[];
  /** This fabric's mixing rows, or null when the master states none. */
  composition: FabricComposition | null;
  /** `No Of Colors` as declared on the fabric line (0513). */
  declaredColourCount: number | null;
  yarnName: (id: string | null) => string;
  uomName: (id: string | null) => string;
  onPatchYdRepeat: (key: string, patch: Partial<YdRepeatRow>) => void;
  onAddYdRepeat: () => void;
  onRemoveYdRepeat: (row: YdRepeatRow) => void;
  onPatchYdCombination: (key: string, patch: Partial<YdCombinationRow>) => void;
  onAddYdCombination: () => void;
  onRemoveYdCombination: (row: YdCombinationRow) => void;
}) {
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={title}
      /* CLEARS THE FULL-SCREEN EDITOR BENEATH IT, the same base the Structure
         Details overlay uses one module along. */
      zIndexBase={120}
    >
      <Tabs
        /* THE CLIENT'S "TOP BAR" (2026-09-02, screenshot 114300 —
           `Manage Attributes | Display Attributes | Sorting`): "if we click the
           tab, the actual screen of that field will display in that single
           screen". Legacy stacks all three grids down one popup; this shows one
           at a time.

           `components/ui/tabs.tsx` IS THE STRIP, not a local one. Its own doc
           states the division this obeys — a MASTER's sections go on a left rail,
           a DOCUMENT's tabs on a top strip "which is also the legacy RP-Software
           shape the operators already know" — so the popup inherits the arrow
           keys, the roving tab stop and the per-tab problem count with it.

           REPEATS IS FIRST AND IS THE DEFAULT, which is legacy's own top-to-
           bottom order and also the dependency order: Mixing Details READS
           Repeats, so the tab that is typed comes before the tab that is
           derived. */
        items={[
          {
            key: "repeats",
            label: "Repeats",
            content: (
              <RepeatsPanel
                rows={ydRepeats}
                yarns={yarnOptions}
                uoms={uomOptions}
                composition={composition}
                declaredColourCount={declaredColourCount}
                onPatch={onPatchYdRepeat}
                onAdd={onAddYdRepeat}
                onRemove={onRemoveYdRepeat}
              />
            ),
          },
          {
            key: "mixing",
            label: "Mixing Details",
            content: (
              <MixingDetailsPanel
                repeats={ydRepeats}
                composition={composition}
                declaredColourCount={declaredColourCount}
                yarnName={yarnName}
                uomName={uomName}
              />
            ),
          },
          {
            key: "combinations",
            label: "Combinations",
            content: (
              <CombinationsPanel
                rows={ydCombinations}
                comboOptions={comboOptions}
                onPatch={onPatchYdCombination}
                onAdd={onAddYdCombination}
                onRemove={onRemoveYdCombination}
              />
            ),
          },
        ]}
      />
    </Sheet>
  );
}
