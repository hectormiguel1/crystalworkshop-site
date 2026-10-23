// Minimal ZIP reader (stored or deflated entries, no ZIP64).
import { readFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';

/** Every file entry of the ZIP bytes `zip`: [{ name, size, read() }] (directories left out). */
export function zipEntries(zip) {
  let eocd = -1;
  for (let o = zip.length - 22; o >= 0 && eocd < 0; o--) if (zip.readUInt32LE(o) === 0x06054b50) eocd = o;
  if (eocd < 0) throw new Error('not a ZIP archive: no end record');
  const out = [];
  let o = zip.readUInt32LE(eocd + 16);
  for (let i = zip.readUInt16LE(eocd + 10); i > 0; i--) {
    if (zip.readUInt32LE(o) !== 0x02014b50) throw new Error(`damaged ZIP directory at ${o}`);
    const [method, packed, size, nameLen] = [zip.readUInt16LE(o + 10), zip.readUInt32LE(o + 20), zip.readUInt32LE(o + 24), zip.readUInt16LE(o + 28)];
    const name = zip.subarray(o + 46, o + 46 + nameLen).toString('utf8');
    const local = zip.readUInt32LE(o + 42);
    if (!name.endsWith('/')) {
      out.push({
        name,
        size,
        read() {
          const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
          const body = zip.subarray(start, start + packed);
          if (method === 0) return Buffer.from(body);
          if (method === 8) return inflateRawSync(body);
          throw new Error(`${name}: unsupported ZIP compression method ${method}`);
        },
      });
    }
    o += 46 + nameLen + zip.readUInt16LE(o + 30) + zip.readUInt16LE(o + 32);
  }
  return out;
}

/** Returns the contents of the first entry of the ZIP bytes `zip` whose path ends with `suffix`, or null. */
export function entryFromZip(zip, suffix) {
  const hit = zipEntries(zip).find((e) => e.name.endsWith(suffix));
  return hit ? hit.read() : null;
}

/** Returns the contents of the first entry of the ZIP file `archive` whose path ends with `suffix`, or null. */
export function readFromZip(archive, suffix) {
  return entryFromZip(readFileSync(archive), suffix);
}
