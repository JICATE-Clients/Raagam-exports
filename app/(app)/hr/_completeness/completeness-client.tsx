"use client";

import { useMemo, useState } from "react";
import { PageHeader } from "@/components/ui/page-header";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { DataTable, type Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import { withCreatedColumns } from "@/components/ui/created-columns";
import { Button } from "@/components/ui/button";
import { rowActionsColumn } from "@/components/ui/row-actions-column";
import CompletenessSheet from "./completeness-sheet";
import {
  bankDone,
  salaryDone,
  type PersonCompleteness,
} from "@/lib/hr/completeness-types";

/**
 * WHO STILL OWES A SALARY REGISTRY / A BANK ACCOUNT — one screen, two subjects.
 *
 * The client asked for both to appear in the HR sidebar so the pending count is
 * visible without opening people one at a time (2026-09-11). The two lists ask
 * the same question of the same people and differ only in which columns they
 * show and which predicate decides "done", so they are one component — the same
 * call `person-client.tsx` makes for Staff and Workers, and for the same reason:
 * two copies would drift the first time either changed.
 *
 * ## IT READS; IT DOES NOT EDIT
 *
 * A row opens the person's own record, which is where these fields live and
 * where every rule about them already is — the required holds, the duplicate
 * guard, the derived `monthly_salary` trigger. Editing a salary here would be a
 * second write path to the same columns, and the first divergence between them
 * would be silent.
 */
export type CompletenessKind = "salary" | "bank";

type Named = { id: string; name: string };

export default function CompletenessClient({
  kind,
  rows,
  departments,
  banks,
}: {
  kind: CompletenessKind;
  rows: PersonCompleteness[];
  departments: Named[];
  banks: Named[];
}) {
  const [q, setQ] = useState("");
  /**
   * ALL, not Pending, is the opening view (client 2026-09-12: "not only pending
   * i can filter them so i want every staff and workers salary and bank details
   * here like filled pending and also filled").
   *
   * The screen started on Pending because the count was its whole point. It is
   * now also where these details are ENTERED and CHANGED, and a filter that
   * hides everyone already done makes the screen useless for the second job —
   * a filled record would vanish from the list the moment it was filled. The
   * count above the table still answers the original question, and it counts
   * the whole population rather than what the filter is showing.
   */
  const [state, setState] = useState<"pending" | "done" | "all">("all");
  const [who, setWho] = useState<"all" | "staff" | "worker">("all");
  /** The row whose sheet is open, or null. */
  const [editing, setEditing] = useState<PersonCompleteness | null>(null);

  const isSalary = kind === "salary";
  const done = isSalary ? salaryDone : bankDone;

  const nameOf = useMemo(() => {
    const m = new Map<string, string>();
    for (const d of departments) m.set(d.id, d.name);
    for (const b of banks) m.set(b.id, b.name);
    return m;
  }, [departments, banks]);

  /**
   * INACTIVE PEOPLE ARE OUT OF THE COUNT, not merely filtered from the table.
   *
   * A left employee who never had bank details is not work owed to anybody, and
   * counting them would make the number permanently non-zero — a pending count
   * that can never reach zero is one nobody reads twice.
   */
  const live = useMemo(() => rows.filter((r) => r.isActive), [rows]);

  const pending = useMemo(() => live.filter((r) => !done(r)), [live, done]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return live.filter((r) => {
      if (state === "pending" && done(r)) return false;
      if (state === "done" && !done(r)) return false;
      if (who !== "all" && r.kind !== who) return false;
      if (!needle) return true;
      return (
        r.name.toLowerCase().includes(needle) ||
        (r.code ?? "").toLowerCase().includes(needle)
      );
    });
  }, [live, q, state, who, done]);

  const money = (n: number) =>
    n > 0 ? n.toLocaleString("en-IN", { minimumFractionDigits: 2 }) : "—";

  const common: Column<PersonCompleteness>[] = [
    { header: "ID No", cell: (r) => r.code ?? "—" },
    { header: "Name", cell: (r) => r.name },
    {
      header: "Type",
      cell: (r) => (r.kind === "staff" ? "Staff" : "Worker"),
    },
    {
      header: "Department",
      cell: (r) => (r.departmentId ? (nameOf.get(r.departmentId) ?? "—") : "—"),
    },
  ];

  const specific: Column<PersonCompleteness>[] = isSalary
    ? [
        { header: "Gross (Statutory)", cell: (r) => money(r.statGross) },
        { header: "Gross (Actual)", cell: (r) => money(r.actGross) },
        { header: "ESI", cell: (r) => r.esiStatus ?? "—" },
        { header: "PF", cell: (r) => r.pfStatus ?? "—" },
      ]
    : [
        { header: "Pay Mode", cell: (r) => r.payMode ?? "—" },
        {
          header: "Bank",
          cell: (r) => (r.bankId ? (nameOf.get(r.bankId) ?? "—") : "—"),
        },
        { header: "Branch", cell: (r) => r.branch ?? "—" },
        { header: "A/c No", cell: (r) => r.acNo ?? "—" },
        { header: "IFSC", cell: (r) => r.ifsc ?? "—" },
      ];

  const columns: Column<PersonCompleteness>[] = [
    ...common,
    ...specific,
    {
      header: "Status",
      cell: (r) =>
        done(r) ? (
          <StatusPill tone="success">Complete</StatusPill>
        ) : (
          <StatusPill tone="warning">Pending</StatusPill>
        ),
    },
    /* A REAL BUTTON, not a whole-row link. The row used to navigate to the
       Staff list and nothing else — "if click nothing works" (client
       2026-09-12) — which was true: it landed on a list, not on the record.
       Through `rowActionsColumn` so the trailing action column gets the shared
       width and cell wrapper rather than a hand-rolled `header: ""`
       (LAYOUT.md §6a). The label is written out rather than an icon because it
       differs by row: an empty one is being FILLED IN, a full one EDITED. */
    rowActionsColumn<PersonCompleteness>((r) => (
      <Button variant="outline" size="sm" onClick={() => setEditing(r)}>
        {done(r) ? "Edit" : "Fill in"}
      </Button>
    )),
  ];

  const title = isSalary ? "Salary Registry" : "Bank Details";

  return (
    <div className="space-y-4">
      <PageHeader
        title={title}
        description={
          isSalary
            ? "Who still needs their pay heads entered"
            : "Who still needs an account for their pay to reach"
        }
      />

      {/*
        THE COUNT IS THE POINT OF THE SCREEN, so it is stated in words above the
        table rather than left to be inferred from the row count — the table is
        filtered, and a filtered row count answers a different question from
        "how many are outstanding".
      */}
      <p className="text-sm text-muted-foreground">
        <span className="font-semibold text-foreground">{pending.length}</span>{" "}
        of {live.length} active {live.length === 1 ? "person" : "people"} still
        to fill in.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        {/* `type="search"`: a query is not a stored value, so the CAPITALS
            primitive exempts this type by construction (AGENTS.md). */}
        <Input
          type="search"
          className="h-9 w-56"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label={`Search ${title}`}
        />
        <Select
          className="h-9 w-36"
          value={state}
          onChange={(e) => setState(e.target.value as typeof state)}
          aria-label="Completion"
        >
          <option value="pending">Pending</option>
          <option value="done">Complete</option>
          <option value="all">All</option>
        </Select>
        <Select
          className="h-9 w-36"
          value={who}
          onChange={(e) => setWho(e.target.value as typeof who)}
          aria-label="Staff or workers"
        >
          <option value="all">Staff &amp; Workers</option>
          <option value="staff">Staff only</option>
          <option value="worker">Workers only</option>
        </Select>
      </div>

      {/* The row's own button opens the sheet — see the last column. */}
      <DataTable
        // Splices Created Date / Created User in last before Status.
        columns={withCreatedColumns(columns, shown)}
        rows={shown}
        getKey={(r) => `${r.kind}:${r.id}`}
        // "Nothing pending" is only a claim when there is someone to be
        // pending. With nobody on file it would be vacuously true and read as
        // a real result — the trap an empty REPORT sets (AGENTS.md).
        empty={
          live.length === 0
            ? "No active staff or workers yet."
            : state === "pending"
              ? "Nothing pending — every active person has this filled in."
              : "No records."
        }
      />

      {editing && (
        <CompletenessSheet
          kind={kind}
          row={editing}
          banks={banks}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}
