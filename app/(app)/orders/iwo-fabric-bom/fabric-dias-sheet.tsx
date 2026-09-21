"use client";

/**
 * IWO Fabric BOM ▸ Fabric Consumption ▸ [Dias] — the finish dias of ONE
 * fabric line, each with its own Req Wt (client 2026-09-21: "if multiple is
 * applicable can plan like color button — now it's creating another fabric,
 * it's a bug").
 *
 * THE SHAPE IT REPLACES. Several dias of one fabric have always been several
 * STORED lines (0592's unique (fabric, colour, dia), one Req Wt each), and
 * until today the only way to enter them was `+ Dia`, which inserted a second
 * LINE of the same fabric — so the fabric appeared twice on Fabric Allocation
 * and Fabric Consumption, and read as a duplicate rather than as a split. The
 * screen now holds ONE row per fabric with its dias in a list, and expands
 * back to one stored line per dia at every boundary (save, rules, engine) —
 * so storage, the rules and the yarn engine are untouched; only the screen's
 * state changed shape. `[Shades]` on Yarn Lines is the same idea for a DYED
 * yarn's colours, and this file is copied from it.
 *
 * NO SAVE OF ITS OWN. The rows live on the line in the screen's state and are
 * written by the BOM's own Save, so the footer is `SubSheetFooter` (Done).
 *
 * "md", NOT "sm": this is a `ChildGrid`, and its table only switches in from a
 * ~512px container — `sm`'s ~408px of content drops it to header-less cards
 * (AGENTS.md, "A sub-detail Sheet's size"; the Shades sheet's own note).
 *
 * A dia is PICKED from the BOM's Dia panel, scoped to the fabric's own knit
 * family (`dia-knit.ts`) — the same list and rule the grid's Finish Dia cell
 * reads, handed in as `optionsFor` so the two cannot disagree.
 */

import { Sheet, type SheetOrigin } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Combobox } from "@/components/ui/combobox";
import { FIELD_WIDTH_CSS } from "@/components/ui/field";
import { ChildGrid, type ChildGridColumn } from "@/components/masters/child-grid";
import { SubSheetFooter } from "@/components/orders/sub-sheet-footer";

/** One dia of a line as the grid edits it — Req Wt held as the TEXT typed. */
export type DiaQtyRow = { key: string; dia: string; req_kgs: string };

export const blankDiaQty = (key: string): DiaQtyRow => ({ key, dia: "", req_kgs: "" });

/** Is this dia row worth storing? Same test as `isBlankIwoFabricLine`'s two
 *  dia fields — the sheet seeds a blank row and an untouched seed is dropped
 *  when the line has other dias to stand on. */
export const isBlankDiaQty = (d: DiaQtyRow): boolean => !d.dia.trim() && !d.req_kgs.trim();

export function FabricDiasSheet({
  open,
  onClose,
  origin,
  fabricName,
  rows,
  onChange,
  optionsFor,
  required,
  newKey,
  readOnly = false,
}: {
  open: boolean;
  onClose: () => void;
  /** The [Dias] button's rect, so the box grows out of it. */
  origin?: SheetOrigin | null;
  fabricName: string;
  rows: DiaQtyRow[];
  onChange: (next: DiaQtyRow[]) => void;
  /** The grid's own `diaOptionsFor(held, knit)`, already bound to this
   *  line's family — one list behind the cell and the sheet. */
  optionsFor: (held: string) => { value: string; label: string; sublabel?: string }[];
  /** Does this line owe a dia (dyed / washed / printed)? The hold the grid's
   *  cell carries, carried here too. */
  required: boolean;
  newKey: () => string;
  readOnly?: boolean;
}) {
  const patch = (key: string, p: Partial<DiaQtyRow>) => onChange(rows.map((r) => (r.key === key ? { ...r, ...p } : r)));
  const kg = (n: number) => n.toLocaleString("en-IN", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
  const num = (v: string) => {
    const t = v.trim().replace(/,/g, "");
    return t === "" ? null : Number(t);
  };

  /**
   * WIDTHS (check:grid-budget): hug (Finish Dia, ~144) + range 112 = 256, and
   * 296 with the grid's chrome <= 1155.
   */
  const diaColumns: ChildGridColumn<DiaQtyRow>[] = [
    {
      header: "Finish Dia",
      required,
      width: FIELD_WIDTH_CSS.hug,
      cell: (r) => (
        <Combobox
          compact
          inputClassName="h-8"
          required={required}
          disabled={readOnly}
          options={optionsFor(r.dia)}
          value={r.dia}
          onChange={(v) => patch(r.key, { dia: v })}
          clearable
        />
      ),
    },
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
  ];

  return (
    <Sheet
      open={open}
      onClose={onClose}
      size="md"
      alignToPane
      origin={origin}
      zIndexBase={120}
      title={`Dias — ${fabricName || "fabric"}`}
      footer={<SubSheetFooter onDone={onClose} parent="Fabric BOM" />}
    >
      <ChildGrid<DiaQtyRow>
        columns={diaColumns}
        rows={rows}
        tableFrom="5xl"
        onAdd={() => onChange([...rows, blankDiaQty(newKey())])}
        onRemove={(r) => {
          const left = rows.filter((x) => x.key !== r.key);
          onChange(left.length ? left : [blankDiaQty(newKey())]);
        }}
        addLabel="+ Add dia"
        hideAdd={readOnly}
        hideRemove={readOnly}
      />
    </Sheet>
  );
}
