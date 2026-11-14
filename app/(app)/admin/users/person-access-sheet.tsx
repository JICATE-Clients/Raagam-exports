"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet } from "@/components/ui/sheet";
import { StatusPill } from "@/components/ui/status-pill";
import { useToast } from "@/components/ui/toast";
import { ModuleAccessList } from "@/components/permissions/module-access";
import { ALL_UNITS, RoleChips, UnitChips, unitsPayload } from "@/components/permissions/access-pickers";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { menuCatalog } from "@/lib/permissions/screen-catalog";
import { treeHas, type PermissionTree as Tree } from "@/lib/permissions/effective";
import {
  EXCEPTION_LIMIT,
  LEVEL_WORD,
  applyPersonCells,
  cellsOf,
  changesInWords,
  effectiveTree,
  levelOf,
  personChanges,
  personModel,
  screensOf,
} from "@/lib/permissions/levels";
import { saveRoleAccess, saveUserAccess } from "@/lib/permissions/actions";
import { setLoginActive } from "@/lib/users/actions";
import type { AccessLocation, AccessUser, ScreenBlock } from "@/lib/permissions/service";
import type { Action, Module } from "@/lib/auth/types";
import { assignRole, removeRole } from "@/app/(app)/admin/actions";
import type { RoleOption, UserRoleEntry, ProfileRow } from "./page";

