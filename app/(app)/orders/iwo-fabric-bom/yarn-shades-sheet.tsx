"use client";

/**
 * IWO Fabric BOM ▸ Yarn Lines ▸ [Shades] — the shades of ONE DYED yarn line
 * (0592; client audio 2026-09-19: "Stage = DYED prompts for specific yarn shade
 * colours and planned weights per shade").
 *
 * NO SAVE OF ITS OWN. The rows live on the yarn line in the screen's state and
 * are written by the BOM's own Save, so the footer is `SubSheetFooter` (Done),
 * never a Save that would imply the shades commit on their own — on a NEW BOM
 * there is no row to commit them against.
 *
 * "md", NOT "sm": this is a `ChildGrid`, and its table only switches in from a
 * ~512px container — `sm`'s ~408px of content drops it to header-less cards
 * (AGENTS.md, "A sub-detail Sheet's size"; Style ▸ Process's own note).
 *
 * A shade's colour is PICKED from the BOM's Yarn Colour panel, never typed:
 * the Yarn Process grid scopes a dyeing step by that same name, and two
 * spellings of one colour would be a step that dyes nothing.
 */

import { Sheet, type SheetOrigin } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { FIELD_WIDTH_CSS } from "@/components/ui/field";
import { ChildGrid, type ChildGridColumn } from "@/components/masters/child-grid";
import { SubSheetFooter } from "@/components/orders/sub-sheet-footer";
import type { IwoColourBy } from "@/lib/orders/iwo-fabric-bom/yarn";

/** One shade as the grid edits it — KGS held as the TEXT typed. */
export type ShadeRow = { key: string; color_name: string; planned_kgs: string };

export function YarnShadesSheet({
  open,
  onClose,
  origin,
  yarnName,
  colourBy,
  rows,
  onChange,
  colours,
  purchaseOf,
  newKey,
  readOnly = false,
}: {
  open: boolean;
  onClose: () => void;
  /** The [Shades] button's rect, so the box grows out of it. */
  origin?: SheetOrigin | null;
  yarnName: string;
  colourBy: IwoColourBy | null;
  rows: ShadeRow[];
  onChange: (next: ShadeRow[]) => void;
  /** The Yarn Colour panel's names. */
  colours: readonly string[];
  /** Dyed Purchase only — what each shade buys (the engine's answer, keyed by
   *  the capitalised colour). Null on Yarn Dyeing: the grey lot is bought once,
   *  on the yarn line. */
  purchaseOf: ((colour: string) => number | null) | null;
  newKey: () => string;
  readOnly?: boolean;
}) {
  const patch = (key: string, p: Partial<ShadeRow>) => onChange(rows.map((r) => (r.key === key ? { ...r, ...p } : r)));
  const kg = (n: number) => n.toLocaleString("en-IN", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
  const num = (v: string) => {
    const t = v.trim().replace(/,/g, "");
    return t === "" ? null : Number(t);
  };

  /**
   * WIDTHS (check:grid-budget): code 144 + range 112 + range 112 = 368, and
   * 408 with the grid's chrome <= 1155.
   */
  const shadeColumns: ChildGridColumn<ShadeRow>[] = [
    {
      header: "Colour",
      required: true,
      width: FIELD_WIDTH_CSS.code,
      cell: (r) => {
        // The colour this row holds survives even once it has left the panel —
        // the "Disabled rows" rule: a filled field never renders as empty. The
        // rule in `lines.ts` then says it is off the panel.
        const offPanel = r.color_name && !colours.includes(r.color_name) ? [r.color_name] : [];
        return (
          <Select
            compact
            required
            aria-label="Shade colour"
            disabled={readOnly}
            value={r.color_name}
            onChange={(e) => patch(r.key, { color_name: e.target.value })}
          >
            <option value="" />
            {[...colours, ...offPanel].map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        );
      },
    },
    {
      header: "KGS",
      required: true,
      align: "right",
      width: FIELD_WIDTH_CSS.range,
      total: { kind: "sum", of: (r) => num(r.planned_kgs) || 0, format: kg },
      cell: (r) => (
        <Input
          className="h-8 text-right"
          inputMode="decimal"
          required
          readOnly={readOnly}
          aria-label="Shade KGS"
          value={r.planned_kgs}
          onChange={(e) => patch(r.key, { planned_kgs: e.target.value })}
        />
      ),
    },
    ...(purchaseOf
      ? [
          {
            // Derived, never typed — `readOnly` also takes it off the Tab path.
            header: "Purchase Wt",
            align: "right" as const,
            width: FIELD_WIDTH_CSS.range,
            total: { kind: "sum" as const, of: (r: ShadeRow) => purchaseOf(r.color_name) ?? 0, format: kg },
            cell: (r: ShadeRow) => {
              const q = purchaseOf(r.color_name);
              return <Input className="h-8 text-right" readOnly aria-label="Shade purchase weight" value={q == null ? "" : kg(q)} />;
            },
          },
        ]
      : []),
  ];

  return (
    <Sheet
      open={open}
      onClose={onClose}
      size="md"
      alignToPane
      origin={origin}
      zIndexBase={120}
      title={`Shades — ${yarnName || "yarn"}`}
      footer={<SubSheetFooter onDone={onClose} parent="Fabric BOM" />}
    >
      <p className="mb-2 text-sm text-muted-foreground">
        {colourBy === "yarn_dyeing"
          ? "Yarn Dyeing: the grey total is bought once, then each shade gets its own dyeing step on Yarn Process."
          : colourBy === "dyed_purchase"
            ? "Dyed Purchase: each shade is bought already dyed."
            : "Choose Colour by on the yarn line first."}
      </p>
      {colours.length === 0 && (
        <p className="mb-2 text-sm text-warning">
          The Yarn Colour panel (Fabric BOM section) is empty — add the shade names there first.
        </p>
      )}
      <ChildGrid<ShadeRow>
        columns={shadeColumns}
        rows={rows}
        tableFrom="5xl"
        onAdd={() => onChange([...rows, { key: newKey(), color_name: "", planned_kgs: "" }])}
        onRemove={(r) => {
          const left = rows.filter((x) => x.key !== r.key);
          onChange(left.length ? left : [{ key: newKey(), color_name: "", planned_kgs: "" }]);
        }}
        addLabel="+ Add shade"
        hideAdd={readOnly}
        hideRemove={readOnly}
      />
    </Sheet>
  );
}
