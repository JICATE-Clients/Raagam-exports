"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { editPostedGrn } from "@/lib/purchase/grn-actions";
import { useToast } from "@/components/ui/toast";
import { ChildGrid, type ChildGridColumn } from "@/components/masters/child-grid";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldError, FieldRow, FIELD_WIDTH_CSS } from "@/components/ui/field";
import { Truncated } from "@/components/ui/truncated";
import { Card, CardHeader, CardTitle, CardBody } from "@/components/ui/card";
import type { GrnBinOption, GrnStoreOption } from "@/lib/purchase/grn-service";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { fmtNumber } from "@/lib/format";
import { pickedBins, splitBinsProblem, withTailBin } from "@/lib/purchase/bin-split";
import { StoreBinCell } from "@/components/purchase/store-bin-editor";

type Split = { key: string; binId: string; qty: string; typed?: boolean };
type EditLine = {
  /** ChildGrid's row key — the GRN line id. */
  key: string;
  id: string;
  description: string;
  po_code: string | null;
  qc_status: string;
  rejected: number;
  received: string;
  lot: string;
  storeId: string;
  bins: Split[];
  /** As loaded — a line equal to this is not sent, and no line sent means paper only. */
  original: string;
};

let seq = 0;
const newSplit = (binId = "", qty = ""): Split => ({ key: `e${++seq}`, binId, qty });
const num = (s: string) => {
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
};
const round3 = (n: number) => Math.round(n * 1000) / 1000;
/** What a line says — its PICKED bins only, so the blank end row never reads as a change. */
const snapshot = (l: Pick<EditLine, "received" | "lot" | "storeId" | "bins">) => {
  const picked = pickedBins(l.bins);
  return JSON.stringify([num(l.received), l.lot.trim().toUpperCase(), l.storeId, picked.map((b) => [b.binId, picked.length > 1 ? num(b.qty) : 0])]);
};

const QC_LABEL: Record<string, string> = { passed: "Passed", failed: "Failed", partial: "Partial", pending: "Pending QC" };

