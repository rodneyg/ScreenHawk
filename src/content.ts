type Point = { x: number; y: number };
type Answer =
  | { ok: true; answer: string; historySaveFailed?: boolean }
  | { ok: false; message: string; showOptions?: boolean };

const global = globalThis as typeof globalThis & { screenHawkInstalled?: boolean };
let nextQuestion = 0;

if (!global.screenHawkInstalled) {
  global.screenHawkInstalled = true;
  let closeQuestion: (() => void) | undefined;

  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (sender.id !== chrome.runtime.id || sender.tab) return;
    if (message?.action === 'resetCapture') {
      closeQuestion?.();
      respond({ ok: true });
    } else if (message?.action === 'startFormDraft') {
      const field = document.activeElement;
      if (!(field instanceof HTMLTextAreaElement) || !isEditable(field)) {
        respond({ ok: false });
        return;
      }
      closeQuestion?.();
      closeQuestion = showDraftButton(field, () => {
        closeQuestion = showQuestion({ field });
      });
      respond({ ok: true });
    } else if (message?.action === 'startSelection') {
      closeQuestion?.();
      selectArea(message.image).then((close) => {
        closeQuestion = close;
        respond({ ok: true });
      }, () => respond({ ok: false }));
      return true;
    }
  });
}

function isEditable(field: HTMLTextAreaElement) {
  return field.isConnected && !field.readOnly && !field.matches(':disabled');
}

function showDraftButton(field: HTMLTextAreaElement, openDraft: () => void) {
  const lifetime = new AbortController();
  const host = document.createElement('div');
  host.id = 'screenhawk-draft-launcher';
  const root = host.attachShadow({ mode: 'closed' });
  const styles = new CSSStyleSheet();
  styles.replaceSync(`
    :host { all: initial; position: fixed; z-index: 2147483647; }
    :host([hidden]) { display: none; }
    button {
      background: #101b24; color: #a6f6e0; border: 1px solid #55717e; border-radius: 8px;
      font: 600 13px/1.4 system-ui, sans-serif; min-height: 28px; padding: 3px 9px; cursor: pointer;
    }
    button:focus-visible { outline: 2px solid #147f68; outline-offset: 2px; }
  `);
  root.adoptedStyleSheets = [styles];
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = 'Help me write';
  root.append(button);
  document.documentElement.append(host);

  function close() {
    lifetime.abort();
    host.remove();
  }

  function position() {
    if (!isEditable(field)) {
      close();
      return;
    }
    const { top, left, right, bottom, width, height } = field.getBoundingClientRect();
    host.hidden = !width || !height || right <= 0 || bottom <= 0 || left >= innerWidth || top >= innerHeight;
    if (host.hidden) return;
    host.style.left = `${Math.max(0, Math.min(right, innerWidth) - button.offsetWidth - 4)}px`;
    host.style.top = `${Math.max(0, top) + 4}px`;
  }

  button.addEventListener('click', (event) => {
    if (!event.isTrusted || !isEditable(field)) return;
    close();
    field.focus({ preventScroll: true });
    openDraft();
  });
  const { signal } = lifetime;
  window.addEventListener('scroll', position, { capture: true, signal });
  window.addEventListener('resize', position, { signal });
  document.addEventListener('focusin', (event) => {
    if (event.target !== field && event.target !== host) close();
  }, { signal });
  button.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    close();
    field.focus({ preventScroll: true });
  });
  position();
  if (!host.hidden) button.focus({ preventScroll: true });
  return close;
}

function getFieldLabel(field: HTMLTextAreaElement) {
  // A wrapping label can include a textarea's default value or other controls.
  const label = field.labels?.[0]?.cloneNode(true) as HTMLLabelElement | undefined;
  label?.querySelectorAll(
    'input, textarea, select, button, output, script, style, [contenteditable], [hidden], [aria-hidden="true"]',
  )
    .forEach((control) => control.remove());
  return (field.getAttribute('aria-label')?.trim() || label?.textContent?.trim() || field.placeholder)
    .replace(/\s+/g, ' ').trim().slice(0, 200);
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
  return showQuestion({ preview });
}

