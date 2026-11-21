const storeLink = document.querySelector('[data-store-url]');
const allowedSources = new Set([
  'awesome_chrome',
  'producthunt',
]);

if (storeLink?.dataset.storeUrl) {
  const params = new URLSearchParams(window.location.search);
  const source = [params.get('utm_source'), params.get('ref')]
    .find((value) => allowedSources.has(value));
  const storeUrl = new URL(storeLink.dataset.storeUrl);

  if (source) {
    storeUrl.searchParams.set('utm_source', source);
  }

  storeLink.href = storeUrl.href;
  storeLink.removeAttribute('aria-disabled');
  storeLink.textContent = 'Add to Chrome';

  const emitStoreClick = () => {
    storeLink.dispatchEvent(new CustomEvent('cws_install_click', {
      bubbles: true,
      detail: { source: source ?? null },
    }));
  };

  storeLink.addEventListener('click', emitStoreClick);
  storeLink.addEventListener('auxclick', (event) => {
    if (event.button === 1) emitStoreClick();
  });
}

storeLink?.addEventListener('cws_install_click', ({ detail }) => {
  const source = allowedSources.has(detail?.source) ? detail.source : 'direct';
  window.va?.('event', { name: 'cws_install_click', data: { source } });
});
