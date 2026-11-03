"use client";

import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";
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
type BinOption = { id: string; code: string; description?: string | null; inactive?: boolean; store_id?: string | null };

/**
 * THE BIN LIST FOLLOWS THE STORE (0800, user 2026-11-03: "the Bin dropdown displays only
 * the bins mapped to that selected Store"). Every bin now belongs to a store, so stock can
 * never be put in a rack of a different store room. A bin the line ALREADY holds stays
 * offered even if it sits elsewhere, so an old record's value is never blanked (the same
 * rule as a disabled master row, AGENTS.md "Disabled rows").
 */
function binsOfStore(bins: BinOption[], storeId: string, keep: string[]): BinOption[] {
  return bins.filter((b) => b.store_id === storeId || keep.includes(b.id));
}

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
  onBinCreated?: (bin: { id: string; code: string; store_id: string | null }) => void;
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
  const storeBins = binsOfStore(bins, storeId, picked.map((x) => x.binId));
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
                bins={storeBins}
                storeId={storeId || null}
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
export function StoreBinCell<T extends SplitRow>(
  props: BinRowsProps<T> & {
    id?: string;
    parent?: string;
    /**
     * STORE AND BIN RIGHT IN THE ROW (user 2026-11-03, via the GRN session): the Store
     * select over the Bin picker, the Bin list only that store's bins, instead of one
     * pop-up button that truncated to "Material Store · n…". Stacked, not side by side:
     * the column stays 144px so the GRN grid keeps its 896px switch (two boxes side by
     * side need ~210). A "Split bins…" link opens the same pop-up; a line already split
     * across several bins shows the pop-up button as before.
     */
    inline?: boolean;
  },
) {
  const problem = splitBinsProblem(props.rows, props.accepted);
  const picked = pickedBins(props.rows);
  const first = props.rows[0];
  const inline = !!props.inline && picked.length <= 1 && !!first;
  return (
    <StoreBinTrigger
      id={props.id}
      text={summary(props)}
      problem={problem}
      description={props.description}
      parent={props.parent ?? "GRN"}
      opener={
        inline
          ? (openSheet) => (
              <div className="grid gap-1">
                <Select
                  id={props.id}
                  aria-label={`Store, ${props.description}`}
                  className="h-8"
                  value={props.storeId}
                  onChange={(e) => {
                    const next = e.target.value;
                    props.onStore(next);
                    // The bin held must be in the new store, or it goes (0800).
                    const held = first.binId ? props.bins.find((b) => b.id === first.binId) : null;
                    if (held && held.store_id !== next) props.onRow(first.key, { binId: "" });
                  }}
                >
                  {props.stores.length === 0 ? <option value="">No store in this unit</option> : null}
                  {props.stores.map((st) => (
                    <option key={st.id} value={st.id}>
                      {st.name}
                    </option>
                  ))}
                </Select>
                <BinPicker
                  label={`Bin, ${props.description}`}
                  className="min-w-0"
                  bins={binsOfStore(props.bins, props.storeId, first.binId ? [first.binId] : [])}
                  storeId={props.storeId || null}
                  value={first.binId}
                  canCreate={props.canCreateBin}
                  onChange={(v) => props.onRow(first.key, { binId: v })}
                  onCreated={(nb) => {
                    props.onBinCreated?.(nb);
                    props.onRow(first.key, { binId: nb.id });
                  }}
                />
                {/* button-shape: exempt -- an inline text link opening the bin-split pop-up */}
                <button
                  type="button"
                  tabIndex={-1}
                  className="justify-self-start text-[11px] text-primary hover:underline"
                  onClick={(e) => openSheet(e.currentTarget.getBoundingClientRect())}
                >
                  Split bins…
                </button>
              </div>
            )
          : undefined
      }
    >
      <BinRowsEditor {...props} />
    </StoreBinTrigger>
  );
}

