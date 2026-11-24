# ScreenHawk site

Vercel serves this directory as a static site. The project root is `site` and the production branch is `main`. The clean URLs are `/`, `/privacy`, `/support`, `/changelog`, and `/terms`. The changelog page is generated from `changelog/*.md` at the repository root by `npm run changelog:build`.

The `data-store-url` attribute in `index.html` points to the public Chrome Web Store listing. With a configured URL, `store.js` labels the link “Add to Chrome” and forwards supported referral values.
