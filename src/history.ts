export type HistoryEntry = {
  id: string;
  timestamp: number;
  prompt: string;
  answer: string;
  thumbnail: string;
};

const key = 'interactionHistory';
const limit = 20;
let writes: Promise<void> = Promise.resolve();

export async function readHistory(): Promise<HistoryEntry[]> {
  const stored = await chrome.storage.local.get<{ [key]: HistoryEntry[] }>({ [key]: [] });
  return stored[key];
}

// Keep saves and deletes from overwriting each other in the extension worker.
function updateHistory(update: (entries: HistoryEntry[]) => HistoryEntry[]) {
  const write = writes.then(async () => {
    const entries = await readHistory();
    await chrome.storage.local.set({ [key]: update(entries) });
  });
  writes = write.catch(() => {});
  return write;
}

export async function saveInteraction(prompt: string, answer: string, image: string, signal: AbortSignal) {
  const thumbnail = await createThumbnail(image);
  if (signal.aborted) return;
  await updateHistory((entries) => signal.aborted ? entries : [{
    id: crypto.randomUUID(),
    timestamp: Date.now(),
    prompt,
    answer,
    thumbnail,
  }, ...entries].slice(0, limit));
}

export function deleteInteraction(id: string) {
  return updateHistory((entries) => entries.filter((entry) => entry.id !== id));
}

async function createThumbnail(image: string) {
  const png = atob(image.slice(image.indexOf(',') + 1));
  const bytes = Uint8Array.from(png, (byte) => byte.charCodeAt(0));
  const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
  try {
    const scale = Math.min(1, 320 / bitmap.width, 200 / bitmap.height);
    const canvas = new OffscreenCanvas(
      Math.max(1, Math.round(bitmap.width * scale)),
      Math.max(1, Math.round(bitmap.height * scale)),
    );
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Thumbnail unavailable');
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const jpeg = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.7 });
    const encoded = Array.from(new Uint8Array(await jpeg.arrayBuffer()), (byte) => String.fromCharCode(byte)).join('');
    return `data:image/jpeg;base64,${btoa(encoded)}`;
  } finally {
    bitmap.close();
  }
}
