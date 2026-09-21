"use client";

/**
 * IWO Material BOM ▸ Items ▸ [Breakup] — ONE line's rows by colour and/or size
 * (0614; user 2026-09-21, "the attribute field is missing … add it too").
 *
 * WHAT IT IS, AND WHAT IT IS NOT. The order Material BOM's Attribute EXPLODES a
 * line by the order's colourways and sizes — rows the order supplies. An IWO
 * has no order, so its Attribute is a breakup the planner TYPES: a Colour
 * picked from the same list the line's own Colour uses, a Size typed (an IWO
 * has no size range to pick from), a Planned Qty each. The line's Planned Qty
 * is their sum, read-only on the line (`plannedQtyOf`).
 *
 * NO SAVE OF ITS OWN. The rows live on the line in the screen's state and are
 * written by the BOM's own Save, so the footer is `SubSheetFooter` (Done),
 * never a Save that would imply the breakup commits on its own — on a NEW BOM
 * there is no line to commit it against. The Yarn Lines [Shades] sheet's shape.
 *
 * "md", NOT "sm": this is a `ChildGrid`, and its table only switches in from a
 * ~512px container — `sm`'s ~408px of content drops it to header-less cards
 * (AGENTS.md, "A sub-detail Sheet's size").
 *
 * WIDTHS (check:grid-budget): code 144 (Colour) + code 144 (Size) + range 112
 * (Planned Qty) = 400, and 472 with the grid's chrome <= 1155. A colour-only
 * or size-only attribute draws two of the three.
 */

import { Sheet, type SheetOrigin } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { FIELD_WIDTH_CSS } from "@/components/ui/field";
import { ChildGrid, type ChildGridColumn } from "@/components/masters/child-grid";
import { LookupDialogPicker } from "@/components/masters/lookup-dialog-picker";
import { SubSheetFooter } from "@/components/orders/sub-sheet-footer";
import { fmtNumber } from "@/lib/format";
import type { ConfigLookup } from "@/lib/masters/extras-types";
import {
  attributeHasColour,
  attributeHasSize,
  IWO_MB_ATTRIBUTE_LABELS,
  type IwoMbAttribute,
} from "@/lib/orders/iwo-material-bom/types";

/** One breakup row as the grid edits it — Planned Qty held as the TEXT typed. */
export type BreakupRow = { key: string; item_color_id: string | null; size: string; planned_qty: string };

export const blankBreakupRow = (newKey: () => string): BreakupRow => ({
  key: newKey(),
  item_color_id: null,
  size: "",
  planned_qty: "",
});

export function BreakupSheet({
  open,
  onClose,
  origin,
  materialName,
  attribute,
  uomCode,
  rows,
  onChange,
  colors,
  canCreateColour,
  newKey,
  readOnly = false,
}: {
  open: boolean;
  onClose: () => void;
  /** The [Breakup] button's rect, so the box grows out of it. */
  origin?: SheetOrigin | null;
  materialName: string;
  attribute: IwoMbAttribute;
  /** The line's Cons. Uom, named beside the total. */
  uomCode: string;
  rows: BreakupRow[];
  onChange: (next: BreakupRow[]) => void;
  /** The `fabric_color` list — the same one the line's own Colour offers. */
  colors: ConfigLookup[];
  canCreateColour: boolean;
  newKey: () => string;
  readOnly?: boolean;
}) {
  const patch = (key: string, p: Partial<BreakupRow>) => onChange(rows.map((r) => (r.key === key ? { ...r, ...p } : r)));
  const num = (v: string) => {
    const t = v.trim().replace(/,/g, "");
    return t === "" ? null : Number(t);
  };
  const qty = (n: number) => `${fmtNumber(n)}${uomCode ? ` ${uomCode}` : ""}`;

  const columns: ChildGridColumn<BreakupRow>[] = [
    ...(attributeHasColour(attribute)
      ? [
          {
            header: "Colour",
            required: true,
            width: FIELD_WIDTH_CSS.code,
            cell: (r: BreakupRow) => (
              <LookupDialogPicker
                kind="fabric_color"
                label="Colour"
                compact
                required
                options={colors}
                canCreate={canCreateColour && !readOnly}
                value={r.item_color_id}
                onChange={(id) => patch(r.key, { item_color_id: id })}
              />
            ),
          },
        ]
      : []),
    ...(attributeHasSize(attribute)
      ? [
          {
            header: "Size",
            required: true,
            width: FIELD_WIDTH_CSS.code,
            cell: (r: BreakupRow) => (
              <Input
                className="h-8"
                required
                readOnly={readOnly}
                aria-label="Size"
                value={r.size}
                onChange={(e) => patch(r.key, { size: e.target.value })}
              />
            ),
          },
        ]
      : []),
    {
      header: "Planned Qty",
      required: true,
      align: "right",
      width: FIELD_WIDTH_CSS.range,
      total: { kind: "sum", of: (r) => num(r.planned_qty) || 0, format: qty },
      cell: (r) => (
        <Input
          className="h-8 text-right"
          inputMode="decimal"
          required
          readOnly={readOnly}
          aria-label="Planned Qty"
          value={r.planned_qty}
          onChange={(e) => patch(r.key, { planned_qty: e.target.value })}
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
      title={`Breakup — ${materialName || "material"}`}
      footer={<SubSheetFooter onDone={onClose} parent="Material BOM" />}
    >
      <p className="mb-2 text-sm text-muted-foreground">
        {IWO_MB_ATTRIBUTE_LABELS[attribute]} wise: one row per {attributeHasColour(attribute) && attributeHasSize(attribute) ? "colour and size" : attributeHasColour(attribute) ? "colour" : "size"}, and the line&apos;s Planned Qty is their total.
      </p>
      <ChildGrid<BreakupRow>
        columns={columns}
        rows={rows}
        tableFrom="5xl"
        onAdd={() => onChange([...rows, blankBreakupRow(newKey)])}
        onRemove={(r) => {
          const left = rows.filter((x) => x.key !== r.key);
          onChange(left.length ? left : [blankBreakupRow(newKey)]);
        }}
        addLabel="+ Add row"
        hideAdd={readOnly}
        hideRemove={readOnly}
      />
    </Sheet>
  );
}
