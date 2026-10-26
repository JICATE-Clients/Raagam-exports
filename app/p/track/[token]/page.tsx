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
import { LaneTile, StepChain } from "@/components/resolve/inbox/inbox-bits";
import { stepOf } from "@/components/resolve/inbox/inbox-flow";
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
  title: "Concern status — Raagam Exports",
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
            <h1 className="text-base font-semibold">Nothing matches this link</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Check that the whole link was copied.{" "}
              <Link href="/p/track" className="text-primary underline-offset-2 hover:underline">
                Paste it again
              </Link>
              .
            </p>
          </section>
        ) : (
          <section className="space-y-4 rounded-xl border border-border bg-surface p-4">
            <div className="flex items-start gap-2.5">
              <LaneTile lane="concern" size="md" />
              <div className="min-w-0 flex-1">
                <h1 className="text-base font-semibold leading-snug">{view.subject}</h1>
                <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                  <span className="font-mono">{view.ref_no}</span>
                  <StatusPill tone={ticketStatusTone(view.status)}>{COMPLAINT_STATUS_LABEL[view.status] ?? view.status}</StatusPill>
                </p>
              </div>
            </div>

            {/* Where it is, said once — the same chain the app draws on every ticket. */}
            <StepChain
              lane="concern"
              state={stepOf({ kind: "complaint", status: view.status, assignee_id: view.first_response_at ? "answered" : null })}
            />

            {view.resolution_message ? (
              <div className="flex items-start gap-2">
                <span className="flex size-6 flex-none items-center justify-center rounded-full bg-violet-600 text-[10px] font-bold text-white" aria-hidden="true">
                  HR
                </span>
                <p className="whitespace-pre-line rounded-xl rounded-tl-sm border border-border bg-surface-muted px-3 py-2 text-sm">
                  {view.resolution_message}
                </p>
              </div>
            ) : (
              <p className="rounded-lg bg-surface-muted px-3 py-2 text-sm text-muted-foreground">
                {view.first_response_at ? "It is being looked into. The reply will show here." : "Waiting for someone to pick it up."}
              </p>
            )}

            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm">
              <dt className="text-muted-foreground">Raised</dt>
              <dd>{fmtDateTime(view.created_at)}</dd>
              <dt className="text-muted-foreground">First reply</dt>
              <dd>{view.first_response_at ? fmtDateTime(view.first_response_at) : "Not yet"}</dd>
              {view.resolved_at ? (
                <>
                  <dt className="text-muted-foreground">Answered</dt>
                  <dd>{fmtDateTime(view.resolved_at)}</dd>
                </>
              ) : null}
              {view.withdrawn_at ? (
                <>
                  <dt className="text-muted-foreground">Withdrawn</dt>
                  <dd>{fmtDateTime(view.withdrawn_at)}</dd>
                </>
              ) : null}
            </dl>

            <p className="text-xs text-muted-foreground">Keep this link private — anyone who has it can see this page.</p>
            {open ? <WithdrawButton token={token} /> : null}
          </section>
        )}
      </div>
    </main>
  );
}
