"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createGrn } from "@/lib/purchase/grn-actions";
import { useToast } from "@/components/ui/toast";
import { ChildGrid, type ChildGridColumn } from "@/components/masters/child-grid";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { Field, FieldError, FieldRow, FIELD_WIDTH_CSS } from "@/components/ui/field";
import { StatusPill, type StatusTone } from "@/components/ui/status-pill";
import { Truncated } from "@/components/ui/truncated";
import { Card, CardHeader, CardTitle, CardBody } from "@/components/ui/card";
import { QcFailedSheet, type QcFailChoice } from "@/components/purchase/qc-failed-sheet";
import type { GrnBinOption, GrnStoreOption, OpenPoLine, ReplacementDue } from "@/lib/purchase/grn-service";
import type { QcStatus } from "@/lib/purchase/types";
import { acceptedFrom } from "@/lib/purchase/grn-tolerance";
import { focusField } from "@/lib/focus";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { today } from "@/lib/calendar";
import { fmtNumber } from "@/lib/format";

/**
 * STORE KEEPER GRN ENTRY (2026-09-23; reworked 2026-10-31 to the user's GRN rules).
 *
 * Header, one row: Store Location (the working unit) · GRN Date · Vendor · Document Type
 * (Invoice / DC / Replacement) · PO No — or, for a Replacement, the Replacement DC it fills,
 * which LOCKS the vendor to that DC's — · the vendor's document No · its Date (today).
 * Picking the PO loads EVERY line with something pending; the cursor lands on the first
 * row's Today Recd.
 *
 * THE LINE RULES (user 2026-10-31):
 *  - EXCESS LOCKED. Today Recd may not exceed the line's pending balance (ordered − closed
 *    − received − owed back as a replacement). No tolerance band, no override: the box
 *    says so in red and Save waits. `createGrn` refuses the same.
 *  - CLOSE BALANCE. Short of the balance, a "Close bal." tick says the vendor will not send
 *    the rest; on post the remainder closes (0782) without reopening the requirement.
 *  - QC opens on PASSED. FAILED asks first (`QcFailedSheet`): failed qty, reason, and
 *    Rejection (debit note + Rejection DC + requirement reopens) or Replacement
 *    (Replacement DC, no debit, vendor resends).
 *  - BIN SPLIT. "+ Split" puts the accepted qty into several bins; the split must add up
 *    to the accepted qty exactly (0782's `grn_line_bins`, re-checked by `grn_post`).
 *
 * TAB IS THE CONTRACT'S, NOT THIS FILE'S. Inside the grid `tabAlongRow` walks the row's
 * fields; QC and Close bal. sit under `data-focus-optional`, so Tab runs Today Recd → Bin
 * → Lot No → the next row's Today Recd. No keydown handler here.
 */

type DocType = "invoice" | "dc" | "replacement";

interface BinSplit {
  key: string;
  binId: string;
  /** Only typed once the line is split; a single bin takes the whole accepted qty. */
  qty: string;
}

interface DraftLine {
  key: string;
  poLineItemId: string;
  purchaseOrderId: string;
  description: string;
  uomCode: string | null;
  ordered: number;
  receivedSoFar: number;
  /** The most Today Recd may be: what is still pending on this line for THIS GRN. */
  pending: number;
  todayRecd: string;
  /** The vendor's lot (user 2026-10-31: "Lot No", was Roll / Batch) — stored in roll_batch_no. */
  rollBatchNo: string;
  qcStatus: QcStatus;
  /** Set by the QC Failed popup: the failed qty, why, and Rejection / Replacement. */
  fail: QcFailChoice | null;
  /** Vendor will not send the rest — close the balance on post (0782). */
  closeBalance: boolean;
  /** Where the accepted goods go (grn.md §2A) — opens on the unit's material store. */
  storeId: string;
  bins: BinSplit[];
}

let splitSeq = 0;
const newSplit = (binId = ""): BinSplit => ({ key: `s${++splitSeq}`, binId, qty: "" });

