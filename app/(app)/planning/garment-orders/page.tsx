import Link from "next/link";
import { requirePermission } from "@/lib/auth/server";
import { PageHeader } from "@/components/ui/page-header";
import { HubCard } from "@/components/masters/hub-card";

// The 28 legacy "Planning ▸ Materials-Garment Orders" tasks, each linking to its
// built app screen. Five (marked "New") are the screens added to fill the gaps.
// This is the sub-module hub — the "child" level of the master structure
// (module → sub-module → child), rendered exactly like /masters/materials.
const CARDS: { label: string; href: string; hint: string }[] = [
  { label: "Create Shipment Plan", href: "/planning/shipment-plans", hint: "Group orders into a planned shipping window." },
  { label: "SQ Note", href: "/planning/sq-notes", hint: "Sample-quote note with allocation lines." },
  { label: "Prepare Fabric BOM", href: "/planning/boms", hint: "Fabric BOM per garment order." },
  { label: "Prepare Material BOM", href: "/planning/boms", hint: "Material BOM for a shipment plan." },
  { label: "BOM for Internal Orders", href: "/planning/iwo-boms", hint: "Material BOM for internal work orders." },
  { label: "Prepare Material BOM for IWO", href: "/planning/iwo-boms", hint: "BOM against an internal work order." },
  { label: "Prepare Budgets", href: "/planning/budgets", hint: "Pull BOM lines into an order budget." },
  { label: "Approve Budgets", href: "/planning/budgets", hint: "Approve submitted budgets." },
  { label: "Purchase Process Allocation", href: "/planning/process-allocations", hint: "Allocate a process to a vendor." },
  { label: "Material Excess Order & Receipt", href: "/planning/material-excess", hint: "Order & receive excess material." },
  { label: "Issue PPM", href: "/planning/ppm", hint: "Issue production-planning materials." },
  { label: "Rate Amendment for Garmenting PPMs", href: "/planning/ppm", hint: "Amend PPM line rates (editable while draft)." },
  { label: "SQ Allocation Amendment", href: "/planning/sq-notes", hint: "Edit SQ allocation lines while draft." },
  { label: "Fabric BOM Amendment", href: "/planning/bom-amendments", hint: "Record & approve a fabric BOM change." },
  { label: "Material BOM Amendment", href: "/planning/bom-amendments", hint: "Record & approve a material BOM change." },
  { label: "Budget Amendment", href: "/planning/budget-amendments", hint: "Revise an approved budget total." },
  { label: "Budget Amendments to Approve", href: "/planning/budget-amendments", hint: "Approve submitted budget amendments." },
  { label: "Shortage", href: "/planning/shortages", hint: "Flag a material/garment gap." },
  { label: "Shortages to Approve", href: "/planning/shortages", hint: "Approve submitted shortages." },
  { label: "Garmenting PPM Cancellation", href: "/planning/ppm-cancellations", hint: "Cancel an issued PPM with approval. (New)" },
  { label: "Rate Detail for Amended Items", href: "/planning/rate-amended-items", hint: "Register of items with an amended rate. (New)" },
  { label: "SQ Cancellation", href: "/planning/sq-notes", hint: "Cancel an SQ note." },
  { label: "Garment Shortage", href: "/planning/shortages", hint: "Garment-kind shortage." },
  { label: "Garment Shortages to Approve", href: "/planning/shortages", hint: "Approve garment shortages." },
  { label: "Stock Completion", href: "/planning/stock-completion", hint: "Close out planned stock for an order." },
  { label: "Garmenting PPM Receipt Completion", href: "/planning/ppm-receipts", hint: "Close an issued PPM's receipts. (New)" },
  { label: "SQ Closure", href: "/planning/sq-closure", hint: "Close an allocated SQ note. (New)" },
  { label: "Approve Costing", href: "/planning/approve-costing", hint: "Sign off a finalised garment costing. (New)" },
];

export default async function GarmentOrdersHubPage() {
  await requirePermission("planning", "view");

  return (
    <div className="space-y-4">
      <nav className="text-xs text-muted-foreground">
        <Link href="/planning" className="hover:text-primary">
          Planning
        </Link>{" "}
        / <span className="text-foreground">Materials – Garment Orders</span>
      </nav>
      <PageHeader
        title="Materials – Garment Orders"
        description="Every screen for planning a garment order's materials, budgets and issues — the legacy Planning ▸ Materials-Garment Orders task list."
      />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {CARDS.map((c, i) => (
          <HubCard
            key={`${c.href}-${i}`}
            href={c.href}
            title={c.label}
            subtitle={c.hint}
            external
          />
        ))}
      </div>
    </div>
  );
}
