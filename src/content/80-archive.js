// Packing the collected media into a zip and handing it to the browser.

function extFor(kind, mime) {
  if (mime) {
    const m = mime.split('/')[1]?.split(';')[0];
    if (m) return { quicktime: 'mov', jpeg: 'jpg', mpeg: 'mp3', 'x-matroska': 'mkv', ogg: 'ogg' }[m] || m;
  }
  return { video: 'mp4', gif: 'mp4', voice: 'ogg', file: 'bin' }[kind] || 'jpg';
}

// Returns a Blob rather than saving it: naming, numbering, foldering and the
// skip-and-count rules are the numbers the user reads at the end of a run.
// Fusing them with browser IO made them unreachable from a test, and they were
// wrong twice before anyone noticed.
async function buildArchive(items, report) {
  const zip = new JSZip();
  const counts = {};
  let failed = 0;
  let total = 0;

  for (let i = 0; i < items.length; i++) {
    report({ phase: 'downloading', done: i, total: items.length });
    try {
      const kind = items[i].kind;
      // Videos arrive pre-fetched (assembled from Range chunks while the viewer
      // was open); everything else is a live blob: URL in the page.
      let blob = items[i].blob;
      if (!blob) {
        const res = await fetch(items[i].url);
        if (!res.ok) throw new Error(res.status);
        blob = await res.blob();
      }
      if (!blob.size) { failed++; continue; }

      const n = (counts[kind] = (counts[kind] || 0) + 1);
      total++;
      zip.file(`${kind}/${kind}_${String(n).padStart(4, '0')}.${extFor(kind, blob.type)}`, blob);
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

function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

async function zipAndSave(items, report) {
  const { blob, counts, total, failed } = await buildArchive(items, report);
  saveBlob(blob, `${TG.chatName()}-media.zip`);
  return { counts, total, failed };
}

// --- exports ---
TG.buildArchive = buildArchive;
TG.zipAndSave = zipAndSave;
