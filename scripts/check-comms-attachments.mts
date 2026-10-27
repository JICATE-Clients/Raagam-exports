// Verification for Communication Hub ATTACHMENTS (0737's bucket and table,
// 0761's server-side checks; lib/comms/file-sniff.ts, attachments.ts,
// attachment-actions.ts, upload.ts, orphans.ts; the composer and the message
// attachment cards).
//
//     npm run check:comms-attachments
//
// The live half — uploading as a member, spoofed types, outsiders, downloads,
// deletion — is the attachments end-to-end run. This file asserts what that
// cannot see:
//
//   1. THE CONTENT CHECK on real byte patterns: every allowed type passes its
//      own signature, fails a foreign one, and a program or web page never
//      passes under any name.
//   2. ONE LIST OF TYPES — every allowed MIME has its own signature rule (none
//      falls to the default), the picker offers nothing the server refuses.
//   3. THE CHECK IS IN THE DATABASE'S PATH — comm_send_message requires a
//      server-written check row and takes size and type from it, the row's
//      table is unreachable from a browser, the orphan sweep is service-only.
//   4. THE SCREENS — verify before "done", delete on remove, progress, links
//      signed for the viewer only, Office files download-only.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { sniffProblem, SNIFF_BYTES } from "../lib/comms/file-sniff.ts";
import { ACCEPT_ATTR, fileKind, isImageMime, isOpenableMime } from "../lib/comms/attachments.ts";
import { ALLOWED_MIME, ATTACHMENTS_PER_MESSAGE, ATTACHMENT_MAX_BYTES, attachmentPath } from "../lib/comms/types.ts";

let failures = 0;
function check(cond: boolean, msg: string) {
  if (cond) console.log(`ok    ${msg}`);
  else {
    failures++;
    console.error(`FAIL  ${msg}`);
  }
}

const root = resolve(import.meta.dirname, "..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");
const sql = read("supabase/migrations/0761_comms_attachment_checks.sql").replace(/--[^\n]*/g, "");

// ---------- 1. the content check ----------

const bytes = (...parts: (number[] | string)[]) =>
  new Uint8Array(parts.flatMap((p) => (typeof p === "string" ? Array.from(p, (c) => c.charCodeAt(0)) : p)));
const SAMPLES: Record<string, Uint8Array> = {
  pdf: bytes("%PDF-1.7\n%âãÏÓ\n1 0 obj"),
  png: bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13], "IHDR"),
  jpeg: bytes([0xff, 0xd8, 0xff, 0xe0, 0, 16], "JFIF"),
  gif: bytes("GIF89a", [1, 0, 1, 0]),
  webp: bytes("RIFF", [0x24, 0, 0, 0], "WEBPVP8 "),
  zip: bytes([0x50, 0x4b, 0x03, 0x04, 20, 0, 6, 0], "[Content_Types].xml"),
  ole: bytes([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0]),
  csv: bytes("style,colour,qty\nRE-1021,NAVY,1200\n"),
  txt: bytes([0xef, 0xbb, 0xbf], "Cutting plan for Monday\r\n"),
  exe: bytes("MZ", [0x90, 0, 3, 0], "This program cannot be run in DOS mode"),
  elf: bytes([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1]),
  html: bytes("  <!DOCTYPE html><script>alert(1)</script>"),
  svg: bytes("<svg xmlns='http://www.w3.org/2000/svg' onload='alert(1)'/>"),
  binary: bytes("hello", [0], "world"),
};
const RIGHT: Record<string, keyof typeof SAMPLES> = {
  "application/pdf": "pdf",
  "image/png": "png",
  "image/jpeg": "jpeg",
  "image/gif": "gif",
  "image/webp": "webp",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "zip",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "zip",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "zip",
  "application/msword": "ole",
  "application/vnd.ms-excel": "ole",
  "text/csv": "csv",
  "text/plain": "txt",
};
for (const mime of ALLOWED_MIME) {
  const own = RIGHT[mime];
  check(!!own && sniffProblem(mime, SAMPLES[own]) === null, `${mime.replace(/^application\/vnd\.openxmlformats-officedocument\./, "ooxml/")} passes with its own signature`);
  const foreign = own === "pdf" ? "png" : "pdf";
  check(sniffProblem(mime, SAMPLES[foreign]) !== null, `${mime.replace(/^application\/vnd\.openxmlformats-officedocument\./, "ooxml/")} refuses a ${foreign.toUpperCase()} in disguise`);
}
for (const mime of ALLOWED_MIME) {
  for (const evil of ["exe", "elf"] as const) {
    if (sniffProblem(mime, SAMPLES[evil]) === null) check(false, `a ${evil} passed as ${mime}`);
  }
}
check(ALLOWED_MIME.every((m) => sniffProblem(m, SAMPLES.exe) === "Programs cannot be shared here."), "a Windows program is refused under EVERY allowed type, with its own sentence");
check(["text/plain", "text/csv"].every((m) => sniffProblem(m, SAMPLES.html) && sniffProblem(m, SAMPLES.svg) && sniffProblem(m, SAMPLES.binary)), "a web page, an SVG or binary data is not accepted as text");
check(sniffProblem("application/vnd.ms-excel", SAMPLES.csv) === null, "a CSV exported as .xls is still a spreadsheet");
check(sniffProblem("image/svg+xml", bytes("<svg/>")) !== null && sniffProblem("text/html", bytes("<p>")) !== null, "a type outside the allowlist is refused outright");
check(sniffProblem("application/pdf", new Uint8Array()) === "The file is empty.", "an empty upload is refused");
check(SNIFF_BYTES === 8192, "the server reads 8 KB, never the whole file");

