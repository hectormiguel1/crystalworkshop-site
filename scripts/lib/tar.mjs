// Minimal reader for one file inside a .tar.gz (ustar + GNU long names).
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

/** Returns the contents of the first entry whose path ends with `suffix`, or null. */
export function readFromTarGz(archive, suffix) {
  const tar = gunzipSync(readFileSync(archive));
  let offset = 0;
  let longName = null;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((b) => b === 0)) break;
    const field = (start, len) => header.subarray(start, start + len).toString('utf8').replace(/\0.*$/s, '');
    const size = parseInt(field(124, 12).trim() || '0', 8);
    const type = String.fromCharCode(header[156] || 48);
    const prefix = field(345, 155);
    let name = longName ?? (prefix ? `${prefix}/${field(0, 100)}` : field(0, 100));
    const body = tar.subarray(offset + 512, offset + 512 + size);
    longName = null;
    if (type === 'L') {
      longName = body.toString('utf8').replace(/\0.*$/s, '');
    } else if ((type === '0' || type === '\0') && name.endsWith(suffix)) {
      return Buffer.from(body);
    }
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return null;
}
