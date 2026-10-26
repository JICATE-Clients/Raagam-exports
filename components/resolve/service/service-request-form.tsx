"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CircleCheck, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { Field, FieldError, FieldRow } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { logCall as logCallAction, submitServiceRequest } from "@/lib/resolve/desk-actions";
import {
  DESK_CHANNELS,
  SOURCE_LABEL,
  TICKET_TYPE_LABEL,
  type DeskChannel,
  type Impact,
  type KbSearchHit,
  type OpenServiceCategory,
} from "@/lib/resolve/desk-types";
import { PhotoCapture, type CapturedPhoto } from "@/components/resolve/report/photo-capture";
import { KbSuggestions } from "@/components/resolve/kb/kb-suggestions";

/** The three words the requester answers with — never a priority (plan §1.3). */
const IMPACT_OPTIONS: { value: Impact; label: string }[] = [
  { value: "cannot_work", label: "Cannot work" },
  { value: "degraded", label: "With difficulty" },
  { value: "request", label: "Just a request" },
];
const IMPACT_HINT: Record<Impact, string> = {
  cannot_work: "Nothing works for you until this is fixed — it is answered first.",
  degraded: "You can carry on, but it is slowing you down.",
  request: "Nothing is broken — you are asking for something.",
};

/**
 * NEED IT HELP — the service request, phone first (service-desk-plan §6).
 *
 * The requester says WHAT (category), the problem in a line, and how much it
 * stops them (impact). Everything else — type, priority, which team, the two
 * SLA clocks — is the server's, and comes back on the receipt. While they type
 * the title, published knowledge-base articles that match are offered under it:
 * "This solved it" ends the visit without a ticket.
 *
 * `logCall` turns the same form into the desk's Log a Call (`/resolve/desk/log`):
 * a requester picker and the channel the call came in on lead the form, and the
 * ticket is raised on that person's behalf (`resolve:edit`, no rate limit).
 */
