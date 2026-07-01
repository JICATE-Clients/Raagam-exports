"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { PayrollSettings, PayrollSettingsInput } from "@/lib/hr/types";
import { updateSettings } from "@/lib/hr/masters-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardBody } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";

function toFormState(s: PayrollSettings): PayrollSettingsInput {
  return {
    ot_multiplier: s.ot_multiplier,
    max_ot_hours_per_day: s.max_ot_hours_per_day,
    max_ot_hours_per_month: s.max_ot_hours_per_month,
    esi_rate: s.esi_rate,
    pf_rate: s.pf_rate,
    currency: s.currency,
  };
}

export default function SettingsClient({
  settings,
  canEdit,
}: {
  settings: PayrollSettings | null;
  canEdit: boolean;
}) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();
  const [form, setForm] = useState<PayrollSettingsInput>(
    settings
      ? toFormState(settings)
      : {
          ot_multiplier: 2,
          max_ot_hours_per_day: 4,
          max_ot_hours_per_month: 50,
          esi_rate: 0.0075,
          pf_rate: 0.12,
          currency: "INR",
        },
  );

  if (!settings) {
    return (
      <Card>
        <CardBody>
          <p className="text-sm text-muted-foreground">
            No payroll settings found. Contact an administrator to seed the settings row.
          </p>
        </CardBody>
      </Card>
    );
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const result = await updateSettings(settings!.id, form);
      if (result.ok) {
        success("Settings saved.");
        router.refresh();
      } else {
        toastError(result.error);
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Payroll Configuration</CardTitle>
      </CardHeader>
      <CardBody>
        <form onSubmit={handleSubmit} className="grid grid-cols-2 gap-4 max-w-lg">
          {/* OT */}
          <div>
            <Label htmlFor="ps-ot-mult">OT Multiplier</Label>
            <Input
              id="ps-ot-mult"
              type="number"
              min={1}
              step={0.1}
              value={form.ot_multiplier}
              disabled={!canEdit}
              onChange={(e) =>
                setForm({ ...form, ot_multiplier: parseFloat(e.target.value) || 1 })
              }
            />
          </div>
          <div>
            <Label htmlFor="ps-currency">Currency</Label>
            <Input
              id="ps-currency"
              value={form.currency}
              maxLength={3}
              disabled={!canEdit}
              onChange={(e) =>
                setForm({ ...form, currency: e.target.value.toUpperCase() })
              }
            />
          </div>
          <div>
            <Label htmlFor="ps-max-ot-day">Max OT Hours / Day</Label>
            <Input
              id="ps-max-ot-day"
              type="number"
              min={0}
              step={0.5}
              value={form.max_ot_hours_per_day}
              disabled={!canEdit}
              onChange={(e) =>
                setForm({
                  ...form,
                  max_ot_hours_per_day: parseFloat(e.target.value) || 0,
                })
              }
            />
          </div>
          <div>
            <Label htmlFor="ps-max-ot-month">Max OT Hours / Month</Label>
            <Input
              id="ps-max-ot-month"
              type="number"
              min={0}
              step={1}
              value={form.max_ot_hours_per_month}
              disabled={!canEdit}
              onChange={(e) =>
                setForm({
                  ...form,
                  max_ot_hours_per_month: parseFloat(e.target.value) || 0,
                })
              }
            />
          </div>

          {/* Statutory rates — shown as percentage in the UI */}
          <div>
            <Label htmlFor="ps-esi">ESI Rate (%)</Label>
            <Input
              id="ps-esi"
              type="number"
              min={0}
              max={100}
              step={0.01}
              value={(form.esi_rate * 100).toFixed(4)}
              disabled={!canEdit}
              onChange={(e) =>
                setForm({
                  ...form,
                  esi_rate: parseFloat(e.target.value) / 100 || 0,
                })
              }
            />
          </div>
          <div>
            <Label htmlFor="ps-pf">PF Rate (%)</Label>
            <Input
              id="ps-pf"
              type="number"
              min={0}
              max={100}
              step={0.01}
              value={(form.pf_rate * 100).toFixed(4)}
              disabled={!canEdit}
              onChange={(e) =>
                setForm({
                  ...form,
                  pf_rate: parseFloat(e.target.value) / 100 || 0,
                })
              }
            />
          </div>

          {canEdit && (
            <div className="col-span-2 flex justify-end pt-1">
              <Button type="submit" variant="primary" size="sm" disabled={isPending}>
                {isPending ? "Saving…" : "Save Settings"}
              </Button>
            </div>
          )}
        </form>

        {!canEdit && (
          <p className="mt-3 text-xs text-muted-foreground">
            You have view-only access. Contact an admin to modify settings.
          </p>
        )}
      </CardBody>
    </Card>
  );
}
