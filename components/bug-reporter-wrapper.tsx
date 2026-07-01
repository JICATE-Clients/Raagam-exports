"use client";

import { BugReporterProvider } from "@boobalan_jkkn/bug-reporter-sdk";
import { useEffect, useState, type ReactNode } from "react";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";

const apiKey = process.env.NEXT_PUBLIC_BUG_REPORTER_API_KEY;
const apiUrl = process.env.NEXT_PUBLIC_BUG_REPORTER_API_URL;

/**
 * The SDK only mounts when real credentials are present — both a key and URL that
 * are no longer the `REPLACE_ME` placeholder. (The platform issues `br_…` keys;
 * we intentionally do NOT hard-code a key prefix so a format change on the
 * platform can't silently disable the widget.) Until `.env.local` is filled this
 * renders children untouched, so the ERP is unaffected.
 */
const configured =
  !!apiKey &&
  !!apiUrl &&
  !apiKey.includes("REPLACE_ME") &&
  !apiUrl.includes("REPLACE_ME");

/**
 * Wraps the app with the JKKN Bug Reporter, seeding the signed-in Supabase user
 * as report context. Mounted app-wide in the root layout.
 */
export function BugReporterWrapper({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    if (!configured) return;
    const supabase = createClient();
    let mounted = true;

    supabase.auth
      .getUser()
      .then(({ data }) => {
        if (mounted) setUser(data.user);
      })
      .catch(() => {
        if (mounted) setUser(null);
      });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  if (!configured) return <>{children}</>;

  return (
    <BugReporterProvider
      apiKey={apiKey!}
      apiUrl={apiUrl!}
      enabled={true}
      debug={process.env.NODE_ENV === "development"}
      userContext={
        user
          ? {
              userId: user.id,
              name:
                (user.user_metadata?.full_name as string | undefined) ||
                user.email?.split("@")[0] ||
                "User",
              email: user.email ?? undefined,
            }
          : undefined
      }
    >
      {children}
    </BugReporterProvider>
  );
}
