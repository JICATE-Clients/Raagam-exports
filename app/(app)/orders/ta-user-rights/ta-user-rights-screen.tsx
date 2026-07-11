"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { DataTable, type Column } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { useToast } from "@/components/ui/toast";
import { useCreateIntent } from "@/lib/use-create-intent";
import { RecordPicker } from "@/components/masters/record-picker";
import { setTaUserRights } from "@/lib/orders/ta-user-rights/actions";
import type {
  TaUserRightsFormData,
  TaUserRightsSummaryRow,
} from "@/lib/orders/ta-user-rights/service";
import type { TaUserRight } from "@/lib/orders/ta-user-rights/types";

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
  }

  useCreateIntent(() => selectUser(null));

  function getPerm(key: string): RowPerm {
    return perms[key] ?? emptyPerm();
  }

  function setAction(key: string, action: ActionKey, value: boolean) {
    setPerms((prev) => ({ ...prev, [key]: { ...getPermFrom(prev, key), [action]: value } }));
  }

  function setAllForRow(key: string, value: boolean) {
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
        success("Rights saved");
        router.refresh();
      } else {
        toastError(res.error);
      }
    });
  }

  const selectedUser = data.users.find((u) => u.id === userId) ?? null;

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
    <div className="space-y-4">
      <PageHeader
        title="TA User Rights"
        description="Grant per-user View / Add / Modify / Delete rights over Time & Action activities."
      />

      <Card>
        <CardBody className="grid grid-cols-1 gap-4 sm:max-w-md">
          <RecordPicker
            label="User"
            items={data.users}
            value={userId}
            onChange={selectUser}
            required
          />
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

            <div className="overflow-x-auto rounded-lg border border-border bg-surface">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-surface-muted">
                    <th className="min-w-[220px] px-3 py-2 text-left text-xs font-semibold text-muted-foreground">
                      Activity
                    </th>
                    {(["All", ...ACTIONS] as const).map((c) => (
                      <th
                        key={c}
                        className="px-3 py-2 text-center text-xs font-semibold capitalize text-muted-foreground"
                      >
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {matrixRows.map((mr) => {
                    const p = getPerm(mr.key);
                    const all = p.view && p.add && p.modify && p.delete;
                    return (
                      <tr
                        key={mr.key}
                        className="border-b border-border last:border-0 hover:bg-surface-muted/60"
                      >
                        <td className="px-3 py-2 text-sm text-foreground">
                          {mr.key === ALL_KEY ? (
                            <span className="font-medium">{mr.label}</span>
                          ) : (
                            mr.label
                          )}
                        </td>
                        <td className="px-3 py-2 text-center">
                          <input
                            type="checkbox"
                            aria-label="All"
                            checked={all}
                            disabled={!canEdit || isPending}
                            onChange={(e) => setAllForRow(mr.key, e.target.checked)}
                            className="h-4 w-4 cursor-pointer accent-primary disabled:cursor-not-allowed disabled:opacity-40"
                          />
                        </td>
                        {ACTIONS.map((action) => (
                          <td key={action} className="px-3 py-2 text-center">
                            <input
                              type="checkbox"
                              aria-label={action}
                              checked={p[action]}
                              disabled={!canEdit || isPending}
                              onChange={(e) => setAction(mr.key, action, e.target.checked)}
                              className="h-4 w-4 cursor-pointer accent-primary disabled:cursor-not-allowed disabled:opacity-40"
                            />
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

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
            columns={summaryColumns}
            rows={summary}
            getKey={(r) => r.user_id}
            empty="No user rights configured yet. Pick a user above to start."
          />
        </div>
      )}
    </div>
  );
}
