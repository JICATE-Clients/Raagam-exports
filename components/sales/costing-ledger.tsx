"use client";

/**
 * SAMPLE COSTING — THE LEDGER (user 2026-10-17, artifact "Sample Costing —
 * Single-Screen Entry", Option 3). A TEST DUPLICATE of the cost entry, served at
 * /sales/sample-costing/ledger beside the real screen, which is untouched: "build
 * as a duplicate … if it is okay we can replace the current screen".
 *
 * THE SHAPE — a bill read top to bottom:
 *   Details (always open)
 *   1 Fabric            Component consumption, then Fabric processing cost
 *   2 CMT & garment processes
 *   3 Trims
 *   4 Other costs & overheads
 *   5 Margin & terms
 *   6 Quote to the buyer (always open — it is the answer)
 * Each section is a header row (summary + status) over its body, with its own
 * figure on a right-hand SPINE, so the price builds down the page while it is
 * typed. ONE SECTION OPEN AT A TIME (`useAccordion`, AGENTS "Folds are
 * accordions"): the cursor arriving in a section opens it and folds the last.
 *
 * WHAT IS NOT NEW: the data. This component edits the same `CostingDraft` the
 * Cost Sheet tabs edit, through the same `onChange`, with the same row
 * factories (`revision-draft.ts`) and the same rules — the fabric is chosen in
 * Component consumption (`pickLineFabric`, copied from cost-sheet-document.tsx),
 * a picked operation pre-fills a blank rate from the master, a trim is Direct
 * Rate or No of Items ÷ No of Pcs at a pack Rate. Every figure is read from the
 * model and `summaryOf` — nothing here prices anything. Labels are the current
 * screen's words (user 2026-10-17: "see our current screen first for labeling").
 *
 * KEYBOARD IS THE APP CONTRACT: Enter / Tab / arrows / Ctrl+Del come from
 * lib/focus.ts and `gridKeyNav`; each section header is a Tab stop
 * (`data-row-open`) so tabbing off a section's last field opens the next.
 */

import { useState, type ComponentType, type ReactNode } from "react";
import { ChevronDown, Layers, Receipt, Scissors, Tag, TrendingUp, Building2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Truncated } from "@/components/ui/truncated";
import { Button } from "@/components/ui/button";
import { Toggle } from "@/components/ui/toggle";
import { Segmented } from "@/components/ui/segmented";
import { MultiSelect } from "@/components/ui/multi-select";
import { RowHoverRemove } from "@/components/ui/row-hover-remove";
import { gridKeyNav } from "@/components/masters/child-grid";
import { TypeOrPick } from "@/app/(app)/orders/_garment-order/type-or-pick";
import { useAccordion } from "@/lib/ui/use-accordion";
import { cn } from "@/lib/utils";
import type { CostSheetEdit } from "@/components/sales/cost-sheet-document";
import { FLOOR_PCT, fx, type CostSheetModel } from "@/lib/sales/sample-costing/cost-sheet";
import { MARGIN_TARGET_PCT, dimensionalGrams, hasYarnMix, num, quoteKey, sizesOf, trimCostPerPiece, yarnMixTotal } from "@/lib/sales/sample-costing/calc";
import { newExtra, newFabric, newFabricProcess, newPieceLine, newTrim, newWeightRows, newYarnMix } from "@/lib/sales/sample-costing/revision-draft";
import {
  costingFieldId,
  isBlankFabric,
  summaryOf,
  type CostingProblem,
  type FabricDraft,
  type FabricProcessDraft,
  type PieceDraft,
  type TrimDraft,
  type WeightDraft,
  type YarnMixDraft,
} from "@/lib/sales/sample-costing/types";

type SecKey = "fabric" | "making" | "trims" | "oh" | "terms";
const ORDER: SecKey[] = ["fabric", "making", "trims", "oh", "terms"];

/* Each section's colour is an app TOKEN, so the skin, the colour presets and dark mode
   carry it: titles in the tone, the open body on its soft tint. */
const TONE: Record<SecKey | "quote", { icon: string; tint: string; title: string }> = {
  fabric: { icon: "bg-info-soft text-info", tint: "bg-info-soft/35", title: "text-info" },
  making: { icon: "bg-success-soft text-success", tint: "bg-success-soft/35", title: "text-success" },
  trims: { icon: "bg-warning-soft text-warning", tint: "bg-warning-soft/35", title: "text-warning" },
  oh: { icon: "bg-accent-soft text-accent", tint: "bg-accent-soft/35", title: "text-accent" },
  terms: { icon: "bg-primary-soft text-primary", tint: "bg-primary-soft/35", title: "text-primary" },
  quote: { icon: "bg-foreground text-surface", tint: "", title: "text-foreground" },
};

const patchBy = <T extends { key: string }>(xs: readonly T[], key: string, patch: Partial<T>): T[] => xs.map((x) => (x.key === key ? { ...x, ...patch } : x));
const money = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? "—" : v.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

/* ---- the table: one bordered grid, every input fills its own cell ---------------- */
const TB = "w-full border-separate border-spacing-0 overflow-hidden rounded-lg border border-border bg-surface text-sm";
const TH = "border-b border-r border-border bg-surface-muted px-2.5 py-2 text-left text-xs font-semibold whitespace-nowrap last:border-r-0";
const TD = "border-b border-r border-border p-0 align-middle last:border-r-0";
const TDV = "border-b border-r border-border px-2.5 align-middle text-right font-mono tabular-nums whitespace-nowrap last:border-r-0";
const CELL = "h-9 w-full rounded-none border-0 bg-transparent px-2.5 shadow-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary";
const FOOT = "bg-surface-muted px-2.5 py-1.5 align-middle";
const LABEL = "mb-1.5 block text-xs font-semibold";

/** A number box: selects on focus so typing replaces, like Excel. */
function Num({ value, onChange, label, id, className, cell }: { value: string; onChange: (v: string) => void; label: string; id?: string; className?: string; cell?: boolean }) {
  return (
    <Input
      id={id}
      type="number"
      inputMode="decimal"
      step="any"
      min={0}
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onFocus={(e) => e.currentTarget.select()}
      className={cn("text-right font-mono tabular-nums", cell && CELL, className)}
    />
  );
}

/** A grams cell. Typing `40x7x220` (length × width × GSM) turns into the grams when the
 *  cell is left; the corner mark keeps the formula, shown on hover — never a second number
 *  in the cell (user 2026-10-17: "why this is showing this duplicated value"). */
const DIMS = /^\s*(\d+(?:\.\d+)?)\s*[x×*]\s*(\d+(?:\.\d+)?)\s*[x×*]\s*(\d+(?:\.\d+)?)\s*$/i;
function GramCell({ w, label, onPatch }: { w: WeightDraft; label: string; onPatch: (p: Partial<WeightDraft>) => void }) {
  const [typing, setTyping] = useState<string | null>(null);
  const dimG = !w.weight_g.trim() ? dimensionalGrams(w) : null;
  const shown = typing ?? (dimG != null ? dimG.toFixed(2) : w.weight_g);
  return (
    <span className="relative block" title={dimG != null ? `Worked out from ${w.length_cm} × ${w.width_cm} × ${w.gsm} ÷ 10000` : undefined}>
      {/* caps-input: exempt -- a figure or L x W x GSM, nothing to capitalise */}
      <Input
        id={costingFieldId.weightGrams(w.key)}
        uppercase={false}
        inputMode="decimal"
        aria-label={label}
        value={shown}
        onFocus={(e) => {
          setTyping(dimG != null ? `${w.length_cm}x${w.width_cm}x${w.gsm}` : w.weight_g);
          e.currentTarget.select();
        }}
        onChange={(e) => {
          const v = e.target.value;
          setTyping(v);
          // A plain number prices on the keystroke; a formula waits for the cell to be left.
          if (v.trim() === "" || Number.isFinite(Number(v))) onPatch({ weight_g: v, length_cm: "", width_cm: "", gsm: "" });
        }}
        onBlur={() => {
          const m = typing ? DIMS.exec(typing) : null;
          if (m) onPatch({ weight_g: "", length_cm: m[1], width_cm: m[2], gsm: m[3] });
          setTyping(null);
        }}
        className={cn(CELL, "text-right font-mono tabular-nums", !shown.trim() && "bg-warning-soft/60")}
      />
      {dimG != null ? <span aria-hidden className="pointer-events-none absolute right-0 top-0 h-0 w-0 border-l-[9px] border-t-[9px] border-l-transparent border-t-primary" /> : null}
    </span>
  );
}

