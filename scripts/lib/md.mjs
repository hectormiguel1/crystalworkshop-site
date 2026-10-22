// Markdown helpers for the generator: turn the release READMEs and the
// CrystalWorkshop wiki (GitHub wiki flavour) into Starlight MDX pages.
import path from 'node:path';

/** URL path of a docs slug ('' is the home page). Always ends with '/'. */
export function urlOf(slug) {
  return slug ? `/${slug}/` : '/';
}

/** Relative link from page `from` to page `to` (slugs), base-path independent. */
export function rel(from, to, hash = '') {
  const a = urlOf(from).replace(/\/$/, '') || '/';
  const b = urlOf(to).replace(/\/$/, '') || '/';
  let r = path.posix.relative(a, b);
  r = r === '' ? './' : `${r}/`;
  return hash ? `${r}#${hash}` : r;
}

/** GitHub-style heading anchor. */
export function anchor(text) {
  return text
    .toLowerCase()
    .replace(/[`*_]/g, '')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/\s/g, '-');
}

/** Splits markdown into fenced-code and text segments. */
export function segments(md) {
  const out = [];
  const lines = md.split('\n');
  let buf = [];
  let fence = null;
  const flush = (code) => {
    if (buf.length) out.push({ code, text: buf.join('\n') });
    buf = [];
  };
  for (const line of lines) {
    const m = line.match(/^\s*(`{3,}|~{3,})/);
    if (!fence && m) {
      flush(false);
      fence = m[1];
      buf.push(line);
    } else if (fence && line.trim().startsWith(fence)) {
      buf.push(line);
      flush(true);
      fence = null;
    } else {
      buf.push(line);
    }
  }
  flush(fence !== null);
  return out;
}

