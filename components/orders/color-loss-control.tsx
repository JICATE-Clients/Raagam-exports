"use client";

/**
 * [Set Color Loss] — ONE STEP'S LOSS, PER COLOURWAY (0606, client spec 2026-09-21).
 *
 * Sits under a route step's Loss % on Fabric Process and under a yarn step's on
 * Yarn Process. A tick, "Color-wise", and — once ticked — a button that opens a
 * small sheet listing the fabric's (or yarn's) colourways with the step's own
 * loss as the default and a box per colour for the custom one. The rules
 * (validation, seed, summary) are `lib/orders/fabric-bom/color-loss.ts`; the
 * arithmetic is `lossForCombo`, inside `stagesForGroup`.
 *
 * ## THE SHEET HAS ITS OWN SAVE, AND THAT IS NOT A SECOND WAY TO PERSIST
 *
 * The spec's dialog carries [Cancel] [Save Color Loss], and it needs them:
 * the dialog's gate is "every colourway has a valid loss before the dialog
 * closes", and a draft is what lets Cancel mean cancel. "Save Color Loss"
 * writes the draft into the ROW — the screen's state — exactly like typing in
 * the row does; the BOM's own footer Save is still what reaches the database.
 * The footer USED to say so ("Saved with the BOM") and the body used to state
 * the formula; both lines were removed on the client's word (screenshot 2983,
 * 2026-09-21: "remove this messages no need"). The sheet is two fields per
 * colour and its two buttons, nothing else.
 *
 * ## KEYBOARD
 *
 * The tick is `data-focus-optional` while UNTICKED — most steps are flat, so
 * Tab steps over it and ↑↓←→ still land on it (the Material ▸ Direct Purchase
 * precedent in `lib/focus.ts`: optional on most records, reachable, dropped
 * from the marker once the operator has opted in). The button is a
 * `data-field-trigger`, the dialog-picker idiom: a Tab stop, ↓ / Space / click
 * open it, Enter moves on. It only exists while the tick is on, so it is on the
 * Tab path exactly when there is something behind it.
 *
 * Size is `sm` — a small table opened from inside an already-open editor
 * (AGENTS.md "A sub-detail Sheet's size"), grown from the button that opened it.
 */

import { useState } from "react";
import { Sheet, type SheetOrigin } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { ChildGrid, type ChildGridColumn } from "@/components/masters/child-grid";
import { FIELD_WIDTH_CSS } from "@/components/ui/field";
import { Truncated } from "@/components/ui/truncated";
import {
  colorLossProblem,
  colorLossSeed,
  colorLossSummary,
  colourKey,
  type ColorLossDraft,
} from "@/lib/orders/fabric-bom/color-loss";

/** One row of the pick grid (`pickRows`). */
type PickRow = { key: string; colour: string; loss: string };
/** A key no current row holds. */
const nextKey = (xs: readonly PickRow[]) => `r${xs.reduce((m, x) => Math.max(m, Number(x.key.slice(1)) || 0), -1) + 1}`;

