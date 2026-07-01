import Link from "next/link";
import {
  Users,
  Building2,
  UserCog,
  CalendarCheck,
  Scissors,
  Wallet,
  ReceiptText,
  Settings,
} from "lucide-react";
import { requirePermission } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { Stat } from "@/components/ui/stat";

async function safeCount(table: string): Promise<number> {
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
  { href: "/hr/workers", label: "Workers", desc: "Shift & piece-rate workers (3 types)", icon: Users },
  { href: "/hr/contractors", label: "Contractors", desc: "Piece-rate contractors", icon: Building2 },
  { href: "/hr/staff", label: "Staff", desc: "Monthly-salary staff", icon: UserCog },
  { href: "/hr/attendance", label: "Attendance", desc: "Daily hours, OT & extra (biometric/manual)", icon: CalendarCheck },
  { href: "/hr/piece-records", label: "Piece Records", desc: "Worker piece counts (editable until locked)", icon: Scissors },
  { href: "/hr/payroll", label: "Payroll Runs", desc: "Weekly workers + monthly staff; dual-account", icon: Wallet },
  { href: "/hr/payslip", label: "Payslips", desc: "Weekly worker payslip (A/C 1 + A/C 2)", icon: ReceiptText },
  { href: "/hr/settings", label: "Payroll Settings", desc: "OT caps, ESI/PF rates", icon: Settings },
];

export default async function HrPage() {
  await requirePermission("hr_payroll", "view");

  const [workers, staff, contractors] = await Promise.all([
    safeCount("workers"),
    safeCount("staff"),
    safeCount("contractors"),
  ]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="HR & Payroll"
        description="Workers, attendance, piece counts, payroll runs and payslips"
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <Stat label="Workers" value={workers} tone="info" />
        <Stat label="Staff" value={staff} />
        <Stat label="Contractors" value={contractors} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
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
