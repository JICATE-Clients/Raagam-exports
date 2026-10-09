"use client";

import { useState, type ReactNode } from "react";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { CostingDraft } from "@/lib/sales/sample-costing/types";
import { newExtra, newFabric, newPieceLine, newTrim, newWeightRows } from "@/lib/sales/sample-costing/revision-draft";

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

/** A row's ✕ — never the keyboard's Tab stop (the contract's Remove), always on the mouse. */
export function RemoveX({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      tabIndex={-1}
      data-row-remove
      aria-label={`Remove ${label}`}
      title={`Remove ${label}`}
      onClick={onClick}
      className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-[#b8c4cc] bg-white text-[#5b6b78] hover:text-[#c0392b]"
    >
      <X className="h-3.5 w-3.5" />
    </button>
  );
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

/** The piece an added row belongs to: the only one, or a pick when the costing is a set. */
function usePiece(draft: CostingDraft) {
  const [pick, setPick] = useState<string>("");
  const key = draft.pieces.some((p) => p.key === pick) ? pick : (draft.pieces[0]?.key ?? "");
  const control =
    draft.pieces.length > 1 ? (
      <Pick label="Piece" value={key} empty="Piece" options={draft.pieces.map((p) => ({ id: p.key, name: p.piece_name || "GARMENT" }))} onPick={(id) => setPick(id)} w="w-32" />
    ) : null;
  return { key, control };
}

export function AddFabric({ draft, onChange, options }: EditProps) {
  const [pick, setPick] = useState<Opt | null>(null);
  return (
    <AddRow
      addLabel="Add fabric"
      add={() => {
        const f = newFabric();
        onChange({ ...draft, fabrics: [...draft.fabrics, { ...f, fabric_id: pick?.id ?? null, quality: pick?.name ?? "" }] });
        setPick(null);
      }}
    >
      <Pick label="Fabric structure" value={pick?.id ?? null} empty="Fabric structure" options={options.fabrics} onPick={(id, name) => setPick({ id, name })} />
    </AddRow>
  );
}

export function AddWeight({ draft, onChange, options, sizes }: EditProps & { sizes: readonly (string | null)[] }) {
  const piece = usePiece(draft);
  const [comp, setComp] = useState<string>("");
  const [fab, setFab] = useState<string>("");
  return (
    <AddRow
      addLabel="Add weight line"
      disabled={!comp}
      add={() => {
        onChange({ ...draft, weights: [...draft.weights, ...newWeightRows(piece.key, [comp], fab || null, sizes)] });
        setComp("");
      }}
    >
      {piece.control}
      <Pick label="Component" value={comp} empty="Component" options={options.components} onPick={(id) => setComp(id)} />
      <Pick label="Fabric" value={fab} empty="Fabric" options={draft.fabrics.map((f, i) => ({ id: f.key, name: f.quality || `Fabric ${i + 1}` }))} onPick={(id) => setFab(id)} />
    </AddRow>
  );
}

export function AddOperation({ draft, onChange, options }: EditProps) {
  const piece = usePiece(draft);
  const [proc, setProc] = useState<string>("");
  return (
    <AddRow
      addLabel="Add operation"
      disabled={!proc}
      add={() => {
        const p = options.garmentProcesses.find((x) => x.id === proc);
        if (!p) return;
        const line = newPieceLine(p.garment_kind, p.id, p.name);
        onChange({ ...draft, pieces: draft.pieces.map((x) => (x.key === piece.key ? { ...x, lines: [...x.lines, line] } : x)) });
        setProc("");
      }}
    >
      {piece.control}
      <Pick label="CMT or embellishment process" value={proc} empty="Process" options={options.garmentProcesses} onPick={(id) => setProc(id)} />
    </AddRow>
  );
}

export function AddTrim({ draft, onChange, options }: EditProps) {
  const piece = usePiece(draft);
  const [item, setItem] = useState<Opt | null>(null);
  return (
    <AddRow
      addLabel="Add trim"
      disabled={!item}
      add={() => {
        if (!item) return;
        onChange({ ...draft, trims: [...draft.trims, newTrim(piece.key, item.id, item.name)] });
        setItem(null);
      }}
    >
      {piece.control}
      <Pick label="Trim or accessory" value={item?.id ?? null} empty="Trim" options={options.trims} onPick={(id, name) => setItem({ id, name })} />
    </AddRow>
  );
}

export function AddCharge({ draft, onChange }: Pick2) {
  return <AddRow addLabel="Add charge" add={() => onChange({ ...draft, extras: [...draft.extras, newExtra("overhead")] })} />;
}
type Pick2 = { draft: CostingDraft; onChange: (next: CostingDraft) => void };
