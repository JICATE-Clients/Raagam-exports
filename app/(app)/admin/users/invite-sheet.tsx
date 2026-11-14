"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { ToggleGroup } from "@/components/ui/segmented";
import { useToast } from "@/components/ui/toast";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { ALL_UNITS, UnitChips, unitsPayload } from "@/components/permissions/access-pickers";
import { menuCatalog } from "@/lib/permissions/screen-catalog";
import { treeHas, type PermissionTree as Tree } from "@/lib/permissions/effective";
import {
  LEVEL_WORD,
  cellsOf,
  levelOf,
  nearEmails,
  roleInWords,
  screensOf,
} from "@/lib/permissions/levels";
import { PersonAccessTree } from "@/components/permissions/person-access-tree";
import type { Action, Module } from "@/lib/auth/types";
import { saveUserAccess } from "@/lib/permissions/actions";
import type { AccessLocation, AccessUser, ScreenBlock } from "@/lib/permissions/service";
import { assignRole, removeRole } from "@/app/(app)/admin/actions";
import { createUserFromStaff, resendWelcome } from "@/lib/users/actions";
import type { RoleOption, UserRoleEntry, UserRow } from "./page";

export type InviteDelivery = { email: string; emailed: boolean; emailProblem?: string; tempPassword?: string };

type Step = 1 | 2 | 3;
const STEPS: { n: Step; word: string }[] = [
  { n: 1, word: "Who" },
  { n: 2, word: "Job & units" },
  { n: 3, word: "Review & send" },
];

