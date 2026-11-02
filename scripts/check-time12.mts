/**
 * Vectors for lib/time12.ts — the 12-hour time box (client 2026-11-02: the
 * time fields showed 24-hour on the client's machine and 12-hour on ours).
 * Run: npx tsx scripts/check-time12.mts
 */
import { flipMeridiem, fmt12, parseTime12 } from "../lib/time12";

let fail = 0;
const eq = (label: string, got: unknown, want: unknown) => {
  const ok = got === want;
  if (!ok) fail++;
  console.log(`${ok ? "ok  " : "FAIL"} ${label} → ${JSON.stringify(got)}${ok ? "" : ` (want ${JSON.stringify(want)})`}`);
};

// Shown
eq("fmt12 09:30", fmt12("09:30"), "09:30 AM");
eq("fmt12 21:05:00", fmt12("21:05:00"), "09:05 PM");
eq("fmt12 00:15", fmt12("00:15"), "12:15 AM");
eq("fmt12 12:00", fmt12("12:00"), "12:00 PM");
eq("fmt12 blank", fmt12(""), "");
eq("fmt12 null", fmt12(null), "");

// Typed, with AM/PM
eq("9:30pm", parseTime12("9:30pm"), "21:30");
eq("9:30 PM", parseTime12("9:30 PM"), "21:30");
eq("9 p", parseTime12("9 p"), "21:00");
eq("12am", parseTime12("12am"), "00:00");
eq("12 pm", parseTime12("12 pm"), "12:00");
eq("9.30 a.m.", parseTime12("9.30 a.m."), "09:30");
eq("09:00 AM (its own display)", parseTime12("09:00 AM"), "09:00");
eq("06:30 PM (its own display)", parseTime12("06:30 PM"), "18:30");
eq("13pm refused", parseTime12("13pm"), null);

// Typed, 24-hour — only one meaning
eq("21:30", parseTime12("21:30"), "21:30");
eq("2130", parseTime12("2130"), "21:30");
eq("0:45", parseTime12("0:45"), "00:45");

// Typed, bare 1–12: keeps the field's side of noon
eq("1 beside 14:00", parseTime12("1", "14:00"), "13:00");
eq("9 beside 08:00", parseTime12("9", "08:00"), "09:00");
eq("930 beside 18:00", parseTime12("930", "18:00"), "21:30");
// …and on an empty field, the working-day guess
eq("9 empty", parseTime12("9"), "09:00");
eq("11:15 empty", parseTime12("11:15"), "11:15");
eq("12 empty", parseTime12("12"), "12:00");
eq("2 empty", parseTime12("2"), "14:00");
eq("0930 empty", parseTime12("0930"), "09:30");

// Not (yet) a time
eq("blank", parseTime12(""), null);
eq("9:75", parseTime12("9:75"), null);
eq("24:00", parseTime12("24:00"), null);
eq("abc", parseTime12("abc"), null);
eq("12345", parseTime12("12345"), null);

// AM/PM switch
eq("flip 09:30", flipMeridiem("09:30"), "21:30");
eq("flip 21:30", flipMeridiem("21:30"), "09:30");
eq("flip 00:10", flipMeridiem("00:10"), "12:10");

console.log(`\n${fail} FAIL`);
process.exit(fail ? 1 : 0);
