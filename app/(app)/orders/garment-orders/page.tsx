import Link from "next/link";
import { requirePermission } from "@/lib/auth/server";
import { PageHeader } from "@/components/ui/page-header";
import { HubCard } from "@/components/masters/hub-card";

// Orders ▸ Garment Orders (legacy Sales ▸ Garment Orders, 14 tasks) — sub-module hub.
const CARDS: { label: string; href: string; hint: string }[] = [
  { label: "All Orders", href: "/orders", hint: "Confirmed orders; create from an accepted quote." },
  { label: "Style", href: "/orders/styles", hint: "Order style master." },
  { label: "Material BOM", href: "/orders/material-bom", hint: "Material BOM for accepted orders." },
  { label: "Material BOM Amendment", href: "/orders/material-bom-amendment", hint: "Amend an order's material BOM." },
  { label: "Colour Cards", href: "/orders/color-cards", hint: "Customer colour cards." },
  { label: "Garment Processes", href: "/orders/garment-processes", hint: "Define garment processes for accepted orders." },
  { label: "Internal Work Orders", href: "/orders/internal-work-orders", hint: "Raise internal work orders." },
  { label: "Order Amendment", href: "/orders/amendments", hint: "Raise a garment-order amendment." },
  { label: "Process Amendment", href: "/orders/process-amendments", hint: "Amend a garment process." },
  { label: "Approve Amendment", href: "/orders/approve-amendments", hint: "Approve/reject submitted amendments." },
  { label: "Advised Items", href: "/orders/advised-items", hint: "Prepare advised items." },
  { label: "Packing List Advice", href: "/orders/packing-advice", hint: "Packing-list advice for an order." },
  { label: "Cancellation", href: "/orders/cancellations", hint: "Garment-order cancellation." },
  { label: "Completion", href: "/orders/completions", hint: "Garment-order completion." },
];

export default async function GarmentOrdersHubPage() {
  await requirePermission("orders", "view");
  return (
    <div className="space-y-4">
      <nav className="text-xs text-muted-foreground">
        <Link href="/orders" className="hover:text-primary">
          Orders
        </Link>{" "}
        / <span className="text-foreground">Garment Orders</span>
      </nav>
      <PageHeader
        title="Garment Orders"
        description="Confirmed customer orders — BOMs, processes, work orders, amendments, cancellation and completion."
      />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {CARDS.map((c) => (
          <HubCard key={c.href} href={c.href} title={c.label} subtitle={c.hint} external />
        ))}
      </div>
    </div>
  );
}
