"use client";

import { useState, useTransition } from "react";
import { Loader2, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Sheet } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { Toggle } from "@/components/ui/toggle";
import { sendEvent, sendPoll } from "@/lib/comms/card-actions";
import { POLL_MAX_OPTIONS } from "@/lib/comms/cards";
import type { DirectoryPerson } from "@/lib/comms/types";
import { PeoplePicker } from "./people-picker";

/**
 * The three 📎 items that ask before they send (0776): Contact, Poll, Event.
 * Each is a small sheet (AGENTS.md "A sub-detail Sheet's size": `sm`, over the
 * pane). Every text here is chat content read by people, not a stored value
 * anything matches on — so none of it is forced to capitals, the same carve-out
 * the message box itself has (lib/comms/types.ts).
 */

/** Share a colleague: tapping a person sends their card at once, as WhatsApp. */
export function ContactSheet({
  open,
  meId,
  onClose,
  onPick,
}: {
  open: boolean;
  meId: string;
  onClose: () => void;
  onPick: (p: DirectoryPerson) => void;
}) {
  return (
    <Sheet open={open} onClose={onClose} title="Share a contact" size="sm" alignToPane>
      <div className="flex h-[24rem] flex-col gap-3">
        <PeoplePicker
          key={open ? "open" : "shut"}
          selected={[]}
          single
          autoFocus
          exclude={[meId]}
          onChange={(next) => {
            if (next[0]) onPick(next[0]);
          }}
        />
      </div>
    </Sheet>
  );
}

export function PollSheet({
  open,
  conversationId,
  onClose,
  onSent,
}: {
  open: boolean;
  conversationId: string;
  onClose: () => void;
  onSent: () => void;
}) {
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState<string[]>(["", ""]);
  const [multi, setMulti] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  // One key per open, so a retried click never posts the poll twice.
  const [clientId, setClientId] = useState(() => crypto.randomUUID());

  function close() {
    setQuestion("");
    setOptions(["", ""]);
    setMulti(true);
    setError(null);
    setClientId(crypto.randomUUID());
    onClose();
  }
  const filled = options.map((o) => o.trim()).filter(Boolean);
  const ready = question.trim().length > 0 && filled.length >= 2;

  function send() {
    if (!ready) return;
    start(async () => {
      const r = await sendPoll({ conversation_id: conversationId, client_id: clientId, question, options, multi });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      close();
      onSent();
    });
  }

  return (
    <Sheet
      open={open}
      onClose={close}
      title="Create poll"
      size="sm"
      alignToPane
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={close} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={send} disabled={pending || !ready}>
            {pending && <Loader2 className="h-4 w-4 animate-spin" />} Send poll
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label="Question" required>
          {/* caps-input: exempt -- a poll question is chat content read by people, like a message */}
          <Input uppercase={false} value={question} maxLength={200} autoFocus onChange={(e) => setQuestion(e.target.value)} placeholder="Ask a question" />
        </Field>
        <div className="flex flex-col gap-1.5">
          <p className="text-xs font-semibold text-muted-foreground">Options (2 to {POLL_MAX_OPTIONS})</p>
          {options.map((o, i) => (
            <div key={i} className="flex items-center gap-1.5">
              {/* caps-input: exempt -- a poll option is chat content read by people */}
              <Input
                uppercase={false}
                value={o}
                maxLength={100}
                aria-label={`Option ${i + 1}`}
                placeholder={`Option ${i + 1}`}
                onChange={(e) => setOptions((prev) => prev.map((x, j) => (j === i ? e.target.value : x)))}
              />
              {options.length > 2 && (
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove option ${i + 1}`}
                  onClick={() => setOptions((prev) => prev.filter((_, j) => j !== i))}
                >
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>
          ))}
          {options.length < POLL_MAX_OPTIONS && (
            <Button variant="ghost" size="sm" className="self-start" data-row-add onClick={() => setOptions((prev) => [...prev, ""])}>
              <Plus className="h-4 w-4" aria-hidden /> Add option
            </Button>
          )}
        </div>
        <Toggle checked={multi} onChange={setMulti} label="Allow multiple answers" />
        {error && (
          <p className="text-sm text-danger" role="alert">
            {error}
          </p>
        )}
      </div>
    </Sheet>
  );
}

function inAWeek(): string {
  const d = new Date(Date.now() + 7 * 86_400_000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function EventSheet({
  open,
  conversationId,
  onClose,
  onSent,
}: {
  open: boolean;
  conversationId: string;
  onClose: () => void;
  onSent: () => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [date, setDate] = useState(inAWeek);
  const [time, setTime] = useState("10:00");
  const [location, setLocation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [clientId, setClientId] = useState(() => crypto.randomUUID());

  function close() {
    setName("");
    setDescription("");
    setDate(inAWeek());
    setTime("10:00");
    setLocation("");
    setError(null);
    setClientId(crypto.randomUUID());
    onClose();
  }
  const ready = name.trim().length > 0 && !!date;

  function send() {
    if (!ready) return;
    start(async () => {
      const r = await sendEvent({
        conversation_id: conversationId,
        client_id: clientId,
        name,
        description: description.trim() || null,
        date,
        time: time || null,
        location: location.trim() || null,
      });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      close();
      onSent();
    });
  }

  return (
    <Sheet
      open={open}
      onClose={close}
      title="Create event"
      size="sm"
      alignToPane
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={close} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={send} disabled={pending || !ready}>
            {pending && <Loader2 className="h-4 w-4 animate-spin" />} Send event
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label="Event name" required>
          {/* caps-input: exempt -- an event name is chat content read by people, like a message */}
          <Input uppercase={false} value={name} maxLength={100} autoFocus onChange={(e) => setName(e.target.value)} placeholder="e.g. NEXT buyer visit" />
        </Field>
        <Field label="Description">
          {/* caps-input: exempt -- chat content read by people */}
          <Textarea uppercase={false} value={description} maxLength={500} rows={2} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Date" required>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Time">
            <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          </Field>
        </div>
        <Field label="Location">
          {/* caps-input: exempt -- chat content read by people */}
          <Input uppercase={false} value={location} maxLength={120} onChange={(e) => setLocation(e.target.value)} placeholder="e.g. Unit 1 sample room" />
        </Field>
        {error && (
          <p className="text-sm text-danger" role="alert">
            {error}
          </p>
        )}
      </div>
    </Sheet>
  );
}
