"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ChildGrid, type ChildGridColumn } from "@/components/masters/child-grid";
import { Field, FieldRow } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Sheet } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { saveKbArticle } from "@/lib/resolve/desk-actions";
import type { OpenServiceCategory } from "@/lib/resolve/desk-types";

/** What the editor opens with — an article being edited, or a draft pre-filled
 *  from a resolved ticket (`kb_draft`: root cause → problem, resolution → steps). */
export type KbDraft = {
  id?: string;
  title: string;
  problem: string;
  steps: string[];
  tags: string[];
  category_code: string | null;
  source_ticket_id: string | null;
};

type StepRow = { key: string; text: string };

let seq = 0;
const stepRow = (text = ""): StepRow => ({ key: `s${++seq}`, text });
const stepBlank = (r: StepRow) => r.text.trim() === "";

/**
 * A ticket's resolution is one block of prose; an article is numbered steps.
 * Split on line breaks, else on sentence ends, so the technician starts from
 * their own words already in rows rather than one long first step.
 */
export function stepsFromText(text: string | null | undefined): string[] {
  const t = (text ?? "").trim();
  if (!t) return [];
  const lines = t.split(/\r?\n+/).map((s) => s.replace(/^\s*(\d+[.)]|[-*•])\s*/, "").trim()).filter(Boolean);
  if (lines.length > 1) return lines;
  return t.split(/(?<=[.!?])\s+(?=\S)/).map((s) => s.trim()).filter(Boolean);
}

/**
 * THE KNOWLEDGE-BASE EDITOR (service-desk-plan §6) — title, problem, steps,
 * tags, category. Saving creates a DRAFT (`rh_kb_save`); publishing is a
 * separate, deliberate step on the article page, so an article written in a
 * hurry from a ticket is never suggested to requesters before someone reads it.
 *
 * Steps are a `ChildGrid` with a BLANK END ROW (AGENTS "A table may keep a
 * blank end row"): typing into it makes it a step and a fresh blank appears;
 * Enter on the untouched blank leaves the table. The schema drops the blank, so
 * it is never saved. `md`, not `sm`: the sheet carries a ChildGrid (AGENTS "A
 * sub-detail Sheet's size").
 *
 * Mounted only while open (the caller renders it conditionally), so every
 * opening starts from `draft` with nothing left over from the last one.
 */
export function KbEditorSheet({
  draft,
  categories,
  onClose,
  onSaved,
}: {
  draft: KbDraft;
  categories: OpenServiceCategory[];
  onClose: () => void;
  /** After a save — the caller decides where to go (the article page). */
  onSaved?: (id: string) => void;
}) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();
  const [title, setTitle] = useState(draft.title);
  const [problem, setProblem] = useState(draft.problem);
  const [steps, setSteps] = useState<StepRow[]>(() => draft.steps.map((s) => stepRow(s)));
  const [tags, setTags] = useState(draft.tags.join(", "));
  const [categoryCode, setCategoryCode] = useState(draft.category_code ?? "");
  const [dirty, setDirty] = useState(false);
  useUnsavedGuard(dirty || isPending);

  const filled = steps.filter((r) => !stepBlank(r));
  const canSave = title.trim() !== "" && problem.trim().length >= 3 && filled.length > 0 && !isPending;
  // A category retired since the article was written stays on it, labelled.
  const codes = categories.some((c) => c.code === categoryCode) || !categoryCode
    ? categories
    : [...categories, { id: categoryCode, code: categoryCode, name: `${categoryCode} (inactive)`, description: null, ticket_type: "incident" as const }];

  const edit = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setDirty(true);
  };

  const stepColumns: ChildGridColumn<StepRow>[] = [
    {
      header: "Step",
      cell: (r) => (
        <Input
          value={r.text}
          maxLength={1000}
          aria-label="Step"
          onChange={(e) => {
            const text = e.target.value;
            setSteps((rows) => rows.map((x) => (x.key === r.key ? { ...x, text } : x)));
            setDirty(true);
          }}
        />
      ),
    },
  ];

  function save() {
    startTransition(async () => {
      const res = await saveKbArticle({
        id: draft.id,
        title,
        problem,
        steps: filled.map((r) => r.text),
        tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
        category_code: categoryCode || null,
        source_ticket_id: draft.source_ticket_id,
      });
      if (!res.ok) {
        toastError(res.error);
        return;
      }
      setDirty(false);
      success(draft.id ? "Article saved." : "Draft saved. Publish it from the article page when it is ready.");
      router.refresh();
      onSaved?.(res.data.id);
      onClose();
    });
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title={draft.id ? "Edit article" : "New knowledge-base article"}
      size="md"
      footer={
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={isPending}>
            Cancel
          </Button>
          <Button type="button" onClick={save} disabled={!canSave}>
            {isPending ? "Saving…" : draft.id ? "Save article" : "Save draft"}
          </Button>
        </div>
      }
    >
      {/* 288 (title) + 144 (category) + 12 gap = 444px; problem and steps take the row.
          Capped at 46rem (736px) so the steps read as a list, not a banner. */}
      <div className="max-w-[46rem] space-y-4">
        <FieldRow>
          <Field label="Title" required w="name">
            <Input value={title} maxLength={160} onChange={(e) => edit(setTitle)(e.target.value)} />
          </Field>
          <Field label="Category" w="term">
            <Select value={categoryCode} onChange={(e) => edit(setCategoryCode)(e.target.value)}>
              <option value="">Any</option>
              {codes.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
        </FieldRow>
        <Field label="Problem it solves" required>
          <Textarea rows={3} maxLength={4000} value={problem} onChange={(e) => edit(setProblem)(e.target.value)} />
        </Field>
        <div className="space-y-1.5">
          {/* No `*`: the blank end row is never held (a held row nobody asked
              for is a cage), so "at least one step" is Save's to refuse. */}
          <p className="text-sm font-medium text-foreground">Steps</p>
          <ChildGrid<StepRow>
            columns={stepColumns}
            rows={steps}
            tableFrom="5xl"
            onAdd={() => {
              setSteps((rows) => [...rows, stepRow()]);
            }}
            tailRow={stepBlank}
            onRemove={(r) => {
              setSteps((rows) => rows.filter((x) => x.key !== r.key));
              setDirty(true);
            }}
          />
        </div>
        <Field label="Tags" hint="Separate with commas — words a requester might type.">
          <Input value={tags} maxLength={400} onChange={(e) => edit(setTags)(e.target.value)} />
        </Field>
      </div>
    </Sheet>
  );
}
