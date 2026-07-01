import Link from "next/link";
import { requireUser, can } from "@/lib/auth/server";
import { getDashboardData } from "@/lib/orders/service";
import { milestoneTone } from "@/lib/orders/types";
import { fmtDate } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardHeader, CardTitle, CardBody } from "@/components/ui/card";
import { Stat } from "@/components/ui/stat";
import { DataTable, type Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import type { DashboardMilestoneRow, OrderStatusCount } from "@/lib/orders/service";

const ORDER_STATUS_LABELS: Record<string, string> = {
  confirmed: "Confirmed",
  in_production: "In Production",
  shipped: "Shipped",
  closed: "Closed",
  cancelled: "Cancelled",
};

const milestoneColumns: Column<DashboardMilestoneRow>[] = [
  {
    header: "Order",
    cell: (m) =>
      m.order_number ? (
        <Link
          href={`/orders/${m.sales_order_id}`}
          className="font-mono text-xs text-primary hover:underline"
        >
          {m.order_number}
        </Link>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
  },
  {
    header: "Buyer",
    cell: (m) => (
      <span className="text-sm">{m.buyer_name ?? "—"}</span>
    ),
  },
  {
    header: "Milestone",
    cell: (m) => <span className="text-sm">{m.name}</span>,
  },
  {
    header: "Planned Date",
    cell: (m) => (
      <span className="tabular-nums text-sm">{fmtDate(m.planned_date)}</span>
    ),
  },
  {
    header: "Status",
    cell: (m) => (
      <StatusPill tone={milestoneTone(m)}>
        {m.planned_date && new Date(m.planned_date + "T00:00:00") < new Date()
          ? "Overdue"
          : "Due soon"}
      </StatusPill>
    ),
  },
];

const pipelineColumns: Column<OrderStatusCount>[] = [
  {
    header: "Status",
    cell: (r) => (
      <span className="text-sm">{ORDER_STATUS_LABELS[r.status] ?? r.status}</span>
    ),
  },
  {
    header: "Orders",
    align: "right",
    cell: (r) => (
      <span className="tabular-nums text-sm font-semibold">{r.count}</span>
    ),
  },
];

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ denied?: string }>;
}) {
  const user = await requireUser();
  const { denied } = await searchParams;
  const canViewOrders = await can("orders", "view");

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Good day, ${user.fullName ?? "there"}`}
        description="Order T&A Dashboard — Raagam Exports ERP"
      />

      {/* Permission-denied notice */}
      {denied && (
        <div className="rounded-md border border-warning bg-warning-soft px-4 py-3 text-sm text-warning">
          You don&apos;t have permission to access the{" "}
          <strong>{denied}</strong> module.
        </div>
      )}

      {canViewOrders ? (
        <OrdersDashboard />
      ) : (
        <Card>
          <CardBody className="py-10 text-center">
            <p className="text-sm font-medium text-foreground">
              Order data not available
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              You don&apos;t have permission to view orders. Contact your
              administrator to request access.
            </p>
          </CardBody>
        </Card>
      )}
    </div>
  );
}

// ---------- Orders dashboard section (only rendered when user has orders:view) ----------

async function OrdersDashboard() {
  const data = await getDashboardData();
  const {
    openOrders,
    overdueCount,
    dueThisWeekCount,
    pendingAmendments,
    statusCounts,
    milestoneRows,
  } = data;

  const totalOrders = statusCounts.reduce((s, r) => s + r.count, 0);

  return (
    <>
      {/* KPI stats — 2-col on mobile, 4-col on md+ */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat
          label="Open orders"
          value={openOrders}
          hint="Confirmed + in production"
          tone="info"
        />
        <Stat
          label="Milestones due this week"
          value={dueThisWeekCount}
          hint="Next 7 days, not done"
          tone="warning"
        />
        <Stat
          label="Overdue milestones"
          value={overdueCount}
          hint="Past planned date, not done"
          tone={overdueCount > 0 ? "danger" : "neutral"}
        />
        <Stat
          label="Pending amendments"
          value={pendingAmendments}
          hint="Awaiting approval"
          tone={pendingAmendments > 0 ? "warning" : "neutral"}
        />
      </div>

      {/* Milestone attention table */}
      <Card>
        <CardHeader>
          <CardTitle>Milestones — overdue &amp; due this week</CardTitle>
          <Link
            href="/orders"
            className="text-xs text-primary hover:underline"
          >
            View all orders →
          </Link>
        </CardHeader>
        <CardBody className="p-0">
          <DataTable
            columns={milestoneColumns}
            rows={milestoneRows}
            getKey={(m) => m.id}
            empty="No overdue or upcoming milestones — everything on track."
          />
        </CardBody>
      </Card>

      {/* Order pipeline health */}
      <Card>
        <CardHeader>
          <CardTitle>Order pipeline health</CardTitle>
          <span className="text-xs text-muted-foreground">
            {totalOrders} total order{totalOrders !== 1 ? "s" : ""}
          </span>
        </CardHeader>
        <CardBody className="p-0">
          <DataTable
            columns={pipelineColumns}
            rows={statusCounts.filter((r) => r.count > 0)}
            getKey={(r) => r.status}
            empty="No orders yet."
          />
        </CardBody>
      </Card>
    </>
  );
}
