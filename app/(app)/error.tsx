"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, RotateCw, Home } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";

/**
 * The error boundary for every screen inside the app shell.
 *
 * Placed on `(app)` rather than per-module on purpose: it wraps `page.tsx`,
 * `loading.tsx` and every nested layout BELOW it, but not the `(app)/layout.tsx`
 * beside it — so a screen that throws loses only the content pane. The sidebar,
 * topbar and mobile nav stay on screen and the operator can navigate away
 * instead of hitting a dead page with nothing but the browser Back button.
 *
 * `unstable_retry()` re-fetches and re-renders the segment (Next 16.2+). It is
 * the right call here rather than `reset()`: nearly every throw in this app is a
 * Supabase round-trip that failed, so clearing the error state WITHOUT
 * re-fetching — which is all `reset()` does — would re-render the same failed
 * data and land straight back on this page.
 */
export default function AppError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  const router = useRouter();

  useEffect(() => {
    // Server Component errors reach the client with their message stripped, so
    // in production this logs little more than the digest. That is the point:
    // the digest is the key that matches this screen to the server-side log.
    console.error("[route-error]", error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardBody className="flex flex-col items-center gap-4 py-8 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-danger/10 text-danger">
            <AlertTriangle className="h-6 w-6" />
          </div>

          <div className="space-y-1.5">
            <h1 className="text-base font-semibold text-foreground">
              This screen couldn&apos;t load
            </h1>
            <p className="text-sm text-muted-foreground">
              Something went wrong while fetching the data. Your saved work is
              not affected — try again, or head back and come in from another
              screen.
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
            <Button onClick={() => unstable_retry()}>
              <RotateCw />
              Try again
            </Button>
            <Button variant="outline" onClick={() => router.push("/")}>
              <Home />
              Dashboard
            </Button>
          </div>

          {/*
            Shown, not hidden behind a details toggle: when an operator rings up
            about a broken screen this reference is the only thing that ties
            their report to a line in the server log.
          */}
          {error.digest ? (
            <p className="pt-1 font-mono text-[11px] text-muted-foreground">
              Reference: {error.digest}
            </p>
          ) : null}
        </CardBody>
      </Card>
    </div>
  );
}
