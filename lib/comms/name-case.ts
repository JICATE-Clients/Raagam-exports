/**
 * "SRIPRIYA JICATE" → "Sripriya Jicate" for a PERSON'S name on screen. Names are
 * stored in capitals (CAPITALS rule), and a column of capitals reads as shouting
 * and runs wider; this is display only — nothing stored or searched changes.
 */
export function nameCase(name: string): string {
  return name
    .toLowerCase()
    .replace(/(^|[\s.'-])(\p{L})/gu, (_m, sep: string, ch: string) => sep + ch.toUpperCase());
}
