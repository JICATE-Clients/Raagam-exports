"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Send, Undo2 } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { StatusPill } from "@/components/ui/status-pill";
import { useToast } from "@/components/ui/toast";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { abandonSampleRevision, makeSampleRevisionCosting, submitSampleRevision } from "@/lib/sales/sample-revisions/actions";
import {
  REVISION_KIND_LABEL,
  REVISION_ORIGIN_LABEL,
  REVISION_STATUS_LABEL,
  opensCosting,
  type CostingKpis,
  type SampleRevisionRow,
} from "@/lib/sales/sample-revisions/types";
import { statusTone } from "@/lib/ui/status-tone";

/**
 * ONE SAMPLE REVISION (0716) — what it opens, where to make the change, the
 * cost comparison V0 against proposed (spec §5), and the one next step: Send
 * to MD while it is being worked, nothing while the MD has it, the outcome
 * once decided.
 *
 * THE CHANGE IS MADE IN THE SAMPLE'S OWN EDITORS, never copied here — Sample
 * Entry for Sample Info & Qty, the proposed costing revision for the costing
 * modules. Each opens with only the ticked modules editable; the database
 * refuses the rest.
 */

const money = (n: number | null | undefined) =>
  n == null ? "—" : n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

type Head = { label: string; get: (k: CostingKpis) => number | null; pct?: boolean };
const HEADS: Head[] = [
  { label: "Fabric & Yarn", get: (k) => k.fabric },
  { label: "Process", get: (k) => k.process },
  { label: "Accessories & Trims", get: (k) => k.trims },
  { label: "CMT", get: (k) => k.cmt },
  { label: "Overheads", get: (k) => k.overheads },
  { label: "Total cost", get: (k) => k.gross_cost },
  { label: "Quoted price", get: (k) => k.quoted },
  { label: "Margin %", get: (k) => k.margin_pct, pct: true },
];

