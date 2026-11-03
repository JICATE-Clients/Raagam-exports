"use client";

import { useState, type ReactNode } from "react";
import { Sheet, type SheetOrigin } from "@/components/ui/sheet";
import { SubSheetFooter } from "@/components/orders/sub-sheet-footer";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { BinPicker } from "@/components/masters/bin-picker";
import { Truncated } from "@/components/ui/truncated";
import { fmtNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { binBalance, pickedBins, splitBinsProblem, type SplitRow } from "@/lib/purchase/bin-split";

/**
 * STORE · BIN, IN A POP-UP (user 2026-11-02, screenshot 161807: "material store inside
 * inline details popup"). A Store select stacked over one bin box per split, inside one grid
 * cell, grew taller with every bin. The cell is now ONE line saying where the goods go —
 * `Material Store · HO-R01-S01 (500 kg)` — and the store and bins are edited in a small
 * sheet opened from it (AGENTS.md "A sub-detail Sheet's size": `sm`, `alignToPane`,
 * `origin`, `SubSheetFooter` — its rows live on the GRN line and the GRN's own Save stores
 * them).
 *
 * The bins follow `lib/purchase/bin-split.ts`: Bin 1 takes the whole accepted qty and no
 * other bin can be added while it does; lower it and a blank row opens for the balance.
 *
 * `BinRowsEditor` is the sheet's body and is also used bare where the store/bin already sit
 * inside a form of their own (Stores ▸ Pending QC).
 */

export type StoreOption = { id: string; name: string };
type BinOption = { id: string; code: string; description?: string | null; inactive?: boolean };

export type BinRowsProps<T extends SplitRow> = {
  /** Names the line in every label ("Bin 1, 24'S BCI COTTON"). */
  description: string;
  stores: StoreOption[];
  storeId: string;
  onStore: (id: string) => void;
  rows: T[];
  onRow: (key: string, patch: Partial<SplitRow>) => void;
  accepted: number;
  uom: string | null;
  bins: BinOption[];
  canCreateBin?: boolean;
  /** A bin made from the picker's "+ Add" — the caller adds it to its list. */
  onBinCreated?: (bin: { id: string; code: string }) => void;
  /** False where the screen draws its own Store field (Pending QC's is mandatory). */
  showStore?: boolean;
};

export function BinRowsEditor<T extends SplitRow>({
  description,
  stores,
  storeId,
  onStore,
  rows,
  onRow,
  accepted,
  uom,
  bins,
  canCreateBin = false,
  onBinCreated,
  showStore = true,
}: BinRowsProps<T>) {
  const balance = binBalance(rows, accepted);
  const problem = splitBinsProblem(rows, accepted);
  const picked = pickedBins(rows);
  const u = uom ? ` ${uom}` : "";
  return (
    <div className="space-y-2">
      {showStore ? (
      <label className="grid w-[12.375rem] gap-0.5">
        <span className="text-xs font-medium text-muted-foreground">Store</span>
        <Select aria-label={`Store, ${description}`} className="w-[12.375rem]" value={storeId} onChange={(e) => onStore(e.target.value)}>
          {stores.length === 0 ? <option value="">No store in this unit</option> : null}
          {stores.map((st) => (
            <option key={st.id} value={st.id}>
              {st.name}
            </option>
          ))}
        </Select>
      </label>
      ) : null}

      <div className="grid gap-1">
        <div className="grid grid-cols-[6rem_6rem] items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <span>Bin</span>
          <span className="text-right">Qty{u}</span>
        </div>
        {rows.map((b, i) => {
          const isTail = !b.binId && picked.length > 0;
          return (
            <div key={b.key} className="grid grid-cols-[6rem_6rem] items-center gap-1.5">
              <BinPicker
                label={`Bin ${i + 1}, ${description}`}
                className="min-w-0"
                bins={bins}
                value={b.binId}
                canCreate={canCreateBin}
                usedIds={picked.map((x) => x.binId)}
                /* ENTER LANDS HERE AND STAYS (user 2026-11-02: "enter closes it, but it should
                   make a new bin entry for the remaining qty"). Enter off Bin 1's qty already
                   moves to this blank row; while a balance is left it is held as invalid, so
                   the next Enter cannot fall through to Done — type a bin code or ↓, and the
                   bin picked takes the balance. */
                invalid={isTail && balance > 0}
                onChange={(v) => onRow(b.key, { binId: v })}
                onCreated={(nb) => {
                  onBinCreated?.(nb);
                  onRow(b.key, { binId: nb.id });
                }}
              />
              {b.binId ? (
                <Input
                  type="number"
                  min={0}
                  inputMode="decimal"
                  aria-label={`Bin ${i + 1} qty, ${description}`}
                  className="text-right tabular-nums"
                  /* A split that does not add up never closes on Enter (focus.ts step 3). */
                  aria-invalid={problem ? true : undefined}
                  value={b.qty}
                  onChange={(e) => onRow(b.key, { qty: e.target.value, typed: true })}
                />
              ) : (
                <span className="text-right text-xs tabular-nums text-muted-foreground">
                  {isTail && balance > 0 ? `${fmtNumber(balance)}${u} left` : ""}
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* Only a problem is said (user 2026-11-02, screenshot 3987: "remove it, complicated") —
          no standing hint, no "Balanced" line. */}
      {problem ? (
        <p className="text-xs text-danger" role="alert">
          {problem}
        </p>
      ) : null}
    </div>
  );
}

/** What the cell says: `Material Store · HO-R01-S01 (500 kg)`, or `· 2 bins`. */
function summary<T extends SplitRow>(p: BinRowsProps<T>): string {
  const store = p.stores.find((s) => s.id === p.storeId)?.name ?? "No store";
  const picked = pickedBins(p.rows);
  if (picked.length === 0) return `${store} · no bin`;
  if (picked.length > 1) return `${store} · ${picked.length} bins`;
  const code = p.bins.find((b) => b.id === picked[0].binId)?.code ?? "bin";
  return `${store} · ${code} (${fmtNumber(Number(picked[0].qty) || 0)}${p.uom ? ` ${p.uom}` : ""})`;
}

/**
 * The grid cell: one line, opens the sheet. A FIELD for the keyboard contract
 * (`data-field-trigger`: Tab stops here, ↓ opens) whose value is what it opens
 * (`data-enter-opens`: Enter opens rather than stepping past — file-attachments.tsx).
 */
export function StoreBinCell<T extends SplitRow>(props: BinRowsProps<T> & { id?: string; parent?: string }) {
  return (
    <StoreBinTrigger
      id={props.id}
      text={summary(props)}
      problem={splitBinsProblem(props.rows, props.accepted)}
      description={props.description}
      parent={props.parent ?? "GRN"}
    >
      <BinRowsEditor {...props} />
    </StoreBinTrigger>
  );
}

/**
 * ONE STORE, ONE BIN — THE SAME CELL (user 2026-11-03, screenshot 095545: "this ui button
 * for all procurement material bin concept apply this"). The DC send / receive / return
 * screens save ONE store and ONE bin per line, so they cannot use the split editor; they
 * used to draw a Store select and a Bin select side by side. This is the same one-line
 * button and the same small sheet, holding a Store select (when the screen has one to
 * choose) and one BinPicker. `note` is a muted line under the button ("in stock 120").
 */
export function StoreBinPickCell({
  id,
  description,
  parent,
  stores,
  storeId = "",
  onStore,
  storeLabel = "Store",
  allowNoStore = false,
  bins,
  binId,
  onBin,
  canCreateBin = false,
  onBinCreated,
  note,
}: {
  id?: string;
  description: string;
  /** The document whose Save stores the pick ("DC", "Return"…). */
  parent: string;
  /** Omit where the store is fixed by the screen — the cell then edits the bin only. */
  stores?: StoreOption[];
  storeId?: string;
  onStore?: (id: string) => void;
  storeLabel?: string;
  /** Offer a blank "—" store (a line that may go back to no store). Off: the select lists stores only. */
  allowNoStore?: boolean;
  bins: BinOption[];
  binId: string;
  onBin: (id: string) => void;
  canCreateBin?: boolean;
  onBinCreated?: (bin: { id: string; code: string }) => void;
  note?: ReactNode;
}) {
  const store = stores ? (stores.find((s) => s.id === storeId)?.name ?? "No store") : null;
  const code = binId ? (bins.find((b) => b.id === binId)?.code ?? "bin") : "no bin";
  const text = store ? `${store} · ${code}` : code;
  return (
    <StoreBinTrigger id={id} text={text} problem={null} description={description} parent={parent} note={note}>
      <div className="space-y-2">
        {stores && onStore ? (
          <label className="grid gap-0.5">
            <span className="text-xs font-medium text-muted-foreground">{storeLabel}</span>
            <Select aria-label={`${storeLabel}, ${description}`} value={storeId} onChange={(e) => onStore(e.target.value)}>
              {stores.length === 0 ? <option value="">No store in this unit</option> : allowNoStore ? <option value="">—</option> : null}
              {stores.map((st) => (
                <option key={st.id} value={st.id}>
                  {st.name}
                </option>
              ))}
            </Select>
          </label>
        ) : null}
        <div className="grid gap-0.5">
          <span className="text-xs font-medium text-muted-foreground">Bin</span>
          <BinPicker
            label={`Bin, ${description}`}
            bins={bins}
            value={binId}
            canCreate={canCreateBin}
            onChange={onBin}
            onCreated={(nb) => {
              onBinCreated?.(nb);
              onBin(nb.id);
            }}
          />
        </div>
      </div>
    </StoreBinTrigger>
  );
}

/**
 * The grid cell both variants share: one line, opens the sheet. A FIELD for the keyboard
 * contract (`data-field-trigger`: Tab stops here, ↓ opens) whose value is what it opens
 * (`data-enter-opens`: Enter opens rather than stepping past — file-attachments.tsx).
 */
function StoreBinTrigger({
  id,
  text,
  problem,
  description,
  parent,
  note,
  children,
}: {
  id?: string;
  text: string;
  problem: string | null;
  description: string;
  parent: string;
  note?: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [origin, setOrigin] = useState<SheetOrigin | null>(null);
  return (
    <div className="grid gap-0.5">
      <button
        type="button"
        id={id}
        data-field-trigger
        data-enter-opens
        aria-haspopup="dialog"
        aria-label={`Store and bin, ${description}: ${text}${problem ? ` — ${problem}` : ""}`}
        onClick={(e) => {
          setOrigin(e.currentTarget.getBoundingClientRect());
          setOpen(true);
        }}
        className={cn(
          "flex h-8 w-full min-w-0 items-center rounded-control border bg-surface px-2 text-left text-xs",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          problem
            ? "border-danger"
            : // On a flat sheet grid the cell IS the field (globals.css data-grid-cells="flat").
              "border-border hover:border-primary/50 [[data-grid-cells=flat]_&]:border-transparent",
          "[[data-grid-cells=flat]_&]:rounded-none [[data-grid-cells=flat]_&]:bg-transparent",
        )}
      >
        <Truncated text={text} className="min-w-0" />
      </button>
      {problem ? <span className="text-[11px] text-danger">{problem}</span> : null}
      {note ? <span className="text-[11px] tabular-nums text-muted-foreground">{note}</span> : null}
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title="Store · Bin"
        size="sm"
        /* SHRUNK TO ITS CONTENT (user 2026-11-02: "shrink it", "compact it more", "Bin 1 —
           remove it", then "bin field the same size as qty"): Bin 96 + Qty 96 + 6 gap = 198px,
           Store spans both; + px-5 and the border = 240 → 15.5rem. A long bin code ellipsises
           and reveals on hover (the picker's own Truncated). */
        maxWidthClass="max-w-[15.5rem]"
        alignToPane
        origin={origin}
        footer={<SubSheetFooter onDone={() => setOpen(false)} parent={parent} />}
      >
        <Truncated text={description} className="mb-1.5 block text-[11px] text-muted-foreground" />
        {children}
      </Sheet>
    </div>
  );
}
