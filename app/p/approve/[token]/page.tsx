import type { Metadata } from "next";
import Image from "next/image";
import { FileText } from "lucide-react";
import { publicLinkView } from "@/lib/ta/approval-links-service";
import { allow, clientIp } from "@/lib/rate-limit";
import { LINK_STATUS_LABEL, TOKEN_RE } from "@/lib/ta/approval-links-types";
import { DecisionForm } from "./decision-form";

/**
 * /p/approve/<token> — the buyer's approval page (0668). PUBLIC: `proxy.ts`
 * stands down for `/p/`, and this page sits outside `app/(app)`, whose layout
 * requires a session. It shows the item, the RE No, the customer's name, the
 * merchandiser's message and the files — nothing else from the ERP.
 */

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Approval — Raagam Exports",
  robots: { index: false, follow: false },
};

export default async function ApprovePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  // RATE LIMITED per address (0672, lib/rate-limit.ts — per instance; the
  // 256-bit token is the real guard, this only stops one caller hammering).
  const limited = !allow(`page:${await clientIp()}`, 60, 60_000);
  const view =
    !limited && TOKEN_RE.test(token) ? await publicLinkView(token) : ({ state: "invalid" } as const);

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
        ) : view.state === "invalid" ? (
          <section className="rounded-lg border border-border bg-surface p-5 text-center">
            <h1 className="text-base font-semibold">This link is not valid</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Please check the link in your email, or ask Raagam Exports for a new one.
            </p>
          </section>
        ) : (
          <section className="space-y-4 rounded-lg border border-border bg-surface p-5">
            <div>
              <h1 className="text-lg font-semibold">{view.approval}</h1>
              <dl className="mt-2 grid grid-cols-[6rem_1fr] gap-y-1 text-sm">
                {view.orderRef && (
                  <>
                    <dt className="text-muted-foreground">Order</dt>
                    <dd className="font-mono">{view.orderRef}</dd>
                  </>
                )}
                {view.customer && (
                  <>
                    <dt className="text-muted-foreground">Customer</dt>
                    <dd>{view.customer}</dd>
                  </>
                )}
                {view.state === "open" && (
                  <>
                    <dt className="text-muted-foreground">Answer by</dt>
                    <dd>{view.expiresOn}</dd>
                  </>
                )}
              </dl>
            </div>

            {view.message && (
              <p className="whitespace-pre-line rounded-md bg-surface-muted p-3 text-sm">{view.message}</p>
            )}

            {view.files.length > 0 && (
              <ul className="space-y-2">
                {view.files.map((f) => (
                  <li key={f.path}>
                    {f.url && f.mime?.startsWith("image/") ? (
                      <a href={f.url} target="_blank" rel="noopener noreferrer" className="block">
                        {/* A signed, short-lived URL — next/image cannot optimise it. */}
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={f.url} alt={f.name} className="max-h-80 w-full rounded-md border border-border object-contain" />
                      </a>
                    ) : f.url ? (
                      <a
                        href={f.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-2 text-sm text-primary underline-offset-2 hover:underline"
                      >
                        <FileText className="size-4" aria-hidden /> {f.name}
                      </a>
                    ) : (
                      <span className="text-sm text-muted-foreground">{f.name} (could not be loaded)</span>
                    )}
                  </li>
                ))}
              </ul>
            )}

            {/* THE DISPATCH PROOF (0672) — the courier slip or photo saved
                when the item was marked Sent, and its tracking reference. */}
            {(view.proof || view.proofReference) && (
              <div className="space-y-2 rounded-md border border-border p-3">
                <p className="text-xs font-medium text-muted-foreground">Dispatch details</p>
                {view.proofReference && (
                  <p className="text-sm">
                    Courier reference: <span className="font-mono">{view.proofReference}</span>
                  </p>
                )}
                {view.proof?.url && view.proof.mime?.startsWith("image/") ? (
                  <a href={view.proof.url} target="_blank" rel="noopener noreferrer" className="block">
                    {/* A signed, short-lived URL — next/image cannot optimise it. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={view.proof.url}
                      alt="Dispatch proof"
                      className="max-h-60 w-full rounded-md border border-border object-contain"
                    />
                  </a>
                ) : view.proof?.url ? (
                  <a
                    href={view.proof.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 text-sm text-primary underline-offset-2 hover:underline"
                  >
                    <FileText className="size-4" aria-hidden /> Dispatch proof
                  </a>
                ) : null}
              </div>
            )}

            {view.state === "open" ? (
              <DecisionForm token={token} defaultName={view.recipientName ?? ""} />
            ) : (
              <p className="rounded-md border border-border bg-surface-muted p-3 text-sm">
                <span className="font-medium">{LINK_STATUS_LABEL[view.status]}</span>
                {view.decidedByName && view.decidedOn && (
                  <span className="text-muted-foreground">
                    {" "}
                    — {view.decidedByName}, {view.decidedOn}
                  </span>
                )}
                {view.status === "expired" && (
                  <span className="block text-muted-foreground">Please ask Raagam Exports for a new link.</span>
                )}
              </p>
            )}
          </section>
        )}
      </div>
    </main>
  );
}
