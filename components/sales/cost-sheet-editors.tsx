"use client";

import { RowHoverRemove } from "@/components/ui/row-hover-remove";
import { useState, type ReactNode } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { CostingDraft } from "@/lib/sales/sample-costing/types";
import { newExtra, newFabric, newPieceLine, newTrim } from "@/lib/sales/sample-costing/revision-draft";
import { TypeOrPick } from "@/app/(app)/orders/_garment-order/type-or-pick";

/**
 * The structural half of editing ON the Cost Sheet (client 2026-10-09: "we need
 * full editing here"): adding and removing the rows a figure sits in, and
 * picking what a row is. The numbers themselves are `Ed` boxes in the document.
 *
 * Every control edits the report's working copy through `onChange` and nothing
 * else — the sheet re-draws from it, and nothing is saved until Save as Rev N.
 *
 * Paper-coloured like `Ed`: the sheet is paper whatever the theme.
 */

export type Opt = { id: string; name: string };
export type EditOptions = {
  fabrics: readonly Opt[];
  yarns: readonly Opt[];
  processes: readonly Opt[];
  garmentProcesses: readonly (Opt & { garment_kind: "cmt" | "embellishment" })[];
  components: readonly Opt[];
  trims: readonly Opt[];
};

const PAPER = "h-7 rounded-md border border-[#037bb8] bg-white px-1.5 text-xs font-semibold text-[#0f1b26]";

/** A native list on the paper. The browser's own memory is off, as everywhere. */
export function Pick({ label, value, options, onPick, empty, w = "w-44" }: { label: string; value: string | null; options: readonly Opt[]; onPick: (id: string, name: string) => void; empty: string; w?: string }) {
  return (
    <select
      aria-label={label}
      title={label}
      value={value ?? ""}
      autoComplete="off"
      data-1p-ignore
      data-lpignore="true"
      data-form-type="other"
      onChange={(e) => {
        const o = options.find((x) => x.id === e.target.value);
        if (o) onPick(o.id, o.name);
      }}
      className={`${PAPER} ${w}`}
    >
      <option value="">{empty}</option>
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.name}
        </option>
      ))}
    </select>
  );
}

/** A text cell edited in place. */
export function EdText({ value, onChange, label, w = "w-40" }: { value: string; onChange: (v: string) => void; label: string; w?: string }) {
  return (
    <input
      type="text"
      aria-label={label}
      title={label}
      value={value}
      autoComplete="off"
      data-1p-ignore
      data-lpignore="true"
      data-form-type="other"
      onChange={(e) => onChange(e.target.value.toUpperCase())}
      className={`${PAPER} ${w} uppercase`}
    />
  );
}

/** A row's ✕ — the app-wide hover ✕ (user 2026-10-12, erp-row-hover-remove):
 *  hidden until the pointer is on its `<tr>`, never a Tab stop, Ctrl+Del-able. */
export function RemoveX({ label, onClick }: { label: string; onClick: () => void }) {
  return <RowHoverRemove label={`Remove ${label}`} onClick={onClick} />;
}

function AddRow({ children, add, addLabel, disabled }: { children?: ReactNode; add: () => void; addLabel: string; disabled?: boolean }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, padding: "8px 12px" }}>
      {children}
      <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={add} data-row-add>
        <Plus className="h-3.5 w-3.5" />
        {addLabel}
      </Button>
    </div>
  );
}

type EditProps = { draft: CostingDraft; onChange: (next: CostingDraft) => void; options: EditOptions };

