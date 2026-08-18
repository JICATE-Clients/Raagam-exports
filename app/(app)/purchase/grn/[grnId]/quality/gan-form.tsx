"use client";

import { useState, useTransition } from "react";
import { createGanCheck, addGanParameter, completeGanCheck } from "@/lib/purchase/gan-actions";
import type { GanResult } from "@/lib/purchase/gan-types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { useUnsavedGuard } from "@/lib/reload-guard";

type ParamRow = {
  parameter_name: string;
  method: string;
  spec_min: string;
  spec_max: string;
  actual_value: string;
  unit: string;
  result: "pass" | "fail" | "";
};

function emptyParam(): ParamRow {
  return { parameter_name: "", method: "", spec_min: "", spec_max: "", actual_value: "", unit: "", result: "" };
}

export function GanForm({ grnId }: { grnId: string }) {
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState("");
  const [overallResult, setOverallResult] = useState<GanResult>("pass");
  const [params, setParams] = useState<ParamRow[]>([emptyParam()]);

  const dirty = params.some((p) => p.parameter_name.trim());
  useUnsavedGuard(open && (dirty || isPending));

  function reset() {
    setNotes("");
    setOverallResult("pass");
    setParams([emptyParam()]);
    setOpen(false);
  }

  function updateParam(idx: number, key: keyof ParamRow, val: string) {
    setParams((prev) => prev.map((p, i) => (i === idx ? { ...p, [key]: val } : p)));
  }

  function handleSubmit() {
    startTransition(async () => {
      // create the check
      const checkResult = await createGanCheck({
        grn_id: grnId,
        notes: notes.trim() || null,
      });
      if (!checkResult.ok) {
        toastError(checkResult.error);
        return;
      }

      // add parameters
      const validParams = params.filter((p) => p.parameter_name.trim());
      for (let i = 0; i < validParams.length; i++) {
        const p = validParams[i];
        await addGanParameter(grnId, {
          check_id: checkResult.checkId,
          parameter_name: p.parameter_name.trim(),
          method: p.method.trim() || null,
          spec_min: p.spec_min ? parseFloat(p.spec_min) : null,
          spec_max: p.spec_max ? parseFloat(p.spec_max) : null,
          actual_value: p.actual_value.trim() || null,
          unit: p.unit.trim() || null,
          result: p.result === "pass" || p.result === "fail" ? p.result : null,
          sort_order: i,
        });
      }

      // complete the check
      await completeGanCheck(checkResult.checkId, grnId, overallResult);

      success("Quality check created and completed.");
      reset();
    });
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>+ New Quality Check</Button>
      <Sheet open={open} onClose={() => setOpen(false)} title="GAN Quality Check" size="lg">
        <div className="space-y-4 p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label>Overall Result</Label>
              <Select value={overallResult} onChange={(e) => setOverallResult(e.target.value as GanResult)}>
                <option value="pass">Pass</option>
                <option value="fail">Fail</option>
                <option value="conditional">Conditional</option>
              </Select>
            </div>
            <div>
              <Label>Notes</Label>
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Quality check notes" />
            </div>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <Label>Parameters</Label>
              <Button size="sm" variant="outline" onClick={() => setParams((p) => [...p, emptyParam()])}>+ Add</Button>
            </div>
            <div className="space-y-2">
              {params.map((param, idx) => (
                <div key={idx} className="rounded border border-border p-2">
                  <div className="grid grid-cols-7 gap-2">
                    <div className="col-span-2">
                      <Input placeholder="Parameter *" value={param.parameter_name} onChange={(e) => updateParam(idx, "parameter_name", e.target.value)} />
                    </div>
                    <Input placeholder="Method" value={param.method} onChange={(e) => updateParam(idx, "method", e.target.value)} />
                    <Input type="number" placeholder="Min" value={param.spec_min} onChange={(e) => updateParam(idx, "spec_min", e.target.value)} />
                    <Input type="number" placeholder="Max" value={param.spec_max} onChange={(e) => updateParam(idx, "spec_max", e.target.value)} />
                    <Input placeholder="Actual" value={param.actual_value} onChange={(e) => updateParam(idx, "actual_value", e.target.value)} />
                    <div className="flex gap-1">
                      <Select value={param.result} onChange={(e) => updateParam(idx, "result", e.target.value)}>
                        <option value=""></option>
                        <option value="pass">Pass</option>
                        <option value="fail">Fail</option>
                      </Select>
                      {params.length > 1 && (
                        <Button size="sm" variant="ghost" className="text-danger" onClick={() => setParams((p) => p.filter((_, i) => i !== idx))}>X</Button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={reset}>Cancel</Button>
            <Button disabled={isPending || !params.some((p) => p.parameter_name.trim())} onClick={handleSubmit}>
              {isPending ? "Saving..." : "Save & Complete"}
            </Button>
          </div>
        </div>
      </Sheet>
    </>
  );
}
