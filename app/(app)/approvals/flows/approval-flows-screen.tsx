"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Layers, ListChecks, Filter } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { DataTable, type Column } from "@/components/ui/data-table";
import { withCreatedColumns } from "@/components/ui/created-columns";
import { rowActionsColumn } from "@/components/ui/row-actions-column";
import { RowActions } from "@/components/ui/row-actions";
import { FilterBar } from "@/components/ui/filter-bar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Field, FieldGrid } from "@/components/ui/field";
import { StatusPill } from "@/components/ui/status-pill";
import { Truncated } from "@/components/ui/truncated";
import { ChildGrid, type ChildGridColumn } from "@/components/masters/child-grid";
import {
  MasterFullScreen,
  SectionBody,
  type FullScreenSection,
} from "@/components/masters/master-full-screen";
import { useToast } from "@/components/ui/toast";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { saveApprovalFlow, setApprovalFlowActive } from "@/lib/approvals/actions";
import { describeCriteria } from "@/lib/approvals/criteria";
import { WORKFLOW_LIST, workflowLabel } from "@/lib/approvals/workflows";
import type { RoleOption } from "@/lib/approvals/admin";
import type { ApprovalFlow, ApprovalStep, CriteriaCondition } from "@/lib/approvals/types";

export type FlowRow = ApprovalFlow & { created_by_name?: string | null };

/** A step being edited. `key` is the grid's identity, never persisted. */
type StepRow = {
  key: string;
  step_label: string;
  approver_role_key: string;
  step_type: "" | "review" | "final";
};

/** One criteria condition being edited. */
type CritRow = {
  key: string;
  field: string;
  op: "eq" | "ne" | "gt" | "gte" | "lt" | "lte" | "in";
  value: string;
};

/**
 * THE FLOW BUILDER.
 *
 * ## WHAT THIS SCREEN IS FOR, IN ONE LINE
 *
 * Turning "a budget over ten lakh needs the MD as well" from a migration into a
 * row. That is the entire justification for the engine, and this is the only
 * place the sentence gets written.
 *
 * ## THE ZERO-HOLDER WARNING IS THE MOST VALUABLE THING HERE
 *
 * The skill says so outright, and the reason is the failure it prevents: a step
 * routed to a role nobody holds produces a run that sits in nobody's queue,
 * raises nothing, and is chased by no one. `approval_start_run` refuses to
 * create one — but that refusal lands on whoever submits a budget at month end,
 * not on whoever built the flow in a quiet moment. The count beside the role
 * moves the discovery to the person who can fix it.
 *
 * It WARNS and does not BLOCK: a flow is legitimately built the day before the
 * role is assigned.
 *
 * ## CRITERIA IS FLAT, AND THAT IS A FEATURE
 *
 * No nested AND/OR/NOT — the conditions are ANDed and that is all. When a flow
 * needs OR, it is two flows at different priorities. The skill's reasoning is
 * worth keeping in mind while being tempted to add a group button: a flat
 * matcher stays renderable as an English sentence, and an admin who can read the
 * sentence catches a mis-built flow before production. `describeCriteria` writes
 * that sentence, and it is shown on every row of the list.
 */
