type Point = { x: number; y: number };
type Answer =
  | { ok: true; answer: string; historySaveFailed?: boolean }
  | { ok: false; message: string; showOptions?: boolean };

const global = globalThis as typeof globalThis & { screenHawkInstalled?: boolean };
let nextQuestion = 0;

if (!global.screenHawkInstalled) {
  global.screenHawkInstalled = true;
  let closeCapture: (() => void) | undefined;

  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (sender.id !== chrome.runtime.id || sender.tab) return;
    if (message?.action === 'resetCapture') {
      closeCapture?.();
      respond({ ok: true });
    } else if (message?.action === 'startSelection') {
      closeCapture?.();
      selectArea(message.image).then((close) => {
        closeCapture = close;
        respond({ ok: true });
      }, () => respond({ ok: false }));
      return true;
    }
  });
}

async function selectArea(snapshot: string) {
  const bytes = Uint8Array.from(atob(snapshot.slice(snapshot.indexOf(',') + 1)), (byte) => byte.charCodeAt(0));
  const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
  const preview = document.createElement('canvas');
  preview.width = bitmap.width;
  preview.height = bitmap.height;
  const previewContext = preview.getContext('2d');
  try {
    if (!previewContext) throw new Error('Preview unavailable');
    previewContext.drawImage(bitmap, 0, 0);
  } finally {
    bitmap.close();
  }
  const lifetime = new AbortController();
  const host = document.createElement('div');
  host.id = 'screenhawk-overlay';
  const root = host.attachShadow({ mode: 'closed' });
  const styles = new CSSStyleSheet();
  styles.replaceSync(`
      :host { all: initial; color-scheme: dark; }
      * { box-sizing: border-box; }
      dialog {
        color: #eef6f7; background: #101b24; border: 1px solid #35515f; border-radius: 18px;
        font: 15px/1.5 system-ui, sans-serif; box-shadow: 0 18px 56px #020a1399;
        padding: 24px; width: min(460px, calc(100vw - 32px)); outline: none;
      }
      dialog::backdrop { background: #0410185c; }
      dialog.selecting {
        position: fixed; inset: 0; margin: 0; width: 100%; height: 100%;
        max-width: none; max-height: none; border: 0; padding: 0; border-radius: 0;
        background: transparent; box-shadow: none; overflow: hidden;
      }
      dialog.selecting::backdrop { background: transparent; }
      #area { position: absolute; inset: 0; touch-action: none; cursor: crosshair; overflow: hidden; }
      #area canvas { position: absolute; width: 100%; height: 100%; pointer-events: none; }
      #area::before {
        content: ''; position: absolute; inset: 0; z-index: 1; background: #04101870; pointer-events: none;
      }
      #area:has(#box:not([hidden]))::before { display: none; }
      #box {
        position: absolute; z-index: 1; pointer-events: none; border: 2px solid #77f1cf; border-radius: 5px;
        box-shadow: 0 0 0 150vmax #04101870;
      }
      #hint {
        position: absolute; z-index: 2; pointer-events: none; top: 24px; left: 50%; transform: translateX(-50%);
        min-width: min(330px, 90vw); text-align: center; color: #eef6f7; background: #101b24;
        padding: 10px 14px; border: 1px solid #35515f; border-radius: 12px;
      }
      h2 { font-size: 21px; line-height: 1.2; margin: 0 0 12px; }
      p { margin: 0 0 14px; }
      small, .muted { color: #aac2cc; }
      textarea {
        background: #0a141d; border: 1px solid #55717e; border-radius: 10px; padding: 11px;
        width: 100%; min-height: 78px; resize: vertical; color: inherit; font: inherit;
      }
      .actions { display: flex; align-items: center; justify-content: flex-end; gap: 8px; margin-top: 16px; }
      button, a { font: inherit; font-weight: 600; color: #a6f6e0; }
      button { cursor: pointer; background: transparent; border: 0; border-radius: 8px; padding: 8px 13px; }
      button.primary { background: #77f1cf; color: #0b2921; }
      button:disabled { opacity: .6; cursor: wait; }
      :focus-visible { outline: 2px solid #77f1cf; outline-offset: 3px; }
      #answer { white-space: pre-wrap; overflow-wrap: anywhere; }
      [hidden] { display: none !important; }
  `);
  root.adoptedStyleSheets = [styles];
  root.innerHTML = `
    <dialog class="selecting" aria-label="Select a page area">
      <div id="area">
        <div id="box" hidden></div>
        <div id="hint"><strong>Drag to select a page area</strong><br><small>Escape to cancel</small></div>
      </div>
      <form hidden>
        <h2>Ask about this area</h2>
        <label for="question" class="muted">Question</label>
        <textarea id="question" rows="3" maxlength="2000" required></textarea>
        <small>Ask sends your selection and question to OpenAI. Successful answers are saved with a compressed image and source page information in local history.</small>
        <p id="error" role="alert" hidden></p>
        <a id="options" href="#" hidden>Open ScreenHawk settings</a>
        <div class="actions">
          <button type="button" id="cancel">Cancel</button>
          <button class="primary" type="submit">Ask</button>
        </div>
      </form>
      <section hidden>
        <h2 id="answer-title" tabindex="-1">Answer</h2>
        <p id="answer"></p>
        <p id="history-note" class="muted" role="status" hidden>ScreenHawk could not save this answer to history.</p>
        <div class="actions"><button class="primary" id="close">Close</button></div>
      </section>
    </dialog>`;
  const dialog = root.querySelector('dialog')!;
  const area = root.querySelector<HTMLDivElement>('#area')!;
  preview.setAttribute('aria-hidden', 'true');
  area.prepend(preview);
  const box = root.querySelector<HTMLDivElement>('#box')!;
  const form = root.querySelector('form')!;
  const question = root.querySelector('textarea')!;
  const submit = form.querySelector<HTMLButtonElement>('[type=submit]')!;
  const error = root.querySelector<HTMLParagraphElement>('#error')!;
  const options = root.querySelector<HTMLAnchorElement>('#options')!;
  const answerPanel = root.querySelector('section')!;
  const heading = root.querySelector<HTMLElement>('#answer-title')!;
  let start: Point | undefined;
  let pointer: number | undefined;
  let crop: string | undefined;
  let requestId: string | undefined;

  function close() {
    lifetime.abort();
    if (requestId) void chrome.runtime.sendMessage({ action: 'cancelQuestion', id: requestId }).catch(() => {});
    preview.width = 0;
    crop = undefined;
    if (dialog.open) dialog.close();
    host.remove();
  }

  function showError(message: string, showOptions = false) {
    error.textContent = message;
    error.hidden = false;
    options.hidden = !showOptions;
  }

  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    close();
  });
  root.querySelector('#cancel')!.addEventListener('click', close);
  root.querySelector('#close')!.addEventListener('click', close);
  window.addEventListener('resize', () => {
    if (!area.hidden) close();
  }, { signal: lifetime.signal });
  area.addEventListener('wheel', (event) => event.preventDefault(), { passive: false });
  options.addEventListener('click', (event) => {
    event.preventDefault();
    void chrome.runtime.sendMessage({ action: 'openOptions' }).then((state) => {
      if (!state?.ok) showError('Open settings from the ScreenHawk toolbar menu.', true);
    }).catch(() => showError('Open settings from the ScreenHawk toolbar menu.', true));
  });

  function bounds(event: PointerEvent, origin: Point) {
    const { left, top, width, height } = area.getBoundingClientRect();
    const x = Math.max(0, Math.min(event.clientX - left, width));
    const y = Math.max(0, Math.min(event.clientY - top, height));
    return {
      x: Math.min(x, origin.x), y: Math.min(y, origin.y),
      width: Math.abs(x - origin.x), height: Math.abs(y - origin.y),
    };
  }

  area.addEventListener('pointerdown', (event) => {
    if (!event.isTrusted || event.button !== 0 || pointer !== undefined) return;
    const { left, top } = area.getBoundingClientRect();
    start = { x: event.clientX - left, y: event.clientY - top };
    pointer = event.pointerId;
    area.setPointerCapture(pointer);
  });
  area.addEventListener('pointermove', (event) => {
    if (!event.isTrusted || !start || pointer !== event.pointerId) return;
    const rect = bounds(event, start);
    Object.assign(box.style, {
      left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.width}px`, height: `${rect.height}px`,
    });
    box.hidden = false;
  });
  area.addEventListener('lostpointercapture', () => {
    start = undefined;
    pointer = undefined;
    box.hidden = true;
  });
  area.addEventListener('pointerup', (event) => {
    if (!event.isTrusted || !start || pointer !== event.pointerId) return;
    const rect = bounds(event, start);
    if (rect.width < 12 || rect.height < 12) return;
    const viewport = area.getBoundingClientRect();
    area.hidden = true;
    form.hidden = false;
    dialog.classList.remove('selecting');
    dialog.setAttribute('aria-label', 'Ask about this area');
    submit.disabled = true;
    question.focus();
    try {
      crop = cropImage(preview, rect, viewport);
      submit.disabled = false;
    } catch {
      showError('Could not prepare this area. Close this window and try a new capture.');
    } finally {
      preview.width = 0;
    }
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const prompt = question.value.trim();
    if (!event.isTrusted || !prompt || !crop || requestId) return;
    requestId = String(++nextQuestion);
    submit.disabled = true;
    question.readOnly = true;
    submit.textContent = 'Asking…';
    error.hidden = true;
    options.hidden = true;
    try {
      const result: Answer = await chrome.runtime.sendMessage({ action: 'ask', id: requestId, image: crop, prompt });
      if (lifetime.signal.aborted) return;
      if (result.ok) {
        crop = undefined;
        root.querySelector('#answer')!.textContent = result.answer;
        root.querySelector<HTMLElement>('#history-note')!.hidden = !result.historySaveFailed;
        form.hidden = true;
        answerPanel.hidden = false;
        dialog.setAttribute('aria-label', 'Answer');
        heading.focus();
      } else {
        showError(result.message, result.showOptions);
      }
    } catch {
      if (!lifetime.signal.aborted) showError('Could not send your question. Try again.');
    } finally {
      requestId = undefined;
      submit.disabled = false;
      question.readOnly = false;
      submit.textContent = 'Ask';
    }
  });

  document.documentElement.append(host);
  dialog.showModal();
  return close;
}

function cropImage(source: HTMLCanvasElement, rect: Point & { width: number; height: number }, viewport: DOMRect) {
  const ratioX = source.width / viewport.width;
  const ratioY = source.height / viewport.height;
  // Round inward so a fractional selection never shares pixels outside the selected area.
  const x = Math.ceil(rect.x * ratioX);
  const y = Math.ceil(rect.y * ratioY);
  const width = Math.floor((rect.x + rect.width) * ratioX) - x;
  const height = Math.floor((rect.y + rect.height) * ratioY) - y;
  const scale = Math.min(1, 2048 / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.floor(width * scale));
  canvas.height = Math.max(1, Math.floor(height * scale));
  const context = canvas.getContext('2d');
  if (!context || width < 1 || height < 1) throw new Error('Crop unavailable');
  context.drawImage(source, x, y, width, height, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/png');
}

export {};
