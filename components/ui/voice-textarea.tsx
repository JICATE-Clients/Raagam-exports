"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type ComponentProps } from "react";
import { Mic, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup } from "@/components/ui/segmented";
import { cn } from "@/lib/utils";
import { tamilWord, toTamil } from "@/lib/tamil-translit";

/**
 * A REASON BOX YOU CAN SPEAK INTO, IN TAMIL OR ENGLISH (user 2026-11-05: "in
 * all request reasons I want Tamil and English typing, and also voice — if
 * they click the mic and talk it should print as letters in the reason box").
 *
 * Typing: the box takes whatever the keyboard sends, so Tamil typing is the
 * device's Tamil keyboard (Gboard on a phone, the Windows Tamil keyboard on a
 * PC). Tamil has no capitals, so the CAPITALS rule leaves it exactly as typed.
 *
 * Voice: the browser's own speech recognition (Chrome, Edge, Android; Safari
 * where it ships it) in `ta-IN` or `en-IN`, chosen with the தமிழ் / EN switch
 * beside the mic. Each finished phrase is ADDED after what is already in the
 * box — never replacing it — so a reason can be part typed, part spoken, and
 * in both languages. The words still being heard show greyed under the box
 * until the phrase ends. English that is spoken is capitalised like English
 * that is typed, so the stored value obeys the same rule either way.
 *
 * Needs internet (the browser sends the audio to its own speech service) and
 * a one-time microphone permission. Where the browser has no recognition
 * (Firefox), the mic does not render — the box is a plain reason box there.
 *
 * TAMIL LETTERS FROM AN ENGLISH KEYBOARD (same day: "if I select Tamil the
 * letters can be English or Tamil, the wording should show the Tamil
 * letters"). With தமிழ் on, a word typed in English letters turns into Tamil
 * script the moment it ends (space, Enter, punctuation, or leaving the box) —
 * "thalaivali " becomes "தலைவலி ". The word being typed shows its Tamil under
 * the box first, so the operator sees it before it lands. Voice in Tamil does
 * the same to any English words the recogniser hears ("fever"). The rules are
 * `lib/tamil-translit.ts`, in the browser — nothing is sent anywhere. English
 * keeps the CAPITALS rule; Tamil mode turns it off for this box, because case
 * picks the letter there (n ந/ன, N ண; l ல, L ள).
 *
 * The mic and the switch are buttons, so Tab still lands only on fields
 * (AGENTS.md "Tab lands on fields"); they are mouse / touch controls.
 */

type Lang = "ta-IN" | "en-IN";
const LANG_KEY = "raagam.voice-lang";

// The Web Speech API is not in TypeScript's DOM library yet — the slice we use.
type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};
type RecognitionCtor = new () => Recognition;
function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const noSubscribe = () => () => {};
function savedLang(): Lang {
  try {
    const saved = localStorage.getItem(LANG_KEY);
    if (saved === "ta-IN" || saved === "en-IN") return saved;
  } catch {
    // private window / blocked storage — Tamil stays the default
  }
  return "ta-IN";
}

const MIC_ERRORS: Record<string, string> = {
  "not-allowed": "Microphone is blocked — allow it from the lock icon in the address bar.",
  "service-not-allowed": "Microphone is blocked — allow it from the lock icon in the address bar.",
  "no-speech": "Didn't hear anything — tap the mic and speak again.",
  "audio-capture": "No microphone found on this device.",
  network: "Voice typing needs internet.",
};

