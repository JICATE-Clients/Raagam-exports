"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChildGrid, type ChildGridColumn } from "@/components/masters/child-grid";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldError, FieldRow, FIELD_WIDTH_CSS } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Truncated } from "@/components/ui/truncated";
import { StoreBinPickCell } from "@/components/purchase/store-bin-editor";
import { useToast } from "@/components/ui/toast";
import { postDcReturn } from "@/lib/purchase/general-dc-actions";
import type { GeneralDc } from "@/lib/purchase/general-dc-service";
import { partyOf } from "@/lib/purchase/general-dc-party";
import type { BinOption, StoreOption } from "@/lib/stores/production-dc-service";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { today } from "@/lib/calendar";
import { fmtDate, fmtNumber } from "@/lib/format";

/**
 * DELIVERY RETURN (0797) — a RETURNABLE General DC coming back: the same item, no loss, no
 * bill. One row per DC line still out: Sent · Back so far · Returning now · Store · Bin · Lot.
 * Close bal. writes off what will not come back, with a mandatory reason. Posting is one
 * database call (`dc_return_post`), all or nothing.
 */

// default-row: exempt -- the rows are the DC's own lines, derived from the document; none is added here

type Row = {
  key: string;
  itemId: string | null;
  description: string;
  uom: string | null;
  sent: number;
  back: number;
  left: number;
  qty: string;
  closeBalance: boolean;
  reason: string;
  storeId: string;
  binId: string;
  lotNo: string;
};

