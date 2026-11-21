export type Field = HTMLTextAreaElement | HTMLInputElement;

export function isEditable(field: Field) {
  return (field instanceof HTMLTextAreaElement || field.type === 'text') &&
    field.isConnected && !field.readOnly && !field.matches(':disabled');
}

export function chooseField(onSelect: (field: Field) => void) {
  const lifetime = new AbortController();
  const { signal } = lifetime;
  const highlighted = new Map<Field, { outline: string; priority: string }>();
  for (const field of document.querySelectorAll<Field>('textarea, input')) {
    const { width, height } = field.getBoundingClientRect();
    if (!isEditable(field) || !width || !height || getComputedStyle(field).visibility !== 'visible') continue;
    highlighted.set(field, {
      outline: field.style.getPropertyValue('outline'),
      priority: field.style.getPropertyPriority('outline'),
    });
    field.style.setProperty('outline', '2px solid #078c78', 'important');
  }

  const host = document.createElement('div');
  host.id = 'screenhawk-field-helper';
  const root = host.attachShadow({ mode: 'closed' });
  const styles = new CSSStyleSheet();
  styles.replaceSync(`
    :host { all: initial; position: fixed; top: 12px; left: 12px; z-index: 2147483647; pointer-events: none; }
    p { max-width: calc(100vw - 48px); margin: 0; padding: 8px 12px; border-radius: 8px;
      background: #101b24; color: #eef6f7; font: 14px/1.4 system-ui, sans-serif; }
  `);
  root.adoptedStyleSheets = [styles];
  const status = document.createElement('p');
  status.setAttribute('role', 'status');
  status.textContent = highlighted.size
    ? 'Choose a highlighted text field. Press Escape to stop.'
    : 'No editable text fields found. Press Escape to stop.';
  root.append(status);
  document.documentElement.append(host);

  function close() {
    lifetime.abort();
    for (const [field, { outline, priority }] of highlighted) {
      field.style.setProperty('outline', outline, priority);
    }
    highlighted.clear();
    host.remove();
  }

  function select(event: MouseEvent | KeyboardEvent) {
    if (!event.isTrusted) return;
    const field = event.target as Field;
    if (!highlighted.has(field) || !isEditable(field)) return;
    event.preventDefault();
    field.focus({ preventScroll: true });
    close();
    onSelect(field);
  }

  document.addEventListener('click', select, { capture: true, signal });
  document.addEventListener('keydown', (event) => {
    if (!event.isTrusted) return;
    if (event.key === 'Escape') close();
    if (event.key === 'Enter') select(event);
  }, { capture: true, signal });
  return close;
}