/**
 * INVITE IN THREE STEPS (plan approved 2026-11-14, screen B, D4/D5 —
 * https://claude.ai/artifact/JopxLF22KNdjwGEjYzMQFt):
 *   1 WHO            the people, their emails as HR holds them, and any email
 *                    one letter away from someone else's (the typo twin that
 *                    made one person into two rows, D5);
 *   2 JOB & UNITS    the job role(s) as cards with what each opens, and units —
 *                    both required;
 *   3 REVIEW & SEND  what they will be able to open, in words, and one button.
 *
 * MODULE ACCESS IS EDITABLE ON REVIEW, FOR ONE PERSON (user 2026-11-14,
 * screenshot 4178: "this area needs to allow edit the user give module access").
 * D4 had made it a read-only "Can open" line; that is reversed for a single
 * invite. It is the person editor's list, SCOPED TO THE CHOSEN ROLE(S) — so it
 * opens on the role's modules, and "All modules" adds any other on the client's
 * request — it still starts from the role, never from ALL with 1,306 boxes to
 * untick (D4's real point). A bulk invite keeps
 * the read-only summary: one person's exceptions are not a batch decision.
 *
 * Send does, per person (unchanged): units on their email (`saveUserAccess`),
 * the login if they have none (`createUserFromStaff`), the roles
 * (`assignRole`, and for one person `removeRole` on unticked ones), then the
 * mail (`resendWelcome`), which the server refuses without a role and a unit.
 * SEVERAL people: roles and units are ADDED to what each has — a bulk invite
 * never takes access away. `mail={false}` is the bulk "Give role & unit".
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
  allEmails,
}: {
  people: UserRow[];
  /** false = give the roles and units, send nothing. */
  mail?: boolean;
  /** Ticked people left out, each "Name — reason" — said here, not silently dropped. */
  skipped?: string[];
  origin: DOMRect | null;
  onClose: () => void;
  onDelivered: (d: InviteDelivery) => void;
  roles: RoleOption[];
  locations: AccessLocation[];
  accessOf: (r: UserRow) => AccessUser | null;
  rolesByUser: Record<string, UserRoleEntry[]>;
  roleTrees: Record<string, Tree>;
  offered: Partial<Record<Module, Action[]>>;
  /** Every email on the Users list — for the one-letter-off warning. */
  allEmails: string[];
}) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, start] = useTransition();
  const single = people.length === 1 ? people[0] : null;
  const catalog = useMemo(() => menuCatalog(), []);

  const heldOf = (r: UserRow) => (r.profile ? (rolesByUser[r.profile.id] ?? []) : []);
  const storedUnitsOf = (r: UserRow) => {
    const a = accessOf(r)?.access;
    return a?.all_locations ? [ALL_UNITS] : (a?.location_ids ?? []);
  };
  const [step, setStep] = useState<Step>(1);
  const [roleIds, setRoleIds] = useState<string[]>(() => (single ? heldOf(single).map((u) => u.role_id) : []));
  const [units, setUnits] = useState<string[]>(() => (single ? storedUnitsOf(single) : []));
  const [tried, setTried] = useState(false);
  const singleAccess = single ? accessOf(single) : null;
  const [tree, setTree] = useState<Tree>(() => singleAccess?.tree ?? {});
  const [blocks, setBlocks] = useState<ScreenBlock[]>(() => singleAccess?.blocks ?? []);
  /* Role's modules by default; All modules adds what the client asks for beyond it. */
  const [scope, setScope] = useState<ModuleScope>("role");
  useUnsavedGuard(isPending);

  const noRole = roleIds.length === 0;
  const noUnit = units.length === 0;
  const roleNameOf = (id: string) => roles.find((r) => r.id === id)?.name ?? "Unknown role";

  /* D5: an email one letter from another person's — before a second row is made. */
  const twins = people
    .map((p) => ({ p, near: p.email ? nearEmails(p.email, allEmails) : [] }))
    .filter((x) => x.near.length > 0);

  /* Step 3's summary: each sidebar module the chosen roles open, and how far. */
  const picked = roleIds.map((id) => roleTrees[id] ?? {});
  const opens = catalog
    .map((cm) => ({
      label: cm.label,
      level: levelOf(cellsOf(screensOf(cm), offered), (sc, a) => picked.some((t) => treeHas(t, sc, a))),
    }))
    .filter((x) => x.level !== "none");
  const unitWords = units.includes(ALL_UNITS)
    ? "All units"
    : units.map((u) => locations.find((l) => l.id === u)?.name ?? "(inactive unit)").join(", ");
  /* One person's list: their role(s) as picked in step 2, plus their own changes. */
  const liveBlocks = blocks.filter((b) => picked.some((t) => treeHas(t, { key: b.screen, module: b.module as Module }, b.action)));
  const blocksKey = (b: ScreenBlock[]) => b.map((x) => `${x.screen}|${x.action}`).sort().join(",");
  const accessDirty =
    !!singleAccess &&
    (JSON.stringify(tree) !== JSON.stringify(singleAccess.tree) || blocksKey(liveBlocks) !== blocksKey(singleAccess.blocks));
  const editsAccess = !!single && !!singleAccess;

  function next() {
    if (step === 2) {
      setTried(true);
      if (noRole || noUnit) return;
    }
    setStep((s) => (s < 3 ? ((s + 1) as Step) : s));
  }

  function send() {
    if (noRole || noUnit) {
      setStep(2);
      setTried(true);
      return;
    }
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

        // 1. Units — exactly as chosen for one person; added to theirs for several.
        const stored = storedUnitsOf(r);
        const nextUnits = single
          ? units
          : stored.includes(ALL_UNITS) || units.includes(ALL_UNITS)
            ? [ALL_UNITS]
            : [...new Set([...stored, ...units])];
        const same = nextUnits.length === stored.length && nextUnits.every((u) => stored.includes(u));
        if (!same || !a.access || (single && accessDirty)) {
          // One person: the module access as set on Review. Several: their own
          // changes (extras, blocks) are left exactly as they are.
          const res = await saveUserAccess({
            email: a.email,
            active: a.access?.is_active ?? true,
            note: a.access?.note ?? null,
            tree: single ? tree : a.tree,
            locations: unitsPayload(nextUnits),
            ...(single ? { blocks: liveBlocks } : {}),
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
  const finalWord = !mail ? "Save" : resend ? "Resend invite" : "Send invite";

  return (
    <Sheet
      open
      onClose={onClose}
      origin={origin}
      size="md"
      title={!mail ? `Give role & unit · ${who}` : resend ? `Resend invite · ${who}` : `Invite ${who}`}
      footer={
        <>
          <Button variant="outline" size="md" onClick={step === 1 ? onClose : () => setStep((s) => (s - 1) as Step)}>
            {step === 1 ? "Cancel" : "Back"}
          </Button>
          {step < 3 ? (
            <Button size="md" onClick={next}>
              {step === 1 ? "Next: job & units" : "Next: review"}
            </Button>
          ) : (
            <Button size="md" disabled={isPending} onClick={send}>
              {mail && <Mail className="h-4 w-4" aria-hidden />}
              {isPending ? (mail ? "Sending…" : "Saving…") : finalWord}
            </Button>
          )}
        </>
      }
    >
      {/* 52rem: the step rail (11rem) + one column of cards / chips. Review with
          the access editor takes the sheet's whole width — the rail + grid need
          it, and a narrow centred column left blank space on both sides
          (user 2026-11-14, screenshot 4181). */}
      <div
        className={`mx-auto grid gap-4 sm:grid-cols-[11rem_minmax(0,1fr)] ${step === 3 && editsAccess ? "max-w-none" : "max-w-[52rem]"}`}
      >
        <ol className="flex gap-1 overflow-x-auto sm:flex-col" aria-label="Steps">
          {STEPS.map((s) => {
            const done = s.n < step;
            const on = s.n === step;
            return (
              <li
                key={s.n}
                aria-current={on ? "step" : undefined}
                className={`flex shrink-0 items-center gap-2 rounded-lg px-2 py-1.5 text-sm ${on ? "border border-border bg-surface font-semibold" : "text-muted-foreground"}`}
              >
                <span
                  className={`inline-flex size-5 items-center justify-center rounded-full text-[11px] font-semibold ${
                    done ? "bg-success text-white" : on ? "bg-primary text-primary-foreground" : "border border-border"
                  }`}
                  aria-hidden
                >
                  {done ? <Check className="size-3" /> : s.n}
                </span>
                {s.word}
              </li>
            );
          })}
        </ol>

        <div className="min-w-0 space-y-4">
          {/* ── 1 · WHO ─────────────────────────────────────────────────── */}
          {step === 1 && (
            <>
              <ul className="divide-y divide-border rounded-lg border border-border">
                {people.map((p) => (
                  <li key={p.key} className="flex flex-wrap items-baseline justify-between gap-x-3 px-3 py-2 text-sm">
                    <span className="font-medium text-foreground">{p.name ?? "—"}</span>
                    <span className="text-muted-foreground">
                      {p.code && <span className="mr-2 font-mono text-xs">{p.code}</span>}
                      {p.email}
                    </span>
                  </li>
                ))}
              </ul>
              {twins.map(({ p, near }) => (
                <div key={p.key} className="rounded-md border-l-4 border-warning bg-warning/10 px-3 py-2 text-sm">
                  <span className="font-medium">{p.email}</span> is one letter from{" "}
                  <span className="font-medium">{near.join(", ")}</span>. If they are the same person, correct the email in{" "}
                  <Link href="/hr/staff" className="text-primary underline-offset-2 hover:underline">HR &amp; Payroll ▸ People ▸ Staff</Link>{" "}
                  — their login and access move with it. If they are different people, carry on.
                </div>
              ))}
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
              <p className="text-xs text-muted-foreground">
                Emails come from HR &amp; Payroll ▸ People ▸ Staff. A wrong one is corrected there, not here.
              </p>
            </>
          )}

          {/* ── 2 · JOB & UNITS ─────────────────────────────────────────── */}
          {step === 2 && (
            <>
              <fieldset className="space-y-2">
                <legend className="text-sm font-semibold text-foreground">
                  Job role <span className="text-danger">*</span>
                </legend>
                <div className="grid gap-2 sm:grid-cols-2">
                  {roles
                    .filter((r) => r.name !== "Super Admin")
                    .map((r) => {
                      const on = roleIds.includes(r.id);
                      return (
                        <label
                          key={r.id}
                          className={`flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 text-sm ${
                            on ? "border-primary bg-primary/10" : "border-border"
                          }`}
                        >
                          <input
                            type="checkbox"
                            className="mt-0.5 size-4 accent-[var(--primary)]"
                            checked={on}
                            onChange={() => setRoleIds((ids) => (on ? ids.filter((x) => x !== r.id) : [...ids, r.id]))}
                          />
                          <span className="min-w-0">
                            <span className="block font-medium text-foreground">{r.name}</span>
                            <span className="block text-xs text-muted-foreground">{roleInWords(roleTrees[r.id] ?? {}, offered)}</span>
                          </span>
                        </label>
                      );
                    })}
                  <Link
                    href="/admin/access-control"
                    className="flex items-center rounded-lg border border-dashed border-border px-3 py-2 text-sm text-primary hover:bg-surface"
                  >
                    + New role — on Roles &amp; Permissions
                  </Link>
                </div>
                {tried && noRole && <p className="text-xs text-danger">Pick a job role — with none they open nothing.</p>}
                {!single && <p className="text-xs text-muted-foreground">Added to the roles each person already holds.</p>}
              </fieldset>
              <fieldset className="space-y-2">
                <legend className="text-sm font-semibold text-foreground">
                  Units <span className="text-danger">*</span>
                </legend>
                <UnitChips locations={locations} value={units} onChange={setUnits} />
              </fieldset>
            </>
          )}

          {/* ── 3 · REVIEW & SEND ───────────────────────────────────────── */}
          {step === 3 && (
            <div className="space-y-3 text-sm">
              {/* One row of three when the editor follows, so it starts higher up. */}
              <dl
                className={`rounded-lg border border-border ${
                  editsAccess ? "grid divide-y divide-border sm:grid-cols-3 sm:divide-x sm:divide-y-0 [&>div]:sm:grid-cols-1" : "divide-y divide-border"
                }`}
              >
                <div className="grid gap-1 px-3 py-2 sm:grid-cols-[8rem_1fr]">
                  <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Who</dt>
                  <dd>{single ? `${who} · ${single.email}` : people.map((p) => p.name ?? p.email).join(", ")}</dd>
                </div>
                <div className="grid gap-1 px-3 py-2 sm:grid-cols-[8rem_1fr]">
                  <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Job role</dt>
                  <dd>{roleIds.map(roleNameOf).join(", ")}</dd>
                </div>
                <div className="grid gap-1 px-3 py-2 sm:grid-cols-[8rem_1fr]">
                  <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Units</dt>
                  <dd>{unitWords}</dd>
                </div>
                {!editsAccess && (
                  <div className="grid gap-1 px-3 py-2 sm:grid-cols-[8rem_1fr]">
                    <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Can open</dt>
                    <dd>
                      {opens.length === 0 ? (
                        <span className="text-danger">Nothing — this role opens no module yet.</span>
                      ) : (
                        <ul className="grid gap-x-4 gap-y-0.5 sm:grid-cols-2">
                          {opens.map((o) => (
                            <li key={o.label}>
                              {o.label} <span className="text-muted-foreground">· {LEVEL_WORD[o.level]}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </dd>
                  </div>
                )}
              </dl>
              {editsAccess && (
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Module access <span className="font-normal normal-case">— from {roleIds.map(roleNameOf).join(", ")}; add or narrow for this person</span>
                    </p>
                    <ToggleGroup<ModuleScope>
                label="Modules shown"
                value={scope}
                onChange={setScope}
                options={[
                  { value: "role", label: "Role's modules" },
                  { value: "all", label: "All modules" },
                ]}
              />
                  </div>
                  <PersonAccessTree
                    catalog={catalog}
                    offered={offered}
                    roleTrees={picked}
                    tree={tree}
                    blocks={liveBlocks}
                    scope={scope}
                    onChange={(next) => {
                      setTree(next.extras);
                      setBlocks(next.blocks);
                    }}
                  />
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                {!mail
                  ? "No mail is sent — use Invite when they should sign in."
                  : "They get a sign-in link and a temporary password, and choose their own password at first sign-in."}
              </p>
            </div>
          )}
        </div>
      </div>
    </Sheet>
  );
}

type ModuleScope = "role" | "all";
