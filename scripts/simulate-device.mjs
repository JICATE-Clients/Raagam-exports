#!/usr/bin/env node
// Simulates an eSSL uFace 302 (ZKTeco ADMS push) so you can test without the real device.
// Sends the same requests the device sends: handshake, heartbeat, and punches (ATTLOG).
//
// Requires Node 18+ (built-in fetch). No packages needed.
//
// Usage:
//   # Straight to the ERP (local `next dev` or Vercel) - you must pass the bridge key:
//   node scripts/simulate-device.mjs --url http://localhost:3000 --key <BRIDGE_KEY> --sn TESTSN001 --user 1001
//
//   # Through the Cloudflare Worker (plain HTTP, exactly like the device) - no key needed:
//   node scripts/simulate-device.mjs --url http://essl-bridge.<sub>.workers.dev --sn <SERIAL> --user 1001
//
// Options:
//   --url    base URL (no trailing slash)                      [required]
//   --sn     device serial number (must be in ALLOWED_SN)     [default TESTSN001]
//   --user   device User ID (= employees.biometric_id)        [default 1001]
//   --key    BRIDGE_KEY, only when calling the ERP directly
//   --time   punch time in IST "YYYY-MM-DD HH:MM:SS"          [default: now]
//   --step   all | handshake | heartbeat | punch               [default all]

const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, cur, i, arr) => {
    if (cur.startsWith("--")) pairs.push([cur.slice(2), arr[i + 1] && !arr[i + 1].startsWith("--") ? arr[i + 1] : "true"]);
    return pairs;
  }, [])
);

if (!args.url) {
  console.error("Missing --url. Example: node scripts/simulate-device.mjs --url http://localhost:3000 --key <BRIDGE_KEY>");
  process.exit(1);
}

const base = args.url.replace(/\/$/, "");
const sn = args.sn || "TESTSN001";
const userId = args.user || "1001";
const step = args.step || "all";

function nowIST() {
  // "YYYY-MM-DD HH:MM:SS" in Asia/Kolkata, like the device clock
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }).formatToParts(new Date());
  const v = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${v.year}-${v.month}-${v.day} ${v.hour === "24" ? "00" : v.hour}:${v.minute}:${v.second}`;
}

const punchTime = args.time || nowIST();

const headers = { "User-Agent": "iClock Proxy/1.09" };
if (args.key) headers["x-bridge-key"] = args.key;

async function call(label, method, path, body) {
  const url = `${base}${path}`;
  try {
    const res = await fetch(url, {
      method,
      headers: body ? { ...headers, "Content-Type": "text/plain" } : headers,
      body,
      redirect: "manual",
    });
    const text = await res.text();
    const ok = res.status === 200;
    console.log(`\n${ok ? "OK  " : "FAIL"} ${label}  ->  HTTP ${res.status}`);
    console.log(`     ${method} ${url}`);
    if (res.status >= 300 && res.status < 400) {
      console.log(`     Redirected to: ${res.headers.get("location")}`);
      console.log("     A redirect means the device would fail here (plain HTTP not accepted, or login middleware).");
    }
    console.log(text.split(/\r?\n/).map((l) => `     | ${l}`).join("\n"));
    return ok;
  } catch (err) {
    console.log(`\nFAIL ${label}  ->  ${err.message}`);
    return false;
  }
}

let allOk = true;

if (step === "all" || step === "handshake") {
  allOk = (await call("Handshake", "GET", `/iclock/cdata?SN=${encodeURIComponent(sn)}&options=all&pushver=2.2.14&language=69`)) && allOk;
}

if (step === "all" || step === "heartbeat") {
  allOk = (await call("Heartbeat", "GET", `/iclock/getrequest?SN=${encodeURIComponent(sn)}`)) && allOk;
}

if (step === "all" || step === "punch") {
  // ATTLOG line: USER_ID \t TIME \t STATUS \t VERIFY \t WORKCODE \t RESERVED \t RESERVED
  const line = `${userId}\t${punchTime}\t0\t15\t0\t0\t0`;
  allOk = (await call(`Punch (user ${userId} at ${punchTime} IST)`, "POST",
    `/iclock/cdata?SN=${encodeURIComponent(sn)}&table=ATTLOG&Stamp=9999`, line + "\n")) && allOk;
}

console.log(allOk
  ? "\nAll requests succeeded. Check the punches / daily_attendance tables and the live screen."
  : "\nSome requests failed. See docs/04-testing.md -> Troubleshooting.");
process.exit(allOk ? 0 : 1);
