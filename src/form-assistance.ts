type Field = HTMLTextAreaElement | HTMLInputElement;

export function getFieldLabel(field: Field) {
  const label = field.labels?.[0]?.cloneNode(true) as HTMLLabelElement | undefined;
  label?.querySelectorAll(
    'input, textarea, select, button, output, script, style, [contenteditable], [hidden], [aria-hidden="true"]',
  ).forEach((control) => control.remove());
  return (field.getAttribute('aria-label')?.trim() || label?.textContent?.trim() || field.placeholder)
    .replace(/\s+/g, ' ').trim().slice(0, 200);
}

function isEditable(field: Element | null): field is Field {
  return (field instanceof HTMLTextAreaElement || (field instanceof HTMLInputElement && field.type === 'text')) &&
    field.isConnected && !field.readOnly && !field.matches(':disabled') &&
    field.getBoundingClientRect().width > 0 && getComputedStyle(field).visibility === 'visible';
}

export function chooseField(nextId: () => string) {
  const lifetime = new AbortController();
  const { signal } = lifetime;
  let active: Field | undefined;
  let requestId: string | undefined;
  let picking = true;
  const marked = new Map<Field, [string, string]>();
  const host = document.createElement('div');
  host.id = 'screenhawk-field-helper';
  host.style.cssText = 'position:fixed;inset:12px auto auto 12px;z-index:2147483647';
  const root = host.attachShadow({ mode: 'closed' });
  root.innerHTML = `
    <style>
      :host { color-scheme: dark; font: 14px system-ui; color: #f1f5f9; }
      [hidden] { display: none !important; }
      .card { box-sizing: border-box; width: min(340px, calc(100vw - 24px)); padding: 12px;
        background: #14242f; border: 1px solid #66848f; border-radius: 10px; box-shadow: 0 6px 24px #0008; }
      .card:has(#open:not([hidden])) { width: max-content; padding: 0; border: 0; }
      form, section { display: grid; gap: 8px; }
      input, textarea, button { font: inherit; }
      input, textarea { box-sizing: border-box; width: 100%; padding: 6px; }
      button { cursor: pointer; padding: 6px 10px; border-radius: 7px; border: 1px solid #6caaa0; }
      p { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; }
      #answer { max-height: 150px; overflow: auto; }
      small { color: #bacbd3; }
    </style>
    <div class="card">
      <p id="hint" role="status">Choose a highlighted text field. Press Escape to stop.</p>
      <button id="open" type="button" hidden>Help me write</button>
      <form hidden>
        <label>Field label <input id="label" maxlength="200" autocomplete="off"></label>
        <label>What do you want to say? <textarea id="instructions" rows="3" maxlength="2000" required></textarea></label>
        <small>ScreenHawk sends this label and your instructions to OpenAI.</small>
        <button id="generate" type="submit">Generate draft</button>
      </form>
      <section hidden>
        <p id="answer" aria-live="polite"></p>
        <button id="insert" type="button">Use draft</button>
      </section>
      <p id="status" role="status"></p>
    </div>`;
  const hint = root.querySelector<HTMLElement>('#hint')!;
  const open = root.querySelector<HTMLButtonElement>('#open')!;
  const form = root.querySelector('form')!;
  const review = root.querySelector('section')!;
  const label = root.querySelector<HTMLInputElement>('#label')!;
  const instructions = root.querySelector<HTMLTextAreaElement>('textarea')!;
  const generate = root.querySelector<HTMLButtonElement>('#generate')!;
  const answer = root.querySelector<HTMLElement>('#answer')!;
  const status = root.querySelector<HTMLElement>('#status')!;
  const insert = root.querySelector<HTMLButtonElement>('#insert')!;

  function clearHighlights() {
    for (const [field, [outline, priority]] of marked) {
      field.style.setProperty('outline', outline, priority);
    }
    marked.clear();
  }

  function close() {
    lifetime.abort();
    if (requestId) void chrome.runtime.sendMessage({ action: 'cancelQuestion', id: requestId }).catch(() => {});
    clearHighlights();
    host.remove();
  }

  function position() {
    if (!active) return;
    const field = active.getBoundingClientRect();
    const left = Math.max(12, Math.min(field.right - host.offsetWidth, innerWidth - host.offsetWidth - 12));
    const bottom = open.hidden ? field.bottom + 6 : Math.max(12, field.top - host.offsetHeight / 2);
    const top = bottom + host.offsetHeight <= innerHeight
      ? bottom : Math.max(12, field.top - host.offsetHeight - 6);
    host.style.left = `${left}px`;
    host.style.top = `${top}px`;
  }

  function showButton(field: Field) {
    if (requestId) return;
    picking = false;
    clearHighlights();
    active = field;
    hint.hidden = true;
    form.hidden = true;
    review.hidden = true;
    open.hidden = false;
    status.textContent = '';
    position();
  }

  function select(event: MouseEvent | FocusEvent) {
    if (!event.isTrusted || !isEditable(event.target as Element | null)) return;
    const field = event.target as Field;
    if (picking && event.type !== 'click') return;
    if (!picking && (field === active || !(field instanceof HTMLTextAreaElement))) return;
    showButton(field);
  }

  open.addEventListener('click', (event) => {
    if (!event.isTrusted || !active || !isEditable(active)) return;
    label.value = getFieldLabel(active);
    instructions.value = '';
    open.hidden = true;
    form.hidden = false;
    position();
    instructions.focus();
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const prompt = instructions.value.trim();
    if (!event.isTrusted || !prompt || requestId) return;
    requestId = nextId();
    generate.disabled = true;
    status.textContent = 'Drafting…';
    try {
      const result = await chrome.runtime.sendMessage({
        action: 'draft', id: requestId, prompt, fieldLabel: label.value.trim(),
      });
      if (signal.aborted) return;
      if (!result?.ok) {
        status.textContent = result?.message ?? 'Could not draft text. Try again.';
        return;
      }
      answer.textContent = result.answer;
      status.textContent = '';
      form.hidden = true;
      review.hidden = false;
      position();
      insert.focus();
    } catch {
      if (!signal.aborted) status.textContent = 'Could not draft text. Try again.';
    } finally {
      requestId = undefined;
      generate.disabled = false;
    }
  });

  insert.addEventListener('click', (event) => {
    if (!event.isTrusted) return;
    const field = active;
    if (!field || !isEditable(field)) {
      status.textContent = 'This field is no longer editable.';
      return;
    }
    const prototype = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const draft = answer.textContent ?? '';
    const value = field.maxLength >= 0 ? draft.slice(0, field.maxLength) : draft;
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(field, value);
    close();
    field.focus();
    field.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertText', data: value }));
    field.dispatchEvent(new Event('change', { bubbles: true }));
  });

  for (const field of document.querySelectorAll('textarea, input')) {
    if (!isEditable(field)) continue;
    marked.set(field, [field.style.getPropertyValue('outline'), field.style.getPropertyPriority('outline')]);
    field.style.setProperty('outline', '2px solid #078c78', 'important');
  }
  if (!marked.size) hint.textContent = 'No editable text fields found. Press Escape to stop.';
  document.documentElement.append(host);
  document.addEventListener('click', select, { capture: true, signal });
  document.addEventListener('focusin', select, { signal });
  document.addEventListener('keydown', (event) => {
    if (!event.isTrusted || event.key !== 'Escape') return;
    close();
  }, { signal });
  window.addEventListener('resize', position, { signal });
  window.addEventListener('scroll', position, { capture: true, signal });
  return close;
}