/**
 * ONE PERSON'S ACCESS (plan approved 2026-11-14, screen C —
 * https://claude.ai/artifact/JopxLF22KNdjwGEjYzMQFt).
 *
 * LEFT: who they are and their login — email, roles, units, resend the
 * sign-in mail, switch the login off. RIGHT: what they can open, one row per
 * sidebar module, Full · View only · Custom · None (`ModuleAccessList`); only
 * Custom opens the screen boxes.
 *
 * Storage is unchanged: what the role gives and this person should not have is
 * a BLOCK (0840); what they have beyond the role is an EXTRA (their email
 * grants). The control turns a module level into exactly those, so a role
 * keeps routing approvals and alerts to them.
 *
 * EXCEPTIONS STAY RARE (D3). Past `EXCEPTION_LIMIT` modules differing from the
 * role, the page says the role is wrong for them and offers "Save as a new
 * role": their access as it stands becomes a role, they get it instead, and
 * their exceptions are cleared. That is the "ALL minus 13 modules = Pulse only"
 * case that produced 1,306 blocks for one person.
 *
 * Nothing is stored until Save (or Save as a new role); Cancel drops it all.
 * Mount with a `key` per person: state seeds from props once.
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
  onInvite,
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
  roleTrees: Record<string, Tree>;
  locations: AccessLocation[];
  offered: Partial<Record<Module, Action[]>>;
  canEdit: boolean;
  meId: string;
  /** Opens the invite sheet for this person (send / resend the sign-in mail). */
  onInvite: (() => void) | null;
}) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, start] = useTransition();
  const catalog = useMemo(() => menuCatalog(), []);

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
  const [newRoleName, setNewRoleName] = useState("");
  const [keepExceptions, setKeepExceptions] = useState(false);

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

  const pickedTrees = roleIds.map((id) => roleTrees[id] ?? {});
  /* Blocks only mean something on a cell a role they hold gives. */
  const liveBlocks = blocks.filter((b) => pickedTrees.some((t) => treeHas(t, { key: b.screen, module: b.module as Module }, b.action)));
  const model = personModel(pickedTrees, tree, liveBlocks);
  const changes = personChanges(pickedTrees, tree, liveBlocks, offered);
  const tooMany = changes.total > EXCEPTION_LIMIT && roleIds.length > 0;

  function save() {
    if (access && !superAdmin && active && noUnit) {
      toastError("Unit is required — tick at least one unit.");
      return;
    }
    start(async () => {
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
          blocks: liveBlocks,
        });
        if (!res.ok) return toastError(res.error);
      }
      success(`Access saved for ${name}`);
      onClose();
      router.refresh();
    });
  }

  /** D3: their access as it stands becomes a role; they hold it instead; exceptions cleared. */
  function saveAsRole() {
    const roleTitle = newRoleName.trim();
    if (!roleTitle) {
      document.getElementById("pa-new-role")?.focus();
      return;
    }
    if (!profile || !access) return;
    if (noUnit) {
      toastError("Unit is required — tick at least one unit.");
      return;
    }
    start(async () => {
      const made = await saveRoleAccess({
        name: roleTitle,
        description: `Made from ${name}'s access`,
        tree: effectiveTree(model.has, offered),
      });
      if (!made.ok) return toastError(made.error);
      const given = await assignRole(profile.id, made.roleId, null);
      if (!given.ok) return toastError(given.error);
      for (const ur of userRoles) {
        const r = await removeRole(ur.id);
        if (!r.ok) return toastError(r.error);
      }
      const res = await saveUserAccess({
        email: access.email,
        active: true,
        note: access.access?.note ?? null,
        tree: {},
        locations: unitsPayload(units),
        blocks: [],
      });
      if (!res.ok) return toastError(res.error);
      success(`${roleTitle} created and given to ${name}. Their exceptions are cleared.`);
      onClose();
      router.refresh();
    });
  }

  function switchLogin(on: boolean) {
    if (!profile) return;
    start(async () => {
      const res = await setLoginActive(profile.id, on);
      if (!res.ok) return toastError(res.error);
      success(on ? "Login switched on." : "Login switched off — they can no longer sign in.");
      router.refresh();
    });
  }

  const loginPill = !profile ? (
    <StatusPill tone="neutral">Not invited</StatusPill>
  ) : !profile.is_active ? (
    <StatusPill tone="neutral">Login switched off</StatusPill>
  ) : profile.must_change_password ? (
    <StatusPill tone="warning">Invited · temporary password</StatusPill>
  ) : (
    <StatusPill tone="success">Active</StatusPill>
  );

  const roleWord = (cm: (typeof catalog)[number]) =>
    levelOf(cellsOf(screensOf(cm), offered), (sc, a) => model.roleHas(sc, a));

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
      {/* 68rem: side panel 16rem + module rows (name + the four-word control). */}
      <div className="mx-auto grid max-w-[68rem] gap-5 lg:grid-cols-[16rem_minmax(0,1fr)]">
        {/* ── LEFT: the person and their login ─────────────────────────── */}
        <aside className="space-y-4 rounded-lg border border-border bg-surface p-4 text-sm lg:self-start">
          <div className="space-y-1">
            <p className="font-semibold text-foreground">{name}</p>
            {code && <p className="font-mono text-xs text-muted-foreground">{code}</p>}
            {access?.email && <p className="break-all text-muted-foreground">{access.email}</p>}
            <div>{loginPill}</div>
          </div>

          {isMe && <p className="text-warning">Your own access is set by another administrator.</p>}

          {superAdmin ? (
            <p className="text-muted-foreground">Super admin — every module, every screen and every unit.</p>
          ) : (
            <>
              <div className="space-y-1.5">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Job role</p>
                {!profile ? (
                  <p className="text-muted-foreground">Given with the invite.</p>
                ) : (
                  <RoleChips id="pa-add-role" roles={roles} value={roleIds} onChange={setRoleIds} readOnly={locked} />
                )}
              </div>
              <div className="space-y-1.5">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Units <span className="text-danger">*</span>
                </p>
                {!access ? (
                  <p className="text-muted-foreground">No email in HR &amp; Payroll ▸ People ▸ Staff — add one there first.</p>
                ) : (
                  <UnitChips locations={locations} value={units} onChange={setUnits} readOnly={locked} />
                )}
              </div>
            </>
          )}

          {!superAdmin && !locked && (
            <div className="flex flex-col items-start gap-1 border-t border-border pt-3">
              {onInvite && (
                <button type="button" onClick={onInvite} className="text-primary underline-offset-2 hover:underline">
                  {profile ? "Resend sign-in mail" : "Invite — send sign-in mail"}
                </button>
              )}
              {profile && (
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => switchLogin(!profile.is_active)}
                  className={`underline-offset-2 hover:underline ${profile.is_active ? "text-danger" : "text-primary"}`}
                >
                  {profile.is_active ? "Switch login off" : "Switch login on"}
                </button>
              )}
            </div>
          )}
        </aside>

        {/* ── RIGHT: what they can open ────────────────────────────────── */}
        {!superAdmin && (
          <section className="min-w-0 space-y-3" aria-label="What they can open">
            <h3 className="text-sm font-semibold text-foreground">What they can open</h3>

            {!access && (
              <p className="text-sm text-muted-foreground">Changes for one person need an email in HR &amp; Payroll ▸ People ▸ Staff. Their role still applies.</p>
            )}

            {tooMany && !keepExceptions && profile && access && !locked ? (
              <div className="space-y-2 rounded-lg border border-danger/40 bg-danger/5 px-3 py-2 text-sm">
                <p>
                  <span className="font-medium text-danger">
                    {changes.total} modules differ from {roleIds.map(roleName).join(", ")}.
                  </span>{" "}
                  <span className="text-muted-foreground">That usually means the role is wrong for them. Save what they have as a role of its own:</span>
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="w-56">
                    <Input id="pa-new-role" aria-label="New role name" value={newRoleName} onChange={(e) => setNewRoleName(e.target.value)} />
                  </div>
                  <Button type="button" variant="outline" size="md" disabled={isPending} onClick={saveAsRole}>
                    Save as a new role
                  </Button>
                  <button type="button" className="text-primary underline-offset-2 hover:underline" onClick={() => setKeepExceptions(true)}>
                    Keep as exceptions
                  </button>
                </div>
              </div>
            ) : changes.total > 0 ? (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                <span className="text-muted-foreground">Changed for this person:</span>
                <span className="font-medium text-foreground">{changesInWords(changes).join(" · ")}</span>
                {!locked && access && (
                  <button
                    type="button"
                    className="text-primary underline-offset-2 hover:underline"
                    onClick={() => {
                      setTree({});
                      setBlocks([]);
                    }}
                  >
                    Back to the role only
                  </button>
                )}
              </div>
            ) : null}

            <ModuleAccessList
              catalog={catalog}
              offered={offered}
              has={model.has}
              readOnly={locked || !access}
              onCells={(c) => {
                const next = applyPersonCells(pickedTrees, tree, liveBlocks, c);
                setTree(next.extras);
                setBlocks(next.blocks);
                setActive(true);
              }}
              noteOf={(cm, level) => {
                const fromRole = roleWord(cm);
                if (fromRole === "none") return level === "none" ? null : "Added for this person";
                if (level === "none") return `Removed for this person · role gives ${LEVEL_WORD[fromRole]}`;
                if (level === fromRole && level !== "custom") return "From role";
                return null;
              }}
              cellTitle={(sc, a) =>
                model.roleHas(sc, a)
                  ? model.isBlocked(sc, a)
                    ? "Removed for this person — tick to give it back"
                    : "From their role"
                  : model.extraHas(sc, a)
                    ? "Added for this person"
                    : undefined
              }
            />
          </section>
        )}
      </div>
    </Sheet>
  );
}
