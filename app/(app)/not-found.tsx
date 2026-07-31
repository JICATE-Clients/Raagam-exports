"use client";

import { useRouter } from "next/navigation";
import { FileQuestion, ArrowLeft, Home } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";

/**
 * Shown when a screen inside the shell calls `notFound()` — an order id that
 * doesn't exist, a master row someone else deleted, a bookmarked link to a
 * record that has since been merged away.
 *
 * Distinct from the root `app/not-found.tsx`, which catches URLs matching no
 * route at all and therefore cannot assume the user is signed in. This one sits
 * under `(app)/layout.tsx`, so the sidebar and topbar stay put and "the record
 * is gone" doesn't look like "the app is gone".
 *
 * Back is offered ahead of Dashboard on purpose: a missing record is almost
 * always reached from a list, and that list is where the operator wants to be.
 */
export default function AppNotFound() {
  const router = useRouter();

  return (
    <div className="flex min-h-[60vh] items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardBody className="flex flex-col items-center gap-4 py-8 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-surface-muted text-muted-foreground">
            <FileQuestion className="h-6 w-6" />
          </div>

          <div className="space-y-1.5">
            <h1 className="text-base font-semibold text-foreground">
              We couldn&apos;t find that record
            </h1>
            <p className="text-sm text-muted-foreground">
              It may have been deleted, or the link may be out of date. Nothing
              has been changed.
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
            <Button onClick={() => router.back()}>
              <ArrowLeft />
              Go back
            </Button>
            <Button variant="outline" onClick={() => router.push("/")}>
              <Home />
              Dashboard
            </Button>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
