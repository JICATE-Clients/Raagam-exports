"use client";

import { SlidersHorizontal } from "lucide-react";
import { useMemo, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "@/components/ui/field";
import { Sheet } from "@/components/ui/sheet";
import { DataTable, type Column } from "@/components/ui/data-table";
import { RowActions } from "@/components/ui/row-actions";
import { rowActionsColumn } from "@/components/ui/row-actions-column";
import { Tooltip } from "@/components/ui/tooltip";
import { useToast } from "@/components/ui/toast";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { clearEntitlement, saveEntitlement } from "@/lib/hr/timeoff-actions";
import {
  fmtDays,
  personKey,
  type BalanceRow,
  type Entitlement,
  type LeaveType,
  type LeaveYear,
} from "@/lib/hr/timeoff-types";
import { cn } from "@/lib/utils";

/**
 * HR ▸ Time Off ▸ Leave Balances (0765, MyJKKN §9.9).
 *
 * One row per person, one column per tracked leave type, showing what is
 * AVAILABLE. Every figure is derived (timeoff_balance_sheet): entitlement from
 * the type or an override, accrual for monthly types, used = approved leave +
 * any opening figure, less pending and encashed. "Adjust" sets a person's
 * override, carried-forward days and the days already taken before this
 * system — each change logged with its reason.
 */

type Person = {
  key: string;
  kind: "staff" | "worker";
  name: string;
  code: string | null;
  cells: Map<string, BalanceRow>;
};

type Props = {
  years: LeaveYear[];
  yearId: string;
  sheet: BalanceRow[];
  types: LeaveType[];
  overrides: Entitlement[];
  canEdit: boolean;
};

type EditRow = { entitled: string; carried: string; opening: string };

export function BalancesScreen({ years, yearId, sheet, types, overrides, canEdit }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();

  const [search, setSearch] = useState("");
  const [kind, setKind] = useState<"" | "staff" | "worker">("");

  // Only tracked leave types that someone actually has a row for, in catalog order.
  const columnsTypes = useMemo(() => {
    const present = new Set(sheet.map((b) => b.leave_type_id));
    return types.filter((t) => present.has(t.id));
  }, [sheet, types]);

  const people = useMemo(() => {
    const m = new Map<string, Person>();
    for (const b of sheet) {
      const key = personKey(b.person_kind, (b.staff_id ?? b.worker_id) as string);
      let p = m.get(key);
      if (!p) {
        p = { key, kind: b.person_kind, name: b.person_name, code: b.person_code, cells: new Map() };
        m.set(key, p);
      }
      p.cells.set(b.leave_type_id, b);
    }
    return [...m.values()];
  }, [sheet]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return people.filter(
      (p) =>
        (!kind || p.kind === kind) &&
        (!q || p.name.toLowerCase().includes(q) || (p.code ?? "").toLowerCase().includes(q)),
    );
  }, [people, search, kind]);

  // ── adjust ──
  const [adjustFor, setAdjustFor] = useState<Person | null>(null);
  const [edits, setEdits] = useState<Record<string, EditRow>>({});
  const [reason, setReason] = useState("");
  const [dirty, setDirty] = useState(false);
  useUnsavedGuard((!!adjustFor && dirty) || isPending);

  const overrideOf = (p: Person, typeId: string) =>
    overrides.find(
      (o) => o.leave_type_id === typeId && (p.kind === "staff" ? o.staff_id : o.worker_id) === p.key.split(":")[1],
    );

  function openAdjust(p: Person) {
    const e: Record<string, EditRow> = {};
    for (const t of columnsTypes) {
      const o = overrideOf(p, t.id);
      e[t.id] = {
        entitled: o?.entitled_days == null ? "" : String(o.entitled_days),
        carried: o ? String(o.carried_forward) : "0",
        opening: o ? String(o.opening_used) : "0",
      };
    }
    setEdits(e);
    setReason("");
    setDirty(false);
    setAdjustFor(p);
  }

  function saveAll() {
    if (!adjustFor) return;
    const p = adjustFor;
    startTransition(async () => {
      for (const t of columnsTypes) {
        const e = edits[t.id];
        const o = overrideOf(p, t.id);
        const blank = e.entitled === "" && Number(e.carried || 0) === 0 && Number(e.opening || 0) === 0;
        const same =
          o &&
          (o.entitled_days == null ? "" : String(o.entitled_days)) === e.entitled &&
          o.carried_forward === Number(e.carried || 0) &&
          o.opening_used === Number(e.opening || 0);
        if (same || (!o && blank)) continue;
        const r =
          o && blank
            ? await clearEntitlement(o.id)
            : await saveEntitlement({
                year_id: yearId,
                leave_type_id: t.id,
                person: p.key,
                entitled_days: e.entitled === "" ? null : Number(e.entitled),
                carried_forward: Number(e.carried || 0),
                opening_used: Number(e.opening || 0),
                reason,
              });
        if (!r.ok) {
          toastError(`${t.name}: ${r.error}`);
          router.refresh();
          return;
        }
      }
      success("Balances saved");
      setDirty(false);
      setAdjustFor(null);
      router.refresh();
    });
  }

  const columns: Column<Person>[] = [
    {
      header: "Person",
      cell: (p) => (
        <span className="text-sm">
          <span className="font-medium">{p.name}</span>
          <span className="ml-2 text-xs text-muted-foreground">{p.kind === "worker" ? "Worker" : "Staff"}</span>
        </span>
      ),
    },
    ...columnsTypes.map(
      (t): Column<Person> => ({
        header: t.code,
        align: "right",
        cell: (p) => {
          const b = p.cells.get(t.id);
          if (!b) return <span className="text-muted-foreground">—</span>;
          return (
            <Tooltip
              label={`${t.name}: entitled ${fmtDays(b.accrued)}${b.carried ? ` + ${fmtDays(b.carried)} carried` : ""}, used ${fmtDays(b.used)}, pending ${fmtDays(b.pending)}${b.encashed ? `, encashed ${fmtDays(b.encashed)}` : ""}`}
            >
              <span
                tabIndex={0}
                className={cn(
                  "text-sm font-medium tabular-nums",
                  b.available <= 0 ? "text-danger" : b.available < 2 ? "text-warning" : "",
                  b.has_override && "underline decoration-dotted underline-offset-4",
                )}
              >
                {fmtDays(b.available)}
                <span className="font-normal text-muted-foreground"> / {fmtDays(b.accrued + b.carried)}</span>
              </span>
            </Tooltip>
          );
        },
      }),
    ),
  ];
  const actions = rowActionsColumn<Person>((p) => (
    <RowActions
      label={p.name}
      view={false}
      menu={canEdit ? [{ label: "Adjust balance", icon: SlidersHorizontal, onClick: () => openAdjust(p) }] : []}
    />
  ));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select
          aria-label="Leave year"
          className="h-9 w-36"
          value={yearId}
          onChange={(e) => router.push(`${pathname}?year=${e.target.value}`)}
        >
          {years.map((y) => (
            <option key={y.id} value={y.id}>
              {y.name}
            </option>
          ))}
        </Select>
        {people.length > 1 && (
          <>
            {/* caps-input: exempt -- a search box, not a stored value */}
            <Input
              type="search"
              aria-label="Search people"
              placeholder="Search name or code"
              className="h-9 w-60"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <Select aria-label="Kind" className="h-9 w-32" value={kind} onChange={(e) => setKind(e.target.value as "" | "staff" | "worker")}>
              <option value="">Everyone</option>
              <option value="staff">Staff</option>
              <option value="worker">Workers</option>
            </Select>
          </>
        )}
        <span className="text-xs text-muted-foreground">Available / entitled. Hover a figure for the breakdown.</span>
      </div>

      <DataTable
        columns={[...columns, actions]}
        rows={visible}
        getKey={(p) => p.key}
        empty="No balances — add leave types that track a balance on Leave Setup."
      />

      <Sheet
        open={!!adjustFor}
        onClose={() => setAdjustFor(null)}
        title={adjustFor ? `Adjust balance — ${adjustFor.name}` : "Adjust balance"}
        size="md"
        footer={
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground">
              {reason.trim() ? "Every change is logged with this reason." : "The reason is mandatory."}
            </span>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setAdjustFor(null)}>
                Cancel
              </Button>
              <Button disabled={isPending || !reason.trim() || !dirty} onClick={saveAll}>
                {isPending ? "Saving…" : "Save"}
              </Button>
            </div>
          </div>
        }
      >
        {adjustFor && (
          <div className="max-w-[44rem] space-y-4 text-sm">
            <table className="w-full">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="pb-2 font-medium">Leave type</th>
                  <th className="pb-2 font-medium">Entitled (blank = default)</th>
                  <th className="pb-2 font-medium">Carried forward</th>
                  <th className="pb-2 font-medium">Already taken before</th>
                </tr>
              </thead>
              <tbody>
                {columnsTypes.map((t) => {
                  const e = edits[t.id];
                  if (!e) return null;
                  const put = (k: keyof EditRow, v: string) => {
                    setEdits((all) => ({ ...all, [t.id]: { ...all[t.id], [k]: v } }));
                    setDirty(true);
                  };
                  return (
                    <tr key={t.id}>
                      <td className="py-1 pr-3">{t.name}</td>
                      <td className="py-1 pr-3">
                        <Input
                          type="number"
                          min="0"
                          step="0.5"
                          aria-label={`${t.name} entitled`}
                          placeholder={fmtDays(t.default_entitled_days)}
                          className="w-28"
                          value={e.entitled}
                          onChange={(ev) => put("entitled", ev.target.value)}
                        />
                      </td>
                      <td className="py-1 pr-3">
                        <Input
                          type="number"
                          min="0"
                          step="0.5"
                          aria-label={`${t.name} carried forward`}
                          className="w-28"
                          value={e.carried}
                          onChange={(ev) => put("carried", ev.target.value)}
                        />
                      </td>
                      <td className="py-1">
                        <Input
                          type="number"
                          min="0"
                          step="0.5"
                          aria-label={`${t.name} already taken`}
                          className="w-28"
                          value={e.opening}
                          onChange={(ev) => put("opening", ev.target.value)}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <Field label="Reason" required>
              <Textarea
                rows={2}
                value={reason}
                onChange={(e) => {
                  setReason(e.target.value);
                  setDirty(true);
                }}
              />
            </Field>
          </div>
        )}
      </Sheet>
    </div>
  );
}
