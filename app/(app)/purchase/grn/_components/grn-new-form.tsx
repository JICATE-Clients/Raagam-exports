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
import type { GrnBinOption, GrnStoreOption, OpenPoLine, ReplacementDue } from "@/lib/purchase/grn-service";
import type { QcStatus } from "@/lib/purchase/types";
import {
  acceptedFrom,
  receiptBand,
  toleranceLimit,
  type ReceiptBand,
} from "@/lib/purchase/grn-tolerance";
import { focusField } from "@/lib/focus";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { today } from "@/lib/calendar";
import { fmtNumber } from "@/lib/format";

/**
 * STORE KEEPER GRN ENTRY (2026-09-23).
 *
 * Header: Store Location · GRN Date · Challan / Inv No · Vendor · PO No. Picking
 * the PO loads EVERY line of it into the grid, so the keeper never types an item
 * description or a UOM; they type Today Recd, Shortage / Rej and Roll / Batch No,
 * and the cursor lands on the first row's Today Recd the moment the PO is picked.
 *
 * TAB IS THE CONTRACT'S, NOT THIS FILE'S. Inside the grid `tabAlongRow`
 * (child-grid.tsx) walks the row's fields and skips anything off the typing
 * path — so QC Status and Rejection Reason sit under `data-focus-optional`
 * (a wrapper div carries the marker), and Tab runs Today Recd → Shortage / Rej → Roll / Batch
 * No → the next row's Today Recd. Reason JOINS the path once the line has a
 * shortage, because it is then mandatory and a required field Tab can never
 * reach would be a cage (`autoFilledField`'s rule). No keydown handler here.
 *
 * TOLERANCE is `lib/purchase/grn-tolerance.ts`, the same function `createGrn`
 * runs and the same rule the database trigger enforces (0620): GREEN exact,
 * AMBER over but inside the PO's approved tolerance, RED beyond it — and a RED
 * line blocks Save until a Store Manager (`stores:approve`) authorises it.
 */

interface DraftLine {
  key: string;
  poLineItemId: string;
  purchaseOrderId: string;
  description: string;
  uomCode: string | null;
  ordered: number;
  receivedSoFar: number;
  tolerancePct: number;
  todayRecd: string;
  shortageRej: string;
  rollBatchNo: string;
  qcStatus: QcStatus;
  rejectionReason: string;
  /** Where a rejected qty goes (0780): sent again on this PO, or closed and re-bought. */
  rejectionAction: "replace" | "return";
  /** Where the accepted goods go (grn.md §2A) — opens on the unit's material store. */
  storeId: string;
  binId: string;
}

/** A PO's lines as the grid's rows — every line, in the PO's own order (0620). */
function linesOfPo(openPoLines: OpenPoLine[], poId: string, defaultStoreId: string | null): DraftLine[] {
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
      tolerancePct: l.tolerance_pct,
      todayRecd: "",
      shortageRej: "",
      rollBatchNo: "",
      qcStatus: "pending",
      rejectionReason: "",
      rejectionAction: "replace",
      storeId: defaultStoreId ?? "",
      binId: "",
    }));
}

const QC_OPTIONS: { value: QcStatus; label: string }[] = [
  { value: "pending", label: "Pending" },
  { value: "passed", label: "Passed" },
  { value: "failed", label: "Failed" },
  { value: "partial", label: "Partial" },
];

const BAND_VIEW: Record<Exclude<ReceiptBand, "none">, { tone: StatusTone; label: string }> = {
  short: { tone: "info", label: "Part" },
  exact: { tone: "success", label: "Exact" },
  within: { tone: "warning", label: "In tol." },
  over: { tone: "danger", label: "Over" },
};

