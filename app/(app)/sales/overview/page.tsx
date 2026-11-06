import { requirePermission } from "@/lib/auth/server";
import { MODULE_GROUPS } from "@/lib/nav/module-groups";
import { loadEnquiries } from "@/lib/analytics/sources";
import { today } from "@/lib/dashboard/range";
import { myIdentity } from "@/lib/overview/me";
import { sampleOverview, waitingDays, type SampleRow } from "@/lib/overview/sample";
import { asOfNow } from "@/lib/overview/words";
import { GlowBars, NeedsDoing, Strip, VizCard, MOOD_COLOUR } from "@/components/viz/kit";
import { Funnel } from "@/components/analytics/pictures";
import { LoadError, NoAccess } from "@/components/analytics/board-ui";
import { MoreLinks, OverviewHeader, Row3, Say, WhenList, whoOf } from "@/components/overview/frame";

/**
 * SAMPLE ▸ OVERVIEW — "Which samples are waiting, and on whom?" (wave 2, 2026-11-06; plan
 * https://claude.ai/artifact/5e8SGWe8DPHC7Ua2fQyaiW). Sample's root still sends the "+" quick
 * action (`/sales?new=1…`) straight to Sample Entry; only a bare `/sales` lands here.
 *
 * The enquiry, its current costing and whether an order names it come from the Analytics
 * loader (`loadEnquiries`), read through the person's own session — costing only when Sample
 * Costing is theirs to open. "Mine" is the enquiries whose merchandiser is the operator.
 */
export default async function SampleOverviewPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requirePermission(MODULE_GROUPS["/sales"].module, "view");
  const sp = await searchParams;
  const t = today();
  const asOf = asOfNow();
  const [res, me] = await Promise.all([loadEnquiries(), myIdentity()]);
  const header = (who: "mine" | "everyone" | null, mine: number, everyone: number) => (
    <OverviewHeader title="Sample" question="Which samples are waiting, and on whom?" who={who} mine={mine} everyone={everyone} asOf={asOf} />
  );
  if (!res.ok) {
    return (
      <div className="space-y-3">
        {header(null, 0, 0)}
        {res.reason === "access" ? <NoAccess what="The sample overview" screen="Sample Entry" /> : <LoadError message={res.message} />}
      </div>
    );
  }

  const all = res.data.rows as SampleRow[];
  const mineRows = me.staffId ? all.filter((e) => e.merchandiserId === me.staffId) : [];
  const who = whoOf(sp.who, mineRows.length);
  const rows = who === "mine" ? mineRows : all;
  const o = sampleOverview(rows, t);

  /* Which buyers say yes: of each buyer's costings that got an answer, how many were approved. */
  const answered = new Map<string, { yes: number; n: number }>();
  for (const e of rows) {
    const st = e.costing?.status;
    if (st !== "approved" && st !== "rejected") continue;
    const cur = answered.get(e.buyer) ?? { yes: 0, n: 0 };
    cur.n++;
    if (st === "approved") cur.yes++;
    answered.set(e.buyer, cur);
  }
  const buyerBars = [...answered.entries()]
    .sort((a, b) => b[1].n - a[1].n)
    .slice(0, 7)
    .map(([k, v]) => ({
      key: k,
      label: k,
      value: (v.yes / v.n) * 100,
      colour: MOOD_COLOUR[v.yes / v.n >= 0.5 ? "good" : "look"],
      display: `${v.yes} of ${v.n} yes`,
    }));

  return (
    <div className="space-y-2.5">
      {header(mineRows.length ? who : null, mineRows.length, all.length)}
      {!res.data.costingVisible ? (
        <p className="text-xs text-muted-foreground">Costing figures show to people who can open Sample Costing; the funnel stops at Enquiry for you.</p>
      ) : null}
      <Say lines={o.say} />
      <Strip compact cells={o.strip} />
      <VizCard title="How far did each enquiry get?" question="Each step counts enquiries that got at least that far · an order typed without naming its enquiry cannot be counted">
        <Funnel steps={o.funnel} />
      </VizCard>
      <Row3>
        <WhenList
          title="Which enquiries are not costed yet?"
          question="Oldest first · the buyer, the sample no. under it"
          empty="Every enquiry has a costing."
          grouped={false}
          more="/sales/sample-entry"
          items={o.notCosted.map((e) => ({
            key: e.id,
            when: o.age(e) > 7 ? "late" : "today",
            name: e.buyer,
            // The title is often just the buyer's name again — shown only when it says more.
            code: [e.code, e.title !== "—" && e.title.toUpperCase() !== e.buyer.toUpperCase() ? e.title : ""].filter(Boolean).join(" · "),
            href: "/sales/sample-costing",
            note: `${o.age(e)} d old`,
          }))}
        />
        <WhenList
          title="Which costings wait on the buyer?"
          question="Sent to the buyer, no answer yet · longest first"
          empty="No costing is waiting on a buyer."
          grouped={false}
          more="/sales/sample-costing"
          items={o.withBuyer.map((e) => ({
            key: e.id,
            when: "today",
            name: e.buyer,
            code: e.code,
            href: "/sales/sample-costing",
            // No sent date on the cost sheet = no honest "how long" (rule 7): said, not dashed.
            note: waitingDays(e, t) != null ? `${waitingDays(e, t)} d waiting` : "sent · date not recorded",
          }))}
        />
        <VizCard title="Which buyers say yes?" question="Approved out of the costings each buyer answered" padded>
          <GlowBars rows={buyerBars} format={(v) => `${Math.round(v)}%`} empty="No buyer has answered a costing yet." />
        </VizCard>
      </Row3>
      <NeedsDoing compact cells={o.needs} />
      <MoreLinks
        links={[
          { href: "/sales/sample-entry", label: "Sample Entry" },
          { href: "/analytics/samples", label: "Samples & Enquiries board" },
        ]}
      />
    </div>
  );
}
