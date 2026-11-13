"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { ALL_UNITS, AccessRow, RoleChips, UnitChips, unitsPayload } from "@/components/permissions/access-pickers";
import { AccessMatrix } from "@/components/permissions/access-matrix";
import { screenCatalog } from "@/lib/permissions/screen-catalog";
import { treeHas, type PermissionTree as Tree } from "@/lib/permissions/effective";
import type { Action, Module } from "@/lib/auth/types";
import { saveUserAccess } from "@/lib/permissions/actions";
import type { AccessLocation, AccessUser, ScreenBlock } from "@/lib/permissions/service";
import { assignRole, removeRole } from "@/app/(app)/admin/actions";
import { createUserFromStaff, resendWelcome } from "@/lib/users/actions";
import type { RoleOption, UserRoleEntry, UserRow } from "./page";

export type InviteDelivery = { email: string; emailed: boolean; emailProblem?: string; tempPassword?: string };

/**
 * INVITE = ROLE + UNIT + WELCOME MAIL, IN THAT ORDER (user 2026-11-13: "still
 * there is which is asking for inviting user without role … if we invite user
 * should with role and unit and after also allow the role edit after
 * allocating").
 *
 * The ✉ on a Users row (and the bulk "Send welcome mail") used to mail at
 * once — a login with no role and no unit, which signs in to nothing. Now it
 * opens this: the role(s) and unit(s) are asked first, both mandatory, and
 * Send does, per person:
 *   1. units on their email (`saveUserAccess`, their extras untouched);
 *   2. the login, if they have none (`createUserFromStaff`, no mail);
 *   3. the roles (`assignRole`; for one person, unticked ones `removeRole`);
 *   4. the mail (`resendWelcome`, `first` for a new login).
 * The server refuses step 4 without a role and a unit (`inviteMissing`), so
 * this sheet is the courtesy and that is the guard.
 *
 * ONE PERSON: prefilled with what they hold, set exactly as shown.
 * SEVERAL: the chosen roles are ADDED to each, and the chosen units added to
 * the ones each already has — a bulk invite never takes access away.
 * Everything stays editable afterwards on the pencil (person editor).
 *
 * ROLE WITH ITS ACCESS, EDITABLE (user 2026-11-13: "while inviting you were
 * asking role only but also then there also edit that role access" — "role
 * with edit access"). For ONE person the sheet shows the same `AccessMatrix`
 * as the ✏️ editor under the roles picked: untick a blue cell to block it for
 * them (0840), tick an empty one to give an extra. Step 1 then saves units,
 * extras and blocks together. For SEVERAL the table is not shown — one set of
 * ticks copied onto different people is not a decision anyone made; each is
 * adjusted after with ✏️.
 *
 * `mail={false}` is the bulk "Give role & unit" (screenshot 4148): steps 1–3
 * only — logins made quietly — and Send reads Save. Inviting stays its own
 * deliberate step.
 */
