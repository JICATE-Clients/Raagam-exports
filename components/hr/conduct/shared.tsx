"use client";

import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "@/components/ui/field";
import { Sheet } from "@/components/ui/sheet";
import { fmtDateTime } from "@/lib/format";

/**
 * HR ▸ Conduct & Policies (0791) — pieces the three screens share.
 */

/**
 * A short note or reason, with its minimum length said up front. `min` 0
 * makes it optional (an acknowledgement's remark). `children` sits between
 * the intro and the box — a tick, a picker.
 */
export function NoteSheet({
  open,
  title,
  intro,
  label = "Reason",
  min = 1,
  confirmLabel,
  danger = false,
  busy,
  onClose,
  onConfirm,
  children,
}: {
  open: boolean;
  title: string;
  intro: ReactNode;
  label?: string;
  min?: number;
  confirmLabel: string;
  danger?: boolean;
  busy: boolean;
  onClose: () => void;
  onConfirm: (note: string) => void;
  children?: ReactNode;
}) {
  const [note, setNote] = useState("");
  const short = note.trim().length < min;
  function close() {
    setNote("");
    onClose();
  }
  return (
    <Sheet
      open={open}
      onClose={close}
      title={title}
      size="sm"
      footer={
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">{short && min > 1 ? `At least ${min} characters` : ""}</span>
          <div className="flex gap-2">
            <Button variant="outline" onClick={close}>
              Cancel
            </Button>
            <Button
              variant={danger ? "danger" : "primary"}
              disabled={busy || short}
              onClick={() => {
                onConfirm(note);
                setNote("");
              }}
            >
              {confirmLabel}
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-3 text-sm">
        <div>{intro}</div>
        {children}
        <Field label={label} required={min > 0}>
          <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
    </Sheet>
  );
}

/** A tick with its words beside it. */
export function Tick({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  return (
    <label className="flex items-start gap-2 text-sm">
      <input
        type="checkbox"
        className="mt-0.5 size-4 accent-[var(--primary)]"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>{children}</span>
    </label>
  );
}

/** A diary: what happened, when, by whom. */
export function Diary({ rows }: { rows: { id: string; title: string; note: string | null; at: string; actor: string | null }[] }) {
  if (!rows.length) return <p className="text-sm text-muted-foreground">Nothing yet.</p>;
  return (
    <ol className="space-y-3 border-l border-border pl-4">
      {rows.map((r) => (
        <li key={r.id} className="relative">
          <span className="absolute -left-[21px] top-1.5 size-2.5 rounded-full bg-primary" aria-hidden />
          <p className="text-sm font-medium">{r.title}</p>
          {r.note && <p className="whitespace-pre-wrap text-sm text-foreground/80">{r.note}</p>}
          <p className="text-xs text-muted-foreground">
            {fmtDateTime(r.at)}
            {r.actor ? ` · ${r.actor}` : ""}
          </p>
        </li>
      ))}
    </ol>
  );
}
