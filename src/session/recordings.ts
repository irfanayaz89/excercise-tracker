import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import type { Recording } from '@/engine/recording';

function dir(): Directory {
  const d = new Directory(Paths.document, 'recordings');
  if (!d.exists) d.create({ intermediates: true, idempotent: true });
  return d;
}

/** Saves a recording and returns its file, or null if saving failed or it was empty. */
export async function saveRecording(rec: Recording): Promise<File | null> {
  if (rec.frames.length < 30) return null;
  try {
    const name = `set-${rec.createdAt.replace(/[:.]/g, '-')}.json`;
    const f = new File(dir(), name);
    await f.write(JSON.stringify(rec));
    return f;
  } catch (e) {
    console.warn('[recordings] save failed', e);
    return null;
  }
}

export function listRecordings(): File[] {
  try {
    return dir()
      .list()
      .filter((x): x is File => x instanceof File && x.name.endsWith('.json'))
      .sort((a, b) => (a.name < b.name ? 1 : -1));
  } catch {
    return [];
  }
}

export async function shareRecording(f: File): Promise<boolean> {
  try {
    if (!(await Sharing.isAvailableAsync())) return false;
    await Sharing.shareAsync(f.uri, { mimeType: 'application/json', dialogTitle: 'Share set recording' });
    return true;
  } catch {
    return false;
  }
}

export function deleteRecording(f: File): void {
  try {
    f.delete();
  } catch {
    // ignore
  }
}
