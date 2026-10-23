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
 * A device that has never been seen appears by itself, unnamed and with no
 * unit, ready for HR to label.
 *
 * It returns what the handler needs to know about the device, so the touch and
 * the lookup are ONE round trip rather than two: a heartbeat every 30 seconds
 * per device is not the place to ask the same question twice.
 *
 * The upsert names only `last_seen` and `last_ip`, so a conflict updates only
 * those — the name, unit, direction and watermark a person set are never
 * overwritten by a device dialling in. On a first INSERT the rest take their
 * column defaults, which is what makes a new device arrive as 'both',
 * unassigned, with a '0' watermark.
 */
type DeviceState = {
  direction: "in" | "out" | "both";
  /** The ATTLOG watermark we last accepted. '0' = send everything. */
  lastStamp: string;
  /** Approved by an admin to record punches (0735). A new device is false. */
  enabled: boolean;
  /** Punches older than this are acknowledged but not stored (0735). */
  acceptFrom: string | null;
};

async function touchDevice(
  sn: string,
  ip: string | null,
): Promise<DeviceState> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("biometric_devices")
    .upsert(
      { serial_no: sn, last_seen: new Date().toISOString(), last_ip: ip },
      { onConflict: "serial_no" },
    )
    .select("direction, last_attlog_stamp, enabled, accept_from")
    .maybeSingle();

  if (error) console.error("[iclock] device touch failed", error);

  /**
   * FALLING BACK TO '0' ON A FAILED READ IS THE SAFE DIRECTION. It asks the
   * device for more than we need and the unique key drops the surplus; the
   * opposite guess — a high stamp — would tell the device we already hold
   * punches we have never seen, and it would never offer them again.
   */
  return {
    direction: (data?.direction as DeviceState["direction"]) ?? "both",
    lastStamp: data?.last_attlog_stamp ?? "0",
    /**
     * A FAILED READ IS NOT AN APPROVAL. If the row could not be read we do not
     * know whether this reader was approved, and the safe answer to "may it
     * write attendance?" is no — it is refused, keeps its punches, and offers
     * them again. This is the opposite direction from `lastStamp` above, and
     * for the same reason: in each case the cautious guess is the one that
     * cannot lose a punch.
     */
    enabled: data?.enabled === true,
    acceptFrom: (data?.accept_from as string | null) ?? null,
  };
}

/**
 * Move the watermark on, and only ever FORWARDS. A device re-sending an older
 * batch must not drag it backwards, or everything after that batch is asked
 * for again on the next handshake.
 */
async function advanceStamp(sn: string, posted: string, current: string) {
  if (!/^\d+$/.test(posted)) return; // junk stamp: leave the watermark alone
  if (!(BigInt(posted) > BigInt(/^\d+$/.test(current) ? current : "0"))) return;

  const supabase = createAdminClient();
  const { error } = await supabase
    .from("biometric_devices")
    .update({ last_attlog_stamp: posted })
    .eq("serial_no", sn);
  if (error) console.error("[iclock] stamp advance failed", error);
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

  const device = await touchDevice(sn, req.headers.get("x-device-ip"));

  if (url.pathname.endsWith("/cdata")) {
    /**
     * `Realtime=1` is what makes this live — without it the device batches and
     * uploads on a timer. `Delay=30` is the heartbeat, and it is what the
     * online / offline indicator is measured against.
     *
     * `Stamp` IS A WATERMARK, NOT A SETTING: it means "I already hold records
     * up to here, send me what came after". So the value handed back is this
     * device's own last ACCEPTED stamp (0734), and '0' — a device we have never
     * heard from — asks for everything it holds.
     *
     * Both extremes are wrong as a constant. A fixed HIGH value (the reference
     * document sends 9999) claims we hold punches we have never seen, and the
     * device never offers them again. A fixed '0' re-asks for the device's
     * entire stored log on every single reconnect, leaving the unique key to
     * silently discard thousands of rows we should not have requested.
     *
     * `OpStamp` stays 0 because OPERLOG is acknowledged and discarded — there
     * is no watermark to keep when nothing is stored. The cost is that a device
     * re-offers its operation log on each reconnect and we drop it again.
     */
    return text(
      [
        `GET OPTION FROM: ${sn}`,
        `Stamp=${device.lastStamp}`,
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

  const device = await touchDevice(sn, req.headers.get("x-device-ip"));

  if (url.pathname.endsWith("/cdata") && table === "ATTLOG") {
    /**
     * A READER NOBODY APPROVED DOES NOT WRITE ATTENDANCE (0735). Refused with
     * a non-200 rather than acknowledged-and-dropped, so the device KEEPS the
     * punches and offers them again the moment an admin approves it: a block
     * that turns out to be a mistake costs nothing. Its handshake and
     * heartbeat above are still answered, which is what makes it appear on the
     * Live screen to be approved in the first place.
     */
    if (!device.enabled) {
      console.warn(`[iclock] punches refused — device ${sn} is not approved`);
      return text("Device not approved", 403);
    }

    const { direction } = device;

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

    /**
     * THE FIRST HANDSHAKE WITH A REAL DEVICE ASKS FOR ITS WHOLE HISTORY, and a
     * reader that has been on the wall for two years holds two years of it —
     * months of attendance nobody reconciled, against shift rules that did not
     * exist, for people who may have left, arriving indistinguishable from
     * today's punches. `accept_from` (0735) is where this device's history
     * starts; by default the moment it registered.
     *
     * The old lines are still ACKNOWLEDGED: dropped here, counted, and the
     * watermark advances below, so the device stops offering them. Refusing
     * them instead would have it re-send the same history forever.
     */
    const acceptFrom = device.acceptFrom ? Date.parse(device.acceptFrom) : null;
    const fresh =
      acceptFrom === null
        ? rows
        : rows.filter((r) => Date.parse(r.punch_time) >= acceptFrom);
    const skipped = rows.length - fresh.length;
    if (skipped > 0) {
      console.log(
        `[iclock] ${sn}: ${skipped} punch(es) older than accept_from acknowledged, not stored`,
      );
    }

    if (fresh.length > 0) {
      const supabase = createAdminClient();
      const { error } = await supabase.from("punches").upsert(fresh, {
        onConflict: "device_sn,user_id,punch_time",
        ignoreDuplicates: true,
      });

      if (error) {
        console.error("[iclock] punch insert failed", error);
        /**
         * Non-200: the device keeps these punches and sends them again. The
         * watermark is NOT advanced below, which is the half that makes the
         * retry mean something — a stamp moved past a batch we failed to store
         * is a batch the device will never offer again.
         */
        return text("ERROR", 500);
      }
    }

    /**
     * THE WATERMARK ADVANCES EXACTLY WHEN WE ACCEPT THE BATCH, which is why
     * this sits after the failure return and not inside the `rows.length`
     * branch. A batch whose every line was unparseable stores nothing and is
     * still ACCEPTED — we answer OK — so its stamp must move too. Leaving it
     * behind would have the device re-send that same unparseable batch on
     * every reconnect for as long as it keeps it.
     */
    await advanceStamp(
      sn,
      url.searchParams.get("Stamp") ?? "",
      device.lastStamp,
    );
    return text("OK");
  }

  // OPERLOG (someone edited a user on the device), command results, anything
  // else: acknowledged so the device stops asking, stored nowhere for now.
  return text("OK");
}