/** A row's ✕ — the app's hover ✕ (Ctrl+Del-able, off the Tab path). */
const RemoveX = ({ label, onClick }: { label: string; onClick: () => void }) => <RowHoverRemove label={`Remove ${label}`} onClick={onClick} />;

/** The "+ Add …" under a table: a grid's add control (`data-row-add`, AGENTS "Tab lands on fields"). */
const AddBtn = ({ label, onClick }: { label: string; onClick: () => void }) => (
  <Button type="button" variant="ghost" size="sm" data-row-add onClick={onClick} className="text-primary">
    + {label}
  </Button>
);

/** One section: header row over its body, its figure on the spine. */
function Section({
  k,
  n,
  title,
  icon: Icon,
  summary,
  todo,
  open,
  onToggle,
  focus,
  spine,
  children,
}: {
  k: SecKey;
  n: number;
  title: string;
  icon: ComponentType<{ className?: string }>;
  summary: string;
  todo: number;
  open: boolean;
  onToggle: () => void;
  focus: { onFocus: () => void };
  spine: ReactNode;
  children: ReactNode;
}) {
  const t = TONE[k];
  return (
    <section data-sec={k} aria-label={title} className="grid grid-cols-1 border-t border-border md:grid-cols-[minmax(0,1fr)_13rem]" {...focus}>
      <div className={cn("min-w-0", open && t.tint)}>
        <button
          type="button"
          data-row-open
          aria-expanded={open}
          onClick={onToggle}
          className={cn("flex min-h-16 w-full items-center gap-3.5 px-5 py-3 text-left hover:bg-surface-muted/60 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary", open && "border-b border-border")}
        >
          <span className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-lg", t.icon)}>
            <Icon className="h-[18px] w-[18px]" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-bold text-heading">
              {n} · {title}
            </span>
            <Truncated text={summary} className="block text-xs text-muted-foreground" />
          </span>
          <span className={cn("shrink-0 rounded-full px-2.5 py-0.5 text-xs font-bold", todo ? "bg-warning-soft text-warning" : "bg-success-soft text-success")}>
            {todo ? `${todo} to fill` : "✓ Done"}
          </span>
          <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} aria-hidden />
        </button>
        {open ? <div className="flex flex-col gap-4 px-5 pb-5 pt-4">{children}</div> : null}
      </div>
      <div className="flex flex-col gap-0.5 border-t border-dashed border-border bg-surface-muted px-5 py-4 md:border-l md:border-t-0 md:border-solid">{spine}</div>
    </section>
  );
}

const Spine = ({ cap, value, sub }: { cap: string; value: string; sub?: string }) => (
  <>
    <span className="text-[11px] font-bold uppercase tracking-[.09em] text-muted-foreground">{cap}</span>
    <span className="font-mono text-xl font-bold tabular-nums text-heading">{value}</span>
    {sub ? <span className="font-mono text-xs tabular-nums text-muted-foreground">{sub}</span> : null}
  </>
);

const marginTone = (m: number | null) => (m == null ? "bg-surface-muted text-muted-foreground" : m < FLOOR_PCT ? "bg-danger-soft text-danger" : m < MARGIN_TARGET_PCT ? "bg-warning-soft text-warning" : "bg-success-soft text-success");