/* THE ADD LINE IS A FULL LINE (user 2026-10-15, screenshot 3525: "can't add size and
   loss — rethink the add option"). The first cut of the ready row held the line's NAMES
   only — Component, Fabric — with the size and Loss % cells blank and "+ Add" standing
   in the Loss % column, so a line's figures could only be typed after it existed. Now:
   - every editable table has a narrow ACTION column on the right (`td.act`): a line's
     hover ✕ lives there, and so does the add line's "+ Add";
   - the add line has a box in EVERY column the operator types — names AND figures —
     and "+ Add" creates the line with all of it, then clears.
   Tab off the last box lands on "+ Add" and Enter adds (the app's grid rule); the
   cursor then lands in the new line (`landOnAddedRow`). Plan: artifact "Cost Sheet
   Line Entry".
   COMPONENT CONSUMPTION LEFT THIS SHAPE (user 2026-10-15, screenshot 3544): its lines
   are edited where they stand and "+ Add row" adds a blank one — see
   cost-sheet-document.tsx `secConsumption`. The other tables keep their add line. */

type Val = { id: string | null; name: string };
const BLANK: Val = { id: null, name: "" };

/** A number cell edited in place. Paper-coloured whatever the theme: the sheet is paper.
 *  Its look is `.cs-ed` in the sheet CSS, not `!` utilities — a layered `!important`
 *  outranks every unlayered rule, so a table cell could never flatten it. */
