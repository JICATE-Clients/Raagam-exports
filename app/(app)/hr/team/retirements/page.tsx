import Link from "next/link";
import { requirePermission } from "@/lib/auth/server";
import { PageHeader } from "@/components/ui/page-header";
import { buttonClasses } from "@/components/ui/button";
import { DataTable, type Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import { today } from "@/lib/calendar";
import { fmtDate } from "@/lib/format";
import { getLcSettings, lifecycleViewer, listRetirementsDue } from "@/lib/hr/lifecycle-service";
import { personKey } from "@/lib/hr/timeoff-types";
import type { RetirementDue } from "@/lib/hr/lifecycle-types";

export const metadata = { title: "Retirements Due" };

/**
 * HR ▸ Team Lifecycle ▸ Retirements Due (0766). MyJKKN ran a monthly job that
 * opened retirement cases by itself; a job is one more thing to schedule and
 * forget, so here the list is worked out whenever the page opens
 * (`lc_retirements_due`, from date of birth and the retirement age on
 * Lifecycle Setup), and HR opens the exit with one click.
 */
export default async function Page() {
  await requirePermission("hr_payroll", "view");
  const [rows, settings, viewer] = await Promise.all([listRetirementsDue(), getLcSettings(), lifecycleViewer()]);
  const t0 = today();

  const columns: Column<RetirementDue>[] = [
    { header: "Code", cell: (r) => <span className="font-mono text-xs font-medium">{r.code ?? "—"}</span> },
    {
      header: "Person",
      cell: (r) => (
        <span className="text-sm">
          <span className="font-medium">{r.name}</span>
          <span className="ml-2 text-xs text-muted-foreground">{r.person_kind === "worker" ? "Worker" : "Staff"}</span>
        </span>
      ),
    },
    { header: "Date of Birth", cell: (r) => <span className="text-sm tabular-nums">{fmtDate(r.date_of_birth)}</span> },
    { header: "Age Now", align: "right", cell: (r) => <span className="text-sm tabular-nums">{r.age_now}</span> },
    {
      header: "Retires On",
      cell: (r) => (
        <span className={r.retires_on < t0 ? "text-sm font-medium text-danger tabular-nums" : "text-sm tabular-nums"}>
          {fmtDate(r.retires_on)}
          {r.retires_on < t0 ? " (past)" : ""}
        </span>
      ),
    },
    {
      header: "Exit",
      cell: (r) =>
        r.has_exit ? (
          <StatusPill tone="info">Exit open</StatusPill>
        ) : viewer.canEdit ? (
          <Link
            href={`/hr/team/exits?retire=${personKey(r.person_kind, (r.staff_id ?? r.worker_id) as string)}&lwd=${r.retires_on}`}
            className={buttonClasses({ variant: "outline", size: "sm" })}
          >
            Open retirement exit
          </Link>
        ) : (
          <span className="text-sm text-muted-foreground">—</span>
        ),
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Retirements Due"
        description={`Active staff and workers reaching ${settings.retirement_age} within the next ${settings.retirement_lookahead} month(s), from their date of birth. People with no date of birth are not listed.`}
      />
      <DataTable
        columns={columns}
        rows={rows}
        getKey={(r) => r.staff_id ?? r.worker_id ?? r.name}
        empty="Nobody reaches retirement age in this window."
      />
    </div>
  );
}
