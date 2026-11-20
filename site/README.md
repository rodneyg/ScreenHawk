# ScreenHawk site

Vercel serves this directory as a static site. The project root is `site` and the production branch is `main`. The clean URLs are `/`, `/privacy`, `/support`, `/changelog`, and `/terms`. The changelog page is generated from `changelog/*.md` at the repository root by `npm run changelog:build`.

When the Chrome Web Store listing is public, set the one `data-store-url=""` attribute in `index.html` to the full public listing URL. The button will read “Add to Chrome” and link to that listing. Leave the attribute empty until the listing is public.
