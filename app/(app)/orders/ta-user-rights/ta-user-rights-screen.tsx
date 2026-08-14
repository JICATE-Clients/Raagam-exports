"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { DataTable, type Column } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { useToast } from "@/components/ui/toast";
import { useCreateIntent } from "@/lib/use-create-intent";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { Field, FieldGrid } from "@/components/ui/field";
import { ChildGrid, type ChildGridColumn } from "@/components/masters/child-grid";
import { RecordPicker } from "@/components/masters/record-picker";
import { setTaUserRights } from "@/lib/orders/ta-user-rights/actions";
import type {
  TaUserRightsFormData,
  TaUserRightsSummaryRow,
} from "@/lib/orders/ta-user-rights/service";
import type { TaUserRight } from "@/lib/orders/ta-user-rights/types";
import { withCreatedColumns } from "@/components/ui/created-columns";

const ALL_KEY = "__all__";
const ACTIONS = ["view", "add", "modify", "delete"] as const;
type ActionKey = (typeof ACTIONS)[number];
type RowPerm = Record<ActionKey, boolean>;

const emptyPerm = (): RowPerm => ({ view: false, add: false, modify: false, delete: false });

interface Props {
  data: TaUserRightsFormData;
  allRights: TaUserRight[];
  summary: TaUserRightsSummaryRow[];
  canEdit: boolean;
}

