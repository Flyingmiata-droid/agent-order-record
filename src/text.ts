// Small text helpers shared by renderers.

const ZERO_DECIMAL = new Set(['BIF', 'CLP', 'DJF', 'GNF', 'JPY', 'KMF', 'KRW', 'MGA', 'PYG', 'RWF', 'UGX', 'VND', 'VUV', 'XAF', 'XOF', 'XPF']);

// Minor units to a plain amount string. AEP money is integer minor units.
export function money(minor: unknown, currency: unknown): string {
  if (typeof minor !== 'number' || !Number.isInteger(minor)) return 'unknown amount';
  const cur = typeof currency === 'string' ? currency.toUpperCase() : '';
  if (ZERO_DECIMAL.has(cur)) return (minor + ' ' + cur).trim();
  const sign = minor < 0 ? '-' : '';
  const abs = Math.abs(minor);
  const cents = String(abs % 100).padStart(2, '0');
  return (sign + Math.floor(abs / 100) + '.' + cents + ' ' + cur).trim();
}

// Cuts text to a limit without breaking a word or a hash. The cut lands on
// the last whitespace before the limit and a marker is added.
export function truncate(text: string, limit: number): { text: string; truncated: boolean } {
  if (text.length <= limit) return { text, truncated: false };
  const marker = ' [truncated]';
  const room = limit - marker.length;
  if (room <= 0) return { text: text.slice(0, limit), truncated: true };
  const head = text.slice(0, room + 1);
  const cut = Math.max(head.lastIndexOf(' '), head.lastIndexOf('\n'));
  // No whitespace to cut on (one long token): cut hard rather than return nothing.
  const kept = cut > 0 ? head.slice(0, cut) : text.slice(0, room);
  return { text: kept.replace(/\s+$/, '') + marker, truncated: true };
}

function luhn(digits: string): boolean {
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (alt) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
    alt = !alt;
  }
  return sum % 10 === 0;
}

// Major card brand prefixes: Visa 4, Mastercard 51 to 55 and 2221 to 2720,
// Amex 34 and 37, Discover 6011 and 65.
function cardPrefix(d: string): boolean {
  const two = Number(d.slice(0, 2));
  const four = Number(d.slice(0, 4));
  return d[0] === '4' || (two >= 51 && two <= 55) || (four >= 2221 && four <= 2720) || two === 34 || two === 37 || four === 6011 || two === 65;
}

// True when a digit string alone has the shape of a card number: 13 to 19
// digits, a major brand prefix, passing Luhn. Used for fields that are long
// digit strings by nature, such as a tracking number.
export function panShaped(digits: string): boolean {
  return digits.length >= 13 && digits.length <= 19 && cardPrefix(digits) && luhn(digits);
}

// True when the text holds something that looks like a full card number.
// Errs toward yes: a false refusal is safe, a leaked card number is not.
// 1. Any unbroken run of 13 to 19 digits that passes Luhn, even glued to letters.
// 2. Inside a longer unbroken run, any 15 or 16 digit window with a card brand
//    prefix that passes Luhn (a card number next to other digits).
// 3. Digit groups split by spaces, tabs, line breaks, dots, slashes or hyphens
//    (up to three between groups) that add up to 13 to 19 digits and pass Luhn,
//    where every group but the last has four digits or more. That keeps dates
//    and IP addresses out.
export function looksLikePan(text: string): boolean {
  for (const m of text.matchAll(/\d{13,}/g)) {
    const d = m[0];
    if (d.length <= 19) { if (luhn(d)) return true; continue; }
    for (const n of [15, 16]) for (let i = 0; i + n <= d.length; i++) {
      const w = d.slice(i, i + n);
      if (cardPrefix(w) && luhn(w)) return true;
    }
  }
  const sep = /[ \t\r\n\u00a0.\/-]+/;
  for (const m of text.matchAll(/\d+(?:[ \t\r\n\u00a0.\/-]{1,3}\d+)+/g)) {
    const groups = m[0].split(sep);
    for (let i = 0; i < groups.length; i++) {
      let digits = '';
      for (let j = i; j < groups.length; j++) {
        if (j > i && groups[j - 1].length < 4) break;
        digits += groups[j];
        if (digits.length > 19) break;
        if (j > i && digits.length >= 13 && luhn(digits)) return true;
      }
    }
  }
  return false;
}

export function hashPrefix(tagged: string): string {
  const hex = tagged.startsWith('sha256:') ? tagged.slice(7) : tagged;
  return hex.slice(0, 16) + '...';
}
