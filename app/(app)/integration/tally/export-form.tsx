"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { generateTallyExport } from "@/lib/integration/actions";
import { EXPORT_TYPES, EXPORT_TYPE_LABELS } from "@/lib/integration/types";
import type { ExportType } from "@/lib/integration/types";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardBody } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";

export function ExportForm() {
  const [exportType, setExportType] = useState<ExportType>("sales_invoices");
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const { success, error: toastError } = useToast();

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    startTransition(async () => {
      const result = await generateTallyExport({
        export_type: exportType,
        period_start: periodStart || null,
        period_end: periodEnd || null,
      });
      if (result.ok) {
        success("Export generated successfully");
        router.push(`/integration/tally/${result.exportId}`);
      } else {
        toastError(result.error ?? "Export failed");
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Generate Tally Export</CardTitle>
      </CardHeader>
      <CardBody>
        <form onSubmit={handleSubmit} className="space-y-4 max-w-sm">
          <div className="space-y-1">
            <Label htmlFor="export_type">Export Type</Label>
            <Select
              id="export_type"
              value={exportType}
              onChange={(e) => setExportType(e.target.value as ExportType)}
            >
              {EXPORT_TYPES.map((type) => (
                <option key={type} value={type}>
                  {EXPORT_TYPE_LABELS[type]}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="period_start">Period Start (optional)</Label>
            <Input
              id="period_start"
              type="date"
              value={periodStart}
              onChange={(e) => setPeriodStart(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="period_end">Period End (optional)</Label>
            <Input
              id="period_end"
              type="date"
              value={periodEnd}
              onChange={(e) => setPeriodEnd(e.target.value)}
            />
          </div>
          <Button type="submit" disabled={isPending}>
            {isPending ? "Generating…" : "Generate Export"}
          </Button>
        </form>
      </CardBody>
    </Card>
  );
}
