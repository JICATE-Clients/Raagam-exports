"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { DataTable, type Column } from "@/components/ui/data-table";
import { withCreatedColumns } from "@/components/ui/created-columns";
import { Stat } from "@/components/ui/stat";
import { StatusPill } from "@/components/ui/status-pill";
import { Truncated } from "@/components/ui/truncated";
import type {
  DeviceRow,
  PunchRow,
  PunchIdentity,
} from "@/lib/hr/punch-service";
import DeviceSheet from "./device-sheet";

/**
 * WATCHING PUNCHES ARRIVE. The one screen that answers "is the device working?"
 * without anybody opening a database.
 *
 * It shows the RAW fact — which device, which user id as enrolled on that
 * device, when, and which way the device counts. No names: a punch's user id
 * belongs to the device, and which table of people it resolves against is a
 * decision nobody has made yet. Showing a blank name column would read as "we
 * don't know who this is" rather than "we haven't wired that up".
 *
 * Realtime rather than polling, and the subscription is still RLS-scoped —
 * Supabase evaluates the SELECT policy row by row, so a punch from a unit the
 * viewer is not allocated to never reaches this tab.
 */

/** A heartbeat arrives every ~30 s, so two minutes of silence is a problem. */
const ONLINE_WINDOW_MS = 2 * 60 * 1000;

const IST = "Asia/Kolkata";

/**
 * 12-hour with am/pm, like every other clock in the app (`fmtTime`,
 * `fmtDateTime` — user 2026-10-01: "not railway format"); seconds kept,
 * because two punches a few seconds apart are what this screen is read for.
 */
function istTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-IN", {
    timeZone: IST,
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
}

/**
 * THE GAP BETWEEN WHAT THE DEVICE CLAIMS AND WHEN IT REACHED US. A device whose
 * clock has drifted produces attendance that looks entirely plausible and is
 * simply wrong, and this column is the only thing on any screen that reveals
 * it. A live punch should land within a second or two; a backlog upload after
 * an outage legitimately shows hours, which is why the number is shown rather
 * than judged.
 */
function clockGap(punch: string, received: string) {
  const secs = Math.round(
    (new Date(received).getTime() - new Date(punch).getTime()) / 1000,
  );
  const abs = Math.abs(secs);
  if (abs < 90) return { text: `${secs}s`, tone: "neutral" as const };
  if (abs < 3600)
    return { text: `${Math.round(secs / 60)}m`, tone: "warning" as const };
  return { text: `${Math.round(secs / 3600)}h`, tone: "danger" as const };
}

/**
 * IS THIS DEVICE'S CLOCK WRONG? — and the hard part is telling drift apart
 * from a backlog, because both produce big clock gaps.
 *
 * The discriminator is the SMALLEST gap, not the average. A device whose clock
 * is wrong offsets EVERY punch by roughly the same amount, so even its newest
 * punch arrives late. A device uploading history after an outage has huge gaps
 * on the old lines and a small one on whatever it recorded most recently — so
 * one small gap is enough to say the clock is fine.
 *
 * Three punches minimum: a single reading is a round-trip, not a pattern.
 */
const CLOCK_WARN_SECONDS = 10 * 60;

function clockHealth(rows: PunchRow[]) {
  if (rows.length < 3) return null;
  const gaps = rows.map(
    (p) => (new Date(p.received_at).getTime() - new Date(p.punch_time).getTime()) / 1000,
  );
  const smallest = Math.min(...gaps.map(Math.abs));
  if (smallest <= CLOCK_WARN_SECONDS) return null;
  // Sign of the typical gap: received later than claimed = the clock is behind.
  const mid = [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)];
  return {
    minutes: Math.round(smallest / 60),
    behind: mid > 0,
  };
}

const DIRECTION: Record<
  PunchRow["direction"],
  { label: string; tone: "success" | "info" | "neutral" }
> = {
  in: { label: "In", tone: "success" },
  out: { label: "Out", tone: "info" },
  both: { label: "Either way", tone: "neutral" },
};

interface Props {
  devices: DeviceRow[];
  punches: PunchRow[];
  /** device id -> person, for DISPLAY only. No attendance is derived from it. */
  identities: Record<string, PunchIdentity>;
  locations: { id: string; name: string }[];
  todayCount: number;
  /** Start of today in IST, from the server. */
  todayFromIso: string;
  /** The server's clock at render, so the client never calls Date.now() in a render. */
  serverNowIso: string;
}

