import type { NeedCell, StripCell } from "@/components/viz/kit";
import { count, outOf, type SayLine } from "./words";

/**
 * ADMINISTRATION ▸ OVERVIEW — the rules, pure (plan https://claude.ai/artifact/5e8SGWe8DPHC7Ua2fQyaiW,
 * wave 2, built 2026-11-06).
 *
 * A login HAS SIGNED IN when it is active and has set its own password; one still on the
 * temporary password from its welcome mail has never signed in (it can — it just has not). A staff member with NO EMAIL
 * cannot be given a login at all (logins are created from HR ▸ Staff by email), so that is the
 * fix the page names. Jobs use `jobHealth` (`lib/jobs/registry.ts`): late = past 3× its interval.
 */

export type LoginRow = { id: string; active: boolean; tempPassword: boolean; superAdmin: boolean };
export type JobRow = { key: string; label: string; health: "on_time" | "late" | "failed" | "never" };

export function adminOverview(v: { logins: readonly LoginRow[]; staffNoEmail: number; staffNoLogin: number; jobs: readonly JobRow[] }) {
  const active = v.logins.filter((l) => l.active);
  const canSignIn = active.filter((l) => !l.tempPassword);
  const temp = active.filter((l) => l.tempPassword);
  const off = v.logins.filter((l) => !l.active);
  const bad = v.jobs.filter((j) => j.health === "failed" || j.health === "late");
  const never = v.jobs.filter((j) => j.health === "never");

  const say: SayLine[] = [
    {
      text: `${count(canSignIn.length, "person", "people")} ${canSignIn.length === 1 ? "has" : "have"} signed in; ${temp.length ? `${temp.length} more ${temp.length === 1 ? "has" : "have"} a login but never signed in` : "nobody is left on a temporary password"}.`,
      mood: temp.length ? "look" : "good",
      href: temp.length ? "/admin/users" : undefined,
      linkText: "Resend the welcome mail",
    },
  ];
  if (v.staffNoEmail)
    say.push({
      text: `${count(v.staffNoEmail, "active staff member")} ${v.staffNoEmail === 1 ? "has" : "have"} no email in HR, so ${v.staffNoEmail === 1 ? "they" : "they"} cannot be given a login.`,
      mood: "look",
      href: "/hr/staff",
      linkText: "HR ▸ Staff",
    });
  if (bad.length)
    say.push({
      text: `${count(bad.length, "scheduled job")} ${bad.length === 1 ? "is" : "are"} ${bad.every((j) => j.health === "failed") ? "failing" : "late or failing"}: ${bad.map((j) => j.label).join(", ")}.`,
      mood: "problem",
      href: "/admin/jobs",
      linkText: "Scheduled Jobs",
    });
  else if (v.jobs.length && !never.length) say.push({ text: "Every scheduled job ran on time.", mood: "good" });
  if (never.length)
    say.push({ text: `${count(never.length, "scheduled job")} ${never.length === 1 ? "has" : "have"} never run: ${never.map((j) => j.label).join(", ")}.`, mood: "look", href: "/admin/jobs", linkText: "Scheduled Jobs" });

  const strip: StripCell[] = [
    // "Have signed in", not "can": a login on its temporary password CAN sign in, it just has not.
    { label: "Have signed in", value: outOf(canSignIn.length, v.logins.length), hint: `${off.length} switched off`, mood: "normal", href: "/admin/users" },
    { label: "Never signed in", value: count(temp.length, "login"), hint: temp.length ? "temporary password" : "none", mood: temp.length ? "look" : "good", href: "/admin/users" },
    { label: "No email in HR", value: count(v.staffNoEmail, "staff", "staff"), hint: v.staffNoEmail ? "cannot get a login" : "every one has one", mood: v.staffNoEmail ? "look" : "good" },
    { label: "Staff without a login", value: count(v.staffNoLogin, "staff", "staff"), hint: "have an email, no login", mood: v.staffNoLogin ? "normal" : "good", href: "/admin/users" },
    { label: "Scheduled jobs", value: outOf(v.jobs.length - bad.length - never.length, v.jobs.length), hint: bad.length ? `${bad.length} late or failing` : never.length ? `${never.length} never run` : "all on time", mood: bad.length ? "problem" : never.length ? "look" : "good", href: "/admin/jobs" },
  ];

  const needs: NeedCell[] = [
    { title: "Welcome mails", mood: temp.length ? "look" : "good", count: temp.length ? count(temp.length, "login") : "None", text: temp.length ? "still on the temporary password — resend from the row" : "Everyone has signed in", href: temp.length ? "/admin/users" : undefined, linkText: "Users" },
    { title: "Emails in HR", mood: v.staffNoEmail ? "look" : "good", count: v.staffNoEmail ? count(v.staffNoEmail, "staff", "staff") : "None", text: v.staffNoEmail ? "add the email in HR ▸ Staff, then create the login" : "Every active staff member has an email", href: v.staffNoEmail ? "/hr/staff" : undefined, linkText: "HR ▸ Staff" },
    { title: "Scheduled jobs", mood: bad.length ? "problem" : never.length ? "look" : "good", count: bad.length + never.length ? count(bad.length + never.length, "job") : "None", text: bad.length + never.length ? [...bad, ...never].map((j) => j.label).join(" · ") : "Every job ran on time", href: bad.length + never.length ? "/admin/jobs" : undefined, linkText: "Scheduled Jobs" },
  ];

  return { say, strip, needs };
}
