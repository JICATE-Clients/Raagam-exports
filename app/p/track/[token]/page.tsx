import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { allow, clientIp } from "@/lib/rate-limit";
import { trackComplaint } from "@/lib/resolve/tracking";
import { ticketStatusTone } from "@/lib/resolve/sla";
import { COMPLAINT_STATUS_LABEL, type TrackedComplaint } from "@/lib/resolve/types";
import { StatusPill } from "@/components/ui/status-pill";
import { fmtDateTime } from "@/lib/format";
import { isTrackingToken } from "@/lib/resolve/token";
import { WithdrawButton } from "./withdraw-button";

/**
 * /p/track/<token> — an anonymous complaint's tracking page. PUBLIC, outside
 * `app/(app)`, same protections as `/p/approve/<token>`: no shell, noindex, a
 * per-address rate limit, and the token's shape checked before any lookup.
 *
 * It shows EXACTLY what `TrackedComplaint` carries — reference, subject,
 * status, the key times and the handler's resolution message. Nothing about
 * the handler, the category's committee, internal notes or the complainant.
 * A malformed token and an unknown one read identically, so the page cannot
 * be used to probe which tokens exist.
 */

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Complaint status — Raagam Exports",
  robots: { index: false, follow: false },
  // The token is in this page's URL; never send it on as a Referer.
  referrer: "no-referrer",
};

export default async function TrackedComplaintPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const limited = !allow(`track:${await clientIp()}`, 60, 60_000);
  let view: TrackedComplaint | null = null;
  if (!limited && isTrackingToken(token)) {
    try {
      view = await trackComplaint(token);
    } catch {
      view = null; // a lookup failure reads as "no match", never as a hint
    }
  }
  const open = view && view.status !== "resolved" && view.status !== "withdrawn";

  return (
    <main className="min-h-dvh bg-background px-4 py-8 text-foreground">
      <div className="mx-auto w-full max-w-lg space-y-5">
        <header className="text-center">
          <Image
            src="/brand/raagam-wordmark.png"
            alt="Raagam Exports"
            width={431}
            height={184}
            priority
            className="mx-auto h-12 w-auto"
          />
        </header>

        {limited ? (
          <section className="rounded-lg border border-border bg-surface p-5 text-center">
            <h1 className="text-base font-semibold">Too many requests</h1>
            <p className="mt-1 text-sm text-muted-foreground">Please wait a minute and open the link again.</p>
          </section>
        ) : !view ? (
          <section className="rounded-lg border border-border bg-surface p-5 text-center">
            <h1 className="text-base font-semibold">No complaint matches this link</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Check that the whole link was copied.{" "}
              <Link href="/p/track" className="text-primary underline-offset-2 hover:underline">
                Paste it again
              </Link>
              .
            </p>
          </section>
        ) : (
          <section className="space-y-4 rounded-lg border border-border bg-surface p-5">
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-sm text-muted-foreground">{view.ref_no}</span>
                <StatusPill tone={ticketStatusTone(view.status)}>
                  {COMPLAINT_STATUS_LABEL[view.status] ?? view.status}
                </StatusPill>
              </div>
              <h1 className="text-lg font-semibold">{view.subject}</h1>
            </div>

            <dl className="space-y-1 text-sm">
              <div className="flex flex-wrap gap-x-2">
                <dt className="text-muted-foreground">Sent</dt>
                <dd>{fmtDateTime(view.created_at)}</dd>
              </div>
              <div className="flex flex-wrap gap-x-2">
                <dt className="text-muted-foreground">First response</dt>
                <dd>{view.first_response_at ? fmtDateTime(view.first_response_at) : "Not yet"}</dd>
              </div>
              {view.resolved_at ? (
                <div className="flex flex-wrap gap-x-2">
                  <dt className="text-muted-foreground">Resolved</dt>
                  <dd>{fmtDateTime(view.resolved_at)}</dd>
                </div>
              ) : null}
              {view.withdrawn_at ? (
                <div className="flex flex-wrap gap-x-2">
                  <dt className="text-muted-foreground">Withdrawn</dt>
                  <dd>{fmtDateTime(view.withdrawn_at)}</dd>
                </div>
              ) : null}
            </dl>

            {view.resolution_message ? (
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground">The handler&apos;s reply</p>
                <p className="whitespace-pre-line rounded-md bg-surface-muted p-3 text-sm">{view.resolution_message}</p>
              </div>
            ) : null}

            {open ? <WithdrawButton token={token} /> : null}

            <p className="text-xs text-muted-foreground">
              Keep this link private — anyone who has it can see this page.
            </p>
          </section>
        )}
      </div>
    </main>
  );
}
