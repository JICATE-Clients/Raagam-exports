"use client";

// Debounced real-time duplicate-name check. Returns an error string while the
// typed name collides with an existing record (else null). Backstopped by the
// on-save guard in each master's create/update action.

import { useEffect, useState } from "react";
import { checkDuplicate } from "@/lib/masters/duplicate-actions";

export function useDuplicateCheck(args: {
  table: string;
  name: string;
  nameColumn?: string;
  excludeId?: string;
  scope?: Record<string, string | null>;
  /** Skip checking while false (e.g. required-field empty). Defaults to true. */
  enabled?: boolean;
}): string | null {
  const { table, name, nameColumn, excludeId, scope, enabled = true } = args;
  const [error, setError] = useState<string | null>(null);
  const scopeKey = JSON.stringify(scope ?? {});

  useEffect(() => {
    if (!enabled || !name.trim()) {
      setError(null);
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      const res = await checkDuplicate(table, name.trim(), {
        nameColumn,
        excludeId,
        scope: scope ?? undefined,
      });
      if (!cancelled) setError(res.ok ? null : res.error);
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
    // scopeKey captures `scope` object identity-independently
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table, name, nameColumn, excludeId, scopeKey, enabled]);

  return error;
}
