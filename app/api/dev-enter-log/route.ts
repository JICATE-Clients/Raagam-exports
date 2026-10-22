// TEMP DIAGNOSTIC (2026-10-22, toggle Enter) — delete with the console.info in
// lib/focus.ts. Dev only: appends what Enter saw on a tick box to a local file.
import { appendFile } from "node:fs/promises";

export async function POST(req: Request) {
  if (process.env.NODE_ENV !== "development") return new Response(null, { status: 404 });
  const line = await req.text();
  await appendFile(
    "C:/Users/sanka/AppData/Local/Temp/claude/C--Users-sanka-OneDrive-Gambar-Raagam-exports/a0f41017-09dc-4218-9f77-ea639e43dff5/scratchpad/enter-log.txt",
    `${new Date().toISOString()} ${line.slice(0, 2000)}\n`,
  );
  return new Response(null, { status: 204 });
}
