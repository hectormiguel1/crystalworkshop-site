// Readers for the Nexus page BBCode (NEXUS.bbcode) the release ships.

/** Drops the sentences of `text` that hold a BBCode link (pointers to this site). */
export function withoutLinkSentences(text) {
  return text
    .split(/(?<=\.)\s+/)
    .filter((s) => !/\[url[=\]]/i.test(s))
    .join(' ')
    .trim();
}

/**
 * `[*][b]Head[/b]: rest` items of a bbcode section, as Markdown. Links
 * (pointers to this site's guides) are dropped with their text.
 */
export function bbList(bb, heading) {
  const m = bb.match(new RegExp(`\\[b\\]${heading}\\[\\/b\\]\\[\\/size\\]\\n\\[list\\]([\\s\\S]*?)\\[\\/list\\]`));
  if (!m) return [];
  return [...m[1].matchAll(/\[\*\]([^\n]+)/g)].map((x) =>
    x[1]
      .replace(/\s*\[url=[^\]]*\][^[]*\[\/url\]/g, '')
      .replace(/\[b\]([^[]+)\[\/b\]/g, '**$1**')
      .replace(/\[i\]([^[]+)\[\/i\]/g, '`$1`')
      .replace(/\[[^\]]+\]/g, '')
      .trim(),
  );
}

/** `[b]Changelog[/b]` section of a Nexus page: [{ version, text }]. */
export function bbChangelog(bb) {
  const m = bb.match(/\[b\]Changelog\[\/b\]\[\/size\]\n([\s\S]*?)(?:\n\n\[size|$)/);
  if (!m) return [];
  return [...m[1].matchAll(/\[b\]([^[]+)\[\/b\]:\s*([^\n]+)/g)].map((x) => ({ version: x[1].trim(), text: withoutLinkSentences(x[2].trim()) }));
}