function num(s: string): number {
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

export function DcReturnForm({
  dc,
  stores,
  bins,
  home = "/purchase/delivery-returns",
}: {
  dc: GeneralDc;
  stores: StoreOption[];
  bins: BinOption[];
  home?: string;
}) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();
  // Back into a stock store of this unit — never Processing, where the goods sat while out.
  const backStores = stores.filter((s) => s.store_type !== "processing");

  const [returnDate, setReturnDate] = useState(today());
  const [partyDcNo, setPartyDcNo] = useState("");
  const [notes, setNotes] = useState("");
  const [rows, setRows] = useState<Row[]>(() =>
    dc.lines
      .map((l) => ({
        key: l.id,
        itemId: l.item_id,
        description: l.description,
        uom: l.uom,
        sent: l.sent_qty,
        back: l.returned_qty + l.closed_qty,
        left: Math.max(l.sent_qty - l.returned_qty - l.closed_qty, 0),
        qty: "",
        closeBalance: false,
        reason: "",
        // It goes back where it came from unless the keeper says otherwise.
        storeId: l.from_store_id && backStores.some((s) => s.id === l.from_store_id) ? l.from_store_id : "",
        binId: l.bin_id ?? "",
        lotNo: l.lot_no ?? "",
      }))
      .filter((r) => r.left > 1e-9),
  );
  const [dirty, setDirty] = useState(false);
  useUnsavedGuard(dirty || isPending);

  function update(key: string, patch: Partial<Omit<Row, "key">>) {
    setDirty(true);
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  const problemOf = (r: Row): string | null => {
    const q = num(r.qty);
    if (q < 0) return "Cannot be negative";
    if (q > r.left + 1e-9) return `Only ${fmtNumber(r.left)} is out`;
    if (q > 0 && r.itemId && !r.storeId) return "Pick the store";
    if (r.closeBalance && r.left - q > 1e-9 && !r.reason.trim()) return "Say why the rest is not coming back";
    return null;
  };
  const acting = rows.filter((r) => num(r.qty) > 0 || (r.closeBalance && r.left - num(r.qty) > 1e-9));
  const anyProblem = rows.some((r) => !!problemOf(r));
  const blocker = !returnDate ? "Pick the return date" : acting.length === 0 ? "Enter what came back" : anyProblem ? "Fix the lines marked in red" : null;
  const canPost = !isPending && !blocker;

  function post() {
    if (!canPost) return;
    startTransition(async () => {
      const result = await postDcReturn(dc.id, {
        return_date: returnDate,
        party_dc_no: partyDcNo.trim() || null,
        notes: notes.trim() || null,
        lines: acting.map((r) => ({
          dc_line_id: r.key,
          returned_qty: num(r.qty),
          close_balance: r.closeBalance,
          close_reason: r.closeBalance ? r.reason.trim() || null : null,
          store_id: r.itemId ? r.storeId || null : null,
          bin_id: r.itemId ? r.binId || null : null,
          lot_no: r.itemId ? r.lotNo.trim() || null : null,
        })),
      });
      if (result.ok) {
        setDirty(false);
        success("Return posted");
        router.push(home);
      } else {
        toastError(result.error);
        router.refresh();
      }
    });
  }

  /*
   * Description 200 · Sent 88 · Back 88 · Returning 88 · Close bal. 72 · Reason 176 ·
   * Store · Bin 176 (one button, 2026-11-03) · Lot No 112 = 1000, + 72 chrome = 1072 <= 1155
   * -> tableFrom="5xl".
   */
  const dcReturnColumns: ChildGridColumn<Row>[] = [
    {
      header: "Description",
      width: FIELD_WIDTH_CSS.party,
      cell: (r) => <Truncated className="text-sm font-medium">{r.description}</Truncated>,
    },
    {
      header: "Sent",
      width: FIELD_WIDTH_CSS.hug,
      align: "right",
      cell: (r) => (
        <span className="tabular-nums text-sm">
          {fmtNumber(r.sent)} <span className="text-xs text-muted-foreground">{r.uom ?? ""}</span>
        </span>
      ),
    },
    {
      header: "Back So Far",
      width: FIELD_WIDTH_CSS.hug,
      align: "right",
      cell: (r) => <span className="tabular-nums text-sm text-muted-foreground">{fmtNumber(r.back)}</span>,
    },
    {
      header: "Returning",
      width: FIELD_WIDTH_CSS.hug,
      cell: (r) => {
        const problem = problemOf(r);
        return (
          <>
            <Input
              type="number"
              min={0}
              inputMode="decimal"
              aria-label={`Returning now, ${r.description}`}
              aria-invalid={problem ? true : undefined}
              aria-describedby={problem ? `drn-${r.key}-error` : undefined}
              className="h-8 text-right tabular-nums"
              value={r.qty}
              placeholder={fmtNumber(r.left)}
              onChange={(e) => update(r.key, { qty: e.target.value })}
            />
            <FieldError id={`drn-${r.key}-error`}>{problem}</FieldError>
          </>
        );
      },
    },
    {
      header: "Close Bal.",
      width: FIELD_WIDTH_CSS.num,
      cell: (r) => (
        <label data-focus-optional className="flex items-center gap-1 text-[11px]" title="The rest will not come back — write it off">
          <input
            type="checkbox"
            aria-label={`Close the balance, ${r.description}`}
            checked={r.closeBalance}
            onChange={(e) => update(r.key, { closeBalance: e.target.checked })}
          />
          <span className="tabular-nums text-muted-foreground">{fmtNumber(Math.max(r.left - num(r.qty), 0))}</span>
        </label>
      ),
    },
    {
      header: "Reason",
      width: FIELD_WIDTH_CSS.term,
      cell: (r) => (
        <Input
          aria-label={`Why the rest is not coming back, ${r.description}`}
          className="h-8"
          value={r.reason}
          disabled={!r.closeBalance}
          onChange={(e) => update(r.key, { reason: e.target.value })}
        />
      ),
    },
    {
      // ONE BUTTON, STORE AND BIN IN A POP-UP — GRN's cell (user 2026-11-03, screenshot 095545).
      header: "Store · Bin",
      width: FIELD_WIDTH_CSS.term,
      // pick-once: exempt -- several lines go back into the same store and bin
      cell: (r) =>
        r.itemId ? (
          <StoreBinPickCell
            description={r.description}
            parent="Return"
            stores={backStores}
            storeId={r.storeId}
            onStore={(v) => update(r.key, { storeId: v })}
            allowNoStore
            bins={bins}
            binId={r.binId}
            onBin={(v) => update(r.key, { binId: v })}
          />
        ) : (
          <span className="text-xs text-muted-foreground">No stock</span>
        ),
    },
    {
      header: "Lot No",
      width: FIELD_WIDTH_CSS.range,
      cell: (r) =>
        r.itemId ? <Input aria-label="Lot No" className="h-8" value={r.lotNo} onChange={(e) => update(r.key, { lotNo: e.target.value })} /> : null,
    },
  ];

  return (
    <div data-focus-scope className="space-y-5">
      {/* DC facts, then Return Date 144 · Party DC No 144 · Notes 288 = 576 + gaps → 48rem cap. */}
      <Card className="max-w-[48rem]">
        <CardHeader>
          <CardTitle>Return against {dc.code ?? "General DC"}</CardTitle>
          <span className="text-xs text-muted-foreground">
            {partyOf(dc)} · {dc.purpose ?? ""} · sent {fmtDate(dc.dc_date)}
            {dc.expected_return_date ? ` · due ${fmtDate(dc.expected_return_date)}` : ""}
          </span>
        </CardHeader>
        <CardBody>
          <FieldRow>
            <Field label="Return Date" required w="code" htmlFor="drn-date">
              <Input
                id="drn-date"
                type="date"
                max="9999-12-31"
                value={returnDate}
                onChange={(e) => {
                  setDirty(true);
                  setReturnDate(e.target.value);
                }}
              />
            </Field>
            <Field label="Party DC No" w="code" htmlFor="drn-party-dc">
              <Input
                id="drn-party-dc"
                value={partyDcNo}
                onChange={(e) => {
                  setDirty(true);
                  setPartyDcNo(e.target.value);
                }}
              />
            </Field>
            <Field label="Notes" w="name" htmlFor="drn-notes">
              <Input
                id="drn-notes"
                value={notes}
                onChange={(e) => {
                  setDirty(true);
                  setNotes(e.target.value);
                }}
              />
            </Field>
          </FieldRow>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Items Coming Back</CardTitle>
        </CardHeader>
        <CardBody>
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing is still out on this DC.</p>
          ) : (
            <ChildGrid<Row> columns={dcReturnColumns} rows={rows} tableFrom="5xl" flatRows hideAdd hideRemove onAdd={() => {}} onRemove={() => {}} />
          )}
        </CardBody>
      </Card>

      <div data-focus-region="footer" className="flex flex-wrap items-center gap-3">
        <Button variant="outline" onClick={() => router.push(home)} disabled={isPending}>
          Cancel
        </Button>
        <Button onClick={post} disabled={!canPost}>
          {isPending ? "Posting…" : "Post return"}
        </Button>
        {blocker && !isPending ? <span className="text-sm text-muted-foreground">{blocker}</span> : null}
      </div>
    </div>
  );
}
