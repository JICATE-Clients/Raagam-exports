import { redirect } from "next/navigation";

// MOVED 2026-11-12 (user: "knitting need to move as new module … Process"). Knitting is a
// sub-module of the Process module now; this address keeps old links and bookmarks working.
export default function Page() {
  redirect("/process/knitting-receipts");
}
