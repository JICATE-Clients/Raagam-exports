"use client";

/**
 * IWO Material BOM ▸ Items ▸ the rows UNDER a split line — one line's breakup
 * by colour and/or size (0614), listed the way the order Material BOM lists
 * its Attribute rows (user 2026-09-22: "use the same logic and UI for listing
 * it"): a caption band naming the attribute and its row count, a chevron that
 * folds it, and the grid beneath, all INSIDE the line's own card so Tab walks
 * the line's cells and then these rows (`tabFieldsIn`, "a row's nested grid
 * is part of the row").
 *
 * IT REPLACED A SHEET. The first cut (2026-09-21) put these rows behind a
 * [Breakup] button in the Planned Qty cell, opening a side sheet — so the
 * figure on the line and the rows that made it were two screens apart, and a
 * line's colours could not be read beside the line. The order screen's
 * `bom-slice-grid.tsx` is the shape this follows: rows under the line, open by
 * default, and a caption that refuses to fold while a row still owes a value
 * (AGENTS.md: requiring a hidden field is a record that cannot be saved with
 * nothing on screen to say why).
 *
 * WHAT AN IWO ATTRIBUTE MEANS, AND WHAT IT DOES NOT. The order Material BOM's
 * Attribute EXPLODES a line by the order's colourways and sizes — rows the
 * order supplies. An IWO has no order, so its rows are PICKED: an Item Color
 * from the same list the line's own Colour uses, a Size from the Sizes master
 * (the list the garment order's size range is picked from — user 2026-09-22,
 * "size from master, same concept"), a Planned Qty each. The line's Planned
 * Qty is their sum (`plannedQtyOf`), read-only on the line.
 *
 * BOTH PICKERS TAKE A NAME THAT IS NOT ON THE LIST — type it and the last row
 * reads `Add "…"` (the `DataPicker` behind every lookup picker), gated like
 * the order screen's Item Color by the MASTERS permission, since that writes
 * the master. The first cut gated it on orders-create and passed no `canEdit`,
 * so the colour read as a closed list (user 2026-09-22, "allow manual entry").
 *
 * THE SIZE COLUMN STAYS TEXT (0614). The picker is keyed by the size's NAME:
 * its value is the master row whose name matches what the row holds, and a
 * pick writes that row's name back. A size stored before the master had it
 * still shows — offered back as a row of its own so the cell never reads
 * blank over a value it holds — and re-picking replaces it.
 *
 * THE COLUMNS FOLLOW THE ATTRIBUTE, the order screen's rule: Item Color is
 * drawn only under Colour / Colour + Size, Size only under Size / Colour +
 * Size — a column for an axis the line does not split by would be a box with
 * nothing to put in it.
 *
 * ITEM COLOR IS NOT STARRED, NOT HELD, NOT REFUSED — the IWO exception (client
 * spec 2026-09-22). The order screen makes it mandatory on a colour-wise row;
 * an IWO books advance trims before the buyer's shades are approved, so a row
 * whose colour is still pending is the ordinary case. Size stays mandatory: a
 * size-wise row with no size says nothing. `rules.ts` is the one place the
 * refusal lives; this file only draws what it decides.
 *
 * WIDTHS (check:grid-budget): code 144 (Item Color) + code 144 (Size) + range
 * 112 (Planned Qty) = 400, and 472 with the grid's chrome — a `tableAlways`
 * grid, which is safe because it is a third of the narrowest pane. A SAMPLE
 * plan adds term 176 (SMP No) first and hug 88 (Add) last = 664 + 72 = 736,
 * still well inside it.
 *
 * ON A SAMPLE PLAN THESE ROWS ARE THE SAMPLES' SHARES (0711, client
 * 2026-10-12 — the Fabric Plan's Allocation / Consumption split applied to
 * accessories). The line is the SWO's consolidated accessory; every row here
 * names its SMP, and the rows are there under EVERY attribute — under Item
 * wise it is one row per sample. A sample needing several colours or sizes
 * of the accessory gets them as SUB-ROWS under its SMP ("+ Colour" /
 * "+ Size", the Fabric Plan's "+ Add Dia"): the SMP is shown once, on the
 * head row, and never re-picked. `sub` is a hint, not a link — a row reads as
 * a continuation only while its SMP still equals the row above, so removing
 * the head can never strand one under the wrong sample. The grid's
 * own card is the ONE frame; the caption lives in its `label` row (see the
 * note at the render).
 */

