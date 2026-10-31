/**
 * AN AMOUNT IN WORDS, THE INDIAN WAY (user 2026-10-31, PO FORMAT.pdf: "VALUE IN WORDS
 * RUPEES TWO LAKHS EIGHTY-SEVEN THOUSAND THREE HUNDRED TEN ONLY"). Crore · lakh ·
 * thousand · hundred — never million — because that is how the vendor reads the figure.
 * Plain function, no server or client tie, so any printed document can say a total twice.
 */
const ONES = [
  "", "ONE", "TWO", "THREE", "FOUR", "FIVE", "SIX", "SEVEN", "EIGHT", "NINE", "TEN",
  "ELEVEN", "TWELVE", "THIRTEEN", "FOURTEEN", "FIFTEEN", "SIXTEEN", "SEVENTEEN", "EIGHTEEN", "NINETEEN",
];
const TENS = ["", "", "TWENTY", "THIRTY", "FORTY", "FIFTY", "SIXTY", "SEVENTY", "EIGHTY", "NINETY"];

function belowHundred(n: number): string {
  if (n < 20) return ONES[n];
  return TENS[Math.floor(n / 10)] + (n % 10 ? `-${ONES[n % 10]}` : "");
}

function belowThousand(n: number): string {
  const h = Math.floor(n / 100);
  const r = n % 100;
  return [h ? `${ONES[h]} HUNDRED` : "", r ? belowHundred(r) : ""].filter(Boolean).join(" ");
}

/** A whole number in Indian words ("TWO LAKHS EIGHTY-SEVEN THOUSAND THREE HUNDRED TEN"). */
export function indianWords(whole: number): string {
  let n = Math.floor(Math.abs(whole));
  if (n === 0) return "ZERO";
  const parts: string[] = [];
  const crore = Math.floor(n / 1e7);
  n %= 1e7;
  const lakh = Math.floor(n / 1e5);
  n %= 1e5;
  const thousand = Math.floor(n / 1e3);
  n %= 1e3;
  // A crore count past 99 is itself said in Indian words ("ONE HUNDRED CRORES").
  if (crore) parts.push(`${indianWords(crore)} ${crore === 1 ? "CRORE" : "CRORES"}`);
  if (lakh) parts.push(`${belowHundred(lakh)} ${lakh === 1 ? "LAKH" : "LAKHS"}`);
  if (thousand) parts.push(`${belowHundred(thousand)} THOUSAND`);
  if (n) parts.push(belowThousand(n));
  return parts.join(" ");
}

/**
 * "RUPEES … AND FIFTY PAISE ONLY" for INR; for an import PO the currency code leads
 * ("USD … AND 25 CENTS ONLY" would guess the minor unit's name, so it says "/100").
 */
export function amountInWords(amount: number, currency = "INR"): string {
  const neg = amount < 0;
  const cents = Math.round(Math.abs(amount) * 100);
  const whole = Math.floor(cents / 100);
  const minor = cents % 100;
  const head = currency === "INR" ? "RUPEES" : currency;
  const tail = !minor ? "" : currency === "INR" ? ` AND ${belowHundred(minor)} PAISE` : ` AND ${minor}/100`;
  return `${neg ? "MINUS " : ""}${head} ${indianWords(whole)}${tail} ONLY`;
}
