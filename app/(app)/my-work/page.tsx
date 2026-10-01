import Link from "next/link";
import type { ReactNode } from "react";
import { Bell, ClipboardCheck, ClipboardList, GitPullRequestArrow, PencilRuler, ShoppingBag, type LucideIcon } from "lucide-react";
import { requireUser } from "@/lib/auth/server";
import { getMyWork, type Section } from "@/lib/my-work/service";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusPill } from "@/components/ui/status-pill";
import { Truncated } from "@/components/ui/truncated";

/**
 * MY WORK (user 2026-10-01) — one page, a card per kind of work, and a card
 * only where this person has that kind of work. Every card links to the
 * module's own screen, already narrowed to "mine" where the screen can say so,
 * so this page is a door, never a second editor.
 *
 * `requireUser`, not `requirePermission`: every login has an approvals queue
 * and alerts. The cards that need Orders access check it in `getMyWork`.
 */
export default async function MyWorkPage() {
  const user = await requireUser();
  const w = await getMyWork(user);

  const hasAny = (s: Section<unknown>) => !!s && (s.total > 0 || !!s.error);
  const cards = [
    hasAny(w.approvals) && (
      <WorkCard key="approvals" icon={ClipboardCheck} title="My Approvals" section={w.approvals} href="/approvals" hrefLabel="Open queue">
        <p className="text-sm">
          <span className="text-2xl font-semibold tabular-nums">{w.approvals!.total}</span>{" "}
          waiting on you
          {w.approvals!.overdue > 0 && (
            <StatusPill tone="danger" className="ml-2">
              {w.approvals!.overdue} overdue
            </StatusPill>
          )}
        </p>
      </WorkCard>
    ),
    hasAny(w.ta) && (
      <WorkCard key="ta" icon={ClipboardList} title="My T&A Tasks" section={w.ta} href="/orders/ta-worklist?scope=mine" hrefLabel="Open worklist">
        {(w.ta!.overdue > 0 || w.ta!.dueToday > 0) && (
          <div className="mb-2 flex gap-2">
            {w.ta!.overdue > 0 && <StatusPill tone="danger">{w.ta!.overdue} overdue</StatusPill>}
            {w.ta!.dueToday > 0 && <StatusPill tone="warning">{w.ta!.dueToday} due today</StatusPill>}
          </div>
        )}
        <Rows>
          {w.ta!.items.map((t) => (
            <Row key={t.id} href="/orders/ta-worklist?scope=mine" main={t.activity} sub={[t.reNo, t.buyer].filter(Boolean).join(" · ")} side={<Due date={t.targetDate} daysLate={t.daysLate} />} />
          ))}
        </Rows>
      </WorkCard>
    ),
    hasAny(w.orders) && (
      <WorkCard key="orders" icon={ShoppingBag} title="My Orders" section={w.orders} href="/orders/all" hrefLabel="All orders">
        <Rows>
          {w.orders!.items.map((o) => (
            <Row
              key={o.salesOrderId}
              href={`/orders/${o.salesOrderId}`}
              main={o.reNo ?? "(no RE No)"}
              sub={o.buyer}
              side={
                <span className="text-xs text-muted-foreground">
                  {o.status === "amending" ? <StatusPill tone="info">In revision</StatusPill> : o.deliveryDate ? `Ship ${fmtDate(o.deliveryDate)}` : null}
                </span>
              }
            />
          ))}
        </Rows>
      </WorkCard>
    ),
    hasAny(w.cad) && (
      <WorkCard key="cad" icon={PencilRuler} title="My CAD Work" section={w.cad} href="/orders/cad-lifecycle" hrefLabel="Open CAD">
        <Rows>
          {w.cad!.items.map((c) => (
            <Row
              key={c.id}
              href="/orders/cad-lifecycle"
              main={`${c.styleRefNo} · V${c.version}`}
              sub={[c.reNo, c.patternStatus].filter(Boolean).join(" · ")}
              side={<span className="text-xs text-muted-foreground">{c.targetDate ? `Due ${fmtDate(c.targetDate)}` : null}</span>}
            />
          ))}
        </Rows>
      </WorkCard>
    ),
    hasAny(w.revisions) && (
      <WorkCard key="revisions" icon={GitPullRequestArrow} title="My Revisions" section={w.revisions} href="/orders/order-amendments" hrefLabel="All revisions">
        <Rows>
          {w.revisions!.items.map((r) => (
            <Row
              key={r.id}
              href={`/orders/order-amendments/${r.id}`}
              main={r.entryNo ?? "Revision"}
              sub={[r.reNo, r.reason].filter(Boolean).join(" · ")}
              side={<span className="text-xs text-muted-foreground">{fmtDate(r.raisedAt)}</span>}
            />
          ))}
        </Rows>
      </WorkCard>
    ),
    hasAny(w.alerts) && (
      <WorkCard key="alerts" icon={Bell} title="My Alerts" section={w.alerts} countLabel="unread">
        <Rows>
          {w.alerts!.items.map((a) => (
            <Row key={a.id} href={a.href} main={a.title} sub={a.body} side={<span className="text-xs text-muted-foreground">{fmtDateTime(a.createdAt)}</span>} />
          ))}
        </Rows>
      </WorkCard>
    ),
  ].filter(Boolean);

  const who = w.me ? `${w.me.name}${w.me.department_name ? ` · ${w.me.department_name}` : ""}` : user.fullName || user.email;

  return (
    <div className="space-y-4">
      <PageHeader title="My Work" description={`What is on you today, ${fmtDate(w.today)} — ${who}`} back={false} />

      {!w.me && (
        <p className="rounded-lg border border-warning/40 bg-warning-soft px-3 py-2 text-sm text-warning">
          This login is not linked to a staff record, so orders, T&amp;A tasks and CAD work assigned to you by name cannot be shown.
          Ask an administrator to set your Employee Code or e-mail on your staff record.
        </p>
      )}

      {cards.length === 0 ? (
        <Card>
          <CardBody className="py-10 text-center text-sm text-muted-foreground">Nothing is waiting on you right now.</CardBody>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{cards}</div>
      )}
    </div>
  );
}

