"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Sheet } from "@/components/ui/sheet";
import { StatusPill } from "@/components/ui/status-pill";
import { useToast } from "@/components/ui/toast";
import { AccessMatrix } from "@/components/permissions/access-matrix";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { screenCatalog } from "@/lib/permissions/screen-catalog";
import type { PermissionTree as Tree } from "@/lib/permissions/effective";
import { saveUserAccess } from "@/lib/permissions/actions";
import type { AccessLocation, AccessUser } from "@/lib/permissions/service";
import type { Action, Module } from "@/lib/auth/types";
import { assignRole, removeRole } from "@/app/(app)/admin/actions";
import type { RoleOption, UserRoleEntry, ProfileRow } from "./page";

const ALL_UNITS = "__all_units__";

/**
 * ONE PERSON'S ACCESS, ON ONE PAGE, WITH ONE SAVE (user 2026-11-13,
 * screenshot 4139: "plan this page UI" — approved: role chips, unit buttons, a
 * "Can open" summary, extra screens folded, one Save button).
 *
 * The first cut of this editor (same day) was three bordered boxes: a Roles
 * box holding a card per role plus an "Assign another" form whose button sat
 * greyed until a pick; a Units box half the screen wide for one dropdown that
 * said "1 units selected" without naming the unit; and the whole permission
 * tree open underneath with a Status switch that read like the PERSON's
 * status. Roles and units saved on each click and extra screens on a button —
 * two rules on one page.
 *
 * Now, top to bottom:
 *   ROLES          chips; ✕ takes one off, "+ Add role" picks one on.
 *   UNITS *        the units as named buttons, ticked on or off.
 *   ACCESS TABLE   `AccessMatrix` — what the roles give (blue, locked) and this
 *                  person's extras (green), one table (plan approved 2026-11-13,
 *                  https://claude.ai/artifact/JGQev3raC2WCeMyVULxE9j). It replaced
 *                  a "Can open" list and a separate tree that disagreed.
 * No on/off switch for extras any more: an extra is removed by unticking it.
 * The stored `is_active` is kept as it is unless the extras are edited, when
 * Save switches them on — a change nobody could see working would be a lie.
 * Nothing is stored until Save; Cancel drops every change. Save writes the
 * role changes (assign / remove, the same actions as before) and then the
 * email access — units, switch and tree — in one `saveUserAccess`.
 *
 * Roles hang off a LOGIN; units and extra screens off the EMAIL (0661), so they
 * can be set before the person has ever signed in. Mount with a `key` per
 * person: state seeds from props once.
 */