/** Applies `fn` to text outside fenced code and inline code spans. */
export function mapText(md, fn) {
  return segments(md)
    .map((s) => {
      if (s.code) return s.text;
      return s.text
        .split(/(`+[^`]*`+)/g)
        .map((part, i) => (i % 2 === 1 ? part : fn(part)))
        .join('');
    })
    .join('\n');
}

/** Escapes MDX-significant characters in prose. */
export function escapeMdx(md) {
  return mapText(md, (t) =>
    t
      .replace(/<(https?:\/\/[^>\s]+)>/g, '$1')
      .replace(/\{/g, '&#123;')
      .replace(/\}/g, '&#125;')
      .replace(/</g, '&lt;')
      // A prose line starting with import/export would be read as ESM.
      .replace(/^(\s*)(import|export)\b/gm, (_, sp, w) => `${sp}&#${w.charCodeAt(0)};${w.slice(1)}`),
  );
}

/** First H1 and the rest. */
export function takeTitle(md) {
  const m = md.match(/^#\s+(.+)\n/m);
  if (!m) return { title: '', body: md };
  return { title: m[1].trim(), body: md.replace(m[0], '').replace(/^\s+/, '') };
}

/** Splits `## ` sections: [{ title, body }], preamble has title ''. */
export function h2Sections(md) {
  const out = [{ title: '', body: [] }];
  for (const line of segmentsAware(md)) {
    const m = line.code ? null : line.text.match(/^##\s+(.+)$/);
    if (m) out.push({ title: m[1].trim(), body: [] });
    else out[out.length - 1].body.push(line.text);
  }
  return out.map((s) => ({ title: s.title, body: s.body.join('\n').trim() }));
}

function* segmentsAware(md) {
  for (const s of segments(md)) for (const text of s.text.split('\n')) yield { code: s.code, text };
}

/** Plain-text summary of the first paragraph. */
export function firstParagraph(md) {
  const para = md
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .find((p) => p && !p.startsWith('#') && !p.startsWith('!') && !p.startsWith('>') && !p.startsWith('|') && !p.startsWith('-'));
  return plain(para || '');
}

export function plain(s) {
  return s
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\[\[([^\]|]+)(\|[^\]]+)?\]\]/g, '$1')
    .replace(/[*_`]/g, '')
    .replace(/^Goal:\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Inline markdown (code, bold, italics, links) to HTML for data cards. */
export function inlineHtml(s) {
  const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return s
    .split(/(`[^`]*`)/g)
    .map((part, i) => {
      if (i % 2 === 1) return `<code>${esc(part.slice(1, -1))}</code>`;
      return esc(part)
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
    })
    .join('');
}

/** Parses a markdown table starting at the first `|` line of `md`. */
export function parseTable(md) {
  const rows = md
    .split('\n')
    .filter((l) => l.trim().startsWith('|'))
    .map((l) =>
      l
        .trim()
        .replace(/^\||\|$/g, '')
        .split(/(?<!\\)\|/)
        .map((c) => c.trim()),
    );
  if (rows.length < 2) return { head: [], rows: [] };
  return { head: rows[0], rows: rows.slice(2) };
}

/** `> ...` blocks to Starlight asides. */
export function asides(md) {
  return segments(md)
    .map((s) => {
      if (s.code) return s.text;
      const lines = s.text.split('\n');
      const out = [];
      for (let i = 0; i < lines.length; i++) {
        if (!/^>\s?/.test(lines[i])) {
          out.push(lines[i]);
          continue;
        }
        const block = [];
        while (i < lines.length && /^>\s?/.test(lines[i])) block.push(lines[i++].replace(/^>\s?/, ''));
        i--;
        let text = block.join('\n').trim();
        let kind = 'note';
        let title = '';
        const m = text.match(/^\*\*([^*]+?)\.?\*\*:?\s*/);
        if (m && /\b(ALPHA|BETA)\b/.test(m[1])) {
          kind = 'caution';
          title = m[1].replace(/[.:]$/, '');
          text = text.slice(m[0].length);
        }
        out.push(`:::${kind}${title ? `[${title}]` : ''}`, text, ':::');
      }
      return out.join('\n');
    })
    .join('\n');
}

/** `**Term**` + `: definition` (wiki definition lists) to `### Term` + paragraphs. */
export function definitionLists(md, level = '###') {
  const lines = md.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const term = lines[i].match(/^\*\*([^*]+)\*\*(.*)$/);
    if (term && /^:\s/.test(lines[i + 1] || '')) {
      out.push(`${level} ${term[1]}${term[2]}`, '');
      i++;
      out.push(lines[i].replace(/^:\s+/, ''));
      while (i + 1 < lines.length && (lines[i + 1] === '' || /^ {2}/.test(lines[i + 1]))) {
        if (lines[i + 1] === '' && !/^ {2}/.test(lines[i + 2] || '')) break;
        out.push(lines[++i].replace(/^ {2}/, ''));
      }
      continue;
    }
    out.push(lines[i]);
  }
  return out.join('\n');
}

/** Wraps the ordered lists of `## Steps…` sections in `<Steps>`. */
export function stepLists(md, headings = /^Steps\b/i) {
  const lines = md.split('\n');
  const out = [];
  let inSteps = false;
  let fence = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*(```|~~~)/.test(line)) fence = !fence;
    if (!fence) {
      const h2 = line.match(/^##\s+(.+)$/);
      if (h2) inSteps = headings.test(h2[1]);
    }
    if (!fence && inSteps && /^1\.\s/.test(line)) {
      let end = i;
      let inner = false;
      for (let j = i; j < lines.length; j++) {
        const l = lines[j];
        if (/^\s*(```|~~~)/.test(l)) inner = !inner;
        if (inner || l === '' || /^\s+\S/.test(l) || /^\d+\.\s/.test(l)) {
          if (l !== '') end = j;
          continue;
        }
        break;
      }
      out.push('<Steps>', '', ...lines.slice(i, end + 1), '', '</Steps>');
      i = end;
      continue;
    }
    out.push(line);
  }
  return out.join('\n');
}

/** Consecutive `### Windows` / `### Linux` sections to synced OS tabs. */
export function osTabs(md) {
  const lines = md.split('\n');
  const win = lines.findIndex((l) => /^###\s+Windows\b/.test(l));
  if (win < 0) return md;
  const lin = lines.findIndex((l, i) => i > win && /^###\s+Linux\b/.test(l));
  if (lin < 0 || lines.slice(win + 1, lin).some((l) => /^#{1,3}\s/.test(l))) return md;
  let end = lines.findIndex((l, i) => i > lin && /^#{1,3}\s/.test(l));
  if (end < 0) end = lines.length;
  const label = (l) => l.replace(/^###\s+/, '').trim();
  return [
    ...lines.slice(0, win),
    '<Tabs syncKey="os">',
    `<TabItem label="${label(lines[win])}">`,
    '',
    ...lines.slice(win + 1, lin),
    '',
    '</TabItem>',
    `<TabItem label="${label(lines[lin])}">`,
    '',
    ...lines.slice(lin + 1, end),
    '',
    '</TabItem>',
    '</Tabs>',
    '',
    ...lines.slice(end),
  ].join('\n');
}

export function yamlString(s) {
  return JSON.stringify(s);
}
