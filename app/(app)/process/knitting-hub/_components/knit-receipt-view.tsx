import Link from "next/link";
import { DataTable, type Column } from "@/components/ui/data-table";
import { DocFacts } from "@/components/purchase/doc-facts";
import { PageHeader } from "@/components/ui/page-header";
import { creatorName } from "@/components/ui/created-columns";
import { fmtDate, fmtNumber } from "@/lib/format";
import type { KnitReceiptDoc } from "@/lib/production/knitting-service";

type FabricLine = KnitReceiptDoc["fabrics"][number];
type YarnLine = KnitReceiptDoc["yarns"][number];

const KIND_LABEL: Record<YarnLine["kind"], string> = { used: "Used in fabric", returned: "Returned", written_off: "Written off" };

/**
 * ONE POSTED FABRIC RECEIPT / YARN RETURN, READ-ONLY (user 2026-11-12: "need to show the exact
 * screen for the receipt and return"). The registers listed the documents with no way in. A
 * posted document cannot change, so this is a view: the facts strip, then its lines. A Fabric
 * Receipt also shows the yarn it drew off by blend % ("Used in fabric"); a Yarn Return shows
 * only what came back.
 */
export function KnitReceiptView({ doc }: { doc: KnitReceiptDoc }) {
  const fabric = doc.kind === "fabric";
  const back = fabric ? "/process/knitting-receipts" : "/process/knitting-returns";
  const yarns = fabric ? doc.yarns : doc.yarns.filter((y) => y.kind === "returned");
  const place = (store: string | null, bin: string | null) => [bin, store].filter(Boolean).join(" · ") || "—";

  const fabricCols: Column<FabricLine>[] = [
    { header: "Fabric", cell: (f) => <span className="text-sm">{f.fabric}</span> },
    { header: "Dia", align: "right", cell: (f) => <span className="tabular-nums text-sm">{f.dia ?? "—"}</span> },
    { header: "Rolls", align: "right", cell: (f) => <span className="tabular-nums text-sm">{f.rolls ?? "—"}</span> },
    { header: "Net Kg", align: "right", cell: (f) => <span className="tabular-nums text-sm font-semibold">{fmtNumber(f.net_kg)}</span> },
    { header: "Gross Kg", align: "right", cell: (f) => <span className="tabular-nums text-sm">{f.gross_kg == null ? "—" : fmtNumber(f.gross_kg)}</span> },
    { header: "Bin · Store", cell: (f) => <span className="text-sm">{place(f.store, f.bin)}</span> },
    { header: "Lot", cell: (f) => <span className="text-sm">{f.lot ?? "—"}</span> },
  ];
  const yarnCols: Column<YarnLine>[] = [
    { header: "Yarn", cell: (y) => <span className="text-sm">{y.yarn}</span> },
    ...(fabric ? [{ header: "Kind", cell: (y: YarnLine) => <span className="text-sm">{KIND_LABEL[y.kind]}</span> }] : []),
    { header: "Kg", align: "right", cell: (y) => <span className="tabular-nums text-sm font-semibold">{fmtNumber(y.qty_kg)}</span> },
    { header: "Bags", align: "right", cell: (y) => <span className="tabular-nums text-sm">{y.bags ?? "—"}</span> },
    { header: "Bin · Store", cell: (y) => <span className="text-sm">{place(y.store, y.bin)}</span> },
    { header: "Lot", cell: (y) => <span className="text-sm">{y.lot ?? "—"}</span> },
    { header: "Reason", cell: (y) => <span className="text-sm">{y.reason ?? "—"}</span> },
  ];

  const fabricKg = doc.fabrics.reduce((t, f) => t + f.net_kg, 0);
  const yarnKg = yarns.reduce((t, y) => t + y.qty_kg, 0);

  return (
    <div className="space-y-4">
      <PageHeader
        title={`${fabric ? "Fabric Receipt" : "Yarn Return"} ${doc.code ?? ""}`.trim()}
        actions={<Link href={back} className="text-sm text-primary hover:underline">← {fabric ? "Fabric Receipts" : "Yarn Returns"}</Link>}
      />
      <DocFacts
        facts={[
          { label: fabric ? "Receipt No" : "Return No", value: doc.code ?? "—", mono: true },
          { label: "Date", value: fmtDate(doc.receipt_date), mono: true },
          {
            label: "KO No",
            value: (
              <Link href={`/process/knitting-hub/${doc.order_id}`} className="text-primary hover:underline">
                {doc.order_code ?? "—"}
              </Link>
            ),
            mono: true,
          },
          { label: "RE No", value: doc.re_no ?? "—" },
          { label: "Knitter", value: doc.knitter ?? "—" },
          { label: "Knitter DC", value: doc.vendor_dc_no ? `${doc.vendor_dc_no}${doc.vendor_dc_date ? ` · ${fmtDate(doc.vendor_dc_date)}` : ""}` : "—" },
          doc.vehicle_no ? { label: "Vehicle", value: doc.vehicle_no } : null,
          fabric ? { label: "Fabric Kg", value: fmtNumber(fabricKg), mono: true } : { label: "Yarn Back Kg", value: fmtNumber(yarnKg), mono: true },
          { label: "Created By", value: creatorName(doc) ?? "—" },
        ]}
      >
        {doc.notes ? <p className="mt-2 text-sm text-muted-foreground">{doc.notes}</p> : null}
      </DocFacts>

      {fabric ? (
        <section className="space-y-2">
          <h3 className="text-sm font-semibold">Fabric received</h3>
          <DataTable columns={fabricCols} rows={doc.fabrics} getKey={(f) => f.id} paginate={false} empty="No fabric lines." />
        </section>
      ) : null}
      <section className="space-y-2">
        <h3 className="text-sm font-semibold">{fabric ? "Yarn drawn for this fabric" : "Yarn returned"}</h3>
        <DataTable columns={yarnCols} rows={yarns} getKey={(y) => y.id} paginate={false} empty="No yarn lines." />
      </section>
    </div>
  );
}
