import { requirePermission } from "@/lib/auth/server";
import { HubPage, type HubCardSpec } from "@/components/shell/group-hub";

// Sales ▸ Marketing (legacy) — "Opportunities & Costing" sub-module hub.
// Master structure: module → sub-module (sidebar) → child (these cards).
//
// Sales is deliberately absent from `lib/nav/module-groups.ts` — `nav.ts` keeps
// its literal five-row list, because Sales already listed sub-modules and needed
// no regrouping — so these cards are declared here and rendered by the shared
// `HubPage`. Nothing machine-checks this list; `npm run check:nav` only sees the
// nine grouped modules.
//
// The ↗ is GONE from every card, and that is a fix rather than a loss: it means
// "this card leaves the module", and all five of these are Sales routes. The
// same mistake is recorded against `/orders/ta`, which passed `external` on all
// six of its own siblings.
const CARDS: HubCardSpec[] = [
  { key: "/sales", href: "/sales", label: "Opportunities / Pipeline", description: "Enquiry → costing → quoted → won/lost pipeline." },
  { key: "/sales/styles", href: "/sales/styles", label: "Styles", description: "Define styles for an opportunity." },
  { key: "/sales/cost-sheets", href: "/sales/cost-sheets", label: "Cost Sheets", description: "Versioned product cost sheets; draft → approve." },
  { key: "/sales/quotes", href: "/sales/quotes", label: "Quote Preparation", description: "Prepare buyer quotes from approved costings." },
  { key: "/sales/quote-confirmations", href: "/sales/quote-confirmations", label: "Confirm Quotes", description: "Accept/reject quotes (a win creates an order)." },
];

export default async function OpportunitiesCostingHubPage() {
  await requirePermission("sales", "view");
  return (
    <HubPage
      breadcrumb={{ href: "/sales", label: "Sample" }}
      title="Opportunities & Costing"
      description="Customer engagement from opportunity through style definition, costing and quoting."
      cards={CARDS}
    />
  );
}
