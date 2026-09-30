import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { orderOverrideEditCount } from "@/lib/orders/overrides/service";

/**
 * "This version includes N post-approval override edit(s). See Override Edit
 * Report." (doc/email role system.md §7.3)
 *
 * Rendered beside the order report strip (`OrderDocumentTabs`), which is on
 * every per-order report page — so every report carries the note without a
 * line in any of them. Unlike the strip it is NOT `print:hidden`: the note is
 * part of what the printed document says about itself.
 *
 * A server component, and it renders NOTHING when the order carries no
 * committed override edit — the case for every order today. The count is
 * `order_override_edit_count()` (0656): numbers only, readable by anyone who
 * can read the report; who changed what stays in the Override Edit Report.
 *
 * NOT IN THE PDF EXPORTS. Those are drawn by jsPDF (`report-pdf-kit.ts`) from
 * data, not from this page; carrying the note there means each exporter
 * reading the count. Recorded in doc/order/permission-override-findings.md.
 */
export async function OrderOverrideNote({ orderId }: { orderId: string }) {
  const { commits } = await orderOverrideEditCount(orderId);
  if (commits === 0) return null;
  return (
    <p className="flex items-center gap-2 rounded-md border border-warning bg-warning-soft px-3 py-2 text-sm text-warning">
      <ShieldAlert className="h-4 w-4 shrink-0" aria-hidden />
      <span>
        This version includes {commits} post-approval override edit{commits === 1 ? "" : "s"}.{" "}
        <Link href="/reports/override-edits" className="font-medium underline print:no-underline">
          See Override Edit Report
        </Link>
        .
      </span>
    </p>
  );
}