import { ChevronDown, ChevronRight } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { FIELD_WIDTH_CSS } from "@/components/ui/field";
import { ChildGrid, type ChildGridColumn } from "@/components/masters/child-grid";
import { LookupDialogPicker } from "@/components/masters/lookup-dialog-picker";
import { fmtNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ConfigLookup } from "@/lib/masters/extras-types";
import {
  attributeHasColour,
  attributeHasSize,
  IWO_MB_ATTRIBUTE_LABELS,
  type IwoMbAttribute,
} from "@/lib/orders/iwo-material-bom/types";
import { isBlankIwoMbSlice } from "@/lib/orders/iwo-material-bom/rules";

/** One breakup row as the grid edits it — Planned Qty held as the TEXT typed. */
export type BreakupRow = {
  key: string;
  /** 0711 — the SWO sample (SMP) this row is for; "" = none / production. */
  sample_style_id: string;
  item_color_id: string | null;
  size: string;
  planned_qty: string;
  /** A further colour / size of the SMP on the row above (sample plan only). */
  sub?: boolean;
};

export const blankBreakupRow = (newKey: () => string): BreakupRow => ({
  key: newKey(),
  sample_style_id: "",
  item_color_id: null,
  size: "",
  planned_qty: "",
});

const num = (v: string) => {
  const t = v.trim().replace(/,/g, "");
  return t === "" ? null : Number(t);
};

