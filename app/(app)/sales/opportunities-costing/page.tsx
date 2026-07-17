import Link from "next/link";
import { requirePermission } from "@/lib/auth/server";
import { PageHeader } from "@/components/ui/page-header";
import { HubCard } from "@/components/masters/hub-card";

// Sales ▸ Marketing (legacy) — "Opportunities & Costing" sub-module hub.
// Master structure: module → sub-module (sidebar) → child (these cards).
const CARDS: { label: string; href: string; hint: string }[] = [
  { label: "Opportunities / Pipeline", href: "/sales", hint: "Enquiry → costing → quoted → won/lost pipeline." },
  { label: "Styles", href: "/sales/styles", hint: "Define styles for an opportunity." },
  { label: "Cost Sheets", href: "/sales/cost-sheets", hint: "Versioned product cost sheets; draft → approve." },
  { label: "Quote Preparation", href: "/sales/quotes", hint: "Prepare buyer quotes from approved costings." },
  { label: "Confirm Quotes", href: "/sales/quote-confirmations", hint: "Accept/reject quotes (a win creates an order)." },
];

export default async function OpportunitiesCostingHubPage() {
  await requirePermission("sales", "view");
  return (
    <div className="space-y-4">
      <nav className="text-xs text-muted-foreground">
        <Link href="/sales" className="hover:text-primary">
          Sales
        </Link>{" "}
        / <span className="text-foreground">Opportunities &amp; Costing</span>
      </nav>
      <PageHeader
        title="Opportunities & Costing"
        description="Customer engagement from opportunity through style definition, costing and quoting."
      />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {CARDS.map((c) => (
          <HubCard key={c.href} href={c.href} title={c.label} subtitle={c.hint} external />
        ))}
      </div>
    </div>
  );
}
