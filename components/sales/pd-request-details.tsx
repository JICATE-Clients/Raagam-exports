import type { ReactNode } from "react";
import { FileText, ImageIcon } from "lucide-react";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Truncated } from "@/components/ui/truncated";
import { withCreatedColumns } from "@/components/ui/created-columns";
import { fmtDate, fmtNumber } from "@/lib/format";
import { PD_TO_DEPARTMENT, type PdSample, type PdStyleLine } from "@/lib/sales/pd-requests/types";

/**
 * ONE PD REQUEST'S DOCUMENT — what the merchandiser sends and what the Sample
 * Department reads, drawn by the same component on both screens so the two
 * can never show a request differently (client spec 2026-10-14):
 *
 *  - routing: From (merchandiser) · To Department · SWO No and its SMPs (0723
 *    — one request per SWO);
 *  - the sample's details, FETCHED from Sample Entry — Style Name / No,
 *    Article No, Sample Type, Required Qty, fabric structure · GSM ·
 *    composition, Target Delivery Date — one row per style line, because a
 *    sample carries several and each has its own;
 *  - the tech pack and garment images carried forward from Sample Info.
 *
 * Remarks are the caller's: an editable box on the request form, a read-only
 * paragraph on the queue. No hooks, so a server page could draw it too.
 */

const styleColumns: Column<PdStyleLine>[] = [
  { header: "SMP No", cell: (l) => <span className="whitespace-nowrap font-mono text-xs">{l.smp_no ?? "—"}</span> },
  {
    header: "Style Name / No",
    cell: (l) => (
      <span className="block">
        <span className="font-medium">{l.name || "—"}</span>
        {l.sample_no ? <span className="block font-mono text-[11px] text-muted-foreground">{l.sample_no}</span> : null}
      </span>
    ),
  },
  { header: "Article No", cell: (l) => l.article_no || "—" },
  { header: "Sample Type", cell: (l) => l.sample_type || "—" },
  {
    header: "Required Qty",
    align: "right",
    cell: (l) => <span className="tabular-nums">{`${fmtNumber(l.sample_qty)} ${l.unit === "Set" ? "sets" : "pcs"}`}</span>,
  },
  {
    header: "Fabric · GSM",
    cell: (l) =>
      l.fabrics.length ? (
        <span className="block space-y-0.5">
          {l.fabrics.map((f, i) => (
            <span key={i} className="block">
              {f.structure}
              {f.gsm != null ? <span className="text-muted-foreground">{` · ${fmtNumber(f.gsm)} GSM`}</span> : null}
            </span>
          ))}
        </span>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
  },
  {
    header: "Composition",
    cell: (l) => l.composition ?? <span className="text-muted-foreground">Not costed yet</span>,
  },
  {
    header: "Target Delivery",
    cell: (l) => <span className="whitespace-nowrap tabular-nums">{l.delivery_date ? fmtDate(l.delivery_date) : "—"}</span>,
  },
];

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium">{children}</dd>
    </div>
  );
}

export function PdRequestDetails({
  sample,
  from,
  routing = true,
  children,
}: {
  sample: PdSample;
  /** The merchandiser the request comes from. */
  from: string | null;
  /** From · To Department · SWO No in the facts band. `false` on the request
   *  FORM, which draws those three as its own fields above. */
  routing?: boolean;
  /** Remarks / the decision — the caller's, drawn under the details. */
  children?: ReactNode;
}) {
  return (
    <div className="space-y-5">
      {/* Routing and the sample's identity — six facts at most to a row. */}
      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 rounded-md border border-border p-3 sm:grid-cols-3 lg:grid-cols-6">
        {routing ? (
          <>
            <Fact label="From">{from || "—"}</Fact>
            <Fact label="To Department">{PD_TO_DEPARTMENT}</Fact>
            <Fact label={sample.swo_no ? "SWO No" : "SMP No"}>
              <span className="font-mono">{sample.swo_no ?? sample.smp_nos[0] ?? "—"}</span>
            </Fact>
          </>
        ) : null}
        {sample.swo_no ? (
          <Fact label={sample.smp_nos.length === 1 ? "SMP No" : `SMP Nos (${sample.smp_nos.length})`}>
            <span className="font-mono">{sample.smp_nos.join(", ") || "—"}</span>
          </Fact>
        ) : null}
        <Fact label="Customer">{sample.customer ?? "—"}</Fact>
        <Fact label="Season">{sample.season ?? "—"}</Fact>
        <Fact label="Total Qty">
          <span className="tabular-nums">{`${fmtNumber(sample.total_pieces)} pcs`}</span>
        </Fact>
      </dl>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Sample details</h3>
        <DataTable
          // The style lines carry no created_at, so this adds nothing — the
          // request's own Sent line is the record's creator (created-columns rule).
          columns={withCreatedColumns(styleColumns, sample.styles)}
          rows={sample.styles}
          getKey={(l) => l.id}
          // A request's lines are part of the document, never a page of them.
          paginate={false}
          compact
          empty="No style lines."
        />
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">
          Techpack / Spec File
          {sample.tech_pack ? <span className="ml-2 text-xs font-normal text-muted-foreground">{sample.tech_pack}</span> : null}
        </h3>
        {sample.files.length ? (
          <ul className="flex flex-wrap gap-2">
            {sample.files.map((f, i) => {
              const Icon = f.kind === "Tech Pack" ? FileText : ImageIcon;
              const body = (
                <>
                  <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="min-w-0">
                    <Truncated text={f.file_name} className="block max-w-[16rem] text-sm" />
                    <span className="block text-[11px] text-muted-foreground">{`${f.kind} · ${f.style}`}</span>
                  </span>
                </>
              );
              return (
                <li key={i}>
                  {f.url ? (
                    <a
                      href={f.url}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-2 rounded-control border border-border px-3 py-1.5 hover:bg-surface-muted"
                    >
                      {body}
                    </a>
                  ) : (
                    <span className="flex items-center gap-2 rounded-control border border-border px-3 py-1.5">{body}</span>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">No tech pack or image attached on Sample Entry.</p>
        )}
      </section>

      {children}
    </div>
  );
}