function showQuestion(context: { preview: HTMLCanvasElement } | { field: HTMLTextAreaElement }) {
  const preview = 'preview' in context ? context.preview : undefined;
  const field = 'field' in context ? context.field : undefined;
  const drafting = !!field;
  const originalValue = field?.value;
  const lifetime = new AbortController();
  const host = document.createElement('div');
  host.id = 'screenhawk-overlay';
  const root = host.attachShadow({ mode: 'closed' });
  const styles = new CSSStyleSheet();
  styles.replaceSync(`
      :host { all: initial; color-scheme: dark; }
      * { box-sizing: border-box; }
      dialog {
        color: #eef6f7; background: rgb(16 27 36 / 94%); border: 1px solid #35515f; border-radius: 18px;
        backdrop-filter: blur(10px);
        font: 15px/1.5 system-ui, sans-serif; box-shadow: 0 18px 56px #020a1399;
        padding: 24px; width: min(460px, calc(100vw - 32px)); outline: none;
      }
      dialog::backdrop { background: #0410185c; }
      dialog.selecting {
        position: fixed; inset: 0; margin: 0; width: 100%; height: 100%;
        max-width: none; max-height: none; border: 0; padding: 0; border-radius: 0;
        background: transparent; backdrop-filter: none; box-shadow: none; overflow: hidden;
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
      textarea, #field-label {
        background: #0a141d; border: 1px solid #55717e; border-radius: 10px; padding: 11px;
        width: 100%; min-height: 78px; resize: vertical; color: inherit; font: inherit;
      }
      #field-label { min-height: auto; margin-bottom: 12px; }
      .actions { display: flex; align-items: center; justify-content: flex-end; gap: 8px; margin-top: 16px; }
      button, a { font: inherit; font-weight: 600; color: #a6f6e0; }
      button {
        cursor: pointer; background: rgb(170 194 204 / 15%); color: #eef6f7;
        border: 1px solid rgb(170 194 204 / 40%); border-radius: 8px; padding: 8px 13px;
      }
      button:not(.primary):hover:not(:disabled) { background: rgb(170 194 204 / 25%); }
      button.primary { background: rgb(119 241 207 / 20%); color: #d4fff3; border-color: rgb(119 241 207 / 45%); }
      section button.primary:hover:not(:disabled) { background: rgb(119 241 207 / 30%); }
      form button.primary {
        min-width: 24px; min-height: 24px; padding: 7px 12px;
        background: rgba(119, 241, 207, .14); color: #a6f6e0;
        border: 1px solid rgba(119, 241, 207, .34); backdrop-filter: blur(8px);
      }
      form button.primary:enabled { opacity: .78; }
      form button.primary:enabled:is(:hover, :focus-visible) {
        background: rgba(119, 241, 207, .24); opacity: 1;
      }
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
        <h2 id="prompt-title">Ask about this area</h2>
        <div id="field-context" hidden>
          <label for="field-label" class="muted">Field label (optional)</label>
          <input id="field-label" type="text" maxlength="200" autocomplete="off">
        </div>
        <label id="question-label" for="question" class="muted">Question</label>
        <textarea id="question" rows="3" maxlength="2000" required></textarea>
        <small id="sharing">ScreenHawk sends your selection and question to OpenAI when you click Ask. Successful answers are saved with a compressed image and source page information in local history.</small>
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
        <p id="insert-error" role="alert" hidden></p>
        <div class="actions">
          <button type="button" class="primary" id="close">Close</button>
          <button type="button" class="primary" id="insert" hidden>Use draft</button>
        </div>
      </section>
    </dialog>`;
  const dialog = root.querySelector('dialog')!;
  const area = root.querySelector<HTMLDivElement>('#area')!;
  if (preview) {
    preview.setAttribute('aria-hidden', 'true');
    area.prepend(preview);
  }
  const fieldLabel = root.querySelector<HTMLInputElement>('#field-label')!;
  const box = root.querySelector<HTMLDivElement>('#box')!;
  const form = root.querySelector('form')!;
  const question = root.querySelector('textarea')!;
  const submit = form.querySelector<HTMLButtonElement>('[type=submit]')!;
  const error = root.querySelector<HTMLParagraphElement>('#error')!;
  const options = root.querySelector<HTMLAnchorElement>('#options')!;
  const answerPanel = root.querySelector('section')!;
  const heading = root.querySelector<HTMLElement>('#answer-title')!;
  const answer = root.querySelector<HTMLParagraphElement>('#answer')!;
  const insert = root.querySelector<HTMLButtonElement>('#insert')!;
  let start: Point | undefined;
  let pointer: number | undefined;
  let crop: string | undefined;
  let requestId: string | undefined;

  function close() {
    lifetime.abort();
    if (requestId) void chrome.runtime.sendMessage({ action: 'cancelQuestion', id: requestId }).catch(() => {});
    if (preview) preview.width = 0;
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
  if (field) {
    insert.hidden = false;
    if (originalValue) insert.textContent = 'Replace field text';
    insert.addEventListener('click', (event) => {
      if (!event.isTrusted) return;
      const draft = answer.textContent ?? '';
      const insertError = root.querySelector<HTMLParagraphElement>('#insert-error')!;
      if (!isEditable(field) || field.value !== originalValue) {
        insertError.textContent = 'The text area changed. You can still copy this draft.';
      } else if (field.maxLength >= 0 && draft.length > field.maxLength) {
        insertError.textContent = 'This draft is too long for the text area. You can still copy it.';
      } else {
        field.value = draft;
        field.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertReplacementText' }));
        close();
        field.focus({ preventScroll: true });
        return;
      }
      insertError.hidden = false;
    });
  }
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

  function showPrompt(title: string) {
    area.hidden = true;
    form.hidden = false;
    dialog.classList.remove('selecting');
    dialog.setAttribute('aria-label', title);
    question.focus();
  }

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
    if (!event.isTrusted || !preview || !start || pointer !== event.pointerId) return;
    const rect = bounds(event, start);
    if (rect.width < 12 || rect.height < 12) return;
    const viewport = area.getBoundingClientRect();
    showPrompt('Ask about this area');
    submit.disabled = true;
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
    if (!event.isTrusted || !prompt || (!drafting && !crop) || requestId) return;
    requestId = String(++nextQuestion);
    const request = drafting
      ? { action: 'draft', id: requestId, prompt, fieldLabel: fieldLabel.value.trim() }
      : { action: 'ask', id: requestId, prompt, image: crop };
    submit.disabled = true;
    question.readOnly = true;
    fieldLabel.readOnly = true;
    submit.textContent = drafting ? 'Drafting…' : 'Asking…';
    error.hidden = true;
    options.hidden = true;
    try {
      const result: Answer = await chrome.runtime.sendMessage(request);
      if (lifetime.signal.aborted) return;
      if (result.ok) {
        crop = undefined;
        answer.textContent = result.answer;
        root.querySelector<HTMLElement>('#history-note')!.hidden = !result.historySaveFailed;
        form.hidden = true;
        answerPanel.hidden = false;
        dialog.setAttribute('aria-label', drafting ? 'Draft' : 'Answer');
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
      fieldLabel.readOnly = false;
      submit.textContent = drafting ? 'Generate draft' : 'Ask';
    }
  });

  if (field) {
    fieldLabel.value = getFieldLabel(field);
    root.querySelector<HTMLElement>('#field-context')!.hidden = false;
    root.querySelector('#prompt-title')!.textContent = 'Draft for field';
    root.querySelector('#question-label')!.textContent = 'What do you want to say?';
    question.placeholder = 'Describe what you want to write';
    root.querySelector('#sharing')!.textContent = 'ScreenHawk sends the label above and your instructions to OpenAI.';
    heading.textContent = 'Review draft';
    submit.textContent = 'Generate draft';
    area.hidden = true;
  }
  document.documentElement.append(host);
  dialog.showModal();
  if (drafting) showPrompt('Draft for field');
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
