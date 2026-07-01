import Link from "next/link";
import {
  TrendingUp,
  ReceiptText,
  Landmark,
  BookOpen,
  ListTree,
} from "lucide-react";
import { requirePermission } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { Stat } from "@/components/ui/stat";
import { fmtMoney } from "@/lib/format";
import { payableOutstanding } from "@/lib/finance/calc";

async function sums() {
  try {
    const supabase = await createClient();
    const [{ data: pay }, { data: recv }] = await Promise.all([
      supabase.from("payables").select("total_amount, paid_amount").neq("status", "cancelled"),
      supabase.from("receivables").select("amount_inr").neq("status", "cancelled"),
    ]);
    const payableOut = (
      (pay ?? []) as { total_amount: number; paid_amount: number }[]
    ).reduce((s, p) => s + payableOutstanding(p), 0);
    const receivable = (
      (recv ?? []) as { amount_inr: number }[]
    ).reduce((s, r) => s + (r.amount_inr ?? 0), 0);
    return { payableOut, receivable };
  } catch {
    return { payableOut: 0, receivable: 0 };
  }
}

const areas = [
  { href: "/finance/pnl", label: "Shipment P&L", desc: "Real-time profit per shipment (revenue − cost)", icon: TrendingUp },
  { href: "/finance/payables", label: "Payables", desc: "Vendor bills, 3-way match & aging", icon: ReceiptText },
  { href: "/finance/receivables", label: "Receivables", desc: "Buyer invoices in GBP/EUR with forex", icon: Landmark },
  { href: "/finance/ledger", label: "General Ledger", desc: "Journal entries (admin-only reversal)", icon: BookOpen },
  { href: "/finance/accounts", label: "Chart of Accounts", desc: "GL account master", icon: ListTree },
];

export default async function FinancePage() {
  await requirePermission("finance", "view");
  const { payableOut, receivable } = await sums();

  return (
    <div className="space-y-4">
      <PageHeader
        title="Finance"
        description="Shipment P&L, payables, receivables and general ledger"
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <Stat label="Payables outstanding" value={fmtMoney(payableOut)} tone="warning" />
        <Stat label="Receivables (INR)" value={fmtMoney(receivable)} tone="info" />
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
                    <p className="mt-0.5 text-xs text-muted-foreground">{a.desc}</p>
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
