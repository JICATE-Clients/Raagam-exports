"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { type Column } from "@/components/ui/data-table";
import { Field, FieldRow, FIELD_WIDTH_CSS } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Sheet } from "@/components/ui/sheet";
import { StatusPill } from "@/components/ui/status-pill";
import { Toggle } from "@/components/ui/toggle";
import { ActiveField } from "@/components/ui/active-field";
import { DuplicateError } from "@/components/ui/duplicate-error";
import { useToast } from "@/components/ui/toast";
import { ChildGrid, type ChildGridColumn } from "@/components/masters/child-grid";
import { MasterListShell } from "@/components/masters/master-list-shell";
import { useDuplicateName, dupFieldProps } from "@/lib/masters/use-duplicate-check";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { activeTone } from "@/lib/ui/status-tone";
import { saveTeam } from "@/lib/resolve/actions";
import type { TeamRow } from "@/lib/resolve/service";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean };
type Option = { id: string; name: string; inactive?: boolean };
type MemberRow = { key: string; profile_id: string; active: boolean };

let seq = 0;
/** A blank member line — every key empty or false, so an untouched one is
 *  dropped on save rather than inserted (AGENTS "Editable sub-tables"). */
const blankMember = (): MemberRow => ({ key: `m${++seq}`, profile_id: "", active: true });

const blankForm = () => ({ trade_id: "", name: "", lead_id: "", inactive: false });
type Form = ReturnType<typeof blankForm>;

/**
 * Resolve Hub ▸ Administration ▸ Teams — one trade's people at this unit. The
 * team's LEAD is routing rule 3's first choice (then the first active member),
 * and a member must be active on a team here to be assigned or to claim.
 *
 * Switching a member off keeps the line (and their history) but takes them out
 * of routing and To claim; removing the line takes them off the team.
 */