export function ApprovalFlowsScreen({
  rows,
  roles,
}: {
  rows: FlowRow[];
  roles: RoleOption[];
}) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, start] = useTransition();

  const [query, setQuery] = useState("");
  const [workflow, setWorkflow] = useState("");
  const [mode, setMode] = useState<"list" | "edit">("list");
  const [editId, setEditId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  const [workflowKey, setWorkflowKey] = useState("");
  const [flowName, setFlowName] = useState("");
  const [priority, setPriority] = useState("100");
  const [isActive, setIsActive] = useState(true);
  const [steps, setSteps] = useState<StepRow[]>([]);
  const [crits, setCrits] = useState<CritRow[]>([]);

  /* AGENTS.md, Auto-reload guard: any screen holding editable local state must
     declare itself, `isPending` included — a reload landing mid-action loses the
     toast and leaves the admin unsure whether the flow saved. */
  useUnsavedGuard(dirty || isPending);

  /* A REF, NOT A MUTATED `useMemo`. The React Compiler treats a memo's result as
     immutable and errors on `seq.n++` ("this function may reassign or modify
     `seq` after render"); a ref is the app's own idiom for a key generator —
     `fabric-bom-screen.tsx` and `mba-master-screen.tsx` both use exactly this. */
  const keySeq = useRef(0);
  const newKey = () => `k${keySeq.current++}`;

  const roleByName = useMemo(
    () => new Map(roles.map((r) => [r.name, r.holderCount])),
    [roles],
  );

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rows.filter((f) => {
      if (workflow && f.workflow_key !== workflow) return false;
      if (!needle) return true;
      return [f.flow_name, workflowLabel(f.workflow_key)].some((v) =>
        (v ?? "").toLowerCase().includes(needle),
      );
    });
  }, [rows, query, workflow]);

  function openNew() {
    setEditId(null);
    setWorkflowKey(WORKFLOW_LIST[0]?.key ?? "");
    setFlowName("");
    setPriority("100");
    setIsActive(true);
    setSteps([{ key: newKey(), step_label: "", approver_role_key: "", step_type: "" }]);
    setCrits([]);
    setDirty(false);
    setMode("edit");
  }

  function openExisting(f: FlowRow) {
    setEditId(f.id);
    setWorkflowKey(f.workflow_key);
    setFlowName(f.flow_name);
    setPriority(String(f.priority));
    setIsActive(f.is_active);
    setSteps(
      (f.steps ?? []).map((s) => ({
        key: newKey(),
        step_label: s.step_label ?? "",
        approver_role_key: s.approver_role_key ?? "",
        step_type: (s.step_type ?? "") as StepRow["step_type"],
      })),
    );
    setCrits(critRowsOf(f.criteria));
    setDirty(false);
    setMode("edit");
  }

  /** Unpack the stored criteria object back into editable rows. */
  function critRowsOf(criteria: Record<string, CriteriaCondition>): CritRow[] {
    return Object.entries(criteria ?? {}).map(([field, cond]) => {
      if (cond !== null && typeof cond === "object") {
        const [op, value] = Object.entries(cond)[0] ?? ["eq", ""];
        return {
          key: newKey(),
          field,
          op: op as CritRow["op"],
          value: Array.isArray(value) ? value.join(", ") : String(value),
        };
      }
      return { key: newKey(), field, op: "eq" as const, value: String(cond) };
    });
  }

  /**
   * Pack the rows back into the flat AND-of-conditions the matcher reads.
   *
   * A NUMERIC-LOOKING VALUE IS STORED AS A NUMBER. `gte` against the string
   * "1000000" would compare lexically and rank "9" above "1000000", so a
   * ten-lakh threshold would match a nine-rupee budget. The comparison operators
   * are the whole reason this coercion exists.
   */
  function criteriaOf(list: CritRow[]): Record<string, CriteriaCondition> {
    const out: Record<string, CriteriaCondition> = {};
    for (const c of list) {
      const field = c.field.trim();
      if (!field) continue;
      const raw = c.value.trim();
      if (c.op === "in") {
        out[field] = {
          in: raw.split(",").map((v) => coerce(v.trim())),
        } as CriteriaCondition;
        continue;
      }
      const v = coerce(raw);
      out[field] = (c.op === "eq" ? v : { [c.op]: v }) as CriteriaCondition;
    }
    return out;
  }

  const coerce = (v: string): string | number | boolean => {
    if (v === "true") return true;
    if (v === "false") return false;
    if (v !== "" && !Number.isNaN(Number(v))) return Number(v);
    return v;
  };

  const stepsPayload = (): ApprovalStep[] =>
    steps
      .filter((s) => s.step_label.trim() || s.approver_role_key)
      .map((s, i) => ({
        step_order: i + 1,
        step_label: s.step_label.trim(),
        approver_role_key: s.approver_role_key || null,
        ...(s.step_type ? { step_type: s.step_type } : {}),
      }));

  /**
   * `canSave` IS DERIVED, never hand-assembled (layout rule 5).
   *
   * Everything below is also enforced by `approval_validate_steps` (0501) as a
   * raised exception, so this is the courtesy half — it stops the admin
   * discovering at Save that step 3 names nobody.
   */
  const problems = useMemo(() => {
    const out: string[] = [];
    if (!workflowKey) out.push("Pick the document this flow approves");
    if (!flowName.trim()) out.push("Name the flow");
    const packed = stepsPayload();
    if (packed.length === 0) out.push("Add at least one step");
    packed.forEach((s, i) => {
      if (!s.step_label) out.push(`Step ${i + 1} needs a label`);
      if (!s.approver_role_key) out.push(`Step ${i + 1} names no approver`);
    });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workflowKey, flowName, steps]);

  function submit() {
    start(async () => {
      const res = await saveApprovalFlow({
        ...(editId ? { id: editId } : {}),
        workflow_key: workflowKey,
        flow_name: flowName.trim(),
        description: null,
        tenant_id: null,
        location_id: null,
        criteria: criteriaOf(crits),
        steps: stepsPayload(),
        priority: Number(priority) || 100,
        is_active: isActive,
      });
      if (res.ok) {
        success(editId ? "Flow updated" : "Flow created");
        setDirty(false);
        setMode("list");
        router.refresh();
      } else {
        toastError(res.error);
      }
    });
  }

  function toggleActive(f: FlowRow) {
    start(async () => {
      const res = await setApprovalFlowActive(f.id, !f.is_active);
      if (res.ok) {
        success(f.is_active ? "Flow switched off" : "Flow switched on");
        router.refresh();
      } else {
        toastError(res.error);
      }
    });
  }

  // ---- the editor's grids --------------------------------------------------

  const mut = <T,>(set: (fn: (xs: T[]) => T[]) => void) => (fn: (xs: T[]) => T[]) => {
    set(fn);
    setDirty(true);
  };
  const mutSteps = mut<StepRow>(setSteps);
  const mutCrits = mut<CritRow>(setCrits);

  const stepColumns: ChildGridColumn<StepRow>[] = [
    {
      header: "#",
      width: "3rem",
      align: "right",
      cell: (_r, i) => <span className="text-sm tabular-nums">{i + 1}</span>,
    },
    {
      header: "Step",
      cell: (r) => (
        <Input
          value={r.step_label}
          onChange={(e) =>
            mutSteps((xs) =>
              xs.map((x) => (x.key === r.key ? { ...x, step_label: e.target.value } : x)),
            )
          }
        />
      ),
    },
    {
      header: "Approver role",
      width: "14rem",
      cell: (r) => (
        <Select
          compact
          value={r.approver_role_key}
          onChange={(e) =>
            mutSteps((xs) =>
              xs.map((x) =>
                x.key === r.key ? { ...x, approver_role_key: e.target.value } : x,
              ),
            )
          }
        >
          <option value="" />
          {roles.map((role) => (
            <option key={role.name} value={role.name}>
              {role.name}
            </option>
          ))}
        </Select>
      ),
    },
    {
      header: "Holders",
      width: "8rem",
      cell: (r) => {
        if (!r.approver_role_key) return <span className="text-sm">—</span>;
        const n = roleByName.get(r.approver_role_key) ?? 0;
        /* THE WARNING, AT THE POINT OF THE DECISION. Red rather than muted:
           this is the difference between a flow that works and one that strands
           every request routed through it. */
        return n === 0 ? (
          <span className="text-xs font-medium text-danger">
            nobody holds this
          </span>
        ) : (
          <span className="text-sm tabular-nums text-muted-foreground">{n}</span>
        );
      },
    },
    {
      header: "Type",
      width: "8rem",
      cell: (r) => (
        <Select
          compact
          value={r.step_type}
          onChange={(e) =>
            mutSteps((xs) =>
              xs.map((x) =>
                x.key === r.key
                  ? { ...x, step_type: e.target.value as StepRow["step_type"] }
                  : x,
              ),
            )
          }
        >
          <option value="" />
          <option value="review">review</option>
          <option value="final">final</option>
        </Select>
      ),
    },
  ];

  const critColumns: ChildGridColumn<CritRow>[] = [
    {
      header: "Context key",
      cell: (r) => (
        /* caps-input: exempt -- a criteria key is matched byte-for-byte against
           a JSON key the calling screen sends (`total_value`), so upper-casing
           it would stop every condition matching. */
        <Input
          uppercase={false}
          value={r.field}
          onChange={(e) =>
            mutCrits((xs) =>
              xs.map((x) => (x.key === r.key ? { ...x, field: e.target.value } : x)),
            )
          }
        />
      ),
    },
    {
      header: "Test",
      width: "8rem",
      cell: (r) => (
        <Select
          compact
          value={r.op}
          onChange={(e) =>
            mutCrits((xs) =>
              xs.map((x) =>
                x.key === r.key ? { ...x, op: e.target.value as CritRow["op"] } : x,
              ),
            )
          }
        >
          <option value="eq">is</option>
          <option value="ne">is not</option>
          <option value="gt">&gt;</option>
          <option value="gte">&ge;</option>
          <option value="lt">&lt;</option>
          <option value="lte">&le;</option>
          <option value="in">is one of</option>
        </Select>
      ),
    },
    {
      header: "Value",
      width: "14rem",
      cell: (r) => (
        /* caps-input: exempt -- compared against the raw context value the
           calling screen sends; upper-casing "yarn" to "YARN" would stop it
           matching. */
        <Input
          uppercase={false}
          value={r.value}
          onChange={(e) =>
            mutCrits((xs) =>
              xs.map((x) => (x.key === r.key ? { ...x, value: e.target.value } : x)),
            )
          }
        />
      ),
    },
  ];

  const sections: FullScreenSection[] = [
    {
      key: "flow",
      label: "Flow",
      icon: Layers,
      done: !!workflowKey && !!flowName.trim(),
      content: (
        <SectionBody title="Flow">
          <FieldGrid>
            <Field label="Document" required size="sm" htmlFor="af-workflow">
              <Select
                id="af-workflow"
                value={workflowKey}
                onChange={(e) => {
                  setWorkflowKey(e.target.value);
                  setDirty(true);
                }}
              >
                <option value="" />
                {WORKFLOW_LIST.map((w) => (
                  <option key={w.key} value={w.key}>
                    {w.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Flow name" required size="sm" htmlFor="af-name">
              <Input
                id="af-name"
                value={flowName}
                onChange={(e) => {
                  setFlowName(e.target.value);
                  setDirty(true);
                }}
              />
            </Field>
            <Field label="Priority" size="sm" htmlFor="af-priority">
              <Input
                id="af-priority"
                type="number"
                value={priority}
                onChange={(e) => {
                  setPriority(e.target.value);
                  setDirty(true);
                }}
              />
            </Field>
            <Field label="Active" size="sm" htmlFor="af-active">
              <Select
                id="af-active"
                value={isActive ? "yes" : "no"}
                onChange={(e) => {
                  setIsActive(e.target.value === "yes");
                  setDirty(true);
                }}
              >
                <option value="yes">Active</option>
                <option value="no">Switched off</option>
              </Select>
            </Field>
          </FieldGrid>
          {/* LOWER WINS, said where the number is typed. One ordering and only
              one — the skill records that the source system ran a 6-level
              specificity ladder ALONGSIDE a priority column, and two independent
              orderings is ambiguity rather than flexibility. The catch-alls
              seeded by 0503 sit at 900, so anything built here outranks them. */}
          <p className="text-xs text-muted-foreground">
            The lowest priority number that matches wins. The default catch-all
            flows sit at 900.
          </p>
        </SectionBody>
      ),
    },
    {
      key: "when",
      label: "When it applies",
      icon: Filter,
      done: crits.length > 0,
      content: (
        <SectionBody title="When it applies">
          {/* CONDITIONAL, the only shape a line under a heading may take. It says
              what "no conditions" MEANS, which is not obvious and is the single
              most consequential state on this screen: a flow with no conditions
              is the catch-all for its document. */}
          {crits.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No conditions — this flow applies to every {workflowLabel(workflowKey)}{" "}
              that no lower-numbered flow has already claimed.
            </p>
          )}
          <ChildGrid<CritRow>
            columns={critColumns}
            rows={crits}
            addLabel="+ Add condition"
            onAdd={() => {
              mutCrits((xs) => [
                ...xs,
                { key: newKey(), field: "", op: "eq", value: "" },
              ]);
            }}
            onRemove={(row) => mutCrits((xs) => xs.filter((x) => x.key !== row.key))}
          />
          <p className="mt-3 text-xs text-muted-foreground">
            All conditions must hold. For an either/or, build a second flow with a
            lower priority number. A key the calling screen does not send does NOT
            match — the request falls through to the catch-all rather than being
            mis-routed.
          </p>
        </SectionBody>
      ),
    },
    {
      key: "steps",
      label: "Steps",
      icon: ListChecks,
      done: steps.some((s) => s.step_label.trim() && s.approver_role_key),
      content: (
        <SectionBody title="Steps">
          <ChildGrid<StepRow>
            columns={stepColumns}
            rows={steps}
            addLabel="+ Add step"
            seedRow
            onAdd={() => {
              mutSteps((xs) => [
                ...xs,
                { key: newKey(), step_label: "", approver_role_key: "", step_type: "" },
              ]);
            }}
            onRemove={(row) => mutSteps((xs) => xs.filter((x) => x.key !== row.key))}
          />
          <p className="mt-3 text-xs text-muted-foreground">
            Signed in order, top to bottom. Editing a flow never changes a request
            already in flight — each run carries a frozen copy of the steps it
            started with.
          </p>
        </SectionBody>
      ),
    },
  ];

  // ---- the list ------------------------------------------------------------

  const columns: Column<FlowRow>[] = [
    {
      header: "Document",
      cell: (f) => <span className="text-sm">{workflowLabel(f.workflow_key)}</span>,
    },
    {
      header: "Flow",
      cell: (f) => (
        <button
          type="button"
          className="text-xs font-medium text-primary hover:underline"
          onClick={() => openExisting(f)}
        >
          <Truncated>{f.flow_name}</Truncated>
        </button>
      ),
    },
    {
      header: "When",
      /* THE ENGLISH SENTENCE, on every row. This is the skill's stated reason
         for keeping criteria flat — "an admin who can read the sentence catches
         a mis-built flow before production" — and it only pays off if the
         sentence is actually shown somewhere they look. */
      cell: (f) => (
        <span className="text-xs text-muted-foreground">
          <Truncated>{describeCriteria(f.criteria) || "Always"}</Truncated>
        </span>
      ),
    },
    {
      header: "Steps",
      cell: (f) => (
        <span className="text-xs text-muted-foreground">
          <Truncated>
            {(f.steps ?? []).map((s) => s.step_label).join(" → ") || "—"}
          </Truncated>
        </span>
      ),
    },
    {
      header: "Priority",
      align: "right",
      cell: (f) => <span className="text-sm tabular-nums">{f.priority}</span>,
    },
    {
      header: "Status",
      cell: (f) =>
        f.is_active ? (
          <StatusPill tone="success">Active</StatusPill>
        ) : (
          <StatusPill tone="neutral">Off</StatusPill>
        ),
    },
    rowActionsColumn<FlowRow>((f) => (
      <RowActions
        label={f.flow_name}
        onEdit={() => openExisting(f)}
        canEdit
        /* SWITCHED OFF, NEVER DELETED. Runs in flight hold a frozen copy of the
           steps, so turning a flow off never strands work — and the database
           refuses a delete anyway (`approval_runs.flow_id` is ON DELETE
           RESTRICT), which is the same lesson stated as a constraint. */
        canDelete={false}
        /* SWITCH ON/OFF LIVES IN THE ⋮ MENU, not as a button in the row. That
           is the app's settled shape for exactly this kind of action — the
           client moved Block/Unblock off all 40 master forms into the listing's
           ⋮ (AGENTS.md's "Block is a row ACTION" decision), and a flow being
           active is the same kind of fact about the row. */
        menu={[
          {
            label: f.is_active ? "Switch off" : "Switch on",
            onClick: () => toggleActive(f),
            disabled: isPending,
          },
        ]}
        isPending={isPending}
      />
    )),
  ];

  return (
    <>
      <div className="space-y-4">
        <PageHeader
          title="Approval Flows"
          description="Who signs each document, in what order, and under which conditions."
          actions={
            <Button size="md" onClick={openNew}>
              + New Flow
            </Button>
          }
        />

        <FilterBar
          search={query}
          onSearch={setQuery}
          searchPlaceholder="Search flow or document…"
          activeCount={workflow ? 1 : 0}
          onReset={workflow ? () => setWorkflow("") : undefined}
          right={`${filtered.length} of ${rows.length}`}
        >
          <div>
            <label className="text-xs font-medium" htmlFor="af-filter-workflow">
              Document
            </label>
            <Select
              id="af-filter-workflow"
              value={workflow}
              onChange={(e) => setWorkflow(e.target.value)}
            >
              <option value="">All ({rows.length})</option>
              {WORKFLOW_LIST.map((w) => (
                <option key={w.key} value={w.key}>
                  {w.label}
                </option>
              ))}
            </Select>
          </div>
        </FilterBar>

        <DataTable
          columns={withCreatedColumns(columns, filtered)}
          rows={filtered}
          getKey={(f) => f.id}
          empty="No flows yet. Every document falls back to its default chain until one is built."
        />
      </div>

      <MasterFullScreen
        mount="overlay"
        open={mode === "edit"}
        onClose={() => setMode("list")}
        modeLabel={
          <>
            {editId ? "Editing" : "New"}{" "}
            <span className="font-semibold text-foreground">approval flow</span>
          </>
        }
        header={{
          initials: "AF",
          title: flowName || (editId ? "Approval flow" : "New approval flow"),
          badges: dirty ? (
            <span className="text-[11px] font-medium text-warning">● Unsaved</span>
          ) : null,
        }}
        sections={sections}
        footer={{
          status: dirty
            ? "Unsaved changes"
            : editId
              ? "All changes saved"
              : "New approval flow",
          onCancel: () => setMode("list"),
          onSave: submit,
          saveLabel: "Save flow",
          canSave: problems.length === 0,
          /* Layout rule 2: no red badge on the rail, so Save must say WHY it is
             refusing — a dead Save button with no explanation is the bug
             `sectionValidity` was built to end. */
          onBlockedSave: () => toastError(problems[0] ?? "Nothing to save"),
          isPending,
        }}
      />
    </>
  );
}
