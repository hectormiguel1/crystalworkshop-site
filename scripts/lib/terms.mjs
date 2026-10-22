// Banned names matched by hash, so the names themselves never appear in this
// repository. Each entry is the SHA-256 of the name's canonical form: lower
// case, letters and digits only. Candidates are windows of one to three
// consecutive words of the scanned text (also split at camelCase and
// letter/digit boundaries), joined without separators and case-folded, so
// "Some Name", "some-name", "Some.Name" and "SomeName" all match.
import { createHash } from 'node:crypto';

export const HASHED_TERMS = [
  '0463055ea4061953aee0bca7bc0f4b70b31a74624a77ed06d976c4aa6f9da982',
  'f78f408094250ef09a03c211781a61c253d2803e0c294d7509681a3be80bf4e5',
  '4605a5be54f65758b1b2f51fde6b42d235d770f59e110c286bd4179a1979aa4b',
  '6381691e1fe55f4edee2288827a5e428fdceb4222581ed67eeb7135b03ad2011',
  '9df10d29d3071d6273f5c36497a791790568c89e1138b785c3e3175df6d004c6',
  '01bb2a73fc486891a0f066503f30876becf5c71df21e6473a2722d7732ce0cc3',
];

export const sha256 = (s) => createHash('sha256').update(s).digest('hex');

/** Canonical form of a candidate: lower case, letters and digits only. */
export const canonical = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

/** Words of `text` with their offsets: whole alphanumeric runs and their camelCase parts. */
function words(text) {
  const whole = [];
  const parts = [];
  for (const m of text.matchAll(/[\p{L}\p{N}]+/gu)) {
    whole.push({ w: m[0], at: m.index, end: m.index + m[0].length });
    for (const p of m[0].matchAll(/\p{Lu}+(?=\p{Lu}\p{Ll})|\p{Lu}?\p{Ll}+|\p{Lu}+|\p{N}+|[\p{L}]+/gu)) {
      parts.push({ w: p[0], at: m.index + p.index, end: m.index + p.index + p[0].length });
    }
  }
  return [whole, parts];
}

/**
 * Hits of hashed names in `text`: [{ index, text, term }] where `term` is the
 * index into `hashes` and `text` the matched source span.
 * `cache` (a Map) memoises candidate hashes across calls. With `stripTags`,
 * markup tags are blanked first (offsets kept), so "<b>Some</b> Name" matches.
 */
export function hashedHits(text, hashes = HASHED_TERMS, cache = new Map(), { maxWords = 3, stripTags = false } = {}) {
  const scan = stripTags ? text.replace(/<[^<>]*>/g, (m) => ' '.repeat(m.length)) : text;
  const want = new Map(hashes.map((h, i) => [h, i]));
  const hit = (cand) => {
    let h = cache.get(cand);
    if (h === undefined) {
      h = sha256(cand);
      cache.set(cand, h);
    }
    return want.get(h);
  };
  const out = [];
  const seen = new Set();
  for (const list of words(scan)) {
    for (let i = 0; i < list.length; i++) {
      let cand = '';
      for (let n = 0; n < maxWords && i + n < list.length; n++) {
        cand += list[i + n].w.toLowerCase();
        if (cand.length > 64) break;
        const term = hit(cand);
        if (term === undefined) continue;
        const key = `${list[i].at}:${term}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ index: list[i].at, text: text.slice(list[i].at, list[i + n].end), term });
      }
    }
  }
  return out.sort((a, b) => a.index - b.index);
}
