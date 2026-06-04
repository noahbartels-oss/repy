// Deterministic generation of candidate PSN online IDs.

export const PRESETS = {
  letters: "abcdefghijklmnopqrstuvwxyz",
  digits: "0123456789",
  symbols: "-_",
};

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

/**
 * Lazily yields every combination of `charset` of the given `length`,
 * in a stable order, skipping ones that aren't valid online IDs.
 * Generation is deterministic, which is what lets us resume by index.
 */
export function* generate(charset, length) {
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

/** A stable signature for a generation config, used to validate resume state. */
export function configSignature(charset, length) {
  const normalized = [...new Set([...charset])].sort().join("");
  return `${length}:${normalized}`;
}