export function Ed({ value, onChange, label, w = "w-24" }: { value: string; onChange: (v: string) => void; label: string; w?: string }) {
  return (
    <Input
      type="number"
      inputMode="decimal"
      step="any"
      min={0}
      aria-label={label}
      title={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onFocus={(e) => e.currentTarget.select()}
      className={`${w} cs-ed text-right font-semibold tabular-nums`}
    />
  );
}

/** A searchable picker for a line's cell. A typed name that matches a row exactly
 *  counts as picking it, so typing "NECK" and pressing Add works. */
export function CellPick({ label, options, value, onPick }: { label: string; options: readonly (Opt & { note?: string })[]; value: Val; onPick: (v: Val) => void }) {
  return (
    <TypeOrPick
      label={label}
      options={options.map((o) => ({ id: o.id, name: o.name, note: o.note }))}
      valueId={value.id}
      text={value.name}
      placeholder={label}
      uppercase
      inputClassName="h-7 text-xs"
      onChange={(v) => onPick(v.id ? v : { id: options.find((o) => o.name.toUpperCase() === v.name.trim().toUpperCase())?.id ?? null, name: v.name })}
    />
  );
}

/** The add line's last cell, in the action column. */
function AddCell({ add, disabled }: { add: () => void; disabled: boolean }) {
  return (
    <td className="act">
      <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={add} data-row-add>
        <Plus className="h-3.5 w-3.5" />
        Add
      </Button>
    </td>
  );
}

/** A figure box in the add line — the same box a line's own figures use. */
function NumCell({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <td className="r">
      <Ed w="w-full" label={label} value={value} onChange={onChange} />
    </td>
  );
}

/** The piece an added line belongs to: the only one, or a pick when the costing is a set. */
function usePiece(draft: CostingDraft) {
  const [pick, setPick] = useState<string>("");
  const key = draft.pieces.some((p) => p.key === pick) ? pick : (draft.pieces[0]?.key ?? "");
  const name = draft.pieces.find((p) => p.key === key)?.piece_name || "GARMENT";
  const cell =
    draft.pieces.length > 1 ? (
      <td>
        <CellPick label="Piece" options={draft.pieces.map((p) => ({ id: p.key, name: p.piece_name || "GARMENT" }))} value={{ id: key, name }} onPick={(v) => v.id && setPick(v.id)} />
      </td>
    ) : null;
  return { key, cell };
}

/** CMT or embellishment operations: Piece? · Operation · Rate ₹ · + Add. */
export function OperationReadyRow({ draft, onChange, options, kind }: EditProps & { kind: "cmt" | "embellishment" }) {
  const piece = usePiece(draft);
  const [proc, setProc] = useState<Val>(BLANK);
  const [rate, setRate] = useState("");
  const list = options.garmentProcesses.filter((x) => x.garment_kind === kind);
  return (
    <tr className="ready" data-grid-row>
      {piece.cell}
      <td><CellPick label={kind === "cmt" ? "CMT operation" : "Process"} options={list} value={proc} onPick={setProc} /></td>
      <NumCell label="New operation — rate ₹" value={rate} onChange={setRate} />
      <AddCell
        disabled={!proc.id}
        add={() => {
          const p = list.find((x) => x.id === proc.id);
          if (!p) return;
          const line = { ...newPieceLine(p.garment_kind, p.id, p.name), rate };
          onChange({ ...draft, pieces: draft.pieces.map((x) => (x.key === piece.key ? { ...x, lines: [...x.lines, line] } : x)) });
          setProc(BLANK);
          setRate("");
        }}
      />
    </tr>
  );
}

/** Trims: Piece? · Trim · Pricing (direct rate, or pack price ÷ pack size) · Consumption · (Cost) · + Add. */
export function TrimReadyRow({ draft, onChange, options }: EditProps) {
  const piece = usePiece(draft);
  const [item, setItem] = useState<Val>(BLANK);
  const [direct, setDirect] = useState(true);
  const [rate, setRate] = useState("");
  const [packPrice, setPackPrice] = useState("");
  const [packSize, setPackSize] = useState("");
  const [qty, setQty] = useState("");
  return (
    <tr className="ready" data-grid-row>
      {piece.cell}
      <td><CellPick label="Trim or accessory" options={options.trims} value={item} onPick={setItem} /></td>
      <td className="dim">
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            <input type="checkbox" checked={direct} onChange={(e) => setDirect(e.target.checked)} />
            <span>Direct</span>
          </label>
          {direct ? (
            <Ed w="w-20" label="New trim — direct rate ₹" value={rate} onChange={setRate} />
          ) : (
            <>
              <Ed w="w-20" label="New trim — pack price ₹" value={packPrice} onChange={setPackPrice} />
              <span>÷</span>
              <Ed w="w-16" label="New trim — pack size" value={packSize} onChange={setPackSize} />
            </>
          )}
        </span>
      </td>
      {direct ? <td /> : <NumCell label="New trim — consumption" value={qty} onChange={setQty} />}
      <td />
      <AddCell
        disabled={!item.id}
        add={() => {
          if (!item.id) return;
          const t = { ...newTrim(piece.key, item.id, item.name), is_direct: direct, rate: direct ? rate : "", pack_price: direct ? "" : packPrice, pack_size: direct ? "" : packSize, qty: direct ? "" : qty };
          onChange({ ...draft, trims: [...draft.trims, t] });
          setItem(BLANK);
          setRate("");
          setPackPrice("");
          setPackSize("");
          setQty("");
        }}
      />
    </tr>
  );
}

/** The foot of the fabric rail: pick a structure, + Add. The new fabric opens beside the
 *  rail (`onAdded`), where Bought-in, Loss % or its price are set — the rail line is 220px
 *  wide, too narrow to carry them, and they belong to the fabric's own header anyway. */
export function FabricAddLine({ draft, onChange, options, onAdded }: EditProps & { onAdded?: (key: string) => void }) {
  const [pick, setPick] = useState<Val>(BLANK);
  return (
    <div className="fadd">
      <CellPick label="Fabric structure" options={options.fabrics} value={pick} onPick={setPick} />
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={!pick.id}
        data-row-add
        onClick={() => {
          const f = { ...newFabric(), fabric_id: pick.id, quality: pick.name, is_direct: false, yarns: [], processes: [] };
          onChange({ ...draft, fabrics: [...draft.fabrics, f] });
          onAdded?.(f.key);
          setPick(BLANK);
        }}
      >
        <Plus className="h-3.5 w-3.5" />
        Add
      </Button>
    </div>
  );
}

export function AddCharge({ draft, onChange }: Pick2) {
  return <AddRow addLabel="Add charge" add={() => onChange({ ...draft, extras: [...draft.extras, newExtra("overhead")] })} />;
}
type Pick2 = { draft: CostingDraft; onChange: (next: CostingDraft) => void };
