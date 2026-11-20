# ScreenHawk

ScreenHawk is a Chrome extension for asking questions about an area of the current tab.

## Set up

1. Run `npm ci` and `npm run build`.
2. Open `chrome://extensions` in Chrome 106 or later. Turn on Developer mode and choose **Load unpacked**. Select the `dist` folder.
3. Open the ScreenHawk toolbar popup and choose **Settings**.
4. Paste your own OpenAI API key, then choose **Save settings**. The key needs OpenAI API access with available quota and permission to call your model. ScreenHawk defaults to `gpt-6-luna`. You can enter another OpenAI model that accepts image inputs through Chat Completions.

## Use it

Choose **Select area** in the toolbar popup, or press **Cmd+Shift+S** on Mac or **Ctrl+Shift+S** elsewhere. Drag over the part of the visible page you want to share. Enter your question and choose **Ask**. The answer appears on the same page.

To draft text for a form, click an editable text area and choose **Draft for field** in the toolbar popup. Review or clear the field label, enter what you want to say, and choose **Generate draft**. Copy the draft into the form when you are ready.

Press **Escape** to close the overlay or cancel selection. Chrome restricts extensions on certain pages, including `chrome://` pages and the Chrome Web Store. If the shortcut is unavailable, check its assignment at `chrome://extensions/shortcuts`.

## Privacy

Your key and model setting are saved in local extension storage on this device. ScreenHawk captures the visible tab locally when you start a selection. When you choose **Ask**, it sends just the selected image and question directly to the OpenAI API using your key. When you choose **Generate draft**, ScreenHawk sends only the label shown in the dialog and the instructions you type. It does not read the form’s entered values or submit the form. OpenAI handles each request under your API account. ScreenHawk does not send data to the developer or run analytics.

The toolbar popup's **History** shows your latest 20 successful capture questions and answers with the time and a compressed thumbnail of the selection. Open a question to review its answer or delete the entry. History is stored on this device.

## Test

```sh
npm ci
npx playwright install chromium
npm test
```

The browser test loads the built extension in headless Chromium. The default run sends requests to a local mock and needs no secrets. For the live test, set `OPENAI_API_KEY` in your environment and run `npm run e2e:real`. Set `SCREENHAWK_EVIDENCE` to write evidence to a different folder. Evidence includes screenshots and a video. The live test makes one API request using your API quota.

## Changelog updates

`changelog/*.md` is the source of truth for the public `/changelog` page. Entries use date, title, status, and prs frontmatter, plus New, Improved, and Fixed bullet groups. Run `npm run changelog:build` after you set an entry to `status: published`. Run `npm run changelog:add` with the GitHub CLI to draft merged pull requests since the latest published date. On merges to main, the Draft changelog Action opens a draft pull request for review.