function num(s: string): number {
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

function lineBand(l: DraftLine): ReceiptBand {
  return receiptBand({
    ordered: l.ordered,
    receivedSoFar: l.receivedSoFar,
    acceptedToday: acceptedFrom(num(l.todayRecd), num(l.shortageRej)),
    tolerancePct: l.tolerancePct,
  });
}

/** The line's own refusal, if any — shown UNDER the field it is about. */
function shortageProblem(l: DraftLine): string | null {
  return num(l.shortageRej) > num(l.todayRecd) ? "More than Today Recd" : null;
}
function reasonProblem(l: DraftLine): string | null {
  return num(l.shortageRej) > 0 && !l.rejectionReason.trim() ? "Reason required" : null;
}

interface Props {
  openPoLines: OpenPoLine[];
  locations: { id: string; code: string; name: string; postable: boolean }[];
  defaultLocationId: string | null;
  /** Holds `stores:approve` — may authorise an over-receipt. */
  canAuthorize: boolean;
  /** The working unit's stores and bins — the line's Store and Bin pickers (0777). */
  stores: GrnStoreOption[];
  bins: GrnBinOption[];
  defaultStoreId: string | null;
  /** Opened from a Pending row on the Receiving list: that PO, already loaded. */
  initialPoId?: string | null;
  /** Opened from the list's New GRN with one vendor filtered: that vendor, already chosen. */
  initialVendorId?: string | null;
  /** Back to the Receiving list (embedded); omitted = the standalone /new page. */
  onCancel?: () => void;
  /**
   * A REPLACEMENT GRN (0780): the Rejection DC it fills. Its vendor and PO are fixed, and
   * only the lines still owed load — the goods the vendor is sending back in place of
   * what was rejected. No bill is raised for it; the original invoice covered them.
   */
  replacement?: ReplacementDue | null;
}

export function GrnNewForm({
  openPoLines,
  locations,
  defaultLocationId,
  canAuthorize,
  stores,
  bins,
  defaultStoreId,
  initialPoId = null,
  initialVendorId = null,
  onCancel,
  replacement = null,
}: Props) {
  /* A replacement opens on the PO its owed lines belong to (one GRN, one PO). */
  const replacementPoId = replacement
    ? (openPoLines.find((l) => l.id === replacement.lines[0]?.po_line_item_id)?.purchase_order_id ?? null)
    : null;
  const owedLineIds = new Set(replacement?.lines.map((l) => l.po_line_item_id) ?? []);
  const startPoId = replacementPoId ?? initialPoId;
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();

  const [locationId, setLocationId] = useState(defaultLocationId ?? "");
  const [grnDate, setGrnDate] = useState(() => today());
  const [invoiceNo, setInvoiceNo] = useState("");
  const [invoiceDate, setInvoiceDate] = useState("");
  const [dcNo, setDcNo] = useState("");
  // OPENED ON A PO (the Receiving list's pencil): its vendor and lines are there from the
  // first render, and the cursor lands on the first Today Recd (landToken starts at 1).
  const [vendorId, setVendorId] = useState(
    () =>
      replacement?.vendor_id ||
      ((startPoId ? openPoLines.find((l) => l.purchase_order_id === startPoId)?.vendor_id : null) ?? initialVendorId ?? ""),
  );
  const [poId, setPoId] = useState(startPoId ?? "");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<DraftLine[]>(() =>
    startPoId
      ? linesOfPo(openPoLines, startPoId, defaultStoreId).filter((l) => !replacement || owedLineIds.has(l.poLineItemId))
      : [],
  );
  const [overrideReason, setOverrideReason] = useState("");
  const [authorized, setAuthorized] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [dirty, setDirty] = useState(false);
  const gridRef = useRef<HTMLDivElement>(null);
  const [landToken, setLandToken] = useState(startPoId ? 1 : 0);

  useUnsavedGuard(dirty || isPending);

  /* THE CURSOR LANDS ON THE FIRST ROW'S TODAY RECD once a PO's lines arrive.
     A focus move after a render, not a key handler: `focusField` is the
     contract's own mover (caret placed, so → still works). */
  useEffect(() => {
    if (landToken === 0) return;
    const el = gridRef.current?.querySelector<HTMLElement>("[data-grn-today]");
    if (el) focusField(el);
  }, [landToken]);

  // ---------- options ----------
  const locationOptions: ComboboxOption[] = locations.map((l) => ({
    value: l.id,
    label: l.name,
    search: l.code,
    disabled: !l.postable,
    disabledNote: l.postable ? undefined : "(switch unit in the top bar)",
  }));

  // One entry per open PO, from the lines the server already sent.
  const pos = new Map<string, { id: string; code: string | null; vendorId: string; vendorName: string }>();
  for (const l of openPoLines) {
    if (!pos.has(l.purchase_order_id)) {
      pos.set(l.purchase_order_id, {
        id: l.purchase_order_id,
        code: l.po_code,
        vendorId: l.vendor_id,
        vendorName: l.vendor_name,
      });
    }
  }
  /* ONLY VENDORS WITH SOMETHING TO DELIVER (grn.md §1, 0777): the vendor list is read off
     the open POs themselves — their MASTER vendor — so a vendor with no open PO is not
     offered, and a PO raised on Raise PO (master vendor only) is receivable at last. */
  const vendorOptions: ComboboxOption[] = Array.from(
    new Map(Array.from(pos.values()).filter((p) => p.vendorId).map((p) => [p.vendorId, p.vendorName])).entries(),
  )
    .sort((a, b) => a[1].localeCompare(b[1]))
    .map(([value, label]) => ({ value, label }));
  /* A PO number can be typed straight in: with no vendor chosen the list is
     every open PO (the vendor shows beside it), and picking one fills the
     vendor. With a vendor chosen it narrows to that vendor's open POs. */
  const poOptions: ComboboxOption[] = Array.from(pos.values())
    .filter((p) => !vendorId || p.vendorId === vendorId)
    .map((p) => ({
      value: p.id,
      label: p.code ?? "(no number)",
      sublabel: vendorId ? undefined : p.vendorName,
      search: p.vendorName,
    }));

  // ---------- edits ----------
  function touch() {
    setDirty(true);
  }

  function loadPo(nextPoId: string) {
    setPoId(nextPoId);
    setAuthorized(false);
    setAttempted(false);
    if (!nextPoId) {
      setLines([]);
      return;
    }
    const po = pos.get(nextPoId);
    if (po && po.vendorId !== vendorId) setVendorId(po.vendorId);
    setLines(linesOfPo(openPoLines, nextPoId, defaultStoreId));
    setLandToken((t) => t + 1);
  }

  function updateLine(key: string, patch: Partial<Omit<DraftLine, "key">>) {
    touch();
    // A quantity change after authorisation voids it: the manager signed off
    // on the figures they saw, not on whatever is typed next.
    if ("todayRecd" in patch || "shortageRej" in patch) setAuthorized(false);
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  // ---------- derived ----------
  const bands = lines.map(lineBand);
  const receiving = lines.filter((l) => num(l.todayRecd) > 0);
  const counts = { exact: 0, within: 0, over: 0, short: 0 };
  for (const b of bands) if (b !== "none") counts[b]++;
  const location = locations.find((l) => l.id === locationId);
  const lineProblems = receiving.some((l) => shortageProblem(l) || reasonProblem(l));
  const needsOverride = counts.over > 0;
  const blockedByOverride = needsOverride && !authorized;
  const canSave =
    !isPending &&
    !!location?.postable &&
    !!grnDate &&
    !!vendorId &&
    !!poId &&
    receiving.length > 0 &&
    !lineProblems &&
    !blockedByOverride;

  function handleSave() {
    setAttempted(true);
    if (!canSave) return;
    startTransition(async () => {
      const result = await createGrn({
        master_vendor_id: vendorId,
        location_id: locationId || null,
        grn_date: grnDate,
        invoice_no: invoiceNo.trim() || null,
        invoice_date: invoiceDate || null,
        dc_no: dcNo.trim() || null,
        kind: replacement ? "replacement" : "regular",
        vendor_return_id: replacement?.id ?? null,
        notes: notes.trim() || null,
        over_receipt_reason: needsOverride && authorized ? overrideReason.trim() : null,
        lines: receiving.map((l, i) => {
          const received = num(l.todayRecd);
          const rejected = num(l.shortageRej);
          return {
            po_line_item_id: l.poLineItemId,
            purchase_order_id: l.purchaseOrderId,
            description: l.description,
            received_qty: received,
            // Derived, never typed — and recomputed by the action regardless.
            accepted_qty: acceptedFrom(received, rejected),
            rejected_qty: rejected,
            qc_status: l.qcStatus,
            rejection_reason: l.rejectionReason.trim() || null,
            // A replacement's own rejection is still owed on the same DC (the action re-forces it).
            rejection_action: replacement ? "replace" : l.rejectionAction,
            roll_batch_no: l.rollBatchNo.trim() || null,
            store_id: l.storeId || null,
            bin_id: l.binId || null,
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
   * Item 176 · PO Qty 112 · Today 88 · Rej 88 · Store 112 · Bin 112 · Roll 112 · QC 88 ·
   * Reason 112 · Status 88 = 1088, + 40 chrome (the `#`; no ✕ — `hideRemove`, the rows are
   * the PO's own lines) = 1128 <= 1155 -> tableFrom="5xl". Store and Bin (0777) were paid
   * for by folding UOM and Recd So Far into the PO Qty cell, and Roll / Reason to `range`.
   */
  const grnLineColumns: ChildGridColumn<DraftLine>[] = [
    {
      header: "Item Description",
      width: FIELD_WIDTH_CSS.term,
      cell: (l) => <Truncated className="text-sm">{l.description}</Truncated>,
    },
    {
      // PO QTY, ITS UNIT, AND WHAT HAS ARRIVED SO FAR — one cell, two lines.
      header: "PO Qty",
      width: FIELD_WIDTH_CSS.range,
      align: "right",
      cell: (l) => (
        <div className="text-right leading-tight">
          <div className="tabular-nums text-sm">
            {fmtNumber(l.ordered)} <span className="text-xs text-muted-foreground">{l.uomCode ?? ""}</span>
          </div>
          <div className="text-[11px] tabular-nums text-muted-foreground">recd {fmtNumber(l.receivedSoFar)}</div>
        </div>
      ),
    },
    {
      header: "Today Recd",
      width: FIELD_WIDTH_CSS.hug,
      cell: (l) => (
        <Input
          type="number"
          min={0}
          inputMode="decimal"
          data-grn-today
          aria-label={`Today Recd, ${l.description}`}
          className="h-8 text-right tabular-nums"
          value={l.todayRecd}
          onChange={(e) => updateLine(l.key, { todayRecd: e.target.value })}
        />
      ),
    },
    {
      header: "Shortage / Rej",
      width: FIELD_WIDTH_CSS.hug,
      cell: (l) => {
        const problem = shortageProblem(l);
        return (
          <>
            <Input
              type="number"
              min={0}
              inputMode="decimal"
              aria-label={`Shortage / Rej, ${l.description}`}
              aria-invalid={problem ? true : undefined}
              aria-describedby={problem ? `grn-short-${l.key}-error` : undefined}
              className="h-8 text-right tabular-nums"
              value={l.shortageRej}
              onChange={(e) => updateLine(l.key, { shortageRej: e.target.value })}
            />
            <FieldError id={`grn-short-${l.key}-error`}>{problem}</FieldError>
          </>
        );
      },
    },
    {
      // WHERE IT IS PUT (grn.md §2A): the unit's store — opens on the material store — and
      // the bin. Accepted goods are booked into this store when the GRN is posted.
      header: "Store",
      width: FIELD_WIDTH_CSS.range,
      cell: (l) => (
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
      ),
    },
    {
      header: "Bin",
      width: FIELD_WIDTH_CSS.range,
      cell: (l) => (
        <Select
          aria-label={`Bin, ${l.description}`}
          className="h-8"
          value={l.binId}
          onChange={(e) => updateLine(l.key, { binId: e.target.value })}
        >
          <option value="">{bins.length === 0 ? "No bins yet" : "—"}</option>
          {bins.map((b) => (
            <option key={b.id} value={b.id}>
              {b.code}
            </option>
          ))}
        </Select>
      ),
    },
    {
      header: "Roll / Batch No",
      width: FIELD_WIDTH_CSS.range,
      cell: (l) => (
        <Input
          aria-label={`Roll / Batch No, ${l.description}`}
          className="h-8"
          value={l.rollBatchNo}
          onChange={(e) => updateLine(l.key, { rollBatchNo: e.target.value })}
        />
      ),
    },
    {
      header: "QC",
      width: FIELD_WIDTH_CSS.hug,
      // Off the typing path: the arrows and the mouse reach it, Tab steps over.
      cell: (l) => (
        <div data-focus-optional>
          <Select
            aria-label={`QC status, ${l.description}`}
            className="h-8"
            value={l.qcStatus}
            onChange={(e) => updateLine(l.key, { qcStatus: e.target.value as QcStatus })}
          >
            {QC_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </div>
      ),
    },
    {
      header: "Rejection Reason",
      width: FIELD_WIDTH_CSS.range,
      cell: (l) => {
        // Mandatory exactly when the line has a shortage / rejection (postGrn
        // refuses without it) — and then ON the Tab path, so the hold is one
        // Tab can satisfy. Otherwise optional and stepped over.
        const needed = num(l.shortageRej) > 0;
        const problem = attempted ? reasonProblem(l) : null;
        return (
          <div data-focus-optional={needed ? undefined : ""}>
            <Input
              aria-label={`Rejection reason, ${l.description}`}
              aria-invalid={problem ? true : undefined}
              aria-describedby={problem ? `grn-reason-${l.key}-error` : undefined}
              required={needed}
              className="h-8"
              value={l.rejectionReason}
              onChange={(e) => updateLine(l.key, { rejectionReason: e.target.value })}
            />
            <FieldError id={`grn-reason-${l.key}-error`}>{problem}</FieldError>
            {/* WHERE THE REJECTED QTY GOES (0780) — under the reason, only once something is
                rejected, and never on a replacement (still owed on the same DC). Replace:
                the vendor sends it again on this PO. Return: closed here, re-bought on a new PO. */}
            {needed && !replacement ? (
              <Select
                aria-label={`Rejected goods, ${l.description}`}
                className="mt-1 h-7 text-xs"
                value={l.rejectionAction}
                onChange={(e) => updateLine(l.key, { rejectionAction: e.target.value === "return" ? "return" : "replace" })}
              >
                <option value="replace">Vendor replaces</option>
                <option value="return">Return &amp; re-buy</option>
              </Select>
            ) : null}
          </div>
        );
      },
    },
    {
      header: "Status",
      width: FIELD_WIDTH_CSS.hug,
      // From the ROW, not `bands[i]`: a grid index is page-relative.
      cell: (l) => {
        const b = lineBand(l);
        if (b === "none") return null;
        const v = BAND_VIEW[b];
        return <StatusPill tone={v.tone}>{v.label}</StatusPill>;
      },
    },
  ];

  return (
    <div data-focus-scope className="space-y-5">
      {/* 5 fields: 200 + 144 + 144 + 288 + 176 = 952 + 4 × 12 gap = 1000px ≈ 62.5rem → cap at 64rem. */}
      <Card className="max-w-[64rem]">
        <CardHeader>
          <CardTitle>{replacement ? "Replacement GRN" : "GRN Details"}</CardTitle>
          {replacement ? (
            // What this receipt fills — and why no bill follows it (0780).
            <span className="text-xs text-muted-foreground">
              Replaces goods on Rejection DC {replacement.code ?? ""}
              {replacement.grn_code ? ` (rejected on ${replacement.grn_code})` : ""} · no new bill — the
              vendor&apos;s original invoice covered them
            </span>
          ) : null}
        </CardHeader>
        <CardBody className="space-y-3">
          <FieldRow>
            <Field
              label="Store Location"
              required
              w="party"
              htmlFor="grn-location"
              error={
                locations.length > 0 && !defaultLocationId
                  ? "Pick your working unit in the top bar first"
                  : null
              }
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
            <Field label="Vendor" required w="name" htmlFor="grn-vendor">
              <Combobox
                id="grn-vendor"
                options={vendorOptions}
                value={vendorId}
                // A replacement comes from the vendor the goods went back to — fixed.
                disabled={!!replacement}
                openOnFocus={false}
                onChange={(v) => {
                  touch();
                  setVendorId(v);
                  const current = poId ? pos.get(poId) : null;
                  if (current && current.vendorId !== v) loadPo("");
                }}
              />
            </Field>
            <Field
              label="PO No"
              required
              w="term"
              htmlFor="grn-po"
              error={
                vendorId && poOptions.length === 0
                  ? "No open PO for this vendor. Approve a PO first."
                  : null
              }
            >
              <Combobox
                id="grn-po"
                options={poOptions}
                value={poId}
                disabled={!!replacement}
                openOnFocus={false}
                onChange={(v) => {
                  touch();
                  loadPo(v);
                }}
              />
            </Field>
          </FieldRow>
          {/* THE VENDOR'S PAPERS (grn.md §2A, 0777): the invoice and the delivery challan
              that came with the goods — one "Challan / Inv No" box held either before. */}
          <FieldRow>
            <Field label="Invoice No" w="code" htmlFor="grn-invoice-no">
              <Input
                id="grn-invoice-no"
                value={invoiceNo}
                onChange={(e) => {
                  touch();
                  setInvoiceNo(e.target.value);
                }}
              />
            </Field>
            <Field label="Invoice Date" w="code" htmlFor="grn-invoice-date">
              <Input
                id="grn-invoice-date"
                type="date"
                max="9999-12-31"
                value={invoiceDate}
                onChange={(e) => {
                  touch();
                  setInvoiceDate(e.target.value);
                }}
              />
            </Field>
            <Field label="DC No" w="code" htmlFor="grn-dc-no">
              <Input
                id="grn-dc-no"
                value={dcNo}
                onChange={(e) => {
                  touch();
                  setDcNo(e.target.value);
                }}
              />
            </Field>
            <Field label="Notes" w="name" htmlFor="grn-notes">
              <Input
                id="grn-notes"
                value={notes}
                onChange={(e) => {
                  touch();
                  setNotes(e.target.value);
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
              Blank Today Recd = not received on this GRN
            </span>
          )}
        </CardHeader>
        <CardBody className="space-y-3">
          {lines.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Pick a PO above and its items load here.
            </p>
          ) : (
            <>
              <ToleranceSummary counts={counts} />
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
              {lines.map((l, i) =>
                bands[i] === "within" || bands[i] === "over" ? (
                  <p
                    key={l.key}
                    className={
                      bands[i] === "over" ? "text-xs text-danger" : "text-xs text-warning"
                    }
                  >
                    {l.description}: {fmtNumber(l.receivedSoFar + acceptedFrom(num(l.todayRecd), num(l.shortageRej)))}{" "}
                    of {fmtNumber(l.ordered)} — tolerance {fmtNumber(l.tolerancePct)}% allows up to{" "}
                    {fmtNumber(toleranceLimit(l.ordered, l.tolerancePct))}
                    {bands[i] === "over" ? ". Beyond tolerance." : "."}
                  </p>
                ) : null,
              )}
            </>
          )}

          {needsOverride && (
            <div className="max-w-[40rem] space-y-2 rounded-md border border-danger/40 bg-danger/5 p-3">
              <p className="text-sm font-semibold text-danger">
                {counts.over} line{counts.over === 1 ? "" : "s"} beyond the PO&apos;s over-receipt
                tolerance. Save is blocked until a Store Manager authorises it.
              </p>
              {canAuthorize ? (
                <FieldRow>
                  <Field
                    label="Override reason"
                    required
                    w="name"
                    htmlFor="grn-override-reason"
                  >
                    <Input
                      id="grn-override-reason"
                      value={overrideReason}
                      onChange={(e) => {
                        touch();
                        setAuthorized(false);
                        setOverrideReason(e.target.value);
                      }}
                    />
                  </Field>
                  <Field label="">
                    <Button
                      type="button"
                      variant={authorized ? "outline" : "primary"}
                      disabled={!overrideReason.trim()}
                      onClick={() => setAuthorized((a) => !a)}
                    >
                      {authorized ? "Authorised — undo" : "Authorise over-receipt"}
                    </Button>
                  </Field>
                </FieldRow>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Ask a Store Manager to sign in and authorise, or correct Today Recd.
                </p>
              )}
            </div>
          )}
        </CardBody>
      </Card>

      {/* The footer region: Enter off the last field and Ctrl+S press its LAST
          button (lib/focus.ts submitTargetOf), so Save sits after Cancel. */}
      <div data-focus-region="footer" className="flex flex-wrap items-center gap-3">
        <Button
          variant="outline"
          onClick={() => (onCancel ? onCancel() : router.push("/purchase/grn"))}
          disabled={isPending}
        >
          Cancel
        </Button>
        <Button onClick={handleSave} disabled={!canSave}>
          {isPending ? "Saving…" : "Save GRN"}
        </Button>
        {!canSave && !isPending && (
          <span className="text-sm text-muted-foreground">
            {!location?.postable
              ? "Receive into the unit you are working in"
              : !poId
                ? "Pick a vendor and a PO"
                : receiving.length === 0
                  ? "Enter Today Recd on at least one line"
                  : blockedByOverride
                    ? "Needs a Store Manager override"
                    : lineProblems
                      ? "Fix the lines marked in red"
                      : null}
          </span>
        )}
      </div>
    </div>
  );
}

/** The summary banner: one sentence per colour that is present. */
function ToleranceSummary({
  counts,
}: {
  counts: { exact: number; within: number; over: number; short: number };
}) {
  const total = counts.exact + counts.within + counts.over + counts.short;
  if (total === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      {counts.exact > 0 && <StatusPill tone="success">{counts.exact} exact</StatusPill>}
      {counts.short > 0 && <StatusPill tone="info">{counts.short} part delivery</StatusPill>}
      {counts.within > 0 && (
        <StatusPill tone="warning">{counts.within} over, within tolerance</StatusPill>
      )}
      {counts.over > 0 && (
        <StatusPill tone="danger">{counts.over} beyond tolerance</StatusPill>
      )}
    </div>
  );
}