/** Owed back as a replacement, per PO line — that qty comes in on its DC's row, not here. */
function owedByLine(replacements: ReplacementDue[]): Map<string, number> {
  const owed = new Map<string, number>();
  for (const d of replacements) for (const x of d.lines) owed.set(x.po_line_item_id, (owed.get(x.po_line_item_id) ?? 0) + x.due);
  return owed;
}

/**
 * A PO's lines as the grid's rows, in the PO's own order — only lines with something
 * pending. For a Replacement, only the DC's owed lines, each capped at what it owes.
 */
function linesOfPo(
  openPoLines: OpenPoLine[],
  poId: string,
  defaultStoreId: string | null,
  owed: Map<string, number>,
  repl: ReplacementDue | null,
): DraftLine[] {
  const due = new Map((repl?.lines ?? []).map((x) => [x.po_line_item_id, x.due]));
  return openPoLines
    .filter((l) => l.purchase_order_id === poId)
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((l) => ({
      key: l.id,
      poLineItemId: l.id,
      purchaseOrderId: l.purchase_order_id,
      description: l.description,
      uomCode: l.uom_code,
      ordered: l.quantity,
      receivedSoFar: l.received_qty,
      pending: repl ? (due.get(l.id) ?? 0) : Math.max(0, l.open_balance - (owed.get(l.id) ?? 0)),
      todayRecd: "",
      rollBatchNo: "",
      qcStatus: "passed" as QcStatus,
      fail: null,
      closeBalance: false,
      storeId: defaultStoreId ?? "",
      bins: [newSplit()],
    }))
    .filter((l) => l.pending > 1e-9);
}

const QC_OPTIONS: { value: QcStatus; label: string }[] = [
  { value: "passed", label: "Passed" },
  { value: "failed", label: "Failed" },
  { value: "pending", label: "Pending" },
];