export function CostingLedger({ model, edit, problems }: { model: CostSheetModel; edit: CostSheetEdit; problems: CostingProblem[] }) {
  const d = edit.draft;
  const opts = edit.options;
  const s = model.sizes[0];
  const ccy = model.currency ?? "";
  const set = edit.onChange;
  const acc = useAccordion("fabric");
  const fabFold = useAccordion(d.fabrics.find((x) => x.fabric_id || x.quality.trim())?.key ?? null);
  const multi = d.pieces.length > 1;
  const pieceName = (key: string) => d.pieces.find((p) => p.key === key)?.piece_name || "GARMENT";
  const setFabric = (key: string, patch: Partial<FabricDraft>) => set({ ...d, fabrics: patchBy(d.fabrics, key, patch) });
  const setPiece = (key: string, patch: Partial<PieceDraft>) => set({ ...d, pieces: patchBy(d.pieces, key, patch) });
  const setHeader = (patch: Partial<typeof d.header>) => set({ ...d, header: { ...d.header, ...patch } });

  /* ---- where each problem lives — the status chips and "show me" read this ----- */
  const secOf = (p: CostingProblem): SecKey | "info" | "quote" =>
    p.section === "info"
      ? "info"
      : p.section === "fabrics" || p.section === "consumption"
        ? "fabric"
        : p.section === "cmt"
          ? "making"
          : p.section === "trims"
            ? "trims"
            : p.fieldId?.startsWith("sc-x-")
              ? "oh"
              : "terms";
  const todo = (k: SecKey) => problems.filter((p) => secOf(p) === k).length;
  const showMe = () => {
    const p = problems[0];
    if (!p) return;
    const k = secOf(p);
    if (k !== "info" && k !== "quote") acc.setOpenKey(k);
    const fab = p.fieldId?.match(/^sc-fab-(?:yarn-|direct-|mix-)?(.+)$/)?.[1];
    if (fab) fabFold.setOpenKey(fab);
    // After the section has rendered open.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const el = (p.fieldId && document.getElementById(p.fieldId)) || document.querySelector<HTMLElement>(`[data-sec="${k}"] input`);
        el?.focus();
        el?.scrollIntoView({ block: "center", behavior: "smooth" });
      }),
    );
  };

  /* ==== 1 · FABRIC ================================================================ */
  const weightRows = model.weights.editRows;
  const setLine = (r: (typeof weightRows)[number], patch: { piece_key?: string; component_ids?: string[]; fabric_key?: string }) =>
    set({ ...d, weights: d.weights.map((x) => (r.wkeys.includes(x.key) ? { ...x, ...patch } : x)) });
  const fabricChoices = opts
    ? [...opts.fabrics.map((o) => ({ id: o.id, name: o.name })), ...d.fabrics.filter((x) => !x.fabric_id && x.quality.trim()).map((x) => ({ id: `q:${x.key}`, name: x.quality }))]
    : [];
  /* THE FABRIC IS CHOSEN IN COMPONENT CONSUMPTION — cost-sheet-document.tsx's
     `pickLineFabric`, rule for rule (a typed name renames its own fabric instead of
     adding one per keystroke; a structure new to the sheet becomes a fabric card,
     filled from the entry's rate memory through `pickFabric`). */
  const pickLineFabric = (r: (typeof weightRows)[number], v: { id: string | null; name: string }) => {
    if (!v.id && !v.name.trim()) return;
    const cur = d.fabrics.find((x) => x.key === r.fabricKey);
    const ownTyped = !!cur && !cur.fabric_id && d.weights.every((x) => x.fabric_key !== cur.key || r.wkeys.includes(x.key));
    const nameOnly = ownTyped && v.id !== `q:${cur.key}` && isBlankFabric({ ...cur, quality: "" });
    const typedName = v.name.trim().toUpperCase();
    const sameName = (x: FabricDraft) => !x.fabric_id && x.quality.trim().toUpperCase() === typedName;
    if (!v.id && ownTyped && !d.fabrics.some((x) => x.key !== cur.key && sameName(x))) {
      set({ ...d, fabrics: d.fabrics.map((x) => (x.key === cur.key ? { ...x, quality: v.name } : x)) });
      return;
    }
    const fabrics = nameOnly ? d.fabrics.filter((x) => x.key !== cur!.key) : d.fabrics;
    let target = v.id?.startsWith("q:")
      ? fabrics.find((x) => `q:${x.key}` === v.id)
      : fabrics.find((x) => (v.id ? x.fabric_id === v.id : !x.fabric_id && x.quality.trim().toUpperCase() === typedName));
    let next = fabrics;
    if (!target) {
      const blank = fabrics.find((x) => !x.fabric_id && !x.quality.trim());
      const base: FabricDraft = { ...(blank ?? { ...newFabric(), processes: [] }), is_direct: false };
      const named: FabricDraft = { ...base, ...(edit.pickFabric ? edit.pickFabric(base, v) : { fabric_id: v.id, quality: v.name }) };
      target = named;
      next = blank ? fabrics.map((x) => (x.key === blank.key ? named : x)) : [...fabrics, named];
    }
    const key = target.key;
    set({ ...d, fabrics: next, weights: d.weights.map((x) => (r.wkeys.includes(x.key) ? { ...x, fabric_key: key } : x)) });
    fabFold.setOpenKey(key);
  };
  const addWeightLine = () => {
    const open = weightRows.findIndex((r) => r.componentIds.length === 0 && !r.fabricKey);
    if (open >= 0) {
      document.querySelectorAll<HTMLElement>('[aria-label="Component consumption"] tbody tr[data-grid-row]')[open]?.querySelector<HTMLElement>("input")?.focus();
      return;
    }
    set({ ...d, weights: [...d.weights, ...newWeightRows(d.pieces[0]?.key ?? "", [], null, sizesOf(d.weights))] });
  };
  const sizeWise = model.weights.sizeLabels.length > 1;
  const noWeightCol = !!edit.sizeWise && !sizeWise && model.weights.sizeLabels[0] === "All sizes";
  const sizeCols = noWeightCol ? [] : model.weights.sizeLabels;
  const weightHead = (l: string) => (l === "All sizes" ? "Avg Pcs Wgt" : l);
  const avgOf = (xs: readonly (number | null)[]) => (xs.length ? xs.reduce<number>((t, x) => t + (x ?? 0), 0) / xs.length : 0);

  const shownFabrics = d.fabrics.filter((x) => x.fabric_id || x.quality.trim());
  const heldFab = fabFold.openKey;
  const openFab = heldFab !== null && !shownFabrics.some((x) => x.key === heldFab) ? (shownFabrics[0]?.key ?? null) : heldFab;
  const figOf = (f: FabricDraft) => model.fabrics.find((x) => x.key === f.key);

  const consumption = (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className={cn("text-[11px] font-bold uppercase tracking-[.09em]", TONE.fabric.title)}>Component consumption</span>
        <span className="text-xs text-muted-foreground">
          grams · or type <b className="font-mono text-foreground">L x W x GSM</b> — it becomes grams when you leave the cell (<span className="text-primary">◥</span> = worked out)
        </span>
      </div>
      {edit.sizes}
      <div className="max-w-full overflow-x-auto">
        <table className={TB} aria-label="Component consumption">
          <thead className={TONE.fabric.title}>
            <tr>
              {multi ? <th className={cn(TH, "w-32")}>Piece</th> : null}
              <th className={cn(TH, "min-w-56")}>Component</th>
              <th className={cn(TH, "w-56")}>Fabric</th>
              {sizeCols.map((l) => (
                <th key={l} className={cn(TH, "w-24 text-right")}>{weightHead(l)}</th>
              ))}
              {sizeWise ? <th className={cn(TH, "w-28 text-right")} title="the sizes' grams over the size count">Avg PCS Wgt</th> : null}
              <th className={cn(TH, "w-10")}><span className="sr-only">Remove</span></th>
            </tr>
          </thead>
          <tbody data-grid-body onKeyDown={gridKeyNav}>
            {weightRows.map((r, i) => (
              <tr key={r.wkeys[0] ?? i} data-grid-row>
                {multi ? (
                  <td className={TD}>
                    <TypeOrPick label="Piece" options={d.pieces.map((p) => ({ id: p.key, name: p.piece_name || "GARMENT" }))} valueId={r.pieceKey} text={pieceName(r.pieceKey)} onChange={(v) => v.id && setLine(r, { piece_key: v.id })} uppercase inputClassName={CELL} />
                  </td>
                ) : null}
                <td className={TD}>
                  {opts ? (
                    <MultiSelect
                      compact
                      label="Components"
                      hideChips
                      summarizeLabels
                      summaryNoun="components"
                      inputClassName={CELL}
                      panelClassName="min-w-64"
                      options={opts.components.map((o) => ({ id: o.id, label: o.name }))}
                      values={r.componentIds}
                      onChange={(ids) => ids.length && setLine(r, { component_ids: ids })}
                    />
                  ) : (
                    <span className="px-2.5">{r.component}</span>
                  )}
                </td>
                <td className={TD}>
                  <TypeOrPick
                    label="Fabric"
                    id={r.wkeys[0] ? costingFieldId.weightFabric(r.wkeys[0]) : undefined}
                    options={fabricChoices.filter((o) => o.id !== `q:${r.fabricKey}`)}
                    valueId={(() => {
                      const cur = d.fabrics.find((x) => x.key === r.fabricKey);
                      return cur ? (cur.fabric_id ?? `q:${cur.key}`) : null;
                    })()}
                    text={r.fabric}
                    onChange={(v) => pickLineFabric(r, v.id ? v : { id: fabricChoices.find((o) => o.name.toUpperCase() === v.name.trim().toUpperCase())?.id ?? null, name: v.name })}
                    placeholder="Pick a fabric"
                    uppercase
                    inputClassName={CELL}
                  />
                </td>
                {sizeCols.map((l, j) => {
                  const cell = r.cells[j];
                  const w = cell ? d.weights.find((x) => x.key === cell.key) : undefined;
                  return (
                    <td key={l} className={TD}>
                      {w ? <GramCell w={w} label={`${r.component || "component"} ${weightHead(l)} — grams`} onPatch={(p) => set({ ...d, weights: patchBy(d.weights, w.key, p) })} /> : null}
                    </td>
                  );
                })}
                {sizeWise ? <td className={cn(TDV, "bg-info-soft/30 text-muted-foreground")}>{r.grams.some((g) => g != null) ? fx(avgOf(r.grams)) : ""}</td> : null}
                <td className={cn(TD, "text-center")}>
                  {r.wkeys.length && weightRows.length > 1 ? <RemoveX label={r.component || "line"} onClick={() => set({ ...d, weights: d.weights.filter((x) => !r.wkeys.includes(x.key)) })} /> : null}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td className={FOOT} colSpan={multi ? 2 : 1}>
                <AddBtn label="Add row" onClick={addWeightLine} />
              </td>
              <td className={cn(FOOT, "text-right text-xs font-bold", TONE.fabric.title)}>Fabric cost ₹ / {model.unitWord}</td>
              {sizeCols.map((l, j) => (
                <td key={l} className={cn(FOOT, "text-right font-mono text-[13px] font-semibold tabular-nums")}>{money(model.weights.fabricBySize[j])}</td>
              ))}
              {sizeWise ? <td className={cn(FOOT, "text-right font-mono text-[13px] font-bold tabular-nums")} title="Avg Piece Rate / PCS — carried to every other section">{money(s.fabric)}</td> : null}
              <td className={FOOT} />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );

  const fabricCards = (
    <div className="flex flex-col gap-2">
      <span className={cn("text-[11px] font-bold uppercase tracking-[.09em]", TONE.fabric.title)}>
        Fabric processing cost <span className="font-medium normal-case tracking-normal text-muted-foreground">· ₹ per kg — yarn + processes, then loss</span>
      </span>
      {!shownFabrics.length ? <p className="m-0 text-sm text-muted-foreground">Pick a fabric in Component consumption above. It is priced here.</p> : null}
      {shownFabrics.map((f) => {
        const fig = figOf(f);
        const open = !f.is_direct && openFab === f.key;
        const setY = (key: string, patch: Partial<YarnMixDraft>) => setFabric(f.key, { yarns: patchBy(f.yarns, key, patch) });
        const setP = (key: string, patch: Partial<FabricProcessDraft>) => setFabric(f.key, { processes: patchBy(f.processes, key, patch) });
        const perYarn = hasYarnMix(f) || f.yarns.length > 1;
        const yarnLines: (YarnMixDraft | null)[] = f.yarns.length ? f.yarns : [null];
        const procLines: (FabricProcessDraft | null)[] = f.processes.length ? f.processes : [null];
        const flat = ([["knitting_rate", "Knitting (flat rate)"], ["dyeing_rate", "Dyeing (flat rate)"], ["finishing_rate", "Finishing (flat rate)"]] as const).filter(([k]) => f[k].trim() !== "");
        const share = yarnMixTotal(f);
        const blendOff = !f.is_direct && hasYarnMix(f) ? Math.round((share - 100) * 100) / 100 : 0;
        const yarnT = fig?.yarn ?? 0;
        const procT = fig ? fig.knitting + fig.dyeing + fig.finishing + fig.special : 0;
        const sub = yarnT + procT;
        const price = fig?.price ?? null;
        const named = f.yarns.filter((y) => y.yarn_name.trim() || y.item_id);
        const blend = f.is_direct ? "Bought-in" : named.map((y) => `${y.mix_pct.trim() ? `${y.mix_pct}% ` : ""}${y.yarn_name || "yarn"}`).join(" + ");
        const name = f.quality || fig?.name || "Fabric";
        return (
          <div key={f.key} className={cn("overflow-hidden rounded-xl border bg-surface", open ? "border-info/50 shadow-sm" : "border-border")} {...fabFold.focusProps(f.key)}>
            <div className={cn("flex flex-wrap items-center gap-3 px-3.5 py-2.5", open ? "border-b border-border bg-info-soft/40" : "bg-surface-muted/50")}>
              <button
                type="button"
                data-row-open
                aria-expanded={open}
                disabled={f.is_direct}
                onClick={() => fabFold.toggle(f.key)}
                className="flex min-w-0 flex-1 items-center gap-3 text-left disabled:cursor-default"
              >
                <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", !open && "-rotate-90", f.is_direct && "opacity-0")} aria-hidden />
                <span className="min-w-0">
                  <span className="block font-semibold text-heading">
                    {name}
                  </span>
                  {blend ? <Truncated text={blend} className="block text-xs text-muted-foreground" /> : null}
                </span>
              </button>
              <Toggle checked={f.is_direct} onChange={(v) => setFabric(f.key, { is_direct: v })} label="Bought-in" />
              <span className="text-xs font-semibold text-muted-foreground">Price / KG</span>
              {f.is_direct ? (
                <Num id={costingFieldId.fabricDirect(f.key)} label={`${name} price per kg`} value={f.direct_rate} onChange={(v) => setFabric(f.key, { direct_rate: v })} className="w-32" />
              ) : (
                <b className="font-mono text-base tabular-nums text-info">₹ {money(price)}</b>
              )}
              <RemoveX
                label={name}
                onClick={() => set({ ...d, fabrics: d.fabrics.filter((x) => x.key !== f.key), weights: d.weights.map((w) => (w.fabric_key === f.key ? { ...w, fabric_key: null } : w)) })}
              />
            </div>
            {open ? (
              <div className="grid grid-cols-1 gap-4 p-3.5 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
                <div className="flex min-w-0 flex-col gap-1.5">
                  <span className={cn("text-[11px] font-bold uppercase tracking-[.09em]", TONE.fabric.title)}>Yarn</span>
                  <table className={TB} aria-label={`${name} yarn`}>
                    <thead className={TONE.fabric.title}>
                      <tr>
                        <th className={TH}>Yarn</th>
                        <th className={cn(TH, "w-20 text-right")}>Mix %</th>
                        <th className={cn(TH, "w-28 text-right")}>Rate / KG</th>
                        <th className={cn(TH, "w-24 text-right")}>Amount</th>
                        <th className={cn(TH, "w-10")}><span className="sr-only">Remove</span></th>
                      </tr>
                    </thead>
                    <tbody data-grid-body onKeyDown={gridKeyNav}>
                      {yarnLines.map((y, i) => (
                        <tr key={y?.key ?? `${f.key}-y`} data-grid-row>
                          <td className={TD}>
                            <TypeOrPick
                              label="Yarn"
                              options={(opts?.yarns ?? []).map((o) => ({ id: o.id, name: o.name }))}
                              valueId={y?.item_id ?? null}
                              text={y?.yarn_name ?? ""}
                              onChange={(v) => (y ? setY(y.key, { item_id: v.id, yarn_name: v.name }) : setFabric(f.key, { yarns: [{ ...newYarnMix(), item_id: v.id, yarn_name: v.name }] }))}
                              placeholder="Pick a yarn"
                              uppercase
                              inputClassName={CELL}
                            />
                          </td>
                          <td className={TD}>
                            <Num
                              cell
                              id={i === 0 ? costingFieldId.yarnMix(f.key) : undefined}
                              label="Mix percent"
                              value={y?.mix_pct ?? ""}
                              onChange={(v) => (y ? setY(y.key, { mix_pct: v }) : setFabric(f.key, { yarns: [{ ...newYarnMix(), mix_pct: v }] }))}
                            />
                          </td>
                          <td className={TD}>
                            {perYarn && y ? (
                              <Num cell label="Yarn rate per KG" value={y.rate} onChange={(v) => setY(y.key, { rate: v })} />
                            ) : i === 0 ? (
                              <Num cell id={costingFieldId.fabricRate(f.key)} label={`${name} yarn rate per kg`} value={f.yarn_rate} onChange={(v) => setFabric(f.key, { yarn_rate: v })} />
                            ) : null}
                          </td>
                          <td className={TDV}>{perYarn && y ? ((num(y.mix_pct) ?? null) == null ? "—" : fx(((num(y.mix_pct) ?? 0) * (num(y.rate) ?? 0)) / 100)) : i === 0 ? money(yarnT) : ""}</td>
                          <td className={cn(TD, "text-center")}>{y && f.yarns.length > 1 ? <RemoveX label={y.yarn_name || "yarn"} onClick={() => setFabric(f.key, { yarns: f.yarns.filter((x) => x.key !== y.key) })} /> : null}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td className={FOOT}>
                          <AddBtn label="Add yarn" onClick={() => setFabric(f.key, { yarns: [...(f.yarns.length ? f.yarns : [newYarnMix()]), newYarnMix()] })} />
                        </td>
                        <td className={cn(FOOT, "text-right")}>
                          {hasYarnMix(f) ? <span className={cn("rounded-full px-2 py-0.5 font-mono text-xs font-bold", blendOff ? "bg-warning-soft text-warning" : "bg-success-soft text-success")}>{+share.toFixed(2)}%</span> : null}
                        </td>
                        <td className={cn(FOOT, "text-right text-xs text-muted-foreground")}>yarn / kg</td>
                        <td className={cn(FOOT, "text-right font-mono font-bold tabular-nums")}>{money(yarnT)}</td>
                        <td className={FOOT} />
                      </tr>
                    </tfoot>
                  </table>
                  {blendOff ? (
                    <p className="m-0 text-xs text-warning">
                      Mix is {share}% — {blendOff < 0 ? `${+Math.abs(blendOff).toFixed(2)}% still to place` : `${+blendOff.toFixed(2)}% too much`}. A blend should add to 100%.
                    </p>
                  ) : null}
                </div>
                <div className="flex min-w-0 flex-col gap-1.5">
                  <span className={cn("text-[11px] font-bold uppercase tracking-[.09em]", TONE.fabric.title)}>Processes</span>
                  <table className={TB} aria-label={`${name} processes`}>
                    <thead className={TONE.fabric.title}>
                      <tr>
                        <th className={TH}>Process</th>
                        <th className={cn(TH, "w-28 text-right")}>Rate / KG</th>
                        <th className={cn(TH, "w-10")}><span className="sr-only">Remove</span></th>
                      </tr>
                    </thead>
                    <tbody data-grid-body onKeyDown={gridKeyNav}>
                      {procLines.map((q) => (
                        <tr key={q?.key ?? `${f.key}-p`} data-grid-row>
                          <td className={TD}>
                            <TypeOrPick
                              label="Process"
                              options={(opts?.processes ?? []).map((o) => ({ id: o.id, name: o.name }))}
                              valueId={q?.process_id ?? null}
                              text={q?.process_name ?? ""}
                              onChange={(v) => (q ? setP(q.key, { process_id: v.id, process_name: v.name }) : setFabric(f.key, { processes: [{ ...newFabricProcess(), process_id: v.id, process_name: v.name }] }))}
                              placeholder="Pick a process"
                              uppercase
                              inputClassName={CELL}
                            />
                          </td>
                          <td className={TD}>
                            <Num cell label="Process rate per KG" value={q?.rate ?? ""} onChange={(v) => (q ? setP(q.key, { rate: v }) : setFabric(f.key, { processes: [{ ...newFabricProcess(), rate: v }] }))} />
                          </td>
                          <td className={cn(TD, "text-center")}>{q ? <RemoveX label={q.process_name || "process"} onClick={() => setFabric(f.key, { processes: f.processes.filter((x) => x.key !== q.key) })} /> : null}</td>
                        </tr>
                      ))}
                      {/* Old costings' flat knitting / dyeing / finishing rates, until cleared. */}
                      {flat.map(([k, label]) => (
                        <tr key={k} data-grid-row>
                          <td className={cn(TD, "px-2.5 text-muted-foreground")}>{label}</td>
                          <td className={TD}>
                            <Num cell label={`${name} ${label}`} value={f[k]} onChange={(v) => setFabric(f.key, { [k]: v } as Partial<FabricDraft>)} />
                          </td>
                          <td className={TD} />
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td className={FOOT}>
                          <AddBtn label="Add process" onClick={() => setFabric(f.key, { processes: [...(f.processes.length ? f.processes : [newFabricProcess()]), newFabricProcess()] })} />
                        </td>
                        <td className={cn(FOOT, "text-right font-mono font-bold tabular-nums")}>{money(procT)}</td>
                        <td className={FOOT} />
                      </tr>
                    </tfoot>
                  </table>
                  {/* The price build, figures in one aligned column. */}
                  <table className={cn(TB, "mt-2")} aria-label={`${name} price per kg`}>
                    <tbody>
                      {[
                        ["Yarn", money(yarnT)],
                        ["+ Processes", money(procT)],
                      ].map(([k, v]) => (
                        <tr key={k}>
                          <td className={cn(TD, "px-2.5 py-2 text-[13px]", TONE.fabric.title)}>{k}</td>
                          <td className={cn(TDV, "w-32")}>{v}</td>
                        </tr>
                      ))}
                      <tr className="bg-surface-muted">
                        <td className={cn(TD, "px-2.5 py-2 text-[13px]", TONE.fabric.title)}>Subtotal</td>
                        <td className={cn(TDV, "w-32 font-semibold")}>{money(sub)}</td>
                      </tr>
                      <tr>
                        <td className={cn(TD, "px-2.5 text-[13px]", TONE.fabric.title)}>
                          Loss % <span className="text-xs text-muted-foreground">+ ₹ {money(price != null ? price - sub : 0)}</span>
                        </td>
                        <td className={cn(TD, "w-32")}>
                          <Num cell label={`${name} process loss percent`} value={f.process_loss_pct} onChange={(v) => setFabric(f.key, { process_loss_pct: v })} />
                        </td>
                      </tr>
                      <tr className="bg-info-soft/40">
                        <td className="border-t-2 border-foreground px-2.5 py-2 text-[13px] font-bold text-heading">Price / KG</td>
                        <td className="border-t-2 border-foreground px-2.5 text-right font-mono font-bold tabular-nums text-info">{money(price)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}
            {f.is_direct && !(price != null && price > 0) ? <p className="m-0 border-t border-border px-3.5 py-2 text-xs text-warning">{name}: type the price per kg.</p> : null}
          </div>
        );
      })}
    </div>
  );

  /* ==== 2 · CMT & GARMENT PROCESSES ================================================ */
  const procOf = (id: string | null) => (id ? opts?.garmentProcesses.find((x) => x.id === id) : undefined);
  const cmtList = (opts?.garmentProcesses ?? []).filter((x) => x.garment_kind === "cmt");
  const embList = (opts?.garmentProcesses ?? []).filter((x) => x.garment_kind === "embellishment");
  /** Picking an operation fills a blank rate from the master's standard rate, never a typed one. */
  const pickOp = (p: PieceDraft, lineKey: string, v: { id: string | null; name: string }) => {
    const line = p.lines.find((l) => l.key === lineKey);
    const m = procOf(v.id);
    const prefill = m?.standard_rate != null && line && !line.rate.trim() ? { rate: String(m.standard_rate) } : {};
    setPiece(p.key, { lines: patchBy(p.lines, lineKey, { process_id: v.id, process_name: v.name, ...prefill }) });
  };
  /* "By operation" is cmt_direct off. Adding an operation turns it off for that piece, so
     the line it adds is the one that prices (calc.ts `pieceCmt`). */
  const addOp = (p: PieceDraft, kind: "cmt" | "embellishment") =>
    setPiece(p.key, { ...(kind === "cmt" ? { cmt_direct: false } : {}), lines: [...p.lines, newPieceLine(kind, null, "")] });
  const opTable = (p: PieceDraft, kind: "cmt" | "embellishment") => {
    const lines = p.lines.filter((l) => l.kind === kind);
    const rows = lines.length ? lines : [null];
    const list = kind === "cmt" ? cmtList : embList;
    const total = lines.reduce((t, l) => t + (num(l.rate) ?? 0), 0);
    return (
      <table className={TB} aria-label={`${kind === "cmt" ? "CMT operations" : "Garment processes"}${multi ? ` — ${p.piece_name}` : ""}`}>
        <thead className={TONE.making.title}>
          <tr>
            <th className={TH}>Operation</th>
            <th className={cn(TH, "w-28 text-right")}>Rate ₹</th>
            <th className={cn(TH, "w-10")}><span className="sr-only">Remove</span></th>
          </tr>
        </thead>
        <tbody data-grid-body onKeyDown={gridKeyNav}>
          {rows.map((l) => (
            <tr key={l?.key ?? `${p.key}-${kind}`} data-grid-row>
              <td className={TD}>
                <TypeOrPick
                  label={kind === "cmt" ? "CMT operation" : "Garment process"}
                  options={list.map((o) => ({ id: o.id, name: o.name }))}
                  valueId={l?.process_id ?? null}
                  text={l?.process_name ?? ""}
                  onChange={(v) => {
                    if (l) return pickOp(p, l.key, v);
                    const line = { ...newPieceLine(kind, v.id, v.name), rate: procOf(v.id)?.standard_rate != null ? String(procOf(v.id)!.standard_rate) : "" };
                    setPiece(p.key, { ...(kind === "cmt" ? { cmt_direct: false } : {}), lines: [...p.lines, line] });
                  }}
                  placeholder={kind === "cmt" ? "Pick an operation" : "Print, embroidery, wash…"}
                  uppercase
                  inputClassName={CELL}
                />
              </td>
              <td className={TD}>
                <Num
                  cell
                  label="Rate"
                  value={l?.rate ?? ""}
                  onChange={(v) => (l ? setPiece(p.key, { lines: patchBy(p.lines, l.key, { rate: v }) }) : setPiece(p.key, { ...(kind === "cmt" ? { cmt_direct: false } : {}), lines: [...p.lines, { ...newPieceLine(kind, null, ""), rate: v }] }))}
                />
              </td>
              <td className={cn(TD, "text-center")}>{l ? <RemoveX label={l.process_name || "line"} onClick={() => setPiece(p.key, { lines: p.lines.filter((x) => x.key !== l.key) })} /> : null}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td className={FOOT}>
              <AddBtn label={kind === "cmt" ? "Add operation" : "Add process"} onClick={() => addOp(p, kind)} />
            </td>
            <td className={cn(FOOT, "text-right font-mono font-bold tabular-nums")}>{money(total)}</td>
            <td className={FOOT} />
          </tr>
        </tfoot>
      </table>
    );
  };
  const making = (
    <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-2">
      <div className="flex min-w-0 flex-col gap-3">
        <span className={cn("text-[11px] font-bold uppercase tracking-[.09em]", TONE.making.title)}>CMT operations</span>
        {d.pieces.map((p) => (
          <div key={p.key} className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-3">
              {multi ? <span className="text-sm font-semibold text-heading">{p.piece_name}</span> : null}
              <Segmented<"ops" | "one">
                name={`cmt-mode-${p.key}`}
                value={p.cmt_direct ? "one" : "ops"}
                onChange={(v) => setPiece(p.key, { cmt_direct: v === "one" })}
                options={[
                  { value: "ops", label: "By operation" },
                  { value: "one", label: "One CMT rate" },
                ]}
              />
            </div>
            {p.cmt_direct ? (
              <label className="flex max-w-sm items-center justify-between gap-3 rounded-lg border border-border bg-surface px-3 py-2">
                <span className={cn("text-[13px]", TONE.making.title)}>CMT ₹ / {model.unitWord} — all operations in one figure</span>
                <Num label={`${p.piece_name} CMT rate`} value={p.cmt} onChange={(v) => setPiece(p.key, { cmt: v })} className="w-28" />
              </label>
            ) : (
              opTable(p, "cmt")
            )}
          </div>
        ))}
      </div>
      <div className="flex min-w-0 flex-col gap-3">
        <span className={cn("text-[11px] font-bold uppercase tracking-[.09em]", TONE.making.title)}>Garment processes</span>
        {d.pieces.map((p) => (
          <div key={p.key} className="flex flex-col gap-2">
            {multi ? <span className="text-sm font-semibold text-heading">{p.piece_name}</span> : null}
            {opTable(p, "embellishment")}
          </div>
        ))}
      </div>
    </div>
  );

  /* ==== 3 · TRIMS ================================================================== */
  const setTrim = (key: string, patch: Partial<TrimDraft>) => set({ ...d, trims: patchBy(d.trims, key, patch) });
  const trims = (
    <div className="flex flex-col gap-2">
      <span className="text-xs text-muted-foreground">
        Tick <b className="text-foreground">Direct Rate</b> when the rate is ₹ per piece. Otherwise Cons Qty = No of Items ÷ No of Pcs, and Cost = Cons Qty × Rate.
      </span>
      <div className="max-w-full overflow-x-auto">
        <table className={cn(TB, "min-w-[46rem]")} aria-label="Trims">
          <thead className={TONE.trims.title}>
            <tr>
              {multi ? <th className={cn(TH, "w-32")}>Piece</th> : null}
              <th className={TH}>Trim</th>
              <th className={cn(TH, "w-24 text-center")}>Direct Rate</th>
              <th className={cn(TH, "w-24 text-right")}>No of Items</th>
              <th className={cn(TH, "w-24 text-right")}>No of Pcs</th>
              <th className={cn(TH, "w-24 text-right")}>Cons Qty</th>
              <th className={cn(TH, "w-28 text-right")}>Rate ₹</th>
              <th className={cn(TH, "w-24 text-right")}>Cost ₹</th>
              <th className={cn(TH, "w-10")}><span className="sr-only">Remove</span></th>
            </tr>
          </thead>
          <tbody data-grid-body onKeyDown={gridKeyNav}>
            {d.trims.map((t) => {
              const direct = t.is_direct !== false;
              const items = num(t.qty);
              const pcs = num(t.pack_size);
              const cons = direct ? null : items != null ? items / (pcs && pcs > 0 ? pcs : 1) : null;
              const cost = trimCostPerPiece(t).cost;
              const trimLabel = opts?.trims.find((x) => x.id === t.item_id)?.name || t.description;
              return (
                <tr key={t.key} data-grid-row>
                  {multi ? (
                    <td className={TD}>
                      <TypeOrPick label="Piece" options={d.pieces.map((p) => ({ id: p.key, name: p.piece_name || "GARMENT" }))} valueId={t.piece_key} text={pieceName(t.piece_key)} onChange={(v) => v.id && setTrim(t.key, { piece_key: v.id })} uppercase inputClassName={CELL} />
                    </td>
                  ) : null}
                  <td className={TD}>
                    <TypeOrPick
                      label="Trim or accessory"
                      options={(opts?.trims ?? []).map((o) => ({ id: o.id, name: o.name }))}
                      valueId={t.item_id}
                      text={trimLabel}
                      onChange={(v) => setTrim(t.key, { item_id: v.id, description: v.name })}
                      placeholder="Pick a trim"
                      uppercase
                      inputClassName={CELL}
                    />
                  </td>
                  <td className={cn(TD, "text-center")}>
                    <input type="checkbox" aria-label={`${trimLabel || "Trim"} — direct rate`} checked={direct} onChange={(e) => setTrim(t.key, { is_direct: e.target.checked })} className="h-4 w-4 accent-[var(--color-warning)] align-middle" />
                  </td>
                  <td className={TD}>{direct ? <span className="block px-2.5 text-right text-muted-foreground">—</span> : <Num cell id={costingFieldId.trimQty(t.key)} label="No of items" value={t.qty} onChange={(v) => setTrim(t.key, { qty: v })} />}</td>
                  <td className={TD}>{direct ? <span className="block px-2.5 text-right text-muted-foreground">—</span> : <Num cell id={costingFieldId.trimPackSize(t.key)} label="No of pcs" value={t.pack_size} onChange={(v) => setTrim(t.key, { pack_size: v })} />}</td>
                  <td className={cn(TDV, "text-muted-foreground")}>{direct ? "1" : cons == null ? "—" : cons.toFixed(4)}</td>
                  <td className={TD}>
                    {direct ? (
                      <Num cell id={costingFieldId.trimRate(t.key)} label="Rate per piece" value={t.rate} onChange={(v) => setTrim(t.key, { rate: v })} />
                    ) : (
                      <Num cell id={costingFieldId.trimPackPrice(t.key)} label="Pack rate" value={t.pack_price} onChange={(v) => setTrim(t.key, { pack_price: v })} />
                    )}
                  </td>
                  <td className={cn(TDV, "font-semibold")}>{money(cost)}</td>
                  <td className={cn(TD, "text-center")}>{d.trims.length > 1 ? <RemoveX label={trimLabel || "trim"} onClick={() => set({ ...d, trims: d.trims.filter((x) => x.key !== t.key) })} /> : null}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td className={FOOT} colSpan={multi ? 7 : 6}>
                <AddBtn label="Add trim" onClick={() => set({ ...d, trims: [...d.trims, newTrim(d.pieces[0]?.key ?? "")] })} />
              </td>
              <td className={cn(FOOT, "text-right font-mono font-bold tabular-nums")}>{money(s.trims)}</td>
              <td className={FOOT} />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );

  /* ==== 4 · OTHER COSTS & OVERHEADS ================================================ */
  const fieldCard = "rounded-lg border border-border bg-surface px-3 py-2.5";
  const overheads = (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-[repeat(auto-fit,minmax(11rem,1fr))] gap-3">
        <label className={fieldCard}>
          <span className={cn(LABEL, TONE.oh.title)}>Garment Rejection %</span>
          <Num label="Garment Rejection percent" value={d.header.garment_waste_pct} onChange={(v) => setHeader({ garment_waste_pct: v })} />
          <span className="mt-1 block text-right font-mono text-xs text-muted-foreground">= ₹ {money(s.wastage)}</span>
        </label>
        <label className={fieldCard}>
          <span className={cn(LABEL, TONE.oh.title)}>Overhead %</span>
          <Num label="Overhead percent" value={d.header.overhead_pct} onChange={(v) => setHeader({ overhead_pct: v })} />
          <span className="mt-1 block text-right font-mono text-xs text-muted-foreground">= ₹ {money(s.overhead)}</span>
        </label>
        {d.pieces.map((p) => (
          <label key={`t${p.key}`} className={fieldCard}>
            <span className={cn(LABEL, TONE.oh.title)}>Testing ₹{multi ? ` · ${p.piece_name}` : ""}</span>
            <Num label={`${p.piece_name} testing`} value={p.testing_cost} onChange={(v) => setPiece(p.key, { testing_cost: v })} />
            <span className="mt-1 block text-right text-xs text-muted-foreground">per {model.unitWord}</span>
          </label>
        ))}
        {d.pieces.map((p) => (
          <label key={`b${p.key}`} className={fieldCard}>
            <span className={cn(LABEL, TONE.oh.title)}>Bank charges ₹{multi ? ` · ${p.piece_name}` : ""}</span>
            <Num label={`${p.piece_name} bank charges`} value={p.bank_cost} onChange={(v) => setPiece(p.key, { bank_cost: v })} />
            <span className="mt-1 block text-right text-xs text-muted-foreground">per {model.unitWord}</span>
          </label>
        ))}
      </div>
      <div className="flex flex-col gap-1.5">
        <span className={cn("text-[11px] font-bold uppercase tracking-[.09em]", TONE.oh.title)}>Extra charges</span>
        <table className={TB} aria-label="Extra charges">
          <thead className={TONE.oh.title}>
            <tr>
              <th className={TH}>Charge</th>
              <th className={cn(TH, "w-32")}>Adds to</th>
              <th className={cn(TH, "w-28")}>Type</th>
              <th className={cn(TH, "w-28 text-right")}>Value</th>
              <th className={cn(TH, "w-10")}><span className="sr-only">Remove</span></th>
            </tr>
          </thead>
          <tbody data-grid-body onKeyDown={gridKeyNav}>
            {d.extras.length ? (
              d.extras.map((x) => {
                const setX = (patch: Partial<typeof x>) => set({ ...d, extras: patchBy(d.extras, x.key, patch) });
                const sel = "h-9 w-full border-0 bg-transparent px-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary";
                return (
                  <tr key={x.key} data-grid-row>
                    <td className={TD}>
                      <Input id={costingFieldId.extraName(x.key)} aria-label="Charge name" value={x.name} onChange={(e) => setX({ name: e.target.value })} className={CELL} />
                    </td>
                    <td className={TD}>
                      <select aria-label="Adds to" value={x.section} onChange={(e) => setX({ section: e.target.value as typeof x.section })} className={sel} autoComplete="off" data-1p-ignore data-lpignore="true" data-form-type="other">
                        <option value="overhead">Cost</option>
                        <option value="price">Price</option>
                      </select>
                    </td>
                    <td className={TD}>
                      <select aria-label="Charge type" value={x.kind} onChange={(e) => setX({ kind: e.target.value as "flat" | "pct" })} className={sel} autoComplete="off" data-1p-ignore data-lpignore="true" data-form-type="other">
                        <option value="flat">Flat ₹</option>
                        <option value="pct">Percent</option>
                      </select>
                    </td>
                    <td className={TD}>
                      <Num cell id={costingFieldId.extraValue(x.key)} label="Charge value" value={x.value} onChange={(v) => setX({ value: v })} />
                    </td>
                    <td className={cn(TD, "text-center")}>
                      <RemoveX label={x.name || "charge"} onClick={() => set({ ...d, extras: d.extras.filter((e) => e.key !== x.key) })} />
                    </td>
                  </tr>
                );
              })
            ) : (
              <tr>
                <td className={cn(TD, "px-2.5 py-2 text-xs text-muted-foreground")} colSpan={5}>
                  None — add one for a cost or price charge this sheet needs.
                </td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr>
              <td className={FOOT} colSpan={5}>
                <AddBtn label="Add charge" onClick={() => set({ ...d, extras: [...d.extras, newExtra("overhead")] })} />
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );

  /* ==== 5 · MARGIN & TERMS ========================================================= */
  const termBox = (label: string, field: keyof typeof d.header, id?: string) => (
    <label className={fieldCard} key={field}>
      <span className={cn(LABEL, TONE.terms.title)}>{label}</span>
      <Num id={id} label={label} value={String(d.header[field] ?? "")} onChange={(v) => setHeader({ [field]: v } as Partial<typeof d.header>)} />
    </label>
  );
  const terms = (
    <div className="flex flex-col gap-4">
      {edit.terms}
      <div className="flex flex-wrap items-end gap-3">
        <label className={cn(fieldCard, "w-40")}>
          <span className={cn(LABEL, TONE.terms.title)}>Margin %</span>
          <Num id={costingFieldId.margin} label="Margin percent" value={d.header.margin_pct} onChange={(v) => setHeader({ margin_pct: v })} className="font-bold" />
        </label>
        <div className="flex gap-1 pb-3" role="group" aria-label="Quick margin">
          {["18", "20", "22", "25"].map((m) => (
            <Button key={m} type="button" size="sm" variant={num(d.header.margin_pct) === Number(m) ? "primary" : "outline"} onClick={() => setHeader({ margin_pct: m })} tabIndex={-1}>
              {m}%
            </Button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(10rem,1fr))] gap-3">
        {termBox("Commission %", "commission_pct")}
        {termBox("LC discount %", "discount_pct")}
        {termBox("Freight / pc ₹", "freight_per_pc")}
        {termBox("Insurance / pc ₹", "insurance_per_pc")}
        {termBox(`Exchange rate ₹ / ${ccy || "FOB"}`, "exchange_rate", costingFieldId.rate)}
        {termBox(`Buyer target ${ccy}`.trim(), "buyer_target_price")}
      </div>
    </div>
  );

  /* ==== 6 · QUOTE ================================================================== */
  const group = summaryOf(d).groups[0];
  const target = num(d.header.buyer_target_price);
  const fillQuotes = () => {
    const quotes = { ...d.quotes };
    for (const p of group?.pieces ?? []) {
      const k = quoteKey(p.pieceKey, null);
      if ((quotes[k] ?? "").trim() === "" && p.calc != null) quotes[k] = (Math.round(p.calc * 100) / 100).toFixed(2);
    }
    set({ ...d, quotes });
  };

  /* ==== the strip: the answer, always in view ====================================== */
  const fobShown = s?.quoted ?? s?.calc ?? null;
  const eff = s?.effectiveMarginPct ?? null;
  const done = ORDER.filter((k) => !todo(k)).length;

  const summaries: Record<SecKey, string> = {
    fabric: `${shownFabrics.length} fabric${shownFabrics.length === 1 ? "" : "s"} · ${weightRows.filter((r) => r.componentIds.length).length} lines · ${fx(s?.grams ?? 0)} g avg`,
    making: `CMT ₹ ${money(s?.cmt)} · garment processes ₹ ${money(s?.process)}`,
    trims: `${d.trims.filter((t) => t.item_id || t.description.trim()).length} trims · ${d.trims.filter((t) => t.is_direct === false).length} by pack`,
    oh: `Rejection ${d.header.garment_waste_pct || 0}% · overhead ${d.header.overhead_pct || 0}% · testing & bank ₹ ${money((s?.testing ?? 0) + (s?.bank ?? 0))}`,
    terms: `Margin ${d.header.margin_pct || 0}% · commission ${d.header.commission_pct || 0}% · ${ccy || "currency"} @ ₹ ${d.header.exchange_rate || "—"}`,
  };

  return (
    <div className="flex flex-col gap-3">
      {/* THE STRIP — Net → Gross → Selling → FOB, and what is left to fill. */}
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border border-border bg-foreground px-5 py-3 text-surface shadow-sm">
        {[
          ["Net", `₹ ${money(s?.net)}`],
          ["Gross", `₹ ${money(s?.grossCost)}`],
          ["Selling", `₹ ${money(s?.price)}`],
        ].map(([k, v]) => (
          <div key={k}>
            <div className="text-[10.5px] font-semibold uppercase tracking-[.08em] opacity-60">{k}</div>
            <div className="font-mono font-semibold tabular-nums">{v}</div>
          </div>
        ))}
        <div>
          <div className="text-[10.5px] font-semibold uppercase tracking-[.08em] opacity-60">FOB · {s?.quoted != null ? "quoted" : "calculated"}</div>
          <div className="font-mono text-lg font-extrabold tabular-nums">{fobShown == null ? "—" : `${ccy} ${fobShown.toFixed(2)}`}</div>
        </div>
        <span className={cn("rounded-full px-2.5 py-0.5 font-mono text-xs font-bold", marginTone(eff))}>{eff == null ? "margin —" : `${eff.toFixed(1)}% margin`}</span>
        <span className="flex-1" />
        <span className="text-xs opacity-70">{done} of 5 sections complete</span>
        {problems.length ? (
          <Button type="button" variant="outline" size="sm" onClick={showMe} className="border-warning/60 bg-transparent text-warning hover:bg-warning/10">
            {problems.length} to fill — show me
          </Button>
        ) : null}
      </div>

      <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-sm">
        {/* DETAILS — always open: what is being costed comes first. */}
        <div className="px-5 py-4">{edit.details}</div>

        <Section k="fabric" n={1} title="Fabric" icon={Layers} summary={summaries.fabric} todo={todo("fabric")} open={acc.isOpen("fabric")} onToggle={() => acc.toggle("fabric")} focus={acc.focusProps("fabric")} spine={<Spine cap="Fabric" value={`₹ ${money(s?.fabric)}`} sub={`${fx(s?.grams ?? 0)} g avg piece`} />}>
          {consumption}
          {fabricCards}
        </Section>
        <Section k="making" n={2} title="CMT & garment processes" icon={Scissors} summary={summaries.making} todo={todo("making")} open={acc.isOpen("making")} onToggle={() => acc.toggle("making")} focus={acc.focusProps("making")} spine={<Spine cap="CMT & processes" value={`₹ ${money((s?.cmt ?? 0) + (s?.process ?? 0))}`} sub={`so far ₹ ${money((s?.fabric ?? 0) + (s?.cmt ?? 0) + (s?.process ?? 0))}`} />}>
          {making}
        </Section>
        <Section k="trims" n={3} title="Trims" icon={Tag} summary={summaries.trims} todo={todo("trims")} open={acc.isOpen("trims")} onToggle={() => acc.toggle("trims")} focus={acc.focusProps("trims")} spine={<Spine cap="Trims" value={`₹ ${money(s?.trims)}`} sub={`so far ₹ ${money((s?.fabric ?? 0) + (s?.cmt ?? 0) + (s?.process ?? 0) + (s?.trims ?? 0))}`} />}>
          {trims}
        </Section>
        <Section k="oh" n={4} title="Other costs & overheads" icon={Building2} summary={summaries.oh} todo={todo("oh")} open={acc.isOpen("oh")} onToggle={() => acc.toggle("oh")} focus={acc.focusProps("oh")} spine={<Spine cap="Gross cost" value={`₹ ${money(s?.grossCost)}`} sub={`net ₹ ${money(s?.net)}`} />}>
          {overheads}
        </Section>
        <Section k="terms" n={5} title="Margin & terms" icon={TrendingUp} summary={summaries.terms} todo={todo("terms")} open={acc.isOpen("terms")} onToggle={() => acc.toggle("terms")} focus={acc.focusProps("terms")} spine={<Spine cap="Selling price" value={`₹ ${money(s?.price)}`} sub={s?.calc == null ? "FOB needs the rate" : `FOB ${ccy} ${s.calc.toFixed(4)}`} />}>
          {terms}
        </Section>

        {/* 6 · QUOTE — always open: it is the answer. */}
        <section data-sec="quote" aria-label="Quote to the buyer" className="border-t border-border px-5 py-5">
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <span className={cn("grid h-9 w-9 place-items-center rounded-lg", TONE.quote.icon)}>
              <Receipt className="h-[18px] w-[18px]" />
            </span>
            <div className="flex-1">
              <div className="text-[15px] font-bold text-heading">6 · Quote to the buyer</div>
              <div className="text-xs text-muted-foreground">
                FOB per {model.unitWord} in {ccy || "the buyer's currency"} · buyer target <b className="font-mono text-foreground">{target == null ? "—" : target.toFixed(2)}</b>
              </div>
            </div>
            <Button type="button" variant="outline" onClick={fillQuotes}>
              Fill blanks from calculated
            </Button>
          </div>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(15rem,1fr))] gap-3">
            {d.pieces.map((p) => {
              const fig = group?.pieces.find((x) => x.pieceKey === p.key);
              const k = quoteKey(p.key, null);
              const q = num(d.quotes[k]);
              const m = fig?.effectiveMarginPct ?? null;
              const gap = q != null && target != null && !multi ? q - target : null;
              return (
                <div key={p.key} className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-3.5">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-heading">{multi ? p.piece_name : `Per ${model.unitWord}`}</span>
                    <span className={cn("rounded-full px-2 py-0.5 font-mono text-xs font-bold", marginTone(m))}>{m == null ? "no quote" : `${m.toFixed(1)}%`}</span>
                  </div>
                  <label>
                    <span className={cn(LABEL, "text-muted-foreground")}>Quoted {ccy}</span>
                    <Num
                      label={`Quoted price${multi ? ` ${p.piece_name}` : ""}`}
                      value={d.quotes[k] ?? ""}
                      onChange={(v) => {
                        edit.onQuote?.(k);
                        set({ ...d, quotes: { ...d.quotes, [k]: v } });
                      }}
                      className="h-12 text-left text-2xl font-bold"
                    />
                  </label>
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>
                      calculated <b className="font-mono text-foreground">{fig?.calc == null ? "—" : fig.calc.toFixed(4)}</b>
                    </span>
                    {gap != null ? <span className={cn("font-mono", gap > 0 ? "text-danger" : "text-success")}>{`${gap > 0 ? "+" : gap < 0 ? "−" : ""}${Math.abs(gap).toFixed(2)} vs target`}</span> : null}
                  </div>
                </div>
              );
            })}
            {multi && s ? (
              <div className="flex flex-col justify-center gap-1 rounded-xl border border-dashed border-border bg-surface-muted p-3.5">
                <span className="text-xs font-semibold uppercase tracking-[.08em] text-muted-foreground">Set total</span>
                <span className="font-mono text-2xl font-bold tabular-nums">{fobShown == null ? "—" : `${ccy} ${fobShown.toFixed(2)}`}</span>
                <span className={cn("w-fit rounded-full px-2 py-0.5 font-mono text-xs font-bold", marginTone(eff))}>{eff == null ? "margin —" : `${eff.toFixed(1)}% margin`}</span>
              </div>
            ) : null}
          </div>
        </section>
      </div>
      <p className="m-0 text-xs text-muted-foreground">Enter moves to the next box · Ctrl+S saves · a section opens when you reach it, and the one you left folds to a summary.</p>
    </div>
  );
}
