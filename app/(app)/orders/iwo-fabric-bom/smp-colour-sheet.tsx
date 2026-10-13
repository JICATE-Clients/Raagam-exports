"use client";

/**
 * Sample ▸ Fabric Plan ▸ Fabric Consumption ▸ [Colours & Dias] — ONE sample's
 * colours on ONE fabric, each with its dias and weights (user 2026-10-12,
 * approved mock-up "Colours & Dias Popup").
 *
 * THE ORDER MODULE'S SHAPE, BORROWED. Order Entry ▸ Combos ▸ [Detail] opens
 * "Structure Details": a parent on the left, its child rows beside it, one rule
 * per cell. Here the parent is the COLOUR and the children are its DIAS — the
 * client's tree (SMP + Fabric + GSM → Colour → Finish Dia + Req Wt) with the
 * first level on the screen and the other two in here, so a colour is picked
 * once however many dias it is cut at.
 *
 * ONE TABLE, ONE HEADER (rework 2026-10-12, screenshot 3457). The first cut
 * drew a box per colour, each with its own column titles, a tall empty left
 * half and a stretched Gross Yarn column; the titles sat away from the boxes
 * they named. Now it is a single CSS grid at fixed column widths that hugs its
 * contents: the Colour cell SPANS its dia rows (`gridRow: span n`), the titles
 * are drawn once, and a Fabric total row closes it. Gridlines are the `gap-px`
 * over a border-coloured ground — every cell gets its rule without a border
 * per cell to keep in step.
 *
 * WHAT IS OWED IS SHOWN ON THE BOX, NOT LISTED IN A SENTENCE. Each control
 * carries `required`, so a blank one wears `data-required-empty` (the cursor
 * hold's marker) and the red ring below; the footer only counts what is left.
 * The old sentence named every line ("RED · a dia, RED · a dia, a colour · a
 * dia") and was there before anything had been typed.
 *
 * NO SAVE OF ITS OWN, like Style ▸ Process and the Shades popup: the Fabric
 * Plan's Save writes these rows, so the footer is `SubSheetFooter` (Done),
 * held — with the count — while something is still blank.
 *
 * GREIGE HAS NO COLOUR (`lines.ts`): one block of dias, no Colour cell's
 * picker and no "+ Add colour". A PRINT-stage fabric asks a Print beside each
 * colour, inside the same cell.
 */

import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import type { SheetOrigin } from "@/components/ui/sheet";
import { Truncated } from "@/components/ui/truncated";
import { SubDetailSheet } from "@/components/orders/sub-detail-sheet";
import { cn } from "@/lib/utils";
import { comboKey } from "@/lib/orders/fabric-bom/yarn-process";
import { diaKey } from "@/lib/orders/fabric-bom/dia-knit";

export type SmpColourDia = { key: string; finish_dia: string; req_kgs: string };
export type SmpColourBlock = { grp: string; color_name: string; print_name: string; dias: SmpColourDia[] };

