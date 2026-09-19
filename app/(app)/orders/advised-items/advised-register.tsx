"use client";

/**
 * Orders ▸ Advised Items — the REGISTER: every order that has a Material BOM
 * line still "To be advised", grouped by RE No (doc/order/advised-items-plan.md).
 *
 * A VIEW, NOT A SECOND LIST. An advised line IS a Material BOM line whose
 * `type` is "To be advised" (the TBA toggle); this screen reads those lines and
 * writes nothing but the conversion. The orphan editor it replaces kept a
 * free-text list of its own that nothing else read — two answers to "what is
 * still to be advised", which disagree the first time one is edited.
 *
 * THE LIST IS THE SHELL'S. `MasterListShell` supplies the search, the toolbar,
 * the Created Date / Created User pair (AGENTS.md) and the mobile cards; the
 * screen only says which columns and where a row opens.
 */

import { useRouter } from "next/navigation";
import { MasterListShell } from "@/components/masters/master-list-shell";
import { PageHeader } from "@/components/ui/page-header";
import { StatusPill } from "@/components/ui/status-pill";
import { Truncated } from "@/components/ui/truncated";
import type { Column } from "@/components/ui/data-table";
import type { AdvisedOrderRow } from "@/lib/orders/advised/types";

export function AdvisedRegister({ rows }: { rows: AdvisedOrderRow[] }) {
  const router = useRouter();
  const open = (r: AdvisedOrderRow) => router.push(`/orders/advised-items/${r.id}`);

  const columns: Column<AdvisedOrderRow>[] = [
    {
      header: "RE No",
      cell: (r) => (
        <button
          type="button"
          className="font-mono text-xs font-medium text-primary hover:underline"
          onClick={() => open(r)}
        >
          {r.re_no ?? r.id.slice(0, 8)}
        </button>
      ),
    },
    { header: "Customer", cell: (r) => <Truncated>{r.customer_name ?? ""}</Truncated> },
    {
      header: "Pending",
      align: "right",
      // PENDING IS THE NUMBER THAT BLOCKS A PURCHASE ORDER — every one of these
      // lines refuses a PO until it is converted — so it is the loud one.
      cell: (r) => (
        <span className={r.pending > 0 ? "tabular-nums text-sm font-semibold text-danger" : "tabular-nums text-sm"}>
          {r.pending}
        </span>
      ),
    },
    {
      header: "Converted",
      align: "right",
      cell: (r) => <span className="tabular-nums text-sm">{r.converted}</span>,
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Advised Items"
        description="Materials still to be advised by the buyer, by order — each one blocks its purchase order until it is converted."
      />
      <MasterListShell<AdvisedOrderRow>
        rows={rows}
        getKey={(r) => r.id}
        // NOTHING IS ADDED OR DELETED HERE — a line becomes advised on the
        // Material BOM (the TBA toggle) and leaves by conversion, on the order's
        // own page. The shell's Add and Delete therefore have no door to open.
        perms={{ canCreate: false, canEdit: false, canDelete: false }}
        searchText={(r) => [r.re_no, r.customer_name].filter(Boolean).join(" ")}
        searchPlaceholder="Search RE No or customer…"
        columns={columns}
        actions={{ onView: open }}
        empty="No order has a material still to be advised."
        mobile={{
          title: (r) => r.re_no ?? r.id.slice(0, 8),
          subtitle: (r) => r.customer_name ?? "",
          pill: (r) =>
            r.pending > 0 ? (
              <StatusPill tone="danger">{r.pending} pending</StatusPill>
            ) : (
              <StatusPill tone="success">All converted</StatusPill>
            ),
          onView: open,
        }}
      />
    </div>
  );
}
