import { redirect } from "next/navigation";

// Dissolved 2026-10-14 (user: "no need grouping, list plainly under sample
// management") — its screens are children of Sample Management now.
export default function Page() {
  redirect("/sales/management");
}