export function ColorLossControl({
  colours,
  baseLoss,
  wise,
  losses,
  onChange,
  stageLabel,
  readOnly = false,
  unavailable = null,
  driven = false,
  pickRows = false,
}: {
  /** The colourways this step can treat — the FABRIC's (or yarn's) own, never
   *  the order's whole list (the cascading rule, same as the Compo Color ▾). */
  colours: readonly string[];
  /** The step's flat Loss %, as typed — the dialog's "Default Stage %". */
  baseLoss: string;
  wise: boolean;
  losses: ColorLossDraft;
  onChange: (next: { color_wise_loss: boolean; color_losses: ColorLossDraft }) => void;
  /** "DYEING" — what the sheet is headed with. */
  stageLabel: string;
  readOnly?: boolean;
  /** Why this step cannot go colour-wise right now (it is already scoped to
   *  one colour, or the fabric serves only one). The tick is not drawn; a
   *  held-on step still shows its summary so nothing computes unseen. */
  unavailable?: string | null;
  /**
   * THE ROW'S For FIELD ALREADY SAID COLOR WISE (client 2026-09-21) — so no
   * tick of our own: the For field IS the switch, and a second one beside it
   * would be two answers to one question. The button stands alone.
   */
  driven?: boolean;
  /**
   * THE OPERATOR'S OWN ROWS (client spec 2026-09-26, "Color-Wise Process Grid:
   * Enable User Entry & Re-wire Dropdown") — each row picks a colour from
   * `colours` and types its loss, with + Add colour and ✕, the Conversion
   * Details' shape. Yarn Process passes it with the yarn's STRIPE colours;
   * Fabric Process keeps the fixed one-row-per-colourway table.
   */
  pickRows?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [origin, setOrigin] = useState<SheetOrigin | null>(null);
  const [draft, setDraft] = useState<ColorLossDraft>({});
  const [rows, setRows] = useState<PickRow[]>([]);
  const [tried, setTried] = useState(false);

  const openSheet = (el: HTMLElement) => {
    setOrigin(el.getBoundingClientRect());
    setDraft(colorLossSeed(colours, losses, baseLoss));
    if (pickRows) {
      /* What is saved, as rows; nothing saved yet → one row per colour at the
         step's own Loss %, so the first open is ready to type into. */
      const held = Object.entries(losses).filter(([k]) => !!k.trim());
      const start =
        held.length > 0
          ? held.map(([k, v]) => ({ colour: colours.find((c) => colourKey(c) === colourKey(k)) ?? k, loss: v }))
          : colours.map((c) => ({ colour: c, loss: baseLoss.trim() }));
      setRows((start.length > 0 ? start : [{ colour: "", loss: "" }]).map((r, i) => ({ key: `r${i}`, ...r })));
    }
    setTried(false);
    setOpen(true);
  };

  /** Pick mode's gate — every row with a colour has a valid loss, and no loss without a colour. */
  const rowsProblem = (): string | null => {
    for (const [i, r] of rows.entries()) {
      const c = r.colour.trim();
      const t = r.loss.trim();
      if (!c && !t) continue;
      if (!c) return `Pick the colour on row ${i + 1}`;
      if (!t) return `Enter the loss % for ${c}`;
      const n = Number(t);
      if (!Number.isFinite(n)) return `The loss % for ${c} is not a number`;
      if (n < 0) return `The loss % for ${c} cannot be negative`;
      if (n >= 100) return `The loss % for ${c} must be below 100`;
    }
    if (!rows.some((r) => r.colour.trim())) return "Add a colour and its loss %";
    return null;
  };
  const saveRows = () => {
    setTried(true);
    if (rowsProblem()) return;
    const map: ColorLossDraft = {};
    for (const r of rows) if (r.colour.trim()) map[colourKey(r.colour)] = r.loss.trim();
    onChange({ color_wise_loss: true, color_losses: map });
    setOpen(false);
  };
  /** The pick grid's two columns — a colour from `colours` (one per row), its loss. */
  const colourLossRowColumns: ChildGridColumn<PickRow>[] = [
    {
      header: "Color",
      width: FIELD_WIDTH_CSS.code,
      cell: (r, i) => {
        const taken = rows.filter((x) => x.key !== r.key).map((x) => colourKey(x.colour));
        const options = [
          ...colours.filter((c) => !taken.includes(colourKey(c))),
          // A saved colour no longer offered stays on its row.
          ...(r.colour && !colours.some((c) => colourKey(c) === colourKey(r.colour)) ? [r.colour] : []),
        ];
        return (
          <Select
            compact
            className="h-8"
            aria-label={`Color, row ${i + 1}`}
            value={r.colour}
            disabled={readOnly}
            onChange={(e) => setRows((xs) => xs.map((x) => (x.key === r.key ? { ...x, colour: e.target.value } : x)))}
          >
            <option value="" />
            {options.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        );
      },
    },
    {
      header: "Loss %",
      width: FIELD_WIDTH_CSS.range,
      align: "right",
      cell: (r, i) => (
        <Input
          type="number"
          inputMode="decimal"
          min={0}
          max={99.99}
          step="0.01"
          className="h-8 text-right"
          aria-label={`Loss % for ${r.colour || `row ${i + 1}`}`}
          value={r.loss}
          disabled={readOnly}
          onChange={(e) => setRows((xs) => xs.map((x) => (x.key === r.key ? { ...x, loss: e.target.value } : x)))}
        />
      ),
    },
  ];

  const problem = colorLossProblem(colours, draft);
  const save = () => {
    setTried(true);
    if (problem) return;
    /* Only the colourways listed are written — saving the dialog also drops a
       colourway that has left the fabric since the losses were last set. */
    onChange({ color_wise_loss: true, color_losses: { ...draft } });
    setOpen(false);
  };

  if (unavailable && !wise) return null;

  return (
    <div className="mt-1 flex min-w-0 flex-col gap-1">
      <div className="flex items-center gap-2">
        {!unavailable && !driven && (
          <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
            <input
              type="checkbox"
              className="size-3.5 accent-primary"
              checked={wise}
              disabled={readOnly}
              aria-label={`Assort Color-Wise Loss for ${stageLabel}`}
              {...(!wise ? { "data-focus-optional": "" } : {})}
              onChange={(e) =>
                onChange(
                  e.target.checked
                    ? /* Ticking seeds every colour with the default so the
                         step keeps computing exactly what it did until the
                         operator changes a figure. */
                      { color_wise_loss: true, color_losses: colorLossSeed(colours, losses, baseLoss) }
                    : { color_wise_loss: false, color_losses: {} },
                )
              }
            />
            Color-wise
          </label>
        )}
        {wise && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            data-field-trigger=""
            disabled={readOnly || (!pickRows && colours.length === 0)}
            onClick={(e) => openSheet(e.currentTarget)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                openSheet(e.currentTarget);
              }
            }}
          >
            {driven ? "Color Loss" : "Set Color Loss"}
          </Button>
        )}
      </div>
      {/* NO SUMMARY LINE UNDER THE BUTTON WHEN For DRIVES IT (user 2026-09-26,
          screenshot 3113: "WHITE — · RED — … no need in UI"). The losses are
          behind the Color Loss button; the ticked (non-driven) mode keeps its
          line, being the only thing on screen that says the step is colour-wise. */}
      {wise && !driven && (
        <Truncated
          className="text-xs text-muted-foreground"
          text={
            pickRows
              ? Object.entries(losses)
                  .map(([k, v]) => `${k} ${(v ?? "").trim() || "—"}`)
                  .join(" · ")
              : colorLossSummary(colours, losses, baseLoss)
          }
        />
      )}
      {wise && unavailable && <p className="text-xs text-warning">{unavailable}</p>}

      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={`Color-Wise Process Loss (Stage: ${stageLabel})`}
        size="sm"
        alignToPane
        origin={origin}
        footer={
          <div className="flex w-full items-center justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="button" onClick={pickRows ? saveRows : save}>
              Save Color Loss
            </Button>
          </div>
        }
      >
        {pickRows ? (
          <div data-focus-scope="">
            {/* ONE ChildGrid, never a hand-rolled table (raagam-screen-layout) —
                Ctrl+Del, "+ Add colour" and the landing in a new row come with
                it. `tableAlways`: two fixed columns (144 + 112 = 256 + 72 chrome
                = 328px) fit the sm sheet, where the default breakpoint would
                drop to cards. */}
            <ChildGrid<PickRow>
              columns={colourLossRowColumns}
              rows={rows}
              tableAlways
              hideAdd={readOnly}
              hideRemove={readOnly}
              addLabel="+ Add colour"
              onAdd={() => setRows((xs) => [...xs, { key: nextKey(xs), colour: "", loss: "" }])}
              onRemove={(r) => setRows((xs) => xs.filter((x) => x.key !== r.key))}
            />
            {tried && rowsProblem() && <p className="mt-2 text-xs text-danger">{rowsProblem()}</p>}
          </div>
        ) : (
        <div data-focus-scope="">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                {/* TWO FIELDS, COLOR AND LOSS (client 2026-09-21). A "default"
                    column went: under COLOR WISE the step has no flat Loss %
                    on screen, so a default beside each colour named a figure
                    the operator cannot see or edit. */}
                <th className="py-1.5 pr-2 font-medium">Color</th>
                <th className="py-1.5 text-right font-medium">Loss %</th>
              </tr>
            </thead>
            <tbody>
              {colours.map((c) => {
                const k = colourKey(c);
                const v = draft[k] ?? "";
                const bad = tried && colorLossProblem([c], draft) !== null;
                return (
                  <tr key={k} className="border-b last:border-b-0">
                    <td className="py-1.5 pr-2 font-medium">{c}</td>
                    <td className="py-1.5">
                      <div className="ml-auto flex w-28 items-center gap-1">
                        <Input
                          type="number"
                          inputMode="decimal"
                          min={0}
                          max={99.99}
                          step="0.01"
                          className="h-8 text-right"
                          aria-label={`Loss % for ${c}`}
                          aria-invalid={bad || undefined}
                          required
                          value={v}
                          disabled={readOnly}
                          onChange={(e) => setDraft((d) => ({ ...d, [k]: e.target.value }))}
                        />
                        <span className="text-xs text-muted-foreground">%</span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {/* `text-danger`, not `text-destructive` — the latter is no token here
              and compiled to no colour (--check color-token, 2026-09-26). */}
          {tried && problem && <p className="mt-2 text-xs text-danger">{problem}</p>}
        </div>
        )}
      </Sheet>
    </div>
  );
}