const num = (v: string): number | null => {
  const t = v.trim().replace(/,/g, "");
  return t === "" ? null : Number(t);
};
const kg = (n: number) => n.toLocaleString("en-IN", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Colour 12rem · Finish Dia 8rem · Req Wt 8rem · Gross Yarn 7rem · ✕ 2.5rem
 *  = 37.5rem; the sheet is capped at 2xl (42rem) around it. */
const COLS = "grid-cols-[12rem_8rem_8rem_7rem_2.5rem]";
const HEAD = "bg-surface-muted px-3 py-2 text-[10.5px] font-semibold uppercase tracking-[.06em] text-muted-foreground";
const CELL = "bg-surface px-2 py-1.5";

/** A held value the panel no longer lists stays selectable as itself, tagged. */
function PanelSelect({
  label,
  value,
  options,
  keyOf,
  required,
  onPick,
}: {
  label: string;
  value: string;
  options: readonly string[];
  keyOf: (v: string) => string;
  required?: boolean;
  onPick: (v: string) => void;
}) {
  const held = value.trim() && !options.some((o) => keyOf(o) === keyOf(value)) ? value : "";
  return (
    <Select
      compact
      required={required}
      aria-label={label}
      value={held || options.find((o) => keyOf(o) === keyOf(value)) || ""}
      onChange={(e) => onPick(e.target.value)}
      className={cn(held && "text-danger")}
    >
      <option value="" />
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
      {held && <option value={held}>{held} (not declared)</option>}
    </Select>
  );
}

export function SmpColourSheet({
  open,
  onClose,
  origin,
  subtitle,
  blocks,
  greige,
  withPrint,
  colours,
  prints,
  dias,
  diaHint,
  grossOf,
  onColour,
  onPrint,
  onDia,
  onAddDia,
  onRemoveDia,
  onAddColour,
  onRemoveColour,
}: {
  open: boolean;
  onClose: () => void;
  origin: SheetOrigin | null;
  /** SMP · style · fabric · GSM — the second line of the title. */
  subtitle: string;
  blocks: SmpColourBlock[];
  /** A greige fabric — no colour to pick. */
  greige: boolean;
  /** A PRINT-stage fabric — each colour also names its Print. */
  withPrint: boolean;
  colours: readonly string[];
  prints: readonly string[];
  dias: readonly string[];
  /** Said when `dias` is empty: which panel to fill, for which knit family. */
  diaHint: string;
  /** Gross yarn for a weight in a colour (the fabric's route losses). */
  grossOf: (kgs: number | null, colour: string) => number | null;
  onColour: (grp: string, v: string) => void;
  onPrint: (grp: string, v: string) => void;
  onDia: (key: string, patch: { finish_dia?: string; req_kgs?: string }) => void;
  onAddDia: (grp: string) => void;
  onRemoveDia: (key: string, grp: string) => void;
  onAddColour: () => void;
  onRemoveColour: (grp: string) => void;
}) {
  const subtotal = (b: SmpColourBlock) => b.dias.reduce((a, d) => a + (num(d.req_kgs) || 0), 0);
  const total = blocks.reduce((a, b) => a + subtotal(b), 0);
  const totalGross = blocks.reduce(
    (a, b) => a + b.dias.reduce((x, d) => x + (grossOf(num(d.req_kgs), b.color_name) ?? 0), 0),
    0,
  );

  /* WHAT DONE WAITS FOR — counted, not listed; the boxes themselves are red. */
  const noWeight = blocks.reduce((a, b) => a + b.dias.filter((d) => !((num(d.req_kgs) ?? 0) > 0)).length, 0);
  const noDia = greige ? 0 : blocks.reduce((a, b) => a + b.dias.filter((d) => !d.finish_dia.trim()).length, 0);
  const noColour = greige ? 0 : blocks.filter((b) => !b.color_name.trim()).length;
  const owed = [
    noColour && plural(noColour, "colour"),
    noDia && plural(noDia, "Finish Dia", "Finish Dias"),
    noWeight && plural(noWeight, "weight"),
  ].filter(Boolean);
  const blockedReason = owed.length ? `Still needed: ${owed.join(", ")} — fill the red boxes, or remove those lines.` : null;

  const canRemoveColour = !greige && blocks.length > 1;

  return (
    <SubDetailSheet
      open={open}
      onClose={onClose}
      origin={origin}
      title={
        <>
          <span className="block">Colours &amp; Dias</span>
          <Truncated className="block text-xs font-normal text-muted-foreground">{subtitle}</Truncated>
        </>
      }
      grid
      maxWidthClass="max-w-2xl"
      parent="Fabric Plan"
      blockedReason={blockedReason}
    >
      <div className="space-y-3">
        {dias.length === 0 && <p className="text-sm text-warning">{diaHint}</p>}
        {/* ONE TABLE. Scrolls sideways inside the sheet on a phone rather than
            folding, so a colour and its dias never part company. */}
        <div className="overflow-x-auto">
          <div
            className={cn(
              "grid w-fit gap-px overflow-hidden rounded-control border bg-border",
              COLS,
              "[&_[data-required-empty]]:ring-1 [&_[data-required-empty]]:ring-danger",
            )}
          >
            {/* The titles, once. */}
            <div className={HEAD}>{greige ? "Greige" : withPrint ? "Colour · Print" : "Colour"}</div>
            <div className={HEAD}>Finish Dia</div>
            <div className={cn(HEAD, "text-right")}>Req Wt (kgs)</div>
            <div className={cn(HEAD, "text-right")}>Gross Yarn</div>
            <div className={HEAD} aria-hidden />

            {blocks.map((b) => {
              const sub = subtotal(b);
              const onlyDia = b.dias.length === 1;
              return [
                /* THE COLOUR CELL spans its dia rows and the "+ Add dia" row. */
                <div
                  key={`${b.grp}:colour`}
                  className={cn(CELL, "space-y-1.5 py-2")}
                  style={{ gridRow: `span ${b.dias.length + 1}` }}
                >
                  {greige ? (
                    <div className="text-sm font-medium">Greige</div>
                  ) : (
                    <div className="flex items-center gap-1">
                      <div className="min-w-0 flex-1">
                        <PanelSelect label="Colour" required value={b.color_name} options={colours} keyOf={comboKey} onPick={(v) => onColour(b.grp, v)} />
                      </div>
                      {canRemoveColour && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          data-row-remove
                          className="h-8 w-8 shrink-0 px-0 text-muted-foreground"
                          aria-label={`Remove ${b.color_name || "this colour"} and its dias`}
                          title="Remove this colour and its dias"
                          onClick={() => onRemoveColour(b.grp)}
                        >
                          <X aria-hidden className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  )}
                  {withPrint && !greige && (
                    <PanelSelect label="Print" required value={b.print_name} options={prints} keyOf={comboKey} onPick={(v) => onPrint(b.grp, v)} />
                  )}
                  <div className="text-xs text-muted-foreground">
                    Subtotal <span className="font-semibold tabular-nums text-foreground">{kg(sub)}</span> kg
                  </div>
                </div>,

                /* ONE ROW PER DIA. */
                ...b.dias.flatMap((d) => {
                  const w = num(d.req_kgs);
                  const g = grossOf(w, b.color_name);
                  // A colour's only dia: its ✕ takes the colour with it, when
                  // there is another colour to keep; otherwise there is nothing
                  // to remove and the cell stays empty.
                  const removable = !onlyDia || canRemoveColour;
                  return [
                    <div key={`${d.key}:dia`} className={CELL}>
                      <PanelSelect
                        label={`Finish Dia${b.color_name ? ` — ${b.color_name}` : ""}`}
                        required={!greige}
                        value={d.finish_dia}
                        options={dias}
                        keyOf={diaKey}
                        onPick={(v) => onDia(d.key, { finish_dia: v })}
                      />
                    </div>,
                    <div key={`${d.key}:kg`} className={CELL}>
                      <Input
                        className="h-8 text-right"
                        inputMode="decimal"
                        required
                        aria-label={`Req Wt (kgs)${b.color_name ? ` — ${b.color_name}` : ""}${d.finish_dia ? ` · ${d.finish_dia}` : ""}`}
                        value={d.req_kgs}
                        onChange={(e) => onDia(d.key, { req_kgs: e.target.value })}
                      />
                    </div>,
                    <div key={`${d.key}:gross`} className={cn(CELL, "flex items-center justify-end px-3 text-sm tabular-nums text-muted-foreground")}>
                      {g != null && g > 0 ? kg(g) : "—"}
                    </div>,
                    <div key={`${d.key}:x`} className={cn(CELL, "flex items-center justify-center px-0")}>
                      {removable && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          data-row-remove
                          className="h-8 w-8 px-0 text-muted-foreground"
                          aria-label={onlyDia ? `Remove ${b.color_name || "this colour"}` : `Remove dia${d.finish_dia ? ` ${d.finish_dia}` : ""}`}
                          onClick={() => (onlyDia ? onRemoveColour(b.grp) : onRemoveDia(d.key, b.grp))}
                        >
                          <X aria-hidden className="h-4 w-4" />
                        </Button>
                      )}
                    </div>,
                  ];
                }),

                /* "+ ADD DIA" — the colour's last row, across the dia columns. */
                <div key={`${b.grp}:add`} className={cn(CELL, "col-span-4 py-1")}>
                  <Button type="button" variant="ghost" size="sm" data-row-add className="text-primary" onClick={() => onAddDia(b.grp)}>
                    + Add dia{b.color_name ? ` under ${b.color_name}` : ""}
                  </Button>
                </div>,
              ];
            })}

            {/* THE FABRIC TOTAL — the figure the row on the screen shows. */}
            <div className={cn(HEAD, "col-span-2 text-right normal-case tracking-normal text-foreground")}>Fabric total</div>
            <div className={cn(HEAD, "text-right text-sm normal-case tabular-nums tracking-normal text-foreground")}>{kg(total)}</div>
            <div className={cn(HEAD, "text-right text-sm normal-case tabular-nums tracking-normal text-foreground")}>{totalGross > 0 ? kg(totalGross) : "—"}</div>
            <div className={HEAD} aria-hidden />
          </div>
        </div>
        {!greige && (
          <Button type="button" variant="outline" data-row-add onClick={onAddColour}>
            + Add colour
          </Button>
        )}
      </div>
    </SubDetailSheet>
  );
}
