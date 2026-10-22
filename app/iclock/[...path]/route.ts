/**
 * THE GATE'S ENDPOINT — where a biometric device posts every punch.
 *
 * An eSSL / ZKTeco device speaks ADMS "push": it dials OUT to an address typed
 * into its own menu and posts each punch as it happens. Nothing is installed at
 * the client site, nothing polls, and no PC sits in between — which is the whole
 * requirement ("no dependency on any person or system").
 *
 *   device ──HTTP──► Cloudflare Worker ──HTTPS──► this route ──► punches
 *
 * THE WORKER EXISTS FOR ONE REASON: the uFace 302's Cloud Server screen offers
 * Server Address and Server Port and no HTTPS switch at all, while Vercel
 * answers plain HTTP with a 308 that cannot be turned off — and the device does
 * not follow redirects. The Worker is stateless: it translates and forwards.
 * A device that CAN do HTTPS (ZKTeco SpeedFace-V5L, the AiFace range) posts
 * here directly and the Worker is simply not used; this file does not change.
 *
 * OUTSIDE `app/(app)` DELIBERATELY. That group's layout resolves a session and
 * a current unit; a device has neither. `proxy.ts` lets `/iclock/*` past the
 * login redirect for the same reason it lets `/api/cron/*` past — see the note
 * there. Auth moves into this handler rather than going away: no `x-bridge-key`
 * means 403, and an unknown serial means 403.
 *
 * Three things here are protocol, not preference, and changing them breaks the
 * device rather than the code:
 *
 *   - Replies are `text/plain`. The handshake body starts `GET OPTION FROM: <SN>`
 *     and carries `Realtime=1`; everything else answers exactly `OK`.
 *   - A failed insert must answer NON-200. The device then keeps the punch and
 *     sends it again. Answering OK on a failure throws the punch away silently,
 *     and nothing downstream can tell it ever existed.
 *   - The device sends local time with NO timezone, so `+05:30` is appended here.
 */

import { NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** The uFace 302 sends IST with no offset. */
const DEVICE_TZ = "+05:30";

function text(body: string, status = 200) {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/plain" },
  });
}

/**
 * FAILS CLOSED. Only the Cloudflare Worker knows `BRIDGE_KEY`. If the variable
 * is unset the route refuses everything rather than falling open — an
 * environment variable nobody set is not consent, the same rule the approval
 * cron applies to `CRON_SECRET`.
 */
function authorized(req: NextRequest) {
  const key = process.env.BRIDGE_KEY;
  if (!key) {
    console.error("[iclock] BRIDGE_KEY is not set — refusing device traffic");
    return false;
  }
  return req.headers.get("x-bridge-key") === key;
}

/** Empty `ALLOWED_SN` allows any serial that carries the key. */
function allowedSN(sn: string) {
  const list = (process.env.ALLOWED_SN ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return sn !== "" && (list.length === 0 || list.includes(sn));
}

/**
 * Every call records that the device is alive. The heartbeat arrives every ~30
 * seconds, so a device silent for two minutes is one somebody needs to look at
 * — and "a device went quiet and nobody noticed" is the most common way an
 * attendance system fails quietly.
 *
 * `onConflict: serial_no` with no other columns means a device that has never
 * been seen appears by itself, unnamed and with no unit, ready for HR to label.
 * It never overwrites the name, unit or direction a person has set.
 */
async function touchDevice(sn: string, ip: string | null) {
  const supabase = createAdminClient();
  const { error } = await supabase.from("biometric_devices").upsert(
    { serial_no: sn, last_seen: new Date().toISOString(), last_ip: ip },
    { onConflict: "serial_no" },
  );
  if (error) console.error("[iclock] device touch failed", error);
}

/** The direction this device's punches are recorded as, copied at punch time. */
async function directionOf(sn: string): Promise<"in" | "out" | "both"> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("biometric_devices")
    .select("direction")
    .eq("serial_no", sn)
    .maybeSingle();
  return (data?.direction as "in" | "out" | "both") ?? "both";
}

/**
 * GET /iclock/cdata       — handshake, the device asking for its settings
 * GET /iclock/getrequest  — heartbeat, the device asking for queued commands
 */
export async function GET(req: NextRequest) {
  if (!authorized(req)) return text("Forbidden", 403);

  const url = req.nextUrl;
  const sn = url.searchParams.get("SN") ?? "";
  if (!allowedSN(sn)) return text("Unknown device", 403);

  await touchDevice(sn, req.headers.get("x-device-ip"));

  if (url.pathname.endsWith("/cdata")) {
    /**
     * `Realtime=1` is what makes this live — without it the device batches and
     * uploads on a timer. `Delay=30` is the heartbeat, and it is what the
     * online / offline indicator is measured against.
     *
     * `Stamp=0` asks for everything the device still holds. The ADMS stamp is a
     * watermark meaning "I already have records up to here", so a HIGH value
     * tells the device to send nothing — which is the opposite of what is
     * wanted on a first connect or after an outage. Duplicates cost nothing:
     * the unique key on (device_sn, user_id, punch_time) drops them.
     */
    return text(
      [
        `GET OPTION FROM: ${sn}`,
        "Stamp=0",
        "OpStamp=0",
        "ErrorDelay=60",
        "Delay=30",
        "TransTimes=00:00;14:05",
        "TransInterval=1",
        "TransFlag=1111000000",
        "Realtime=1",
        "Encrypt=0",
      ].join("\r\n"),
    );
  }

  // Heartbeat: nothing queued for the device to do.
  return text("OK");
}

/**
 * POST /iclock/cdata?table=ATTLOG — punches, one per line
 * POST /iclock/cdata?table=OPERLOG, /iclock/devicecmd — acknowledged, ignored
 */
export async function POST(req: NextRequest) {
  if (!authorized(req)) return text("Forbidden", 403);

  const url = req.nextUrl;
  const sn = url.searchParams.get("SN") ?? "";
  if (!allowedSN(sn)) return text("Unknown device", 403);

  const table = (url.searchParams.get("table") ?? "").toUpperCase();
  const body = await req.text();

  await touchDevice(sn, req.headers.get("x-device-ip"));

  if (url.pathname.endsWith("/cdata") && table === "ATTLOG") {
    const direction = await directionOf(sn);

    // USER_ID \t YYYY-MM-DD HH:MM:SS \t STATUS \t VERIFY \t WORKCODE \t … \t …
    const rows = body
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [userId = "", time = "", status, verify] = line.split("\t");
        return {
          device_sn: sn,
          user_id: userId.trim(),
          punch_time: `${time.trim().replace(" ", "T")}${DEVICE_TZ}`,
          direction,
          status: Number(status) || 0,
          verify_mode: Number(verify) || 0,
          raw: line,
        };
      })
      /**
       * A malformed line is DROPPED rather than failing the batch. One bad line
       * must not make the device resend a hundred good punches forever; `raw`
       * keeps whatever did parse, and the log keeps the rest.
       */
      .filter(
        (r) =>
          r.user_id !== "" &&
          /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+/.test(r.punch_time),
      );

    if (rows.length > 0) {
      const supabase = createAdminClient();
      const { error } = await supabase
        .from("punches")
        .upsert(rows, {
          onConflict: "device_sn,user_id,punch_time",
          ignoreDuplicates: true,
        });

      if (error) {
        console.error("[iclock] punch insert failed", error);
        // Non-200: the device keeps these punches and sends them again.
        return text("ERROR", 500);
      }
    }
    return text("OK");
  }

  // OPERLOG (someone edited a user on the device), command results, anything
  // else: acknowledged so the device stops asking, stored nowhere for now.
  return text("OK");
}
