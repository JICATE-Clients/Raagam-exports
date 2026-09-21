"use client";

/**
 * IWO Fabric BOM ▸ Fabric Consumption ▸ [Breakup] — ONE fabric's rows by
 * colour and/or finish dia (client 2026-09-21, screenshots 2990 · 2992: "plan
 * the dia, weight, colour … like the Material BOM attribute listing").
 *
 * THE MATERIAL BOM'S BREAKUP SHEET (0614) WITH A FABRIC'S AXES. There the
 * attribute is Item · Colour · Size · Colour + Size and the rows carry Colour
 * / Size / Planned Qty; here it is Fabric · Colour · Dia · Colour + Dia and
 * the rows carry Colour / Print (on a Print stage, where Colour is split) /
 * Finish Dia / Req Wt. Only the columns the attribute has are drawn. The
 * fabric row's Req Wt is Σ these rows (`reqKgsOf`, `plan.ts`) — read-only on
 * the row, a button that opens this.
 *
 * WHAT THE LEGACY SCREEN CONTRIBUTED (recording 2026-09-21): that a colour has
 * dias with a weight each, and that Print belongs to the colour. NOT its
 * three nested grids — one idiom per work order, and this application's is
 * the flat `ChildGrid` breakup.
 *
 * NO SAVE OF ITS OWN. The rows live on the fabric row in the screen's state
 * and are written by the BOM's own Save, so the footer is `SubSheetFooter`
 * (Done). "md", not "sm": a `ChildGrid`'s table only switches in from a
 * ~512px container (AGENTS.md, "A sub-detail Sheet's size").
 *
 * A colour is PICKED from the BOM's Fabric Colour panel, a print from its
 * Prints panel, a dia from the Dia panel scoped to the fabric's knit family —
 * the same lists and the same rule (`dia-knit.ts`) the fabric row's own cells
 * read, handed in as functions so the two surfaces cannot disagree.
 *
 * WIDTHS (check:grid-budget): code 144 (Colour) + hug 88 (Print) + hug 88
 * (Finish Dia) + range 112 (Req Wt) + range 112 (Gross Yarn) = 544, and 616
 * with the grid's chrome <= 1155. A colour-only or dia-only attribute draws
 * fewer.
 */

import { Sheet, type SheetOrigin } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Combobox } from "@/components/ui/combobox";
import { FIELD_WIDTH_CSS } from "@/components/ui/field";
import { ChildGrid, type ChildGridColumn } from "@/components/masters/child-grid";
import { SubSheetFooter } from "@/components/orders/sub-sheet-footer";
import {
  blankPlanRow,
  PLAN_BY_LABELS,
  planHasColour,
  planHasDia,
  type PlanBy,
  type PlanRow,
} from "@/lib/orders/iwo-fabric-bom/plan";

