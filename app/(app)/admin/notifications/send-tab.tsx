"use client";

import { useState, useTransition } from "react";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { MultiSelect } from "@/components/ui/multi-select";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, FieldRow } from "@/components/ui/field";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { previewAudience, sendAnnouncement, sendTestNotification } from "@/lib/notifications/admin-actions";
import type { ReachablePerson } from "@/lib/notifications/admin-types";

type Audience = "everyone" | "roles" | "people";
type Tone = "info" | "success" | "warning" | "danger";

/**
 * SEND — a Test to one person, and an Announcement to many.
 *
 * Both go through `notify()` like every other alert (events `admin.test` and
 * `admin.broadcast`), so they are logged, obey their own switches on the
 * Overview, and an announcement can be taken back from the Log.
 *
 * An announcement is CONFIRMED WITH ITS HEAD-COUNT. "Everyone" on a shared
 * shop-floor phone is a lot of buzzing; the number before Send is the moment
 * an admin notices they picked the wrong audience.
 */
export function SendTab({
  people,
  roles,
  meId,
  canCreate,
}: {
  people: ReachablePerson[];
  roles: { id: string; name: string }[];
  meId: string;
  canCreate: boolean;
}) {
  const active = people.filter((p) => p.is_active);
  return (
    <div className="grid gap-4 lg:grid-cols-[22rem_1fr]">
      <TestCard people={active} meId={meId} canCreate={canCreate} />
      <AnnouncementCard people={active} roles={roles} canCreate={canCreate} />
    </div>
  );
}

