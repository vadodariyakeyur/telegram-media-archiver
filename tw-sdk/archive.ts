// Packing the collected media into a zip and handing it to the browser.
import JSZip from 'jszip';
import { chatName } from './dom';
import type { FoundItem, MediaKind } from './types';

function extFor(kind: MediaKind, mime: string | null | undefined): string {
  if (mime) {
    const m = mime.split('/')[1]?.split(';')[0];
    if (m) return ({ quicktime: 'mov', jpeg: 'jpg', mpeg: 'mp3', 'x-matroska': 'mkv', ogg: 'ogg' } as Record<string, string>)[m] || m;
  }
  return ({
    video: 'mp4', gif: 'mp4', round: 'mp4',
    voice: 'ogg', music: 'mp3', file: 'bin',
  } as Partial<Record<MediaKind, string>>)[kind] || 'jpg';
}

// Telegram's own filename, when the scan captured one. A zip full of
// file_0001.bin is not an archive of anything — but two chats can send the same
// name, so the sequence number stays as the collision break.
function nameFor(item: FoundItem, kind: MediaKind, n: number, mime: string | null | undefined): string {
  const seq = String(n).padStart(4, '0');
  const raw = item.name;
  if (!raw) return `${kind}_${seq}.${extFor(kind, mime)}`;
  const dot = raw.lastIndexOf('.');
  const stem = dot > 0 ? raw.slice(0, dot) : raw;
  const ext = dot > 0 ? raw.slice(dot + 1) : extFor(kind, mime);
  return `${stem}_${seq}.${ext}`;
}

export interface ArchiveReport {
  phase: 'downloading' | 'zipping';
  done?: number;
  total?: number;
}

export interface ArchiveResult {
  blob: Blob;
  counts: Record<string, number>;
  total: number;
  failed: number;
}

// Returns a Blob rather than saving it: naming, numbering, foldering and the
// skip-and-count rules are the numbers the user reads at the end of a run.
// Fusing them with browser IO made them unreachable from a test, and they were
// wrong twice before anyone noticed.
export async function buildArchive(items: FoundItem[], report: (r: ArchiveReport) => void): Promise<ArchiveResult> {
  const zip = new JSZip();
  const counts: Record<string, number> = {};
  let failed = 0;
  let total = 0;

  for (let i = 0; i < items.length; i++) {
    report({ phase: 'downloading', done: i, total: items.length });
    try {
      const kind = items[i].kind;
      // Deferred kinds arrive pre-fetched (assembled from Range chunks by the
      // collect pass); everything else is a live blob: URL in the page.
      let blob = items[i].blob;
      if (!blob) {
        const res = await fetch(items[i].url!);
        if (!res.ok) throw new Error(String(res.status));
        blob = await res.blob();
      }
      if (!blob.size) { failed++; continue; }

      const n = (counts[kind] = (counts[kind] || 0) + 1);
      total++;
      zip.file(`${kind}/${nameFor(items[i], kind, n, blob.type)}`, blob);
    } catch {
      // A blob can be revoked between scan and fetch; skip and keep going.
      failed++;
    }
  }

  if (total === 0) {
    throw new Error('Nothing could be downloaded (media links expired). Re-scan and retry.');
  }

  report({ phase: 'zipping' });
  const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
  return { blob, counts, total, failed };
}

function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

export async function zipAndSave(items: FoundItem[], report: (r: ArchiveReport) => void): Promise<{ counts: Record<string, number>; total: number; failed: number }> {
  const { blob, counts, total, failed } = await buildArchive(items, report);
  saveBlob(blob, `${chatName()}-media.zip`);
  return { counts, total, failed };
}
