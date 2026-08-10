import { requirePermission } from "@/lib/auth/server";
import { HubPage, type HubCardSpec } from "@/components/shell/group-hub";

// Sales ▸ Marketing (legacy) — "Samples & Development" sub-module hub. See the
// note on `/sales/opportunities-costing`: Sales keeps a literal list because it
// is absent from `lib/nav/module-groups.ts`, and the ↗ is dropped because
// `/sales/samples` does not leave the module.
const CARDS: HubCardSpec[] = [
  { key: "/sales/samples", href: "/sales/samples", label: "Samples", description: "Proto/fit/SMS/PP/TOP sample tracking." },
];

export default async function SamplesDevelopmentHubPage() {
  await requirePermission("sales", "view");
  return (
    <HubPage
      breadcrumb={{ href: "/sales", label: "Sales" }}
      title="Samples & Development"
      description="Sample lifecycle and product-development requests for confirmed styles."
      cards={CARDS}
    />
  );
}
