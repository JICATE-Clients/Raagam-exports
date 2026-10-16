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
 * COLOURS IN A SIDE RAIL (user 2026-10-15, screenshots 3533 / 3535). The
 * 2026-10-12 cut was one table with the Colour cell spanning its dia rows;
 * with three or four colours it ran past the popup and a colour's red boxes
 * scrolled out of sight. Now the colours are a rail — name, subtotal, and a
 * red "n owed" while anything under it is blank — and the pane beside it holds
 * ONLY the picked colour's dias, in one headed table at fixed column widths.
 * The colour is named once, in the rail: a new colour's picker sits in its
 * rail item until a colour is chosen, and the pane carries no Colour field of
 * its own ("one color field is enough").
 *
 * A RAIL MUST NOT HIDE WHAT IS OWED. A blank box under a colour you are not
 * looking at is a Done that refuses with nothing on screen to say why — so
 * every rail item counts its own blanks, and Done, while held, carries the
 * operator to the first colour that still owes something (`onBlocked`).
 *
 * TAB WALKS ON THROUGH THE COLOURS. The pane holds one colour's fields, so Tab
 * off its last field opens the next colour (Shift+Tab, the previous colour's
 * last field) through `registerContentEdge` — the same hand-off the section
 * rail of a `MasterFullScreen` publishes, registered on this sheet's dialog
 * element because that is the scope `lib/focus.ts` walks up from inside a
 * Sheet. Off the last colour it declines, and Tab wraps as on any overlay.
 *
 * WHAT IS OWED IS SHOWN ON THE BOX, NOT LISTED IN A SENTENCE. Each control
 * carries `required`, so a blank one wears `data-required-empty` (the cursor
 * hold's marker) and the red ring below; the footer only counts what is left.
 *
 * NO SAVE OF ITS OWN, like Style ▸ Process and the Shades popup: the Fabric
 * Plan's Save writes these rows, so the footer is `SubSheetFooter` (Done),
 * held — with the count — while something is still blank.
 *
 * GREIGE HAS NO COLOUR (`lines.ts`): one block of dias, no rail and no
 * "+ Add colour". A PRINT-stage fabric asks a Print above the picked colour's
 * dias.
 */

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import type { SheetOrigin } from "@/components/ui/sheet";
import { Truncated } from "@/components/ui/truncated";
import { SubDetailSheet } from "@/components/orders/sub-detail-sheet";
import { cn } from "@/lib/utils";
import { focusFirstField, focusLastField, registerContentEdge } from "@/lib/focus";
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

/** Rail 12rem + 1rem gap | Finish Dia 8rem · Req Wt 8rem · Gross Yarn 7rem ·
 *  ✕ 2.5rem = 38.5rem; the sheet is capped at 2xl (42rem) around it. */
const COLS = "grid-cols-[8rem_8rem_7rem_2.5rem]";
const HEAD = "bg-surface-muted px-3 py-2 text-[10.5px] font-semibold uppercase tracking-[.06em] text-muted-foreground";
const TOTAL = "bg-surface-muted px-3 py-2 text-sm font-semibold tabular-nums text-foreground";
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

type Landing = "first" | "last" | "pick";

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
  /** Adds a colour and returns its `grp`, so the rail can open it. */
  onAddColour: () => string;
  onRemoveColour: (grp: string) => void;
}) {
  const subtotal = (b: SmpColourBlock) => b.dias.reduce((a, d) => a + (num(d.req_kgs) || 0), 0);
  const grossIn = (b: SmpColourBlock) => b.dias.reduce((a, d) => a + (grossOf(num(d.req_kgs), b.color_name) ?? 0), 0);
  const total = blocks.reduce((a, b) => a + subtotal(b), 0);
  const totalGross = blocks.reduce((a, b) => a + grossIn(b), 0);

  /* WHAT DONE WAITS FOR — counted, not listed; the boxes themselves are red. */
  const askPrint = withPrint && !greige;
  const owedIn = (b: SmpColourBlock) =>
    (greige || b.color_name.trim() ? 0 : 1) +
    (askPrint && !b.print_name.trim() ? 1 : 0) +
    b.dias.reduce((a, d) => a + (greige || d.finish_dia.trim() ? 0 : 1) + ((num(d.req_kgs) ?? 0) > 0 ? 0 : 1), 0);
  const noWeight = blocks.reduce((a, b) => a + b.dias.filter((d) => !((num(d.req_kgs) ?? 0) > 0)).length, 0);
  const noDia = greige ? 0 : blocks.reduce((a, b) => a + b.dias.filter((d) => !d.finish_dia.trim()).length, 0);
  const noColour = greige ? 0 : blocks.filter((b) => !b.color_name.trim()).length;
  const noPrint = askPrint ? blocks.filter((b) => !b.print_name.trim()).length : 0;
  const owed = [
    noColour && plural(noColour, "colour"),
    noPrint && plural(noPrint, "print"),
    noDia && plural(noDia, "Finish Dia", "Finish Dias"),
    noWeight && plural(noWeight, "weight"),
  ].filter(Boolean);
  const blockedReason = owed.length ? `Still needed: ${owed.join(", ")} — fill the red boxes, or remove those lines.` : null;

  const canRemoveColour = !greige && blocks.length > 1;

  /* THE PICKED COLOUR, held by `grp`. One that is gone (removed) falls back to
     the first, so the pane is never empty while a colour exists. */
  const [picked, setPicked] = useState<string | null>(null);
  const curIdx = Math.max(0, blocks.findIndex((b) => b.grp === picked));
  const cur = blocks[curIdx] ?? null;

  /* Where the cursor goes once a newly picked colour has rendered: "first"
     arriving forward, "last" arriving back, "pick" for a new colour's rail
     picker. A colour with no name yet is always entered at its picker. */
  const landing = useRef<Landing | null>(null);
  const railRef = useRef<HTMLDivElement>(null);
  const paneRef = useRef<HTMLDivElement>(null);
  const go = (grp: string, land: Landing | null) => {
    landing.current = land;
    setPicked(grp);
  };
  useLayoutEffect(() => {
    const land = landing.current;
    if (!land || !cur) return;
    landing.current = null;
    const pick = railRef.current?.querySelector<HTMLElement>(`[data-colour-item="${cur.grp}"] select`);
    if (pick && (land === "pick" || !cur.color_name.trim())) pick.focus();
    else if (land === "last") focusLastField(paneRef.current);
    else focusFirstField(paneRef.current);
  });

  /* Tab / Enter off the pane's last field opens the next colour. The callback
     is registered once per open, so it reads the live list through refs. */
  const blocksRef = useRef(blocks);
  const curIdxRef = useRef(curIdx);
  useEffect(() => {
    blocksRef.current = blocks;
    curIdxRef.current = curIdx;
  });
  useEffect(() => {
    if (!open || greige) return;
    const dialog = paneRef.current?.closest<HTMLElement>('[role="dialog"]') ?? null;
    return registerContentEdge(dialog, (dir) => {
      const next = blocksRef.current[curIdxRef.current + dir];
      if (!next) return false;
      landing.current = dir === 1 ? "first" : "last";
      setPicked(next.grp);
      return true;
    });
  }, [open, greige]);

  /* Done, while held, takes the operator to the first colour that owes. */
  const toFirstOwed = () => {
    const b = blocks.find((x) => owedIn(x) > 0);
    if (b) go(b.grp, "first");
  };

  const pane = cur && (
    <div ref={paneRef} className="min-w-0 space-y-2">
      {askPrint && (
        <div className="w-48 space-y-1">
          <div className="text-xs font-medium text-muted-foreground">Print{cur.color_name ? ` — ${cur.color_name}` : ""}</div>
          <PanelSelect label="Print" required value={cur.print_name} options={prints} keyOf={comboKey} onPick={(v) => onPrint(cur.grp, v)} />
        </div>
      )}
      {/* The picked colour's dias. Scrolls sideways inside the pane on a phone
          rather than folding. */}
      <div className="overflow-x-auto">
        <div
          className={cn(
            "grid w-fit gap-px overflow-hidden rounded-control border bg-border",
            COLS,
            "[&_[data-required-empty]]:ring-1 [&_[data-required-empty]]:ring-danger",
          )}
        >
          <div className={HEAD}>Finish Dia</div>
          <div className={cn(HEAD, "text-right")}>Req Wt (kgs)</div>
          <div className={cn(HEAD, "text-right")}>Gross Yarn</div>
          <div className={HEAD} aria-hidden />

          {cur.dias.flatMap((d) => {
            const w = num(d.req_kgs);
            const g = grossOf(w, cur.color_name);
            const onlyDia = cur.dias.length === 1;
            // A colour's only dia: its ✕ takes the colour with it, when there
            // is another colour to keep; otherwise there is nothing to remove.
            const removable = !onlyDia || canRemoveColour;
            return [
              <div key={`${d.key}:dia`} className={CELL}>
                <PanelSelect
                  label={`Finish Dia${cur.color_name ? ` — ${cur.color_name}` : ""}`}
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
                  aria-label={`Req Wt (kgs)${cur.color_name ? ` — ${cur.color_name}` : ""}${d.finish_dia ? ` · ${d.finish_dia}` : ""}`}
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
                    aria-label={onlyDia ? `Remove ${cur.color_name || "this colour"}` : `Remove dia${d.finish_dia ? ` ${d.finish_dia}` : ""}`}
                    onClick={() => (onlyDia ? onRemoveColour(cur.grp) : onRemoveDia(d.key, cur.grp))}
                  >
                    <X aria-hidden className="h-4 w-4" />
                  </Button>
                )}
              </div>,
            ];
          })}

          {/* The colour's subtotal closes its table. */}
          <div className={cn(TOTAL, "font-medium")}>{greige ? "Greige" : cur.color_name || "New colour"} subtotal</div>
          <div className={cn(TOTAL, "text-right")}>{kg(subtotal(cur))}</div>
          <div className={cn(TOTAL, "text-right")}>{grossIn(cur) > 0 ? kg(grossIn(cur)) : "—"}</div>
          <div className={TOTAL} aria-hidden />
        </div>
      </div>
      <Button type="button" variant="ghost" size="sm" data-row-add className="text-primary" onClick={() => onAddDia(cur.grp)}>
        + Add dia{cur.color_name ? ` under ${cur.color_name}` : ""}
      </Button>
    </div>
  );

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
      onBlocked={toFirstOwed}
    >
      <div className="space-y-3">
        {dias.length === 0 && <p className="text-sm text-warning">{diaHint}</p>}
        {greige ? (
          pane
        ) : (
          <div className="grid gap-4 sm:grid-cols-[12rem_minmax(0,1fr)]">
            {/* THE RAIL — every colour once, with what it still owes. A row of
                chips on a phone, a column beside the pane from `sm` up. */}
            <div
              ref={railRef}
              aria-label="Colours"
              className="flex gap-1 overflow-x-auto rounded-control bg-surface-muted p-1.5 sm:flex-col sm:self-start sm:overflow-visible"
            >
              {blocks.map((b) => {
                const o = owedIn(b);
                const on = b.grp === cur?.grp;
                const named = !!b.color_name.trim();
                const notDeclared = named && !colours.some((c) => comboKey(c) === comboKey(b.color_name));
                return (
                  <div
                    key={b.grp}
                    data-colour-item={b.grp}
                    // Focus arriving in an item (its picker, its ✕) opens it.
                    onFocus={() => {
                      if (!on) setPicked(b.grp);
                    }}
                    className={cn(
                      "relative flex min-w-[9rem] shrink-0 items-start gap-2 rounded-control border p-2",
                      on ? "border-primary bg-surface" : "border-transparent hover:bg-surface",
                    )}
                  >
                    <span aria-hidden className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", o ? "bg-danger" : "bg-success")} />
                    {/* TWO LINES, EACH WITH ONE THING ON ITS RIGHT (user 2026-10-15,
                        screenshot 3536: the ✓ / ✕ crowded the item and the active
                        colour's name showed half). The name line carries only the
                        ✕; the status (✓ / "n owed") rides the kg line, so the name
                        no longer shares its width with a badge AND a button. */}
                    <div className="min-w-0 flex-1 space-y-0.5">
                      <div className="flex items-center gap-1">
                      <div className="min-w-0 flex-1">
                      {named ? (
                        // The whole item is the click target (`after:inset-0`);
                        // the ✕ sits above it.
                        <button
                          type="button"
                          aria-current={on || undefined}
                          title={notDeclared ? `${b.color_name} is not declared on this fabric's colour panel` : undefined}
                          className={cn(
                            "block w-full text-left text-sm font-semibold after:absolute after:inset-0 after:rounded-control focus-visible:after:ring-2 focus-visible:after:ring-primary focus-visible:outline-none",
                            notDeclared && "text-danger",
                          )}
                          onClick={() => go(b.grp, null)}
                        >
                          <Truncated>{b.color_name}</Truncated>
                        </button>
                      ) : (
                        <PanelSelect
                          label="Colour"
                          required
                          value=""
                          // A colour already in the rail is not offered again.
                          options={colours.filter((c) => !blocks.some((x) => comboKey(x.color_name) === comboKey(c)))}
                          keyOf={comboKey}
                          // The picker becomes the colour's name, so the
                          // cursor moves on to its first dia.
                          onPick={(v) => {
                            onColour(b.grp, v);
                            if (v) go(b.grp, "first");
                          }}
                        />
                      )}
                      </div>
                      {on && canRemoveColour && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          data-row-remove
                          className="relative z-10 h-6 w-6 shrink-0 px-0 text-muted-foreground"
                          aria-label={`Remove ${b.color_name || "this colour"} and its dias`}
                          title="Remove this colour and its dias"
                          onClick={() => onRemoveColour(b.grp)}
                        >
                          <X aria-hidden className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs tabular-nums text-muted-foreground">{kg(subtotal(b))} kg</span>
                        {o ? (
                          <span className="whitespace-nowrap rounded-full bg-danger/10 px-1.5 text-[11px] font-semibold text-danger">{o} owed</span>
                        ) : (
                          <span className="text-xs font-semibold text-success" aria-label="Complete">
                            ✓
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                data-row-add
                className="shrink-0 justify-start text-primary"
                onClick={() => go(onAddColour(), "pick")}
              >
                + Add colour
              </Button>
            </div>
            {pane}
          </div>
        )}
        {/* THE FABRIC TOTAL — the figure the row on the screen shows. */}
        <div className="flex flex-wrap justify-end gap-x-4 text-xs text-muted-foreground">
          <span>
            Fabric total <span className="font-semibold tabular-nums text-foreground">{kg(total)}</span> kg
          </span>
          <span>
            Gross yarn <span className="font-semibold tabular-nums text-foreground">{totalGross > 0 ? kg(totalGross) : "—"}</span> kg
          </span>
        </div>
      </div>
    </SubDetailSheet>
  );
}
