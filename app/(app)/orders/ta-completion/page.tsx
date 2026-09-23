import Link from "next/link";
import { requirePermission } from "@/lib/auth/server";
import {
  getTaCompletions,
  getTaCompletableOrders,
  getBuyerOptions,
} from "@/lib/orders/ta-completion/service";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { NewTaCompletionForm } from "./new-ta-completion-form";
import { TaCompletionsList } from "./ta-completions-list";

export default async function TaCompletionPage() {
  await requirePermission("orders", "view");

  const [completions, orders, buyers] = await Promise.all([
    getTaCompletions(),
    getTaCompletableOrders(),
    getBuyerOptions(),
  ]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="TA Completion"
        description="Record the completion of an order's Time & Action schedule."
        actions={
          <Link href="/orders">
            <Button variant="outline" size="md">
              ← Orders
            </Button>
          </Link>
        }
      />

      <NewTaCompletionForm orders={orders} buyers={buyers} />

      {/* The list (and its filter drawer) is a client component — the columns
          hold cell FUNCTIONS, which cannot cross the server→client boundary. */}
      <TaCompletionsList rows={completions} />
    </div>
  );
}
