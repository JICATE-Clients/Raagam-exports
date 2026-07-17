import Link from "next/link";
import { requirePermission } from "@/lib/auth/server";
import { PageHeader } from "@/components/ui/page-header";
import { HubCard } from "@/components/masters/hub-card";

// Orders ▸ Time & Action (legacy Sales ▸ TA, 7 tasks) — sub-module hub.
const CARDS: { label: string; href: string; hint: string }[] = [
  { label: "TA Activity", href: "/orders/ta-masters", hint: "Master list of T&A activities." },
  { label: "TA Department Assign", href: "/orders/ta-department-assign", hint: "Assign activities to departments/owners." },
  { label: "TA User Rights", href: "/orders/ta-user-rights", hint: "Per-user activity permission matrix." },
  { label: "TA Style", href: "/orders/ta-style", hint: "Style-level T&A configuration." },
  { label: "TA Plan", href: "/orders/ta-plan", hint: "Build a Time & Action plan for an order." },
  { label: "TA Followups", href: "/orders/ta-followups", hint: "Track T&A milestone follow-ups." },
  { label: "TA Completion", href: "/orders/ta-completion", hint: "Record T&A completion." },
];

export default async function TaHubPage() {
  await requirePermission("orders", "view");
  return (
    <div className="space-y-4">
      <nav className="text-xs text-muted-foreground">
        <Link href="/orders" className="hover:text-primary">
          Orders
        </Link>{" "}
        / <span className="text-foreground">Time &amp; Action (TA)</span>
      </nav>
      <PageHeader
        title="Time & Action (TA)"
        description="Technical-assessment scheduling — activities, plans, follow-ups and completion for each order."
      />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {CARDS.map((c) => (
          <HubCard key={c.href} href={c.href} title={c.label} subtitle={c.hint} external />
        ))}
      </div>
    </div>
  );
}
