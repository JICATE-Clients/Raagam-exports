"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { Field, FieldError, FieldRow } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Toggle } from "@/components/ui/toggle";
import { useToast } from "@/components/ui/toast";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { submitComplaint } from "@/lib/resolve/actions";
import type { OpenComplaintCategory } from "@/lib/resolve/types";
import { AnonymousReceipt } from "./anonymous-receipt";
import { WhoSeesIt } from "./who-sees-it";

type Shown = { refNo: string; trackingUrl: string; responseDueAt: string | null };

/**
 * MAKE A COMPLAINT (spec §4 "Complaint report", plan §10.7).
 *
 * Category, subject and description are mandatory; "Send anonymously" exists
 * only when the chosen category allows it (and is dropped the moment a
 * category that does not is picked — a hidden switch left on would be a
 * decision the person can no longer see). The `WhoSeesIt` box restates, in
 * plain words, what the toggles mean before anything is sent.
 *
 * After sending: a named complaint goes to its ticket page's receipt; an
 * anonymous one has no ticket the person can open, so its receipt — and the
 * one-time tracking link — renders HERE from the action's result.
 */
export function ComplaintForm({ categories }: { categories: OpenComplaintCategory[] }) {
  const router = useRouter();
  const { error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();

  const [categoryId, setCategoryId] = useState("");
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [anonymous, setAnonymous] = useState(false);
  const [aboutSuperior, setAboutSuperior] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [shown, setShown] = useState<Shown | null>(null);

  const category = categories.find((c) => c.id === categoryId) ?? null;
  const canBeAnonymous = !!category?.anonymous_allowed;
  const isAnonymous = canBeAnonymous && anonymous;

  const dirty =
    !sent && (categoryId !== "" || subject.trim() !== "" || description.trim() !== "" || anonymous || aboutSuperior);
  // While the one-time link is on screen the guard stays UP: a silent deploy
  // reload there would destroy the only copy of it.
  useUnsavedGuard(dirty || isPending || shown !== null);

  const options = useMemo<ComboboxOption[]>(
    () => categories.map((c) => ({ value: c.id, label: c.name, sublabel: c.description ?? undefined })),
    [categories],
  );

  if (shown) {
    return (
      <AnonymousReceipt
        refNo={shown.refNo}
        trackingUrl={shown.trackingUrl}
        responseDueAt={shown.responseDueAt}
        onDone={() => {
          setShown(null);
          router.push("/resolve/report");
        }}
      />
    );
  }

  const missing = {
    category: !categoryId,
    subject: !subject.trim(),
    description: !description.trim(),
  };

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setAttempted(true);
    setServerError(null);
    if (missing.category || missing.subject || missing.description) return;
    startTransition(async () => {
      const res = await submitComplaint({
        category_id: categoryId,
        subject: subject.trim(),
        description: description.trim(),
        is_anonymous: isAnonymous,
        about_superior: aboutSuperior,
      });
      if (!res.ok) {
        setServerError(res.error);
        toastError(res.error);
        return;
      }
      setSent(true);
      const r = res.data;
      if (r.ticket_id) {
        router.push(`/resolve/tickets/${r.ticket_id}?receipt=1`);
        return;
      }
      if (!r.tracking_token) {
        // Anonymous but no token back: say so rather than show a receipt with no way in.
        setSent(false);
        setServerError("The complaint was sent, but no tracking link came back. Ask the administrator to check it.");
        return;
      }
      setShown({
        refNo: r.ref_no,
        // Built in the browser from where the person is now — never routed
        // through a URL of this app, so it cannot land in history or logs.
        trackingUrl: `${window.location.origin}/p/track/${r.tracking_token}`,
        responseDueAt: r.response_due_at,
      });
    });
  }

  return (
    <form
      onSubmit={submit}
      // ONE MARKER, NEVER A HANDLER — an editor scope, so Tab walks the fields
      // and Enter off the last one sends (keyboard contract).
      data-focus-scope
      className="w-full max-w-[40rem] space-y-4"
      /* 40rem: the same cap as the Broken form — a subject line and a paragraph. */
    >
      <FieldRow align="start">
        <Field
          label="Category"
          required
          w="name"
          hint={category?.description ?? undefined}
          error={attempted && missing.category ? "Pick what the complaint is about." : undefined}
        >
          <Combobox
            options={options}
            value={categoryId}
            onChange={(v) => {
              setCategoryId(v);
              if (!categories.find((c) => c.id === v)?.anonymous_allowed) setAnonymous(false);
            }}
          />
        </Field>
      </FieldRow>

      <Field
        label="Subject"
        required
        error={attempted && missing.subject ? "Give it a short subject." : undefined}
      >
        <Input value={subject} maxLength={160} onChange={(e) => setSubject(e.target.value)} />
      </Field>

      <Field
        label="What happened"
        required
        error={attempted && missing.description ? "Describe what happened." : undefined}
      >
        <Textarea rows={5} maxLength={4000} value={description} onChange={(e) => setDescription(e.target.value)} />
      </Field>

      <div className="space-y-2">
        {canBeAnonymous ? (
          <Toggle checked={anonymous} onChange={setAnonymous} label="Send anonymously" />
        ) : null}
        <Toggle checked={aboutSuperior} onChange={setAboutSuperior} label="This is about my superior" />
      </div>

      <WhoSeesIt
        sensitive={!!category?.is_sensitive}
        anonymous={isAnonymous}
        aboutSuperior={aboutSuperior}
        responseHours={null}
      />

      {serverError ? <FieldError>{serverError}</FieldError> : null}

      <div className="flex justify-end border-t border-border pt-3">
        <Button type="submit" disabled={isPending || sent}>
          <Send className="h-4 w-4" aria-hidden />
          {isPending ? "Sending…" : isAnonymous ? "Send anonymously" : "Send complaint"}
        </Button>
      </div>
    </form>
  );
}
