/**
 * Files under `<Homebridge storage path>/busy-light/` (SPEC section 3): the directory is mode 700 and every file is
 * written to a temporary file and renamed, so a reader never sees half a file.
 */
import fs from 'node:fs';
import path from 'node:path';
import { STORAGE_DIR } from './names.js';

/** `<storagePath>/busy-light`, created with mode 700 if needed. */
export function ensureStorageDir(storagePath: string): string {
  const dir = path.join(storagePath, STORAGE_DIR);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    fs.chmodSync(dir, 0o700);
  } catch {
    // Not ours to change (for example a read-only mount); writing will report any real problem.
  }
  return dir;
}

let counter = 0;

/** Writes to a temporary file in the same directory, then renames it over the target. */
export function writeFileAtomic(file: string, data: string, mode = 0o600): void {
  const tmp = `${file}.${process.pid}.${++counter}.tmp`;
  try {
    fs.writeFileSync(tmp, data, { mode });
    fs.chmodSync(tmp, mode);
    fs.renameSync(tmp, file);
  } catch (err) {
    try {
      fs.unlinkSync(tmp);
    } catch {
      // nothing to clean up
    }
    throw err;
  }
}

/** Parsed JSON, or null when the file is missing or unreadable. */
export function readJson(file: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as unknown;
  } catch {
    return null;
  }
}
