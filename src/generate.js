// Candidate generation for the PSN name checker.
//
// Supports four modes:
//   - pattern:   expand templates like "CVCV" into pronounceable names
//   - brandable: a curated set of pronounceable patterns
//   - words:     real dictionary words of the requested length
//   - brute:     every combination of a character set (lazy, can be huge)
//
// Curated modes (pattern/brandable/words) are materialised and sorted by
// brand score so the most valuable names get checked first. Brute force
// stays a lazy generator and is checked in alphabetical order.

import { readFileSync } from "node:fs";
import { scoreName } from "./score.js";

export const PRESETS = {
  letters: "abcdefghijklmnopqrstuvwxyz",
  digits: "0123456789",
  symbols: "-_",
};

// Character classes for pattern templates.
const CLASSES = {
  C: "bcdfghjklmnpqrstvwxz", // consonants (no vowels, no y)
  V: "aeiou", // vowels
  L: PRESETS.letters, // any letter
  D: PRESETS.digits, // any digit
  A: PRESETS.letters + PRESETS.digits, // alphanumeric
};

// Curated pronounceable templates used by --brandable (length is enforced
// to match --length; templates longer/shorter than that are skipped).
const BRANDABLE_PATTERNS = ["CVCV", "CVVC", "VCVC", "CVCVC", "CVCCV", "CCVCV"];

let cachedWords = null;

/** Loads the bundled dictionary once, as a Set of lowercase words. */
export function loadWords() {
  if (cachedWords) return cachedWords;
  try {
    const text = readFileSync(new URL("../data/words.txt", import.meta.url), "utf8");
    cachedWords = new Set(text.split(/\r?\n/).filter(Boolean));
  } catch {
    cachedWords = new Set();
  }
  return cachedWords;
}

/**
 * Whether a candidate is a structurally valid PSN online ID.
 * PSN rules: 3-16 chars; only letters, digits, hyphen, underscore;
 * must start and end with a letter or digit (no leading/trailing symbol).
 */
export function isValidOnlineId(name) {
  if (name.length < 3 || name.length > 16) return false;
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) return false;
  if (!/^[a-zA-Z0-9]/.test(name)) return false;
  if (!/[a-zA-Z0-9]$/.test(name)) return false;
  return true;
}

/** Expands one pattern template (e.g. "CVCV") into every matching name. */
function expandPattern(pattern) {
  const slots = [...pattern.toUpperCase()].map((ch) => {
    const set = CLASSES[ch];
    if (!set) throw new Error(`Unknown pattern symbol "${ch}". Use C, V, L, D or A.`);
    return [...set];
  });
  let results = [""];
  for (const slot of slots) {
    const next = [];
    for (const prefix of results) {
      for (const c of slot) next.push(prefix + c);
    }
    results = next;
  }
  return results;
}

/** Lazily yields every combination of `charset` of the given `length`. */
function* bruteForce(charset, length) {
  const chars = [...new Set([...charset])];
  const n = chars.length;
  const total = n ** length;
  for (let i = 0; i < total; i++) {
    let rem = i;
    let name = "";
    for (let pos = 0; pos < length; pos++) {
      name = chars[rem % n] + name;
      rem = Math.floor(rem / n);
    }
    if (isValidOnlineId(name)) yield name;
  }
}

// Materialise a candidate list, drop invalid/duplicate entries, and sort by
// brand score (descending) with an alphabetical tiebreaker for determinism.
function finalizeSorted(names) {
  const words = loadWords();
  const seen = new Set();
  const unique = [];
  for (const name of names) {
    if (!isValidOnlineId(name) || seen.has(name)) continue;
    seen.add(name);
    unique.push(name);
  }
  unique.sort((a, b) => {
    const diff = scoreName(b, words) - scoreName(a, words);
    return diff !== 0 ? diff : a < b ? -1 : 1;
  });
  return unique;
}

/**
 * Builds the candidate stream for a run.
 * @returns {{ candidates: Iterable<string>, total: number|null, signature: string, mode: string }}
 */
export function buildCandidates(opts) {
  const { mode, length, charset, patterns, top } = opts;

  if (mode === "brute") {
    return {
      candidates: bruteForce(charset, length),
      total: null, // unknown up front; it's a lazy stream
      signature: `brute:${length}:${[...new Set([...charset])].sort().join("")}`,
      mode,
    };
  }

  let names;
  let sigKey;
  if (mode === "words") {
    names = [...loadWords()].filter((w) => w.length === length);
    sigKey = `words:${length}`;
  } else if (mode === "brandable") {
    const usable = BRANDABLE_PATTERNS.filter((p) => p.length === length);
    names = usable.flatMap(expandPattern);
    sigKey = `brandable:${length}:${usable.join(",")}`;
  } else if (mode === "pattern") {
    names = patterns.flatMap(expandPattern);
    sigKey = `pattern:${patterns.map((p) => p.toUpperCase()).join(",")}`;
  } else {
    throw new Error(`Unknown mode: ${mode}`);
  }

  let sorted = finalizeSorted(names);
  if (Number.isFinite(top)) {
    sorted = sorted.slice(0, top);
    sigKey += `:top${top}`;
  }
  return { candidates: sorted, total: sorted.length, signature: sigKey, mode };
}