// ---------- 2. one list of types ----------

const sniffSrc = read("lib/comms/file-sniff.ts");
check(ALLOWED_MIME.every((m) => sniffSrc.includes(`case "${m}":`)), "every allowed type has its own signature rule (none falls to 'cannot be shared')");
check(!ALLOWED_MIME.some((m) => /svg|html|javascript|^(text|application)\/xml$/.test(m)), "no active-content type (SVG, HTML, XML, script) is allowed at all");
const accept = ACCEPT_ATTR.split(",");
check(ALLOWED_MIME.every((m) => accept.includes(m)) && accept.filter((a) => a.includes("/")).every((m) => (ALLOWED_MIME as readonly string[]).includes(m)), "the file dialog offers exactly the allowed types");
check(!accept.includes(".ppt") && !accept.includes(".exe") && !accept.includes(".svg"), "no extension is offered that the server refuses");
check(isImageMime("image/png") && !isImageMime("image/svg+xml") && !isImageMime("application/pdf"), "only the four bitmap types are shown inline");
check(isOpenableMime("application/pdf") && isOpenableMime("text/plain") && !isOpenableMime("text/csv") && !isOpenableMime("application/msword"), "Office files and CSV are download-only; PDF, text and images may open");
check(fileKind("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "x.xlsx") === "Excel" && fileKind("application/x-foo", "a.weird") === "WEIRD", "file cards name the type");
check(ATTACHMENTS_PER_MESSAGE === 10 && ATTACHMENT_MAX_BYTES === 20 * 1024 * 1024, "10 files of 20 MB — the limits the bucket and comm_send_message enforce");

// ---------- 3. the check is in the database's path ----------

const send = sql.match(/function public\.comm_send_message[\s\S]*?\$\$;/)?.[0] ?? "";
check(/from public\.comm_upload_checks k\s+where k\.storage_path = v_path and k\.owner_id = v_me and k\.conversation_id = p_conv/.test(send), "send REQUIRES a check row for the caller's own upload in this conversation");
check(/v_mime := v_chk\.mime_type;\s+v_size := v_chk\.size_bytes;/.test(send) && !/v_att ->> 'mime_type'/.test(send) && !/v_att ->> 'size_bytes'/.test(send), "size and type come from the check, never from the request");
check(/delete from public\.comm_upload_checks where storage_path = v_path;/.test(send), "a check vouches for one attachment, once");
check(/v_path !~\* \('\^' \|\| p_conv::text/.test(send) && /comm_allowed_mime\(v_mime\)/.test(send) && /v_size > 20971520/.test(send), "0737's key-shape, type and size refusals are all still there");
check(/alter table public\.comm_upload_checks enable row level security;/.test(sql) && !/create policy [a-z_]+ on public\.comm_upload_checks/.test(sql), "the check table is unreachable from a browser (RLS on, no policy)");
check(/revoke all on function public\.comm_orphan_files\(integer, integer\) from public, anon, authenticated;/.test(sql) && !/grant execute on function public\.comm_orphan_files/.test(sql), "the orphan sweep is service-role only");
check(/coalesce\(o\.owner_id, o\.owner::text\) = \(select auth\.uid\(\)\)::text/.test(sql), "upload facts answer only about the caller's OWN object");
check(/not exists \(select 1 from public\.comm_attachments a where a\.storage_path = o\.name\)/.test(sql) && /make_interval\(hours =>/.test(sql), "an orphan is an object no attachment names, past a grace period");
const conv = "cccccccc-0000-4000-8000-000000000003";
const id = "dddddddd-0000-4000-8000-000000000004";
const KEY = /^[0-9a-f-]{36}\/[0-9a-f-]{36}\.[a-z0-9]{1,8}$/;
check(["../../etc/passwd", "a/../../b.pdf", "C:\\\\win.ini", "x.pdf/..", "名前.pdf"].every((n) => KEY.test(attachmentPath(conv, n, id)) && attachmentPath(conv, n, id).startsWith(`${conv}/${id}.`)), "a file name can never reach the storage key (no traversal, no folder change)");
const actions = read("lib/comms/attachment-actions.ts");
check(/const KEY_RE = new RegExp\(`\^\$\{UUID\}\/\$\{UUID\}\\\\\.\[a-z0-9\]\{1,8\}\$`, "i"\)/.test(actions), "the server accepts only generated keys (conversation/uuid.ext)");
check(/Range: `bytes=0-\$\{SNIFF_BYTES - 1\}`/.test(actions) && /drop\(problem\)/.test(actions), "the server reads the first bytes, and DELETES a file that fails");
check(/const s = await createClient\(\);\s+const \{ data, error \} = await s\.storage\.from\(COMM_BUCKET\)\.createSignedUrls/.test(actions) && /download: name/.test(actions), "links are signed with the VIEWER's client; downloads carry Content-Disposition");
check(/runHousekeeping/.test(read("app/api/cron/housekeeping/route.ts")) && /purgeOrphanCommFiles\(\)/.test(read("lib/jobs/sweeps.ts")), "the daily housekeeping job removes orphaned uploads");

// ---------- 4. the screens ----------

const composer = read("components/comms/composer.tsx");
check(/const v = await verifyUpload\(path\);[\s\S]{0,400}status: "done"/.test(composer), "a file is 'done' (sendable) only after the server checked it");
check(/void discardUpload\(u\.path\)/.test(composer) && /onDrop=\{onDrop\}/.test(composer) && /role="progressbar"/.test(composer), "removing a chip deletes its upload; drag-and-drop; a real progress bar");
check(/accept=\{ACCEPT_ATTR\}/.test(composer) && /ATTACHMENT_TYPES_LABEL/.test(composer), "the composer shows the accepted types and limits");
check(/if \(ok\) \{\s+setText\(""\);\s+setUploads\(\[\]\);/.test(composer), "the draft and its files are kept when a send fails");
const cards = read("components/comms/message-attachments.tsx");
check(/new IntersectionObserver/.test(cards) && /loading="lazy"/.test(cards), "images load only when they near the screen");
check(/isOpenableMime\(a\.mime_type\) && \(/.test(cards) && /object-contain/.test(cards), "Open only for safe types; images keep their aspect ratio");
check(!/createAdminClient|service_role/.test(cards + composer), "nothing on the screen holds a privileged key");
check(/<MessageAttachments attachments=\{m\.attachments\}/.test(read("components/comms/message-item.tsx")), "messages render attachments through the one component");

if (failures > 0) {
  console.error(`\ncheck:comms-attachments — ${failures} failure(s)`);
  process.exit(1);
}
console.log("\ncheck:comms-attachments — all assertions passed");
