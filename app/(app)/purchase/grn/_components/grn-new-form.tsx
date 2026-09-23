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
import type { OpenPoLine } from "@/lib/purchase/grn-service";
import type { Vendor, QcStatus } from "@/lib/purchase/types";
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
  vendors: Pick<Vendor, "id" | "code" | "name">[];
  locations: { id: string; code: string; name: string; postable: boolean }[];
  defaultLocationId: string | null;
  /** Holds `stores:approve` — may authorise an over-receipt. */
  canAuthorize: boolean;
}

export function GrnNewForm({
  openPoLines,
  vendors,
  locations,
  defaultLocationId,
  canAuthorize,
}: Props) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();

  const [locationId, setLocationId] = useState(defaultLocationId ?? "");
  const [grnDate, setGrnDate] = useState(() => today());
  const [challanNo, setChallanNo] = useState("");
  const [vendorId, setVendorId] = useState("");
  const [poId, setPoId] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [overrideReason, setOverrideReason] = useState("");
  const [authorized, setAuthorized] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [dirty, setDirty] = useState(false);
  const gridRef = useRef<HTMLDivElement>(null);
  const [landToken, setLandToken] = useState(0);

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
  const vendorOptions: ComboboxOption[] = vendors.map((v) => ({
    value: v.id,
    label: v.name,
    search: v.code,
  }));
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
    setLines(
      openPoLines
        .filter((l) => l.purchase_order_id === nextPoId)
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
        })),
    );
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
        vendor_id: vendorId || null,
        location_id: locationId || null,
        grn_date: grnDate,
        challan_no: challanNo.trim() || null,
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
            roll_batch_no: l.rollBatchNo.trim() || null,
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
   * 176 + 72 + 88×4 + 144 + 88 + 144 + 88 = 1064, + 40 chrome (the `#`; no ✕ —
   * `hideRemove`, the rows are the PO's own lines) = 1104 <= 1155 -> tableFrom="5xl".
   */
  const grnLineColumns: ChildGridColumn<DraftLine>[] = [
    {
      header: "Item Description",
      width: FIELD_WIDTH_CSS.term,
      cell: (l) => <Truncated className="text-sm">{l.description}</Truncated>,
    },
    {
      header: "UOM",
      width: FIELD_WIDTH_CSS.num,
      cell: (l) => <span className="text-sm">{l.uomCode ?? ""}</span>,
    },
    {
      header: "PO Qty",
      width: FIELD_WIDTH_CSS.hug,
      align: "right",
      cell: (l) => <span className="tabular-nums text-sm">{fmtNumber(l.ordered)}</span>,
    },
    {
      header: "Recd So Far",
      width: FIELD_WIDTH_CSS.hug,
      align: "right",
      cell: (l) => <span className="tabular-nums text-sm">{fmtNumber(l.receivedSoFar)}</span>,
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
      header: "Roll / Batch No",
      width: FIELD_WIDTH_CSS.code,
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
      width: FIELD_WIDTH_CSS.code,
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
          <CardTitle>GRN Details</CardTitle>
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
            <Field label="Challan / Inv No" w="code" htmlFor="grn-challan">
              <Input
                id="grn-challan"
                value={challanNo}
                onChange={(e) => {
                  touch();
                  setChallanNo(e.target.value);
                }}
              />
            </Field>
            <Field label="Vendor" required w="name" htmlFor="grn-vendor">
              <Combobox
                id="grn-vendor"
                options={vendorOptions}
                value={vendorId}
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
                openOnFocus={false}
                onChange={(v) => {
                  touch();
                  loadPo(v);
                }}
              />
            </Field>
          </FieldRow>
          <FieldRow>
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
          onClick={() => router.push("/purchase/grn")}
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
