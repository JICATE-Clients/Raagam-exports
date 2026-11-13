"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { StatusPill } from "@/components/ui/status-pill";
import { useToast } from "@/components/ui/toast";
import { AccessMatrix } from "@/components/permissions/access-matrix";
import { ALL_UNITS, AccessRow as Row, RoleChips, UnitChips, unitsPayload } from "@/components/permissions/access-pickers";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { screenCatalog } from "@/lib/permissions/screen-catalog";
import { treeHas, type PermissionTree as Tree } from "@/lib/permissions/effective";
import { saveUserAccess } from "@/lib/permissions/actions";
import type { AccessLocation, AccessUser, ScreenBlock } from "@/lib/permissions/service";
import type { Action, Module } from "@/lib/auth/types";
import { assignRole, removeRole } from "@/app/(app)/admin/actions";
import type { RoleOption, UserRoleEntry, ProfileRow } from "./page";

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
 *   ACCESS TABLE   `AccessMatrix` — what the roles give (blue; untick = BLOCK it
 *                  for this person only, 0840) and this
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
  const [blocks, setBlocks] = useState<ScreenBlock[]>(access?.blocks ?? []);

  const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));
  const rolesDirty = !sameSet(roleIds, heldIds);
  const unitsDirty = !sameSet(units, storedUnits);
  const treeDirty = JSON.stringify(tree) !== JSON.stringify(access?.tree ?? {});
  const blocksKey = (b: ScreenBlock[]) => b.map((x) => `${x.screen}|${x.action}`).sort().join(",");
  const blocksDirty = blocksKey(blocks) !== blocksKey(access?.blocks ?? []);
  const extrasDirty = treeDirty || blocksDirty || active !== (access?.access?.is_active ?? true);
  const dirty = rolesDirty || unitsDirty || extrasDirty;
  useUnsavedGuard(isPending || (open && dirty));

  const roleName = (id: string) => roles.find((r) => r.id === id)?.name ?? "Unknown role";
  const noUnit = !units.includes(ALL_UNITS) && units.length === 0;


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
          locations: unitsPayload(units),
          /* Only blocks a role they still hold gives: remove the role and a
             block on its cells would be a rule about nothing. */
          blocks: blocks.filter((b) =>
            roleIds.some((id) => treeHas(roleTrees[id] ?? {}, { key: b.screen, module: b.module as Module }, b.action)),
          ),
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
                <p className="text-sm text-muted-foreground">No login yet — roles are given with the invite: the ✉ on their row asks for a role and a unit before it sends.</p>
              ) : (
                <RoleChips id="pa-add-role" roles={roles} value={roleIds} onChange={setRoleIds} readOnly={locked} />
              )}
            </Row>

            {/* ── UNITS ─────────────────────────────────────────────────── */}
            <Row label="Units" required>
              {!access ? (
                <p className="text-sm text-muted-foreground">No email in HR &amp; Payroll ▸ People ▸ Staff — add one there first.</p>
              ) : (
                <UnitChips locations={locations} value={units} onChange={setUnits} readOnly={locked} />
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
              blocks={blocks}
              onBlocksChange={setBlocks}
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
