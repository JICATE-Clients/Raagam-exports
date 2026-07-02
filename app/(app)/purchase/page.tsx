import Link from "next/link";
import {
  FileText,
  PackageCheck,
  Truck,
  Building2,
  ClipboardList,
  ClipboardCheck,
  TrendingUp,
  Percent,
  Ban,
  FlaskConical,
} from "lucide-react";
import { requirePermission } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { Stat } from "@/components/ui/stat";

async function safeCount(
  table: string,
  filter?: (
    q: ReturnType<Awaited<ReturnType<typeof createClient>>["from"]>,
  ) => unknown,
): Promise<number> {
  void filter;
  try {
    const supabase = await createClient();
    const { count } = await supabase
      .from(table)
      .select("id", { count: "exact", head: true });
    return count ?? 0;
  } catch {
    return 0;
  }
}

const areas = [
  {
    href: "/purchase/orders",
    label: "Purchase Orders",
    desc: "PO tracker — create from budget, approve, track receipt balance.",
    icon: FileText,
  },
  {
    href: "/purchase/grn",
    label: "Goods Receipt (GRN)",
    desc: "Receive against POs — partial receipts, QC accept/reject.",
    icon: PackageCheck,
  },
  {
    href: "/purchase/dc",
    label: "Delivery Challans",
    desc: "DC tracker — material out to processors and back (traceability).",
    icon: Truck,
  },
  {
    href: "/purchase/vendors",
    label: "Vendors",
    desc: "Vendor master — yarn, knitting, dyeing, trims, packing.",
    icon: Building2,
  },
  {
    href: "/purchase/rfq",
    label: "RFQ",
    desc: "Request quotations from vendors and award.",
    icon: ClipboardList,
  },
  {
    href: "/purchase/indents",
    label: "Indents",
    desc: "Acknowledge department indents and convert to RFQ/PO.",
    icon: ClipboardCheck,
  },
  {
    href: "/purchase/over-budget",
    label: "Over-budget Confirmation",
    desc: "Approve quoted rates that exceed the budget rate.",
    icon: TrendingUp,
  },
  {
    href: "/purchase/rate-amendments",
    label: "PO Rate Amendments",
    desc: "Revise a PO line rate with approval; applies to the PO.",
    icon: Percent,
  },
  {
    href: "/purchase/po-cancellations",
    label: "Cancel Purchase Order",
    desc: "Cancel an open PO with a logged reason.",
    icon: Ban,
  },
  {
    href: "/purchase/lab",
    label: "Lab / QC",
    desc: "Test standards and in-house / outside-lab test reports.",
    icon: FlaskConical,
  },
];

export default async function PurchasePage() {
  await requirePermission("materials_purchase", "view");

  const [openPos, vendors, openDcs] = await Promise.all([
    safeCount("purchase_orders"),
    safeCount("vendors"),
    safeCount("delivery_challans"),
  ]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Materials & Purchase"
        description="Vendors, RFQ, purchase orders, goods receipt and delivery challans"
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <Stat label="Purchase orders" value={openPos} tone="info" />
        <Stat label="Vendors" value={vendors} />
        <Stat label="Delivery challans" value={openDcs} tone="warning" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {areas.map((a) => {
          const Icon = a.icon;
          return (
            <Link key={a.href} href={a.href} className="block">
              <Card className="h-full transition-colors hover:border-primary">
                <CardBody className="flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                    <Icon className="h-5 w-5" />
                  </div>
                  <div>
                    <h2 className="text-sm font-semibold text-foreground">
                      {a.label}
                    </h2>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {a.desc}
                    </p>
                  </div>
                </CardBody>
              </Card>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
