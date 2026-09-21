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
import { Truncated } from "@/components/ui/truncated";
import {
  colorLossProblem,
  colorLossSeed,
  colorLossSummary,
  colourKey,
  type ColorLossDraft,
} from "@/lib/orders/fabric-bom/color-loss";

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
}) {
  const [open, setOpen] = useState(false);
  const [origin, setOrigin] = useState<SheetOrigin | null>(null);
  const [draft, setDraft] = useState<ColorLossDraft>({});
  const [tried, setTried] = useState(false);

  const openSheet = (el: HTMLElement) => {
    setOrigin(el.getBoundingClientRect());
    setDraft(colorLossSeed(colours, losses, baseLoss));
    setTried(false);
    setOpen(true);
  };

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
            disabled={readOnly || colours.length === 0}
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
      {wise && (
        <Truncated className="text-xs text-muted-foreground" text={colorLossSummary(colours, losses, baseLoss)} />
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
            <Button type="button" onClick={save}>
              Save Color Loss
            </Button>
          </div>
        }
      >
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
          {tried && problem && <p className="mt-2 text-xs text-destructive">{problem}</p>}
        </div>
      </Sheet>
    </div>
  );
}
