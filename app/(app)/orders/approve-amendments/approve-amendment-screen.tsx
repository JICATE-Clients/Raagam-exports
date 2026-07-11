"use client";

import { useMemo, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/ui/page-header";
import { DataTable, type Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import { FilterBar } from "@/components/masters/filter-bar";
import { useToast } from "@/components/ui/toast";
import { fmtDate, fmtNumber } from "@/lib/format";
import { decideAmendment } from "@/lib/orders/approve-amendments/actions";
import {
  APPROVAL_STATUSES,
  approvalStatusLabel,
  approvalStatusTone,
  type ApprovalQueueRow,
  type ApprovalStatus,
} from "@/lib/orders/approve-amendments/types";

interface Props {
  rows: ApprovalQueueRow[];
  canDecide: boolean;
}

type Decision = "approved" | "rejected";
type ModalState = { ids: string[]; decision: Decision } | null;

export function ApproveAmendmentScreen({ rows, canDecide }: Props) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, start] = useTransition();

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | ApprovalStatus>("all");
  const [customerFilter, setCustomerFilter] = useState<"all" | string>("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [modal, setModal] = useState<ModalState>(null);
  const [reason, setReason] = useState("");

  // Customer filter options, unique by buyer id.
  const customers = useMemo(() => {
    const m = new Map<string, string>();
    rows.forEach((r) => {
      if (r.buyer) m.set(r.buyer.id, r.buyer.name);
    });
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (statusFilter !== "all" && r.approval_status !== statusFilter) return false;
      if (customerFilter !== "all" && r.buyer?.id !== customerFilter) return false;
      if (q) {
        const hay = [
          r.sales_order?.order_number,
          r.buyer?.name,
          r.po_no,
          r.code,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [rows, search, statusFilter, customerFilter]);

  const activeCount = (statusFilter !== "all" ? 1 : 0) + (customerFilter !== "all" ? 1 : 0);

  function toggle(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleAll() {
    setSelected((prev) => {
      const allOn = filtered.length > 0 && filtered.every((r) => prev.has(r.id));
      if (allOn) return new Set();
      return new Set(filtered.map((r) => r.id));
    });
  }

  function openDecision(ids: string[], decision: Decision) {
    if (!ids.length) return;
    setModal({ ids, decision });
    setReason("");
  }

  function submitDecision() {
    if (!modal) return;
    const { ids, decision } = modal;
    start(async () => {
      const res = await decideAmendment(ids, decision, reason);
      if (res.ok) {
        success(decision === "approved" ? "Amendment(s) approved" : "Amendment(s) rejected");
        setModal(null);
        setReason("");
        setSelected(new Set());
        router.refresh();
      } else {
        toastError(res.error);
      }
    });
  }

  const columns: Column<ApprovalQueueRow>[] = [
    { header: "SC No", cell: (r) => <span className="font-mono text-xs">{r.sales_order?.order_number ?? "—"}</span> },
    { header: "SC Dt", cell: (r) => <span className="tabular-nums text-xs">{fmtDate(r.sales_order?.ship_date ?? null)}</span> },
    { header: "Order No", cell: (r) => <span className="text-sm">{r.po_no ?? "—"}</span> },
    { header: "Customer", cell: (r) => <span className="text-sm">{r.buyer?.name ?? "—"}</span> },
    { header: "Delivery Dt", cell: (r) => <span className="tabular-nums text-xs">{fmtDate(r.delivery_date)}</span> },
    { header: "Ship Type", cell: (r) => <span className="text-sm">{r.ship_type?.name ?? "—"}</span> },
    { header: "Ship Mode", cell: (r) => <span className="text-sm">{r.ship_mode ?? "—"}</span> },
    { header: "Currency", cell: (r) => <span className="text-sm">{r.currency_code ?? "—"}</span> },
    { header: "Pay Mode", cell: (r) => <span className="text-sm">{r.pay_mode ?? "—"}</span> },
    { header: "Order Qty", align: "right", cell: (r) => <span className="tabular-nums text-sm">{fmtNumber(r.sales_order?.order_qty ?? null)}</span> },
    { header: "Amended Dt", cell: (r) => <span className="tabular-nums text-xs">{fmtDate(r.amend_date)}</span> },
    { header: "Amendment No", cell: (r) => <span className="font-mono text-xs font-medium">{r.code ?? "—"}</span> },
    {
      header: "Approval Status",
      cell: (r) => <StatusPill tone={approvalStatusTone(r.approval_status)}>{approvalStatusLabel(r.approval_status)}</StatusPill>,
    },
    { header: "Created User", cell: (r) => <span className="text-sm">{r.creator?.full_name ?? "—"}</span> },
    {
      header: "Reason",
      cell: (r) => (
        <span className="block max-w-[16rem] truncate text-sm text-muted-foreground" title={r.reason_text ?? undefined}>
          {r.reason_text ?? "—"}
        </span>
      ),
    },
    {
      header: "",
      align: "right",
      cell: (r) => (
        <div className="flex items-center justify-end gap-1 whitespace-nowrap">
          <Link
            href="/orders/amendments"
            className="text-xs font-medium text-primary hover:underline"
          >
            Details
          </Link>
          {canDecide && r.approval_status === "pending" && (
            <>
              <Button variant="outline" size="sm" onClick={() => openDecision([r.id], "approved")}>
                Approve
              </Button>
              <Button variant="outline" size="sm" onClick={() => openDecision([r.id], "rejected")}>
                Reject
              </Button>
            </>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Approve Amendment"
        description="Review and approve or reject raised garment order amendments."
        actions={
          <Link href="/orders">
            <Button variant="outline" size="sm">
              ← Garment Orders
            </Button>
          </Link>
        }
      />

      <FilterBar
        search={search}
        onSearch={setSearch}
        searchPlaceholder="Search SC No, customer, order no, amendment no…"
        activeCount={activeCount}
        onReset={() => {
          setStatusFilter("all");
          setCustomerFilter("all");
        }}
        right={`${filtered.length} of ${rows.length}`}
      >
        <div>
          <Label htmlFor="flt-status">Status</Label>
          <Select
            id="flt-status"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as "all" | ApprovalStatus)}
          >
            <option value="all">All</option>
            {APPROVAL_STATUSES.map((s) => (
              <option key={s} value={s}>
                {approvalStatusLabel(s)}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="flt-customer">Customer</Label>
          <Select
            id="flt-customer"
            value={customerFilter}
            onChange={(e) => setCustomerFilter(e.target.value)}
          >
            <option value="all">All</option>
            {customers.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </Select>
        </div>
      </FilterBar>

      {canDecide && selected.size > 0 && (
        <div className="sticky top-2 z-10 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface/95 px-3 py-2 shadow-sm backdrop-blur">
          <span className="text-sm font-medium">{selected.size} selected</span>
          <div className="flex-1" />
          <Button size="sm" onClick={() => openDecision([...selected], "approved")}>
            Approve selected ({selected.size})
          </Button>
          <Button variant="outline" size="sm" onClick={() => openDecision([...selected], "rejected")}>
            Reject selected ({selected.size})
          </Button>
          <button
            type="button"
            onClick={() => setSelected(new Set())}
            aria-label="Clear selection"
            className="ml-1 text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      <DataTable
        columns={columns}
        rows={filtered}
        getKey={(r) => r.id}
        empty="No amendments awaiting approval."
        selectable={canDecide}
        selectedKeys={selected}
        onToggle={toggle}
        onToggleAll={toggleAll}
      />

      {modal && (
        <DecisionModal
          decision={modal.decision}
          count={modal.ids.length}
          reason={reason}
          onReason={setReason}
          onCancel={() => setModal(null)}
          onConfirm={submitDecision}
          busy={isPending}
        />
      )}
    </div>
  );
}

function DecisionModal({
  decision,
  count,
  reason,
  onReason,
  onCancel,
  onConfirm,
  busy,
}: {
  decision: Decision;
  count: number;
  reason: string;
  onReason: (v: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
  busy: boolean;
}) {
  const isReject = decision === "rejected";
  const reasonMissing = isReject && !reason.trim();

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-lg border border-border bg-surface p-5 shadow-lg">
        <h2 className="text-lg font-semibold">
          {isReject ? "Reject" : "Approve"} {count > 1 ? `${count} amendments` : "amendment"}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {isReject
            ? "This records a rejection decision. A reason is required."
            : "This records an approval decision. A reason is optional."}
        </p>
        <div className="mt-4">
          <Label htmlFor="decision-reason">Reason {isReject ? "*" : "(optional)"}</Label>
          <Textarea
            id="decision-reason"
            rows={3}
            value={reason}
            onChange={(e) => onReason(e.target.value)}
            placeholder={isReject ? "Why is this amendment rejected?" : "Optional note…"}
          />
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={onConfirm} disabled={busy || reasonMissing}>
            {busy ? "Saving…" : isReject ? "Reject" : "Approve"}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
