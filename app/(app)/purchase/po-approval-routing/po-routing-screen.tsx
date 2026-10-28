"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { FIELD_WIDTH_CSS, Field, FieldError, FieldRow, fieldWidthStep } from "@/components/ui/field";
import { Truncated } from "@/components/ui/truncated";
import { useToast } from "@/components/ui/toast";
import { ChildGrid, type ChildGridColumn } from "@/components/masters/child-grid";
import { DetailSection } from "@/components/masters/detail-section";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { resolveFlowPreview } from "@/lib/approvals/criteria";
import type { RoleOption } from "@/lib/approvals/admin";
import type { ApprovalFlow } from "@/lib/approvals/types";
import {
  planRouting,
  routingFromFlows,
  routingProblem,
  syncSeniority,
  type PoRouting,
} from "@/lib/purchase/po-routing-model";
import { savePoRouting } from "@/lib/purchase/po-routing-actions";
import type { ItemClassOption } from "@/lib/purchase/po-routing-service";

/** One line of "Who approves": above budget, one per item class, then everything else. */
type WhoRow = { key: string; kind: "above" | "class" | "default"; label: string; code?: string };
type RankRow = { key: string; role: string; rank: number };

export function PoRoutingScreen({
  flows,
  roles,
  classes,
  canEdit,
}: {
  flows: ApprovalFlow[];
  roles: RoleOption[];
  classes: ItemClassOption[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const loaded = useMemo(() => routingFromFlows(flows, classes.map((c) => c.code)), [flows, classes]);
  const [routing, setRouting] = useState<PoRouting>(loaded.routing);
  const [dirty, setDirty] = useState(false);
  const [isPending, startTransition] = useTransition();
  useUnsavedGuard(dirty || isPending);

  // "Try it" — a PO the operator describes, routed by the drafts Save would write.
  const [tryClasses, setTryClasses] = useState<string[]>([]);
  const [tryAbove, setTryAbove] = useState(false);

  const holders = useMemo(() => new Map(roles.map((r) => [r.name, r.holderCount])), [roles]);
  const className = useMemo(() => new Map(classes.map((c) => [c.code, c.name])), [classes]);

  const change = (next: PoRouting) => {
    setRouting({ ...next, seniority: syncSeniority(next.classRoles, next.seniority) });
    setDirty(true);
  };
  const roleOf = (r: WhoRow) =>
    r.kind === "above" ? routing.aboveBudgetRole : r.kind === "default" ? routing.defaultRole : routing.classRoles[r.code!] ?? "";
  const setRoleOf = (r: WhoRow, role: string) =>
    change(
      r.kind === "above"
        ? { ...routing, aboveBudgetRole: role }
        : r.kind === "default"
          ? { ...routing, defaultRole: role }
          : { ...routing, classRoles: { ...routing.classRoles, [r.code!]: role } },
    );
  const move = (role: string, by: -1 | 1) => {
    const s = [...routing.seniority];
    const i = s.indexOf(role);
    const j = i + by;
    if (i < 0 || j < 0 || j >= s.length) return;
    [s[i], s[j]] = [s[j], s[i]];
    setRouting({ ...routing, seniority: s });
    setDirty(true);
  };

  const whoRows: WhoRow[] = [
    { key: "above", kind: "above", label: "Above approved budget" },
    ...classes.map((c) => ({ key: c.code, kind: "class" as const, label: c.name, code: c.code })),
    { key: "default", kind: "default", label: "Every other PO" },
  ];
  const rankRows: RankRow[] = routing.seniority.map((role, i) => ({ key: role, role, rank: i + 1 }));

  /* WIDTHS (check:grid-budget): name 288 + party 200 + num 72 = 560, and 632
     with the grid's 72px chrome ≤ 1155. */
  const whoColumns: ChildGridColumn<WhoRow>[] = [
    {
      header: "Purchase order",
      width: FIELD_WIDTH_CSS.name,
      cell: (r) => <Truncated className={r.kind === "class" ? "" : "font-medium"}>{r.label}</Truncated>,
    },
    {
      header: "Approver",
      width: FIELD_WIDTH_CSS.party,
      cell: (r) => {
        const role = roleOf(r);
        const nobody = !!role && (holders.get(role) ?? 0) === 0;
        return (
          <>
            <Select
              compact
              aria-label={`Approver — ${r.label}`}
              required={r.kind !== "class"}
              disabled={!canEdit}
              value={role}
              onChange={(e) => setRoleOf(r, e.target.value)}
            >
              {/* A class with no approver of its own falls to "Every other PO" — said
                  in the option, since it is a state of the routing, not a hint. */}
              <option value="">{r.kind === "class" ? "Same as every other PO" : ""}</option>
              {roles.map((o) => (
                <option key={o.name} value={o.name}>
                  {o.name}
                </option>
              ))}
            </Select>
            {nobody && <FieldError>Nobody holds this role — a PO sent here cannot be submitted.</FieldError>}
          </>
        );
      },
    },
    {
      header: "People",
      align: "right",
      width: FIELD_WIDTH_CSS.num,
      cell: (r) => {
        const role = roleOf(r);
        return <span className="tabular-nums">{role ? (holders.get(role) ?? 0) : ""}</span>;
      },
    },
  ];

  /* WIDTHS (check:grid-budget): num 72 + party 200 + name 288 + hug 88 = 648,
     and 720 with the grid's 72px chrome ≤ 1155. */
  const rankColumns: ChildGridColumn<RankRow>[] = [
    { header: "Rank", align: "right", width: FIELD_WIDTH_CSS.num, cell: (r) => <span className="tabular-nums">{r.rank}</span> },
    { header: "Approver", width: FIELD_WIDTH_CSS.party, cell: (r) => <Truncated>{r.role}</Truncated> },
    {
      header: "Approves",
      width: FIELD_WIDTH_CSS.name,
      cell: (r) => (
        <Truncated>
          {Object.entries(routing.classRoles)
            .filter(([, role]) => role === r.role)
            .map(([code]) => className.get(code) ?? code)
            .join(", ")}
        </Truncated>
      ),
    },
    {
      header: "Move",
      width: FIELD_WIDTH_CSS.hug,
      cell: (r) =>
        canEdit ? (
          <div className="flex gap-1">
            <Button type="button" variant="outline" size="sm" aria-label={`Move ${r.role} up`} disabled={r.rank === 1} onClick={() => move(r.role, -1)}>
              ↑
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-label={`Move ${r.role} down`}
              disabled={r.rank === rankRows.length}
              onClick={() => move(r.role, 1)}
            >
              ↓
            </Button>
          </div>
        ) : null,
    },
  ];

  /* THE PREVIEW ROUTES THROUGH THE ENGINE'S OWN PREVIEW MATCHER, over the drafts
     Save would write PLUS the flows this screen leaves alone — one of those could
     match first, and a preview that ignored them would promise a route Save does
     not deliver. */
  const tryResult = useMemo(() => {
    const drafts = planRouting(routing, flows).save.map(
      (d) => ({ ...d, id: d.id ?? d.flow_name, created_at: "", updated_at: "", created_by: null }) as ApprovalFlow,
    );
    const hit = resolveFlowPreview([...drafts, ...loaded.others], { above_budget: tryAbove, item_classes: tryClasses });
    return hit ? { role: hit.steps?.[0]?.approver_role_key ?? "", flow: hit.flow_name } : null;
  }, [routing, flows, loaded.others, tryAbove, tryClasses]);

  const problem = routingProblem(routing);
  const save = () =>
    startTransition(async () => {
      const res = await savePoRouting(routing);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setDirty(false);
      toast.success("PO approval routing saved — new POs follow it from now on");
      router.refresh();
    });

  /** The narrow-pane card: the table's own columns and widths, one declaration (skill rule 4). */
  const mobileRow = <T,>(columns: ChildGridColumn<T>[], row: T, i: number) => (
    <FieldRow align="start" gap="tight">
      {columns.map((c, ci) => (
        <Field key={ci} label={c.header} required={c.required} w={fieldWidthStep(c.width) ?? "hug"}>
          {c.cell(row, i)}
        </Field>
      ))}
    </FieldRow>
  );

  return (
    <div data-focus-scope className="space-y-4">
      <DetailSection label="Who approves">
        {/* default-row: exempt -- one fixed row per item class plus two; the grid cannot grow */}
        <ChildGrid<WhoRow>
          columns={whoColumns}
          rows={whoRows}
          tableFrom="5xl"
          flatRows
          hideAdd
          hideRemove
          keepOne={false}
          onAdd={() => false}
          onRemove={() => {}}
          renderMobileRow={(row, i) => mobileRow(whoColumns, row, i)}
        />
      </DetailSection>

      <DetailSection label="Seniority — who gets a PO that mixes classes">
        {rankRows.length ? (
          // default-row: exempt -- rows are DERIVED from the approvers chosen above
          <ChildGrid<RankRow>
            columns={rankColumns}
            rows={rankRows}
            tableFrom="5xl"
            flatRows
            hideAdd
            hideRemove
            keepOne={false}
            onAdd={() => false}
            onRemove={() => {}}
            renderMobileRow={(row, i) => mobileRow(rankColumns, row, i)}
          />
        ) : (
          <p className="text-sm text-muted-foreground">
            No item class has an approver of its own — every PO within budget goes to the approver for every other PO.
          </p>
        )}
      </DetailSection>

      <DetailSection label="Try it">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
          {classes.map((c) => (
            <label key={c.code} className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                className="h-4 w-4 cursor-pointer accent-primary"
                checked={tryClasses.includes(c.code)}
                onChange={(e) =>
                  setTryClasses((xs) => (e.target.checked ? [...xs, c.code] : xs.filter((x) => x !== c.code)))
                }
              />
              {c.name}
            </label>
          ))}
          <label className="flex cursor-pointer items-center gap-2 font-medium">
            <input
              type="checkbox"
              className="h-4 w-4 cursor-pointer accent-primary"
              checked={tryAbove}
              onChange={(e) => setTryAbove(e.target.checked)}
            />
            Above budget
          </label>
        </div>
        <p className="mt-3 text-sm">
          {tryResult ? (
            <>
              Goes to <span className="font-semibold">{tryResult.role || "—"}</span>
              <span className="text-muted-foreground"> · {tryResult.flow}</span>
            </>
          ) : (
            <span className="text-danger">No flow takes this PO — it could not be submitted.</span>
          )}
        </p>
      </DetailSection>

      {loaded.others.length > 0 && (
        <p className="text-sm text-muted-foreground">
          {loaded.others.length} more Purchase Order {loaded.others.length === 1 ? "flow uses" : "flows use"} other rules
          and {loaded.others.length === 1 ? "is" : "are"} kept as {loaded.others.length === 1 ? "it is" : "they are"} — see
          Approvals ▸ Flows.
        </p>
      )}

      {canEdit && (
        <div className="flex items-center justify-end gap-3">
          <span className="text-sm text-muted-foreground">{dirty ? (problem || "Unsaved changes") : ""}</span>
          <Button onClick={save} disabled={!dirty || isPending || !!problem}>
            {isPending ? "Saving…" : "Save routing"}
          </Button>
        </div>
      )}
    </div>
  );
}
