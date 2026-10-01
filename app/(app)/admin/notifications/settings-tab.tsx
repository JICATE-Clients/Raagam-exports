"use client";

import { useState, useTransition } from "react";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldRow } from "@/components/ui/field";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { cleanupNow, previewCleanup, saveRetention } from "@/lib/jobs/actions";
import type { Retention } from "@/lib/notifications/admin-types";

type Counts = { read: number; unread: number; log: number; jobRuns: number };

/**
 * HOW LONG THINGS ARE KEPT, and the cleanup that applies it (0677).
 *
 * Before this nothing ever deleted a notification. The housekeeping job
 * (Scheduled Jobs) now deletes by these numbers every night; "Clean up now"
 * does the same on demand — but only after counting what it would remove, by
 * the SAVED numbers, so an admin sees "214 alerts" before pressing anything.
 */
export function SettingsTab({
  retention,
  canEdit,
  canDelete,
}: {
  retention: Retention;
  canEdit: boolean;
  canDelete: boolean;
}) {
  const { success, error } = useToast();
  const [isPending, start] = useTransition();
  const [read, setRead] = useState(String(retention.readDays));
  const [unread, setUnread] = useState(String(retention.unreadDays));
  const [log, setLog] = useState(String(retention.logDays));
  const [jobRuns, setJobRuns] = useState(String(retention.jobRunDays));
  const [preview, setPreview] = useState<Counts | null>(null);

  const dirty =
    read !== String(retention.readDays) ||
    unread !== String(retention.unreadDays) ||
    log !== String(retention.logDays) ||
    jobRuns !== String(retention.jobRunDays);
  useUnsavedGuard(dirty || isPending);

  const save = () =>
    start(async () => {
      const res = await saveRetention({
        readDays: Number(read),
        unreadDays: Number(unread),
        logDays: Number(log),
        jobRunDays: Number(jobRuns),
      });
      if (res.ok) success("Saved — the nightly cleanup uses these from tonight");
      else error(res.error);
    });

  const count = () =>
    start(async () => {
      const res = await previewCleanup();
      if (!res.ok) error(res.error);
      else setPreview({ read: res.read, unread: res.unread, log: res.log, jobRuns: res.jobRuns });
    });

  const clean = () =>
    start(async () => {
      const res = await cleanupNow();
      setPreview(null);
      if (!res.ok) error(res.error);
      else success(`Cleaned up: ${res.read + res.unread} alerts, ${res.log} log rows, ${res.jobRuns} job runs`);
    });

  const total = preview ? preview.read + preview.unread + preview.log + preview.jobRuns : 0;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>How long to keep</CardTitle>
        </CardHeader>
        {/* A form on a page: the marker keeps Tab on its fields (keyboard contract). */}
        <CardBody className="space-y-3" data-focus-scope>
          {/* Two 144px day boxes a row: the LABELS set the width — "Unread alerts (days)" wrapped at 112px. */}
          <FieldRow>
            <Field label="Read alerts (days)" w="code" required>
              <Input type="number" min={7} max={3650} value={read} onChange={(e) => setRead(e.target.value)} disabled={!canEdit} />
            </Field>
            <Field label="Unread alerts (days)" w="code" required>
              <Input type="number" min={30} max={3650} value={unread} onChange={(e) => setUnread(e.target.value)} disabled={!canEdit} />
            </Field>
          </FieldRow>
          <FieldRow>
            <Field label="Alert log (days)" w="code" required>
              <Input type="number" min={30} max={3650} value={log} onChange={(e) => setLog(e.target.value)} disabled={!canEdit} />
            </Field>
            <Field label="Job runs (days)" w="code" required>
              <Input type="number" min={7} max={3650} value={jobRuns} onChange={(e) => setJobRuns(e.target.value)} disabled={!canEdit} />
            </Field>
          </FieldRow>
          <p className="text-xs text-muted-foreground">
            Unread alerts are kept at least as long as read ones — nothing is deleted before someone could have seen
            it. Deleting an alert removes it from that person&apos;s bell.
          </p>
          <Button size="md" disabled={!canEdit || !dirty || isPending} onClick={save}>
            {isPending ? "Saving…" : "Save"}
          </Button>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Clean up now</CardTitle>
        </CardHeader>
        <CardBody className="space-y-3">
          <p className="text-sm text-muted-foreground">
            The cleanup runs by itself every night at 3:00 am (Scheduled Jobs). Run it now to apply a change today. It
            uses the SAVED numbers, and counts first.
          </p>
          <Button variant="outline" size="md" disabled={!canDelete || isPending} onClick={count}>
            {isPending && !preview ? "Counting…" : "Count what would go…"}
          </Button>
          {!canDelete && (
            <p className="text-xs text-muted-foreground">Cleaning up needs the Delete permission on Administration.</p>
          )}
        </CardBody>
      </Card>

      <ConfirmDialog
        open={!!preview}
        title={total === 0 ? "Nothing to clean up" : `Delete ${total} old row${total === 1 ? "" : "s"}?`}
        body={
          preview && (
            <ul className="list-disc space-y-0.5 pl-5">
              <li>{preview.read} read alerts older than {retention.readDays} days</li>
              <li>{preview.unread} unread alerts older than {retention.unreadDays} days</li>
              <li>{preview.log} alert-log rows older than {retention.logDays} days</li>
              <li>{preview.jobRuns} job runs older than {retention.jobRunDays} days</li>
            </ul>
          )
        }
        confirmLabel={total === 0 ? "Close" : "Delete"}
        tone={total === 0 ? "primary" : "danger"}
        isPending={isPending}
        onConfirm={total === 0 ? () => setPreview(null) : clean}
        onCancel={() => setPreview(null)}
      />
    </div>
  );
}
