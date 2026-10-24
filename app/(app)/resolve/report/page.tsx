import Link from "next/link";
import { ClipboardList, KeyRound, MessageSquareWarning, ShoppingCart, Wrench } from "lucide-react";
import { can, requireUser } from "@/lib/auth/server";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";

/**
 * REPORT A PROBLEM — the chooser. Three doors, and it creates nothing itself
 * (spec §4): each card either opens a form or explains where the request goes.
 *
 * `requireUser`, not a permission redirect — reporting is for everyone, and a
 * person who cannot raise an indent still needs to be told how to ask for one.
 */
export default async function ReportChooserPage() {
  await requireUser();
  const canIndent = await can("materials_purchase", "create");

  return (
    <div className="space-y-4">
      <PageHeader title="Report a problem" />

      <div className="flex flex-col gap-3 md:flex-row md:items-stretch">
        <Card interactive className="relative flex-1 p-4">
          <Wrench className="h-6 w-6 text-primary" aria-hidden />
          <h2 className="mt-2 text-base font-semibold text-foreground">
            <Link
              href="/resolve/report/broken"
              className="after:absolute after:inset-0 after:content-[''] underline-offset-2 hover:underline focus-visible:underline"
            >
              Something is broken
            </Link>
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            A leak, a dead light, a jammed machine, a broken chair. Say where it is and what is wrong
            — it goes straight to whoever fixes it, with a due date.
          </p>
        </Card>

        <Card interactive className="relative flex-1 p-4">
          <MessageSquareWarning className="h-6 w-6 text-primary" aria-hidden />
          <h2 className="mt-2 text-base font-semibold text-foreground">
            <Link
              href="/resolve/report/complaint"
              className="after:absolute after:inset-0 after:content-[''] underline-offset-2 hover:underline focus-visible:underline"
            >
              Make a complaint
            </Link>
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            About conduct, pay, safety or anything that is not a broken thing. It goes to an
            independent handler, and some categories can be sent anonymously.
          </p>
        </Card>

        {canIndent ? (
          <Card interactive className="relative flex-1 p-4">
            <ShoppingCart className="h-6 w-6 text-primary" aria-hidden />
            <h2 className="mt-2 text-base font-semibold text-foreground">
              <Link
                href="/purchase/indents"
                className="after:absolute after:inset-0 after:content-[''] underline-offset-2 hover:underline focus-visible:underline"
              >
                Need to buy something
              </Link>
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Raise a purchase indent. It follows the usual purchase approvals.
            </p>
          </Card>
        ) : (
          <Card className="flex-1 p-4">
            <ShoppingCart className="h-6 w-6 text-muted-foreground" aria-hidden />
            <h2 className="mt-2 text-base font-semibold text-foreground">Need to buy something</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Purchases are raised as indents by the Purchase team or your department head. Tell
              them what you need, how many, and by when — they will raise the indent and you can
              follow it with them.
            </p>
          </Card>
        )}
      </div>

      {/* Following up — text links, not buttons: none of them is the next step here. */}
      <nav aria-label="Follow up" className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
        <Link href="/resolve/my-reports" className="inline-flex items-center gap-1.5 text-primary underline-offset-2 hover:underline">
          <ClipboardList className="h-4 w-4" aria-hidden />
          My Reports
        </Link>
        <Link href="/resolve/my-complaints" className="inline-flex items-center gap-1.5 text-primary underline-offset-2 hover:underline">
          <MessageSquareWarning className="h-4 w-4" aria-hidden />
          My Complaints
        </Link>
        <Link href="/p/track" className="inline-flex items-center gap-1.5 text-primary underline-offset-2 hover:underline">
          <KeyRound className="h-4 w-4" aria-hidden />
          Track an anonymous complaint
        </Link>
      </nav>
    </div>
  );
}
