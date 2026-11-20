const storeLink = document.querySelector('[data-store-url]');

if (storeLink.dataset.storeUrl) {
  storeLink.href = storeLink.dataset.storeUrl;
  storeLink.removeAttribute('aria-disabled');
  storeLink.textContent = 'Add to Chrome';
}