/**
 * BIN · QTY, RIGHT IN THE ROW — NO STORE (user 2026-11-03, GRN entry: "Store · Bin rename the
 * field as Bin, no need to ask store details again, just list the bin and qty field inside …
 * no need the first bin auto-consume, allow it as user entry, just list bin near qty field").
 * The store is the GRN's Received Store (the header), so the line asks only WHERE in it: one
 * row per bin, the Bin picker (that store's bins, 0800) with its Qty box beside it. Nothing is
 * pre-filled — the operator types each bin's qty — and a blank bin row waits under the picked
 * ones while they hold less than the accepted qty (`withTailBin(…, false)`). The bins must
 * still hold the accepted qty exactly (`splitBinsProblem`, re-checked by grn_post).
 */
export function BinQtyCell<T extends SplitRow>({
  description,
  storeId,
  rows,
  onRow,
  accepted,
  uom,
  bins,
  canCreateBin = false,
  onBinCreated,
}: Omit<BinRowsProps<T>, "stores" | "onStore" | "showStore">) {
  const balance = binBalance(rows, accepted);
  const problem = splitBinsProblem(rows, accepted);
  const picked = pickedBins(rows);
  const u = uom ? ` ${uom}` : "";
  const storeBins = binsOfStore(bins, storeId, picked.map((x) => x.binId));
  const rootRef = useRef<HTMLDivElement>(null);
  /** Enter on the LAST bin's Qty with qty still left: ask for the next bin row (bin-split.ts
   *  `more`) and land in its Bin box. Otherwise Enter does what it always does — moves on. */
  const askMore = (e: KeyboardEvent<HTMLInputElement>, key: string, isLast: boolean) => {
    if (e.key !== "Enter" || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;
    if (!isLast || balance <= 0 || !(Number(e.currentTarget.value) > 0)) return;
    e.preventDefault();
    e.stopPropagation();
    onRow(key, { more: true });
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const tail = rootRef.current?.querySelector<HTMLElement>("[data-bin-tail] input, [data-bin-tail] [role='combobox']");
        tail?.focus();
      }),
    );
  };
  return (
    <div ref={rootRef} className="grid gap-1">
      {rows.map((b, i) => {
        const isTail = !b.binId && picked.length > 0;
        const isLastPicked = !!b.binId && b.key === picked[picked.length - 1]?.key;
        return (
          <div
            key={b.key}
            data-bin-tail={isTail || undefined}
            className="grid grid-cols-[minmax(0,1fr)_4.5rem] items-center gap-1"
          >
            <BinPicker
              label={`Bin ${i + 1}, ${description}`}
              className="min-w-0"
              bins={storeBins}
              storeId={storeId || null}
              value={b.binId}
              canCreate={canCreateBin}
              usedIds={picked.map((x) => x.binId)}
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
                placeholder="Qty"
                className="h-8 text-right tabular-nums"
                aria-invalid={problem ? true : undefined}
                value={b.qty}
                onChange={(e) => onRow(b.key, { qty: e.target.value, typed: true })}
                onKeyDown={(e) => askMore(e, b.key, isLastPicked)}
              />
            ) : (
              <span className="text-right text-[11px] tabular-nums text-muted-foreground">
                {isTail && balance > 0 ? `${fmtNumber(balance)}${u} left` : ""}
              </span>
            )}
          </div>
        );
      })}
      {problem && picked.some((r) => r.typed) ? (
        <p className="text-[11px] text-danger" role="alert">
          {problem}
        </p>
      ) : null}
    </div>
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
  onBinCreated?: (bin: { id: string; code: string; store_id: string | null }) => void;
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
            bins={binsOfStore(bins, storeId, binId ? [binId] : [])}
            storeId={storeId || null}
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
  opener,
}: {
  id?: string;
  text: string;
  problem: string | null;
  description: string;
  parent: string;
  note?: ReactNode;
  children: ReactNode;
  /** Replaces the one-line button with the caller's own controls; it is handed the
   *  function that opens the same sheet (the GRN's inline Store / Bin + "Split bins…"). */
  opener?: (openSheet: (rect: DOMRect) => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [origin, setOrigin] = useState<SheetOrigin | null>(null);
  const openSheet = (rect: DOMRect) => {
    setOrigin(rect);
    setOpen(true);
  };
  return (
    <div className="grid gap-0.5">
      {opener ? opener(openSheet) : (
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
      )}
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
