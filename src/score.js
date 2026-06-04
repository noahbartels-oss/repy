// Scores how "valuable"/brandable a candidate name is, so the bot can check
// the best names first. Higher score = more desirable.

const VOWELS = new Set([..."aeiou"]);
// Letters that read as premium/techy in brand names (nexo, zaro, qvik...).
const PREMIUM = new Set([..."xzvjqk"]);

const isVowel = (c) => VOWELS.has(c);
const isLetter = (c) => /[a-z]/.test(c);
const isDigit = (c) => /[0-9]/.test(c);

/** Strict consonant/vowel alternation, e.g. CVCV or VCVC. */
function isAlternating(letters) {
  for (let i = 1; i < letters.length; i++) {
    if (isVowel(letters[i]) === isVowel(letters[i - 1])) return false;
  }
  return true;
}

/**
 * @param {string} name      candidate online ID
 * @param {Set<string>} words  dictionary set for real-word detection
 */
export function scoreName(name, words = new Set()) {
  const lower = name.toLowerCase();
  const chars = [...lower];
  const letters = chars.filter(isLetter);
  let s = 0;

  // Real dictionary word — highly memorable/valuable.
  if (words.has(lower)) s += 12;

  // Pronounceability: reward clean consonant/vowel alternation.
  if (letters.length >= 2 && isAlternating(letters)) s += 5;

  // Brand-typical shape: starts on a consonant, ends on a vowel.
  if (isLetter(chars[0]) && !isVowel(chars[0])) s += 1;
  if (isVowel(chars[chars.length - 1])) s += 3;

  // Premium-feeling letters.
  for (const c of chars) if (PREMIUM.has(c)) s += 2;

  // All-distinct characters look cleaner.
  if (new Set(chars).size === chars.length) s += 1;

  // Penalise repeated adjacent characters (aabb, lloo...).
  for (let i = 1; i < chars.length; i++) {
    if (chars[i] === chars[i - 1]) s -= 2;
  }

  // Digits hurt brandability; a single trailing digit is only mildly bad.
  const digits = chars.filter(isDigit).length;
  if (digits > 0) {
    const trailingOnly = digits === 1 && isDigit(chars[chars.length - 1]);
    s -= trailingOnly ? 1 : 3 * digits;
  }

  return s;
}
