"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ClipboardCheck } from "lucide-react";
import { DataTable, type Column } from "@/components/ui/data-table";
import { RowIconAction } from "@/components/ui/row-actions";
import { Sheet } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Segmented } from "@/components/ui/segmented";
import { Field, FieldError, FieldRow } from "@/components/ui/field";
import { Truncated } from "@/components/ui/truncated";
import { useToast } from "@/components/ui/toast";
import { decideQc } from "@/lib/purchase/grn-actions";
import type { GrnBinOption, GrnStoreOption, PendingQcLine } from "@/lib/purchase/grn-service";
import { fmtDate, fmtNumber } from "@/lib/format";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { pickedBins, splitBinsProblem, withTailBin } from "@/lib/purchase/bin-split";
import { BinPicker } from "@/components/masters/bin-picker";

const num = (s: string) => {
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
};
const round3 = (n: number) => Math.round(n * 1000) / 1000;

type Split = { key: string; binId: string; qty: string; typed?: boolean };
let seq = 0;
const newSplit = (binId = ""): Split => ({ key: `q${++seq}`, binId, qty: "" });

export function QcPendingClient({
  lines,
  stores,
  bins,
  defaultStoreId,
  canDecide,
  canCreateBin = false,
}: {
  lines: PendingQcLine[];
  stores: GrnStoreOption[];
  bins: GrnBinOption[];
  defaultStoreId: string | null;
  canDecide: boolean;
  /** May "+ Add" a bin from a bin box (masters:create). */
  canCreateBin?: boolean;
}) {
  const [open, setOpen] = useState<PendingQcLine | null>(null);
  const [openSeq, setOpenSeq] = useState(0);

  const columns: Column<PendingQcLine>[] = [
    { header: "GRN No", cell: (r) => <span className="font-mono text-xs font-medium">{r.grn_code ?? "—"}</span> },
    { header: "GRN Date", cell: (r) => <span className="text-sm">{fmtDate(r.grn_date)}</span> },
    { header: "Vendor", cell: (r) => <Truncated>{r.vendor_name ?? "—"}</Truncated> },
    { header: "PO No", cell: (r) => <span className="font-mono text-xs">{r.po_code ?? "—"}</span> },
    { header: "Item", cell: (r) => <Truncated>{r.description}</Truncated> },
    { header: "Lot No", cell: (r) => <span className="text-sm">{r.lot_no ?? "—"}</span> },
    {
      header: "Received",
      align: "right",
      cell: (r) => (
        <span className="tabular-nums text-sm">
          {fmtNumber(r.received_qty)} <span className="text-xs text-muted-foreground">{r.uom_code ?? ""}</span>
        </span>
      ),
    },
    {
      header: "",
      align: "right",
      cell: (r) => (
        <RowIconAction
          label="Inspect"
          name={r.description}
          icon={ClipboardCheck}
          disabledReason={canDecide ? null : "You do not have permission to decide QC"}
          onClick={() => {
            setOpenSeq((n) => n + 1);
            setOpen(r);
          }}
        />
      ),
    },
  ];

  return (
    <>
      <DataTable
        columns={columns}
        rows={lines}
        getKey={(r) => r.id}
        empty="Nothing is waiting for QC — every received line has been inspected."
      />
      {open ? (
        <InspectSheet
          key={openSeq}
          line={open}
          stores={stores}
          bins={bins}
          defaultStoreId={open.store_id ?? defaultStoreId}
          canCreateBin={canCreateBin}
          onClose={() => setOpen(null)}
        />
      ) : null}
    </>
  );
}

/**
 * ONE LINE'S DECISION. Failed qty opens at 0 — "all passed" is one click — and asking for
 * any failure brings the reason and the Rejection / Replacement choice with it. The
 * accepted qty is put away here (user: the bin is chosen on the QC screen), in one bin or
 * split across several that must add up to it.
 */