function WorkCard({
  icon: Icon,
  title,
  section,
  href,
  hrefLabel,
  countLabel,
  children,
}: {
  icon: LucideIcon;
  title: string;
  section: Section<unknown>;
  href?: string;
  hrefLabel?: string;
  countLabel?: string;
  children: ReactNode;
}) {
  const s = section!;
  return (
    <Card className="flex flex-col">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Icon className="size-4 text-muted-foreground" aria-hidden />
          {title}
          <StatusPill tone="neutral">
            {s.total}
            {countLabel ? ` ${countLabel}` : ""}
          </StatusPill>
        </CardTitle>
        {href && (
          <Link href={href} className="text-xs font-semibold text-primary hover:underline">
            {hrefLabel ?? "Open"} →
          </Link>
        )}
      </CardHeader>
      <CardBody className="flex-1">
        {s.error ? <p className="text-sm text-danger">Could not load: {s.error}</p> : children}
        {!s.error && s.total > s.items.length && s.items.length > 0 && (
          <p className="mt-2 text-xs text-muted-foreground">
            Showing {s.items.length} of {s.total}
          </p>
        )}
      </CardBody>
    </Card>
  );
}

function Rows({ children }: { children: ReactNode }) {
  return <ul className="divide-y divide-border">{children}</ul>;
}

function Row({ href, main, sub, side }: { href: string | null; main: string; sub?: string | null; side?: ReactNode }) {
  const body = (
    <div className="flex items-center justify-between gap-3 py-2">
      <div className="min-w-0">
        <p className="text-sm font-medium"><Truncated text={main} /></p>
        {sub && <p className="text-xs text-muted-foreground"><Truncated text={sub} /></p>}
      </div>
      <div className="shrink-0">{side}</div>
    </div>
  );
  return <li>{href ? <Link href={href} className="block rounded hover:bg-surface-muted">{body}</Link> : body}</li>;
}

function Due({ date, daysLate }: { date: string; daysLate: number }) {
  if (daysLate > 0) return <StatusPill tone="danger">{daysLate}d late</StatusPill>;
  if (daysLate === 0) return <StatusPill tone="warning">Today</StatusPill>;
  return <span className="text-xs text-muted-foreground">{fmtDate(date)}</span>;
}
