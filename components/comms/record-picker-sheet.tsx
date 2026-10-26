"use client";

import { useEffect, useRef, useState } from "react";
import { ClipboardList, FileText, Loader2, Package } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Sheet } from "@/components/ui/sheet";
import { ToggleGroup } from "@/components/ui/segmented";
import { findRecords } from "@/lib/comms/actions";
import { RECORD_KINDS, RECORD_KIND_KEYS, type RecordKind, type RecordPreview } from "@/lib/comms/types";
import { fmtDate } from "@/lib/format";
import { cn } from "@/lib/utils";

const ICON: Record<RecordKind, typeof FileText> = {
  purchase_order: Package,
  purchase_indent: FileText,
  sales_order: ClipboardList,
};

/**
 * "Link a record" — find a PO, indent or RE by its number and drop a link to
 * it into the message (phase 6). The search runs as the SENDER (their module
 * permission and RLS), so they can only link what they could open; what each
 * READER sees is decided again for them when the chip renders.
 */
export function RecordPickerSheet({
  open,
  onClose,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (record: RecordPreview) => void;
}) {
  const [kind, setKind] = useState<RecordKind>("purchase_order");
  const [q, setQ] = useState("");
  const [results, setResults] = useState<RecordPreview[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const seq = useRef(0);

  useEffect(() => {
    if (!open) return;
    const mine = ++seq.current;
    const t = setTimeout(async () => {
      setLoading(true);
      const r = await findRecords(kind, q);
      if (mine !== seq.current) return; // a newer keystroke owns the list
      setLoading(false);
      if (r.ok) {
        setResults(r.records);
        setError(null);
      } else {
        setResults([]);
        setError(r.error);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [open, kind, q]);

  function close() {
    setQ("");
    setResults(null);
    setError(null);
    onClose();
  }

  return (
    // zIndexBase 120: this opens from the thread sheet's composer too, and an
    // inner sheet must stack above the outer one (sheet.tsx).
    <Sheet open={open} onClose={close} title="Link a record" size="sm" alignToPane zIndexBase={120}>
      <div className="flex h-[24rem] flex-col gap-3">
        <ToggleGroup
          label="Record type"
          value={kind}
          onChange={(k) => {
            setKind(k);
            setResults(null);
          }}
          options={RECORD_KIND_KEYS.map((k) => ({ value: k, label: RECORD_KINDS[k].short }))}
        />
        {/* caps-input: exempt -- a search box; the query is not a stored value */}
        <Input
          type="search"
          uppercase={false}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={`Search ${RECORD_KINDS[kind].label.toLowerCase()} by number`}
          aria-label={`Search ${RECORD_KINDS[kind].label.toLowerCase()} by number`}
          autoFocus
        />
        <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-border">
          {error ? (
            <p className="p-3 text-sm text-danger" role="alert">
              {error}
            </p>
          ) : results === null || (loading && results.length === 0) ? (
            <p className="flex items-center gap-2 p-3 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Searching…
            </p>
          ) : results.length === 0 ? (
            <p className="p-3 text-sm text-muted-foreground">
              {q ? `No ${RECORD_KINDS[kind].label.toLowerCase()} matches “${q}”.` : "Nothing to show yet."}
            </p>
          ) : (
            <ul aria-label="Records">
              {results.map((p) => {
                const Icon = ICON[p.kind];
                return (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => {
                        onPick(p);
                        setQ("");
                        setResults(null);
                      }}
                      className={cn(
                        "flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-surface-muted",
                        "focus-visible:bg-surface-muted focus-visible:outline-none",
                      )}
                    >
                      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                      <span className="min-w-0 flex-1">
                        <span className="block break-words text-sm font-medium text-foreground">{p.number}</span>
                        <span className="block break-words text-xs text-muted-foreground">
                          {[p.party, p.status?.replace(/_/g, " "), p.date ? fmtDate(p.date) : null]
                            .filter(Boolean)
                            .join(" · ") || "—"}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          Only the link is sent. Each person sees the record&apos;s details only if they can open it themselves.
        </p>
      </div>
    </Sheet>
  );
}
