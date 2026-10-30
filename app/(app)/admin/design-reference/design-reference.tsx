"use client";

import { useEffect, useState, type ReactNode } from "react";
import {
  Ban,
  CalendarRange,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Copy,
  Download,
  FileSpreadsheet,
  FileText,
  Info,
  Layers,
  Lock,
  Pencil,
  Plus,
  Printer,
  RotateCcw,
  Send,
  ShieldCheck,
  Trash2,
  TriangleAlert,
  Undo2,
  Upload,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusDot, StatusPill } from "@/components/ui/status-pill";
import { ToggleGroup } from "@/components/ui/segmented";
import { STATUS_TONES, TASK_PROGRESS, statusTone, type StatusTone } from "@/lib/ui/status-tone";

const TONE_ORDER: StatusTone[] = ["success", "warning", "danger", "info", "neutral"];

const TONE_MEANING: Record<StatusTone, string> = {
  success: "Finished, accepted or in force",
  warning: "Waiting on someone, or half done",
  danger: "The operator must act",
  info: "Moving, out of our hands",
  neutral: "No claim yet, or retired",
};

/** The table, read live and grouped by tone — so this list IS the rule. */
const WORDS_BY_TONE = TONE_ORDER.map((tone) => ({
  tone,
  words: Object.entries(STATUS_TONES)
    .filter(([, t]) => t === tone)
    .map(([w]) => w),
}));

const label = (w: string) => w.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

/* Only tokens in the committed theme; each swatch reads its value live, so a
   colour preset or dark mode shows here exactly as on the screens. */
const TOKENS: { name: string; use: string }[] = [
  { name: "--foreground", use: "Main text" },
  { name: "--muted-foreground", use: "Secondary text, idle icons" },
  { name: "--caption", use: "Captions, helper text" },
  { name: "--border", use: "Dividers, field borders" },
  { name: "--border-strong", use: "Outline buttons under New look" },
  { name: "--canvas", use: "Page background" },
  { name: "--surface", use: "Cards, tables" },
  { name: "--surface-muted", use: "Table headers, subtle fills" },
  { name: "--primary", use: "Primary buttons, links, focus" },
  { name: "--primary-hover", use: "Primary button hover" },
  { name: "--primary-soft", use: "Selected rows, soft highlights" },
  { name: "--accent", use: "Second data colour (charts, KPIs)" },
  { name: "--success", use: "Success text / icons" },
  { name: "--success-soft", use: "Success pill background" },
  { name: "--warning", use: "Warning text / icons" },
  { name: "--warning-soft", use: "Warning pill background" },
  { name: "--danger", use: "Danger text / icons" },
  { name: "--danger-soft", use: "Danger pill background" },
  { name: "--info", use: "Info text / icons" },
  { name: "--info-soft", use: "Info pill background" },
];

const ICONS: { icon: LucideIcon; name: string; use: string }[] = [
  { icon: Plus, name: "Plus", use: "Add a record or row" },
  { icon: Pencil, name: "Pencil", use: "Edit" },
  { icon: Trash2, name: "Trash2", use: "Delete" },
  { icon: X, name: "X", use: "Close, remove a row" },
  { icon: Copy, name: "Copy", use: "Copy from" },
  { icon: Check, name: "Check", use: "Done, selected" },
  { icon: CheckCircle2, name: "CheckCircle2", use: "Approved, completed" },
  { icon: ShieldCheck, name: "ShieldCheck", use: "Verified, permitted" },
  { icon: Send, name: "Send", use: "Submit, send" },
  { icon: RotateCcw, name: "RotateCcw", use: "Return, request rework" },
  { icon: Undo2, name: "Undo2", use: "Revert, refund" },
  { icon: Ban, name: "Ban", use: "Block, cancel" },
  { icon: Lock, name: "Lock", use: "Locked record" },
  { icon: TriangleAlert, name: "TriangleAlert", use: "Warning (the one warning icon)" },
  { icon: Info, name: "Info", use: "Information" },
  { icon: FileText, name: "FileText", use: "Report — a row's Report icon opens the entry's real report page (as Order Entry); no View, no eye (2026-10-30)" },
  { icon: Printer, name: "Printer", use: "Print" },
  { icon: Download, name: "Download", use: "Export, download" },
  { icon: Upload, name: "Upload", use: "Import, attach" },
  { icon: FileSpreadsheet, name: "FileSpreadsheet", use: "Excel export" },
  { icon: ChevronDown, name: "ChevronDown", use: "Open a list or fold" },
  { icon: ChevronRight, name: "ChevronRight", use: "Go into, next" },
  { icon: Users, name: "Users", use: "People, parties" },
  { icon: CalendarRange, name: "CalendarRange", use: "Dates, T&A" },
  { icon: Layers, name: "Layers", use: "BOM, structure" },
  { icon: ClipboardList, name: "ClipboardList", use: "Lists, plans" },
];

function Section({ title, note, children }: { title: string; note?: ReactNode; children: ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardBody className="space-y-3">
        {note && <p className="max-w-3xl text-sm text-muted-foreground">{note}</p>}
        {children}
      </CardBody>
    </Card>
  );
}