export function TaUserRightsScreen({ data, allRights, summary, canEdit }: Props) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, start] = useTransition();

  const [userId, setUserId] = useState<string | null>(null);
  const [perms, setPerms] = useState<Record<string, RowPerm>>({});

  /**
   * Tracks whether the matrix has been TOUCHED, which is not the same question
   * as whether a user is selected.
   *
   * Guarding on `userId !== null` would be the obvious one-liner and is a trap:
   * this screen is read far more often than it is edited, so leaving a user on
   * screen would block the silent auto-update indefinitely on this route — the
   * failure mode already recorded against `useUnsavedGuard` elsewhere in the
   * app. Set it where an edit actually happens, clear it on both exits (picking
   * a different user, or a save that committed).
   */
  const [dirty, setDirty] = useState(false);

  useUnsavedGuard(dirty || isPending);

  const rightsByUser = useMemo(() => {
    const m = new Map<string, TaUserRight[]>();
    for (const r of allRights) {
      const list = m.get(r.user_id) ?? [];
      list.push(r);
      m.set(r.user_id, list);
    }
    return m;
  }, [allRights]);

  // Matrix rows: "All Activities" wildcard + each activity.
  const matrixRows = useMemo(
    () => [
      { key: ALL_KEY, label: "All Activities" },
      ...data.activities.map((a) => ({ key: a.id, label: `${a.short_name} — ${a.name}` })),
    ],
    [data.activities],
  );

  function permsForUser(id: string): Record<string, RowPerm> {
    const next: Record<string, RowPerm> = {};
    for (const r of rightsByUser.get(id) ?? []) {
      const key = r.activity_id ?? ALL_KEY;
      next[key] = {
        view: r.can_view,
        add: r.can_add,
        modify: r.can_modify,
        delete: r.can_delete,
      };
    }
    return next;
  }

  function selectUser(id: string | null) {
    setUserId(id);
    setPerms(id ? permsForUser(id) : {});
    setDirty(false);
  }

  useCreateIntent(() => selectUser(null));

  function getPerm(key: string): RowPerm {
    return perms[key] ?? emptyPerm();
  }

  function setAction(key: string, action: ActionKey, value: boolean) {
    setDirty(true);
    setPerms((prev) => ({ ...prev, [key]: { ...getPermFrom(prev, key), [action]: value } }));
  }

  function setAllForRow(key: string, value: boolean) {
    setDirty(true);
    setPerms((prev) => ({
      ...prev,
      [key]: { view: value, add: value, modify: value, delete: value },
    }));
  }

  function getPermFrom(state: Record<string, RowPerm>, key: string): RowPerm {
    return state[key] ?? emptyPerm();
  }

  function save() {
    if (!userId) return;
    const rows = matrixRows.map((mr) => {
      const p = getPerm(mr.key);
      return {
        activity_id: mr.key === ALL_KEY ? null : mr.key,
        can_view: p.view,
        can_add: p.add,
        can_modify: p.modify,
        can_delete: p.delete,
      };
    });
    start(async () => {
      const res = await setTaUserRights({ user_id: userId, rows });
      if (res.ok) {
        setDirty(false);
        success("Rights saved");
        router.refresh();
      } else {
        toastError(res.error);
      }
    });
  }

  const selectedUser = data.users.find((u) => u.id === userId) ?? null;

  /**
   * The matrix's columns, declared once — the table branch and the stacked-card
   * branch both read this, so a sixth action cannot leave the header and the
   * cells disagreeing.
   *
   * No column is `required`: a right left unticked is a right not granted, which
   * is a complete record. Marking one would hold the cursor on a box whose
   * empty state is the answer.
   */
  const rightsColumns: ChildGridColumn<{ key: string; label: string }>[] = [
    {
      header: "Activity",
      width: "16rem",
      cell: (mr) =>
        mr.key === ALL_KEY ? (
          <span className="text-sm font-medium">{mr.label}</span>
        ) : (
          <span className="text-sm">{mr.label}</span>
        ),
    },
    {
      header: "All",
      align: "center",
      width: "5rem",
      cell: (mr) => {
        const p = getPerm(mr.key);
        return (
          <input
            type="checkbox"
            aria-label="All"
            checked={p.view && p.add && p.modify && p.delete}
            disabled={!canEdit || isPending}
            onChange={(e) => setAllForRow(mr.key, e.target.checked)}
            className="h-4 w-4 cursor-pointer accent-primary disabled:cursor-not-allowed disabled:opacity-40"
          />
        );
      },
    },
    ...ACTIONS.map((action) => ({
      header: action.charAt(0).toUpperCase() + action.slice(1),
      align: "center" as const,
      width: "5rem",
      cell: (mr: { key: string; label: string }) => (
        <input
          type="checkbox"
          aria-label={action}
          checked={getPerm(mr.key)[action]}
          disabled={!canEdit || isPending}
          onChange={(e) => setAction(mr.key, action, e.target.checked)}
          className="h-4 w-4 cursor-pointer accent-primary disabled:cursor-not-allowed disabled:opacity-40"
        />
      ),
    })),
  ];

  const summaryColumns: Column<TaUserRightsSummaryRow>[] = [
    {
      header: "User",
      cell: (r) => (
        <button
          type="button"
          onClick={() => selectUser(r.user_id)}
          className="text-sm font-medium text-primary hover:underline"
        >
          {r.name}
        </button>
      ),
    },
    { header: "Code", cell: (r) => <span className="font-mono text-xs">{r.code ?? "—"}</span> },
    {
      header: "Rules",
      align: "right",
      cell: (r) => <span className="tabular-nums text-xs text-muted-foreground">{r.count}</span>,
    },
  ];

  return (
    // ONE MARKER, NEVER A HANDLER. `isEditorScope()` is false without it, so Tab
    // keeps native order and walks out of the form. The PageHeader inside is
    // stamped `data-focus-region="header"` by the component itself, so its
    // actions sort as chrome rather than with the fields.
    <div data-focus-scope className="space-y-4">
      <PageHeader
        title="TA User Rights"
        description="Grant per-user View / Add / Modify / Delete rights over Time & Action activities."
      />

      <Card>
        <CardBody>
          {/* On the field track like every other picker in the module, rather
              than a lone `sm:max-w-md` box — the same `<Field size>` +
              `compact` pairing, so this User sits at the same ~280px as the
              Sales Order on Pack Ratios and Price Confirmation. */}
          <FieldGrid>
            <Field label="User" required size="sm">
              <RecordPicker
                label="User"
                compact
                items={data.users}
                value={userId}
                onChange={selectUser}
              />
            </Field>
          </FieldGrid>
        </CardBody>
      </Card>

      {userId ? (
        <Card>
          <CardBody className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-foreground">
                Activity rights — {selectedUser?.name ?? "User"}
              </h3>
            </div>

            {/* THE MATRIX IS A CHILD GRID, and the argument is the keyboard one
                rather than the look. `gridKeyNav` finds rows by `data-grid-row`
                and cells by `ROW_FIELDS` — which counts a CHECKBOX as a column,
                deliberately, because excluding it once left every arrow key dead
                on a tick-box cell. A hand-rolled `<table>` carries neither
                marker, so ↑↓←→ did nothing across a grid whose every cell is a
                tick box, and the only way through five columns × N activities
                was Tab or the mouse.

                It also drops the `overflow-x-auto`: the rows fall to stacked
                cards at narrow widths instead of hiding four of the five columns
                behind a horizontal scrollbar.

                `hideAdd` + `lockExisting` are what make it a MATRIX rather than
                a list the operator can grow: the rows are the activity master,
                so there is nothing to add and nothing to remove, and both
                callbacks below are unreachable rather than merely unused. */}
            <ChildGrid
              columns={rightsColumns}
              rows={matrixRows}
              onAdd={() => false}
              onRemove={() => {}}
              hideAdd
              lockExisting
            />

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => selectUser(userId)} disabled={isPending}>
                Cancel
              </Button>
              <Button onClick={save} disabled={!canEdit || isPending}>
                {isPending ? "Saving…" : "Save"}
              </Button>
            </div>
          </CardBody>
        </Card>
      ) : (
        <div>
          <h3 className="mb-2 text-sm font-semibold text-foreground">Configured users</h3>
          <DataTable
            columns={withCreatedColumns(summaryColumns, summary)}
            rows={summary}
            getKey={(r) => r.user_id}
            empty="No user rights configured yet. Pick a user above to start."
          />
        </div>
      )}
    </div>
  );
}