export default function LiveClient({
  devices: initialDevices,
  punches: initialPunches,
  identities,
  locations,
  todayCount: initialTodayCount,
  todayFromIso,
  serverNowIso,
}: Props) {
  const supabase = useMemo(() => createClient(), []);

  /**
   * ONE CHANNEL PER MOUNT. supabase-js hands back the SAME channel object for a
   * repeated name, and adding an `.on()` to a channel that has already
   * subscribed throws and takes the route down — the failure
   * `lib/notifications/use-notifications.ts` records when a second bell
   * mounted. `useId` makes a second copy of this screen harmless.
   */
  const instance = useId().replace(/[^A-Za-z0-9]/g, "");

  const [devices, setDevices] = useState(initialDevices);
  const [punches, setPunches] = useState(initialPunches);
  const [todayCount, setTodayCount] = useState(initialTodayCount);

  /**
   * The clock STARTS from the server's and is advanced by a timer. Reading
   * `Date.now()` during a render is impure — the React Compiler refuses it —
   * and it would also be the wrong clock: a machine whose time is days out
   * would paint every device offline.
   */
  const [now, setNow] = useState(() => Date.parse(serverNowIso));
  const [setupSerial, setSetupSerial] = useState<string | null>(null);

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 15_000);

    /**
     * REALTIME IS THE FAST PATH, NOT THE ONLY ONE. A channel that drops
     * quietly — a laptop asleep, a tab in the background, Wi-Fi blinking —
     * stops delivering `last_seen` while the clock above keeps ticking, so a
     * healthy device read OFFLINE after two minutes and stayed that way until
     * the page was reloaded (reported 2026-10-26 as "offline until restarted").
     *
     * So the device list is also re-read every 30 s and whenever the tab comes
     * back. Straight from the browser through the viewer's session (RLS, same
     * as `listDevices`), not a server round trip; skipped while the tab is
     * hidden, so a forgotten tab costs nothing. Columns match `listDevices`.
     */
    const refreshDevices = async () => {
      if (document.hidden) return;
      const { data, error } = await supabase
        .from("biometric_devices")
        .select(
          "serial_no, name, location_id, direction, purpose, is_active, last_seen, last_ip, last_attlog_stamp, enabled, accept_from",
        )
        .order("last_seen", { ascending: false, nullsFirst: false });
      if (error) {
        console.error("[live] device refresh failed", error);
        return;
      }
      setDevices((data ?? []) as DeviceRow[]);
      setNow(Date.now());
    };
    const poll = setInterval(() => void refreshDevices(), 30_000);
    const onVisible = () => {
      if (!document.hidden) void refreshDevices();
    };
    document.addEventListener("visibilitychange", onVisible);

    const channel = supabase
      .channel(`hr-punches:${instance}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "punches" },
        (payload) => {
          const p = payload.new as PunchRow;
          /**
           * A BACKLOG UPLOAD IS NOT NEWS. A device coming back from an outage
           * re-sends days of stored punches, and each one arrives here as a
           * fresh INSERT — dropping them at the top of today's feed would make
           * last week look like this minute. The feed is today's; the count
           * counts today.
           */
          if (p.punch_time < todayFromIso) return;
          setPunches((prev) => [p, ...prev.filter((x) => x.id !== p.id)]);
          setTodayCount((n) => n + 1);
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "biometric_devices" },
        (payload) => {
          const d = payload.new as DeviceRow;
          if (!d?.serial_no) return;
          setDevices((prev) => {
            const next = prev.filter((x) => x.serial_no !== d.serial_no);
            return [d, ...next];
          });
          // A device dialling in is the clock we care about most.
          setNow(Date.now());
        },
      )
      .subscribe();

    return () => {
      clearInterval(tick);
      clearInterval(poll);
      document.removeEventListener("visibilitychange", onVisible);
      void supabase.removeChannel(channel);
    };
  }, [supabase, instance, todayFromIso]);

  const online = devices.filter(
    (d) => d.last_seen && now - Date.parse(d.last_seen) < ONLINE_WINDOW_MS,
  ).length;

  const unassigned = devices.filter((d) => !d.location_id).length;
  const pending = devices.filter((d) => !d.enabled).length;

  /** Devices whose clock looks wrong, judged from today's own punches. */
  const clockSuspect = useMemo(() => {
    const out: { serial: string; label: string; minutes: number; behind: boolean }[] = [];
    for (const d of devices) {
      const h = clockHealth(punches.filter((p) => p.device_sn === d.serial_no));
      if (h) out.push({ serial: d.serial_no, label: d.name || d.serial_no, ...h });
    }
    return out;
  }, [devices, punches]);

  const deviceLabel = useMemo(() => {
    const m: Record<string, string> = {};
    devices.forEach((d) => (m[d.serial_no] = d.name || d.serial_no));
    return m;
  }, [devices]);

  const columns: Column<PunchRow>[] = [
    {
      header: "Time",
      cell: (p) => <span className="tabular-nums">{istTime(p.punch_time)}</span>,
    },
    {
      /**
       * DISPLAY ONLY (pilot, 2026-10-23). Matched on the id enrolled on the
       * reader; nothing here is written anywhere or used to compute hours.
       * An unmatched id is named as such rather than blanked — a blank cell
       * reads as "nobody punched" instead of "nobody is mapped to this id".
       */
      header: "Person",
      cell: (p) => {
        const who = identities[p.user_id];
        if (!who)
          return (
            <span className="text-muted-foreground">Unknown ID {p.user_id}</span>
          );
        return (
          <span className="flex items-center gap-1.5">
            <Truncated>{who.name}</Truncated>
            {who.kind === "staff" ? (
              <span className="text-xs text-muted-foreground">staff</span>
            ) : null}
            {who.conflict ? (
              <StatusPill tone="danger">Duplicate ID</StatusPill>
            ) : null}
          </span>
        );
      },
    },
    {
      header: "Device",
      cell: (p) => <Truncated>{deviceLabel[p.device_sn] ?? p.device_sn}</Truncated>,
    },
    {
      header: "User ID on device",
      cell: (p) => <span className="tabular-nums">{p.user_id}</span>,
    },
    {
      header: "Counts as",
      cell: (p) => {
        const d = DIRECTION[p.direction] ?? DIRECTION.both;
        return <StatusPill tone={d.tone}>{d.label}</StatusPill>;
      },
    },
    {
      header: "Clock gap",
      align: "right",
      cell: (p) => {
        const g = clockGap(p.punch_time, p.received_at);
        return (
          <span
            className={
              g.tone === "danger"
                ? "tabular-nums text-danger"
                : g.tone === "warning"
                  ? "tabular-nums text-warning"
                  : "tabular-nums text-muted-foreground"
            }
          >
            {g.text}
          </span>
        );
      },
    },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="Devices online"
          value={`${online} / ${devices.length}`}
          tone={devices.length === 0 ? "neutral" : online ? "success" : "danger"}
          hint="Heartbeat within 2 minutes"
        />
        <Stat label="Punches today" value={todayCount} tone="info" />
        <Stat
          label="Last punch"
          value={punches[0] ? istTime(punches[0].punch_time) : "—"}
          hint={punches[0] ? deviceLabel[punches[0].device_sn] : "Nothing yet"}
        />
        <Stat
          label="Awaiting approval"
          value={pending}
          tone={pending ? "warning" : "neutral"}
          hint={
            unassigned
              ? `${unassigned} also with no unit`
              : "New devices arrive pending"
          }
        />
      </div>

      {/*
        A DEVICE THAT HAS NEVER DIALLED IN IS THE COMMON FIRST STATE, and
        "no devices" with no explanation reads as a broken screen rather than
        an unfinished setup. This names the cause, which is the one kind of
        empty state the layout rules keep.
      */}
      {devices.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No biometric device has connected yet. A device appears here by itself
          the first time it reaches the ERP — nothing needs creating.
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {devices.map((d) => {
            const isOnline =
              !!d.last_seen && now - Date.parse(d.last_seen) < ONLINE_WINDOW_MS;
            return (
              <button
                key={d.serial_no}
                type="button"
                onClick={() => setSetupSerial(d.serial_no)}
                title="Set up this device"
                className="rounded-control focus-visible:outline-2 focus-visible:outline-ring"
              >
              <StatusPill
                tone={!d.enabled ? "warning" : isOnline ? "success" : "danger"}
              >
                {!d.enabled
                  ? "Pending approval"
                  : isOnline
                    ? "Online"
                    : "Offline"}{" "}
                · {d.name || d.serial_no}
                {d.direction !== "both" ? ` · ${DIRECTION[d.direction].label}` : ""}
              </StatusPill>
              </button>
            );
          })}
        </div>
      )}

      {/*
        `withCreatedColumns` is a DELIBERATE NO-OP here and still belongs: a
        punch has no creator — it is an event a device recorded, not a row
        somebody entered — and the helper self-hides when the rows carry no
        `created_at`, which punches never will (they carry `received_at`, shown
        above as the clock gap). Calling it anyway is how the rule stays true
        without a per-file opt-out that cannot tell a listing that is exempt
        from one that forgot.
      */}
      {/*
        A WRONG DEVICE CLOCK IS THE FAILURE THAT LOOKS LIKE SUCCESS. Attendance
        is always derived from `punch_time`, the device's own clock — never from
        when we received it — so a reader running 40 minutes slow produces
        plausible, wrong hours and plausible, wrong wages. Nothing else on any
        screen says so, which is why this sits above the feed rather than in it.
      */}
      {clockSuspect.length > 0 ? (
        <div className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
          {clockSuspect.map((c) => (
            <p key={c.serial}>
              <span className="font-medium">{c.label}</span>: clock looks about{" "}
              <span className="tabular-nums">{c.minutes} min</span>{" "}
              {c.behind ? "behind" : "ahead"}. Every punch from it is being
              recorded at the wrong time — set the device&apos;s date and time to
              IST.
            </p>
          ))}
        </div>
      ) : null}

      <DataTable
        columns={withCreatedColumns(columns, punches)}
        rows={punches}
        getKey={(p) => String(p.id)}
        empty="No punches today yet."
        dense
      />

      {setupSerial ? (
        <DeviceSheet
          device={devices.find((d) => d.serial_no === setupSerial)!}
          locations={locations}
          onClose={() => setSetupSerial(null)}
        />
      ) : null}
    </div>
  );
}
