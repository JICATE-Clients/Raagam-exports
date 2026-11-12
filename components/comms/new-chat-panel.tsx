"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { ArrowLeft, ArrowRight, Building2, Camera, Check, Loader2, Megaphone, Search, UserPlus, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Truncated } from "@/components/ui/truncated";
import { useAppUser } from "@/lib/auth/permission-context";
import { hasPermission } from "@/lib/auth/types";
import { createGroup, findPeople, openDirect } from "@/lib/comms/actions";
import type { DirectoryPerson } from "@/lib/comms/types";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { cn } from "@/lib/utils";
import { Face } from "./person-photo";
import { WithPresence } from "./presence";
import { NewCommunitySheet } from "./new-community-sheet";

/**
 * NEW CHAT, WHATSAPP'S WAY (user 2026-11-12, screenshot 142515 + artifact
 * "Comms New Chat Panel": "new chat button click panna whatsapp la irukka mari
 * venum"). The New button no longer opens a centred sheet or the To: screen —
 * this panel slides in OVER the chat list, the same width, the way WhatsApp
 * desktop does:
 *
 * - ← New chat, a search pill, then New group · New channel · New community.
 * - The directory A–Z under sticky letter headings. Tapping a person opens
 *   (or finds — the database keeps one per pair) the DM at once.
 * - New group is a second step in the same panel (Add group members: tick
 *   people, chips above, → ), then a third (group name, ✓).
 *
 * ↑ ↓ walk the list, Enter opens / ticks, Esc steps back one layer — the
 * comms frame is `data-focus-scope="off"`, so the panel owns its keys.
 *
 * "Message yourself" from the WhatsApp screenshot is not offered:
 * comm_open_direct is a two-person DM and refuses the caller as the other side.
 */
export type NewChatMode = "direct" | "group";

