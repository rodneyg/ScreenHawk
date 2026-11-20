export type HistoryEntry = {
  id: string;
  timestamp: number;
  prompt: string;
  answer: string;
  thumbnail: string;
  screenshot?: string;
  url?: string;
  title?: string;
};

const key = 'interactionHistory';
const limit = 50;
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

export async function saveInteraction(
  prompt: string, answer: string, image: string, signal: AbortSignal, source: { url?: string; title?: string },
) {
  const { screenshot, thumbnail } = await compressImages(image);
  if (signal.aborted) return;
  await updateHistory((entries) => signal.aborted ? entries : [{
    id: crypto.randomUUID(),
    timestamp: Date.now(),
    prompt,
    answer,
    thumbnail,
    screenshot,
    url: source.url?.slice(0, 4096),
    title: source.title?.slice(0, 500),
  }, ...entries].slice(0, limit));
}

export function deleteInteraction(id: string) {
  return updateHistory((entries) => entries.filter((entry) => entry.id !== id));
}

export function clearHistory() {
  return updateHistory(() => []);
}

async function compressImages(image: string) {
  const png = atob(image.slice(image.indexOf(',') + 1));
  const bytes = Uint8Array.from(png, (byte) => byte.charCodeAt(0));
  const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
  try {
    const thumbnail = await encodeJpeg(bitmap, 320, 200, 0.7);
    const budget = 150_000 - thumbnail.length;
    const large = await encodeJpeg(bitmap, 1200, 1200, 0.6);
    // Bound bytes per entry so even image-heavy history fits within local storage.
    const screenshot = large.length <= budget ? large : await encodeJpeg(bitmap, 500, 500, 0.5);
    return { thumbnail, screenshot: screenshot.length <= budget ? screenshot : thumbnail };
  } finally {
    bitmap.close();
  }
}


async function encodeJpeg(bitmap: ImageBitmap, width: number, height: number, quality: number) {
  const scale = Math.min(1, width / bitmap.width, height / bitmap.height);
  const canvas = new OffscreenCanvas(
    Math.max(1, Math.round(bitmap.width * scale)),
    Math.max(1, Math.round(bitmap.height * scale)),
  );
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Screenshot unavailable');
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const jpeg = await canvas.convertToBlob({ type: 'image/jpeg', quality });
  const encoded = Array.from(new Uint8Array(await jpeg.arrayBuffer()), (byte) => String.fromCharCode(byte)).join('');
  return `data:image/jpeg;base64,${btoa(encoded)}`;
}
