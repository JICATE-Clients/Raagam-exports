"use client";

import { useState, useTransition } from "react";
import { Sheet } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Toggle } from "@/components/ui/toggle";
import { MultiSelect } from "@/components/ui/multi-select";
import { useToast } from "@/components/ui/toast";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { fmtDateTime } from "@/lib/format";
import { saveEventSettings } from "@/lib/notifications/admin-actions";
import type { EventOverview, ReachablePerson } from "@/lib/notifications/admin-types";

/**
 * ONE ALERT'S SETTINGS — on/off, push, the admin fallback, and who is copied.
 *
 * What the admin can and cannot do here is the plan's §4, and the database
 * (0676 `notification_save_event`) refuses the same things this screen greys:
 *   - A MANDATORY alert's on/off switch is shown and LOCKED, with the reason.
 *     Hiding it would leave the admin wondering why one alert has no switch.
 *   - CC ADDS people. "Goes to" is the code's own recipient (the order's
 *     merchandiser, the step's approvers) and is never removable — a role
 *     picker cannot express "the merchandiser of THIS order".
 * Push is switchable on every alert, mandatory or not: the bell row still lands.
 */
export function EventSettingsSheet({
  event,
  roles,
  people,
  canEdit,
  onClose,
}: {
  event: EventOverview;
  roles: { id: string; name: string }[];
  people: ReachablePerson[];
  canEdit: boolean;
  onClose: () => void;
}) {
  const { success, error } = useToast();
  const [isPending, start] = useTransition();
  const [enabled, setEnabled] = useState(event.enabled);
  const [push, setPush] = useState(event.push);
  const [fallback, setFallback] = useState(event.fallbackToAdmins);
  const [ccRoles, setCcRoles] = useState<string[]>(event.ccRoleIds);
  const [ccUsers, setCcUsers] = useState<string[]>(event.ccUserIds);

  const same = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));
  const dirty =
    enabled !== event.enabled ||
    push !== event.push ||
    fallback !== event.fallbackToAdmins ||
    !same(ccRoles, event.ccRoleIds) ||
    !same(ccUsers, event.ccUserIds);
  useUnsavedGuard(dirty || isPending);

  // Disabled rows: an inactive login is not offered — unless it is already
  // copied, where it stays visible (greyed) rather than silently dropping.
  const personOptions = people
    .filter((p) => p.is_active || ccUsers.includes(p.user_id))
    .map((p) => ({
      id: p.user_id,
      label: p.full_name || p.email || "—",
      inactive: !p.is_active,
    }));

  const save = () =>
    start(async () => {
      const res = await saveEventSettings({
        key: event.key,
        enabled,
        push,
        fallbackToAdmins: fallback,
        ccRoles,
        ccUsers,
      });
      if (res.ok) {
        success(`${event.label} — saved`);
        onClose();
      } else error(res.error);
    });

  return (
    <Sheet
      open
      onClose={onClose}
      title={event.label}
      size="sm"
      footer={
        <>
          <Button variant="outline" size="md" onClick={onClose}>
            Cancel
          </Button>
          <Button size="md" disabled={!canEdit || !dirty || isPending} onClick={save}>
            {isPending ? "Saving…" : "Save"}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <div>
          <p className="text-xs font-semibold text-muted-foreground">Goes to</p>
          <p className="text-sm text-foreground">{event.audience}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Decided by the app for each record — it cannot be removed here, only added to.
          </p>
        </div>

        <div className="space-y-3">
          <div>
            <Toggle
              checked={enabled}
              onChange={setEnabled}
              label="Send this alert"
              disabled={!canEdit || event.mandatory}
            />
            {event.mandatory && (
              <p className="mt-1 text-xs text-muted-foreground">
                Always on: this alert is how a document leaves an approval queue. Switching it off would leave the
                document waiting with nobody told.
              </p>
            )}
            {!enabled && (
              <p className="mt-1 text-xs text-warning">
                Off: nothing is sent, and each one is still written to the Log as &quot;Switched off&quot;.
              </p>
            )}
          </div>
          <div>
            <Toggle checked={push} onChange={setPush} label="Phone & browser alert" disabled={!canEdit || !enabled} />
            <p className="mt-1 text-xs text-muted-foreground">
              Off: it still lands in the bell, without buzzing anyone&apos;s phone.
            </p>
          </div>
          <div>
            <Toggle
              checked={fallback}
              onChange={setFallback}
              label="If it reaches nobody, send it to the administrators"
              disabled={!canEdit || !enabled}
            />
          </div>
        </div>

        <div className="space-y-3">
          <p className="text-xs font-semibold text-muted-foreground">Also send to</p>
          <MultiSelect
            label="Roles"
            options={roles.map((r) => ({ id: r.id, label: r.name }))}
            values={ccRoles}
            onChange={setCcRoles}
            disabled={!canEdit || !enabled}
          />
          <MultiSelect
            label="People"
            options={personOptions}
            values={ccUsers}
            onChange={setCcUsers}
            disabled={!canEdit || !enabled}
          />
          <p className="text-xs text-muted-foreground">
            Everyone here gets every one of these alerts, on top of the people it normally goes to.
          </p>
        </div>

        {event.updatedAt && (
          <p className="text-xs text-muted-foreground">Last changed {fmtDateTime(event.updatedAt)}</p>
        )}
      </div>
    </Sheet>
  );
}
