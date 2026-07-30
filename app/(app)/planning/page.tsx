import Link from "next/link";
import {
  FileText,
  Scissors,
  Shirt,
  Gem,
  AlertTriangle,
  ArrowRightLeft,
  ClipboardCheck,
  RefreshCcw,
  ShoppingCart,
  XCircle,
  CheckCircle2,
  BarChart2,
  DollarSign,
  Layers,
  Grid,
  PackagePlus,
  CalendarRange,
  Factory,
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
    href: "/planning/material-bom",
    label: "Material BOM",
    desc: "Production BOM — cloths, yarn process, fabric process sequences.",
    icon: FileText,
  },
  {
    href: "/planning/fabric-bom",
    label: "Fabric BOM",
    desc: "Fabric BOM — style-level fabric construction and costing.",
    icon: Scissors,
  },
  {
    href: "/planning/garment-bom",
    label: "Garment BOM",
    desc: "Garment BOM — component and garment process operations.",
    icon: Shirt,
  },
  {
    href: "/planning/accessory-bom",
    label: "Accessories BOM",
    desc: "Accessory BOM — purchased and in-factory trims, packing.",
    icon: Gem,
  },
  {
    href: "/planning/bom-shortage",
    label: "BOM Shortage",
    desc: "Shortage requisitions — additional material against BOM.",
    icon: AlertTriangle,
  },
  {
    href: "/planning/bom-transfer",
    label: "BOM Transfer",
    desc: "Transfer BOM quantities between sales orders.",
    icon: ArrowRightLeft,
  },
  {
    href: "/planning/garment-ppm",
    label: "Garment PPM",
    desc: "Pre-production material orders for garment manufacturing.",
    icon: Shirt,
  },
  {
    href: "/planning/processing-ppm",
    label: "Processing PPM",
    desc: "Processing/fabric PPM orders.",
    icon: RefreshCcw,
  },
  {
    href: "/planning/purchase-ppm",
    label: "Purchase PPM",
    desc: "Purchase PPM / material indent orders.",
    icon: ShoppingCart,
  },
  {
    href: "/planning/ppm-cancel",
    label: "PPM Cancel",
    desc: "Purchase/processing PPM cancellations.",
    icon: XCircle,
  },
  {
    href: "/planning/ppm-completion",
    label: "PPM Completion",
    desc: "PPM completion records.",
    icon: CheckCircle2,
  },
  {
    href: "/planning/garment-ppm-cancel",
    label: "Garment PPM Cancel",
    desc: "Garment PPM cancellations with style/size breakdown.",
    icon: ClipboardCheck,
  },
  {
    href: "/planning/material-excess-plan",
    label: "Material Excess Plan",
    desc: "Excess allowance planning for BOM items.",
    icon: BarChart2,
  },
  {
    href: "/planning/material-rate",
    label: "Material Rate",
    desc: "Rate fixing for sewing thread and tape items.",
    icon: DollarSign,
  },
  {
    href: "/planning/fabric-order",
    label: "Fabric Order",
    desc: "Fabric purchase orders with style/color/size breakdown.",
    icon: Layers,
  },
  {
    href: "/planning/fabric-consumption",
    label: "Fabric Consumption",
    desc: "Fabric consumption setup per style.",
    icon: Grid,
  },
  {
    href: "/planning/excess-order",
    label: "Excess Order",
    desc: "Requisitions for material shortage against PPMs.",
    icon: PackagePlus,
  },
  {
    href: "/planning/capacity-planning",
    label: "Capacity Planning",
    desc: "Pre-production capacity allocation by location and team.",
    icon: CalendarRange,
  },
  {
    href: "/planning/production-planning",
    label: "Production Planning",
    desc: "Production line scheduling with work order assignments.",
    icon: Factory,
  },
];

export default async function PlanningPage() {
  await requirePermission("planning", "view");

  const [materialBoms, fabricBoms, garmentBoms] = await Promise.all([
    safeCount("material_boms"),
    safeCount("fabric_boms"),
    safeCount("garment_boms"),
  ]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Planning"
        description="Bill of materials — material, fabric, garment, accessories, shortage and transfers"
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <Stat label="Material BOMs" value={materialBoms} tone="info" />
        <Stat label="Fabric BOMs" value={fabricBoms} />
        <Stat label="Garment BOMs" value={garmentBoms} tone="warning" />
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
