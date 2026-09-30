"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Ban, History, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Field, FieldRow } from "@/components/ui/field";
import { Sheet } from "@/components/ui/sheet";
import { DetailSection } from "@/components/masters/detail-section";
import { MasterListShell, type ShellExtraFilter } from "@/components/masters/master-list-shell";
import { DataTable, type Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import { Truncated } from "@/components/ui/truncated";
import { withCreatedColumns } from "@/components/ui/created-columns";
import { useToast } from "@/components/ui/toast";
import { fmtDateTime } from "@/lib/format";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { grantOverride, loadGrantHistory, revokeOverride } from "@/lib/orders/overrides/actions";
import {
  GRANT_STATUS_LABEL,
  GRANT_STATUS_TONE,
  OVERRIDE_GROUPS,
  OVERRIDE_KEYS,
  OVERRIDE_MAX_DAYS,
  OVERRIDE_QUICK_DAYS,
  expiryProblem,
  overrideKeyLabel,
  reasonProblem,
  type OverrideGrantStatus,
  type OverrideKey,
} from "@/lib/orders/overrides/override-modules";
import type { OverrideGrant, OverrideGrantee, OverrideGrantHistoryRow } from "@/lib/orders/overrides/types";

/**
 * Admin ▸ Access Control ▸ Permission Overrides (doc/email role system.md §7.1).
 *
 * A register of grants — who may edit which module of an APPROVED order, until
 * when, and why — with three doors: Grant (the + button), Renew and Revoke (row
 * icons). Every door is an RPC that carries its own rules and writes the grant
 * history in the same transaction (0651); this screen answers the same rules
 * sooner, under the field they are about.
 *
 * NO DELETE, ANYWHERE. A grant is revoked, never removed (R-12): the history of
 * who could edit what, and when, is the point of the register. So the row has
 * no bin and the shell is told `canDelete: false`.
 */

type Props = {
  grants: OverrideGrant[];
  grantees: OverrideGrantee[];
  canManage: boolean;
  /**
   * ONE PERSON'S corrections — the Access Control screen's By User tab
   * (user 2026-09-30: the three access pages merged). Only that email's grants
   * are listed and a new grant is for that email; everything else — the rules,
   * the RPCs, the history — is this same screen.
   */
  forEmail?: string;
};

type GrantForm = {
  email: string;
  keys: OverrideKey[];
  /** `<input type="datetime-local">` value — the operator's LOCAL time (IST);
   *  converted to UTC only at submit (spec §7.1: "Show IST; send UTC"). */
  expiry: string;
  reason: string;
};

type GrantField = "email" | "keys" | "expiry" | "reason";

const BLANK: GrantForm = { email: "", keys: [], expiry: "", reason: "" };

/** A Date as a datetime-local value in the browser's own zone. */
function toLocalInput(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

const STATUS_FILTER: ShellExtraFilter<OverrideGrant> = {
  key: "status",
  label: "Status",
  options: (Object.keys(GRANT_STATUS_LABEL) as OverrideGrantStatus[]).map((s) => ({
    value: s,
    label: GRANT_STATUS_LABEL[s],
  })),
  predicate: (r, v) => r.status === v,
};

const MODULE_FILTER: ShellExtraFilter<OverrideGrant> = {
  key: "module",
  label: "Module",
  options: OVERRIDE_KEYS.map((k) => ({ value: k, label: overrideKeyLabel(k) })),
  predicate: (r, v) => r.module_key === v,
};

export function PermissionOverridesScreen({ grants: allGrants, grantees, canManage, forEmail }: Props) {
  const grants = forEmail ? allGrants.filter((g) => g.user_email === forEmail) : allGrants;
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, start] = useTransition();

  // ── Grant / Renew sheet ────────────────────────────────────────────────────
  const [grantOpen, setGrantOpen] = useState(false);
  /** Renew fixes the user — it re-grants THAT person, it does not re-pick one. */
  const [renewing, setRenewing] = useState(false);
  const [form, setForm] = useState<GrantForm>(BLANK);
  const [errors, setErrors] = useState<Partial<Record<GrantField, string>>>({});
  const [dept, setDept] = useState("");
  const [desig, setDesig] = useState("");

  // ── Revoke sheet ───────────────────────────────────────────────────────────
  const [revoking, setRevoking] = useState<OverrideGrant | null>(null);
  const [revokeReason, setRevokeReason] = useState("");
  const [revokeError, setRevokeError] = useState<string | null>(null);

  // ── History sheet ──────────────────────────────────────────────────────────
  const [historyFor, setHistoryFor] = useState<OverrideGrant | null>(null);
  const [history, setHistory] = useState<OverrideGrantHistoryRow[] | null>(null);

  /* The Staff Master's department / designation, where a login links one
     (findings C-8). OPTIONAL filters, not the spec's mandatory ones: most
     logins carry no employee link yet, and a mandatory filter would hide them. */
  const departments = useMemo(
    () => [...new Set(grantees.map((g) => g.department).filter((d): d is string => !!d))].sort(),
    [grantees],
  );
  const designations = useMemo(
    () => [...new Set(grantees.map((g) => g.designation).filter((d): d is string => !!d))].sort(),
    [grantees],
  );
  /* AGENTS.md "Auto-reload guard": a silent deploy reload must not eat a
     half-typed grant or revoke. Keyed on what the operator actually entered —
     an open sheet with nothing typed in is not unsaved work. */
  useUnsavedGuard(
    isPending ||
      (grantOpen && (!!form.reason.trim() || (!renewing && (!!form.email || form.keys.length > 0)))) ||
      (!!revoking && !!revokeReason.trim()),
  );

  const pickable = grantees.filter(
    (g) => (!dept || g.department === dept) && (!desig || g.designation === desig),
  );

  const columns: Column<OverrideGrant>[] = [
    { header: "User", cell: (r) => <span className="text-sm">{r.user_email}</span> },
    { header: "Module", cell: (r) => <span className="text-sm">{overrideKeyLabel(r.module_key)}</span> },
    {
      header: "Status",
      cell: (r) => <StatusPill tone={GRANT_STATUS_TONE[r.status]}>{GRANT_STATUS_LABEL[r.status]}</StatusPill>,
    },
    { header: "Expires", cell: (r) => <span className="text-sm tabular-nums">{fmtDateTime(r.override_expiry)}</span> },
    { header: "Granted By", cell: (r) => <span className="text-sm">{r.granted_by_name ?? "—"}</span> },
    {
      header: "Reason",
      cell: (r) => (
        <Truncated text={r.revoked_at ? `${r.reason} · REVOKED: ${r.revoke_reason ?? ""}` : r.reason} className="max-w-[18rem] text-sm" />
      ),
    },
  ];

  const historyColumns: Column<OverrideGrantHistoryRow>[] = [
    { header: "When", cell: (h) => <span className="text-sm tabular-nums">{fmtDateTime(h.action_timestamp)}</span> },
    {
      header: "Action",
      cell: (h) => (
        <StatusPill tone={h.action === "REVOKE" ? "danger" : h.action === "RENEW" ? "info" : "success"}>
          {h.action === "GRANT" ? "Granted" : h.action === "RENEW" ? "Renewed" : "Revoked"}
        </StatusPill>
      ),
    },
    { header: "Expiry", cell: (h) => <span className="text-sm tabular-nums">{fmtDateTime(h.override_expiry)}</span> },
    { header: "By", cell: (h) => <span className="text-sm">{h.actor_name ?? h.actor_email ?? "—"}</span> },
    { header: "Reason", cell: (h) => <Truncated text={h.reason} className="max-w-[14rem] text-sm" /> },
  ];

  // ── Doors ──────────────────────────────────────────────────────────────────

  function openGrant() {
    setRenewing(false);
    setForm({ ...BLANK, email: forEmail ?? "", expiry: toLocalInput(new Date(Date.now() + 7 * 86_400_000)) });
    setErrors({});
    setDept("");
    setDesig("");
    setGrantOpen(true);
  }

  /** Renew = grant again, same user, this module pre-ticked (R-13: the same
   *  row is updated, its revoke cleared, one RENEW history row). */
  function openRenew(r: OverrideGrant) {
    setRenewing(true);
    setForm({
      email: r.user_email,
      keys: [r.module_key as OverrideKey],
      expiry: toLocalInput(new Date(Date.now() + 7 * 86_400_000)),
      reason: "",
    });
    setErrors({});
    setGrantOpen(true);
  }

  function quickExpiry(days: number) {
    setForm((f) => ({ ...f, expiry: toLocalInput(new Date(Date.now() + days * 86_400_000)) }));
    setErrors((e) => ({ ...e, expiry: undefined }));
  }

  function toggleKey(k: OverrideKey, on: boolean) {
    setForm((f) => ({ ...f, keys: on ? [...f.keys, k] : f.keys.filter((x) => x !== k) }));
    setErrors((e) => ({ ...e, keys: undefined }));
  }

  function submitGrant() {
    /* Judged at the click, not in render: the expiry rule reads the clock. */
    const expiry = new Date(form.expiry);
    const next: Partial<Record<GrantField, string>> = {
      email: form.email ? undefined : "Choose the user to grant access to.",
      keys: form.keys.length ? undefined : "Choose at least one module.",
      expiry: form.expiry ? expiryProblem(expiry, new Date()) ?? undefined : "Choose when the access expires.",
      reason: reasonProblem(form.reason) ?? undefined,
    };
    setErrors(next);
    if (Object.values(next).some(Boolean)) return;
    start(async () => {
      const res = await grantOverride({
        email: form.email,
        keys: form.keys,
        expiresAt: expiry.toISOString(),
        reason: form.reason,
      });
      if (res.ok) {
        success(renewing ? "Access renewed" : `Access granted for ${res.granted} module${res.granted === 1 ? "" : "s"}`);
        setGrantOpen(false);
        router.refresh();
      } else {
        toastError(res.error);
      }
    });
  }

  function openRevoke(r: OverrideGrant) {
    setRevoking(r);
    setRevokeReason("");
    setRevokeError(null);
  }

  function submitRevoke() {
    if (!revoking) return;
    const problem = reasonProblem(revokeReason);
    setRevokeError(problem);
    if (problem) return;
    const id = revoking.id;
    start(async () => {
      const res = await revokeOverride({ id, reason: revokeReason });
      if (res.ok) {
        success("Access revoked");
        setRevoking(null);
        router.refresh();
      } else {
        toastError(res.error);
      }
    });
  }

  function openHistory(r: OverrideGrant) {
    setHistoryFor(r);
    setHistory(null);
    start(async () => {
      const res = await loadGrantHistory(r.id);
      if (res.ok) setHistory(res.rows);
      else {
        toastError(res.error);
        setHistoryFor(null);
      }
    });
  }

  const moduleChoice = (k: OverrideKey) => (
    <label key={k} className="flex min-h-9 w-fit cursor-pointer items-center gap-2">
      <input
        type="checkbox"
        className="h-4 w-4 cursor-pointer accent-primary"
        checked={form.keys.includes(k)}
        onChange={(e) => toggleKey(k, e.target.checked)}
      />
      <span className="text-sm text-foreground">{overrideKeyLabel(k)}</span>
    </label>
  );
  const orderEntry = OVERRIDE_GROUPS.find((g) => g.module === "order_entry");
  const otherModules = OVERRIDE_GROUPS.filter((g) => g.module !== "order_entry").flatMap((g) => g.keys);

  return (
    <>
      <MasterListShell<OverrideGrant>
        rows={grants}
        getKey={(r) => r.id}
        /* Renew and Revoke ride `menu` (inline icons), so Edit and Delete are
           off: there is no record to edit — a grant is re-granted — and none
           to delete (R-12). */
        perms={{ canCreate: canManage, canEdit: false, canDelete: false }}
        searchText={(r) => `${r.user_email} ${overrideKeyLabel(r.module_key)} ${r.reason}`}
        extraFilters={[STATUS_FILTER, MODULE_FILTER]}
        columns={columns}
        addLabel="+ Grant Access"
        onAdd={canManage ? openGrant : undefined}
        view={false}
        actions={{
          menuAs: "icons",
          menu: (r) => [
            ...(canManage
              ? [
                  { label: "Renew", icon: RefreshCw, onClick: () => openRenew(r) },
                  {
                    label: "Revoke",
                    icon: Ban,
                    danger: true,
                    disabled: !!r.revoked_at,
                    onClick: () => openRevoke(r),
                  },
                ]
              : []),
            { label: "History", icon: History, onClick: () => openHistory(r) },
          ],
        }}
        rowLabel={(r) => `${r.user_email} ${overrideKeyLabel(r.module_key)}`}
        mobile={{
          title: (r) => r.user_email,
          subtitle: (r) => overrideKeyLabel(r.module_key),
          pill: (r) => <StatusPill tone={GRANT_STATUS_TONE[r.status]}>{GRANT_STATUS_LABEL[r.status]}</StatusPill>,
          meta: (r) => `Expires ${fmtDateTime(r.override_expiry)}`,
        }}
        isPending={isPending}
      />

      {/* ── Grant / Renew ─────────────────────────────────────────────────── */}
      <Sheet
        open={grantOpen}
        onClose={() => setGrantOpen(false)}
        size="md"
        title={renewing ? "Renew Override Access" : "Grant Override Access"}
        footer={
          <>
            <Button variant="outline" size="md" onClick={() => setGrantOpen(false)}>
              Cancel
            </Button>
            <Button size="md" disabled={isPending} onClick={submitGrant}>
              {isPending ? "Saving…" : renewing ? "Renew access" : "Grant access"}
            </Button>
          </>
        }
      >
        {/* Cap: the Order Entry row is the widest thing here — five checkbox
            labels (~150px each) + 4 × 12px gaps ≈ 800px, + 2 × 10px section
            padding = 820px → 52rem (832px). Every other row is narrower:
            User name 288 + Expires party 200 + Quick name 288 + 2 × 12 = 800px. */}
        <DetailSection label="Who" cols={1} className="max-w-[52rem]">
          {!renewing && !forEmail && (departments.length > 0 || designations.length > 0) && (
            <FieldRow>
              <Field label="Department" w="party" htmlFor="po-dept">
                <Select id="po-dept" value={dept} onChange={(e) => setDept(e.target.value)}>
                  <option value="">All</option>
                  {departments.map((d) => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Designation" w="party" htmlFor="po-desig">
                <Select id="po-desig" value={desig} onChange={(e) => setDesig(e.target.value)}>
                  <option value="">All</option>
                  {designations.map((d) => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </Select>
              </Field>
            </FieldRow>
          )}
          <FieldRow align="start">
            <Field label="User" required w="name" htmlFor="po-user" error={errors.email}>
              {renewing || forEmail ? (
                <Input id="po-user" readOnly value={form.email} />
              ) : (
                <Select
                  id="po-user"
                  value={form.email}
                  onChange={(e) => {
                    setForm((f) => ({ ...f, email: e.target.value }));
                    setErrors((x) => ({ ...x, email: undefined }));
                  }}
                >
                  <option value=""></option>
                  {pickable.map((g) => (
                    /* C-4: a login that cannot edit orders is SHOWN, disabled,
                       with the reason — an override only lifts the approval
                       lock, it cannot stand in for the role. */
                    <option key={g.user_id} value={g.email} disabled={!g.can_edit_orders}>
                      {[g.full_name ?? g.email, g.full_name ? g.email : null, g.designation]
                        .filter(Boolean)
                        .join(" · ")}
                      {g.can_edit_orders ? "" : " (cannot edit orders)"}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field
              label="Expires"
              required
              w="party"
              htmlFor="po-expiry"
              error={errors.expiry}
              hint={`IST · at most ${OVERRIDE_MAX_DAYS} days`}
            >
              <Input
                id="po-expiry"
                type="datetime-local"
                value={form.expiry}
                onChange={(e) => {
                  setForm((f) => ({ ...f, expiry: e.target.value }));
                  setErrors((x) => ({ ...x, expiry: undefined }));
                }}
              />
            </Field>
            {/* `name` (288px), not `term`: three "N days" buttons are ~230px
                with their gaps, and at 176px the third was clipped behind a
                scrollbar (seen in the browser, 2026-09-30). */}
            <Field label="Quick" w="name">
              <FieldRow nowrap gap="pack">
                {OVERRIDE_QUICK_DAYS.map((d) => (
                  <Button key={d} type="button" variant="outline" size="sm" onClick={() => quickExpiry(d)}>
                    {d} {d === 1 ? "day" : "days"}
                  </Button>
                ))}
              </FieldRow>
            </Field>
          </FieldRow>
        </DetailSection>

        <DetailSection label="Modules" cols={1} className="max-w-[52rem]">
          {/* Worded and ordered exactly as Raise Revision (spec §7.1): Order
              Entry with its five kinds, then the three modules. What each opens
              is that kind's revision seed and nothing wider (R-17). */}
          <Field label={orderEntry?.label ?? "Order Entry"} error={errors.keys}>
            <FieldRow>{(orderEntry?.keys ?? []).map(moduleChoice)}</FieldRow>
          </Field>
          <Field label="Other Modules">
            <FieldRow>{otherModules.map(moduleChoice)}</FieldRow>
          </Field>
        </DetailSection>

        <DetailSection label="Why" cols={1} className="max-w-[52rem]">
          <Field label="Reason" required htmlFor="po-reason" error={errors.reason}>
            <Textarea
              id="po-reason"
              rows={3}
              value={form.reason}
              onChange={(e) => {
                setForm((f) => ({ ...f, reason: e.target.value }));
                setErrors((x) => ({ ...x, reason: undefined }));
              }}
            />
          </Field>
        </DetailSection>
      </Sheet>

      {/* ── Revoke ────────────────────────────────────────────────────────── */}
      <Sheet
        open={!!revoking}
        onClose={() => setRevoking(null)}
        size="sm"
        title="Revoke Override Access"
        footer={
          <>
            <Button variant="outline" size="md" onClick={() => setRevoking(null)}>
              Cancel
            </Button>
            <Button variant="danger" size="md" disabled={isPending} onClick={submitRevoke}>
              {isPending ? "Revoking…" : "Revoke access"}
            </Button>
          </>
        }
      >
        {revoking && (
          <DetailSection label={`${overrideKeyLabel(revoking.module_key)} · ${revoking.user_email}`} cols={1}>
            {/* The revoke takes effect on the user's very next save (R-10):
                every write re-reads the grant against the database clock. */}
            <Field label="Reason" required htmlFor="po-revoke-reason" error={revokeError}>
              <Textarea
                id="po-revoke-reason"
                rows={3}
                value={revokeReason}
                onChange={(e) => {
                  setRevokeReason(e.target.value);
                  setRevokeError(null);
                }}
              />
            </Field>
          </DetailSection>
        )}
      </Sheet>

      {/* ── History ───────────────────────────────────────────────────────── */}
      <Sheet
        open={!!historyFor}
        onClose={() => setHistoryFor(null)}
        size="md"
        title={historyFor ? `History · ${historyFor.user_email} · ${overrideKeyLabel(historyFor.module_key)}` : "History"}
      >
        <DataTable
          columns={withCreatedColumns(historyColumns, history ?? [])}
          rows={history ?? []}
          getKey={(h) => h.id}
          /* A grant's history is part of that grant — a document, not a list. */
          paginate={false}
          empty={history === null ? "Loading…" : "No history yet."}
        />
      </Sheet>
    </>
  );
}