function num(s: string): number {
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;
const accepted = (l: DraftLine) => acceptedFrom(num(l.todayRecd), l.fail?.qty ?? 0);

/** The line's own refusals — each shown UNDER the field it is about. */
function excessProblem(l: DraftLine): string | null {
  return num(l.todayRecd) > l.pending + 1e-9
    ? `Excess quantity blocked: at most ${fmtNumber(l.pending)} is pending`
    : null;
}
function failProblem(l: DraftLine): string | null {
  return l.fail && l.fail.qty > num(l.todayRecd) ? "Failed qty is more than Today Recd" : null;
}
function splitProblem(l: DraftLine): string | null {
  if (l.bins.length < 2 || num(l.todayRecd) <= 0) return null;
  if (l.bins.some((b) => !b.binId)) return "Pick a bin on every split";
  const held = round3(l.bins.reduce((a, b) => a + num(b.qty), 0));
  const want = round3(accepted(l));
  return held === want ? null : `Bins hold ${fmtNumber(held)} — must be ${fmtNumber(want)}`;
}

/** Part / Exact, read off the pending balance (excess is refused, so there is no "over"). */
function lineStatus(l: DraftLine): { tone: StatusTone; label: string } | null {
  const t = num(l.todayRecd);
  if (t <= 0) return null;
  if (excessProblem(l)) return { tone: "danger", label: "Excess" };
  if (round3(t) === round3(l.pending)) return { tone: "success", label: "Full" };
  return l.closeBalance ? { tone: "neutral", label: "Closed" } : { tone: "info", label: "Part" };
}

interface Props {
  openPoLines: OpenPoLine[];
  locations: { id: string; code: string; name: string; postable: boolean }[];
  defaultLocationId: string | null;
  /** The working unit's stores and bins — the line's Store and Bin pickers (0777). */
  stores: GrnStoreOption[];
  bins: GrnBinOption[];
  defaultStoreId: string | null;
  /** Replacement DCs still owed — the Replacement document type picks one (0781). */
  replacements?: ReplacementDue[];
  /** Opened from a Pending row on the Receiving list: that PO, already loaded. */
  initialPoId?: string | null;
  /** Opened from the list's New GRN with one vendor filtered: that vendor, already chosen. */
  initialVendorId?: string | null;
  /** Back to the Receiving list (embedded); omitted = the standalone /new page. */
  onCancel?: () => void;
  /** Opened from a Replacement DC's Pending row: that DC, already chosen. */
  replacement?: ReplacementDue | null;
}

export function GrnNewForm({
  openPoLines,
  locations,
  defaultLocationId,
  stores,
  bins,
  defaultStoreId,
  replacements = [],
  initialPoId = null,
  initialVendorId = null,
  onCancel,
  replacement = null,
}: Props) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();
  const owed = owedByLine(replacements);

  /** The PO a Replacement DC's owed lines belong to (one GRN, one PO). */
  const poOfRepl = (r: ReplacementDue | null) =>
    r ? (openPoLines.find((l) => l.id === r.lines[0]?.po_line_item_id)?.purchase_order_id ?? null) : null;
  const startPoId = poOfRepl(replacement) ?? initialPoId;

  const [locationId, setLocationId] = useState(defaultLocationId ?? "");
  const [grnDate, setGrnDate] = useState(() => today());
  /* THE VENDOR'S PAPER (user 2026-10-31): ONE document came with the goods — an Invoice, a
     Delivery Challan, or a Replacement delivery against our Replacement DC. One type, one
     number, one date (today unless changed). An Invoice is stored in invoice_no, a DC or a
     replacement's challan in dc_no, the date in invoice_date either way. */
  const [docType, setDocType] = useState<DocType>(replacement ? "replacement" : "invoice");
  const [docNo, setDocNo] = useState("");
  const [docDate, setDocDate] = useState(() => today());
  const [repl, setRepl] = useState<ReplacementDue | null>(replacement);
  const [vendorId, setVendorId] = useState(
    () =>
      replacement?.vendor_id ||
      ((startPoId ? openPoLines.find((l) => l.purchase_order_id === startPoId)?.vendor_id : null) ?? initialVendorId ?? ""),
  );
  const [poId, setPoId] = useState(startPoId ?? "");
  const [lines, setLines] = useState<DraftLine[]>(() =>
    startPoId ? linesOfPo(openPoLines, startPoId, defaultStoreId, owed, replacement) : [],
  );
  const [dirty, setDirty] = useState(false);
  const gridRef = useRef<HTMLDivElement>(null);
  const [landToken, setLandToken] = useState(startPoId ? 1 : 0);
  /** The line whose QC was just set to Failed — its popup is open. */
  const [failKey, setFailKey] = useState<string | null>(null);
  const [failSeq, setFailSeq] = useState(0);

  useUnsavedGuard(dirty || isPending);

  /* THE CURSOR LANDS ON THE FIRST ROW'S TODAY RECD once a PO's lines arrive.
     A focus move after a render, not a key handler: `focusField` is the
     contract's own mover (caret placed, so → still works). */
  useEffect(() => {
    if (landToken === 0) return;
    const el = gridRef.current?.querySelector<HTMLElement>("[data-grn-today]");
    if (el) focusField(el);
  }, [landToken]);

  const isRepl = docType === "replacement";

  // ---------- options ----------
  const locationOptions: ComboboxOption[] = locations.map((l) => ({
    value: l.id,
    label: l.name,
    search: l.code,
    disabled: !l.postable,
    disabledNote: l.postable ? undefined : "(switch unit in the top bar)",
  }));

  // One entry per open PO with something still to receive on it (not just owed back).
  const pos = new Map<string, { id: string; code: string | null; vendorId: string; vendorName: string }>();
  for (const l of openPoLines) {
    if (l.open_balance - (owed.get(l.id) ?? 0) <= 1e-9) continue;
    if (!pos.has(l.purchase_order_id)) {
      pos.set(l.purchase_order_id, { id: l.purchase_order_id, code: l.po_code, vendorId: l.vendor_id, vendorName: l.vendor_name });
    }
  }
  /* ONLY VENDORS WITH SOMETHING TO DELIVER (grn.md §1, 0777) — on a Replacement, only
     vendors owed a replacement. */
  const vendorPairs: [string, string][] = isRepl
    ? replacements.map((r) => [r.vendor_id, r.vendor_name])
    : Array.from(pos.values()).filter((p) => p.vendorId).map((p) => [p.vendorId, p.vendorName]);
  const vendorOptions: ComboboxOption[] = Array.from(new Map(vendorPairs).entries())
    .sort((a, b) => a[1].localeCompare(b[1]))
    .map(([value, label]) => ({ value, label }));
  const poOptions: ComboboxOption[] = Array.from(pos.values())
    .filter((p) => !vendorId || p.vendorId === vendorId)
    .map((p) => ({ value: p.id, label: p.code ?? "(no number)", sublabel: vendorId ? undefined : p.vendorName, search: p.vendorName }));
  const replOptions: ComboboxOption[] = replacements
    .filter((r) => !vendorId || r.vendor_id === vendorId)
    .map((r) => ({
      value: r.id,
      label: r.code ?? "(no number)",
      sublabel: vendorId ? r.grn_code ?? undefined : r.vendor_name,
      search: `${r.vendor_name} ${r.grn_code ?? ""}`,
    }));

  // ---------- edits ----------
  function touch() {
    setDirty(true);
  }

  function loadPo(nextPoId: string) {
    setPoId(nextPoId);
    if (!nextPoId) {
      setLines([]);
      return;
    }
    const po = pos.get(nextPoId);
    if (po && po.vendorId !== vendorId) setVendorId(po.vendorId);
    setLines(linesOfPo(openPoLines, nextPoId, defaultStoreId, owed, null));
    setLandToken((t) => t + 1);
  }

  /* PICKING THE REPLACEMENT DC LOCKS THE VENDOR to the one the goods went back to, and
     loads only what that DC still owes. */
  function loadRepl(id: string) {
    const r = replacements.find((x) => x.id === id) ?? null;
    setRepl(r);
    if (!r) {
      setPoId("");
      setLines([]);
      return;
    }
    setVendorId(r.vendor_id);
    const p = poOfRepl(r) ?? "";
    setPoId(p);
    setLines(p ? linesOfPo(openPoLines, p, defaultStoreId, owed, r) : []);
    setLandToken((t) => t + 1);
  }

  function changeDocType(next: DocType) {
    touch();
    if ((next === "replacement") !== isRepl) {
      // Switching between buying and replacing starts the document over.
      setRepl(null);
      setPoId("");
      setLines([]);
    }
    setDocType(next);
  }

  function updateLine(key: string, patch: Partial<Omit<DraftLine, "key">>) {
    touch();
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }
  function updateSplit(lineKey: string, splitKey: string, patch: Partial<Omit<BinSplit, "key">>) {
    touch();
    setLines((prev) =>
      prev.map((l) => (l.key === lineKey ? { ...l, bins: l.bins.map((b) => (b.key === splitKey ? { ...b, ...patch } : b)) } : l)),
    );
  }

  // ---------- derived ----------
  const receiving = lines.filter((l) => num(l.todayRecd) > 0);
  const location = locations.find((l) => l.id === locationId);
  const lineProblems = receiving.some((l) => excessProblem(l) || failProblem(l) || splitProblem(l));
  const failLine = failKey ? (lines.find((l) => l.key === failKey) ?? null) : null;
  const canSave =
    !isPending &&
    !!location?.postable &&
    !!grnDate &&
    !!vendorId &&
    !!poId &&
    (!isRepl || !!repl) &&
    receiving.length > 0 &&
    !lineProblems;

  function handleSave() {
    if (!canSave) return;
    startTransition(async () => {
      const result = await createGrn({
        master_vendor_id: vendorId,
        location_id: locationId || null,
        grn_date: grnDate,
        invoice_no: docType === "invoice" ? docNo.trim() || null : null,
        invoice_date: docDate || null,
        dc_no: docType !== "invoice" ? docNo.trim() || null : null,
        kind: isRepl ? "replacement" : "regular",
        vendor_return_id: isRepl ? (repl?.id ?? null) : null,
        notes: null,
        over_receipt_reason: null,
        lines: receiving.map((l, i) => {
          const received = num(l.todayRecd);
          const rejected = l.fail?.qty ?? 0;
          const acc = acceptedFrom(received, rejected);
          const split = l.bins.length > 1;
          return {
            po_line_item_id: l.poLineItemId,
            purchase_order_id: l.purchaseOrderId,
            description: l.description,
            received_qty: received,
            // Derived, never typed — and recomputed by the action regardless.
            accepted_qty: acc,
            rejected_qty: rejected,
            qc_status: l.qcStatus,
            rejection_reason: l.fail?.reason || null,
            // A replacement's own failure is still owed on the same DC (the action re-forces it).
            rejection_action: isRepl ? "replace" : (l.fail?.action ?? "replace"),
            roll_batch_no: l.rollBatchNo.trim() || null,
            store_id: l.storeId || null,
            bin_id: split ? null : l.bins[0]?.binId || null,
            bins: split ? l.bins.map((b) => ({ bin_id: b.binId, qty: num(b.qty) })) : [],
            close_balance: !isRepl && l.closeBalance && received < l.pending,
            sort_order: i,
          };
        }),
      });

      if (result.ok) {
        setDirty(false);
        success("GRN saved as draft");
        router.push(`/purchase/grn/${result.grnId}`);
      } else {
        toastError(result.error);
      }
    });
  }

  /*
   * Item 176 · PO Qty 112 · Today 112 · Store 112 · Bin 176 · Lot No 112 · QC 112 ·
   * Close bal. 88 · Status 88 = 1088, + 40 chrome (the `#`; no ✕ — `hideRemove`, the rows
   * are the PO's own lines) = 1128 <= 1155 -> tableFrom="5xl". Bin is `term` for its split
   * rows (bin + qty + ✕); Today is `range` for its excess message.
   */
  const grnLineColumns: ChildGridColumn<DraftLine>[] = [
    {
      header: "Item Description",
      width: FIELD_WIDTH_CSS.term,
      cell: (l) => <Truncated className="text-sm">{l.description}</Truncated>,
    },
    {
      // PO QTY AND ITS UNIT, and what is still pending for this GRN — one cell, two lines.
      header: isRepl ? "Owed" : "PO Qty",
      width: FIELD_WIDTH_CSS.range,
      align: "right",
      cell: (l) => (
        <div className="text-right leading-tight">
          <div className="tabular-nums text-sm">
            {fmtNumber(isRepl ? l.pending : l.ordered)} <span className="text-xs text-muted-foreground">{l.uomCode ?? ""}</span>
          </div>
          {isRepl ? null : (
            <div className="text-[11px] tabular-nums text-muted-foreground">pending {fmtNumber(l.pending)}</div>
          )}
        </div>
      ),
    },
    {
      header: "Today Recd",
      width: FIELD_WIDTH_CSS.range,
      cell: (l) => {
        const problem = excessProblem(l);
        return (
          <>
            <Input
              type="number"
              min={0}
              max={l.pending}
              inputMode="decimal"
              data-grn-today
              aria-label={`Today Recd, ${l.description}`}
              aria-invalid={problem ? true : undefined}
              aria-describedby={problem ? `grn-today-${l.key}-error` : undefined}
              className="h-8 text-right tabular-nums"
              value={l.todayRecd}
              onChange={(e) => updateLine(l.key, { todayRecd: e.target.value })}
            />
            <FieldError id={`grn-today-${l.key}-error`}>{problem}</FieldError>
          </>
        );
      },
    },
    {
      // WHERE IT IS PUT (grn.md §2A): the unit's store — opens on the material store.
      header: "Store",
      width: FIELD_WIDTH_CSS.range,
      cell: (l) => (
        <div data-focus-optional>
          <Select
            aria-label={`Store, ${l.description}`}
            className="h-8"
            value={l.storeId}
            onChange={(e) => updateLine(l.key, { storeId: e.target.value })}
          >
            {stores.length === 0 ? <option value="">No store in this unit</option> : null}
            {stores.map((st) => (
              <option key={st.id} value={st.id}>
                {st.name}
              </option>
            ))}
          </Select>
        </div>
      ),
    },
    {
      // ONE BIN, OR SPLIT ACROSS SEVERAL (0782): a split row is bin + qty + ✕, and the
      // split must hold exactly the accepted qty.
      header: "Bin",
      width: FIELD_WIDTH_CSS.term,
      cell: (l) => {
        const split = l.bins.length > 1;
        const problem = splitProblem(l);
        return (
          <div className="space-y-1">
            {l.bins.map((b, i) => (
              <div key={b.key} className="flex items-center gap-1">
                <Select
                  aria-label={`Bin ${i + 1}, ${l.description}`}
                  className="h-8 min-w-0 flex-1"
                  value={b.binId}
                  onChange={(e) => updateSplit(l.key, b.key, { binId: e.target.value })}
                >
                  <option value="">{bins.length === 0 ? "No bins yet" : "—"}</option>
                  {bins.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.code}
                    </option>
                  ))}
                </Select>
                {split ? (
                  <>
                    <Input
                      type="number"
                      min={0}
                      inputMode="decimal"
                      aria-label={`Bin ${i + 1} qty, ${l.description}`}
                      className="h-8 w-16 text-right tabular-nums"
                      value={b.qty}
                      onChange={(e) => updateSplit(l.key, b.key, { qty: e.target.value })}
                    />
                    {/* button-shape: exempt -- the split row's own ✕, a glyph not an action button */}
                    <button
                      type="button"
                      data-row-remove
                      aria-label={`Remove bin ${i + 1}, ${l.description}`}
                      tabIndex={-1}
                      className="px-1 text-xs text-muted-foreground hover:text-danger"
                      onClick={() => updateLine(l.key, { bins: l.bins.filter((x) => x.key !== b.key) })}
                    >
                      ✕
                    </button>
                  </>
                ) : null}
              </div>
            ))}
            {bins.length > 1 ? (
              // button-shape: exempt -- an inline text link adding a split row under the bin
              <button
                type="button"
                tabIndex={-1}
                className="text-[11px] font-semibold text-primary hover:underline"
                onClick={() => {
                  touch();
                  // The first bin takes the accepted qty so far, so the split starts adding up.
                  setLines((prev) =>
                    prev.map((x) =>
                      x.key !== l.key
                        ? x
                        : {
                            ...x,
                            bins:
                              x.bins.length === 1
                                ? [{ ...x.bins[0], qty: num(x.todayRecd) > 0 ? String(round3(accepted(x))) : "" }, newSplit()]
                                : [...x.bins, newSplit()],
                          },
                    ),
                  );
                }}
              >
                + Split bin
              </button>
            ) : null}
            <FieldError id={`grn-bins-${l.key}-error`}>{problem}</FieldError>
          </div>
        );
      },
    },
    {
      header: "Lot No",
      width: FIELD_WIDTH_CSS.range,
      cell: (l) => (
        <Input
          aria-label={`Lot No, ${l.description}`}
          className="h-8"
          value={l.rollBatchNo}
          onChange={(e) => updateLine(l.key, { rollBatchNo: e.target.value })}
        />
      ),
    },
    {
      header: "QC",
      width: FIELD_WIDTH_CSS.range,
      // Off the typing path: the arrows and the mouse reach it, Tab steps over.
      cell: (l) => (
        <div data-focus-optional>
          <Select
            aria-label={`QC status, ${l.description}`}
            className="h-8"
            value={l.qcStatus}
            onChange={(e) => {
              const next = e.target.value as QcStatus;
              // FAILED ASKS FIRST (user 2026-10-31): Rejection or Replacement, in a popup.
              // The status only becomes Failed once the popup is confirmed.
              if (next === "failed") {
                setFailKey(l.key);
                setFailSeq((n) => n + 1);
                return;
              }
              updateLine(l.key, { qcStatus: next, fail: null });
            }}
          >
            {QC_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
          {l.fail ? (
            // button-shape: exempt -- an inline text link reopening the line's QC Failed choice
            <button
              type="button"
              tabIndex={-1}
              className="mt-0.5 block text-left text-[11px] text-danger hover:underline"
              onClick={() => {
                setFailKey(l.key);
                setFailSeq((n) => n + 1);
              }}
            >
              {fmtNumber(l.fail.qty)} {isRepl || l.fail.action === "replace" ? "Replacement" : "Rejection"}
            </button>
          ) : null}
          <FieldError id={`grn-fail-${l.key}-error`}>{failProblem(l)}</FieldError>
        </div>
      ),
    },
    {
      // VENDOR WILL NOT SEND THE REST (0782): only offered while short of the balance.
      header: "Close bal.",
      width: FIELD_WIDTH_CSS.hug,
      cell: (l) => {
        const t = num(l.todayRecd);
        if (isRepl || t <= 0 || t >= l.pending - 1e-9) return null;
        return (
          <label data-focus-optional className="flex items-center gap-1 text-[11px]" title="The vendor will not send the rest — close the balance">
            <input
              type="checkbox"
              aria-label={`Close the balance of ${fmtNumber(l.pending - t)}, ${l.description}`}
              checked={l.closeBalance}
              onChange={(e) => updateLine(l.key, { closeBalance: e.target.checked })}
            />
            <span className="tabular-nums text-muted-foreground">{fmtNumber(round3(l.pending - t))}</span>
          </label>
        );
      },
    },
    {
      header: "Status",
      width: FIELD_WIDTH_CSS.hug,
      cell: (l) => {
        const s = lineStatus(l);
        return s ? <StatusPill tone={s.tone}>{s.label}</StatusPill> : null;
      },
    },
  ];

  const docLabel = docType === "invoice" ? "Invoice" : docType === "dc" ? "DC" : "Vendor DC";

  return (
    <div data-focus-scope className="space-y-5">
      {/* ONE ROW (user 2026-10-31, screenshot 3934 — "all fields onto single row"): Location
          176 · GRN Date 144 · Vendor 200 · Doc Type 144 · PO / Replacement DC 176 · No 144 ·
          Date 144 = 1128 + 6 × 12 gap = 1200px + card padding ≈ 77rem → cap at 78rem. A
          narrower screen still wraps (FieldRow), rather than squeezing a field. */}
      <Card className="max-w-[78rem]">
        <CardHeader>
          <CardTitle>{isRepl ? "Replacement GRN" : "GRN Details"}</CardTitle>
          {isRepl ? (
            // What this receipt fills — and why no bill follows it (0781).
            <span className="text-xs text-muted-foreground">
              Receives what a Replacement DC is owed · no new PO, no new bill — the vendor&apos;s original invoice stands
            </span>
          ) : null}
        </CardHeader>
        <CardBody className="space-y-3">
          <FieldRow>
            <Field
              label="Store Location"
              required
              w="term"
              htmlFor="grn-location"
              error={locations.length > 0 && !defaultLocationId ? "Pick your working unit in the top bar first" : null}
            >
              <Combobox
                id="grn-location"
                options={locationOptions}
                value={locationId}
                openOnFocus={false}
                onChange={(v) => {
                  touch();
                  setLocationId(v);
                }}
              />
            </Field>
            <Field label="GRN Date" required w="code" htmlFor="grn-date">
              <Input
                id="grn-date"
                type="date"
                max="9999-12-31"
                value={grnDate}
                onChange={(e) => {
                  touch();
                  setGrnDate(e.target.value);
                }}
              />
            </Field>
            <Field label="Vendor" required w="party" htmlFor="grn-vendor">
              <Combobox
                id="grn-vendor"
                options={vendorOptions}
                value={vendorId}
                // A replacement's vendor is the DC's, locked once the DC is picked.
                disabled={isRepl && !!repl}
                openOnFocus={false}
                onChange={(v) => {
                  touch();
                  setVendorId(v);
                  if (isRepl) {
                    if (repl && repl.vendor_id !== v) loadRepl("");
                  } else {
                    const current = poId ? pos.get(poId) : null;
                    if (current && current.vendorId !== v) loadPo("");
                  }
                }}
              />
            </Field>
            <Field label="Document Type" w="code" htmlFor="grn-doc-type">
              <Select id="grn-doc-type" value={docType} onChange={(e) => changeDocType(e.target.value as DocType)}>
                <option value="invoice">Invoice</option>
                <option value="dc">DC</option>
                <option value="replacement">Replacement</option>
              </Select>
            </Field>
            {isRepl ? (
              <Field
                label="Replacement DC"
                required
                w="term"
                htmlFor="grn-repl"
                error={replacements.length === 0 ? "No replacement is owed by any vendor" : null}
              >
                <Combobox
                  id="grn-repl"
                  options={replOptions}
                  value={repl?.id ?? ""}
                  openOnFocus={false}
                  onChange={(v) => {
                    touch();
                    loadRepl(v);
                  }}
                />
              </Field>
            ) : (
              <Field
                label="PO No"
                required
                w="term"
                htmlFor="grn-po"
                error={vendorId && poOptions.length === 0 ? "No open PO for this vendor. Approve a PO first." : null}
              >
                <Combobox
                  id="grn-po"
                  options={poOptions}
                  value={poId}
                  openOnFocus={false}
                  onChange={(v) => {
                    touch();
                    loadPo(v);
                  }}
                />
              </Field>
            )}
            <Field label={`${docLabel} No`} w="code" htmlFor="grn-doc-no">
              <Input
                id="grn-doc-no"
                value={docNo}
                onChange={(e) => {
                  touch();
                  setDocNo(e.target.value);
                }}
              />
            </Field>
            <Field label={`${docLabel} Date`} w="code" htmlFor="grn-doc-date">
              <Input
                id="grn-doc-date"
                type="date"
                max="9999-12-31"
                value={docDate}
                onChange={(e) => {
                  touch();
                  setDocDate(e.target.value);
                }}
              />
            </Field>
          </FieldRow>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Items Received</CardTitle>
          {lines.length > 0 && (
            <span className="text-xs text-muted-foreground">
              Blank Today Recd = not received on this GRN · short of the balance? tick Close bal. if the vendor will not send the rest
            </span>
          )}
        </CardHeader>
        <CardBody className="space-y-3">
          {lines.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {isRepl ? "Pick the Replacement DC above and what it is owed loads here." : "Pick a PO above and its items load here."}
            </p>
          ) : (
            <div ref={gridRef}>
              {/* default-row: exempt -- the rows are the picked PO's own lines, derived; nothing is added here */}
              <ChildGrid<DraftLine>
                columns={grnLineColumns}
                rows={lines}
                tableFrom="5xl"
                flatRows
                hideAdd
                hideRemove
                keepOne={false}
                onAdd={() => false}
                onRemove={() => {}}
              />
            </div>
          )}
        </CardBody>
      </Card>

      {failLine ? (
        <QcFailedSheet
          key={failSeq}
          open
          description={failLine.description}
          received={num(failLine.todayRecd)}
          initial={failLine.fail}
          isReplacement={isRepl}
          onClose={() => setFailKey(null)}
          onConfirm={(choice) => {
            updateLine(failLine.key, { qcStatus: "failed", fail: choice });
            setFailKey(null);
          }}
        />
      ) : null}

      {/* The footer region: Enter off the last field and Ctrl+S press its LAST
          button (lib/focus.ts submitTargetOf), so Save sits after Cancel. */}
      <div data-focus-region="footer" className="flex flex-wrap items-center gap-3">
        <Button variant="outline" onClick={() => (onCancel ? onCancel() : router.push("/purchase/grn"))} disabled={isPending}>
          Cancel
        </Button>
        <Button onClick={handleSave} disabled={!canSave}>
          {isPending ? "Saving…" : "Save GRN"}
        </Button>
        {!canSave && !isPending && (
          <span className="text-sm text-muted-foreground">
            {!location?.postable
              ? "Receive into the unit you are working in"
              : isRepl && !repl
                ? "Pick the Replacement DC"
                : !poId
                  ? "Pick a vendor and a PO"
                  : receiving.length === 0
                    ? "Enter Today Recd on at least one line"
                    : lineProblems
                      ? "Fix the lines marked in red"
                      : null}
          </span>
        )}
      </div>
    </div>
  );
}
