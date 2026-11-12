import { requirePermission } from "@/lib/auth/server";
import { loadEnquiries } from "@/lib/analytics/sources";
import { samplesBoard, type EnquiryIn } from "@/lib/analytics/compute";
import { inRange, parsePeriod } from "@/lib/analytics/period";
import { today } from "@/lib/dashboard/range";
import { fmtCompactNumber, fmtPct } from "@/lib/dashboard/format";
import { fmtDate } from "@/lib/format";
import { DataTable } from "@/components/ui/data-table";
import { withCreatedColumns } from "@/components/ui/created-columns";
import { GlowBars, NeedsDoing, Strip, Tape, VizCard } from "@/components/viz/kit";
import { Funnel } from "@/components/analytics/pictures";
import { BoardHeader, LoadError, NoAccess, Row3, n, viewOf } from "@/components/analytics/board-ui";

/**
 * ANALYTICS ▸ SAMPLES & ENQUIRIES — "How many enquiries become orders?"
 *
 * Enquiries are Sample Entry's; the costing state is Costing's current sheet (latest, not
 * superseded). The period picks enquiries by the day they were received.
 */
export default async function SamplesBoardPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requirePermission("reports", "view");
  const sp = await searchParams;
  const period = parsePeriod(sp.p);
  const view = viewOf(sp.view);
  const res = await loadEnquiries();
  const t = today();

  const header = <BoardHeader title="Samples & Enquiries" question="How many enquiries become orders?" period={period.key} view={view} />;
  if (!res.ok) {
    return (
      <div className="space-y-3">
        {header}
        {res.reason === "access" ? <NoAccess what="Enquiries" screen="Sample Entry" /> : <LoadError message={res.message} />}
      </div>
    );
  }

  const { rows: all, costingVisible } = res.data;
  const b = samplesBoard(all, period, t);
  const rows = all.filter((e) => inRange(e.received, period));
  const share = (x: number) => (b.enquiries ? `${Math.round((x / b.enquiries) * 100)}% of enquiries` : "");
  const STATE_WORD = { draft: "Draft", submitted: "Submitted", approved: "Approved", rejected: "Rejected" } as const;

  if (view === "list") {
    return (
      <div className="space-y-3">
        {header}
        <DataTable
          rows={rows}
          getKey={(r) => r.id}
          empty={`No enquiry was received in ${period.label}.`}
          columns={withCreatedColumns<EnquiryIn>(
            [
              { header: "Enquiry", cell: (r) => <span className="font-semibold">{r.code}</span> },
              { header: "Title", cell: (r) => r.title },
              { header: "Buyer", cell: (r) => r.buyer },
              { header: "Merchandiser", cell: (r) => r.merchandiser },
              { header: "Received", cell: (r) => fmtDate(r.received) },
              { header: "Costing", cell: (r) => (r.costing ? STATE_WORD[r.costing.status] : "Not costed") },
              { header: "Order", cell: (r) => (r.becameOrder ? "Yes" : "—") },
            ],
            rows,
          )}
        />
      </div>
    );
  }

  return (
    <div className="space-y-2.5">
      {header}
      {!costingVisible ? <NoAccess what="Costing progress" screen="Costing" /> : null}
      <Strip
        cells={[
          { label: `Enquiries · ${period.label}`, value: fmtCompactNumber(b.enquiries), hint: "received", href: "/sales/sample-entry" },
          { label: "Costed", value: fmtCompactNumber(b.costed), hint: share(b.costed) || "none yet", href: "/sales/sample-costing" },
          { label: "Costing approved", value: fmtCompactNumber(b.approved), hint: share(b.approved) || "none yet", mood: b.approved ? "good" : "normal" },
          {
            label: "Days to first costing",
            value: b.avgDaysToCosting == null ? "—" : b.avgDaysToCosting.toFixed(1),
            hint: "from enquiry received",
            mood: b.avgDaysToCosting == null ? "quiet" : b.avgDaysToCosting <= 7 ? "good" : "look",
          },
          {
            label: "Waiting a decision",
            value: fmtCompactNumber(b.waiting.length),
            hint: b.waiting[0]?.waitingDays != null ? `oldest ${b.waiting[0].waitingDays} days` : "none",
            mood: b.waiting.length ? "look" : "good",
            href: "/sales/sample-costing",
          },
        ]}
      />
      <VizCard title="How many enquiries turn into orders?" question="Each step counts the enquiries that got at least that far">
        <Funnel steps={b.funnel} />
        {b.orders === 0 && b.enquiries > 0 ? (
          <p className="px-3.5 pb-3 text-[11.5px] text-muted-foreground">&ldquo;Became an order&rdquo; counts orders raised from their enquiry. None are linked yet, so it reads 0 rather than guessing.</p>
        ) : null}
      </VizCard>
      <Row3>
        <VizCard title="Where do the costings stand?" question="Current sheet per enquiry" padded>
          <Tape
            parts={[
              { label: "Not costed", value: b.states.none, colour: "var(--border-strong)" },
              { label: "Draft", value: b.states.draft, colour: "var(--viz-2)" },
              { label: "Submitted", value: b.states.submitted, colour: "var(--warning)" },
              { label: "Approved", value: b.states.approved, colour: "var(--success)" },
            ]}
            format={(v) => fmtCompactNumber(v)}
            note={b.states.rejected ? `${n(b.states.rejected, "costing")} rejected.` : undefined}
          />
        </VizCard>
        <VizCard title="Which buyer says yes?" question="Approved or ordered ÷ enquiries" padded>
          <GlowBars
            rows={b.byBuyer.slice(0, 6).map((r) => ({ key: r.key, label: r.label, value: r.value, colour: r.value >= 40 ? "var(--success)" : r.value > 0 ? "var(--warning)" : "var(--border-strong)" }))}
            format={(v) => fmtPct(v, 0)}
          />
        </VizCard>
        <VizCard title="Who costs fastest?" question="Days to first costing, per merchandiser" padded>
          <GlowBars
            rows={b.daysByMerchandiser.slice(0, 6).map((r) => ({ key: r.key, label: r.label, value: r.value, colour: r.value <= 7 ? "var(--success)" : "var(--warning)" }))}
            format={(v) => `${v.toFixed(1)} days`}
            empty="Nothing costed yet."
          />
        </VizCard>
      </Row3>
      <NeedsDoing
        cells={[
          {
            title: "Waiting a decision",
            mood: b.waiting.length ? "look" : "good",
            count: b.waiting.length ? n(b.waiting.length, "costing") : "None",
            text: b.waiting.length ? b.waiting.map((e) => `${e.code}${e.waitingDays != null ? ` ${e.waitingDays} d` : ""}`).join(" · ") : "No costing is waiting",
            href: b.waiting.length ? "/sales/sample-costing" : undefined,
            linkText: "Costing",
          },
          {
            title: "Not costed yet",
            mood: b.notCosted.length ? "look" : "good",
            count: b.notCosted.length ? n(b.notCosted.length, "enquiry", "enquiries") : "None",
            text: b.notCosted.length ? b.notCosted.map((e) => `${e.code} ${e.buyer}`).join(" · ") : "Every enquiry has a costing",
            href: b.notCosted.length ? "/sales/sample-costing" : undefined,
            linkText: "Costing",
          },
          {
            title: "Orders not linked",
            mood: "quiet",
            count: b.orders ? n(b.orders, "won") : "0 linked",
            text: "Raise the order from its enquiry so the win is counted",
            href: "/sales/sample-entry",
            linkText: "Sample Entry",
          },
        ]}
      />
    </div>
  );
}
