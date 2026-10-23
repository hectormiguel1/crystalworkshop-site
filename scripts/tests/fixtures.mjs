// Shared test fixtures.
import { deflateRawSync } from 'node:zlib';

// Builds a ZIP from [name, contents, method] entries (CRCs are not checked by the reader).
export function zipOf(entries) {
  const locals = [];
  const central = [];
  let offset = 0;
  for (const [name, text, method] of entries) {
    const raw = Buffer.from(text);
    const body = method === 8 ? deflateRawSync(raw) : raw;
    const n = Buffer.from(name);
    const extra = Buffer.from('xx');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(n.length, 26);
    local.writeUInt16LE(extra.length, 28);
    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(method, 10);
    dir.writeUInt32LE(body.length, 20);
    dir.writeUInt32LE(raw.length, 24);
    dir.writeUInt16LE(n.length, 28);
    dir.writeUInt16LE(extra.length, 30);
    dir.writeUInt32LE(offset, 42);
    locals.push(local, n, extra, body);
    central.push(dir, n, extra);
    offset += 30 + n.length + extra.length + body.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}
