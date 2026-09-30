"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Worker, WorkerAttendance, AttendanceInput } from "@/lib/hr/types";
import { WORKER_TYPE_LABELS } from "@/lib/hr/types";
import type { LocationOption } from "@/lib/hr/masters-service";
import { saveAttendanceBatch } from "@/lib/hr/attendance-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Toggle } from "@/components/ui/toggle";
import { useToast } from "@/components/ui/toast";
import { gridKeyNav } from "@/components/masters/child-grid";

interface RowState {
  present: boolean;
  normal_hours: number;
  ot_hours: number;
  extra_hours: number;
  source: "biometric" | "manual";
  note: string;
}

function makeDefault(existing?: WorkerAttendance): RowState {
  return {
    present: existing?.present ?? false,
    normal_hours: existing?.normal_hours ?? 0,
    ot_hours: existing?.ot_hours ?? 0,
    extra_hours: existing?.extra_hours ?? 0,
    source: existing?.source ?? "manual",
    note: existing?.note ?? "",
  };
}

export default function AttendanceClient({
  workers,
  attendanceByWorker,
  locations,
  selectedDate,
  selectedLocationId,
  maxOtPerDay,
}: {
  workers: Worker[];
  attendanceByWorker: Record<string, WorkerAttendance>;
  locations: LocationOption[];
  selectedDate: string;
  selectedLocationId: string | null;
  maxOtPerDay: number;
}) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();

  // Filter controls (local; changing them navigates to update server data)
  const [dateVal, setDateVal] = useState(selectedDate);
  const [locationVal, setLocationVal] = useState(selectedLocationId ?? "");

  // Per-worker row state
  const [rows, setRows] = useState<Record<string, RowState>>(() =>
    Object.fromEntries(
      workers.map((w) => [w.id, makeDefault(attendanceByWorker[w.id])]),
    ),
  );

  function navigate() {
    const params = new URLSearchParams();
    params.set("date", dateVal);
    if (locationVal) params.set("location", locationVal);
    router.push(`/hr/attendance?${params.toString()}`);
  }

  function setRow(workerId: string, patch: Partial<RowState>) {
    setRows((prev) => ({
      ...prev,
      [workerId]: { ...prev[workerId], ...patch },
    }));
  }

  function handleOtChange(workerId: string, raw: string) {
    const val = parseFloat(raw) || 0;
    const capped = Math.min(val, maxOtPerDay);
    setRow(workerId, { ot_hours: capped });
  }

  function handleSave() {
    startTransition(async () => {
      const payload: AttendanceInput[] = workers.map((w) => {
        const r = rows[w.id];
        return {
          worker_id: w.id,
          work_date: selectedDate,
          present: r.present,
          normal_hours: r.present ? r.normal_hours : 0,
          ot_hours: r.present ? r.ot_hours : 0,
          extra_hours: r.present ? r.extra_hours : 0,
          source: r.source,
          note: r.note || null,
        };
      });

      const result = await saveAttendanceBatch(payload);
      if (result.ok) {
        success("Attendance saved.");
        router.refresh();
      } else {
        toastError(result.error);
      }
    });
  }

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      {/* On a phone Date and Location share the row and Load wraps under
          them; from `sm` up they keep their fixed widths. */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1 sm:flex-none">
          <Label htmlFor="att-date">Date</Label>
          <Input
            id="att-date"
            type="date"
            value={dateVal}
            onChange={(e) => setDateVal(e.target.value)}
            className="w-full sm:w-40"
          />
        </div>
        <div className="min-w-0 flex-1 sm:flex-none">
          <Label htmlFor="att-loc">Location</Label>
          <Select
            id="att-loc"
            value={locationVal}
            onChange={(e) => setLocationVal(e.target.value)}
            className="w-full sm:w-48"
          >
            <option value="">All Locations</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </Select>
        </div>
        <Button variant="outline" size="sm" onClick={navigate}>
          Load
        </Button>
      </div>

      {workers.length === 0 ? (
        <p className="text-sm text-muted-foreground py-8 text-center">
          No active workers for the selected filters.
        </p>
      ) : (
        <>
          {/* PHONE: ONE CARD PER WORKER. The table below is eight columns of
              inputs, so under `md` typing an OT figure meant scrolling sideways
              inside the grid ("a grid wraps; it never scrolls sideways",
              raagam-screen-layout). The same row state drives both, so a value
              typed here is the value the table shows at a wider width. */}
          <div className="space-y-3 md:hidden">
            {workers.map((w) => {
              const r = rows[w.id];
              const otCapped = r.ot_hours > maxOtPerDay;
              return (
                <div
                  key={w.id}
                  className="space-y-3 rounded-lg border border-border bg-surface p-3"
                >
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="font-medium">{w.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {[w.code, WORKER_TYPE_LABELS[w.worker_type]]
                          .filter(Boolean)
                          .join(" · ")}
                      </div>
                    </div>
                    <Toggle
                      checked={r.present}
                      onChange={(v) => setRow(w.id, { present: v })}
                      label="Present"
                    />
                  </div>
                  {/* responsive: exempt -- phone-only card; three short hour boxes (~100px each) fit 360px */}
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <Label htmlFor={`att-hrs-${w.id}`}>Hrs</Label>
                      <Input
                        id={`att-hrs-${w.id}`}
                        type="number"
                        min={0}
                        step={0.5}
                        value={r.normal_hours}
                        disabled={!r.present}
                        onChange={(e) =>
                          setRow(w.id, {
                            normal_hours: parseFloat(e.target.value) || 0,
                          })
                        }
                        className="w-full text-right tabular-nums"
                      />
                    </div>
                    <div>
                      <Label htmlFor={`att-ot-${w.id}`}>
                        OT Hrs
                        {otCapped && (
                          <span className="ml-1 text-xs text-warning">
                            capped
                          </span>
                        )}
                      </Label>
                      <Input
                        id={`att-ot-${w.id}`}
                        type="number"
                        min={0}
                        step={0.5}
                        value={r.ot_hours}
                        disabled={!r.present}
                        onChange={(e) => handleOtChange(w.id, e.target.value)}
                        className="w-full text-right tabular-nums"
                      />
                    </div>
                    <div>
                      <Label htmlFor={`att-extra-${w.id}`}>Extra Hrs</Label>
                      <Input
                        id={`att-extra-${w.id}`}
                        type="number"
                        min={0}
                        step={0.5}
                        value={r.extra_hours}
                        disabled={!r.present}
                        onChange={(e) =>
                          setRow(w.id, {
                            extra_hours: parseFloat(e.target.value) || 0,
                          })
                        }
                        className="w-full text-right tabular-nums"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-2">
                    <div>
                      <Label htmlFor={`att-src-${w.id}`}>Source</Label>
                      <Select
                        id={`att-src-${w.id}`}
                        value={r.source}
                        onChange={(e) =>
                          setRow(w.id, {
                            source: e.target.value as "biometric" | "manual",
                          })
                        }
                        className="w-full"
                      >
                        <option value="manual">Manual</option>
                        <option value="biometric">Biometric</option>
                      </Select>
                    </div>
                    <div>
                      <Label htmlFor={`att-note-${w.id}`}>Note</Label>
                      <Input
                        id={`att-note-${w.id}`}
                        value={r.note}
                        placeholder="optional"
                        onChange={(e) =>
                          setRow(w.id, { note: e.target.value })
                        }
                        className="w-full"
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="hidden overflow-x-auto rounded-lg border border-border bg-surface md:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-surface-muted">
                  <th className="px-3 py-2 text-left text-xs font-bold text-muted-foreground">
                    Worker
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-bold text-muted-foreground">
                    Type
                  </th>
                  <th className="px-3 py-2 text-center text-xs font-bold text-muted-foreground w-16">
                    Present
                  </th>
                  <th className="px-3 py-2 text-right text-xs font-bold text-muted-foreground w-24">
                    Hrs
                  </th>
                  <th className="px-3 py-2 text-right text-xs font-bold text-muted-foreground w-24">
                    OT Hrs
                  </th>
                  <th className="px-3 py-2 text-right text-xs font-bold text-muted-foreground w-24">
                    Extra Hrs
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-bold text-muted-foreground w-24">
                    Source
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-bold text-muted-foreground">
                    Note
                  </th>
                </tr>
              </thead>
              {/* data-grid-body / data-grid-row give this batch-entry table
                  Excel-style row navigation: ↓/↑ move to the same column one
                  worker up or down, instead of walking every cell in the row.
                  See gridKeyNav in components/masters/child-grid.tsx — the same
                  markers ChildGrid emits, so a hand-rolled table gets identical
                  behaviour without adopting the component. */}
              <tbody data-grid-body onKeyDown={(e) => gridKeyNav(e)}>
                {workers.map((w) => {
                  const r = rows[w.id];
                  const otCapped = r.ot_hours > maxOtPerDay;
                  return (
                    <tr
                      key={w.id}
                      data-grid-row
                      className="border-b border-border last:border-0 hover:bg-surface-muted/60"
                    >
                      <td className="px-3 py-1.5 align-middle">
                        <div className="font-medium">{w.name}</div>
                        {w.code && (
                          <div className="text-xs font-mono text-muted-foreground">
                            {w.code}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-1.5 align-middle text-xs text-muted-foreground">
                        {WORKER_TYPE_LABELS[w.worker_type]}
                      </td>
                      <td className="px-3 py-1.5 align-middle text-center">
                        <input
                          type="checkbox"
                          checked={r.present}
                          onChange={(e) =>
                            setRow(w.id, { present: e.target.checked })
                          }
                          className="h-4 w-4 cursor-pointer"
                        />
                      </td>
                      <td className="px-3 py-1.5 align-middle">
                        <Input
                          type="number"
                          min={0}
                          step={0.5}
                          value={r.normal_hours}
                          disabled={!r.present}
                          onChange={(e) =>
                            setRow(w.id, {
                              normal_hours: parseFloat(e.target.value) || 0,
                            })
                          }
                          className="w-20 text-right tabular-nums"
                        />
                      </td>
                      <td className="px-3 py-1.5 align-middle">
                        <div className="relative">
                          <Input
                            type="number"
                            min={0}
                            step={0.5}
                            value={r.ot_hours}
                            disabled={!r.present}
                            onChange={(e) =>
                              handleOtChange(w.id, e.target.value)
                            }
                            className="w-20 text-right tabular-nums"
                          />
                          {otCapped && (
                            <span className="absolute -top-4 right-0 text-xs text-warning">
                              capped
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-1.5 align-middle">
                        <Input
                          type="number"
                          min={0}
                          step={0.5}
                          value={r.extra_hours}
                          disabled={!r.present}
                          onChange={(e) =>
                            setRow(w.id, {
                              extra_hours: parseFloat(e.target.value) || 0,
                            })
                          }
                          className="w-20 text-right tabular-nums"
                        />
                      </td>
                      <td className="px-3 py-1.5 align-middle">
                        <Select
                          value={r.source}
                          onChange={(e) =>
                            setRow(w.id, {
                              source: e.target.value as "biometric" | "manual",
                            })
                          }
                          className="w-28"
                        >
                          <option value="manual">Manual</option>
                          <option value="biometric">Biometric</option>
                        </Select>
                      </td>
                      <td className="px-3 py-1.5 align-middle">
                        <Input
                          value={r.note}
                          placeholder="optional"
                          onChange={(e) =>
                            setRow(w.id, { note: e.target.value })
                          }
                          className="w-32"
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-muted-foreground">
              Max OT per day: <strong>{maxOtPerDay} hrs</strong>. Entries exceeding
              the limit are capped automatically on save.
            </p>
            <Button
              variant="primary"
              size="sm"
              disabled={isPending}
              onClick={handleSave}
            >
              {isPending ? "Saving…" : "Save Attendance"}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
