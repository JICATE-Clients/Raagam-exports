"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateTaFollowup } from "@/lib/orders/ta-followups/actions";
import {
  TA_FOLLOWUP_STATUSES,
  TA_FOLLOWUP_STATUS_LABELS,
  taFollowupTone,
  followupDays,
  type TaFollowupRow,
  type TaFollowupStatus,
} from "@/lib/orders/ta-followups/types";
import { useToast } from "@/components/ui/toast";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusPill } from "@/components/ui/status-pill";
import { DataTable, type Column } from "@/components/ui/data-table";
import { FilterBar } from "@/components/masters/filter-bar";
import { fmtDate, fmtNumber } from "@/lib/format";

interface Props {
  rows: TaFollowupRow[];
  canEdit: boolean;
}

const uniq = (xs: (string | null)[]) =>
  Array.from(new Set(xs.filter((x): x is string => !!x))).sort();

export function TaFollowupsClient({ rows, canEdit }: Props) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();

  const [query, setQuery] = useState("");
  const [fStatus, setFStatus] = useState("");
  const [fDept, setFDept] = useState("");
  const [fActivity, setFActivity] = useState("");
  const [fCustomer, setFCustomer] = useState("");
  const [planFrom, setPlanFrom] = useState("");
  const [planTo, setPlanTo] = useState("");

  // local drafts for the free-text followup fields (commit on blur)
  const [drafts, setDrafts] = useState<Record<string, { description?: string; notes?: string }>>({});

  const departments = useMemo(() => uniq(rows.map((r) => r.department)), [rows]);
  const activities = useMemo(() => uniq(rows.map((r) => r.activity_name)), [rows]);
  const customers = useMemo(() => uniq(rows.map((r) => r.customer)), [rows]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (fStatus && r.status !== fStatus) return false;
      if (fDept && r.department !== fDept) return false;
      if (fActivity && r.activity_name !== fActivity) return false;
      if (fCustomer && r.customer !== fCustomer) return false;
      if (planFrom && (!r.plan_date || r.plan_date < planFrom)) return false;
      if (planTo && (!r.plan_date || r.plan_date > planTo)) return false;
      if (q) {
        const hay =
          `${r.order_no ?? ""} ${r.style_code ?? ""} ${r.sq_no ?? ""} ${r.activity_name ?? ""} ${r.customer ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [rows, query, fStatus, fDept, fActivity, fCustomer, planFrom, planTo]);

  const activeCount = [fStatus, fDept, fActivity, fCustomer, planFrom, planTo].filter(
    Boolean,
  ).length;

  function resetFilters() {
    setFStatus("");
    setFDept("");
    setFActivity("");
    setFCustomer("");
    setPlanFrom("");
    setPlanTo("");
  }

  function commit(
    id: string,
    patch: Parameters<typeof updateTaFollowup>[1],
    label: string,
  ) {
    startTransition(async () => {
      const res = await updateTaFollowup(id, patch);
      if (res.ok) {
        success(label);
        router.refresh();
      } else {
        toastError(res.error);
        router.refresh();
      }
    });
  }

  const draftVal = (r: TaFollowupRow, field: "description" | "notes") =>
    drafts[r.id]?.[field] ?? r[field] ?? "";

  function setDraft(id: string, field: "description" | "notes", value: string) {
    setDrafts((d) => ({ ...d, [id]: { ...d[id], [field]: value } }));
  }

  function commitText(r: TaFollowupRow, field: "description" | "notes") {
    const next = drafts[r.id]?.[field];
    if (next === undefined || (next || "") === (r[field] ?? "")) return;
    commit(r.id, { [field]: next }, "Saved");
  }

  const columns: Column<TaFollowupRow>[] = [
    {
      header: "Order No",
      cell: (r) => (
        <div className="min-w-[90px]">
          <div className="font-mono text-xs font-medium">{r.order_no ?? "—"}</div>
          <div className="text-[11px] text-muted-foreground">{fmtDate(r.delivery_date)}</div>
        </div>
      ),
    },
    { header: "Style No", cell: (r) => <span className="text-sm">{r.style_code ?? "—"}</span> },
    { header: "SQ No", cell: (r) => <span className="font-mono text-xs">{r.sq_no ?? "—"}</span> },
    { header: "Customer", cell: (r) => <span className="text-sm">{r.customer ?? "—"}</span> },
    {
      header: "Order Qty",
      align: "right",
      cell: (r) => (
        <span className="tabular-nums text-sm">{r.order_qty != null ? fmtNumber(r.order_qty) : "—"}</span>
      ),
    },
    {
      header: "TA Deliv. Dt",
      align: "right",
      cell: (r) => (
        <span className="tabular-nums text-xs text-muted-foreground">
          {r.proposed_delivery_date ? fmtDate(r.proposed_delivery_date) : "—"}
        </span>
      ),
    },
    {
      header: "Activity",
      cell: (r) => (
        <div className="min-w-[120px]">
          <div className="text-sm font-medium">{r.activity_name ?? "—"}</div>
          {r.details && <div className="text-[11px] text-muted-foreground">{r.details}</div>}
        </div>
      ),
    },
    {
      header: "Description",
      cell: (r) =>
        canEdit ? (
          <Input
            value={draftVal(r, "description")}
            onChange={(e) => setDraft(r.id, "description", e.target.value)}
            onBlur={() => commitText(r, "description")}
            className="h-8 w-40 text-xs"
            placeholder="—"
          />
        ) : (
          <span className="text-sm text-muted-foreground">{r.description ?? "—"}</span>
        ),
    },
    {
      header: "Notes",
      cell: (r) =>
        canEdit ? (
          <Input
            value={draftVal(r, "notes")}
            onChange={(e) => setDraft(r.id, "notes", e.target.value)}
            onBlur={() => commitText(r, "notes")}
            className="h-8 w-40 text-xs"
            placeholder="—"
          />
        ) : (
          <span className="text-sm text-muted-foreground">{r.notes ?? "—"}</span>
        ),
    },
    {
      header: "Plan Dt",
      align: "right",
      cell: (r) => (
        <span className="tabular-nums text-xs text-muted-foreground">
          {r.plan_date ? fmtDate(r.plan_date) : "—"}
        </span>
      ),
    },
    {
      header: "Actual Dt",
      cell: (r) =>
        canEdit ? (
          <Input
            type="date"
            value={r.actual_date ?? ""}
            onChange={(e) =>
              commit(r.id, { actual_date: e.target.value || null }, "Actual date saved")
            }
            disabled={isPending}
            className="h-8 w-36 text-xs"
          />
        ) : (
          <span className="tabular-nums text-xs text-muted-foreground">
            {r.actual_date ? fmtDate(r.actual_date) : "—"}
          </span>
        ),
    },
    {
      header: "Days",
      align: "right",
      cell: (r) => {
        const d = followupDays(r.plan_date, r.actual_date, r.status);
        return (
          <StatusPill tone={taFollowupTone(r)}>
            {d == null ? "—" : d > 0 ? `+${d}` : `${d}`}
          </StatusPill>
        );
      },
    },
    {
      header: "Status",
      cell: (r) =>
        canEdit ? (
          <Select
            value={r.status}
            onChange={(e) =>
              commit(r.id, { status: e.target.value as TaFollowupStatus }, "Status updated")
            }
            disabled={isPending}
            className="h-8 w-32 text-xs"
            aria-label={`Status for ${r.activity_name ?? "activity"}`}
          >
            {TA_FOLLOWUP_STATUSES.map((s) => (
              <option key={s} value={s}>
                {TA_FOLLOWUP_STATUS_LABELS[s]}
              </option>
            ))}
          </Select>
        ) : (
          <StatusPill tone={taFollowupTone(r)}>
            {TA_FOLLOWUP_STATUS_LABELS[r.status]}
          </StatusPill>
        ),
    },
  ];

  return (
    <div className="space-y-4">
      <FilterBar
        search={query}
        onSearch={setQuery}
        searchPlaceholder="Search order, style, SQ, activity or customer…"
        activeCount={activeCount}
        onReset={resetFilters}
        right={
          <>
            {filtered.length} of {rows.length}
          </>
        }
      >
        <Select
          value={fStatus}
          onChange={(e) => setFStatus(e.target.value)}
          aria-label="Filter status"
          className="h-9 text-base md:text-sm"
        >
          <option value="">All status</option>
          {TA_FOLLOWUP_STATUSES.map((s) => (
            <option key={s} value={s}>
              {TA_FOLLOWUP_STATUS_LABELS[s]}
            </option>
          ))}
        </Select>
        <Select
          value={fDept}
          onChange={(e) => setFDept(e.target.value)}
          aria-label="Filter department"
          className="h-9 text-base md:text-sm"
        >
          <option value="">All departments</option>
          {departments.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </Select>
        <Select
          value={fActivity}
          onChange={(e) => setFActivity(e.target.value)}
          aria-label="Filter activity"
          className="h-9 text-base md:text-sm"
        >
          <option value="">All activities</option>
          {activities.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </Select>
        <Select
          value={fCustomer}
          onChange={(e) => setFCustomer(e.target.value)}
          aria-label="Filter customer"
          className="h-9 text-base md:text-sm"
        >
          <option value="">All customers</option>
          {customers.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </Select>
        <div>
          <Label htmlFor="ta-plan-from" className="text-xs">
            Plan from
          </Label>
          <Input
            id="ta-plan-from"
            type="date"
            value={planFrom}
            onChange={(e) => setPlanFrom(e.target.value)}
            className="h-9"
          />
        </div>
        <div>
          <Label htmlFor="ta-plan-to" className="text-xs">
            Plan to
          </Label>
          <Input
            id="ta-plan-to"
            type="date"
            value={planTo}
            onChange={(e) => setPlanTo(e.target.value)}
            className="h-9"
          />
        </div>
      </FilterBar>

      <DataTable
        columns={columns}
        rows={filtered}
        getKey={(r) => r.id}
        empty="No TA followups. Build a TA Plan with activities first (Orders ▸ TA Plan)."
      />
    </div>
  );
}