export function InviteSheet({
  people,
  mail = true,
  skipped = [],
  origin,
  onClose,
  onDelivered,
  roles,
  locations,
  accessOf,
  rolesByUser,
  roleTrees,
  offered,
}: {
  people: UserRow[];
  /** false = give the roles and units, send nothing. */
  mail?: boolean;
  /** Ticked people left out, each "Name — reason" — said here, not silently dropped. */
  skipped?: string[];
  origin: DOMRect | null;
  onClose: () => void;
  /** One person's delivery, for the note above the list (temp password when the mail failed). */
  onDelivered: (d: InviteDelivery) => void;
  roles: RoleOption[];
  locations: AccessLocation[];
  accessOf: (r: UserRow) => AccessUser | null;
  rolesByUser: Record<string, UserRoleEntry[]>;
  /** Each role's tree by role id — what the access table shows in blue. */
  roleTrees: Record<string, Tree>;
  offered: Partial<Record<Module, Action[]>>;
}) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, start] = useTransition();
  const single = people.length === 1 ? people[0] : null;

  const heldOf = (r: UserRow) => (r.profile ? (rolesByUser[r.profile.id] ?? []) : []);
  const storedUnitsOf = (r: UserRow) => {
    const a = accessOf(r)?.access;
    return a?.all_locations ? [ALL_UNITS] : (a?.location_ids ?? []);
  };
  const [roleIds, setRoleIds] = useState<string[]>(() => (single ? heldOf(single).map((u) => u.role_id) : []));
  const [units, setUnits] = useState<string[]>(() => (single ? storedUnitsOf(single) : []));
  const [tried, setTried] = useState(false);
  // One person only: their extras and blocks, edited in the access table.
  const singleAccess = single ? accessOf(single) : null;
  const [tree, setTree] = useState<Tree>(() => singleAccess?.tree ?? {});
  const [blocks, setBlocks] = useState<ScreenBlock[]>(() => singleAccess?.blocks ?? []);
  const catalog = useMemo(() => screenCatalog(), []);
  const roleNameOf = (id: string) => roles.find((r) => r.id === id)?.name ?? "Unknown role";
  useUnsavedGuard(isPending);

  const noRole = roleIds.length === 0;
  const noUnit = units.length === 0;

  function send() {
    setTried(true);
    if (noRole || noUnit) return;
    start(async () => {
      let sent = 0;
      let firstError: string | null = null;
      for (const r of people) {
        const fail = (e: string) => {
          firstError ??= `${r.name ?? r.email}: ${e}`;
        };
        const a = accessOf(r);
        if (!a) {
          fail("no email in HR & Payroll ▸ People ▸ Staff");
          continue;
        }

        // 1. Units — exactly as shown for one person; added to theirs for several.
        const stored = storedUnitsOf(r);
        const next = single
          ? units
          : stored.includes(ALL_UNITS) || units.includes(ALL_UNITS)
            ? [ALL_UNITS]
            : [...new Set([...stored, ...units])];
        const same = next.length === stored.length && next.every((u) => stored.includes(u));
        // One person: their extras and blocks from the access table ride along.
        const treeChanged = !!single && JSON.stringify(tree) !== JSON.stringify(a.tree);
        const keyOf = (b: ScreenBlock[]) => b.map((x) => `${x.screen}|${x.action}`).sort().join(",");
        // Only blocks on a cell a picked role gives — anything else blocks nothing.
        const keptBlocks = blocks.filter((b) =>
          roleIds.some((id) => treeHas(roleTrees[id] ?? {}, { key: b.screen, module: b.module as Module }, b.action)),
        );
        const blocksChanged = !!single && keyOf(keptBlocks) !== keyOf(a.blocks);
        if (!same || treeChanged || blocksChanged) {
          const res = await saveUserAccess({
            email: a.email,
            active: treeChanged ? true : (a.access?.is_active ?? true),
            note: a.access?.note ?? null,
            tree: single ? tree : a.tree,
            locations: unitsPayload(next),
            ...(single ? { blocks: keptBlocks } : {}),
          });
          if (!res.ok) {
            fail(res.error);
            continue;
          }
        }

        // 2. The login.
        let userId = r.profile?.id ?? null;
        const isNew = !userId;
        if (!userId) {
          if (!r.staffId) {
            fail("not in HR & Payroll ▸ People ▸ Staff, so no login can be made");
            continue;
          }
          const made = await createUserFromStaff({ staffId: r.staffId });
          if (!made.ok || !made.userId) {
            fail(made.ok ? "the login was made but its id did not come back — reload and try again" : made.error);
            continue;
          }
          userId = made.userId;
        }

        // 3. Roles.
        const held = heldOf(r);
        let roleFailed = false;
        for (const rid of roleIds.filter((id) => !held.some((h) => h.role_id === id))) {
          const res = await assignRole(userId, rid, null);
          if (!res.ok) {
            fail(res.error);
            roleFailed = true;
            break;
          }
        }
        if (roleFailed) continue;
        if (single) {
          for (const h of held.filter((h) => !roleIds.includes(h.role_id))) {
            const res = await removeRole(h.id);
            if (!res.ok) fail(res.error);
          }
        }

        if (!mail) {
          sent++;
          continue;
        }
        // 4. The mail — the server re-checks role + unit.
        const res = await resendWelcome(userId, { first: isNew });
        if (!res.ok) {
          fail(res.error);
          continue;
        }
        sent++;
        if (single) onDelivered(res);
      }

      const done = mail
        ? single
          ? `Invite sent to ${single.email}.`
          : `${sent} invite(s) sent`
        : `Roles and units saved for ${single ? (single.name ?? single.email) : `${sent} people`}`;
      if (sent) success(`${done}${!single && firstError ? ` · failed — ${firstError}` : ""}`);
      else if (firstError) toastError(firstError);
      if (sent) onClose();
      router.refresh();
    });
  }

  const who = single ? (single.name ?? single.email ?? "this person") : `${people.length} people`;
  const resend = !!single?.profile;

  return (
    <Sheet
      open
      onClose={onClose}
      origin={origin}
      // One person gets the access table, which needs the room; several get the small sheet.
      size={single ? "lg" : "sm"}
      title={!mail ? `Give role & unit · ${who}` : resend ? `Resend welcome mail · ${who}` : `Invite ${who}`}
      footer={
        <>
          <Button variant="outline" size="md" onClick={onClose}>Cancel</Button>
          <Button size="md" disabled={isPending} onClick={send}>
            {mail && <Mail className="h-4 w-4" aria-hidden />}
            {isPending ? (mail ? "Sending…" : "Saving…") : !mail ? "Save" : resend ? "Resend" : "Send invite"}
          </Button>
        </>
      }
    >
      <div className={`space-y-4 ${single ? "mx-auto max-w-[60rem]" : ""}`}>
        <p className="text-sm text-muted-foreground">
          {!mail
            ? "The roles and units below are added to what each person already has. No mail is sent — use Invite when they should sign in."
            : single
              ? `${single.email} gets a sign-in link and a temporary password. They will open only what these roles allow, in these units.`
              : "Each person gets a sign-in link and a temporary password. The roles and units below are added to what each already has."}
        </p>
        {!single && (
          <p className="text-xs text-muted-foreground">{people.map((p) => p.name ?? p.email).join(", ")}</p>
        )}
        {skipped.length > 0 && (
          <div className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs">
            <p className="font-medium text-foreground">Left out ({skipped.length}):</p>
            <ul className="mt-0.5 list-disc pl-4 text-muted-foreground">
              {skipped.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
        )}
        <dl className="divide-y divide-border rounded-lg border border-border bg-surface">
          <AccessRow label="Roles" required>
            <RoleChips id="inv-add-role" roles={roles} value={roleIds} onChange={setRoleIds} />
            {tried && noRole && <p className="mt-1 text-xs text-danger">Give at least one role — with none they open nothing.</p>}
          </AccessRow>
          <AccessRow label="Units" required>
            <UnitChips locations={locations} value={units} onChange={setUnits} />
          </AccessRow>
        </dl>
        {single && singleAccess && (
          <section className="space-y-2" aria-label="What they can open">
            <h3 className="text-sm font-semibold text-foreground">What they can open</h3>
            <p className="text-xs text-muted-foreground">
              {roleIds.length === 0
                ? "Add a role above and its access shows here."
                : "Blue comes from the roles above — untick one to block it for this person only. Tick an empty cell to give an extra."}
            </p>
            <AccessMatrix
              catalog={catalog}
              offered={offered}
              roleTrees={roleIds.map((id) => ({ name: roleNameOf(id), tree: roleTrees[id] ?? {} }))}
              extras={tree}
              onChange={setTree}
              blocks={blocks}
              onBlocksChange={setBlocks}
            />
          </section>
        )}
        <p className="text-xs text-muted-foreground">You can change their roles, units and extra screens any time with the ✏️ on their row.</p>
      </div>
    </Sheet>
  );
}