export function GrnEditForm({
  grn,
  lines: initialLines,
  stores,
  bins,
  qtyLock,
  canCreateBin = false,
}: {
  grn: {
    id: string;
    code: string | null;
    vendor: string | null;
    invoice_no: string | null;
    invoice_date: string | null;
    dc_no: string | null;
    vehicle_ref: string | null;
  };
  lines: {
    id: string;
    description: string;
    po_code: string | null;
    qc_status: string;
    received_qty: number;
    rejected_qty: number;
    roll_batch_no: string | null;
    store_id: string | null;
    bin_id: string | null;
    bin_split: { code: string; qty: number; bin_id: string }[];
  }[];
  stores: GrnStoreOption[];
  bins: GrnBinOption[];
  /** Why quantities are locked (null = editable). The paper is always editable. */
  qtyLock: string | null;
  /** May "+ Add" a bin from a bin box (masters:create). */
  canCreateBin?: boolean;
}) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();
  const [invoiceNo, setInvoiceNo] = useState(grn.invoice_no ?? "");
  const [invoiceDate, setInvoiceDate] = useState(grn.invoice_date ?? "");
  const [dcNo, setDcNo] = useState(grn.dc_no ?? "");
  const [vehicleRef, setVehicleRef] = useState(grn.vehicle_ref ?? "");
  const [lines, setLines] = useState<EditLine[]>(() =>
    initialLines.map((l) => {
      const row = {
        received: String(l.received_qty),
        lot: l.roll_batch_no ?? "",
        storeId: l.store_id ?? "",
        // Opens with its blank end row already under the bins it holds.
        bins: withTailBin(
          // A saved split keeps its saved qtys (typed); a single bin holds it all.
          l.bin_split.length > 1
            ? l.bin_split.map((b) => ({ ...newSplit(b.bin_id, String(b.qty)), typed: true }))
            : [newSplit(l.bin_split[0]?.bin_id ?? l.bin_id ?? "")],
          () => newSplit(),
          l.qc_status === "pending" ? l.received_qty : round3(l.received_qty - l.rejected_qty),
        ),
      };
      return {
        key: l.id,
        id: l.id,
        description: l.description,
        po_code: l.po_code,
        qc_status: l.qc_status,
        rejected: l.rejected_qty,
        ...row,
        original: snapshot(row),
      };
    }),
  );
  const [dirty, setDirty] = useState(false);
  const [addedBins, setAddedBins] = useState<GrnBinOption[]>([]);
  const allBins = [...bins, ...addedBins];
  useUnsavedGuard(dirty || isPending);

  function touch() {
    setDirty(true);
  }
  /** Every change re-shapes the bins (lib/purchase/bin-split.ts: untyped bins hold what is left). */
  function patch(id: string, p: Partial<EditLine>) {
    touch();
    setLines((xs) =>
      xs.map((x) => {
        if (x.id !== id) return x;
        const next = { ...x, ...p };
        return { ...next, bins: withTailBin(next.bins, () => newSplit(), accepted(next)) };
      }),
    );
  }

  const changed = lines.filter((l) => snapshot(l) !== l.original);
  const accepted = (l: EditLine) => (l.qc_status === "pending" ? num(l.received) : round3(num(l.received) - l.rejected));
  const problem = (l: EditLine): string | null => {
    if (num(l.received) < 0) return "Cannot be negative";
    if (l.qc_status !== "pending" && num(l.received) < l.rejected) return `Less than the ${fmtNumber(l.rejected)} that failed QC`;
    return null;
  };
  const splitProblem = (l: EditLine): string | null => (l.qc_status === "pending" ? null : splitBinsProblem(l.bins, accepted(l)));
  const lineProblems = !qtyLock && lines.some((l) => problem(l) || splitProblem(l));
  /* THE VENDOR'S PAPER IS MANDATORY (user 2026-11-03): its date always, and ONE number —
     Invoice No or DC No, whichever paper came. So the No is required only while both are
     blank (a state rule, like Fabric's Using). The star sits on Invoice No only: a held box
     cannot be tabbed past, so starring both would cage the operator before DC No. */
  const noPaperNo = !invoiceNo.trim() && !dcNo.trim();
  const canSave = !isPending && dirty && !lineProblems && !noPaperNo && !!invoiceDate;

  function save() {
    if (!canSave) return;
    startTransition(async () => {
      const res = await editPostedGrn(grn.id, {
        header: {
          invoice_no: invoiceNo.trim() || null,
          invoice_date: invoiceDate || null,
          dc_no: dcNo.trim() || null,
          vehicle_ref: vehicleRef.trim() || null,
        },
        // EVERY line goes up once any changed: the function re-posts the whole GRN.
        lines:
          qtyLock || changed.length === 0
            ? []
            : lines.map((l) => {
                const picked = pickedBins(l.bins);
                const split = picked.length > 1;
                return {
                  id: l.id,
                  received_qty: num(l.received),
                  roll_batch_no: l.lot.trim() || null,
                  store_id: l.qc_status === "pending" ? null : l.storeId || null,
                  bin_id: l.qc_status === "pending" || split ? null : picked[0]?.binId || null,
                  bins: l.qc_status !== "pending" && split ? picked.map((b) => ({ bin_id: b.binId, qty: num(b.qty) })) : [],
                };
              }),
      });
      if (res.ok) {
        setDirty(false);
        success(changed.length && !qtyLock ? "GRN re-posted — stock, PO balance and the draft bill follow" : "GRN updated");
        router.push(`/purchase/grn/${grn.id}`);
        router.refresh();
      } else {
        toastError(res.error);
      }
    });
  }

  const locked = !!qtyLock;
  /*
   * Item 176 · QC 112 · Received 112 · Lot No 112 · Store · Bin 176 = 688 + 40 chrome
   * (the `#`; no ✕) = 728 <= 1155 -> tableFrom="5xl".
   */
  const grnEditColumns: ChildGridColumn<EditLine>[] = [
    {
      header: "Item",
      width: FIELD_WIDTH_CSS.term,
      cell: (l) => (
        <div className="min-w-0 leading-tight">
          <Truncated className="text-sm">{l.description}</Truncated>
          <div className="font-mono text-[11px] text-muted-foreground">{l.po_code ?? ""}</div>
        </div>
      ),
    },
    {
      header: "QC",
      width: FIELD_WIDTH_CSS.range,
      cell: (l) => (
        <span className="text-xs text-muted-foreground">
          {QC_LABEL[l.qc_status] ?? l.qc_status}
          {l.rejected > 0 ? ` · ${fmtNumber(l.rejected)} failed` : ""}
        </span>
      ),
    },
    {
      header: "Received",
      width: FIELD_WIDTH_CSS.range,
      cell: (l) => (
        <>
          <Input
            type="number"
            min={0}
            inputMode="decimal"
            aria-label={`Received, ${l.description}`}
            className="h-8 text-right tabular-nums"
            disabled={locked}
            value={l.received}
            onChange={(e) => patch(l.id, { received: e.target.value })}
          />
          <FieldError id={`ge-recd-${l.id}`}>{locked ? null : problem(l)}</FieldError>
        </>
      ),
    },
    {
      header: "Lot No",
      width: FIELD_WIDTH_CSS.range,
      cell: (l) => (
        <Input
          aria-label={`Lot No, ${l.description}`}
          className="h-8"
          disabled={locked}
          value={l.lot}
          onChange={(e) => patch(l.id, { lot: e.target.value })}
        />
      ),
    },
    {
      // ONE LINE, EDITED IN A POP-UP (user 2026-11-02, screenshot 161807) — the same cell
      // as GRN entry: Bin 1 takes it all; lower it to open another (bin-split.ts).
      header: "Store · Bin",
      width: FIELD_WIDTH_CSS.term,
      cell: (l) => {
        if (l.qc_status === "pending") return <span className="text-[11px] text-muted-foreground">Store &amp; bin chosen at QC</span>;
        if (locked) {
          const picked = pickedBins(l.bins);
          const store = stores.find((st) => st.id === l.storeId)?.name ?? "—";
          const where = picked.map((b) => allBins.find((x) => x.id === b.binId)?.code ?? "—").join(", ");
          return <Truncated className="text-xs" text={`${store}${where ? ` · ${where}` : ""}`} />;
        }
        return (
          <StoreBinCell
            id={`ge-bins-${l.id}`}
            description={l.description}
            stores={stores}
            storeId={l.storeId}
            onStore={(v) => patch(l.id, { storeId: v })}
            rows={l.bins}
            onRow={(k, p) => patch(l.id, { bins: l.bins.map((x) => (x.key === k ? { ...x, ...p } : x)) })}
            accepted={accepted(l)}
            uom={null}
            bins={allBins}
            canCreateBin={canCreateBin}
            onBinCreated={(nb) => setAddedBins((xs) => [...xs, { id: nb.id, code: nb.code, description: null, store_id: nb.store_id }])}
          />
        );
      },
    },
  ];

  return (
    <div data-focus-scope className="space-y-5">
      {/* Invoice No 144 · Invoice Date 144 · DC No 144 · Vehicle 144 = 576 + 3 × 12 = 612px. */}
      <Card className="max-w-[48rem]">
        <CardHeader>
          <CardTitle>GRN Details</CardTitle>
          <span className="text-sm">
            <span className="text-muted-foreground">GRN No </span>
            <span className="font-semibold">{grn.code ?? "—"}</span>
            {grn.vendor ? <span className="text-muted-foreground"> · {grn.vendor}</span> : null}
          </span>
        </CardHeader>
        <CardBody>
          <FieldRow>
            <Field label="Invoice No" required={noPaperNo} w="code" htmlFor="ge-inv">
              <Input
                id="ge-inv"
                value={invoiceNo}
                onChange={(e) => {
                  touch();
                  setInvoiceNo(e.target.value);
                }}
              />
            </Field>
            <Field label="Invoice / DC Date" required w="code" htmlFor="ge-inv-date">
              <Input
                id="ge-inv-date"
                type="date"
                max="9999-12-31"
                value={invoiceDate}
                onChange={(e) => {
                  touch();
                  setInvoiceDate(e.target.value);
                }}
              />
            </Field>
            <Field label="DC No" w="code" htmlFor="ge-dc">
              <Input
                id="ge-dc"
                value={dcNo}
                onChange={(e) => {
                  touch();
                  setDcNo(e.target.value);
                }}
              />
            </Field>
            <Field label="Vehicle / Transport Ref" w="code" htmlFor="ge-vehicle">
              <Input
                id="ge-vehicle"
                value={vehicleRef}
                onChange={(e) => {
                  touch();
                  setVehicleRef(e.target.value);
                }}
              />
            </Field>
          </FieldRow>
        </CardBody>
      </Card>

      <div className="space-y-3">
        {/* NO "Lines" CARD (user 2026-11-03: "lines layout remove it from overall module"): the
          table sits on the page, full width — the card only added a second frame and a title. */}
        <span className={locked ? "text-xs text-warning" : "text-xs text-muted-foreground"}>
            {locked
              ? `Quantities are locked: ${qtyLock}. The paper above can still be corrected.`
              : "Changing a quantity, lot or bin re-posts the GRN: stock, PO balance and the draft bill are recalculated."}
          </span>
        <div>
          {/* default-row: exempt -- the rows are the posted GRN's own lines; nothing is added here */}
          <ChildGrid<EditLine>
            columns={grnEditColumns}
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
      </div>

      <div data-focus-region="footer" className="flex flex-wrap items-center gap-3">
        <Button variant="outline" onClick={() => router.push(`/purchase/grn/${grn.id}`)} disabled={isPending}>
          Cancel
        </Button>
        <Button onClick={save} disabled={!canSave}>
          {isPending ? "Saving…" : changed.length && !locked ? "Save & Re-post" : "Save"}
        </Button>
        {lineProblems ? <span className="text-sm text-muted-foreground">Fix the lines marked in red</span> : null}
      </div>
    </div>
  );
}