export function TeamsScreen({
  rows,
  perms,
  people,
  trades,
}: {
  rows: TeamRow[];
  perms: Perms;
  people: Option[];
  trades: Option[];
}) {
  const router = useRouter();
  const { success, error } = useToast();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<Form>(blankForm);
  const [members, setMembers] = useState<MemberRow[]>(() => [blankMember()]);
  const [dirty, setDirty] = useState(false);
  useUnsavedGuard(open && (dirty || isPending));

  const set = (patch: Partial<Form>) => {
    setForm((f) => ({ ...f, ...patch }));
    setDirty(true);
  };
  const setMember = (key: string, patch: Partial<MemberRow>) => {
    setMembers((ms) => ms.map((m) => (m.key === key ? { ...m, ...patch } : m)));
    setDirty(true);
  };

  const dupError = useDuplicateName({
    table: "rh_teams",
    name: form.name,
    label: "name",
    excludeId: editId ?? undefined,
    enabled: open && !!form.name.trim(),
    rows,
    rowId: (r) => r.id,
    rowValue: (r) => r.name,
  });

  const nameOf = useMemo(() => new Map(people.map((p) => [p.id, p.name])), [people]);
  const tradeOptions = useMemo(
    () => trades.filter((t) => !t.inactive || t.id === form.trade_id).map((t) => ({ value: t.id, label: t.name })),
    [trades, form.trade_id],
  );
  const personOptions = useMemo(() => people.map((p) => ({ value: p.id, label: p.name })), [people]);

  function openAdd() {
    setEditId(null);
    setForm(blankForm());
    setMembers([blankMember()]);
    setDirty(false);
    setOpen(true);
  }
  function openEdit(r: TeamRow) {
    setEditId(r.id);
    setForm({ trade_id: r.trade_id, name: r.name, lead_id: r.lead_id ?? "", inactive: r.inactive });
    const held = r.members.map((m) => ({ key: m.id, profile_id: m.profile_id, active: m.active }));
    setMembers(held.length ? held : [blankMember()]);
    setDirty(false);
    setOpen(true);
  }

  const kept = members.filter((m) => m.profile_id);
  const twice = kept.length !== new Set(kept.map((m) => m.profile_id)).size;
  const canSave = !!form.trade_id && !!form.name.trim() && !dupError && !twice && !isPending;

  function submit() {
    startTransition(async () => {
      const res = await saveTeam({
        id: editId ?? undefined,
        trade_id: form.trade_id,
        name: form.name,
        lead_id: form.lead_id || null,
        inactive: form.inactive,
        members: kept.map((m) => ({ profile_id: m.profile_id, active: m.active })),
      });
      if (res.ok) {
        success(editId ? "Team updated." : "Team added.");
        setOpen(false);
        router.refresh();
      } else error(res.error);
    });
  }

  function toggleInactive(r: TeamRow) {
    startTransition(async () => {
      const res = await saveTeam({
        id: r.id,
        trade_id: r.trade_id,
        name: r.name,
        lead_id: r.lead_id,
        inactive: true,
        members: r.members.map((m) => ({ profile_id: m.profile_id, active: m.active })),
      });
      if (res.ok) {
        success(`${r.name} switched off.`);
        router.refresh();
      } else error(res.error);
    });
  }

  // Active first (AGENTS "Active leads the form" — a grid whose rows switch off
  // shows the switch as its FIRST column). 88 + 288 + 72 chrome = 448px.
  const memberColumns: ChildGridColumn<MemberRow>[] = [
    {
      header: "Active",
      width: FIELD_WIDTH_CSS.hug,
      cell: (m) => (
        <Toggle checked={m.active} onChange={(on) => setMember(m.key, { active: on })} tone="success" ariaLabel="Active on this team" />
      ),
    },
    {
      header: "Person",
      width: FIELD_WIDTH_CSS.name,
      cell: (m) => (
        <Combobox
          options={personOptions.filter(
            (o) => o.value === m.profile_id || !members.some((x) => x.key !== m.key && x.profile_id === o.value),
          )}
          value={m.profile_id}
          onChange={(v) => setMember(m.key, { profile_id: v })}
        />
      ),
    },
  ];

  const teamColumns: Column<TeamRow>[] = [
    { header: "Team", cell: (r) => <span className="text-sm font-semibold">{r.name}</span> },
    { header: "Trade", cell: (r) => <span className="text-sm">{r.trade_name ?? "—"}</span> },
    { header: "Lead", cell: (r) => <span className="text-sm">{r.lead_name ?? "—"}</span> },
    {
      header: "Members",
      align: "right",
      cell: (r) => <span className="tabular-nums text-sm">{r.members.filter((m) => m.active).length}</span>,
    },
    {
      header: "Status",
      cell: (r) => <StatusPill tone={activeTone(!r.inactive)}>{r.inactive ? "Inactive" : "Active"}</StatusPill>,
    },
  ];

  return (
    <div className="space-y-4">
      <MasterListShell
        rows={rows}
        getKey={(r) => r.id}
        perms={perms}
        searchText={(r) => [r.name, r.trade_name, r.lead_name, ...r.members.map((m) => m.name)].filter(Boolean).join(" ")}
        searchPlaceholder="Search team, trade, lead or member…"
        statusOf={(r) => (r.inactive ? "inactive" : "active")}
        addLabel="+ Add Team"
        onAdd={perms.canCreate ? openAdd : undefined}
        columns={teamColumns}
        actions={{
          onEdit: openEdit,
          onDelete: toggleInactive,
          menuAs: "icons",
          deleteDisabledReason: (r) => (r.inactive ? "Already switched off" : null),
        }}
        rowLabel={(r) => r.name}
        empty="No teams in this unit yet."
        mobile={{
          title: (r) => r.name,
          meta: (r) => [r.trade_name, r.lead_name ? `Lead ${r.lead_name}` : null].filter(Boolean).join(" · "),
          pill: (r) => <StatusPill tone={activeTone(!r.inactive)}>{r.inactive ? "Inactive" : "Active"}</StatusPill>,
          onEdit: openEdit,
          onDelete: toggleInactive,
        }}
        isPending={isPending}
      />

      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        size="md"
        title={editId ? `Edit ${form.name || "Team"}` : "New Team"}
        footer={
          <>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button disabled={!canSave} onClick={submit}>
              {isPending ? "Saving…" : "Save team"}
            </Button>
          </>
        }
      >
        {/* Header row: 88 status + 176 trade + 288 name + 200 lead + 3 × 12px gap
            = 788px → 50rem. The members grid sits OUTSIDE that cap: `tableFrom="5xl"`
            measures the grid's own container, and a 50rem box would fold it to cards. */}
        <div className="space-y-4">
          <FieldRow className="max-w-[50rem]">
            <ActiveField id="rh-team-active" active={!form.inactive} onChange={(on) => set({ inactive: !on })} isNew={!editId} />
            <Field label="Trade" required w="term" htmlFor="rh-team-trade">
              <Combobox id="rh-team-trade" options={tradeOptions} value={form.trade_id} onChange={(v) => set({ trade_id: v })} />
            </Field>
            <Field label="Team Name" required w="name" htmlFor="rh-team-name">
              <Input
                id="rh-team-name"
                value={form.name}
                onChange={(e) => set({ name: e.target.value })}
                {...dupFieldProps(dupError, "rh-team-name")}
              />
              <DuplicateError error={dupError} id="rh-team-name" />
            </Field>
            <Field label="Lead" w="party" htmlFor="rh-team-lead">
              <Combobox
                id="rh-team-lead"
                options={personOptions}
                value={form.lead_id}
                onChange={(v) => set({ lead_id: v })}
                clearable
              />
            </Field>
          </FieldRow>
          <div className="space-y-1">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Members</h3>
            <ChildGrid<MemberRow>
              rows={members}
              columns={memberColumns}
              tableFrom="5xl"
              addLabel="+ Add member"
              onAdd={() => {
                setMembers((ms) => [...ms, blankMember()]);
                setDirty(true);
              }}
              onRemove={(m) => {
                setMembers((ms) => ms.filter((x) => x.key !== m.key));
                setDirty(true);
              }}
            />
            {twice && <p className="text-xs text-danger">A person is listed twice.</p>}
            {form.lead_id && !kept.some((m) => m.profile_id === form.lead_id) && (
              <p className="text-xs text-muted-foreground">
                {nameOf.get(form.lead_id) ?? "The lead"} leads this team without being one of its members.
              </p>
            )}
          </div>
        </div>
      </Sheet>
    </div>
  );
}
