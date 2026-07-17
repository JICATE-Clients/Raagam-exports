import Link from "next/link";
import { requirePermission } from "@/lib/auth/server";
import { PageHeader } from "@/components/ui/page-header";
import { HubCard } from "@/components/masters/hub-card";

// Sales ▸ Marketing (legacy) — "Samples & Development" sub-module hub.
const CARDS: { label: string; href: string; hint: string }[] = [
  { label: "Samples", href: "/sales/samples", hint: "Proto/fit/SMS/PP/TOP sample tracking." },
  { label: "PD Requests", href: "/sales/pd-requests", hint: "Product-development requests handed to Planning." },
];

export default async function SamplesDevelopmentHubPage() {
  await requirePermission("sales", "view");
  return (
    <div className="space-y-4">
      <nav className="text-xs text-muted-foreground">
        <Link href="/sales" className="hover:text-primary">
          Sales
        </Link>{" "}
        / <span className="text-foreground">Samples &amp; Development</span>
      </nav>
      <PageHeader
        title="Samples & Development"
        description="Sample lifecycle and product-development requests for confirmed styles."
      />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {CARDS.map((c) => (
          <HubCard key={c.href} href={c.href} title={c.label} subtitle={c.hint} external />
        ))}
      </div>
    </div>
  );
}