export function VoiceTextarea({
  value,
  onValueChange,
  className,
  ...props
}: Omit<ComponentProps<typeof Textarea>, "value" | "onChange"> & {
  value: string;
  onValueChange: (next: string) => void;
}) {
  // Known only in the browser: the server (and hydration) say no mic, then the
  // browser's answer takes over — so the two renders never disagree.
  const supported = useSyncExternalStore(noSubscribe, () => !!recognitionCtor(), () => false);
  // Read lazily; the switch is not drawn until `supported`, so it never hydrates.
  const [lang, setLang] = useState<Lang>(() => (typeof window === "undefined" ? "ta-IN" : savedLang()));
  const [listening, setListening] = useState(false);
  const [heard, setHeard] = useState("");
  const [problem, setProblem] = useState("");
  const rec = useRef<Recognition | null>(null);
  // The latest box value, for a phrase that finishes after more was typed.
  const latest = useRef(value);
  useEffect(() => {
    latest.current = value;
  }, [value]);

  // Leaving the screen mid-sentence turns the microphone off.
  useEffect(() => () => rec.current?.abort(), []);

  function pickLang(next: Lang) {
    setLang(next);
    try {
      localStorage.setItem(LANG_KEY, next);
    } catch {
      // per-viewer convenience only
    }
    // Switching mid-sentence restarts the mic in the new language.
    if (listening) {
      rec.current?.abort();
      start(next);
    }
  }

  function add(text: string, l: Lang) {
    const said = text.trim();
    if (!said) return;
    // Lower-cased first: a recogniser's "Fever" must not read F/E as the long-vowel keys.
    const words = l === "en-IN" ? said.toUpperCase() : toTamil(said.toLowerCase());
    const before = latest.current;
    const next = before && !/\s$/.test(before) ? `${before} ${words}` : `${before}${words}`;
    latest.current = next;
    onValueChange(next);
  }

  function start(l: Lang = lang) {
    const Ctor = recognitionCtor();
    if (!Ctor) return;
    const r = new Ctor();
    r.lang = l;
    r.continuous = true;
    r.interimResults = true;
    r.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) add(res[0].transcript, l);
        else interim += res[0].transcript;
      }
      setHeard(interim);
    };
    r.onerror = (e) => {
      if (e.error !== "aborted") setProblem(MIC_ERRORS[e.error] ?? "Voice typing stopped — tap the mic to try again.");
    };
    r.onend = () => {
      if (rec.current === r) {
        rec.current = null;
        setListening(false);
        setHeard("");
      }
    };
    rec.current = r;
    setProblem("");
    setHeard("");
    setListening(true);
    try {
      r.start();
    } catch {
      setListening(false);
      setProblem("Voice typing could not start — tap the mic again.");
    }
  }

  function stop() {
    rec.current?.stop();
  }

  const tamil = lang === "ta-IN";
  // The English-letter word just before the caret, still being typed.
  const [typing, setTyping] = useState("");

  /** Convert the Latin word that ends at `end` in `text`, if there is one. */
  function convertBefore(text: string, end: number): { text: string; caret: number } | null {
    const m = /[A-Za-z]+$/.exec(text.slice(0, end));
    if (!m) return null;
    const ta = tamilWord(m[0]);
    return { text: text.slice(0, m.index) + ta + text.slice(end), caret: m.index + ta.length };
  }

  function onType(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const el = e.target;
    const text = el.value;
    if (!tamil) {
      setTyping("");
      onValueChange(text);
      return;
    }
    const caret = el.selectionStart ?? text.length;
    const last = text[caret - 1] ?? "";
    // A word just ended — turn the English letters before it into Tamil.
    if (/[\s.,!?;:)\]-]/.test(last)) {
      const done = convertBefore(text, caret - 1);
      if (done) {
        setTyping("");
        onValueChange(done.text);
        // Put the caret back after the space / mark the operator just typed.
        requestAnimationFrame(() => {
          try {
            el.setSelectionRange(done.caret + 1, done.caret + 1);
          } catch {
            // the box was closed in between
          }
        });
        return;
      }
    }
    setTyping(/[A-Za-z]+$/.exec(text.slice(0, caret))?.[0] ?? "");
    onValueChange(text);
  }

  function onLeave(e: React.FocusEvent<HTMLTextAreaElement>) {
    if (!tamil || !typing) return;
    const el = e.target;
    const done = convertBefore(el.value, el.selectionStart ?? el.value.length);
    setTyping("");
    if (done) onValueChange(done.text);
  }

  return (
    <div className="space-y-1.5">
      <Textarea
        {...props}
        className={className}
        // caps-input: exempt -- in Tamil mode case picks the Tamil letter (n ந/ன, N ண), and the English letters are converted to Tamil script; English mode keeps capitals
        uppercase={tamil ? false : props.uppercase}
        lang={tamil ? "ta" : undefined}
        value={value}
        onChange={onType}
        onBlur={(e) => {
          onLeave(e);
          props.onBlur?.(e);
        }}
      />
      {tamil && typing && (
        <p className="text-sm text-muted-foreground">
          <span className="font-mono text-xs">{typing}</span> → <span className="font-medium text-foreground">{tamilWord(typing)}</span>
          <span className="ml-2 text-xs">space to place it</span>
        </p>
      )}
      {heard && <p className="text-sm italic text-muted-foreground">{heard}…</p>}
      {supported && (
        <div className="flex flex-wrap items-center gap-2">
          <ToggleGroup<Lang>
            label="Voice language"
            value={lang}
            onChange={pickLang}
            options={[
              { value: "ta-IN", label: "தமிழ்" },
              { value: "en-IN", label: "English" },
            ]}
          />
          <Button
            type="button"
            size="sm"
            variant={listening ? "primary" : "outline"}
            aria-pressed={listening}
            aria-label={listening ? "Stop voice typing" : "Speak the reason"}
            onClick={() => (listening ? stop() : start())}
            className={cn(listening && "bg-rose-600 hover:bg-rose-700")}
          >
            {listening ? <Square className="size-3.5 fill-current" /> : <Mic className="size-4" />}
            {listening ? "Stop" : "Speak"}
          </Button>
          {listening && (
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-rose-600 dark:text-rose-400">
              <span className="size-2 rounded-full bg-rose-500 motion-safe:animate-pulse" />
              Listening in {lang === "ta-IN" ? "Tamil" : "English"}…
            </span>
          )}
          {problem && !listening && <span className="text-xs text-rose-600 dark:text-rose-400">{problem}</span>}
        </div>
      )}
    </div>
  );
}
