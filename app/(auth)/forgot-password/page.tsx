"use client";

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardBody } from "@/components/ui/card";

/**
 * FORGOT PASSWORD — emails a recovery link. The link comes back through
 * `/auth/callback` (which exchanges the code for a session) and lands on
 * `/set-password?reset=1`, the same screen a first sign-in uses to replace its
 * temporary password, so there is one place a password is chosen.
 */
export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const next = encodeURIComponent("/set-password?reset=1");
    const { error } = await createClient().auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/auth/callback?next=${next}`,
    });
    setLoading(false);
    if (error) {
      /* Supabase Auth's email limit (2026-11-13: the built-in mailer allowed 2 an hour for the
         whole project and three operators were refused). Its raw text read as a broken screen. */
      if (error.status === 429 || error.code === "over_email_send_rate_limit") {
        return setError(
          "Too many reset emails were sent in the last hour. Please try again later, or ask an admin to resend your login from Users & Access.",
        );
      }
      return setError(error.message);
    }
    setSent(true);
  }

  return (
    <Card>
      <CardBody className="space-y-4">
        <div>
          <h2 className="text-base font-semibold text-foreground">Forgot password</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {sent
              ? "If an account exists for that email, a reset link is on its way. Open it on this device to choose a new password."
              : "Enter your email and we'll send you a link to reset your password."}
          </p>
        </div>

        {error && (
          <p className="rounded-md bg-danger-soft px-3 py-2 text-xs text-danger">
            {error}
          </p>
        )}

        {!sent && (
          <form onSubmit={submit} className="space-y-3">
            <div>
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoFocus
              />
            </div>
            <Button type="submit" size="lg" className="w-full" disabled={loading}>
              {loading ? "Sending…" : "Send reset link"}
            </Button>
          </form>
        )}

        <p className="text-center text-xs text-muted-foreground">
          <Link href="/login" className="text-primary hover:underline">
            Back to sign in
          </Link>
        </p>
      </CardBody>
    </Card>
  );
}
