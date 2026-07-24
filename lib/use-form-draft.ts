"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Autosave-to-draft for a form (checklist "Auto Save (Draft)"): while `enabled`,
 * it debounce-persists `value` to localStorage under `storageKey`, but only once
 * the form is dirty (differs from the snapshot taken when it opened). On open, if
 * a stored draft exists that differs from the opening state, `hasDraft` is true
 * so the editor can offer to restore it. The controlled form state stays owned
 * by the screen; this hook only mirrors it to storage.
 *
 * Typical wiring in a master editor:
 *   const draft = useFormDraft({
 *     storageKey: `masters:bank:${editId ?? "new"}`,
 *     enabled: open,
 *     value: { form, branches },
 *     onRestore: (v) => { setForm(v.form); setBranches(v.branches); },
 *   });
 *   // banner when draft.hasDraft → draft.restore() / draft.discard()
 *   // on successful save AND on cancel/close → draft.clear()
 */
export function useFormDraft<T>({
  storageKey,
  enabled,
  value,
  onRestore,
  debounceMs = 800,
}: {
  storageKey: string;
  enabled: boolean;
  value: T;
  onRestore: (v: T) => void;
  debounceMs?: number;
}) {
  const [hasDraft, setHasDraft] = useState(false);
  // JSON of the state captured when the editor opened — the "not dirty" baseline.
  const baselineRef = useRef<string | null>(null);
  const onRestoreRef = useRef(onRestore);
  onRestoreRef.current = onRestore;

  // On open: snapshot the baseline and detect a pre-existing draft.
  useEffect(() => {
    if (!enabled) {
      baselineRef.current = null;
      setHasDraft(false);
      return;
    }
    baselineRef.current = JSON.stringify(value);
    try {
      const raw = window.localStorage.getItem(storageKey);
      setHasDraft(!!raw && raw !== baselineRef.current);
    } catch {
      setHasDraft(false);
    }
    // Only re-run when the editor opens or the record identity changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, storageKey]);

  // Debounced persist while dirty.
  useEffect(() => {
    if (!enabled || baselineRef.current == null) return;
    const snap = JSON.stringify(value);
    if (snap === baselineRef.current) return; // untouched — nothing to save
    const id = window.setTimeout(() => {
      try {
        window.localStorage.setItem(storageKey, snap);
      } catch {
        /* storage full / disabled — silently skip */
      }
    }, debounceMs);
    return () => window.clearTimeout(id);
  }, [value, enabled, storageKey, debounceMs]);

  const restore = useCallback(() => {
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (raw) onRestoreRef.current(JSON.parse(raw) as T);
    } catch {
      /* corrupt draft — ignore */
    }
    setHasDraft(false);
  }, [storageKey]);

  const clear = useCallback(() => {
    try {
      window.localStorage.removeItem(storageKey);
    } catch {
      /* ignore */
    }
    setHasDraft(false);
  }, [storageKey]);

  // discard is clear + hide the banner (semantic alias for the UI).
  return { hasDraft, restore, discard: clear, clear };
}
