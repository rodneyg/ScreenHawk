import { readHistory } from './history';

const status = document.querySelector<HTMLElement>('#viewer-status')!;
const article = document.querySelector<HTMLElement>('article')!;

async function render() {
  const id = new URLSearchParams(location.search).get('id');
  const entry = (await readHistory()).find((item) => item.id === id);
  if (!entry) {
    status.textContent = 'This interaction is no longer available.';
    return;
  }

  const date = new Date(entry.timestamp);
  const time = document.querySelector('time')!;
  time.dateTime = date.toISOString();
  time.textContent = date.toLocaleString();
  const image = document.querySelector<HTMLImageElement>('#saved-image')!;
  image.src = entry.screenshot ?? entry.thumbnail;
  document.querySelector('#saved-question')!.textContent = entry.prompt;
  document.querySelector('#saved-answer')!.textContent = entry.answer;
  document.querySelector('#source-title')!.textContent = entry.title ?? '';
  const sourceLink = document.querySelector<HTMLAnchorElement>('#source-link')!;
  if (entry.url && /^https?:\/\//i.test(entry.url)) {
    sourceLink.href = entry.url;
    sourceLink.target = '_blank';
    sourceLink.rel = 'noopener noreferrer';
    sourceLink.hidden = false;
  }
  const remove = document.querySelector<HTMLButtonElement>('#delete-entry')!;
  remove.addEventListener('click', async () => {
    remove.disabled = true;
    try {
      const result = await chrome.runtime.sendMessage({ action: 'deleteInteraction', id });
      if (!result?.ok) throw new Error('Delete failed');
      article.hidden = true;
      status.textContent = 'Entry deleted.';
    } catch {
      status.textContent = 'Could not delete this entry. Try again.';
      remove.disabled = false;
    }
  });
  status.textContent = '';
  article.hidden = false;
}

void render().catch(() => { status.textContent = 'Could not load this interaction.'; });
