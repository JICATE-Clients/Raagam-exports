"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { tokenFromPaste } from "./token-shape";

/** Paste the private link (or just its code) → open its tracking page. */
export function TrackLookupForm() {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      data-focus-scope
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        const token = tokenFromPaste(value);
        if (!token) {
          setError("Paste the tracking link you were given when you sent the complaint.");
          return;
        }
        setError(null);
        router.push(`/p/track/${encodeURIComponent(token)}`);
      }}
    >
      <Field label="Tracking link" required error={error ?? undefined}>
        {/* caps-input: exempt -- a pasted URL / case-sensitive token; capitals would break it. */}
        <Input uppercase={false} value={value} onChange={(e) => setValue(e.target.value)} spellCheck={false} />
      </Field>
      <div className="flex justify-end">
        <Button type="submit">Track</Button>
      </div>
    </form>
  );
}
