"use client";

import { useState, useTransition } from "react";
import { useCreateIntent } from "@/lib/use-create-intent";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardHeader, CardTitle, CardBody } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";
import { createRun } from "@/lib/hr/payroll-actions";
import type { LocationOption } from "@/lib/hr/payroll-service";

export function NewRunForm({ locations }: { locations: LocationOption[] }) {
  const [open, setOpen] = useState(false);
  useCreateIntent(() => setOpen(true));
  const [pending, startTransition] = useTransition();
  const { success, error } = useToast();
  const router = useRouter();

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);

    startTransition(async () => {
      const result = await createRun({
        run_kind: fd.get("run_kind") as "worker" | "staff",
        period_type: fd.get("period_type") as "weekly" | "monthly",
        period_start: fd.get("period_start") as string,
        period_end: fd.get("period_end") as string,
        location_id: (fd.get("location_id") as string) || null,
        notes: (fd.get("notes") as string) || null,
      });

      if (result.ok) {
        success("Payroll run created");
        setOpen(false);
        router.push(`/hr/payroll/${result.runId}`);
      } else {
        error(result.error);
      }
    });
  }

  if (!open) {
    return (
      <Button onClick={() => setOpen(true)} size="sm">
        New run
      </Button>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>New payroll run</CardTitle>
        <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </CardHeader>
      <CardBody>
        <form onSubmit={handleSubmit} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor="run_kind">Run kind</Label>
            <Select id="run_kind" name="run_kind" required defaultValue="worker">
              <option value="worker">Worker (weekly)</option>
              <option value="staff">Staff (monthly)</option>
            </Select>
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor="period_type">Period type</Label>
            <Select id="period_type" name="period_type" required defaultValue="weekly">
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </Select>
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor="location_id">Location (optional)</Label>
            <Select id="location_id" name="location_id">
              <option value="">All locations</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.code ? `${l.code} — ` : ""}{l.name}
                </option>
              ))}
            </Select>
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor="period_start">Period start</Label>
            <Input id="period_start" name="period_start" type="date" required />
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor="period_end">Period end</Label>
            <Input id="period_end" name="period_end" type="date" required />
          </div>

          <div className="flex flex-col gap-1 sm:col-span-2 lg:col-span-3">
            <Label htmlFor="notes">Notes</Label>
            <Textarea id="notes" name="notes" rows={2} placeholder="Optional remarks" />
          </div>

          <div className="flex items-center gap-2 sm:col-span-2 lg:col-span-3">
            <Button type="submit" disabled={pending}>
              {pending ? "Creating…" : "Create run"}
            </Button>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}