function TestCard({ people, meId, canCreate }: { people: ReachablePerson[]; meId: string; canCreate: boolean }) {
  const { error } = useToast();
  const [isPending, start] = useTransition();
  const [who, setWho] = useState(meId);
  const [result, setResult] = useState<string | null>(null);

  const send = () =>
    start(async () => {
      setResult(null);
      const res = await sendTestNotification(who);
      if (!res.ok) {
        error(res.error);
        return;
      }
      setResult(
        res.suppressed === "disabled"
          ? "Not sent — the Test alert is switched off on the Overview."
          : res.reached === 0
            ? "Reached nobody."
            : res.pushAttempted === 0
              ? "In their bell. No phone or browser has alerts turned on for them, so nothing buzzed."
              : `In their bell, and sent to ${res.pushSent} of ${res.pushAttempted} device${res.pushAttempted === 1 ? "" : "s"}.${
                  res.pushFailed ? " A device refused it — see Devices." : ""
                }`,
      );
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Test alert</CardTitle>
      </CardHeader>
      {/* A form on a page: the marker keeps Tab on its fields (keyboard contract). */}
      <CardBody className="space-y-3" data-focus-scope>
        <p className="text-xs text-muted-foreground">
          For &quot;my phone doesn&apos;t buzz&quot;: send one alert and see exactly where it went.
        </p>
        <Field label="Send to">
          <Combobox
            options={people.map((p) => ({
              value: p.user_id,
              label: p.full_name || p.email || "—",
              sublabel: p.device_count ? `${p.device_count} device${p.device_count === 1 ? "" : "s"}` : "no device",
            }))}
            value={who}
            onChange={setWho}
          />
        </Field>
        <Button size="md" disabled={!canCreate || !who || isPending} onClick={send}>
          {isPending ? "Sending…" : "Send test"}
        </Button>
        {result && <p className="text-sm text-foreground">{result}</p>}
      </CardBody>
    </Card>
  );
}

const TONE_LABEL: Record<Tone, string> = {
  info: "Information",
  success: "Good news",
  warning: "Needs attention",
  danger: "Urgent",
};

function AnnouncementCard({
  people,
  roles,
  canCreate,
}: {
  people: ReachablePerson[];
  roles: { id: string; name: string }[];
  canCreate: boolean;
}) {
  const { success, error } = useToast();
  const [isPending, start] = useTransition();
  const [audience, setAudience] = useState<Audience>("everyone");
  const [roleIds, setRoleIds] = useState<string[]>([]);
  const [userIds, setUserIds] = useState<string[]>([]);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [href, setHref] = useState("");
  const [tone, setTone] = useState<Tone>("info");
  const [confirmCount, setConfirmCount] = useState<number | null>(null);

  const dirty = !!(title || body || href || roleIds.length || userIds.length);
  useUnsavedGuard(dirty || isPending);

  const target = () =>
    audience === "roles"
      ? { kind: "roles" as const, roleIds }
      : audience === "people"
        ? { kind: "people" as const, userIds }
        : { kind: "everyone" as const };

  const review = () =>
    start(async () => {
      const res = await previewAudience(target());
      if (!res.ok) error(res.error);
      else if (res.count === 0) error("Nobody active is in that audience.");
      else setConfirmCount(res.count);
    });

  const send = () =>
    start(async () => {
      const res = await sendAnnouncement({
        audience: target(),
        title,
        body: body || undefined,
        href: href || undefined,
        type: tone,
      });
      setConfirmCount(null);
      if (!res.ok) {
        error(res.error);
        return;
      }
      success(`Announcement sent to ${res.reached} ${res.reached === 1 ? "person" : "people"}`);
      setTitle("");
      setBody("");
      setHref("");
      setRoleIds([]);
      setUserIds([]);
    });

  const audienceReady =
    audience === "everyone" || (audience === "roles" ? roleIds.length > 0 : userIds.length > 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Announcement</CardTitle>
      </CardHeader>
      <CardBody className="space-y-3" data-focus-scope>
        {/* Audience 176 + picker 288 + gap → fits the card at lg; wraps below. */}
        <FieldRow>
          <Field label="Send to" w="term">
            <Select value={audience} onChange={(e) => setAudience(e.target.value as Audience)}>
              <option value="everyone">Everyone</option>
              <option value="roles">People in roles</option>
              <option value="people">Chosen people</option>
            </Select>
          </Field>
          {audience === "roles" && (
            <Field w="name">
              <MultiSelect
                label="Roles"
                options={roles.map((r) => ({ id: r.id, label: r.name }))}
                values={roleIds}
                onChange={setRoleIds}
                // Names in the trigger, not chips beneath it: chips grew this
                // field and dropped it below "Send to" on the same row.
                hideChips
                summarizeLabels
              />
            </Field>
          )}
          {audience === "people" && (
            <Field w="name">
              <MultiSelect
                label="People"
                options={people.map((p) => ({ id: p.user_id, label: p.full_name || p.email || "—" }))}
                values={userIds}
                onChange={setUserIds}
                // Names in the trigger, not chips beneath it: chips grew this
                // field and dropped it below "Send to" on the same row.
                hideChips
                summarizeLabels
              />
            </Field>
          )}
        </FieldRow>
        <FieldRow>
          <Field label="Title" required w="name">
            <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} />
          </Field>
          <Field label="Kind" w="term">
            <Select value={tone} onChange={(e) => setTone(e.target.value as Tone)}>
              {(Object.keys(TONE_LABEL) as Tone[]).map((t) => (
                <option key={t} value={t}>
                  {TONE_LABEL[t]}
                </option>
              ))}
            </Select>
          </Field>
        </FieldRow>
        <Field label="Message">
          <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} maxLength={1000} />
        </Field>
        <Field label="Opens (optional)" w="name" hint="A screen in this app, e.g. /orders — never an outside website.">
          {/* caps-input: exempt -- a URL path is case-sensitive; capitals would break the link */}
          <Input value={href} onChange={(e) => setHref(e.target.value)} uppercase={false} />
        </Field>
        <Button size="md" disabled={!canCreate || !title.trim() || !audienceReady || isPending} onClick={review}>
          {isPending && confirmCount === null ? "Counting…" : "Send…"}
        </Button>
      </CardBody>

      <ConfirmDialog
        open={confirmCount !== null}
        title={`Send to ${confirmCount ?? 0} ${confirmCount === 1 ? "person" : "people"}?`}
        body={
          <>
            <span className="font-medium">{title}</span> will land in their bell
            {` and, where alerts are on, buzz their phone. You can take it out of the bells later from the Log — a phone that already buzzed keeps it.`}
          </>
        }
        confirmLabel="Send"
        tone="primary"
        isPending={isPending}
        onConfirm={send}
        onCancel={() => setConfirmCount(null)}
      />
    </Card>
  );
}
