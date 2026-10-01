"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { FIELD_WIDTH_CSS } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { ChildGrid, type ChildGridColumn } from "@/components/masters/child-grid";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { fmtFixed } from "@/lib/format";
import { saveManualCosts } from "@/lib/orders/profitability/actions";
import { MANUAL_BUCKETS, MANUAL_BUCKET_LABELS, type ManualBucket, type ManualCostRow } from "@/lib/orders/profitability/types";

/**
 * The hand-entered heads of one order's statement — CMT & Overheads and Other
 * Income (0667). Its own Save: these rows belong to the order, not to a
 * document being edited elsewhere.
 *
 * OPENS WITH A ROW (AGENTS.md "Editable sub-tables open with a row"): the blank
 * factory stamps only "" and the default head, and the save side drops a row
 * with no description and no amount — the head is a default, so it is never
 * the evidence that a row was typed. No cell is `required`: an order with no
 * CMT recorded yet is a legitimate state, and a required cell in a seeded row
 * would hold the cursor in a grid nobody has read yet.
 */

type Row = { key: string; id: string | null; bucket: ManualBucket; description: string; amount: string; remarks: string };

let seq = 0;
const newKey = () => `mc-${++seq}`;
const blank = (): Row => ({ key: newKey(), id: null, bucket: "cmt_overheads", description: "", amount: "", remarks: "" });
const toRows = (initial: ManualCostRow[]): Row[] =>
  initial.length
    ? initial.map((r) => ({
        key: newKey(),
        id: r.id,
        bucket: r.bucket,
        description: r.description,
        amount: String(r.amount_inr),
        remarks: r.remarks ?? "",
      }))
    : [blank()];

const amountOf = (v: string) => {
  const n = Number(v.replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : 0;
};

export function ManualCostsEditor({
  salesOrderId,
  initial,
  canEdit,
}: {
  salesOrderId: string;
  initial: ManualCostRow[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [rows, setRows] = useState<Row[]>(() => toRows(initial));
  const [dirty, setDirty] = useState(false);
  const [isPending, startTransition] = useTransition();
  useUnsavedGuard(dirty || isPending);

  const patch = (key: string, p: Partial<Row>) => {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...p } : r)));
    setDirty(true);
  };

  /* WIDTHS (check:grid-budget): term 176 + name 288 + range 112 + name 288
     = 864, and 936 with the grid's 72px chrome ≤ 1155. */
  const columns: ChildGridColumn<Row>[] = [
    {
      header: "Type",
      width: FIELD_WIDTH_CSS.term,
      cell: (r) => (
        <Select
          compact
          aria-label="Type"
          disabled={!canEdit}
          value={r.bucket}
          onChange={(e) => patch(r.key, { bucket: e.target.value as ManualBucket })}
        >
          {MANUAL_BUCKETS.map((b) => (
            <option key={b} value={b}>
              {MANUAL_BUCKET_LABELS[b]}
            </option>
          ))}
        </Select>
      ),
    },
    {
      header: "What was it for",
      width: FIELD_WIDTH_CSS.name,
      cell: (r) => (
        <Input
          className="h-8"
          aria-label="What was it for"
          readOnly={!canEdit}
          value={r.description}
          onChange={(e) => patch(r.key, { description: e.target.value })}
        />
      ),
    },
    {
      header: "Amount (₹)",
      align: "right",
      width: FIELD_WIDTH_CSS.range,
      total: { kind: "sum", of: (r) => amountOf(r.amount), format: (n) => fmtFixed(n) },
      cell: (r) => (
        <Input
          className="h-8 text-right"
          inputMode="decimal"
          aria-label="Amount"
          readOnly={!canEdit}
          value={r.amount}
          onChange={(e) => patch(r.key, { amount: e.target.value })}
        />
      ),
    },
    {
      header: "Note",
      width: FIELD_WIDTH_CSS.name,
      cell: (r) => (
        <Input
          className="h-8"
          aria-label="Note"
          readOnly={!canEdit}
          value={r.remarks}
          onChange={(e) => patch(r.key, { remarks: e.target.value })}
        />
      ),
    },
  ];

  const save = () =>
    startTransition(async () => {
      const res = await saveManualCosts(
        salesOrderId,
        rows.map((r) => ({ id: r.id, bucket: r.bucket, description: r.description, amount_inr: r.amount, remarks: r.remarks })),
      );
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setDirty(false);
      toast.success("Saved");
      router.refresh();
    });

  return (
    // Full width: the grid's table layout switches on at 5xl (1024px), and the
    // old 60rem cap kept it in unlabelled stacked cards (screenshot 2026-10-01).
    <div className="space-y-3">
      <ChildGrid<Row>
        columns={columns}
        rows={rows}
        tableFrom="5xl"
        onAdd={() => {
          setRows((rs) => [...rs, blank()]);
          setDirty(true);
        }}
        onRemove={(r) => {
          setRows((rs) => {
            const left = rs.filter((x) => x.key !== r.key);
            return left.length ? left : [blank()];
          });
          setDirty(true);
        }}
        addLabel="+ Add a cost"
        hideAdd={!canEdit}
        hideRemove={!canEdit}
      />
      {canEdit && (
        <div className="flex justify-end">
          <Button onClick={save} disabled={!dirty || isPending}>
            {isPending ? "Saving…" : "Save"}
          </Button>
        </div>
      )}
    </div>
  );
}
