import { canViewHref, requirePermission } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import { today } from "@/lib/dashboard/range";
import { fmtCompactInr } from "@/lib/dashboard/format";
import { financeOverview, owedOf, type BillRow } from "@/lib/overview/finance";
import { asOfNow, relDays, whenOf } from "@/lib/overview/words";
import { GlowBars, MOOD_COLOUR, NeedsDoing, Strip, VizCard } from "@/components/viz/kit";
import { LoadError, NoAccess } from "@/components/analytics/board-ui";
import { MoreLinks, OverviewHeader, Row3, Say, WhenList } from "@/components/overview/frame";

/**
 * FINANCE ▸ OVERVIEW — "What do we owe, and what is coming in?" (wave 3, 2026-11-06). Replaces
 * a page of stat cards. Payables and receivables are read through the person's own session,
 * each only when its screen is theirs to open; embeds name their FK columns (a bill points at
 * both `vendors` and `master_vendors`). The rules are `lib/overview/finance.ts`, pure.
 */
export default async function FinanceOverviewPage() {
  await requirePermission("finance", "view");
  const t = today();
  const asOf = asOfNow();
  const header = <OverviewHeader title="Finance" question="What do we owe, and what is coming in?" who={null} mine={0} everyone={0} asOf={asOf} />;
  const [canPay, canRec] = await Promise.all([canViewHref("/finance/payables"), canViewHref("/finance/receivables")]);
  if (!canPay && !canRec) {
    return (
      <div className="space-y-3">
        {header}
        <NoAccess what="The finance overview" screen="Payables" />
      </div>
    );
  }

  const s = await createClient();
  const none = Promise.resolve({ data: [] as unknown[], error: null, count: null as number | null });
  const [payRes, recRes, shipRes] = await Promise.all([
    canPay
      ? s
          .from("payables")
          .select("id, code, status, match_status, due_date, total_amount, paid_amount, mv:master_vendors!master_vendor_id(name), v:vendors!vendor_id(name), po:purchase_orders!purchase_order_id(code)")
          .neq("status", "cancelled")
      : none,
    canRec ? s.from("receivables").select("id", { count: "exact", head: true }).neq("status", "cancelled") : none,
    canRec ? s.from("shipments").select("id", { count: "exact", head: true }) : none,
  ]);
  const failed = [payRes, recRes, shipRes].find((r) => r.error);
  if (failed?.error) {
    return (
      <div className="space-y-3">
        {header}
        <LoadError message={failed.error.message} />
      </div>
    );
  }

  type Raw = {
    id: string;
    code: string | null;
    status: string;
    match_status: string | null;
    due_date: string | null;
    total_amount: unknown;
    paid_amount: unknown;
    mv: { name: string | null } | null;
    v: { name: string | null } | null;
    po: { code: string | null } | null;
  };
  const bills: BillRow[] = ((payRes.data ?? []) as unknown as Raw[]).map((b) => ({
    id: b.id,
    code: b.code ?? "Bill",
    vendor: b.mv?.name?.trim() || b.v?.name?.trim() || "No vendor",
    po: b.po?.code ?? null,
    status: b.status,
    match: b.match_status,
    due: b.due_date,
    total: Number(b.total_amount) || 0,
    paid: Number(b.paid_amount) || 0,
  }));
  const o = financeOverview(bills, canRec ? (recRes.count ?? 0) : null, canRec ? (shipRes.count ?? 0) : null, t);

  /* The picture: who we owe, red where a bill of theirs does not match its PO / GRN. */
  const byVendor = new Map<string, { owed: number; bad: boolean }>();
  for (const b of o.live) {
    const cur = byVendor.get(b.vendor) ?? { owed: 0, bad: false };
    cur.owed += owedOf(b);
    if (b.match === "exception") cur.bad = true;
    byVendor.set(b.vendor, cur);
  }
  const bars = [...byVendor.entries()]
    .sort((a, b) => b[1].owed - a[1].owed)
    .slice(0, 10)
    .map(([k, v]) => ({ key: k, label: k, value: v.owed, colour: MOOD_COLOUR[v.bad ? "problem" : "normal"] }));

  return (
    <div className="space-y-2.5">
      {header}
      <Say lines={o.say} />
      <Strip compact cells={o.strip} />
      <VizCard title="Who do we owe?" question="Unpaid on each vendor's bills · red where a bill does not match its PO and GRN" padded>
        <GlowBars rows={bars} format={fmtCompactInr} empty="We owe no vendor anything." />
      </VizCard>
      <Row3>
        <WhenList
          title="Which bills don't match?"
          question="Bill, PO and GRN disagree — check before paying"
          empty="Every bill matches its PO and GRN."
          grouped={false}
          more="/finance/payables"
          items={o.unmatched.map((b) => ({ key: b.id, when: "late", name: b.vendor, code: [b.code, b.po].filter(Boolean).join(" · "), href: "/finance/payables", note: fmtCompactInr(owedOf(b)) }))}
        />
        <WhenList
          title="What is due, and when?"
          question="Unpaid bills by their due date"
          empty="No bill is unpaid."
          more="/finance/payables"
          items={o.live.map((b) => ({
            key: b.id,
            when: whenOf(b.due, t),
            name: b.vendor,
            code: b.code,
            href: "/finance/payables",
            note: b.due ? `${relDays(b.due, t)} · ${fmtCompactInr(owedOf(b))}` : `no due date · ${fmtCompactInr(owedOf(b))}`,
          }))}
        />
        <VizCard title="What is coming in?" question="Money due from buyers" padded>
          {canRec && (recRes.count ?? 0) > 0 ? (
            <p className="text-sm">
              {(recRes.count ?? 0).toLocaleString("en-IN")} receivable{recRes.count === 1 ? "" : "s"} open — see Receivables for each buyer and its due date.
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              Receivables are raised from shipments. When the first shipment is made, what each buyer owes and when it is due will show here.
            </p>
          )}
        </VizCard>
      </Row3>
      <NeedsDoing compact cells={o.needs} />
      <MoreLinks
        links={[
          { href: "/finance/payables", label: "Payables" },
          { href: "/finance/receivables", label: "Receivables" },
        ]}
      />
    </div>
  );
}