function VarianceTable({ v0, proposed }: { v0: CostingKpis | null; proposed: CostingKpis | null }) {
  const cur = proposed?.currency ?? v0?.currency ?? "";
  return (
    <div className="w-fit max-w-full overflow-x-auto rounded-lg border border-border">
      <table className="text-sm tabular-nums">
        <thead>
          <tr className="border-b border-border bg-surface-muted text-xs font-bold uppercase tracking-[0.06em] text-muted-foreground">
            <th className="px-3 py-2 text-left">Cost head</th>
            <th className="px-3 py-2 text-right">{`V0 · Rev ${v0 ? v0.version - 1 : "—"}`}</th>
            <th className="px-3 py-2 text-right">{`Proposed · Rev ${proposed ? proposed.version - 1 : "—"}`}</th>
            <th className="px-3 py-2 text-right">Variance</th>
          </tr>
        </thead>
        <tbody>
          {HEADS.map((h) => {
            const a = v0 ? h.get(v0) : null;
            const b = proposed ? h.get(proposed) : null;
            const d = a != null && b != null ? Math.round((b - a) * 100) / 100 : null;
            // Cost up is bad, margin up is good.
            const bad = d != null && d !== 0 && (h.pct ? d < 0 : h.label !== "Quoted price" ? d > 0 : d < 0);
            const total = h.label === "Total cost";
            return (
              <tr key={h.label} className={total ? "border-t border-border font-semibold" : "border-b border-border last:border-0"}>
                <td className="px-3 py-1.5">{h.label}</td>
                <td className="px-3 py-1.5 text-right">{h.pct ? (a == null ? "—" : `${a.toFixed(1)} %`) : money(a)}</td>
                <td className="px-3 py-1.5 text-right">{h.pct ? (b == null ? "—" : `${b.toFixed(1)} %`) : money(b)}</td>
                <td className={`px-3 py-1.5 text-right ${d == null || d === 0 ? "text-muted-foreground" : bad ? "text-danger" : "text-success"}`}>
                  {d == null ? "—" : `${d > 0 ? "+" : ""}${h.pct ? `${d.toFixed(1)} %` : money(d)}`}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="border-t border-border px-3 py-1.5 text-xs text-muted-foreground">{`${cur} per piece · ${v0?.costing_no ?? proposed?.costing_no ?? ""}`}</p>
    </div>
  );
}

export function RevisionDetailScreen({
  rev,
  comparison,
  canEdit,
}: {
  rev: SampleRevisionRow;
  comparison: { v0: CostingKpis | null; proposed: CostingKpis | null }[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, start] = useTransition();
  const [abandoning, setAbandoning] = useState(false);
  const [why, setWhy] = useState("");
  useUnsavedGuard((abandoning && !!why.trim()) || isPending);

  const draft = rev.status === "draft";
  const needsCosting = draft && opensCosting(rev.kinds) && rev.costing_pairs.length === 0;

  const run = (fn: () => Promise<{ ok: true } | { ok: false; error: string }>, said: string, back = false) =>
    start(async () => {
      const res = await fn();
      if (!res.ok) {
        toastError(res.error);
        return;
      }
      success(said);
      if (back) router.push("/sales/sample-revision");
      else router.refresh();
    });

  return (
    <div className="space-y-5">
      <PageHeader
        title={`Sample Revision ${rev.revision_code}`}
        back={{ href: "/sales/sample-revision", label: "Revision" }}
        actions={
          draft && canEdit ? (
            <Button disabled={isPending || needsCosting} onClick={() => run(() => submitSampleRevision(rev.id), `${rev.revision_code} sent to the MD.`)}>
              <Send className="h-4 w-4" />
              Send to MD
            </Button>
          ) : undefined
        }
      />

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-mono text-lg font-semibold">{rev.revision_code}</span>
        <StatusPill tone={statusTone(rev.status)}>{REVISION_STATUS_LABEL[rev.status]}</StatusPill>
        <span className="text-sm text-muted-foreground">
          {`${rev.smp_no ?? "—"}${rev.customer_name ? ` · ${rev.customer_name}` : ""}${rev.style_names.length ? ` · ${rev.style_names.join(", ")}` : ""} · Rev ${rev.revision_no}`}
        </span>
      </div>

      <dl className="grid max-w-[48rem] grid-cols-[9rem_1fr] gap-x-4 gap-y-2 text-sm">
        <dt className="text-muted-foreground">Modules open</dt>
        <dd className="m-0 flex flex-wrap gap-1.5">
          {rev.kinds.map((k) => (
            <StatusPill key={k} tone="info">
              {REVISION_KIND_LABEL[k]}
            </StatusPill>
          ))}
        </dd>
        <dt className="text-muted-foreground">Asked by</dt>
        <dd className="m-0">{REVISION_ORIGIN_LABEL[rev.origin]}</dd>
        <dt className="text-muted-foreground">Remarks</dt>
        <dd className="m-0 whitespace-pre-line">{rev.remarks}</dd>
        {rev.submitted_at ? (
          <>
            <dt className="text-muted-foreground">Sent to MD</dt>
            <dd className="m-0">{fmtDateTime(rev.submitted_at)}</dd>
          </>
        ) : null}
        {rev.decided_at ? (
          <>
            <dt className="text-muted-foreground">Decided</dt>
            <dd className="m-0">{`${fmtDate(rev.decided_at)}${rev.decision_remark ? ` — ${rev.decision_remark}` : ""}`}</dd>
          </>
        ) : null}
      </dl>

      {rev.revert_error ? (
        <p className="max-w-[48rem] rounded-md border border-danger bg-danger-soft px-3 py-2 text-sm text-danger">
          {`The MD rejected this revision, but putting V0 back failed: ${rev.revert_error}`}
        </p>
      ) : null}

      {/* WHERE THE CHANGE IS MADE — the sample's own editors. */}
      {draft ? (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold">Make the change</h2>
          <div className="flex flex-wrap gap-2">
            {rev.kinds.includes("sample_info") ? (
              <Link href={`/sales/sample-entry?open=${rev.opportunity_id}`} className="inline-flex">
                <Button variant="outline">Open Sample Entry</Button>
              </Link>
            ) : null}
            {comparison.map(({ proposed }) =>
              proposed ? (
                <Link key={proposed.cost_sheet_id} href={`/sales/sample-costing?open=${proposed.cost_sheet_id}`} className="inline-flex">
                  <Button variant="outline">{`Open Costing ${proposed.costing_no ?? ""} · Rev ${proposed.version - 1}`}</Button>
                </Link>
              ) : null,
            )}
            {needsCosting && canEdit ? (
              <Button disabled={isPending} onClick={() => run(() => makeSampleRevisionCosting(rev.id), "Costing revision made.")}>
                Make costing revision
              </Button>
            ) : null}
          </div>
          <p className="text-xs text-muted-foreground">Only the modules above can be edited; everything else stays as approved.</p>
        </section>
      ) : null}

      {comparison.length ? (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold">Cost comparison</h2>
          {comparison.map((c, i) => (
            <VarianceTable key={c.v0?.cost_sheet_id ?? i} v0={c.v0} proposed={c.proposed} />
          ))}
        </section>
      ) : null}

      {draft && canEdit ? (
        <section className="max-w-[36rem] space-y-2">
          {abandoning ? (
            <>
              <Field label="Why is it being abandoned?" required htmlFor="rev-why">
                <Textarea id="rev-why" rows={2} required value={why} onChange={(e) => setWhy(e.target.value)} />
              </Field>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setAbandoning(false)}>
                  Keep working
                </Button>
                <Button
                  variant="outline"
                  className="border-danger text-danger"
                  disabled={isPending || !why.trim()}
                  onClick={() => run(() => abandonSampleRevision(rev.id, why), `${rev.revision_code} abandoned — the sample is back to V0.`, true)}
                >
                  <Undo2 className="h-4 w-4" />
                  Abandon and restore V0
                </Button>
              </div>
            </>
          ) : (
            <button type="button" className="text-sm text-danger hover:underline" onClick={() => setAbandoning(true)}>
              Abandon this revision…
            </button>
          )}
        </section>
      ) : null}
    </div>
  );
}
