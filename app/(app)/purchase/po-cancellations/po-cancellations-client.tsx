"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Field } from "@/components/ui/field";
import { FIELD_WIDTH_CSS } from "@/components/ui/field";
import { Card, CardHeader, CardTitle, CardBody } from "@/components/ui/card";
import { DataTable, type Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import { ToggleGroup } from "@/components/ui/segmented";
import { Tabs } from "@/components/ui/tabs";
import { RowIconAction } from "@/components/ui/row-actions";
import { ChildGrid, type ChildGridColumn } from "@/components/masters/child-grid";
import { useToast } from "@/components/ui/toast";
import { fmtDate, fmtNumber } from "@/lib/format";
import { statusTone } from "@/lib/ui/status-tone";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { cancelPurchaseOrder } from "@/lib/purchase/extras-actions";
import { requestPoCancellation, decidePoCancellation } from "@/lib/purchase/po-cancel-actions";
import { PO_CANCEL_REQUEST_STATUS_LABELS } from "@/lib/purchase/extras-types";
import type {
  CancellableLine,
  CancellablePo,
  PoCancellationWithRefs,
  PoCancelRequestRow,
  PoOption,
} from "@/lib/purchase/extras-service";
import { withCreatedColumns } from "@/components/ui/created-columns";

interface Props {
  /** The register of POs cancelled whole. */
  rows: PoCancellationWithRefs[];
  /** Drafts — cancelled directly, nobody to approve. */
  draftPos: PoOption[];
  /** Approved / partly received POs a request can be raised on. */
  requestPos: CancellablePo[];
  requests: PoCancelRequestRow[];
  canEdit: boolean;
  canApprove: boolean;
  initialPoId: string | null;
  /** From My Approvals' row link (`?open=`): the request to show first. */
  openId: string | null;
}

type Scope = "whole" | "partial";
type LineRow = CancellableLine & { key: string };

export function PoCancellationsClient({ rows, draftPos, requestPos, requests, canEdit, canApprove, initialPoId, openId }: Props) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();

  // ── the request form ─────────────────────────────────────────────────────
  const [poId, setPoId] = useState(() => (initialPoId && requestPos.some((p) => p.id === initialPoId) ? initialPoId : ""));
  const [scope, setScope] = useState<Scope>("whole");
  const [qty, setQty] = useState<Record<string, string>>({});
  const [reason, setReason] = useState("");
  // ── the draft direct cancel ──────────────────────────────────────────────
  const [draftId, setDraftId] = useState("");
  const [draftReason, setDraftReason] = useState("");
  // ── a reject in progress ─────────────────────────────────────────────────
  const [rejecting, setRejecting] = useState<PoCancelRequestRow | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  const dirty =
    !!reason.trim() || Object.values(qty).some((v) => v.trim() !== "") || !!draftReason.trim() || !!rejectReason.trim();
  useUnsavedGuard(dirty || isPending);

  const po = requestPos.find((p) => p.id === poId) ?? null;
  const lineRows: LineRow[] = useMemo(() => (po?.lines ?? []).map((l) => ({ ...l, key: l.id })), [po]);

  function resetRequest() {
    setPoId("");
    setScope("whole");
    setQty({});
    setReason("");
  }

  function handleRequest(e: React.FormEvent) {
    e.preventDefault();
    if (!po) return toastError("Select a PO");
    const lines =
      scope === "partial"
        ? lineRows
            .map((l) => ({ po_line_item_id: l.id, cancel_qty: Number(qty[l.id] ?? "") || 0 }))
            .filter((l) => l.cancel_qty > 0)
        : [];
    startTransition(async () => {
      const r = await requestPoCancellation({ purchase_order_id: po.id, scope, reason, lines });
      if (r.ok) {
        success("Sent to the MD for approval");
        resetRequest();
        router.refresh();
      } else toastError(r.error);
    });
  }

  function handleDraftCancel(e: React.FormEvent) {
    e.preventDefault();
    if (!draftId) return toastError("Select a draft PO");
    startTransition(async () => {
      const r = await cancelPurchaseOrder(draftId, draftReason);
      if (r.ok) {
        success("Draft PO cancelled");
        setDraftId("");
        setDraftReason("");
        router.refresh();
      } else toastError(r.error);
    });
  }

  function decide(id: string, action: "approve" | "reject", why?: string) {
    startTransition(async () => {
      const r = await decidePoCancellation(id, action, why);
      if (r.ok) {
        success(action === "approve" ? "Approved — the PO is updated" : "Rejected");
        setRejecting(null);
        setRejectReason("");
        router.refresh();
      } else toastError(r.error);
    });
  }

  /*
   * 288 + 88 + 88 + 88 + 88 + 112 = 752, + 40 chrome (the `#`; no ✕ — `hideRemove`)
   * = 792 <= 1155 -> tableFrom="5xl".
   */
  const cancelLineColumns: ChildGridColumn<LineRow>[] = [
    { header: "Item", width: FIELD_WIDTH_CSS.name, cell: (r) => <span className="text-sm">{r.description}</span> },
    { header: "UOM", width: FIELD_WIDTH_CSS.hug, cell: (r) => <span className="text-sm">{r.uom_code ?? ""}</span> },
    {
      header: "Ordered",
      width: FIELD_WIDTH_CSS.hug,
      align: "right",
      cell: (r) => <span className="tabular-nums text-sm">{fmtNumber(r.quantity)}</span>,
    },
    {
      header: "Received",
      width: FIELD_WIDTH_CSS.hug,
      align: "right",
      cell: (r) => <span className="tabular-nums text-sm">{fmtNumber(r.received_qty)}</span>,
    },
    {
      header: "Open",
      width: FIELD_WIDTH_CSS.hug,
      align: "right",
      cell: (r) => <span className="tabular-nums text-sm">{fmtNumber(r.open_qty)}</span>,
    },
    {
      header: "Cancel Qty",
      width: FIELD_WIDTH_CSS.range,
      align: "right",
      cell: (r) =>
        scope === "whole" ? (
          <span className="tabular-nums text-sm font-semibold">{fmtNumber(r.open_qty)}</span>
        ) : (
          <Input
            type="number"
            min="0"
            max={r.open_qty}
            step="any"
            aria-label={`Cancel qty for ${r.description}`}
            disabled={r.open_qty <= 0}
            value={qty[r.id] ?? ""}
            onChange={(e) => setQty((q) => ({ ...q, [r.id]: e.target.value }))}
          />
        ),
    },
  ];

  const requestColumns: Column<PoCancelRequestRow>[] = [
    { header: "Code", cell: (r) => <span className="font-mono text-xs font-medium">{r.code ?? "—"}</span> },
    { header: "PO", cell: (r) => <span className="text-sm">{r.po_code ?? "—"}</span> },
    { header: "Vendor", cell: (r) => <span className="text-sm">{r.vendor_name ?? "—"}</span> },
    {
      header: "Cancelling",
      cell: (r) => (
        <div className="space-y-0.5 text-sm">
          {r.scope === "whole" ? <div className="font-medium">Whole PO</div> : null}
          {r.lines.map((l) => (
            <div key={l.po_line_item_id} className="text-xs text-muted-foreground">
              {l.description}: <span className="tabular-nums text-foreground">{fmtNumber(l.cancel_qty)}</span> of{" "}
              {fmtNumber(l.open_qty)} {l.uom_code ?? ""}
            </div>
          ))}
        </div>
      ),
    },
    { header: "Reason", cell: (r) => <span className="text-sm">{r.reason}</span> },
    {
      header: "Decision",
      cell: (r) =>
        r.decided_at ? (
          <span className="text-xs text-muted-foreground">
            {fmtDate(r.decided_at)}
            {r.decision_remark ? ` · ${r.decision_remark}` : ""}
          </span>
        ) : null,
    },
    {
      header: "Status",
      cell: (r) => <StatusPill tone={statusTone(r.status)}>{PO_CANCEL_REQUEST_STATUS_LABELS[r.status]}</StatusPill>,
    },
    {
      header: "",
      cell: (r) =>
        canApprove && r.status === "submitted" ? (
          <div className="flex justify-end gap-1">
            <RowIconAction label="Approve" name={r.code} icon={Check} onClick={() => decide(r.id, "approve")} />
            <RowIconAction
              label="Reject"
              name={r.code}
              icon={X}
              danger
              onClick={() => {
                setRejecting(r);
                setRejectReason("");
              }}
            />
          </div>
        ) : null,
    },
  ];

  const registerColumns: Column<PoCancellationWithRefs>[] = [
    { header: "Code", cell: (r) => <span className="font-mono text-xs font-medium">{r.code ?? "—"}</span> },
    { header: "PO", cell: (r) => <span className="text-sm">{r.po_code ?? "—"}</span> },
    { header: "Vendor", cell: (r) => <span className="text-sm">{r.vendor_name ?? "—"}</span> },
    { header: "Reason", cell: (r) => <span className="text-sm">{r.reason}</span> },
    {
      header: "Cancelled",
      cell: (r) => <span className="tabular-nums text-xs text-muted-foreground">{fmtDate(r.created_at)}</span>,
    },
  ];

  // The request My Approvals pointed at, first.
  const orderedRequests = openId
    ? [...requests.filter((r) => r.id === openId), ...requests.filter((r) => r.id !== openId)]
    : requests;
  const waiting = requests.filter((r) => r.status === "submitted");

  return (
    <div className="space-y-4">
      {canEdit && (
        <Card>
          <CardHeader>
            <CardTitle>Request cancellation</CardTitle>
          </CardHeader>
          <CardBody>
            {requestPos.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No approved purchase order has anything still open to cancel (or each already has a request waiting).
              </p>
            ) : (
              <form onSubmit={handleRequest} className="max-w-[60rem] space-y-4" data-focus-scope="">
                {/* 288 + 16 + 288 = 592: PO and what to cancel, side by side. */}
                <div className="flex flex-wrap items-end gap-4">
                  <Field label="Purchase order" required w="name">
                    <Select
                      value={poId}
                      onChange={(e) => {
                        setPoId(e.target.value);
                        setQty({});
                      }}
                    >
                      <option value=""></option>
                      {requestPos.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.code ?? p.id.slice(0, 8)}
                          {p.vendor_name ? ` — ${p.vendor_name}` : ""}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <div className="space-y-1">
                    <Label>Cancel</Label>
                    <ToggleGroup<Scope>
                      label="What to cancel"
                      value={scope}
                      onChange={(v) => {
                        setScope(v);
                        setQty({});
                      }}
                      options={[
                        { value: "whole", label: "Whole PO" },
                        { value: "partial", label: "Chosen lines" },
                      ]}
                    />
                  </div>
                </div>

                {po ? (
                  // default-row: exempt -- rows are the PO's own lines; the grid cannot grow
                  <ChildGrid<LineRow>
                    label={scope === "whole" ? "Everything still open is cancelled" : "Enter the qty to cancel on each line"}
                    columns={cancelLineColumns}
                    rows={lineRows}
                    tableFrom="5xl"
                    flatRows
                    hideAdd
                    hideRemove
                    keepOne={false}
                    onAdd={() => false}
                    onRemove={() => {}}
                  />
                ) : null}

                <Field label="Reason" required w="name" className="max-w-[36rem]">
                  <Input value={reason} onChange={(e) => setReason(e.target.value)} required />
                </Field>
                <p className="text-xs text-muted-foreground">
                  Nothing changes on the PO until the MD approves. Then the cancelled qty comes off each line and goes
                  back on Raise PO&apos;s pending list.
                </p>
                <div className="flex justify-end gap-2">
                  <Button type="button" variant="outline" onClick={resetRequest} disabled={isPending}>
                    Clear
                  </Button>
                  <Button type="submit" disabled={isPending || !po || !reason.trim()}>
                    {isPending ? "Sending…" : "Send to MD"}
                  </Button>
                </div>
              </form>
            )}
          </CardBody>
        </Card>
      )}

      {rejecting && (
        <Card>
          <CardHeader>
            <CardTitle>Reject {rejecting.code ?? "request"}</CardTitle>
          </CardHeader>
          <CardBody>
            <div className="flex flex-wrap items-end gap-3" data-focus-scope="">
              <Field label="Reason" required w="name">
                <Input value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} autoFocus />
              </Field>
              <Button type="button" variant="outline" onClick={() => setRejecting(null)} disabled={isPending}>
                Cancel
              </Button>
              <Button
                type="button"
                variant="danger"
                disabled={isPending || !rejectReason.trim()}
                onClick={() => decide(rejecting.id, "reject", rejectReason)}
              >
                Reject
              </Button>
            </div>
          </CardBody>
        </Card>
      )}

      <Tabs
        items={[
          {
            key: "requests",
            label: `Requests (${waiting.length} waiting)`,
            content: (
              <DataTable
                columns={withCreatedColumns(requestColumns, orderedRequests)}
                rows={orderedRequests}
                getKey={(r) => r.id}
                empty="No cancellation requests yet."
              />
            ),
          },
          {
            key: "cancelled",
            label: `Cancelled POs (${rows.length})`,
            content: (
              <DataTable
                columns={withCreatedColumns(registerColumns, rows)}
                rows={rows}
                getKey={(r) => r.id}
                empty="No purchase order cancelled yet."
              />
            ),
          },
        ]}
        defaultKey="requests"
      />

      {canEdit && draftPos.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Cancel a draft PO</CardTitle>
          </CardHeader>
          <CardBody>
            {/* A draft has gone to no vendor, so its raiser cancels it directly — no approval. */}
            <form onSubmit={handleDraftCancel} className="flex flex-wrap items-end gap-3" data-focus-scope="">
              <Field label="Draft PO" required w="name">
                <Select value={draftId} onChange={(e) => setDraftId(e.target.value)}>
                  <option value=""></option>
                  {draftPos.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.code ?? p.id.slice(0, 8)}
                      {p.vendor_name ? ` — ${p.vendor_name}` : ""}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Reason" required w="name">
                <Input value={draftReason} onChange={(e) => setDraftReason(e.target.value)} required />
              </Field>
              <Button type="submit" variant="outline" className="text-danger hover:border-danger" disabled={isPending}>
                {isPending ? "Cancelling…" : "Cancel draft"}
              </Button>
            </form>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
