"use client";

import { useState, useTransition } from "react";
import { Sheet } from "@/components/ui/sheet";
import { Field, FieldRow } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { fmtDateTime } from "@/lib/format";
import {
  setDeviceApproval,
  updateDeviceSetup,
  refetchDeviceHistory,
} from "@/lib/hr/punch-actions";
import type { DeviceRow } from "@/lib/hr/punch-service";

/**
 * SETTING UP A READER. Opened from a device on the Live screen.
 *
 * `size="sm"` — a `[Click]`-opened sub-detail with no document behind it
 * (AGENTS.md "A sub-detail Sheet's size"); its content is a short field list,
 * not a `ChildGrid`, so `md` would leave a blank pane.
 *
 * It is the only screen that can ask a device for its history again, which is
 * why the explanation of what that does lives here rather than in a tooltip.
 */
export default function DeviceSheet({
  device,
  locations,
  onClose,
}: {
  device: DeviceRow;
  locations: { id: string; name: string }[];
  onClose: () => void;
}) {
  const [name, setName] = useState(device.name ?? "");
  const [locationId, setLocationId] = useState(device.location_id ?? "");
  const [direction, setDirection] = useState(device.direction);
  const [from, setFrom] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    start(async () => {
      setMsg(null);
      const r = await fn();
      if (!r.ok) setMsg(r.error ?? "That did not work.");
      else onClose();
    });

  return (
    <Sheet
      open
      onClose={onClose}
      size="sm"
      title={`Device ${device.name || device.serial_no}`}
    >
      <div className="space-y-5">
        <FieldRow>
          <Field label="Name" w="name">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="GATE-1 IN"
            />
          </Field>
        </FieldRow>

        <FieldRow>
          <Field label="Unit" w="party">
            <Select
              value={locationId}
              onChange={(e) => setLocationId(e.target.value)}
            >
              <option value="">Not assigned</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </Select>
          </Field>
          {/*
            DIRECTION IS A PROPERTY OF THE READER, not of the punch: one device
            at the way in, one at the way out. It is COPIED onto each punch as
            it lands, so changing it here affects punches from now on and never
            rewrites what last month meant.
          */}
          <Field label="Punches count as" w="term">
            <Select
              value={direction}
              onChange={(e) =>
                setDirection(e.target.value as DeviceRow["direction"])
              }
            >
              <option value="in">Coming in</option>
              <option value="out">Going out</option>
              <option value="both">Either way</option>
            </Select>
          </Field>
        </FieldRow>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            disabled={pending}
            onClick={() =>
              run(() =>
                updateDeviceSetup(device.serial_no, {
                  name: name.trim() || null,
                  location_id: locationId || null,
                  direction,
                }),
              )
            }
          >
            Save device
          </Button>
          <span className="text-xs text-muted-foreground">
            Serial {device.serial_no}
          </span>
        </div>

        <div className="space-y-2 border-t border-border pt-4">
          <p className="ty-label text-xs font-medium text-muted-foreground">
            Approval
          </p>
          <div className="flex items-center gap-3">
            <StatusPill tone={device.enabled ? "success" : "warning"}>
              {device.enabled ? "Approved" : "Pending approval"}
            </StatusPill>
            <Button
              variant="outline"
              disabled={pending}
              onClick={() =>
                run(() => setDeviceApproval(device.serial_no, !device.enabled))
              }
            >
              {device.enabled ? "Block this device" : "Approve this device"}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            A blocked reader is refused rather than ignored, so it keeps its
            punches and offers them again if you approve it later. Nothing is
            lost by blocking.
          </p>
        </div>

        <div className="space-y-2 border-t border-border pt-4">
          <p className="ty-label text-xs font-medium text-muted-foreground">
            History
          </p>
          <p className="text-sm">
            Recording punches from{" "}
            <span className="font-medium tabular-nums">
              {fmtDateTime(device.accept_from)}
            </span>
          </p>
          <FieldRow>
            <Field label="Re-fetch history from" w="code">
              <Input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
            </Field>
          </FieldRow>
          <Button
            variant="outline"
            disabled={pending || !from}
            onClick={() => run(() => refetchDeviceHistory(device.serial_no, from))}
          >
            Ask the device for its history
          </Button>
          {/*
            SAYING WHAT THIS ACTUALLY DOES, because the obvious reading is
            wrong. It does not fetch anything itself — it widens the window AND
            forgets how far this device had got, so the reader offers its stored
            punches again. Widening the window alone would do nothing at all,
            which is the trap `refetch_device_history()` exists to close.
          */}
          <p className="text-xs text-muted-foreground">
            This widens the window and forgets how far this reader had got, so
            it offers its stored punches again from that date. Anything already
            recorded is ignored, so it is safe to repeat.{" "}
            <span className="font-medium">
              Restart the device afterwards
            </span>{" "}
            — it only asks for its settings when it boots or reconnects, not on
            every heartbeat.
          </p>
        </div>

        {msg ? <p className="text-sm text-danger">{msg}</p> : null}
      </div>
    </Sheet>
  );
}
