# ScreenHawk

ScreenHawk is a Chrome extension for asking questions about an area of the current tab.

## Install from the Chrome Web Store

[Add ScreenHawk to Chrome](https://chromewebstore.google.com/detail/screenhawk/leppimoaddibhnikopkcooeaehcifbin). For a local development build, follow the unpacked installation steps below.

## Install unpacked in Chrome

Use Chrome 106 or later and Node.js 24 with npm. From the repository root, run:

```sh
npm ci
npm run build
```

The build creates `dist/`. Keep the entire folder together. It contains
`manifest.json` at its root, `background.js`, `content.js`, `popup.html`,
`popup.js`, `options.html`, `options.js`, `ui.css`, and the `icons/` folder.

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and select the built `dist` folder.
3. In Chrome's **Extensions** menu, open **ScreenHawk**. Pin it if you want it on the toolbar.

### Verify the install

- On `chrome://extensions`, confirm **ScreenHawk** is enabled and check its card for errors.
- Open the ScreenHawk popup and click **Settings**. Paste your own OpenAI API key and click **Save settings**. Reopen Settings to confirm the key was saved. The key needs API access, available quota, and permission to call your model. The default is `gpt-6-luna`. For area questions, use a model that accepts image inputs through Chat Completions. Drafting uses the same model with text input.
- On a regular HTTPS page with non-sensitive content, open the popup and click **Select area**. Drag over part of the page and press **Escape** to check that the overlay closes. To verify a live answer using your API quota, select again, enter a question, and click **Ask**. Confirm the answer appears on that page.

### Troubleshooting

- **Chrome can't load the manifest or a file:** Run `npm run build` again and choose the folder with the built `manifest.json` directly inside it.
- **Chrome still shows the old build:** After rebuilding, click **Reload** on the ScreenHawk card at `chrome://extensions`, then refresh your test tab.
- **Select area does nothing:** Switch to a regular web page. Chrome blocks extensions on `chrome://` pages and the Chrome Web Store. For a shortcut that does nothing, check `chrome://extensions/shortcuts`.
- **Ask shows an API error:** Open **Settings**, check the saved key and model, and review the API account's access and quota.

## Build a ZIP for manual installation

Run `npm run package:zip` after `npm ci` with the `zip` command on your PATH. Extract `build/screenhawk-unpacked.zip` and select the extracted folder containing `manifest.json` when you choose **Load unpacked**.

## Use it

Choose **Select area** in the toolbar popup, or press **Cmd+Shift+S** on Mac or **Ctrl+Shift+S** elsewhere. Drag over the part of the visible page you want to share. You can also move with the arrow keys and mark each corner with Enter or Space. Hold Shift for smaller movements. Enter your question and choose **Ask**. The answer appears on the same page.

To draft text for a form, click an editable text area and choose **Draft for field** in the toolbar popup. Click **Help me write** at the top right of the text area. Review or clear the field label, enter what you want to say, and choose **Generate draft**. Review the draft, then choose **Use draft** for an empty field or **Replace field text** for a field with text.

Press **Escape** to close the overlay or cancel selection. Chrome restricts extensions on certain pages, including `chrome://` pages and the Chrome Web Store. If the shortcut is unavailable, check its assignment at `chrome://extensions/shortcuts`.

To select a field directly, choose **Choose field** or press **Ctrl+Shift+Z** (**Command+Shift+Z** on Mac). Choose a highlighted editable text area or plain text input, then use **Help me write** to create and review a draft. Press **Escape** to cancel field selection.

## Privacy

Your key and model setting are saved in local extension storage on this device. ScreenHawk captures the visible tab locally when you start a selection. When you choose **Ask**, it sends just the selected image and question directly to the OpenAI API using your key. When you choose **Generate draft**, the only page or user text ScreenHawk sends is the reviewed field label and the instructions you type. It checks the selected field's value on your device before inserting the draft so it can preserve any changes made while you were drafting. You submit the form yourself. OpenAI handles each request under your API account. The Chrome extension has no developer server or telemetry. The ScreenHawk website uses Vercel Web Analytics for aggregate page views and Chrome Web Store link clicks. The [website privacy policy](site/privacy.html) explains what those events contain.

The toolbar popup's **History** shows up to 20 saved capture questions and answers with the time and a compressed thumbnail of the selection. Open a question to review its answer or delete the entry. History is stored on this device and excludes form drafts.

## Test

```sh
npm ci
npx playwright install chromium
npm test
```

The browser test loads the built extension in headless Chromium. The full suite also checks the changelog, extension error recovery, and website analytics. The default run sends requests to a local mock and needs no secrets. For the live test, set `OPENAI_API_KEY` in your environment and run `npm run e2e:real`. Set `SCREENHAWK_EVIDENCE` to write evidence to a different folder. Evidence includes screenshots and a video. The live test makes one API request using your API quota.

## Changelog updates

`changelog/*.md` is the source of truth for the public `/changelog` page. Entries use date, title, status, and prs frontmatter, plus New, Improved, and Fixed bullet groups. Run `npm run changelog:build` after you set an entry to `status: published`. Run `npm run changelog:add` with the GitHub CLI to draft notes for unlisted pull requests merged to main on or after the latest published entry’s UTC date. When the Draft changelog workflow generates a new entry for a merge, it pushes a `changelog/pr-<number>` branch and tries to open a draft pull request. GitHub Actions currently lacks permission to open those pull requests in this repository. If a draft branch exists, open a pull request from it and review the entry before publishing.

