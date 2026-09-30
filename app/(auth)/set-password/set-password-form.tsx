"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { Card, CardBody } from "@/components/ui/card";
import { setOwnPassword } from "@/lib/users/actions";

export function SetPasswordForm({ email }: { email: string | null }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await setOwnPassword({ password, confirm });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.replace("/");
      router.refresh();
    });
  }

  return (
    <Card>
      <CardBody>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <h2 className="text-base font-semibold text-foreground">Choose your password</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {email ? <>Signed in as {email}. </> : null}
              The password you were emailed was temporary — set your own to continue.
            </p>
          </div>
          <Field label="New password" required>
            <Input
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              autoFocus
            />
          </Field>
          <Field label="Confirm password" required error={error ?? undefined}>
            <Input
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
              minLength={8}
            />
          </Field>
          <p className="text-xs text-muted-foreground">At least 8 characters, with letters and a number.</p>
          <Button type="submit" variant="primary" className="w-full" disabled={isPending || !password || !confirm}>
            {isPending ? "Saving…" : "Save and continue"}
          </Button>
        </form>
      </CardBody>
    </Card>
  );
}
