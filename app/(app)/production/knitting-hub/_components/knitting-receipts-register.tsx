import Link from "next/link";
import { DataTable, type Column } from "@/components/ui/data-table";
import { withCreatedColumns } from "@/components/ui/created-columns";
import { PageHeader } from "@/components/ui/page-header";
import { fmtDate, fmtNumber } from "@/lib/format";
import type { KnitReceiptListRow } from "@/lib/production/knitting-service";

const BASE = "/production/knitting-hub";

/**
 * The register of Fabric Receipts, or of Yarn Returns (client 2026-11-11, 0831: "distinct
 * screens/menus"). Server-rendered and read-only: a posted document cannot change, and each is
 * POSTED on its Knitting Order (tabs 3 and 4), which is where the KO No link goes.
 */
export function KnittingReceiptsRegister({ kind, rows }: { kind: "fabric" | "yarn_return"; rows: KnitReceiptListRow[] }) {
  const fabric = kind === "fabric";
  const columns: Column<KnitReceiptListRow>[] = [
    { header: fabric ? "Receipt No" : "Return No", cell: (r) => <span className="font-mono text-xs font-medium">{r.code ?? "—"}</span> },
    { header: "Date", cell: (r) => <span className="tabular-nums text-sm">{fmtDate(r.receipt_date)}</span> },
    {
      header: "KO No",
      cell: (r) => (
        <Link href={`${BASE}/${r.order_id}`} className="font-mono text-xs text-primary hover:underline">
          {r.order_code ?? "—"}
        </Link>
      ),
    },
    { header: "RE No", cell: (r) => <span className="text-sm">{r.re_no ?? "—"}</span> },
    { header: "Knitter", cell: (r) => <span className="text-sm">{r.knitter ?? "—"}</span> },
    { header: "Knitter DC", cell: (r) => <span className="text-sm">{r.vendor_dc_no ?? "—"}</span> },
    ...(fabric ? [{ header: "Rolls", align: "right" as const, cell: (r: KnitReceiptListRow) => <span className="tabular-nums text-sm">{r.rolls || "—"}</span> }] : []),
    { header: fabric ? "Fabric Kg" : "Yarn Back Kg", align: "right", cell: (r) => <span className="tabular-nums text-sm">{fmtNumber(r.kg)}</span> },
  ];
  return (
    <div className="space-y-4">
      <PageHeader
        title={fabric ? "Fabric Receipts" : "Yarn Returns"}
        description={
          fabric
            ? "Knitted fabric received from the knitters — post one on its Knitting Order, tab 3"
            : "Unknitted yarn the knitters sent back — post one on its Knitting Order, tab 4"
        }
      />
      <DataTable
        columns={withCreatedColumns(columns, rows)}
        rows={rows}
        getKey={(r) => r.id}
        empty={fabric ? "No fabric received yet." : "No yarn returned yet."}
      />
    </div>
  );
}
