// Build-time virus scan data: public/api/scans.json as the scans workflow of
// the public repository last committed it. The page refreshes it at runtime
// (scripts/scans-client.ts); without the file, the downloads from the release
// data are listed with "Not scanned yet".
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fallbackFiles, usableScans } from '../../scripts/scans/model.mjs';
import { releases, allItems } from './data';

type Doc = { generated: string | null; scanners: Record<string, string>; files: any[] };

function load(): Doc | null {
  // The build runs in the site folder (locally and in the Pages workflow).
  for (const p of ['public/api/scans.json', 'site/public/api/scans.json']) {
    const file = path.resolve(process.cwd(), p);
    if (!existsSync(file)) continue;
    try {
      return usableScans(JSON.parse(readFileSync(file, 'utf8')));
    } catch {
      return null;
    }
  }
  return null;
}

export const scans: Doc | null = load();

/** The files the Security page lists: scan results, else every download. */
export const scanFiles = (): any[] => scans?.files ?? fallbackFiles(releases);

/** Product ids in display order (apps, then mods). */
export const scanOrder = (): string[] => allItems().map((i) => i.id);
