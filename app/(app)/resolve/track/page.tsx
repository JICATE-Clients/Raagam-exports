import { redirect } from "next/navigation";

/**
 * Resolve Hub ▸ Reporting ▸ Track Concern. The tracking page itself is the
 * PUBLIC `/p/track` (outside the app, no login — an anonymous complaint is
 * followed by its token alone). The sidebar row lives here because
 * `check:nav` resolves every registered leaf under `app/(app)`, so a registry
 * entry pointing straight at `/p/track` can never pass; this hop is the row.
 */
export default function TrackComplaintPage() {
  redirect("/p/track");
}
