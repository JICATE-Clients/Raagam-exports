import { requirePermission } from "@/lib/auth/server";
import { PageHeader } from "@/components/ui/page-header";
import { listApprovedFines } from "@/lib/hr/fines-service";
import { fmtMoney } from "@/lib/format";
import { RegisterMonthFilter, RegisterToolbar } from "./register-toolbar";

export const metadata = { title: "Fine Summary Report" };

/**
 * FINE SUMMARY REPORT (doc/order/punishment fine.md §7) — the "Entry Register"
 * management reads to verify a month's financial conduct.
 *
 * Deliberately STATIC: a plain table, no sorting, no charts ("interactive charts
 * and visualizations are strictly forbidden in this module"). APPROVED fines
 * only — a rejected or abandoned fine is an audit record, not a deduction.
 * The month is a plain GET form so the page stays a server component.
 */

/** Markdown cells cannot hold a pipe or a newline. */
function mdCell(v: string): string {
  return v.replace(/\|/g, "\|").replace(/\r?\n/g, " ");
}

export default async function FineRegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  await requirePermission("hr_payroll", "view");
  const { month: raw } = await searchParams;
  const month = raw && /^\d{4}-\d{2}$/.test(raw) ? raw : null;
  const rows = await listApprovedFines(month);
  const total = rows.reduce((s, r) => s + r.fine_amount, 0);

  const period = month
    ? new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1, 1).toLocaleDateString("en-IN", {
        month: "long",
        year: "numeric",
      })
    : "All months";

  const markdown = [
    `# Fine Summary Report — ${period}`,
    "",
    "| Staff Name | Fine Reason (Remarks) | Amount | Approver Name |",
    "|---|---|---:|---|",
    ...rows.map(
      (r) =>
        `| ${mdCell(r.staff_name ?? "—")} | ${mdCell(r.remarks)} | ${r.fine_amount.toFixed(2)} | ${mdCell(r.approver_name ?? "—")} |`,
    ),
    `| **Total** | | **${total.toFixed(2)}** | |`,
    "",
  ].join("\n");

  return (
    <div className="space-y-4">
      <PageHeader
        title="Fine Summary Report"
        description={`Approved staff fines — ${period}`}
        actions={<RegisterToolbar markdown={markdown} fileName={`fine-summary-${month ?? "all"}.md`} />}
      />

      <RegisterMonthFilter month={month} />

      <div className="overflow-x-auto rounded-md border border-border bg-surface">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left">
              <th className="px-3 py-2 font-semibold">Staff Name</th>
              <th className="px-3 py-2 font-semibold">Fine Reason (Remarks)</th>
              <th className="px-3 py-2 text-right font-semibold">Amount</th>
              <th className="px-3 py-2 font-semibold">Approver Name</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-center text-muted-foreground">
                  No approved fines for {period.toLowerCase()}.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id} className="border-b border-border last:border-0 align-top">
                  <td className="px-3 py-2">{r.staff_name ?? "—"}</td>
                  <td className="px-3 py-2 whitespace-pre-wrap">{r.remarks}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(r.fine_amount)}</td>
                  <td className="px-3 py-2">{r.approver_name ?? "—"}</td>
                </tr>
              ))
            )}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr className="border-t border-border font-semibold">
                <td className="px-3 py-2" colSpan={2}>Total</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(total)}</td>
                <td />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
