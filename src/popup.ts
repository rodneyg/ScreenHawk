import { readHistory, type HistoryEntry } from './history';

const capture = document.querySelector<HTMLButtonElement>('#capture')!;
const status = document.querySelector<HTMLElement>('#status')!;
const historyList = document.querySelector<HTMLUListElement>('#history-list')!;
const historyStatus = document.querySelector<HTMLElement>('#history-status')!;

capture.addEventListener('click', async () => {
  capture.disabled = true;
  status.textContent = '';
  try {
    const result = await chrome.runtime.sendMessage({ action: 'startCapture' });
    if (result.ok) {
      window.close();
      return;
    }
    status.textContent = result.message;
  } catch {
    status.textContent = 'Could not start ScreenHawk. Try again.';
  } finally {
    capture.disabled = false;
  }
});

document.querySelector('#settings')!.addEventListener('click', async (event) => {
  event.preventDefault();
  await chrome.runtime.openOptionsPage();
  window.close();
});

function renderEntry(entry: HistoryEntry) {
  const row = document.createElement('li');
  const details = document.createElement('details');
  const summary = document.createElement('summary');
  const prompt = document.createElement('span');
  prompt.className = 'history-prompt';
  prompt.textContent = entry.prompt;
  summary.append(prompt);

  const preview = document.createElement('div');
  preview.className = 'history-preview';
  const thumbnail = document.createElement('img');
  thumbnail.src = entry.thumbnail;
  thumbnail.alt = 'Selected area';
  const time = document.createElement('time');
  const date = new Date(entry.timestamp);
  time.dateTime = date.toISOString();
  time.textContent = date.toLocaleString();
  preview.append(thumbnail, time);

  const answer = document.createElement('p');
  answer.className = 'history-answer';
  answer.textContent = entry.answer;
  const remove = document.createElement('button');
  remove.className = 'history-delete';
  remove.type = 'button';
  remove.textContent = 'Delete entry';
  remove.addEventListener('click', async () => {
    remove.disabled = true;
    try {
      const result = await chrome.runtime.sendMessage({ action: 'deleteInteraction', id: entry.id });
      if (!result?.ok) throw new Error('Delete failed');
      const next = row.nextElementSibling ?? row.previousElementSibling;
      row.remove();
      clear.disabled = !historyList.children.length;
      historyStatus.textContent = historyList.children.length ? 'Entry deleted.' : 'No saved interactions.';
      (next?.querySelector('summary') ?? capture).focus();
    } catch {
      historyStatus.textContent = 'Could not delete this entry. Try again.';
      remove.disabled = false;
    }
  });
  const viewer = document.createElement('a');
  viewer.href = `interaction-viewer.html?id=${encodeURIComponent(entry.id)}`;
  viewer.target = '_blank';
  viewer.textContent = 'Open details';
  details.append(summary, answer, viewer, remove);
  row.append(preview, details);
  return row;
}

const clear = document.querySelector<HTMLButtonElement>('#clear-history')!;
clear.addEventListener('click', async () => {
  if (!confirm('Delete all saved interactions?')) return;
  clear.disabled = true;
  try {
    const result = await chrome.runtime.sendMessage({ action: 'clearHistory' });
    if (!result?.ok) throw new Error('Clear failed');
    historyList.replaceChildren();
    historyStatus.textContent = 'No saved interactions.';
    capture.focus();
  } catch {
    historyStatus.textContent = 'Could not clear history. Try again.';
    clear.disabled = false;
  }
});

void readHistory().then((entries) => {
  historyList.replaceChildren(...entries.map(renderEntry));
  clear.disabled = !entries.length;
  historyStatus.textContent = entries.length ? '' : 'No saved interactions.';
}).catch(() => {
  historyStatus.textContent = 'Could not load history.';
});