function InspectSheet({
  line,
  stores,
  bins,
  defaultStoreId,
  canCreateBin,
  onClose,
}: {
  line: PendingQcLine;
  stores: GrnStoreOption[];
  bins: GrnBinOption[];
  defaultStoreId: string | null;
  canCreateBin: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();
  const isRepl = line.grn_kind === "replacement";
  const [failed, setFailed] = useState("0");
  const [reason, setReason] = useState("QC FAILED");
  const [action, setAction] = useState<"return" | "replace">(isRepl ? "replace" : "return");
  const [storeId, setStoreId] = useState(defaultStoreId ?? stores[0]?.id ?? "");
  const [splits, setSplits] = useState<Split[]>([newSplit()]);
  const [dirty, setDirty] = useState(false);
  const [addedBins, setAddedBins] = useState<GrnBinOption[]>([]);
  const allBins = [...bins, ...addedBins];
  useUnsavedGuard(dirty || isPending);

  const f = num(failed);
  const accepted = round3(Math.max(0, line.received_qty - f));
  const picked = pickedBins(splits);
  const split = picked.length > 1;
  /** Re-shape the bin rows to the blank-end-row rule (the first bin holds the rest). */
  const reshape = (rows: Split[], acc: number = accepted) => withTailBin(rows, () => newSplit(), acc);
  const failProblem =
    f < 0 ? "Cannot be negative" : f > line.received_qty + 1e-9 ? `More than received (${fmtNumber(line.received_qty)})` : null;
  const reasonProblem = f > 0 && !reason.trim() ? "Enter a reason" : null;
  const splitProblem = splitBinsProblem(splits, accepted);
  const canSave = !isPending && !failProblem && !reasonProblem && !splitProblem && (accepted === 0 || !!storeId);

  function touch() {
    setDirty(true);
  }

  function save() {
    if (!canSave) return;
    startTransition(async () => {
      const res = await decideQc(line.id, {
        failed_qty: f,
        rejection_reason: f > 0 ? reason : null,
        rejection_action: f > 0 ? action : null,
        store_id: accepted > 0 ? storeId || null : null,
        bin_id: split ? null : picked[0]?.binId || null,
        bins: split && accepted > 0 ? picked.map((s) => ({ bin_id: s.binId, qty: num(s.qty) })) : [],
      });
      if (res.ok) {
        setDirty(false);
        success(
          f === 0
            ? `QC passed — ${fmtNumber(accepted)} into stock`
            : accepted === 0
              ? `QC failed — ${fmtNumber(f)} to the ${action === "return" ? "Rejection" : "Replacement"} DC`
              : `QC recorded — ${fmtNumber(accepted)} into stock, ${fmtNumber(f)} to the ${action === "return" ? "Rejection" : "Replacement"} DC`,
        );
        onClose();
        router.refresh();
      } else {
        toastError(res.error);
      }
    });
  }

  return (
    <Sheet
      open
      onClose={onClose}
      size="sm"
      alignToPane
      title={`QC · ${line.grn_code ?? "GRN"}`}
      footer={
        <div data-focus-region="footer" className="flex items-center justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={isPending}>
            Cancel
          </Button>
          <Button onClick={save} disabled={!canSave}>
            {isPending ? "Saving…" : f > 0 ? "Record QC" : "Pass all"}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="text-sm">
          <div className="font-medium">{line.description}</div>
          <div className="text-xs text-muted-foreground">
            {line.vendor_name ?? "—"} · {line.po_code ?? "—"}
            {line.lot_no ? ` · Lot ${line.lot_no}` : ""} · received{" "}
            <span className="tabular-nums">{fmtNumber(line.received_qty)}</span> {line.uom_code ?? ""}
          </div>
        </div>

        <FieldRow>
          <Field label="Failed Qty" w="code" htmlFor="qc-failed" error={failProblem}>
            <Input
              id="qc-failed"
              type="number"
              min={0}
              max={line.received_qty}
              inputMode="decimal"
              className="text-right tabular-nums"
              value={failed}
              onChange={(e) => {
                touch();
                setFailed(e.target.value);
                const nf = parseFloat(e.target.value);
                setSplits((xs) => reshape(xs, round3(Math.max(0, line.received_qty - (Number.isFinite(nf) ? nf : 0)))));
              }}
            />
          </Field>
          <Field label="Passed Qty" w="code">
            {/* Derived, never typed: received − failed. */}
            <Input readOnly tabIndex={-1} className="text-right tabular-nums" value={fmtNumber(accepted)} />
          </Field>
        </FieldRow>

        {f > 0 ? (
          <div className="space-y-3 rounded-md border border-border p-3">
            <Field label="Rejection Reason" required htmlFor="qc-reason" error={reasonProblem}>
              <Input
                id="qc-reason"
                value={reason}
                onChange={(e) => {
                  touch();
                  setReason(e.target.value);
                }}
              />
            </Field>
            {isRepl ? (
              <p className="text-xs text-muted-foreground">
                A replacement&apos;s own failure stays owed on the same Replacement DC — the vendor sends it again.
              </p>
            ) : (
              <Field label="Send back as">
                <Segmented
                  name="qc-action"
                  value={action}
                  onChange={(v) => {
                    touch();
                    setAction(v);
                  }}
                  options={[
                    { value: "return", label: "Rejection" },
                    { value: "replace", label: "Replacement" },
                  ]}
                />
              </Field>
            )}
            <p className="text-xs text-muted-foreground">
              {action === "return" && !isRepl
                ? "Rejection DC sends it back · the PO line closes this qty and the requirement reopens · never billed, so no debit note"
                : "Replacement DC sends it back · the vendor resends on the same PO (Replacement GRN) · never billed"}
            </p>
          </div>
        ) : null}

        {accepted > 0 ? (
          <div className="space-y-2">
            <Field label="Store" required htmlFor="qc-store">
              <Select
                id="qc-store"
                value={storeId}
                onChange={(e) => {
                  touch();
                  setStoreId(e.target.value);
                }}
              >
                {stores.length === 0 ? <option value="">No store in this unit</option> : null}
                {stores.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </Field>
            <div>
              <div className="mb-1 text-sm font-medium">Bin{split ? "s" : ""}</div>
              <div className="space-y-1">
                {/* A blank end row waits under the picked bins (no "+ Split bins"). */}
                {splits.map((s, i) => {
                  return (
                    <div key={s.key} className="flex items-center gap-2">
                      <BinPicker
                        label={s.binId ? `Bin ${i + 1}` : "Another bin"}
                        className="min-w-0 flex-1"
                        compact={false}
                        bins={allBins}
                        value={s.binId}
                        canCreate={canCreateBin}
                        usedIds={picked.map((x) => x.binId)}
                        onChange={(v) => {
                          touch();
                          setSplits((xs) => reshape(xs.map((x) => (x.key === s.key ? { ...x, binId: v } : x))));
                        }}
                        onCreated={(nb) => {
                          touch();
                          setAddedBins((xs) => [...xs, { id: nb.id, code: nb.code, description: null }]);
                          setSplits((xs) => reshape(xs.map((x) => (x.key === s.key ? { ...x, binId: nb.id } : x))));
                        }}
                      />
                      {split && s.binId ? (
                          <Input
                            type="number"
                            min={0}
                            inputMode="decimal"
                            aria-label={`Bin ${i + 1} qty`}
                            className="w-24 shrink-0 text-right tabular-nums"
                            value={s.qty}
                            onChange={(e) => {
                              touch();
                              setSplits((xs) => reshape(xs.map((x) => (x.key === s.key ? { ...x, qty: e.target.value, typed: true } : x))));
                            }}
                          />
                      ) : split ? (
                        <span className="w-24 shrink-0" aria-hidden />
                      ) : null}
                    </div>
                  );
                })}
              </div>
              <FieldError id="qc-bins-error">{splitProblem}</FieldError>
            </div>
          </div>
        ) : null}
      </div>
    </Sheet>
  );
}