export function ServiceRequestForm({
  categories,
  logCall,
}: {
  categories: OpenServiceCategory[];
  logCall?: { people: { id: string; name: string }[] };
}) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();

  const [requesterId, setRequesterId] = useState("");
  const [channel, setChannel] = useState<DeskChannel>("phone");
  const [categoryId, setCategoryId] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [impact, setImpact] = useState<Impact | "">("");
  const [photo, setPhoto] = useState<CapturedPhoto | null>(null);
  const [attempted, setAttempted] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [solved, setSolved] = useState<KbSearchHit | null>(null);

  const dirty =
    !sent &&
    (title.trim() !== "" ||
      description.trim() !== "" ||
      categoryId !== "" ||
      impact !== "" ||
      photo !== null ||
      requesterId !== "");
  useUnsavedGuard(dirty || isPending);

  const categoryOptions = useMemo<ComboboxOption[]>(
    () =>
      categories.map((c) => ({
        value: c.id,
        label: c.name,
        sublabel: TICKET_TYPE_LABEL[c.ticket_type],
        search: c.code,
      })),
    [categories],
  );
  const peopleOptions = useMemo<ComboboxOption[]>(
    () => (logCall?.people ?? []).map((p) => ({ value: p.id, label: p.name })),
    [logCall],
  );
  const category = categories.find((c) => c.id === categoryId) ?? null;

  const requesterMissing = !!logCall && !requesterId;
  const categoryMissing = !categoryId;
  const titleMissing = !title.trim();
  const impactMissing = impact === "";
  const descriptionMissing = description.trim().length < 3;

  function reset() {
    setCategoryId("");
    setTitle("");
    setDescription("");
    setImpact("");
    setPhoto(null);
    setAttempted(false);
    setServerError(null);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setAttempted(true);
    setServerError(null);
    if (requesterMissing || categoryMissing || titleMissing || descriptionMissing || impactMissing) return;
    const fd = new FormData();
    fd.set("category_id", categoryId);
    fd.set("title", title.trim());
    fd.set("description", description.trim());
    fd.set("impact", impact);
    if (logCall) {
      fd.set("requester_id", requesterId);
      fd.set("source", channel);
    } else {
      fd.set("source", "form");
    }
    if (photo) fd.set("photo", photo.file);
    startTransition(async () => {
      const res = await (logCall ? logCallAction(fd) : submitServiceRequest(fd));
      if (!res.ok) {
        setServerError(res.error);
        toastError(res.error);
        return;
      }
      setSent(true);
      if (logCall) success(`Logged ${res.data.ref_no}. Read the reference back to the caller.`);
      router.push(`/resolve/tickets/${res.data.ticket_id}?receipt=1`);
    });
  }

  if (solved) {
    return (
      <div role="status" className="w-full max-w-[40rem] space-y-3 rounded-lg border border-success/40 bg-success-soft/50 p-4">
        <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <CircleCheck className="h-4 w-4 text-success" aria-hidden />
          Glad that sorted it — no request was sent.
        </p>
        <p className="text-sm text-muted-foreground">
          Thank you for saying so: it tells the desk that &ldquo;{solved.title}&rdquo; helps people.
        </p>
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            setSolved(null);
            reset();
          }}
        >
          Ask about something else
        </Button>
      </div>
    );
  }

  const busy = isPending || sent;

  return (
    <form
      onSubmit={submit}
      // ONE MARKER, NEVER A HANDLER — a page form joins the Tab/Enter contract.
      data-focus-scope
      className="w-full max-w-[40rem] space-y-4"
      /* 40rem: the 288px name step twice over plus the gap — the same cap as
         the Broken form beside it; the title and details read as sentences. */
    >
      {logCall ? (
        <FieldRow align="start">
          <Field
            label="Caller"
            required
            w="name"
            error={attempted && requesterMissing ? "Pick who is calling." : undefined}
          >
            <Combobox options={peopleOptions} value={requesterId} onChange={setRequesterId} />
          </Field>
          <Field label="Came in by" w="name">
            <Segmented<DeskChannel>
              name="sd-log-channel"
              value={channel}
              onChange={setChannel}
              options={DESK_CHANNELS.map((c) => ({ value: c, label: SOURCE_LABEL[c] }))}
            />
          </Field>
        </FieldRow>
      ) : null}

      <FieldRow align="start">
        <Field
          label="What is it about"
          required
          w="name"
          hint={category?.description ?? undefined}
          error={attempted && categoryMissing ? "Pick what the problem is about." : undefined}
        >
          <Combobox options={categoryOptions} value={categoryId} onChange={setCategoryId} />
        </Field>
      </FieldRow>

      <Field
        label="In a few words"
        required
        error={attempted && titleMissing ? "Say in a few words what is wrong or what you need." : undefined}
      >
        <Input value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />
      </Field>

      <KbSuggestions
        query={title}
        categoryCode={category?.code ?? null}
        disabled={busy}
        onSolved={(hit) => {
          reset();
          setSolved(hit);
        }}
      />

      <Field
        label="What happened, or what you need"
        required
        hint="Any error message, and what you were doing when it appeared."
        error={attempted && descriptionMissing ? "Say what happened, or what you need." : undefined}
      >
        <Textarea
          value={description}
          maxLength={4000}
          rows={4}
          onChange={(e) => setDescription(e.target.value)}
        />
      </Field>

      <Field
        label="How much does it stop you"
        required
        hint={impact ? IMPACT_HINT[impact] : undefined}
        error={attempted && impactMissing ? "Say how much this stops you working." : undefined}
      >
        <Segmented<Impact | "">
          name="sd-impact"
          value={impact}
          onChange={setImpact}
          options={IMPACT_OPTIONS}
          disabled={busy}
        />
      </Field>

      <div className="space-y-1.5">
        <p className="text-sm font-medium text-foreground">Screenshot or photo</p>
        <PhotoCapture value={photo} onChange={setPhoto} disabled={busy} takeLabel="Take a photo of the screen" />
        <p className="text-xs text-muted-foreground">Optional. An error message on screen helps the desk most.</p>
      </div>

      {serverError ? <FieldError>{serverError}</FieldError> : null}

      <div className="flex justify-end border-t border-border pt-3">
        <Button type="submit" disabled={busy}>
          <Send className="h-4 w-4" aria-hidden />
          {isPending ? "Sending…" : logCall ? "Log the call" : "Send request"}
        </Button>
      </div>
    </form>
  );
}