export function NewChatPanel({
  open,
  startMode = "direct",
  onClose,
}: {
  open: boolean;
  startMode?: NewChatMode;
  onClose: () => void;
}) {
  const me = useAppUser();
  const router = useRouter();
  const canCreateChannel = hasPermission(me, "communication", "create");
  // "direct" → "group" (pick members) → "name". Declared above every return.
  const [step, setStep] = useState<"direct" | "group" | "name">(startMode);
  const [q, setQ] = useState("");
  const [people, setPeople] = useState<DirectoryPerson[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [picked, setPicked] = useState<DirectoryPerson[]>([]);
  const [groupName, setGroupName] = useState("");
  const [hl, setHl] = useState(0);
  const [community, setCommunity] = useState(false);
  const [pending, start] = useTransition();
  const [opening, setOpening] = useState<string | null>(null);
  const seq = useRef(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // A half-built group is typed work: hold the silent auto-reload off it.
  useUnsavedGuard(open && (picked.length > 0 || pending));

  // Each opening starts clean, in the mode it was asked for.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setStep(startMode);
      setQ("");
      setPicked([]);
      setGroupName("");
      setError(null);
      setHl(0);
      setOpening(null);
    }
  }

  useEffect(() => {
    if (!open) return;
    const mine = ++seq.current;
    const t = setTimeout(async () => {
      setLoading(true);
      const r = await findPeople(q, q.trim() ? 50 : 300);
      if (mine !== seq.current) return; // a newer keystroke owns the list
      setLoading(false);
      if (r.ok) {
        setPeople(r.people.filter((p) => p.id !== me.id));
        setError(null);
      } else setError(r.error);
    }, q ? 250 : 0);
    return () => clearTimeout(t);
  }, [open, q, retry, me.id]);

  useEffect(() => {
    if (!open || step === "name") return;
    const raf = requestAnimationFrame(() => searchRef.current?.focus());
    return () => cancelAnimationFrame(raf);
  }, [open, step]);

  // The rows ↑ ↓ walk, in screen order.
  const term = q.trim();
  const shortcuts: { key: string; label: string; icon: typeof UserPlus; run: () => void }[] =
    step === "direct" && !term
      ? [
          { key: "group", label: "New group", icon: UserPlus, run: () => toStep("group") },
          ...(canCreateChannel
            ? [{ key: "channel", label: "New channel", icon: Megaphone, run: () => { onClose(); router.push("/comms/channels?create=1"); } }]
            : []),
          { key: "community", label: "New community", icon: Building2, run: () => setCommunity(true) },
        ]
      : [];
  const sections = byLetter(people);
  const ordered = sections.flatMap(([, ps]) => ps);
  const rowCount = shortcuts.length + ordered.length;
  const hlAt = Math.min(hl, Math.max(rowCount - 1, 0));

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-row="${hlAt}"]`)?.scrollIntoView({ block: "nearest" });
  }, [hlAt]);

  function toStep(next: "direct" | "group" | "name") {
    setStep(next);
    setQ("");
    setHl(0);
    setError(null);
    if (next === "direct") setPicked([]);
  }

  function back() {
    if (pending) return;
    if (step === "name") setStep("group");
    else if (step === "group" && startMode === "direct") toStep("direct");
    else onClose();
  }

  function openWith(p: DirectoryPerson) {
    if (pending) return;
    setOpening(p.full_name);
    setError(null);
    start(async () => {
      const r = await openDirect(p.id);
      if (!r.ok) {
        setOpening(null);
        setError(r.error);
        return;
      }
      onClose();
      if (r.id) router.push(`/comms/c/${r.id}`);
    });
  }

  function toggle(p: DirectoryPerson) {
    setPicked((list) => (list.some((x) => x.id === p.id) ? list.filter((x) => x.id !== p.id) : [...list, p]));
  }

  function create() {
    if (picked.length === 0 || pending) return;
    setError(null);
    start(async () => {
      const r = await createGroup({ name: groupName.trim() || null, member_ids: picked.map((p) => p.id) });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      onClose();
      if (r.id) router.push(`/comms/c/${r.id}`);
    });
  }

  function activate(i: number) {
    if (i < shortcuts.length) return shortcuts[i].run();
    const p = ordered[i - shortcuts.length];
    if (!p) return;
    if (step === "group") toggle(p);
    else openWith(p);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (community) return;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      back();
      return;
    }
    if (step === "name") return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setHl(Math.max(0, Math.min(rowCount - 1, hlAt + (e.key === "ArrowDown" ? 1 : -1))));
    } else if (e.key === "Enter" && rowCount > 0) {
      e.preventDefault();
      activate(hlAt);
    }
  }

  const title = step === "direct" ? "New chat" : step === "group" ? "Add group members" : "New group";
  const chosen = new Set(picked.map((p) => p.id));
  let n = shortcuts.length;

  return (
    <>
      <div
        role="dialog"
        aria-label={title}
        aria-hidden={!open}
        inert={!open}
        onKeyDown={onKeyDown}
        className={cn(
          "absolute inset-0 z-20 flex flex-col bg-surface transition-transform duration-200 ease-out motion-reduce:transition-none",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <header className="flex h-11 shrink-0 items-center gap-2 px-2">
          <button
            type="button"
            onClick={back}
            aria-label="Back"
            title="Back (Esc)"
            className="grid h-8 w-8 place-items-center rounded-full text-foreground hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ArrowLeft className="h-5 w-5" aria-hidden />
          </button>
          <h2 className="text-[15px] font-semibold text-heading">{title}</h2>
        </header>

        {step === "name" ? (
          <div className="flex min-h-0 flex-1 flex-col items-center gap-5 overflow-y-auto px-5 py-4">
            <span className="grid h-28 w-28 place-items-center rounded-full bg-surface-muted text-muted-foreground" aria-hidden>
              <Camera className="h-9 w-9" />
            </span>
            <label className="flex w-full flex-col gap-1 text-xs text-muted-foreground">
              Group name (optional)
              {/* caps-input: exempt -- display text read by people (a conversation name), like a chat message; nothing matches on it */}
              <Input
                uppercase={false}
                value={groupName}
                maxLength={80}
                autoFocus
                onChange={(e) => setGroupName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    create();
                  }
                }}
                className="rounded-none border-0 border-b-2 border-primary bg-transparent px-0.5 text-[15px] focus-visible:ring-0"
              />
            </label>
            <p className="w-full text-[13px] text-muted-foreground">
              {picked.length} member{picked.length === 1 ? "" : "s"}: {picked.map((p) => p.full_name).join(", ")}
            </p>
            {error && (
              <p className="w-full text-sm text-danger" role="alert">
                {error}
              </p>
            )}
            <Fab label="Create group" onClick={create} busy={pending}>
              <Check className="h-6 w-6" aria-hidden />
            </Fab>
          </div>
        ) : (
          <>
            {step === "group" && picked.length > 0 && (
              <ul className="flex max-h-28 shrink-0 flex-wrap gap-1.5 overflow-y-auto px-3 pb-2" aria-label="Selected people">
                {picked.map((p) => (
                  <li key={p.id} className="flex items-center gap-1.5 rounded-full bg-surface-muted py-0.5 pl-0.5 pr-1 text-[13px]">
                    <span className="flex h-6 w-6 items-center justify-center overflow-hidden rounded-full bg-surface text-[10px] font-semibold text-muted-foreground">
                      <Face userId={p.id} name={p.full_name} />
                    </span>
                    {p.full_name}
                    <button
                      type="button"
                      onClick={() => toggle(p)}
                      aria-label={`Remove ${p.full_name}`}
                      className="grid h-5 w-5 place-items-center rounded-full text-muted-foreground hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <X className="h-3 w-3" aria-hidden />
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <div role="search" className="relative shrink-0 px-3 pb-1">
              <Search className="pointer-events-none absolute left-6 top-[16px] h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
              {/* caps-input: exempt -- a search box; the query is not a stored value */}
              <Input
                ref={searchRef}
                type="search"
                uppercase={false}
                value={q}
                onChange={(e) => {
                  setQ(e.target.value);
                  setHl(0);
                }}
                aria-label="Search name, department or code"
                className="h-8 rounded-full border-2 border-transparent bg-surface-muted pl-9 pr-3 text-[12.5px] focus-visible:border-primary focus-visible:bg-surface focus-visible:ring-0 [&::-webkit-search-cancel-button]:appearance-none"
              />
              {!q && (
                <span className="pointer-events-none absolute inset-y-0 left-[3rem] right-6 flex -translate-y-0.5 items-center truncate text-[12.5px] text-muted-foreground">
                  Search name, department or code
                </span>
              )}
            </div>

            <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto pb-20" role="listbox" aria-label="People" aria-multiselectable={step === "group"}>
              {shortcuts.map((s, i) => (
                <Row key={s.key} index={i} on={i === hlAt} onClick={s.run} onHover={() => setHl(i)}>
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground" aria-hidden>
                    <s.icon className="h-4 w-4" />
                  </span>
                  <span className="text-[13.5px] font-medium text-foreground">{s.label}</span>
                </Row>
              ))}

              {error ? (
                <div className="flex items-center justify-between gap-2 px-4 py-3 text-sm text-danger" role="alert">
                  <span>{error}</span>
                  <button type="button" className="font-semibold underline" onClick={() => setRetry((x) => x + 1)}>
                    Retry
                  </button>
                </div>
              ) : loading && people.length === 0 ? (
                <p className="flex items-center gap-2 px-4 py-3 text-sm text-muted-foreground" role="status">
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Reading people…
                </p>
              ) : people.length === 0 ? (
                <p className="px-4 py-8 text-center text-sm text-muted-foreground">
                  {term ? `No one matches “${term}”.` : "No colleagues to show."}
                </p>
              ) : (
                sections.map(([letter, ps]) => (
                  <section key={letter} aria-label={letter}>
                    <h3 className="sticky top-0 z-[1] bg-surface px-3.5 pb-0.5 pt-2 text-[11.5px] font-semibold tracking-wide text-primary">{letter}</h3>
                    {ps.map((p) => {
                      const i = n++;
                      const on = chosen.has(p.id);
                      return (
                        <Row
                          key={p.id}
                          index={i}
                          on={i === hlAt}
                          selected={step === "group" ? on : undefined}
                          onClick={() => (step === "group" ? toggle(p) : openWith(p))}
                          onHover={() => setHl(i)}
                        >
                          <WithPresence userId={p.id}>
                            <span className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-muted text-xs font-semibold text-muted-foreground">
                              <span className="flex h-full w-full items-center justify-center overflow-hidden rounded-full">
                                <Face userId={p.id} name={p.full_name} />
                              </span>
                              {on && (
                                <span className="absolute -bottom-0.5 -right-0.5 grid h-4 w-4 place-items-center rounded-full border-2 border-surface bg-primary text-primary-foreground">
                                  <Check className="h-2.5 w-2.5" strokeWidth={4} aria-hidden />
                                </span>
                              )}
                            </span>
                          </WithPresence>
                          <span className="min-w-0 flex-1">
                            <Truncated text={p.full_name} className="block text-[13.5px] font-medium leading-tight text-foreground" touch={false} />
                            <Truncated
                              text={[p.designation, p.department, p.employee_code].filter(Boolean).join(" · ") || "—"}
                              className="block text-xs leading-tight text-muted-foreground"
                              touch={false}
                            />
                          </span>
                          {opening === p.full_name && pending && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" aria-label="Opening chat" />}
                        </Row>
                      );
                    })}
                  </section>
                ))
              )}
            </div>

            {step === "group" && picked.length > 0 && (
              <Fab label="Next" onClick={() => setStep("name")}>
                <ArrowRight className="h-6 w-6" aria-hidden />
              </Fab>
            )}
          </>
        )}
      </div>
      <NewCommunitySheet
        open={community}
        onClose={() => {
          setCommunity(false);
          onClose();
        }}
      />
    </>
  );
}

function Row({
  index,
  on,
  selected,
  onClick,
  onHover,
  children,
}: {
  index: number;
  on: boolean;
  selected?: boolean;
  onClick: () => void;
  onHover: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected ?? on}
      data-row={index}
      tabIndex={-1}
      onClick={onClick}
      onMouseMove={onHover}
      className={cn(
        "flex min-h-[44px] w-full items-center gap-2.5 px-3 py-1 text-left focus-visible:outline-none",
        on ? "bg-surface-muted" : "hover:bg-surface-muted/60",
      )}
    >
      {children}
    </button>
  );
}

function Fab({ label, onClick, busy = false, children }: { label: string; onClick: () => void; busy?: boolean; children: ReactNode }) {
  return (
    // button-shape: exempt -- a round floating action button (WhatsApp's → / ✓), not an action-bar button
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      aria-label={label}
      title={label}
      className="absolute bottom-5 right-5 z-10 grid h-13 w-13 place-items-center rounded-full bg-primary text-primary-foreground shadow-lg transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-70"
    >
      {busy ? <Loader2 className="h-6 w-6 animate-spin" aria-hidden /> : children}
    </button>
  );
}

/** The directory under A–Z headings; a name that starts with no letter goes under #, first. */
function byLetter(people: DirectoryPerson[]): [string, DirectoryPerson[]][] {
  const out = new Map<string, DirectoryPerson[]>();
  const sorted = [...people].sort((a, b) => a.full_name.localeCompare(b.full_name, undefined, { sensitivity: "base" }));
  for (const p of sorted) {
    const c = p.full_name.trim().charAt(0).toUpperCase();
    const key = /[A-Z]/.test(c) ? c : "#";
    out.set(key, [...(out.get(key) ?? []), p]);
  }
  return [...out.entries()].sort(([a], [b]) => (a === "#" ? -1 : b === "#" ? 1 : a.localeCompare(b)));
}