export function BreakupGrid({
  attribute,
  uomCode,
  rows,
  onChange,
  colors,
  sizes,
  masterPerms,
  newKey,
  open,
  onToggle,
  samples,
}: {
  attribute: IwoMbAttribute;
  /** The line's Cons. Uom, named beside the total. */
  uomCode: string;
  rows: BreakupRow[];
  onChange: (next: BreakupRow[]) => void;
  /** The `fabric_color` list — the same one the line's own Colour offers. */
  colors: ConfigLookup[];
  /** The `size` list — the Sizes master. */
  sizes: ConfigLookup[];
  /** Add / Modify on either picker writes a master: gated by `masters`. */
  masterPerms: { canCreate: boolean; canEdit: boolean };
  newKey: () => string;
  open: boolean;
  onToggle: () => void;
  /** A SAMPLE plan (0711): the SWO's samples, what SMP No offers — `null`
   *  while no SWO is picked (the column shows, greyed, saying why). Absent on
   *  a production IWO: no SMP column at all. */
  samples?: { id: string; label: string }[] | null;
}) {
  const perSmp = samples !== undefined;
  const patch = (key: string, p: Partial<BreakupRow>) => onChange(rows.map((r) => (r.key === key ? { ...r, ...p } : r)));
  const withColour = attributeHasColour(attribute);
  const withSize = attributeHasSize(attribute);
  const attrLabel = IWO_MB_ATTRIBUTE_LABELS[attribute];
  const label = perSmp ? (attribute === "item" ? "Samples" : `Samples · ${attrLabel}`) : attrLabel;

  /** A sub-row of the SMP above (the header note). */
  const follows = (i: number) => perSmp && i > 0 && !!rows[i]?.sub && rows[i].sample_style_id === rows[i - 1].sample_style_id;
  const runEnd = (i: number) => !follows(i + 1);
  /** The head row and the sub-rows straight after it. */
  const runOf = (i: number) => {
    const out = [i];
    for (let j = i + 1; j < rows.length && follows(j); j++) out.push(j);
    return out;
  };
  /** The head of the run a row belongs to — where its SMP lives. */
  const headOf = (i: number) => {
    let h = i;
    while (h > 0 && follows(h)) h--;
    return h;
  };
  /** Re-picking a head's SMP carries to its sub-rows, so the run never splits. */
  const setSmp = (i: number, id: string) => {
    const run = new Set(runOf(i).map((j) => rows[j].key));
    onChange(rows.map((r) => (run.has(r.key) ? { ...r, sample_style_id: id } : r)));
  };
  /** "+ Colour" / "+ Size" — a new row under the SMP, after its last one. */
  const addUnder = (head: number) => {
    const run = runOf(head);
    const at = run[run.length - 1] + 1;
    const added: BreakupRow = { ...blankBreakupRow(newKey), sample_style_id: rows[head].sample_style_id, sub: true };
    onChange([...rows.slice(0, at), added, ...rows.slice(at)]);
  };
  const subMark = <span aria-hidden className="pl-2 text-muted-foreground">↳</span>;
  const qty = (n: number) => `${fmtNumber(n)}${uomCode ? ` ${uomCode}` : ""}`;

  /* THE SAME TEST THE SAVE RUNS, read here for the caption: which row still
     owes a value. A row nobody typed on owes nothing (the save drops it) —
     unless it is the ONLY row, since a split line with no kept row is a line
     with no Planned Qty. */
  const kept = rows.filter(
    (r) =>
      !isBlankIwoMbSlice({ sample_style_id: r.sample_style_id || null, item_color_id: r.item_color_id, size: r.size, planned_qty: num(r.planned_qty) }),
  );
  const owes = (r: BreakupRow) =>
    perSmp && !r.sample_style_id ? "its SMP No" : withSize && !r.size.trim() ? "a Size" : num(r.planned_qty) == null ? "its Planned Qty" : null;
  const owing = kept.findIndex((r) => owes(r) != null);
  const owed =
    kept.length === 0
      ? perSmp
        ? "add a row for each sample, with its Planned Qty"
        : "add a row with its Planned Qty"
      : owing >= 0
        ? `row ${rows.indexOf(kept[owing]) + 1} needs ${owes(kept[owing])}`
        : null;
  const total = kept.reduce((a, r) => a + (num(r.planned_qty) ?? 0), 0);

  /* THE SIZE PICKER, KEYED BY NAME (header note). A held name the master does
     not know is offered back as its own row so the box shows what it holds. */
  const sizeOptionsFor = (held: string): ConfigLookup[] => {
    const h = held.trim().toUpperCase();
    if (!h || sizes.some((s) => s.name.trim().toUpperCase() === h)) return sizes;
    return [...sizes, { id: `text:${h}`, kind: "size", code: null, name: h, notes: null, is_active: true } as ConfigLookup];
  };
  const sizeIdOf = (held: string): string | null => {
    const h = held.trim().toUpperCase();
    if (!h) return null;
    return sizes.find((s) => s.name.trim().toUpperCase() === h)?.id ?? `text:${h}`;
  };
  const sizeNameOf = (id: string): string =>
    id.startsWith("text:") ? id.slice(5) : (sizes.find((s) => s.id === id)?.name ?? "");

  const breakupColumns: ChildGridColumn<BreakupRow>[] = [
    ...(perSmp
      ? [
          {
            header: "SMP No",
            required: !!samples,
            width: FIELD_WIDTH_CSS.term,
            cell: (r: BreakupRow, i: number) => {
              if (follows(i)) return subMark;
              const held = r.sample_style_id && !samples?.some((x) => x.id === r.sample_style_id) ? r.sample_style_id : "";
              return (
                <Select
                  compact
                  className={cn("h-8", held && "text-danger")}
                  aria-label="SMP No"
                  required={!!samples}
                  disabled={!samples}
                  title={samples ? undefined : "Pick the SWO first — its samples are listed here."}
                  value={r.sample_style_id}
                  onChange={(e) => setSmp(i, e.target.value)}
                >
                  <option value="">{samples ? "" : "Pick the SWO first"}</option>
                  {(samples ?? []).map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.label}
                    </option>
                  ))}
                  {held && <option value={held}>(not in this SWO)</option>}
                </Select>
              );
            },
          },
        ]
      : []),
    ...(withColour
      ? [
          {
            header: "Item Color",
            width: FIELD_WIDTH_CSS.code,
            cell: (r: BreakupRow) => (
              <LookupDialogPicker
                kind="fabric_color"
                label="Item Color"
                compact
                options={colors}
                canCreate={masterPerms.canCreate}
                canEdit={masterPerms.canEdit}
                value={r.item_color_id}
                onChange={(id) => patch(r.key, { item_color_id: id })}
              />
            ),
          },
        ]
      : []),
    ...(withSize
      ? [
          {
            header: "Size",
            required: true,
            width: FIELD_WIDTH_CSS.code,
            cell: (r: BreakupRow) => (
              <LookupDialogPicker
                kind="size"
                label="Size"
                compact
                required
                options={sizeOptionsFor(r.size)}
                canCreate={masterPerms.canCreate}
                canEdit={masterPerms.canEdit}
                value={sizeIdOf(r.size)}
                onChange={(id) => patch(r.key, { size: id ? sizeNameOf(id) : "" })}
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
          aria-label="Planned Qty"
          value={r.planned_qty}
          onChange={(e) => patch(r.key, { planned_qty: e.target.value })}
        />
      ),
    },
    /* "+ COLOUR" / "+ SIZE" — on the LAST row of an SMP's run, so the new row
       lands under the ones it joins. Only where an SMP can own several rows
       (a colour / size attribute); under Item wise one row per sample is the
       whole answer. `data-row-open` puts it on the row's axis for Tab, Enter
       and the arrows, as the caption is. */
    ...(perSmp && attribute !== "item"
      ? [
          {
            header: "Add",
            // hug, not num: "+ Colour" wraps to two lines in 72px.
            width: FIELD_WIDTH_CSS.hug,
            cell: (_r: BreakupRow, i: number) => {
              if (!runEnd(i)) return null;
              const head = headOf(i);
              const what = withColour && !withSize ? "Colour" : withSize && !withColour ? "Size" : "Row";
              const reason = rows[head].sample_style_id ? null : "Pick the SMP No first";
              return (
                <span title={reason ?? undefined} className="inline-block">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    data-row-open
                    disabled={!!reason}
                    aria-label={reason ? `Add ${what} — ${reason}` : `Add another ${what.toLowerCase()} for this sample`}
                    onClick={() => addUnder(head)}
                  >
                    + {what}
                  </Button>
                </span>
              );
            },
          },
        ]
      : []),
  ];

  /* THE CAPTION IS THE FOLD, and it is a `data-row-open` control so Tab,
     Enter and ← → reach it on the line's own axis. It stays put and names the
     row that is unanswered rather than vanishing — the order screen's caption,
     and `canFold`'s "a row with nothing filled has no summary worth showing"
     one level up. `normal-case tracking-normal` because the grid's `label`
     slot sets small caps for a plain title, and this is a sentence. */
  const caption = (
    <button
      type="button"
      data-row-open
      onClick={onToggle}
      aria-expanded={open}
      disabled={!!owed}
      title={owed ? `Fill in the ${label.toLowerCase()} rows before closing this` : undefined}
      className="flex items-center gap-1.5 rounded text-[11px] font-medium normal-case tracking-normal text-foreground hover:text-primary disabled:cursor-default disabled:hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {open ? (
        <ChevronDown className={cn("h-3.5 w-3.5 shrink-0", owed && "opacity-40")} />
      ) : (
        <ChevronRight className="h-3.5 w-3.5 shrink-0" />
      )}
      <span>
        {label}
        <span className="text-muted-foreground">
          {" "}&mdash; {kept.length} row{kept.length === 1 ? "" : "s"}
          {kept.length > 0 && total > 0 && <> &middot; {qty(total)}</>}
        </span>
      </span>
    </button>
  );
  const warning = owed ? <span className="pl-3 text-[11px] font-normal normal-case tracking-normal text-warning">{owed}</span> : null;

  /* ONE FRAME — THE GRID'S OWN (user 2026-09-22, screenshot 3015: "excess
     border"). The first cut wrapped caption, grid and "+ Add row" in a second
     rounded border, 480px wide around a 472px table: two frames touching on
     the left, 8px of dead frame on the right, the button boxed in below. The
     caption is the grid's `label` row now and the warning its `badge`, so the
     card `ChildGrid` already draws is the only box, hugging its table like the
     Processes grid beside it. Folded, the caption stands alone — never
     `hidden`: a hidden field is still in the DOM for Tab and the holds. */
  if (!open) {
    return (
      <div className="mt-3 flex items-center gap-3">
        {caption}
        {warning}
      </div>
    );
  }
  return (
    <div className="mt-3">
      <ChildGrid<BreakupRow>
        label={caption}
        badge={warning}
        columns={breakupColumns}
        rows={rows}
        tableAlways
        onAdd={() => onChange([...rows, blankBreakupRow(newKey)])}
        onRemove={(r) => {
          const left = rows.filter((x) => x.key !== r.key);
          onChange(left.length ? left : [blankBreakupRow(newKey)]);
        }}
        addLabel="+ Add row"
      />
    </div>
  );
}
