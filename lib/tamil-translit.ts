/**
 * TANGLISH → TAMIL SCRIPT (user 2026-11-05: "if I select Tamil the letters can
 * be English or Tamil, the wording should show the Tamil letters"). Phonetic,
 * the way the familiar Tamil phone keyboards read Latin letters:
 *
 *   amma → அம்ம · ammaa → அம்மா · thalaivali → தலைவலி · vaNakkam → வணக்கம்
 *   · nandri → நன்றி · kuzhanthai → குழந்தை · naaLai → நாளை
 *   (n before a vowel at a word's start is ந, elsewhere ன; "ndr" is ன்ற)
 *
 * A short vowel is written short: "amma" is அம்ம and "ammaa" is அம்மா, as on
 * the phonetic phone keyboards — guessing would make "enna" (என்ன) wrong.
 *
 * Case picks between letters that share a sound: N ண · L ள · R ற · S ஸ, and
 * the long vowels A I U E O (also aa ii/ee uu/oo ae oa). zh ழ, ng ங, nj/gn ஞ,
 * ch/s ச, sh ஷ, j ஜ, h ஹ, t/d ட, th/dh த, f ஃப.
 *
 * Runs entirely in the browser — no service, nothing sent anywhere. Only Latin
 * letters are touched; Tamil, digits and punctuation pass straight through.
 */

const VOWELS: [string, string, string][] = [
  // latin, independent, sign (after a consonant; "" = the inherent a)
  ["aa", "ஆ", "ா"], ["A", "ஆ", "ா"],
  ["ai", "ஐ", "ை"], ["au", "ஔ", "ௌ"], ["ow", "ஔ", "ௌ"],
  ["ii", "ஈ", "ீ"], ["ee", "ஈ", "ீ"], ["I", "ஈ", "ீ"],
  ["uu", "ஊ", "ூ"], ["oo", "ஊ", "ூ"], ["U", "ஊ", "ூ"],
  ["ae", "ஏ", "ே"], ["E", "ஏ", "ே"],
  ["oa", "ஓ", "ோ"], ["O", "ஓ", "ோ"],
  ["a", "அ", ""], ["i", "இ", "ி"], ["u", "உ", "ு"], ["e", "எ", "ெ"], ["o", "ஒ", "ொ"],
];

const CONSONANTS: [string, string][] = [
  ["ksh", "க்ஷ"],
  ["zh", "ழ"], ["ng", "ங"], ["nj", "ஞ"], ["gn", "ஞ"], ["ch", "ச"], ["sh", "ஷ"],
  ["th", "த"], ["dh", "த"], ["kh", "க"], ["gh", "க"], ["ph", "ஃப"], ["bh", "ப"], ["rr", "ற"],
  ["k", "க"], ["g", "க"], ["c", "க"], ["q", "க"], ["x", "க்ஸ"],
  ["s", "ச"], ["S", "ஸ"], ["j", "ஜ"], ["J", "ஜ"], ["h", "ஹ"], ["H", "ஹ"],
  ["t", "ட"], ["T", "ட"], ["d", "ட"], ["D", "ட"],
  ["N", "ண"], ["n", "ன"], // n at a word's start before a vowel → ந (below)
  ["p", "ப"], ["P", "ப"], ["b", "ப"], ["B", "ப"], ["f", "ஃப"], ["F", "ஃப"],
  ["m", "ம"], ["M", "ம"], ["y", "ய"], ["Y", "ய"],
  ["r", "ர"], ["R", "ற"], ["l", "ல"], ["L", "ள"],
  ["v", "வ"], ["V", "வ"], ["w", "வ"], ["W", "வ"], ["z", "ழ"], ["Z", "ழ"],
  ["G", "க"], ["K", "க"], ["C", "க"], ["Q", "க"], ["X", "க்ஸ"],
];

const PULLI = "்";

function match<T extends [string, ...string[]]>(table: T[], word: string, at: number): T | null {
  let best: T | null = null;
  for (const row of table) {
    if (word.startsWith(row[0], at) && (!best || row[0].length > best[0].length)) best = row;
  }
  return best;
}

/** One run of Latin letters → Tamil script. */
export function tamilWord(word: string): string {
  // "ndr" is said ன்ற (nandri நன்றி, endru என்று).
  word = word.replace(/ndr/g, "nR");
  let out = "";
  let i = 0;
  while (i < word.length) {
    const c = match(CONSONANTS, word, i);
    if (c) {
      i += c[0].length;
      let base = c[1];
      const v = match(VOWELS, word, i);
      // ந at the start of a word (nandri, naan); ன everywhere else (avan).
      if (c[0] === "n" && out === "" && v) base = "ந";
      // "nth" / "ndh" inside a word is ந் (vandhaan, panthu).
      if (c[0] === "n" && out !== "" && /^(th|dh)/.test(word.slice(i))) base = "ந";
      if (v) {
        out += base + v[2];
        i += v[0].length;
      } else {
        out += base + PULLI;
      }
      continue;
    }
    const v = match(VOWELS, word, i);
    if (v) {
      out += v[1];
      i += v[0].length;
      continue;
    }
    out += word[i];
    i++;
  }
  return out;
}

/** Every run of Latin letters in a text → Tamil script; everything else as is. */
export function toTamil(text: string): string {
  return text.replace(/[A-Za-z]+/g, (w) => tamilWord(w));
}