function Swatch({ name, use }: { name: string; use: string }) {
  const [value, setValue] = useState<string>("");
  useEffect(() => {
    const read = () =>
      setValue(getComputedStyle(document.documentElement).getPropertyValue(name).trim());
    read();
    // A preset, New look or dark-mode switch rewrites attributes on <html>.
    const mo = new MutationObserver(read);
    mo.observe(document.documentElement, { attributes: true });
    return () => mo.disconnect();
  }, [name]);
  return (
    <div className="flex min-w-0 items-center gap-3 rounded-control border border-border p-2">
      <span
        className="size-9 shrink-0 rounded-control border border-border"
        style={{ background: `var(${name})` }}
        aria-hidden
      />
      <div className="min-w-0 text-xs">
        <div className="font-mono font-semibold text-foreground">{name}</div>
        <div className="text-muted-foreground">{use}</div>
        <div className="font-mono text-muted-foreground">{value || "—"}</div>
      </div>
    </div>
  );
}

export function DesignReference() {
  const [view, setView] = useState<"pending" | "updated" | "draft">("pending");

  return (
    <div className="space-y-4">
      <Section
        title="Buttons"
        note={
          <>
            One shape: 8px corners, 36px (<code>md</code>) or 32px (<code>sm</code>, grids and dense bars). Weight
            follows emphasis — primary, approve and danger <b>700</b>, outline <b>600</b>, ghost and subtle{" "}
            <b>500</b>. One filled button per screen: the next step.
          </>
        }
      >
        {(["md", "sm"] as const).map((size) => (
          <div key={size} className="flex flex-wrap items-center gap-2">
            <span className="w-8 text-xs font-mono text-muted-foreground">{size}</span>
            <Button size={size}>Save</Button>
            <Button size={size} variant="approve">
              Approve
            </Button>
            <Button size={size} variant="danger">
              Delete
            </Button>
            <Button size={size} variant="outline">
              Cancel
            </Button>
            <Button size={size} variant="ghost">
              View
            </Button>
            <Button size={size} variant="subtle">
              Filters
            </Button>
            <Button size={size} variant="outline">
              <Plus aria-hidden /> Add row
            </Button>
            <Button size={size} disabled>
              Disabled
            </Button>
          </div>
        ))}
        <div className="flex flex-wrap items-center gap-2">
          <span className="w-8 text-xs font-mono text-muted-foreground">icon</span>
          <Button size="icon" variant="ghost" aria-label="Edit">
            <Pencil aria-hidden />
          </Button>
          <Button size="icon" variant="ghost" aria-label="Delete">
            <Trash2 aria-hidden />
          </Button>
          <Button size="icon" variant="outline" aria-label="Print">
            <Printer aria-hidden />
          </Button>
        </div>
        <div className="space-y-1">
          <div className="text-xs font-semibold text-muted-foreground">Pick one of these words — ToggleGroup</div>
          <ToggleGroup
            label="Queue"
            value={view}
            onChange={setView}
            options={[
              { value: "pending", label: "Pending" },
              { value: "updated", label: "Updated" },
              { value: "draft", label: "Draft" },
            ]}
          />
        </div>
      </Section>

      <Section
        title="Status colours"
        note="Five tones, each a soft background with coloured text at weight 600. Under New look each pill also carries an icon, so a status reads without its colour."
      >
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-5">
          {TONE_ORDER.map((tone) => (
            <div key={tone} className="space-y-1.5 rounded-control border border-border p-3">
              <div className="flex items-center gap-2">
                <StatusPill tone={tone}>{label(tone)}</StatusPill>
                <StatusDot tone={tone} />
              </div>
              <div className="text-xs text-muted-foreground">{TONE_MEANING[tone]}</div>
              <div className="font-mono text-[11px] text-muted-foreground">
                --{tone} on --{tone === "neutral" ? "surface-muted" : `${tone}-soft`}
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section
        title="Which status gets which colour"
        note={
          <>
            Read live from <code>lib/ui/status-tone.ts</code> — the one table every screen uses. Matching is exact:
            &ldquo;Not Approved&rdquo; is its own word, never &ldquo;approved&rdquo; with something in front. A word
            not listed shows grey. A module that genuinely means something else passes a documented override — e.g.
            on a T&amp;A step <StatusPill tone={statusTone("pending", TASK_PROGRESS)}>Pending</StatusPill> means not
            started, where on an approval{" "}
            <StatusPill tone={statusTone("pending")}>Pending</StatusPill> means waiting on someone.
          </>
        }
      >
        <div className="space-y-3">
          {WORDS_BY_TONE.map(({ tone, words }) => (
            <div key={tone} className="flex flex-col gap-1.5 sm:flex-row sm:items-start sm:gap-3">
              <div className="w-24 shrink-0 pt-0.5 text-xs font-semibold capitalize text-muted-foreground">{tone}</div>
              <div className="flex min-w-0 flex-wrap gap-1.5">
                {words.map((w) => (
                  <StatusPill key={w} tone={statusTone(w)}>
                    {label(w)}
                  </StatusPill>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section
        title="Colour tokens"
        note="Use the token, never a raw Tailwind colour (red-600, amber-50…): tokens follow the colour preset and dark mode, raw colours do not. Values below are this browser's, right now."
      >
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {TOKENS.map((t) => (
            <Swatch key={t.name} {...t} />
          ))}
        </div>
      </Section>

      <Section
        title="Icons"
        note={
          <>
            lucide-react only. 16px in buttons and toolbars (a Button sizes its own icon), 14px in dense rows and
            pills. Colour is inherited from the text; idle icons use <code>text-muted-foreground</code>.
          </>
        }
      >
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {ICONS.map(({ icon: Icon, name, use }) => (
            <div key={name} className="flex min-w-0 items-center gap-3 rounded-control border border-border p-2">
              <Icon className="size-4 shrink-0 text-foreground" aria-hidden />
              <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
              <div className="min-w-0 text-xs">
                <div className="font-mono font-semibold text-foreground">{name}</div>
                <div className="text-muted-foreground">{use}</div>
              </div>
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}