export function PersonAccessSheet({
  open,
  onClose,
  origin,
  name,
  code,
  profile,
  access,
  userRoles,
  roles,
  roleTrees,
  locations,
  offered,
  canEdit,
  meId,
}: {
  open: boolean;
  onClose: () => void;
  origin: DOMRect | null;
  name: string;
  code: string | null;
  profile: ProfileRow | null;
  /** The person's email access — synthesised blank when never set up; null when HR has no email. */
  access: AccessUser | null;
  userRoles: UserRoleEntry[];
  roles: RoleOption[];
  /** Each role's permission tree, by role id — for the "Can open" summary. */
  roleTrees: Record<string, Tree>;
  locations: AccessLocation[];
  offered: Partial<Record<Module, Action[]>>;
  canEdit: boolean;
  meId: string;
}) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, start] = useTransition();
  const catalog = screenCatalog();

  const isMe = !!profile && profile.id === meId;
  const superAdmin = !!profile?.is_super_admin;
  const locked = !canEdit || isMe;

  // ── The draft — nothing reaches the database until Save ────────────────────
  const heldIds = useMemo(() => userRoles.map((ur) => ur.role_id), [userRoles]);
  const storedUnits = access?.access?.all_locations ? [ALL_UNITS] : (access?.access?.location_ids ?? []);
  const [roleIds, setRoleIds] = useState<string[]>(heldIds);
  const [units, setUnits] = useState<string[]>(storedUnits);
  const [active, setActive] = useState(access?.access?.is_active ?? true);
  const [tree, setTree] = useState<Tree>(access?.tree ?? {});
  /* "+ Add role" is a BUTTON that opens the picker: placeholders are off app-wide
     (`SHOW_PLACEHOLDERS`), so an empty picker could never say what it was for —
     it drew as a blank box (screenshot 4140). */
  const [adding, setAdding] = useState(false);
  const [rolePick, setRolePick] = useState("");

  const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));
  const rolesDirty = !sameSet(roleIds, heldIds);
  const unitsDirty = !sameSet(units, storedUnits);
  const treeDirty = JSON.stringify(tree) !== JSON.stringify(access?.tree ?? {});
  const extrasDirty = treeDirty || active !== (access?.access?.is_active ?? true);
  const dirty = rolesDirty || unitsDirty || extrasDirty;
  useUnsavedGuard(isPending || (open && dirty));

  const roleName = (id: string) => roles.find((r) => r.id === id)?.name ?? "Unknown role";
  const unitIds = units.filter((u) => u !== ALL_UNITS);
  const allUnits = units.includes(ALL_UNITS);
  const noUnit = !allUnits && unitIds.length === 0;

  function toggleUnit(id: string) {
    if (id === ALL_UNITS) return setUnits(allUnits ? [] : [ALL_UNITS]);
    // Ticking one unit while "All units" is on narrows to that unit.
    const base = allUnits ? [] : unitIds;
    setUnits(base.includes(id) ? base.filter((u) => u !== id) : [...base, id]);
  }


  function save() {
    if (access && !superAdmin && active && noUnit) {
      toastError("Unit is required — tick at least one unit.");
      return;
    }
    start(async () => {
      // Roles first — they hang off the login. Same actions the old panel used.
      if (profile && rolesDirty) {
        for (const id of roleIds.filter((id) => !heldIds.includes(id))) {
          const r = await assignRole(profile.id, id, null);
          if (!r.ok) return toastError(r.error);
        }
        for (const ur of userRoles.filter((ur) => !roleIds.includes(ur.role_id))) {
          const r = await removeRole(ur.id);
          if (!r.ok) return toastError(r.error);
        }
      }
      if (access && (unitsDirty || extrasDirty)) {
        const res = await saveUserAccess({
          email: access.email,
          active,
          note: access.access?.note ?? null,
          tree,
          locations: { all: allUnits, ids: allUnits ? [] : unitIds },
        });
        if (!res.ok) return toastError(res.error);
      }
      success(`Access saved for ${name}`);
      onClose();
      router.refresh();
    });
  }

  const loginPill = !profile ? (
    <StatusPill tone="neutral">No login yet</StatusPill>
  ) : !profile.is_active ? (
    <StatusPill tone="neutral">Login switched off</StatusPill>
  ) : profile.must_change_password ? (
    <StatusPill tone="warning">Temporary password</StatusPill>
  ) : (
    <StatusPill tone="success">Password set</StatusPill>
  );

  const offeredRoles = roles.filter((r) => !roleIds.includes(r.id));
  const paused = !!access?.access && !access.access.is_active && Object.values(access.tree).some(Boolean);

  return (
    <Sheet
      open={open}
      onClose={onClose}
      origin={origin}
      title={`Access · ${name}`}
      footer={
        <>
          <Button variant="outline" size="md" onClick={onClose}>{superAdmin || locked ? "Close" : "Cancel"}</Button>
          {!superAdmin && (
            <Button size="md" disabled={isPending || locked || !dirty} onClick={save}>
              {isPending ? "Saving…" : "Save"}
            </Button>
          )}
        </>
      }
    >
      {/* 60rem: the widest row is the permission tree (rail 15rem + six action
          columns); every other row is a label column (8rem) + chips. */}
      <div className="mx-auto max-w-[60rem] space-y-5">
        {/* Who this is — the facts the bare name in the title left out. */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
          {code && <span className="font-mono text-xs">{code}</span>}
          {access?.email && <span>{access.email}</span>}
          {loginPill}
        </div>

        {isMe && <p className="text-sm text-warning">Your own access is set by another administrator.</p>}

        {superAdmin ? (
          <p className="rounded-lg border border-border bg-surface px-4 py-3 text-sm">
            <strong className="font-semibold">Super admin</strong>
            <span className="text-muted-foreground"> — every module, every screen and every unit. There is nothing to set here.</span>
          </p>
        ) : (
          <dl className="divide-y divide-border rounded-lg border border-border bg-surface">
            {/* ── ROLES ─────────────────────────────────────────────────── */}
            <Row label="Roles">
              {!profile ? (
                <p className="text-sm text-muted-foreground">No login yet — send the welcome mail from the row first. A role hangs off the login.</p>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  {roleIds.length === 0 && <span className="text-sm text-muted-foreground">No role yet</span>}
                  {roleIds.map((id) => (
                    <span key={id} className="inline-flex h-8 items-center gap-1 rounded-control bg-info/10 pl-3 pr-1 text-sm font-medium text-info">
                      {roleName(id)}
                      {!locked && (
                        <button
                          type="button"
                          aria-label={`Remove role ${roleName(id)}`}
                          className="inline-flex size-6 items-center justify-center rounded-full hover:bg-info/20"
                          onClick={() => setRoleIds((ids) => ids.filter((x) => x !== id))}
                        >
                          <X className="size-3.5" aria-hidden />
                        </button>
                      )}
                    </span>
                  ))}
                  {!locked && offeredRoles.length > 0 &&
                    (adding ? (
                      <div className="w-56">
                        {/* Picking IS adding — no second "Assign" button (screenshot 4139). */}
                        <Combobox
                          id="pa-add-role"
                          options={offeredRoles.map((r) => ({ value: r.id, label: r.name, sublabel: r.description ?? undefined }))}
                          value={rolePick}
                          onChange={(v) => {
                            if (v) setRoleIds((ids) => (ids.includes(v) ? ids : [...ids, v]));
                            setRolePick("");
                            setAdding(false);
                          }}
                        />
                      </div>
                    ) : (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setAdding(true);
                          // The picker mounts on this click; put the cursor in it.
                          requestAnimationFrame(() => document.getElementById("pa-add-role")?.focus());
                        }}
                      >
                        <Plus className="h-4 w-4" aria-hidden />
                        Add role
                      </Button>
                    ))}
                </div>
              )}
            </Row>

            {/* ── UNITS ─────────────────────────────────────────────────── */}
            <Row label="Units" required>
              {!access ? (
                <p className="text-sm text-muted-foreground">No email in HR &amp; Payroll ▸ People ▸ Staff — add one there first.</p>
              ) : (
                <div className="space-y-1.5">
                  {/* Named, not counted: "1 units selected" never said WHICH unit. */}
                  <div className="flex flex-wrap gap-2" role="group" aria-label="Units">
                    {[{ id: ALL_UNITS, name: "All units" }, ...locations].map((l) => {
                      const on = l.id === ALL_UNITS ? allUnits : allUnits || unitIds.includes(l.id);
                      return (
                        <label
                          key={l.id}
                          className={`inline-flex h-8 cursor-pointer items-center gap-2 rounded-control border px-3 text-sm ${
                            on ? "border-primary bg-primary/10 font-medium text-primary" : "border-border text-foreground"
                          } ${locked ? "pointer-events-none opacity-60" : ""}`}
                        >
                          <input
                            type="checkbox"
                            className="size-4 accent-[var(--primary)]"
                            checked={on}
                            disabled={locked}
                            onChange={() => toggleUnit(l.id)}
                          />
                          {l.name}
                        </label>
                      );
                    })}
                    {/* A unit switched off since it was given stays listed, so Save never drops it silently. */}
                    {unitIds
                      .filter((id) => !locations.some((l) => l.id === id))
                      .map((id) => (
                        <span key={id} className="inline-flex h-8 items-center rounded-control border border-border px-3 text-sm text-muted-foreground">
                          (inactive unit)
                        </span>
                      ))}
                  </div>
                  <p className={`text-xs ${noUnit ? "text-danger" : "text-muted-foreground"}`}>
                    {noUnit ? "Tick at least one — with no unit they see no data." : "The units they may switch to in the top bar."}
                  </p>
                </div>
              )}
            </Row>
          </dl>
        )}

        {!superAdmin && (
          <section className="space-y-2" aria-label="What they can open">
            <h3 className="text-sm font-semibold text-foreground">What they can open</h3>
            {!access ? (
              <p className="text-sm text-muted-foreground">
                Extra screens need an email in HR &amp; Payroll ▸ People ▸ Staff. Their roles still apply.
              </p>
            ) : (
              <>
                {paused && (
                  <p className="text-sm text-warning">
                    Their extra screens are switched off and do not count today. Change any tick and Save switches them back on.
                  </p>
                )}
                {!access.has_login && (
                  <p className="text-xs text-muted-foreground">
                    No login yet — extras start working the first time they sign in with {access.email}.
                  </p>
                )}
              </>
            )}
            <AccessMatrix
              catalog={catalog}
              offered={offered}
              roleTrees={roleIds.map((id) => ({ name: roleName(id), tree: roleTrees[id] ?? {} }))}
              extras={tree}
              readOnly={locked || !access}
              onChange={(t) => {
                setTree(t);
                setActive(true);
              }}
            />
          </section>
        )}
      </div>
    </Sheet>
  );
}

/** One labelled line of the editor — label column left, content right. */
function Row({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="grid gap-2 px-4 py-3 sm:grid-cols-[8rem_1fr] sm:items-start">
      <dt className="pt-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
        {required && <span className="text-danger"> *</span>}
      </dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}