export function FabricBreakupSheet({
  open,
  onClose,
  origin,
  fabricName,
  planBy,
  printStage,
  rows,
  onChange,
  colours,
  prints,
  diaOptionsFor,
  grossOf,
  newKey,
  readOnly = false,
}: {
  open: boolean;
  onClose: () => void;
  /** The Req Wt button's rect, so the box grows out of it. */
  origin?: SheetOrigin | null;
  fabricName: string;
  planBy: PlanBy;
  /** Is the fabric's Stage a Print stage? Then a colour row carries its Print. */
  printStage: boolean;
  rows: PlanRow[];
  onChange: (next: PlanRow[]) => void;
  /** The Fabric Colour panel's names. */
  colours: readonly string[];
  /** The Roll-form Prints panel's names. */
  prints: readonly string[];
  /** The fabric row's own `diaOptionsFor`, already bound to this fabric's
   *  knit family — one list behind the row's cell and this sheet. */
  diaOptionsFor: (held: string) => { value: string; label: string; sublabel?: string }[];
  /** One row's Gross Yarn (its kgs through the fabric's route, at ITS colour's
   *  loss — 0613), or null while it cannot be stated. */
  grossOf: (row: PlanRow) => number | null;
  newKey: () => string;
  readOnly?: boolean;
}) {
  const patch = (key: string, p: Partial<PlanRow>) => onChange(rows.map((r) => (r.key === key ? { ...r, ...p } : r)));
  const kg = (n: number) => n.toLocaleString("en-IN", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
  const num = (v: string) => {
    const t = v.trim().replace(/,/g, "");
    return t === "" ? null : Number(t);
  };
  const withColour = planHasColour(planBy);
  const withDia = planHasDia(planBy);

  const breakupColumns: ChildGridColumn<PlanRow>[] = [
    ...(withColour
      ? [
          {
            header: "Colour",
            required: true,
            width: FIELD_WIDTH_CSS.code,
            cell: (r: PlanRow) => {
              // A name the row already holds survives a panel edit that removed
              // it — the "Disabled rows" rule; `lines.ts` then says it is off
              // the panel.
              const held = r.color_name && !colours.includes(r.color_name) ? [r.color_name] : [];
              return (
                <Select
                  compact
                  required
                  className="h-8"
                  aria-label="Colour"
                  disabled={readOnly}
                  value={r.color_name}
                  onChange={(e) => patch(r.key, { color_name: e.target.value })}
                >
                  <option value="" />
                  {[...colours, ...held].map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </Select>
              );
            },
          } satisfies ChildGridColumn<PlanRow>,
        ]
      : []),
    ...(withColour && printStage
      ? [
          {
            /* PRINT RIDES WITH THE COLOUR (the legacy puts it on the colour row;
               the 09-20 ticket's "planned per print, colour and dia"). Drawn
               only where the colour axis is split — otherwise the fabric row's
               one Print applies to every line. */
            header: "Print",
            required: true,
            width: FIELD_WIDTH_CSS.hug,
            cell: (r: PlanRow) => {
              const held = r.print_name && !prints.includes(r.print_name) ? [r.print_name] : [];
              return (
                <Select
                  compact
                  required
                  className="h-8"
                  aria-label="Print"
                  disabled={readOnly}
                  value={r.print_name}
                  onChange={(e) => patch(r.key, { print_name: e.target.value })}
                >
                  <option value="" />
                  {[...prints, ...held].map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </Select>
              );
            },
          } satisfies ChildGridColumn<PlanRow>,
        ]
      : []),
    ...(withDia
      ? [
          {
            header: "Finish Dia",
            required: true,
            width: FIELD_WIDTH_CSS.hug,
            cell: (r: PlanRow) => (
              <Combobox
                compact
                inputClassName="h-8"
                required
                disabled={readOnly}
                options={diaOptionsFor(r.dia)}
                value={r.dia}
                onChange={(v) => patch(r.key, { dia: v })}
                clearable
              />
            ),
          } satisfies ChildGridColumn<PlanRow>,
        ]
      : []),
    {
      header: "Req Wt (KGS)",
      required: true,
      align: "right",
      width: FIELD_WIDTH_CSS.range,
      total: { kind: "sum", of: (r) => num(r.req_kgs) || 0, format: kg },
      cell: (r) => (
        <Input
          className="h-8 text-right"
          inputMode="decimal"
          required
          readOnly={readOnly}
          aria-label="Req Wt (KGS)"
          value={r.req_kgs}
          onChange={(e) => patch(r.key, { req_kgs: e.target.value })}
        />
      ),
    },
    {
      // Derived, never typed — `readOnly` also takes it off the Tab path. Per
      // row, so a colour-wise loss (0613) is seen where it acts.
      header: "Gross Yarn",
      align: "right",
      width: FIELD_WIDTH_CSS.range,
      total: { kind: "sum", of: (r) => grossOf(r) ?? 0, format: kg },
      cell: (r) => {
        const g = grossOf(r);
        return <Input className="h-8 text-right" readOnly aria-label="Gross Yarn (KGS)" value={g == null ? "" : kg(g)} />;
      },
    },
  ];

  const axes = withColour && withDia ? "colour and dia" : withColour ? "colour" : "dia";

  return (
    <Sheet
      open={open}
      onClose={onClose}
      size="md"
      alignToPane
      origin={origin}
      zIndexBase={120}
      title={`Breakup — ${fabricName || "fabric"}`}
      footer={<SubSheetFooter onDone={onClose} parent="Fabric BOM" />}
    >
      <p className="mb-2 text-sm text-muted-foreground">
        {PLAN_BY_LABELS[planBy]} wise: one row per {axes}, and the fabric&apos;s Req Wt is their total.
      </p>
      {withColour && colours.length === 0 && (
        <p className="mb-2 text-sm text-warning">The Fabric Colour panel (Fabric BOM section) is empty — add the colours there first.</p>
      )}
      {withDia && diaOptionsFor("").length === 0 && (
        <p className="mb-2 text-sm text-warning">The Dia panel (Fabric BOM section) has no dia of this fabric&apos;s family — declare them there first.</p>
      )}
      <ChildGrid<PlanRow>
        columns={breakupColumns}
        rows={rows}
        tableFrom="5xl"
        onAdd={() => onChange([...rows, blankPlanRow(newKey())])}
        onRemove={(r) => {
          const left = rows.filter((x) => x.key !== r.key);
          onChange(left.length ? left : [blankPlanRow(newKey())]);
        }}
        addLabel="+ Add row"
        hideAdd={readOnly}
        hideRemove={readOnly}
      />
    </Sheet>
  );
}
